# Verification — 2026-10-14

## Desktop acceptance of 0.3.6 — 2026-10-14

Client 3.15.1.8093, isolated profile, plugin 0.3.6 installed from this repository's marketplace.
Every item of the matrix passed; results are in `output/verification/desktop-v036.json`. Scenarios the host
cannot drive (two windows over one workspace, a surface for a request-less session, a forced microcompact,
recorded evidence for a picker model switch) were moved out of the matrix into a documented "outside the matrix"
note in desktop-acceptance.md. A live edit-rewind could not be driven (the host's edit button ignores synthetic
events); branch handling is unit-tested against ZCode's revert shape. The 0.2.0-era "Context tab missing after
restart" issue did not reproduce. Usage read exactly from a hot 4.5 MB WAL; a 306 KB message paged in 26 chunks; rotation,
malformed/partial rows, a 5.6 MB record and a reset marker all behaved as specified; hidden panels stopped polling
and heavy panel use changed no bytes.

## Previous run — 2026-10-12 (0.2.0) Source contract baseline: ZCode 3.15.1 (aac4755666d09fdcd70272fcf063c077a639015f).
Actual Windows client: 3.15.1.8093. All data-producing desktop calls use the isolated local mock provider.

| Check | Environment | Result |
|---|---|---|
| Syntax, manifest, build and bundled dependency notices | WSL Node 24.13.1 / esbuild 0.28.2 | Passed |
| Domain/data regression, readonly WAL, identity, reset, gaps, search, tool pairing, baseline, bounded Diff | WSL Node 24.13.1 | 42 tests passed |
| Same syntax and regression suite | Native Windows Node 24.19.0 | 42 tests passed |
| Built service and app-only MCP tools, bound-session isolation | WSL stdio | Passed |
| Installed release service, no source node_modules | Native Windows / bundled MCP test client | Passed |
| Official App/AppBridge, real stdio/SQLite, A/B fixture | Chrome 154.0.8037.98 | 15 interaction groups passed; no page errors |
| Historical composition, pinned refresh, missing baseline, added/removed navigation, verified schema body Diff | Same SDK browser fixture | Passed |
| Search beyond 40 elements and explicit all-loaded-snapshot search | Same SDK browser fixture | Passed |
| Tool arguments, 12k body chunks, full-body search, return state and guest reconstruction | Same SDK browser fixture | Passed |
| All diagnostic tabs and body at 320/360/420/520 CSS px, themes/locales, browse preference, clickable chart | Same SDK browser fixture | Passed; no horizontal overflow |
| Official CLI market validation and isolated 0.2.0 installation | Windows / fully isolated CLI profile | Passed |
| Real Electron guest handshake, session binding, SQLite/traj, pinned refresh, readable body/return, guest reload restore | 3.15.1.8093 / isolated profile | Passed with exact project-level test approvals |
| Real sidebar layout | Electron guest, 434 CSS px, DPR 1.25 | DOM width passed; parent CDP screenshots are not used as layout proof |
| ZIP CRC, manifest/required files, equality to local marketplace and SHA-256 | Python stdlib packaging | Passed |
| Restart and real compaction cases | Actual client | 0.2.0: incomplete; 0.3.6: passed |
| macOS / hosted GitHub Actions | Not run | Unverified |

## Evidence and limits

Raw WSL reports: `output/verification/result.json`, syntax/unit/build/stdio logs.
Native results: `windows-result.json`, `windows-unit.log`, `windows-syntax.log`, `windows-stdio.log`.
Browser results and four-width images: `output/playwright/`. Synthetic SDK fixture is not Electron.
Desktop results: `output/verification/desktop-v036.json` (0.3.6), `desktop-v02.json` (0.2.0); drivers/raw host logs in `_sandbox/context-desktop-acceptance`.
Package result: `output/verification/package-result.json` and the ZIP `.sha256` file.

The earlier 0.1.1 desktop baseline successfully bound a real session and read its recorded usage/content;
that remains basic integration evidence, not the complete desktop acceptance matrix.

This run found an important host constraint: generic MCP `readOnlyHint` does not bypass approval.
`get_context_request` initially waited for host permission, then timed out after 60 seconds; the main UI did not
show the request. A CLI `permission.allowedTools` attempt did not resolve it in this conversation.
The isolated fixture already had a precise project approval for `get_context_summary`; the test driver added
only `get_context_request` to that same fixture project's ruleset. Details and guest reload then passed.
This test setup writes only the isolated fixture database's project permission row; the plugin itself remains read-only.
It is not a validated automatic installation workaround for real users. See handoff.md for exact tool names.

On full application restart, reopening the old test conversation did not immediately expose Context in the
side-pane menu. It appeared after another local mock request. Old-session opening without a new submission
still needs host integration work. A successful guest reload is not proof of a full application restart.

Body replacements are paired only by unique recorded identities. Ordinary-message replacement is not guessed.
Unified Diff is a bounded common-prefix/suffix replacement block, not a minimal LCS diff; very long single lines
also remain bounded to 12k characters. Markdown supports safe headings/paragraphs/code only. Copy means current block.
State restoration requires sandbox localStorage; it was available in this Electron fixture.
No official source, executable, real user configuration or real conversation database was modified.
