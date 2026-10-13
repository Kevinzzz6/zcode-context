import test from "node:test";
import assert from "node:assert/strict";
import {readSessionContext,sanitizeSessionSegment} from "../src/domain/session.mjs";
import {normalizeFact,summarizeFacts} from "../src/domain/usage.mjs";
import {foldRecord,diffRecords,composition,estimateTokens} from "../src/domain/trajectory.mjs";
import {compactEvent} from "../src/domain/events.mjs";
import {modelRecord} from "./fixtures.mjs";
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
  assert.equal(compactEvent(record,"sess_B"),null);assert.equal(compactEvent(record,"sess_A").evidence,"logged");
  assert.equal(compactEvent({...record,event:"context_usage_snapshot"},"sess_A"),null);
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
