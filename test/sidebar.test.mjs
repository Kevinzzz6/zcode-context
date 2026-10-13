import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ContextDataService} from "../src/data/service.mjs";
import {expandCollection,foldRecord,diffRecords,inputElements,toolEvidence,attemptUsage,textDifference,elementSummary,trajectorySummary} from "../src/domain/trajectory.mjs";
import {modelRecord,usageDatabase} from "./fixtures.mjs";
async function fixture(records,callback,events=[],tools=null) {
  const root=await mkdtemp(join(tmpdir(),"context-sidebar-"));
  try {
    await mkdir(join(root,"rollout"));await mkdir(join(root,"log"));
    await writeFile(join(root,"rollout","model-io-sess_A.jsonl"),records.map(x=>typeof x==="string"?x:JSON.stringify(x)).join("\n")+"\n");
    const date=new Date(),stamp=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
    await writeFile(join(root,"log","zcode-"+stamp+".jsonl"),events.map(JSON.stringify).join("\n")+"\n");
    const db=tools?usageDatabase(root):null;
    for(const [i,[sessionId,name,status]] of (tools??[]).entries())db.tool(sessionId,"t"+i,name,status);
    const service=new ContextDataService({db:db?db.path:join(root,"absent.sqlite"),trajectoryDirs:[join(root,"rollout")],logDir:join(root,"log")});
    try{await callback(service,await service.overview("sess_A"));}finally{db?.db.close();}
  }finally{await rm(root,{recursive:true,force:true});}
}
test("search and largest-content location cover elements beyond the first 40-row page",()=>{
  const messages=Array.from({length:85},(_,i)=>({role:"tool",content:i===84?"UNIQUE_NEEDLE "+"x".repeat(25000):"small "+i}));
  return fixture([modelRecord("sess_A","large",messages)],async(service,o)=>{
    const key=o.trajectories[0].key;
    const first=await service.request("sess_A",{key,sort:"order"});assert.equal(first.elements.length,40);assert.equal(first.largest.key,"message:84");
    const result=await service.request("sess_A",{key,search:"unique_needle"});assert.equal(result.filteredCount,1);assert.equal(result.elements[0].key,"message:84");
    const body=await service.request("sess_A",{key,elementKey:"message:84",bodySearch:"unique_needle"});
    assert.equal(body.content.text.length,12000);assert.equal(body.content.matchCount,1);assert.equal(body.content.hits[0],0);
    const raw=await service.request("sess_A",{key,elementKey:"message:84",format:"raw",offset:24000});assert.ok(raw.content.text.length<12000);
  });
});
test("full snapshots separated by a malformed row cannot produce a deletion or negative Delta",()=>fixture([
  modelRecord("sess_A","one",[{role:"user",content:"x".repeat(10000)}]),"invalid json",
  modelRecord("sess_A","two",[{role:"user",content:"small"}])],async(service,o)=>{
    assert.equal(o.trajectories.at(-1).delta,null);
    const d=await service.request("sess_A",{key:o.trajectories.at(-1).key});assert.equal(d.diff.available,false);assert.equal(d.diff.reason,"history_gap");
  }));
test("history remains bounded and pages through more than 60 loaded snapshots",()=>fixture(
  Array.from({length:75},(_,i)=>modelRecord("sess_A","r"+i,[{role:"user",content:String(i)}],{startedAt:new Date(Date.now()-100000+i*1000).toISOString()})),
  async(service,o)=>{
    assert.equal(o.trajectories.length,60);assert.equal(o.history.hasOlder,true);
    const older=await service.overview("sess_A",undefined,1);assert.equal(older.trajectories.length,15);assert.equal(older.history.hasOlder,false);
    assert.notEqual(older.revision,o.revision);const again=await service.overview("sess_A",older.revision,1);assert.equal(again.unchanged,true);
  }));
