import test from "node:test";
import assert from "node:assert/strict";
import { foldRecord, diffRecords, composition } from "../src/domain/trajectory.mjs";
import { createSizeLedger, measureRecord, storeSizes } from "../src/domain/ledger.mjs";
import { modelRecord } from "./fixtures.mjs";

const system = { role: "system", content: "You are a coding agent. ".repeat(20) };
const prompt = { role: "user", content: "Please read the cache module and fix the expiry check." };
const reply = (ids, text = "Reading the files.") => ({ role: "assistant", content: text, toolCalls: ids.map(id => ({ id, name: "Read", input: { file_path: id + ".ts" } })) });
const result = (id, content) => ({ role: "tool", toolCallId: id, toolName: "Read", content });
// A request record with its own reported usage and, for the next request to prove its reply, the response's calls.
const request = (id, messages, input, output, calls = [], extra = {}) => modelRecord("sess_A", id, messages, {
  response: { text: extra.text ?? "", usage: { inputTokens: input, outputTokens: output }, toolCalls: calls.map(c => ({ toolCallId: c, toolName: "Read", input: {} })) },
  ...(extra.raw ?? {}) });
function run(raws, options = {}) {
  const ledger = createSizeLedger(); let previous;
  return raws.map(raw => { const record = foldRecord(raw, previous); previous = record;
    return { record, sizes: measureRecord(ledger, record, { segment: options.segments?.shift() ?? 0, store: options.store ?? null, breaks: options.breaks ?? [] }) }; });
}
const size = (sizes, key) => sizes.byKey.get(key);

test("a reply is measured at its response's output and a lone tool result at the rest of the increase", () => {
  const [first, second] = run([request("a", [system, prompt], 1000, 50, ["c1"]),
    request("b", [system, prompt, reply(["c1"]), result("c1", "export const ttl = 60;\n".repeat(40))], 1400, 30)]);
  assert.equal(first.sizes.total, 1000);
  assert.equal(size(first.sizes, "message:0").kind, "split");
  assert.equal(size(first.sizes, "message:0").share.scope, "base");
  assert.equal(Math.round(size(first.sizes, "message:0").tokens + size(first.sizes, "message:1").tokens), 1000);
  assert.deepEqual([size(second.sizes, "message:2").kind, size(second.sizes, "message:2").source, size(second.sizes, "message:2").tokens], ["measured", "reply", 50]);
  assert.deepEqual([size(second.sizes, "message:3").kind, size(second.sizes, "message:3").source, size(second.sizes, "message:3").tokens], ["measured", "increment", 350]);
  // What was already there keeps the size it was booked at.
  assert.equal(size(second.sizes, "message:0").tokens, size(first.sizes, "message:0").tokens);
  assert.equal(second.sizes.measured, 400);
  const buckets = Object.fromEntries(composition(second.record, second.sizes).buckets.map(b => [b.role, b]));
  assert.equal(buckets.tool.tokens, 350); assert.equal(buckets.tool.measuredTokens, 350);
  assert.equal(buckets.system.measuredTokens, 0);
  const diff = diffRecords(first.record, second.record, first.sizes, second.sizes);
  assert.equal(diff.sizeDelta, 400); assert.equal(diff.sizeExact, true);
  assert.equal(diff.categories.find(c => c.role === "tool").sizeDelta, 350);
  assert.equal(diff.added.find(x => x.role === "tool").tokens, 350);
});

test("several new items share the measured rest of an increase by estimate, and say so", () => {
  const [, second] = run([request("a", [system, prompt], 1000, 50, ["c1", "c2"]),
    request("b", [system, prompt, reply(["c1", "c2"]), result("c1", "short"), result("c2", "x".repeat(4000))], 1600, 30)]);
  const one = size(second.sizes, "message:3"), two = size(second.sizes, "message:4");
  assert.equal(size(second.sizes, "message:2").tokens, 50);
  assert.equal(one.kind, "split"); assert.equal(two.kind, "split");
  assert.deepEqual(one.share, { tokens: 550, count: 2, scope: "step" });
  assert.equal(Math.round(one.tokens + two.tokens), 550);
  assert.ok(two.tokens > one.tokens);
});

test("a reply whose tool calls differ from the previous response is not booked at that response's output", () => {
  const [, second] = run([request("a", [system, prompt], 1000, 50, ["c1"]),
    request("b", [system, prompt, reply(["other"]), result("other", "data")], 1400, 30)]);
  assert.equal(size(second.sizes, "message:2").kind, "split");
  assert.equal(size(second.sizes, "message:3").kind, "split");
});

