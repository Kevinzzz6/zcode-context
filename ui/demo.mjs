// Synthetic preview data for `npm run preview`; it never reads real sessions.
const now=Date.now(),count=9;
const toolSize=i=>i<6?1200+i*2400:2400+(i-6)*1100;
function elements(i) {
  const first={step:1,turn:1},entered=j=>({step:j+2,turn:j+1<4?1:2});
  const list=[{key:"message:0",role:"system",title:"You are a demo coding agent",estimatedTokens:1800,entered:first},
    ...["Read","Edit","Bash","Grep","Glob","Write","TodoWrite","WebFetch","mcp__browser__open"].map((name,j)=>({key:"tool:"+j,role:"schema",title:name,toolName:name,subtitle:name+" demo schema",estimatedTokens:600+j*90,callCount:[4,1,2,1,0,0,0,0,1][j]})),
    {key:"message:1",role:"user",title:"检查缓存过期逻辑",estimatedTokens:40,entered:first}];
  for(let j=0;j<i;j++)list.push({key:"message:"+(2+j*2),role:"assistant",chip:"Read",title:"src/demo-"+j+".ts",estimatedTokens:30,entered:entered(j)},
    {key:"message:"+(3+j*2),role:"tool",chip:"Read",entered:entered(j),title:"src/demo-"+j+".ts",estimatedTokens:j>=i-3||i<6?Math.round(toolSize(i)/Math.max(1,Math.min(i,3))):0,status:"ok",lines:120});
  return list.filter(x=>x.estimatedTokens>0).map(x=>({chars:x.estimatedTokens*4,preview:x.title,status:null,chip:null,subtitle:null,lines:1,...x}));
}
const buckets=list=>["system","schema","user","assistant","tool"].map(role=>{const xs=list.filter(x=>x.role===role);return {role,count:xs.length,chars:xs.reduce((n,x)=>n+x.chars,0),estimatedTokens:xs.reduce((n,x)=>n+x.estimatedTokens,0)};}).filter(b=>b.count);
const steps=Array.from({length:count},(_,i)=>{
  const list=elements(i),composition={buckets:buckets(list),tokenMethod:"script_weighted",complete:true,schemasRecorded:true};
  const total=composition.buckets.reduce((n,b)=>n+b.estimatedTokens,0);
  return {key:String(i).padStart(24,"a"),requestId:"demo_"+i,attempt:1,startedAt:now-(count-i)*45000,turnId:i<4?"t1":"t2",step:i+1,turn:i<4?1:2,
    querySource:"main_turn",complete:true,model:{modelId:"demo-model"},usage:{inputTokens:Math.round(total*1.04),outputTokens:120+i*20,cacheReadTokens:Math.round(total*0.9)},
    composition,userPreview:i<4?"检查缓存过期逻辑":"修复它并补一个测试",responseCalls:[{name:"Read",title:"src/demo-"+i+".ts"}],responseCallCount:1,
    responsePreview:"",hasResponse:true,list,total};
});
for(const [i,s] of steps.entries()) {
  if(!i){s.delta=null;s.deltaReason="no_previous_snapshot";continue;}
  const before=new Map(steps[i-1].composition.buckets.map(b=>[b.role,b.chars]));
  const categories=s.composition.buckets.map(b=>({role:b.role,charsDelta:b.chars-(before.get(b.role)??0)}));
  s.delta={chars:(s.total-steps[i-1].total)*4,categories};
}
const view=s=>{const {list,total,...rest}=s;return rest;};
const group=list=>{const out={};for(const x of list){const g=out[x.role]??={count:0,items:[]};g.count++;if(g.items.length<40)g.items.push(x);}return out;};
export function demoCall(name,args) {
  if(name==="get_context_summary"&&args.eventDetail)return {sessionId:"sess_demo",eventDetail:{id:args.eventDetail,messageCount:3,listedMessages:3,itemCount:3,tokens:5200,
    items:[{role:"user",chip:null,title:"检查缓存过期逻辑",tokens:20},{role:"tool",chip:"Read",title:"src/demo-0.ts",tokens:4400},{role:"assistant",chip:null,title:"Reading the cache module first.",tokens:780}]}};
  if(name==="get_context_summary"&&args.revision==="demo")return {sessionId:"sess_demo",revision:"demo",unchanged:true};
  if(name==="get_context_summary")return {sessionId:"sess_demo",revision:"demo",trajectories:steps.map(view),trajectory:{coverage:[]},history:{loadedCount:count,hasOlder:false},
    usage:{available:true,totals:{requestCount:count,inputTokens:steps.reduce((n,s)=>n+s.usage.inputTokens,0),outputTokens:steps.reduce((n,s)=>n+s.usage.outputTokens,0),cacheHitRate:0.9},
      days:[{utcDay:Math.floor(now/86400000),inputTokens:steps.reduce((n,s)=>n+s.usage.inputTokens,0),outputTokens:2000}],facts:steps.map(s=>({startedAt:s.startedAt,querySource:"main_turn",modelId:"demo-model",status:"completed",inputTokens:s.usage.inputTokens,outputTokens:s.usage.outputTokens,durationMs:1800}))},
    events:[{kind:"compaction",evidence:"recorded",id:"c:demo",summarizedCount:3,event:"compact.auto.completed",status:"completed",timestamp:steps[6].startedAt-14000,endedAt:steps[6].startedAt-4000,durationMs:10000,
        reason:"token_pressure",tokensSavedEstimate:9000,navigation:{evidence:"turn_range"}},
      {kind:"model",event:"session.model.updated",timestamp:steps[8].startedAt-3000,endedAt:steps[8].startedAt-3000,from:"demo/demo-small",to:"demo/demo-model",navigation:{evidence:"time_range"}},
      {kind:"tools",event:"mcp.tools.registered",timestamp:steps[0].startedAt-2000,endedAt:steps[0].startedAt-2000,toolCount:1,serverCount:1,navigation:{evidence:"time_range"}},
      {kind:"inject",evidence:"recorded",id:"m:demo-1",form:"todo_reminder",source:"todo_reminder",timestamp:steps[5].startedAt-1000,tokens:96,stepKey:steps[5].key,elementKey:"message:11",elementRole:"tool",
        text:"The TodoWrite tool hasn't been used recently. (Demo reminder.)",truncated:false},
      {kind:"inject",evidence:"recorded",id:"m:demo-2",form:"background_notification",source:"background_task",timestamp:steps[2].startedAt-1000,tokens:104,stepKey:null,elementKey:null,
        text:"Background task finished: demo build (exit 0).\nThis request is no longer readable, so the text comes from the conversation store.",truncated:false}].sort((a,b)=>a.timestamp-b.timestamp)};
  const index=Math.max(0,steps.findIndex(s=>s.key===args.key)),s=steps[index],previous=args.noBaseline?null:steps[index-1];
  const query=(args.search??"").toLowerCase(),prefix=args.toolPrefix??"";
  const hit=x=>(!prefix||x.role==="schema"&&String(x.toolName??"").startsWith(prefix))&&(!query||x.title.toLowerCase().includes(query));
  const filtered=s.list.filter(x=>(!args.role||x.role===args.role)&&hit(x)).sort((a,b)=>b.chars-a.chars);
  const keys=new Set(previous?.list.map(x=>x.key+x.estimatedTokens)??[]),added=previous?s.list.filter(x=>!keys.has(x.key+x.estimatedTokens)):[];
  const now2=new Set(s.list.map(x=>x.key+x.estimatedTokens)),removed=previous?previous.list.filter(x=>!now2.has(x.key+x.estimatedTokens)):[];
  const shownAdded=added.filter(hit),shownRemoved=removed.filter(hit),roles={};
  const tally=role=>roles[role]??={total:0,matched:0,added:0,addedTotal:0,removed:previous?0:null,removedTotal:previous?0:null};
  for(const x of s.list){const r=tally(x.role);r.total++;if(hit(x))r.matched++;}
  for(const x of added)tally(x.role).addedTotal++;for(const x of removed)tally(x.role).removedTotal++;
  for(const x of shownAdded)tally(x.role).added++;for(const x of shownRemoved)tally(x.role).removed++;
  const listing={narrowed:Boolean(query||prefix),source:previous?"diff":null,roles,added:shownAdded.length,addedTotal:added.length,
    removed:previous?shownRemoved.length:null,removedTotal:previous?removed.length:null,addedGroups:group(shownAdded),removedGroups:group(shownRemoved)};
  const diff=previous?{available:true,previousKey:previous.key,addedCount:added.length,removedCount:removed.length,changedCount:0,addedKeys:added.map(x=>x.key),changedPairs:[],
    addedGroups:group(added),removedGroups:group(removed),categories:s.delta.categories.map(c=>({...c,addedCount:added.filter(x=>x.role===c.role).length,removedCount:removed.filter(x=>x.role===c.role).length})),schemasComparable:true}
    :{available:false,reason:"no_previous_snapshot"};
  const element=args.elementKey?(steps.find(x=>x.key===args.key)??s).list.find(x=>x.key===args.elementKey):null;
  const text=element?(element.role==="schema"?JSON.stringify({name:element.title,description:"Demo schema for **"+element.title+"**.",parameters:{type:"object",properties:{file_path:{type:"string",description:"Path to the file."}},required:["file_path"]}},null,2):"Synthetic preview content for "+element.title+".\nNo real data is read."):"";
  const unused=s.list.filter(x=>x.callCount===0);
  return {sessionId:"sess_demo",summary:view(s),composition:s.composition,diff,listing,groups:group(filtered),
    schemaCalls:{available:true,scope:"session",schemaCount:8,unusedCount:unused.length,unusedEstimatedTokens:unused.reduce((n,x)=>n+x.estimatedTokens,0),unknownCount:0},elements:filtered.slice((args.page??0)*40,(args.page??0)*40+40),elementCount:s.list.length,filteredCount:filtered.length,
    searchScope:"all_elements_in_selected_loaded_snapshot",loadedSnapshotCount:count,baselineOptions:steps.slice(0,index).map(x=>({key:x.key,startedAt:x.startedAt,complete:true})),
    content:element?{...element,offset:0,totalChars:text.length,lineCount:text.split("\n").length,text,hasMore:false,format:"readable",hits:[],matchCount:0,
      tool:element.role==="tool"?{name:"Read",arguments:'{"file_path":"'+element.title+'"}',fields:[{name:"file_path",value:element.title}],evidence:"tool_call_id"}:null}:null,bodyDiff:null};
}