test("schema replacements have category Delta and bounded unified body Diff with verified identity",()=>fixture([
  modelRecord("sess_A","before",[],{request:{messages:[],body:{tools:[{name:"Read",description:"before",parameters:{type:"object"}}]}}}),
  modelRecord("sess_A","after",[],{request:{messages:[],body:{tools:[{name:"Read",description:"after",parameters:{type:"object"}}]}}})],async(service,o)=>{
    const key=o.trajectories.at(-1).key,d=await service.request("sess_A",{key});assert.equal(d.diff.changedCount,1);
    assert.equal(d.diff.categories[0].role,"schema");
    const body=await service.request("sess_A",{key,elementKey:"tool:0",diffBeforeElement:"tool:0"});
    assert.match(body.bodyDiff.text,/- .*before/);assert.match(body.bodyDiff.text,/\+ .*after/);
    await assert.rejects(service.request("sess_B",{key,elementKey:"tool:0",diffBeforeElement:"tool:0"}),{code:"request_expired"});
  }));
test("explicit baseline selection respects source, completeness and chronology",()=>fixture([
  modelRecord("sess_A","a",[{role:"user",content:"a"}]),
  modelRecord("sess_A","b",[{role:"user",content:"bb"}],{querySource:"compact"}),
  modelRecord("sess_A","c",[{role:"user",content:"ccc"}])],async(service,o)=>{
    const [a,b,c]=o.trajectories;
    const valid=await service.request("sess_A",{key:c.key,baselineKey:a.key});assert.equal(valid.diff.previousKey,a.key);assert.equal(valid.diff.available,true);
    const source=await service.request("sess_A",{key:c.key,baselineKey:b.key});assert.equal(source.diff.reason,"different_query_source");
    const future=await service.request("sess_A",{key:a.key,baselineKey:c.key});assert.equal(future.diff.reason,"invalid_baseline");
  }));
test("compact navigation exposes turn or time range evidence without claiming exact attempt identity",()=>{
  const now=Date.now(),event={sessionId:"sess_A",event:"compact.auto.completed",turnId:"turn_test",timestamp:new Date(now).toISOString()};
  return fixture([
    modelRecord("sess_A","before",[{role:"user",content:"before"}],{startedAt:new Date(now-1000).toISOString(),turnId:"turn_test"}),
    modelRecord("sess_A","after",[{role:"user",content:"after"}],{startedAt:new Date(now+1000).toISOString(),turnId:"turn_next"})],async(service,o)=>{
      assert.equal(o.events[0].navigation.evidence,"turn_range");assert.equal(o.events[0].navigation.beforeKey,o.trajectories[0].key);
      assert.equal(o.events[0].navigation.afterKey,o.trajectories[1].key);assert.ok(!("requestKey" in o.events[0]));
    },[event]);
});
test("tool parameters only pair by a unique recorded call ID",()=>{
  const message={role:"assistant",tool_calls:[{id:"call_1",function:{name:"Read",arguments:'{"path":"cache.ts"}'}}]};
  const result={role:"tool",tool_call_id:"call_1",content:"result"};
  const record=foldRecord(modelRecord("s","r",[message,result]));assert.equal(toolEvidence(record,inputElements(record)[1]).name,"Read");
  const ambiguous=foldRecord(modelRecord("s","r",[message,message,result]));assert.equal(toolEvidence(ambiguous,inputElements(ambiguous)[2]),null);
});
test("similar ordinary messages never create guessed body replacements",()=>{
  const a=foldRecord(modelRecord("s","a",[{role:"user",content:"one"}])),b=foldRecord(modelRecord("s","b",[{role:"user",content:"two"}]));
  assert.equal(diffRecords(a,b).changed.length,0);assert.equal(diffRecords(a,b).added.length,1);
});
test("attempt usage keeps missing fields unknown and zero known",()=>{
  assert.deepEqual(attemptUsage({inputTokens:0,outputTokens:10}),{inputTokens:0,outputTokens:10,cacheReadTokens:null,cacheWriteTokens:null});
});
test("block Diff preserves unchanged boundaries around changed lines",()=>{
  const result=textDifference("a\nb\nc","a\nnew\nc");assert.deepEqual(result.map(x=>x.kind),["context","removed","added","context"]);
});
test("cross-snapshot search includes cached history and never a foreign session",()=>fixture([
  modelRecord("sess_A","old",[{role:"system",content:"OLD_HISTORY_NEEDLE"}]),
  modelRecord("sess_A","new",[{role:"user",content:"latest"}])],async(service,o)=>{
    const d=await service.request("sess_A",{key:o.trajectories[1].key,search:"old_history_needle",searchScope:"loaded"});
    assert.equal(d.filteredCount,1);assert.equal(d.elements[0].snapshotKey,o.trajectories[0].key);assert.equal(d.searchScope,"all_loaded_snapshots");
    const foreign=await service.overview("sess_B");assert.equal(foreign.trajectories.length,0);
  }));
