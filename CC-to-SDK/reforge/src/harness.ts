// M1 — shared scenario plumbing: deterministic base options, a controllable
// streaming-input channel (for multi-turn scenarios that must wait for a result
// before sending the next user message), sandbox reset, and a query driver.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { REFORGE_ROOT, SANDBOX } from "./runTurn.js";

/**
 * H1 — reforge-owned config dir. `settingSources: []` does NOT contain this:
 * the probe measured the shared real ~/.claude still injecting the user's
 * memory index, personal slash commands, and identity into every system prompt
 * (and 63 session files written into the user's real store). Isolation is
 * total (real-store writes: +0) and makes recordings reproducible; the dir is
 * persistent rather than per-run so first-run/onboarding state stays stable.
 */
export const CONFIG_DIR = join(REFORGE_ROOT, "config");

export interface ScenarioContext {
  /** absolute path of the engine wrapper under test */
  engine: string;
  /** base URL of the record/replay proxy */
  baseUrl: string;
  /** behavioral side-channel: harness-side observations (hook fires, permission consults). Diffed. */
  collect(event: string, payload?: unknown): void;
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

/** Deterministic defaults every scenario builds on. Options.env REPLACES the subprocess env. */
export function baseOptions(ctx: ScenarioContext): Options {
  mkdirSync(CONFIG_DIR, { recursive: true });
  return {
    pathToClaudeCodeExecutable: ctx.engine,
    cwd: SANDBOX,
    settingSources: [],
    env: {
      ...(process.env as Record<string, string>),
      CLAUDE_CONFIG_DIR: CONFIG_DIR,
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ANTHROPIC_BASE_URL: ctx.baseUrl,
    },
  };
}

/** Wipe the shared sandbox cwd so every engine run sees the same filesystem. */
export function resetSandbox(): void {
  mkdirSync(SANDBOX, { recursive: true });
  for (const entry of readdirSync(SANDBOX)) rmSync(join(SANDBOX, entry), { recursive: true, force: true });
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
