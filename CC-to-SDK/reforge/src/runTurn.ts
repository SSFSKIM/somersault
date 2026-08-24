// Shared driver: run one prompt through an engine (via sdk.mjs's
// pathToClaudeCodeExecutable seam) and capture every SDK message.
//
// Determinism knobs for differential runs:
//  - settingSources: [] — no user/project settings, plugins, hooks, or MCP servers
//  - fixed cwd (reforge/sandbox) — identical for every engine
//  - telemetry/nonessential traffic disabled via env
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REFORGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SANDBOX = join(REFORGE_ROOT, "sandbox");
export const enginePath = (name: string) => join(REFORGE_ROOT, "engines", name);

export interface TurnOptions {
  engine: string; // engine name under engines/ (e.g. "engine-real") or absolute path
  prompt: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  env?: Record<string, string>; // extra env for the engine subprocess (e.g. ANTHROPIC_BASE_URL)
}

export interface TurnCapture {
  engine: string;
  messages: unknown[];
  durationMs: number;
}

export async function runTurn(opts: TurnOptions): Promise<TurnCapture> {
  const engine = opts.engine.includes("/") ? opts.engine : enginePath(opts.engine);
  mkdirSync(SANDBOX, { recursive: true });
  const messages: unknown[] = [];
  const started = Date.now();
  const q = query({
    prompt: opts.prompt,
    options: {
      pathToClaudeCodeExecutable: engine,
      cwd: SANDBOX,
      model: opts.model,
      maxTurns: opts.maxTurns ?? 1,
      allowedTools: opts.allowedTools ?? [],
      permissionMode: "bypassPermissions",
      settingSources: [],
      // Options.env REPLACES the subprocess env (sdk-options-gotchas), so
      // rebuild it: parent env + determinism knobs + caller extras.
      env: {
        ...(process.env as Record<string, string>),
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ...opts.env,
      },
    },
  });
  for await (const m of q) messages.push(m);
  return { engine, messages, durationMs: Date.now() - started };
}

export function saveTranscript(name: string, capture: TurnCapture): string {
  const dir = join(REFORGE_ROOT, "transcripts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(file, capture.messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  return file;
}
