import test from "node:test";
import assert from "node:assert/strict";
import {readSessionContext,sanitizeSessionSegment} from "../src/domain/session.mjs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {normalizeFact} from "../src/domain/usage.mjs";
import {readUsage} from "../src/data/sqlite.mjs";
import {foldRecord,diffRecords,composition,estimateTokens} from "../src/domain/trajectory.mjs";
import {contextEvent,mergeEvents,conversationEvents,summarizedItems} from "../src/domain/events.mjs";
import {modelRecord,usageDatabase} from "./fixtures.mjs";
// The per-request semantics the SQL aggregate must reproduce: unknown fields stay out of sums, a hit rate needs both sides.
function summarizeFacts(facts) {
  const sum=key=>{const known=facts.filter(f=>f[key]!==null);return known.length?known.reduce((s,f)=>s+f[key],0):null;};
  const eligible=facts.filter(f=>f.inputTokens!==null&&f.cacheReadTokens!==null),input=eligible.reduce((s,f)=>s+f.inputTokens,0);
  return {requestCount:facts.length,reportedCount:facts.filter(f=>f.hasUsage).length,missingUsageCount:facts.filter(f=>!f.hasUsage).length,
    inputTokens:sum("inputTokens"),outputTokens:sum("outputTokens"),totalTokens:sum("totalTokens"),
    cacheHitRate:input>0?eligible.reduce((s,f)=>s+f.cacheReadTokens,0)/input:null,
    errorCount:facts.filter(f=>f.status==="error").length,retryCount:facts.reduce((s,f)=>s+f.retryCount,0)};
}
test("only the host namespace binds a session; transport IDs and arguments cannot bind it",()=>{
  assert.throws(()=>readSessionContext({session_id:"sess_wrong"}),{code:"binding_unavailable"});
  assert.throws(()=>readSessionContext(undefined),{code:"binding_unavailable"});
  assert.throws(()=>readSessionContext({"com.zcode/request-context":{session_id:"../../secret"}}),{code:"binding_unavailable"});
  assert.equal(readSessionContext({"com.zcode/request-context":{session_id:"sess_A"}}).sessionId,"sess_A");
});
test("session bindings stay independent when calls interleave",()=>{
  const a=readSessionContext({"com.zcode/request-context":{session_id:"sess_A"}});
  const b=readSessionContext({"com.zcode/request-context":{session_id:"sess_B"}});
  assert.equal(a.sessionId,"sess_A");assert.equal(b.sessionId,"sess_B");assert.ok(Object.isFrozen(a));
});
test("cache and reasoning are breakdowns, never added to normalized total",()=>{
  const fact=normalizeFact({id:"one",input_tokens:100,output_tokens:20,cache_read_input_tokens:80,
    reasoning_tokens:10,computed_total_tokens:120,raw_usage_json:'{"inputTokens":100,"outputTokens":20}'});
  const total=summarizeFacts([fact]);assert.equal(total.totalTokens,120);assert.equal(total.cacheHitRate,.8);
});
test("missing provider usage is unknown while explicitly reported zero is zero",()=>{
  const absent=normalizeFact({id:"missing",input_tokens:0,output_tokens:0,computed_total_tokens:0,raw_usage_json:null});
  const zero=normalizeFact({id:"zero",input_tokens:0,output_tokens:0,computed_total_tokens:0,raw_usage_json:'{"inputTokens":0,"outputTokens":0}'});
  assert.equal(absent.inputTokens,null);assert.equal(zero.inputTokens,0);
  assert.equal(summarizeFacts([absent,zero]).missingUsageCount,1);
});
test("delta reconstructs before source filtering; a sidecar full snapshot breaks append continuity safely",()=>{
  const base=foldRecord(modelRecord("sess_A","a",[{role:"system",content:"rules"},{role:"user",content:"hello"}]));
  const next=foldRecord(modelRecord("sess_A","b",[{role:"assistant",content:"hi"}],{request:{messagesKind:"delta",messageOffset:2,messageCount:3,messages:[{role:"assistant",content:"hi"}]}}),base);
  assert.equal(next.messages.complete,true);assert.equal(next.messages.items.length,3);
  assert.equal(diffRecords(base,next).added.length,1);
  const compact=foldRecord(modelRecord("sess_A","c",[{role:"user",content:"summarize"}],{querySource:"compact"}),next);
  assert.equal(diffRecords(next,compact).available,false);
});
test("delta with an absent prefix and tail snapshots never claim complete reconstruction",()=>{
  const delta=foldRecord(modelRecord("sess_A","b",[],{request:{messages:[{role:"user",content:"tail"}],messagesKind:"delta",messageOffset:8,messageCount:9}}));
  assert.equal(delta.messages.complete,false);assert.equal(delta.messages.reason,"missing_baseline");
  const tail=foldRecord(modelRecord("sess_A","c",[],{request:{messages:[{role:"user",content:"tail"}],messagesKind:"tail",messageOffset:8,messageCount:9}}));
  assert.equal(tail.messages.complete,false);assert.equal(diffRecords(delta,tail).available,false);
});
test("diff preserves duplicate message counts and detects changed order",()=>{
  const a=foldRecord(modelRecord("s","a",[{role:"user",content:"x"},{role:"user",content:"x"},{role:"user",content:"y"}]));
  const b=foldRecord(modelRecord("s","b",[{role:"user",content:"y"},{role:"user",content:"x"}]));
  const diff=diffRecords(a,b);assert.equal(diff.removed.length,1);assert.equal(diff.added.length,0);assert.equal(diff.reordered,true);
});
test("an unrecorded schema set is not treated as a tool removal",()=>{
  const a=foldRecord(modelRecord("s","a",[],{request:{messages:[],body:{tools:[{name:"read"}]}}}));
  const b=foldRecord(modelRecord("s","b",[]));
  const diff=diffRecords(a,b);assert.equal(diff.removed.length,0);assert.equal(diff.schemasComparable,false);
});
test("composition clearly reports estimates and schema coverage",()=>{
  const record=foldRecord(modelRecord("s","a",[{role:"tool",toolName:"Read",content:"output"}]));
  const result=composition(record);assert.equal(result.tokenMethod,"script_weighted");assert.equal(result.schemasRecorded,false);
});
test("compaction requires an explicit matching-session event; a size drop is not a cause",()=>{
  const record={sessionId:"sess_A",event:"compact.micro.applied",timestamp:"2026-10-12T12:00:00Z",context:{trigger:"token_pressure",tokensSaved:300}};
  assert.equal(contextEvent(record,"sess_B"),null);assert.equal(contextEvent(record,"sess_A").evidence,"logged");
  assert.equal(contextEvent({...record,event:"context_usage_snapshot"},"sess_A"),null);
});
test("one compaction's started and completed records merge into one event by span",()=>{
  const log=(event,timestamp,extra={})=>contextEvent({sessionId:"sess_A",event,timestamp,turnId:"turn_1",spanId:"span_1",context:{},...extra},"sess_A");
  const [event,...rest]=mergeEvents([log("compact.completed","2026-10-13T09:08:42.556Z",{durationMs:71691}),log("compact.started","2026-10-13T09:07:30.866Z")]);
  assert.equal(rest.length,0);assert.equal(event.status,"completed");assert.equal(event.event,"compact.completed");assert.equal(event.durationMs,71691);
  assert.equal(event.timestamp,Date.parse("2026-10-13T09:07:30.866Z"));assert.equal(event.endedAt,Date.parse("2026-10-13T09:08:42.556Z"));
  const [running]=mergeEvents([log("compact.auto.started","2026-10-13T09:07:30.866Z")]);assert.equal(running.status,"started");assert.equal(running.endedAt,null);
  const other=log("compact.started","2026-10-13T10:00:00Z",{spanId:"span_2"});assert.equal(mergeEvents([log("compact.started","2026-10-13T09:07:30Z"),other]).length,2);
});
test("model switches, rewinds and tool registrations are context events; a first model selection is not",()=>{
  const log=(event,context,extra={})=>contextEvent({sessionId:"sess_A",event,timestamp:"2026-10-13T09:00:00Z",spanId:"span_1",context,...extra},"sess_A");
  const model=log("session.model.updated",{model:"p/b",previousModel:"p/a"});assert.equal(model.kind,"model");assert.equal(model.from,"p/a");assert.equal(model.to,"p/b");
  assert.equal(log("session.model.updated",{model:"p/b"}),null);assert.equal(log("session.model.updated",{model:"p/b",previousModel:"p/b"}),null);
  const merged=mergeEvents([log("rewind.conversation.completed",{keptMessageCount:97}),log("conversation.command.edit_user_query.completed",{},{timestamp:"2026-10-13T09:00:00.120Z"})]);
  assert.equal(merged.length,1);assert.equal(merged[0].kind,"rewind");assert.equal(merged[0].edited,true);assert.equal(merged[0].keptMessageCount,97);
  const tools=log("mcp.tools.registered",{registeredToolCount:3,serverCount:1});assert.equal(tools.kind,"tools");assert.equal(tools.toolCount,3);
  assert.equal(log("session.reasoning_effort.updated",{thoughtLevel:"max"}),null);
});
test("filename normalization follows the official convention",()=>assert.equal(sanitizeSessionSegment("sess_a.b"),"sess_a-b"));

