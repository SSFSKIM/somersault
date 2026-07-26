import { describe, it, expect, vi } from "vitest";
import { main } from "../../src/cli/main.js";
import type { MainDeps } from "../../src/cli/main.js";
import { parseCcx } from "../../src/cli/args.js";
import type { CcxInvocation } from "../../src/cli/args.js";
import { spawnDetached } from "../../src/cli/spawn.js";
import { parseHostArgv, hostOptsFrom } from "../../src/cli/hostMain.js";
import type { AgentsRow } from "../../src/fleet/project.js";

/** Every dispatch target throws by default, so a test that reaches the WRONG arm fails by name instead
 *  of quietly doing nothing — and nothing here spawns a process, opens a session or runs git. */
function deps(over: Partial<MainDeps> = {}): MainDeps {
  return {
    runHostMain: async () => { throw new Error("runHostMain must not run"); },
    collectFleet: async () => { throw new Error("collectFleet must not run"); },
    spawnDetached: () => { throw new Error("spawnDetached must not run"); },
    ensureWorktree: async () => { throw new Error("ensureWorktree must not run"); },
    stopSession: async () => { throw new Error("stopSession must not run"); },
    rmSession: async () => { throw new Error("rmSession must not run"); },
    fleetGc: async () => { throw new Error("fleetGc must not run"); },
    ...over,
  };
}
const banner = { short: "00000000", banner: "backgrounded · 00000000" };
function fakeSpawner() {
  const calls: any[] = [];
  return { calls, spawn: (cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts });
    return { pid: 4242, unref: () => {}, on: () => {} };
  } };
}
function captureLog<T>(fn: () => Promise<T>): Promise<{ out: string[]; err: string[]; value: T }> {
  const out: string[] = [], err: string[] = [];
  const l = vi.spyOn(console, "log").mockImplementation((s?: unknown) => { out.push(String(s)); });
  const e = vi.spyOn(console, "error").mockImplementation((s?: unknown) => { err.push(String(s)); });
  return fn().then((value) => ({ out, err, value })).finally(() => { l.mockRestore(); e.mockRestore(); });
}

describe("main — the internal host route", () => {
  it("routes on argv[0], handing the markers to the child entry point untouched", async () => {
    const seen: string[][] = [];
    const argv = ["--__host", "0a1b2c3d", "--__kind", "bg", "task"];
    const code = await main(argv, deps({ runHostMain: async (a) => { seen.push(a); } }));
    expect(code).toBe(0);
    expect(seen[0]).toEqual(argv);
  });
  it("keeps the markers away from parseCcx, which would reject them as unknown flags", () => {
    // The proof that routing must happen BEFORE parsing: this is the argv every detached child boots on.
    expect(() => parseCcx(["--__host", "0a1b2c3d", "--__kind", "bg", "task"])).toThrow(/unknown flag --__host/);
  });
  it("does NOT route a run whose --model value happens to repeat the marker word", async () => {
    // `argv.includes("--__host")` sent this down the host path, where parseHostArgv throws because the
    // marker is not first — a legitimate `ccx --bg --model … task` dying on a stack trace.
    const seen: CcxInvocation[] = [];
    const { value } = await captureLog(() => main(["--bg", "--model", "--__host", "task"],
      deps({ spawnDetached: (inv) => { seen.push(inv); return banner; } })));
    expect(value).toBe(0);
    expect(seen[0]!.config.model).toBe("--__host");
    expect(seen[0]!.prompt).toBe("task");
  });
});

describe("hostOptsFrom — what the detached child derives from its own argv", () => {
  it("FORKS a bg resume instead of resuming the parent session in place", () => {
    // In place the resumed turn keeps the PARENT's uuid, so two roster rows carry one session id:
    // `ccx rm <uuid>` refuses as ambiguous from then on, and the consumer's purge — which only runs when
    // the new uuid differs from the old — silently never fires, so superseded turns accumulate forever.
    const { opts } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "--resume", "u-parent", "task"]);
    expect(opts.config).toMatchObject({ resume: "u-parent", forkSession: true });
    expect(opts.kind).toBe("bg");
  });
  it("does not fork a bg run that has nothing to resume", () => {
    const { opts, prompt } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "task"]);
    expect(opts.config.forkSession).toBeUndefined();
    expect(prompt).toBe("task");
  });
  it("leaves an interactive resume in place — branching is the bg contract, not a global rule", () => {
    const { opts } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive", "--resume", "u-parent"]);
    expect(opts.config).toMatchObject({ resume: "u-parent" });
    expect(opts.config.forkSession).toBeUndefined();
  });
});

