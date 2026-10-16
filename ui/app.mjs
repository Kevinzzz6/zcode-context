import { App } from "@modelcontextprotocol/ext-apps";
import { initialView, restoreView, saveView, mergeSnapshots, lens } from "./state.mjs";
import { translator, ORDER } from "./i18n.mjs";
import { renderApp, isAgent, CHUNK, layoutTrend, highlight, anchors, olderUnloaded, BOUNDARY, eventId, expandedRoles } from "./components.mjs";
import { demoCall } from "./demo.mjs";
const root=document.getElementById("root");
const INFO={name:"zcode-context",version:"0.3.10"};
const RETENTION_KEY="zcode-context:retention-dismissed";
let retentionDismissed=false;try{retentionDismissed=localStorage.getItem(RETENTION_KEY)==="1";}catch{}
const demo=new URLSearchParams(location.search).get("demo")==="1";
let app=null,t=translator(),view=initialView(),boundSession=null,overview=null,items=[],hasOlder=false,historyPage=0;
let detail=null,content=null,more={},notice=null,busy=false,activeLoads=0;
const eventDetails=new Map();
let generation=0,detailSequence=0,contentSequence=0,moreSequence={},toolCallsDigest=null,branch=null,branchEpoch=0;
let pendingRender=false,renderedSelection=null,scrollTarget=null,jumpToMatch=false,keepRightEdge=null,reveal=null;
// Bumped by every navigation, so an event navigation still waiting for history does not override a later choice.
let navigation=0;
let timer,searchTimer,bodyTimer,slowTimer,noticeTimer,scrollTimer,idlePolls=0,stopped=false;
const persist=()=>saveView(boundSession,view);
const latestKey=()=>items.filter(isAgent).at(-1)?.key??items.at(-1)?.key??null;

// Background refreshes wait while a native select is open or text is selected, so polling never interrupts reading.
function interacting() {
  if(document.activeElement?.tagName==="SELECT")return true;
  const selection=document.getSelection?.();
  return Boolean(selection&&!selection.isCollapsed&&root.contains(selection.anchorNode));
}
// Focus is restored by id or by a button's stable data-focus key; anything else by its child path from the nearest
// ancestor that has one, which holds while the rebuilt structure around it is the same.
const anchorOf=el=>el.id?{id:el.id}:el.dataset?.focus?{key:el.dataset.focus}:null;
function focusTarget(el) {
  const path=[];
  for(let x=el;x&&x!==root;x=x.parentElement) {
    const anchor=anchorOf(x);if(anchor)return {...anchor,path};
    path.unshift([...x.parentElement.children].indexOf(x));
  }
  return {root:true,path};
}
function restoreTarget({id,key,path}) {
  let el=id?document.getElementById(id):key?[...root.querySelectorAll("[data-focus]")].find(x=>x.dataset.focus===key):root;
  for(const i of path)el=el?.children[i];
  return el&&root.contains(el)&&el.matches("button,input,select,textarea,a[href],[tabindex]")?el:null;
}
function render(background=false) {
  if(background&&interacting()){pendingRender=true;return;}
  pendingRender=false;highlight(null);
  const focus=document.activeElement,target=focus&&root.contains(focus)&&focus!==root?focusTarget(focus):null,caret=focus?.selectionStart;
  const scrolls=new Map([...root.querySelectorAll("[data-scroll]")].map(el=>[el.dataset.scroll,[el.scrollLeft,el.scrollTop,el.scrollWidth]]));
  const y=window.scrollY,agents=items.filter(isAgent),index=agents.findIndex(x=>x.key===view.selectedKey);
  const selected=items.find(x=>x.key===view.selectedKey)??(detail?.summary?.key===view.selectedKey?detail.summary:null);
  const newerCount=index>=0?agents.length-1-index:selected?agents.filter(x=>x.startedAt>selected.startedAt).length:0;
  root.replaceChildren(renderApp({t,view,lens:lens(view),version:INFO.version,overview,items,selected,detail,content,more,eventDetails,hasOlder,notice,busy,demo,latestKey:latestKey(),newerCount,session:boundSession,actions,retentionDismissed}));
  for(const el of root.querySelectorAll("[data-scroll]")) {
    const saved=scrolls.get(el.dataset.scroll);if(!saved)continue;
    el.scrollTop=saved[1];el.scrollLeft=keepRightEdge&&el.dataset.scroll==="trend"?el.scrollWidth-keepRightEdge:saved[0];
  }
  keepRightEdge=null;
  adaptTrend();
  if(target) {
    const el=restoreTarget(target);
    if(el&&el!==document.activeElement){el.focus({preventScroll:true});if(caret!=null&&el.setSelectionRange)try{el.setSelectionRange(caret,caret);}catch{}}
  }
  window.scrollTo(0,y);
  if(renderedSelection!==view.selectedKey){renderedSelection=view.selectedKey;centerSelectedBar();}
  if(scrollTarget){const [selector,block="nearest"]=[].concat(scrollTarget),el=root.querySelector(selector);scrollTarget=null;el?.scrollIntoView({block});}
  if(jumpToMatch) {
    const body=document.getElementById("content"),mark=body?.querySelector("mark.current");
    if(mark){jumpToMatch=false;body.scrollTop=mark.offsetTop-body.clientHeight/3;}
  }
}
function adaptTrend() {
  const card=root.querySelector(".trend-card"),scroller=card?.querySelector(".trend-scroll");
  if(!scroller||!view.trendAdaptive)return;
  let pending=null;
  layoutTrend(card,{visibleOnly:true});
  scroller.addEventListener("scroll",()=>{pending??=setTimeout(()=>{pending=null;layoutTrend(card,{visibleOnly:true});},40);},{passive:true});
}
function centerSelectedBar() {
  const scroller=document.getElementById("trend-scroll"),bar=scroller?.querySelector(".bar.selected");
  if(scroller&&bar)scroller.scrollLeft=Math.max(0,bar.offsetLeft-scroller.clientWidth/2+bar.offsetWidth/2);
}
const resume=()=>{if(pendingRender&&!interacting())render();};
document.addEventListener("selectionchange",resume);
document.addEventListener("focusout",()=>setTimeout(resume,0));

