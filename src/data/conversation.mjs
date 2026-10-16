import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { ContextError } from "../domain/session.mjs";
import { classifyDbError } from "./sqlite.mjs";
import { SUMMARY_KEYS } from "../domain/trajectory.mjs";
const TEXT_CHARS = 4000;
// Token estimates of large outputs scale the script mix of a short sample to the full length.
const SAMPLE_CHARS = 400;
const DETAIL_ROWS = 400;
const VERIFY_CHARS = 2 * 1024 * 1024;
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
    return { db, sequence: message.has("sequence") ? "sequence" : "NULL", revert: columns("session").has("revert") };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.close();
    throw error;
  }
}
// Fields are read with json_extract so the large tool outputs inside part data never cross into JavaScript.
const field = path => "CASE WHEN ok THEN json_extract(data,'" + path + "') END";
const MESSAGE_FIELDS = ["role:$.role", "origin:$.semantics.origin", "kind:$.semantics.kind", "source:$.semantics.source",
  "visibility:$.semantics.providerVisibility", "synthetic:$.synthetic", "metaSource:$.metadata.source"];
const PART_FIELDS = ["type:$.type", "tool:$.tool", "callId:$.callID", "skill:$.state.input.skill", "toolEnd:$.state.time.end",
  "synthetic:$.synthetic", "textSource:$.metadata.source", "timelineType:$.timelineType"];
// Only injected text is kept, so ordinary replies and prompts never cross into JavaScript.
const INJECTED_TEXT = "ok AND json_extract(data,'$.type')='text' AND json_extract(data,'$.synthetic')=1";
const select = fields => fields.map(x => { const [name, path] = x.split(":"); return field(path) + " AS " + name; }).join(",");

