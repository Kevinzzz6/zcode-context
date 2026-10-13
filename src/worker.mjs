import { parentPort, workerData } from "node:worker_threads";
import { ContextDataService } from "./data/service.mjs";
import { serialRunner } from "./data/runner.mjs";
const service = new ContextDataService(workerData.paths);
parentPort.on("message", serialRunner(
  input => input.method !== "overview" ? service.request(input.sessionId, input.args)
    : input.args.eventDetail ? service.eventDetail(input.sessionId, input.args.eventDetail) : service.overview(input.sessionId, input.args.revision, input.args.historyPage),
  message => parentPort.postMessage(message)));
