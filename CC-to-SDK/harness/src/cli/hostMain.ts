import { isAbsolute } from "node:path";
import { SessionHost } from "../host/host.js";
import type { SessionHostOpts } from "../host/host.js";
import { isShortId } from "../fleet/paths.js";
import { parseCcx } from "./args.js";
import type { CcxInvocation } from "./args.js";

/** Read POSITIONALLY and validated, never by value. `argv[argv.indexOf("--__kind") + 1]` yields argv[0]
 *  when the marker is absent — a *defined* value, so a `?? "bg"` fallback never fires: kind lands as
 *  "--__host", the bg-gated turn finalize never records `done`, and the consumer's poller waits out its
 *  whole limit on a turn that in fact finished. `short` picked the same way names a roster row after a
 *  stray token. A value-based filter is lossy too — it drops every token that merely equals a marker
 *  word, so `--__host <id> --__kind bg --model --__host task` reduces to just ["--model"], eating the
 *  flag value and the prompt. Nothing upstream saves us: the dispatcher routes on
 *  `argv.includes("--__host")` before parseCcx ever runs, so a hand-typed `ccx --__host` reaches here. */
export function parseHostArgv(argv: string[]): { short: string; kind: "bg" | "interactive"; worktree?: string; inv: CcxInvocation } {
  if (argv[0] !== "--__host" || argv[2] !== "--__kind") throw new Error("--__host is internal: expected `--__host <short> --__kind <bg|interactive>` first");
  const short = argv[1];
  if (!isShortId(short)) throw new Error(`--__host requires an 8-hex short id, got ${JSON.stringify(short)}`);
  const kind = argv[3];
  if (kind !== "bg" && kind !== "interactive") throw new Error(`--__kind must be bg|interactive, got ${JSON.stringify(kind)}`);
  // Optional, positional, and the LAST marker — the parent emits it only when --worktree was resolved.
  // Absolute or nothing: this value becomes the roster row's `worktree`, and rmSession refuses a
  // relative one outright, so a row written from one would be permanently unremovable.
  let rest = 4, worktree: string | undefined;
  if (argv[4] === "--__worktree") {
    worktree = argv[5];
    if (worktree === undefined || !isAbsolute(worktree)) throw new Error(`--__worktree requires an absolute path, got ${JSON.stringify(worktree)}`);
    rest = 6;
  }
  return { short, kind, ...(worktree ? { worktree } : {}), inv: parseCcx(argv.slice(rest)) };
}

/** Everything the child derives from its own argv before anything is opened. Split out from
 *  runHostMain so the derivation below — the fork decision — is testable without spawning a process
 *  or opening an SDK session. */
export function hostOptsFrom(argv: string[]): { opts: SessionHostOpts; prompt?: string } {
  const { short, kind, worktree, inv } = parseHostArgv(argv);
  // A bg resume must BRANCH, never resume in place — the plan pins `--bg --resume` to SDK
  // `resume: <uuid>` + `forkSession: true`, the exact lever probe 59 verified. In place the fork keeps
  // the PARENT's uuid, so two roster rows share one session id: `ccx rm <uuid>` then refuses as
  // ambiguous and uuid addressing is broken for good, while the consumer's purge — which only runs when
  // the new uuid differs from the old — silently never fires, so superseded turns accumulate forever.
  // Forking is also what makes that purge safe: the child's transcript physically carries the parent's
  // conversation, so deleting the parent costs no history.
  const config = kind === "bg" && inv.config.resume ? { ...inv.config, forkSession: true } : inv.config;
  return {
    opts: {
      // The MARKER's value only, never inv.worktree: that one is a name (`wt`), and recording a name
      // gives rm a row it refuses to touch forever. The parent never forwards --worktree anyway.
      short, name: process.env.CLAUDE_CODE_SESSION_NAME ?? short, cwd: process.cwd(), kind,
      ...(worktree ? { worktree } : {}),
      config,
    },
    ...(inv.prompt ? { prompt: inv.prompt } : {}),
  };
}

/** The detached child's entry point. Never called by a user directly; `--__host` is internal. */
export async function runHostMain(argv: string[]): Promise<void> {
  const { opts, prompt } = hostOptsFrom(argv);
  const host = new SessionHost(opts);
  await host.start();
  try { if (prompt) await host.runTask(prompt); }
  finally { await host.stop(); }
}
