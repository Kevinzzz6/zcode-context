import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
async function walk(url) {
  for(const entry of await readdir(url,{withFileTypes:true})) {
    const child=new URL(entry.name+(entry.isDirectory()?"/":""),url);
    if(entry.isDirectory())await walk(child);
    else if(entry.name.endsWith(".mjs")) {
      const result=spawnSync(process.execPath,["--check",fileURLToPath(child)],{stdio:"inherit"});
      if(result.status!==0)process.exit(result.status??1);
    }
  }
}
const root=new URL("../",import.meta.url);
for(const directory of ["src/","ui/","scripts/","test/"])await walk(new URL(directory,root));
const pkg=JSON.parse(await readFile(new URL("package.json",root),"utf8"));
const manifest=JSON.parse(await readFile(new URL(".zcode-plugin/plugin.json",root),"utf8"));
if(pkg.name!==manifest.name||pkg.version!==manifest.version)throw new Error("Package and plugin identities differ.");
const lock=JSON.parse(await readFile(new URL("package-lock.json",root),"utf8"));
if(lock.version!==pkg.version||lock.packages?.[""]?.version!==pkg.version)throw new Error("package-lock.json version differs from package.json; run npm install.");
// The MCP server and the app announce their version to the host; it must be the released one.
for(const file of ["src/server.mjs","ui/app.mjs"]) {
  const announced=[...(await readFile(new URL(file,root),"utf8")).matchAll(/name:"zcode-context",version:"([^"]+)"/g)].map(x=>x[1]);
  if(announced.length!==1||announced[0]!==pkg.version)throw new Error(file+" announces version "+(announced.join(", ")||"none")+", expected "+pkg.version+".");
}
if(JSON.stringify(manifest.mcpServers).includes("ZCODE_SESSION_ID"))throw new Error("Session variables cannot appear in the MCP manifest.");
console.log("Syntax and manifest checks passed.");
