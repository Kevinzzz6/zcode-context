import { createHash } from "node:crypto";
import { inputElements, contentKey, estimateTokens, canonical } from "./trajectory.mjs";
import { nonnegative } from "./session.mjs";
// Measured sizes of a request's input elements.
//
// The provider reports each request's whole input. Within one series (same file segment, source and model) consecutive
// requests differ by what entered and what left between them, so the change in reported input plus the sizes booked
// for what left is exactly the size of what entered. A new reply is booked at exactly the output tokens of the response
// that produced it, when its tool-call IDs (or, for a text reply, its text) prove it is that response and the output
// leaves room for whatever else entered; the rest of the increase belongs to the other new elements: measured when
// there is one, split by estimate when there are several. Content measured once has that size again wherever it
// reappears with the same model. The first request of a series has no increase, so its reported total is split by
// estimate, except for content measured earlier or by ZCode's conversation store (storeSizes). A partial (tail)
// record's total includes unrecorded messages, so it is never split: what is not measured there is a plain estimate,
// and what it cannot account for stays unrecorded. Nothing is scaled across requests, and no measured size is below 1.
const identity = key => createHash("sha256").update(key).digest("base64url").slice(0, 22);
// Reported counts of otherwise identical requests can differ by a few tokens of framing. What an accepted step leaves
// unattributed is carried as a residual, and a request whose residual outgrows the tolerance is split afresh.
const FRAMING = 16;
const tolerance = total => Math.max(FRAMING, total * 0.002);
// A model whose output overshoots the next request's increase in more than 5% of at least 10 checks, and at least 3
// times, does not send all of its output back as input (hidden reasoning, say), so its replies are not booked at
// their output, and what was measured with it is not reused.
const GUARD_STEPS = 10, GUARD_MISSES = 3, GUARD_MISS_RATE = 0.05;
const guardFails = guard => guard.steps >= GUARD_STEPS && guard.misses >= GUARD_MISSES && guard.misses / guard.steps > GUARD_MISS_RATE;
// Known sizes that leave less than this share of the estimate for the remaining elements do not fit the total.
const PLAUSIBLE_SHARE = 0.3;
// Schemas named by the request but absent from its body are part of the reported total without being elements.
const accountable = record => record.messages.complete && !(record.tools === null && record.toolNames.length > 0);
const isMessage = element => element.key.startsWith("message:");
// A reply's own text, without reasoning or tool calls: what a response records as its text.
const replyText = message => typeof message?.content === "string" ? message.content
  : Array.isArray(message?.content) ? message.content.filter(part => part?.type === "text").map(part => String(part.text ?? "")).join("") : "";
const squeeze = text => String(text).replace(/\s+/g, "");
// Count of sorted values at or below x.
function rank(sorted, x) {
  let low = 0, high = sorted.length;
  while (low < high) { const mid = (low + high) >> 1; if (sorted[mid] <= x) low = mid + 1; else high = mid; }
  return low;
}

// A delta record shares the message objects of the record it extends, so each message's identity is computed once.
const identities = new WeakMap();
function elementsOf(record) {
  return inputElements(record).map(element => {
    const value = element.value, shared = value && typeof value === "object";
    let known = shared ? identities.get(value) : null;
    if (!known) {
      const key = contentKey(value);
      known = { id: identity(key), estimate: Math.max(1, estimateTokens(key)) };
      if (shared) identities.set(value, known);
    }
    return { key: element.key, role: element.role, id: known.id, estimate: known.estimate,
      calls: element.calls.map(call => call.id).filter(id => typeof id === "string").map(id => id.slice(0, 256)),
      toolCallId: element.toolCallId, chars: element.role === "tool" ? element.readable.length : null,
      text: element.role === "assistant" ? replyText(value) : null };
  });
}
const entry = (element, tokens, kind, source) => ({ id: element.id, role: element.role, tokens, kind, source, share: null });
function share(next, elements, indexes, tokens, scope) {
  const estimate = indexes.reduce((n, i) => n + elements[i].estimate, 0) || 1, group = { tokens, count: indexes.length, scope };
  for (const i of indexes) next[i] = { ...entry(elements[i], tokens * elements[i].estimate / estimate, "split", null), share: group };
}
const estimateOf = (elements, indexes) => indexes.reduce((n, i) => n + elements[i].estimate, 0);
// The new reply is the previous response: exactly the response's tool-call IDs, or for a text reply exactly its text
// (only its opening when the response text was longer than the recorded preview).
function isResponse(element, prev) {
  if (prev.callCount > prev.callIds.length) return false;
  const ids = prev.callIds;
  if (element.calls.length || ids.length)
    return element.calls.length === ids.length && new Set(element.calls).size === ids.length && element.calls.every(id => ids.includes(id));
  const said = squeeze(prev.preview), text = squeeze(element.text ?? "");
  return said.length >= 8 && (prev.previewWhole ? text === said : text.startsWith(said));
}