test("a text reply is proven by the response text; the prompt that follows is measured", () => {
  const answer = "The expiry check compared seconds with milliseconds; it is fixed now.";
  const [, second] = run([request("a", [system, prompt], 1000, 40, [], { text: answer }),
    request("b", [system, prompt, { role: "assistant", content: answer }, { role: "user", content: "Thanks, add a test." }], 1100, 20)]);
  assert.deepEqual([size(second.sizes, "message:2").source, size(second.sizes, "message:2").tokens], ["reply", 40]);
  assert.deepEqual([size(second.sizes, "message:3").source, size(second.sizes, "message:3").tokens], ["increment", 60]);
});

test("what leaves is subtracted at its booked size; an increase that cannot be explained starts over", () => {
  const big = result("c1", "y".repeat(3000)), cleared = result("c1", "[cleared]");
  const steps = run([request("a", [system, prompt], 1000, 50, ["c1"]),
    request("b", [system, prompt, reply(["c1"]), big], 1800, 30),
    request("c", [system, prompt, reply(["c1"]), cleared], 1100, 30),
    request("d", [system, prompt, reply(["c1"]), cleared, { role: "user", content: "next" }], 900, 30)]);
  assert.equal(size(steps[1].sizes, "message:3").tokens, 750);
  // The cleared result replaced 750 booked tokens and the request shrank by 700.
  assert.deepEqual([size(steps[2].sizes, "message:3").kind, size(steps[2].sizes, "message:3").tokens], ["measured", 50]);
  // Adding a message while the reported input shrinks has no consistent reading, so the request is split afresh.
  assert.equal(size(steps[3].sizes, "message:4").kind, "split");
  assert.equal(size(steps[3].sizes, "message:4").share.scope, "base");
  assert.equal(Math.round([...steps[3].sizes.byKey.values()].reduce((n, x) => n + x.tokens, 0)), 900);
});

test("a model whose output keeps exceeding the next increase stops being booked at its output", () => {
  // Each response reports 500 output tokens, but only 300 tokens enter with the next request.
  const raws = [request("r0", [system, prompt], 1000, 500, ["c0"])], messages = [system, prompt];
  for (let i = 0; i < 12; i++) {
    messages.push(reply(["c" + i]), result("c" + i, "z".repeat(400)));
    raws.push(request("r" + (i + 1), [...messages], 1000 + 300 * (i + 1), i === 11 ? 20 : 500, ["c" + (i + 1)]));
  }
  messages.push(reply(["c12"]), result("c12", "z".repeat(400)));
  raws.push(request("last", [...messages], 1000 + 300 * 12 + 300, 20));
  const steps = run(raws);
  const lastReply = "message:" + (messages.length - 2);
  // The last response's 20 tokens fit the increase, yet the model already failed the check.
  assert.equal(size(steps.at(-1).sizes, lastReply).kind, "split");
  assert.ok(steps.slice(1).every(step => [...step.sizes.byKey.values()].every(x => x.source !== "reply" && x.source !== "earlier")));
});

test("a partial record is never split: appends are measured and the rest of the reported input stays unrecorded", () => {
  const tail = { messages: [prompt, reply(["c1"])], messagesKind: "tail", messageOffset: 10, messageCount: 12, toolNames: [] };
  const delta = { messages: [result("c1", "q".repeat(800)), reply(["c2"])], messagesKind: "delta", messageOffset: 12, messageCount: 14, toolNames: [] };
  const [first, second] = run([
    modelRecord("sess_A", "a", [], { request: tail, response: { text: "", usage: { inputTokens: 9000, outputTokens: 70 }, toolCalls: [{ toolCallId: "c2" }] } }),
    modelRecord("sess_A", "b", [], { request: delta, response: { text: "", usage: { inputTokens: 9400, outputTokens: 10 }, toolCalls: [] } })]);
  assert.equal(first.sizes.complete, false);
  assert.equal(size(first.sizes, "message:0").kind, "estimated");
  const recorded = [...first.sizes.byKey.values()].reduce((n, x) => n + x.tokens, 0);
  assert.equal(Math.round(first.sizes.unrecorded), Math.round(9000 - recorded));
  assert.deepEqual([size(second.sizes, "message:3").source, size(second.sizes, "message:3").tokens], ["reply", 70]);
  assert.deepEqual([size(second.sizes, "message:2").source, size(second.sizes, "message:2").tokens], ["increment", 330]);
  assert.equal(Math.round(second.sizes.unrecorded), Math.round(first.sizes.unrecorded));
  assert.equal(composition(second.record, second.sizes).sizes.complete, false);
});