test("SDK content-part tool results preserve recorded identity for readable tool evidence",()=>{
  const record=foldRecord(modelRecord("s","r",[
    {role:"assistant",content:[{type:"tool-call",toolCallId:"part_1",toolName:"Read",args:{path:"README.md"}}]},
    {role:"tool",content:[{type:"tool-result",toolCallId:"part_1",toolName:"Read",result:"read output",isError:true}]}
  ]));
  const item=inputElements(record)[1];assert.equal(item.toolCallId,"part_1");assert.equal(item.status,"error");
  assert.equal(item.readable,"read output");assert.equal(toolEvidence(record,item).name,"Read");
});
test("a body replacement with a very long single line cannot bypass the 12k response bound",()=>fixture([
  modelRecord("sess_A","a",[],{request:{messages:[],body:{tools:[{name:"Read",description:"a".repeat(30000)}]}}}),
  modelRecord("sess_A","b",[],{request:{messages:[],body:{tools:[{name:"Read",description:"b".repeat(30000)}]}}})],async(service,o)=>{
    const key=o.trajectories.at(-1).key;
    const first=await service.request("sess_A",{key,elementKey:"tool:0",diffBeforeElement:"tool:0"});
    assert.equal(first.bodyDiff.text.length,12000);assert.equal(first.bodyDiff.hasMore,true);
    const next=await service.request("sess_A",{key,elementKey:"tool:0",diffBeforeElement:"tool:0",offset:12000});assert.equal(next.bodyDiff.text.length,12000);
  }));
test("canonical ZCode toolCalls pair results with arguments and readable labels",()=>{
  const call={id:"c1",name:"Read",input:{file_path:"src/cache.ts",limit:20}};
  const record=foldRecord(modelRecord("s","r",[
    {role:"assistant",content:"",toolCalls:[call]},
    {role:"tool",toolCallId:"c1",toolName:"Read",content:"line\nline",isError:false},
    {role:"assistant",content:"",toolCalls:[{id:"g1",name:"Grep",input:{pattern:"ttl",path:"src"}},{id:"g2",name:"Grep",input:{pattern:"now"}}]},
    {role:"user",content:"<system-reminder>\nTodo reminder\n</system-reminder>"}
  ]));
  const elements=inputElements(record);
  const evidence=toolEvidence(record,elements[1]);
  assert.equal(evidence.name,"Read");assert.deepEqual(evidence.fields.map(x=>x.name),["file_path","limit"]);
  const [, result, calls, reminder]=elements.map(elementSummary);
  assert.equal(result.chip,"Read");assert.equal(result.title,"src/cache.ts");assert.equal(result.lines,2);
  assert.equal(calls.chip,"Grep ×2");assert.equal(calls.title,"ttl · src");
  assert.equal(reminder.chip,"reminder");assert.equal(reminder.title,"Todo reminder");
  const duplicate=foldRecord(modelRecord("s","r",[{role:"assistant",toolCalls:[call]},{role:"assistant",toolCalls:[call]},{role:"tool",toolCallId:"c1",content:"x"}]));
  assert.equal(toolEvidence(duplicate,inputElements(duplicate)[2]),null);
});
test("summaries skip system reminders and keep response tool calls",()=>{
  const record=foldRecord(modelRecord("s","r",[{role:"user",content:"真正的问题"},{role:"user",content:"<system-reminder>x</system-reminder>"}],
    {response:{text:"",toolCalls:[{id:"b",name:"Bash",input:{command:"npm test"}}],usage:{inputTokens:1}}}));
  const summary=trajectorySummary(record,"k");
  assert.equal(summary.userPreview,"真正的问题");assert.deepEqual(summary.responseCalls,[{name:"Bash",title:"npm test"}]);
});
test("step and turn ordinals count agent requests only and remain stable as the window slides",()=>fixture([
  modelRecord("sess_A","a",[{role:"user",content:"a"}],{turnId:"t1"}),
  modelRecord("sess_A","title",[{role:"user",content:"a"}],{turnId:"t1",querySource:"session_title"}),
  modelRecord("sess_A","b",[{role:"user",content:"b"}],{turnId:"t1"}),
  modelRecord("sess_A","c",[{role:"user",content:"c"}],{turnId:"t2"})],async(service,o)=>{
    assert.deepEqual(o.trajectories.map(x=>[x.step,x.turn]),[[1,1],[null,1],[2,1],[3,2]]);
  }));
