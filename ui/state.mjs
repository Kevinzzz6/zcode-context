export function initialView() {
  return {selectedKey:null,follow:true,tab:"composition",layout:"diagnostic",trend:"total",trendPage:0,
    search:"",searchScope:"selected",sort:"size",expanded:[],page:0,changePage:0,baselineKey:null,detail:null,scroll:0,usage:false,infoOpen:false,trendOpen:false};
}
export function restoreView(sessionId) {
  try {
    const saved=JSON.parse(localStorage.getItem("zcode-context:view:v2:"+sessionId));
    if(!saved||typeof saved!=="object")return initialView();
    const view={...initialView(),...saved};
    if(!["composition","changes","events"].includes(view.tab))view.tab="composition";
    if(!Array.isArray(view.expanded))view.expanded=[];
    return view;
  }catch{return initialView();}
}
export function saveView(sessionId,view) {
  if(!sessionId)return;
  try{localStorage.setItem("zcode-context:view:v2:"+sessionId,JSON.stringify(view));}catch{/* Sandboxed storage is optional. */}
}
export function mergeSnapshots(oldItems,newItems) {
  return [...new Map([...oldItems,...newItems].map(x=>[x.key,x])).values()]
    .sort((a,b)=>a.startedAt-b.startedAt).slice(-240);
}
