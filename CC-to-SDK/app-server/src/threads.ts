import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os"; import { join } from "node:path";
import { randomBytes } from "node:crypto";

export function threadsDir(): string { return process.env.CC_APPSERVER_STATE_DIR ?? join(homedir(), ".cc-appserver"); }
interface Rec { sessionId: string; cwd: string; updatedAt: number }
function load(dir: string): Record<string, Rec> { try { return JSON.parse(readFileSync(join(dir, "threads.json"), "utf8")); } catch { return {}; } }

export function recordThread(threadId: string, sessionId: string, cwd: string, dir = threadsDir()): void {
  mkdirSync(dir, { recursive: true });
  const all = load(dir); all[threadId] = { sessionId, cwd, updatedAt: Date.now() };
  const keys = Object.keys(all).sort((a, b) => all[b].updatedAt - all[a].updatedAt).slice(0, 200);
  // Write to a sibling temp file then rename over the real one — rename is atomic on POSIX, so a crash
  // mid-write leaves the previous threads.json intact instead of truncated/corrupt.
  const tmp = join(dir, `threads.json.tmp-${randomBytes(4).toString("hex")}`);
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))));
  renameSync(tmp, join(dir, "threads.json"));
}
export function lookupThread(threadId: string, dir = threadsDir()): Rec | undefined { return load(dir)[threadId]; }
