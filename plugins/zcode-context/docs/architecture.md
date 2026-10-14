# Architecture

## Independent plugin

This package is separate from Canvas. It neither loads nor patches Canvas or ZCode.
The only visible integration is a session-scoped official UI surface.

## Identity

Host side pane session → session facade trace → MCP tools/call
_meta["com.zcode/request-context"].session_id → schema validation → scoped read.

Each request resolves identity independently. No global currentSessionId, workspace-to-last-session
map, hook, or browser global localStorage supplies authority. Missing identity fails closed.
Resource reads currently lack this metadata; the HTML is generic and first binds via an app-only tool.

## Data

- SQLite: canonical 30-day logical model-request facts; short readonly transactions, no migrations.
  Main-turn inputs are charted separately from compact/title/child requests. Totals include each
  model_usage row once. Unknown usage stays unknown. Cache normalization follows the upstream legacy helper.
- Trajectory: fixed session filename plus exact raw sessionId validation. Bounded asynchronous JSONL reader
  handles append, UTF-8 boundaries, reset, cold-tail gaps and partial lines. Only a missing file restarts the window;
  other system errors keep the position. A delta after a tail continues the tail's recorded range and stays partial. Expansion occurs before
  query-source filtering. Context snapshots compare content, not sampling or provider tokenization.
- Conversation store: the session's `message` / `part` rows (and `session.revert`) in the same SQLite file, read-only and
  incrementally by `time_updated`. Every message and part id is known: deletions are dropped, and rows below the cursor or a
  cursor that went backwards reload everything. Only the
  JSON fields events need are extracted; ordinary text and whole tool inputs never reach JavaScript. Injected text past
  4000 characters is matched by length and SHA-256. It is the source of injections,
  compactions (status, tokens, summarized messages on the active branch) and model switches for the whole session.
  Transient open errors keep the last events; a missing database or unsupported schema falls back to the logs.
- Event logs: three days, for rewinds, edited questions, MCP registrations and compactions the store has no row for.
  A negative size delta alone has no causal classification.

Requests are not forcibly joined across SQLite and traj: logical_request_id and adapter requestId
are not proven to be the same identifier. This avoids multiplying usage by network retries.

## Isolation and limits

A worker serializes reads and limits memory. Server identity is per call; worker caches use session/file keys.
Unexpected errors (anything but a ContextError) are logged to stderr, never to the stdio protocol channel, and reach the panel
only as `read_failed`. A read that times out (15 s) or is cancelled is skipped by the worker if it has not started (`src/data/runner.mjs`); the
busy limit of 8 counts reads the worker still holds, so abandoned work cannot pile up behind a slow read (`src/data/reader.mjs`).
The panel polls every 3 s, slows to 6 s and then 10 s while summaries stay unchanged, and returns to 3 s when it becomes
visible, gains focus or the pointer enters it. A measured unchanged refresh of a 32 MiB real session costs about 7 ms
(SQLite about 4 ms), so the service does not cache unchanged reads.
Overview exposes only bounded summaries. Detail returns element lists and 12k-character chunks on demand.
The page uses textContent for captured data. Everything runs offline.

A 24 MiB cold-file window and 8 MiB scan/line limits are deliberate limits, including full-retention mode.
Incompleteness travels with snapshots. A full snapshot may restore local completeness, while earlier history
remains missing. No fake context-window percentage or per-plugin provenance is derived from those gaps.

## Dependencies on ZCode

| Contract | Source baseline | Failure behavior |
|---|---|---|
| Official ui.surfaces and MCP Apps | UI_PLUGIN.md at aac4755 | Surface unavailable |
| Namespaced tool request metadata | adapters/src/mcp/index.ts; session-facade.ts | Binding error |
| model_usage schema and normalized token fields | repositories/usage.ts | Usage unavailable |
| Model I/O filename and full/delta/tail shape | runner-debug.ts | Coverage warning |
| Compact event shape and daily log naming | runtime/methods/{compact,microcompact}.ts | Event list incomplete |
| message/part semantics, compaction and timeline parts, session.revert | runtime/methods/{message,compact}-persistence.ts | Logs only |
| Default CLI directory layout | bootstrap/src/app/paths.ts | User config override needed |

Do not import upstream source packages at runtime. Do not instantiate SqliteSessionStore.

## Sidebar state and query boundaries (0.3)

The generic HTML first obtains a host-bound summary, then restores preferences for that verified session.
Selection/follow state, baseline, category expansion, filter, browser mode and the open element are owned by ui/state.mjs;
components only render safe DOM nodes, and app.mjs coordinates SDK calls with independent result sequences.
Persisted view keys never authorize a session. Missing host identity clears visible data. A restored selection absent
from the summary's loaded keys falls back to the latest request.

Rendering is a full rebuild of the root, but only when data or view state changed: an unchanged revision does not render,
and background renders are deferred while a native select has focus or text inside the panel is selected. Element scroll
positions keyed by `data-scroll` survive rebuilds; a new body part or element gets a new key and starts at the top.

The service numbers agent requests (`step`) and their turns (`turn`) at ingestion, per file generation, so labels do not
shift when the 120-record cache slides. Auxiliary sources have no step and are excluded from the trend series.
Summary returns 60 cached trajectory summaries at a time. Detail returns `groups` (each category's first 40 elements,
sorted as requested); `role` plus `page` loads further pages of one category. Diff additionally returns added/removed
groups per category, added keys and verified replacement pairs. Search has explicit selected and loaded-snapshot scopes
and never escapes the session cache.
Element summaries carry a chip and title derived from the recorded call (canonical `toolCalls`, OpenAI `tool_calls`
and AI SDK parts); a call ID recorded more than once is ambiguous and pairs nothing.
Canonical element estimates share the composition measure (`estimateTokens`: about 4 characters per token for ASCII,
1.5 for CJK, 2 for other scripts; `tokenMethod: "script_weighted"`). Diff categories and timeline deltas carry `tokensDelta`
in the same measure, so the panel never converts characters itself. Actual response usage remains an independent field.
Schema summaries carry `callCount` from session-wide SQLite tool_usage (read-only, like model_usage; null when the table or name
is unavailable). `schemaSort` (size, calls, name) permutes schema items among their own slots before grouping and paging; size
keeps the general size/order sort. `schemaCalls` reports how many schemas were never called and their estimated size.
Message summaries of the selected agent snapshot carry `entered: {step, turn}` or `enteredBefore` with `tracedTo`. Messages are
identified by absolute index (`messages.offset` plus position, valid for full, tail and delta records). The walk follows
previous() within one segment and stops at a missing offset, a shrinking message count or different recorded content at the same
index. Per-message digests and the result are cached on the cache entry, so it is bounded by the 120 cached records.
Body/Raw and body Diff return at most 12k characters; body search counts all matches and bounds navigation to 100 offsets.
Comparison requires continuous file segment, complete messages and matching querySource. Unknown schemas are excluded
from Delta. A body replacement additionally requires unique captured schema name or tool-result identity.
The linear common-prefix/suffix Diff is labelled as a replacement block, not an optimal LCS.

ZCode generic MCP tools retain host approval policy even with readOnlyHint. The plugin cannot grant itself host permissions.
The Electron fixture seeds exact project-level approvals for the two readonly tools in a fully isolated fixture database, documented in handoff.md.