// The session's conversation store: message semantics, compaction and timeline parts, Skill loads and injected text.
// Rows are read incrementally by time_updated. Every message and part id is known, so after each change the counts tell
// whether rows were deleted (ZCode removes the messages of a compaction whose persistence failed, possibly offset by new
// rows in the same poll) or arrived below the cursor (a restored or backfilled database). Deletions are dropped; rows
// never seen, or a cursor that went backwards, reload everything.
// A rewind deletes nothing: the abandoned branch stays in the store and session.revert records the active one.
const fresh = () => ({ messageCursor: -1, partCursor: -1, messageCount: 0, partCount: 0, messages: new Map(), parts: new Map(), partIds: new Set() });
// Injected text longer than the read bound is identified by its length and digest; the full text is read one part at a
// time and only up to VERIFY_CHARS, beyond which it cannot be located and shows as recorded.
const fingerprint = text => { const value = text.trim(); return { prefix: value.slice(0, 1000), chars: value.length, hash: createHash("sha256").update(value).digest("hex") }; };
export function readConversation(dbPath, sessionId, cache = null) {
  let handle;
  try {
    handle = open(dbPath);
    const { db, sequence, revert } = handle;
    // A rewind only rewrites session.revert, so the branch is reported on its own: what a compaction summarized depends on it.
    const rawRevert = revert ? db.prepare("SELECT revert FROM session WHERE id=?").get(sessionId)?.revert : null;
    const branch = rawRevert == null ? null : createHash("sha256").update(String(rawRevert)).digest("hex").slice(0, 16);
    const stat = table => db.prepare("SELECT count(*) AS n, max(time_updated) AS u FROM " + table + " WHERE session_id=?").get(sessionId);
    const messageStat = stat("message"), partStat = stat("part");
    let c = cache?.partIds && (messageStat.u ?? -1) >= cache.messageCursor && (partStat.u ?? -1) >= cache.partCursor ? cache : fresh();
    if (c.messageCursor === (messageStat.u ?? -1) && c.partCursor === (partStat.u ?? -1) && c.messageCount === messageStat.n && c.partCount === partStat.n) {
      db.exec("COMMIT");
      return { available: true, changed: false, cache: c, branch };
    }
    const messages = db.prepare("SELECT id," + sequence + " AS sequence,time_created AS created,time_updated AS updated," + select(MESSAGE_FIELDS) +
      ",CASE WHEN ok THEN substr(json_extract(data,'$.summary.body'),1," + TEXT_CHARS + ") END AS summary" +
      " FROM (SELECT *,json_valid(data) AS ok FROM message WHERE session_id=? AND time_updated>=?)");
    const parts = db.prepare("SELECT id,message_id AS messageId,time_created AS created,time_updated AS updated," + select(PART_FIELDS) +
      ",CASE WHEN " + INJECTED_TEXT + " THEN substr(json_extract(data,'$.text'),1," + TEXT_CHARS + ") END AS text" +
      ",CASE WHEN " + INJECTED_TEXT + " THEN length(json_extract(data,'$.text')) END AS textChars" +
      ",CASE WHEN ok AND json_extract(data,'$.tool')='Skill' THEN length(json_extract(data,'$.state.output')) END AS outputChars" +
      ",CASE WHEN ok AND json_extract(data,'$.tool')='Skill' THEN substr(json_extract(data,'$.state.output'),1," + SAMPLE_CHARS + ") END AS outputSample" +
      ",CASE WHEN ok AND json_extract(data,'$.type') IN ('compaction','timeline') THEN data END AS raw" +
      " FROM (SELECT *,json_valid(data) AS ok FROM part WHERE session_id=? AND time_updated>=?)");
    const fullText = db.prepare("SELECT json_extract(data,'$.text') AS text FROM part WHERE session_id=? AND id=?");
    const ingest = c => {
      for (const row of messages.all(sessionId, c.messageCursor)) c.messages.set(row.id, row);
      // Only the parts events are built from are kept; every other part is reread only when it changes.
      for (const row of parts.all(sessionId, c.partCursor)) {
        c.partIds.add(row.id);
        const keep = row.type === "compaction" || row.type === "timeline" || (row.type === "tool" && row.tool === "Skill") || (row.type === "text" && row.synthetic === 1);
        if (!keep) { c.parts.delete(row.id); continue; }
        // SQLite counts code points, so truncation is decided here rather than by comparing JavaScript lengths.
        row.truncated = row.type === "text" && row.textChars > TEXT_CHARS;
        if (row.truncated)
          row.verify = row.textChars <= VERIFY_CHARS ? fingerprint(String(fullText.get(sessionId, row.id)?.text ?? "")) : null;
        c.parts.set(row.id, row);
      }
    };
    ingest(c);
    if (c.messages.size !== messageStat.n || c.partIds.size !== partStat.n) {
      const ids = table => new Set(db.prepare("SELECT id FROM " + table + " WHERE session_id=?").all(sessionId).map(row => row.id));
      const liveMessages = ids("message"), liveParts = ids("part");
      if ([...liveMessages].some(id => !c.messages.has(id)) || [...liveParts].some(id => !c.partIds.has(id))) { c = fresh(); ingest(c); }
      else {
        for (const id of [...c.messages.keys()]) if (!liveMessages.has(id)) c.messages.delete(id);
        for (const id of [...c.partIds]) if (!liveParts.has(id)) { c.partIds.delete(id); c.parts.delete(id); }
      }
    }
    db.exec("COMMIT");
    Object.assign(c, { messageCursor: messageStat.u ?? -1, partCursor: partStat.u ?? -1, messageCount: messageStat.n, partCount: partStat.n });
    return { available: true, changed: true, cache: c, branch };
  } catch (error) {
    if (handle) { try { handle.db.exec("ROLLBACK"); } catch {} }
    return { available: false, code: classifyDbError(error), cache };
  } finally { handle?.db.close(); }
}

