import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readSessionContext, ContextError } from "./domain/session.mjs";
import { resolveDataPaths } from "./data/paths.mjs";
const HTML_URI = "ui://zcode-context/panel.html";
const pending = new Map(); let sequence = 0; let worker = null;
function failWorker() {
  worker = null;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new ContextError("worker_unavailable","Data worker stopped.")); }
  pending.clear();
}
function getWorker() {
  if (worker) return worker;
  const next = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { paths: resolveDataPaths() }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  worker = next;
  next.on("message", message => {
    const job = pending.get(message.id); if (!job) return;
    pending.delete(message.id); clearTimeout(job.timer);
    message.error ? job.reject(new ContextError(message.error.code,message.error.message)) : job.resolve(message.result);
  });
  const onFailure = () => { if (worker === next) failWorker(); };
  next.on("error", onFailure); next.on("exit", onFailure);
  return next;
}
function runJob(method, sessionId, args, signal) {
  return new Promise((resolve,reject) => {
    if (pending.size >= 8) { reject(new ContextError("reader_busy","Too many pending reads.")); return; }
    const current = getWorker(); const id = ++sequence;
    const timer = setTimeout(() => { const job = pending.get(id); pending.delete(id); job?.reject(new ContextError("read_timeout","Data read timed out.")); },15000);
    const abort = () => { const job = pending.get(id); if (job) { clearTimeout(timer); pending.delete(id); job.reject(new ContextError("cancelled","Read cancelled.")); } };
    signal?.addEventListener("abort",abort,{once:true});
    const done = callback => value => { signal?.removeEventListener("abort",abort); callback(value); };
    pending.set(id,{resolve:done(resolve),reject:done(reject),timer});
    if (signal?.aborted) { abort(); return; }
    current.postMessage({id,method,sessionId,args});
  });
}
export function createContextServer() {
  const server = new McpServer({name:"zcode-context",version:"0.2.0"});
  server.registerResource("context_panel", HTML_URI, { mimeType:"text/html;profile=mcp-app",
    _meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}} },
    async () => ({contents:[{uri:HTML_URI,mimeType:"text/html;profile=mcp-app",text:await readFile(new URL("./context.html",import.meta.url),"utf8")}]})
  );
  const wrap = method => async (args,extra) => {
    try {
      // extra.sessionId is an MCP transport ID; only the host namespace binds a ZCode session.
      const {sessionId} = readSessionContext(extra._meta);
      const result = await runJob(method,sessionId,args,extra.signal);
      return {content:[],structuredContent:result};
    } catch (error) {
      return {isError:true,content:[{type:"text",text:"Context data is unavailable."}],
        structuredContent:{error:{code:error instanceof ContextError ? error.code : "read_failed"}}};
    }
  };
  const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  server.registerTool("get_context_summary",{description:"App-only read-only session usage and context overview.",
    inputSchema:{revision:z.string().max(64).optional(),historyPage:z.number().int().min(0).max(4).optional()},annotations,_meta:{ui:{visibility:["app"]}}},wrap("overview"));
  server.registerTool("get_context_request",{description:"App-only read-only recorded input and differences.",
    inputSchema:{key:z.string().regex(/^[a-f0-9]{24}$/),page:z.number().int().min(0).max(100000).optional(),
      baselineKey:z.string().regex(/^[a-f0-9]{24}$/).optional(),
      search:z.string().max(200).optional(),searchScope:z.enum(["selected","loaded"]).optional(),role:z.string().max(32).optional(),sort:z.enum(["size","order"]).optional(),
      format:z.enum(["readable","raw"]).optional(),bodySearch:z.string().max(200).optional(),
      changePage:z.number().int().min(0).max(100000).optional(),diffBeforeElement:z.string().regex(/^(message|tool):[0-9]+$/).optional(),
      elementKey:z.string().regex(/^(message|tool):[0-9]+$/).optional(),offset:z.number().int().min(0).max(100000000).optional()},
    annotations,_meta:{ui:{visibility:["app"]}}},wrap("request"));
  return server;
}
const server = createContextServer();
await server.connect(new StdioServerTransport());
let closing = false;
const shutdown = async () => {
  if (closing) return; closing = true;
  await server.close().catch(()=>{}); await worker?.terminate().catch(()=>{}); process.exit(0);
};
process.on("SIGINT",shutdown); process.on("SIGTERM",shutdown);
process.stdin.once("end",shutdown); process.stdin.once("close",shutdown);
