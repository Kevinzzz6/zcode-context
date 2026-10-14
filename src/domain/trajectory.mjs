import { nonnegative } from "./session.mjs";
const MAX_CONTEXT_CHARS = 24 * 1024 * 1024;
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
// A tokenizer-free size estimate. Latin text and JSON average about 4 characters per token, but Chinese, Japanese and
// Korean characters take far more: about 1.5 characters per token across common model tokenizers. Counting every
// character as 1/4 token made CJK content look several times smaller than it is.
const isWide = c => (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef);
export function estimateTokens(text) {
  let narrow = 0, wide = 0, other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) narrow++;
    else if (isWide(c)) wide++;
    else { other++; if (c >= 0xd800 && c <= 0xdbff) i++; }
  }
  return Math.ceil(narrow / 4 + wide / 1.5 + other / 2);
}
export const TOKEN_METHOD = "script_weighted";
// Identity of recorded content for matching across requests. Prompt-cache breakpoints move to the newest message on
// every request, so they are not part of a message's identity.
const CACHE_KEYS = new Set(["cacheControl", "cache_control"]);
const withoutCache = value => Array.isArray(value) ? value.map(withoutCache)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([k]) => !CACHE_KEYS.has(k)).map(([k, v]) => [k, withoutCache(v)])) : value;
export const contentKey = value => canonical(withoutCache(value));
// `offset` is the absolute index of items[0] in the full message list, or null when the encoding does not say.
export function expandCollection(items, kind, offset, count, previous) {
  const at = Number.isInteger(offset) && offset >= 0 ? offset : null;
  if (!Array.isArray(items)) return { items: [], offset: 0, complete: false, reason: "not_recorded" };
  if (kind !== undefined && !["full","delta","tail"].includes(kind)) return { items, offset: null, complete: false, reason: "unsupported_encoding" };
  if (kind === "tail") return { items, offset: at, complete: offset === 0 && (count == null || count === items.length), reason: "tail" };
  if (kind === "delta") {
    if (at !== null && previous?.complete && previous.items.length >= offset) {
      const expanded = previous.items.slice(0, offset).concat(items);
      return { items: expanded, offset: 0, complete: count == null || expanded.length === count, reason: count == null || expanded.length === count ? null : "count_mismatch" };
    }
    // ZCode writes a delta against its own untrimmed previous request, so a delta after a tail continues the tail's
    // recorded range. The earlier prefix stays unknown: the result keeps the tail's offset and is never complete.
    const start = previous?.offset;
    if (at !== null && Number.isInteger(start) && start <= at && start + previous.items.length >= at)
      return { items: previous.items.slice(0, at - start).concat(items), offset: start, complete: false, reason: previous.reason ?? "missing_baseline" };
    return { items, offset: at, complete: false, reason: "missing_baseline" };
  }
  return { items, offset: 0, complete: count == null || items.length === count, reason: count == null || items.length === count ? null : "count_mismatch" };
}
export function foldRecord(raw, previous) {
  const request = raw.request ?? {};
  const messages = expandCollection(request.messages, request.messagesKind, request.messageOffset, request.messageCount, previous?.messages);
  let body = request.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const providerMessages = expandCollection(body?.messages, request.bodyMessagesKind, request.bodyMessageOffset, request.bodyMessageCount, previous?.providerMessages);
  const sdkMessages = expandCollection(request.sdkMessages, request.sdkMessagesKind, request.sdkMessageOffset, request.sdkMessageCount, previous?.sdkMessages);
  const size = [messages, providerMessages, sdkMessages].reduce((n, collection) => n + collection.items.reduce((sum, item) => sum + canonical(item).length, 0), 0);
  if (size > MAX_CONTEXT_CHARS) return { oversized: true, messages: { items: [], complete: false, reason: "context_limit" } };
  const bodyTools = Array.isArray(body?.tools) ? body.tools : null;
  return {
    requestId: typeof raw.requestId === "string" ? raw.requestId : "",
    messageTotal: Number.isInteger(request.messageCount) && request.messageCount >= 0 ? request.messageCount : null,
    attempt: Number.isInteger(raw.attempt) ? raw.attempt : 1,
    startedAt: Date.parse(raw.startedAt) || 0, turnId: raw.turnId ?? null,
    querySource: raw.querySource ?? "unknown", model: raw.model ?? {},
    messages, providerMessages, sdkMessages, tools: bodyTools,
    toolNames: Array.isArray(request.toolNames) ? request.toolNames : [],
    responseUsage: raw.response?.usage ?? null,
    responsePreview: String(raw.response?.text ?? "").slice(0, 240),
    responseCalls: (Array.isArray(raw.response?.toolCalls) ? raw.response.toolCalls : []).slice(0, 8).map(call => ({
      name: typeof (call?.name ?? call?.toolName) === "string" ? String(call.name ?? call.toolName).slice(0, 80) : null,
      title: inputSummary(parseInput(call?.input ?? call?.args ?? call?.arguments)) })),
    responseCallCount: Array.isArray(raw.response?.toolCalls) ? raw.response.toolCalls.length : 0,
    hasResponse: Boolean(raw.response), hasError: Boolean(raw.error),
    hasReset: Boolean(raw.modelIOReset), bodySource: body?.bodySource ?? null
  };
}
export function readableText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => {
    if (typeof part === "string") return part;
    if (part?.text !== undefined) return String(part.text);
    if (part?.type === "tool-call" || part?.type === "tool_use") return JSON.stringify(part, null, 2);
    if (part?.result !== undefined) return readableText(part.result);
    return JSON.stringify(part, null, 2);
  }).join("\n\n");
  return value == null ? "" : JSON.stringify(value, null, 2);
}
function resultPart(message) {
  const results=(Array.isArray(message?.content)?message.content:[]).filter(x=>["tool-result","tool_result"].includes(x?.type));
  return results.length===1?results[0]:null;
}
function parseInput(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
// Canonical ZCode messages carry `toolCalls: [{id,name,input}]`; OpenAI and AI SDK shapes are also recorded.
export function messageCalls(message) {
  const calls = [];
  for (const call of Array.isArray(message?.toolCalls) ? message.toolCalls : [])
    calls.push({id:call?.id ?? call?.toolCallId ?? null, name:call?.name ?? call?.toolName ?? null, input:parseInput(call?.input ?? call?.args ?? call?.arguments)});
  for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    calls.push({id:call?.id ?? null, name:call?.function?.name ?? call?.name ?? null, input:parseInput(call?.function?.arguments ?? call?.arguments)});
  for (const part of Array.isArray(message?.content) ? message.content : [])
    if (["tool-call","tool_use"].includes(part?.type)) calls.push({id:part.toolCallId ?? part.id ?? null, name:part.toolName ?? part.name ?? null, input:parseInput(part.args ?? part.input)});
  return calls;
}
// A call ID recorded more than once is ambiguous and maps to null.
export function callIndex(record) {
  const index = new Map();
  for (const message of record.messages.items) for (const call of messageCalls(message))
    if (call.id) index.set(call.id, index.has(call.id) ? null : call);
  return index;
}
const REMINDER = /^\s*<system-reminder>\s*/;
// ZCode opens the first request after a compaction with the summary under this fixed preface.
const CONTINUATION = /^\s*This session is being continued from a previous conversation/;
export const isContinuation = item => item.role === "user" && CONTINUATION.test(userText(item.readable));
// Hosts prepend tagged context blocks (for example <in-app-browser-context>) to the user's own text.
const INJECTED = /^\s*<([a-z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>\s*/i;
export function userText(text) {
  let rest = String(text ?? "");
  for (let i = 0; i < 8 && INJECTED.test(rest); i++) rest = rest.replace(INJECTED, "");
  return rest.replace(/^\s*## My request for ZCode:\s*/i, "");
}
const oneLine = text => String(text).replace(/\s+/g, " ").trim().slice(0, 160);
function firstLine(text) {
  for (const line of String(text ?? "").split("\n")) {
    const value = line.trim();
    if (value && !/^<\/?system-reminder>$/.test(value)) return value.slice(0, 160);
  }
  return "";
}
export const SUMMARY_KEYS = ["command","file_path","notebook_path","pattern","url","query","skill","path","description","prompt","subject","name","title"];
export function inputSummary(input) {
  if (input == null) return null;
  if (typeof input !== "object") return oneLine(input) || null;
  for (const key of SUMMARY_KEYS) {
    if (typeof input[key] !== "string" || !input[key].trim()) continue;
    return key === "pattern" && typeof input.path === "string" ? oneLine(input.pattern + " · " + input.path) : oneLine(input[key]);
  }
  const first = Object.values(input).find(value => typeof value === "string" && value.trim());
  return first ? oneLine(first) : null;
}
function describe(item) {
  if (item.role === "tool") return {chip:item.toolName ?? item.call?.name ?? null, title:inputSummary(item.call?.input) ?? firstLine(item.readable), subtitle:null};
  if (item.role === "assistant" && item.calls.length) {
    const names = [...new Set(item.calls.map(call => call.name ?? "tool"))];
    const chip = names.length === 1 ? names[0] + (item.calls.length > 1 ? " ×" + item.calls.length : "") : names.slice(0, 2).join(" · ") + (names.length > 2 ? " …" : "");
    return {chip, title:firstLine(item.readable) || inputSummary(item.calls[0].input) || "", subtitle:null};
  }
  if (item.role === "user" && REMINDER.test(item.readable)) return {chip:"reminder", title:firstLine(item.readable.replace(REMINDER, "")), subtitle:null};
  if (item.role === "schema") return {chip:null, title:item.toolName ?? firstLine(item.readable), subtitle:firstLine(item.value?.function?.description ?? item.value?.description ?? "") || null};
  if (item.role === "user") return {chip:null, title:firstLine(userText(item.readable)) || firstLine(item.readable), subtitle:null};
  return {chip:null, title:firstLine(item.readable), subtitle:null};
}
export function inputElements(record) {
  const calls = callIndex(record);
  const result = record.messages.items.map((message, index) => {
    const toolCallId = message?.toolCallId ?? message?.tool_call_id ?? resultPart(message)?.toolCallId ?? resultPart(message)?.tool_use_id ?? null;
    return {
      key: "message:" + index, role: ["system","user","assistant","tool"].includes(message?.role) ? message.role : "unknown",
      toolName: message?.toolName ?? message?.name ?? resultPart(message)?.toolName ?? null, toolCallId,
      text: JSON.stringify(message, null, 2), value: message,
      readable: readableText(message?.content ?? message?.text ?? message),
      status: message?.isError === true || resultPart(message)?.isError === true ? "error" : message?.isError === false || resultPart(message)?.isError === false ? "ok" : message?.status ?? null,
      calls: message?.role === "assistant" ? messageCalls(message) : [], call: toolCallId ? calls.get(toolCallId) ?? null : null
    };
  });
  for (const [index, tool] of (record.tools ?? []).entries()) result.push({
    key: "tool:" + index, role: "schema", toolName: tool?.function?.name ?? tool?.name ?? null,
    toolCallId: null, text: JSON.stringify(tool, null, 2), value: tool,
    readable: JSON.stringify(tool?.function ?? tool, null, 2), status: null, calls: [], call: null
  });
  return result;
}
export function elementSummary(item) {
  const label = describe(item), serialized = canonical(item.value);
  return {key:item.key, role:item.role, toolName:typeof item.toolName==="string"?item.toolName.slice(0,160):null, toolCallId:typeof item.toolCallId==="string"?item.toolCallId.slice(0,256):null,
    chars:serialized.length, estimatedTokens:estimateTokens(serialized),
    preview:item.readable.replace(/\s+/g," ").slice(0,180), status:item.status,
    chip:typeof label.chip==="string"?label.chip.slice(0,80):null, title:label.title, subtitle:label.subtitle, lines:item.readable.split("\n").length};
}
export function toolEvidence(record, element) {
  if (!element.toolCallId) return null;
  const call = callIndex(record).get(element.toolCallId);
  if (!call) return null;
  const text = readableText(call.input);
  const fields = call.input && typeof call.input === "object" && !Array.isArray(call.input)
    ? Object.entries(call.input).slice(0, 16).map(([name, value]) => {
      const full = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
      return {name:name.slice(0, 80), value:full.slice(0, 800), truncated:full.length > 800};
    }) : null;
  return {name:call.name ?? null, arguments:text.slice(0,1600), argumentsTruncated:text.length>1600, fields, evidence:"tool_call_id"};
}
export function attemptUsage(usage) {
  return Object.fromEntries(["inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens"].map(k=>[k,nonnegative(usage?.[k])]));
}
export function composition(record) {
  const buckets = new Map();
  for (const element of inputElements(record)) {
    const current = buckets.get(element.role) ?? { role: element.role, chars: 0, estimatedTokens: 0, count: 0 };
    const serialized = canonical(element.value);
    current.chars += serialized.length; current.estimatedTokens += estimateTokens(serialized); current.count++;
    buckets.set(element.role, current);
  }
  return { buckets: [...buckets.values()], tokenMethod: TOKEN_METHOD, complete: record.messages.complete, schemasRecorded: record.tools !== null };
}
export function diffRecords(before, after) {
  if (!before.messages.complete || !after.messages.complete) return { available:false, reason:"incomplete_snapshot" };
  if (before.querySource !== after.querySource) return {available:false,reason:"different_query_source"};
  const schemasComparable = before.tools !== null && after.tools !== null;
  const a=inputElements(before).filter(x=>schemasComparable || x.role!=="schema");
  const b=inputElements(after).filter(x=>schemasComparable || x.role!=="schema");
  const queues=new Map();
  a.forEach((item,i)=>{const k=contentKey(item.value);const q=queues.get(k)??[];q.push(i);queues.set(k,q);});
  const removed=new Set(a.map((_,i)=>i));const added=[];const matches=[];
  for(const [i,item] of b.entries()) {
    const q=queues.get(contentKey(item.value));
    if(q?.length){const j=q.shift();removed.delete(j);matches.push([j,i]);}else added.push(item);
  }
  const removedItems=[...removed].map(i=>a[i]);
  // Only pair replacements with unique recorded identity, never guess by similar text or index.
  const identity=x=>x.role==="schema"&&x.toolName?"schema:"+x.toolName:x.toolCallId?x.role+":"+x.toolCallId:null;
  const changed=[];
  for(const afterItem of added) {
    const id=identity(afterItem);if(!id)continue;
    const left=a.filter(x=>identity(x)===id),right=b.filter(x=>identity(x)===id);
    if(left.length===1&&right.length===1&&removedItems.includes(left[0]))changed.push({before:elementSummary(left[0]),after:elementSummary(afterItem),identity:id});
  }
  const roles=[...new Set([...a,...b].map(x=>x.role))];
  const measure=new Map([...a,...b].map(x=>{const s=canonical(x.value);return [x,{chars:s.length,tokens:estimateTokens(s)}];}));
  const categories=roles.map(role=>{
    const size=(xs,unit)=>xs.filter(x=>x.role===role).reduce((n,x)=>n+measure.get(x)[unit],0);
    return {role,beforeChars:size(a,"chars"),afterChars:size(b,"chars"),charsDelta:size(b,"chars")-size(a,"chars"),tokensDelta:size(b,"tokens")-size(a,"tokens"),
      addedCount:added.filter(x=>x.role===role).length,removedCount:removedItems.filter(x=>x.role===role).length};
  });
  return {available:true,added:added.map(elementSummary),removed:removedItems.map(elementSummary),changed,categories,
    reordered:matches.some((v,i)=>i>0&&v[0]<matches[i-1][0]),schemasComparable,
    charsDelta:categories.reduce((n,x)=>n+x.charsDelta,0),tokensDelta:categories.reduce((n,x)=>n+x.tokensDelta,0),
    modelChanged:canonical(before.model)!==canonical(after.model),attribution:"observed_change"};
}
export function trajectorySummary(record, key) {
  return {key,requestId:record.requestId,attempt:record.attempt,startedAt:record.startedAt,turnId:record.turnId,
    querySource:record.querySource,model:record.model,complete:record.messages.complete,incompleteReason:record.messages.reason,
    messageCount:record.messages.items.length,messageTotal:record.messageTotal??null,schemaCount:record.tools?.length??null,hasResponse:record.hasResponse,hasError:record.hasError,
    composition:composition(record),usage:attemptUsage(record.responseUsage),responsePreview:record.responsePreview,
    responseCalls:record.responseCalls??[],responseCallCount:record.responseCallCount??0,
    userPreview:oneLine(userText(inputElements(record).findLast(x=>x.role==="user"&&!REMINDER.test(x.readable))?.readable??""))};
}
// Linear, bounded unified difference. This highlights a replacement block without an expensive full LCS.
export function textDifference(before,after) {
  const a=before.split("\n"),b=after.split("\n");let start=0,end=0;
  while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
  while(end<Math.min(a.length,b.length)-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  const rows=[...a.slice(Math.max(0,start-2),start).map(text=>({kind:"context",text})),
    ...a.slice(start,a.length-end).map(text=>({kind:"removed",text})),
    ...b.slice(start,b.length-end).map(text=>({kind:"added",text})),
    ...b.slice(b.length-end,b.length-end+2).map(text=>({kind:"context",text}))];
  return rows;
}
