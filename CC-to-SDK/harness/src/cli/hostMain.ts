import { SessionHost } from "../host/host.js";
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
export function parseHostArgv(argv: string[]): { short: string; kind: "bg" | "interactive"; inv: CcxInvocation } {
  if (argv[0] !== "--__host" || argv[2] !== "--__kind") throw new Error("--__host is internal: expected `--__host <short> --__kind <bg|interactive>` first");
  const short = argv[1];
  if (!isShortId(short)) throw new Error(`--__host requires an 8-hex short id, got ${JSON.stringify(short)}`);
  const kind = argv[3];
  if (kind !== "bg" && kind !== "interactive") throw new Error(`--__kind must be bg|interactive, got ${JSON.stringify(kind)}`);
  return { short, kind, inv: parseCcx(argv.slice(4)) };
}

/** The detached child's entry point. Never called by a user directly; `--__host` is internal. */
export async function runHostMain(argv: string[]): Promise<void> {
  const { short, kind, inv } = parseHostArgv(argv);
  // The child re-parses the forwarded config flags, so hasExplicitPermissionConfig is recomputed here
  // rather than smuggled across in yet another flag. A bare --bg has nothing that can route to `ask`.
  const noHumanSeam = kind === "bg" && !inv.hasExplicitPermissionConfig;
  const host = new SessionHost({
    short, name: process.env.CLAUDE_CODE_SESSION_NAME ?? short, cwd: process.cwd(), kind,
    ...(inv.worktree ? { worktree: inv.worktree } : {}), ...(noHumanSeam ? { noHumanSeam } : {}),
    config: inv.config,
  });
  await host.start();
  try { if (inv.prompt) await host.runTask(inv.prompt); }
  finally { await host.stop(); }
}
