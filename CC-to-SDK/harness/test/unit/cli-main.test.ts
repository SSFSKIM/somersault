import { describe, it, expect, vi } from "vitest";
import { main, attachToImpl, ACCOUNT_LABEL_BUDGET_MS } from "../../src/cli/main.js";
import type { MainDeps } from "../../src/cli/main.js";
import { parseCcx } from "../../src/cli/args.js";
import { versionLine } from "../../src/cli/help.js";
import type { CcxInvocation } from "../../src/cli/args.js";
import { spawnDetached } from "../../src/cli/spawn.js";
import { parseHostArgv, hostOptsFrom, runHostMain } from "../../src/cli/hostMain.js";
import type { AgentsRow } from "../../src/fleet/project.js";
import type { prepareAttach as realPrepareAttach } from "../../src/cli/attach.js";
import type { ChatClientOpts } from "../../src/tui/chatMain.js";

// F4's -p mapping lives inside main.ts's own (unexported) default runOnce, which calls createHarness
// directly — the only way to pin that wiring without spawning the real SDK is to mock createHarness
// itself and inspect the config it was called with.
vi.mock("../../src/harness.js", () => ({ createHarness: vi.fn(() => ({ run: async () => ({ result: "ok" }) })) }));

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
    // W-S6: it lists this directory's transcripts and reads the fleet roster. Throwing by default keeps
    // the suite off the machine's real sessions AND makes "main resolved when it should not have" audible.
    resolveResume: async () => { throw new Error("resolveResume must not run"); },
    probeSocket: async () => { throw new Error("probeSocket must not run"); },
    runServe: async () => { throw new Error("runServe must not run"); },
    // Empty by default: no test may read the real ~/.claude/ccx/prefs.json, and a launch with no saved
    // default is the ordinary case anyway (F6 T11-fix).
    loadPrefs: () => ({}),
    // Wave-T T15: a bypass launch is the ONLY thing that reaches it, and no test here launches one — a call
    // from anywhere else is the gate firing where it should not, and must fail by name.
    showBypassConsent: async () => { throw new Error("showBypassConsent must not run"); },
    // The launch clock (t13 review finding 1). NEVER FIRES by default, and that is the point: the suite runs
    // on no real timer at all, and every test that does not care about the account race gets the arm where
    // `accountInfo()` (or its absence) decides. A test that wants the deadline injects `fakeClock().delay`.
    delay: () => new Promise<void>(() => {}),
    ...over,
  };
}
/** The injected launch clock. `delay` PARKS and records the budget it was asked for; `advance()` waits until
 *  the code under test has actually parked its timer, then fires it — the fake-clock equivalent of the wall
 *  clock passing the deadline, with no real `setTimeout` anywhere in the path. */