function baseline(elements, total, complete, lookup) {
  const next = new Array(elements.length).fill(null);
  let known = elements.map(element => { const found = lookup?.(element); return found && found.tokens >= 1 ? found : null; });
  const fixedOf = list => list.reduce((n, found) => n + (found?.tokens ?? 0), 0);
  if (complete) {
    const fixed = fixedOf(known), open = estimateOf(elements, elements.flatMap((_, i) => known[i] ? [] : [i]));
    if (fixed && (open ? total - fixed < PLAUSIBLE_SHARE * open : Math.abs(total - fixed) > tolerance(total))) known = known.map(() => null);
  }
  const rest = [];
  elements.forEach((element, i) => { if (known[i]) next[i] = entry(element, known[i].tokens, "measured", known[i].source); else rest.push(i); });
  if (complete) { if (rest.length) share(next, elements, rest, total - fixedOf(known), "base"); }
  else for (const i of rest) next[i] = entry(elements[i], elements[i].estimate, "estimated", null);
  return next;
}

// Pairs the elements of two complete requests by identity: whatever is unpaired entered or left.
function matchAll(prev, elements) {
  const pool = new Map();
  prev.entries.forEach((item, j) => { const q = pool.get(item.id); if (q) q.push(j); else pool.set(item.id, [j]); });
  const used = new Set(), next = new Array(elements.length).fill(null), added = [];
  elements.forEach((element, i) => {
    const q = pool.get(element.id);
    if (q?.length) { const j = q.shift(); used.add(j); next[i] = { ...prev.entries[j], role: element.role }; }
    else added.push(i);
  });
  return { next, added, removed: prev.entries.filter((_, j) => !used.has(j)) };
}
// A partial record holds a trailing window of the messages. It continues the previous one only by appending: the window
// may move on, but where the two overlap every message is the same, and only messages past the previous end are new.
// Messages that slid out of the window are still sent, only no longer recorded, so they leave nothing. Schemas are
// recorded in full and pair by identity.
function matchWindow(prev, elements, record) {
  const start = record.messages.offset, from = prev.offset;
  const messages = elements.filter(isMessage), end = start + messages.length, previousEnd = from + prev.messageIds.length;
  if (start == null || from == null || start < from || start >= previousEnd || end < previousEnd) return null;
  for (let j = start; j < previousEnd; j++) if (messages[j - start].id !== prev.messageIds[j - from]) return null;
  const next = new Array(elements.length).fill(null), added = [], pool = new Map(), used = new Set();
  prev.entries.forEach((item, j) => { if (j < prev.messageIds.length) return; const q = pool.get(item.id); if (q) q.push(j); else pool.set(item.id, [j]); });
  elements.forEach((element, i) => {
    if (isMessage(element)) {
      const j = start + i;
      if (j < previousEnd) next[i] = { ...prev.entries[j - from], role: element.role }; else added.push(i);
      return;
    }
    const q = pool.get(element.id);
    if (q?.length) { const j = q.shift(); used.add(j); next[i] = { ...prev.entries[j], role: element.role }; } else added.push(i);
  });
  return { next, added, removed: prev.entries.filter((_, j) => j >= prev.messageIds.length && !used.has(j)) };
}

