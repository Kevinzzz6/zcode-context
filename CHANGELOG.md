# Changelog

## 0.3.2 — 2026-10-13

- On partial (tail) records the In row and Changes mode list what entered after the baseline step, derived from entry stamps, with +N per category; removals stay unknown and the panel says so. Messages that cannot be dated are counted, not listed.
- Incomplete-record notes name the reason in words instead of codes such as "tail".
- `npm run preview:session -- <sessionId>` previews a real session read-only through the built service; `FIXTURE_TAIL=n` makes the UI fixture record tails like ZCode's default.
- README.md is now Chinese (README.en.md in English), rewritten for users with screenshots and a default-versus-complete-retention table; README_CN.md is removed.

## 0.3.1 — 2026-10-13

Tested against a real 600k-token session in the user's ZCode.

- Partial (tail) records, the default ZCode rollout format, now lead with the provider's actual input instead of the recorded part (about 60k of a real 600k), show the recorded coverage (latest n of total messages), draw the rest as hatched "earlier messages (not recorded)" in the bar, legend and trend, compare steps by actual input, and explain how to turn on complete Model I/O retention.
- Ignore moving prompt-cache breakpoints (cacheControl) when matching messages; they broke entry-stamp chains after one step and would make diffs report the previous message as removed and re-added.
- The trend says when ZCode reset the record file or only its end was read, and that step numbers are relative.
- User previews and titles drop host-injected leading blocks such as <in-app-browser-context>.

- Trend: hover tip with per-category values, category highlight shared by the legend, summary bar, browser and bars, Steps/Turns granularity, and an Adaptive axis that rescales to the bars in view.
- Summary: Turn / In / Reply brief; In lists what entered the context after the previous reply, in message order.
- Browser: compare with the previous step or the previous turn's last step; Earlier… still picks any step.
- Body find with previous/next, Enter / Shift+Enter / Esc; left/right arrows move between steps.
- Tool schemas: each schema row shows how often this session called the tool (×N from SQLite tool_usage, ×0 muted, nothing when the table is unavailable); the category offers Size / Calls / Name ordering and a line with the number and estimated size of schemas never called. Ordering is applied on the server before grouping and paging.
- Entry stamps: each message row shows the turn and step it entered the context (`T2 S7`), traced by absolute message index through tail and delta records; messages already present where the continuous history begins (oldest loaded record, gap, reset or compaction) say "earlier" instead of a guessed step.
- Collections report the absolute offset of their first recorded item.
- Keep LF line endings in the working copy; the browser smoke test now covers 25 interaction groups.

## 0.3.0 — 2026-10-13

- Redesign the sidebar after dsh-context's card layout: request summary with composition bar, legend and User / Added / Response brief; trend with a Y axis, turn band and ✂ compaction markers; a context browser with inline expansion; a compaction events card; collapsed explanations.
- Number agent requests as stable steps and turns. Title and compaction requests stay selectable but no longer distort the trend or its Delta bars.
- Show every size in estimated tokens with compact formatting; deltas no longer mix characters and tokens.
- Give each category its own first page and "show more", replacing a global 40-row page that hid most items of small categories.
- Merge the Changes tab into the browser as a "Changes" mode with per-category added and removed items, struck-through removals from the baseline, and the verified body Diff inside the expanded item.
- Pair tool results with canonical ZCode `toolCalls` arguments, label elements by tool and key argument (for example `Read · src/cache.ts`), show tool cards with an argument table and status, and render schemas as description plus parameter table.
- Stop rebuilding the page on every poll: unchanged revisions do not render, and background updates wait while a select is open or text is selected. Following pauses while an element is open and shows how many newer requests arrived.
- Fall back to the latest request when a restored selection has left the read window.
- Add `npm run fixture:ui`, a synthetic multi-turn session in the canonical shape for UI work; update the browser smoke test to 18 interaction groups.

## 0.2.0 — 2026-10-12

- Make trajectory snapshot selection shared across the diagnostic sidebar; pin history and retain view state on refresh, return and guest reconstruction.
- Add categorical stacked/Delta trends, bounded history navigation, estimated composition and independent attempt provider usage.
- Add category folding, summaries, size/order sorting, largest-content location and search across all selected or loaded snapshot elements.
- Add readable tool/message/system/schema details, evidence-only call pairing, Raw/basic Markdown, chunk copy and full-body search.
- Add category changes, baseline selection, added/removed navigation and identity-verified, bounded unified replacement-block Diff.
- Translate logged compact events and label before/after time and turn-range navigation without inferring causes.
- Reject comparisons across malformed/reset history gaps and keep expired handles distinct.
- Move SQLite 30-day usage to a secondary view; split UI state, components, localization and SDK coordination.
- Validate WSL/Windows, SDK browser interactions and isolated installation. Document the real host MCP approval requirement; full desktop acceptance remains incomplete.

## 0.1.1 — 2026-10-12

- Add daily UTC usage totals and explicit partial-usage and recent-timeline coverage notices.
- Open added and removed Diff elements directly in their respective captured inputs.
- Include captured content in request handles so replacement data cannot reuse stale handles after restart.
- Bound repeated coverage warnings and reject delta baselines across recorded file resets.
- Use the lockfile for CI dependency installation.
- Add regression coverage and complete handoff documentation. Desktop integration awaits the compatible ZCode rollout.

## 0.1.0 — 2026-10-12

- Initial independent read-only UI plugin: per-call session binding, SQLite usage, trajectory composition and content, snapshot differences and explicit compaction events.
