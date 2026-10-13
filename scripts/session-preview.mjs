// Read-only preview of one real ZCode session through the built plugin service, for checking real data without
// installing the plugin. Reads ~/.zcode/cli (or ZCODE_CONTEXT_DATA_ROOT / ZCODE_CONTEXT_DB_PATH); listens on 127.0.0.1 only.
// Usage: npm run build && npm run preview:session -- sess_xxx [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const sessionId = process.argv[2], port = Number(process.argv[3] ?? 4177);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(sessionId ?? "")) { console.error("Usage: npm run preview:session -- <sessionId> [port]"); process.exit(1); }
const client = new Client({ name: "context-session-preview", version: "0.3.2" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../dist/server.mjs", import.meta.url))], env: process.env, stderr: "pipe" }));
const panel = await readFile(new URL("../dist/context.html", import.meta.url)), host = await readFile(new URL("../dist/test/host.js", import.meta.url));
const shell = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:13px system-ui;background:#e9ebef}header{padding:10px 14px;display:flex;gap:8px;align-items:center}main{display:flex;gap:14px;padding:0 14px 14px;align-items:flex-start}iframe{height:1500px;border:0;background:white;border-radius:8px}</style></head><body><header>Read-only session preview · ${sessionId} <button id="dark">Theme</button><button id="english">English</button></header><main><iframe id="sess_A" style="width:440px"></iframe><iframe id="sess_B" style="width:340px"></iframe></main><script type="module" src="/host.js"></script></body></html>`;
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(shell); return; }
    if (url.pathname === "/panel") { res.writeHead(200, { "content-type": "text/html" }); res.end(panel); return; }
    if (url.pathname === "/host.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(host); return; }
    if (url.pathname === "/call" && req.method === "POST") {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const params = JSON.parse(Buffer.concat(chunks));
      if (!["get_context_summary", "get_context_request"].includes(params.name)) throw new Error("Unknown tool");
      // Both panes of the shell show the same session; the host's per-frame session IDs are only frame labels here.
      const value = await client.callTool({ name: params.name, arguments: params.arguments ?? {}, _meta: { "com.zcode/request-context": { session_id: sessionId } } });
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); return;
    }
    res.writeHead(404); res.end();
  } catch (error) { res.writeHead(500); res.end(String(error)); }
}).listen(port, "127.0.0.1", () => console.log("Session preview (read-only): http://127.0.0.1:" + port));
const stop = async () => { await client.close(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