test("groups give every category its own first page and changes are grouped by category",()=>fixture([
  modelRecord("sess_A","one",[{role:"system",content:"rules"},...Array.from({length:30},(_,i)=>({role:"tool",content:"old "+i}))]),
  modelRecord("sess_A","two",[{role:"system",content:"rules"},...Array.from({length:30},(_,i)=>({role:"tool",content:"old "+i})),
    ...Array.from({length:50},(_,i)=>({role:"tool",content:"new "+"x".repeat(i)})),{role:"user",content:"small"}])],async(service,o)=>{
    const d=await service.request("sess_A",{key:o.trajectories.at(-1).key});
    assert.equal(d.groups.tool.count,80);assert.equal(d.groups.tool.items.length,40);
    assert.equal(d.groups.user.count,1);assert.equal(d.groups.system.items[0].title,"rules");
    assert.equal(d.diff.addedGroups.tool.count,50);assert.equal(d.diff.addedGroups.user.count,1);assert.equal(d.diff.addedKeys.length,51);
    assert.deepEqual(d.diff.removedGroups,{});
    const more=await service.request("sess_A",{key:o.trajectories.at(-1).key,role:"tool",page:1});
    assert.equal(more.elements.length,40);assert.ok(more.elements.every(x=>x.role==="tool"));
  }));
