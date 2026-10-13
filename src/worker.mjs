import { parentPort, workerData } from "node:worker_threads";
import { ContextDataService } from "./data/service.mjs";
import { serialRunner } from "./data/runner.mjs";
const service = new ContextDataService(workerData.paths);
parentPort.on("message", serialRunner(
  input => input.method === "overview" ? service.overview(input.sessionId, input.args.revision, input.args.historyPage) : service.request(input.sessionId, input.args),
  message => parentPort.postMessage(message)));
