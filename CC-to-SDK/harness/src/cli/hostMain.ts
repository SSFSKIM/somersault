import { SessionHost } from "../host/host.js";
import { parseCcx } from "./args.js";

/** The detached child's entry point. Never called by a user directly; `--__host` is internal. */
export async function runHostMain(argv: string[]): Promise<void> {
  const short = argv[argv.indexOf("--__host") + 1];
  const kind = (argv[argv.indexOf("--__kind") + 1] ?? "bg") as "bg" | "interactive";
  const inv = parseCcx(argv.filter((a, i) => !["--__host", "--__kind"].includes(a) && !["--__host", "--__kind"].includes(argv[i - 1])));
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
