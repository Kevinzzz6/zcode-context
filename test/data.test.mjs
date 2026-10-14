import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { usageDatabase, modelRecord, conversationStore } from "./fixtures.mjs";
import { readConversation, readSummarizedMessages } from "../src/data/conversation.mjs";
import { conversationEvents } from "../src/domain/events.mjs";
import { readUsage } from "../src/data/sqlite.mjs";
import { JsonlTail } from "../src/data/jsonl.mjs";
import { ContextDataService } from "../src/data/service.mjs";
async function temporary(callback){const path=await mkdtemp(join(tmpdir(),"zcode-context-test-"));try{await callback(path);}finally{await rm(path,{recursive:true,force:true});}}
test("read-only SQLite observes uncheckpointed WAL and isolates sessions",()=>temporary(async root=>{
  const fixture=usageDatabase(root);
  try {
    fixture.add("sess_A","a",100,10);fixture.add("sess_B","b",900,90);
    assert.ok(existsSync(fixture.path+"-wal"));
    assert.equal(readUsage(fixture.path,"sess_A").totals.inputTokens,100);
    fixture.add("sess_A","c",200,20);
    assert.equal(readUsage(fixture.path,"sess_A").totals.inputTokens,300);
    assert.equal(readUsage(fixture.path,"sess_B").totals.inputTokens,900);
    assert.equal(fixture.db.prepare("select count(*) as n from model_usage").get().n,3);
  }finally{fixture.db.close();}
}));
test("retention window and overview totals are independent of the recent timeline cap",()=>temporary(async root=>{
  const fixture=usageDatabase(root);const now=Date.now();
  try {
    fixture.add("sess_A","old",999,99,now-31*86400000);
    for(let i=0;i<100;i++)fixture.add("sess_A","r"+i,100,10,now-i*1000);
    const result=readUsage(fixture.path,"sess_A",now);
    assert.equal(result.totals.requestCount,100);assert.equal(result.totals.inputTokens,10000);
    assert.equal(result.facts.length,80);assert.equal(result.timelineLimited,true);
  }finally{fixture.db.close();}
}));
test("missing databases are not created",()=>temporary(async root=>{
  const path=join(root,"absent.sqlite");assert.equal(readUsage(path,"sess_A").available,false);assert.equal(existsSync(path),false);
}));
test("JSONL buffers partial UTF-8 lines and invalidates replaced file state",()=>temporary(async root=>{
  const path=join(root,"model.jsonl");const bytes=Buffer.from(JSON.stringify({text:"你好🙂"})+"\n");
  await writeFile(path,bytes.subarray(0,bytes.length-3));
  const reader=new JsonlTail();const rows=[];let resets=0;
  await reader.scan(path,row=>rows.push(row),()=>resets++);
  assert.equal(rows.length,0);await appendFile(path,bytes.subarray(bytes.length-3));
  await reader.scan(path,row=>rows.push(row),()=>resets++);assert.equal(rows[0].text,"你好🙂");
  await writeFile(path,'{"text":"new"}\n');await reader.scan(path,row=>rows.push(row),()=>resets++);
  assert.equal(rows.at(-1).text,"new");assert.ok(resets>=2);
}));
test("a transient read failure keeps the JSONL position instead of reading the window again",()=>temporary(async root=>{
  const path=join(root,"model.jsonl");await writeFile(path,'{"n":1}\n');
  let busy=false;const opener=(...args)=>busy?Promise.reject(Object.assign(new Error("busy"),{code:"EBUSY"})):open(...args);
  const reader=new JsonlTail(opener);const rows=[];let resets=0;
  await reader.scan(path,row=>rows.push(row),()=>resets++);
  busy=true;const failed=await reader.scan(path,row=>rows.push(row),()=>resets++);busy=false;
  assert.equal(failed.available,false);assert.equal(failed.code,"file_unavailable");
  await appendFile(path,'{"n":2}\n');const after=await reader.scan(path,row=>rows.push(row),()=>resets++);
  assert.deepEqual(rows.map(x=>x.n),[1,2]);assert.equal(resets,1);assert.equal(after.generation,1);
  await rm(path);assert.equal((await reader.scan(path,()=>{})).code,"trajectory_missing");
  await writeFile(path,'{"n":3}\n');await reader.scan(path,row=>rows.push(row),()=>resets++);assert.equal(resets,2);
}));
test("malformed complete rows are marked; unfinished rows are not",()=>temporary(async root=>{
  const path=join(root,"model.jsonl");await writeFile(path,'bad json\n{"text":"unfinished"');
  const reader=new JsonlTail();const result=await reader.scan(path,()=>{});
  assert.deepEqual(result.coverage,["malformed_line"]);assert.equal(result.pendingLine,true);
}));
test("retained usage survives trajectory loss; request keys cannot cross sessions",()=>temporary(async root=>{
  const fixture=usageDatabase(root);fixture.add("sess_A","a",100,10);fixture.add("sess_B","b",900,90);
  await mkdir(join(root,"rollout"));await mkdir(join(root,"log"));
  await writeFile(join(root,"rollout","model-io-sess_A.jsonl"),JSON.stringify(modelRecord("sess_A","reqA",[{role:"user",content:"only A"}]))+"\n");
  const service=new ContextDataService({db:fixture.path,trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")});
  try{
    const a=await service.overview("sess_A");const b=await service.overview("sess_B");
    assert.equal(a.sessionId,"sess_A");assert.equal(b.usage.totals.inputTokens,900);assert.equal(b.trajectory.available,false);
    const key=a.trajectories[0].key;await assert.rejects(service.request("sess_B",{key}),{code:"request_expired"});
    const detail=await service.request("sess_A",{key,elementKey:"message:0"});assert.match(detail.content.text,/only A/);
  }finally{fixture.db.close();}
}));
test("a foreign session in the named trajectory file is never displayed",()=>temporary(async root=>{
  await mkdir(join(root,"rollout"));
  await writeFile(join(root,"rollout","model-io-sess_A.jsonl"),JSON.stringify(modelRecord("sess_B","reqB",[{role:"user",content:"secret B"}]))+"\n");
  const service=new ContextDataService({db:join(root,"missing.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")});
  const result=await service.overview("sess_A");assert.equal(result.trajectories.length,0);
}));

test("SQLite aggregates preserve field-level missing usage",()=>temporary(async root=>{
  const fixture=usageDatabase(root);
  try {
    fixture.add("sess_partial","partial",100,0,Date.now(),{inputTokens:100});
    fixture.db.prepare("UPDATE model_usage SET cache_read_input_tokens=0 WHERE id=?").run("partial");
    const result=readUsage(fixture.path,"sess_partial");
    assert.equal(result.totals.inputTokens,100);assert.equal(result.totals.outputTokens,null);assert.equal(result.totals.cacheHitRate,null);
    fixture.add("sess_total","total",0,0,Date.now(),{totalTokens:50});
    fixture.db.prepare("UPDATE model_usage SET provider_total_tokens=50 WHERE id=?").run("total");
    const total=readUsage(fixture.path,"sess_total");
    assert.equal(total.totals.inputTokens,null);assert.equal(total.totals.totalTokens,50);
  } finally {fixture.db.close();}
}));

test("child sessions receive their own recorded-input composition",()=>temporary(async root=>{
  await mkdir(join(root,"rollout"));
  const record=modelRecord("sess_child","child_request",[{role:"user",content:"child input"}],{querySource:"subagent"});
  await writeFile(join(root,"rollout","model-io-sess_child.jsonl"),JSON.stringify(record)+"\n");
  const service=new ContextDataService({db:join(root,"missing.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")});
  const result=await service.overview("sess_child");assert.equal(result.composition.complete,true);assert.equal(result.composition.buckets[0].role,"user");
}));

test("old request handles cannot resolve a different snapshot after worker restart",()=>temporary(async root=>{
  await mkdir(join(root,"rollout"));const path=join(root,"rollout","model-io-sess_A.jsonl");
  const first=modelRecord("sess_A","req1",[{role:"user",content:"x"}]);
  await writeFile(path,JSON.stringify(first)+"\n");
  const paths={db:join(root,"missing.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")};
  const one=new ContextDataService(paths);const oldKey=(await one.overview("sess_A")).trajectories[0].key;
  await writeFile(path,JSON.stringify({...first,requestId:"req2",request:{...first.request,messages:[{role:"user",content:"y"}]}})+"\n");
  const two=new ContextDataService(paths);const newKey=(await two.overview("sess_A")).trajectories[0].key;
  assert.notEqual(oldKey,newKey);await assert.rejects(two.request("sess_A",{key:oldKey}),{code:"request_expired"});
}));

test("replacing content with identical request metadata cannot reuse a request handle",()=>temporary(async root=>{
  await mkdir(join(root,"rollout"));const path=join(root,"rollout","model-io-sess_A.jsonl");
  const first=modelRecord("sess_A","same_request",[{role:"user",content:"before"}]);
  const paths={db:join(root,"missing.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")};
  await writeFile(path,JSON.stringify(first)+"\n");
  const oldKey=(await new ContextDataService(paths).overview("sess_A")).trajectories[0].key;
  await writeFile(path,JSON.stringify({...first,request:{...first.request,messages:[{role:"user",content:"after!"}]}})+"\n");
  const restarted=new ContextDataService(paths);const result=await restarted.overview("sess_A");
  assert.notEqual(result.trajectories[0].key,oldKey);
  await assert.rejects(restarted.request("sess_A",{key:oldKey}),{code:"request_expired"});
}));

test("repeated malformed rows keep coverage memory bounded",()=>temporary(async root=>{
  const path=join(root,"model.jsonl");const reader=new JsonlTail();await writeFile(path,"bad\n".repeat(2000));
  await reader.scan(path,()=>{});await appendFile(path,"bad\n".repeat(2000));await reader.scan(path,()=>{});
  assert.deepEqual(reader.coverage,["malformed_line"]);
}));

test("a recorded file reset cannot borrow a pre-reset delta baseline",()=>temporary(async root=>{
  await mkdir(join(root,"rollout"));const path=join(root,"rollout","model-io-sess_A.jsonl");
  const first=modelRecord("sess_A","first",[{role:"user",content:"obsolete prefix"}]);
  const reset=modelRecord("sess_A","reset",[],{modelIOReset:{reason:"session_file_size_limit"},request:{
    messages:[{role:"user",content:"new tail"}],messagesKind:"delta",messageOffset:1,messageCount:2}});
  await writeFile(path,[first,reset].map(JSON.stringify).join("\n")+"\n");
  const service=new ContextDataService({db:join(root,"missing.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")});
  const result=await service.overview("sess_A");const detail=await service.request("sess_A",{key:result.trajectories.at(-1).key,elementKey:"message:0"});
  assert.equal(detail.summary.complete,false);assert.equal(detail.diff.available,false);
  assert.ok(result.trajectory.coverage.includes("history_reset"));assert.doesNotMatch(detail.content.text,/obsolete prefix/);
}));

test("mixed complete and partial usage marks incomplete aggregate fields",()=>temporary(async root=>{
  const fixture=usageDatabase(root);
  try {
    fixture.add("sess_A","complete",100,10);fixture.add("sess_A","partial",200,0,Date.now(),{inputTokens:200});
    const {totals}=readUsage(fixture.path,"sess_A");
    assert.equal(totals.inputTokens,300);assert.equal(totals.outputTokens,10);
    assert.equal(totals.inputMissingCount,0);assert.equal(totals.outputMissingCount,1);assert.equal(totals.totalMissingCount,0);
  } finally {fixture.db.close();}
}));

test("removed diff elements resolve through the exact previous snapshot handle",()=>temporary(async root=>{
  await mkdir(join(root,"rollout"));const path=join(root,"rollout","model-io-sess_A.jsonl");
  const first=modelRecord("sess_A","first",[{role:"user",content:"removed text"}]);
  const second=modelRecord("sess_A","second",[{role:"user",content:"added text"}]);
  await writeFile(path,[first,second].map(JSON.stringify).join("\n")+"\n");
  const service=new ContextDataService({db:join(root,"missing.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")});
  const result=await service.overview("sess_A");const selected=await service.request("sess_A",{key:result.trajectories.at(-1).key});
  assert.equal(selected.diff.addedCount,1);assert.equal(selected.diff.removedCount,1);
  const previous=await service.request("sess_A",{key:selected.diff.previousKey,elementKey:selected.diff.removed[0].key});
  assert.match(previous.content.text,/removed text/);assert.doesNotMatch(previous.content.text,/added text/);
  await assert.rejects(service.request("sess_B",{key:selected.diff.previousKey}),{code:"request_expired"});
}));
test("the conversation store is read incrementally, reloads after a deletion and fails closed on another schema",async()=>{
  const root=await mkdtemp(join(tmpdir(),"zcode-context-conversation-"));
  try {
    const fixture=usageDatabase(root),store=conversationStore(fixture.db),now=Date.now();
    store.prompt("sess_A","u1",now-3000,"hello");store.reminder("sess_A","r1",now-2000,"reminder one");store.reminder("sess_B","rb",now-2000,"other session");
    const first=readConversation(fixture.path,"sess_A");
    assert.equal(first.available,true);assert.deepEqual(conversationEvents(first.cache).map(e=>e.id),["m:r1"]);
    assert.equal(readConversation(fixture.path,"sess_A",first.cache).changed,false);
    store.reminder("sess_A","r2",now-1000,"reminder two");
    const second=readConversation(fixture.path,"sess_A",first.cache);
    assert.equal(second.changed,true);assert.deepEqual(conversationEvents(second.cache).map(e=>e.id),["m:r1","m:r2"]);
    store.remove("r1");
    const third=readConversation(fixture.path,"sess_A",second.cache);
    assert.deepEqual(conversationEvents(third.cache).map(e=>e.id),["m:r2"]);
    // A deletion offset by new rows in the same poll leaves the counts unchanged; the removed event still goes.
    store.remove("r2");store.reminder("sess_A","r3",now-500,"reminder three");store.prompt("sess_A","u2",now-400,"again");
    const fourth=readConversation(fixture.path,"sess_A",third.cache);
    assert.deepEqual(conversationEvents(fourth.cache).map(e=>e.id),["m:r3"]);
    assert.ok([...fourth.cache.parts.values()].every(part=>part.type!=="text"||part.synthetic===1));
    // A row below the cursor (a restored or backfilled database) is never returned by the incremental query.
    store.reminder("sess_A","old",now-9000,"restored reminder");
    const fifth=readConversation(fixture.path,"sess_A",fourth.cache);
    assert.deepEqual(conversationEvents(fifth.cache).map(e=>e.id),["m:old","m:r3"]);
    fixture.db.exec("DROP TABLE part");
    assert.equal(readConversation(fixture.path,"sess_A").code,"schema_unsupported");
    fixture.db.close();
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("a rotated second source does not keep an injection on a step it no longer has",()=>temporary(async root=>{
  const fixture=usageDatabase(root),store=conversationStore(fixture.db),now=Date.now(),at=ms=>new Date(now+ms).toISOString(),text="Background task finished.";
  store.reminder("sess_A","n1",now-5000,text,"background_notification","background_task");
  for(const dir of ["rollout","debug","log"])await mkdir(join(root,dir));
  const line=(id,ms,messages)=>JSON.stringify(modelRecord("sess_A",id,messages,{startedAt:at(ms)}))+"\n";
  await writeFile(join(root,"rollout","model-io-sess_A.jsonl"),line("main",-10000,[{role:"user",content:"main"}]));
  const debug=join(root,"debug","model-io-sess_A.jsonl");
  await writeFile(debug,line("d0",-9000,[{role:"user",content:"start"}])+line("d1",-2000,[{role:"user",content:"start"},{role:"user",content:text}]));
  const service=new ContextDataService({db:fixture.path,trajectoryDirs:[join(root,"rollout"),join(root,"debug")],logDir:join(root,"log")});
  try{
    const before=await service.overview("sess_A"),step=before.events.find(e=>e.id==="m:n1").stepKey;
    assert.ok(step);
    await writeFile(debug,line("rotated",-1000,[{role:"user",content:"rotated file"}]));
    const after=await service.overview("sess_A"),keys=after.history.loadedKeys;
    assert.ok(!keys.includes(step));assert.equal(after.events.find(e=>e.id==="m:n1").stepKey,null);
  }finally{fixture.db.close();}
}));
test("summarized tool calls bring only title fields and a bounded sample of their input into JavaScript",()=>temporary(async root=>{
  const fixture=usageDatabase(root),store=conversationStore(fixture.db),now=Date.now();
  store.prompt("sess_A","u1",now-9000,"write it");
  store.reply("sess_A","a1",now-8000,"Writing.",[["Write",{file_path:"src/big.ts",content:"y".repeat(500000)},"ok"]]);
  try{
    const read=readSummarizedMessages(fixture.path,"sess_A",{through:2});
    const tool=read.messages[1].parts.find(x=>x.type==="tool");
    assert.equal(tool.input,undefined);assert.ok(tool.inputSample.length<=400);assert.ok(tool.inputChars>500000);
    assert.deepEqual(tool.inputFields,{file_path:"src/big.ts"});
  }finally{fixture.db.close();}
}));
test("the session cache evicts the least recently used session",()=>{
  const service=new ContextDataService({db:"x",trajectoryDirs:[],logDir:"x"}),first=service.state("sess_0");
  for(let i=1;i<8;i++)service.state("sess_"+i);
  assert.equal(service.state("sess_0"),first);service.state("sess_8");
  assert.equal(service.sessions.has("sess_0"),true);assert.equal(service.sessions.has("sess_1"),false);
});
test("older event logs cannot push out today's events",()=>temporary(async root=>{
  await mkdir(join(root,"log"));
  const stamp=date=>date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
  const day=offset=>{const date=new Date();date.setDate(date.getDate()-offset);return date;};
  const rows=(date,n,tag)=>Array.from({length:n},(_,i)=>JSON.stringify({sessionId:"sess_A",event:"mcp.tools.registered",timestamp:new Date(Math.min(Date.now(),date.getTime())-i*1000).toISOString(),spanId:tag+i,context:{registeredToolCount:i}})).join("\n")+"\n";
  await writeFile(join(root,"log","zcode-"+stamp(day(0))+".jsonl"),rows(day(0),60,"today"));
  await writeFile(join(root,"log","zcode-"+stamp(day(1))+".jsonl"),rows(day(1),250,"yesterday"));
  const service=new ContextDataService({db:join(root,"absent.sqlite"),trajectoryDirs:[],logDir:join(root,"log")});
  await service.refresh("sess_A");
  const spans=[...service.state("sess_A").events.values()].map(e=>e.spanId);
  assert.equal(spans.filter(x=>x.startsWith("today")).length,60);assert.equal(spans.length,200);
}));
