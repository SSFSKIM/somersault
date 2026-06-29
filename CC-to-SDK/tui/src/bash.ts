// tui/src/bash.ts — the `!` bash-mode shell escape: run a command locally in cwd and render its output
// into the transcript (CC's UserBashInput/Output messages). Local-only — it does NOT trigger a model turn
// (a quick shell peek without leaving the REPL). runBash is the one impure bit; formatBashLines is pure.
import { exec } from "node:child_process";
import type { RenderLine } from "./render.js";

export interface BashResult { code: number; output: string }

/** Run `command` in `cwd`; resolve with combined stdout+stderr and an exit code (never rejects).
 *  NB: `exec` (full shell) is INTENTIONAL — this is an interactive shell escape, so the user's own
 *  command string IS the input (pipes/globs/&& are the point), run with their own privileges in their
 *  own cwd, exactly like a terminal or CC's `!` mode. There is no untrusted interpolation here. */
export function runBash(command: string, cwd: string): Promise<BashResult> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`.replace(/\n+$/, "");
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code, output });
    });
  });
}

/** Dim indented output (capped) + a red `exit N` line when the command failed. (The `! command` header is
 *  echoed separately by the caller for immediate feedback.) */
export function formatBashOutput(r: BashResult, cap = 40): RenderLine[] {
  const lines = r.output ? r.output.split("\n") : [];
  const out: RenderLine[] = lines.slice(0, cap).map((l) => ({ text: `  ${l}`, dim: true }));
  if (lines.length > cap) out.push({ text: `  … ${lines.length - cap} more lines`, dim: true });
  if (r.code !== 0) out.push({ text: `  exit ${r.code}`, color: "red" });
  return out;
}

/** Header + output, for callers that render the whole block at once. */
export function formatBashLines(command: string, r: BashResult, cap = 40): RenderLine[] {
  return [{ text: `! ${command}`, color: "magenta" }, ...formatBashOutput(r, cap)];
}
