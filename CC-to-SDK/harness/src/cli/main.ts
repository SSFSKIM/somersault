import { parseCcx } from "./args.js";
import type { CcxInvocation } from "./args.js";
import { spawnDetached as realSpawnDetached } from "./spawn.js";
import { runHostMain as realRunHostMain } from "./hostMain.js";
import { collectFleet as realCollectFleet } from "../fleet/index.js";
import type { AgentsRow } from "../fleet/project.js";
import { renderAgents } from "./agents.js";
import { stopSession as realStopSession, rmSession as realRmSession, fleetGc as realFleetGc } from "./lifecycle.js";
import { ensureWorktree as realEnsureWorktree } from "./worktree.js";
import { SessionHost } from "../host/host.js";
import type { SessionHostOpts } from "../host/host.js";
import { mintShortId, hostSocketPath } from "../fleet/paths.js";
import { welcomeBanner } from "../tui/banner.js";
import { parseThinkArg } from "../tui/thinkLevels.js";
// type-only: main.ts stays React-free. The ink import happens only inside the DEFAULT runChatClient,
// via a dynamic import — an interactive path that never runs (e.g. every non-TTY/-p/--bg invocation)
// never pulls ink/React into the process at all.
import type { ChatClientOpts } from "../tui/chatMain.js";

/** One entry per dispatch target. Injected so a unit test can exercise the ROUTING without spawning a
 *  process, opening an SDK session, touching the real fleet directory or running git. */
export interface MainDeps {
  runHostMain: (argv: string[]) => Promise<void>;
  collectFleet: () => Promise<AgentsRow[]>;
  spawnDetached: (inv: CcxInvocation) => { short: string; banner: string };
  ensureWorktree: (repo: string, name: string) => Promise<string>;
  stopSession: (target: string) => Promise<void>;
  rmSession: (target: string) => Promise<void>;
  fleetGc: () => Promise<string[]>;
  runChatClient: (o: ChatClientOpts) => Promise<void>;
  makeHost: (o: SessionHostOpts) => SessionHost;
  runOnce: (inv: CcxInvocation) => Promise<string>;
  isTTY: () => boolean;
}
const defaults: MainDeps = {
  runHostMain: realRunHostMain, collectFleet: realCollectFleet, spawnDetached: realSpawnDetached,
  ensureWorktree: realEnsureWorktree, stopSession: realStopSession, rmSession: realRmSession, fleetGc: realFleetGc,
  makeHost: (o) => new SessionHost(o),
  // The React-free guarantee: the import happens only when an interactive path actually calls it.
  runChatClient: async (o) => (await import("../tui/chatMain.js")).runChatClient(o),
  runOnce: async (inv) => {
    const { createHarness } = await import("../harness.js");
    // RunResult.result IS the final string directly (harness.ts's run(): `if ("result" in mm) result =
    // mm.result` copies the SDK result message's own `result` field verbatim, one layer, not two).
    const r = await createHarness(inv.config).run(inv.prompt!);
    return typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  },
  isTTY: () => Boolean(process.stdin.isTTY),
};

const msg = (e: unknown): string => (e as Error)?.message ?? String(e);
/** ONE stderr shape for the whole program — `ccx: <what went wrong>` — so a parse error, a refusal and a
 *  throw caught at the top level in bin.ts all read the same way to an operator tailing a daemon's log. */
const fail = (text: string, code: number): number => { console.error(`ccx: ${text}`); return code; };

/** Returns the exit code; never throws for an operator error. Everything a consumer script reads —
 *  the banner on stdout, the refusal on stderr, the code — is decided here. */
