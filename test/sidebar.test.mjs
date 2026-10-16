import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ContextDataService} from "../src/data/service.mjs";
import {expandCollection,foldRecord,diffRecords,inputElements,toolEvidence,attemptUsage,textDifference,elementSummary,trajectorySummary} from "../src/domain/trajectory.mjs";
import {modelRecord,usageDatabase,conversationStore} from "./fixtures.mjs";
async function fixture(records,callback,events=[],tools=null,conversation=null) {
  const root=await mkdtemp(join(tmpdir(),"context-sidebar-"));
  try {
    await mkdir(join(root,"rollout"));await mkdir(join(root,"log"));
    await writeFile(join(root,"rollout","model-io-sess_A.jsonl"),records.map(x=>typeof x==="string"?x:JSON.stringify(x)).join("\n")+"\n");
    const date=new Date(),stamp=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
    await writeFile(join(root,"log","zcode-"+stamp+".jsonl"),events.map(JSON.stringify).join("\n")+"\n");
    const db=tools||conversation?usageDatabase(root):null;
    for(const [i,[sessionId,name,status]] of (tools??[]).entries())db.tool(sessionId,"t"+i,name,status);
    if(conversation)conversation(conversationStore(db.db));
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
// ZCode's default writer follows a tail with deltas against its untrimmed previous request.
test("deltas after a tail keep the tail's recorded messages, still partial",()=>{
  const history=Array.from({length:100},(_,i)=>({role:i%2?"assistant":"user",content:"m"+i}));
  const next={role:"user",content:"m100"};
  return fixture([tail("r1",history,64),
    modelRecord("sess_A","r2",[],{request:{messages:[next],messagesKind:"delta",messageOffset:100,messageCount:101}}),
    modelRecord("sess_A","r3",[],{request:{messages:[],messagesKind:"delta",messageOffset:101,messageCount:101}})],async(service,o)=>{
    const [,second,third]=o.trajectories;
    assert.equal(second.complete,false);assert.equal(second.messageCount,65);assert.equal(third.messageCount,65);
    const d=await service.request("sess_A",{key:third.key});
    assert.equal(d.elementCount,65);assert.equal(d.diff.available,false);
    const last=await service.request("sess_A",{key:third.key,elementKey:"message:64"});assert.equal(last.content.text,"m100");
  });
});
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
  const partial=expandCollection([4,5],"tail",3,5),continued=expandCollection([6],"delta",5,6,partial);
  assert.equal(continued.offset,3);assert.deepEqual(continued.items,[4,5,6]);assert.equal(continued.complete,false);assert.equal(continued.reason,"tail");
  const gap=expandCollection([9],"delta",8,9,partial);assert.equal(gap.offset,8);assert.deepEqual(gap.items,[9]);assert.equal(gap.reason,"missing_baseline");
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
    assert.deepEqual(stamps(await service.request("sess_A",{key:keys[4]})),{0:"S3T2",1:"S4T2",2:"S4T2",3:"S5T2"});
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
const cached=n=>chat(n,{[n-1]:{...message(n-1),cacheControl:{type:"ephemeral"}}});
test("a prompt-cache breakpoint moving to the newest message breaks neither entry stamps nor diffs",()=>{
  const before=foldRecord(modelRecord("s","a",cached(2))),after=foldRecord(modelRecord("s","b",cached(4)));
  const d=diffRecords(before,after);assert.equal(d.added.length,2);assert.equal(d.removed.length,0);
  return fixture([tail("c1",cached(4),3,{turnId:"t1"}),tail("c2",cached(6),3,{turnId:"t1"}),tail("c3",cached(8),3,{turnId:"t1"})],async(service,o)=>{
    assert.deepEqual(stamps(await service.request("sess_A",{key:o.trajectories.at(-1).key})),{0:"S2T1",1:"S3T1",2:"S3T1"});
  });
});
test("partial records list what entered after the baseline step from entry stamps",()=>fixture([
  tail("r1",chat(5),3,{turnId:"t1"}),tail("r2",chat(7),3,{turnId:"t1"}),tail("r3",chat(8),3,{turnId:"t2"})],async(service,o)=>{
    const keys=o.trajectories.map(x=>x.key);
    const step=await service.request("sess_A",{key:keys[2]});
    assert.equal(step.diff.available,false);assert.equal(step.arrivals.sinceStep,2);
    assert.deepEqual(step.arrivals.keys,["message:2"]);assert.equal(step.arrivals.unknownCount,0);
    const since=await service.request("sess_A",{key:keys[2],baselineKey:keys[0]});
    assert.equal(since.arrivals.sinceStep,1);assert.deepEqual([...since.arrivals.keys].sort(),["message:0","message:1","message:2"]);
    assert.equal((await service.request("sess_A",{key:keys[0]})).arrivals,null);
  }));
test("a compaction points at the continuation summary of the first agent request after it",()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString(),span={sessionId:"sess_A",turnId:"turn_c",spanId:"span_c"};
  return fixture([
    modelRecord("sess_A","before",[{role:"user",content:"long history"}],{startedAt:at(-5000)}),
    modelRecord("sess_A","compact",[{role:"user",content:"summarize"}],{startedAt:at(-3500),querySource:"compact"}),
    modelRecord("sess_A","after",[{role:"system",content:"rules"},{role:"user",content:"This session is being continued from a previous conversation that ran out of context. Summary…"}],{startedAt:at(-1000)})],
    async(service,o)=>{
      const event=o.events.find(e=>e.kind==="compaction");
      assert.equal(event.navigation.summaryStepKey,o.trajectories[2].key);assert.equal(event.navigation.summaryKey,"message:1");
    },[{...span,event:"compact.started",timestamp:at(-4000)},{...span,event:"compact.completed",timestamp:at(-3000),durationMs:1000}]);
});
test("the element being opened stays in its category's first page",()=>fixture([
  modelRecord("sess_A","many",Array.from({length:60},(_,i)=>({role:"tool",content:i===59?"tiny":"bigger tool output "+i})))],async(service,o)=>{
    const key=o.trajectories[0].key,plain=await service.request("sess_A",{key});
    assert.ok(!plain.groups.tool.items.some(x=>x.key==="message:59"));
    const d=await service.request("sess_A",{key,focusKey:"message:59"});assert.ok(d.groups.tool.items.some(x=>x.key==="message:59"));
  }));
test("reminders sharing a long opening are located by their own text, and a skipped record leaves them unlocated",()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString(),opening="The TodoWrite tool hasn't been used recently. ".repeat(10);
  const a=opening+"Todos: [alpha]",b=opening+"Todos: [beta]",c=opening+"Todos: [gamma]";
  return fixture([
    modelRecord("sess_A","r0",[{role:"user",content:"start"}],{startedAt:at(-9000)}),
    modelRecord("sess_A","r1",[{role:"user",content:"start"},{role:"user",content:a},{role:"user",content:b}],{startedAt:at(-6000)}),
    "{not json",
    modelRecord("sess_A","r2",[{role:"user",content:"start"},{role:"user",content:a},{role:"user",content:b},{role:"user",content:c}],{startedAt:at(-2000)})],
    async(service,o)=>{
      const find=id=>o.events.find(e=>e.id===id);
      assert.equal(find("m:ra").stepKey,o.trajectories[1].key);assert.equal(find("m:ra").elementKey,"message:1");
      assert.equal(find("m:rb").elementKey,"message:2");
      // The first request after gamma may have been the malformed line, so it is not pinned to r2.
      assert.equal(find("m:rc").stepKey,null);
    },[],null,store=>{
      store.reminder("sess_A","ra",now-7000,a);store.reminder("sess_A","rb",now-6500,b);store.reminder("sess_A","rc",now-4000,c);
    });
});
test("injections longer than the read bound are told apart by length and digest",()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString(),opening="Restored context line. ".repeat(250);
  const a=opening+"[alpha]",b=opening+"[beta, a little longer]";
  return fixture([
    modelRecord("sess_A","r0",[{role:"user",content:"start"}],{startedAt:at(-9000)}),
    modelRecord("sess_A","r1",[{role:"user",content:"start"},{role:"user",content:a},{role:"user",content:b}],{startedAt:at(-3000)})],
    async(service,o)=>{
      const find=id=>o.events.find(e=>e.id===id);
      assert.ok(opening.length>4000);
      assert.equal(find("m:ra").elementKey,"message:1");assert.equal(find("m:rb").elementKey,"message:2");
      assert.equal(find("m:ra").truncated,true);
    },[],null,store=>{store.reminder("sess_A","ra",now-7000,a);store.reminder("sess_A","rb",now-6000,b);});
});
test("the earliest readable request is only the first carrier when its file was read without a gap before it",async()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString(),text="Background task finished.";
  const carrier=modelRecord("sess_A","r1",[{role:"user",content:"start"},{role:"user",content:text}],{startedAt:at(-2000)});
  const located=async lines=>{let step;await fixture(lines,async(service,o)=>{step=o.events.find(e=>e.id==="m:n1").stepKey;},[],null,
    store=>store.reminder("sess_A","n1",now-5000,text,"background_notification","background_task"));return step;};
  assert.ok(await located([carrier]));
  assert.equal(await located(["{not json",carrier]),null);
});
test("recorded injections are matched to the item of the first agent request that carried them",()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString(),reminder="The TodoWrite tool hasn't been used recently.";
  return fixture([
    modelRecord("sess_A","before",[{role:"user",content:"start"}],{startedAt:at(-9000)}),
    modelRecord("sess_A","carrier",[{role:"user",content:"start"},{role:"system",content:reminder},{role:"tool",toolCallId:"call_skill",toolName:"Skill",content:"<skill_content name=\"demo\">"}],{startedAt:at(-5000)}),
    modelRecord("sess_A","later",[{role:"user",content:"start"},{role:"system",content:reminder},{role:"system",content:reminder}],{startedAt:at(-1000)})],
    async(service,o)=>{
      const [todo,skill]=o.events.filter(e=>e.kind==="inject");
      assert.equal(todo.evidence,"recorded");assert.equal(todo.form,"todo_reminder");assert.equal(todo.stepKey,o.trajectories[1].key);assert.equal(todo.elementKey,"message:1");
      assert.ok(!("needle" in todo));assert.equal(todo.text,reminder);
      assert.equal(skill.form,"skill");assert.equal(skill.name,"demo-skill");assert.equal(skill.stepKey,o.trajectories[1].key);assert.equal(skill.elementKey,"message:2");
      const late=o.events.find(e=>e.id==="m:r2");assert.equal(late.stepKey,o.trajectories[2].key);assert.equal(late.elementKey,"message:2");
      assert.ok(!o.events.some(e=>e.kind==="model"&&e.evidence==="logged"));assert.equal(o.events.find(e=>e.kind==="model").to,"p/b");
    },[{sessionId:"sess_A",event:"session.model.updated",timestamp:at(-8000),context:{model:"p/b",previousModel:"p/a"}}],null,store=>{
      store.prompt("sess_A","u1",now-9500,"start");
      store.reminder("sess_A","r1",now-7000,reminder);
      store.reply("sess_A","a1",now-6500,"loading a skill",[["Skill",{skill:"demo-skill"},"<skill_content name=\"demo\">","call_skill"]]);
      store.modelChange("sess_A","mc",now-8000,"p/a","p/b");
      store.reminder("sess_A","r2",now-2000,reminder);
    });
});
test("an injection whose request is not readable keeps its text and no step",()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString();
  return fixture([modelRecord("sess_A","only",[{role:"user",content:"x"}],{startedAt:at(-1000)})],async(service,o)=>{
    const e=o.events.find(x=>x.kind==="inject");assert.equal(e.stepKey,null);assert.equal(e.elementKey,null);assert.equal(e.text,"notice from before the records");
  },[],null,store=>store.reminder("sess_A","r0",now-60000,"notice from before the records","background_notification","background_task"));
});
test("a recorded compaction carries exact figures, replaces its log records and lists what it summarized",()=>{
  const now=Date.now(),at=ms=>new Date(now+ms).toISOString(),span={sessionId:"sess_A",turnId:"turn_c",spanId:"span_c"};
  return fixture([
    modelRecord("sess_A","before",[{role:"user",content:"history"}],{startedAt:at(-9000)}),
    modelRecord("sess_A","after",[{role:"user",content:"This session is being continued from a previous conversation. Summary body"}],{startedAt:at(-1000)})],
    async(service,o)=>{
      const compactions=o.events.filter(e=>e.kind==="compaction");
      assert.equal(compactions.length,1);const c=compactions[0];
      assert.equal(c.evidence,"recorded");assert.equal(c.event,"compact.auto.completed");assert.equal(c.preTokens,90000);assert.equal(c.postTokens,11000);
      assert.equal(c.tokensSavedEstimate,79000);assert.equal(c.summarizedCount,3);assert.equal(c.durationMs,40);assert.equal(c.navigation.summaryKey,"message:0");
      const {eventDetail:d}=await service.eventDetail("sess_A",c.id);
      assert.equal(d.messageCount,3);assert.deepEqual(d.items.map(x=>x.role+":"+(x.chip??"")+":"+x.title),
        ["user::fix the cache","assistant::Reading it.","tool:Read:src/cache.ts","tool:Write:src/big.ts","inject:todo_reminder:keep a todo list"]);
      // A Write's whole file is never read into JavaScript; its size is scaled from a bounded sample.
      const write=d.items.find(x=>x.chip==="Write");assert.ok(Math.abs(write.tokens-500000/4)<200,String(write.tokens));
      await assert.rejects(service.eventDetail("sess_A","c:missing"),{code:"event_missing"});
    },[{...span,event:"compact.auto.started",timestamp:at(-6000)},{...span,event:"compact.auto.completed",timestamp:at(-5950)}],null,store=>{
      store.prompt("sess_A","u1",now-9500,"fix the cache");
      store.reply("sess_A","a1",now-9200,"Reading it.",[["Read",{file_path:"src/cache.ts"},"x".repeat(400)],["Write",{file_path:"src/big.ts",content:"y".repeat(500000)},"ok"]]);
      store.reminder("sess_A","r1",now-8000,"keep a todo list");
      store.compaction("sess_A","one",now-6000,{summaryId:"sum1",lastSummarizedId:"r1"});
    });
});
test("a compaction's summarized messages follow the active branch after a rewind; one on the rewound branch says so",()=>{
  const now=Date.now();let conversation=null;
  return fixture([modelRecord("sess_A","only",[{role:"user",content:"third"}])],async(service,o)=>{
    const compactions=o.events.filter(e=>e.kind==="compaction");
    const active=compactions.find(e=>e.id==="c:compact_one"),rewound=compactions.find(e=>e.id==="c:compact_zero");
    const {eventDetail:d}=await service.eventDetail("sess_A",active.id);
    assert.equal(d.messageCount,4);assert.deepEqual(d.items.map(x=>x.role+":"+x.title),["user:first","assistant:first reply","user:third","assistant:third reply"]);
    await assert.rejects(service.eventDetail("sess_A",rewound.id),{code:"rewound_branch"});
    // A rewind rewrites only session.revert; the overview still reports a new branch and revision, so the panel rereads details.
    assert.ok(o.conversation.branch);
    conversation.revert("sess_A",{kind:"conversation_rewind",targetMessageID:"u3",keptMessageIDs:["u1","a1"],branchCutAfterMessageID:"sum1",branchGeneration:2});
    const after=await service.overview("sess_A",o.revision);
    assert.equal(after.unchanged,undefined);assert.notEqual(after.conversation.branch,o.conversation.branch);
  },[],null,store=>{
    conversation=store;
    store.prompt("sess_A","u1",now-9000,"first");store.reply("sess_A","a1",now-8900,"first reply");
    store.prompt("sess_A","u2",now-8000,"second");store.reply("sess_A","a2",now-7900,"second reply");
    store.compaction("sess_A","zero",now-7800,{summaryId:"sumX",lastSummarizedId:"a2",count:4});
    store.revert("sess_A",{kind:"conversation_rewind",targetMessageID:"u2",keptMessageIDs:["u1","a1"],branchCutAfterMessageID:"sumX",branchGeneration:1});
    store.prompt("sess_A","u3",now-6000,"third");store.reply("sess_A","a3",now-5900,"third reply");
    store.compaction("sess_A","one",now-5000,{summaryId:"sum1",lastSummarizedId:"a3",count:4});
  });
});
test("every count follows the narrowing of the list it opens, while the In row keeps every addition",()=>{
  const base=[{role:"user",content:"question"}],added=[...base,{role:"tool",content:"small result"},{role:"tool",content:"x".repeat(400)+" DEEP_NEEDLE"},{role:"user",content:"follow-up"}];
  return fixture([modelRecord("sess_A","a",base),modelRecord("sess_A","b",added)],async(service,o)=>{
    const key=o.trajectories.at(-1).key,plain=await service.request("sess_A",{key});
    assert.equal(plain.listing.narrowed,false);assert.equal(plain.listing.source,"diff");assert.equal(plain.listing.added,3);assert.equal(plain.listing.removed,0);
    assert.deepEqual(plain.listing.roles.tool,{total:2,matched:2,added:2,addedTotal:2,removed:0,removedTotal:0});
    const d=await service.request("sess_A",{key,search:"deep_needle"});
    assert.equal(d.listing.narrowed,true);assert.equal(d.listing.added,1);assert.equal(d.listing.addedTotal,3);
    assert.deepEqual(d.listing.roles.tool,{total:2,matched:1,added:1,addedTotal:2,removed:0,removedTotal:0});
    // The user category gained a message too, but none matches: its +N is 0, not the unfiltered 1.
    assert.deepEqual(d.listing.roles.user,{total:2,matched:0,added:0,addedTotal:1,removed:0,removedTotal:0});
    assert.equal(d.listing.addedGroups.tool.items[0].key,d.elements[0].key);assert.equal(d.listing.addedGroups.user,undefined);assert.deepEqual(d.listing.removedGroups,{});
    assert.equal(d.diff.addedGroups.tool.count,2);assert.equal(d.diff.addedGroups.user.count,1);
  });
});
test("a tool-name prefix matches schemas by name only, never messages that mention it",()=>{
  const messages=[{role:"user",content:"try mcp__node_repl__js"},{role:"tool",content:"called mcp__node_repl__js"}];
  return fixture([modelRecord("sess_A","a",messages.slice(0,1),{request:{messages:messages.slice(0,1),body:{tools:[tool("Read",10)]}}}),
    modelRecord("sess_A","b",messages,{request:{messages,body:{tools:[tool("Read",10),tool("mcp__node_repl__js",10)]}}})],async(service,o)=>{
    const key=o.trajectories.at(-1).key,text=await service.request("sess_A",{key,search:"mcp__"});
    assert.deepEqual(Object.keys(text.groups).sort(),["schema","tool","user"]);
    const d=await service.request("sess_A",{key,toolPrefix:"mcp__"});
    assert.deepEqual(Object.keys(d.groups),["schema"]);assert.deepEqual(d.groups.schema.items.map(x=>x.toolName),["mcp__node_repl__js"]);
    assert.equal(d.listing.roles.schema.matched,1);assert.equal(d.listing.roles.schema.total,2);assert.equal(d.listing.roles.user.matched,0);
    assert.equal(d.listing.added,1);assert.equal(d.listing.addedGroups.schema.items[0].toolName,"mcp__node_repl__js");assert.equal(d.listing.roles.tool.added,0);
  });
});
test("an opened item stays listed when the narrowing would hide it, marked pinned and not counted",()=>fixture([
  modelRecord("sess_A","a",[{role:"user",content:"one"}]),modelRecord("sess_A","b",[{role:"user",content:"one"},{role:"user",content:"two"}])],async(service,o)=>{
    const key=o.trajectories.at(-1).key,d=await service.request("sess_A",{key,search:"absent",focusKey:"message:1"});
    assert.deepEqual(d.groups.user.items.map(x=>[x.key,x.pinned]),[["message:1",true]]);assert.equal(d.groups.user.count,0);
    assert.deepEqual(d.listing.addedGroups.user.items.map(x=>[x.key,x.pinned]),[["message:1",true]]);
    assert.equal(d.listing.roles.user.matched,0);assert.equal(d.listing.added,0);
    const plain=await service.request("sess_A",{key,focusKey:"message:1"});assert.equal(plain.groups.user.items.find(x=>x.key==="message:1").pinned,undefined);
  }));