test("tail records keep the declared message total and user previews drop injected host blocks",()=>{
  const messages=[{role:"user",content:"<in-app-browser-context source=\"ambient-ui-state\">\nstate\n</in-app-browser-context>\n\n## My request for ZCode:\n真实问题"}];
  const record=foldRecord(modelRecord("s","r",messages,{request:{messages,messagesKind:"tail",messageOffset:500,messageCount:501}}));
  const summary=trajectorySummary(record,"k");
  assert.equal(summary.complete,false);assert.equal(summary.messageTotal,501);assert.equal(summary.messageCount,1);
  assert.equal(summary.userPreview,"真实问题");assert.equal(elementSummary(inputElements(record)[0]).title,"真实问题");
});
// Production records keep only the newest messages: messagesKind "tail" with an absolute messageOffset.
const tail=(id,all,keep,extra={})=>modelRecord("sess_A",id,[],{...extra,request:{messages:all.slice(-keep),messagesKind:"tail",messageOffset:all.length-keep,messageCount:all.length,...extra.request}});
const tool=(name,size)=>({type:"function",function:{name,description:name+" "+"d".repeat(size),parameters:{type:"object"}}});
test("schema call counts come from session tool_usage, not the tail of recorded messages",()=>{
  const tools=[tool("Read",400),tool("Grep",100),tool("Write",300),tool("Unused",200)];
  const history=[{role:"system",content:"rules"},...Array.from({length:20},(_,i)=>({role:"user",content:"m"+i}))];
  return fixture([tail("r",history,4,{request:{body:{tools}}})],async(service,o)=>{
    assert.equal(o.toolCalls.available,true);assert.equal(o.toolCalls.byName.Read.count,3);assert.equal(o.toolCalls.byName.Read.errorCount,1);
    const d=await service.request("sess_A",{key:o.trajectories[0].key});
    assert.equal(d.summary.complete,false);
    const count=Object.fromEntries(d.groups.schema.items.map(x=>[x.toolName,x.callCount]));
    assert.deepEqual(count,{Read:3,Grep:1,Write:0,Unused:0});
    assert.equal(d.schemaCalls.available,true);assert.equal(d.schemaCalls.scope,"session");assert.equal(d.schemaCalls.unusedCount,2);
    const size=name=>d.groups.schema.items.find(x=>x.toolName===name).estimatedTokens;
    assert.equal(d.schemaCalls.unusedEstimatedTokens,size("Write")+size("Unused"));
    assert.deepEqual(d.groups.schema.items.map(x=>x.toolName),["Read","Write","Unused","Grep"]);
    const calls=await service.request("sess_A",{key:o.trajectories[0].key,schemaSort:"calls"});
    assert.deepEqual(calls.groups.schema.items.map(x=>x.toolName),["Read","Grep","Write","Unused"]);
    const names=await service.request("sess_A",{key:o.trajectories[0].key,schemaSort:"name"});
    assert.deepEqual(names.groups.schema.items.map(x=>x.toolName),["Grep","Read","Unused","Write"]);
    assert.deepEqual(names.groups.user.items.map(x=>x.key),d.groups.user.items.map(x=>x.key));
    const body=await service.request("sess_A",{key:o.trajectories[0].key,elementKey:"tool:0"});assert.equal(body.content.callCount,3);
  },[],[["sess_A","Read"],["sess_A","Read"],["sess_A","Read","error"],["sess_A","Grep"],["sess_B","Write"],["sess_B","Unused"]]);
});
test("schema call sort stays consistent across show-more pages",()=>{
  const tools=Array.from({length:45},(_,i)=>tool("T"+String(i).padStart(2,"0"),100+i*10));
  return fixture([modelRecord("sess_A","r",[{role:"user",content:"x"}],{request:{messages:[{role:"user",content:"x"}],body:{tools}}})],async(service,o)=>{
    const key=o.trajectories[0].key,first=await service.request("sess_A",{key,schemaSort:"calls"});
    assert.equal(first.groups.schema.count,45);assert.equal(first.groups.schema.items.length,40);
    const next=await service.request("sess_A",{key,schemaSort:"calls",role:"schema",page:1});
    const all=[...first.groups.schema.items,...next.elements];
    assert.equal(new Set(all.map(x=>x.key)).size,45);
    assert.deepEqual(all.slice(0,3).map(x=>x.toolName),["T01","T40","T00"]);
    for(let i=1;i<all.length;i++)assert.ok(all[i-1].callCount>all[i].callCount||all[i-1].callCount===all[i].callCount&&all[i-1].chars>=all[i].chars);
    assert.equal(first.schemaCalls.unusedCount,42);
  },[],[["sess_A","T01"],["sess_A","T01"],["sess_A","T01"],["sess_A","T40"],["sess_A","T40"],["sess_A","T00"]]);
});
test("without a tool_usage table call counts are unknown, never zero",()=>fixture([
  modelRecord("sess_A","r",[],{request:{messages:[],body:{tools:[tool("Read",10)]}}})],async(service,o)=>{
    assert.equal(o.toolCalls.available,false);
    const d=await service.request("sess_A",{key:o.trajectories[0].key,schemaSort:"calls"});
    assert.equal(d.groups.schema.items[0].callCount,null);assert.equal(d.schemaCalls.available,false);
  }));
