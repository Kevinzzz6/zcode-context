import { palette, ORDER } from "./i18n.mjs";
import { lens } from "./state.mjs";
export const CHUNK=12000;
const nf=new Intl.NumberFormat();
export const full=n=>n==null||!Number.isFinite(n)?"—":nf.format(Math.round(n));
export function compact(n) {
  if(n==null||!Number.isFinite(n))return "—";
  const a=Math.abs(n);
  if(a<1000)return String(Math.round(n));
  if(a<1e6)return (n/1000).toFixed(1)+"k";
  return (n/1e6).toFixed(a<1e7?2:1)+"M";
}
const approx=n=>"≈"+compact(n);
const signed=n=>(n>0?"+":n<0?"−":"±")+compact(Math.abs(n));
const pct=ratio=>ratio>0&&ratio<0.005?"<1%":Math.round(ratio*100)+"%";
// Token deltas come estimated by the server; chars/4 only covers payloads from before it sent them.
const tokensOf=delta=>!delta?0:delta.tokensDelta??delta.tokens??Math.round((delta.charsDelta??delta.chars??0)/4);
export const clock=ms=>ms?new Date(ms).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}):"—";
const utcDate=day=>new Date(day*86400000).toISOString().slice(0,10);

export function node(tag,attrs={},...children) {
  const el=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) {
    if(value===undefined||value===null)continue;
    if(key==="class")el.className=value;
    else if(key.startsWith("on"))el.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==="style")Object.assign(el.style,value);
    else if(key==="dataset")Object.assign(el.dataset,value);
    else el[key]=value;
  }
  el.append(...children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false));
  return el;
}
export const button=(content,action,attrs={})=>node("button",{type:"button",onclick:action,...attrs},content);
const muted=value=>node("span",{class:"muted"},value);
const spacer=()=>node("span",{class:"spacer"});
const dot=role=>node("i",{class:"dot",style:{background:palette[role]??palette.unknown}});
const chip=(value,cls="")=>value?node("span",{class:("chip "+cls).trim()},value):null;
function seg(options,value,onChange,{id,small=false}={}) {
  const group=node("div",{class:"seg"+(small?" small":""),role:"group",id});
  for(const [key,label] of options)group.append(button(label,()=>{if(key!==value)onChange(key);},{class:key===value?"on":"",ariaPressed:String(key===value),id:id?id+"-"+key:undefined}));
  return group;
}

const SOURCES=new Set(["session_title","compact","main_turn","subagent","workflow_child"]);
export const isAgent=item=>item?.step!=null;
const sourceName=(t,source)=>t("source."+(SOURCES.has(source)?source:"unknown"));
export const itemName=(t,item)=>!item?"—":item.step!=null?t("step",{n:item.step}):sourceName(t,item.querySource);
const itemLong=(t,item)=>[itemName(t,item),item.turn!=null?t("turn",{n:item.turn}):null,clock(item.startedAt)].filter(Boolean).join(" · ");
const totalOf=item=>item?.composition?.buckets?.reduce((n,x)=>n+x.estimatedTokens,0)??0;
// Default ZCode rollouts keep only the latest messages (a tail). The provider's input count is then the only full size,
// and the difference to the recorded estimate is shown as unrecorded earlier messages.
const actualOf=item=>item?.usage?.inputTokens??null;
function partialOf(item) {
  const recorded=totalOf(item),actual=actualOf(item);
  return item&&!item.complete&&actual!=null&&actual>recorded?{recorded,actual,unrecorded:actual-recorded}:null;
}
const previousAgent=(items,item)=>items.filter(x=>isAgent(x)&&x.querySource===item.querySource&&x.startedAt<item.startedAt).at(-1)??null;
function bucketsOf(item) {
  const map=new Map((item?.composition?.buckets??[]).map(x=>[x.role,x]));
  return ORDER.filter(role=>map.has(role)).map(role=>map.get(role));
}
function compactKind(event) {
  event=String(event??"");
  return event.includes(".micro")?"microCompact":event.includes(".auto")?"autoCompact":event.includes(".reactive")?"reactiveCompact":"manualCompact";
}
// Event anchors use the agent-request series that the trend shows, not auxiliary requests:
// the last request sent before the operation began and the first one sent after it ended.
// With earlier steps not loaded, an event older than the first loaded step has no known neighbour on either side.
// A recorded injection carries the step the server found it in, or none when that request is not readable.
export function anchors(items,event,older=false) {
  const agents=items.filter(isAgent);
  if("stepKey" in event) {
    if(!event.stepKey)return {before:null,after:null,unlocated:true};
    const after=agents.find(x=>x.key===event.stepKey)??null;
    return after?{before:agents.findLast(x=>x.startedAt<after.startedAt)??null,after}:{before:null,after:null,earlier:older};
  }
  const before=agents.findLast(x=>x.startedAt<=event.timestamp)??null;
  if(!before&&older&&agents.length)return {before:null,after:null,earlier:true};
  return {before,after:agents.find(x=>x.startedAt>(event.endedAt??event.timestamp))??null};
}
const TRUNCATED=["display_window","history_window","history_reset","source_rotated"];
export const olderUnloaded=ctx=>Boolean(ctx.hasOlder)||ctx.items.length<(ctx.overview?.history?.loadedCount??0)
  ||(ctx.overview?.trajectory?.coverage??[]).some(code=>TRUNCATED.includes(code));
const GLYPH={compaction:"✂",rewind:"↶",model:"⇄",tools:"⚙",inject:"↳"};
// Compaction and rewind remove content between two requests, so their focus compares the request after with the one before.
export const BOUNDARY=new Set(["compaction","rewind"]);
const EVENT_ROWS=12;
const modelName=id=>String(id).split("/").at(-1);
// ZCode's own source label for an injection; an unknown source shows as ZCode names it.
const known=(t,key)=>{const text=t(key);return text===key?null:text;};
function injectLabel(t,e) {
  if(e.form==="skill")return "Skill";
  return known(t,"src."+e.source)??known(t,"form."+e.form)??e.source??e.form??t("kind.inject");
}
function eventLabel(t,e) {
  if(e.kind==="compaction")return t(compactKind(e.event));
  if(e.kind==="inject")return injectLabel(t,e);
  if(e.kind==="rewind")return t(e.edited?"kind.edit":"kind.rewind");
  return t("kind."+e.kind);
}
// The label follows the status, not the event name: a cancelled manual compaction is logged as compact.failed.
const COMPACT_STATUS={started:"inProgress",retrying:"retrying",completed:"completed",failed:"failed",interrupted:"interrupted",skipped:"skipped",applied:"applied"};
function eventDetail(t,e) {
  if(e.kind==="compaction") {
    const status=Object.hasOwn(COMPACT_STATUS,e.status)?e.status:null,timed=status&&status!=="started"&&status!=="retrying";
    return [t(status?COMPACT_STATUS[status]:"compactUnknown"),e.durationMs!=null&&timed?t("took",{s:(e.durationMs/1000).toFixed(1)}):null,
      e.summarizedCount!=null?t("summarizedCount",{n:full(e.summarizedCount)}):null,e.reason].filter(Boolean).join(" · ");
  }
  if(e.kind==="inject")return e.form==="skill"?e.name??"":String(e.text??"").split("\n").map(x=>x.trim()).find(Boolean)?.slice(0,160)??"";
  if(e.kind==="model")return modelName(e.from)+" → "+modelName(e.to);
  if(e.kind==="rewind")return e.keptMessageCount!=null?t("kept",{n:full(e.keptMessageCount)}):"";
  if(e.kind==="tools")return e.toolCount!=null?t("toolsRegistered",{n:e.toolCount}):"";
  return "";
}
function eventAt(t,e,{before,after,earlier,unlocated}) {
  if(earlier)return t("eventEarlier");
  if(unlocated)return t("eventUnreadable");
  if(e.stepKey)return after?(after.turn!=null?t("turnShort",{n:after.turn})+" · ":"")+t("step",{n:after.step}):null;
  if(BOUNDARY.has(e.kind)&&before&&after) {
    const turn=before.turn!=null&&before.turn===after.turn?t("turnShort",{n:after.turn})+" · ":"";
    return turn+t("stepGap",{a:before.step,b:after.step});
  }
  if(after)return t("fromStep",{n:after.step});
  if(before)return t("afterStep",{n:before.step});
  return null;
}
const KINDS=["compaction","rewind","inject","model","tools"];
export const eventKinds=events=>KINDS.filter(kind=>(events??[]).some(e=>e.kind===kind));

