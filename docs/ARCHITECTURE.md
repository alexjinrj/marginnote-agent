# MarginNote MCP Bridge: architecture

Audit baseline: local fork alexjinrj/marginnote-agent, commit 8df0c58. Upstream provenance: shentry/marginnote-agent. Audited 2026-10-03.

## Audited legacy execution path

host/src/main.mjs loads model configuration and creates server.mjs. That module instantiates the LLM provider, AgentEngine, external MCP client manager, approvals and persisted sessions together with MarginNoteBridge. It cannot be reused as the new entry point without retaining the agent runtime.

The addon uses JavaScriptCore and native MarginNote APIs. addon/main.js loads a chat panel and starts a global MNAgentBridge on scene connection. Every 500 ms the addon requests /api/marginnote/next. Host queues {requestId, tool, arguments}; addon executes synchronously on the main queue and POSTs {requestId, success, result, error} to /api/marginnote/result. /connect and polling refresh liveness. Native HTTP timeout is 5 seconds; host RPC timeout is 60 seconds; offline threshold was 3 seconds. Upstream redispatches any request after 10 seconds, including writes. Lost write results could therefore duplicate mutations. Multiple scenes share a constant client ID and bridge singleton. There is no verified active-window routing.

addon/tools.js owns get_context, get_selection, read_pdf, list_notebooks, search_notes, get_note, create_note, update_note, append_comment and focus_note. IDs are noteId, topicId/notebookId and docMd5. Notes serialize title, excerptText, notesText, comments, children, parentNoteId, color and native page fields. SearchManager.searchText supports notebook filtering; searchPage can return page records without note IDs. PDF text is accessed through the currently open document, bounded to 20 pages/50,000 characters with cursors; there is no arbitrary-document lookup or new OCR.

Legacy writes run through UndoManager.undoGrouping, then mark notebook sync dirty and refresh UI. This is not evidence of transactional rollback. The bridge-only `create_card` path now validates parent membership before creating the note. Host writes remain disabled by default pending real persistence and Undo checks.

The current runtime does not use the legacy LaunchAgent path. Homebrew owns
`scripts/marginnote-host-supervisor.mjs` through `brew services`; the
supervisor starts only its own bridge child while MarginNote is running. No
process occupying a port may be killed automatically.

## Bridge components

```text
Claudian / Codex --stdio--> mcp/src/index.mjs (one per client)
                                    |
                            HTTP on 127.0.0.1:42117
                                    |
             supervisor child: host/src/bridge-main.mjs (shared)
                                    ^
                     addon polls /next and posts /result
                                    |
                       addon bridge-only entry point
                                    |
                          native MarginNote APIs

Homebrew service: scripts/marginnote-host-supervisor.mjs
        |-- owns the bridge child above
        `-- dashboard on http://127.0.0.1:42118
