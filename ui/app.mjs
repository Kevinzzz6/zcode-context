import { App } from "@modelcontextprotocol/ext-apps";
import { initialView, restoreView, saveView, mergeSnapshots } from "./state.mjs";
import { translator } from "./i18n.mjs";
import { node, button, fmt, when, snapshotControls, trend, compositionView, changesView, eventsView, contentView, usageView } from "./components.mjs";
let app=null,overview=null,items=[],boundSession=null,view=initialView(),detail=null,contentData=null;
let t=translator(),busy=false,generation=0,detailSequence=0,contentSequence=0,historyPage=0,hasOlder=false;
let notice="",timer,searchTimer,bodyTimer,controller;
const demo=new URLSearchParams(location.search).get("demo")==="1";
const root=document.getElementById("root");
const persist=()=>saveView(boundSession,view);
function render() {
  const focus=document.activeElement,focusId=focus?.id,selection=focus?.selectionStart,scroll=window.scrollY;
  const selected=detail?.summary.key===view.selectedKey?{...detail.summary,delta:detail.diff.available?{chars:detail.diff.charsDelta}:null,deltaReason:detail.diff.reason}:items.find(x=>x.key===view.selectedKey);
  const ctx={t,view,overview,items,selected,detail,contentData,actions,hasOlder};
  const header=node("header",{},node("h1",{id:"heading"},t("title")),node("div",{class:"controls"},
    button(t("usage"),()=>set({usage:true}),{id:"show-usage"}),button(t("refresh"),()=>refresh(true),{id:"refresh",disabled:busy})));
  const status=node("p",{id:"status",role:"status",class:"muted"},notice||(!overview?t("loading"):demo?"DEMO · Synthetic input":""));
  const body=node("div",{id:"main-view"});
  if(overview) {
    if(view.usage)body.append(usageView(ctx));
    else if(view.detail)body.append(contentView(ctx));
    else {
      body.append(snapshotControls(ctx));
      if(items.length) {
        const pref=node("select",{id:"layout",onchange:e=>set({layout:e.target.value})});
        for(const key of ["diagnostic","browse"])pref.append(node("option",{value:key,selected:key===view.layout},t(key)));
        body.append(node("div",{class:"preference"},pref),trend(ctx));
        const tabs=node("nav",{ariaLabel:t("title")});
        for(const key of ["composition","changes","events"])tabs.append(button(t(key),()=>set({tab:key}),{id:"tab-"+key,class:view.tab===key?"active":"",ariaPressed:view.tab===key}));
        body.append(tabs,view.tab==="composition"?compositionView(ctx):view.tab==="changes"?changesView(ctx):eventsView(ctx));
      }else body.append(node("p",{class:"notice"},t("empty")),eventsView(ctx));
    }
    const info=node("details",{id:"request-info",open:view.infoOpen,ontoggle:e=>{view.infoOpen=e.target.open;persist();}},node("summary",{},t("recordInfo")),node("p",{id:"session"},boundSession),
      button(t("copy")+" ID",()=>copy(boundSession)),node("p",{class:"muted",id:"coverage"},t("gap")+": "+(overview.trajectory.coverage.join(" · ")||"—")+" · "+fmt(overview.history?.loadedCount)+" loaded"),
      node("p",{class:"muted"},t("boundaries")));
    if(selected)info.append(node("pre",{},`${selected.requestId} · attempt ${selected.attempt}\n${when(selected.startedAt)} · ${selected.querySource}\nturnId: ${selected.turnId??t("unknown")}`),
      node("p",{class:"muted"},t("actual")),node("pre",{},Object.entries(selected.usage??{}).map(([k,v])=>k+": "+(v==null?t("unknown"):fmt(v))).join("\n")),
      node("p",{class:"muted"},selected.responsePreview??""));
    body.append(info);
  }
  root.replaceChildren(header,status,body);
  if(focusId) {const restored=document.getElementById(focusId);restored?.focus({preventScroll:true});if(selection!=null&&restored?.setSelectionRange&&restored.type!=="number")try{restored.setSelectionRange(selection,selection);}catch{}}
  window.scrollTo(0,scroll);
}
function set(patch,reload=false) {
  view={...view,...patch};persist();render();if(reload)loadDetail();
}
function choose(key,follow=false) {
  if(!key)return;
  ++contentSequence;view={...view,selectedKey:key,follow,detail:null,page:0,changePage:0,baselineKey:null,trendPage:follow?0:view.trendPage};
  detail=null;contentData=null;notice="";persist();render();loadDetail();
}
async function call(name,args,signal) {
  if(demo)return demoCall(name,args);
  const result=await app.callServerTool({name,arguments:args},{signal});
  if(result.isError)throw Object.assign(new Error("Read failed"),{code:result.structuredContent?.error?.code});
  return result.structuredContent;
}
function showError(error) {
  if(error.code==="binding_unavailable"){generation++;overview=null;items=[];boundSession=null;detail=null;contentData=null;view=initialView();}
  notice=t(error.code==="binding_unavailable"?"binding":error.code==="request_expired"?"expired":"error")+(error.code==="binding_unavailable"||error.code==="request_expired"?"":" · "+t("hostPermission"));render();
}
async function refresh(force=false) {
  if(busy)return;busy=true;controller=new AbortController();render();
  const expectedGeneration=generation;
  try {
    const next=await call("get_context_summary",force?{}:{...(overview?.revision?{revision:overview.revision}:{})},controller.signal);
    if(expectedGeneration!==generation)return;
    const fresh=next.sessionId!==boundSession;
    if(fresh){generation++;boundSession=next.sessionId;view=restoreView(boundSession);items=[];detail=null;contentData=null;historyPage=0;}
    if(!next.unchanged) {
      overview=next;items=mergeSnapshots(items.filter(x=>!next.history?.loadedKeys||next.history.loadedKeys.includes(x.key)),next.trajectories);hasOlder=(next.history?.loadedCount??items.length)>items.length;
      const latest=items.findLast(x=>["main_turn","subagent","workflow_child"].includes(x.querySource))??items.at(-1);
      const old=view.selectedKey;
      if(view.follow&&!view.detail)view.selectedKey=latest?.key??null;
      if(!view.selectedKey)view.selectedKey=latest?.key??null;
      if(old!==view.selectedKey){detail=null;view.page=0;view.baselineKey=null;}
      notice="";persist();render();
      if(fresh||!detail||force||old!==view.selectedKey)await loadDetail();
      if(view.detail&&(fresh||force))await loadContent();
      if(fresh)window.scrollTo(0,view.scroll??0);
    }
  }catch(error){if(expectedGeneration===generation||boundSession)showError(error);}
  finally{busy=false;render();}
}
async function loadDetail() {
  if(!view.selectedKey)return;
  const sequence=++detailSequence,expectedGeneration=generation,key=view.selectedKey;
  const args={key,page:view.page,search:view.search,searchScope:view.searchScope,sort:view.sort,changePage:view.changePage,...(view.baselineKey?{baselineKey:view.baselineKey}:{})};
  try {
    const next=await call("get_context_request",args);
    if(sequence!==detailSequence||expectedGeneration!==generation||key!==view.selectedKey||next.sessionId!==boundSession)return;
    detail=next;
    if(!view.expanded.length&&next.composition.buckets.length)view.expanded=[[...next.composition.buckets].sort((a,b)=>b.chars-a.chars)[0].role];
    if(view.search)view.expanded=[...new Set([...view.expanded,...next.elements.map(x=>x.role)])];
    if(!items.some(x=>x.key===key))items=mergeSnapshots(items,[next.summary]);
    persist();render();
  }catch(error){if(sequence===detailSequence&&expectedGeneration===generation)showError(error);}
}
async function open(item,options={}) {
  view.scroll=window.scrollY;view.follow=false;
  view.detail={key:options.key??view.selectedKey,elementKey:item.key,offset:0,format:"readable",search:"",matchIndex:-1,...options};
  contentData=null;persist();render();window.scrollTo(0,0);await loadContent();
}
async function loadContent() {
  if(!view.detail)return;
  const pointer={...view.detail},sequence=++contentSequence,expectedGeneration=generation;
  try {
    const next=await call("get_context_request",{key:pointer.key,elementKey:pointer.elementKey,offset:pointer.offset,
      format:pointer.format==="raw"?"raw":"readable",bodySearch:pointer.search,
      ...(pointer.diffBeforeElement?{diffBeforeElement:pointer.diffBeforeElement,...(view.baselineKey?{baselineKey:view.baselineKey}:{})}:{})});
    if(sequence!==contentSequence||expectedGeneration!==generation||!view.detail||next.sessionId!==boundSession)return;
    contentData=next;persist();render();
  }catch(error){if(sequence===contentSequence&&expectedGeneration===generation)showError(error);}
}
async function olderTrend() {
  if((view.trendPage+1)*10<items.length){set({trendPage:view.trendPage+1});return;}
  if(!hasOlder)return;
  const expectedGeneration=generation;
  try{
    const next=await call("get_context_summary",{historyPage:historyPage+1});
    if(expectedGeneration!==generation||next.sessionId!==boundSession)return;
    historyPage++;items=mergeSnapshots(items,next.trajectories);hasOlder=next.history.hasOlder;set({trendPage:view.trendPage+1});
  }catch(error){showError(error);}
}
async function copy(text) {
  try{await navigator.clipboard.writeText(text);notice=t("copied");}catch{notice=t("copyFailed");}render();
}
const actions={set,openSearch:async item=>{view.selectedKey=item.snapshotKey;view.baselineKey=null;detail=null;await loadDetail();open(item);},remember:patch=>{view={...view,...patch};persist();},select:choose,latest:()=>choose(items.findLast(x=>["main_turn","subagent","workflow_child"].includes(x.querySource))?.key??items.at(-1)?.key,true),
  olderTrend,open,copy,expand:role=>set({expanded:view.expanded.includes(role)?view.expanded.filter(x=>x!==role):[...view.expanded,role]}),
  search:value=>{view.search=value;view.page=0;persist();clearTimeout(searchTimer);searchTimer=setTimeout(loadDetail,180);},
  bodySearch:value=>{view.detail.search=value;view.detail.matchIndex=-1;persist();clearTimeout(bodyTimer);bodyTimer=setTimeout(loadContent,180);},
  nextMatch:()=>{const hits=contentData?.content?.hits??[];if(!hits.length)return;view.detail.matchIndex=((view.detail.matchIndex??-1)+1)%hits.length;view.detail.offset=Math.floor(hits[view.detail.matchIndex]/12000)*12000;loadContent();},
  contentFormat:format=>{view.detail={...view.detail,format,offset:0};persist();loadContent();},
  chunk:offset=>{view.detail.offset=offset;persist();loadContent();window.scrollTo(0,0);},
  back:()=>{const scroll=view.scroll;++contentSequence;view.detail=null;contentData=null;persist();render();window.scrollTo(0,scroll);}
};
window.addEventListener("scroll",()=>{if(!view.detail)view.scroll=window.scrollY;persist();},{passive:true});
document.addEventListener("visibilitychange",()=>{clearInterval(timer);if(!document.hidden){refresh();timer=setInterval(refresh,3000);}});
// Preview data is explicitly isolated from the production reader.
function demoCall(name,args) {
  const messages=[{key:"message:0",role:"system",chars:300,estimatedTokens:75,preview:"Demonstration rules"},{key:"message:1",role:"tool",toolName:"Read",chars:6400,estimatedTokens:1600,preview:"Example tool result"}];
  const records=Array.from({length:8},(_,i)=>({key:"demo"+i,requestId:"demo_request_"+i,attempt:1,startedAt:Date.now()-(8-i)*60000,querySource:"main_turn",complete:true,model:{modelId:"demo-model"},usage:{inputTokens:1000,outputTokens:20,cacheReadTokens:null},composition:{buckets:[{role:"system",count:1,chars:300,estimatedTokens:75},{role:"tool",count:1,chars:6400+i*800,estimatedTokens:1600+i*200}]},delta:i?{chars:800,categories:[{role:"tool",charsDelta:800}]}:null}));
  if(name==="get_context_summary")return {sessionId:"sess_demo",revision:"demo",trajectories:records,trajectory:{coverage:[]},history:{loadedCount:8,hasOlder:false},usage:{available:false},events:[]};
  const summary=records.find(x=>x.key===args.key)??records.at(-1);
  return {sessionId:"sess_demo",summary,composition:summary.composition,diff:{available:false,reason:"no_previous_snapshot"},elements:messages,elementCount:2,filteredCount:2,baselineOptions:[],content:args.elementKey?{...messages.find(x=>x.key===args.elementKey),text:"Synthetic preview content. No real data read.",offset:0,totalChars:44,lineCount:1,hits:[],matchCount:0}:null};
}
render();
if(!demo) {
  app=new App({name:"zcode-context",version:"0.2.0"},{availableDisplayModes:["fullscreen"]});
  const applyHostContext=()=>{
    const context=app.getHostContext();t=translator(context?.locale??"zh-CN");
    document.documentElement.lang=context?.locale??"zh-CN";document.documentElement.dataset.theme=context?.theme??"light";
    for(const [key,value] of Object.entries(context?.styles?.variables??{}))if(key.startsWith("--")&&typeof value==="string")document.documentElement.style.setProperty(key,value);
    render();
  };
  app.onhostcontextchanged=applyHostContext;
  app.onteardown=async()=>{persist();clearInterval(timer);clearTimeout(searchTimer);clearTimeout(bodyTimer);controller?.abort();};
  try{await app.connect();applyHostContext();await refresh();}catch(error){showError(error);}
}else await refresh();
timer=setInterval(()=>{if(!document.hidden)refresh();},3000);