test("a moving tail window continues the previous one: what slid out is unrecorded, not removed", () => {
  const older = [{ role: "user", content: "older question" }, { role: "assistant", content: "older answer" }];
  const window = (offset, messages) => ({ messages, messagesKind: "tail", messageOffset: offset, messageCount: offset + messages.length, toolNames: [] });
  const usage = (input, output, calls = []) => ({ text: "", usage: { inputTokens: input, outputTokens: output }, toolCalls: calls.map(c => ({ toolCallId: c })) });
  const [first, second] = run([
    modelRecord("sess_A", "a", [], { request: window(10, [...older, prompt, reply(["c1"])]), response: usage(9000, 70, ["c2"]) }),
    modelRecord("sess_A", "b", [], { request: window(12, [prompt, reply(["c1"]), result("c1", "q".repeat(800)), reply(["c2"])]), response: usage(9400, 10) })]);
  assert.deepEqual([size(second.sizes, "message:3").source, size(second.sizes, "message:3").tokens], ["reply", 70]);
  assert.deepEqual([size(second.sizes, "message:2").source, size(second.sizes, "message:2").tokens], ["increment", 330]);
  // The two older messages are still sent; their share moved into the unrecorded part.
  const slid = size(first.sizes, "message:0").tokens + size(first.sizes, "message:1").tokens;
  assert.equal(Math.round(second.sizes.unrecorded), Math.round(first.sizes.unrecorded + slid));
  // A window that moved back, or changed a message where the two overlap, is not a continuation.
  const back = run([
    modelRecord("sess_A", "a", [], { request: window(12, [prompt, reply(["c1"])]), response: usage(9000, 70, ["c2"]) }),
    modelRecord("sess_A", "b", [], { request: window(11, [older[1], prompt, reply(["c1"])]), response: usage(9100, 10) })]);
  assert.equal(size(back[1].sizes, "message:2").kind, "estimated");
  const edited = run([
    modelRecord("sess_A", "a", [], { request: window(10, [...older, prompt]), response: usage(9000, 70) }),
    modelRecord("sess_A", "b", [], { request: window(11, [{ role: "assistant", content: "edited" }, prompt, { role: "user", content: "more" }]), response: usage(9100, 10) })]);
  assert.equal(size(edited[1].sizes, "message:2").kind, "estimated");
});

test("content measured once keeps its size when the series starts over or reappears among several new items", () => {
  const reminder = { role: "user", content: "<system-reminder>\nThe task list has not been updated recently.\n</system-reminder>" };
  const steps = run([request("a", [system, prompt], 1000, 50, ["c1"]),
    request("b", [system, prompt, reply(["c1"]), reminder], 1200, 40, ["c2"]),
    request("c", [system, prompt, reply(["c1"]), reminder, reply(["c2"]), result("c2", "w".repeat(900)), reminder], 1700, 10),
    request("d", [system, prompt, reply(["c1"]), reminder, { role: "user", content: "a new question" }], 1100, 10)]);
  assert.deepEqual([size(steps[1].sizes, "message:3").source, size(steps[1].sizes, "message:3").tokens], ["increment", 150]);
  // The reminder came back with a tool result: it keeps its 150 and the result gets the rest of the increase.
  assert.deepEqual([size(steps[2].sizes, "message:6").source, size(steps[2].sizes, "message:6").tokens], ["earlier", 150]);
  assert.deepEqual([size(steps[2].sizes, "message:5").kind, size(steps[2].sizes, "message:5").tokens], ["measured", 500 - 40 - 150]);
  // The last request shrank by more than what left was booked at, so it starts over, keeping the sizes already known.
  assert.equal(size(steps[3].sizes, "message:4").share.scope, "base");
  assert.deepEqual([size(steps[3].sizes, "message:2").source, size(steps[3].sizes, "message:2").tokens], ["earlier", 50]);
  assert.deepEqual([size(steps[3].sizes, "message:3").source, size(steps[3].sizes, "message:3").tokens], ["earlier", 150]);
  assert.equal(Math.round([...steps[3].sizes.byKey.values()].reduce((n, x) => n + x.tokens, 0)), 1100);
});

