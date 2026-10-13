const ALLOWED = new Set(["compact.started", "compact.completed", "compact.auto.started", "compact.auto.completed",
  "compact.auto.failed", "compact.reactive.started", "compact.reactive.completed", "compact.reactive.failed", "compact.micro.applied"]);
export function compactEvent(record, sessionId) {
  if (record.sessionId !== sessionId || !ALLOWED.has(record.event)) return null;
  const context = record.context ?? {};
  return { event: record.event, timestamp: Date.parse(record.timestamp) || 0,
    turnId: record.turnId ?? null, reason: context.compactReason ?? context.trigger ?? null,
    tokensSavedEstimate: typeof context.tokensSaved === "number" ? context.tokensSaved : null,
    clearedMessageCount: typeof context.clearedMessageCount === "number" ? context.clearedMessageCount : null,
    evidence: "logged" };
}
