# Project Specification: MarginNote MCP Bridge

## 1. Project Summary

Build a local MCP server that exposes MarginNote 4 capabilities to the Codex CLI running inside the Claudian Obsidian plugin.

Codex CLI must remain the only reasoning and agent layer. The bridge translates MCP tool calls into the existing MarginNote RPC protocol and performs no reasoning of its own.

Target architecture:

```text
Obsidian / Claudian
        │
    Codex CLI
        │ stdio MCP
        ▼
MarginNote MCP Bridge
        │ localhost RPC
        ▼
MarginNote Addon
        │
    MarginNote 4
```

Upstream project: `shentry/marginnote-agent`

## 2. Objective

Allow Codex CLI inside Claudian to:

- retrieve the current MarginNote context and selection;
- list notebooks and search notes;
- read individual notes and supported PDF pages;
- navigate MarginNote to a specified note;
- append comments and later create or update notes;
- combine MarginNote data with Obsidian files in one Codex task.

The bridge must not contain LLM calls, model prompts, an agent loop, conversation state, or autonomous planning. It may expose static MCP initialization instructions and tool descriptions that help the client choose tools; the MCP client remains responsible for reasoning.

### Long-term outcomes

1. Codex can read the complete user-selected card library across MarginNote study sets, propose a knowledge-framework-based reorganization, and apply an approved plan without deleting cards.
2. Codex can turn knowledge frameworks from the current conversation, or from chat records explicitly supplied to it, into a hierarchy of MarginNote mind-map cards.

The bridge remains a deterministic data and mutation layer. Codex owns synthesis and planning; the bridge neither stores nor retrieves chat history on its own.

## 3. Component Responsibilities

### 3.1 Codex CLI

Codex CLI owns user interaction, reasoning, planning, tool selection, Obsidian access, and cross-source synthesis.

### 3.2 MarginNote MCP Bridge

The bridge owns:

- MCP server initialization and tool registration;
- argument validation;
- translation between MCP calls and MarginNote RPC requests;
- response normalization;
- timeouts and structured error mapping;
- minimal operational logging.

For stdio transport, stdout must be reserved exclusively for MCP protocol messages. Logs must be written to stderr.

### 3.3 MarginNote Addon

The addon owns access to MarginNote native APIs, UI context, notes, documents, navigation, writes, and UndoManager integration.

## 4. Upstream Repository Audit

Before implementation, inspect the complete `shentry/marginnote-agent` repository and document:

- Addon-to-Host request lifecycle;
- RPC transport, queue, polling, timeout, and reconnection behavior;
- locations of native MarginNote tool implementations;
- MarginNote object identifiers and serialized data shapes;
- dependencies between tools and the current agent or HTTP layers;
- write behavior and UndoManager integration;
- process ownership and use of port `42117`;
- reusable modules, removable modules, and required modifications.

Produce `docs/ARCHITECTURE.md` before implementing the MCP layer.

Reuse where practical:

- MarginNote addon;
- MarginNote RPC protocol and transport;
- native tool implementations;
- MarginNote data types;
- UndoManager integration.

Remove from the runtime path:

- LLM client and model configuration;
- agent loop and prompts;
- chat UI;
- conversation and session persistence;
- external MCP client and orchestration.

## 5. Functional Scope

### 5.1 Phase 1: Proof of Concept

Implement:

- `marginnote.get_context`
- `marginnote.search_notes`
- `marginnote.get_note`

This phase is the primary Go/No-Go checkpoint. It passes only when Codex CLI inside Claudian can retrieve real MarginNote data through MCP.

### 5.2 Phase 2: Complete Read and Navigation Layer

Add:

- `marginnote.get_selection`
- `marginnote.list_notebooks`
- `marginnote.get_current_pdf`
- `marginnote.focus_note`

### 5.3 Phase 3: Controlled Write Layer

Add:

- `marginnote.append_comment`
- `marginnote.create_note`
- `marginnote.update_note`

Initial versions must not expose deletion, bulk mutation, bulk movement, or automatic mind-map restructuring.

### 5.4 Future Library and Framework Workflows

After the single-card write layer has passed real MarginNote persistence and Undo checks:

- expose bounded library enumeration across study sets, retaining stable note IDs, parent/child order, source-document links and available summary relationships;
- provide a complete logical snapshot through multiple bounded calls if the library exceeds one MCP response;
- let Codex produce a reviewable plan of card creations, text edits, moves and links; validate targets, cycles, scope and changed-source conflicts before applying it;
- apply an approved plan in small, traceable batches with read-back verification and a recovery path, without deletion;
- create card hierarchies from conversation-derived framework data passed explicitly by Codex; no chat-history persistence is added to the bridge.