export async function main(argv: string[], deps: MainDeps = defaults): Promise<number> {
  // POSITIONAL, matching parseHostArgv's own contract. `argv.includes("--__host")` reads a marker out of
  // any position, so `ccx --bg --model --__host task` — a legitimate run whose model value repeats the
  // word — was routed to the child entry point, where it throws because the marker is not first.
  if (argv[0] === "--__host") { await deps.runHostMain(argv); return 0; }
  let inv: CcxInvocation;
  try { inv = parseCcx(argv); } catch (e) { return fail(msg(e), 2); }

  switch (inv.command) {
    case "agents":
      // --all and --cwd travel UNCHANGED: doperpowers polls `agents --json --all` until a row reads a
      // terminal state, so a dropped --all hides the very answer it is waiting for.
      console.log(renderAgents(await deps.collectFleet(),
        { json: inv.json, all: inv.all, ...(inv.cwdFilter ? { cwdFilter: inv.cwdFilter } : {}) }));
      return 0;
    case "stop": case "rm": {
      // rm is deliberately silent on a session it cannot find, so a MISSING target would exit 0 having
      // removed nothing — success, over a session still on disk. Refuse before we get there.
      if (!inv.target) return fail(`${inv.command} requires a session: a short id, a session uuid or a name`, 2);
      try { await (inv.command === "stop" ? deps.stopSession : deps.rmSession)(inv.target); return 0; }
      catch (e) { return fail(msg(e), 1); }
    }
    case "gc":
      for (const p of await deps.fleetGc()) console.log(`removed ${p}`);
      return 0;
    case "attach":
      return fail("attach ships in plan A2", 2);
    case "run": {
      if (inv.worktree !== undefined) {
        // PRESENT and empty is not the same as absent: `--worktree "$WT"` with WT unset arrives here as "",
        // which the old truthiness guard read as "no worktree asked for" — the run landed in the shared
        // checkout and exited 0 with a banner, isolation requested and silently not delivered.
        if (!inv.worktree.trim()) return fail("--worktree requires a name", 2);
        // Two consumers of the resolved path, both required: config.cwd is what the (bg-spawned or
        // in-process) session runs in, worktreePath is what the roster row records for `ccx rm`. Above
        // the fg/bg split (unlike A1) because a FOREGROUND run needs its own cwd exactly as much as a
        // detached one now that this task gives it a real code path.
        try { inv.worktreePath = await deps.ensureWorktree(inv.config.cwd ?? process.cwd(), inv.worktree); }
        catch (e) { return fail(`could not prepare worktree ${inv.worktree}: ${msg(e)}`, 1); }
        inv.config.cwd = inv.worktreePath;
      }
      if (inv.bg) { console.log(deps.spawnDetached(inv).banner); return 0; }
      // --detachable is an ATTACHED session that survives its terminal; Task 8 is the one that brings
      // the attach client, replacing this line.
      if (inv.detachable) return fail("--detachable ships in Task 8 (it needs attach)", 2);
      if (inv.print) {
        // -p: one-shot headless print — the `cc-harness "<prompt>"` shape folded into ccx (contract table).
        if (!inv.prompt) return fail("-p requires a prompt", 2);
        console.log(await deps.runOnce(inv));
        return 0;
      }
      if (!deps.isTTY()) return fail("foreground ccx needs a terminal (use -p or --bg for scripts)", 2);
      return await runForegroundImpl(inv, deps);
    }
    default:
      // Exhaustive TODAY, and `inv.command` is `never` here to keep it that way. A member added to the
      // union without an arm used to fall out of the switch as `undefined`, which bin.ts hands to
      // exitAfterFlush as exit 0 — a command that did nothing, reported as success.
      return fail(`unhandled command ${String(inv.command)}`, 2);
  }
}

/** Foreground ccx: an IN-PROCESS host + a loopback client over its own socket — exactly one ChatSession
 *  code path, so the daily REPL continuously exercises the attach protocol (spec A2b §3). */
export async function runForegroundImpl(inv: CcxInvocation, deps: MainDeps): Promise<number> {
  const short = mintShortId(Math.random);
  const name = inv.name ?? short;
  const cwd = inv.config.cwd ?? process.cwd();
  process.env.CLAUDE_CODE_SESSION_NAME = name;       // engine self-registration, same as the fork path
  process.env.CLAUDE_CODE_SESSION_KIND = "interactive";
  // Launch-time thinking budget (the old cc-harness-chat behavior): --think off disables, a level sets
  // the budget, absent leaves the SDK default. thinkBudget/parseThinkArg from ../tui/thinkLevels.js (pure).
  const parsedThink = inv.think ? parseThinkArg(inv.think) : undefined;
  const thinking = parsedThink ? (parsedThink.budget === 0 ? { type: "disabled" as const } : { type: "enabled" as const, budgetTokens: parsedThink.budget }) : undefined;
  // Launch resume goes to the CLIENT (initialResume → resumeInto → the adapter's resume op), NOT into
  // the host's config: one resume code path, and the incr-9 replay behavior survives the cutover.
  const { resume, ...hostConfig } = inv.config;
  const host = deps.makeHost({
    short, name, cwd, kind: "interactive", detached: false,
    ...(inv.worktreePath ? { worktree: inv.worktreePath } : {}),
    config: { ...hostConfig, ...(thinking ? { thinking } : {}) },
  });
  await host.start();
  // Terminal gone or OS says stop: finalize `done` — the deliberate asymmetry (acceptance 10): a default
  // session's life IS its terminal's. stop() is memoized+bounded, so double signals are safe.
  const onSignal = () => { void host.stop("done").finally(() => process.exit(0)); };
  process.on("SIGHUP", onSignal); process.on("SIGTERM", onSignal);
  try {
    await deps.runChatClient({
      socketPath: hostSocketPath(process.pid), client: { kind: "loopback" }, cwd,
      ...(inv.prompt ? { initialPrompt: inv.prompt } : {}),
      ...(resume ? { initialResume: { kind: "id" as const, id: resume } } : { initialLines: welcomeBanner({ cwd, model: inv.config.model, mode: inv.config.permissionMode ?? "default" }) }),
      hookOpts: { initialMode: inv.config.permissionMode ?? "default", ...(parsedThink ? { initialThink: parsedThink.level } : {}) },
    });
  } finally {
    process.off("SIGHUP", onSignal); process.off("SIGTERM", onSignal);
    await host.stop("done");
  }
  return 0;
}
