// README variant of scripts/ui-fixture.mjs: the same synthetic story plus ZCode conversation-store rows (prompts, replies,
// injections, a Skill load, a compaction with its summary, a model switch) so the Context events card shows every kind.
// Started by docs/images/src/render.sh; FIXTURE_LANG=en tells the story in English, FIXTURE_TAIL=n records tails.
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { usageDatabase, conversationStore } from "../../../test/fixtures.mjs";

const en = process.env.FIXTURE_LANG === "en", L = (zh, english) => en ? english : zh;
const port = Number(process.env.PORT ?? 4175);
const keep = Number(process.env.FIXTURE_TAIL ?? 0);
const encode = messages => keep && messages.length > keep
  ? { messages: messages.slice(-keep), messagesKind: "tail", messageOffset: messages.length - keep, messageCount: messages.length }
  : { messages, messagesKind: "full", messageOffset: 0, messageCount: messages.length };
const root = await mkdtemp(join(tmpdir(), "context-readme-fixture-"));
const usage = usageDatabase(root);
const store = conversationStore(usage.db);
await mkdir(join(root, "rollout")); await mkdir(join(root, "log"));

const words = "cache entry ttl expires clock now value key store map timer refresh invalidate config request handler session token window budget".split(" ");
const filler = (seed, chars) => { let out = "", i = seed; while (out.length < chars) { out += words[(i * 7 + out.length) % words.length] + (i % 11 === 0 ? ".\n" : " "); i++; } return out.slice(0, chars); };
const code = (name, lines) => Array.from({ length: lines }, (_, i) => i % 9 === 0 ? `export function ${name}${i}(key: string, ttl = ${i * 100}) {` : i % 9 === 8 ? "}" : `  const ${words[i % words.length]}${i} = store.get(key)?.${words[(i + 3) % words.length]} ?? now();`).join("\n");
const schema = (name, size) => ({ type: "function", function: { name, description: `${name} tool. ` + filler(name.length, size),
  parameters: { type: "object", properties: { file_path: { type: "string", description: "Absolute path to the file." }, limit: { type: "number", description: "Optional line limit." } }, required: ["file_path"] } } });
const tools = [["Agent",1900],["AskUserQuestion",4900],["Bash",2500],["CronCreate",6100],["CronDelete",390],["CronList",250],["Edit",990],["EnterPlanMode",4300],
  ["ExitPlanMode",2800],["Glob",700],["Grep",1800],["Read",1450],["Skill",1700],["TaskOutput",1500],["TaskStop",560],["TodoRead",230],["TodoWrite",1150],
  ["WebFetch",770],["Write",660],["SendMessage",1130],["ReadSessionContext",2900],["mcp__node_repl__js",3200]].map(([n, s]) => schema(n, s));
const system = [{ role: "system", content: "You are ZCode, an interactive coding agent" },
  { role: "system", content: "You are an interactive ZCode agent that helps users with software engineering tasks.\n" + filler(1, 1200), cacheControl: { type: "ephemeral" } },
  { role: "system", content: "# Communicating with the user\n\n" + filler(2, 5600), cacheControl: { type: "ephemeral" } }];
const agentList = "<system-reminder>\nAvailable agent types for the Agent tool:\n" + filler(4, 5900) + "\n</system-reminder>";
const reminders = [{ role: "user", content: "<system-reminder>\nThe following skills are available for use with the Skill tool:\n" + filler(3, 7300) + "\n</system-reminder>" },
  { role: "user", content: "<system-reminder>\nAs you answer the user's questions, you can use the following context: today's date is 2026-10-13.\n</system-reminder>" },
  { role: "user", content: agentList }];