The native API exposes `summaryLinks` for reading, but creation of MarginNote's special Summary nodes is not yet verified. Do not represent an ordinary parent/child grouping as a native Summary node.

## 6. MCP Tool Contracts

### Current public contract — 0.9.2

The user approved the task-oriented tool restructure. The public MCP interface is `get_workspace`, `list_notebooks`, `search_cards`, `read_card`, `read_card_tree`, `read_pdf_page`, `create_cards`, `append_card_comment`, `promote_excerpt_to_title`, `preview_card_moves`, and `apply_card_moves`. These supersede the earlier public tool names in the historical sections below. `mcp/src/tools.mjs` declares current input/output schemas; `docs/TOOL_REVIEW.md` maps every preceding capability to its replacement.

`read_card` resolves the focused card when note_id is omitted, then pins that ID for text and media reads. It combines card text/relationships with bounded visual attachments, linked visual comments and sketch sources, image blocks and local image paths. Media pagination requires an explicit note_id on later pages. A missing handwriting render is reported separately from empty text; no handwriting transcript is fabricated.

`read_pdf_page` combines the existing PDF locator with local text/OCR and rendered-page output. include_content=false retains the locator-only workflow. `create_cards` uses the existing verified framework primitive for either one node or a hierarchy. Move preview and application remain distinct; the original write lock, stale-snapshot/plan checks, bounds and unknown-timeout handling remain enforced.

The shared Host continues to use stable internal native RPC names in `mcp/src/rpc-tools.mjs`. The Add-on does not launch processes. A Homebrew-managed supervisor owns the Host and the local dashboard, while MCP stdio remains client-launched. Agent reasoning and visual interpretation remain in the MCP client.

Exact schemas must reflect the capabilities and data structures verified during the repository audit. Stable MarginNote IDs are canonical identifiers.

### 6.1 `marginnote.get_context`

Returns available current state, including notebook, document, page, note/card, selection, and stable IDs.

### 6.2 `marginnote.get_selection`

Returns the content or object currently selected by the user in MarginNote.

### 6.3 `marginnote.search_notes`

Input:

```json
{
  "query": "string",
  "notebook_id": "optional string",
  "limit": "optional integer"
}
```

Each result should include available fields such as note ID, title, excerpt or content, comment, notebook, document, page, and parent note.

### 6.4 `marginnote.get_note`

Input: `note_id`.

Returns the full representation available through the native integration.

### 6.5 `marginnote.list_notebooks`

Returns at least `notebook_id` and `title` for each accessible notebook.

### 6.6 `marginnote.get_current_pdf`

Returns only the local absolute path, file name and current zero-based page index of the PDF open in the connected study window, plus a one-based page number and available document metadata. No PDF content is returned. Codex opens the local file and reads or renders the indicated page using its own file access. Missing or nonabsolute paths and unavailable page indices are explicit errors; the bridge does not infer a path or page. Re-query after changing documents or pages. No OCR or model call is performed by the bridge.

### 6.7 `marginnote.focus_note`

Accepts a note ID and brings the corresponding note or card into view without modifying data.

### 6.8 `marginnote.append_comment`

Accepts a note ID and content. It appends content without overwriting the existing note.

### 6.9 `marginnote.create_note`

Exposes only fields reliably supported by the native integration. The MCP layer must not invent unsupported abstractions.

### 6.10 `marginnote.update_note`

Updates one explicitly identified note per tool call. No bulk update interface is permitted in the initial version.

## 7. Transport and Process Model

Codex CLI communicates with the bridge over stdio MCP. The bridge communicates with the addon through the upstream localhost RPC mechanism unless the audit reveals a blocking defect.

Any network listener must bind only to `127.0.0.1`.

The implementation must define ownership of the RPC listener and handle multiple Codex or Claudian sessions deterministically. It must prevent silent port conflicts and return a clear startup error if the required port is already owned by an incompatible process.

## 8. Security and Privacy

The bridge must operate locally and must not require or store:

- OpenAI or Anthropic API keys;
- Codex credentials;
- conversation history;
- copies of the Obsidian Vault;
- full note or PDF payloads in normal logs.

Model access and authentication remain entirely within Codex CLI.

## 9. Error Handling

Return structured MCP errors for at least:

- `MARGINNOTE_NOT_RUNNING`
- `MARGINNOTE_ADDON_UNAVAILABLE`
- `MARGINNOTE_RPC_TIMEOUT`
- `NOTE_NOT_FOUND`
- `INVALID_ARGUMENT`
- `RPC_FAILURE`
- `PORT_IN_USE`

