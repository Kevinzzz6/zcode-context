import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
const bridges=[];
for(const sessionId of ["sess_A","sess_B"]) {
  const frame=document.getElementById(sessionId);
  const context={theme:"light",locale:"zh-CN",displayMode:"fullscreen",containerDimensions:{width:520,maxHeight:1200},platform:"desktop"};
  const bridge=new AppBridge(null,{name:"context-fixture",version:"0.1.1"},{serverTools:{},serverResources:{},logging:{}},{hostContext:context});
  bridge.oncalltool=async params=>{
    const response=await fetch("/call?session="+sessionId,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(params)});
    if(!response.ok)throw new Error("Fixture call failed");
    return response.json();
  };
  frame.src="/panel";
  await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
  bridges.push({bridge,context});
}
document.getElementById("dark").onclick=()=>{for(const entry of bridges){entry.context={...entry.context,theme:entry.context.theme==="dark"?"light":"dark"};entry.bridge.setHostContext(entry.context);}};
document.getElementById("english").onclick=()=>{for(const entry of bridges){entry.context={...entry.context,locale:"en-US"};entry.bridge.setHostContext(entry.context);}};