test("a first turn compared by turn compares with nothing instead of the previous step",()=>fixture([
  tail("r1",chat(5),3,{turnId:"t1"}),tail("r2",chat(7),3,{turnId:"t1"})],async(service,o)=>{
    const key=o.trajectories.at(-1).key,step=await service.request("sess_A",{key});assert.equal(step.listing.source,"arrivals");
    const d=await service.request("sess_A",{key,noBaseline:true});
    assert.equal(d.diff.available,false);assert.equal(d.diff.reason,"no_previous_turn");assert.equal(d.arrivals,null);
    assert.equal(d.listing.source,null);assert.equal(d.listing.added,0);assert.equal(d.listing.removed,null);
    const turn=await service.request("sess_A",{key,baselineMode:"turn"});assert.equal(turn.diff.reason,"no_previous_turn");assert.equal(turn.arrivals,null);
  }));
// The panel shows 60 steps at a time; the previous turn is found in the whole cache, beyond the steps it has loaded.
test("the previous-turn baseline is resolved by the service over its whole cache",()=>{
  const records=Array.from({length:70},(_,i)=>modelRecord("sess_A","r"+i,chat(i+1),{turnId:i<5?"t1":"t2"}));
  return fixture(records,async(service,o)=>{
    assert.equal(o.trajectories.length,60);
    const all=service.records(service.state("sess_A")),first=o.trajectories[0];
    assert.equal(first.turn,2);
    const d=await service.request("sess_A",{key:first.key,baselineMode:"turn"});
    assert.equal(d.diff.available,true);assert.equal(d.diff.previousKey,all[4].key);
    // The detail's summary carries the same Delta as the trend item, so a restored selection is comparable.
    assert.equal(d.summary.delta.tokens,first.delta.tokens);
  });
});
test("a partial record's arrivals are counted under the narrowing and its removals stay unknown",()=>fixture([
  tail("r1",chat(5),3,{turnId:"t1"}),tail("r2",chat(7),3,{turnId:"t1"}),tail("r3",chat(8),3,{turnId:"t2"})],async(service,o)=>{
    const key=o.trajectories.at(-1).key,hit=await service.request("sess_A",{key,search:"m7"}),miss=await service.request("sess_A",{key,search:"absent"});
    assert.equal(hit.listing.source,"arrivals");assert.equal(hit.listing.added,1);assert.equal(hit.listing.removed,null);
    assert.equal(hit.listing.roles.assistant.added,1);assert.equal(hit.listing.roles.assistant.removed,null);
    assert.equal(miss.listing.added,0);assert.equal(miss.listing.addedTotal,1);assert.deepEqual(miss.listing.addedGroups,{});
  }));
