import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root=new URL("../",import.meta.url);const path=relative=>new URL(relative,root);
await rm(path("dist"),{recursive:true,force:true});await mkdir(path("dist"),{recursive:true});
const nodeBuild=await build({metafile:true,entryPoints:[fileURLToPath(path("src/server.mjs")),fileURLToPath(path("src/worker.mjs"))],bundle:true,platform:"node",target:"node24",format:"esm",outdir:fileURLToPath(path("dist")),outExtension:{".js":".mjs"},packages:"bundle",external:["node:*"],banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},sourcemap:false});
const result=await build({metafile:true,entryPoints:[fileURLToPath(path("ui/app.mjs"))],bundle:true,platform:"browser",target:"es2022",format:"esm",write:false,minify:true});
await mkdir(path("dist/test"),{recursive:true});
await build({entryPoints:[fileURLToPath(path("ui/test-host.mjs"))],bundle:true,platform:"browser",target:"es2022",format:"esm",outfile:fileURLToPath(path("dist/test/host.js")),minify:true});
const html=await readFile(path("ui/index.html"),"utf8");const css=await readFile(path("ui/styles.css"),"utf8");
const page=html.replace("<!--STYLE-->",()=>"<style>"+css+"</style>").replace("<!--SCRIPT-->",()=>"<script type='module'>"+result.outputFiles[0].text.replaceAll("</script","<\\/script")+"</script>");
if(page.includes("<!--SCRIPT-->")||page.includes("<!--STYLE-->"))throw new Error("HTML template markers remain in the built page.");
await writeFile(path("dist/context.html"),page);
const packages=new Map();
for(const input of [...Object.keys(nodeBuild.metafile.inputs),...Object.keys(result.metafile.inputs)]) {
  if(!input.includes("node_modules/"))continue;
  let directory=dirname(resolve(input));
  while(directory!==dirname(directory)) {
    try {
      const metadata=JSON.parse(await readFile(directory+"/package.json","utf8"));
      if(metadata.name&&metadata.version){packages.set(directory,metadata);break;}
    }catch{}
    directory=dirname(directory);
  }
}
let notices="ZCode Context — bundled dependency notices\n\n";
for(const [directory,metadata] of [...packages.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name))) {
  let license="";
  for(const name of ["LICENSE","LICENSE.md","LICENSE.txt","LICENSE-MIT","license","license.md"]) {
    try{license=await readFile(directory+"/"+name,"utf8");break;}catch{}
  }
  if(!license)throw new Error("Missing bundled dependency license: "+metadata.name);
  notices+="===== "+metadata.name+" "+metadata.version+" =====\n"+license+"\n\n";
  try{notices+=await readFile(directory+"/NOTICE","utf8");notices+="\n\n";}catch{}
}
await writeFile(path("dist/THIRD_PARTY_NOTICES.txt"),notices);
const plugin=path("plugins/zcode-context/");
await rm(plugin,{recursive:true,force:true});await mkdir(plugin,{recursive:true});
await cp(path(".zcode-plugin"),new URL(".zcode-plugin/",plugin),{recursive:true});
await mkdir(new URL("dist/",plugin),{recursive:true});
for(const file of ["server.mjs","worker.mjs","context.html"])await cp(path("dist/"+file),new URL("dist/"+file,plugin));
await cp(path("dist/THIRD_PARTY_NOTICES.txt"),new URL("THIRD_PARTY_NOTICES.txt",plugin));
for(const file of ["README.md","README.en.md","CHANGELOG.md","LICENSE","NOTICE"])await cp(path(file),new URL(file,plugin));
await cp(path("docs"),new URL("docs/",plugin),{recursive:true});
const manifest=JSON.parse(await readFile(path(".zcode-plugin/plugin.json"),"utf8"));
await writeFile(path("marketplace.json"),JSON.stringify({name:"zcode-context-marketplace",description:"Distribution marketplace for the zcode-context plugin.",owner:{name:manifest.author.name},plugins:[{name:manifest.name,version:manifest.version,source:"./plugins/zcode-context",description:manifest.description,description_i18n:manifest.description_i18n,category:"developer-tools",keywords:["context","tokens","usage","mcp"]}]},null,2)+"\n");
console.log("Built plugins/zcode-context and the root marketplace.json. The repository itself is now a ZCode plugin marketplace: add it by GitHub repo (Kevinzzz6/zcode-context), by the repo root path, or via a release zip.");
