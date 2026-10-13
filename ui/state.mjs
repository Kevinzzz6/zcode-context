const PREFIX="zcode-context:view:v3:";
export function initialView() {
  return {selectedKey:null,follow:true,page:"context",trend:"total",granularity:"step",trendAdaptive:false,search:"",searchAll:false,sort:"size",schemaSort:"size",mode:"all",
    expanded:null,searchExpanded:null,open:null,baselineKey:null,baselineMode:"step",aboutOpen:false,scroll:0,eventKinds:null,eventFocus:null,eventNote:null,eventKey:null,eventsAll:false,eventOpen:null};
}
export function restoreView(sessionId) {
  try {
    const saved=JSON.parse(localStorage.getItem(PREFIX+sessionId));
    if(!saved||typeof saved!=="object")return initialView();
    const base=initialView(),view={...base,...saved};
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
    view.eventFocus=null;view.eventsAll=view.eventsAll===true;if(typeof view.eventOpen!=="string")view.eventOpen=null;
    if(view.eventNote&&(typeof view.eventNote!=="object"||typeof view.eventNote.key!=="string"))view.eventNote=null;
    return view;
  }catch{return initialView();}
}
export function saveView(sessionId,view) {
  if(!sessionId)return;
  try{localStorage.setItem(PREFIX+sessionId,JSON.stringify(view));}catch{/* Sandboxed storage is optional. */}
}
export function mergeSnapshots(oldItems,newItems) {
  return [...new Map([...oldItems,...newItems].map(x=>[x.key,x])).values()]
    .sort((a,b)=>a.startedAt-b.startedAt).slice(-240);
}