test("a gap or a model switch starts a new series; a request without reported input has no sizes", () => {
  const first = request("a", [system, prompt], 1000, 50, ["c1"]), next = request("b", [system, prompt, reply(["c1"]), result("c1", "data")], 1400, 30);
  assert.equal(size(run([first, next], { segments: [0, 1] })[1].sizes, "message:3").share.scope, "base");
  const switched = { ...next, model: { providerId: "demo", modelId: "other-model" } };
  assert.equal(size(run([first, switched])[1].sizes, "message:3").share.scope, "base");
  assert.equal(run([request("x", [prompt], 0, 0)])[0].sizes, null);
});

test("the conversation store measures replies and lone tool results where a series starts", () => {
  const conversation = { messages: new Map([["u1", { role: "user", visibility: "visible", created: 1 }]]), parts: new Map(),
    tools: new Map([["p1", { messageId: "a1", callId: "c1", outputChars: 4 }], ["p2", { messageId: "a2", callId: "c2", outputChars: 1 }], ["p3", { messageId: "a2", callId: "c3", outputChars: 1 }]]) };
  const rows = [{ message: "a1", startedAt: 10, source: "main_turn", model: "demo-model", input: 1000, output: 50 },
    { message: "a2", startedAt: 20, source: "main_turn", model: "demo-model", input: 1400, output: 60 },
    { message: "a3", startedAt: 30, source: "main_turn", model: "demo-model", input: 2000, output: 10 }];
  const store = storeSizes(rows, conversation), lookup = store.lookup("demo-model");
  assert.equal(lookup({ role: "assistant", calls: ["c1"] }), 50);
  assert.equal(lookup({ role: "tool", toolCallId: "c1", chars: 4 }), 350);
  // The result sent is not the content the store measured (cleared, rewritten): another length.
  assert.equal(lookup({ role: "tool", toolCallId: "c1", chars: 9 }), null);
  // Two results of one reply share an increase: neither is measured on its own.
  assert.equal(lookup({ role: "tool", toolCallId: "c2", chars: 1 }), null);
  assert.equal(lookup({ role: "assistant", calls: ["c2", "c3"] }), 60);
  assert.equal(lookup({ role: "assistant", calls: ["c2"] }), null);
  // The newest request has no next one to check its output against.
  assert.equal(store.lookup("another-model")({ role: "assistant", calls: ["c1"] }), null);
  // A visible message created between two requests also entered with the increase.
  const prompted = storeSizes(rows, { ...conversation, messages: new Map([["u2", { role: "user", visibility: "visible", created: 15 }]]) });
  assert.equal(prompted.lookup("demo-model")({ role: "tool", toolCallId: "c1", chars: 4 }), null);
  // A compaction or model switch between them changes what the next request sends.
  const compacted = storeSizes(rows, { ...conversation, parts: new Map([["x", { type: "compaction", created: 15 }]]) });
  assert.equal(compacted.lookup("demo-model")({ role: "assistant", calls: ["c1"] }), null);
  assert.equal(storeSizes(rows, conversation, [15]).lookup("demo-model")({ role: "tool", toolCallId: "c1", chars: 4 }), null);
  const [base] = run([request("b", [system, prompt, reply(["c1"]), result("c1", "data")], 1400, 60)], { store });
  assert.deepEqual([size(base.sizes, "message:2").source, size(base.sizes, "message:2").tokens], ["store", 50]);
  assert.deepEqual([size(base.sizes, "message:3").source, size(base.sizes, "message:3").tokens], ["store", 350]);
  assert.deepEqual(size(base.sizes, "message:0").share, { tokens: 1000, count: 2, scope: "base" });
});

test("the conversation store gives no sizes for a model whose output does not come back as input", () => {
  const rows = [], tools = new Map();
  for (let i = 0; i < 12; i++) { rows.push({ message: "m" + i, startedAt: i, source: "main_turn", model: "reasoner", input: 1000 + 100 * i, output: 400 }); tools.set("p" + i, { messageId: "m" + i, callId: "c" + i, outputChars: 1 }); }
  const store = storeSizes(rows, { messages: new Map(), parts: new Map(), tools });
  assert.equal(store.lookup("reasoner"), null);
  // Its records book no reply at output from the first one, before their own guard has seen ten steps.
  const reasoner = { raw: { model: { providerId: "demo", modelId: "reasoner" } } };
  const [, step] = run([request("a", [system, prompt], 1000, 50, ["c1"], reasoner),
    request("b", [system, prompt, reply(["c1"]), result("c1", code)], 1400, 30, [], reasoner)], { store });
  assert.ok([...step.sizes.byKey.values()].every(x => x.source !== "reply"));
});

