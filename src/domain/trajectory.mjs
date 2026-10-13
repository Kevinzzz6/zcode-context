import { nonnegative } from "./session.mjs";
const MAX_CONTEXT_CHARS = 24 * 1024 * 1024;
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export function expandCollection(items, kind, offset, count, previous) {
  if (!Array.isArray(items)) return { items: [], complete: false, reason: "not_recorded" };
  if (kind !== undefined && !["full","delta","tail"].includes(kind)) return { items, complete: false, reason: "unsupported_encoding" };
  if (kind === "tail") return { items, complete: offset === 0 && (count == null || count === items.length), reason: "tail" };
  if (kind === "delta") {
    if (!Number.isInteger(offset) || offset < 0 || !previous?.complete || previous.items.length < offset) {
      return { items, complete: false, reason: "missing_baseline" };
    }
    const expanded = previous.items.slice(0, offset).concat(items);
    return { items: expanded, complete: count == null || expanded.length === count, reason: count == null || expanded.length === count ? null : "count_mismatch" };
  }
  return { items, complete: count == null || items.length === count, reason: count == null || items.length === count ? null : "count_mismatch" };
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
    attempt: Number.isInteger(raw.attempt) ? raw.attempt : 1,
    startedAt: Date.parse(raw.startedAt) || 0, turnId: raw.turnId ?? null,
    querySource: raw.querySource ?? "unknown", model: raw.model ?? {},
    messages, providerMessages, sdkMessages, tools: bodyTools,
    toolNames: Array.isArray(request.toolNames) ? request.toolNames : [],
    responseUsage: raw.response?.usage ?? null,
    responsePreview: String(raw.response?.text ?? "").slice(0, 240),
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
export function inputElements(record) {
  const result = record.messages.items.map((message, index) => ({
    key: "message:" + index, role: ["system","user","assistant","tool"].includes(message?.role) ? message.role : "unknown",
    toolName: message?.toolName ?? message?.name ?? resultPart(message)?.toolName ?? null,
    toolCallId: message?.toolCallId ?? message?.tool_call_id ?? resultPart(message)?.toolCallId ?? resultPart(message)?.tool_use_id ?? null,
    text: JSON.stringify(message, null, 2), value: message,
    readable: readableText(message?.content ?? message?.text ?? message),
    status: message?.isError === true || resultPart(message)?.isError === true ? "error" : message?.status ?? null
  }));
  for (const [index, tool] of (record.tools ?? []).entries()) result.push({
    key: "tool:" + index, role: "schema", toolName: tool?.function?.name ?? tool?.name ?? null,
    toolCallId: null, text: JSON.stringify(tool, null, 2), value: tool,
    readable: JSON.stringify(tool?.function ?? tool, null, 2), status: null
  });
  return result;
}
export function elementSummary(item) {
  return {key:item.key, role:item.role, toolName:typeof item.toolName==="string"?item.toolName.slice(0,160):null, toolCallId:typeof item.toolCallId==="string"?item.toolCallId.slice(0,256):null,
    chars:canonical(item.value).length, estimatedTokens:Math.ceil(canonical(item.value).length/4),
    preview:item.readable.replace(/\s+/g," ").slice(0,180), status:item.status};
}
export function toolEvidence(record, element) {
  if (!element.toolCallId) return null;
  const calls = [];
  for (const message of record.messages.items) {
    for (const call of message?.tool_calls ?? []) if (call.id === element.toolCallId) calls.push({name:call.function?.name,arguments:call.function?.arguments});
    for (const part of Array.isArray(message?.content) ? message.content : []) {
      if (["tool-call","tool_use"].includes(part?.type) && (part.toolCallId ?? part.id) === element.toolCallId)
        calls.push({name:part.toolName ?? part.name,arguments:part.args ?? part.input});
    }
  }
  return calls.length === 1 ? {name:calls[0].name ?? null, arguments:readableText(calls[0].arguments).slice(0,1600),
    argumentsTruncated:readableText(calls[0].arguments).length>1600,evidence:"tool_call_id"} : null;
}
export function attemptUsage(usage) {
  return Object.fromEntries(["inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens"].map(k=>[k,nonnegative(usage?.[k])]));
}
export function composition(record) {
  const buckets = new Map();
  for (const element of inputElements(record)) {
    const current = buckets.get(element.role) ?? { role: element.role, chars: 0, estimatedTokens: 0, count: 0 };
    const length = canonical(element.value).length;
    current.chars += length; current.estimatedTokens += Math.ceil(length / 4); current.count++;
    buckets.set(element.role, current);
  }
  return { buckets: [...buckets.values()], tokenMethod: "chars/4", complete: record.messages.complete, schemasRecorded: record.tools !== null };
}
export function diffRecords(before, after) {
  if (!before.messages.complete || !after.messages.complete) return { available:false, reason:"incomplete_snapshot" };
  if (before.querySource !== after.querySource) return {available:false,reason:"different_query_source"};
  const schemasComparable = before.tools !== null && after.tools !== null;
  const a=inputElements(before).filter(x=>schemasComparable || x.role!=="schema");
  const b=inputElements(after).filter(x=>schemasComparable || x.role!=="schema");
  const queues=new Map();
  a.forEach((item,i)=>{const k=canonical(item.value);const q=queues.get(k)??[];q.push(i);queues.set(k,q);});
  const removed=new Set(a.map((_,i)=>i));const added=[];const matches=[];
  for(const [i,item] of b.entries()) {
    const q=queues.get(canonical(item.value));
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
  const categories=roles.map(role=>{
    const size=xs=>xs.filter(x=>x.role===role).reduce((n,x)=>n+canonical(x.value).length,0);
    return {role,beforeChars:size(a),afterChars:size(b),charsDelta:size(b)-size(a),
      addedCount:added.filter(x=>x.role===role).length,removedCount:removedItems.filter(x=>x.role===role).length};
  });
  return {available:true,added:added.map(elementSummary),removed:removedItems.map(elementSummary),changed,categories,
    reordered:matches.some((v,i)=>i>0&&v[0]<matches[i-1][0]),schemasComparable,
    charsDelta:categories.reduce((n,x)=>n+x.charsDelta,0),
    modelChanged:canonical(before.model)!==canonical(after.model),attribution:"observed_change"};
}
export function trajectorySummary(record, key) {
  return {key,requestId:record.requestId,attempt:record.attempt,startedAt:record.startedAt,turnId:record.turnId,
    querySource:record.querySource,model:record.model,complete:record.messages.complete,incompleteReason:record.messages.reason,
    messageCount:record.messages.items.length,schemaCount:record.tools?.length??null,hasResponse:record.hasResponse,hasError:record.hasError,
    composition:composition(record),usage:attemptUsage(record.responseUsage),responsePreview:record.responsePreview,
    userPreview:inputElements(record).findLast(x=>x.role==="user")?.readable.slice(0,160)??""};
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