export function renderApp(ctx) {
  const {view}=ctx,page=document.createDocumentFragment();
  const add=(...parts)=>page.append(...parts.filter(Boolean));
  add(toolbar(ctx),ctx.notice?noticeBar(ctx):null);
  if(view.page==="about"){add(aboutPage(ctx));return page;}
  if(!ctx.overview){add(node("section",{class:"card"},node("p",{class:"muted",id:"loading"},ctx.t("loading"))));return page;}
  if(view.page==="usage"){add(usagePage(ctx),about(ctx));return page;}
  if(!ctx.items.length) {
    add(node("section",{class:"card empty"},node("h2",{},ctx.t("empty")),node("p",{class:"muted"},ctx.t("emptyHint"))),eventsCard(ctx),about(ctx));
    return page;
  }
  add(pinnedBar(ctx),summaryCard(ctx),trendCard(ctx),browserCard(ctx),eventsCard(ctx),about(ctx));
  return page;
}

function toolbar(ctx) {
  const {t,view,items,actions:a}=ctx,bar=node("div",{class:"toolbar"});
  const refresh=button("↻",()=>a.refresh(),{class:"icon-btn"+(ctx.busy?" spinning":""),id:"refresh",title:t("refresh"),ariaLabel:t("refresh")});
  if(view.page==="usage") {
    bar.append(button("‹ "+t("back"),()=>a.page("context"),{class:"btn ghost",id:"usage-back"}),node("h1",{class:"toolbar-title",id:"heading"},t("usageTitle")),spacer(),refresh);
    return bar;
  }
  if(view.page==="about") {
    bar.append(button("‹ "+t("back"),()=>a.page("context"),{class:"btn ghost",id:"about-back"}),node("h1",{class:"toolbar-title",id:"heading"},t("aboutPage")),spacer());
    return bar;
  }
  if(items.length) {
    const agents=items.filter(isAgent),selected=items.find(x=>x.key===view.selectedKey),index=agents.findIndex(x=>x.key===view.selectedKey);
    const prev=index>=0?agents[index-1]:selected?agents.findLast(x=>x.startedAt<selected.startedAt):null;
    const next=index>=0?agents[index+1]:selected?agents.find(x=>x.startedAt>selected.startedAt):null;
    const select=node("select",{id:"snapshot",class:"step-select",ariaLabel:t("agentRequests"),onchange:e=>a.select(e.target.value)});
    const main=node("optgroup",{label:t("agentRequests")}),aux=node("optgroup",{label:t("auxRequests")});
    for(const item of [...items].reverse())(isAgent(item)?main:aux).append(node("option",{value:item.key,selected:item.key===view.selectedKey},itemLong(t,item)));
    if(main.children.length)select.append(main);
    if(aux.children.length)select.append(aux);
    bar.append(node("div",{class:"stepper"},
      button("‹",()=>a.select(prev?.key),{class:"icon-btn",id:"snapshot-previous",disabled:!prev,title:t("previous")+" (←)",ariaLabel:t("previous")}),select,
      button("›",()=>a.select(next?.key),{class:"icon-btn",id:"snapshot-next",disabled:!next,title:t("next")+" (→)",ariaLabel:t("next")})));
  } else bar.append(spacer());
  bar.append(button(t("usage"),()=>a.page("usage"),{class:"btn",id:"show-usage"}),
    button("ⓘ",()=>a.page("about"),{class:"icon-btn",id:"show-about",title:t("aboutPage"),ariaLabel:t("aboutPage")}),refresh);
  return bar;
}
function pinnedBar(ctx) {
  const {t,view,actions:a,latestKey,newerCount}=ctx;
  if(!latestKey||view.selectedKey===latestKey)return null;
  return node("div",{class:"pinned",id:"follow-state"},node("span",{},t(view.follow&&view.open?"paused":"pinned")),spacer(),
    button(newerCount?t("newer",{n:newerCount})+" · "+t("latest"):t("latest"),a.latest,{class:"btn accent small",id:"latest"}));
}
function noticeBar(ctx) {
  const {t,notice:n,actions:a}=ctx;
  if(n.kind==="slow")return node("div",{class:"notice slow",id:"status",role:"status"},t("slow"));
  if(n.kind==="info")return node("div",{class:"notice info",id:"status",role:"status"},t(n.code));
  const message=n.code==="binding_unavailable"?t("binding"):n.code==="request_expired"?t("expired"):n.code==="connect_failed"?t("connectFailed"):t("readFailed");
  return node("div",{class:"notice error",id:"status",role:"alert"},node("span",{},message),spacer(),
    n.code==="connect_failed"?null:n.code==="request_expired"?button(t("latest"),a.latest,{class:"btn small",dataset:{focus:"notice-latest"}}):button(t("retry"),()=>a.refresh(true),{class:"btn small",dataset:{focus:"notice-retry"}}));
}

function summaryCard(ctx) {
  const {t,view,selected:s,detail:d,actions:a,latestKey}=ctx;
  if(!s)return null;
  const buckets=bucketsOf(s),sum=buckets.reduce((n,x)=>n+x.estimatedTokens,0)||1;
  const live=view.follow&&view.selectedKey===latestKey;
  const head=node("div",{class:"card-head"},
    node("div",{class:"eyebrow"},node("b",{},itemName(t,s)),s.turn!=null?muted(t("turn",{n:s.turn})):null),
    node("div",{class:"head-meta"},live?node("span",{class:"live"},node("i",{class:"live-dot"}),t("following")):null,muted(clock(s.startedAt))));
  const partial=partialOf(s),prev=partial?previousAgent(ctx.items,s):null,actualDelta=partial&&actualOf(prev)!=null?partial.actual-actualOf(prev):null;
  const deltaTokens=s.delta?tokensOf(s.delta):actualDelta;
  const badge=deltaTokens!=null
    ?node("span",{class:"badge "+(deltaTokens>0?"up":deltaTokens<0?"down":"flat"),id:"selected-delta",title:s.delta?"":t("actualDeltaTip")},signed(deltaTokens)+" "+t("vsPrevious"))
    :node("span",{class:"badge flat",id:"selected-delta",title:t(s.deltaReason??"no_previous_snapshot")},t("notComparable"));
  const big=partial
    ?node("div",{class:"big-row"},node("strong",{class:"big",id:"selected-total"},compact(partial.actual)),muted(t("actualInput")),badge)
    :node("div",{class:"big-row"},node("strong",{class:"big",id:"selected-total"},approx(totalOf(s))),muted(t("estimate")),badge);
  const u=s.usage??{},facts=node("div",{class:"facts"});
  if(partial)facts.append(node("span",{title:t("recordedTip")},t("recorded")+" ",node("b",{},approx(partial.recorded)),
    s.messageTotal!=null?" · "+t("recordedMessages",{n:s.messageCount,total:s.messageTotal}):null));
  else if(u.inputTokens!=null)facts.append(node("span",{},t("actualIn")+" ",node("b",{},compact(u.inputTokens))));
  if(u.outputTokens!=null)facts.append(node("span",{},t("output")+" ",node("b",{},compact(u.outputTokens))));
  if(u.inputTokens&&u.cacheReadTokens!=null)facts.append(node("span",{},t("cache")+" ",node("b",{},pct(u.cacheReadTokens/u.inputTokens))));
  if(s.model?.modelId)facts.append(muted(s.model.modelId));
  if(!s.complete&&!partial)facts.append(node("span",{class:"badge warn",title:s.incompleteReason??""},t("partial")));
  const whole=partial?partial.actual:sum,stack=node("div",{class:"stackbar"});
  for(const b of buckets)stack.append(node("span",{dataset:{role:b.role},style:{flexGrow:String(Math.max(b.estimatedTokens,1)),background:palette[b.role]??palette.unknown},title:t(b.role)+" "+approx(b.estimatedTokens),...hoverRole(b.role)}));
  if(partial)stack.append(node("span",{class:"unrecorded",dataset:{role:"unrecorded"},style:{flexGrow:String(partial.unrecorded)},title:t("unrecorded")+" "+approx(partial.unrecorded),...hoverRole("unrecorded")}));
  const legend=node("div",{class:"legend"});
  for(const b of buckets)legend.append(button([dot(b.role),node("span",{class:"legend-name"},t(b.role)),node("span",{class:"num"},approx(b.estimatedTokens)),node("span",{class:"pct"},pct(b.estimatedTokens/whole))],
    ()=>a.focusRole(b.role),{class:"legend-item",dataset:{role:b.role,focus:"legend:"+b.role},...hoverRole(b.role)}));
  if(partial)legend.append(node("div",{class:"legend-item",dataset:{role:"unrecorded"},title:t("unrecordedTip"),...hoverRole("unrecorded")},node("i",{class:"dot unrecorded"}),
    node("span",{class:"legend-name"},t("unrecorded")),node("span",{class:"num"},approx(partial.unrecorded)),node("span",{class:"pct"},pct(partial.unrecorded/whole))));
  const hint=partial?node("p",{class:"note partial-hint",id:"partial-hint"},t("partialHint",{n:s.messageCount,total:s.messageTotal??"?"})):null;
  const brief=node("div",{class:"brief"});
  if(s.userPreview)brief.append(briefRow(t("briefTurn"),node("span",{class:"brief-text"},s.userPreview),t("briefTurnTip")));
  const inputs=stepInputs(ctx,s);
  if(inputs)brief.append(briefRow(t("briefInput"),inputs,t("briefInputTip")));
  const calls=s.responseCalls??[];
  if(calls.length)brief.append(briefRow(t("briefReply"),node("span",{class:"brief-list"},calls.slice(0,2).map(call=>node("span",{class:"brief-item"},chip(call.name,"tool-chip"),node("span",{class:"brief-text"},call.title??""))),
    s.responseCallCount>2?muted(t("moreItems",{n:s.responseCallCount-2})):null),t("briefReplyTip")));
  else if(s.responsePreview)brief.append(briefRow(t("briefReply"),node("span",{class:"brief-text"},s.responsePreview.replace(/\s+/g," ")),t("briefReplyTip")));
  else if(!s.hasResponse)brief.append(briefRow(t("briefReply"),muted(t("noResponse")),t("briefReplyTip")));
  return node("section",{class:"card summary",id:"summary"},head,big,facts.children.length?facts:null,stack,legend,hint,brief.children.length?brief:null);
}
// What entered the context after the previous step's reply: tool results, reminders and other non-reply items, in message order.
function stepInputs(ctx,s) {
  const {t,lens:L,detail:d,actions:a}=ctx;
  if(d?.summary?.key!==s.key||L.baselineKey||L.baselineMode==="turn")return null;
  const source=d.diff.available?d.diff.addedGroups:d.arrivals?.available?d.arrivals.groups:null;
  if(!source)return muted(t("notComparable"));
  const index=item=>Number(item.key.split(":")[1])+(item.key.startsWith("tool:")?1e9:0);
  const items=Object.values(source??{}).flatMap(g=>g.items)
    .filter(x=>x.role!=="assistant"&&!(x.role==="user"&&x.chip!=="reminder")).sort((a,b)=>index(a)-index(b));
  if(!items.length)return muted(t("noInputs"));
  return node("span",{class:"brief-list"},items.slice(0,3).map(item=>button([chip(label(t,item),"tool-chip"),node("span",{class:"brief-text"},item.title||item.preview),node("span",{class:"num"},approx(item.estimatedTokens))],
    ()=>a.reveal(item),{class:"brief-item clickable",dataset:{element:item.key,focus:"brief:"+item.key}})),
    items.length>3?button(t("moreItems",{n:items.length-3}),()=>a.mode("changes"),{class:"btn ghost small brief-more",dataset:{focus:"brief-more"}}):null);
}
function briefRow(name,content,tip) {
  return node("div",{class:"brief-row"},node("span",{class:"brief-label",title:tip},name),node("span",{class:"brief-body"},content));
}
const label=(t,item)=>item.chip==="reminder"?t("reminder"):item.chip;

