import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { ContextError } from "../domain/session.mjs";
import { normalizeFact, normalizedInput } from "../domain/usage.mjs";
import { nonnegative } from "../domain/session.mjs";
const FIELDS = ["id", "logical_request_id", "session_id", "turn_id", "trace_id", "query_source", "provider_id", "model_id",
  "status", "started_at", "duration_ms", "time_to_first_token_ms", "input_tokens", "output_tokens", "reasoning_tokens",
  "cache_creation_input_tokens", "cache_read_input_tokens", "provider_total_tokens", "computed_total_tokens", "retry_count", "raw_usage_json"];
// Busy and other open or I/O failures (a backup holding the file, say) are transient; a missing file or an
// unsupported schema is not.
export const classifyDbError = error => error.code === "ENOENT" ? "database_missing"
  : error.code === "SQLITE_BUSY" || /locked|busy/i.test(error.message) ? "database_busy"
  : error instanceof ContextError ? error.code : "database_unavailable";
export function readUsage(dbPath, sessionId, now = Date.now()) {
  let db;
  try {
    if (!statSync(dbPath).isFile()) throw new ContextError("database_missing", "Session database is not a regular file.");
    // Do not use SqliteSessionStore: its constructor owns migrations and may write.
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN");
    const columns = new Set(db.prepare("PRAGMA table_info(model_usage)").all().map(row => row.name));
    if (!["id", "session_id", "started_at", "input_tokens", "output_tokens"].every(key => columns.has(key))) {
      throw new ContextError("schema_unsupported", "This database does not have the supported model_usage schema.");
    }
    const expression = key => columns.has(key) ? key : "NULL";
    const selection = FIELDS.map(key => expression(key) + " AS " + key).join(",");
    const raw = expression("raw_usage_json");
    const knownFor = (column, key) => "(coalesce(" + expression(column) + ",0)>0 OR CASE WHEN json_valid(" + raw + ") THEN " +
      "json_type(" + raw + ",'$." + key + "') IN ('integer','real') AND json_extract(" + raw + ",'$." + key + "')>=0 ELSE 0 END)";
    const inputKnown = knownFor("input_tokens","inputTokens");
    const outputKnown = knownFor("output_tokens","outputTokens");
    const readKnown = knownFor("cache_read_input_tokens","cacheReadTokens");
    const writeKnown = knownFor("cache_creation_input_tokens","cacheWriteTokens");
    const rawTotalKnown = "(CASE WHEN json_valid(" + raw + ") THEN json_type(" + raw + ",'$.totalTokens') IN ('integer','real') AND json_extract(" + raw + ",'$.totalTokens')>=0 ELSE 0 END)";
    const providerKnown = "(" + expression("provider_total_tokens") + " IS NOT NULL OR " + rawTotalKnown + ")";
    const totalKnown = "((" + inputKnown + " AND " + outputKnown + ") OR " + providerKnown + ")";
    const known = "(" + [inputKnown,outputKnown,readKnown,writeKnown,totalKnown].join(" OR ") + ")";
    const cache = "(coalesce(" + expression("cache_read_input_tokens") + ",0)+coalesce(" + expression("cache_creation_input_tokens") + ",0))";
    const storedTotal = "coalesce(" + expression("provider_total_tokens") + "," + expression("computed_total_tokens") + ",0)";
    const inputSide = "CASE WHEN coalesce(input_tokens,0)<=0 THEN " + cache + " WHEN " + cache + "<=0 THEN input_tokens" +
      " WHEN " + storedTotal + ">0 AND abs(" + storedTotal + "-(input_tokens+" + cache + "+coalesce(output_tokens,0)))<abs(" + storedTotal + "-(input_tokens+coalesce(output_tokens,0))) THEN input_tokens+" + cache + " ELSE input_tokens END";
    const total = "CASE WHEN " + inputKnown + " AND " + outputKnown +
      " THEN coalesce(" + expression("computed_total_tokens") + ",(" + inputSide + ")+coalesce(output_tokens,0)) ELSE coalesce(" +
      expression("provider_total_tokens") + ",CASE WHEN json_valid(" + raw + ") THEN json_extract(" + raw + ",'$.totalTokens') ELSE NULL END) END";
    const totalsSql = "count(*) AS requestCount, sum(CASE WHEN " + known + " THEN 1 ELSE 0 END) AS reportedCount," +
      "sum(CASE WHEN " + inputKnown + " THEN 1 ELSE 0 END) AS inputReportedCount," +
      "sum(CASE WHEN " + outputKnown + " THEN 1 ELSE 0 END) AS outputReportedCount," +
      "sum(CASE WHEN " + totalKnown + " THEN 1 ELSE 0 END) AS totalReportedCount," +
      "sum(CASE WHEN " + inputKnown + " THEN (" + inputSide + ") ELSE 0 END) AS inputTokens," +
      "sum(CASE WHEN " + outputKnown + " THEN output_tokens ELSE 0 END) AS outputTokens," +
      "sum(CASE WHEN " + totalKnown + " THEN (" + total + ") ELSE 0 END) AS totalTokens," +
      "sum(CASE WHEN " + inputKnown + " AND " + readKnown + " THEN coalesce(" + expression("cache_read_input_tokens") + ",0) ELSE 0 END) AS cacheReadTokens," +
      "sum(CASE WHEN " + inputKnown + " AND " + readKnown + " THEN (" + inputSide + ") ELSE 0 END) AS cacheInputTokens," +
      "sum(CASE WHEN " + expression("status") + "='error' THEN 1 ELSE 0 END) AS errorCount," +
      "sum(coalesce(" + expression("retry_count") + ",0)) AS retryCount";
    const since = now - 30 * 24 * 60 * 60 * 1000;
    const aggregate = db.prepare("SELECT " + totalsSql + " FROM model_usage WHERE session_id=? AND started_at>=?").get(sessionId, since);
    const facts = db.prepare("SELECT " + selection + " FROM model_usage WHERE session_id=? AND started_at>=? ORDER BY started_at DESC,id DESC LIMIT 80")
      .all(sessionId, since).map(normalizeFact).reverse();
    const days = db.prepare("SELECT CAST(started_at / 86400000 AS INTEGER) AS utcDay," + totalsSql +
      " FROM model_usage WHERE session_id=? AND started_at>=? GROUP BY utcDay ORDER BY utcDay").all(sessionId, since);
    db.exec("COMMIT");
    const normalize = row => {
      const requestCount = Number(row.requestCount ?? 0); const reportedCount = Number(row.reportedCount ?? 0);
      const inputTokens = Number(row.inputTokens ?? 0);
      return { requestCount, reportedCount, missingUsageCount: requestCount - reportedCount,
        inputMissingCount: requestCount - Number(row.inputReportedCount ?? 0),
        outputMissingCount: requestCount - Number(row.outputReportedCount ?? 0),
        totalMissingCount: requestCount - Number(row.totalReportedCount ?? 0),
        inputTokens: Number(row.inputReportedCount ?? 0) ? inputTokens : null,
        outputTokens: Number(row.outputReportedCount ?? 0) ? Number(row.outputTokens ?? 0) : null,
        totalTokens: Number(row.totalReportedCount ?? 0) ? Number(row.totalTokens ?? 0) : null,
        cacheHitRate: Number(row.cacheInputTokens ?? 0) > 0 ? Number(row.cacheReadTokens ?? 0) / Number(row.cacheInputTokens) : null,
        errorCount: Number(row.errorCount ?? 0), retryCount: Number(row.retryCount ?? 0) };
    };
    return { available: true, totals: normalize(aggregate), facts, days: days.map(row => ({ utcDay: row.utcDay, ...normalize(row) })),
      windowDays: 30, timelineLimited: Number(aggregate.requestCount ?? 0) > facts.length };
  } catch (error) {
    if (db) { try { db.exec("ROLLBACK"); } catch {} }
    const code = classifyDbError(error);
    return { available: false, code, facts: [], days: [], totals: null, windowDays: 30 };
  } finally { db?.close(); }
}
// Session-wide calls per tool name. A missing table or column leaves counts unknown rather than zero.
export function readToolCalls(dbPath, sessionId) {
  let db;
  try {
    if (!statSync(dbPath).isFile()) throw new ContextError("database_missing", "Session database is not a regular file.");
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN");
    const columns = new Set(db.prepare("PRAGMA table_info(tool_usage)").all().map(row => row.name));
    if (!["session_id", "tool_name"].every(key => columns.has(key))) {
      throw new ContextError("schema_unsupported", "This database does not have the supported tool_usage schema.");
    }
    const errors = columns.has("status") ? "sum(CASE WHEN status='error' THEN 1 ELSE 0 END)" : "NULL";
    const fetched = db.prepare("SELECT tool_name AS name, count(*) AS count, " + errors + " AS errorCount FROM tool_usage" +
      " WHERE session_id=? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC, tool_name LIMIT 501").all(sessionId), rows = fetched.slice(0, 500);
    db.exec("COMMIT");
    const byName = Object.create(null);
    for (const row of rows) byName[String(row.name).slice(0, 160)] = { count: Number(row.count), errorCount: row.errorCount == null ? null : Number(row.errorCount) };
    return { available: true, scope: "session", byName, callCount: rows.reduce((n, row) => n + Number(row.count), 0), truncated: fetched.length > 500 };
  } catch (error) {
    if (db) { try { db.exec("ROLLBACK"); } catch {} }
    const code = classifyDbError(error);
    return { available: false, code, byName: {} };
  } finally { db?.close(); }
}
// Completed requests of a session, oldest first, each with the assistant message it produced (null when not linked), for
// measured sizes (ledger.mjs). Unlinked rows still mark where a request happened. The newest rows are kept when a session
// has more than the bound. A summary of the rows is the key: when it equals `key`, the rows are not read again.
export function readRequestUsage(dbPath, sessionId, { key = null, limit = 20000 } = {}) {
  let db;
  try {
    if (!statSync(dbPath).isFile()) throw new ContextError("database_missing", "Session database is not a regular file.");
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN");
    const columns = new Set(db.prepare("PRAGMA table_info(model_usage)").all().map(row => row.name));
    if (!["session_id", "started_at", "status", "input_tokens", "output_tokens", "assistant_message_id"].every(key => columns.has(key)))
      throw new ContextError("schema_unsupported", "This database does not link usage to assistant messages.");
    const scope = " FROM model_usage WHERE session_id=? AND status='completed'";
    const summary = db.prepare("SELECT count(*) AS n, max(started_at) AS last, total(input_tokens) AS input, total(output_tokens) AS output," +
      " count(assistant_message_id) AS linked" + scope).get(sessionId);
    const current = [summary.n, summary.last, summary.input, summary.output, summary.linked].join(":");
    if (current === key) { db.exec("COMMIT"); return { available: true, key: current, unchanged: true, rows: null }; }
    const expression = column => (columns.has(column) ? column : "NULL") + " AS " + column;
    const rows = db.prepare("SELECT assistant_message_id AS message, started_at AS startedAt, " +
      ["query_source", "model_id", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
        "provider_total_tokens", "computed_total_tokens"].map(expression).join(",") + scope +
      " ORDER BY started_at DESC," + (columns.has("attempt_index") ? "attempt_index DESC," : "") + "rowid DESC LIMIT ?").all(sessionId, limit);
    db.exec("COMMIT");
    return { available: true, key: current, unchanged: false, rows: rows.reverse().map(row => ({ message: row.message == null ? null : String(row.message),
      startedAt: Number(row.startedAt), source: row.query_source ?? "unknown", model: row.model_id ?? null,
      input: normalizedInput(row), output: nonnegative(row.output_tokens) })) };
  } catch (error) {
    if (db) { try { db.exec("ROLLBACK"); } catch {} }
    return { available: false, code: classifyDbError(error), rows: null };
  } finally { db?.close(); }
}
