import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);

// src/worker.mjs
import { parentPort, workerData } from "node:worker_threads";

// src/data/service.mjs
import { join } from "node:path";
import { createHash as createHash2 } from "node:crypto";

// src/data/sqlite.mjs
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";

// src/domain/session.mjs
var ContextError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContextError";
    this.code = code;
  }
};
function sanitizeSessionSegment(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function nonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function isAgentSource(value) {
  return value === "main_turn" || value === "subagent" || value === "workflow_child";
}

// src/domain/usage.mjs
function parseUsage(value) {
  if (typeof value !== "string") return null;
  try {
    const result = JSON.parse(value);
    return result && typeof result === "object" && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}
function normalizedInput(row) {
  const input = nonnegative(row.input_tokens) ?? 0;
  const cache = (nonnegative(row.cache_read_input_tokens) ?? 0) + (nonnegative(row.cache_creation_input_tokens) ?? 0);
  if (input <= 0) return cache;
  if (cache <= 0) return input;
  const total = nonnegative(row.provider_total_tokens) ?? nonnegative(row.computed_total_tokens) ?? 0;
  const output = nonnegative(row.output_tokens) ?? 0;
  return total > 0 && Math.abs(total - (input + cache + output)) < Math.abs(total - (input + output)) ? input + cache : input;
}
function normalizeFact(row) {
  const raw = parseUsage(row.raw_usage_json);
  const known = (column, key) => nonnegative(row[column]) > 0 || nonnegative(raw?.[key]) !== null;
  const inputKnown = known("input_tokens", "inputTokens");
  const outputKnown = known("output_tokens", "outputTokens");
  const readKnown = known("cache_read_input_tokens", "cacheReadTokens");
  const writeKnown = known("cache_creation_input_tokens", "cacheWriteTokens");
  const providerTotal = nonnegative(row.provider_total_tokens) ?? nonnegative(raw?.totalTokens);
  const totalTokens = inputKnown && outputKnown ? nonnegative(row.computed_total_tokens) ?? normalizedInput(row) + row.output_tokens : providerTotal;
  return {
    id: String(row.id),
    logicalRequestId: row.logical_request_id ?? null,
    sessionId: row.session_id,
    turnId: row.turn_id ?? null,
    traceId: row.trace_id ?? null,
    querySource: row.query_source ?? "unknown",
    providerId: row.provider_id ?? null,
    modelId: row.model_id ?? null,
    status: row.status ?? "unknown",
    startedAt: nonnegative(row.started_at),
    durationMs: nonnegative(row.duration_ms),
    ttftMs: nonnegative(row.time_to_first_token_ms),
    retryCount: nonnegative(row.retry_count) ?? 0,
    inputTokens: inputKnown ? normalizedInput(row) : null,
    outputTokens: outputKnown ? nonnegative(row.output_tokens) ?? 0 : null,
    reasoningTokens: known("reasoning_tokens", "reasoningTokens") ? nonnegative(row.reasoning_tokens) ?? 0 : null,
    cacheReadTokens: readKnown ? nonnegative(row.cache_read_input_tokens) ?? 0 : null,
    cacheWriteTokens: writeKnown ? nonnegative(row.cache_creation_input_tokens) ?? 0 : null,
    totalTokens,
    hasUsage: inputKnown || outputKnown || readKnown || writeKnown || totalTokens !== null
  };
}

// src/data/sqlite.mjs
var FIELDS = [
  "id",
  "logical_request_id",
  "session_id",
  "turn_id",
  "trace_id",
  "query_source",
  "provider_id",
  "model_id",
  "status",
  "started_at",
  "duration_ms",
  "time_to_first_token_ms",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "provider_total_tokens",
  "computed_total_tokens",
  "retry_count",
  "raw_usage_json"
];
function readUsage(dbPath, sessionId, now = Date.now()) {
  let db;
  try {
    if (!statSync(dbPath).isFile()) throw new ContextError("database_missing", "Session database is not a regular file.");
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN");
    const columns = new Set(db.prepare("PRAGMA table_info(model_usage)").all().map((row) => row.name));
    if (!["id", "session_id", "started_at", "input_tokens", "output_tokens"].every((key) => columns.has(key))) {
      throw new ContextError("schema_unsupported", "This database does not have the supported model_usage schema.");
    }
    const expression = (key) => columns.has(key) ? key : "NULL";
    const selection = FIELDS.map((key) => expression(key) + " AS " + key).join(",");
    const raw = expression("raw_usage_json");
    const knownFor = (column, key) => "(coalesce(" + expression(column) + ",0)>0 OR CASE WHEN json_valid(" + raw + ") THEN json_type(" + raw + ",'$." + key + "') IN ('integer','real') AND json_extract(" + raw + ",'$." + key + "')>=0 ELSE 0 END)";
    const inputKnown = knownFor("input_tokens", "inputTokens");
    const outputKnown = knownFor("output_tokens", "outputTokens");
    const readKnown = knownFor("cache_read_input_tokens", "cacheReadTokens");
    const writeKnown = knownFor("cache_creation_input_tokens", "cacheWriteTokens");
    const rawTotalKnown = "(CASE WHEN json_valid(" + raw + ") THEN json_type(" + raw + ",'$.totalTokens') IN ('integer','real') AND json_extract(" + raw + ",'$.totalTokens')>=0 ELSE 0 END)";
    const providerKnown = "(" + expression("provider_total_tokens") + " IS NOT NULL OR " + rawTotalKnown + ")";
    const totalKnown = "((" + inputKnown + " AND " + outputKnown + ") OR " + providerKnown + ")";
    const known = "(" + [inputKnown, outputKnown, readKnown, writeKnown, totalKnown].join(" OR ") + ")";
    const cache = "(coalesce(" + expression("cache_read_input_tokens") + ",0)+coalesce(" + expression("cache_creation_input_tokens") + ",0))";
    const storedTotal = "coalesce(" + expression("provider_total_tokens") + "," + expression("computed_total_tokens") + ",0)";
    const inputSide = "CASE WHEN coalesce(input_tokens,0)<=0 THEN " + cache + " WHEN " + cache + "<=0 THEN input_tokens WHEN " + storedTotal + ">0 AND abs(" + storedTotal + "-(input_tokens+" + cache + "+coalesce(output_tokens,0)))<abs(" + storedTotal + "-(input_tokens+coalesce(output_tokens,0))) THEN input_tokens+" + cache + " ELSE input_tokens END";
    const total = "CASE WHEN " + inputKnown + " AND " + outputKnown + " THEN coalesce(" + expression("computed_total_tokens") + ",(" + inputSide + ")+coalesce(output_tokens,0)) ELSE coalesce(" + expression("provider_total_tokens") + ",CASE WHEN json_valid(" + raw + ") THEN json_extract(" + raw + ",'$.totalTokens') ELSE NULL END) END";
    const totalsSql = "count(*) AS requestCount, sum(CASE WHEN " + known + " THEN 1 ELSE 0 END) AS reportedCount,sum(CASE WHEN " + inputKnown + " THEN 1 ELSE 0 END) AS inputReportedCount,sum(CASE WHEN " + outputKnown + " THEN 1 ELSE 0 END) AS outputReportedCount,sum(CASE WHEN " + totalKnown + " THEN 1 ELSE 0 END) AS totalReportedCount,sum(CASE WHEN " + inputKnown + " THEN (" + inputSide + ") ELSE 0 END) AS inputTokens,sum(CASE WHEN " + outputKnown + " THEN output_tokens ELSE 0 END) AS outputTokens,sum(CASE WHEN " + totalKnown + " THEN (" + total + ") ELSE 0 END) AS totalTokens,sum(CASE WHEN " + inputKnown + " AND " + readKnown + " THEN coalesce(" + expression("cache_read_input_tokens") + ",0) ELSE 0 END) AS cacheReadTokens,sum(CASE WHEN " + inputKnown + " AND " + readKnown + " THEN (" + inputSide + ") ELSE 0 END) AS cacheInputTokens,sum(CASE WHEN " + expression("status") + "='error' THEN 1 ELSE 0 END) AS errorCount,sum(coalesce(" + expression("retry_count") + ",0)) AS retryCount";
    const since = now - 30 * 24 * 60 * 60 * 1e3;
    const aggregate = db.prepare("SELECT " + totalsSql + " FROM model_usage WHERE session_id=? AND started_at>=?").get(sessionId, since);
    const facts = db.prepare("SELECT " + selection + " FROM model_usage WHERE session_id=? AND started_at>=? ORDER BY started_at DESC,id DESC LIMIT 80").all(sessionId, since).map(normalizeFact).reverse();
    const days = db.prepare("SELECT CAST(started_at / 86400000 AS INTEGER) AS utcDay," + totalsSql + " FROM model_usage WHERE session_id=? AND started_at>=? GROUP BY utcDay ORDER BY utcDay").all(sessionId, since);
    db.exec("COMMIT");
    const normalize = (row) => {
      const requestCount = Number(row.requestCount ?? 0);
      const reportedCount = Number(row.reportedCount ?? 0);
      const inputTokens = Number(row.inputTokens ?? 0);
      return {
        requestCount,
        reportedCount,
        missingUsageCount: requestCount - reportedCount,
        inputMissingCount: requestCount - Number(row.inputReportedCount ?? 0),
        outputMissingCount: requestCount - Number(row.outputReportedCount ?? 0),
        totalMissingCount: requestCount - Number(row.totalReportedCount ?? 0),
        inputTokens: Number(row.inputReportedCount ?? 0) ? inputTokens : null,
        outputTokens: Number(row.outputReportedCount ?? 0) ? Number(row.outputTokens ?? 0) : null,
        totalTokens: Number(row.totalReportedCount ?? 0) ? Number(row.totalTokens ?? 0) : null,
        cacheHitRate: Number(row.cacheInputTokens ?? 0) > 0 ? Number(row.cacheReadTokens ?? 0) / Number(row.cacheInputTokens) : null,
        errorCount: Number(row.errorCount ?? 0),
        retryCount: Number(row.retryCount ?? 0)
      };
    };
    return {
      available: true,
      totals: normalize(aggregate),
      facts,
      days: days.map((row) => ({ utcDay: row.utcDay, ...normalize(row) })),
      windowDays: 30,
      timelineLimited: Number(aggregate.requestCount ?? 0) > facts.length
    };
  } catch (error) {
    if (db) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
    }
    const code = error.code === "ENOENT" ? "database_missing" : error.code === "SQLITE_BUSY" || /locked|busy/i.test(error.message) ? "database_busy" : error instanceof ContextError ? error.code : "database_unavailable";
    return { available: false, code, facts: [], days: [], totals: null, windowDays: 30 };
  } finally {
    db?.close();
  }
}
function readToolCalls(dbPath, sessionId) {
  let db;
  try {
    if (!statSync(dbPath).isFile()) throw new ContextError("database_missing", "Session database is not a regular file.");
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN");
    const columns = new Set(db.prepare("PRAGMA table_info(tool_usage)").all().map((row) => row.name));
    if (!["session_id", "tool_name"].every((key) => columns.has(key))) {
      throw new ContextError("schema_unsupported", "This database does not have the supported tool_usage schema.");
    }
    const errors = columns.has("status") ? "sum(CASE WHEN status='error' THEN 1 ELSE 0 END)" : "NULL";
    const rows = db.prepare("SELECT tool_name AS name, count(*) AS count, " + errors + " AS errorCount FROM tool_usage WHERE session_id=? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC, tool_name LIMIT 500").all(sessionId);
    db.exec("COMMIT");
    const byName = /* @__PURE__ */ Object.create(null);
    for (const row of rows) byName[String(row.name).slice(0, 160)] = { count: Number(row.count), errorCount: row.errorCount == null ? null : Number(row.errorCount) };
    return { available: true, scope: "session", byName, callCount: rows.reduce((n, row) => n + Number(row.count), 0), truncated: rows.length === 500 };
  } catch (error) {
    if (db) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
    }
    const code = error.code === "ENOENT" ? "database_missing" : error.code === "SQLITE_BUSY" || /locked|busy/i.test(error.message) ? "database_busy" : error instanceof ContextError ? error.code : "database_unavailable";
    return { available: false, code, byName: {} };
  } finally {
    db?.close();
  }
}