function niceStep(max,count) {
  const raw=Math.max(max,1)/count,mag=10**Math.floor(Math.log10(raw)),norm=raw/mag;
  return (norm<=1?1:norm<=2?2:norm<=2.5?2.5:norm<=5?5:10)*mag;
}
const H=120,TOP=14;
// Scales bars to all of them, or to those currently visible in the scroller.
export function layoutTrend(card,{visibleOnly=false}={}) {
  const scroller=card?.querySelector(".trend-scroll");if(!scroller)return;
  const bars=[...scroller.querySelectorAll(".bar")],delta=card.dataset.mode==="delta";
  let scope=bars;
  if(visibleOnly&&scroller.clientWidth) {
    const left=scroller.scrollLeft,right=left+scroller.clientWidth;
    scope=bars.filter(b=>b.offsetLeft+b.offsetWidth>left&&b.offsetLeft<right);
    if(!scope.length)scope=bars;
  }
  const maxPos=Math.max(0,...scope.map(b=>Number(b.dataset.pos))),maxNeg=Math.max(0,...scope.map(b=>Number(b.dataset.neg)));
  const step=niceStep(Math.max(maxPos,maxNeg),delta?2:3);
  const top=Math.max(step,Math.ceil(maxPos/step)*step),bottom=delta?Math.ceil(maxNeg/step)*step:0;
  const posH=Math.round(H*top/(top+bottom)),negH=H-posH,axis=[],lines=[];
  for(let v=top;v>=-bottom-1e-9;v-=step) {
    const y=v>=0?posH*(1-v/top):posH+negH*(-v/bottom);
    axis.push(node("span",{style:{top:TOP+y+"px"}},(delta&&v>0?"+":v<0?"−":"")+compact(Math.abs(v))));
    lines.push(node("i",{class:v===0?"zero":"",style:{top:y+"px"}}));
  }
  card.querySelector(".y-axis").replaceChildren(...axis);
  card.querySelector(".grid-lines").replaceChildren(...lines);
  card.dataset.scale=compact(top)+(bottom?"/"+compact(bottom):"");
  for(const bar of bars) {
    const up=bar.querySelector(".stack.up"),down=bar.querySelector(".stack.down");
    up.style.height=posH+"px";down.style.height=negH+"px";
    for(const seg of up.querySelectorAll("[data-v]"))seg.style.height=Math.min(posH,Number(seg.dataset.v)/top*posH)+"px";
    for(const seg of down.querySelectorAll("[data-v]"))seg.style.height=bottom?Math.min(negH,Number(seg.dataset.v)/bottom*negH)+"px":"0";
  }
}
// One column per agent step, or per turn (the turn's last step; its change sums the turn's step changes).
function trendColumns(series,turns) {
  if(!turns)return series.map(s=>({s,items:[s],turn:s.turn,delta:s.delta}));
  const columns=[];
  for(const s of series) {
    const last=columns.at(-1);
    if(last&&s.turn!=null&&last.turn===s.turn){last.items.push(s);last.s=s;}
    else columns.push({s,items:[s],turn:s.turn});
  }
  for(const c of columns) {
    if(c.items.some(x=>!x.delta)){c.delta=null;continue;}
    const sums=new Map();
    for(const x of c.items)for(const cat of x.delta.categories){const sum=sums.get(cat.role)??{role:cat.role,charsDelta:0,tokensDelta:0};sum.charsDelta+=cat.charsDelta;sum.tokensDelta+=tokensOf(cat);sums.set(cat.role,sum);}
    c.delta={chars:c.items.reduce((n,x)=>n+x.delta.chars,0),tokens:c.items.reduce((n,x)=>n+tokensOf(x.delta),0),categories:[...sums.values()]};
  }
  return columns;
}
function trendTip(ctx,column,deltaMode) {
  const {t}=ctx,s=column.s,rows=node("div",{class:"tip-rows"});
  const title=column.items.length>1||ctx.view.granularity==="turn"
    ?t("turn",{n:s.turn??"?"})+" · "+t("stepsIn",{n:column.items.length})
    :itemLong(t,s);
  const partial=column.partial,change=column.delta?tokensOf(column.delta):partial?column.actualDelta:null;
  for(const role of ORDER) {
    const value=deltaMode?tokensOf(column.delta?.categories.find(c=>c.role===role)):bucketsOf(s).find(b=>b.role===role)?.estimatedTokens;
    if(!value)continue;
    rows.append(node("div",{class:"tip-row",dataset:{role}},dot(role),node("span",{class:"spacer"},t(role)),node("span",{class:"num"},deltaMode?signed(value):approx(value))));
  }
  if(partial&&!deltaMode)rows.append(node("div",{class:"tip-row",dataset:{role:"unrecorded"}},node("i",{class:"dot unrecorded"}),node("span",{class:"spacer"},t("unrecorded")),node("span",{class:"num"},approx(partial.unrecorded))));
  if(partial&&deltaMode&&!column.delta)rows.append(node("div",{class:"tip-row muted"},t("actualOnly")));
  return node("div",{class:"trend-tip"},node("div",{class:"tip-title"},title),
    node("div",{class:"tip-total"},node("b",{},partial?compact(partial.actual):approx(totalOf(s))),partial?muted(t("actualShort")):null,
      change!=null?node("span",{class:"delta "+(change>0?"up":change<0?"down":"")},signed(change)):muted(t("notComparable"))),
    rows,s.userPreview?node("div",{class:"tip-user muted"},s.userPreview):null);
}
function showTip(ctx,bar,column,deltaMode) {
  const main=bar.closest(".chart-main"),scroller=main.querySelector(".trend-scroll");
  main.querySelector(".trend-tip")?.remove();
  const tip=trendTip(ctx,column,deltaMode);
  main.append(tip);
  const center=bar.offsetLeft-scroller.scrollLeft+bar.offsetWidth/2,gap=bar.offsetWidth/2+6;
  const left=center>main.clientWidth/2?center-gap-tip.offsetWidth:center+gap;
  tip.style.left=Math.max(0,Math.min(main.clientWidth-tip.offsetWidth,left))+"px";
}
// Hovering a category anywhere lights that category's segments in every bar and in the summary bar.
export function highlight(role) {
  if(role)document.documentElement.dataset.hl=role;else delete document.documentElement.dataset.hl;
}
const hoverRole=role=>({onmouseenter:()=>highlight(role),onmouseleave:()=>highlight(null)});
function trendCard(ctx) {
  const {t,view,items,overview:o,actions:a}=ctx;
  let series=items.filter(isAgent);
  if(!series.length)series=items;
  const delta=view.trend==="delta",turns=view.granularity==="turn",columns=trendColumns(series,turns);
  for(const [i,c] of columns.entries()) {
    c.partial=partialOf(c.s);
    const before=actualOf(columns[i-1]?.s);
    c.actualDelta=c.partial&&before!=null?c.partial.actual-before:null;
  }
  const selectedItem=items.find(x=>x.key===view.selectedKey);
  const cuts=new Map();
  for(const event of o.events??[]) {
    if(!BOUNDARY.has(event.kind))continue;
    const target=anchors(items,event,olderUnloaded(ctx));
    if(target.after&&!(cuts.get(target.after.key)?.kind==="compaction"))cuts.set(target.after.key,{event,...target});
  }
  const plot=node("div",{class:"plot",onmouseleave:e=>e.currentTarget.closest(".chart-main")?.querySelector(".trend-tip")?.remove()});
  const dense=columns.length>14;
  let lastTurn,parity=0;
  for(const [i,c] of columns.entries()) {
    const s=c.s,first=i===0||c.turn!==lastTurn;
    const selected=turns?selectedItem?.turn!=null&&selectedItem.turn===c.turn&&isAgent(selectedItem):s.key===view.selectedKey;
    if(i>0&&c.turn!==lastTurn)parity^=1;
    lastTurn=c.turn;
    let pos=[],neg=[],missing=false;
    if(!delta){pos=bucketsOf(s).map(b=>({role:b.role,v:b.estimatedTokens}));if(c.partial)pos.push({role:"unrecorded",v:c.partial.unrecorded});}
    else if(c.delta)for(const role of ORDER) {
      const v=tokensOf(c.delta.categories.find(x=>x.role===role));
      if(v)(v>0?pos:neg).push({role,v:Math.abs(v)});
    }
    else if(c.partial&&c.actualDelta!=null){if(c.actualDelta)(c.actualDelta>0?pos:neg).push({role:"actual",v:Math.abs(c.actualDelta)});}
    else missing=true;
    const sum=list=>list.reduce((n,x)=>n+x.v,0);
    const bar=button([],()=>a.select(s.key),{class:"bar"+(selected?" selected":""),dataset:{key:s.key,focus:"bar:"+s.key,pos:sum(pos),neg:sum(neg)},ariaLabel:turns?t("turn",{n:c.turn??"?"}):itemLong(t,s),
      onmouseenter:e=>showTip(ctx,e.currentTarget,c,delta),onfocus:e=>showTip(ctx,e.currentTarget,c,delta)});
    bar.setAttribute("aria-pressed",String(selected));
    const up=node("span",{class:"stack up"}),down=node("span",{class:"stack down"});
    for(const x of pos)up.append(node("span",{dataset:{v:x.v,role:x.role},style:{background:palette[x.role]},...hoverRole(x.role)}));
    for(const x of neg)down.append(node("span",{dataset:{v:x.v,role:x.role},style:{background:palette[x.role]},...hoverRole(x.role)}));
    if(missing)up.append(node("span",{class:"missing",title:t("deltaUnknown")},"?"));
    const cut=c.items.map(x=>cuts.get(x.key)).find(Boolean);
    if(cut)bar.append(node("span",{class:"cut "+cut.event.kind,title:eventLabel(t,cut.event)+" · "+clock(cut.event.timestamp)+" · "+t("eventFocusTip"),
      onclick:e=>{e.stopPropagation();a.focusEvent(cut.event);}},GLYPH[cut.event.kind]));
    const number=turns?c.turn:s.step??i+1,showLabel=!dense||selected||i===0||number%5===0;
    bar.append(node("span",{class:"bar-area",style:{height:H+"px"}},up,down),node("span",{class:"bar-x"},showLabel?(turns?t("turnShort",{n:number}):String(number)):""));
    if(!turns)bar.append(node("span",{class:"bar-turn"+(parity?" alt":"")+(columns[i+1]?.turn===c.turn?" joined":"")},first&&c.turn!=null?t("turnShort",{n:c.turn}):""));
    plot.append(bar);
  }
  const head=node("div",{class:"card-head"},node("h2",{},t("trend")),node("div",{class:"head-tools"},
    button(t("adaptive"),()=>a.set({trendAdaptive:!view.trendAdaptive}),{class:"toggle"+(view.trendAdaptive?" on":""),id:"trend-adaptive",title:t("adaptiveTip"),ariaPressed:String(view.trendAdaptive)}),
    seg([["step",t("granStep")],["turn",t("granTurn")]],view.granularity,v=>a.set({granularity:v}),{id:"gran",small:true}),
    seg([["total",t("total")],["delta",t("delta")]],view.trend,v=>a.set({trend:v}),{id:"trend",small:true})));
  const chart=node("div",{class:"chart"},node("div",{class:"y-axis",style:{height:TOP+H+"px"}}),
    node("div",{class:"chart-main"},node("div",{class:"grid-lines",style:{top:TOP+"px",height:H+"px"}}),node("div",{class:"trend-scroll",id:"trend-scroll",dataset:{scroll:"trend"}},plot)));
  const coverage=o.trajectory?.coverage??[];
  const history=coverage.includes("history_reset")||coverage.includes("source_rotated")?t("trendReset"):coverage.includes("history_window")?t("trendWindow"):null;
  const foot=node("div",{class:"card-foot"},ctx.hasOlder?button("‹ "+t("older"),a.older,{class:"btn ghost small",id:"older"}):null,spacer(),
    muted(turns?t("loadedTurns",{n:columns.length}):t("loadedSteps",{n:series.length})));
  const card=node("section",{class:"card trend-card",dataset:{mode:view.trend}},head,chart,foot,
    history?node("p",{class:"trend-history muted small",id:"trend-history",title:t("trendNumbering")},history):null);
  layoutTrend(card);
  return card;
}