A failed tool call must not terminate the MCP server unless the process is unrecoverable.

Read-only calls may be retried only when they are idempotent. A timeout during a write has an unknown outcome and must not trigger an automatic retry, because the original write may already have succeeded.

## 10. Logging

Normal development logs may include timestamp, tool name, RPC method, duration, success or failure, and error code. Logs go to stderr.

Full PDF text, note contents, prompts, credentials, and conversation history must not be logged by default. Payload logging may be enabled only through an explicit development flag.

## 11. Preferred Project Structure

```text
marginnote-agent/
├── addon/
├── host/
├── mcp/
│   ├── src/
│   │   ├── index.mjs
│   │   ├── server.mjs
│   │   ├── tools.mjs
│   │   ├── schemas.mjs
│   │   ├── marginnote-client.mjs
│   │   ├── errors.mjs
│   │   └── config.mjs
│   ├── test/
│   └── (uses root package.json and lockfile)
├── docs/ARCHITECTURE.md
├── PROJECT_SPECIFICATION.md
└── README.md
```

The exact structure may change after the audit. Prefer refactoring and reuse over copying large modules.

## 12. Testing Strategy

### 12.1 Automated Tests

Test:

- MCP initialization and tool discovery;
- schema validation;
- RPC serialization and response normalization;
- timeout and error mapping;
- process and port conflict behavior;
- write timeout behavior without automatic retries;
- MCP-to-mock-MarginNote integration.

### 12.2 macOS Integration Tests

On a Mac with MarginNote 4, verify:

- real context and selection retrieval;
- notebook listing and note search;
- note retrieval by returned ID;
- current PDF path and page-index retrieval, followed by local file access from the client;
- navigation with `focus_note`;
- writes to the intended note;
- persistence and Undo behavior;
- graceful behavior when MarginNote or the addon is unavailable.

### 12.3 Claudian End-to-End Tests

Verify these tasks from Codex CLI inside Claudian:

```text
Search MarginNote for notes about CAP theorem and compare them with my Obsidian notes.
```

```text
Append this explanation to the MarginNote card I am currently working on.
```

## 13. Implementation Stages

### Stage 0: Repository Audit

Create `docs/ARCHITECTURE.md` and confirm the actual implementation plan.

### Stage 1: MCP Proof of Concept

Implement `get_context`, `search_notes`, and `get_note`; add automated tests; configure Codex and verify the real Claudian workflow before proceeding to Stage 2.

### Stage 2: Read and Navigation Layer

Add the remaining read and navigation tools and harden validation, timeouts, reconnect behavior, and errors.

### Stage 3: Write Layer

Add `append_comment`, `create_note`, and `update_note`; verify target selection, persistence, Undo, and uncertain timeout handling.

### Stage 4: Claudian and Codex Integration

Document the MCP configuration used by Codex CLI inside Claudian. The intended workflow is to open MarginNote, Obsidian, and Claudian, then use Codex normally without a separate AI chat interface.

### Stage 5: Library Reorganization and Conversation-to-Mind-Map

Verify full-library enumeration and source relationships; implement a bounded snapshot contract. Add plan preview and validation before any library-wide mutation. Verify native move, ordering, Summary and Undo behavior on disposable study sets before enabling each operation. Add a structured framework-to-cards write path for content supplied by Codex from a conversation.

## 14. Acceptance Criteria

### 14.1 Proof of Concept

All conditions must pass:

1. Codex CLI inside Claudian discovers the MarginNote MCP tools.
2. `get_context` returns real MarginNote state.
3. `search_notes` returns real MarginNote notes.
4. `get_note` retrieves a returned note by stable ID.
5. MarginNote or addon unavailability returns a clean structured error.
6. The bridge requires no separate LLM or API configuration.
7. Existing Obsidian and Codex functionality remains unaffected.

### 14.2 Read Layer

Codex successfully combines MarginNote MCP results and Obsidian filesystem content in one task.

### 14.3 Write Layer

Codex appends a comment to the intended current card, the change appears in MarginNote, and the user can undo it through MarginNote.

### 14.4 Long-term Workflows

- A full-library snapshot reports its scope and complete card count, and can be resumed until all cards are read without losing stable IDs or parent/child relationships.
- Before reorganization, Codex presents the proposed card moves, creations and edits for review; the applied result matches that plan and can be verified by reading back the affected cards.
- Given an explicit conversation-derived outline, Codex can create the corresponding card hierarchy in the intended study set and verify its structure and text.
- No card deletion is required or exposed for these workflows.

## 15. Non-Goals

The initial stages do not include:

