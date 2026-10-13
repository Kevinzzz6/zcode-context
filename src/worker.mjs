import { parentPort, workerData } from "node:worker_threads";
import { ContextDataService } from "./data/service.mjs";
const service = new ContextDataService(workerData.paths);
let queue = Promise.resolve();
parentPort.on("message", input => {
  queue = queue.then(async () => {
    try {
      const result = input.method === "overview" ? await service.overview(input.sessionId, input.args.revision,input.args.historyPage) : await service.request(input.sessionId, input.args);
      parentPort.postMessage({ id: input.id, result });
    } catch (error) { parentPort.postMessage({ id: input.id, error: { code: error.code ?? "read_failed", message: "Context data could not be read." } }); }
  });
});
