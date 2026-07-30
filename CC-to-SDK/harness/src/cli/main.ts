import { parseCcx, nonLocalWithoutToken } from "./args.js";
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
import { resolveModelAlias } from "../config/models.js";
import { DEFAULTS } from "../config/types.js";
import { parseThinkArg, thinkingConfigFrom } from "../tui/thinkLevels.js";
import { prepareAttach as realPrepareAttach } from "./attach.js";
import { socketAnswers as realSocketAnswers } from "../fleet/liveness.js";
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
  prepareAttach: typeof realPrepareAttach;
  probeSocket: (path: string) => Promise<void>;
  runServe: (inv: CcxInvocation) => Promise<void>;
}
const defaults: MainDeps = {
  runHostMain: realRunHostMain, collectFleet: realCollectFleet, spawnDetached: realSpawnDetached,
  ensureWorktree: realEnsureWorktree, stopSession: realStopSession, rmSession: realRmSession, fleetGc: realFleetGc,
  makeHost: (o) => new SessionHost(o),
  // The React-free guarantee: the import happens only when an interactive path actually calls it.
  runChatClient: async (o) => (await import("../tui/chatMain.js")).runChatClient(o),
  prepareAttach: realPrepareAttach,
  // Wraps the fleet's existing boolean prober (socketAnswers, which already swallows error codes) into
  // the throw-shaped seam attachToImpl expects — no second prober, no expectation of an error code.
  probeSocket: async (p) => {
    if (!(await realSocketAnswers(p))) throw Object.assign(new Error(`no host listening at ${p}`), { code: "HOST_NOT_LISTENING" });
  },
  runOnce: async (inv) => {
    const { createHarness } = await import("../harness.js");
    // --think reached only runForegroundImpl before F4; -p is headless (no REPL /think), so the launch
    // flag is the ONLY way to set it here — same mapping, via the shared helper.
    const thinking = thinkingConfigFrom(inv.think);
    // RunResult.result IS the final string directly (harness.ts's run(): `if ("result" in mm) result =
    // mm.result` copies the SDK result message's own `result` field verbatim, one layer, not two).
    const r = await createHarness({ ...inv.config, ...(thinking ? { thinking } : {}) }).run(inv.prompt!);
    return typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  },
  isTTY: () => Boolean(process.stdin.isTTY),
  // The React-free-equivalent guarantee for the WebSocket stack: `ws` and the whole appserver module tree
  // load only when a `serve` invocation actually reaches this dispatch, never for `-p`/`--bg`/foreground.
  runServe: async (inv) => { const { runServe } = await import("./serveMain.js"); await runServe(inv); },
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

  // Main-level, NOT parseCcx: the detached child re-parses its own argv WITHOUT --detachable but WITH
  // this forwarded flag (spawn.ts's configFlags), so a grammar-level rule would kill every detachable
  // child at startup. Checked before any arm runs, for every command — --idle-timeout parses regardless
  // of subcommand (see args.ts), so `ccx agents --idle-timeout 5` must be refused here too.
  if (inv.idleTimeoutSec && (inv.command !== "run" || !inv.detachable)) return fail("--idle-timeout only applies to --detachable sessions", 2);

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
    case "serve": {
      // Pure, checked before any listener binds (spec §11 last rule): a non-loopback --listen with no
      // --token-file would mean the only copy of the freshly-minted token lives in THIS process's memory,
      // reachable from anywhere on the network with nothing to authenticate against.
      if (nonLocalWithoutToken(inv)) return fail("--listen to a non-localhost host requires --token-file (spec §11)", 1);
      try { await deps.runServe(inv); return 0; } catch (e) { return fail(msg(e), 1); }
    }
    case "attach": {
      // A missing target would otherwise reach prepareAttach's resolveTarget with `undefined`, which
      // reads as "no session matches undefined" — a confusing error for what is really a missing argument.
      if (!inv.target) return fail("attach requires a session: a short id, a session uuid or a name", 2);
      try { return await attachToImpl(inv.target, {}, deps); } catch (e) { return fail(msg(e), 1); }
    }
    case "run": {
      if (inv.detachable && inv.bg) return fail("--detachable and --bg are mutually exclusive", 2);
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
      // --detachable is an ATTACHED session that survives its terminal: spawn it exactly like --bg
      // (fully detached, kind:"interactive"), then attach to it ourselves — the prompt stays with US,
      // not the spawn line, because the client is the one that submits it (spec A2b §3).
      if (inv.detachable) {
        const { short, banner } = deps.spawnDetached({ ...inv, prompt: undefined });
        console.log(banner);
        return await attachToImpl(short, { ...(inv.prompt ? { initialPrompt: inv.prompt } : {}), fromSpawn: true }, deps);
      }
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

/** Retry classification: `fromSpawn` (the --detachable auto-attach) retries BOTH not-yet-resolvable (the
 *  child writes its roster row after fork) and not-yet-listening; a plain `ccx attach` retries NEITHER —
 *  a typo must fail fast, and a resolvable-but-silent socket is `agents`' unresponsive case, not a
 *  startup race. Bounded at 20×250ms ≈ 5s. Same wiring rule as Task 7: called directly with main's live
 *  `deps`, no self-referencing default. */
export async function attachToImpl(target: string, o: { initialPrompt?: string; fromSpawn?: boolean }, deps: MainDeps): Promise<number> {
  let prep;
  for (let i = 0; ; i++) {
    try { prep = await deps.prepareAttach(target); await deps.probeSocket(prep.socketPath); break; }
    catch (e) {
      const retryable = o.fromSpawn && i < 20;
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await deps.runChatClient({
    socketPath: prep.socketPath, client: { kind: "attached", short: prep.short }, cwd: prep.cwd,
    initialLines: prep.initialLines,
    ...(o.initialPrompt ? { initialPrompt: o.initialPrompt } : {}),
    onDetach: () => { console.error(`detached — session ${prep.short} keeps running · reattach: ccx attach ${prep.short}`); },
  });
  return 0;
}

/** Foreground ccx: an IN-PROCESS host + a loopback client over its own socket — exactly one ChatSession
 *  code path, so the daily REPL continuously exercises the attach protocol (spec A2b §3). */
export async function runForegroundImpl(inv: CcxInvocation, deps: MainDeps): Promise<number> {
  // Refused BEFORE any side effect (no env var mutated, no host built): a launch --resume together with
  // a prompt would set BOTH initialResume and initialPrompt on the same ChatClientOpts, and the REPL's
  // busy-guard (Task 6's resumeInto) then blocks the resume with a "cannot resume mid-turn" notice once
  // the submitted initialPrompt starts a turn first — the resume never actually happens. Foreground-only:
  // -p and --bg never reach runForegroundImpl at all.
  if (inv.config.resume && inv.prompt) return fail("--resume with a prompt is not supported — resume, then type your prompt", 2);
  const short = mintShortId(Math.random);
  const name = inv.name ?? short;
  const cwd = inv.config.cwd ?? process.cwd();
  process.env.CLAUDE_CODE_SESSION_NAME = name;       // engine self-registration, same as the fork path
  process.env.CLAUDE_CODE_SESSION_KIND = "interactive";
  // Launch-time thinking budget (the old cc-harness-chat behavior): --think off disables, a level sets
  // the budget, absent leaves the SDK default. thinkBudget/parseThinkArg from ../tui/thinkLevels.js (pure).
  const parsedThink = inv.think ? parseThinkArg(inv.think) : undefined;
  const thinking = thinkingConfigFrom(inv.think);
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
      // initialModel mirrors resolveOptions.ts's rule (alias first, then default) so the REPL knows what the
      // engine is actually running BEFORE the first turn ends. Without it the Tab ladder's `auto` rung reads
      // an undefined model and silently downgrades the session the user asked for. `ccx attach` (above) has
      // no launch config to pass, and useChat handles that unknown by declining to switch at all.
      hookOpts: { initialMode: inv.config.permissionMode ?? "default", initialModel: resolveModelAlias(inv.config.model) ?? DEFAULTS.model, ...(parsedThink ? { initialThink: parsedThink.level } : {}) },
    });
  } finally {
    process.off("SIGHUP", onSignal); process.off("SIGTERM", onSignal);
    await host.stop("done");
  }
  return 0;
}
