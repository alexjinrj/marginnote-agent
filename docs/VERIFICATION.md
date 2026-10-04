# Verification — 2026-10-03

## Automated evidence

- Node.js runtime used: /Users/alexjinrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.
- Pinned dependencies: @modelcontextprotocol/sdk 1.31.0, zod 3.25.76; pnpm-lock.yaml.
- Final result: 38 tests passed, 0 failed.
- Command: node --test host/test/*.test.mjs mcp/test/*.test.mjs.
- MCP SDK client handshake, discovery and the three original tool calls tested against actual stdio processes and an actual loopback HTTP Host, with a mock native addon.
- Covered: two MCP clients sharing Host; schema checks; mutation rejection; Origin/Host checks; native not-found error; offline/reconnect; port collision; incompatible Host; timeout outcome; no dispatched-write redelivery; late result rejection; bounded normalization; multi-scene addon refusal in a JavaScript VM; Host shutdown/restart.
- Addon build/verify checks archive root, required files, bridge-only entry point, and absence of AgentPanelController.js.
- Legacy automated tests remain passing. They do not establish native MarginNote compatibility.

## Local observations and remaining gate

- Installed Codex CLI reports 0.160.0. Claudian manifest in the open MN4 vault reports 2.3.11.
- Shared Host started successfully at 127.0.0.1:42117 with expected service/protocol identity. Addon liveness remained false.
- Actual smoke call through stdio MCP returned MARGINNOTE_ADDON_UNAVAILABLE cleanly. No real note retrieval is claimed.
- User elected to install and test the built addon themselves. No verified addon installation, Claudian MCP configuration, launchd installation or real write occurred in this run.
- The temporary development Host is stopped at handoff; start it using the README commands.

## User acceptance steps

1. Start Host; install and enable dist/marginnote-agent.mnaddon in MarginNote 4.
2. Open exactly one study window; health should show online=true.
3. Run `pnpm run smoke -- "a term present in your notes"`. Expect context passed, search_count > 0 and get_note_id_match=true.
4. Add the README MCP entry to the actual Codex configuration used by Claudian; start a new Codex conversation.
5. Ask it to get MarginNote context, search a known term, then get one returned note by ID. Verify the notebook and content against the UI.
6. Stop/disable the addon and verify a clean error; restore it and verify the next call succeeds.

Only after steps 3–5 pass is the Stage 1 Go/No-Go gate satisfied. Stage 2 read/navigation and Stage 3 writes remain unimplemented and disabled. Native multi-window lifecycle, page indexing, search result shape and selection availability still require macOS verification.

## Live integration update — 2026-10-03

After the user started the Host and installed the addon, `/health` reported `service=marginnote-mcp-bridge`, `protocol=1`, `version=0.3.0`, and `online=true`. `codex mcp get marginnote --json` showed an enabled stdio entry with the correct absolute Node executable and MCP script paths.

`node scripts/smoke-bridge.mjs Perceptron` passed through the real stdio MCP, shared HTTP Host and MarginNote addon: 3 tools discovered, live context available, 3 search results, and `get_note` returned the same stable ID selected from search. This establishes the Stage 1 real-data bridge path. The test reports counts/status only and did not modify notes.

The Codex Desktop conversational invocation, Claudian invocation, disconnect/reconnect, multi-window behavior and native page indexing remain unverified. The user can now ask a new Codex session to use `marginnote.get_context`; the tool's native content should be compared with the open MarginNote study window before calling the user-facing workflow fully accepted.

## PDF reading update — 2026-10-03

`marginnote.read_pdf` is now registered across MCP, Host and addon. Automated SDK-to-Host tests confirm discovery, argument mapping and page-numbered response. Addon VM tests cover text extraction, cursor and document-ID mismatch. The 0.4.0 addon archive is built separately for user installation. Live PDF text extraction and image handling have not been verified in MarginNote 4; the Host was offline during this update. Images, handwriting and scanned pages are not interpreted.

## PDF locator update — 2026-10-03

Per user direction, the public PDF tool is now `marginnote.get_current_pdf`. It returns only the local absolute PDF path, file name, document ID and current zero-based/one-based page positions. The previous public `read_pdf` tool is removed from MCP and the bridge allowlist. The old internal implementation remains in legacy code and is not reachable through the bridge. A `smoke:pdf` command checks that the file can be opened from the local Node process without printing its content. Real MarginNote path and page behavior still require installation of the 0.5.0 addon and a running shared Host.

## Library and writing update — 2026-10-04

Version 0.6.0 adds paged notebook/card reads, single-card creation, comment append, conversation-outline card creation, excerpt-to-title, and preview/apply card moves. Host write calls require `MN_ENABLE_WRITES=1`; read calls remain available with writes disabled. Native API support was checked against the official Addon headers for `allNotebooks`, `notes`, `createNoteWithTitle`, `addChild`, `insertChild`, `noteTitle`, and `undoGrouping`.

Automated tests exercise a simulated MarginNote object graph plus SDK → stdio MCP → HTTP Host → addon queue mapping. The final local run passed 46 tests; addon build/verify passed. These checks do not prove native MarginNote 4 persistence or Undo. Install the 0.6.0 addon and test writes only in a disposable study set: create a card and framework, append a comment, preview and move a card, compare the UI and readback, then use MarginNote Undo. Native Summary creation is not exposed.
