// M1 — shared scenario plumbing: deterministic base options, a controllable
// streaming-input channel (for multi-turn scenarios that must wait for a result
// before sending the next user message), sandbox reset, and a query driver.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { ENGINE_VERSION } from "./pin.js";
import { acquireSandboxLock } from "./lock.js";
import { censusConfigDir } from "./observed.js";
import { applyPrecondition, EMPTY_PRECONDITION, wipeConfigDir, type ConfigPrecondition } from "./precondition.js";
import { join } from "node:path";
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CONFIG_DIR, REFORGE_ROOT, SANDBOX, sdkEnv } from "./runTurn.js";
import type { EngineEnvKnobs, EnvMode } from "./env.js";
import type { FaultKind } from "./faults.js";
import type { RecordInjector } from "./proxy.js";

export { baselineSeedHash, EMPTY_PRECONDITION, emptyPreconditionFor, projectKeyFor, type ConfigPrecondition, type FsFault, type FsFaultKind, type RecordedPrecondition, type SeedFile } from "./precondition.js";

// H1 — reforge-owned config dir; defined in runTurn.ts so both entry points
// share one definition (runTurn was silently NOT isolated until a review caught
// it). Re-exported for callers that import it from here.
export { CONFIG_DIR };

/** Where `src/observed.ts` accumulates what each reset saw before wiping it (derived; gitignored). */
export const CONFIG_CENSUS_PATH = join(REFORGE_ROOT, "build", "config-observed.json");

export interface ScenarioContext {
  /** absolute path of the engine wrapper under test */
  engine: string;
  /** base URL of the record/replay proxy */
  baseUrl: string;
  /** behavioral side-channel: harness-side observations (hook fires, permission consults). Diffed. */
  collect(event: string, payload?: unknown): void;
  /**
   * X6 — which credential schema the engine child gets. A live recording needs
   * the one selected real credential; an offline replay gets the non-secret
   * placeholder. The runner knows which it is doing, so it says so here rather
   * than letting the schema guess from what happens to be in the shell.
   */
  mode: EnvMode;
  /** Deliberate, schema-checked child-env knobs (retry bound, config dir, seeded gate overrides). */
  knobs?: EngineEnvKnobs;
}

export interface Scenario {
  tag: string;
  title: string;
  run(ctx: ScenarioContext): Promise<unknown[]>; // returns the captured SDK messages
  /**
   * Substance assertion, run against the replayed capture: return a failure
   * reason if the scenario did NOT exercise the behavior it claims (guards the
   * hollow-pass class: two engines agreeing on nothing still diff as identical).
   */
  check?(messages: unknown[], events: unknown[]): string | null;
  /**
   * Opt out of whole-transcript diffing, grading on `check` alone. ONLY for
   * scenarios whose output is genuinely nondeterministic in a way that cannot be
   * canonicalized without discarding a real contract — the reason is required so
   * the exemption is auditable rather than a silent way to make red go green,
   * and such a scenario grades strictly less than the others.
   */
  substanceOnly?: string;
  /**
   * Rewrite the recorded cassette into a FAULT before promoting it, using the
   * H2 derivation (`src/faults.ts`).
   *
   * For a scenario whose condition is a RESPONSE the API will not produce on
   * demand. StopFailure's dispatcher runs on the arm where a turn ends in an
   * api-error message, and no prompt reliably makes the real API return one — so
   * the cassette is recorded healthy and then authored, exactly as the H2 suite
   * already does, and both engines replay the same authored failure. The
   * recording is still a real recording; only the response it serves is chosen.
   */
  deriveFault?: FaultKind;
  /**
   * Choose one response DURING the live take, instead of rewriting the cassette
   * afterwards (`src/proxy.ts`'s `RecordInjector`).
   *
   * `deriveFault` above can only express a fault the engine does not recover
   * from, because a post-hoc rewrite leaves the rest of the cassette answering a
   * conversation that no longer happens. When the fault CHANGES the conversation
   * — the auto-mode classifier failing turns an allowed tool call into a denied
   * one — the choosing has to happen while the engine is still talking, so the
   * requests recorded after it are the ones it really made.
   */
  recordInject?: RecordInjector;
  /**
   * The DECLARED state of the harness config dir before this scenario runs
   * (`src/precondition.ts`). Absent means `EMPTY_PRECONDITION` — which is itself
   * a declaration, not an absence: the reset seeds the documented baseline.
   *
   * The runner records what it applied next to the cassette and applies THAT on
   * replay, so a replay reproduces the filesystem the recording was made
   * against; a declaration that has since changed is reported as a finding
   * rather than silently re-recorded.
   */
  precondition?: ConfigPrecondition;
}

// --- small assertion helpers for scenario checks ----------------------------
export const resultsOf = (msgs: unknown[]) =>
  msgs.filter((m) => (m as { type?: string }).type === "result") as { subtype?: string; result?: unknown }[];

export const resultText = (msgs: unknown[], nth = 0): string => String(resultsOf(msgs)[nth]?.result ?? "");

export const usedTool = (msgs: unknown[], name: string): boolean =>
  msgs.some((m) => {
    const mm = m as { type?: string; message?: { content?: unknown } };
    if (mm.type !== "assistant") return false;
    const c = mm.message?.content;
    return Array.isArray(c) && c.some((b: { type?: string; name?: string }) => b?.type === "tool_use" && b?.name === name);
  });

