# Changelog

## Unreleased

- Sizes are booked from measured increases instead of estimated. Each reply counts at exactly the output tokens of the response that produced it (proven by its tool-call IDs, or for a text reply by its whole text), when that output leaves room for whatever else the step added; an item that was a step's only other addition counts at the rest of that step's increase in provider-reported input; several items added at once share that measured increase by estimate. Content measured once keeps its size with the same model and request source, when it fits. Where a series of records begins, replies and lone tool results are filled in from ZCode's conversation store, which links each request to its assistant message (`model_usage.assistant_message_id`); a stored result is only used for content of the same length. No measured size is below one token, and what a request cannot attribute within tolerance is kept as its residual. Before, every size was the character estimate, which on local Claude sessions put tool results at about two thirds of their size and replies with thinking at about 1.4 times theirs, and headlined an estimate that could be 40% below the actual input.
- The overview headlines the provider's actual input whenever it was reported (not a reported 0), with the measured share next to it ("79% measured", rounded down; under default recording, of the recorded part). Sizes and changes without ≈ are measured; ≈ marks an estimate or an estimated share of a measured total, and hovering a size says which. A category's change counts only what entered and left it, so content shared out afresh does not show as a change, and is shown without ≈ only when all of that is measured; the total change is exact between two complete requests of the same model, and across a model change no measured change is given. Injection sizes and compaction savings, which are estimates, now carry ≈ as well.
- Default (tail) recording: a window that moved on continues the previous record when every overlapping message matches and no compaction falls between them, so each step's new messages are booked from the measured increase (measured when the step added one, shared by estimate when several); what slides out of the window becomes "earlier messages (not recorded)" instead of being estimated away.
- A model whose output exceeds the next request's increase in more than 5% (and at least 3) of at least 10 checked steps (hidden reasoning that is not sent back) is no longer booked at its output, its earlier sizes are not reused, and the conversation store gives it no sizes. The store's verdict over the whole session applies from the first record.
- Size sorting and the largest item follow tokens rather than characters.

## 0.3.10 — 2026-10-16

- On first open the panel shows a banner above the overview pointing at ZCode's full Model I/O retention setting, since default recording drops older messages irrecoverably. Dismissing it once hides it permanently.

## 0.3.9 — 2026-10-15

- When session-wide call counts change while more than one page of schemas is shown, the loaded schema pages are reread with the first one. Before, a reorder under "by calls" could push a schema off the first page onto no page at all, and later pages kept stale counts.
- The overview reports the conversation's active branch (a digest of `session.revert`), and an opened compaction's **What was summarized** is reread when it changes or on a manual refresh. Before, after a rewind the panel kept showing the old branch's messages without the rewound-branch note until it was reopened.

## 0.3.8 — 2026-10-14

- Under default recording, a request recorded as a delta after a tail now keeps the tail's messages. ZCode writes the delta against its own untrimmed previous request, so after resuming a long session (or a size reset) every later request used to show only its newly added messages in the browser and the composition. The record stays partial: removals and Diff are still unavailable.
- A trajectory file that cannot be opened for a moment (a scanner or backup holding it) keeps its read position instead of being treated as rotated, which used to reread the 24 MiB window, renumber steps and expire open requests. Only a missing file restarts it. A database that is briefly unopenable keeps the last context events, like a busy one.
- Context events from a deleted message or part disappear even when new rows arrive in the same poll (ZCode removes the messages of a compaction whose persistence failed). Ordinary prompt and reply text no longer crosses into the plugin on a cold read.
- Injections are located by their whole recorded text rather than its first 300 characters, so two TodoWrite reminders (whose fixed opening is longer than that) no longer point at the same item, and a request after a skipped record is not taken as the first one that carried an injection.
- "Previous turn" is resolved by the service over its whole cache, so the earliest steps shown no longer say "no previous turn" when that turn is cached but not shown. A restored older selection shows its Delta.
- Loading earlier steps twice in quick succession no longer skips a page; an event that is still loading history no longer overrides a step or item chosen meanwhile.
- Searching all loaded requests replaces All / Changes with a note, since it lists matches across requests rather than changes. In Changes a category header counts its changes. A compaction with no step before it opens its continuation summary with the reason it cannot be compared.
- Buttons without an id (category headers, items, events, trend bars) keep keyboard focus across rebuilds; arrow keys inside an open body no longer switch steps. A failed connection to ZCode says to reopen the panel and stops polling.
- Unexpected errors are logged to stderr with the method; only ContextError codes reach the panel, so system codes such as ENOENT no longer leak as error codes. The server exits within two seconds on shutdown.
- An injection longer than the 4000-character read bound is matched by its length and SHA-256 digest (computed from the full text, read one part at a time up to 2 Mi characters) instead of its prefix; one that cannot be verified stays unlocated. The earliest readable request counts as the first carrier only when its file was read from the start without a gap, malformed or oversized line or eviction before it. A located step is recomputed when either trajectory file's earliest request changes, so rotating one source no longer leaves an injection on a step that is gone.
- **What was summarized** no longer reads tool inputs whole: only the fields a title uses (160 characters each) and a 400-character sample cross into JavaScript, so a compaction over large Write calls stays within the worker heap.
- The conversation store remembers every message and part id: rows that appear below the cursor (a restored or backfilled database) or a cursor that goes backwards reload everything, and deletions are dropped without a full reread.
- Typing in the filter, changing the baseline, searching all requests or leaving a focus also cancel an event navigation that is still loading history. Every button keeps keyboard focus across rebuilds: legend, In-row, show-more, event-kind and event-row buttons have stable keys, and any other control is restored by its position under the nearest one that does.
- `kind.compaction` and English singulars ("1 item") are translated; the tool_usage truncation flag is exact at 500 names; summarized parts have a stable order; `package.py` creates its report directory before writing the archive; CI runs on pushes to main and on pull requests instead of twice for PR branches; an SQL-versus-per-request usage parity test replaces the test-only `summarizeFacts`.