function advance(prev, elements, record, total, complete, guard, remembered) {
  if (complete !== prev.complete) return null;
  const match = complete ? matchAll(prev, elements) : matchWindow(prev, elements, record);
  if (!match) return null;
  const { next, added, removed } = match;
  // What left without a measured size of its own leaves the increase unknown; what left at an estimated share leaves it
  // exact only up to that share.
  if (removed.some(item => item.kind === "estimated")) return null;
  const exact = removed.every(item => item.kind === "measured");
  const tol = tolerance(total), budget = total - prev.total + removed.reduce((n, item) => n + item.tokens, 0);
  const replies = added.filter(i => elements[i].role === "assistant");
  let reply = replies.length === 1 && prev.output > 0 && isResponse(elements[replies[0]], prev) ? replies[0] : null;
  if (reply !== null && exact) { guard.steps++; if (prev.output > budget + FRAMING) guard.misses++; }
  // Booked at exactly its output, which must leave room for the rest. A reply that entered alone is the increase itself.
  if (reply !== null && (guard.disabled || added.length === 1 || prev.output >= budget)) reply = null;
  const others = added.filter(i => i !== reply), rest = budget - (reply === null ? 0 : prev.output);
  if (!others.length) return Math.abs(rest) > tol ? null : next;
  if (rest < 1) return null;
  if (reply !== null) next[reply] = entry(elements[reply], prev.output, "measured", "reply");
  // Content measured before keeps its size, and the rest of the increase goes to what is new, unless the two disagree.
  let known = exact && remembered && others.length > 1 ? others.filter(i => remembered(elements[i])) : [];
  let unknown = others.filter(i => !known.includes(i)), remaining = rest - known.reduce((n, i) => n + remembered(elements[i]).tokens, 0);
  if (known.length && (unknown.length ? remaining < Math.max(1, PLAUSIBLE_SHARE * estimateOf(elements, unknown)) : Math.abs(remaining) > tol)) {
    known = []; unknown = others; remaining = rest;
  }
  for (const i of known) next[i] = entry(elements[i], remembered(elements[i]).tokens, "measured", "earlier");
  if (unknown.length === 1 && exact) next[unknown[0]] = entry(elements[unknown[0]], remaining, "measured", "increment");
  else if (unknown.length) share(next, elements, unknown, remaining, exact ? "step" : "removal");
  return next;
}

function finish(elements, entries, total, complete) {
  const byKey = new Map();
  let sum = 0, measured = 0;
  elements.forEach((element, i) => {
    const item = entries[i];
    byKey.set(element.key, { tokens: item.tokens, kind: item.kind, source: item.source, share: item.share });
    sum += item.tokens; if (item.kind === "measured") measured += item.tokens;
  });
  return { total, complete, measured, byKey, residual: complete ? total - sum : null,
    unrecorded: !complete && total - sum > tolerance(total) ? total - sum : null };
}
const sumOf = entries => entries.reduce((n, item) => n + item.tokens, 0);

export const createSizeLedger = () => ({ series: new Map() });
// Content measured once has that size wherever it appears again with the same model and source, so a series that starts
// over keeps what it measured before. The memory is bounded; the oldest sizes go first.
const MEMORY = 8000;
function remember(memory, elements, entries) {
  entries.forEach((item, i) => {
    if (item.kind !== "measured") return;
    memory.delete(elements[i].id); memory.set(elements[i].id, item.tokens);
    if (memory.size > MEMORY) memory.delete(memory.keys().next().value);
  });
}
// Sizes for one record, in file order. `segment` changes at every gap, reset or skipped record of the file; `breaks`
// are the sorted times of compactions, which can change messages outside a partial record's window.
// Returns null when the provider reported no input for the request.
export function measureRecord(ledger, record, { segment = 0, store = null, breaks = [] } = {}) {
  const total = nonnegative(record.responseUsage?.inputTokens);
  if (!total) return null;
  const elements = elementsOf(record), complete = accountable(record), model = canonical(record.model ?? {}), modelId = record.model?.modelId;
  let series = ledger.series.get(record.querySource);
  if (!series) ledger.series.set(record.querySource, series = { prev: null, guards: new Map(), memories: new Map() });
  let guard = series.guards.get(model), memory = series.memories.get(model);
  if (!guard) series.guards.set(model, guard = { steps: 0, misses: 0, disabled: false });
  if (!memory) series.memories.set(model, memory = new Map());
  // The store judged the model over the whole session, before any record was read.
  if (!guard.disabled && store?.disabled(modelId)) { guard.disabled = true; memory.clear(); }
  let prev = series.prev?.segment === segment && series.prev.model === model ? series.prev : null;
  if (prev && !complete && rank(breaks, record.startedAt) !== rank(breaks, prev.startedAt)) prev = null;
  const remembered = guard.disabled ? null : element => { const tokens = memory.get(element.id); return tokens ? { tokens, source: "earlier" } : null; };
  const fromStore = guard.disabled ? null : store?.lookup(modelId);
  const lookup = element => { const found = remembered?.(element); if (found) return found; const tokens = fromStore?.(element); return tokens == null ? null : { tokens, source: "store" }; };
  const before = guard.disabled;
  let entries = prev ? advance(prev, elements, record, total, complete, guard, remembered) : null;
  // A model that just failed the guard has its earlier bookings dropped from here on: this request is split afresh.
  if (!before && guardFails(guard)) { guard.disabled = true; memory.clear(); entries = null; }
  if (entries && complete && Math.abs(total - sumOf(entries)) > tolerance(total)) entries = null;
  entries ??= baseline(elements, total, complete, guard.disabled ? null : lookup);
  if (!guard.disabled) remember(memory, elements, entries);
  series.prev = { segment, model, total, complete, startedAt: record.startedAt, output: nonnegative(record.responseUsage?.outputTokens),
    callIds: record.responseCallIds ?? [], callCount: record.responseCallCount ?? 0,
    preview: String(record.responsePreview ?? ""), previewWhole: String(record.responsePreview ?? "").length < 240,
    offset: record.messages.offset, messageIds: elements.filter(isMessage).map(element => element.id), entries };
  return finish(elements, entries, total, complete);
}

