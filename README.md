# ZCode Context

[简体中文](README_CN.md)

An independent, read-only Context UI plugin for ZCode Desktop local workspaces.

- Binds to its own session through host MCP request metadata. No last-active-file guessing or hooks.
- Reads 30-day SQLite model usage facts through a separate read-only connection, including live WAL.
- Shows daily UTC usage separately from the bounded recent-request timeline.
- Browses recorded model inputs, estimates their composition, and compares complete snapshots; added and removed elements open their respective captured content.
- Correlates explicit compaction log events. Observed changes are not presented as inferred causes.
- Keeps usage available when trajectory content has rotated out. Missing usage and missing content are distinct.

## Build and install

Node.js 24+ is required. SDK versions match the upstream ZCode plugin examples.
The host must also support the official UI plugin contract; the source baseline is ZCode 3.15.1.
The current 3.15.1.8093 client has basic Electron integration evidence for 0.2.0. The 0.3.0 interface has not yet been re-accepted in the real desktop client.

```sh
npm ci
npm run check
npm test
npm run build
npm run smoke
```

After a successful build, add the absolute path of **dist/local-marketplace** in ZCode's plugin marketplace.
Install and enable **zcode-context**, then open **Context** from the session side pane.

The installed package contains bundled service dependencies, the worker, and one offline HTML page.
It does not need this source checkout or node_modules at runtime; Node.js 24+ must remain on PATH.

On changes, rebuild, refresh the same marketplace source, and reinstall. The plugin is not hot-reloaded
from its source directory. Version 0.3.0 is a development version; bump before publishing changed installable content.

For interface work, run `npm run build && npm run fixture:ui` and open http://127.0.0.1:4175. It synthesizes a multi-turn
session in the canonical ZCode shape (tool calls, a title request, an automatic compaction); `/append?session=sess_A` simulates a new request.

MCP host permissions still apply. If detail reads wait or time out, authorize the two read-only
`get_context_summary` and `get_context_request` tools in ZCode. The plugin never edits permission settings.
The isolated Electron test encountered a pending approval that the main page did not display; exact conditions are in [Handoff](docs/handoff.md).

## Configuration

The defaults read **~/.zcode/cli/db/db.sqlite**, **~/.zcode/cli/rollout**, **~/.zcode/cli/debug**, and **~/.zcode/cli/log**.
In the plugin settings, use **dataRoot** for a custom CLI directory containing db/, rollout/ and log/.
Use **dbPath** only when the database lives elsewhere. Both overrides must be absolute (~/ is expanded).

Do not add ZCODE_SESSION_ID to the manifest environment. The service binds each tool call independently
from **_meta["com.zcode/request-context"].session_id**.
Only that namespace is accepted; the SDK transport's extra.sessionId is a different identifier.

If binding is missing, the plugin returns an explicit error and never switches to a different session.
A draft without a materialized host session may not have a usable panel binding. An identified session
without a Model I/O record displays an empty state until the request finishes.

## What the figures mean

- Usage totals: recorded model_usage facts in the last 30 days, including main, compact and sidecar sources
  for this session. They are not a permanent billing ledger or a price estimate.
  Partial input/output reporting sums known values only and displays the number of requests missing each field.
- Daily usage: UTC date buckets across all model-request sources for the session, independent of the recent-request cap.
- Primary chart: stacked trajectory composition estimates for agent requests (main turn, subagent, workflow child), numbered as steps and turns
  from the first record read in the current file. Title and compaction requests remain selectable but are not part of the series.
  Network retry attempts in traj are shown separately, not automatically joined to SQLite request IDs.
- Composition: a deliberately approximate 4-characters/token heuristic over serialized recorded messages.
  Tool schema estimates are added only when request.body.tools was captured. Images/video payloads may be redacted.
- Diff: category changes, added/removed navigation and order changes between complete snapshots in the same file, continuous segment and query source.
  Missing schemas are not treated as removed tools. This compares captured input, not unrecorded provider processing.
- Events: selected explicit compression events from the last 3 local calendar log files.
  Missing events do not establish that no compaction happened.
- Canonical input snapshots are recorded after model attempts; this is not the exact live next-request context.

The cache rate includes only requests that report both input and cache-read usage; absent fields stay unknown.

The Context panel stays with its owning session, including when another conversation is selected.
It does not silently follow the last submitted message.

