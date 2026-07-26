import { parseCcx } from "./args.js";
import type { CcxInvocation } from "./args.js";
import { spawnDetached as realSpawnDetached } from "./spawn.js";
import { runHostMain as realRunHostMain } from "./hostMain.js";
import { collectFleet as realCollectFleet } from "../fleet/index.js";
import type { AgentsRow } from "../fleet/project.js";
import { renderAgents } from "./agents.js";
import { stopSession as realStopSession, rmSession as realRmSession, fleetGc as realFleetGc } from "./lifecycle.js";
import { ensureWorktree as realEnsureWorktree } from "./worktree.js";

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
}
const defaults: MainDeps = {
  runHostMain: realRunHostMain, collectFleet: realCollectFleet, spawnDetached: realSpawnDetached,
  ensureWorktree: realEnsureWorktree, stopSession: realStopSession, rmSession: realRmSession, fleetGc: realFleetGc,
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
      // Refused BEFORE the worktree is created: a checkout and a branch made for a command we then
      // decline are an orphan no roster row names, so `ccx rm` can never reach them. A2 moves this
      // below once the foreground path can actually use what was created.
      // --detachable is an ATTACHED session that survives its terminal, and nothing in A1 keeps a host
      // alive with no turn to run: routed to the detached spawn it printed a success banner and the child
      // stopped immediately, leaving a `working` row over a dead pid for a poller to wait out. Refuse it
      // like attach until A2 brings the client that holds a session up.
      if (inv.detachable) return fail("--detachable ships in plan A2 (it needs the client)", 2);
      if (!inv.bg) return fail("foreground run ships in plan A2 (it needs the client)", 2);
      if (inv.worktree !== undefined) {
        // PRESENT and empty is not the same as absent: `--worktree "$WT"` with WT unset arrives here as "",
        // which the old truthiness guard read as "no worktree asked for" — the run landed in the shared
        // checkout and exited 0 with a banner, isolation requested and silently not delivered.
        if (!inv.worktree.trim()) return fail("--worktree requires a name", 2);
        // Two consumers of the resolved path, both required: config.cwd is what the child process runs
        // in (and what the agents row reports back as its cwd), worktreePath is what the child records
        // on its roster row for `ccx rm`.
        try { inv.worktreePath = await deps.ensureWorktree(inv.config.cwd ?? process.cwd(), inv.worktree); }
        catch (e) { return fail(`could not prepare worktree ${inv.worktree}: ${msg(e)}`, 1); }
        inv.config.cwd = inv.worktreePath;
      }
      console.log(deps.spawnDetached(inv).banner);
      return 0;
    }
    default:
      // Exhaustive TODAY, and `inv.command` is `never` here to keep it that way. A member added to the
      // union without an arm used to fall out of the switch as `undefined`, which bin.ts hands to
      // exitAfterFlush as exit 0 — a command that did nothing, reported as success.
      return fail(`unhandled command ${String(inv.command)}`, 2);
  }
}
