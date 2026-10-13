import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const output=new URL("../output/verification/",import.meta.url);await mkdir(output,{recursive:true});
const testFiles=(await readdir(new URL("../test/",import.meta.url))).filter(name=>name.endsWith(".test.mjs")).map(name=>"test/"+name);
const steps=[["syntax",["scripts/check.mjs"]],["unit",["--test",...testFiles]],["build",["scripts/build.mjs"]],["stdio",["scripts/smoke.mjs"]]];
const report={node:process.version,platform:process.platform,startedAt:new Date().toISOString(),steps:[],passed:false};
try{
  for(const[name,args]of steps){
    const started=Date.now();
    try{const logs=execFileSync(process.execPath,args,{encoding:"utf8",maxBuffer:8*1024*1024,stdio:["ignore","pipe","pipe"]});
      await writeFile(new URL(name+".log",output),logs);report.steps.push({name,passed:true,durationMs:Date.now()-started});console.log(name+": passed");
    }catch(error){await writeFile(new URL(name+".log",output),(error.stdout??"")+(error.stderr??""));report.steps.push({name,passed:false});throw error;}
  }
  report.artifacts={};
  for(const name of ["server.mjs","worker.mjs","context.html"]){const bytes=await readFile(new URL("../dist/"+name,import.meta.url));report.artifacts[name]={bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};}
  report.passed=true;
}finally{report.completedAt=new Date().toISOString();await writeFile(new URL("result.json",output),JSON.stringify(report,null,2)+"\n");}
