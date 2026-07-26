import type { HarnessConfig } from "../config/types.js";

export interface CcxInvocation {
  command: "run" | "agents" | "attach" | "stop" | "rm" | "gc";
  prompt?: string; target?: string;
  bg: boolean; detachable: boolean; print: boolean;
  name?: string; worktree?: string;
  json: boolean; all: boolean; cwdFilter?: string; idleTimeoutMs?: number;
  hasExplicitPermissionConfig: boolean;
  config: HarnessConfig;
}

/** Flags the real CLI has that we deliberately do not support yet. Listing them means we reject them
 *  by name instead of ignoring them — silence here is a safety bug in an unattended worker. */
const KNOWN_UNSUPPORTED = new Set(["--remote-control", "--chrome", "--ide", "--tmux", "--bare", "--gateway"]);

export function parseCcx(argv: string[]): CcxInvocation {
  const a: CcxInvocation = { command: "run", bg: false, detachable: false, print: false, json: false, all: false, hasExplicitPermissionConfig: false, config: {} };
  let i = 0;
  const sub = argv[0];
  if (sub === "agents" || sub === "attach" || sub === "stop" || sub === "rm") { a.command = sub; i = 1; }
  else if (sub === "fleet" && argv[1] === "gc") { a.command = "gc"; return a; }

  for (; i < argv.length; i++) {
    const t = argv[i];
    if (KNOWN_UNSUPPORTED.has(t)) throw new Error(`${t} is not supported by ccx (recognized, deliberately unimplemented)`);
    switch (t) {
      case "--bg": case "--background": a.bg = true; break;
      case "--detachable": a.detachable = true; break;
      case "-p": case "--print": a.print = true; break;
      case "--json": a.json = true; break;
      case "--all": a.all = true; break;
      case "-n": case "--name": a.name = argv[++i]; break;
      case "--worktree": a.worktree = argv[++i]; break;
      case "--cwd": if (a.command === "agents") a.cwdFilter = argv[++i]; else a.config.cwd = argv[++i]; break;
      case "--idle-timeout": a.idleTimeoutMs = Number(argv[++i]) * 1000; break;
      case "--model": a.config.model = argv[++i]; break;
      case "--effort": (a.config as any).effort = argv[++i]; break;
      case "-r": case "--resume": a.config.resume = argv[++i]; break;
      case "--permission-mode": a.config.permissionMode = argv[++i] as any; a.hasExplicitPermissionConfig = true; break;
      case "--settings": (a.config as any).settings = argv[++i]; a.hasExplicitPermissionConfig = true; break;
      default:
        if (t.startsWith("-")) throw new Error(`unknown flag ${t}`);
        if (a.command === "run" && a.prompt === undefined) a.prompt = t;
        else if (a.command !== "run" && a.target === undefined) a.target = t;
    }
  }
  return a;
}
