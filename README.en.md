<a name="readme-top"></a>

<div align="center">

<img src="docs/images/hero.en.png" width="100%" alt="ZCode Context: see the context of every request from the session side pane">

<br>
<br>

**See your context from the ZCode session side pane**<br>
What each request carried · Which content takes the most room · What entered at this step · What a compaction removed

<br>

<a href="https://github.com/Kevinzzz6/zcode-context/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Kevinzzz6/zcode-context?style=flat-square&color=6366f1&label=release"></a>
<a href="https://github.com/Kevinzzz6/zcode-context/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Kevinzzz6/zcode-context/ci.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="ZCode Desktop 3.15.1+" src="https://img.shields.io/badge/ZCode%20Desktop-3.15.1%2B-14b8a6?style=flat-square">
<img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-22c55e?style=flat-square&logo=nodedotjs&logoColor=white">
<img alt="Read-only · Offline" src="https://img.shields.io/badge/Read--only%20%C2%B7%20Offline-f59e0b?style=flat-square">
<a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square"></a>

<br>

[Features](#what-it-answers) &nbsp;·&nbsp; [Install](#install) &nbsp;·&nbsp; [Reading the numbers](#reading-the-numbers) &nbsp;·&nbsp; [How it works](#how-it-works-and-privacy) &nbsp;·&nbsp; [Development](#development) &nbsp;·&nbsp; [**简体中文**](README.md)

</div>

<br>

An independent, read-only, offline ZCode UI plugin for Desktop local workspaces. It never touches the network, never calls a model and never changes a ZCode setting; it turns what ZCode already records on your machine into a side pane that updates with the session.

## What it answers

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/frame-overview.png" alt="Request summary and context trend">
      <h4>Why is the context this big?</h4>
      Each request's size, its composition by category (system prompt, tool schemas, user, assistant, tool results) and the trend over steps.
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/frame-changes.png" alt="Changes view after a compaction">
      <h4>What did a compaction remove?</h4>
      Context events such as compaction; clicking one compares the steps before and after it in the browser, down to the removed items. Changes mode lists only additions and removals (requires complete recording, see <a href="#default-recording-versus-complete-retention">below</a>).
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/frame-tool-card.png" alt="Expanded tool result card">
      <h4>What entered at this step?</h4>
      Everything that entered after the previous reply, usually tool results, with their arguments and bodies one click away. Each message also shows the turn and step it entered, such as <code>T4 S17</code>.
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/frame-schemas.png" alt="Tool schema call counts">
      <h4>Which tool schemas cost tokens for nothing?</h4>
      How often this session called each tool, and how much the never-called schemas cost on every request.
    </td>
  </tr>
</table>

## Layout

From top to bottom:

<table>
  <tr><th align="left">Area</th><th align="left">Contents</th></tr>
  <tr><td nowrap><b>Step selector</b></td><td><kbd>‹</kbd> <kbd>›</kbd> or <kbd>←</kbd> <kbd>→</kbd> move between agent requests; the menu also lists title and compaction requests. Follows the latest request, pauses while you read an expanded element, and tells you how many newer requests arrived when you look at history</td></tr>
  <tr><td nowrap><b>Request summary</b></td><td>Size, change versus the previous step, actual input/output/cache, a category bar and legend, and a Turn / In / Reply brief</td></tr>
  <tr><td nowrap><b>Context trend</b></td><td>One bar per agent request with an axis, a turn band and ✂ compaction markers; Total/Delta, Steps/Turns, Adaptive scaling; hover for per-category values, and hovering a category highlights it everywhere</td></tr>
  <tr><td nowrap><b>Context browser</b></td><td>Collapsible, paged categories; compare with the previous step, the previous turn or any earlier step; Changes mode shows only additions and removals; elements are named by tool and key argument, such as <code>Read · src/cache.ts</code></td></tr>
  <tr><td nowrap><b>Element details</b></td><td>Inline tool cards (argument table, OK/error), schema parameter tables and bodies (readable / Markdown / raw, copy, find, parts)</td></tr>
  <tr><td nowrap><b>Context events</b></td><td>From ZCode's conversation store, for the whole session: injections (TodoWrite reminders, agent list, restored context, background task notices, Skill loads, one row each), compactions (tokens before and after, the summarized messages and what they were) and model switches; rewinds and MCP registrations come from the last 3 days of logs. Clicking an event opens its item in the browser, a compaction compares with the step before and expands what it summarized, and an injection whose request is no longer readable shows its stored text. The ✂ markers in the trend are clickable too</td></tr>
  <tr><td nowrap><b>Usage</b></td><td>Secondary page with 30-day logical usage, daily totals and recent requests</td></tr>
  <tr><td nowrap><b>About</b></td><td>Secondary page (<kbd>ⓘ</kbd> in the toolbar): version, author, licence, source repository, and the read-only local-data, no-network statement</td></tr>
</table>

## Default recording versus complete retention

Under its default settings, ZCode discards model I/O recordings at **two levels**:

- **Message level**: only the **latest 64 messages** of each request are recorded, while a long session's request often has several hundred.
- **Session level**: when a new session starts recording, existing recording files are pruned down to the 2 most recently written — so besides the current session, usually only the 3 most recent sessions keep recordings, and everything earlier is gone. This is why a conversation from a few hours ago shows nothing at all: the plugin cannot read what is no longer on disk.

The plugin keeps these cases apart instead of guessing at missing data:

| | Default | Complete Model I/O retention |
|---|---|---|
| Recordings of earlier sessions | ❌ Only the 3 most recent sessions keep recording files; earlier ones are already deleted and unrecoverable | ✅ Kept, with no per-session-count cleanup |
| Request size | ⚠️ Provider-reported actual input; the recorded part is marked and the rest is shown hatched as "earlier messages (not recorded)" | ✅ Full category estimate |
| Composition by category | ⚠️ Recorded messages and tool schemas only | ✅ Complete |
| In row, additions | ✅ Available (derived from entry stamps) | ✅ Available |
| Removals, per-category change | ❌ Unknown, and the panel says so | ✅ Available |
| Body Diff of a replacement | ❌ Not available | ✅ Available for uniquely identified tool results and schemas |
| Tool call counts, entry stamps | ✅ Available | ✅ Available |

<p align="center">
  <img src="docs/images/frame-partial.png" width="400" alt="Request summary under default recording, with unrecorded messages hatched"><br>
  <sub>Under default recording, earlier unrecorded messages are hatched in the bar and the trend</sub>
</p>

> [!IMPORTANT]
> **Turn on complete Model I/O retention as soon as the plugin is installed, not when you first want to look back — records discarded by default cannot be recovered.** To enable it: ZCode <kbd>Settings</kbd> → <kbd>General</kbd>, find "Complete Model I/O retention" and switch it on. It only applies to requests made after it is turned on; the trade-off is faster disk growth, since the per-session-count cleanup and the 64 MB per-file reset no longer apply. The plugin only reads local data and never changes this setting.

## Install

**Prerequisites**

- **ZCode Desktop**: baseline 3.15.1 with the official UI plugin contract.
- **Node.js 24+** on PATH: `node -v` printing a version is enough. It only starts the plugin's bundled service — no npm or build tools are needed.

### From the plugin marketplace (recommended)

1. Open <kbd>Settings</kbd> → <kbd>Plugin Management</kbd> and switch to the <kbd>Discover</kbd> tab.
2. Click the <kbd>+</kbd> button to add a marketplace.
3. Enter this project's GitHub repository and confirm; `zcode-context-marketplace` appears in the marketplace list:

   ```text
   Kevinzzz6/zcode-context
   ```

   The full URL `https://github.com/Kevinzzz6/zcode-context` also works.
4. Find the **zcode-context** card in the plugin list and click <kbd>Get</kbd>. The button turns to **Installed** when done; the plugin is enabled by default.
5. Restart ZCode.
6. Open any session, click <kbd>+</kbd> in the right pane to add a tab, and choose <kbd>Context</kbd>.

No cloning and no npm commands are involved. The plugin installs into ZCode's local cache with its bundled service dependencies, worker and offline page; it does not need the source checkout at runtime. Uninstall and the on/off switch live in the plugin's detail view on the **Installed** tab.

> [!NOTE]
> Adding the marketplace makes ZCode clone from GitHub. If your network needs a proxy, set the `ZCODE_HTTP_PROXY` environment variable (for example `http://127.0.0.1:7890`) and restart ZCode — ZCode reads only this variable, not `http_proxy`.

<details>
<summary><b>Updating</b></summary>

<br>

In <kbd>Settings</kbd> → <kbd>Plugin Management</kbd> → <kbd>Discover</kbd>, refresh the `zcode-context-marketplace` source; when the zcode-context card offers **Update**, click it and restart ZCode. The current version is shown in the plugin's detail view on the **Installed** tab.

</details>

<details>
<summary><b>Offline install</b> (when GitHub is unreachable)</summary>

<br>

1. Download `zcode-context-<version>-marketplace.zip` for the version you want from [Releases](https://github.com/Kevinzzz6/zcode-context/releases); the matching `.sha256` file verifies it.
2. Unzip it anywhere; you get a `zcode-context-marketplace` directory.
3. Add a marketplace via <kbd>Plugin Management</kbd> → <kbd>Discover</kbd> → <kbd>+</kbd> choosing a local directory, pointing at the unzipped `zcode-context-marketplace` directory (the one containing `marketplace.json`).
4. Get, enable and restart as in steps 4–6 above.

</details>

<details>
<summary><b>From source</b> (developers)</summary>

<br>

```sh
git clone https://github.com/Kevinzzz6/zcode-context.git
cd zcode-context
npm ci
npm run build
```

The build writes `marketplace.json` and `plugins/zcode-context/` at the repository root, so the repository root itself becomes a marketplace directory. Add it in <kbd>Plugin Management</kbd> → <kbd>Discover</kbd> → <kbd>+</kbd> as a local directory using the repository's absolute path. After changing code, rebuild, then refresh and update the plugin in the marketplace. See [Development](#development) for the full verification flow.

</details>

### First run: approve two read-only tools

Enabling the plugin only makes ZCode load it. The panel reads data by calling two tools provided by the plugin, and ZCode applies its normal tool permission rules to them:

- `mcp__plugin_zcode-context_context__get_context_summary`: overview and trend, polled every 3 seconds while data changes and slowing to 10 seconds while it stays unchanged
- `mcp__plugin_zcode-context_context__get_context_request`: a step's content, comparison and bodies

> [!IMPORTANT]
> Both are read-only and callable only by the panel; the model never sees them. If the panel keeps showing "Loading…" or "This is taking a while", allow these two tools in ZCode (approvals are saved per project). The plugin never changes permissions itself.

## Reading the numbers

- **Estimates** use about 4 serialized characters per token for English and code and about 1.5 for Chinese, Japanese and Korean, to compare size and change; they are not the model's tokenization. Values with "≈" are estimates.
- **Actual input** is the provider-reported input of the request, including cache reads.
- **Step and turn numbers** count from the first readable record, not from the start of the session. ZCode periodically resets long sessions' record files; history then starts over, and the trend says so.
- **Entry stamps** `T2 S7` are traced by absolute message position. A message still present where tracing stops (oldest loaded record, a gap, a reset or a compaction) shows "earlier" instead of a guessed step.
- **Tool call counts** cover the whole session, including calls after the selected step and calls already compacted away. Without the call records they are unknown, never ×0.
- **Compaction** is taken from logs only, for the last 3 days. A drop in size does not prove a compaction, and no logged event does not prove there was none.
- **Usage** comes from ZCode's logical request statistics, including title and compaction calls, and is counted separately from the trend's records.

## How it works and privacy

```mermaid
flowchart LR
  panel["Context panel<br/>ZCode session side pane"]
  server["Plugin service<br/>MCP · stdio"]
  worker["Data worker<br/>serialized · time-boxed · memory-bounded"]
  subgraph local["This machine: ~/.zcode/cli (read-only)"]
    db[("db/db.sqlite<br/>usage · tool calls · conversation store")]
    traj["rollout/ · debug/<br/>Model I/O records"]
    log["log/<br/>rewinds · MCP registrations"]
  end
  panel -- "two read-only tools<br/>bound to the session" --> server --> worker
  worker --> db
  worker --> traj
  worker --> log
```

- **Read-only**: no changes to ZCode code, settings, databases or permissions; no migrations; read-only database connections.
- **Offline**: no network access, no model calls; data stays on the machine.
- **Session isolation**: every read binds to the session identity passed by the host; without a valid identity it fails explicitly and never reads another session. The panel stays with the session that opened it, even when another session in the workspace sends messages.
- **Safe rendering**: captured HTML is never executed; bodies render as text or restricted Markdown.

## Configuration

Data is read from `~/.zcode/cli` by default. Change it in the plugin settings when needed:

| Option | Default | Purpose |
|---|---|---|
| `dataRoot` | `~/.zcode/cli` | Another CLI data directory (containing `db/db.sqlite`, `rollout/`, `debug/`, `log/`) |
| `dbPath` | `<dataRoot>/db/db.sqlite` | Set when the database lives elsewhere |

Both must be absolute; `~/` is expanded.

## Development

```sh
npm ci
npm run check        # syntax and manifest checks
npm test             # unit tests
npm run build        # dist/, plugins/zcode-context/ and the root marketplace
npm run smoke        # built service over real MCP stdio
npm run verify       # all of the above, results in output/verification
```

| Command | Purpose |
|---|---|
| `npm run fixture:ui` | Synthetic multi-turn session (tool calls, a title request, an automatic compaction) at <http://127.0.0.1:4175>; `FIXTURE_TAIL=12` mimics default tail recording; `/append?session=sess_A` simulates a new request |
| `npm run preview:session -- <sessionId>` | Read-only preview of a real session through the built service at <http://127.0.0.1:4177>, without installing the plugin |
| `npm run preview` | Demo data at <http://127.0.0.1:4173/?demo=1> |
| `npm run fixture:browser` + `npm run test:browser -- <absolute path to playwright/index.mjs>` | Browser interaction regression (25 groups) with existing Playwright and local Chrome; nothing is downloaded |

The browser test covers the official App/AppBridge handshake, real stdio/SQLite and two-session isolation, but does not replace acceptance in the ZCode desktop side pane. The README hero and screenshot frames are generated from the raw screenshots by [`docs/images/src/render.sh`](docs/images/src/render.sh).

## Status

- ✅ 0.3.x has been checked against a real session (about 600k tokens, default recording) in the read-only preview; unit and browser tests pass.
- ⏳ Acceptance in the ZCode desktop side pane is still pending for 0.3.x; 0.2.0 had basic Electron integration evidence.
- ⚠️ Upstream storage format changes may require adapter updates.

## Documents

| Document | Contents |
|---|---|
| [Changelog](CHANGELOG.md) | What changed in each version |
| [Product decisions and trade-offs](docs/decisions.md) (Chinese) | Features left out on purpose, and why |
| [Architecture](docs/architecture.md) | Identity binding, data sources, isolation and limits |
| [Handoff and next steps](docs/handoff.md) (Chinese) | Fixes in the current version and what comes next |
| [Desktop acceptance](docs/desktop-acceptance.md) | Side-pane acceptance checklist, run only in isolated ZCode copies |
| [Verification](docs/verification.md) | Checks executed and their results |
| [Comparison with dsh-context](docs/dsh-comparison.md) (Chinese) | UI and feature gap assessment |

<br>

<div align="center">

<sub>MIT License · The implementation is original; the product direction was inspired by <a href="https://github.com/bowenliang123/dsh-context">dsh-context</a></sub><br>
<sub><a href="#readme-top">Back to top ↑</a></sub>

</div>