test("legacy cache-exclusive inputs follow the stored total without changing current normalized inputs",()=>{
  const legacy=normalizeFact({id:"legacy",input_tokens:100,output_tokens:20,cache_read_input_tokens:80,
    provider_total_tokens:200,computed_total_tokens:200,raw_usage_json:'{"inputTokens":100,"outputTokens":20}'});
  assert.equal(legacy.inputTokens,180);assert.equal(legacy.totalTokens,200);
});
test("unknown trajectory encodings do not silently become full snapshots",()=>{
  const record=foldRecord(modelRecord("s","a",[{role:"user",content:"x"}],{request:{messages:[{role:"user",content:"x"}],messagesKind:"future_format"}}));
  assert.equal(record.messages.complete,false);assert.equal(record.messages.reason,"unsupported_encoding");
});

test("field-level absence stays unknown even when another usage field is reported",()=>{
  const fact=normalizeFact({id:"partial",input_tokens:100,output_tokens:0,cache_read_input_tokens:0,raw_usage_json:'{"inputTokens":100}'});
  assert.equal(fact.inputTokens,100);assert.equal(fact.outputTokens,null);assert.equal(fact.cacheReadTokens,null);
  assert.equal(summarizeFacts([fact]).cacheHitRate,null);
  const totalOnly=normalizeFact({id:"total",input_tokens:0,output_tokens:0,computed_total_tokens:0,provider_total_tokens:50,raw_usage_json:'{"totalTokens":50}'});
  assert.equal(totalOnly.inputTokens,null);assert.equal(totalOnly.totalTokens,50);
});

