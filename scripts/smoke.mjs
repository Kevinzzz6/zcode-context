import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { usageDatabase, modelRecord } from "../test/fixtures.mjs";
const root=await mkdtemp(join(tmpdir(),"zcode-context-smoke-"));
const fixture=usageDatabase(root);fixture.add("sess_A","a",100,10);fixture.add("sess_B","b",900,90);fixture.db.close();
await mkdir(join(root,"rollout"));await mkdir(join(root,"log"));
for(const sessionId of ["sess_A","sess_B"])await writeFile(join(root,"rollout","model-io-"+sessionId+".jsonl"),
  JSON.stringify(modelRecord(sessionId,"request_"+sessionId,[{role:"user",content:"Input for "+sessionId}]))+"\n");
const client=new Client({name:"context-smoke",version:"0.1.1"});
const transport=new StdioClientTransport({command:process.execPath,args:[process.argv[2] ?? process.env.ZCODE_CONTEXT_SERVER ?? fileURLToPath(new URL("../dist/server.mjs",import.meta.url))],
  env:{...process.env,ZCODE_CONTEXT_DATA_ROOT:root,ZCODE_CONTEXT_DB_PATH:fixture.path},stderr:"pipe"});
try{
  await client.connect(transport);
  const tools=await client.listTools();assert.equal(tools.tools.length,2);
  for(const tool of tools.tools)assert.deepEqual(tool._meta.ui.visibility,["app"]);
  const resource=await client.readResource({uri:"ui://zcode-context/panel.html"});
  assert.match(resource.contents[0].text,/ZCode Context/);assert.ok(resource.contents[0].text.includes("get_context_summary"));
  const read=sessionId=>client.callTool({name:"get_context_summary",arguments:{},_meta:{"com.zcode/request-context":{session_id:sessionId}}});
  const [a,b]=await Promise.all([read("sess_A"),read("sess_B")]);
  assert.equal(a.structuredContent.sessionId,"sess_A");assert.equal(a.structuredContent.usage.totals.inputTokens,100);
  assert.equal(b.structuredContent.sessionId,"sess_B");assert.equal(b.structuredContent.usage.totals.inputTokens,900);
  const a2=await read("sess_A");assert.equal(a2.structuredContent.sessionId,"sess_A");
  const missing=await client.callTool({name:"get_context_summary",arguments:{}});
  assert.equal(missing.isError,true);assert.equal(missing.structuredContent.error.code,"binding_unavailable");
  const foreign=await client.callTool({name:"get_context_request",arguments:{key:a.structuredContent.trajectories[0].key},
    _meta:{"com.zcode/request-context":{session_id:"sess_B"}}});
  assert.equal(foreign.isError,true);
  const newSession=await read("sess_new");assert.equal(newSession.structuredContent.sessionId,"sess_new");assert.equal(newSession.structuredContent.trajectory.available,false);
  console.log("stdio smoke passed: isolated sessions, resources, empty state and missing binding.");
}finally{await client.close();await rm(root,{recursive:true,force:true});}
