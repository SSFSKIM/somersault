import { readFileSync } from "node:fs";
import type { HarnessConfig } from "../config/types.js";
import { parseThinkArg } from "../tui/thinkLevels.js";

// NB: `src/cliArgs.ts` is a DIFFERENT parser (the one-shot `cc-harness` grammar) that shares flag names
// with this one (--model/--permission-mode/--cwd/--resume) — check which grammar you are editing.

export interface CcxInvocation {
  command: "run" | "agents" | "attach" | "stop" | "rm" | "gc" | "serve";
  prompt?: string; target?: string;
  bg: boolean; detachable: boolean; print: boolean;
  name?: string; worktree?: string;
  // `serve`-only fields. Always present (like `config`/`bg` above) so the type stays simple even though
  // only the `serve` arm reads them — `--listen`'s default is loopback:ephemeral, `allowOrigins` fails
  // closed at the transport (Task 10) so an omitted/empty list is exactly the safe default.
  listen: { host: string; port: number };
  tokenFile?: string;
  allowOrigins: string[];
  /** The ABSOLUTE path `--worktree` resolved to. The parser never sets it — main fills it in after
   *  ensureWorktree, and spawnDetached carries it to the child, which is what writes it on the roster
   *  row. Distinct from `worktree` (the name as typed) on purpose: the two live in different domains,
   *  and rmSession acts only on an absolute path. */
  worktreePath?: string;
  json: boolean; all: boolean; cwdFilter?: string;
  // Field only for now — the --idle-timeout flag arm below stays the loud rejection until Task 8
  // rewires it to set this (seconds, a human CLI unit; hostOptsFrom converts to ms for SessionHostOpts).
  idleTimeoutSec?: number;
  // The foreground launch thinking budget (the old `cc-harness-chat --think`) — off|low|medium|high|
  // xhigh|max or a raw token count; validated at parse time, resolved to a budget in runForegroundImpl.
  think?: string;
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
  const a: CcxInvocation = { command: "run", bg: false, detachable: false, print: false, json: false, all: false, config: {}, listen: { host: "127.0.0.1", port: 0 }, allowOrigins: [] };
  let i = 0;
  const sub = argv[0];
  if (sub === "agents" || sub === "attach" || sub === "stop" || sub === "rm") { a.command = sub; i = 1; }
  else if (sub === "serve") { a.command = "serve"; i = 1; }
  else if (sub === "fleet" && argv[1] === "gc") { a.command = "gc"; i = 2; }

  /** Consume this flag's value. A dangling flag in final position used to yield `undefined`, which for
   *  --permission-mode/--settings silently configured the field with no value at all instead of
   *  failing loudly on an unattended worker. */
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
      // Grammar only — NO "only with --detachable" rule here: the detached child re-parses its OWN argv
      // without --detachable but WITH this forwarded flag (spawn.ts's configFlags), so a parser-level
      // constraint would kill every detachable child at startup. That policy check lives in main.ts's
      // switch instead, where it can tell a plain run from a --detachable one.
      case "--idle-timeout": {
        const v = Number(val(t));
        if (!Number.isInteger(v) || v <= 0) throw new Error(`--idle-timeout requires a positive integer of seconds, got ${JSON.stringify(argv[i])}`);
        a.idleTimeoutSec = v; break;
      }
      case "--model": a.config.model = val(t); break;
      case "--effort": a.config.effort = oneOf("--effort", val(t), EFFORT_LEVELS); break;
      case "-r": case "--resume": a.config.resume = val(t); break;
      case "--permission-mode": a.config.permissionMode = oneOf("--permission-mode", val(t), PERMISSION_MODES); break;
      case "--settings": a.config.settings = parseSettings(val(t)); break;
      case "--think": { const v = val(t); if (!parseThinkArg(v)) throw new Error(`--think must be off|low|medium|high|xhigh|max or a token count, got ${JSON.stringify(v)}`); a.think = v; break; }
      case "--listen": {
        const v = val(t);
        let u: URL;
        try { u = new URL(v); } catch { throw new Error(`--listen must be a ws:// URL, got ${JSON.stringify(v)}`); }
        if (u.protocol !== "ws:") throw new Error(`--listen must use the ws:// scheme, got ${JSON.stringify(v)}`);
        // `URL#hostname` keeps IPv6 brackets ("[::1]") — strip them ONCE here so both the loopback check
        // below and the value handed to listenWs/net.Server.listen see the bare literal ("::1"); a
        // bracketed string fails to bind at all (ENOTFOUND) and never matches LOOPBACK_HOSTS.
        const host = u.hostname.startsWith("[") && u.hostname.endsWith("]") ? u.hostname.slice(1, -1) : u.hostname;
        a.listen = { host, port: u.port ? Number(u.port) : 0 };
        break;
      }
      case "--token-file": a.tokenFile = val(t); break;
      // Repeatable — a web UI's own origin plus e.g. a dev server's are both real cases (spec §11: the
      // transport fails closed, so this list is the ONLY way a browser client ever gets in at all).
      case "--allow-origin": a.allowOrigins.push(val(t)); break;
      default:
        if (t.startsWith("-")) throw new Error(`unknown flag ${t}`);
        if (a.command === "run" && a.prompt === undefined) a.prompt = t;
        else if (a.command === "serve") throw new Error(`unexpected argument ${JSON.stringify(t)} — serve takes no positional target`);
        else if (a.command !== "run" && a.target === undefined) a.target = t;
        // Silently dropping it is how `ccx fix the bug` (unquoted) runs an agent on the prompt "fix".
        else throw new Error(`unexpected argument ${JSON.stringify(t)} — quote the prompt as one argument`);
    }
  }
  return a;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
/** spec §11's last rule, kept pure (no I/O) so it can run before any listener binds: a `serve` bound to
 *  anything but loopback with no `--token-file` would let a foreign, unauthenticated network client hit
 *  the control plane the moment a random token is only ever known to THIS process. Non-`serve` invocations
 *  are never asked (their `listen`/`tokenFile` fields are the unused defaults). */
export function nonLocalWithoutToken(inv: CcxInvocation): boolean {
  return inv.command === "serve" && !LOOPBACK_HOSTS.has(inv.listen.host) && !inv.tokenFile;
}