test("token estimates weigh CJK characters far above Latin ones and stay consistent across composition and deltas",()=>{
  assert.equal(estimateTokens(""),0);
  assert.equal(estimateTokens("abcdefgh"),2);
  assert.equal(estimateTokens("检查缓存过期逻辑"),6);
  assert.equal(estimateTokens("こんにちは안녕"),5);
  assert.equal(estimateTokens("😀😀"),1);
  // Mixed text adds its parts, so English-only estimates are unchanged by the CJK weighting.
  assert.equal(estimateTokens("abcd检查缓"),3);
  const chinese="请检查缓存过期逻辑并修复".repeat(20),english="Please check the cache expiry logic and fix it".repeat(5);
  const before=foldRecord(modelRecord("s","a",[{role:"user",content:english}]));
  const after=foldRecord(modelRecord("s","b",[{role:"user",content:english},{role:"user",content:chinese}]));
  const cn=composition(after).buckets.find(x=>x.role==="user").estimatedTokens-composition(before).buckets.find(x=>x.role==="user").estimatedTokens;
  assert.ok(cn>=chinese.length/1.5,"Chinese content counts at least one token per 1.5 characters");
  const diff=diffRecords(before,after);
  assert.equal(diff.tokensDelta,cn);
  assert.equal(diff.categories.find(x=>x.role==="user").tokensDelta,cn);
  assert.equal(composition(after).tokenMethod,"script_weighted");
});
test("compaction statuses follow ZCode's timeline values; a retry, cancellation or skip is never shown as completed",()=>{
  const part=(id,data)=>[id,{id,messageId:"m",created:1000,type:"compaction",raw:JSON.stringify({operationId:"op_"+id,time:{start:1000,end:1500},...data})}];
  const events=conversationEvents({messages:new Map(),parts:new Map([part("a",{timelineStatus:"retrying"}),part("b",{timelineStatus:"interrupted"}),part("c",{timelineStatus:"skipped"}),
    part("d",{timelineStatus:"boundary_pending"}),part("e",{timelineStatus:"failed"}),part("f",{compactBoundary:{boundaryId:"bd_f",summarizedMessageCount:3}})])});
  const status=Object.fromEntries(events.map(e=>[e.id,e.status]));
  assert.deepEqual(status,{"c:op_a":"retrying","c:op_b":"interrupted","c:op_c":"skipped","c:op_d":"unknown","c:op_e":"failed","c:bd_f":"completed"});
  assert.equal(events.find(e=>e.id==="c:op_a").endedAt,null);assert.equal(events.find(e=>e.id==="c:op_b").endedAt,1500);
  const log=(event,extra={})=>contextEvent({sessionId:"sess_A",event,timestamp:"2026-10-13T09:00:00Z",turnId:"turn_1",spanId:"span_1",context:{},...extra},"sess_A");
  const [failed]=mergeEvents([log("compact.started"),log("compact.failed",{timestamp:"2026-10-13T09:00:05Z",status:"failed"})]);
  assert.equal(failed.status,"failed");assert.equal(failed.endedAt,Date.parse("2026-10-13T09:00:05Z"));
  const [cancelled]=mergeEvents([log("compact.started"),log("compact.failed",{timestamp:"2026-10-13T09:00:05Z",status:"cancelled"})]);
  assert.equal(cancelled.status,"interrupted");
});
test("event token estimates use the script-weighted measure, scaled from a sample for long outputs",()=>{
  const chinese="请检查缓存过期逻辑并修复",output=chinese.repeat(100),sample=output.slice(0,400);
  const [skill]=conversationEvents({messages:new Map(),parts:new Map([["s",{id:"s",messageId:"m",created:1,type:"tool",tool:"Skill",skill:"demo",outputChars:output.length,outputSample:sample}]])});
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=3,actual+" ≈ "+expected);
  near(skill.tokens,estimateTokens(output));
  const input=JSON.stringify({file_path:"a.ts"});
  const [tool]=summarizedItems([{role:"assistant",parts:[{type:"tool",tool:"Read",inputFields:{file_path:"a.ts"},inputChars:input.length,inputSample:input,outputChars:output.length,outputSample:sample}]}]);
  near(tool.tokens,estimateTokens(input)+estimateTokens(output));assert.equal(tool.title,"a.ts");
  assert.ok(skill.tokens>output.length/1.5-1,"Chinese output is not counted at a quarter token per character");
});