const todoReminder = "<system-reminder>\nThe TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool.\n</system-reminder>";
const taskNotice = "<task-notification>\nBackground command \"npm run test:watch\" completed (exit code 0). 42 passed, 0 failed.\n</task-notification>";
const skillOutput = "Launching skill: systematic-debugging\n\n# Systematic debugging\n\n" + filler(10, 3200);
const summaryBody = L("用户在排查缓存 TTL 不生效的问题。已确认原因：`set()` 以秒写入、`isExpired()` 按毫秒比较；已在 src/cache.ts 修复为 `ttl * 1000`，新增 test/cache-ttl.test.ts，全部测试通过。当前任务：把 README 里的缓存说明改为毫秒单位，README.md 已读取并开始编辑。\n",
  "The user is investigating why the cache TTL has no effect. Root cause: `set()` stores seconds while `isExpired()` compares milliseconds; fixed in src/cache.ts as `ttl * 1000`, added test/cache-ttl.test.ts, all tests pass. Current task: change the README cache notes to milliseconds; README.md has been read and editing has started.\n") + filler(8, 1800);

let callId = 0, startedAt = Date.now() - 40 * 60000, model = "deepseek-v4";
const history = [...system, ...reminders];
const results = new Map();
let ops = [];
const call = (name, input) => ({ id: "call_" + (++callId), name, input });
const assistant = (content, calls = []) => ({ role: "assistant", content, toolCalls: calls, providerId: "deepseek", modelId: model });
const result = (c, content, isError = false) => { results.set(c.id, content); return { role: "tool", toolCallId: c.id, toolName: c.name, content, isError }; };
const tick = seconds => { startedAt += seconds * 1000; return new Date(startedAt).toISOString(); };
const lines = [];
function record(sessionId, querySource, messages, turnId, response, at) {
  const input = Math.ceil(JSON.stringify(messages).length / 4) + Math.ceil(JSON.stringify(tools).length / 4);
  const output = 40 + (lines.length * 37) % 600;
  const id = sessionId + "_req_" + lines.length;
  const provider = model.startsWith("glm") ? "zai" : "deepseek";
  usage.add(sessionId, id, input, output, Date.parse(at), { inputTokens: input, outputTokens: output, cacheReadTokens: Math.floor(input * 0.92) }, querySource);
  for (const c of response.calls ?? []) usage.tool(sessionId, sessionId + "_" + c.id, c.name, c.name === "Bash" && /cache$/.test(c.input.command) ? "error" : "completed", Date.parse(at));
  lines.push(JSON.stringify({ type: "model_io", sessionId, requestId: id, attempt: 1, querySource, startedAt: at, turnId, traceId: "trace_" + turnId,
    model: { providerId: provider, modelId: model },
    request: { ...encode(messages), toolNames: tools.map(x => x.function.name), body: { model, tools: querySource === "main_turn" ? tools : [] } },
    response: { text: response.text ?? "", toolCalls: response.calls ?? [],
      usage: { inputTokens: input, outputTokens: output, cacheReadTokens: Math.floor(input * 0.92), totalTokens: input + output } } }));
  return input;
}
// Conversation-store rows are written after the story so tool parts carry their results. Each op writes one message.
const later = fn => ops.push(fn);
const prompt = (sessionId, text, at) => { const id = sessionId + "_msg_" + ops.length; later(() => store.prompt(sessionId, id, at, text)); };
let lastMain = 0;
function step(sessionId, turnId, response, seconds = 14) {
  lastMain = record(sessionId, "main_turn", [...history], turnId, response, tick(seconds));
  if (response.calls?.length || response.text) history.push(assistant(response.text ?? "", response.calls ?? []));
  const at = startedAt + 4000, id = sessionId + "_msg_" + ops.length;
  later(() => store.reply(sessionId, id, at, response.text ?? "", (response.calls ?? []).map(c => [c.name, c.input, results.get(c.id) ?? "", c.id])));
}
function inject(sessionId, text, kind, source) { const at = startedAt + 6000, id = sessionId + "_inj_" + ops.length; later(() => store.reminder(sessionId, id, at, text, kind, source)); }
function story(sessionId) {
  history.splice(0, history.length, ...system, ...reminders); lines.length = 0; callId = 0; startedAt = Date.now() - 40 * 60000; ops = []; model = "deepseek-v4";
  const sessionStart = startedAt;
  later(() => store.reminder(sessionId, sessionId + "_inj_agents", sessionStart - 1500, agentList, "system_reminder", "agent_listing_delta"));
  // Turn 1
  history.push({ role: "user", content: L("检查一下缓存过期逻辑，为什么 TTL 不生效？", "Check the cache expiry logic — why doesn't the TTL work?"), cacheControl: { type: "ephemeral" } });
  prompt(sessionId, L("检查一下缓存过期逻辑，为什么 TTL 不生效？", "Check the cache expiry logic — why doesn't the TTL work?"), sessionStart - 1000);
  let c = call("Skill", { skill: "systematic-debugging" }); step(sessionId, "turn_1", { text: L("先按系统化排查的流程来。", "Let me follow a systematic debugging pass."), calls: [c] }, 0);
  record(sessionId, "session_title", [{ role: "system", content: "Generate a short title." }, { role: "user", content: L("检查一下缓存过期逻辑，为什么 TTL 不生效？", "Check the cache expiry logic — why doesn't the TTL work?") }], "turn_1", { text: L("缓存 TTL 排查", "Cache TTL investigation") }, tick(1));
  history.push(result(c, skillOutput));
  c = call("Read", { file_path: "src/cache.ts" }); step(sessionId, "turn_1", { text: L("我先看一下缓存实现。", "Let me read the cache implementation first."), calls: [c] });
  history.push(result(c, code("cache", 220)));
  c = call("Grep", { pattern: "ttl", path: "src" }); step(sessionId, "turn_1", { calls: [c] });
  history.push(result(c, Array.from({ length: 40 }, (_, i) => `src/${words[i % words.length]}.ts:${i * 3 + 1}:  ttl = config.ttl ?? ${i}`).join("\n")));
  c = call("Read", { file_path: "src/clock.ts" }); step(sessionId, "turn_1", { calls: [c] });
  history.push(result(c, code("clock", 90)));
  c = call("Bash", { command: "npm test -- cache", description: L("运行缓存相关测试", "Run the cache tests") }); step(sessionId, "turn_1", { text: L("跑一下现有测试确认现象。", "Running the existing tests to reproduce it."), calls: [c] });
  history.push(result(c, "FAIL test/cache.test.ts\n  ✕ expires entries after ttl (12 ms)\n" + filler(5, 4800), true));
  step(sessionId, "turn_1", { text: L("找到原因了：`set()` 写入时用的是秒，但 `isExpired()` 比较的是毫秒，TTL 实际被放大了 1000 倍。", "Found it: `set()` stores seconds but `isExpired()` compares milliseconds, so every TTL is 1000× too long.") });
  // Turn 2
  history.push({ role: "user", content: L("那就修复它，并补一个测试", "Fix it and add a test"), cacheControl: { type: "ephemeral" } });
  prompt(sessionId, L("那就修复它，并补一个测试", "Fix it and add a test"), startedAt + 60000);
  c = call("Edit", { file_path: "src/cache.ts", old_string: "ttl * 1", new_string: "ttl * 1000" }); step(sessionId, "turn_2", { calls: [c] }, 70);
  history.push(result(c, "The file src/cache.ts has been updated."));
  c = call("Write", { file_path: "test/cache-ttl.test.ts", content: code("ttlTest", 30) }); step(sessionId, "turn_2", { calls: [c] });
  history.push(result(c, "File created successfully at: test/cache-ttl.test.ts"));
  c = call("Bash", { command: "npm test", description: L("运行全部测试", "Run all tests") }); step(sessionId, "turn_2", { calls: [c] });
  history.push(result(c, "PASS test/cache.test.ts\nPASS test/cache-ttl.test.ts\n" + filler(6, 5600)));
  c = call("TodoWrite", { todos: [{ content: L("修复 TTL 单位", "Fix the TTL unit"), status: "completed" }, { content: L("补充测试", "Add a test"), status: "completed" }] }); step(sessionId, "turn_2", { calls: [c] });
  history.push(result(c, "Todos have been modified successfully."), { role: "user", content: todoReminder });
  inject(sessionId, todoReminder, "todo_reminder", "todo_reminder");
  c = call("Glob", { pattern: "src/**/*.ts" }); step(sessionId, "turn_2", { calls: [c] });
  history.push(result(c, Array.from({ length: 120 }, (_, i) => `src/${words[i % words.length]}/${words[(i * 5) % words.length]}-${i}.ts`).join("\n")));
  const greps = ["setTimeout", "Date.now", "ttl", "expires", "invalidate", "refresh"].map(p => call("Grep", { pattern: p, path: "src" }));
  step(sessionId, "turn_2", { text: L("再确认一下还有没有其它地方用错单位。", "Checking whether any other call site uses the wrong unit."), calls: greps });
  for (const g of greps) history.push(result(g, Array.from({ length: 12 }, (_, i) => `src/${words[i]}.ts:${i + 4}: ${g.input.pattern}(…)`).join("\n")));
  step(sessionId, "turn_2", { text: L("其它调用点都使用毫秒，修复只需要这一处。测试已全部通过。", "Every other call site uses milliseconds, so this one fix is enough. All tests pass.") });
  // Turn 3, with automatic compaction in the middle
  history.push({ role: "user", content: L("顺便把 README 里的缓存说明也更新一下", "Also update the cache notes in the README"), cacheControl: { type: "ephemeral" } });
  prompt(sessionId, L("顺便把 README 里的缓存说明也更新一下", "Also update the cache notes in the README"), startedAt + 90000);
  c = call("Read", { file_path: "README.md" }); step(sessionId, "turn_3", { calls: [c] }, 95);
  history.push(result(c, "# Cache\n\n" + filler(7, 9400)));
  c = call("Edit", { file_path: "README.md", old_string: "TTL in seconds", new_string: "TTL in milliseconds" }); step(sessionId, "turn_3", { calls: [c] });
  const lastSummarized = sessionId + "_msg_" + (ops.length - 1), summarizedCount = ops.length, pre = lastMain;
  const compactAt = tick(6), compactStart = Date.parse(compactAt);
  record(sessionId, "compact", [...history, { role: "user", content: "Summarize the conversation so far for continuation." }], "turn_3", { text: "Summary…" }, compactAt);
  const kept = [...system, ...reminders, { role: "user", content: "This session is being continued from a previous conversation. Summary:\n" + summaryBody },
    { role: "user", content: L("顺便把 README 里的缓存说明也更新一下", "Also update the cache notes in the README") }, history.at(-1)];
  history.splice(0, history.length, ...kept);
  history.push(result(c, "The file README.md has been updated."));
  step(sessionId, "turn_3", { text: L("README 已更新为毫秒单位。", "The README now documents milliseconds.") }, 12);
  const post = lastMain;
  later(() => {
    const summaryId = sessionId + "_msg_summary", id = sessionId + "_cmpA", end = compactStart + 9600;
    store.message(sessionId, summaryId, end, { role: "user", summary: { title: "Compact summary", body: summaryBody }, semantics: { origin: "agent_runtime", kind: "compact_summary", providerVisibility: "visible" } });
    store.part(sessionId, summaryId, id + "_sep", compactStart, { type: "compaction", trigger: "auto", boundaryId: "compact_" + id, operationId: "cmp_" + id, summaryMessageId: summaryId,
      preCompactTokenCount: pre, truePostCompactTokenCount: post, time: { start: compactStart, end }, timelineStatus: "completed" });
    store.part(sessionId, summaryId, id + "_boundary", compactStart, { type: "compaction", trigger: "auto",
      compactBoundary: { boundaryId: "compact_" + id, trigger: "auto", summarizedMessageCount: summarizedCount, keptMessageCount: 2, lastSummarizedMessageId: lastSummarized, summaryMessageId: summaryId } });
  });
  // Turn 4, after switching models
  const switchAt = startedAt + 30000;
  later(() => store.modelChange(sessionId, sessionId + "_msg_model", switchAt, "deepseek/deepseek-v4", "zai/glm-5"));
  model = "glm-5";
  history.push({ role: "user", content: L("好的，再跑一遍全部测试", "Great, run the whole suite once more"), cacheControl: { type: "ephemeral" } });
  prompt(sessionId, L("好的，再跑一遍全部测试", "Great, run the whole suite once more"), startedAt + 50000);
  c = call("Bash", { command: "npm test", description: L("运行全部测试", "Run all tests") }); step(sessionId, "turn_4", { calls: [c] }, 60);
  history.push(result(c, "PASS test/cache.test.ts\nPASS test/cache-ttl.test.ts\n" + filler(9, 6800)), { role: "user", content: taskNotice });
  inject(sessionId, taskNotice, "background_notification", "background_task");
  step(sessionId, "turn_4", { text: L("全部 42 个测试通过，后台的 watch 任务也已结束。", "All 42 tests pass, and the background watch task has finished.") });
  return { sessionStart };
}
async function seed(sessionId) {
  const { sessionStart } = story(sessionId);
  for (const op of ops) op();
  await writeFile(join(root, "rollout", "model-io-" + sessionId + ".jsonl"), lines.join("\n") + "\n");
  const date = new Date(), stamp = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  await appendFile(join(root, "log", "zcode-" + stamp + ".jsonl"), JSON.stringify({ sessionId, event: "mcp.tools.registered", timestamp: new Date(sessionStart - 3000).toISOString(),
    context: { registeredToolCount: 1, serverCount: 1 } }) + "\n");
}
async function appendStep(sessionId) {
  const c = call("Read", { file_path: "src/extra-" + callId + ".ts" });
  history.push({ role: "user", content: "再看一下 extra 模块" });
  startedAt = Date.now();
  record(sessionId, "main_turn", [...history], "turn_live", { calls: [c] }, new Date().toISOString());
  history.push(assistant("", [c]), result(c, code("extra", 60)));
  await appendFile(join(root, "rollout", "model-io-" + sessionId + ".jsonl"), lines.at(-1) + "\n");
}
await seed("sess_A"); await seed("sess_B");