// Helpers for the cases below.
const code = "export const ttl = 60;\n".repeat(40);
const reminder = { role: "user", content: "<system-reminder>\nThe task list has not been updated recently.\n</system-reminder>" };
const sum = sizes => [...sizes.byKey.values()].reduce((n, x) => n + x.tokens, 0);
const kinds = sizes => [...sizes.byKey.values()].map(x => x.kind);
const usage = (input, output, calls = []) => ({ text: "", usage: { inputTokens: input, outputTokens: output }, toolCalls: calls.map(c => ({ toolCallId: c })) });
const window = (offset, messages, tools = null) => ({ messages, messagesKind: "tail", messageOffset: offset, messageCount: offset + messages.length,
  toolNames: tools ? tools.map(t => t.function.name) : [], ...(tools ? { body: { tools } } : {}) });
const schema = name => ({ type: "function", function: { name, description: name + " " + "d".repeat(400), parameters: { type: "object" } } });
// Request i reports outputs[i]; each next request adds that response's reply and a result, and grows by 300.
function loop(outputs) {
  const raws = [], messages = [system, prompt];
  outputs.forEach((output, i) => {
    if (i) messages.push(reply(["c" + (i - 1)]), result("c" + (i - 1), "z".repeat(400)));
    raws.push(request("r" + i, [...messages], 1000 + 300 * i, output, ["c" + i]));
  });
  return raws;
}
const lastReplyBooked = step => size(step.sizes, "message:" + (step.record.messages.items.length - 2)).source === "reply";
const row = (message, startedAt, input, output, model = "demo-model") => ({ message, startedAt, source: "main_turn", model, input, output });
const store = (rows, tools, extra = {}) => storeSizes(rows, { messages: new Map(), parts: new Map(), tools, ...extra });

test("a complete request's sizes and its residual add up to its total; a measured size is never below one token", () => {
  const answer = "The expiry check compared seconds with milliseconds.", history = [system, prompt, reply(["c1"]), result("c1", code)];
  const steps = run([request("a", [system, prompt], 1000, 50, ["c1"]), request("b", history, 1400, 30, [], { text: answer }),
    // Only the reply entered: the increase itself is its size.
    request("c", [...history, { role: "assistant", content: answer }], 1435, 20),
    // Nothing entered, yet the input grew by 10: within tolerance, carried as the residual.
    request("d", [...history, { role: "assistant", content: answer }], 1445, 20),
    // Nothing entered and the input grew by 65: no consistent reading, so the request is split afresh.
    request("e", [...history, { role: "assistant", content: answer }], 1510, 20)]);
  for (const { sizes } of steps) {
    assert.ok(Math.abs(sum(sizes) + sizes.residual - sizes.total) < 1e-6);
    assert.ok([...sizes.byKey.values()].every(x => x.kind !== "measured" || x.tokens >= 1));
  }
  assert.deepEqual([size(steps[2].sizes, "message:4").source, size(steps[2].sizes, "message:4").tokens], ["increment", 35]);
  assert.equal(steps[3].sizes.residual, 10);
  assert.equal(size(steps[4].sizes, "message:0").share.scope, "base");
  assert.equal(steps[4].sizes.residual, 0);
});

test("a reply is not booked at an output that leaves nothing for what entered with it", () => {
  // The response's 50 output tokens are more than the 45 that entered with its result.
  const [, step] = run([request("a", [system, prompt], 1000, 50, ["c1"]), request("b", [system, prompt, reply(["c1"]), result("c1", "ok")], 1045, 10)]);
  assert.deepEqual(kinds(step.sizes).slice(2), ["split", "split"]);
  assert.ok(Math.abs(sum(step.sizes) - 1045) < 1e-6);
});

