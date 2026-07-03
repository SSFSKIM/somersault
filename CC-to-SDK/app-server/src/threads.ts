import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os"; import { join } from "node:path";

export function threadsDir(): string { return process.env.CC_APPSERVER_STATE_DIR ?? join(homedir(), ".cc-appserver"); }
interface Rec { sessionId: string; cwd: string; updatedAt: number }
function load(dir: string): Record<string, Rec> { try { return JSON.parse(readFileSync(join(dir, "threads.json"), "utf8")); } catch { return {}; } }

export function recordThread(threadId: string, sessionId: string, cwd: string, dir = threadsDir()): void {
  mkdirSync(dir, { recursive: true });
  const all = load(dir); all[threadId] = { sessionId, cwd, updatedAt: Date.now() };
  const keys = Object.keys(all).sort((a, b) => all[b].updatedAt - all[a].updatedAt).slice(0, 200);
  writeFileSync(join(dir, "threads.json"), JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))));
}
export function lookupThread(threadId: string, dir = threadsDir()): Rec | undefined { return load(dir)[threadId]; }