function browserCard(ctx) {
  const {t,view,lens:L,detail:d,items,actions:a}=ctx,card=node("section",{class:"card browser",id:"browser"});
  const baseline=node("select",{id:"baseline",class:"mini-select"+(L.baselineKey?" on":""),ariaLabel:t("earlierBaseline"),onchange:e=>a.baseline(e.target.value||null)},node("option",{value:""},t("earlierBaseline")));
  for(const option of [...(d?.baselineOptions??[])].reverse()) {
    const item=items.find(x=>x.key===option.key);
    baseline.append(node("option",{value:option.key,selected:option.key===L.baselineKey},[item?itemName(t,item):null,clock(option.startedAt),option.complete?null:t("partial")].filter(Boolean).join(" · ")));
  }
  card.append(node("div",{class:"card-head wrap"},node("h2",{},t("browser")),node("div",{class:"compare",title:t("baselineTip")},muted(t("compareWith")),
    seg([["step",t("baseStep")],["turn",t("baseTurn")]],L.baselineKey?null:L.baselineMode,v=>a.baselineMode(v),{id:"base",small:true}),baseline)));
  if(L.focused)card.append(focusBar(ctx));
  const paused=L.focused&&Boolean(view.search);
  const search=node("input",{id:"element-search",type:"search",class:paused?"paused":null,title:paused?t("focusPausedTip"):null,placeholder:t("filter"),value:view.search,maxLength:200,autocomplete:"off",spellcheck:false,oninput:e=>a.search(e.target.value)});
  const clear=!L.focused&&view.search?button("×",()=>a.search("",true),{class:"icon-btn",id:"search-clear",title:t("clearFilter"),ariaLabel:t("clearFilter")}):null;
  card.append(node("div",{class:"controls"},search,clear,seg([["size",t("bySize")],["order",t("byOrder")]],view.sort,v=>a.sort(v),{id:"sort",small:true})));
  const li=d?.summary?.key===view.selectedKey?d.listing:null;
  const counts=li?.source?` +${li.added}`+(li.removed!=null?` −${li.removed}`:""):"";
  // Searching all loaded requests lists every match; All / Changes compares one request with its baseline, so it does not apply.
  const mode=L.searchAll?node("span",{class:"muted small",id:"mode"},t("loadedAllOnly"))
    :seg([["all",t("all")],["changes",t("changesOnly")+counts]],L.mode,v=>a.mode(v),{id:"mode",small:true});
  if(li?.narrowed&&li.source&&!L.searchAll)mode.title=t("changesNarrowedTip",{n:"+"+li.addedTotal+(li.removedTotal!=null?" −"+li.removedTotal:"")});
  card.append(node("div",{class:"controls"},mode,spacer(),
    !L.focused&&view.search?button(t("searchLoaded"),()=>a.searchAll(!view.searchAll),{class:"toggle"+(view.searchAll?" on":""),id:"search-scope",ariaPressed:String(view.searchAll)}):null));
  if(!li){card.append(node("p",{class:"muted pad"},t("loading")));return card;}
  if(d.searchScope==="all_loaded_snapshots"){card.append(loadedResults(ctx));return card;}
  const notes=[],changes=L.mode==="changes";
  if(changes&&li.source==="arrivals") {
    notes.push(t("arrivalsOnly",{since:t("step",{n:d.arrivals.sinceStep})}));
    if(d.arrivals.unknownCount)notes.push(t("arrivalsUnknown",{n:d.arrivals.unknownCount}));
  } else if(changes&&!li.source)notes.push(t("notComparable")+" · "+t(d.diff.reason));
  if(d.diff.available&&changes){if(d.diff.modelChanged)notes.push(t("modelChanged"));if(d.diff.reordered)notes.push(t("reordered"));}
  if(!d.composition.schemasRecorded)notes.push(t("schemasUnknown"));
  if(!d.composition.complete) {
    const reason=d.summary.incompleteReason,text=reason?t("incomplete."+reason):"";
    notes.push(t("partial")+(text?" · "+(text==="incomplete."+reason?reason:text):""));
  }
  for(const text of notes)card.append(node("p",{class:"note",id:text.startsWith(t("notComparable"))?"diff-status":undefined},text));
  if(changes&&!li.source)return card;
  const buckets=new Map(d.composition.buckets.map(b=>[b.role,b])),categories=new Map((d.diff.available?d.diff.categories:[]).map(c=>[c.role,c]));
  const total=[...buckets.values()].reduce((n,b)=>n+b.estimatedTokens,0)||1,matched=new Set(matchedRoles(L,d)),expanded=expandedRoles(view,d);
  const list=node("div",{class:"categories"});
  for(const role of ORDER.filter(r=>buckets.has(r)||(changes&&li.roles[r]?.removed)))
    list.append(category(ctx,role,buckets.get(role),categories.get(role),total,expanded.includes(role),li.narrowed,matched.has(role)));
  card.append(list);
  if(li.narrowed&&!matched.size)card.append(node("p",{class:"muted pad"},t("noMatches")));
  return card;
}
// Categories with something to list under the current set and narrowing, including an item kept listed because it is open.
export const matchedRoles=(L,d)=>!d?.listing?[]:L.mode==="changes"?ORDER.filter(r=>d.listing.addedGroups[r]?.items.length||d.listing.removedGroups[r]?.items.length):Object.keys(d.groups??{});
// Expanded categories: the focus's own, the matching ones while narrowed (until changed by hand), or the plain list's.
export function expandedRoles(view,d) {
  const L=lens(view);
  if(L.focused&&view.focus.expanded)return view.focus.expanded;
  if(L.focused?d?.listing?.narrowed:view.search)return (L.focused?null:view.searchExpanded)??matchedRoles(L,d);
  return view.expanded??[];
}
// The left half of a header counts what opening it lists, under the current narrowing; its +N / −N open exactly those changes.
// The right half states the request itself — size, share and change against the baseline — and never follows a filter.
function category(ctx,role,bucket,change,total,open,narrowed,matched) {
  const {t,lens:L,detail:d,actions:a,more}=ctx,changes=L.mode==="changes",li=d.listing;
  const r=li.roles[role]??{total:0,matched:0,added:0,addedTotal:0,removed:null,removedTotal:null};
  const group=d.groups?.[role],size=bucket?.estimatedTokens??0,added=li.addedGroups[role],removed=li.removedGroups[role];
  const dim=changes?!added?.items.length&&!removed?.items.length:narrowed&&!matched;
  const expanded=open&&!dim,toggle=()=>a.toggleRole(role),state={ariaExpanded:String(expanded),disabled:dim},delta=tokensOf(change);
  const badge=(n,all,cls,sign)=>n?button(sign+n,()=>a.showChanges(role),{class:"badge cat-badge "+cls,dataset:{focus:"badge:"+role+sign},title:narrowed&&n!==all?t("badgeNarrowedTip",{n,all}):t("badgeTip")}):null;
  const head=node("div",{class:"cat-head",...hoverRole(role)},
    button([node("span",{class:"chev"},expanded?"▾":"▸"),dot(role),node("span",{class:"cat-name"},t(role)),
      node("span",{class:"cat-count"},changes?t("changedItems",{n:r.added+(r.removed??0)}):narrowed?t("matchedItems",{m:r.matched,n:r.total}):t("items",{n:r.total}))],toggle,{class:"cat-toggle",dataset:{focus:"cat:"+role},...state}),
    badge(r.added,r.addedTotal,"up","+"),badge(r.removed,r.removedTotal,"down","−"),
    button([spacer(),delta?node("span",{class:"delta "+(delta>0?"up":"down")},signed(delta)):null,node("span",{class:"num"},approx(size)),node("span",{class:"pct"},pct(size/total))],
      toggle,{class:"cat-toggle cat-facts",tabIndex:-1,...state}));
  const section=node("section",{class:"category"+(expanded?" open":"")+(dim?" dim":""),dataset:{role}},head);
  if(!expanded)return section;
  const body=node("div",{class:"cat-body"}),unlisted=g=>g?g.count-g.items.filter(x=>!x.pinned).length:0;
  if(role==="schema")body.append(schemaTools(ctx,changes,narrowed));
  if(changes) {
    for(const item of added?.items??[])body.append(elementRow(ctx,item,{badge:item.pinned?null:"added"}));
    if(unlisted(added)>0)body.append(node("p",{class:"muted pad"},t("moreNotListed",{n:unlisted(added)})));
    for(const item of removed?.items??[])body.append(elementRow(ctx,item,{badge:"removed",snapshotKey:d.diff.previousKey}));
    if(unlisted(removed)>0)body.append(node("p",{class:"muted pad"},t("moreNotListed",{n:unlisted(removed)})));
    if(body.children.length===(role==="schema"?1:0))body.append(node("p",{class:"muted pad"},t(narrowed?"noMatches":"noChanges")));
  } else {
    const seen=new Set(),rows=[...(group?.items??[]),...(more[role]?.items??[])].filter(x=>!seen.has(x.key)&&seen.add(x.key));
    const addedKeys=new Set(d.diff.available?d.diff.addedKeys:d.arrivals?.available?d.arrivals.keys:[]);
    for(const item of rows)body.append(elementRow(ctx,item,{badge:addedKeys.has(item.key)?"added":null}));
    const left=(group?.count??0)-rows.filter(x=>!x.pinned).length;
    if(left>0)body.append(button(t("showMore",{n:left}),()=>a.more(role),{class:"btn ghost more",dataset:{role,focus:"more:"+role}}));
    if(!rows.length)body.append(node("p",{class:"muted pad"},t("noMatches")));
  }
  section.append(body);
  return section;
}
// Session-wide call counts: a schema never called still costs its size on every request. The line describes every
// schema of the request, so a narrowed list says so.
function schemaTools(ctx,changes,narrowed) {
  const {t,view,detail:d,actions:a}=ctx,s=d.schemaCalls;
  const sort=seg([["size",t(view.sort==="order"?"byOrder":"bySize")],["calls",t("byCalls")],["name",t("byName")]],view.schemaSort,v=>a.schemaSort(v),{id:"schema-sort",small:true});
  const unused=!s?.unusedCount?t("allSchemasCalled"):narrowed?t("unusedSchemasAll",{n:s.unusedCount,total:s.schemaCount,tokens:approx(s.unusedEstimatedTokens)})
    :t("unusedSchemas",{n:s.unusedCount,tokens:approx(s.unusedEstimatedTokens)});
  const line=changes?null:!s?.available?node("span",{class:"schema-unused muted",id:"schema-unused"},t("callsUnknown"))
    :node("span",{class:"schema-unused",id:"schema-unused",title:t("unusedTip")},unused,s.unknownCount?muted(" · "+t("callsUnknownSome",{n:s.unknownCount})):null);
  return node("div",{class:"schema-tools"},line,spacer(),sort);
}
// What an event focus shows and what it pauses; × ends it and the user's own baseline, set and filter come back.
function focusBar(ctx) {
  const {t,view,overview:o,detail:d,items,selected,actions:a}=ctx,f=view.focus;
  const event=(o.events??[]).find(e=>eventId(e)===f.eventKey),li=d?.summary?.key===view.selectedKey?d.listing:null;
  let text="";
  if(f.kind==="tools") {
    const k=li?li.roles.schema?.matched??0:null;
    text=[t("focusTools"),k!=null?t("focusToolsCount",{n:k}):null,k!=null&&f.toolCount!=null&&f.toolCount!==k?t("focusToolsRegistered",{n:f.toolCount}):null].filter(Boolean).join(" · ");
  } else {
    const before=items.find(x=>x.key===f.baselineKey);
    if(before&&selected)text=t("focusCompare",{a:itemName(t,before),b:itemName(t,selected)});
  }
  const notes=[f.note?.reason?t("eventNotComparable",{reason:t(f.note.reason)}):null,f.note?.same?t(f.kind==="tools"?"focusToolsSame":"noChanges"):null,
    f.note?.latest?t("focusToolsLatest"):null,view.search?t("focusPaused",{q:view.search}):null].filter(Boolean);
  return node("div",{class:"focus",id:"focus",dataset:{kind:f.kind}},
    node("div",{class:"focus-bar"},node("div",{class:"focus-head"},node("span",{class:"event-glyph"},GLYPH[f.kind]??"•"),
      node("b",{class:"focus-kind"},event?eventLabel(t,event):t("kind."+f.kind)),spacer(),button("×",a.exitFocus,{class:"icon-btn",id:"focus-exit",title:t("focusExit"),ariaLabel:t("focusExit")})),
      text?node("div",{class:"focus-text"},text):null),
    notes.map(text=>node("p",{class:"note"},text)));
}
function loadedResults(ctx) {
  const {t,detail:d,items}=ctx,wrap=node("div",{class:"loaded-results"},node("p",{class:"muted pad"},t("loadedResults",{n:d.loadedSnapshotCount,m:d.filteredCount})));
  for(const item of d.elements) {
    const snapshot=items.find(x=>x.key===item.snapshotKey);
    wrap.append(elementRow(ctx,item,{snapshotKey:item.snapshotKey,prefix:snapshot?itemName(t,snapshot):clock(item.snapshotTime)}));
  }
  if(d.filteredCount>d.elements.length)wrap.append(node("p",{class:"muted pad"},t("moreNotListed",{n:d.filteredCount-d.elements.length})));
  return wrap;
}
function elementRow(ctx,item,{badge=null,snapshotKey=null,prefix=null}={}) {
  const {t,view,actions:a}=ctx,key=snapshotKey??view.selectedKey;
  const open=Boolean(view.open&&view.open.elementKey===item.key&&view.open.key===key);
  const head=button([node("span",{class:"chev"},open?"▾":"▸"),prefix?chip(prefix,"step-chip"):null,
    item.status==="error"?node("i",{class:"err-dot",title:t("error")}):null,chip(label(t,item),item.role==="tool"||item.role==="assistant"?"tool-chip":""),
    node("span",{class:"el-title"},item.title||item.preview||item.key),
    item.pinned?node("span",{class:"pin",title:t("pinnedTip")},t("pinnedItem")):null,
    badge?node("span",{class:"badge "+(badge==="added"?"up":"down")},t(badge==="added"?"addedBadge":"removedBadge")):null,
    item.role==="schema"&&item.callCount!=null?node("span",{class:"calls"+(item.callCount?"":" zero"),title:t("callsTip",{n:item.callCount})},"×"+item.callCount):null,
    entryStamp(t,item),node("span",{class:"num"},approx(item.estimatedTokens))],()=>a.open(item,key),{class:"el-head",dataset:{focus:"el:"+key+":"+item.key},ariaExpanded:String(open)});
  const row=node("div",{class:"el element-row"+(open?" open":"")+(badge==="removed"?" removed":""),dataset:{element:item.key,snapshot:key,kind:badge??""}},head);
  if(item.subtitle&&!open)row.append(node("div",{class:"el-sub"},item.subtitle));
  if(open)row.append(elementBody(ctx,item,{badge}));
  return row;
}