// src/data/jsonl.mjs
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
var CHUNK = 128 * 1024;
var COLD_BYTES = 24 * 1024 * 1024;
var SCAN_BYTES = 8 * 1024 * 1024;
var LINE_BYTES = 8 * 1024 * 1024;
var hash = (value) => createHash("sha256").update(value).digest("hex");
var JsonlTail = class {
  offset = 0;
  pending = Buffer.alloc(0);
  skipping = false;
  generation = 0;
  identity = null;
  headHash = null;
  headLength = 0;
  mtime = 0;
  missing = false;
  coverage = [];
  markCoverage(reason) {
    if (!this.coverage.includes(reason)) this.coverage.push(reason);
  }
  reset(state, size, onReset) {
    this.identity = state;
    this.offset = Math.max(0, size - COLD_BYTES);
    this.pending = Buffer.alloc(0);
    this.skipping = this.offset > 0;
    this.headHash = null;
    this.headLength = 0;
    this.generation++;
    this.coverage = this.offset > 0 ? ["history_window"] : [];
    onReset?.();
  }
  async scan(path, onRow, onReset, onGap) {
    let file;
    try {
      file = await open(path, "r");
      const st = await file.stat();
      const identity = st.dev + ":" + st.ino;
      const prefix = Buffer.alloc(this.headLength || Math.min(256, st.size));
      await file.read(prefix, 0, prefix.length, 0);
      const changed = this.identity !== identity || st.size < this.offset || this.missing || this.headHash !== null && hash(prefix) !== this.headHash || st.size === this.offset && st.mtimeMs !== this.mtime;
      if (this.identity === null || changed) this.reset(identity, st.size, onReset);
      if (this.headHash === null) {
        this.headLength = Math.min(256, st.size);
        const head = Buffer.alloc(this.headLength);
        await file.read(head, 0, head.length, 0);
        this.headHash = hash(head);
      }
      this.missing = false;
      const stop = Math.min(st.size, this.offset + SCAN_BYTES);
      while (this.offset < stop) {
        const buffer = Buffer.alloc(Math.min(CHUNK, stop - this.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, this.offset);
        if (!bytesRead) break;
        let start = 0;
        const base = this.offset;
        this.offset += bytesRead;
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] !== 10) continue;
          const piece = buffer.subarray(start, i);
          if (this.skipping) {
            this.skipping = false;
            this.pending = Buffer.alloc(0);
            onGap?.();
          } else if (this.pending.length + piece.length > LINE_BYTES) {
            this.markCoverage("oversized_line");
            this.pending = Buffer.alloc(0);
            onGap?.();
          } else {
            const line = Buffer.concat([this.pending, piece]).toString("utf8").trim();
            this.pending = Buffer.alloc(0);
            if (line) {
              try {
                const value = JSON.parse(line);
                if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid row");
                onRow(value, base + i);
              } catch {
                this.markCoverage("malformed_line");
                onGap?.();
              }
            }
          }
          start = i + 1;
        }
        const rest = buffer.subarray(start, bytesRead);
        if (!this.skipping) {
          if (this.pending.length + rest.length > LINE_BYTES) {
            this.pending = Buffer.alloc(0);
            this.skipping = true;
            this.markCoverage("oversized_line");
            onGap?.();
          } else this.pending = Buffer.concat([this.pending, rest]);
        }
      }
      this.mtime = st.mtimeMs;
      return {
        available: true,
        scanning: this.offset < st.size,
        pendingLine: this.pending.length > 0,
        generation: this.generation,
        coverage: [...new Set(this.coverage)]
      };
    } catch (error) {
      this.missing = true;
      return { available: false, code: error.code === "ENOENT" ? "trajectory_missing" : "file_unavailable", scanning: false, coverage: [...new Set(this.coverage)] };
    } finally {
      await file?.close();
    }
  }
};

