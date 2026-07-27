import { describe, it, expect, vi } from "vitest";
import { main, attachToImpl } from "../../src/cli/main.js";
import type { MainDeps } from "../../src/cli/main.js";
import { parseCcx } from "../../src/cli/args.js";
import type { CcxInvocation } from "../../src/cli/args.js";
import { spawnDetached } from "../../src/cli/spawn.js";
import { parseHostArgv, hostOptsFrom, runHostMain } from "../../src/cli/hostMain.js";
import type { AgentsRow } from "../../src/fleet/project.js";

/** Every dispatch target throws by default, so a test that reaches the WRONG arm fails by name instead
 *  of quietly doing nothing — and nothing here spawns a process, opens a session or runs git.
 *  `isTTY` alone defaults to a plain `() => false` rather than a throw: it is a harmless query the run
 *  arm always calls before deciding fg-refuse vs. runForegroundImpl, so throwing there would make every
 *  OTHER "run" test that doesn't care about it fail for an unrelated reason. */
function deps(over: Partial<MainDeps> = {}): MainDeps {
  return {
    runHostMain: async () => { throw new Error("runHostMain must not run"); },
    collectFleet: async () => { throw new Error("collectFleet must not run"); },
    spawnDetached: () => { throw new Error("spawnDetached must not run"); },
    ensureWorktree: async () => { throw new Error("ensureWorktree must not run"); },
    stopSession: async () => { throw new Error("stopSession must not run"); },
    rmSession: async () => { throw new Error("rmSession must not run"); },
    fleetGc: async () => { throw new Error("fleetGc must not run"); },
    runChatClient: async () => { throw new Error("runChatClient must not run"); },
    makeHost: () => { throw new Error("makeHost must not run"); },
    runOnce: async () => { throw new Error("runOnce must not run"); },
    isTTY: () => false,
    prepareAttach: async () => { throw new Error("prepareAttach must not run"); },
    probeSocket: async () => { throw new Error("probeSocket must not run"); },
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
  it("marks the child detached for BOTH kinds — --__host exists only for forks", () => {
    expect(hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "task"]).opts.detached).toBe(true);
    expect(hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive"]).opts.detached).toBe(true);
  });
  it("an interactive child does NOT surface a prompt, even from a stray positional — --detachable keeps it client-side", () => {
    // A bg child's positional IS its task (see "does not fork a bg run..." above); an interactive
    // child's is not — Task 8's --detachable parent types the prompt at the attached client, never on
    // the spawn line, so a stray positional here must not resurrect the old bg behavior.
    const { prompt } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive", "stray"]);
    expect(prompt).toBeUndefined();
  });
  it("idleTimeoutMs is absent until Task 8 wires --idle-timeout to set inv.idleTimeoutSec", () => {
    const { opts } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive"]);
    expect(opts.idleTimeoutMs).toBeUndefined();
  });
});

