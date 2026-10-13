# Desktop acceptance — isolated ZCode only

Baseline: ZCode 3.15.1. Do not run these checks in the developer's active ZCode profile.
Use an isolated executable/profile. Register dist/local-marketplace in that same profile.

Status on 2026-10-12: current client 3.15.1.8093; plugin 0.2.0.
Basic v0.1.1 Electron handshake and real-session data were verified. v0.2 SDK browser and local installation
are verified; the full matrix below remains incomplete. See verification.md for precise executed checks.

Use USERPROFILE, APPDATA and LOCALAPPDATA plus ZCODE_DESKTOP_* in child processes. ZCODE_STORAGE_DIR alone
is insufficient because the CLI reads config under os.homedir(). The fixtures live in _sandbox/context-desktop-acceptance.
Generic MCP host policy still requires authorization: an unapproved get_context_request waited then timed out
without a main-page prompt. The isolated fixture seeds project-level approvals for the two exact read-only tool names in handoff.md;
never silently modify a user's real policy or use wildcard bypasses.

1. Verify the installed plugin name/version, enabled state and Node 24+ availability.
2. Open a session's Context surface. Confirm get_context_summary receives the session_id
   in the host namespace. Log identifiers only; do not capture prompts or credentials.
3. In one workspace create A and B, open their panels, submit to B while keeping A open.
   A must stay A. Switch to A without sending anything; its panel must still report A.
4. Open the same workspace in two windows and interleave refresh/detail requests.
   Late A results must never overwrite B, including when moving or rebuilding a panel.
5. Restart the plugin service and reopen an older session without submitting a message.
   The page must obtain a fresh host binding, not a saved last-active mapping.
6. With a bound session that has no model attempt, show the waiting state.
   Never show a different session's file. An unmaterialized draft may not have a surface yet.
7. Keep the SQLite writer alive in WAL mode. New usage must appear without a checkpoint.
   Compare provider-normalized input/output/cache against the canonical model_usage rows.
8. Cause a normal tool result, a local microcompact, an automatic compact and a model switch
   in test sessions. Distinguish observed message changes from explicitly logged causes.
9. Rotate away the session's traj. Usage remains; content coverage says unavailable/cached.
10. Exercise full/delta/tail, missing baseline, incomplete final line, malformed row, size reset
    and a large full-retention file. Memory and response size must remain bounded.
11. Test light/dark theme and English/Chinese, a narrow pane, keyboard navigation and long tool output.
    Open added and removed Diff elements; each must show content from its own snapshot.
    Check daily UTC totals against SQLite independently of the 80-request timeline cap.
12. Close/hide the panel. It must stop UI polling; closing a page must not change conversation data.

Record the client version, platform, profile, source identity, build version, pass/fail and failures.
Node tests and a stdio smoke test do not substitute for the actual MCP Apps guest/host handshake.
