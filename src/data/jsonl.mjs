import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
const CHUNK = 128 * 1024;
const COLD_BYTES = 24 * 1024 * 1024;
const SCAN_BYTES = 8 * 1024 * 1024;
const LINE_BYTES = 8 * 1024 * 1024;
const hash = value => createHash("sha256").update(value).digest("hex");
export class JsonlTail {
  offset = 0; pending = Buffer.alloc(0); skipping = false; generation = 0;
  identity = null; headHash = null; headLength = 0; mtime = 0; missing = false; coverage = [];
  constructor(openFile = open) { this.openFile = openFile; }
  markCoverage(reason) { if (!this.coverage.includes(reason)) this.coverage.push(reason); }
  reset(state, size, onReset) {
    this.identity = state; this.offset = Math.max(0, size - COLD_BYTES); this.pending = Buffer.alloc(0);
    this.skipping = this.offset > 0; this.headHash = null; this.headLength = 0; this.generation++;
    this.coverage = this.offset > 0 ? ["history_window"] : []; onReset?.();
  }
  async scan(path, onRow, onReset, onGap) {
    let file;
    try {
      file = await this.openFile(path, "r"); const st = await file.stat(); const identity = st.dev + ":" + st.ino;
      const prefix = Buffer.alloc(this.headLength || Math.min(256, st.size)); await file.read(prefix, 0, prefix.length, 0);
      const changed = this.identity !== identity || st.size < this.offset || this.missing ||
        (this.headHash !== null && hash(prefix) !== this.headHash) ||
        (st.size === this.offset && st.mtimeMs !== this.mtime);
      if (this.identity === null || changed) this.reset(identity, st.size, onReset);
      if (this.headHash === null) {
        this.headLength = Math.min(256, st.size); const head = Buffer.alloc(this.headLength);
        await file.read(head, 0, head.length, 0); this.headHash = hash(head);
      }
      this.missing = false;
      const stop = Math.min(st.size, this.offset + SCAN_BYTES);
      while (this.offset < stop) {
        const buffer = Buffer.alloc(Math.min(CHUNK, stop - this.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, this.offset);
        if (!bytesRead) break;
        let start = 0; const base = this.offset; this.offset += bytesRead;
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] !== 10) continue;
          const piece = buffer.subarray(start, i);
          if (this.skipping) { this.skipping = false; this.pending = Buffer.alloc(0); onGap?.(); }
          else if (this.pending.length + piece.length > LINE_BYTES) {
            this.markCoverage("oversized_line"); this.pending = Buffer.alloc(0); onGap?.();
          } else {
            const line = Buffer.concat([this.pending, piece]).toString("utf8").trim();
            this.pending = Buffer.alloc(0);
            if (line) {
              try { const value = JSON.parse(line); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid row"); onRow(value, base + i); }
              catch { this.markCoverage("malformed_line"); onGap?.(); }
            }
          }
          start = i + 1;
        }
        const rest = buffer.subarray(start, bytesRead);
        if (!this.skipping) {
          if (this.pending.length + rest.length > LINE_BYTES) {
            this.pending = Buffer.alloc(0); this.skipping = true; this.markCoverage("oversized_line"); onGap?.();
          } else this.pending = Buffer.concat([this.pending, rest]);
        }
      }
      this.mtime = st.mtimeMs;
      return { available: true, scanning: this.offset < st.size, pendingLine: this.pending.length > 0,
        generation: this.generation, coverage: [...new Set(this.coverage)] };
    } catch (error) {
      // A missing file may come back as a different one, so it is read again from scratch. A transient system error
      // (a scanner or backup briefly holding the file) keeps the position; anything else is a defect and also restarts.
      if (typeof error.code !== "string") console.error("[zcode-context] trajectory scan", error);
      if (error.code === "ENOENT" || typeof error.code !== "string") this.missing = true;
      return { available: false, code: error.code === "ENOENT" ? "trajectory_missing" : "file_unavailable", scanning: false, coverage: [...new Set(this.coverage)] };
    } finally { await file?.close(); }
  }
}
