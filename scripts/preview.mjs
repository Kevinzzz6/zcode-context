import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const html=await readFile(new URL("../dist/context.html",import.meta.url));
createServer((req,res)=>{res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(html);}).listen(4173,"127.0.0.1",()=>console.log("Demo only: http://127.0.0.1:4173/?demo=1"));