test("an event focus pauses the user's filter and baseline, and is never saved",async()=>{
  const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  try {
    const {initialView,saveView,restoreView,lens}=await import("../ui/state.mjs");
    const view={...initialView(),search:"my filter",mode:"changes",baselineMode:"turn",eventKey:"tools:1",
      focus:{kind:"tools",stepKey:"k",mode:"all",toolPrefix:"mcp__",baselineKey:"b",expanded:["schema"]}};
    assert.deepEqual(lens(view),{focused:true,mode:"all",search:"",toolPrefix:"mcp__",baselineKey:"b",baselineMode:"turn",searchAll:false});
    assert.deepEqual(lens({...view,focus:null}),{focused:false,mode:"changes",search:"my filter",toolPrefix:"",baselineKey:null,baselineMode:"turn",searchAll:false});
    saveView("sess_A",view);const saved=JSON.parse(store.get("zcode-context:view:v3:sess_A"));
    assert.equal("focus" in saved,false);assert.equal("eventKey" in saved,false);assert.equal(saved.search,"my filter");
    store.set("zcode-context:view:v3:sess_B",JSON.stringify({...view,eventFocus:{key:"x"},eventNote:{key:"x"}}));
    const restored=restoreView("sess_B");assert.equal(restored.focus,null);assert.equal(restored.eventKey,null);
    assert.equal("eventFocus" in restored,false);assert.equal(restored.search,"my filter");assert.equal(restored.mode,"changes");
  }finally{delete globalThis.localStorage;}
});
