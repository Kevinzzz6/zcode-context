import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readSessionContext, ContextError } from "./domain/session.mjs";
import { resolveDataPaths } from "./data/paths.mjs";
import { createReader } from "./data/reader.mjs";
const HTML_URI = "ui://zcode-context/panel.html";
const reader = createReader(() => new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { paths: resolveDataPaths() }, resourceLimits: { maxOldGenerationSizeMb: 256 } }));
export function createContextServer() {
  const server = new McpServer({name:"zcode-context",version:"0.3.10"});
  server.registerResource("context_panel", HTML_URI, { mimeType:"text/html;profile=mcp-app",
    _meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}} },
    async () => ({contents:[{uri:HTML_URI,mimeType:"text/html;profile=mcp-app",text:await readFile(new URL("./context.html",import.meta.url),"utf8")}]})
  );
  const wrap = method => async (args,extra) => {
    try {
      // extra.sessionId is an MCP transport ID; only the host namespace binds a ZCode session.
      const {sessionId} = readSessionContext(extra._meta);
      const result = await reader.run(method,sessionId,args,extra.signal);
      return {content:[],structuredContent:result};
    } catch (error) {
      if (!(error instanceof ContextError)) console.error("[zcode-context]", method, error);
      return {isError:true,content:[{type:"text",text:"Context data is unavailable."}],
        structuredContent:{error:{code:error instanceof ContextError ? error.code : "read_failed"}}};
    }
  };
  const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  server.registerTool("get_context_summary",{description:"App-only read-only session usage and context overview.",
    inputSchema:{revision:z.string().max(64).optional(),historyPage:z.number().int().min(0).max(4).optional(),eventDetail:z.string().max(300).regex(/^c:[\w-]+$/).optional()},annotations,_meta:{ui:{visibility:["app"]}}},wrap("overview"));
  server.registerTool("get_context_request",{description:"App-only read-only recorded input and differences.",
    inputSchema:{key:z.string().regex(/^[a-f0-9]{24}$/),page:z.number().int().min(0).max(100000).optional(),
      baselineKey:z.string().regex(/^[a-f0-9]{24}$/).optional(),noBaseline:z.boolean().optional(),baselineMode:z.enum(["step","turn"]).optional(),toolPrefix:z.string().max(64).optional(),
      search:z.string().max(200).optional(),searchScope:z.enum(["selected","loaded"]).optional(),role:z.string().max(32).optional(),sort:z.enum(["size","order"]).optional(),schemaSort:z.enum(["size","calls","name"]).optional(),
      format:z.enum(["readable","raw"]).optional(),bodySearch:z.string().max(200).optional(),
      changePage:z.number().int().min(0).max(100000).optional(),diffBeforeElement:z.string().regex(/^(message|tool):[0-9]+$/).optional(),
      elementKey:z.string().regex(/^(message|tool):[0-9]+$/).optional(),focusKey:z.string().regex(/^(message|tool):[0-9]+$/).optional(),offset:z.number().int().min(0).max(100000000).optional()},
    annotations,_meta:{ui:{visibility:["app"]}}},wrap("request"));
  return server;
}
const server = createContextServer();
await server.connect(new StdioServerTransport());
let closing = false;
const shutdown = async () => {
  if (closing) return; closing = true;
  setTimeout(() => process.exit(0), 2000).unref();
  await server.close().catch(()=>{}); await reader.close().catch(()=>{}); process.exit(0);
};
process.on("SIGINT",shutdown); process.on("SIGTERM",shutdown);
process.stdin.once("end",shutdown); process.stdin.once("close",shutdown);
