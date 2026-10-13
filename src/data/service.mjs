import { join } from "node:path";
import { createHash } from "node:crypto";
import { readUsage } from "./sqlite.mjs";
import { JsonlTail } from "./jsonl.mjs";
import { sanitizeSessionSegment, ContextError, isAgentSource } from "../domain/session.mjs";
import { foldRecord, inputElements, composition, diffRecords, trajectorySummary, canonical, elementSummary, toolEvidence, textDifference } from "../domain/trajectory.mjs";
import { compactEvent } from "../domain/events.mjs";
const digest = value => createHash("sha256").update(value).digest("hex").slice(0,24);
const MAX_CACHE_CHARS = 32 * 1024 * 1024;
export class ContextDataService {
  constructor(paths) { this.paths = paths; this.sessions = new Map(); }
  state(sessionId) {
    let state = this.sessions.get(sessionId);
    if (!state) {
      if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value);
      state = { ledgers: new Map(), events: new Map(), logTails: new Map(), overview: null };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
  async refresh(sessionId) {
    const state = this.state(sessionId); const coverage = [];
    for (const directory of this.paths.trajectoryDirs) {
      const path = join(directory, "model-io-" + sanitizeSessionSegment(sessionId) + ".jsonl");
      let ledger = state.ledgers.get(path);
      if (!ledger) { ledger = { tail: new JsonlTail(), previous: null, records: new Map(), chars: 0, segment: 0 }; state.ledgers.set(path, ledger); }
      const status = await ledger.tail.scan(path, (raw, offset) => {
        if (raw.type !== "model_io" || raw.sessionId !== sessionId) { ledger.previous = null; ledger.segment++; return; }
        if (raw.modelIOReset) { ledger.previous = null; ledger.segment++; ledger.tail.markCoverage("history_reset"); }
        const record = foldRecord(raw, ledger.previous);
        if (record.oversized) { ledger.previous = null; ledger.segment++; ledger.tail.markCoverage("context_limit"); return; }
        const serialized = canonical(record); const chars = serialized.length;
        const key = digest(sessionId + ":" + path + ":" + ledger.tail.generation + ":" + ledger.segment + ":" + offset + ":" + digest(serialized));
        ledger.records.set(key, { key, record, chars, path, offset, segment:ledger.segment, summary:trajectorySummary(record,key) }); ledger.chars += chars; ledger.previous = record;
        while (ledger.records.size > 120 || ledger.chars > MAX_CACHE_CHARS) {
          const first = ledger.records.keys().next().value;
          ledger.chars -= ledger.records.get(first).chars; ledger.records.delete(first); ledger.tail.markCoverage("display_window");
        }
        this.trimCaches();
      }, () => { ledger.previous = null; ledger.records.clear(); ledger.chars = 0; ledger.segment++; }, () => { ledger.previous = null; ledger.segment++; });
      coverage.push(status);
    }
    // Event logs are a short diagnostic window; usage history comes from SQLite.
    for (let day = 0; day < 3; day++) {
      const date = new Date(); date.setDate(date.getDate() - day);
      const stamp = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
      const path = join(this.paths.logDir, "zcode-" + stamp + ".jsonl");
      let tail = state.logTails.get(path);
      if (!tail) { tail = new JsonlTail(); state.logTails.set(path, tail); }
      await tail.scan(path, raw => {
        const event = compactEvent(raw, sessionId);
        if (event) state.events.set(event.event + ":" + event.timestamp + ":" + event.turnId, event);
        while (state.events.size > 100) state.events.delete(state.events.keys().next().value);
      });
    }
    const records = this.records(state);
    const usage = readUsage(this.paths.db, sessionId);
    if (records.length && coverage.every(item => !item.available)) coverage.push({ coverage: ["source_rotated"], scanning: false });
    const cutoff = Date.now() - 3 * 86400000;
    for (const [key,event] of state.events) if (event.timestamp < cutoff) state.events.delete(key);
    while (state.logTails.size > 3) state.logTails.delete(state.logTails.keys().next().value);
    const latest = records.findLast(item => isAgentSource(item.record.querySource));
    const overview = { sessionId, usage, trajectories: records.slice(-60).map(item => this.timelineItem(records,item)),
      composition: latest ? composition(latest.record) : null,
      trajectory: { available: records.length > 0, scanning: coverage.some(item => item.scanning),
        pendingLine: coverage.some(item => item.pendingLine), coverage: [...new Set(coverage.flatMap(item => item.coverage))],
        errorCode: records.length ? null : coverage.every(item => !item.available) ? "trajectory_missing" : "waiting_for_records" },
      events: [...state.events.values()].sort((a,b) => a.timestamp-b.timestamp).slice(-30).map(event=>this.eventNavigation(records,event)), eventWindowDays: 3 };
    overview.history = {loadedCount:records.length, loadedKeys:records.map(x=>x.key), page:0, hasOlder:records.length>60, scope:"bounded_loaded_window"};
    overview.revision = digest(JSON.stringify(overview)); state.overview = overview; return overview;
  }
  trimCaches() {
    const ledgers = [...this.sessions.values()].flatMap(state => [...state.ledgers.values()]);
    let total = ledgers.reduce((sum, ledger) => sum + ledger.chars, 0);
    while (total > MAX_CACHE_CHARS) {
      let owner = null; let oldest = null;
      for (const ledger of ledgers) {
        const first = ledger.records.values().next().value;
        if (first && (!oldest || first.record.startedAt < oldest.record.startedAt)) { owner = ledger; oldest = first; }
      }
      if (!owner) break;
      owner.records.delete(oldest.key); owner.chars -= oldest.chars; total -= oldest.chars;
      owner.tail.markCoverage("display_window");
      if (!owner.records.size) owner.previous = null;
    }
  }
  records(state) {
    return [...state.ledgers.values()].flatMap(ledger => [...ledger.records.values()])
      .sort((a,b) => a.record.startedAt-b.record.startedAt || a.path.localeCompare(b.path) || a.offset-b.offset);
  }
  previous(all,selected) {
    const index=all.findIndex(x=>x.key===selected.key);
    return all.slice(0,index).findLast(x=>x.path===selected.path&&x.record.querySource===selected.record.querySource);
  }
  comparison(all,selected,baselineKey) {
    const previous=baselineKey?all.find(x=>x.key===baselineKey):this.previous(all,selected);
    if(!previous)return {available:false,reason:baselineKey?"baseline_expired":"no_previous_snapshot"};
    if(previous.path!==selected.path||previous.segment!==selected.segment)return {available:false,reason:"history_gap",previousKey:previous.key};
    if(previous.key===selected.key||all.indexOf(previous)>=all.indexOf(selected))return {available:false,reason:"invalid_baseline"};
    return {...diffRecords(previous.record,selected.record),previousKey:previous.key};
  }
  timelineItem(all,item) {
    if(!item.timeline || item.timeline.baselineKey && !all.some(x=>x.key===item.timeline.baselineKey)){
      const d=this.comparison(all,item);
      item.timeline={...item.summary,delta:d.available?{chars:d.charsDelta,categories:d.categories,schemasComparable:d.schemasComparable}:null,
        baselineKey:d.previousKey??null,deltaReason:d.reason??null};
    }
    return item.timeline;
  }
  eventNavigation(records,event) {
    // A turn ID supports a turn range, not an exact request association. Time-only navigation is labelled accordingly.
    const matching=event.turnId?records.filter(x=>x.record.turnId===event.turnId):[];
    const before=records.findLast(x=>x.record.startedAt<=event.timestamp);
    const after=records.find(x=>x.record.startedAt>event.timestamp);
    return {...event,navigation:{evidence:matching.length?"turn_range":"time_range",
      turnKeys:matching.slice(0,12).map(x=>x.key),beforeKey:before?.key??null,afterKey:after?.key??null,
      beforeTime:before?.record.startedAt??null,afterTime:after?.record.startedAt??null}};
  }
  async overview(sessionId, revision, historyPage=0) {
    const overview=await this.refresh(sessionId);
    const records=this.records(this.state(sessionId));const end=Math.max(0,records.length-historyPage*60);
    const result=historyPage?{...overview,trajectories:records.slice(Math.max(0,end-60),end).map(x=>this.timelineItem(records,x)),
      history:{...overview.history,page:historyPage,hasOlder:end>60}}:overview;
    result.revision=digest(overview.revision+":"+historyPage);
    return revision&&revision===result.revision?{sessionId,revision,unchanged:true}:result;
  }
  async request(sessionId,args) {
    const state=this.state(sessionId);if(!state.overview)await this.refresh(sessionId);
    const all=this.records(state),selected=all.find(x=>x.key===args.key);
    if(!selected)throw new ContextError("request_expired","Request is outside the loaded trajectory window.");
    const record=selected.record,elements=inputElements(record),page=args.page??0,pageSize=40;
    let diff=this.comparison(all,selected,args.baselineKey);
    if(diff.available)diff={...diff,addedCount:diff.added.length,removedCount:diff.removed.length,changedCount:diff.changed.length,
      added:diff.added.slice((args.changePage??0)*40,(args.changePage??0)*40+40),
      removed:diff.removed.slice((args.changePage??0)*40,(args.changePage??0)*40+40),changed:diff.changed.slice((args.changePage??0)*40,(args.changePage??0)*40+40)};
    const search=(args.search??"").toLowerCase(),role=args.role;
    const loadedSearch=args.searchScope==="loaded"&&Boolean(search);
    const filtered=[];
    // Search one snapshot at a time and retain summaries, avoiding a second copy of all cached bodies.
    for(const snapshot of loadedSearch?all:[selected]) {
      for(const item of snapshot===selected?elements:inputElements(snapshot.record)) {
        if(role&&item.role!==role)continue;
        if(search&&![item.readable,item.toolName,item.toolCallId,item.key].some(v=>String(v??"").toLowerCase().includes(search)))continue;
        filtered.push({...elementSummary(item),...(loadedSearch?{snapshotKey:snapshot.key,snapshotTime:snapshot.record.startedAt}:{})});
      }
    }
    if(args.sort!=="order")filtered.sort((a,b)=>b.chars-a.chars||a.key.localeCompare(b.key));
    const element=args.elementKey?elements.find(x=>x.key===args.elementKey):null;
    if(args.elementKey&&!element)throw new ContextError("element_missing","Element unavailable.");
    let content=null;
    if(element){
      const text=args.format==="raw"?element.text:element.readable,offset=args.offset??0;
      const hits=[];let matchCount=0;const query=(args.bodySearch??"").toLowerCase();
      if(query){const haystack=text.toLowerCase();let cursor=0;while((cursor=haystack.indexOf(query,cursor))!==-1){matchCount++;if(hits.length<100)hits.push(cursor);cursor+=query.length;}}
      content={...elementSummary(element),offset,totalChars:text.length,lineCount:text.split("\n").length,
        text:text.slice(offset,offset+12000),hasMore:offset+12000<text.length,format:args.format??"readable",
        tool:toolEvidence(record,element),hits,matchCount};
    }
    let bodyDiff=null;
    if(args.diffBeforeElement&&element&&diff.available){
      const previous=all.find(x=>x.key===diff.previousKey);
      const original=inputElements(previous.record).find(x=>x.key===args.diffBeforeElement);
      const full=diffRecords(previous.record,record);
      if(!original||!full.changed.some(x=>x.before.key===original.key&&x.after.key===element.key))throw new ContextError("diff_identity_unavailable","No recorded identity for this replacement.");
      // Paginate the rendered difference by characters too: a single huge line cannot bypass limits.
      const unified=textDifference(original.readable,element.readable).map(x=>(x.kind==="added"?"+ ":x.kind==="removed"?"- ":"  ")+x.text).join("\n");
      const offset=args.offset??0;
      bodyDiff={text:unified.slice(offset,offset+12000),offset,totalChars:unified.length,hasMore:offset+12000<unified.length,
        beforeKey:previous.key,afterKey:selected.key,method:"common_prefix_suffix_block"};
    }
    return {sessionId,revision:state.overview.revision,summary:selected.summary,composition:selected.summary.composition,diff,
      baselineOptions:all.filter(x=>x.path===selected.path&&x.record.querySource===record.querySource&&all.indexOf(x)<all.indexOf(selected)).slice(-60).map(x=>({key:x.key,startedAt:x.record.startedAt,turnId:x.record.turnId,complete:x.record.messages.complete})),
      elementCount:elements.length,filteredCount:filtered.length,page,searchScope:args.searchScope==="loaded"&&search?"all_loaded_snapshots":"all_elements_in_selected_loaded_snapshot",loadedSnapshotCount:all.length,
      largest:filtered.length?filtered.reduce((largest,x)=>x.chars>largest.chars?x:largest):null,
      elements:filtered.slice(page*pageSize,(page+1)*pageSize),content,bodyDiff};
  }
}