// When the message first entered the context, or that it was already there where the continuous history begins.
function entryStamp(t,item) {
  const e=item.entered;
  if(e)return node("span",{class:"stamp",title:e.turn!=null?t("enteredTip",{turn:e.turn,step:e.step}):t("enteredStepTip",{step:e.step})},(e.turn!=null?"T"+e.turn+" ":"")+"S"+e.step);
  if(item.enteredBefore)return node("span",{class:"stamp before",title:t("enteredBeforeTip",{step:item.tracedTo?.step??"?"})},t("entryEarlier"));
  return null;
}
function elementBody(ctx,item,{badge}) {
  const {t,view,content:data,detail:d,items,actions:a}=ctx,p=view.open,box=node("div",{class:"el-body"});
  const origin=items.find(x=>x.key===p.key);
  if(badge==="removed")box.append(node("p",{class:"note"},t("fromBaseline",{label:origin?itemLong(t,origin):"—"})));
  else if(p.key!==view.selectedKey&&origin)box.append(node("p",{class:"note"},node("span",{class:"spacer"},itemLong(t,origin)),button(itemName(t,origin)+" ›",()=>a.select(p.key),{class:"btn small"})));
  if(!data?.content||data.content.key!==item.key||data.summary?.key!==p.key){box.append(node("p",{class:"muted"},t("loading")));return box;}
  const c=data.content,diff=data.bodyDiff;
  if(c.role==="tool")box.append(toolCard(t,c));
  const pair=d?.diff?.available&&p.key===view.selectedKey?d.diff.changedPairs?.find(x=>x.after===item.key):null;
  if(pair)box.append(button(p.diff?t("showContent"):t("showDiff"),()=>a.toggleDiff(pair.before),{class:"btn small",id:"toggle-diff"}));
  if(diff){box.append(diffView(ctx,diff));return box;}
  if(c.role==="schema"&&p.format!=="raw") {
    const schema=schemaView(ctx,c);
    if(schema){box.append(schema);return box;}
  }
  box.append(bodyHead(ctx,c),bodyText(ctx,c),bodyFoot(ctx,c));
  return box;
}
function toolCard(t,c) {
  const tool=c.tool,status=c.status==="error"?["err",t("error")]:c.status==null?["unknown",t("statusUnknown")]:["ok",t("ok")];
  const card=node("div",{class:"tool-card"},node("div",{class:"tool-card-head"},node("span",{class:"tool-name"},"← "+(tool?.name??c.toolName??"tool")),spacer(),
    node("span",{class:"status "+status[0]},"● "+status[1])));
  if(tool?.fields?.length) {
    const list=node("dl",{class:"params"});
    for(const field of tool.fields)list.append(node("dt",{},field.name),node("dd",{},field.value+(field.truncated?"…":"")));
    card.append(list);
  } else if(tool)card.append(node("pre",{class:"params-raw"},tool.arguments+(tool.argumentsTruncated?"…":"")));
  else card.append(node("p",{class:"muted"},t("noParams")));
  return card;
}
function formatSwitch(ctx,options) {
  const {t,view,actions:a}=ctx;
  return seg(options.map(key=>[key,key==="markdown"?"MD":t(key)]),view.open.format,v=>a.format(v),{id:"format",small:true});
}
function bodyHead(ctx,c) {
  const {t,actions:a}=ctx,parts=Math.ceil(c.totalChars/CHUNK);
  return node("div",{class:"body-head"},node("b",{},c.role==="tool"?t("result"):t("content")),muted(t("lines",{n:full(c.lineCount)})),spacer(),
    formatSwitch(ctx,c.role==="schema"?["readable","raw"]:["readable","markdown","raw"]),button(parts>1?t("copyChunk"):t("copy"),()=>a.copy(c.text),{class:"btn small",id:"copy"}));
}
function bodyText(ctx,c) {
  const p=ctx.view.open,markdownMode=p.format==="markdown";
  const el=node(markdownMode?"article":"pre",{class:"body"+(markdownMode?" md":""),id:"content",tabIndex:0,dataset:{scroll:"body:"+p.key+":"+p.elementKey+":"+c.offset+":"+p.format}});
  if(markdownMode)el.append(markdown(c.text));
  else if(p.search) {
    const query=p.search.toLowerCase(),lower=c.text.toLowerCase(),current=p.matchIndex>=0?c.hits[p.matchIndex]-c.offset:-1;
    let start=0,at;
    while(query&&(at=lower.indexOf(query,start))>=0){el.append(c.text.slice(start,at),node("mark",{class:at===current?"current":""},c.text.slice(at,at+query.length)));start=at+query.length;}
    el.append(c.text.slice(start));
  } else el.textContent=c.text;
  return el;
}
function bodyFoot(ctx,c) {
  const {t,view,actions:a}=ctx,p=view.open,parts=Math.ceil(c.totalChars/CHUNK),part=Math.floor(c.offset/CHUNK)+1;
  const keys=e=>{
    if(e.key==="Enter"){e.preventDefault();e.shiftKey?a.prevMatch():a.nextMatch();}
    else if(e.key==="Escape"&&e.target.value){e.preventDefault();e.target.value="";a.bodySearch("");}
  };
  const position=p.matchIndex>=0&&c.matchCount?t("matchOf",{i:p.matchIndex+1,n:full(c.matchCount)}):t("matches",{n:full(c.matchCount)});
  const find=node("div",{class:"find"},node("input",{id:"body-search",type:"search",placeholder:t("findInBody"),value:p.search??"",maxLength:200,autocomplete:"off",title:t("findKeys"),oninput:e=>a.bodySearch(e.target.value),onkeydown:keys}),
    p.search?muted(position+(c.matchCount>100?" · "+t("firstMatches"):"")):null,
    p.search?button("‹",a.prevMatch,{class:"icon-btn",id:"prev-match",title:t("prevMatch"),ariaLabel:t("prevMatch"),disabled:!c.hits.length}):null,
    p.search?button("›",a.nextMatch,{class:"icon-btn",id:"next-match",title:t("nextMatch"),ariaLabel:t("nextMatch"),disabled:!c.hits.length}):null);
  const foot=node("div",{class:"body-foot"},find);
  if(parts>1)foot.append(chunks(ctx,c.offset,parts,c.hasMore));
  return foot;
}
function chunks(ctx,offset,parts,hasMore) {
  const {t,actions:a}=ctx;
  return node("div",{class:"chunks"},button("‹ "+t("prevChunk"),()=>a.chunk(Math.max(0,offset-CHUNK)),{class:"btn small",id:"chunk-previous",disabled:offset===0}),
    muted(t("chunkOf",{i:Math.floor(offset/CHUNK)+1,n:parts})),button(t("nextChunk")+" ›",()=>a.chunk(offset+CHUNK),{class:"btn small",id:"more",disabled:!hasMore}));
}
function diffView(ctx,diff) {
  const {t,actions:a}=ctx,parts=Math.ceil(diff.totalChars/CHUNK);
  const body=node("pre",{class:"body body-diff",id:"content",tabIndex:0,dataset:{scroll:"diff:"+diff.afterKey+":"+diff.offset}});
  for(const line of diff.text.split("\n"))body.append(node("div",{class:line.startsWith("+ ")?"added":line.startsWith("- ")?"removed":""},line||" "));
  return node("div",{class:"diff"},node("div",{class:"body-head"},node("b",{},t("showDiff")),spacer(),button(t("copy"),()=>a.copy(diff.text),{class:"btn small",id:"copy"})),
    node("p",{class:"muted small"},t("diffMethod")),body,parts>1?chunks(ctx,diff.offset,parts,diff.hasMore):null);
}
function typeOf(spec) {
  if(!spec||typeof spec!=="object")return "any";
  if(Array.isArray(spec.type))return spec.type.join(" | ");
  if(spec.type)return spec.type+(spec.type==="array"&&spec.items?.type?"<"+spec.items.type+">":"");
  const options=spec.anyOf??spec.oneOf;
  if(Array.isArray(options))return options.map(typeOf).join(" | ");
  return spec.enum?"enum":"any";
}
function schemaView(ctx,c) {
  if(c.offset!==0||c.hasMore)return null;
  let fn;
  try{fn=JSON.parse(c.text);}catch{return null;}
  if(!fn||typeof fn!=="object")return null;
  const {t,actions:a}=ctx,params=fn.parameters??fn.input_schema??fn.inputSchema??{},props=params.properties??{};
  const required=new Set(Array.isArray(params.required)?params.required:[]);
  const wrap=node("div",{class:"schema"},
    node("div",{class:"body-head"},node("b",{},t("description")),spacer(),formatSwitch(ctx,["readable","raw"]),button(t("copy"),()=>a.copy(c.text),{class:"btn small",id:"copy"})),
    node("article",{class:"body md",id:"content",tabIndex:0,dataset:{scroll:"schema:"+c.key}},markdown(String(fn.description??""))),
    node("div",{class:"body-head"},node("b",{},t("parameters")),muted(String(Object.keys(props).length))));
  const list=node("div",{class:"param-list"});
  for(const [name,spec] of Object.entries(props))list.append(node("div",{class:"param"},
    node("div",{class:"param-head"},node("code",{},name),node("span",{class:"param-type"},typeOf(spec)),required.has(name)?node("span",{class:"req"},"✓ "+t("required")):null),
    spec?.description?node("div",{class:"param-desc"},String(spec.description)):null));
  wrap.append(list);
  return wrap;
}
function inline(text) {
  return String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map(part=>
    part.length>2&&part.startsWith("`")&&part.endsWith("`")?node("code",{},part.slice(1,-1)):
    part.length>4&&part.startsWith("**")&&part.endsWith("**")?node("strong",{},part.slice(2,-2)):part);
}
export function markdown(text) {
  const fragment=document.createDocumentFragment(),lines=String(text).split("\n"),block=/^(```|#{1,4}\s|\s*[-*+]\s|\s*\d+[.)]\s|>)/;
  let i=0;
  while(i<lines.length) {
    const line=lines[i];
    if(line.startsWith("```")){const code=[];i++;while(i<lines.length&&!lines[i].startsWith("```"))code.push(lines[i++]);i++;fragment.append(node("pre",{class:"code"},code.join("\n")));continue;}
    const heading=line.match(/^(#{1,4})\s+(.*)$/);
    if(heading){fragment.append(node("h"+(heading[1].length+2),{},inline(heading[2])));i++;continue;}
    if(/^\s*[-*+]\s+/.test(line)||/^\s*\d+[.)]\s+/.test(line)) {
      const ordered=/^\s*\d/.test(line),pattern=ordered?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/,list=node(ordered?"ol":"ul");
      while(i<lines.length&&pattern.test(lines[i]))list.append(node("li",{},inline(lines[i++].replace(pattern,""))));
      fragment.append(list);continue;
    }
    if(line.startsWith(">")){const quote=[];while(i<lines.length&&lines[i].startsWith(">"))quote.push(lines[i++].replace(/^>\s?/,""));fragment.append(node("blockquote",{},inline(quote.join(" "))));continue;}
    if(!line.trim()){i++;continue;}
    const paragraph=[lines[i++]];
    while(i<lines.length&&lines[i].trim()&&!block.test(lines[i]))paragraph.push(lines[i++]);
    fragment.append(node("p",{},inline(paragraph.join(" "))));
  }
  return fragment;
}

export const eventId=event=>event.id??event.kind+":"+event.timestamp;
// Where a click on the event leads, for its tooltip.
function eventTip(t,event,target) {
  if(event.kind==="tools")return t(target.after?"eventToolsTip":"eventToolsNoStepTip");
  if(target.unlocated)return t("eventTextTip");
  if(target.earlier)return t("eventEarlierTip");
  if(!target.after)return t("eventNoAfter");
  if(event.stepKey)return t("eventOpenTip");
  if(event.kind==="model")return t("eventModelTip");
  return t(BOUNDARY.has(event.kind)?"eventCompareTip":"eventFocusTip");
}
function eventsCard(ctx) {
  const {t,view,overview:o,items,actions:a}=ctx,all=o.events??[],kinds=eventKinds(all);
  const picked=view.eventKinds?.filter(k=>kinds.includes(k)),shown=picked?.length?picked:kinds;
  const whole=Boolean(o.conversation?.available);
  const head=node("div",{class:"card-head wrap"},node("h2",{},t("events")),node("span",{class:"muted",id:"events-scope",title:t(whole?"eventsWholeTip":"eventsWindowTip")},t(whole?"eventsWhole":"eventsWindow")),spacer());
  if(kinds.length>1)head.append(node("div",{class:"event-kinds",id:"event-kinds"},...kinds.map(kind=>{
    const on=shown.includes(kind),n=all.filter(e=>e.kind===kind).length;
    return button([t("kindName."+kind),node("span",{class:"kind-n"},String(n))],()=>a.eventKind(kind,kinds),{class:"toggle"+(on&&picked?.length?" on":""),dataset:{kind,focus:"kind:"+kind},ariaPressed:String(on&&Boolean(picked?.length))});
  })));
  const card=node("section",{class:"card events",id:"events"},head);
  if(!all.length){card.append(node("p",{class:"muted"},t("noEvents")));return card;}
  const rows=[...all].reverse().filter(event=>shown.includes(event.kind));
  for(const event of view.eventsAll?rows:rows.slice(0,EVENT_ROWS)) {
    const target=anchors(items,event,olderUnloaded(ctx)),{before,after}=target,at=eventAt(t,event,target),detail=eventDetail(t,event);
    const evidence=t(event.navigation?.evidence==="turn_range"?"turnEvidence":"timeEvidence");
    const on=view.eventKey===eventId(event)&&Boolean(view.selectedKey);
    const saved=event.tokensSavedEstimate!=null?node("span",{class:"badge down",title:t("saved",{n:full(event.tokensSavedEstimate)})},"−"+compact(event.tokensSavedEstimate))
      :event.tokens?node("span",{class:"badge up",title:t("eventTokensTip")},"+"+compact(event.tokens)):null;
    const reachable=Boolean(after)||target.earlier||target.unlocated||event.kind==="tools";
    const open=view.eventOpen===eventId(event),compacted=event.kind==="compaction"&&event.evidence==="recorded"&&event.summarizedCount;
    const main=button([node("span",{class:"event-glyph"},GLYPH[event.kind]??"•"),node("span",{class:"kind"},eventLabel(t,event)),
      detail?node("span",{class:"event-detail",title:detail},detail):null,spacer(),saved,muted(clock(event.timestamp))],
      ()=>a.focusEvent(event),{class:"event-main",dataset:{focus:"event:"+eventId(event)},disabled:!reachable,title:eventTip(t,event,target),ariaPressed:String(on)});
    const nav=node("div",{class:"event-nav"},at?node("span",{class:"event-at",title:evidence},at):null,
      event.clearedMessageCount!=null?muted(t("cleared",{n:full(event.clearedMessageCount)})):null,spacer(),
      event.kind==="inject"&&event.text?button(open?t("hideText"):t("showText"),()=>a.eventToggle(event),{class:"btn small ghost event-toggle",dataset:{focus:"event-text:"+eventId(event)},ariaExpanded:String(open)}):null,
      event.kind==="tools"&&open&&!after?button(t("hideText"),()=>a.eventToggle(event),{class:"btn small ghost event-toggle",dataset:{focus:"event-text:"+eventId(event)},ariaExpanded:"true"}):null,
      compacted?button((open?"▾ ":"▸ ")+t("summarizedList"),()=>a.eventToggle(event),{class:"btn small ghost event-toggle",dataset:{focus:"event-text:"+eventId(event)},ariaExpanded:String(open),title:t("summarizedHint")}):null,
      BOUNDARY.has(event.kind)&&before?button(t(event.kind==="rewind"?"rewindBefore":"before")+" · "+itemName(t,before),()=>a.select(before.key),
        {class:"btn small ghost"+(before.key===view.selectedKey?" on":""),dataset:{focus:"event-before:"+eventId(event)},title:evidence}):null);
    const row=node("div",{class:"event "+event.kind+(event.status==="failed"?" failed":"")+(on?" on":"")+(open?" open":""),dataset:{kind:event.kind,evidence:event.evidence??"logged",event:eventId(event)}},main,nav);
    if(open&&event.kind==="inject")row.append(injectBody(t,event,target));
    else if(open&&event.kind==="tools"&&!after)row.append(toolsBody(ctx,event));
    else if(open&&event.kind==="compaction")row.append(summarizedBody(ctx,event));
    card.append(row);
  }
  if(rows.length>EVENT_ROWS)card.append(button(view.eventsAll?t("showFewerEvents"):t("showAllEvents",{n:rows.length-EVENT_ROWS}),()=>a.set({eventsAll:!view.eventsAll}),{class:"btn ghost small more",id:"events-all"}));
  return card;
}
// An MCP registration with no readable request after it has no step of its own; the latest step is offered, by name.
function toolsBody(ctx,event) {
  const {t,items,actions:a}=ctx;
  return node("div",{class:"event-body"},node("p",{class:"note"},t("toolsNoStep")),
    items.some(isAgent)?button(t("toolsAtLatest"),()=>a.toolsAtLatest(event),{class:"btn small",id:"tools-latest"}):null);
}
// The injected text as ZCode's conversation store keeps it, for when the request that carried it is not readable.
function injectBody(t,event,target) {
  return node("div",{class:"event-body"},target.unlocated?node("p",{class:"note"},t("eventNotInRecords")):null,
    node("pre",{class:"body event-text"},event.text),event.truncated?node("p",{class:"muted small"},t("textTruncated")):null);
}
// What a compaction summarized away, read on demand from the conversation store: one row per prompt, reply, reasoning block or tool call.
function summarizedBody(ctx,event) {
  const {t}=ctx,detail=ctx.eventDetails?.get(eventId(event)),box=node("div",{class:"event-body summarized"});
  if(!detail||detail.state==="loading"){box.append(node("p",{class:"muted"},t("loading")));return box;}
  if(detail.state==="failed"){box.append(node("p",{class:"note"},t(detail.code==="rewound_branch"?"summarizedRewound":"summarizedUnavailable")));return box;}
  const d=detail.data;
  box.append(node("p",{class:"muted small"},t("summarizedHint")+" · "+t("summarizedTotal",{n:full(d.messageCount),items:full(d.itemCount),tokens:approx(d.tokens)})));
  const list=node("div",{class:"summarized-list"});
  for(const item of d.items.slice(0,80))list.append(node("div",{class:"summarized-row"},
    chip(item.chip?known(t,"src."+item.chip)??known(t,"form."+item.chip)??item.chip:t("role."+item.role),"tool-chip"),node("span",{class:"el-title",title:item.title},item.title||"—"),node("span",{class:"num"},approx(item.tokens))));
  box.append(list);
  const rest=d.itemCount-Math.min(80,d.items.length);
  if(rest>0)box.append(node("p",{class:"muted small"},t("moreNotListed",{n:full(rest)})));
  return box;
}
function about(ctx) {
  const {t,view,overview:o,actions:a,session}=ctx,coverage=o?.trajectory?.coverage??[];
  const known=code=>{const text=t("cov."+code);return text==="cov."+code?code:text;};
  return node("details",{class:"about",id:"request-info",open:view.aboutOpen,ontoggle:e=>a.remember({aboutOpen:e.target.open})},
    node("summary",{},t("about")),
    node("ul",{},["aboutEstimate","aboutRecorded","aboutUsage","aboutDiff","aboutPermission"].map(key=>node("li",{},t(key)))),
    node("div",{class:"about-row"},node("b",{},t("coverage")),node("span",{id:"coverage"},coverage.length?coverage.map(known).join("；"):t("coverageFull"))),
    session?node("div",{class:"about-row"},node("b",{},t("session")),node("code",{id:"session"},session),button(t("copyId"),()=>a.copy(session),{class:"btn small"})):null,
    ctx.demo?node("div",{class:"about-row"},node("b",{},t("demo"))):null);
}
function usagePage(ctx) {
  const {t,overview:o}=ctx,u=o.usage,card=node("section",{class:"card",id:"usage-view"});
  if(!u?.available){card.append(node("p",{class:"muted"},t("usageUnavailable")));return card;}
  const x=u.totals,kpi=(id,name,value,title)=>node("div",{class:"kpi",title},node("span",{},name),node("strong",{id},value));
  card.append(node("div",{class:"kpis"},kpi("input",t("input"),compact(x.inputTokens),full(x.inputTokens)),kpi("output",t("output"),compact(x.outputTokens),full(x.outputTokens)),
    kpi("calls",t("calls"),full(x.requestCount)),kpi("cache",t("cacheRate"),x.cacheHitRate==null?"—":pct(x.cacheHitRate))));
  if(x.inputMissingCount||x.outputMissingCount||x.missingUsageCount)card.append(node("p",{class:"note"},t("partUsage")));
  const max=Math.max(1,...u.days.map(day=>day.inputTokens??0)),daily=node("div",{class:"daily",id:"daily"});
  for(const day of [...u.days].reverse())daily.append(node("div",{class:"day"},node("span",{class:"day-date"},utcDate(day.utcDay)),
    node("span",{class:"day-bar"},node("i",{style:{width:(day.inputTokens??0)/max*100+"%"}})),node("span",{class:"num"},compact(day.inputTokens)+" / "+compact(day.outputTokens))));
  const recent=node("div",{class:"recent"});
  for(const fact of [...u.facts].reverse().slice(0,40))recent.append(node("div",{class:"fact"},
    node("div",{class:"fact-main"},node("b",{},sourceName(t,fact.querySource)),muted(fact.modelId??""),spacer(),node("span",{class:"num"},compact(fact.inputTokens)+" / "+compact(fact.outputTokens))),
    node("div",{class:"muted small"},[clock(fact.startedAt),fact.status,fact.durationMs!=null?(fact.durationMs/1000).toFixed(1)+"s":null].filter(Boolean).join(" · "))));
  card.append(node("h3",{},t("daily")),daily,node("h3",{},t("recent")),recent);
  return card;
}
// The plugin's own identity: version (same one the app announces to the host), author, licence, source and what it reads.
function aboutPage(ctx) {
  const {t,actions:a,version,demo}=ctx,row=(id,label,...value)=>node("div",{class:"about-row"},node("b",{},label),...value);
  return node("section",{class:"card",id:"about-view"},
    node("p",{class:"muted",id:"about-tagline"},t("aboutTagline")),
    row("about-version",t("aboutVersion"),node("code",{id:"about-version"},version??"—")),
    row("about-author",t("aboutAuthor"),"Kevinzzz6"),
    row("about-license",t("aboutLicense"),"MIT"),
    row("about-repo",t("aboutRepo"),node("code",{id:"about-repo"},"github.com/Kevinzzz6/zcode-context"),
      button(t("copy"),()=>a.copy("https://github.com/Kevinzzz6/zcode-context"),{class:"btn small",id:"about-repo-copy"})),
    node("p",{class:"note",id:"about-privacy"},t("aboutPrivacy")),
    node("p",{class:"note"},t("aboutNotices")),
    demo?node("p",{class:"note"},t("demo")):null);
}
