import { nonnegative } from "./session.mjs";
export function parseUsage(value) {
  if (typeof value !== "string") return null;
  try { const result = JSON.parse(value); return result && typeof result === "object" && !Array.isArray(result) ? result : null; } catch { return null; }
}
export function normalizedInput(row) {
  const input = nonnegative(row.input_tokens) ?? 0;
  const cache = (nonnegative(row.cache_read_input_tokens) ?? 0) + (nonnegative(row.cache_creation_input_tokens) ?? 0);
  if (input <= 0) return cache;
  if (cache <= 0) return input;
  const total = nonnegative(row.provider_total_tokens) ?? nonnegative(row.computed_total_tokens) ?? 0;
  const output = nonnegative(row.output_tokens) ?? 0;
  return total > 0 && Math.abs(total - (input + cache + output)) < Math.abs(total - (input + output)) ? input + cache : input;
}
export function normalizeFact(row) {
  const raw = parseUsage(row.raw_usage_json);
  const known = (column,key) => nonnegative(row[column]) > 0 || nonnegative(raw?.[key]) !== null;
  const inputKnown = known("input_tokens","inputTokens");
  const outputKnown = known("output_tokens","outputTokens");
  const readKnown = known("cache_read_input_tokens","cacheReadTokens");
  const writeKnown = known("cache_creation_input_tokens","cacheWriteTokens");
  const providerTotal = nonnegative(row.provider_total_tokens) ?? nonnegative(raw?.totalTokens);
  const totalTokens = inputKnown && outputKnown
    ? nonnegative(row.computed_total_tokens) ?? normalizedInput(row) + row.output_tokens
    : providerTotal;
  return {
    id: String(row.id), logicalRequestId: row.logical_request_id ?? null,
    sessionId: row.session_id, turnId: row.turn_id ?? null, traceId: row.trace_id ?? null,
    querySource: row.query_source ?? "unknown", providerId: row.provider_id ?? null,
    modelId: row.model_id ?? null, status: row.status ?? "unknown",
    startedAt: nonnegative(row.started_at), durationMs: nonnegative(row.duration_ms),
    ttftMs: nonnegative(row.time_to_first_token_ms), retryCount: nonnegative(row.retry_count) ?? 0,
    inputTokens: inputKnown ? normalizedInput(row) : null,
    outputTokens: outputKnown ? nonnegative(row.output_tokens) ?? 0 : null,
    reasoningTokens: known("reasoning_tokens","reasoningTokens") ? nonnegative(row.reasoning_tokens) ?? 0 : null,
    cacheReadTokens: readKnown ? nonnegative(row.cache_read_input_tokens) ?? 0 : null,
    cacheWriteTokens: writeKnown ? nonnegative(row.cache_creation_input_tokens) ?? 0 : null,
    totalTokens, hasUsage: inputKnown || outputKnown || readKnown || writeKnown || totalTokens !== null
  };
}
