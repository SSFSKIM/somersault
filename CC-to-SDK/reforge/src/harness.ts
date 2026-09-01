// M1 — shared scenario plumbing: deterministic base options, a controllable
// streaming-input channel (for multi-turn scenarios that must wait for a result
// before sending the next user message), sandbox reset, and a query driver.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CONFIG_DIR, SANDBOX, sdkEnv } from "./runTurn.js";
import type { EngineEnvKnobs, EnvMode } from "./env.js";
import type { FaultKind } from "./faults.js";
import type { RecordInjector } from "./proxy.js";

// H1 — reforge-owned config dir; defined in runTurn.ts so both entry points
// share one definition (runTurn was silently NOT isolated until a review caught
// it). Re-exported for callers that import it from here.
export { CONFIG_DIR };

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
 * Wipe the shared sandbox cwd so every engine run sees the same filesystem.
 *
 * THE PLAN DIRECTORY GOES TOO, and it is not in the sandbox. Plan mode makes the
 * engine render a plan-file preamble into the system prompt whose text depends on
 * whether that file already exists, and the file lands in the harness CONFIG dir
 * rather than the cwd — so a plan-mode recording that writes one leaves the next
 * run a different prompt and a `Write` that comes back "File has not been read
 * yet". Measured: the mode walk's plan turn recorded a successful write and then
 * replayed as a tool error, three requests missing their body hash and being
 * served positionally. Engine state a run creates has to be reset with the
 * sandbox, wherever the engine happens to keep it.
 */
export function resetSandbox(): void {
  mkdirSync(SANDBOX, { recursive: true });
  for (const entry of readdirSync(SANDBOX)) rmSync(join(SANDBOX, entry), { recursive: true, force: true });
  rmSync(join(CONFIG_DIR, "plans"), { recursive: true, force: true });
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