describe("main — agents", () => {
  const rows: AgentsRow[] = [
    { id: "aaaaaaaa", sessionId: "u-done", state: "done", status: "idle", cwd: "/repo", name: "w1" },
    { id: "bbbbbbbb", sessionId: "u-live", state: "working", status: "busy", cwd: "/repo", name: "w2" },
  ];
  it("passes --json and --all through, so a FINISHED session is still listed", async () => {
    // doperpowers polls `agents --json --all` until a row reads done. Dropping --all here means the
    // poller never sees the terminal state and waits out its entire limit on work that is over.
    const { out, value } = await captureLog(() => main(["agents", "--json", "--all"], deps({ collectFleet: async () => rows })));
    expect(value).toBe(0);
    const parsed = JSON.parse(out[0]!);
    expect(parsed.map((r: AgentsRow) => r.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });
  it("without --all lists only the unfinished sessions", async () => {
    const { out } = await captureLog(() => main(["agents", "--json"], deps({ collectFleet: async () => rows })));
    expect(JSON.parse(out[0]!).map((r: AgentsRow) => r.id)).toEqual(["bbbbbbbb"]);
  });
  it("prints a JSON array on an empty fleet rather than nothing at all", async () => {
    // The consumer pipes this straight into json.loads; an empty listing must still parse.
    const { out, value } = await captureLog(() => main(["agents", "--json", "--all"], deps({ collectFleet: async () => [] })));
    expect(value).toBe(0);
    expect(JSON.parse(out[0]!)).toEqual([]);
  });
  it("forwards --cwd as the filter, not as a session working directory", async () => {
    const { out } = await captureLog(() => main(["agents", "--json", "--all", "--cwd", "/repo/other"],
      deps({ collectFleet: async () => rows })));
    expect(JSON.parse(out[0]!)).toEqual([]);
  });
});

describe("main — run", () => {
  it("resolves --worktree into the working directory AND records it for the child", async () => {
    const seen: string[][] = [];
    const got: CcxInvocation[] = [];
    const { value } = await captureLog(() => main(["--bg", "--cwd", "/repo", "--worktree", "wt", "task"], deps({
      ensureWorktree: async (repo, name) => { seen.push([repo, name]); return "/repo/.claude/worktrees/wt"; },
      spawnDetached: (inv) => { got.push(inv); return banner; },
    })));
    expect(value).toBe(0);
    expect(seen[0]).toEqual(["/repo", "wt"]);
    expect(got[0]!.config.cwd).toBe("/repo/.claude/worktrees/wt");
    expect(got[0]!.worktreePath).toBe("/repo/.claude/worktrees/wt");
  });
  it("carries the resolved worktree into the child's markers, or `ccx rm` can never clean it up", async () => {
    // End to end through the REAL spawnDetached: the roster row's `worktree` is the only thing rm acts
    // on, and it is written by the child. A path that stops at the parent leaves rm with nothing to do.
    const s = fakeSpawner();
    await captureLog(() => main(["--bg", "--cwd", "/repo", "--worktree", "wt", "task"], deps({
      ensureWorktree: async () => "/repo/.claude/worktrees/wt",
      spawnDetached: (inv) => spawnDetached(inv, { spawn: s.spawn, rand: () => 0 }),
    })));
    const args: string[] = s.calls[0].args;
    const parsed = parseHostArgv(args.slice(process.execArgv.length + 1));
    expect(parsed.worktree).toBe("/repo/.claude/worktrees/wt");
    expect(parsed.inv.prompt).toBe("task");          // the marker must not eat the task
    expect(s.calls[0].opts.cwd).toBe("/repo/.claude/worktrees/wt");
  });
  it("emits no worktree marker when --worktree was not given", async () => {
    const s = fakeSpawner();
    await captureLog(() => main(["--bg", "task"], deps({ spawnDetached: (inv) => spawnDetached(inv, { spawn: s.spawn, rand: () => 0 }) })));
    const parsed = parseHostArgv((s.calls[0].args as string[]).slice(process.execArgv.length + 1));
    expect(parsed.worktree).toBeUndefined();
    expect(parsed.inv.prompt).toBe("task");
  });
  it("prints the banner daemon-spawn.sh greps the short id out of", async () => {
    const { out } = await captureLog(() => main(["--bg", "-n", "w1", "task"], deps({ spawnDetached: () => banner })));
    expect(out[0]).toBe("backgrounded · 00000000");
  });
  it("refuses a PRESENT but empty --worktree instead of quietly skipping the isolation", async () => {
    // `--worktree "$WT"` with WT unset is what produces this, and the guard used to be truthiness: the
    // worktree was skipped ENTIRELY — exit 0, banner printed, session running in the shared checkout that
    // every downstream claim (the banner, the roster row's cwd) says it was isolated from.
    const { out, err, value } = await captureLog(() => main(["--bg", "--worktree", "", "task"], deps({ spawnDetached: () => banner })));
    expect(value).toBe(2);
    expect(out).toEqual([]);                         // nothing spawned, and no banner claiming it was
    expect(err.join("\n")).toContain("--worktree requires a name");
  });
  it("refuses --detachable instead of printing a banner over a host that dies at once", async () => {
    // Routed to the detached spawn it looked like it worked: banner on stdout, exit 0 — but nothing in
    // A1 keeps a host alive with no turn to run, so the child stopped immediately and left a `working`
    // roster row over a dead pid. deps() throws from spawnDetached, so the value of 2 also proves
    // nothing was spawned.
    const { out, err, value } = await captureLog(() => main(["--detachable", "task"], deps()));
    expect(value).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toMatch(/--detachable/);
  });
  it("reports a worktree that could not be prepared and spawns NOTHING", async () => {
    const { err, value } = await captureLog(() => main(["--bg", "--worktree", "wt", "task"],
      deps({ ensureWorktree: async () => { throw new Error("fatal: not a git repository"); } })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("not a git repository");
  });
  it("refuses a foreground run WITHOUT first creating its worktree", async () => {
    // The refusal must come before any side effect: creating the checkout and the branch for a command
    // we then decline leaves an orphan worktree nobody has a row for, so `ccx rm` can never reach it.
    // ensureWorktree throws here, so a value of 2 (rather than 1) is what proves it was never called.
    const { value } = await captureLog(() => main(["--worktree", "wt", "task"], deps()));
    expect(value).toBe(2);
  });
});

describe("main — lifecycle and failures", () => {
  it("returns 2 on a parse error rather than throwing out of the process", async () => {
    const { err, value } = await captureLog(() => main(["--nope"], deps()));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("unknown flag --nope");
  });
  it("refuses a targetless stop/rm, which would otherwise exit 0 having done nothing", async () => {
    // rmSession is silent on "no such session" by design, so `ccx rm` with a missing argument used to
    // report success over a session still on disk.
    for (const cmd of ["stop", "rm"]) {
      const { value } = await captureLog(() => main([cmd], deps()));
      expect(value).toBe(2);
    }
  });
  it("stops and removes by target, returning 0", async () => {
    const stopped: string[] = [], removed: string[] = [];
    expect((await captureLog(() => main(["stop", "w1"], deps({ stopSession: async (t) => { stopped.push(t); } })))).value).toBe(0);
    expect((await captureLog(() => main(["rm", "0a1b2c3d"], deps({ rmSession: async (t) => { removed.push(t); } })))).value).toBe(0);
    expect(stopped).toEqual(["w1"]); expect(removed).toEqual(["0a1b2c3d"]);
  });
  it("returns 1 with the refusal's own words when rm declines to remove a worktree", async () => {
    const { err, value } = await captureLog(() => main(["rm", "w1"],
      deps({ rmSession: async () => { throw new Error("refusing to remove worktree /repo: git worktree remove failed (main working tree)"); } })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("git worktree remove failed");
  });
  it("lists what fleet gc removed", async () => {
    const { out, value } = await captureLog(() => main(["fleet", "gc"], deps({ fleetGc: async () => ["/run/1.sock"] })));
    expect(value).toBe(0);
    expect(out).toEqual(["removed /run/1.sock"]);
  });
  it("says attach is unimplemented instead of failing silently", async () => {
    const { err, value } = await captureLog(() => main(["attach", "w1"], deps()));
    expect(value).toBe(2);
    expect(err.join("\n")).toMatch(/attach/);
  });
});