- another AI agent inside MarginNote;
- a new MarginNote chat UI;
- MarginNote-to-Obsidian database synchronization;
- Markdown mirroring of all MarginNote notes;
- automatic mind-map restructuring before the Stage 5 validation and review workflow;
- destructive autonomous operations;
- multi-user or cloud hosting;
- public-network access;
- mobile or iPad agent execution.

## 16. Ownership Model

```text
Codex CLI             Agent, reasoning, and orchestration
Claudian              Codex interface inside Obsidian
Obsidian              Long-term knowledge workspace
MarginNote            Reading, annotation, and study workspace
MarginNote MCP Bridge Deterministic integration layer
```

The bridge should remain as small and deterministic as the verified upstream architecture permits.

## 17. Approved Implementation Decisions (2026-10-03)

- Audit the checked-out fork and record its commit; upstream is provenance, not permission to overwrite local changes. Keep one architecture document at docs/ARCHITECTURE.md. Use existing ESM JavaScript (.mjs) and a pinned MCP SDK with a lockfile.
- A separately managed, shared RPC Host is the sole owner of 127.0.0.1:42117. Each Codex session starts a lightweight stdio MCP process that connects to it. MCP processes never kill or take over an existing listener. Identify the host by service name and protocol version. Old Agent Hosts are incompatible. `mn-agent serve`, run by `brew services`, owns the supervisor and bridge child; `npm start` remains a bridge-only development entry point, and legacy code may remain outside the default runtime.
- The default addon archive contains a bridge-only entry point, without the chat panel. Installation/enablement in MarginNote is part of real integration acceptance. Existing source is retained for reference and rollback through Git.
- Phase 1 exposes only the three PoC tools, at both the MCP and RPC boundaries. The host must reject unsupported native tool names, including all mutations.
- Current context must identify its window. Until native active-window APIs are verified, support exactly one connected MarginNote study window and return AMBIGUOUS_CONTEXT for multiple windows. Never pick a window silently. Empty selection and absent study context are normal explicit states.
- Map note_id to noteId, notebook_id to topicId/notebookId, and document_id to docMd5. IDs remain opaque strings. Unknown IDs are null rather than fabricated. Preserve native page fields explicitly until their indexing is verified. Search defaults to all notebooks unless notebook_id is supplied; default limit 30, maximum 100. Search returns notes only, with stable note IDs. No pagination is claimed until native support is verified; indicate possible truncation at the limit. Bound responses and signal truncation.
- Business failures return MCP tool results with isError and an error object containing code, message and outcome where applicable. JSON-RPC protocol failures remain protocol errors. PORT_IN_USE during Host startup is a stderr diagnostic and nonzero exit. Distinguish HOST_UNAVAILABLE, HOST_INCOMPATIBLE, NO_ACTIVE_CONTEXT and AMBIGUOUS_CONTEXT. Report MARGINNOTE_NOT_RUNNING only when process inspection establishes it; otherwise report MARGINNOTE_ADDON_UNAVAILABLE.
- Disable automatic retries and redelivery at every transport layer initially. A dispatched write with lost response has outcome unknown. Queue expiry before dispatch has outcome not_started. Discard late responses. Future deduplication must not claim exactly-once behavior across crashes.
- Writes require explicit stable target IDs obtained from prior reads, independent of later UI focus. Validate notebook and parent membership before creating anything. Undo grouping is not assumed to roll back failures; partial writes must be reported honestly. Verify persistence and Undo on a disposable test note before enabling Stage 3.
- Bound pending requests and HTTP payloads, validate loopback Host/Origin, and reject unknown RPC methods. Local-only transport does not imply local-only model inference: Codex may send returned content to its configured model provider.
- Stage 0 records actual Claudian/Codex versions and configuration loading. Stage 1 includes real tool discovery from Claudian. Stage 4 consolidates documentation and full regression checks. Mock success is never reported as real MarginNote or Claudian acceptance.

## 18. Homebrew Service Decision (2026-10-27)

- One foreground supervisor is owned by `brew services`. It serves the dashboard and starts or stops only its own bridge child as MarginNote opens or closes.
- MCP stdio remains client-launched. It is not installed or managed as a second background service.
- Runtime settings, generated add-ons, helper binaries, and build staging live under `~/Library/Application Support/MarginNote Agent`, outside the Homebrew Cellar.
- Client configuration uses Homebrew's stable `bin/marginnote-agent-mcp` link so upgrades do not invalidate it.
- The supervisor must not terminate an unrelated process that already owns the bridge port.
- The dashboard may detect an installed add-on manifest but must not claim that MarginNote has enabled the extension. Bridge liveness remains the independent connected-state signal.
