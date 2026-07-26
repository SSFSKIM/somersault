import { readFileSync } from "node:fs";
import type { HarnessConfig } from "../config/types.js";

// NB: `src/cliArgs.ts` is a DIFFERENT parser (the one-shot `cc-harness` grammar) that shares flag names
// with this one (--model/--permission-mode/--cwd/--resume) — check which grammar you are editing.

export interface CcxInvocation {
  command: "run" | "agents" | "attach" | "stop" | "rm" | "gc";
  prompt?: string; target?: string;
  bg: boolean; detachable: boolean; print: boolean;
  name?: string; worktree?: string;
  json: boolean; all: boolean; cwdFilter?: string; idleTimeoutMs?: number;
  /** ARGV-SCOPED despite the name: true iff THIS command line carried --permission-mode or --settings.
   *  It cannot observe a project settings file, a managed policy, or any other source. hostMain derives
   *  noHumanSeam from it by re-parsing argv, so a rename ripples — read it as "the operator said so here". */
  hasExplicitPermissionConfig: boolean;
  config: HarnessConfig;
}

/** Flags the real CLI has that we deliberately do not support yet. Listing them means we reject them
 *  by name instead of ignoring them — silence here is a safety bug in an unattended worker. */
const KNOWN_UNSUPPORTED = new Set(["--remote-control", "--chrome", "--ide", "--tmux", "--bare", "--gateway"]);

// The two value domains, checked against HarnessConfig's own unions via `satisfies`: a member added to
// (or dropped from) the union breaks this literal at compile time instead of letting a stale value pass.
const PERMISSION_MODES = { default: true, acceptEdits: true, bypassPermissions: true, plan: true, dontAsk: true, auto: true } satisfies Record<NonNullable<HarnessConfig["permissionMode"]>, true>;
const EFFORT_LEVELS = { low: true, medium: true, high: true, xhigh: true, max: true } satisfies Record<NonNullable<HarnessConfig["effort"]>, true>;

/** `argv[++i] as any` used to put any string into these unions; resolveOptions forwards the value as-is
 *  and its `=== "auto"` guard means a near-miss like `Auto` also skips the auto-model repair. */
function oneOf<K extends string>(flag: string, v: string, domain: Record<K, true>): K {
  // hasOwn, not `in`: `"constructor" in domain` is true through the prototype chain.
  if (!Object.hasOwn(domain, v)) throw new Error(`${flag} must be one of ${Object.keys(domain).join("|")}, got ${JSON.stringify(v)}`);
  return v as K;
}

function jsonObject(text: string): Record<string, unknown> | undefined {
  try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined; }
  catch { return undefined; }
}

/** --settings takes inline JSON *or* a path to a JSON file, like the real CLI (`--settings <file-or-json>`);
 *  doperpowers' daemon-spawn.sh passes a path (DAEMON_CLAUDE_SETTINGS). It MUST land as an object:
 *  config/settings.ts spreads the field, and spreading a string yields {0:"/",1:"h",…} with no error
 *  anywhere — a gateway daemon whose settings became character noise. Neither form parsing = throw;
 *  a misconfigured unattended worker must fail loudly rather than run wrong. */
function parseSettings(v: string): Record<string, unknown> {
  const inline = jsonObject(v);
  if (inline) return inline;
  let text: string;
  try { text = readFileSync(v, "utf8"); }
  catch { throw new Error(`--settings ${JSON.stringify(v)} is neither a JSON object nor a readable file`); }
  const fromFile = jsonObject(text);
  if (!fromFile) throw new Error(`--settings file ${JSON.stringify(v)} does not contain a JSON object`);
  return fromFile;
}

export function parseCcx(argv: string[]): CcxInvocation {
  const a: CcxInvocation = { command: "run", bg: false, detachable: false, print: false, json: false, all: false, hasExplicitPermissionConfig: false, config: {} };
  let i = 0;
  const sub = argv[0];
  if (sub === "agents" || sub === "attach" || sub === "stop" || sub === "rm") { a.command = sub; i = 1; }
  else if (sub === "fleet" && argv[1] === "gc") { a.command = "gc"; i = 2; }

  /** Consume this flag's value. A dangling flag in final position used to yield `undefined`, which for
   *  --permission-mode/--settings still flipped hasExplicitPermissionConfig — turning off the ask-policy
   *  floor for an unattended worker on the strength of a value nobody supplied. */
  const val = (flag: string): string => {
    const v = argv[++i];
    if (v === undefined) throw new Error(`${flag} requires a value`);
    return v;
  };

  for (; i < argv.length; i++) {
    const t = argv[i];
    if (KNOWN_UNSUPPORTED.has(t)) throw new Error(`${t} is not supported by ccx (recognized, deliberately unimplemented)`);
    switch (t) {
      case "--bg": case "--background": a.bg = true; break;
      case "--detachable": a.detachable = true; break;
      case "-p": case "--print": a.print = true; break;
      case "--json": a.json = true; break;
      case "--all": a.all = true; break;
      case "-n": case "--name": a.name = val(t); break;
      case "--worktree": a.worktree = val(t); break;
      case "--cwd": { const v = val(t); if (a.command === "agents") a.cwdFilter = v; else a.config.cwd = v; break; }
      // NaN would sail through: setTimeout coerces it to ~0, so `--idle-timeout 30s` becomes a watchdog
      // that fires immediately instead of an error.
      case "--idle-timeout": { const v = val(t); const n = Number(v); if (!v.trim() || !Number.isFinite(n)) throw new Error(`--idle-timeout must be a number of seconds, got ${JSON.stringify(v)}`); a.idleTimeoutMs = n * 1000; break; }
      case "--model": a.config.model = val(t); break;
      case "--effort": a.config.effort = oneOf("--effort", val(t), EFFORT_LEVELS); break;
      case "-r": case "--resume": a.config.resume = val(t); break;
      case "--permission-mode": a.config.permissionMode = oneOf("--permission-mode", val(t), PERMISSION_MODES); a.hasExplicitPermissionConfig = true; break;
      case "--settings": a.config.settings = parseSettings(val(t)); a.hasExplicitPermissionConfig = true; break;
      default:
        if (t.startsWith("-")) throw new Error(`unknown flag ${t}`);
        if (a.command === "run" && a.prompt === undefined) a.prompt = t;
        else if (a.command !== "run" && a.target === undefined) a.target = t;
        // Silently dropping it is how `ccx fix the bug` (unquoted) runs an agent on the prompt "fix".
        else throw new Error(`unexpected argument ${JSON.stringify(t)} — quote the prompt as one argument`);
    }
  }
  return a;
}
