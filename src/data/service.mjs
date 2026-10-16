import { join } from "node:path";
import { createHash } from "node:crypto";
import { readUsage, readToolCalls } from "./sqlite.mjs";
import { readConversation, readSummarizedMessages } from "./conversation.mjs";
import { JsonlTail } from "./jsonl.mjs";
import { sanitizeSessionSegment, ContextError, isAgentSource } from "../domain/session.mjs";
import { foldRecord, inputElements, composition, diffRecords, trajectorySummary, canonical, contentKey, elementSummary, toolEvidence, textDifference, isContinuation } from "../domain/trajectory.mjs";
import { contextEvent, mergeEvents, conversationEvents, combineEvents, summarizedItems } from "../domain/events.mjs";
const digest = value => createHash("sha256").update(value).digest("hex").slice(0,24);
const sha = value => createHash("sha256").update(value).digest("hex");
// A needle is a whole recorded text, or a long text's prefix, length and digest, checked wherever the prefix occurs.
function contains(readable, needle) {
  if (needle.text !== undefined) return readable.includes(needle.text);
  for (let at = readable.indexOf(needle.prefix); at !== -1; at = readable.indexOf(needle.prefix, at + 1))
    if (sha(readable.slice(at, at + needle.chars)) === needle.hash) return true;
  return false;
}
const MAX_CACHE_CHARS = 32 * 1024 * 1024;
const TRUNCATED = ["history_window", "display_window", "history_reset", "source_rotated"];
// Each category returns its own bounded first page, so a grouped view never depends on a global page.
function groupByRole(items, limit = 40) {
  const groups = {};
  for (const item of items) {
    const group = groups[item.role] ??= { count: 0, items: [] };
    group.count++; if (group.items.length < limit) group.items.push(item);
  }
  return groups;
}
const bySize = (a, b) => b.chars - a.chars || a.key.localeCompare(b.key);
const SCHEMA_ORDER = { calls: (a, b) => (b.callCount ?? -1) - (a.callCount ?? -1) || bySize(a, b),
  name: (a, b) => (a.toolName == null) - (b.toolName == null) || String(a.toolName ?? "").localeCompare(String(b.toolName ?? "")) || a.key.localeCompare(b.key) };