async function call(name,args) {
  if(demo)return demoCall(name,args);
  const result=await app.callServerTool({name,arguments:args});
  if(result.isError)throw Object.assign(new Error("Read failed"),{code:result.structuredContent?.error?.code});
  return result.structuredContent;
}
function startLoad() {
  if(activeLoads++===0)slowTimer=setTimeout(()=>{notice=notice??{kind:"slow"};render(true);},4000);
}
function endLoad() {
  if(--activeLoads>0)return;
  clearTimeout(slowTimer);
  if(notice?.kind==="slow"){notice=null;render(true);}
}
function showError(error) {
  const code=error?.code??"read_failed";
  if(code==="binding_unavailable"){generation++;overview=null;items=[];boundSession=null;detail=null;content=null;more={};moreSequence={};view=initialView();}
  notice={kind:"error",code};render();
}
function flash(code,background=false) {
  notice={kind:"info",code};render(background);
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{if(notice?.kind==="info"){notice=null;render(true);}},1600);
}

async function refresh(force=false) {
  if(busy)return;
  busy=true;document.getElementById("refresh")?.classList.add("spinning");
  const expected=generation;
  try {
    const next=await call("get_context_summary",!force&&overview?.revision?{revision:overview.revision}:{});
    if(expected!==generation)return;
    const fresh=next.sessionId!==boundSession;
    if(fresh){generation++;boundSession=next.sessionId;view=restoreView(boundSession);items=[];detail=null;content=null;more={};moreSequence={};historyPage=0;overview=null;eventDetails.clear();}
    if(next.unchanged){idlePolls++;if(notice?.kind==="error"){notice=null;render(true);}return;}
    idlePolls=0;overview=next;
    // What a compaction summarized depends on the active branch, so a rewind (or a forced refresh) rereads it.
    const nextBranch=next.conversation?.branch??null;
    if(force||nextBranch!==branch){branch=nextBranch;branchEpoch++;eventDetails.clear();}
    // Call counts are session-wide, so a pinned step's schema counts and call sort follow them.
    const calls=JSON.stringify(next.toolCalls??null),callsChanged=calls!==toolCallsDigest;toolCallsDigest=calls;
    items=mergeSnapshots(items.filter(x=>!next.history?.loadedKeys||next.history.loadedKeys.includes(x.key)),next.trajectories);
    hasOlder=historyPage<4&&(next.history?.loadedCount??items.length)>items.length;
    const previous=view.selectedKey,loaded=next.history?.loadedKeys;
    const expired=Boolean(previous&&loaded&&!loaded.includes(previous));
    // Following moves to the newest agent request, except while an element is open for reading.
    if(!previous||expired||(view.follow&&!view.open))view.selectedKey=latestKey();
    if(!previous||expired){view.follow=true;view.open=null;view.focus=null;view.eventKey=null;}
    const changed=previous!==view.selectedKey;
    if(changed){detail=null;content=null;more={};moreSequence={};view.baselineKey=null;view.focus=null;}
    if(notice?.kind==="error")notice=null;
    if(expired&&!fresh)flash("expiredMoved",!force);
    persist();render(!fresh&&!force);
    const opened=view.eventOpen&&next.events?.find(e=>eventId(e)===view.eventOpen);
    if(opened?.kind==="compaction"&&opened.evidence==="recorded"&&!eventDetails.has(view.eventOpen))loadEventDetail(view.eventOpen,!fresh&&!force);
    if(fresh||changed||!detail||force)await loadDetail(!fresh&&!force);
    else if(callsChanged)await loadDetail(true,true);
    if(view.open&&(fresh||force||!content))await loadContent();
    if(fresh)window.scrollTo(0,view.scroll??0);
  }catch(error){if(expected===generation)showError(error);}
  finally{busy=false;document.getElementById("refresh")?.classList.remove("spinning");}
}
async function loadDetail(background=false,keepMore=false) {
  const key=view.selectedKey;if(!key)return;
  const sequence=++detailSequence,expected=generation,L=lens(view);
  // Call counts reorder and relabel schemas, so schema pages already shown are reread with the first page: kept as they
  // were, an item moved off the first page would be on no page at all.
  const schemaPages=keepMore?more.schema?.page??0:0;
  if(schemaPages)moreSequence.schema={};
  startLoad();
  try {
    const focusKey=view.open?.key===key?view.open.elementKey:view.focus?.stepKey===key?view.focus.summary??undefined:undefined;
    const args={key,search:L.search,toolPrefix:L.toolPrefix||undefined,sort:view.sort,schemaSort:view.schemaSort,...baselineArgs()};
    const [next,...pages]=await Promise.all([call("get_context_request",{...args,searchScope:L.searchAll?"loaded":"selected",focusKey}),
      ...Array.from({length:schemaPages},(_,i)=>call("get_context_request",{...args,searchScope:"selected",role:"schema",page:i+1}))]);
    if(sequence!==detailSequence||expected!==generation||key!==view.selectedKey||next.sessionId!==boundSession)return;
    detail=next;
    if(!keepMore){more={};moreSequence={};}
    else if(schemaPages)more={...more,schema:{page:schemaPages,items:pages.flatMap(x=>x.elements)}};
    if(!items.some(x=>x.key===key))items=mergeSnapshots(items,[next.summary]);
    const openSummary=settleFocus(key,next);
    // The page is short while a step loads, so the target is revealed again once its content is in.
    if(reveal?.key===key){scrollTarget=reveal.target;reveal=null;}
    if(view.expanded===null) {
      const roles=next.composition.buckets.map(b=>b.role),largest=[...next.composition.buckets].sort((a,b)=>b.estimatedTokens-a.estimatedTokens)[0]?.role;
      view.expanded=roles.includes("tool")?["tool"]:largest?[largest]:[];
    }
    if(notice?.kind==="error")notice=null;
    persist();render(background);
    if(openSummary){content=null;loadContent();}
  }catch(error){if(sequence===detailSequence&&expected===generation)showError(error);}
  finally{endLoad();}
}
// A focus settles its set once its step has loaded: Changes when there are changes under its narrowing, otherwise All
// with the reason. After a compaction that cannot be compared it opens the summary the request starts from.
function settleFocus(key,next) {
  const f=view.focus;
  if(!f?.probe||f.stepKey!==key)return false;
  const li=next.listing,changed=li.added+(li.removed??0)>0;
  let focus={...f,probe:false},openSummary=false;
  if(f.baselineKey&&!next.diff.available)focus={...focus,mode:"all",note:{reason:next.diff.reason}};
  else if(f.baselineKey&&!changed)focus={...focus,mode:"all",note:{same:true}};
  else if(f.baselineKey)focus={...focus,mode:"changes",expanded:f.expanded??ORDER.filter(r=>li.roles[r]?.added||li.roles[r]?.removed)};
  if(focus.mode==="all"&&f.summary&&next.groups?.user?.items.some(x=>x.key===f.summary)) {
    view.open=openPointer(key,{key:f.summary,role:"user"});focus.expanded=[...new Set([...(focus.expanded??[]),"user"])];
    reveal={key,target:[rowSelector(key,f.summary),"center"]};openSummary=true;
  }
  view={...view,focus};
  return openSummary;
}
async function loadContent() {
  const pointer=view.open;if(!pointer)return;
  const sequence=++contentSequence,expected=generation;
  startLoad();
  try {
    const args={key:pointer.key,elementKey:pointer.elementKey,offset:pointer.offset??0,format:pointer.format==="raw"?"raw":"readable",bodySearch:pointer.search??""};
    if(pointer.diff&&pointer.diffBefore){args.diffBeforeElement=pointer.diffBefore;Object.assign(args,baselineArgs());}
    const next=await call("get_context_request",args);
    if(sequence!==contentSequence||expected!==generation||view.open?.elementKey!==pointer.elementKey||view.open?.key!==pointer.key||next.sessionId!==boundSession)return;
    content=next;render();
  }catch(error) {
    if(sequence!==contentSequence||expected!==generation)return;
    if(["element_missing","request_expired","diff_identity_unavailable"].includes(error.code)){view.open=null;content=null;persist();}
    showError(error);
  }finally{endLoad();}
}
async function loadMore(role) {
  const key=view.selectedKey,sequence=moreSequence[role]={},expected=generation,page=(more[role]?.page??0)+1,L=lens(view);
  try {
    const next=await call("get_context_request",{key,role,page,search:L.search,toolPrefix:L.toolPrefix||undefined,searchScope:"selected",sort:view.sort,schemaSort:view.schemaSort,...baselineArgs()});
    if(sequence!==moreSequence[role]||expected!==generation||key!==view.selectedKey)return;
    more={...more,[role]:{page,items:[...(more[role]?.items??[]),...next.elements]}};render();
  }catch(error){if(expected===generation)showError(error);}
}
async function loadEventDetail(id,background=false) {
  const expected=generation,epoch=branchEpoch,stale=()=>expected!==generation||epoch!==branchEpoch;
  eventDetails.set(id,{state:"loading"});render(background);
  try {
    const next=await call("get_context_summary",{eventDetail:id});
    if(stale())return;
    eventDetails.set(id,next.eventDetail?{state:"ready",data:next.eventDetail}:{state:"failed"});
  }catch(error){if(stale())return;eventDetails.set(id,{state:"failed",code:error?.code});}
  render(background);
}
// One page at a time: a second click or an event's history load joins the read in flight, and the cursor follows
// the page the service answered, so no page is skipped.
let olderLoad=null;
function loadOlder() {
  if(olderLoad?.generation===generation)return olderLoad.promise;
  if(!hasOlder)return Promise.resolve();
  const expected=generation,page=historyPage+1;
  const promise=(async()=>{
    try {
      const next=await call("get_context_summary",{historyPage:page});
      if(expected!==generation||next.sessionId!==boundSession)return;
      historyPage=Math.max(historyPage,next.history?.page??page);items=mergeSnapshots(items,next.trajectories);hasOlder=historyPage<4&&Boolean(next.history?.hasOlder);
      const scroller=document.getElementById("trend-scroll");
      if(scroller)keepRightEdge=scroller.scrollWidth-scroller.scrollLeft;
      render();
    }catch(error){if(expected===generation)showError(error);}
    finally{if(olderLoad?.promise===promise)olderLoad=null;}
  })();
  olderLoad={generation:expected,promise};
  return promise;
}
async function copy(text) {
  try{await navigator.clipboard.writeText(text);flash("copied");}catch{flash("copyFailed");}
}
// "Previous turn" is resolved by the service over its whole cache, not only the steps this panel has loaded.
function baselineArgs() {
  const L=lens(view);
  if(L.baselineKey)return {baselineKey:L.baselineKey};
  return L.baselineMode==="turn"?{baselineMode:"turn"}:{};
}
function jumpMatch(direction) {
  const hits=content?.content?.hits??[];if(!hits.length)return;
  const current=view.open.matchIndex??-1,index=current<0&&direction<0?hits.length-1:(current+direction+hits.length)%hits.length;
  const offset=Math.floor(hits[index]/CHUNK)*CHUNK;
  jumpToMatch=true;updateOpen({matchIndex:index,offset});
  if(offset!==content.content.offset)loadContent();else render();
}
// Left/right arrows move between agent steps unless a field has focus.
function stepBy(direction) {
  const agents=items.filter(isAgent),selected=items.find(x=>x.key===view.selectedKey),index=agents.findIndex(x=>x.key===view.selectedKey);
  const target=index>=0?agents[index+direction]:selected?(direction<0?agents.findLast(x=>x.startedAt<selected.startedAt):agents.find(x=>x.startedAt>selected.startedAt)):null;
  if(target)actions.select(target.key);
}
document.addEventListener("keydown",e=>{
  if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||view.page!=="context")return;
  if(e.target?.closest?.("input,textarea,select,[contenteditable],#content"))return;
  if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();stepBy(e.key==="ArrowLeft"?-1:1);}
});
const updateOpen=patch=>{view={...view,open:{...view.open,...patch}};persist();};
const openPointer=(snapshotKey,item)=>({key:snapshotKey,elementKey:item.key,role:item.role,format:"readable",offset:0,search:"",matchIndex:-1,diff:false,diffBefore:null});
const rowSelector=(snapshotKey,elementKey)=>`.el[data-element="${elementKey}"][data-snapshot="${snapshotKey}"]`;
// Plain navigation to an event's step changes only the step, optionally opening one item; the server keeps an opened
// item listed even when the current filter or set would hide it.
function goStep(key,{eventKey=null,element=null,scroll=["#browser","start"]}={}) {
  if(!key)return;
  ++contentSequence;++navigation;
  view={...view,selectedKey:key,follow:false,open:element?openPointer(key,element):null,baselineKey:null,focus:null,eventKey};
  if(element)setExpanded([...new Set([...expandedRoles(view,detail),element.role])]);
  detail=null;content=null;more={};moreSequence={};if(notice?.kind==="error")notice=null;
  const target=element?[rowSelector(key,element.key),"center"]:scroll;
  scrollTarget=target;reveal={key,target};persist();render();loadDetail();if(element)loadContent();
}
// An event focus shows what one event is about with its own baseline and narrowing. It pauses the user's filter
// rather than replacing it, ends on leaving its step, and is never saved.
function enterFocus(key,focus) {
  if(!key)return;
  ++contentSequence;++navigation;
  view={...view,selectedKey:key,follow:false,open:null,eventKey:focus.eventKey,focus:{probe:true,expanded:null,note:null,...focus,stepKey:key}};
  detail=null;content=null;more={};moreSequence={};if(notice?.kind==="error")notice=null;
  scrollTarget=["#browser","start"];reveal={key,target:scrollTarget};persist();render();loadDetail();
}
// Expanded categories belong to whatever the browser is showing: the focus, a filtered list, or the plain list.
function setExpanded(roles) {
  view=view.focus?{...view,focus:{...view.focus,expanded:roles}}:{...view,[view.search?"searchExpanded":"expanded"]:roles};
}
// Changing the baseline or the filter is the user's own choice, so it ends any focus first.
const leaveFocus=()=>view.focus?{focus:null,eventKey:null}:{};
const MCP={kind:"tools",toolPrefix:"mcp__",expanded:["schema"]};
const actions={
  select(key) {
    if(!key)return;
    ++contentSequence;++navigation;
    view={...view,selectedKey:key,follow:key===latestKey(),open:null,baselineKey:null,focus:null,eventKey:null};
    detail=null;content=null;more={};moreSequence={};if(notice?.kind==="error")notice=null;
    persist();render();loadDetail();
  },
  latest(){actions.select(latestKey());},
  // An event opens what it is about. Observed additions open their item; model switches show the request summary;
  // compactions and rewinds compare the step after with the step before; MCP registrations show the MCP tool schemas
  // of the step after. Events older than the loaded steps first load earlier history, and one that still has no step
  // after it says so instead of borrowing another step.
  async focusEvent(event) {
    const token=++navigation,expected=generation,stale=()=>token!==navigation||expected!==generation;
    const locate=()=>anchors(items,event,olderUnloaded({hasOlder,items,overview}));
    let target=locate();
    for(let i=0;target.earlier&&hasOlder&&i<5;i++){await loadOlder();if(stale())return;target=locate();}
    const id=eventId(event),{before,after}=target;
    if(target.unlocated||event.kind==="tools"&&!after){actions.eventToggle(event,true);return;}
    if(!after){flash(target.earlier?"eventUnreachable":"eventNoAfter");return;}
    const baseline=before&&before.key!==after.key?before.key:null;
    if(event.kind==="tools"){enterFocus(after.key,{...MCP,eventKey:id,baselineKey:baseline,mode:baseline?"changes":"all",toolCount:event.toolCount??null});return;}
    if(event.stepKey){goStep(after.key,{eventKey:id,element:event.elementKey?{key:event.elementKey,role:event.elementRole??"user"}:null});return;}
    if(!BOUNDARY.has(event.kind)){goStep(after.key,{eventKey:id,scroll:["#summary","start"]});return;}
    const summary=event.kind==="compaction"&&event.navigation?.summaryStepKey===after.key?event.navigation.summaryKey:null;
    if(!baseline&&!summary){goStep(after.key,{eventKey:id,scroll:["#browser","start"]});return;}
    // Without a step before it a compaction cannot be compared; the focus says so and opens the summary it continues from.
    enterFocus(after.key,{eventKey:id,kind:event.kind,baselineKey:baseline,mode:baseline?"changes":"all",summary,note:baseline?null:{reason:"no_previous_snapshot"}});
  },
  // The explicit fallback for an MCP registration without a step after it: the latest step, labelled as such.
  toolsAtLatest(event){enterFocus(latestKey(),{...MCP,eventKey:eventId(event),baselineKey:null,mode:"all",note:{latest:true},probe:false,toolCount:event.toolCount??null});},
  exitFocus() {
    if(!view.focus)return;
    ++navigation;
    view={...view,...leaveFocus()};detail=null;more={};moreSequence={};
    persist();render();loadDetail();
  },
  // Opens an event's own body in the list: an injection's text, or the messages a compaction summarized.
  eventToggle(event,open) {
    const id=eventId(event),next=open??view.eventOpen!==id;
    view={...view,eventOpen:next?id:null};persist();render();
    if(next&&event.kind==="compaction"&&event.evidence==="recorded"&&eventDetails.get(id)?.state!=="ready")loadEventDetail(id);
  },
  eventKind(kind,kinds) {
    const current=view.eventKinds?.filter(k=>kinds.includes(k))??[];
    const next=current.includes(kind)?current.filter(k=>k!==kind):[...current,kind];
    view={...view,eventKinds:next.length&&next.length<kinds.length?next:null};persist();render();
  },
  refresh(force=true){refresh(force);},
  dismissRetention(){try{localStorage.setItem(RETENTION_KEY,"1");}catch{}retentionDismissed=true;render();},
  page(page){view={...view,page};persist();render();window.scrollTo(0,0);},
  set(patch){view={...view,...patch};persist();render();},
  remember(patch){view={...view,...patch};persist();},
  // All / Changes only regroups what is already loaded; inside a focus it switches the focus's own set.
  mode(mode){view=view.focus?{...view,focus:{...view.focus,mode}}:{...view,mode};persist();render();},
  sort(sort){view={...view,sort};persist();render();loadDetail();},
  schemaSort(schemaSort){view={...view,schemaSort};persist();render();loadDetail();},
  baselineMode(mode) {
    ++navigation;
    view={...view,...leaveFocus(),baselineMode:mode,baselineKey:null,open:view.open?.diff?{...view.open,diff:false,diffBefore:null,offset:0}:view.open};
    persist();render();loadDetail();if(view.open)loadContent();
  },
  baseline(key) {
    ++navigation;
    view={...view,...leaveFocus(),baselineKey:key,open:view.open?.diff?{...view.open,diff:false,diffBefore:null,offset:0}:view.open};
    persist();render();loadDetail();if(view.open)loadContent();
  },
  search(value,now=false) {
    ++navigation;
    const left=Boolean(view.focus);
    view={...view,...leaveFocus(),search:value,searchExpanded:null};persist();
    if(left)detail=null;
    if(left||now)render();
    clearTimeout(searchTimer);
    if(now)loadDetail();else searchTimer=setTimeout(()=>loadDetail(),200);
  },
  searchAll(on){++navigation;view={...view,searchAll:on};persist();render();loadDetail();},
  toggleRole(role) {
    const current=expandedRoles(view,detail);
    setExpanded(current.includes(role)?current.filter(x=>x!==role):[...current,role]);persist();render();
  },
  // A category's +N / −N lists exactly those items: its changes under the current narrowing.
  showChanges(role) {
    setExpanded([...new Set([...expandedRoles(view,detail),role])]);
    view=view.focus?{...view,focus:{...view.focus,mode:"changes"}}:{...view,mode:"changes"};
    scrollTarget=`.category[data-role="${role}"]`;persist();render();
  },
  // A legend entry goes to its category; the set and the filter stay as they are.
  focusRole(role) {
    setExpanded([...new Set([...expandedRoles(view,detail),role])]);
    scrollTarget=`.category[data-role="${role}"]`;persist();render();
  },
  // Opens one item where it is; the reload sends it as focusKey, so it is listed even if filtered out or beyond the first page.
  reveal(item) {
    const key=view.selectedKey;if(!key)return;
    ++contentSequence;++navigation;content=null;
    setExpanded([...new Set([...expandedRoles(view,detail),item.role])]);
    view={...view,open:openPointer(key,item)};
    scrollTarget=[rowSelector(key,item.key),"center"];reveal={key,target:scrollTarget};persist();render();loadDetail();loadContent();
  },
  open(item,snapshotKey=view.selectedKey,scroll=false) {
    ++contentSequence;++navigation;content=null;
    if(view.open?.elementKey===item.key&&view.open?.key===snapshotKey) {
      view={...view,open:null};persist();
      if(view.follow&&view.selectedKey!==latestKey()){actions.select(latestKey());return;}
      render();return;
    }
    view={...view,open:{key:snapshotKey,elementKey:item.key,role:item.role,format:"readable",offset:0,search:"",matchIndex:-1,diff:false,diffBefore:null}};
    persist();if(scroll)scrollTarget=`.el[data-element="${item.key}"][data-snapshot="${snapshotKey}"]`;render();loadContent();
  },
  more:role=>loadMore(role),
  older:()=>loadOlder(),
  copy:text=>copy(text),
  format(format){updateOpen({format,offset:0,diff:false,diffBefore:null,matchIndex:-1});render();loadContent();},
  chunk(offset){updateOpen({offset});loadContent();},
  bodySearch(value) {
    updateOpen({search:value,matchIndex:-1});
    if(!value)render();
    clearTimeout(bodyTimer);bodyTimer=setTimeout(loadContent,200);
  },
  nextMatch(){jumpMatch(1);},
  prevMatch(){jumpMatch(-1);},
  toggleDiff(before) {
    updateOpen(view.open.diff?{diff:false,diffBefore:null,offset:0}:{diff:true,diffBefore:before,offset:0});
    render();loadContent();
  }
};
window.addEventListener("scroll",()=>{view.scroll=window.scrollY;clearTimeout(scrollTimer);scrollTimer=setTimeout(persist,250);},{passive:true});
// Polling slows down while nothing changes and returns to full speed as soon as the panel is looked at again.
const pollDelay=()=>idlePolls>=20?10000:idlePolls>=10?6000:3000;
function schedule() {
  clearTimeout(timer);
  if(!stopped&&!document.hidden)timer=setTimeout(async()=>{try{await refresh();}finally{schedule();}},pollDelay());
}
function wake() {
  if(stopped||pollDelay()===3000||document.hidden)return;
  idlePolls=0;refresh().finally(schedule);
}
document.addEventListener("visibilitychange",()=>{clearTimeout(timer);if(!stopped&&!document.hidden){idlePolls=0;refresh().finally(schedule);}});
document.documentElement.addEventListener("pointerenter",wake);
window.addEventListener("focus",wake);
render();
if(!demo) {
  app=new App(INFO,{availableDisplayModes:["fullscreen"]});
  const applyHostContext=()=>{
    const context=app.getHostContext();t=translator(context?.locale??"zh-CN");
    document.documentElement.lang=context?.locale??"zh-CN";document.documentElement.dataset.theme=context?.theme??"light";
    for(const [key,value] of Object.entries(context?.styles?.variables??{}))if(key.startsWith("--")&&typeof value==="string")document.documentElement.style.setProperty(key,value);
    render();
  };
  app.onhostcontextchanged=applyHostContext;
  app.onteardown=async()=>{stopped=true;persist();clearTimeout(timer);clearTimeout(searchTimer);clearTimeout(bodyTimer);};
  // Without a connection no read can succeed and retrying cannot reconnect, so polling stops and the panel says to reopen it.
  try{await app.connect();applyHostContext();await refresh();}catch{stopped=true;showError({code:"connect_failed"});}
}else await refresh();
schedule();