describe("runHostMain — interactive hosts stay alive; bg is unchanged", () => {
  /** Every method throws unless overridden, so a call runHostMain should NOT make fails loudly by name. */
  function fakeHost() {
    const calls: string[] = [];
    let resolveFinished!: () => void;
    const finished = new Promise<void>((r) => { resolveFinished = r; });
    return {
      calls, resolveFinished, finished,
      start: async () => { calls.push("start"); },
      runTask: async (p: string) => { calls.push(`runTask:${p}`); },
      stop: async (f?: unknown) => { calls.push(`stop:${String(f)}`); },
    };
  }

  it("for --__kind bg: starts, runs the task, then stops — unchanged from before this task", async () => {
    const h = fakeHost();
    await runHostMain(["--__host", "0a1b2c3d", "--__kind", "bg", "task"], { makeHost: () => h as any });
    expect(h.calls).toEqual(["start", "runTask:task", "stop:undefined"]);
  });

  it("for --__kind interactive: does NOT resolve until `finished` resolves, and never calls stop() itself", async () => {
    const h = fakeHost();
    let resolved = false;
    const p = runHostMain(["--__host", "0a1b2c3d", "--__kind", "interactive"], { makeHost: () => h as any })
      .then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved).toBe(false);
    expect(h.calls).toEqual(["start"]);                          // never called stop() on its own
    h.resolveFinished();                                          // e.g. the idle reaper or a `stop` op fired
    await p;
    process.removeAllListeners("SIGTERM");   // this test's own registration must not leak onto later tests
    expect(resolved).toBe(true);
    expect(h.calls).toEqual(["start"]);                           // still never called stop() itself
  });

  it("SIGTERM stops an interactive host with 'stopped' and lets runHostMain resolve", async () => {
    const h = fakeHost();
    const realStop = h.stop;
    h.stop = async (f?: unknown) => { await realStop(f); h.resolveFinished(); };
    const p = runHostMain(["--__host", "0a1b2c3d", "--__kind", "interactive"], { makeHost: () => h as any });
    await new Promise((r) => setTimeout(r, 10));
    process.emit("SIGTERM");
    await p;
    process.removeAllListeners("SIGTERM");   // this test's own registration must not leak onto later tests
    expect(h.calls).toEqual(["start", "stop:stopped"]);
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
  it("reports a worktree that could not be prepared and spawns NOTHING", async () => {
    const { err, value } = await captureLog(() => main(["--bg", "--worktree", "wt", "task"],
      deps({ ensureWorktree: async () => { throw new Error("fatal: not a git repository"); } })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("not a git repository");
  });
  it("creates the worktree for a FOREGROUND run too — worktree isolation is above the fg/bg split now that this task gives fg a real code path", async () => {
    // Unlike A1 (where any non-bg run was refused before worktree processing ran at all), the worktree
    // block now runs unconditionally: ensureWorktree IS called here even with no --bg, and its resolved
    // path lands in config.cwd before the fg/bg decision is made. isTTY defaults to false (see deps()),
    // so this still exits 2 afterward — proving the worktree was prepared for a run that was then
    // refused only for lack of a terminal, not skipped because it was foreground.
    const seen: string[][] = [];
    const { value } = await captureLog(() => main(["--worktree", "wt", "task"], deps({
      ensureWorktree: async (repo, name) => { seen.push([repo, name]); return "/repo/.claude/worktrees/wt"; },
    })));
    expect(seen[0]).toEqual([process.cwd(), "wt"]);
    expect(value).toBe(2);
  });
});

describe("main — run: foreground (Task 7)", () => {
  it("-p with a prompt calls runOnce and prints its return, spawning no host and no client", async () => {
    const { out, value } = await captureLog(() => main(["-p", "hi"], deps({ runOnce: async (inv) => { expect(inv.prompt).toBe("hi"); return "the answer"; } })));
    expect(value).toBe(0);
    expect(out).toEqual(["the answer"]);
  });
  it("-p with no prompt exits 2 without calling runOnce", async () => {
    const { err, value } = await captureLog(() => main(["-p"], deps()));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("-p requires a prompt");
  });
  it("with isTTY() false, a bare foreground run exits 2 with the terminal message, touching neither makeHost nor runChatClient", async () => {
    const { err, value } = await captureLog(() => main(["task"], deps({ isTTY: () => false })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("needs a terminal");
  });
  it("with isTTY() true, a bare foreground run reaches runForegroundImpl: makeHost gets {kind:'interactive', detached:false}, runChatClient gets {client:{kind:'loopback'}}", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    const { value } = await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(0);
    expect(hostCalls[0]).toMatchObject({ kind: "interactive", detached: false });
    expect(clientCalls[0]).toMatchObject({ client: { kind: "loopback" } });
    expect(clientCalls[0].initialPrompt).toBe("task");
  });
  it("refuses --resume together with a prompt (foreground only), touching neither makeHost nor runChatClient", async () => {
    // A launch --resume + a prompt would set BOTH initialResume and initialPrompt on the client opts;
    // the submitted prompt then starts a turn, and useChat's busy-guard (Task 6) blocks the resume with
    // "cannot resume mid-turn" — the resume never actually happens. Refused before any side effect.
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    const { err, value } = await captureLog(() => main(["--resume", "abc", "hi"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("--resume with a prompt is not supported");
    expect(hostCalls).toEqual([]);
    expect(clientCalls).toEqual([]);
  });
  it("--bg still spawns instead of reaching the foreground path, even with isTTY() true", async () => {
    const { out, value } = await captureLog(() => main(["--bg", "task"], deps({ isTTY: () => true, spawnDetached: () => banner })));
    expect(value).toBe(0);
    expect(out).toEqual(["backgrounded · 00000000"]);
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
});

const prep = (over: Partial<{ socketPath: string; short: string; sessionId?: string; cwd: string; initialLines: { text: string }[] }> = {}) =>
  ({ socketPath: "/run/x.sock", short: "w1", cwd: "/repo", initialLines: [], ...over });

describe("main — attach (Task 8)", () => {
  it("requires a target rather than reaching prepareAttach with undefined", async () => {
    const { err, value } = await captureLog(() => main(["attach"], deps()));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("attach requires a session");
  });
  it("attach <target> resolves via prepareAttach, probes the socket, and reaches runChatClient with client.kind:'attached'", async () => {
    const clientCalls: any[] = [];
    const { value } = await captureLog(() => main(["attach", "w1"], deps({
      prepareAttach: async (target) => { expect(target).toBe("w1"); return prep({ short: "w1", socketPath: "/run/w1.sock" }); },
      probeSocket: async (p) => { expect(p).toBe("/run/w1.sock"); },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(0);
    expect(clientCalls[0]).toMatchObject({ socketPath: "/run/w1.sock", client: { kind: "attached", short: "w1" } });
  });
  it("a prepareAttach failure ('no session matches') is reported as a code-1 refusal, not a stack trace", async () => {
    const { err, value } = await captureLog(() => main(["attach", "nope"], deps({
      prepareAttach: async () => { throw new Error('no session matches "nope"'); },
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("no session matches");
  });
});

describe("attachToImpl — retry classification (Task 8)", () => {
  const mainDeps = (over: Partial<MainDeps> = {}): MainDeps => deps(over);

  it("a plain attach (fromSpawn absent) fails FAST on a resolve failure — no 5s spin", async () => {
    let calls = 0;
    const started = Date.now();
    await expect(attachToImpl("w1", {}, mainDeps({
      prepareAttach: async () => { calls++; throw new Error("no session matches"); },
    }))).rejects.toThrow(/no session matches/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toBe(1);                             // never retried
  });
  it("a plain attach also fails fast when prepareAttach resolves but the socket does not answer", async () => {
    let probeCalls = 0;
    const started = Date.now();
    await expect(attachToImpl("w1", {}, mainDeps({
      prepareAttach: async () => prep(),
      probeSocket: async () => { probeCalls++; throw Object.assign(new Error("no host listening"), { code: "HOST_NOT_LISTENING" }); },
    }))).rejects.toThrow(/no host listening/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(probeCalls).toBe(1);                        // a resolvable-but-silent socket is NOT a startup race
  });
  it("fromSpawn retries past early failures and reaches runChatClient once the host comes up", async () => {
    let calls = 0;
    const clientCalls: any[] = [];
    const code = await attachToImpl("00000000", { fromSpawn: true, initialPrompt: "hi" }, mainDeps({
      prepareAttach: async () => { calls++; if (calls < 3) throw new Error("not found yet"); return prep({ short: "00000000" }); },
      probeSocket: async () => {},
      runChatClient: async (o) => { clientCalls.push(o); },
    }));
    expect(code).toBe(0);
    expect(calls).toBe(3);                              // two failures, then the success on the third try
    expect(clientCalls[0]).toMatchObject({ client: { kind: "attached", short: "00000000" }, initialPrompt: "hi" });
  });
  it("fromSpawn retry is bounded at 20 attempts (21 total calls), then rethrows the last error", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const p = attachToImpl("00000000", { fromSpawn: true }, mainDeps({
        prepareAttach: async () => { calls++; throw new Error("never comes up"); },
      }));
      let rejection: unknown;
      p.catch((e) => { rejection = e; });
      // 21 tries means 20 sleeps of 250ms between them — advance past all of them plus margin.
      for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(250);
      await vi.waitFor(() => expect(rejection).toBeDefined(), { timeout: 1000 });
      expect(calls).toBe(21);
      expect((rejection as Error).message).toBe("never comes up");
    } finally { vi.useRealTimers(); }
  });
});

describe("main — --detachable + --idle-timeout validation and auto-attach (Task 8)", () => {
  it("--idle-timeout without --detachable is refused before any side effect", async () => {
    const { err, value } = await captureLog(() => main(["--idle-timeout", "30", "task"], deps({ isTTY: () => true })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("--idle-timeout only applies to --detachable sessions");
  });
  it("--idle-timeout on a non-run command is refused, even though the parser accepts it there", async () => {
    const { err, value } = await captureLog(() => main(["agents", "--idle-timeout", "30"], deps({ collectFleet: async () => { throw new Error("collectFleet must not run"); } })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("--idle-timeout only applies to --detachable sessions");
  });
  it("--detachable and --bg are refused together, spawning nothing", async () => {
    const { out, err, value } = await captureLog(() => main(["--bg", "--detachable", "task"], deps()));
    expect(value).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("mutually exclusive");
  });
  it("--detachable spawns with prompt:undefined, then auto-attaches passing the ORIGINAL prompt as initialPrompt", async () => {
    const spawnCalls: any[] = [];
    const attachTargets: string[] = [];
    const clientCalls: any[] = [];
    const { out, value } = await captureLog(() => main(["--detachable", "--idle-timeout", "30", "do the thing"], deps({
      spawnDetached: (inv) => { spawnCalls.push(inv); return { short: "12345678", banner: "backgrounded · 12345678" }; },
      prepareAttach: async (target) => { attachTargets.push(target); return prep({ short: "12345678" }); },
      probeSocket: async () => {},
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(0);
    expect(out[0]).toBe("backgrounded · 12345678");
    expect(spawnCalls[0].prompt).toBeUndefined();       // the prompt stays with the client, not the spawn line
    expect(spawnCalls[0].idleTimeoutSec).toBe(30);
    expect(attachTargets[0]).toBe("12345678");           // auto-attach targets the freshly spawned short id
    expect(clientCalls[0]).toMatchObject({ client: { kind: "attached", short: "12345678" }, initialPrompt: "do the thing" });
  });
  it("fromSpawn retry lets the auto-attach survive the child's roster-write race (resolve failure, then success)", async () => {
    let calls = 0;
    const clientCalls: any[] = [];
    const { value } = await captureLog(() => main(["--detachable", "task"], deps({
      spawnDetached: () => ({ short: "12345678", banner: "backgrounded · 12345678" }),
      prepareAttach: async () => { calls++; if (calls < 2) throw new Error("no session matches"); return prep({ short: "12345678" }); },
      probeSocket: async () => {},
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(0);
    expect(calls).toBe(2);                               // the auto-attach path DID retry past the race
    expect(clientCalls[0]).toMatchObject({ client: { kind: "attached", short: "12345678" } });
  });
});
