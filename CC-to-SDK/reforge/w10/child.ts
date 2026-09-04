// C13c / W10c, capability 1 — the scripted child, as the harness declares it.
//
// `w10/scripted-child.sh` is the artifact that runs; this is the DECLARATION
// side of it: the plan a scenario writes down, the argv that plan renders to,
// the bytes that argv must produce, and the seed that puts the script where the
// engine's shell can reach it.
//
// ## Two implementations of one schedule, on purpose
//
// `expectedOutput` re-derives the helper's bytes in TypeScript rather than
// reading them back from a recorded fixture. A fixture would say "the helper
// still produces what it produced last time", which is true of a helper that
// was wrong from the start; two independent implementations of the same written
// schedule disagree the moment either one drifts. It is also what lets a
// scenario state its expectation without a recording — the moat scenarios need
// an exact sha256 for a command they have not run yet.
//
// ## Why the seed is per-scenario and not part of `resetSandbox`
//
// `resetSandbox()` wipes the sandbox before every run, so anything committed
// into it has to be re-seeded per run — and seeding it for EVERY scenario would
// put a file into the graded sandbox tree of all 63, changing what `ls` returns
// for scenarios that have nothing to do with the executor. The precedent is
// W3's `seedGitRepo`: the scenario that needs the world declares it in its own
// `run()`, and the state surface grades the result identically on both engines.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The name the script carries INSIDE the sandbox.
 *
 * Deliberately distinctive: it is the only token a leaked descendant's command
 * line is guaranteed to carry, and `src/state.ts`'s supervision surface uses it
 * as one of the two routes by which an orphan is attributed to this harness
 * rather than to whatever else the operator's machine is running.
 */
export const SCRIPTED_CHILD_NAME = "reforge-child.sh";

/** The committed source, which is what `seedScriptedChild` copies. */
export const SCRIPTED_CHILD_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "scripted-child.sh");

/** The declarative argv, as a scenario writes it down. */
export interface ChildPlan {
  /** total stdout bytes, EXACTLY */
  bytes?: number;
  /** how many writes those bytes are split across */
  chunks?: number;
  /** milliseconds between chunk N and chunk N+1 */
  everyMs?: number;
  /** the exit status the child chooses */
  exit?: number;
  /** `trap '' TERM` — the only way to reach `#h`'s SIGTERM->SIGKILL backstop */
  ignoreTerm?: boolean;
  /** seconds a grandchild holds this process's stdout open PAST its own exit */
  holdFdSeconds?: number;
  /** append a last line the stall detector's `_lr` recognises as an interactive prompt */
  promptTail?: boolean;
}

/** The plan as argv. Order is fixed so the rendered command is a function of the plan. */
export function childArgv(plan: ChildPlan): string[] {
  const argv: string[] = [];
  if (plan.bytes !== undefined) argv.push("--bytes", String(plan.bytes));
  if (plan.chunks !== undefined) argv.push("--chunks", String(plan.chunks));
  if (plan.everyMs !== undefined) argv.push("--every", String(plan.everyMs));
  if (plan.exit !== undefined) argv.push("--exit", String(plan.exit));
  if (plan.ignoreTerm) argv.push("--ignore-term");
  if (plan.holdFdSeconds !== undefined) argv.push("--hold-fd", String(plan.holdFdSeconds));
  if (plan.promptTail) argv.push("--prompt-tail");
  return argv;
}

/** The command a prompt asks the model to run, relative to the sandbox cwd. */
export const childCommand = (plan: ChildPlan): string => [`./${SCRIPTED_CHILD_NAME}`, ...childArgv(plan)].join(" ");

/**
 * The bytes `scripted-child.sh` must write for this plan — the second
 * implementation (see header).
 *
 * The last chunk carries the remainder, so `--bytes N` is exact for every
 * `--chunks K`; a chunk too small for its own `R<i>:` header degrades to a
 * truncated header rather than overrunning N.
 */
export function expectedOutput(plan: ChildPlan): string {
  const bytes = plan.bytes ?? 0;
  const chunks = plan.chunks ?? 1;
  const base = Math.floor(bytes / chunks);
  const rest = bytes - base * (chunks - 1);
  let out = "";
  for (let i = 0; i < chunks; i++) {
    const size = i === chunks - 1 ? rest : base;
    const head = `R${i}:`;
    const body = size - head.length - 1;
    out += body >= 0 ? head + ".".repeat(body) + "\n" : head.slice(0, Math.max(0, size));
  }
  return out + (plan.promptTail ? PROMPT_TAIL : "");
}

/**
 * The interactive-prompt tail, quoted from the pin rather than invented: `_lr`
 * (chunk-fy12d89p.js) tests the last non-empty line against `ylr`'s seven
 * regexes, and this line matches two of them independently — `/Continue\?/i`
 * and `/\(y\/n\)/i` — so a pin that retires one still fires the arm.
 */
export const PROMPT_TAIL = "Continue? (y/n) ";

