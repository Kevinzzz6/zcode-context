const PREFIX="zcode-context:view:v3:";
// Navigation state lives only as long as the panel: an event focus and the event row it highlights are never saved.
const TRANSIENT=["focus","eventKey"];
export function initialView() {
  return {selectedKey:null,follow:true,page:"context",trend:"total",granularity:"step",trendAdaptive:false,search:"",searchAll:false,sort:"size",schemaSort:"size",mode:"all",
    expanded:null,searchExpanded:null,open:null,baselineKey:null,baselineMode:"step",aboutOpen:false,scroll:0,eventKinds:null,eventKey:null,eventsAll:false,eventOpen:null,focus:null};
}
export function restoreView(sessionId) {
  try {
    const saved=JSON.parse(localStorage.getItem(PREFIX+sessionId));
    if(!saved||typeof saved!=="object")return initialView();
    const base=initialView(),view={...base,...saved};
    for(const key of [...TRANSIENT,"eventFocus","eventNote"])delete view[key];
    Object.assign(view,{focus:null,eventKey:null});
    if(!["context","usage","about"].includes(view.page))view.page="context";
    if(!["total","delta"].includes(view.trend))view.trend="total";
    if(!["step","turn"].includes(view.granularity))view.granularity="step";
    view.trendAdaptive=view.trendAdaptive===true;
    if(typeof view.search!=="string")view.search="";
    if(!Number.isFinite(view.scroll))view.scroll=0;
    for(const key of ["selectedKey","baselineKey"])if(view[key]!==null&&typeof view[key]!=="string")view[key]=null;
    for(const key of ["follow","searchAll","aboutOpen"])if(typeof view[key]!=="boolean")view[key]=base[key];
    if(!["all","changes"].includes(view.mode))view.mode="all";
    if(!["size","order"].includes(view.sort))view.sort="size";
    if(!["size","calls","name"].includes(view.schemaSort))view.schemaSort="size";
    if(!["step","turn"].includes(view.baselineMode))view.baselineMode="step";
    if(view.expanded!==null&&!Array.isArray(view.expanded))view.expanded=null;
    if(view.searchExpanded!==null&&!Array.isArray(view.searchExpanded))view.searchExpanded=null;
    if(view.open&&(typeof view.open!=="object"||typeof view.open.elementKey!=="string"))view.open=null;
    if(view.eventKinds!==null&&!(Array.isArray(view.eventKinds)&&view.eventKinds.every(k=>typeof k==="string")))view.eventKinds=null;
    view.eventsAll=view.eventsAll===true;if(typeof view.eventOpen!=="string")view.eventOpen=null;
    return view;
  }catch{return initialView();}
}
export function saveView(sessionId,view) {
  if(!sessionId)return;
  const kept=Object.fromEntries(Object.entries(view).filter(([key])=>!TRANSIENT.includes(key)));
  try{localStorage.setItem(PREFIX+sessionId,JSON.stringify(kept));}catch{/* Sandboxed storage is optional. */}
}
// What the browser applies: the user's own baseline, set and filter, or an event focus that pauses them until it ends.
// A focus fixes its own baseline and narrowing; its set (All / Changes) can still be switched without leaving it.
export function lens(view) {
  const f=view.focus;
  if(f)return {focused:true,mode:f.mode,search:"",toolPrefix:f.toolPrefix??"",baselineKey:f.baselineKey??null,baselineMode:view.baselineMode,searchAll:false};
  return {focused:false,mode:view.mode,search:view.search,toolPrefix:"",baselineKey:view.baselineKey,baselineMode:view.baselineMode,searchAll:view.searchAll&&Boolean(view.search)};
}
export function mergeSnapshots(oldItems,newItems) {
  return [...new Map([...oldItems,...newItems].map(x=>[x.key,x])).values()]
    .sort((a,b)=>a.startedAt-b.startedAt).slice(-240);
}