test("an increase measured against a removal booked at a split share is split too, never measured", () => {
  const head = [system, prompt, reminder, reply(["c1", "c2"]), result("c1", "short")], cleared = result("c2", "[cleared]");
  const start = [request("a", [system, prompt], 1000, 0), request("b", [system, prompt, reminder], 1150, 50, ["c1", "c2"]),
    request("c", [...head, result("c2", "x".repeat(4000))], 1750, 30)];
  const alone = run([...start, request("d", [...head, cleared], 1300, 30)]);
  assert.deepEqual([size(alone[3].sizes, "message:5").kind, size(alone[3].sizes, "message:5").share?.scope], ["split", "removal"]);
  const withReminder = run([...start, request("d", [...head, cleared, reminder], 1500, 30)]);
  assert.deepEqual(kinds(withReminder[3].sizes).slice(5), ["split", "split"]);
});

test("a model that fails the reply guard has its sizes split afresh, and they are not reused when its series starts over", () => {
  const messages = [system, prompt, reply(["c0"]), result("c0", code)];
  const raws = [request("a", [system, prompt], 1000, 50, ["c0"]), request("b", [...messages], 1400, 500, ["c1"])];
  for (let i = 1; i <= 12; i++) { messages.push(reply(["c" + i]), result("c" + i, "z".repeat(400))); raws.push(request("r" + i, [...messages], 1400 + 300 * i, 500, ["c" + (i + 1)])); }
  raws.push(request("again", [system, prompt, reply(["c0"]), result("c0", code)], 1400, 10));
  const steps = run(raws, { segments: [...raws.slice(0, -1).map(() => 0), 1] });
  assert.equal(size(steps[1].sizes, "message:3").source, "increment");
  // The request where the guard tripped no longer carries the reply and result measured before it.
  const tripped = steps.findIndex((step, i) => i > 1 && size(step.sizes, "message:3").kind === "split");
  assert.ok(tripped > 1 && steps.slice(tripped).every(step => !kinds(step.sizes).includes("measured")));
  assert.deepEqual([...new Set(kinds(steps.at(-1).sizes))], ["split"]);
});

test("the reply guard needs at least three misses above 5% of ten checks, and belongs to one model", () => {
  assert.equal(lastReplyBooked(run(loop([500, 500, 500, ...Array(10).fill(100)])).at(-1)), false);
  assert.equal(lastReplyBooked(run(loop([500, 500, ...Array(10).fill(100)])).at(-1)), true);
  assert.equal(lastReplyBooked(run(loop([500, ...Array(40).fill(100)])).at(-1)), true);
  const other = { raw: { model: { providerId: "demo", modelId: "other-model" } } };
  const steps = run([...loop([50, ...Array(12).fill(500)]),
    request("o1", [system, prompt, reply(["c0"]), result("c0", "z".repeat(400))], 1450, 40, ["d1"], other),
    request("o2", [system, prompt, reply(["c0"]), result("c0", "z".repeat(400)), reply(["d1"]), result("d1", code)], 1850, 10, [], other)]);
  assert.equal(size(steps[1].sizes, "message:3").kind, "measured");
  // What demo-model measured is not reused for other-model, whose own replies are still booked.
  assert.deepEqual([...new Set(kinds(steps.at(-2).sizes))], ["split"]);
  assert.deepEqual([size(steps.at(-1).sizes, "message:4").source, size(steps.at(-1).sizes, "message:4").tokens], ["reply", 40]);
});

test("a tail window is not continued past the previous end, after a rewind, after losing an estimated schema, or across a compaction", () => {
  const second = (first, next, options) => run([modelRecord("sess_A", "a", [], { request: first, response: usage(9000, 70, ["c2"]) }),
    modelRecord("sess_A", "b", [], { request: next, response: usage(9400, 10) })], options)[1].sizes;
  const all = sizes => [...new Set(kinds(sizes))];
  assert.deepEqual(all(second(window(10, [prompt, reply(["c1"])]), window(13, [reply(["c2"]), result("c2", "q".repeat(800))]))), ["estimated"]);
  assert.deepEqual(all(second(window(10, [prompt, reply(["c1"]), result("c1", code)]), window(10, [prompt, reply(["c1"])]))), ["estimated"]);
  assert.deepEqual(all(second(window(10, [prompt, reply(["c1"])], [schema("Read"), schema("Write")]),
    window(10, [prompt, reply(["c1"]), result("c1", "q".repeat(800)), reply(["c2"])], [schema("Read")]))), ["estimated"]);
  const appended = [window(10, [prompt, reply(["c1"])]), window(10, [prompt, reply(["c1"]), result("c1", "q".repeat(800)), reply(["c2"])])];
  const records = appended.map((request, i) => modelRecord("sess_A", "r" + i, [], { request, startedAt: new Date(1000 + i * 1000).toISOString(),
    response: usage(9000 + 400 * i, i ? 10 : 70, i ? [] : ["c2"]) }));
  assert.equal(size(run(records)[1].sizes, "message:3").source, "reply");
  assert.deepEqual(all(run(records, { breaks: [1500] })[1].sizes), ["estimated"]);
});

