const COMPACT = new Set(["compact.started", "compact.completed", "compact.auto.started", "compact.auto.completed",
  "compact.auto.failed", "compact.reactive.started", "compact.reactive.completed", "compact.reactive.failed", "compact.micro.applied"]);
const OTHER = { "session.model.updated": "model", "rewind.conversation.completed": "rewind",
  "conversation.command.edit_user_query.completed": "rewind", "mcp.tools.registered": "tools" };
const count = value => typeof value === "number" && Number.isFinite(value) ? value : null;

// One logged record that changes what the next request sends. Records of one operation share a span and are merged later.
export function contextEvent(record, sessionId) {
  if (record.sessionId !== sessionId) return null;
  const kind = COMPACT.has(record.event) ? "compaction" : OTHER[record.event];
  if (!kind) return null;
  const context = record.context ?? {};
  const base = { kind, event: record.event, timestamp: Date.parse(record.timestamp) || 0, turnId: record.turnId ?? null,
    spanId: typeof record.spanId === "string" ? record.spanId : null, evidence: "logged" };
  if (kind === "compaction") return { ...base, status: record.event.split(".").at(-1),
    reason: context.compactReason ?? context.trigger ?? null, durationMs: count(record.durationMs),
    tokensSavedEstimate: count(context.tokensSaved), clearedMessageCount: count(context.clearedMessageCount) };
  if (kind === "model") {
    // Without a previous model this is the session's first selection, not a switch.
    if (typeof context.model !== "string" || typeof context.previousModel !== "string" || context.model === context.previousModel) return null;
    return { ...base, from: context.previousModel, to: context.model };
  }
  if (kind === "rewind") return { ...base, edited: record.event.startsWith("conversation.command.edit_user_query"),
    keptMessageCount: count(context.keptMessageCount) };
  return { ...base, toolCount: count(context.registeredToolCount), serverCount: count(context.serverCount) };
}

const RANK = { started: 0, applied: 1, completed: 2, failed: 3 };
// A compaction logs started and completed (or failed) under one span; an edited question logs the edit and its rewind under one span.
export function mergeEvents(events) {
  const merged = new Map();
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const key = event.spanId && (event.kind === "compaction" || event.kind === "rewind") ? event.kind + ":" + event.spanId
      : event.kind + ":" + event.event + ":" + event.timestamp + ":" + event.turnId;
    const last = merged.get(key);
    if (!last) { merged.set(key, { ...event, endedAt: event.kind === "compaction" && event.status === "started" ? null : event.timestamp }); continue; }
    const next = { ...last, endedAt: Math.max(last.endedAt ?? 0, event.timestamp), turnId: last.turnId ?? event.turnId };
    if (event.kind === "compaction") {
      if (RANK[event.status] >= RANK[last.status]) { next.status = event.status; next.event = event.event; }
      for (const field of ["reason", "durationMs", "tokensSavedEstimate", "clearedMessageCount"]) next[field] = event[field] ?? last[field];
      next.durationMs ??= next.endedAt != null ? next.endedAt - last.timestamp : null;
    } else {
      next.edited = last.edited || event.edited; next.keptMessageCount = event.keptMessageCount ?? last.keptMessageCount;
    }
    merged.set(key, next);
  }
  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}