```

The RPC Host owns the queue and listener. Clients verify service/protocol identity on each call; they do not spawn or terminate the shared Host. The installed entry point for the background supervisor is `mn-agent serve`, run by `brew services`. A developer can invoke the same supervisor in the foreground, and `npm start` still starts only the bridge child for low-level testing. Host shutdown rejects pending calls; MCP EOF only closes its own process. Binding conflicts fail clearly. Reconnection means the next call can succeed after recovery, without retrying a previous operation.

The supervisor follows the MarginNote 4 process. It keeps the dashboard alive
even while the bridge is stopped, starts the bridge after MarginNote opens,
and stops only the bridge child it created after MarginNote closes. It checks
the bridge port before spawning and leaves an unrelated listener untouched.
The dashboard is therefore a control plane, not the bridge itself:
`/health` on 42118 identifies `marginnote-agent-dashboard`, while `/health` on
42117 identifies `marginnote-mcp-bridge`.

Since Host/MCP 0.9.1, `get_note_media` normalization is followed by cache rendering in the Host before the HTTP response. Exact native media hashes resolve private MarginNote cache images there; bounded PNG/JPEG bytes cross localhost to the stdio client. This avoids requiring a sandboxed Claudian/Codex MCP subprocess to read MarginNote's container. The MCP client still creates its own temporary image path and emits the standard image block. Existing Add-on 0.9.0 and RPC protocol 1 are compatible; older Hosts retain client-side cache rendering as a fallback.

The Homebrew service runs `scripts/marginnote-host-supervisor.mjs`. The
supervisor owns only its bridge child and serves the management page on
`127.0.0.1:42118`. The page reports bridge and MarginNote process state,
detects the add-on manifest and Codex MCP configuration, optionally performs a
10-second stdio MCP handshake, shows recent logs, persists pause/write
settings, and can rebuild the add-on archive. State is stored under
`~/Library/Application Support/MarginNote Agent`, never in the Cellar.
Write settings become `MN_ENABLE_WRITES` in the spawned Host environment.
Control actions require a per-process page token and same-origin request; this
protects against web-page requests, not other local processes. A bridge
started outside the service and occupying 42117 is never terminated by the
supervisor.

Add-on detection only validates an installed `mnaddon.json` with add-on ID
`com.marginnote.agent.host`. It does not claim that MarginNote has enabled the
extension. Liveness is established separately by the bridge health response
after the add-on begins polling. The standard search includes MarginNote's
sandboxed container root, plus the home Containers, Application Support,
Documents, and Applications directories. A configured explicit path wins.

MCP stdio is not a background service. Each client launches
`marginnote-agent-mcp` from the stable Homebrew `bin` link, and that process
connects to the shared bridge. Replacing a versioned Cellar path with the
stable link keeps client configuration valid across upgrades.

Reuse native tool implementations and the queue class, with redelivery removed and typed errors added. New bridge HTTP entry point imports no LLM, prompt, AgentEngine, session store, chat server or MCP orchestration. Existing legacy modules and tests stay as reference; default startup, supervisor and addon archive use bridge-only paths. Official MCP SDK handles stdio framing, initialization, discovery and protocol validation. ESM .mjs avoids adding a compiler.

## Contracts and limits

The public MCP task registry in mcp/src/tools.mjs exposes 11 tools, with explicit input and output schemas. Context, search, notebook/tree browsing, and card/PDF reading are distinct tasks. create_cards handles either one card or an ordered hierarchy; comment append, excerpt promotion and preview/apply moves remain separate. The complete capability mapping is in docs/TOOL_REVIEW.md.

The internal RPC registry is mcp/src/rpc-tools.mjs. The Host validates these stable native primitives and gates writes with MN_ENABLE_WRITES=1; /health reports writes_enabled. Public compound tools compose RPC primitives in the MCP process, never in the native UI thread. read_card resolves selection once, pins the card ID, obtains text and enumerates bounded visual media/related comments/sketches, using document-focus rendering as a fallback. Each usable attachment has a standard MCP image block and a local image_file_path for clients that expose only metadata. Raw strokes and failed image rendering have distinct statuses; the client model owns visual interpretation. read_pdf_page locates once and optionally extracts/OCRs/renders that physical page locally. MCP initialize instructions describe these task choices without introducing a model runtime.

A notebook page uses a content/structure snapshot ID to reject changed pagination. Move previews return snapshot and plan IDs; apply validates both, cycles and notebook membership before calling the native API. Each write is grouped for Undo and read back where possible, but grouping is not a transaction and a failed batch can leave partial changes. Native Summary creation remains unsupported.

Search defaults to all notebooks, or the supplied notebook_id, limit 30/max 100. The internal PDF locator returns the open document's native fullPathFileName and currPageIndex; the MCP layer validates an absolute local path and adds a one-based page number. The locator itself returns no content; read_pdf_page can add embedded/OCR text and a rendered page image. No bridge LLM call is made. Locator-only requests let the client open the PDF under its own filesystem permissions. Page search is excluded. Missing context is explicit. Structured errors contain code/message/outcome; ordinary native errors are sanitized to avoid leaking contents through logs. Stdout contains only MCP messages.

Only one study window is supported for PoC; the bridge-only addon tracks connected scenes and refuses ambiguous context. Context identifies window_id. This explicit limitation must be revisited before enabling multi-window operations. Native capability correctness requires macOS testing; VM mocks prove only JavaScript behavior.

At most 64 pending calls; bounded HTTP bodies/responses; no automatic dispatch retry. Request IDs identify results. Pending calls keep the addon logically busy during slow native execution, avoiding false offline errors from paused polling. Browser Origin and Host validation prevent cross-origin use; localhost transport is not authentication against other local processes. No external model connection is made by this runtime.

## Validation and rollout

1. SDK client -> stdio MCP -> real HTTP Host -> mock addon, including reconnect, timeouts, schema failures, incompatible listener, default write lock and enabled write mapping.
2. Package and inspect the bridge-only mnaddon; retain legacy source outside the package.
3. Install the addon, open exactly one study window, and read workspace/card/PDF data from actual MarginNote.
4. Confirm the MCP client discovers all tools from its managed configuration. Verify real returned note IDs. Test writes and Undo on a disposable study set before enabling them for normal use.
5. Install through the Formula, start the service with `brew services`, and verify that the dashboard follows MarginNote. These macOS service checks have not been run in the Linux validation environment.

Automated test success does not satisfy steps 3 or 4. Integration evidence and unresolved limitations are recorded in docs/VERIFICATION.md.