// A schema order only permutes schema items among their own slots, so other categories and pages keep the general order.
function arrange(list, sort, schemaSort) {
  const result = sort === "order" ? [...list] : [...list].sort(bySize), compare = SCHEMA_ORDER[schemaSort];
  if (!compare) return result;
  const slots = result.flatMap((x, i) => x.role === "schema" ? [i] : []), schemas = slots.map(i => result[i]).sort(compare);
  slots.forEach((slot, i) => { result[slot] = schemas[i]; });
  return result;
}
// The element being opened stays listed even when it falls outside its category's first page, or outside the narrowing
// altogether; it is then marked pinned and not counted.
function pin(groups,key,listed,any) {
  if(!key)return groups;
  const item=listed.find(x=>x.key===key)??(any?{...any,pinned:true}:null);
  if(!item)return groups;
  const group=groups[item.role]??={count:0,items:[]};
  if(!group.items.some(x=>x.key===key))group.items.push(item);
  return groups;
}
export class ContextDataService {
  constructor(paths) { this.paths = paths; this.sessions = new Map(); }
  state(sessionId) {
    let state = this.sessions.get(sessionId);
    if (state) { this.sessions.delete(sessionId); this.sessions.set(sessionId, state); return state; }
    if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value);
    state = { ledgers: new Map(), events: new Map(), logTails: new Map(), overview: null, conversation: null, recorded: [], targets: new Map() };
    this.sessions.set(sessionId, state);
    return state;
  }
  async refresh(sessionId) {
    const state = this.state(sessionId); const coverage = [];
    for (const directory of this.paths.trajectoryDirs) {
      const path = join(directory, "model-io-" + sanitizeSessionSegment(sessionId) + ".jsonl");
      let ledger = state.ledgers.get(path);
      if (!ledger) { ledger = { tail: new JsonlTail(), previous: null, records: new Map(), chars: 0, segment: 0, baseSegment: null, steps: 0, turns: new Map() }; state.ledgers.set(path, ledger); }
      const status = await ledger.tail.scan(path, (raw, offset) => {
        if (raw.type !== "model_io" || raw.sessionId !== sessionId) { ledger.previous = null; ledger.segment++; return; }
        if (raw.modelIOReset) { ledger.previous = null; ledger.segment++; ledger.tail.markCoverage("history_reset"); }
        const record = foldRecord(raw, ledger.previous);
        if (record.oversized) { ledger.previous = null; ledger.segment++; ledger.tail.markCoverage("context_limit"); return; }
        const serialized = canonical(record); const chars = serialized.length;
        const key = digest(sessionId + ":" + path + ":" + ledger.tail.generation + ":" + ledger.segment + ":" + offset + ":" + digest(serialized));
        const summary = trajectorySummary(record,key);
        // Ordinals count from the first record read in this file generation, so labels stay stable as the cache window slides.
        const agent = isAgentSource(record.querySource);
        if (agent && record.turnId && !ledger.turns.has(record.turnId)) ledger.turns.set(record.turnId, ledger.turns.size + 1);
        summary.step = agent ? ++ledger.steps : null; summary.turn = record.turnId ? ledger.turns.get(record.turnId) ?? null : null;
        // fromStart: nothing was skipped between the start of this file generation and the record.
        ledger.records.set(key, { key, record, chars, path, offset, segment:ledger.segment, fromStart:ledger.segment===ledger.baseSegment, summary }); ledger.chars += chars; ledger.previous = record;
        while (ledger.records.size > 120 || ledger.chars > MAX_CACHE_CHARS) {
          const first = ledger.records.keys().next().value;
          ledger.chars -= ledger.records.get(first).chars; ledger.records.delete(first); ledger.tail.markCoverage("display_window");
        }
        this.trimCaches();
      }, () => { ledger.previous = null; ledger.records.clear(); ledger.chars = 0; ledger.segment++; ledger.baseSegment = ledger.segment; ledger.steps = 0; ledger.turns.clear(); }, () => { ledger.previous = null; ledger.segment++; });
      coverage.push(status);
    }
    // Event logs are a short diagnostic window; usage history comes from SQLite. Oldest day first, so the
    // insertion-ordered caps below drop the oldest events and log tails.
    for (let day = 2; day >= 0; day--) {
      const date = new Date(); date.setDate(date.getDate() - day);
      const stamp = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
      const path = join(this.paths.logDir, "zcode-" + stamp + ".jsonl");
      let tail = state.logTails.get(path);
      if (!tail) { tail = new JsonlTail(); state.logTails.set(path, tail); }
      await tail.scan(path, raw => {
        const event = contextEvent(raw, sessionId);
        if (event) state.events.set(event.event + ":" + event.timestamp + ":" + event.turnId + ":" + event.spanId, event);
        while (state.events.size > 200) state.events.delete(state.events.keys().next().value);
      });
    }
    const records = this.records(state);
    const usage = readUsage(this.paths.db, sessionId); state.toolCalls = readToolCalls(this.paths.db, sessionId);
    // A busy or briefly unopenable database keeps the last events; a missing database or an unsupported schema falls back to the logs alone.
    const conversation = readConversation(this.paths.db, sessionId, state.conversation);
    if (conversation.available) { if (conversation.changed || !state.conversation) state.recorded = conversationEvents(conversation.cache); state.conversation = conversation.cache; state.branch = conversation.branch; }
    else if (!["database_busy", "database_unavailable"].includes(conversation.code)) { state.conversation = null; state.recorded = []; state.branch = null; }
    // A file that could not be opened this time is not evidence of rotation.
    if (records.length && coverage.every(item => !item.available) && !coverage.some(item => item.code === "file_unavailable"))
      coverage.push({ coverage: ["source_rotated"], scanning: false });
    const cutoff = Date.now() - 3 * 86400000;
    for (const [key,event] of state.events) if (event.timestamp < cutoff) state.events.delete(key);
    while (state.logTails.size > 3) state.logTails.delete(state.logTails.keys().next().value);
    const latest = records.findLast(item => isAgentSource(item.record.querySource));
    const overview = { sessionId, usage, toolCalls: state.toolCalls, trajectories: records.slice(-60).map(item => this.timelineItem(records,item)),
      composition: latest ? composition(latest.record) : null,
      trajectory: { available: records.length > 0, scanning: coverage.some(item => item.scanning),
        pendingLine: coverage.some(item => item.pendingLine), coverage: [...new Set(coverage.flatMap(item => item.coverage))],
        errorCode: records.length ? null : coverage.every(item => !item.available) ? "trajectory_missing" : "waiting_for_records" },
      events: this.contextEvents(state, records, !coverage.some(item => (item.coverage ?? []).some(code => TRUNCATED.includes(code)))), eventWindowDays: 3,
      conversation: { available: conversation.available || Boolean(state.conversation), code: conversation.available ? null : conversation.code, branch: state.branch ?? null } };
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
  // Absolute message range and per-message digests of one cached record, computed once and kept on the cache entry.
  fingerprint(entry) {
    const {items,offset}=entry.record.messages;
    return entry.fingerprint??={start:offset,end:offset==null?null:offset+items.length,hashes:items.map(x=>digest(contentKey(x)))};
  }
  // The message at absolute index i entered with the earliest snapshot of an unbroken chain whose message count exceeds i.
  // The chain follows previous(): same file, segment and source. A missing offset, a shrinking count (compaction) or a
  // different recorded message at the same index ends it; whatever is still present there entered before that point.
  // Older records never appear later in a ledger, so the result is cached on the entry.
  entries(all,selected) {
    if(selected.entries!==undefined)return selected.entries;
    const own=this.fingerprint(selected);
    if(selected.summary.step==null||own.start==null)return selected.entries=null;
    const stamp=x=>({step:x.summary.step,turn:x.summary.turn}),result=[],alive=new Set(own.hashes.keys());
    let cursor=selected,current=own;
    while(alive.size) {
      const prev=this.previous(all,cursor),before=prev&&this.fingerprint(prev);
      if(!prev||prev.segment!==cursor.segment||before.start==null||before.end>current.end){for(const p of alive)result[p]={before:stamp(cursor)};break;}
      for(const p of alive) {
        const i=own.start+p;
        if(before.end<=i){result[p]={entered:stamp(cursor)};alive.delete(p);}
        else if(i>=before.start&&before.hashes[i-before.start]!==own.hashes[p]){result[p]={before:stamp(cursor)};alive.delete(p);}
      }
      cursor=prev;current=before;
    }
    return selected.entries=result;
  }
  timelineItem(all,item) {
    if(!item.timeline || item.timeline.baselineKey && !all.some(x=>x.key===item.timeline.baselineKey)){
      const d=this.comparison(all,item);
      item.timeline={...item.summary,delta:d.available?{chars:d.charsDelta,tokens:d.tokensDelta,categories:d.categories,schemasComparable:d.schemasComparable}:null,
        baselineKey:d.previousKey??null,deltaReason:d.reason??null};
    }
    return item.timeline;
  }
  // Recorded events cover the whole session; the list keeps the newest injections and the newest of everything else.
  contextEvents(state,records,complete) {
    const all=combineEvents(state.recorded,mergeEvents(state.events.values()));
    const kept=[...all.filter(e=>e.kind==="inject").slice(-150),...all.filter(e=>e.kind!=="inject").slice(-60)].sort((a,b)=>a.timestamp-b.timestamp);
    while(state.targets.size>400)state.targets.delete(state.targets.keys().next().value);
    return kept.map(e=>e.kind==="inject"?this.locate(state,records,e,complete):this.eventNavigation(records,e)).map(({needles,...e})=>e);
  }
  // An injected message is first sent with the next agent request; it is found there by tool-call id or by its exact text,
  // the newest occurrence, since reminders repeat. When that request is not readable, or does not contain it, the event keeps no step.
  // A request only counts as the first after the event when nothing was skipped since the one before: same file and segment.
  // The earliest readable request counts only when its file was read from the start without a gap or eviction.
  // A result is reused while each file's earliest agent request is the same and the step it names is still cached.
  locate(state,records,event,complete) {
    const agents=records.filter(x=>x.summary.step!=null),firsts=new Map();
    for(const x of agents)if(!firsts.has(x.path))firsts.set(x.path,x.key);
    const first=[...firsts.values()].join(","),memo=state.targets.get(event.id);
    if(memo&&memo.first===first&&(!memo.target.stepKey||agents.some(x=>x.key===memo.target.stepKey)))return {...event,...memo.target};
    const index=agents.findIndex(x=>x.record.startedAt>=event.timestamp);
    if(index<0)return {...event,stepKey:null,elementKey:null,elementRole:null};
    let target={stepKey:null,elementKey:null,elementRole:null};
    const record=agents[index],prior=agents[index-1];
    if(prior?prior.path===record.path&&prior.segment===record.segment:complete&&record.fromStart) {
      const elements=inputElements(record.record);
      const element=event.toolCallId?elements.find(x=>x.toolCallId===event.toolCallId)
        :event.needles?.length?elements.findLast(x=>x.key.startsWith("message:")&&event.needles.every(n=>contains(x.readable,n))):null;
      if(element)target={stepKey:record.key,elementKey:element.key,elementRole:element.role};
    }
    state.targets.set(event.id,{first,target});
    return {...event,...target};
  }
  // The messages a recorded compaction summarized: after the previous compaction's summary, through its last summarized message.
  async eventDetail(sessionId,id) {
    const state=this.state(sessionId);if(!state.overview)await this.refresh(sessionId);
    const compactions=state.recorded.filter(e=>e.kind==="compaction"),event=compactions.find(e=>e.id===id);
    if(!event||event.lastSummarizedSequence==null)throw new ContextError("event_missing","Compaction details are unavailable.");
    const previous=compactions.filter(e=>e.timestamp<event.timestamp&&e.summarySequence!=null).map(e=>e.summarySequence).reverse();
    const read=readSummarizedMessages(this.paths.db,sessionId,{after:previous,through:event.lastSummarizedSequence,summary:event.summarySequence});
    if(!read.available)throw new ContextError(read.code,"Compaction details are unavailable.");
    const items=summarizedItems(read.messages);
    return {sessionId,eventDetail:{id,messageCount:read.total,listedMessages:read.messages.length,items:items.slice(0,300),itemCount:items.length,
      tokens:items.reduce((n,x)=>n+(x.tokens??0),0)}};
  }
  eventNavigation(records,event) {
    // A turn ID supports a turn range, not an exact request association. Time-only navigation is labelled accordingly.
    const matching=event.turnId?records.filter(x=>x.record.turnId===event.turnId):[];
    // Before is the last request sent before the operation began; after is the first one sent once it ended.
    const before=records.findLast(x=>x.record.startedAt<=event.timestamp);
    const after=records.find(x=>x.record.startedAt>(event.endedAt??event.timestamp));
    // The first agent request after a compaction carries its summary; found by ZCode's fixed preface, not by similarity.
    const agent=event.kind==="compaction"?records.find(x=>x.summary.step!=null&&x.record.startedAt>(event.endedAt??event.timestamp)):null;
    if(agent)agent.continuation??=inputElements(agent.record).find(isContinuation)?.key??null;
    return {...event,navigation:{evidence:matching.length?"turn_range":"time_range",
      turnKeys:matching.slice(0,12).map(x=>x.key),beforeKey:before?.key??null,afterKey:after?.key??null,
      beforeTime:before?.record.startedAt??null,afterTime:after?.record.startedAt??null,
      summaryStepKey:agent?.key??null,summaryKey:agent?.continuation??null}};
  }
  async overview(sessionId, revision, historyPage=0) {
    const overview=await this.refresh(sessionId);
    const records=this.records(this.state(sessionId));const end=Math.max(0,records.length-historyPage*60);
    const result=historyPage?{...overview,trajectories:records.slice(Math.max(0,end-60),end).map(x=>this.timelineItem(records,x)),
      history:{...overview.history,page:historyPage,hasOlder:end>60}}:overview;
    result.revision=digest(overview.revision+":"+historyPage);
    return revision&&revision===result.revision?{sessionId,revision,unchanged:true}:result;
  }
  // "Previous turn": the last agent step of an earlier turn in the same file and from the same source, over the whole cache.
  // A turn numbered after 1 whose predecessor is no longer cached has a baseline that left the window, not no previous turn.
  turnBaseline(all,selected) {
    const s=selected.summary;
    if(s.step==null)return {};
    if(s.turn==null)return {noBaseline:true};
    const previous=all.slice(0,all.indexOf(selected)).findLast(x=>x.summary.step!=null&&x.path===selected.path&&x.record.querySource===selected.record.querySource&&x.summary.turn!=null&&x.summary.turn<s.turn);
    return previous?{baselineKey:previous.key}:{noBaseline:true,noBaselineReason:s.turn>1?"baseline_expired":"no_previous_turn"};
  }
  async request(sessionId,args) {
    const state=this.state(sessionId);if(!state.overview)await this.refresh(sessionId);
    const all=this.records(state),selected=all.find(x=>x.key===args.key);
    if(!selected)throw new ContextError("request_expired","Request is outside the loaded trajectory window.");
    if(args.baselineMode==="turn"&&!args.baselineKey&&!args.noBaseline)args={...args,...this.turnBaseline(all,selected)};
    const record=selected.record,elements=inputElements(record),page=args.page??0,pageSize=40;
    // A turn's first step has no previous turn: nothing is compared, rather than falling back to the previous step.
    let diff=args.noBaseline?{available:false,reason:args.noBaselineReason??"no_previous_turn"}:this.comparison(all,selected,args.baselineKey);
    // Session-wide counts from tool_usage; null when the table is unavailable or a name fell outside the bounded read.
    const calls=state.toolCalls??{available:false,byName:{}};
    const callCount=x=>!calls.available||typeof x.toolName!=="string"?null:Object.hasOwn(calls.byName,x.toolName)?calls.byName[x.toolName].count:calls.truncated?null:0;
    // Entry stamps describe the selected snapshot's own messages only; removed items and other snapshots carry none.
    const entries=this.entries(all,selected);
    const stampOf=key=>{const e=key.startsWith("message:")?entries?.[Number(key.slice(8))]:null;return !e?{}:e.entered?{entered:e.entered}:{enteredBefore:true,tracedTo:e.before};};
    const decorate=(x,own=true)=>x.role==="schema"?{...x,callCount:callCount(x)}:own?{...x,...stampOf(x.key)}:x;
    const order=(list,own)=>arrange(list.map(x=>decorate(x,own)),args.sort,args.schemaSort);
    const search=(args.search??"").toLowerCase(),prefix=args.toolPrefix??"",role=args.role;
    const loadedSearch=args.searchScope==="loaded"&&Boolean(search);
    // The narrowing: free text over bodies, tool names and call IDs, and a tool-name prefix that only schemas can match.
    const hit=item=>(!prefix||item.role==="schema"&&String(item.toolName??"").startsWith(prefix))
      &&(!search||[item.readable,item.toolName,item.toolCallId,item.key].some(v=>String(v??"").toLowerCase().includes(search)));
    // Partial (tail) records cannot be diffed, but entry stamps still tell what entered after the baseline step.
    // Messages whose trace stops after the baseline are counted as unknown rather than guessed.
    let arrivals=null,arrived=null;
    if(!diff.available&&!args.noBaseline&&entries&&selected.summary.step!=null) {
      const base=args.baselineKey?all.find(x=>x.key===args.baselineKey):this.previous(all,selected);
      const since=base&&base.path===selected.path&&base.segment===selected.segment&&base.summary.step!=null&&all.indexOf(base)<all.indexOf(selected)?base.summary.step:null;
      if(since!=null) {
        const stamped=elements.filter(x=>x.key.startsWith("message:")).map(x=>({item:x,entry:entries[Number(x.key.slice(8))]})).filter(x=>x.entry);
        arrived=stamped.filter(x=>x.entry.entered&&x.entry.entered.step>since).map(x=>x.item);
        arrivals={available:true,sinceStep:since,count:arrived.length,keys:arrived.map(x=>x.key),groups:groupByRole(order(arrived.map(elementSummary),true)),
          unknownCount:stamped.filter(x=>!x.entry.entered&&x.entry.before&&x.entry.before.step>since).length};
      }
    }
    // Every count the browser shows comes from here, under the same narrowing as the list it opens: per category the items,
    // those matching, and the changes — the diff, or a partial record's arrivals, whose removals are unknown.
    const own=new Map(elements.map(x=>[x.key,x]));
    let changes=null;
    if(diff.available) {
      const before=new Map(inputElements(all.find(x=>x.key===diff.previousKey).record).map(x=>[x.key,x]));
      changes={source:"diff",added:diff.added.map(x=>[x,own.get(x.key)]),removed:diff.removed.map(x=>[x,before.get(x.key)])};
    } else if(arrived)changes={source:"arrivals",added:arrived.map(x=>[elementSummary(x),x]),removed:null};
    const shown=list=>list?list.filter(([,x])=>x&&hit(x)).map(([summary])=>summary):null;
    const added=shown(changes?.added),removed=shown(changes?.removed),roles={};
    const tally=role=>roles[role]??={total:0,matched:0,added:0,addedTotal:0,removed:removed?0:null,removedTotal:removed?0:null};
    for(const x of elements){const r=tally(x.role);r.total++;if(hit(x))r.matched++;}
    for(const [x] of changes?.added??[])tally(x.role).addedTotal++;
    for(const [x] of changes?.removed??[])tally(x.role).removedTotal++;
    for(const x of added??[])tally(x.role).added++;
    for(const x of removed??[])tally(x.role).removed++;
    const focusItem=args.focusKey&&own.has(args.focusKey)?decorate(elementSummary(own.get(args.focusKey))):null,addedOrdered=order(added??[],true);
    const listing={narrowed:Boolean(search||prefix),source:changes?.source??null,roles,added:added?.length??0,addedTotal:changes?.added.length??0,
      removed:removed?.length??null,removedTotal:changes?.removed?.length??null,
      addedGroups:changes?pin(groupByRole(addedOrdered),args.focusKey,addedOrdered,focusItem):{},removedGroups:removed?groupByRole(order(removed,false)):{}};
    if(diff.available)diff={...diff,addedCount:diff.added.length,removedCount:diff.removed.length,changedCount:diff.changed.length,
      addedKeys:diff.added.slice(0,2000).map(x=>x.key),changedPairs:diff.changed.map(x=>({before:x.before.key,after:x.after.key})),
      addedGroups:groupByRole(order(diff.added,true)),removedGroups:groupByRole(order(diff.removed,false)),
      added:diff.added.slice((args.changePage??0)*40,(args.changePage??0)*40+40),
      removed:diff.removed.slice((args.changePage??0)*40,(args.changePage??0)*40+40),changed:diff.changed.slice((args.changePage??0)*40,(args.changePage??0)*40+40)};
    const filtered=[];
    // Search one snapshot at a time and retain summaries, avoiding a second copy of all cached bodies.
    for(const snapshot of loadedSearch?all:[selected]) {
      for(const item of snapshot===selected?elements:inputElements(snapshot.record)) {
        if(role&&item.role!==role)continue;
        if(!hit(item))continue;
        filtered.push({...decorate(elementSummary(item),snapshot===selected),...(loadedSearch?{snapshotKey:snapshot.key,snapshotTime:snapshot.record.startedAt}:{})});
      }
    }
    const ordered=arrange(filtered,args.sort,loadedSearch?null:args.schemaSort);
    const schemas=elements.filter(x=>x.role==="schema").map(x=>decorate(elementSummary(x))),unused=schemas.filter(x=>x.callCount===0);
    const schemaCalls=record.tools===null?{available:false,reason:"not_recorded"}:!calls.available?{available:false,reason:calls.code??"tool_usage_unavailable"}
      :{available:true,scope:"session",schemaCount:schemas.length,unusedCount:unused.length,unusedEstimatedTokens:unused.reduce((n,x)=>n+x.estimatedTokens,0),unknownCount:schemas.filter(x=>x.callCount==null).length};
    const element=args.elementKey?elements.find(x=>x.key===args.elementKey):null;
    if(args.elementKey&&!element)throw new ContextError("element_missing","Element unavailable.");
    let content=null;
    if(element){
      const text=args.format==="raw"?element.text:element.readable,offset=args.offset??0;
      const hits=[];let matchCount=0;const query=(args.bodySearch??"").toLowerCase();
      if(query){const haystack=text.toLowerCase();let cursor=0;while((cursor=haystack.indexOf(query,cursor))!==-1){matchCount++;if(hits.length<100)hits.push(cursor);cursor+=query.length;}}
      content={...decorate(elementSummary(element)),offset,totalChars:text.length,lineCount:text.split("\n").length,
        text:text.slice(offset,offset+12000),hasMore:offset+12000<text.length,format:args.format??"readable",
        tool:toolEvidence(record,element),hits,matchCount};
    }
    let bodyDiff=null;
    if(args.diffBeforeElement&&element&&diff.available){
      const previous=all.find(x=>x.key===diff.previousKey);
      const original=inputElements(previous.record).find(x=>x.key===args.diffBeforeElement);
      if(!original||!diff.changedPairs.some(x=>x.before===original.key&&x.after===element.key))throw new ContextError("diff_identity_unavailable","No recorded identity for this replacement.");
      // Paginate the rendered difference by characters too: a single huge line cannot bypass limits.
      const unified=textDifference(original.readable,element.readable).map(x=>(x.kind==="added"?"+ ":x.kind==="removed"?"- ":"  ")+x.text).join("\n");
      const offset=args.offset??0;
      bodyDiff={text:unified.slice(offset,offset+12000),offset,totalChars:unified.length,hasMore:offset+12000<unified.length,
        beforeKey:previous.key,afterKey:selected.key,method:"common_prefix_suffix_block"};
    }
    return {sessionId,revision:state.overview.revision,summary:this.timelineItem(all,selected),composition:selected.summary.composition,diff,arrivals,listing,
      baselineOptions:all.filter(x=>x.path===selected.path&&x.record.querySource===record.querySource&&all.indexOf(x)<all.indexOf(selected)).slice(-60).map(x=>({key:x.key,startedAt:x.record.startedAt,turnId:x.record.turnId,complete:x.record.messages.complete})),
      elementCount:elements.length,filteredCount:filtered.length,page,searchScope:args.searchScope==="loaded"&&search?"all_loaded_snapshots":"all_elements_in_selected_loaded_snapshot",loadedSnapshotCount:all.length,
      largest:filtered.length?filtered.reduce((largest,x)=>x.chars>largest.chars?x:largest):null,
      groups:loadedSearch?null:pin(groupByRole(ordered),args.focusKey,ordered,focusItem),schemaCalls,
      elements:ordered.slice(page*pageSize,(page+1)*pageSize),content,bodyDiff};
  }
}
