# Verification

## Homebrew service, dashboard and OCR integration — 2026-10-27

Validation environment: Linux host, Node.js 24.22.1 from the local Playwright
runtime. This validates JavaScript behavior, packaging, and local HTTP
responses only. macOS process inspection, launchd/`brew services`, real
MarginNote integration, and the add-on installation UI were not available in
this environment and are **not** claimed as validated.

The Homebrew-focused tests passed 13/13:

```sh
/home/j/jin0722/.cache/uv/archive-v0/nC8Dlye74aq3gAVt/playwright/driver/node \
  --test scripts/test/*.test.mjs \
  host/test/host-control.test.mjs \
  host/test/marginnote-host-supervisor.test.mjs
```

They cover service paths outside a Cellar, stable MCP wrapper resolution,
add-on packaging, realistic sandboxed-container detection, manifest ID
validation, Codex config/path drift detection, dashboard health and origin/token
checks, and the supervisor starting/stopping only its own child while leaving
an unrelated listener untouched. The dashboard smoke test returned:

```json
{"service":"marginnote-agent-dashboard","protocol":1}
```

`ruby -c Formula/marginnote-agent.rb`, Node syntax checks, and
`git diff --check` passed. `share/marginnote-agent.mnaddon` is a seven-entry,
13,294-byte archive with SHA-256
`88fb502644f9ae04ca36dc205c981f5ed074951e1a56939f9530627fdc47f805`.

After integrating the OCR/card-verification work, the full suite passed under
the same Node.js 24 runtime: 68 passed, 0 failed, and one intentionally skipped
test. This includes all Host, MCP, add-on VM, dashboard, service-config,
packaging, OCR and card-verification tests. The integrated stdio bridge suite
also passed 13/13, including the permission-restricted handwriting render.

The full bridge suite is not compatible with the Node.js 26 test runner in
this environment: two stdio subprocess tests fail there, while the same tests
pass under Node.js 24.22.1. The project requires Node.js >=20, and Node.js 24
is the runtime recorded here.

The add-on build script cannot run on this Linux host because it requires
macOS with Xcode Command Line Tools. The committed archive was therefore
validated instead with `scripts/verify-addon.mjs`, `unzip -t`, both shell
wrappers with `bash -n`, the Node CLI with `node --check`, and the Formula with
`ruby -c`.

The integration is committed as `30352a1`, which combines the Homebrew
implementation and OCR/card-verification work. The commit still has to be
published and the Formula placed in a tap before users can install it from
Homebrew. macOS Homebrew install, `brew services`, and real MarginNote
add-on/MCP acceptance remain required before calling the distribution workflow
verified.

## Claudian cache-access fix — Host/MCP 0.9.1, 2026-10-05

Read the actual Claudian Codex transcript corresponding to the user's quoted failure. It called the new `read_card({})`, not a stale tool: the result had `media_status=unavailable`, `reason=RENDER_CACHE_UNAVAILABLE`, null image path and no image content block. Thus the model's reply accurately described that particular response. Direct local testing of the same selected card returned a readable image. The private-cache access was in the MCP subprocess, whose execution context differs from the manually started Host.

Moved the render stage into the Host after native media normalization. A permission-restricted Node client, allowed to read only the repository and its temporary directory, reproduced no image against the existing 0.9.0 Host. An isolated read-only 0.9.1 Host test reused live native card/media identifiers from that running Host and rendered the real cache image. The same restricted stdio MCP client returned `media_status=ready`, an image block, and a matching 147,714-byte local JPEG for the selected 81-stroke card. Opened the JPEG and verified the implication/transitivity handwriting. This test did not replace the existing Host or modify notes. Native macOS nested sandbox execution was unavailable in this environment; the restricted-client verification used Node file permissions instead.

Added an SDK/HTTP regression test with a permission-restricted stdio subprocess and opaque handwriting returned by the simulated Add-on. The Host supplied pixels before MCP processing. No Add-on changes are required for this fix. Updated descriptions/instructions also tell code-execution agents to forward image blocks with `image(block)` or open the local image path, rather than stringify images into text. The user's actual Claudian session still requires reconnecting after restarting the manual Host; automatic transcription in that UI has not yet been re-tested.

Final verification: 59 tests passed, 0 failed; `git diff --check` passed. The existing production-port Host remained 0.9.0 throughout this isolated verification and needs a manual restart to load 0.9.1.

## Current tool release — 0.9.0, 2026-10-05

The public MCP interface now advertises 11 task tools with input/output schemas. Internal RPC names remain stable. SDK-to-HTTP tests cover text-plus-image card composition, directory/tree browsing, PDF location, one-card/hierarchy creation, comment append, title promotion, preview/apply moves, write enablement, stale validation, errors and Host recovery. Native VM tests retain the original mutation checks and now verify media hashes, comment note IDs and tree visual hints. The standalone reader tests cover multi-source card media, subsequent media pages pinned to a note ID, empty text cards, missing renders, focus fallback, bounded linked comments, variable cache suffixes and PDF image delivery without OCR text. Final suite: 58 tests passed, 0 failed; addon build and archive verification passed.

Live stdio MCP `read_card({})` successfully read the currently selected card `76728F3F-F57D-4816-A63A-6AABFA8A3BFC` from the user's running 0.8.0 Host/Add-on. Typed fields were empty; the card had a PaintNote comment and 81 strokes. The response contained a JPEG image block, a matching local path, `media_status=ready`, and explicit handwriting evidence. The actual JPEG (147,714 bytes, native media hash 6a910f7f49aadeb1e086d9ba95554144) was opened with the local image tool and visually showed the implication/transitivity derivation, including `¬R ⇒ ¬P ⇒ Q`. This verifies usable pixels and visual interpretation, not an OCR accuracy guarantee. The implementation contains no matching card-ID/hash condition.

Further live `list_notebooks` timed out and the following PDF locator request returned MARGINNOTE_ADDON_UNAVAILABLE. A read-only MarginNote UI observation showed the selected “暂停插件” control, and Host health reported online=false. These remaining live reads were not counted as passing. No live writes were performed in the user's coursework notebook; write behavior was verified through SDK/HTTP and the native-object simulation. New native metadata propagation and real write/Undo acceptance require the user to install 0.9.0, restore the plugin, restart the manual Host and identify a disposable study set.

At that time the user chose manual Host management. That historical milestone added no helper app, launchd registration, or automatic Host startup/shutdown. Existing Host ownership, no-write-retry and reconnect tests remained passing. The addon archive was rebuilt and checked separately at `dist/marginnote-agent.mnaddon`.

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

1. Start the Host; install and enable `dist/marginnote-agent.mnaddon` in MarginNote 4. (Historical acceptance step.)
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