function fakeClock() {
  const asked: number[] = []; const parked: (() => void)[] = [];
  return { asked,
    delay: (ms: number) => new Promise<void>((go) => { asked.push(ms); parked.push(go); }),
    async advance(): Promise<void> {
      for (let i = 0; i < 500 && parked.length === 0; i++) await new Promise((r) => setImmediate(r));
      parked.splice(0).forEach((go) => go());
    } };
}
const banner = { short: "00000000", banner: "backgrounded · 00000000" };
const FULL = "0d7a7a9d-1111-2222-3333-444455556666";      // what the W-S6 resolver hands back (Task 9)
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
    expect(() => parseCcx(["--__host", "0a1b2c3d", "--__kind", "bg", "task"])).toThrow(/unknown option '--__host'/);
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
  it("maps a forwarded --think into the host config's `thinking` field, for BOTH kinds (F4)", () => {
    // --detachable's child is kind:"interactive" — the mapping must not be bg-only, or a --detachable
    // launch would keep silently dropping the flag even after spawn.ts forwards it.
    const bg = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "--think", "high", "task"]);
    expect(bg.opts.config.thinking).toEqual({ type: "enabled", budgetTokens: 16000 });
    const interactive = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive", "--think", "off"]);
    expect(interactive.opts.config.thinking).toEqual({ type: "disabled" });
  });
  it("leaves `thinking` unset when --think was not given", () => {
    const { opts } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "task"]);
    expect(opts.config.thinking).toBeUndefined();
  });
  // Wave T EP-T1. `--detachable` re-enters the binary as `--__kind interactive` and never passes through
  // main.ts's foreground construction, while spawn.ts's configFlags forwards --permission-mode only when it
  // was explicitly typed — so without the fix here the identical REPL launches in `auto` while plain `ccx`
  // consults. Asserted on hostOptsFrom because runHostMain hands its result to deps.makeHost verbatim, and
  // an interactive runHostMain does not resolve until `finished` does.
  it("an interactive child launches MANUAL like the foreground REPL — and bg is untouched", () => {
    const it_ = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive"]);
    expect(it_.opts.config.permissionMode).toBe("default");
    const bg = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "task"]);
    expect(bg.opts.config.permissionMode).toBeUndefined();   // left to DEFAULTS (`auto`): nobody to ask
  });
  it("an explicitly forwarded --permission-mode still wins for an interactive child", () => {
    const { opts } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive", "--permission-mode", "acceptEdits"]);
    expect(opts.config.permissionMode).toBe("acceptEdits");
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
  it("-p --think maps into the harness config's `thinking` field (F4) — headless print used to silently drop it", async () => {
    const { createHarness } = await import("../../src/harness.js");
    vi.mocked(createHarness).mockClear();
    const { value } = await captureLog(() => main(["-p", "--think", "high", "hi"]));
    expect(value).toBe(0);
    expect(createHarness).toHaveBeenCalledWith(expect.objectContaining({ thinking: { type: "enabled", budgetTokens: 16000 } }));
  });
  it("-p with no --think leaves `thinking` unset — no accidental default budget", async () => {
    const { createHarness } = await import("../../src/harness.js");
    vi.mocked(createHarness).mockClear();
    await captureLog(() => main(["-p", "hi"]));
    const config = vi.mocked(createHarness).mock.calls[0]![0] as Record<string, unknown>;
    expect(config.thinking).toBeUndefined();
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
  // F6 T11-fix. The /model picker's "set as default" writes `prefs.model`; a foreground launch is where
  // that default is READ, and it flows into the host config exactly as --model does.
  it("a saved prefs model becomes the launch model when no --model was typed", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ model: "opus" }),
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.model).toBe("opus");                    // → resolveOptions, same as --model
    expect(clientCalls[0].hookOpts.initialModel).toBe("claude-opus-5"); // …and the REPL's display seed resolves it
  });
  it("--model WINS over the saved default — a flag typed for this run outranks a stored preference", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--model", "sonnet", "task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ model: "opus" }),
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.model).toBe("sonnet");
    expect(clientCalls[0].hookOpts.initialModel).not.toContain("opus");
  });
  it("with no saved default and no --model, the config carries no model at all (resolveOptions decides)", async () => {
    const hostCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async () => {},
    })));
    expect(hostCalls[0].config.model).toBeUndefined();
  });
  // Wave T EP-T1 (qa3-03/qa3-02). The REPL must launch MANUAL like upstream, and the three readers of the
  // launch mode — the host's engine config, the welcome banner, and the client's hookOpts seed — must all
  // report the SAME value. Splitting those apart is how the banner came to print one mode while the engine
  // ran another, so they are asserted together in one test.
  it("a bare foreground run launches in `default`, and host, banner and hookOpts all agree", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.permissionMode).toBe("default");     // the ENGINE consults before rm/git init
    expect(clientCalls[0].hookOpts.initialMode).toBe("default");    // …the status bar says so from turn 0…
    const lines = (clientCalls[0].initialEntries[0].event.lines as { text: string }[]).map((l) => l.text).join("\n");
    expect(lines).toContain("mode  default");                       // …and so does the welcome banner
  });
  it("--permission-mode auto still reaches all three — an explicitly typed mode outranks the manual launch default", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--permission-mode", "auto", "task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.permissionMode).toBe("auto");
    expect(clientCalls[0].hookOpts.initialMode).toBe("auto");
    const lines = (clientCalls[0].initialEntries[0].event.lines as { text: string }[]).map((l) => l.text).join("\n");
    expect(lines).toContain("mode  auto");
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // WAVE C TASK 13 (EP-C8) — qa6-14: the banner said `(default)` while the status bar said
  // `claude-opus-5`. `welcomeBanner` was never the bug — it renders what it is handed (banner.ts:28);
  // the CALL SITE handed it the raw setting, which is why this gate lives here and not in
  // test/tui/banner.test.ts. §C8.7: banner and footer read the SAME resolution, so they cannot disagree.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const bannerText = (call: any): string => (call.initialEntries[0].event.lines as { text: string }[]).map((l) => l.text).join("\n");

  it("the banner names the model the ENGINE resolved, never the raw setting or `(default)`", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, loadPrefs: () => ({ model: "opus" }),
      makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    const text = bannerText(clientCalls[0]);
    expect(text).toContain("claude-opus-5");                             // what hookOpts.initialModel already said
    expect(text).not.toContain("model  opus");                           // …not the alias the user typed
    expect(text).not.toContain("(default)");
    expect(clientCalls[0].hookOpts.initialModel).toBe("claude-opus-5");  // §C8.7: one resolution, two surfaces
  });
  it("with no --model and no saved default the banner still names the harness default, not `(default)`", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(bannerText(clientCalls[0])).toContain("claude-opus-5");
    expect(bannerText(clientCalls[0])).not.toContain("(default)");
  });
  // t13 review finding 4 — the banner must not ASSERT an effort the model may not even have. The clause used
  // to render `config.effort ?? DEFAULTS.effort`, so `ccx --model haiku` printed ` with xHigh effort` about a
  // catalog row that carries no effort axis at all. The banner cannot know support at seed time (no catalog
  // yet), but it can know whether the USER named a level — so that, and only that, is what it claims.
  it("the banner names the effort level only when the launch NAMED one (§C8.3 `ait`)", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--effort", "low", "task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(bannerText(clientCalls[0])).toContain("with Low effort");
    expect(clientCalls[0].hookOpts.initialEffort).toBe("low");
  });
  it("a DEFAULTED launch prints no effort clause at all — `--model haiku` has no effort axis to name", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--model", "haiku", "task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(bannerText(clientCalls[0])).not.toContain("effort");
    // hookOpts still carries DEFAULTS.effort — the §C6.2 hint names what the ENGINE runs, which is a
    // different question from what the banner is entitled to CLAIM about a model it has no catalog for.
    expect(clientCalls[0].hookOpts.initialEffort).toBe("xhigh");
  });
  // The auth segment's four branches are pinned as a pure mapping in test/tui/banner.test.ts; what this
  // file owns is the WIRING — that the fetch happens where the banner seeds, pre-turn, and that a failing
  // fetch costs the banner nothing.
  it("an injected accountInfo double reaches the banner's billing label", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: async () => ({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }) } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(bannerText(clientCalls[0])).toContain("Claude subscription");
  });
  it("a non-firstParty provider prints its own name", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: async () => ({ apiProvider: "bedrock" }) } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(bannerText(clientCalls[0])).toContain("Amazon Bedrock");
  });
  it("a REJECTING accountInfo omits the segment and still launches — the banner never blocks on it", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: async () => { throw new Error("no credentials"); } } as any;
    const { value } = await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(0);
    const text = bannerText(clientCalls[0]);
    expect(text).toContain("claude-opus-5");
    expect(text).not.toContain("no credentials");
    expect(text).not.toContain("undefined");
  });
  // t13 review finding 1 — THE ONE THAT COSTS FIRST PAINT. `accountInfo()` is not a control round-trip: the
  // SDK answers it out of the memoized init payload (`(await this.initialization).account`), so awaiting it
  // bare parks the whole launch on the `claude` CLI's boot + handshake (measured 1152 ms cold, ~450 ms warm)
  // — and an engine that is alive but never completes that handshake would hold the banner FOREVER. Bounded
  // by a raced timer on the injected clock. What the bound is for is the WEDGE; on a healthy engine the
  // label is meant to WIN the race (see the budget assertion below and the fast-double test after it).
  it("a WEDGED accountInfo cannot hold first paint: past the budget the banner seeds without the segment", async () => {
    const clientCalls: any[] = [];
    const clock = fakeClock();
    // Never settles, and never rejects — the mute-engine shape, which `.catch` alone cannot rescue.
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: () => new Promise(() => {}) } as any;
    const run = captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      delay: clock.delay,
    })));
    await clock.advance();                                   // the wall clock passes 1500 ms
    const { value } = await run;
    expect(value).toBe(0);
    expect(clock.asked).toEqual([ACCOUNT_LABEL_BUDGET_MS]);   // one timer, for the budget the module names
    // The VALUE, not just the wiring: t15's keyed acceptance run found A12's label never rendered because
    // 300 ms lost to the ~450 ms warm handshake on every real boot. The budget must clear the cold measure
    // (~1152 ms) or the segment is dead chrome.
    expect(ACCOUNT_LABEL_BUDGET_MS).toBe(1500);
    // The whole line, so "no billing segment" is pinned as the ABSENCE of the ` · X` tail rather than as the
    // absence of one particular label: the model segment runs straight into the mode tail.
    expect(bannerText(clientCalls[0])).toContain("model  claude-opus-5   ·   mode");
  });
  it("a FAST accountInfo still wins the race — the budget bounds the wedge, it does not gate the label", async () => {
    const clientCalls: any[] = [];
    // deps()'s default clock never fires at all, so this label can only have come from the account arm.
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: async () => ({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }) } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(bannerText(clientCalls[0])).toContain("· Claude subscription");
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
  it("--continue hands the REPL the continue INTENT, not an id (Task 9)", async () => {
    // `{kind:"continue"}` is what useChat's mount effect routes to doContinue() — main never resolves the
    // "most recent" session itself, so there is exactly one place that decision is made.
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    const { value } = await captureLog(() => main(["--continue"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(0);
    expect(clientCalls[0].initialResume).toEqual({ kind: "continue" });
    expect(clientCalls[0].initialEntries).toBeUndefined();     // the welcome banner gives way to the resume
  });
  it("hands the REPL the id the RESOLVER returned, not the one the user typed (Task 9)", async () => {
    // The seam returns an id that differs from the argument on purpose: an assertion on a full UUID would
    // pass with the resolver deleted, and this is the only shape that proves main actually consults it.
    const clientCalls: any[] = [];
    const seen: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    const { value } = await captureLog(() => main(["--resume", "0d7a7a9d"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      resolveResume: async (arg, cwd) => { seen.push({ arg, cwd }); return { kind: "session", id: FULL }; },
    })));
    expect(value).toBe(0);
    expect(seen).toEqual([{ arg: "0d7a7a9d", cwd: process.cwd() }]);
    expect(clientCalls[0].initialResume).toEqual({ kind: "id", id: FULL });
  });
  it("fails the launch on an id that names nothing instead of opening a fresh session (Task 9)", async () => {
    const { err, value } = await captureLog(() => main(["--resume", "zzzz"], deps({
      isTTY: () => true, resolveResume: async (arg) => ({ kind: "unknown", arg }),
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("No conversation found with session ID: zzzz");
  });
  it("fails on a roster row that has minted no session id yet, naming that as the reason (Task 9)", async () => {
    const { err, value } = await captureLog(() => main(["--resume", "k3f9"], deps({
      isTTY: () => true, resolveResume: async () => ({ kind: "pending", short: "k3f9" }),
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("Session k3f9 has not started a conversation yet");
  });
  it("points a STILL-RUNNING session at attach rather than resuming it twice (Task 9)", async () => {
    const { err, value } = await captureLog(() => main(["--resume", "k3f9"], deps({
      isTTY: () => true, resolveResume: async () => ({ kind: "live", short: "k3f9" }),
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("Session k3f9 is still running — attach to it instead: ccx attach k3f9");
  });
  it("names the project a foreign roster id belongs to instead of resuming nothing (external review, finding 3)", async () => {
    const { err, value } = await captureLog(() => main(["--resume", "k3f9"], deps({
      isTTY: () => true, resolveResume: async () => ({ kind: "foreign", short: "k3f9", path: "/elsewhere" }),
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("Session k3f9 belongs to another project: /elsewhere — resume it from there");
  });
  it("reports an ambiguous id by its own message, not as 'no conversation found' (Task 9)", async () => {
    const { err, value } = await captureLog(() => main(["--resume", "0d7a"], deps({
      isTTY: () => true, resolveResume: async () => { throw new Error('ambiguous session id "0d7a" — matches: a, b'); },
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("ambiguous session id");
  });
  it("resolves --resume for --bg too, so the detached child is spawned with the FULL id (Task 9)", async () => {
    // spawn.ts's configFlags forwards config.resume verbatim; unresolved, the child would re-parse an
    // 8-char id the SDK cannot resume at all.
    const spawned: any[] = [];
    const { value } = await captureLog(() => main(["--bg", "--resume", "0d7a7a9d", "task"], deps({
      resolveResume: async () => ({ kind: "session", id: FULL }),
      spawnDetached: (inv) => { spawned.push(inv); return banner; },
    })));
    expect(value).toBe(0);
    expect(spawned[0].config.resume).toBe(FULL);
  });
  it("refuses a bad --resume BEFORE cutting a worktree, so nothing is left to unwind (Task 9)", async () => {
    const { err, value } = await captureLog(() => main(["--resume", "zzzz", "--worktree", "wt"], deps({
      isTTY: () => true, resolveResume: async (arg) => ({ kind: "unknown", arg }),
      ensureWorktree: async () => { throw new Error("ensureWorktree must not run"); },
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("No conversation found with session ID");
  });
  it("refuses --continue together with a prompt, for the same busy-guard reason --resume is refused", async () => {
    const clientCalls: any[] = [];
    const { err, value } = await captureLog(() => main(["--continue", "hi"], deps({
      isTTY: () => true, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("--continue with a prompt is not supported");
    expect(clientCalls).toEqual([]);
  });
  it("refuses --continue together with --resume rather than silently preferring one", async () => {
    const { err, value } = await captureLog(() => main(["--continue", "--resume", "abc"], deps({ isTTY: () => true })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("--continue and --resume are mutually exclusive");
  });
  it("refuses --continue on a SUBCOMMAND, which has no session to continue at all", async () => {
    const { err, value } = await captureLog(() => main(["attach", "abc", "-c"], deps({ isTTY: () => true })));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("--continue only applies to a foreground session");
  });
  it("refuses --continue on -p/--bg/--detachable, which have no launch-resume channel at all", async () => {
    // Accepting it there would start a FRESH session and report success — the silent drop, not a refusal.
    for (const argv of [["-c", "-p", "hi"], ["-c", "--bg", "task"], ["-c", "--detachable"]]) {
      const { err, value } = await captureLog(() => main(argv, deps({ isTTY: () => true })));
      expect(value).toBe(2);
      expect(err.join("\n")).toContain("--continue only applies to a foreground session");
    }
  });
  it("--bg still spawns instead of reaching the foreground path, even with isTTY() true", async () => {
    const { out, value } = await captureLog(() => main(["--bg", "task"], deps({ isTTY: () => true, spawnDetached: () => banner })));
    expect(value).toBe(0);
    expect(out).toEqual(["backgrounded · 00000000"]);
  });
});

describe("main — lifecycle and failures", () => {
  it("returns 2 on a parse error rather than throwing out of the process", async () => {
    // A value-domain error — one of the two throws that KEEP exit 2 (see the unknown-option test below).
    const { err, value } = await captureLog(() => main(["--effort", "extreme", "x"], deps()));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("ccx: --effort must be one of");
  });
  it("prints an unknown option in commander's shape and exits 1, unprefixed", async () => {
    // Wave-C T5: exit 2 → 1, and NOT through fail() — upstream writes `error: unknown option '--x'`
    // with no program prefix and no usage block (L392704/L392647).
    const { err, value } = await captureLog(() => main(["--nope"], deps()));
    expect(value).toBe(1);
    expect(err).toEqual(["error: unknown option '--nope'\n(Did you mean --name?)"]);
  });
  it("keeps a recognized-but-unsupported flag at exit 2 with its own refusal", async () => {
    const { err, value } = await captureLog(() => main(["--bg", "--chrome", "x"], deps()));
    expect(value).toBe(2);
    expect(err.join("\n")).toContain("ccx: --chrome is not supported by ccx");
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
  it("serve dispatches to runServe and returns 0", async () => {
    const seen: CcxInvocation[] = [];
    const { value } = await captureLog(() => main(["serve"], deps({ runServe: async (inv) => { seen.push(inv); } })));
    expect(value).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ command: "serve", listen: { host: "127.0.0.1", port: 0 } });
  });
  it("refuses a non-localhost --listen with no --token-file BEFORE calling runServe, exit 1", async () => {
    const { err, value } = await captureLog(() => main(["serve", "--listen", "ws://0.0.0.0:9001"], deps()));
    expect(value).toBe(1);
    expect(err.join("\n")).toMatch(/--token-file/);
  });
  it("a non-localhost --listen WITH --token-file reaches runServe", async () => {
    const seen: CcxInvocation[] = [];
    const { value } = await captureLog(() => main(["serve", "--listen", "ws://0.0.0.0:9001", "--token-file", "/tmp/tok"],
      deps({ runServe: async (inv) => { seen.push(inv); } })));
    expect(value).toBe(0);
    expect(seen).toHaveLength(1);
  });
  it("propagates a runServe failure as exit 1 with its own message", async () => {
    const { err, value } = await captureLog(() => main(["serve"], deps({ runServe: async () => { throw new Error("EADDRINUSE"); } })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("EADDRINUSE");
  });
});

const attachMessages = [{ type: "user", uuid: "u-1", message: { content: [{ type: "text", text: "hi" }] } }] as Record<string, unknown>[];
const prep = (over: Partial<Awaited<ReturnType<typeof realPrepareAttach>>> = {}) =>
  ({ socketPath: "/run/x.sock", short: "w1", cwd: "/repo", initialEntries: attachMessages.map((message) => ({ kind: "sdk" as const, source: "disk" as const, message })), ...over });

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
  // F1 Task 4: one bootstrap channel reaches the client — no parallel initialLines/initialMessages/
  // initialLocalEvents adapter can smuggle a second, differently-ordered history alongside it.
  it("passes the attach ordered bootstrap stream to runChatClient without parallel adapters", async () => {
    const messages = attachMessages;
    const runChatClient = vi.fn(async (_o: ChatClientOpts) => {});
    await main(["attach", "a0000001"], deps({ prepareAttach: async () => prep(), probeSocket: async () => {}, runChatClient }));
    expect(runChatClient).toHaveBeenCalledWith(expect.objectContaining({ initialEntries: expect.arrayContaining([{ kind: "sdk", source: "disk", message: messages[0] }]) }));
    expect(runChatClient.mock.calls[0]![0]).not.toHaveProperty("initialLines"); expect(runChatClient.mock.calls[0]![0]).not.toHaveProperty("initialMessages"); expect(runChatClient.mock.calls[0]![0]).not.toHaveProperty("initialLocalEvents");
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

describe("main — the CLI surface (Wave-C T5)", () => {
  it("prints the version and exits 0 without touching the TTY gate or a host", async () => {
    // Every other dep throws, and isTTY is false — the short circuit is what keeps this at 0 instead of
    // the "foreground ccx needs a terminal" refusal.
    const { out, value } = await captureLog(() => main(["--version"], deps()));
    expect(value).toBe(0);
    expect(out).toEqual([versionLine()]);
  });
  it("prints the help page and exits 0", async () => {
    const { out, value } = await captureLog(() => main(["--help"], deps()));
    expect(value).toBe(0);
    expect(out[0]!.split("\n")[0]).toBe("Usage: ccx [options] [command] [prompt]");
  });
  it("runs doctor as a subcommand and exits 0", async () => {
    const { out, value } = await captureLog(() => main(["doctor"], deps()));
    expect(value).toBe(0);
    expect(out[0]).toContain("ccx doctor");
    expect(out[0]).toContain("No installation issues found.");
  });
  it("prints help rather than the unknown-option error when both are in the argv", async () => {
    // Verified against the real CLI at 2.1.226: `claude --nope --help` prints the help page and exits 0,
    // because commander's `_outputHelpIfRequested` runs before `unknownOption` ever reports.
    const { out, err, value } = await captureLog(() => main(["--nope", "--help"], deps()));
    expect(value).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toContain("Usage: ccx");
  });
  it("prints the version whichever side of the unknown option it lands on", async () => {
    for (const argv of [["--version", "--nope"], ["--nope", "--version"]]) {
      const { out, value } = await captureLog(() => main(argv, deps()));
      expect(value).toBe(0);
      expect(out).toEqual([versionLine()]);
    }
  });
  it("keeps the unknown option at exit 1 when no printer was asked for", async () => {
    const { err, value } = await captureLog(() => main(["--nope"], deps()));
    expect(value).toBe(1);
    expect(err).toEqual(["error: unknown option '--nope'\n(Did you mean --name?)"]);
  });
  it("lets --help outrank a recognized-but-unsupported flag as well", async () => {
    const { out, value } = await captureLog(() => main(["--help", "--chrome"], deps()));
    expect(value).toBe(0);
    expect(out[0]).toContain("Usage: ccx");
  });
  it("short-circuits ABOVE every cross-flag refusal — `ccx -c --resume x --help` still prints help", async () => {
    // --continue + --resume is an exit-2 refusal at main.ts's top. Help must outrank it, the way
    // commander's own help intercept runs before any action does.
    const { out, value } = await captureLog(() => main(["-c", "--resume", "u1", "--help"], deps()));
    expect(value).toBe(0);
    expect(out[0]).toContain("Usage: ccx");
  });
});
