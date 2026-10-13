import { ContextError } from "../domain/session.mjs";
// Server side of the data worker. A read that times out or is cancelled asks the worker to skip it if it has not
// started. The busy limit counts reads the worker still holds, including ones whose caller already gave up.
export function createReader(spawn, { timeoutMs = 15000, limit = 8 } = {}) {
  const pending = new Map(), held = new Set();
  let sequence = 0, worker = null;
  function fail() {
    worker = null; held.clear();
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new ContextError("worker_unavailable","Data worker stopped.")); }
    pending.clear();
  }
  function current() {
    if (worker) return worker;
    const next = spawn(); worker = next;
    next.on("message", message => {
      if (worker !== next) return;
      held.delete(message.id);
      const job = pending.get(message.id); if (!job) return;
      pending.delete(message.id); clearTimeout(job.timer);
      message.error ? job.reject(new ContextError(message.error.code,message.error.message))
        : message.skipped ? job.reject(new ContextError("cancelled","Read cancelled.")) : job.resolve(message.result);
    });
    const onFailure = () => { if (worker === next) fail(); };
    next.on("error", onFailure); next.on("exit", onFailure);
    return next;
  }
  function run(method, sessionId, args, signal) {
    return new Promise((resolve,reject) => {
      if (signal?.aborted) { reject(new ContextError("cancelled","Read cancelled.")); return; }
      if (held.size >= limit) { reject(new ContextError("reader_busy","Too many pending reads.")); return; }
      const target = current(), id = ++sequence;
      const drop = (code, message) => {
        const job = pending.get(id); if (!job) return;
        clearTimeout(job.timer); pending.delete(id);
        if (worker === target) target.postMessage({cancel:id});
        job.reject(new ContextError(code,message));
      };
      const abort = () => drop("cancelled","Read cancelled.");
      const settle = callback => value => { signal?.removeEventListener("abort",abort); callback(value); };
      signal?.addEventListener("abort",abort,{once:true});
      pending.set(id,{resolve:settle(resolve),reject:settle(reject),timer:setTimeout(() => drop("read_timeout","Data read timed out."),timeoutMs)});
      held.add(id); target.postMessage({id,method,sessionId,args});
    });
  }
  async function close() { const target = worker; worker = null; held.clear(); await target?.terminate(); }
  return { run, close, get held() { return held.size; } };
}
