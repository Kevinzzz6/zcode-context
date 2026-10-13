import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ContextError } from "../domain/session.mjs";
export function resolveDataPaths(env = process.env) {
  const expand = value => value.startsWith("~/") || value.startsWith("~\\") ? join(homedir(), value.slice(2)) : value;
  const configured = env.ZCODE_CONTEXT_DATA_ROOT?.trim();
  const root = configured ? expand(configured) : join(homedir(), ".zcode", "cli");
  const db = env.ZCODE_CONTEXT_DB_PATH?.trim() ? expand(env.ZCODE_CONTEXT_DB_PATH.trim()) : join(root, "db", "db.sqlite");
  if (!isAbsolute(root) || !isAbsolute(db)) throw new ContextError("invalid_config", "Data directory and database path must be absolute.");
  return { root: resolve(root), db: resolve(db), trajectoryDirs: [join(root, "rollout"), join(root, "debug")], logDir: join(root, "log") };
}
