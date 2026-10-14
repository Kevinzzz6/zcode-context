import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { usageDatabase, modelRecord, conversationStore } from "../test/fixtures.mjs";
const root=await mkdtemp(join(tmpdir(),"context-browser-fixture-"));const fixture=usageDatabase(root);const store=conversationStore(fixture.db);
await mkdir(join(root,"rollout"));await mkdir(join(root,"log"));
let counter=0;
async function append(sessionId, large = false, bulk = false, gap = false, reminder = null, mcp = false) {
  const id="fixture_"+(++counter);fixture.add(sessionId,id,sessionId==="sess_A"?100:900,10);fixture.tool(sessionId,id,"Read");
  const messages=[{role:"system",content:"Fixture rules. No real user data."},{role:"user",content:"Recorded input for "+sessionId+" "+id+(large?" "+"long fixture text ".repeat(1600)+" END_OF_LONG_INPUT":"")}];
  messages.push({role:"assistant",tool_calls:[{id:"call_"+id,function:{name:"Read",arguments:'{"path":"src/cache.ts"}'}}]},
    {role:"tool",tool_call_id:"call_"+id,toolName:"Read",content:"Tool output for "+sessionId+" "+id,status:"completed"});
  if(reminder)messages.push({role:"system",content:reminder});
  if(bulk)for(let i=0;i<85;i++)messages.push({role:"tool",content:i===84?"SEARCH_BEYOND_FIRST_PAGE "+"big ".repeat(1000):"tiny tool "+i});
  const record=modelRecord(sessionId,id,messages,{turnId:"turn_"+id,request:{messages,messagesKind:"full",messageCount:messages.length,
    body:{tools:[{name:"Read",description:"Schema "+id,parameters:{type:"object",properties:{path:{type:"string"}}}},{name:"Glob",description:"Never called",parameters:{type:"object"}},
      ...(mcp?[{name:"mcp__fixture__open",description:"Fixture MCP schema",parameters:{type:"object"}}]:[])]}}});
  await appendFile(join(root,"rollout","model-io-"+sessionId+".jsonl"),(gap?"INVALID ROW\n":"")+JSON.stringify(record)+"\n");
}
await append("sess_A");await append("sess_A");await append("sess_B");
const client=new Client({name:"context-browser-fixture",version:"0.3.2"});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL("../dist/server.mjs",import.meta.url))],
  env:{...process.env,ZCODE_CONTEXT_DATA_ROOT:root,ZCODE_CONTEXT_DB_PATH:fixture.path},stderr:"pipe"}));
const panel=await readFile(new URL("../dist/context.html",import.meta.url));
const host=await readFile(new URL("../dist/test/host.js",import.meta.url));
const shell=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px system-ui;background:#eceef2}header{padding:12px}section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:8px}iframe{width:100%;height:1000px;border:0;background:white}</style></head><body><header>SDK test fixture · synthetic data · not the ZCode Desktop sandbox <button id="dark">Theme</button><button id="english">English</button></header><section><iframe id="sess_A"></iframe><iframe id="sess_B"></iframe></section><script type="module" src="/host.js"></script></body></html>`;
const http=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://127.0.0.1");
    if(url.pathname==="/reset"){
      fixture.db.exec("DELETE FROM model_usage; DELETE FROM tool_usage; DELETE FROM message; DELETE FROM part");counter=0;
      for(const id of ["sess_A","sess_B"])await writeFile(join(root,"rollout","model-io-"+id+".jsonl"),"");
      await rm(join(root,"log"),{recursive:true,force:true});await mkdir(join(root,"log"));
      await append("sess_A");await append("sess_A");await append("sess_B");res.writeHead(204);res.end();return;
    }
    if(url.pathname==="/favicon.ico"){res.writeHead(204);res.end();return;}
    if(url.pathname==="/"){res.writeHead(200,{"content-type":"text/html"});res.end(shell);return;}
    if(url.pathname==="/panel"){res.writeHead(200,{"content-type":"text/html"});res.end(panel);return;}
    if(url.pathname==="/host.js"){res.writeHead(200,{"content-type":"text/javascript"});res.end(host);return;}
    const sessionId=url.searchParams.get("session");if(!["sess_A","sess_B"].includes(sessionId)){res.writeHead(400);res.end();return;}
    if(url.pathname==="/append"){await append(sessionId,url.searchParams.get("large")==="1",url.searchParams.get("bulk")==="1",url.searchParams.get("gap")==="1");res.writeHead(200,{"content-type":"application/json"});res.end('{"ok":true}');return;}
    // A runtime reminder in the conversation store, then the request that carries it.
    if(url.pathname==="/inject"){
      const text="Fixture TodoWrite reminder "+Date.now();store.reminder(sessionId,"reminder_"+Date.now(),Date.now()-20,text);
      await append(sessionId,false,false,false,text);res.writeHead(204);res.end();return;
    }
    // An MCP registration in the log, then (unless request=0) the request that carries the new MCP schema.
    if(url.pathname==="/tools"){
      const date=new Date(),stamp=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
      await appendFile(join(root,"log","zcode-"+stamp+".jsonl"),JSON.stringify({sessionId,event:"mcp.tools.registered",timestamp:new Date(date-20).toISOString(),
        turnId:"turn_tools_"+counter,spanId:"span_tools_"+Date.now(),context:{registeredToolCount:3,serverCount:2}})+"\n");
      if(url.searchParams.get("request")!=="0")await append(sessionId,false,false,false,null,true);
      res.writeHead(204);res.end();return;
    }
    if(url.pathname==="/event"){
      const date=new Date(),stamp=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
      const span={sessionId,turnId:"turn_fixture_"+counter,spanId:"span_fixture_"+Date.now()};
      await appendFile(join(root,"log","zcode-"+stamp+".jsonl"),JSON.stringify({...span,event:"compact.auto.started",timestamp:new Date(date-50).toISOString(),context:{compactReason:"token_pressure"}})+"\n"
        +JSON.stringify({...span,event:"compact.auto.completed",timestamp:date.toISOString(),durationMs:50,context:{compactReason:"token_pressure",tokensSaved:120}})+"\n");res.writeHead(204);res.end();return;
    }
    if(url.pathname==="/call"&&req.method==="POST"){
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error("Too large");chunks.push(chunk);}
      const params=JSON.parse(Buffer.concat(chunks));
      if(!["get_context_summary","get_context_request"].includes(params.name))throw new Error("Unknown fixture tool");
      const result=await client.callTool({name:params.name,arguments:params.arguments??{},
        _meta:{"com.zcode/request-context":{session_id:sessionId}}});
      res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(result));return;
    }
    res.writeHead(404);res.end();
  }catch{res.writeHead(500);res.end("Fixture error");}
});
http.listen(4174,"127.0.0.1",()=>console.log("SDK fixture: http://127.0.0.1:4174"));
let closing=false;const stop=async()=>{if(closing)return;closing=true;http.close();await client.close();fixture.db.close();await rm(root,{recursive:true,force:true});process.exit(0);};
process.on("SIGTERM",stop);process.on("SIGINT",stop);