// src/domain/trajectory.mjs
var MAX_CONTEXT_CHARS = 24 * 1024 * 1024;
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
var isWide = (c) => c >= 11904 && c <= 40959 || c >= 44032 && c <= 55215 || c >= 63744 && c <= 64255 || c >= 65280 && c <= 65519;
function estimateTokens(text) {
  let narrow = 0, wide = 0, other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) narrow++;
    else if (isWide(c)) wide++;
    else {
      other++;
      if (c >= 55296 && c <= 56319) i++;
    }
  }
  return Math.ceil(narrow / 4 + wide / 1.5 + other / 2);
}
var TOKEN_METHOD = "script_weighted";
var CACHE_KEYS = /* @__PURE__ */ new Set(["cacheControl", "cache_control"]);
var withoutCache = (value) => Array.isArray(value) ? value.map(withoutCache) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([k]) => !CACHE_KEYS.has(k)).map(([k, v]) => [k, withoutCache(v)])) : value;
var contentKey = (value) => canonical(withoutCache(value));
function expandCollection(items, kind, offset, count, previous) {
  const at = Number.isInteger(offset) && offset >= 0 ? offset : null;
  if (!Array.isArray(items)) return { items: [], offset: 0, complete: false, reason: "not_recorded" };
  if (kind !== void 0 && !["full", "delta", "tail"].includes(kind)) return { items, offset: null, complete: false, reason: "unsupported_encoding" };
  if (kind === "tail") return { items, offset: at, complete: offset === 0 && (count == null || count === items.length), reason: "tail" };
  if (kind === "delta") {
    if (at === null || !previous?.complete || previous.items.length < offset) {
      return { items, offset: at, complete: false, reason: "missing_baseline" };
    }
    const expanded = previous.items.slice(0, offset).concat(items);
    return { items: expanded, offset: 0, complete: count == null || expanded.length === count, reason: count == null || expanded.length === count ? null : "count_mismatch" };
  }
  return { items, offset: 0, complete: count == null || items.length === count, reason: count == null || items.length === count ? null : "count_mismatch" };
}
function foldRecord(raw, previous) {
  const request = raw.request ?? {};
  const messages = expandCollection(request.messages, request.messagesKind, request.messageOffset, request.messageCount, previous?.messages);
  let body = request.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const providerMessages = expandCollection(body?.messages, request.bodyMessagesKind, request.bodyMessageOffset, request.bodyMessageCount, previous?.providerMessages);
  const sdkMessages = expandCollection(request.sdkMessages, request.sdkMessagesKind, request.sdkMessageOffset, request.sdkMessageCount, previous?.sdkMessages);
  const size = [messages, providerMessages, sdkMessages].reduce((n, collection) => n + collection.items.reduce((sum, item) => sum + canonical(item).length, 0), 0);
  if (size > MAX_CONTEXT_CHARS) return { oversized: true, messages: { items: [], complete: false, reason: "context_limit" } };
  const bodyTools = Array.isArray(body?.tools) ? body.tools : null;
  return {
    requestId: typeof raw.requestId === "string" ? raw.requestId : "",
    messageTotal: Number.isInteger(request.messageCount) && request.messageCount >= 0 ? request.messageCount : null,
    attempt: Number.isInteger(raw.attempt) ? raw.attempt : 1,
    startedAt: Date.parse(raw.startedAt) || 0,
    turnId: raw.turnId ?? null,
    querySource: raw.querySource ?? "unknown",
    model: raw.model ?? {},
    messages,
    providerMessages,
    sdkMessages,
    tools: bodyTools,
    toolNames: Array.isArray(request.toolNames) ? request.toolNames : [],
    responseUsage: raw.response?.usage ?? null,
    responsePreview: String(raw.response?.text ?? "").slice(0, 240),
    responseCalls: (Array.isArray(raw.response?.toolCalls) ? raw.response.toolCalls : []).slice(0, 8).map((call) => ({
      name: typeof (call?.name ?? call?.toolName) === "string" ? String(call.name ?? call.toolName).slice(0, 80) : null,
      title: inputSummary(parseInput(call?.input ?? call?.args ?? call?.arguments))
    })),
    responseCallCount: Array.isArray(raw.response?.toolCalls) ? raw.response.toolCalls.length : 0,
    hasResponse: Boolean(raw.response),
    hasError: Boolean(raw.error),
    hasReset: Boolean(raw.modelIOReset),
    bodySource: body?.bodySource ?? null
  };
}
function readableText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => {
    if (typeof part === "string") return part;
    if (part?.text !== void 0) return String(part.text);
    if (part?.type === "tool-call" || part?.type === "tool_use") return JSON.stringify(part, null, 2);
    if (part?.result !== void 0) return readableText(part.result);
    return JSON.stringify(part, null, 2);
  }).join("\n\n");
  return value == null ? "" : JSON.stringify(value, null, 2);
}
function resultPart(message) {
  const results = (Array.isArray(message?.content) ? message.content : []).filter((x) => ["tool-result", "tool_result"].includes(x?.type));
  return results.length === 1 ? results[0] : null;
}
function parseInput(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function messageCalls(message) {
  const calls = [];
  for (const call of Array.isArray(message?.toolCalls) ? message.toolCalls : [])
    calls.push({ id: call?.id ?? call?.toolCallId ?? null, name: call?.name ?? call?.toolName ?? null, input: parseInput(call?.input ?? call?.args ?? call?.arguments) });
  for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    calls.push({ id: call?.id ?? null, name: call?.function?.name ?? call?.name ?? null, input: parseInput(call?.function?.arguments ?? call?.arguments) });
  for (const part of Array.isArray(message?.content) ? message.content : [])
    if (["tool-call", "tool_use"].includes(part?.type)) calls.push({ id: part.toolCallId ?? part.id ?? null, name: part.toolName ?? part.name ?? null, input: parseInput(part.args ?? part.input) });
  return calls;
}
function callIndex(record) {
  const index = /* @__PURE__ */ new Map();
  for (const message of record.messages.items) for (const call of messageCalls(message))
    if (call.id) index.set(call.id, index.has(call.id) ? null : call);
  return index;
}
var REMINDER = /^\s*<system-reminder>\s*/;
var INJECTED = /^\s*<([a-z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>\s*/i;
function userText(text) {
  let rest = String(text ?? "");
  for (let i = 0; i < 8 && INJECTED.test(rest); i++) rest = rest.replace(INJECTED, "");
  return rest.replace(/^\s*## My request for ZCode:\s*/i, "");
}
var oneLine = (text) => String(text).replace(/\s+/g, " ").trim().slice(0, 160);
function firstLine(text) {
  for (const line of String(text ?? "").split("\n")) {
    const value = line.trim();
    if (value && !/^<\/?system-reminder>$/.test(value)) return value.slice(0, 160);
  }
  return "";
}
var SUMMARY_KEYS = ["command", "file_path", "notebook_path", "pattern", "url", "query", "skill", "path", "description", "prompt", "subject", "name", "title"];
function inputSummary(input) {
  if (input == null) return null;
  if (typeof input !== "object") return oneLine(input) || null;
  for (const key of SUMMARY_KEYS) {
    if (typeof input[key] !== "string" || !input[key].trim()) continue;
    return key === "pattern" && typeof input.path === "string" ? oneLine(input.pattern + " \xB7 " + input.path) : oneLine(input[key]);
  }
  const first = Object.values(input).find((value) => typeof value === "string" && value.trim());
  return first ? oneLine(first) : null;
}
function describe(item) {
  if (item.role === "tool") return { chip: item.toolName ?? item.call?.name ?? null, title: inputSummary(item.call?.input) ?? firstLine(item.readable), subtitle: null };
  if (item.role === "assistant" && item.calls.length) {
    const names = [...new Set(item.calls.map((call) => call.name ?? "tool"))];
    const chip = names.length === 1 ? names[0] + (item.calls.length > 1 ? " \xD7" + item.calls.length : "") : names.slice(0, 2).join(" \xB7 ") + (names.length > 2 ? " \u2026" : "");
    return { chip, title: firstLine(item.readable) || inputSummary(item.calls[0].input) || "", subtitle: null };
  }
  if (item.role === "user" && REMINDER.test(item.readable)) return { chip: "reminder", title: firstLine(item.readable.replace(REMINDER, "")), subtitle: null };
  if (item.role === "schema") return { chip: null, title: item.toolName ?? firstLine(item.readable), subtitle: firstLine(item.value?.function?.description ?? item.value?.description ?? "") || null };
  if (item.role === "user") return { chip: null, title: firstLine(userText(item.readable)) || firstLine(item.readable), subtitle: null };
  return { chip: null, title: firstLine(item.readable), subtitle: null };
}
function inputElements(record) {
  const calls = callIndex(record);
  const result = record.messages.items.map((message, index) => {
    const toolCallId = message?.toolCallId ?? message?.tool_call_id ?? resultPart(message)?.toolCallId ?? resultPart(message)?.tool_use_id ?? null;
    return {
      key: "message:" + index,
      role: ["system", "user", "assistant", "tool"].includes(message?.role) ? message.role : "unknown",
      toolName: message?.toolName ?? message?.name ?? resultPart(message)?.toolName ?? null,
      toolCallId,
      text: JSON.stringify(message, null, 2),
      value: message,
      readable: readableText(message?.content ?? message?.text ?? message),
      status: message?.isError === true || resultPart(message)?.isError === true ? "error" : message?.isError === false || resultPart(message)?.isError === false ? "ok" : message?.status ?? null,
      calls: message?.role === "assistant" ? messageCalls(message) : [],
      call: toolCallId ? calls.get(toolCallId) ?? null : null
    };
  });
  for (const [index, tool] of (record.tools ?? []).entries()) result.push({
    key: "tool:" + index,
    role: "schema",
    toolName: tool?.function?.name ?? tool?.name ?? null,
    toolCallId: null,
    text: JSON.stringify(tool, null, 2),
    value: tool,
    readable: JSON.stringify(tool?.function ?? tool, null, 2),
    status: null,
    calls: [],
    call: null
  });
  return result;
}
function elementSummary(item) {
  const label = describe(item), serialized = canonical(item.value);
  return {
    key: item.key,
    role: item.role,
    toolName: typeof item.toolName === "string" ? item.toolName.slice(0, 160) : null,
    toolCallId: typeof item.toolCallId === "string" ? item.toolCallId.slice(0, 256) : null,
    chars: serialized.length,
    estimatedTokens: estimateTokens(serialized),
    preview: item.readable.replace(/\s+/g, " ").slice(0, 180),
    status: item.status,
    chip: typeof label.chip === "string" ? label.chip.slice(0, 80) : null,
    title: label.title,
    subtitle: label.subtitle,
    lines: item.readable.split("\n").length
  };
}
function toolEvidence(record, element) {
  if (!element.toolCallId) return null;
  const call = callIndex(record).get(element.toolCallId);
  if (!call) return null;
  const text = readableText(call.input);
  const fields = call.input && typeof call.input === "object" && !Array.isArray(call.input) ? Object.entries(call.input).slice(0, 16).map(([name, value]) => {
    const full = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
    return { name: name.slice(0, 80), value: full.slice(0, 800), truncated: full.length > 800 };
  }) : null;
  return { name: call.name ?? null, arguments: text.slice(0, 1600), argumentsTruncated: text.length > 1600, fields, evidence: "tool_call_id" };
}
function attemptUsage(usage) {
  return Object.fromEntries(["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].map((k) => [k, nonnegative(usage?.[k])]));
}
function composition(record) {
  const buckets = /* @__PURE__ */ new Map();
  for (const element of inputElements(record)) {
    const current = buckets.get(element.role) ?? { role: element.role, chars: 0, estimatedTokens: 0, count: 0 };
    const serialized = canonical(element.value);
    current.chars += serialized.length;
    current.estimatedTokens += estimateTokens(serialized);
    current.count++;
    buckets.set(element.role, current);
  }
  return { buckets: [...buckets.values()], tokenMethod: TOKEN_METHOD, complete: record.messages.complete, schemasRecorded: record.tools !== null };
}
function diffRecords(before, after) {
  if (!before.messages.complete || !after.messages.complete) return { available: false, reason: "incomplete_snapshot" };
  if (before.querySource !== after.querySource) return { available: false, reason: "different_query_source" };
  const schemasComparable = before.tools !== null && after.tools !== null;
  const a = inputElements(before).filter((x) => schemasComparable || x.role !== "schema");
  const b = inputElements(after).filter((x) => schemasComparable || x.role !== "schema");
  const queues = /* @__PURE__ */ new Map();
  a.forEach((item, i) => {
    const k = contentKey(item.value);
    const q = queues.get(k) ?? [];
    q.push(i);
    queues.set(k, q);
  });
  const removed = new Set(a.map((_, i) => i));
  const added = [];
  const matches = [];
  for (const [i, item] of b.entries()) {
    const q = queues.get(contentKey(item.value));
    if (q?.length) {
      const j = q.shift();
      removed.delete(j);
      matches.push([j, i]);
    } else added.push(item);
  }
  const removedItems = [...removed].map((i) => a[i]);
  const identity = (x) => x.role === "schema" && x.toolName ? "schema:" + x.toolName : x.toolCallId ? x.role + ":" + x.toolCallId : null;
  const changed = [];
  for (const afterItem of added) {
    const id = identity(afterItem);
    if (!id) continue;
    const left = a.filter((x) => identity(x) === id), right = b.filter((x) => identity(x) === id);
    if (left.length === 1 && right.length === 1 && removedItems.includes(left[0])) changed.push({ before: elementSummary(left[0]), after: elementSummary(afterItem), identity: id });
  }
  const roles = [...new Set([...a, ...b].map((x) => x.role))];
  const measure = new Map([...a, ...b].map((x) => {
    const s = canonical(x.value);
    return [x, { chars: s.length, tokens: estimateTokens(s) }];
  }));
  const categories = roles.map((role) => {
    const size = (xs, unit) => xs.filter((x) => x.role === role).reduce((n, x) => n + measure.get(x)[unit], 0);
    return {
      role,
      beforeChars: size(a, "chars"),
      afterChars: size(b, "chars"),
      charsDelta: size(b, "chars") - size(a, "chars"),
      tokensDelta: size(b, "tokens") - size(a, "tokens"),
      addedCount: added.filter((x) => x.role === role).length,
      removedCount: removedItems.filter((x) => x.role === role).length
    };
  });
  return {
    available: true,
    added: added.map(elementSummary),
    removed: removedItems.map(elementSummary),
    changed,
    categories,
    reordered: matches.some((v, i) => i > 0 && v[0] < matches[i - 1][0]),
    schemasComparable,
    charsDelta: categories.reduce((n, x) => n + x.charsDelta, 0),
    tokensDelta: categories.reduce((n, x) => n + x.tokensDelta, 0),
    modelChanged: canonical(before.model) !== canonical(after.model),
    attribution: "observed_change"
  };
}
function trajectorySummary(record, key) {
  return {
    key,
    requestId: record.requestId,
    attempt: record.attempt,
    startedAt: record.startedAt,
    turnId: record.turnId,
    querySource: record.querySource,
    model: record.model,
    complete: record.messages.complete,
    incompleteReason: record.messages.reason,
    messageCount: record.messages.items.length,
    messageTotal: record.messageTotal ?? null,
    schemaCount: record.tools?.length ?? null,
    hasResponse: record.hasResponse,
    hasError: record.hasError,
    composition: composition(record),
    usage: attemptUsage(record.responseUsage),
    responsePreview: record.responsePreview,
    responseCalls: record.responseCalls ?? [],
    responseCallCount: record.responseCallCount ?? 0,
    userPreview: oneLine(userText(inputElements(record).findLast((x) => x.role === "user" && !REMINDER.test(x.readable))?.readable ?? ""))
  };
}
function textDifference(before, after) {
  const a = before.split("\n"), b = after.split("\n");
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const rows = [
    ...a.slice(Math.max(0, start - 2), start).map((text) => ({ kind: "context", text })),
    ...a.slice(start, a.length - end).map((text) => ({ kind: "removed", text })),
    ...b.slice(start, b.length - end).map((text) => ({ kind: "added", text })),
    ...b.slice(b.length - end, b.length - end + 2).map((text) => ({ kind: "context", text }))
  ];
  return rows;
}

// src/domain/events.mjs
var ALLOWED = /* @__PURE__ */ new Set([
  "compact.started",
  "compact.completed",
  "compact.auto.started",
  "compact.auto.completed",
  "compact.auto.failed",
  "compact.reactive.started",
  "compact.reactive.completed",
  "compact.reactive.failed",
  "compact.micro.applied"
]);
function compactEvent(record, sessionId) {
  if (record.sessionId !== sessionId || !ALLOWED.has(record.event)) return null;
  const context = record.context ?? {};
  return {
    event: record.event,
    timestamp: Date.parse(record.timestamp) || 0,
    turnId: record.turnId ?? null,
    reason: context.compactReason ?? context.trigger ?? null,
    tokensSavedEstimate: typeof context.tokensSaved === "number" ? context.tokensSaved : null,
    clearedMessageCount: typeof context.clearedMessageCount === "number" ? context.clearedMessageCount : null,
    evidence: "logged"
  };
}

// src/data/service.mjs
var digest = (value) => createHash2("sha256").update(value).digest("hex").slice(0, 24);
var MAX_CACHE_CHARS = 32 * 1024 * 1024;
function groupByRole(items, limit = 40) {
  const groups = {};
  for (const item of items) {
    const group = groups[item.role] ??= { count: 0, items: [] };
    group.count++;
    if (group.items.length < limit) group.items.push(item);
  }
  return groups;
}
var bySize = (a, b) => b.chars - a.chars || a.key.localeCompare(b.key);
var SCHEMA_ORDER = {
  calls: (a, b) => (b.callCount ?? -1) - (a.callCount ?? -1) || bySize(a, b),
  name: (a, b) => (a.toolName == null) - (b.toolName == null) || String(a.toolName ?? "").localeCompare(String(b.toolName ?? "")) || a.key.localeCompare(b.key)
};
function arrange(list, sort, schemaSort) {
  const result = sort === "order" ? [...list] : [...list].sort(bySize), compare = SCHEMA_ORDER[schemaSort];
  if (!compare) return result;
  const slots = result.flatMap((x, i) => x.role === "schema" ? [i] : []), schemas = slots.map((i) => result[i]).sort(compare);
  slots.forEach((slot, i) => {
    result[slot] = schemas[i];
  });
  return result;
}
var ContextDataService = class {
  constructor(paths) {
    this.paths = paths;
    this.sessions = /* @__PURE__ */ new Map();
  }
  state(sessionId) {
    let state = this.sessions.get(sessionId);
    if (!state) {
      if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value);
      state = { ledgers: /* @__PURE__ */ new Map(), events: /* @__PURE__ */ new Map(), logTails: /* @__PURE__ */ new Map(), overview: null };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
  async refresh(sessionId) {
    const state = this.state(sessionId);
    const coverage = [];
    for (const directory of this.paths.trajectoryDirs) {
      const path = join(directory, "model-io-" + sanitizeSessionSegment(sessionId) + ".jsonl");
      let ledger = state.ledgers.get(path);
      if (!ledger) {
        ledger = { tail: new JsonlTail(), previous: null, records: /* @__PURE__ */ new Map(), chars: 0, segment: 0, steps: 0, turns: /* @__PURE__ */ new Map() };
        state.ledgers.set(path, ledger);
      }
      const status = await ledger.tail.scan(path, (raw, offset) => {
        if (raw.type !== "model_io" || raw.sessionId !== sessionId) {
          ledger.previous = null;
          ledger.segment++;
          return;
        }
        if (raw.modelIOReset) {
          ledger.previous = null;
          ledger.segment++;
          ledger.tail.markCoverage("history_reset");
        }
        const record = foldRecord(raw, ledger.previous);
        if (record.oversized) {
          ledger.previous = null;
          ledger.segment++;
          ledger.tail.markCoverage("context_limit");
          return;
        }
        const serialized = canonical(record);
        const chars = serialized.length;
        const key = digest(sessionId + ":" + path + ":" + ledger.tail.generation + ":" + ledger.segment + ":" + offset + ":" + digest(serialized));
        const summary = trajectorySummary(record, key);
        const agent = isAgentSource(record.querySource);
        if (agent && record.turnId && !ledger.turns.has(record.turnId)) ledger.turns.set(record.turnId, ledger.turns.size + 1);
        summary.step = agent ? ++ledger.steps : null;
        summary.turn = record.turnId ? ledger.turns.get(record.turnId) ?? null : null;
        ledger.records.set(key, { key, record, chars, path, offset, segment: ledger.segment, summary });
        ledger.chars += chars;
        ledger.previous = record;
        while (ledger.records.size > 120 || ledger.chars > MAX_CACHE_CHARS) {
          const first = ledger.records.keys().next().value;
          ledger.chars -= ledger.records.get(first).chars;
          ledger.records.delete(first);
          ledger.tail.markCoverage("display_window");
        }
        this.trimCaches();
      }, () => {
        ledger.previous = null;
        ledger.records.clear();
        ledger.chars = 0;
        ledger.segment++;
        ledger.steps = 0;
        ledger.turns.clear();
      }, () => {
        ledger.previous = null;
        ledger.segment++;
      });
      coverage.push(status);
    }
    for (let day = 0; day < 3; day++) {
      const date = /* @__PURE__ */ new Date();
      date.setDate(date.getDate() - day);
      const stamp = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
      const path = join(this.paths.logDir, "zcode-" + stamp + ".jsonl");
      let tail = state.logTails.get(path);
      if (!tail) {
        tail = new JsonlTail();
        state.logTails.set(path, tail);
      }
      await tail.scan(path, (raw) => {
        const event = compactEvent(raw, sessionId);
        if (event) state.events.set(event.event + ":" + event.timestamp + ":" + event.turnId, event);
        while (state.events.size > 100) state.events.delete(state.events.keys().next().value);
      });
    }
    const records = this.records(state);
    const usage = readUsage(this.paths.db, sessionId);
    state.toolCalls = readToolCalls(this.paths.db, sessionId);
    if (records.length && coverage.every((item) => !item.available)) coverage.push({ coverage: ["source_rotated"], scanning: false });
    const cutoff = Date.now() - 3 * 864e5;
    for (const [key, event] of state.events) if (event.timestamp < cutoff) state.events.delete(key);
    while (state.logTails.size > 3) state.logTails.delete(state.logTails.keys().next().value);
    const latest = records.findLast((item) => isAgentSource(item.record.querySource));
    const overview = {
      sessionId,
      usage,
      toolCalls: state.toolCalls,
      trajectories: records.slice(-60).map((item) => this.timelineItem(records, item)),
      composition: latest ? composition(latest.record) : null,
      trajectory: {
        available: records.length > 0,
        scanning: coverage.some((item) => item.scanning),
        pendingLine: coverage.some((item) => item.pendingLine),
        coverage: [...new Set(coverage.flatMap((item) => item.coverage))],
        errorCode: records.length ? null : coverage.every((item) => !item.available) ? "trajectory_missing" : "waiting_for_records"
      },
      events: [...state.events.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-30).map((event) => this.eventNavigation(records, event)),
      eventWindowDays: 3
    };
    overview.history = { loadedCount: records.length, loadedKeys: records.map((x) => x.key), page: 0, hasOlder: records.length > 60, scope: "bounded_loaded_window" };
    overview.revision = digest(JSON.stringify(overview));
    state.overview = overview;
    return overview;
  }
  trimCaches() {
    const ledgers = [...this.sessions.values()].flatMap((state) => [...state.ledgers.values()]);
    let total = ledgers.reduce((sum, ledger) => sum + ledger.chars, 0);
    while (total > MAX_CACHE_CHARS) {
      let owner = null;
      let oldest = null;
      for (const ledger of ledgers) {
        const first = ledger.records.values().next().value;
        if (first && (!oldest || first.record.startedAt < oldest.record.startedAt)) {
          owner = ledger;
          oldest = first;
        }
      }
      if (!owner) break;
      owner.records.delete(oldest.key);
      owner.chars -= oldest.chars;
      total -= oldest.chars;
      owner.tail.markCoverage("display_window");
      if (!owner.records.size) owner.previous = null;
    }
  }
  records(state) {
    return [...state.ledgers.values()].flatMap((ledger) => [...ledger.records.values()]).sort((a, b) => a.record.startedAt - b.record.startedAt || a.path.localeCompare(b.path) || a.offset - b.offset);
  }
  previous(all, selected) {
    const index = all.findIndex((x) => x.key === selected.key);
    return all.slice(0, index).findLast((x) => x.path === selected.path && x.record.querySource === selected.record.querySource);
  }
  comparison(all, selected, baselineKey) {
    const previous = baselineKey ? all.find((x) => x.key === baselineKey) : this.previous(all, selected);
    if (!previous) return { available: false, reason: baselineKey ? "baseline_expired" : "no_previous_snapshot" };
    if (previous.path !== selected.path || previous.segment !== selected.segment) return { available: false, reason: "history_gap", previousKey: previous.key };
    if (previous.key === selected.key || all.indexOf(previous) >= all.indexOf(selected)) return { available: false, reason: "invalid_baseline" };
    return { ...diffRecords(previous.record, selected.record), previousKey: previous.key };
  }
  // Absolute message range and per-message digests of one cached record, computed once and kept on the cache entry.
  fingerprint(entry) {
    const { items, offset } = entry.record.messages;
    return entry.fingerprint ??= { start: offset, end: offset == null ? null : offset + items.length, hashes: items.map((x) => digest(contentKey(x))) };
  }
  // The message at absolute index i entered with the earliest snapshot of an unbroken chain whose message count exceeds i.
  // The chain follows previous(): same file, segment and source. A missing offset, a shrinking count (compaction) or a
  // different recorded message at the same index ends it; whatever is still present there entered before that point.
  // Older records never appear later in a ledger, so the result is cached on the entry.
  entries(all, selected) {
    if (selected.entries !== void 0) return selected.entries;
    const own = this.fingerprint(selected);
    if (selected.summary.step == null || own.start == null) return selected.entries = null;
    const stamp = (x) => ({ step: x.summary.step, turn: x.summary.turn }), result = [], alive = new Set(own.hashes.keys());
    let cursor = selected, current = own;
    while (alive.size) {
      const prev = this.previous(all, cursor), before = prev && this.fingerprint(prev);
      if (!prev || prev.segment !== cursor.segment || before.start == null || before.end > current.end) {
        for (const p of alive) result[p] = { before: stamp(cursor) };
        break;
      }
      for (const p of alive) {
        const i = own.start + p;
        if (before.end <= i) {
          result[p] = { entered: stamp(cursor) };
          alive.delete(p);
        } else if (i >= before.start && before.hashes[i - before.start] !== own.hashes[p]) {
          result[p] = { before: stamp(cursor) };
          alive.delete(p);
        }
      }
      cursor = prev;
      current = before;
    }
    return selected.entries = result;
  }
  timelineItem(all, item) {
    if (!item.timeline || item.timeline.baselineKey && !all.some((x) => x.key === item.timeline.baselineKey)) {
      const d = this.comparison(all, item);
      item.timeline = {
        ...item.summary,
        delta: d.available ? { chars: d.charsDelta, tokens: d.tokensDelta, categories: d.categories, schemasComparable: d.schemasComparable } : null,
        baselineKey: d.previousKey ?? null,
        deltaReason: d.reason ?? null
      };
    }
    return item.timeline;
  }
  eventNavigation(records, event) {
    const matching = event.turnId ? records.filter((x) => x.record.turnId === event.turnId) : [];
    const before = records.findLast((x) => x.record.startedAt <= event.timestamp);
    const after = records.find((x) => x.record.startedAt > event.timestamp);
    return { ...event, navigation: {
      evidence: matching.length ? "turn_range" : "time_range",
      turnKeys: matching.slice(0, 12).map((x) => x.key),
      beforeKey: before?.key ?? null,
      afterKey: after?.key ?? null,
      beforeTime: before?.record.startedAt ?? null,
      afterTime: after?.record.startedAt ?? null
    } };
  }
  async overview(sessionId, revision, historyPage = 0) {
    const overview = await this.refresh(sessionId);
    const records = this.records(this.state(sessionId));
    const end = Math.max(0, records.length - historyPage * 60);
    const result = historyPage ? {
      ...overview,
      trajectories: records.slice(Math.max(0, end - 60), end).map((x) => this.timelineItem(records, x)),
      history: { ...overview.history, page: historyPage, hasOlder: end > 60 }
    } : overview;
    result.revision = digest(overview.revision + ":" + historyPage);
    return revision && revision === result.revision ? { sessionId, revision, unchanged: true } : result;
  }
  async request(sessionId, args) {
    const state = this.state(sessionId);
    if (!state.overview) await this.refresh(sessionId);
    const all = this.records(state), selected = all.find((x) => x.key === args.key);
    if (!selected) throw new ContextError("request_expired", "Request is outside the loaded trajectory window.");
    const record = selected.record, elements = inputElements(record), page = args.page ?? 0, pageSize = 40;
    let diff = this.comparison(all, selected, args.baselineKey);
    const calls = state.toolCalls ?? { available: false, byName: {} };
    const callCount = (x) => !calls.available || typeof x.toolName !== "string" ? null : Object.hasOwn(calls.byName, x.toolName) ? calls.byName[x.toolName].count : calls.truncated ? null : 0;
    const entries = this.entries(all, selected);
    const stampOf = (key) => {
      const e = key.startsWith("message:") ? entries?.[Number(key.slice(8))] : null;
      return !e ? {} : e.entered ? { entered: e.entered } : { enteredBefore: true, tracedTo: e.before };
    };
    const decorate = (x, own = true) => x.role === "schema" ? { ...x, callCount: callCount(x) } : own ? { ...x, ...stampOf(x.key) } : x;
    const order = (list, own) => arrange(list.map((x) => decorate(x, own)), args.sort, args.schemaSort);
    let arrivals = null;
    if (!diff.available && entries && selected.summary.step != null) {
      const base = args.baselineKey ? all.find((x) => x.key === args.baselineKey) : this.previous(all, selected);
      const since = base && base.path === selected.path && base.segment === selected.segment && base.summary.step != null && all.indexOf(base) < all.indexOf(selected) ? base.summary.step : null;
      if (since != null) {
        const stamped = elements.filter((x) => x.key.startsWith("message:")).map((x) => ({ item: x, entry: entries[Number(x.key.slice(8))] })).filter((x) => x.entry);
        const list = stamped.filter((x) => x.entry.entered && x.entry.entered.step > since).map((x) => elementSummary(x.item));
        arrivals = {
          available: true,
          sinceStep: since,
          count: list.length,
          keys: list.map((x) => x.key),
          groups: groupByRole(order(list, true)),
          unknownCount: stamped.filter((x) => !x.entry.entered && x.entry.before && x.entry.before.step > since).length
        };
      }
    }
    if (diff.available) diff = {
      ...diff,
      addedCount: diff.added.length,
      removedCount: diff.removed.length,
      changedCount: diff.changed.length,
      addedKeys: diff.added.slice(0, 2e3).map((x) => x.key),
      changedPairs: diff.changed.map((x) => ({ before: x.before.key, after: x.after.key })),
      addedGroups: groupByRole(order(diff.added, true)),
      removedGroups: groupByRole(order(diff.removed, false)),
      added: diff.added.slice((args.changePage ?? 0) * 40, (args.changePage ?? 0) * 40 + 40),
      removed: diff.removed.slice((args.changePage ?? 0) * 40, (args.changePage ?? 0) * 40 + 40),
      changed: diff.changed.slice((args.changePage ?? 0) * 40, (args.changePage ?? 0) * 40 + 40)
    };
    const search = (args.search ?? "").toLowerCase(), role = args.role;
    const loadedSearch = args.searchScope === "loaded" && Boolean(search);
    const filtered = [];
    for (const snapshot of loadedSearch ? all : [selected]) {
      for (const item of snapshot === selected ? elements : inputElements(snapshot.record)) {
        if (role && item.role !== role) continue;
        if (search && ![item.readable, item.toolName, item.toolCallId, item.key].some((v) => String(v ?? "").toLowerCase().includes(search))) continue;
        filtered.push({ ...decorate(elementSummary(item), snapshot === selected), ...loadedSearch ? { snapshotKey: snapshot.key, snapshotTime: snapshot.record.startedAt } : {} });
      }
    }
    const ordered = arrange(filtered, args.sort, loadedSearch ? null : args.schemaSort);
    const schemas = elements.filter((x) => x.role === "schema").map((x) => decorate(elementSummary(x))), unused = schemas.filter((x) => x.callCount === 0);
    const schemaCalls = record.tools === null ? { available: false, reason: "not_recorded" } : !calls.available ? { available: false, reason: calls.code ?? "tool_usage_unavailable" } : { available: true, scope: "session", schemaCount: schemas.length, unusedCount: unused.length, unusedEstimatedTokens: unused.reduce((n, x) => n + x.estimatedTokens, 0), unknownCount: schemas.filter((x) => x.callCount == null).length };
    const element = args.elementKey ? elements.find((x) => x.key === args.elementKey) : null;
    if (args.elementKey && !element) throw new ContextError("element_missing", "Element unavailable.");
    let content = null;
    if (element) {
      const text = args.format === "raw" ? element.text : element.readable, offset = args.offset ?? 0;
      const hits = [];
      let matchCount = 0;
      const query = (args.bodySearch ?? "").toLowerCase();
      if (query) {
        const haystack = text.toLowerCase();
        let cursor = 0;
        while ((cursor = haystack.indexOf(query, cursor)) !== -1) {
          matchCount++;
          if (hits.length < 100) hits.push(cursor);
          cursor += query.length;
        }
      }
      content = {
        ...decorate(elementSummary(element)),
        offset,
        totalChars: text.length,
        lineCount: text.split("\n").length,
        text: text.slice(offset, offset + 12e3),
        hasMore: offset + 12e3 < text.length,
        format: args.format ?? "readable",
        tool: toolEvidence(record, element),
        hits,
        matchCount
      };
    }
    let bodyDiff = null;
    if (args.diffBeforeElement && element && diff.available) {
      const previous = all.find((x) => x.key === diff.previousKey);
      const original = inputElements(previous.record).find((x) => x.key === args.diffBeforeElement);
      const full = diffRecords(previous.record, record);
      if (!original || !full.changed.some((x) => x.before.key === original.key && x.after.key === element.key)) throw new ContextError("diff_identity_unavailable", "No recorded identity for this replacement.");
      const unified = textDifference(original.readable, element.readable).map((x) => (x.kind === "added" ? "+ " : x.kind === "removed" ? "- " : "  ") + x.text).join("\n");
      const offset = args.offset ?? 0;
      bodyDiff = {
        text: unified.slice(offset, offset + 12e3),
        offset,
        totalChars: unified.length,
        hasMore: offset + 12e3 < unified.length,
        beforeKey: previous.key,
        afterKey: selected.key,
        method: "common_prefix_suffix_block"
      };
    }
    return {
      sessionId,
      revision: state.overview.revision,
      summary: selected.summary,
      composition: selected.summary.composition,
      diff,
      arrivals,
      baselineOptions: all.filter((x) => x.path === selected.path && x.record.querySource === record.querySource && all.indexOf(x) < all.indexOf(selected)).slice(-60).map((x) => ({ key: x.key, startedAt: x.record.startedAt, turnId: x.record.turnId, complete: x.record.messages.complete })),
      elementCount: elements.length,
      filteredCount: filtered.length,
      page,
      searchScope: args.searchScope === "loaded" && search ? "all_loaded_snapshots" : "all_elements_in_selected_loaded_snapshot",
      loadedSnapshotCount: all.length,
      largest: filtered.length ? filtered.reduce((largest, x) => x.chars > largest.chars ? x : largest) : null,
      groups: loadedSearch ? null : groupByRole(ordered),
      schemaCalls,
      elements: ordered.slice(page * pageSize, (page + 1) * pageSize),
      content,
      bodyDiff
    };
  }
};

// src/data/runner.mjs
function serialRunner(run, reply) {
  let queue = Promise.resolve();
  const waiting = /* @__PURE__ */ new Set(), cancelled = /* @__PURE__ */ new Set();
  return (input) => {
    if (input?.cancel !== void 0) {
      if (waiting.delete(input.cancel)) {
        cancelled.add(input.cancel);
        reply({ id: input.cancel, skipped: true });
      }
      return;
    }
    waiting.add(input.id);
    queue = queue.then(async () => {
      if (cancelled.delete(input.id)) return;
      waiting.delete(input.id);
      try {
        reply({ id: input.id, result: await run(input) });
      } catch (error) {
        reply({ id: input.id, error: { code: error.code ?? "read_failed", message: "Context data could not be read." } });
      }
    });
  };
}

// src/worker.mjs
var service = new ContextDataService(workerData.paths);
parentPort.on("message", serialRunner(
  (input) => input.method === "overview" ? service.overview(input.sessionId, input.args.revision, input.args.historyPage) : service.request(input.sessionId, input.args),
  (message) => parentPort.postMessage(message)
));