// Sizes ZCode's conversation store measures without request records, used where a series starts. model_usage links each
// completed request to the assistant message it produced. For two consecutive requests of a source and model, with no
// compaction or model switch between them, a reply's size is the first request's output when that fits the second's
// increase, and a lone tool result is the increase less that output when no visible message was created between them
// and the result sent is the content the store holds (the same length). Content a request adds without persisting it
// (some runtime reminders) is then counted with the tool result; in local sessions that held for 3 of 407 such steps.
// Models failing the reply guard over the session get no store sizes, and records of theirs book no replies at output.
export function storeSizes(rows, conversation, breaks = []) {
  if (!rows?.length || !conversation?.tools) return null;
  const callsByMessage = new Map(), messageByCall = new Map(), lengthOf = new Map();
  for (const tool of conversation.tools.values()) {
    if (typeof tool.callId !== "string" || !tool.messageId) continue;
    const calls = callsByMessage.get(tool.messageId) ?? []; calls.push(tool.callId); callsByMessage.set(tool.messageId, calls);
    messageByCall.set(tool.callId, messageByCall.has(tool.callId) ? null : tool.messageId);
    lengthOf.set(tool.callId, Number.isFinite(tool.outputChars) ? tool.outputChars : null);
  }
  const times = list => list.filter(Number.isFinite).sort((a, b) => a - b);
  const users = times([...conversation.messages.values()].filter(m => m.role === "user" && m.visibility !== "hidden").map(m => m.created));
  // Compactions and timeline entries (model switches) change what the next request sends without being a new message.
  const marks = times([...breaks, ...[...(conversation.parts?.values() ?? [])].filter(p => p.type === "compaction" || p.type === "timeline").map(p => p.created)]);
  const between = (sorted, from, to) => rank(sorted, to) !== rank(sorted, from);
  // One series per source in time order; rows linked to no message, or to one with several completed rows, keep their place.
  const completed = new Map(), series = new Map();
  for (const row of rows) {
    if (row.message) completed.set(row.message, (completed.get(row.message) ?? 0) + 1);
    const list = series.get(row.source) ?? []; list.push(row); series.set(row.source, list);
  }
  const output = new Map(), tools = new Map(), guards = new Map();
  for (const list of series.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt);
    for (let k = 0; k + 1 < list.length; k++) {
      const row = list[k], next = list[k + 1];
      if (!row.message || completed.get(row.message) !== 1 || !row.model || next.model !== row.model) continue;
      if (!(row.output > 0) || !(row.input > 0) || !(next.input >= row.input) || between(marks, row.startedAt, next.startedAt)) continue;
      const delta = next.input - row.input, guard = guards.get(row.model) ?? { steps: 0, misses: 0 };
      guards.set(row.model, guard); guard.steps++;
      if (row.output > delta + FRAMING) { guard.misses++; continue; }
      if (row.output > delta) continue;
      output.set(row.message, { tokens: row.output, model: row.model });
      const calls = callsByMessage.get(row.message);
      if (delta - row.output >= 1 && calls?.length === 1 && messageByCall.get(calls[0]) === row.message && !between(users, row.startedAt, next.startedAt))
        tools.set(calls[0], { tokens: delta - row.output, model: row.model, chars: lengthOf.get(calls[0]) });
    }
  }
  const disabled = new Set([...guards].filter(([, guard]) => guardFails(guard)).map(([model]) => model));
  return {
    disabled: modelId => disabled.has(modelId),
    lookup(modelId) {
      if (typeof modelId !== "string" || disabled.has(modelId)) return null;
      return element => {
        if (element.role === "assistant" && element.calls.length) {
          const message = messageByCall.get(element.calls[0]);
          if (!message || element.calls.some(id => messageByCall.get(id) !== message) || callsByMessage.get(message).length !== element.calls.length) return null;
          const reply = output.get(message);
          return reply?.model === modelId ? reply.tokens : null;
        }
        const result = element.role === "tool" && element.toolCallId ? tools.get(element.toolCallId) : null;
        // The result sent must be the content the store measured: a cleared or rewritten one has another length.
        return result?.model === modelId && result.chars != null && result.chars === element.chars ? result.tokens : null;
      };
    }
  };
}