test("the SQL usage aggregate equals the per-request normalization summed",async()=>{
  const root=await mkdtemp(join(tmpdir(),"context-usage-parity-"));
  try {
    const fixture=usageDatabase(root),now=Date.now();
    const insert=fixture.db.prepare("INSERT INTO model_usage(id,session_id,status,started_at,input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens,provider_total_tokens,computed_total_tokens,retry_count,raw_usage_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const rows=[["excluded-cache","completed",100,20,80,0,null,120,0,'{"inputTokens":100,"outputTokens":20}'],
      ["included-cache","completed",20,20,80,0,120,null,1,'{"inputTokens":20,"outputTokens":20}'],
      ["cache-write","completed",50,10,0,30,null,null,0,'{"inputTokens":50,"outputTokens":10,"cacheWriteTokens":30}'],
      ["absent","completed",0,0,0,0,null,0,0,null],["zero","completed",0,0,0,0,null,0,0,'{"inputTokens":0,"outputTokens":0}'],
      ["input-only","error",100,0,0,0,null,null,2,'{"inputTokens":100}'],["total-only","completed",0,0,0,0,50,0,0,'{"totalTokens":50}']];
    for(const [i,[id,status,...v]] of rows.entries())insert.run(id,"sess_A",status,now-1000+i,...v);
    const usage=readUsage(fixture.path,"sess_A",now),expected=summarizeFacts(usage.facts);
    assert.equal(usage.facts.length,rows.length);
    for(const key of ["requestCount","reportedCount","missingUsageCount","inputTokens","outputTokens","totalTokens","errorCount","retryCount"])
      assert.equal(usage.totals[key],expected[key],key);
    assert.ok(Math.abs(usage.totals.cacheHitRate-expected.cacheHitRate)<1e-12);
    fixture.db.close();
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("a long injected part without a digest is not located by its prefix",()=>{
  const cache={messages:new Map([["m",{id:"m",role:"user",created:1,kind:"restored_context",origin:"agent_runtime"}]]),
    parts:new Map([["p",{id:"p",messageId:"m",created:1,type:"text",synthetic:1,text:"x".repeat(4000),textChars:3000000,truncated:true,verify:null}]])};
  const [event]=conversationEvents(cache);
  assert.equal(event.needles,null);assert.equal(event.truncated,true);
});
