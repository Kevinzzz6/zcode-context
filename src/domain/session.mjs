export class ContextError extends Error {
  constructor(code, message) { super(message); this.name = "ContextError"; this.code = code; }
}
export function readSessionContext(meta) {
  const value = meta?.["com.zcode/request-context"];
  const sessionId = value?.session_id;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(sessionId)) {
    throw new ContextError("binding_unavailable", "Host session metadata is missing or invalid.");
  }
  return Object.freeze({ sessionId });
}
// From ZCode's modelTrajectoryFileTail.ts (Apache-2.0, see NOTICE); must stay identical to match the host's file names.
export function sanitizeSessionSegment(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
export function nonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function isAgentSource(value) {
  return value === "main_turn" || value === "subagent" || value === "workflow_child";
}