/** Put the helper where the engine's shell can run it, and return the path it lives at. */
export function seedScriptedChild(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, SCRIPTED_CHILD_NAME);
  copyFileSync(SCRIPTED_CHILD_SOURCE, dest);
  // The copy inherits the source's mode on some filesystems and not on others;
  // the engine runs it as `./reforge-child.sh`, which needs the bit.
  chmodSync(dest, 0o755);
  return dest;
}

/** What one direct run of the helper produced — the graded surface of the helper itself. */
export interface ScriptedChildRun {
  bytes: number;
  sha256: string;
  /** newline-terminated lines, which is the chunk count for every plan whose chunks fit their header */
  lines: number;
  /** the `R<i>` markers in order — the chunk schedule made visible IN the bytes */
  markers: string[];
  exitCode: number | null;
  killedBySignal: string | null;
  /** wall clock, used ONLY against a floor (see `childViolations`) and never recorded as a value */
  elapsedMs: number;
  stderr: string;
}

export interface RunChildOptions {
  /** deliver this signal after the child has been alive for `signalAfterMs` */
  signal?: NodeJS.Signals;
  signalAfterMs?: number;
  /** a second signal, for the escalation shape: SIGTERM into a child that ignores it, then SIGKILL */
  thenSignal?: NodeJS.Signals;
  thenAfterMs?: number;
  /** stop waiting and report what happened */
  timeoutMs?: number;
}

/**
 * Run the helper directly — no engine, no cassette — and report what it did.
 *
 * This is the contract test's oracle and nothing else: the SCENARIOS run the
 * helper through the engine's own Bash tool, which is the point. What this
 * proves is that the child the scenarios rely on behaves as its argv declares,
 * so a scenario that grades an engine against it is grading the engine.
 */
export function runScriptedChild(script: string, plan: ChildPlan, opts: RunChildOptions = {}): Promise<ScriptedChildRun> {
  const started = Date.now();
  const child = spawn(script, childArgv(plan), { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => chunks.push(c));
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (opts.signal !== undefined) timers.push(setTimeout(() => child.kill(opts.signal), opts.signalAfterMs ?? 0));
  if (opts.thenSignal !== undefined) timers.push(setTimeout(() => child.kill(opts.thenSignal), opts.thenAfterMs ?? 0));
  return new Promise<ScriptedChildRun>((resolve) => {
    const finish = (code: number | null, sig: string | null): void => {
      for (const t of timers) clearTimeout(t);
      // `close` rather than `exit`, so the stdout pipe has drained: with
      // `--hold-fd` the process exits while a grandchild still holds the write
      // end, and reading on `exit` would report an empty stream for a child
      // that wrote its whole schedule.
      const buf = Buffer.concat(chunks);
      const text = buf.toString("utf8");
      resolve({
        bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
        lines: text.split("\n").length - 1,
        markers: [...text.matchAll(/R(\d+):/g)].map((m) => m[0]),
        exitCode: code,
        killedBySignal: sig,
        elapsedMs: Date.now() - started,
        stderr: stderr.slice(0, 400),
      });
    };
    if (opts.timeoutMs !== undefined) {
      timers.push(
        setTimeout(() => {
          child.kill("SIGKILL");
          finish(null, "TIMEOUT");
        }, opts.timeoutMs),
      );
    }
    child.on("close", (code, sig) => finish(code, sig));
  });
}

/**
 * The helper's contract, as violations.
 *
 * FOUR FIELDS AND ONE FLOOR, and the split is the whole reason the negative
 * control can name what moved. `bytes`/`sha256`/`markers` are the CONTENT axis
 * and are exact; `exitCode` is the status axis and is exact; `elapsedMs` is the
 * SCHEDULE axis and is a FLOOR, because a wall-clock equality would fail on a
 * loaded machine while proving nothing extra. `(chunks - 1) * everyMs` is the
 * sleeping the schedule commits to; everything above it is the machine.
 */
export function childViolations(run: ScriptedChildRun, plan: ChildPlan): string[] {
  const bad: string[] = [];
  const want = expectedOutput(plan);
  const wantSha = createHash("sha256").update(Buffer.from(want, "utf8")).digest("hex");
  if (run.bytes !== Buffer.byteLength(want)) bad.push(`bytes: ${run.bytes} != ${Buffer.byteLength(want)}`);
  if (run.sha256 !== wantSha) bad.push(`sha256: ${run.sha256.slice(0, 12)} != ${wantSha.slice(0, 12)}`);
  const wantMarkers = [...want.matchAll(/R(\d+):/g)].map((m) => m[0]);
  if (JSON.stringify(run.markers) !== JSON.stringify(wantMarkers)) {
    bad.push(`markers: ${JSON.stringify(run.markers)} != ${JSON.stringify(wantMarkers)}`);
  }
  if (run.killedBySignal === null && run.exitCode !== (plan.exit ?? 0)) bad.push(`exitCode: ${run.exitCode} != ${plan.exit ?? 0}`);
  const floorMs = ((plan.chunks ?? 1) - 1) * (plan.everyMs ?? 0);
  if (run.elapsedMs < floorMs) bad.push(`elapsedMs: ${run.elapsedMs} is below the schedule's floor of ${floorMs}`);
  return bad;
}
