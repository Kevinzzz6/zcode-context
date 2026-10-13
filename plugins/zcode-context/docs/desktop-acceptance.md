# Desktop acceptance — isolated ZCode only

Baseline: ZCode 3.15.1. Do not run these checks in the developer's active ZCode profile.
Use an isolated executable/profile. Register the repository root (marketplace.json + plugins/zcode-context) in that same profile.

Status on 2026-10-14: client 3.15.1.8093; plugin 0.3.6.
Every item of the matrix above passed in the isolated profile against the local mock provider
(output/verification/desktop-v036.json). The 0.2.0-era "Context tab missing until a new request
after restart" did not reproduce. Earlier baselines: v0.1.1 handshake, v0.2 SDK browser and
local installation (desktop-v02.json).

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
4. Restart the plugin service and reopen an older session without submitting a message.
   The page must obtain a fresh host binding, not a saved last-active mapping.
5. Keep the SQLite writer alive in WAL mode. New usage must appear without a checkpoint.
   Compare provider-normalized input/output/cache against the canonical model_usage rows.
6. Cause a normal tool result and an automatic compact in test sessions.
   Distinguish observed message changes from explicitly logged causes.
7. Rotate away the session's traj. Usage remains; content coverage says unavailable/cached.
8. Exercise full/delta/tail, missing baseline, incomplete final line, malformed row, size reset
   and a large full-retention file. Memory and response size must remain bounded.
9. Test light/dark theme and English/Chinese, a narrow pane, keyboard navigation and long tool output.
    Open added and removed Diff elements; each must show content from its own snapshot.
    Check daily UTC totals against SQLite independently of the 80-request timeline cap.
10. Close/hide the panel. It must stop UI polling; closing a page must not change conversation data.

Outside the matrix — the host cannot exercise these, so they are not acceptance items: two
windows over one workspace (no API or documented path opens a second one), a surface for a
session that never sent a request (the host mounts no tab until a conversation exists), a
forced local microcompact, and recorded evidence for a picker model switch (3.15.1.8093
writes neither a timeline part nor a log row). Cross-session response ordering stays guarded
per request in the plugin and is unit-tested; the waiting state is covered by the browser fixture.

Record the client version, platform, profile, source identity, build version, pass/fail and failures.
Node tests and a stdio smoke test do not substitute for the actual MCP Apps guest/host handshake.