## 0.3.7 — 2026-10-14

- The context browser follows one set of rules. What it shows is fixed by the step, the baseline, the set (All or Changes) and the filter, and each control changes only its own: picking a step, a category, the legend or an In item no longer resets the filter or the set. The rules are written down in docs/decisions.md.
- Every number a category header can open is the number it lists. `m / n items` and the `+N −N` badges count the current filter; the size, share and token change on the right always describe the whole request. A `+3` on user messages could open a single, older message while a filter was active; it now reads `+0` (no badge), and the Changes toggle counts the same way, with the unfiltered total in its tooltip. The counts come from one server structure (`listing`) instead of six fields picked in the panel; `searchAddedGroups`, `searchRemovedGroups` and `arrivals.searchGroups` are gone.
- `+N` and `−N` are buttons: they switch to Changes and open that category.
- Clicking an event no longer writes into your filter. Compactions, rewinds and MCP registrations open an **event focus** with its own baseline and narrowing, shown in a bar at the top of the browser; your filter is paused (struck through) until the focus ends with ×, by picking another step, by typing in the filter or by changing the baseline. A focus is never saved, so it does not come back after a reload. Injections and model switches only select their step.
- An MCP registration focuses on MCP tool schemas by name (`mcp__` prefix) instead of a full-text search for `mcp__`, which also matched every message that mentioned an MCP tool. It compares with the step before the registration and says when the schemas did not change, and it explains that the registered count includes tools never sent to the model (this plugin's own two panel-only tools, for example). A registration with no readable request after it says so instead of jumping to the latest step; the latest step is offered as an explicit, labelled choice.
- An item opened from the In row, an injection or a compaction summary stays listed, marked **Located**, even when the filter or set would hide it, instead of the filter being cleared to show it. (0.3.6 cleared the search for this.)
- The filter has a clear button. "Previous turn" on a turn's first step is decided by the server (`noBaseline`), so Changes no longer lists the previous step's arrivals under a "no previous turn" note.

## 0.3.6 — 2026-10-13

- A compaction shows as one row instead of two. ZCode logs `compact.started` and `compact.completed` under one span, and each used to get its own row with identical before/after steps; they are now merged by `spanId` into one row with its status (completed, failed or in progress) and duration. An edited question and the rewind it triggers merge the same way.
- The compaction card is now **Context events**, read from ZCode's conversation store (the `message` and `part` tables of the session database) for the whole session instead of three days of logs and the cached requests. Injections are listed one per message under ZCode's own labels (TodoWrite reminder, agent list, restored context, background task notice, subagent message, Skill load); compactions carry tokens before and after, the summarized message count and the summary; model switches come from the timeline. Rewinds, edited questions and MCP tool registrations still come from the logs, and compactions the store has no record of (a failed attempt) are kept from them. The store is read incrementally and only the needed JSON fields are extracted, so large tool outputs never reach the plugin; without the tables the panel falls back to the logs. Kind filters appear when more than one kind is present, and the list shows the latest 12 with a Show all button.
- Clicking an event opens what it is about. An injection opens the message that carried it in the context browser, found in the next agent request by tool-call ID or exact text, even past its category's first page (`focusKey`); when that request is not readable it shows the stored text inline instead of pointing at a nearby step. A compaction selects the step after it and compares with the step before (Changes when both records are complete; otherwise the reason and the continuation summary), and **What was summarized** lists the summarized prompts, replies, reasoning and tool calls from the store, which is the only view of a compaction's removals under default recording. A model switch shows the request summary; an MCP registration filters the tool schemas to `mcp__` tools. The ✂ (and ↶ rewind) markers in the trend do the same.
- An event older than the first loaded step loads earlier steps when clicked, and says so if it still cannot be located, instead of being pinned to the first loaded step.
- Compaction statuses follow ZCode's own values. A retrying, interrupted (cancelled) or skipped compaction used to show as completed; it now shows as retrying, interrupted or skipped, and a status the plugin does not know shows as unknown. A failed manual `/compact` in the logs (`compact.failed`) is no longer dropped, which left it "in progress" when only the logs were readable.
- **What was summarized** follows the active branch. A rewind deletes nothing in ZCode's store, so messages of a rewound branch used to be listed as summarized; a compaction that is itself on a rewound branch now says its contents cannot be determined.
- Skill loads, injected text and summarized tool calls estimate tokens with the script-weighted measure (from a 400-character sample scaled to the full length) instead of four characters per token, so Chinese output is no longer shown about 2.7 times too small.
- Clicking an item in the In row or a category in the summary always shows it: the list is reloaded without the old search and the item is added to its category's first page if needed. Searching in Changes matches full bodies, like All.
- Schema call counts, the never-called summary and the calls sort update while a past step is pinned. A restored open compaction loads its summarized list instead of staying on "loading"; "Show more" in one category no longer drops another's response; polling keeps running if a refresh fails while rendering, and an expiry notice no longer clears a text selection.
- The newest event log is read last, so 200 events from older days cannot push out today's; the session cache evicts the least recently used session instead of the first one opened.

## 0.3.5 — 2026-10-13

- An About page (ⓘ in the toolbar) shows the plugin's version, author, licence, source repository, a pointer to the bundled dependency notices and the read-only/local-data privacy statement. The version it shows is the same literal the app announces to the host, so `npm run check` still catches drift.

## 0.3.4 — 2026-10-13

- Token estimates weigh scripts: about 4 characters per token for English, code and JSON, about 1.5 for Chinese, Japanese and Korean. Every character used to count as a quarter token, so Chinese content looked several times smaller than it is and, on partial (tail) records, inflated "earlier messages (not recorded)", which is actual input minus the recorded estimate. Deltas now come from the server in tokens (`tokensDelta`) instead of the panel dividing characters by 4.
- A read that timed out or was cancelled is skipped by the data worker if it has not started yet, instead of running late and holding up newer reads; the busy limit counts what the worker still holds.
- The panel polls every 3 s while data changes, slows to 6 s and then 10 s when nothing has changed for a while, and refreshes immediately when it becomes visible, gains focus or the pointer enters it. Polling stops for good on teardown.
- The MCP server and app announce the released version (they still said 0.3.2), and `npm run check` fails when they, package-lock.json or the plugin manifest differ from package.json.

## 0.3.3 — 2026-10-13

- The repository is itself a plugin marketplace now. `npm run build` assembles `plugins/zcode-context/` plus a root `marketplace.json` (replacing `dist/local-marketplace`), so users install by adding the GitHub repo `Kevinzzz6/zcode-context` in ZCode's plugin marketplace — no clone, no npm. Release zips (`scripts/package.py`) and offline/local-directory install are documented in the READMEs.
- CI fails when the committed marketplace differs from a fresh build; pushing a `v*` tag verifies, packages and attaches the marketplace zip to a GitHub Release.

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

- Redesign the sidebar with a card layout inspired by dsh-context: request summary with composition bar, legend and User / Added / Response brief; trend with a Y axis, turn band and ✂ compaction markers; a context browser with inline expansion; a compaction events card; collapsed explanations.
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