test("collections report the absolute offset of their first recorded item",()=>{
  const full=expandCollection([1,2,3],"full",0,3);assert.equal(full.offset,0);
  assert.equal(expandCollection([4,5],"tail",3,5).offset,3);assert.equal(expandCollection([4,5],"tail",undefined,5).offset,null);
  assert.equal(expandCollection([4],"delta",3,4,full).offset,0);assert.equal(expandCollection([4],"delta",3,4,full).items.length,4);
  const partial=expandCollection([4,5],"tail",3,5);assert.equal(expandCollection([6],"delta",5,6,partial).offset,5);
  assert.equal(expandCollection([1],"weird",0,1).offset,null);
  assert.equal(foldRecord(tail("r",[1,2,3,4].map(n=>({role:"user",content:String(n)})),2)).messages.offset,2);
});
const message=n=>({role:n%2?"assistant":"user",content:"m"+n});
const chat=(n,extra={})=>Array.from({length:n},(_,i)=>extra[i]??message(i));
const stamps=d=>Object.fromEntries(Object.values(d.groups).flatMap(g=>g.items).filter(x=>x.key.startsWith("message:"))
  .map(x=>[Number(x.key.slice(8)),x.entered?"S"+x.entered.step+"T"+x.entered.turn:x.enteredBefore?"before:S"+x.tracedTo.step:null]));
const same={role:"user",content:"identical"};
test("entry stamps follow absolute indices across tail and delta records, including identical messages",()=>fixture([
  tail("r1",chat(5),3,{turnId:"t1"}),tail("r2",chat(7),3,{turnId:"t1"}),
  tail("r3",chat(8,{7:same}),3,{turnId:"t2"}),tail("r4",chat(10,{7:same,8:same}),3,{turnId:"t2"}),
  modelRecord("sess_A","r5",[],{turnId:"t2",request:{messages:[message(10)],messagesKind:"delta",messageOffset:10,messageCount:11}})],async(service,o)=>{
    const keys=o.trajectories.map(x=>x.key);
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[3]})),{0:"S3T2",1:"S4T2",2:"S4T2"});
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[1]})),{0:"before:S1",1:"S2T1",2:"S2T1"});
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[0]})),{0:"before:S1",1:"before:S1",2:"before:S1"});
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[4]})),{0:"S5T2"});
    const d=await service.request("sess_A",{key:keys[3],search:"identical"});
    assert.deepEqual(d.elements.map(x=>x.entered.step),[3,4]);
  }));
test("entry stamps never cross a history gap, a compaction or a changed message",()=>fixture([
  tail("a1",chat(6),3),tail("a2",chat(8),3),"INVALID ROW",tail("a3",chat(9),3),tail("a4",chat(10),3),
  tail("b1",chat(4),3),tail("b2",chat(5,{3:{role:"user",content:"rewritten"}}),3)],async(service,o)=>{
    const keys=o.trajectories.map(x=>x.key);
    // a4 holds indices 7..9: 7 and 8 were already present at a3, whose predecessor lies across the malformed row.
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[3]})),{0:"before:S3",1:"before:S3",2:"S4Tnull"});
    // b1 has fewer messages than a4 (compaction), so nothing traces past it; b2 rewrote index 3.
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[4]})),{0:"before:S5",1:"before:S5",2:"before:S5"});
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[5]})),{0:"before:S5",1:"before:S6",2:"S6Tnull"});
  }));
test("auxiliary snapshots and schemas carry no entry stamps",()=>fixture([
  modelRecord("sess_A","title",[{role:"user",content:"x"}],{querySource:"session_title"}),
  modelRecord("sess_A","r",[{role:"user",content:"x"}],{request:{messages:[{role:"user",content:"x"}],body:{tools:[tool("Read",5)]}}})],async(service,o)=>{
    const aux=await service.request("sess_A",{key:o.trajectories[0].key});assert.ok(!("entered" in aux.groups.user.items[0])&&!("enteredBefore" in aux.groups.user.items[0]));
    const agent=await service.request("sess_A",{key:o.trajectories[1].key});
    assert.equal(agent.groups.user.items[0].enteredBefore,true);assert.ok(!("enteredBefore" in agent.groups.schema.items[0]));
  }));
