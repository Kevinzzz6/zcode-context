const PREFIX="zcode-context:view:v3:";
export function initialView() {
  return {selectedKey:null,follow:true,page:"context",trend:"total",granularity:"step",trendAdaptive:false,search:"",searchAll:false,sort:"size",mode:"all",
    expanded:null,searchExpanded:null,open:null,baselineKey:null,aboutOpen:false,scroll:0};
}
export function restoreView(sessionId) {
  try {
    const saved=JSON.parse(localStorage.getItem(PREFIX+sessionId));
    if(!saved||typeof saved!=="object")return initialView();
    const view={...initialView(),...saved};
    if(!["context","usage"].includes(view.page))view.page="context";
    if(!["total","delta"].includes(view.trend))view.trend="total";
    if(!["step","turn"].includes(view.granularity))view.granularity="step";
    view.trendAdaptive=view.trendAdaptive===true;
    if(!["all","changes"].includes(view.mode))view.mode="all";
    if(view.expanded!==null&&!Array.isArray(view.expanded))view.expanded=null;
    if(view.searchExpanded!==null&&!Array.isArray(view.searchExpanded))view.searchExpanded=null;
    if(view.open&&(typeof view.open!=="object"||typeof view.open.elementKey!=="string"))view.open=null;
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
