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
  handles append, UTF-8 boundaries, reset, cold-tail gaps and partial lines. Expansion occurs before
  query-source filtering. Context snapshots compare content, not sampling or provider tokenization.
- Event logs: explicit compact events only. A negative size delta alone has no causal classification.

Requests are not forcibly joined across SQLite and traj: logical_request_id and adapter requestId
are not proven to be the same identifier. This avoids multiplying usage by network retries.

## Isolation and limits

A worker serializes reads and limits memory. Server identity is per call; worker caches use session/file keys.
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
| Default CLI directory layout | bootstrap/src/app/paths.ts | User config override needed |

Do not import upstream source packages at runtime. Do not instantiate SqliteSessionStore.

## Sidebar state and query boundaries (0.2)

The generic HTML first obtains a host-bound summary, then restores preferences for that verified session.
Selection/follow state, baseline, category expansion, search, layout and detail cursor are owned by ui/state.mjs;
components only render safe DOM nodes, and app.mjs coordinates SDK calls with independent result generations.
Persisted view keys never authorize a session. Missing host identity clears visible data.

Summary returns 60 cached trajectory summaries at a time; the chart windows ten. Search has explicit selected
and loaded-snapshot scopes, covers all elements before a 40-row page is sliced, and never escapes the session cache.
Canonical element estimates share the composition measure. Actual response usage remains an independent field.
Body/Raw and body Diff return at most 12k characters; body search counts all matches and bounds navigation to 100 offsets.
Comparison requires continuous file segment, complete messages and matching querySource. Unknown schemas are excluded
from Delta. A body replacement additionally requires unique captured schema name or tool-result identity.
The linear common-prefix/suffix Diff is labelled as a replacement block, not an optimal LCS.

ZCode generic MCP tools retain host approval policy even with readOnlyHint. The plugin cannot grant itself host permissions.
The Electron fixture seeds exact project-level approvals for the two readonly tools in a fully isolated fixture database, documented in handoff.md.