test("a partial record does not continue into a complete one, and named but unrecorded schemas make a record partial", () => {
  const [, second] = run([modelRecord("sess_A", "a", [], { request: window(1, [prompt]), response: usage(1000, 50, ["c1"]) }),
    request("b", [system, prompt, reply(["c1"]), result("c1", code)], 1400, 30)]);
  assert.equal(second.sizes.complete, true); assert.ok(!kinds(second.sizes).includes("estimated"));
  const named = (id, messages, input, output, calls = []) => modelRecord("sess_A", id, messages, {
    request: { messages, messagesKind: "full", messageCount: messages.length, toolNames: ["Read"] }, response: usage(input, output, calls) });
  const [a, b] = run([named("a", [system, prompt], 1000, 50, ["c1"]), named("b", [system, prompt, reply(["c1"]), result("c1", code)], 1400, 30)]);
  assert.equal(a.sizes.complete, false); assert.equal(size(a.sizes, "message:0").kind, "estimated"); assert.ok(a.sizes.unrecorded > 0);
  assert.equal(diffRecords(a.record, b.record, a.sizes, b.sizes).sizeExact, false);
});

test("a reply is proven only by exactly the response's call IDs, or by its whole text", () => {
  for (const ids of [["c1"], ["c1", "c1"], ["c1", "c2", "c3"]]) {
    const [, step] = run([request("a", [system, prompt], 1000, 50, ["c1", "c2"]),
      request("b", [system, prompt, reply(ids), result("c1", "data"), { role: "user", content: "go on" }], 1400, 30)]);
    assert.equal(size(step.sizes, "message:2").kind, "split", ids.join());
  }
  for (const [said, text] of [["The fix is in place now.", "Something else entirely."], ["ok", "ok"], ["The fix is in place now.", "The fix is in place now. And more besides."]]) {
    const [, step] = run([request("a", [system, prompt], 1000, 40, [], { text: said }),
      request("b", [system, prompt, { role: "assistant", content: text }, { role: "user", content: "Thanks, add a test." }], 1100, 20)]);
    assert.equal(size(step.sizes, "message:2").kind, "split", text);
  }
  const raw = request("a", [system, prompt], 1000, 50); raw.response.toolCalls = [{ id: "c1", name: "Read", input: {} }];
  assert.equal(size(run([raw, request("b", [system, prompt, reply(["c1"]), result("c1", code)], 1400, 30)])[1].sizes, "message:2").source, "reply");
  const [, two] = run([request("a", [system, prompt], 1000, 80, ["c1"]),
    request("b", [system, prompt, reply(["c1"]), { role: "assistant", content: "A second assistant message." }, result("c1", code)], 1500, 10)]);
  assert.ok([...two.sizes.byKey.values()].every(x => x.source !== "reply"));
});

test("identical messages pair one for one, a request without usage keeps the series, and a remembered size must fit", () => {
  const steps = run([request("a", [system, prompt], 1000, 0), request("b", [system, prompt, reminder], 1150, 0), request("retry", [system, prompt, reminder], 0, 0),
    request("c", [system, prompt, reminder, reminder], 1300, 0), request("d", [system, prompt, reminder], 1150, 0)]);
  assert.equal(steps[2].sizes, null);
  assert.deepEqual([size(steps[3].sizes, "message:3").source, size(steps[3].sizes, "message:3").tokens], ["increment", 150]);
  assert.deepEqual([size(steps[4].sizes, "message:2").kind, size(steps[4].sizes, "message:2").tokens], ["measured", 150]);
  const misfit = run([request("a", [system, prompt], 1000, 0), request("b", [system, prompt, reminder], 1150, 0),
    request("c", [system, prompt, reminder, reminder, result("c9", "w".repeat(400))], 1250, 0)]);
  assert.deepEqual(kinds(misfit[2].sizes).slice(3), ["split", "split"]);
});

