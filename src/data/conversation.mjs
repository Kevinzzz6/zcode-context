import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { ContextError } from "../domain/session.mjs";
const TEXT_CHARS = 4000;
const DETAIL_ROWS = 400;
const REQUIRED = ["id", "session_id", "time_created", "time_updated", "data"];
function open(dbPath) {
  if (!statSync(dbPath).isFile()) throw new ContextError("database_missing", "Session database is not a regular file.");
  // Do not use SqliteSessionStore: its constructor owns migrations and may write.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100; BEGIN");
    const columns = table => new Set(db.prepare("PRAGMA table_info(" + table + ")").all().map(row => row.name));
    const message = columns("message"), part = columns("part");
    if (!REQUIRED.every(key => message.has(key)) || !REQUIRED.every(key => part.has(key)) || !part.has("message_id"))
      throw new ContextError("schema_unsupported", "This database does not have the supported message/part schema.");
    return { db, sequence: message.has("sequence") ? "sequence" : "NULL" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.close();
    throw error;
  }
}
const failure = error => error.code === "ENOENT" ? "database_missing" : error.code === "SQLITE_BUSY" || /locked|busy/i.test(error.message) ? "database_busy"
  : error instanceof ContextError ? error.code : "database_unavailable";
// Fields are read with json_extract so the large tool outputs inside part data never cross into JavaScript.
const field = path => "CASE WHEN ok THEN json_extract(data,'" + path + "') END";
const MESSAGE_FIELDS = ["role:$.role", "origin:$.semantics.origin", "kind:$.semantics.kind", "source:$.semantics.source",
  "visibility:$.semantics.providerVisibility", "synthetic:$.synthetic", "metaSource:$.metadata.source"];
const PART_FIELDS = ["type:$.type", "tool:$.tool", "callId:$.callID", "skill:$.state.input.skill", "toolEnd:$.state.time.end",
  "synthetic:$.synthetic", "textSource:$.metadata.source", "timelineType:$.timelineType"];
const select = fields => fields.map(x => { const [name, path] = x.split(":"); return field(path) + " AS " + name; }).join(",");

// The session's conversation store: message semantics, compaction and timeline parts, Skill loads and injected text.
// Rows are read incrementally by time_updated; a shrinking row count (rewind, deletion) reloads everything.
export function readConversation(dbPath, sessionId, cache = null) {
  let handle;
  try {
    handle = open(dbPath);
    const { db, sequence } = handle;
    const stat = table => db.prepare("SELECT count(*) AS n, max(time_updated) AS u FROM " + table + " WHERE session_id=?").get(sessionId);
    const messageStat = stat("message"), partStat = stat("part");
    let c = cache;
    if (!c || messageStat.n < c.messageCount || partStat.n < c.partCount)
      c = { messageCursor: -1, partCursor: -1, messageCount: 0, partCount: 0, messages: new Map(), parts: new Map() };
    if (c.messageCursor === (messageStat.u ?? -1) && c.partCursor === (partStat.u ?? -1) && c.messageCount === messageStat.n && c.partCount === partStat.n) {
      db.exec("COMMIT");
      return { available: true, changed: false, cache: c };
    }
    const messages = db.prepare("SELECT id," + sequence + " AS sequence,time_created AS created,time_updated AS updated," + select(MESSAGE_FIELDS) +
      ",CASE WHEN ok THEN substr(json_extract(data,'$.summary.body'),1," + TEXT_CHARS + ") END AS summary" +
      " FROM (SELECT *,json_valid(data) AS ok FROM message WHERE session_id=? AND time_updated>=?)").all(sessionId, c.messageCursor);
    for (const row of messages) c.messages.set(row.id, row);
    const parts = db.prepare("SELECT id,message_id AS messageId,time_created AS created,time_updated AS updated," + select(PART_FIELDS) +
      ",CASE WHEN ok AND json_extract(data,'$.type')='text' THEN substr(json_extract(data,'$.text'),1," + TEXT_CHARS + ") END AS text" +
      ",CASE WHEN ok AND json_extract(data,'$.type')='text' THEN length(json_extract(data,'$.text')) END AS textChars" +
      ",CASE WHEN ok AND json_extract(data,'$.tool')='Skill' THEN length(json_extract(data,'$.state.output')) END AS outputChars" +
      ",CASE WHEN ok AND json_extract(data,'$.type') IN ('compaction','timeline') THEN data END AS raw" +
      " FROM (SELECT *,json_valid(data) AS ok FROM part WHERE session_id=? AND time_updated>=?)").all(sessionId, c.partCursor);
    // Only the parts events are built from are kept; every other part is reread only when it changes.
    for (const row of parts) {
      const keep = row.type === "compaction" || row.type === "timeline" || (row.type === "tool" && row.tool === "Skill") || (row.type === "text" && row.synthetic === 1);
      if (keep) c.parts.set(row.id, row); else c.parts.delete(row.id);
    }
    db.exec("COMMIT");
    Object.assign(c, { messageCursor: messageStat.u ?? -1, partCursor: partStat.u ?? -1, messageCount: messageStat.n, partCount: partStat.n });
    return { available: true, changed: true, cache: c };
  } catch (error) {
    if (handle) { try { handle.db.exec("ROLLBACK"); } catch {} }
    return { available: false, code: failure(error), cache };
  } finally { handle?.db.close(); }
}

// The messages one compaction summarized, between two message sequences, with their parts reduced to titles and sizes.
export function readSummarizedMessages(dbPath, sessionId, after, through) {
  let handle;
  try {
    handle = open(dbPath);
    const { db, sequence } = handle;
    if (sequence === "NULL") throw new ContextError("schema_unsupported", "Messages have no sequence.");
    const messages = db.prepare("SELECT id,sequence," + select(MESSAGE_FIELDS) + " FROM (SELECT *,json_valid(data) AS ok FROM message" +
      " WHERE session_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT " + (DETAIL_ROWS + 1) + ")").all(sessionId, after, through);
    const total = db.prepare("SELECT count(*) AS n FROM message WHERE session_id=? AND sequence>? AND sequence<=?").get(sessionId, after, through).n;
    const parts = db.prepare("SELECT message_id AS messageId,time_created AS created," + select(PART_FIELDS) +
      ",CASE WHEN ok THEN substr(json_extract(data,'$.text'),1,400) END AS text,CASE WHEN ok THEN length(json_extract(data,'$.text')) END AS textChars" +
      ",CASE WHEN ok THEN json_extract(data,'$.state.input') END AS input,CASE WHEN ok THEN length(json_extract(data,'$.state.output')) END AS outputChars" +
      " FROM (SELECT *,json_valid(data) AS ok FROM part WHERE session_id=? AND message_id=?) ORDER BY created");
    const rows = messages.slice(0, DETAIL_ROWS).map(m => ({ ...m, parts: parts.all(sessionId, m.id) }));
    db.exec("COMMIT");
    return { available: true, messages: rows, total: Number(total) };
  } catch (error) {
    if (handle) { try { handle.db.exec("ROLLBACK"); } catch {} }
    return { available: false, code: failure(error), messages: [], total: 0 };
  } finally { handle?.db.close(); }
}