export const hasThinking = (msgs: unknown[]): boolean =>
  msgs.some((m) => {
    const c = (m as { message?: { content?: unknown } }).message?.content;
    return Array.isArray(c) && c.some((b: { type?: string }) => b?.type === "thinking");
  });

/**
 * Deterministic defaults every scenario builds on. `Options.env` REPLACES the
 * subprocess env, and under X6 that replacement is CONSTRUCTED: no operator
 * variable reaches the engine unless the schema names it.
 */
export function baseOptions(ctx: ScenarioContext): Options {
  mkdirSync(CONFIG_DIR, { recursive: true });
  return {
    pathToClaudeCodeExecutable: ctx.engine,
    cwd: SANDBOX,
    settingSources: [],
    env: sdkEnv(ctx.mode, ctx.baseUrl, ctx.knobs),
  };
}

/**
 * Reset the machine to a DECLARED state: wipe the sandbox cwd, wipe everything
 * the engine wrote into the harness config dir, then seed what the scenario's
 * precondition declares (`src/precondition.ts`).
 *
 * THE CONFIG DIR GOES TOO, and that is C12a/W9a's change. The principle was
 * already written here and applied to one directory: plan mode makes the engine
 * render a plan-file preamble whose text depends on whether that file already
 * exists, and the file lands in the config dir rather than the cwd — so a
 * plan-mode recording that wrote one left the next run a different prompt and a
 * `Write` that came back "File has not been read yet". Measured then; the
 * sentence it produced was "engine state a run creates has to be reset with the
 * sandbox, wherever the engine happens to keep it", and `plans/` was the only
 * place anyone had checked.
 *
 * The rest of that state had been accumulating since W0: 1,087 task directories,
 * 3,939 empty `session-env/` directories, 412 session transcripts, 247 shell
 * snapshots, and a `.claude.json` whose `skillUsage` counter is monotonic across
 * the whole corpus because nothing ever reset it. None of it is a controlled
 * input, and the config half of the state surface (§3.2) cannot grade a
 * directory whose contents are three days of history.
 *
 * AND IT IS THE HARNESS'S ONE CHOKE POINT, which is why the single-writer lock
 * is taken here (`src/lock.ts`). Every suite in the tree resets before it runs,
 * so a process that has reset is a process that has already destroyed whatever
 * a sibling was measuring. The lock refuses that before the wipe rather than
 * reporting it afterwards as an engine difference.
 *
 * The wipe is total because CONFIG_DIR is entirely derived — nothing is
 * committed there and the engine creates what it needs. What the ENGINE writes
 * is nonetheless a measured population rather than an assumption: every reset
 * censuses the tree before deleting it (`src/observed.ts`), and
 * `research/tools/extract-config-inventory.ts --check` holds that census against
 * the pinned inventory. That check is the tripwire for the state surface's own
 * blind spot — its config root is an INCLUDE-LIST, so a pin that started writing
 * a seventh family would otherwise be seen by nothing.
 */
export function resetSandbox(precondition: ConfigPrecondition = EMPTY_PRECONDITION): void {
  acquireSandboxLock("resetSandbox (sandbox/ + config/)");
  mkdirSync(SANDBOX, { recursive: true });
  for (const entry of readdirSync(SANDBOX)) rmSync(join(SANDBOX, entry), { recursive: true, force: true });
  censusConfigDir(CONFIG_DIR, CONFIG_CENSUS_PATH, ENGINE_VERSION);
  wipeConfigDir(CONFIG_DIR);
  applyPrecondition(CONFIG_DIR, precondition, ENGINE_VERSION);
}

/** Drive a query to completion, capturing every SDK message. */
export async function drive(prompt: string | AsyncIterable<SDKUserMessage>, options: Options): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const m of query({ prompt, options })) messages.push(m);
  return messages;
}

export function userMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: "",
  } as SDKUserMessage;
}

/** Pushable async iterable: lets a scenario feed the next user message only after observing a result. */
export function pushable<T>(): AsyncIterable<T> & { push(v: T): void; end(): void } {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(v: T) {
      queue.push(v);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) yield queue.shift()!;
        else if (done) return;
        else await new Promise<void>((r) => (notify = r));
      }
    },
  };
}

/**
 * Drive a multi-exchange session over the streaming-input channel: `next(n)`
 * returns the (n+1)-th user message given how many results have come back, or
 * null to end the conversation. Returns every SDK message, in order.
 *
 * W4 wrote this for the compaction scenarios, which have to wait for a result
 * before deciding what to send next; W5's PreCompact and SessionEnd recordings
 * need the same shape (a conversation long enough to compact, a turn followed by
 * `/clear`), so it lives here rather than in one wave's file.
 */
export async function converse(
  options: Options,
  next: (results: number) => string | null,
): Promise<unknown[]> {
  const input = pushable<SDKUserMessage>();
  const messages: unknown[] = [];
  const first = next(0);
  if (first === null) throw new Error("converse: the conversation needs at least one user message");
  input.push(userMessage(first));
  let results = 0;
  for await (const m of query({ prompt: input, options })) {
    messages.push(m);
    if ((m as { type?: string }).type !== "result") continue;
    results++;
    const following = next(results);
    if (following === null) input.end();
    else input.push(userMessage(following));
  }
  return messages;
}
