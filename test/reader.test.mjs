import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { serialRunner } from "../src/data/runner.mjs";
import { createReader } from "../src/data/reader.mjs";
import { ContextError } from "../src/domain/session.mjs";
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
// Wires a reader to an in-process runner, standing in for the worker thread.
function harness(run,options) {
  const worker=new EventEmitter(),posted=[];
  const handle=serialRunner(run,message=>worker.emit("message",message));
  worker.postMessage=message=>{posted.push(message);queueMicrotask(()=>handle(message));};
  worker.terminate=async()=>{};
  return {worker,posted,reader:createReader(()=>worker,options)};
}
test("a read cancelled while waiting is skipped by the runner, never run late",async()=>{
  const gate=deferred(),ran=[],replies=[];
  const handle=serialRunner(async input=>{ran.push(input.id);if(input.id===1)await gate.promise;return input.id;},message=>replies.push(message));
  handle({id:1});handle({id:2});handle({id:3});handle({cancel:2});
  await tick();gate.resolve();await tick();await tick();
  assert.deepEqual(ran,[1,3]);
  assert.deepEqual(replies,[{id:2,skipped:true},{id:1,result:1},{id:3,result:3}]);
});
test("cancelling a read that already started or finished leaves no stale state behind",async()=>{
  const gate=deferred(),ran=[],replies=[];
  const handle=serialRunner(async input=>{ran.push(input.id);await gate.promise;return input.id;},message=>replies.push(message));
  handle({id:1});await tick();handle({cancel:1});handle({cancel:99});
  gate.resolve();await tick();
  handle({id:99});await tick();
  assert.deepEqual(ran,[1,99]);
  assert.deepEqual(replies.map(x=>x.result),[1,99]);
});
test("runner failures reply with a code but never the original message",async()=>{
  const replies=[],logged=[];
  const handle=serialRunner(async input=>{throw input.id===1?new ContextError("database_busy","secret path"):Object.assign(new Error("secret path"),{code:"ENOENT"});},
    message=>replies.push(message),(...args)=>logged.push(args));
  handle({id:1,method:"overview"});handle({id:2,method:"request"});await tick();await tick();
  assert.deepEqual(replies,[{id:1,error:{code:"database_busy",message:"Context data could not be read."}},
    {id:2,error:{code:"read_failed",message:"Context data could not be read."}}]);
  assert.equal(logged.length,1);assert.equal(logged[0][1],"request");assert.equal(logged[0][2].code,"ENOENT");
});
test("a timed-out read asks the worker to skip it, and the next read is not stuck behind it",async()=>{
  const gate=deferred(),ran=[];
  const {reader,posted}=harness(async input=>{ran.push(input.args.n);if(input.args.n===1)await gate.promise;return input.args.n;},{timeoutMs:20});
  const first=reader.run("overview","sess_A",{n:1}),second=reader.run("overview","sess_A",{n:2});
  await assert.rejects(first,{code:"read_timeout"});await assert.rejects(second,{code:"read_timeout"});
  assert.ok(posted.some(x=>x.cancel===2));
  gate.resolve();
  assert.equal(await reader.run("overview","sess_A",{n:3}),3);
  assert.deepEqual(ran,[1,3]);
  assert.equal(reader.held,0);
});
test("the busy limit counts reads the worker still holds after their callers gave up",async()=>{
  const gate=deferred();
  const {reader}=harness(async()=>{await gate.promise;return "ok";},{timeoutMs:10,limit:2});
  const results=await Promise.allSettled([reader.run("overview","sess_A",{}),reader.run("overview","sess_A",{})]);
  assert.deepEqual(results.map(x=>x.reason?.code),["read_timeout","read_timeout"]);
  await tick();
  // The first read is still running; the second was skipped and released.
  assert.equal(reader.held,1);
  const third=reader.run("overview","sess_A",{}),fourth=reader.run("overview","sess_A",{});
  await assert.rejects(fourth,{code:"reader_busy"});
  gate.resolve();
  assert.equal(await third,"ok");
});
test("an aborted signal cancels before or while waiting and removes its listener",async()=>{
  const gate=deferred();
  const {reader,posted}=harness(async input=>{if(input.args.wait)await gate.promise;return "ok";});
  const early=new AbortController();early.abort();
  await assert.rejects(reader.run("overview","sess_A",{},early.signal),{code:"cancelled"});
  assert.equal(posted.length,0);
  const blocker=reader.run("overview","sess_A",{wait:true}),controller=new AbortController();
  const waiting=reader.run("overview","sess_A",{},controller.signal);
  controller.abort();
  await assert.rejects(waiting,{code:"cancelled"});
  gate.resolve();assert.equal(await blocker,"ok");
  await tick();assert.equal(reader.held,0);
});
test("a stopped worker fails waiting reads and the next read starts a new worker",async()=>{
  const workers=[];
  const reader=createReader(()=>{const w=new EventEmitter();w.postMessage=()=>{};w.terminate=async()=>{};workers.push(w);return w;},{timeoutMs:1000});
  const waiting=reader.run("overview","sess_A",{});
  workers[0].emit("exit",1);
  await assert.rejects(waiting,{code:"worker_unavailable"});
  assert.equal(reader.held,0);
  const next=reader.run("overview","sess_A",{});
  assert.equal(workers.length,2);
  workers[0].emit("message",{id:2,result:"stale"});
  workers[1].emit("message",{id:2,result:"fresh"});
  assert.equal(await next,"fresh");
});
