import { ContextError } from "../domain/session.mjs";
// Worker side: reads run one at a time. A read the caller gave up on while it was still waiting is skipped, so a
// slow read followed by timeouts does not leave a backlog of stale work in front of fresh requests.
// Only ContextError codes reach the panel; anything else is a defect or an unexpected data shape, logged to stderr
// (not the stdio protocol channel) and reported as read_failed.
export function serialRunner(run, reply, log = (...args) => console.error(...args)) {
  let queue = Promise.resolve();
  const waiting = new Set(), cancelled = new Set();
  return input => {
    if (input?.cancel !== undefined) {
      if (waiting.delete(input.cancel)) { cancelled.add(input.cancel); reply({ id: input.cancel, skipped: true }); }
      return;
    }
    waiting.add(input.id);
    queue = queue.then(async () => {
      if (cancelled.delete(input.id)) return;
      waiting.delete(input.id);
      try { reply({ id: input.id, result: await run(input) }); }
      catch (error) {
        const known = error instanceof ContextError;
        if (!known) log("[zcode-context]", input.method, error);
        reply({ id: input.id, error: { code: known ? error.code : "read_failed", message: "Context data could not be read." } });
      }
    });
  };
}