const build = new URL("../../../output/readme-build/", import.meta.url);
const client = new Client({ name: "context-readme-fixture", version: "0.3.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("server.mjs", build))],
  env: { ...process.env, ZCODE_CONTEXT_DATA_ROOT: root, ZCODE_CONTEXT_DB_PATH: usage.path }, stderr: "pipe" }));
const panel = await readFile(new URL("context.html", build));
const host = await readFile(new URL("test/host.js", build));
const shell = width => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:13px system-ui;background:#e9ebef}header{padding:10px 14px;display:flex;gap:8px;align-items:center}main{display:flex;gap:14px;padding:0 14px 14px;align-items:flex-start}iframe{width:${width}px;height:2400px;border:0;background:white;border-radius:8px}</style></head><body><header>UI fixture · synthetic session · not ZCode Desktop <button id="dark">Theme</button><button id="english">English</button></header><main><iframe id="sess_A"></iframe><iframe id="sess_B" style="width:340px"></iframe></main><script type="module" src="/host.js"></script></body></html>`;
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(shell(Number(url.searchParams.get("width") ?? 440))); return; }
    if (url.pathname === "/panel") { res.writeHead(200, { "content-type": "text/html" }); res.end(panel); return; }
    if (url.pathname === "/host.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(host); return; }
    if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    // Killing the process on Windows would orphan the MCP server child; render.sh asks for a clean stop instead.
    if (url.pathname === "/quit") { res.writeHead(204); res.end(); await stop(); return; }
    const sessionId = url.searchParams.get("session");
    if (!["sess_A", "sess_B"].includes(sessionId)) { res.writeHead(400); res.end(); return; }
    if (url.pathname === "/append") { await appendStep(sessionId); res.writeHead(204); res.end(); return; }
    if (url.pathname === "/call" && req.method === "POST") {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const params = JSON.parse(Buffer.concat(chunks));
      const value = await client.callTool({ name: params.name, arguments: params.arguments ?? {}, _meta: { "com.zcode/request-context": { session_id: sessionId } } });
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); return;
    }
    res.writeHead(404); res.end();
  } catch (error) { res.writeHead(500); res.end(String(error)); }
}).listen(port, "127.0.0.1", () => console.log("README fixture: http://127.0.0.1:" + port));
const stop = async () => { await client.close(); usage.db.close(); await rm(root, { recursive: true, force: true }); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
