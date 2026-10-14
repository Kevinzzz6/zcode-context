import { estimateTokens, inputSummary } from "./trajectory.mjs";
const COMPACT = new Set(["compact.started", "compact.completed", "compact.failed", "compact.auto.started", "compact.auto.completed",
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
  // A cancelled manual compaction is logged as compact.failed with status "cancelled".
  if (kind === "compaction") return { ...base, status: record.event === "compact.failed" && record.status === "cancelled" ? "interrupted" : record.event.split(".").at(-1),
    reason: context.compactReason ?? context.trigger ?? null, durationMs: count(record.durationMs), queryId: context.queryId ?? null,
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

const RANK = { started: 0, applied: 1, completed: 2, failed: 3, interrupted: 3 };
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
      for (const field of ["reason", "durationMs", "tokensSavedEstimate", "clearedMessageCount", "queryId"]) next[field] = event[field] ?? last[field];
      next.durationMs ??= next.endedAt != null ? next.endedAt - last.timestamp : null;
    } else {
      next.edited = last.edited || event.edited; next.keptMessageCount = event.keptMessageCount ?? last.keptMessageCount;
    }
    merged.set(key, next);
  }
  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}

const TEXT_CHARS = 1500;
const parse = text => { try { const value = JSON.parse(text); return value && typeof value === "object" ? value : {}; } catch { return {}; } };
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const modelLabel = selection => !selection ? null : selection.label ?? ([selection.providerId ?? selection.providerID, selection.modelId ?? selection.modelID].filter(Boolean).join("/") || null);
// ZCode's compact timeline statuses. A summarized boundary is evidence of completion; any other status is not guessed.
const STATUSES = new Set(["started", "retrying", "completed", "failed", "interrupted", "skipped"]);
const statusOf = (value, boundary) => STATUSES.has(value) ? value : value == null && boundary ? "completed" : "unknown";
// A message the runtime put into the conversation for the model: not the user's own prompt and not hidden from the provider.
const injected = m => m.role === "user" && m.visibility !== "hidden" && m.kind !== "compact_summary" && m.kind !== "user_prompt"
  && (m.origin === "agent_runtime" || m.synthetic === 1 || m.kind != null);