test("known sizes that leave no plausible room in a total are not used", () => {
  const tools = new Map([["p1", { messageId: "a1", callId: "c1", outputChars: 4 }]]);
  const known = store([row("a1", 10, 1000, 50), row("a2", 20, 1400, 60)], tools);
  // 400 known tokens in a total of 420 leave 20 for a system prompt and a question estimated at several times that.
  for (const total of [300, 420]) {
    const [base] = run([request("b", [system, prompt, reply(["c1"]), result("c1", "data")], total, 60)], { store: known });
    assert.deepEqual([...new Set(kinds(base.sizes))], ["split"]);
    assert.ok(Math.abs(sum(base.sizes) - total) < 1e-6);
  }
  const [kept] = run([request("b", [system, prompt, reply(["c1"]), result("c1", "data")], 1400, 60)], { store: known });
  assert.equal(size(kept.sizes, "message:3").source, "store");
});

test("the store pairs a request only with the very next one of its source, by the same model and with one completed row", () => {
  const tools = new Map([["p1", { messageId: "a1", callId: "c1", outputChars: 4 }], ["p2", { messageId: "b2", callId: "c2", outputChars: 4 }]]);
  const tool = { role: "tool", toolCallId: "c1", chars: 4 };
  assert.equal(store([row("a1", 10, 1000, 50, "A"), row("b2", 20, 1400, 60, "B"), row("a3", 30, 2000, 10, "A")], tools).lookup("A")(tool), null);
  // A completed request linked to no message is still the next request.
  assert.equal(store([row("a1", 10, 1000, 50), row(null, 20, 1400, 60), row("a3", 30, 2000, 10)], tools).lookup("demo-model")(tool), 350);
  assert.equal(store([row("a1", 10, 1000, 50), row("a1", 15, 1000, 50), row("a2", 20, 1400, 60)], tools).lookup("demo-model")(tool), null);
  // Output larger than the whole increase is neither a reply size nor a negative result.
  const over = store([row("a1", 10, 1000, 500), row("a2", 20, 1400, 60)], tools).lookup("demo-model");
  assert.equal(over({ role: "assistant", calls: ["c1"] }), null); assert.equal(over(tool), null);
  // A shrinking request (a compaction) is no evidence against the model.
  const rows = [], many = new Map();
  for (let i = 0; i < 13; i++) { rows.push(row("m" + i, i, i < 7 ? 1000 + 100 * i : 100 * i - 100, 50)); many.set("p" + i, { messageId: "m" + i, callId: "k" + i, outputChars: 1 }); }
  assert.equal(store(rows, many).lookup("demo-model")({ role: "tool", toolCallId: "k1", chars: 1 }), 50);
});

test("category changes count only what entered and left, are exact only when that is measured, and need one model", () => {
  const big = result("c1", "y".repeat(3000)), steps = run([request("a", [system, prompt], 1000, 50, ["c1"]),
    request("b", [system, prompt, reply(["c1"]), big], 1800, 30),
    request("c", [system, prompt, reply(["c1"]), big, { role: "user", content: "next" }], 1700, 10)]);
  const step = (x, y) => diffRecords(steps[x].record, steps[y].record, steps[x].sizes, steps[y].sizes);
  const exact = step(0, 1), category = (d, role) => d.categories.find(c => c.role === role);
  assert.deepEqual([exact.sizeDelta, exact.sizeExact, category(exact, "tool").sizeDelta, category(exact, "tool").sizeExact], [800, true, 750, true]);
  // The last request was split afresh: unchanged categories show no change, and the new prompt's share is not exact.
  const resplit = step(1, 2);
  assert.deepEqual([category(resplit, "system").sizeDelta, category(resplit, "tool").sizeDelta], [0, 0]);
  assert.equal(category(resplit, "user").sizeExact, false);
  assert.deepEqual([resplit.sizeDelta, resplit.sizeExact], [-100, true]);
  const switched = { ...steps[1].record, model: { providerId: "demo", modelId: "other-model" } };
  const across = diffRecords(steps[0].record, switched, steps[0].sizes, steps[1].sizes);
  assert.equal(across.sizeDelta, undefined); assert.ok(across.categories.every(c => c.sizeDelta === undefined));
  // A category holding any estimated share is not wholly measured, however small the share.
  const buckets = Object.fromEntries(composition(steps[1].record, steps[1].sizes).buckets.map(b => [b.role, b]));
  assert.deepEqual([buckets.tool.measuredCount, buckets.tool.count, buckets.system.measuredCount], [1, 1, 0]);
  assert.equal(composition(steps[1].record, steps[1].sizes).sizes.residual, 0);
});