// Sequences of the active conversation branch, or null when no rewind narrowed it. Follows ZCode's
// selectActiveConversationBranch: the kept prefix plus everything after the cut (or from the created message).
function activeSequences(db, sessionId) {
  if (!new Set(db.prepare("PRAGMA table_info(session)").all().map(row => row.name)).has("revert")) return null;
  const raw = db.prepare("SELECT revert FROM session WHERE id=?").get(sessionId)?.revert;
  let revert = null;
  try { revert = raw == null ? null : JSON.parse(raw); } catch { throw new ContextError("branch_unknown", "The rewind state is unreadable."); }
  if (!revert?.targetMessageID) return null;
  const rows = db.prepare("SELECT id,sequence FROM message WHERE session_id=? ORDER BY sequence").all(sessionId);
  const index = id => rows.findIndex(row => row.id === id), target = index(revert.targetMessageID);
  const keptIds = Array.isArray(revert.keptMessageIDs) ? new Set(revert.keptMessageIDs) : null;
  if (!keptIds && target < 0) return null;
  const kept = keptIds ? rows.filter(row => keptIds.has(row.id)) : rows.slice(0, target);
  const cut = revert.branchCutAfterMessageID ? index(revert.branchCutAfterMessageID) : -1, created = revert.createdMessageID ? index(revert.createdMessageID) : -1;
  const from = revert.branchCutAfterMessageID ? (cut < 0 ? rows.length : cut + 1) : created < 0 ? rows.length : created;
  return new Set([...kept, ...rows.slice(from)].map(row => row.sequence));
}

// The messages one compaction summarized: after the newest earlier summary still on the active branch, through its
// last summarized message. `after` lists earlier compaction summary sequences, newest first.
export function readSummarizedMessages(dbPath, sessionId, { after = [], through, summary = null }) {
  let handle;
  try {
    handle = open(dbPath);
    const { db, sequence } = handle;
    if (sequence === "NULL") throw new ContextError("schema_unsupported", "Messages have no sequence.");
    const active = activeSequences(db, sessionId), live = value => !active || active.has(value);
    if (!live(through) || (summary != null && !live(summary))) throw new ContextError("rewound_branch", "This compaction is on a rewound branch.");
    const ids = db.prepare("SELECT id,sequence FROM message WHERE session_id=? AND sequence>? AND sequence<=? ORDER BY sequence")
      .all(sessionId, after.find(live) ?? -1, through).filter(row => live(row.sequence));
    const message = db.prepare("SELECT id,sequence," + select(MESSAGE_FIELDS) + " FROM (SELECT *,json_valid(data) AS ok FROM message WHERE session_id=? AND id=?)");
    const parts = db.prepare("SELECT id,message_id AS messageId,time_created AS created," + select(PART_FIELDS) +
      ",CASE WHEN ok THEN substr(json_extract(data,'$.text'),1,400) END AS text,CASE WHEN ok THEN length(json_extract(data,'$.text')) END AS textChars" +
      ",CASE WHEN ok THEN length(json_extract(data,'$.state.input')) END AS inputChars,CASE WHEN ok THEN substr(json_extract(data,'$.state.input'),1," + SAMPLE_CHARS + ") END AS inputSample" +
      "," + SUMMARY_KEYS.map(key => "CASE WHEN ok AND json_type(data,'$.state.input." + key + "')='text' THEN substr(json_extract(data,'$.state.input." + key + "'),1,160) END AS in_" + key).join(",") +
      ",CASE WHEN ok THEN length(json_extract(data,'$.state.output')) END AS outputChars" +
      ",CASE WHEN ok THEN substr(json_extract(data,'$.state.output'),1," + SAMPLE_CHARS + ") END AS outputSample" +
      " FROM (SELECT *,json_valid(data) AS ok FROM part WHERE session_id=? AND message_id=?) ORDER BY created,id");
    // Tool inputs (a Write's whole file, say) cross into JavaScript only as the fields a title uses and a bounded sample.
    const bounded = part => {
      const inputFields = {};
      for (const key of SUMMARY_KEYS) { if (part["in_" + key] != null) inputFields[key] = part["in_" + key]; delete part["in_" + key]; }
      return { ...part, inputFields };
    };
    const rows = ids.slice(0, DETAIL_ROWS).map(row => ({ ...message.get(sessionId, row.id), parts: parts.all(sessionId, row.id).map(bounded) }));
    db.exec("COMMIT");
    return { available: true, messages: rows, total: ids.length };
  } catch (error) {
    if (handle) { try { handle.db.exec("ROLLBACK"); } catch {} }
    return { available: false, code: classifyDbError(error), messages: [], total: 0 };
  } finally { handle?.db.close(); }
}