// Context events from ZCode's conversation store. Sources are ZCode's own labels (semantics.kind / semantics.source), never inferred from text.
export function conversationEvents(cache) {
  const events = [], texts = new Map(), groups = new Map();
  for (const part of [...cache.parts.values()].sort((a, b) => a.created - b.created)) {
    if (part.type === "text") { const list = texts.get(part.messageId) ?? []; list.push(part); texts.set(part.messageId, list); }
    else if (part.type === "tool" && part.tool === "Skill") events.push({ kind: "inject", evidence: "recorded", id: "p:" + part.id, form: "skill",
      name: typeof part.skill === "string" ? part.skill : null, timestamp: number(part.toolEnd) ?? part.created,
      tokens: part.outputChars != null ? sampled(part.outputSample, part.outputChars) : null, toolCallId: part.callId ?? null });
    else if (part.type === "timeline" && part.timelineType === "model_change") {
      const data = parse(part.raw), from = modelLabel(data.fromModelSelection), to = modelLabel(data.toModelSelection ?? data.toModel);
      if (to && from !== to) events.push({ kind: "model", evidence: "recorded", id: "t:" + part.id, timestamp: number(data.time?.start) ?? part.created, from, to });
    } else if (part.type === "compaction" || (part.type === "timeline" && part.timelineType === "context_compaction")) {
      // A compaction writes a separator part, a boundary part and a timeline part; they share one boundary id.
      const data = parse(part.raw), boundary = data.compactBoundary ?? {}, key = data.boundaryId ?? boundary.boundaryId ?? data.operationId;
      if (!key) continue;
      const group = groups.get(key) ?? { boundaryId: key };
      for (const [name, value] of Object.entries({ operationId: data.operationId, queryId: data.sourceCommandId, trigger: data.trigger ?? boundary.trigger,
        reason: data.compactReason ?? boundary.compactReason, status: data.status ?? data.timelineStatus, start: data.time?.start, end: data.time?.end,
        preTokens: data.preCompactTokenCount ?? boundary.preCompactTokenCount, postTokens: data.truePostCompactTokenCount ?? boundary.truePostCompactTokenCount,
        summarizedCount: boundary.summarizedMessageCount, keptCount: boundary.keptMessageCount, lastSummarizedId: boundary.lastSummarizedMessageId,
        summaryMessageId: data.summaryMessageId ?? boundary.summaryMessageId, created: part.created })) if (value != null) group[name] ??= value;
      groups.set(key, group);
    }
  }
  for (const m of cache.messages.values()) {
    if (!injected(m)) continue;
    const text = (texts.get(m.id) ?? []).map(x => x.text ?? "").join("\n").trim();
    if (!text) continue;
    // Each part's whole text, or for one longer than the read bound its prefix, length and digest. Reminders share long
    // fixed openings, so a prefix alone cannot tell two of them apart; a long part without a digest leaves it unlocated.
    const pieces = (texts.get(m.id) ?? []).filter(x => x.text).map(x => x.truncated ? x.verify ?? null : { text: x.text.trim() });
    const needles = pieces.every(Boolean) ? pieces.filter(x => x.text !== "") : null;
    const chars = (texts.get(m.id) ?? []).reduce((n, x) => n + (x.textChars ?? 0), 0);
    events.push({ kind: "inject", evidence: "recorded", id: "m:" + m.id, form: m.kind ?? "context", source: m.source ?? m.metaSource ?? null,
      timestamp: m.created, tokens: sampled(text, chars),
      text: text.slice(0, TEXT_CHARS), truncated: chars > TEXT_CHARS, needles });
  }
  for (const g of groups.values()) {
    const start = number(g.start) ?? g.created, end = number(g.end), status = statusOf(g.status, g.lastSummarizedId != null || g.summarizedCount != null);
    const summary = g.summaryMessageId ? cache.messages.get(g.summaryMessageId) : null, last = g.lastSummarizedId ? cache.messages.get(g.lastSummarizedId) : null;
    events.push({ kind: "compaction", evidence: "recorded", id: "c:" + g.boundaryId, event: g.trigger === "auto" ? "compact.auto." + status : "compact." + status,
      status, trigger: g.trigger ?? null, reason: g.reason ?? null, timestamp: start, endedAt: status === "started" || status === "retrying" ? null : end ?? start,
      durationMs: end != null ? end - start : null, preTokens: number(g.preTokens), postTokens: number(g.postTokens),
      tokensSavedEstimate: number(g.preTokens) != null && number(g.postTokens) != null ? g.preTokens - g.postTokens : null,
      summarizedCount: number(g.summarizedCount), keptCount: number(g.keptCount), queryId: g.queryId ?? null,
      summarySequence: summary?.sequence ?? null, lastSummarizedSequence: last?.sequence ?? null });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// Text is read as a bounded sample; its token estimate scales the sample's script mix to the full length.
const sampled = (text, chars) => !text ? 0 : Math.round(estimateTokens(text) * Math.max(1, (chars ?? text.length) / text.length));
const firstLine = text => String(text ?? "").split("\n").map(x => x.trim()).find(x => x && !/^<\/?[a-z][\w-]*>$/i.test(x))?.slice(0, 160) ?? "";
// One row per model-visible part of the summarized messages: prompts, replies, reasoning, tool calls and injected context.
export function summarizedItems(messages) {
  const items = [];
  for (const m of messages) {
    if (m.visibility === "hidden") continue;
    for (const p of m.parts) {
      if (p.type === "text" && p.text) items.push({ role: p.synthetic === 1 || injected(m) ? "inject" : m.role === "user" ? "user" : "assistant",
        chip: p.synthetic === 1 || injected(m) ? m.source ?? m.kind ?? p.textSource ?? null : null, title: firstLine(p.text), tokens: sampled(p.text, p.textChars) });
      else if (p.type === "reasoning" && p.text) items.push({ role: "reasoning", chip: null, title: firstLine(p.text), tokens: sampled(p.text, p.textChars) });
      else if (p.type === "tool") {
        const title = inputSummary(p.inputFields ?? {}) ?? inputSummary(p.inputSample) ?? "";
        items.push({ role: "tool", chip: p.tool ?? null, title, tokens: sampled(p.inputSample, p.inputChars) + sampled(p.outputSample, p.outputChars) });
      }
    }
  }
  return items;
}

// Recorded events are authoritative for what the store covers; logs add rewinds, MCP registrations and compactions the store
// has no part for (a failed attempt, say). The same compaction is recognised by its command id or by overlapping time.
export function combineEvents(recorded, logged) {
  if (!recorded.length) return logged;
  const compactions = recorded.filter(e => e.kind === "compaction");
  const same = e => compactions.some(c => (e.queryId && e.queryId === c.queryId) || (e.timestamp <= (c.endedAt ?? c.timestamp) + 2000 && (e.endedAt ?? e.timestamp) >= c.timestamp - 2000));
  const recordedModels = recorded.some(e => e.kind === "model");
  return [...recorded, ...logged.filter(e => e.kind === "compaction" ? !same(e) : e.kind === "model" ? !recordedModels : true)]
    .sort((a, b) => a.timestamp - b.timestamp);
}