For greater content coverage, ZCode's General settings offer **complete Model I/O retention**.
It increases diagnostic disk use and cannot restore previously deleted data. The plugin does not change it.
Readers remain bounded even in that mode: a 24 MiB cold file window, 8 MiB scan batches/lines,
limited session caches and on-demand paginated text. Coverage warnings remain visible.

## Sidebar workflow (0.3)

The sidebar follows dsh-context's card layout, top to bottom:

- **Step selector**: ‹ › move between agent requests; the menu also lists auxiliary title and compaction requests. It follows
  the latest request by default. Choosing an earlier one shows "Jump to latest" with the number of newer requests; following pauses while an element is open. Left/right arrows move between steps when focus is not in a field.
- **Request summary**: estimated input, change versus the previous step, actual provider input/output/cache, a category bar and legend
  (click to jump to the category), and a Turn / In / Reply brief: the turn's opening message, what entered the context after the previous reply (usually tool results; click to open), and this step's calls or text. Hovering a category lights it across the trend and summary.
- **Context trend**: one bar per agent request with a Y axis, a turn band and ✂ compaction markers; Total or Delta, Steps or Turns; scrolls horizontally, and Adaptive rescales the axis to the bars in view. Hovering shows per-category values.
- **Context browser**: fixed categories (system prompt, tool schemas, user, assistant, tool results), each with count, added/removed badges,
  change, estimate, share and its own pagination. The baseline is the previous step, the previous turn's last step, or any earlier step. Elements are named by tool and key argument (for example `Read · src/cache.ts`) and expand
  inline into a tool card with argument table and status, a schema parameter table, or the body (readable / Markdown / raw, copy, find with Enter / Shift+Enter / Esc, 12k parts).
  Changes mode lists added and removed elements per category against the baseline; removed ones come from the baseline and are struck through.
  A replacement with unique recorded identity offers its body Diff inside the expanded element.
- **Compaction events**: logged kind, status, reason and savings, with Before / After step navigation.
- **Usage**: a secondary page with 30-day SQLite logical usage, UTC daily totals and recent requests.

All sizes are estimated tokens (characters / 4). Method and coverage notes sit under "About these numbers" at the bottom.
Polling never rebuilds the page when nothing changed, and background updates wait while a select is open or text is selected.
Captured HTML is never executed. Markdown supports headings, paragraphs, lists, quotes and code, not a complete renderer.
Session-scoped view storage restores selection, preferences, filter, expansion, baseline and the open element after a guest rebuild;
this requires available localStorage and never supplies session authority. A restored selection that left the read window falls back to the latest request.

## Verification

- `npm test`: identity isolation, unknown versus zero usage, token normalization, baseline gaps,
  duplicate-message diffs, readonly WAL, JSONL append/reset behavior and session-scoped content keys.
- `npm run smoke`: built stdio service and real MCP SDK, app-only tool visibility, HTML resource,
  concurrent A/B calls, missing identity, cross-session key rejection and a session with no trajectory.
- `npm run preview`: open http://127.0.0.1:4173/?demo=1 for clearly labelled demo data.
  This does not validate the real Desktop sandbox.
- Optional browser test: start `npm run fixture:browser`, then `npm run test:browser -- /absolute/path/to/playwright/index.mjs`.
  Uses existing Playwright and installed Chrome; no browser is downloaded. It verifies official App/AppBridge communication,
  real stdio/SQLite and A/B page isolation across 23 interaction groups, but not Electron sandbox behavior.
- [Desktop acceptance](docs/desktop-acceptance.md) must be completed in an isolated ZCode copy.
  Code and protocol tests do not prove released-client integration.
- [Handoff](docs/handoff.md) records current state, paths, validation evidence and rollout acceptance steps.

## Data boundaries

No changes to ZCode code, settings, conversation rows, journal mode or migrations. No source database
constructor is reused. No public network connections, model calls, prompt injections or automatic pruning.
Source rows and diagnostic content remain local. SQLite reads run in short transactions in a worker;
the worker has a memory limit and explicit failures. Slow or unsupported sources degrade the panel.

This plugin uses documented UI surfaces plus currently implemented ZCode metadata and storage formats.
Upstream storage changes may require an adapter update. The checked baseline is ZCode 3.15.1
(aac4755666d09fdcd70272fcf063c077a639015f).

MIT licensed. The implementation is original; dsh-context inspired the product direction.
