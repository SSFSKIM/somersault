import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
// F8 T8 — the checklist's call-site wiring is proven through a REAL directory (`--cwd`), not a deps seam:
// main.ts reads opendirSync/existsSync/homedir directly (no injection point exists or is warranted for a
// plain fs/os read), so a temp dir plus the real `homedir()` is the only way to reach the fact through the
// actual chain rather than handing it to a seam.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// F4's -p mapping lives inside main.ts's own (unexported) default runOnce, which calls createHarness
// directly — the only way to pin that wiring without spawning the real SDK is to mock createHarness
// itself and inspect the config it was called with.
vi.mock("../../src/harness.js", () => ({ createHarness: vi.fn(() => ({ run: async () => ({ result: "ok" }) })) }));

// A foreground `main` registers SIGINT/SIGTERM/SIGHUP (`cli/main.ts:418`) and `runHostMain` registers
// SIGTERM, and neither removes them — harmless in a process that is about to exit, a leak in a runner that
// outlives the launch: a stale handler from an earlier test drains an array whose session is long gone, and
// past ten of them Node starts warning. Drop exactly what a test added; the runner's own handlers (vitest
// owns SIGINT) are snapshotted per test and never touched.
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let ownedBefore: Record<string, unknown[]> = {};
beforeEach(() => { ownedBefore = Object.fromEntries(SIGNALS.map((s) => [s, process.listeners(s)])); });
afterEach(() => {
  for (const s of SIGNALS) for (const l of process.listeners(s)) if (!ownedBefore[s]!.includes(l)) process.off(s, l as never);
});

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
    // F8 T7 review finding — the seam that replaces the bare `process.stdout.rows` read the vitest worker
    // can never supply (it is `undefined` under every pool, pipe or pty alike). `undefined` is also the
    // suite's actual truth, so every existing banner test stays on the full-box arm exactly as before.
    rows: () => undefined,
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
  // F9 T-AUTO A1. `--detachable` re-enters the binary as `--__kind interactive` and never passes through
  // main.ts's foreground construction. Both constructors now run the SAME resolver (launchMode.ts) over
  // the SAME effective model, so a bare launch (no forwarded --model, DEFAULTS.model is auto-capable)
  // lands `auto` here exactly as it does in runForegroundImpl. Asserted on hostOptsFrom because
  // runHostMain hands its result to deps.makeHost verbatim, and an interactive runHostMain does not
  // resolve until `finished` does.
  it("a bare interactive child launches auto like the foreground REPL — and bg is untouched", () => {
    const it_ = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive"]);
    expect(it_.opts.config.permissionMode).toBe("auto");
    const bg = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "bg", "task"]);
    expect(bg.opts.config.permissionMode).toBeUndefined();   // left to DEFAULTS (`auto`): nobody to ask
  });
  // The model-gate side of the same resolver: spawn.ts's configFlags forwards --model only when the flag
  // was explicitly typed OR (Task 1) main.ts materialized the effective flag-or-saved-pref model before
  // spawning a --detachable child — either way it arrives here as inv.config.model, and a non-auto-capable
  // one degrades this child to `default` with the model left untouched, the same no-silent-swap rule
  // runForegroundImpl/resolveOptions.ts's explicit-auto gate follow.
  it("an interactive child with a forwarded non-auto-capable --model launches default, model untouched", () => {
    const { opts } = hostOptsFrom(["--__host", "0a1b2c3d", "--__kind", "interactive", "--model", "claude-haiku-4-5-20251001"]);
    expect(opts.config.permissionMode).toBe("default");
    expect(opts.config.model).toBe("claude-haiku-4-5-20251001");
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
  // F10 T-MAINT item 2 (F9 ledger Minor, r4 §2): an ordinary `ccx` launch used to read prefs.json off
  // disk TWICE — `needsBypassConsent` (main.ts:338) for the launch-mode resolution, then
  // `runForegroundImpl` (main.ts:428) for the same model, plus a third time inside
  // `unconsentedBypassLaunch` on a bypass launch. Inefficiency only, never a correctness bug — but a
  // read count is exactly the kind of thing that only stays fixed if something counts it.
  it("reads prefs exactly ONCE per launch, however many gates ask for it", async () => {
    let reads = 0;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      loadPrefs: () => { reads++; return { model: "opus" }; },
      makeHost: () => ({ start: async () => {}, stop: async () => {} }) as any,
      runChatClient: async () => {},
    })));
    expect(reads).toBe(1);
  });
  // The other half of the guarantee: memoising must not turn a launch that needs NO prefs into one that
  // reads them anyway. `-p` answers out of its invocation alone.
  it("a headless -p launch reads prefs zero times", async () => {
    let reads = 0;
    await captureLog(() => main(["-p", "task"], deps({
      loadPrefs: () => { reads++; return {}; },
      runOnce: async () => "answer",
    })));
    expect(reads).toBe(0);
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
  // bl7 T-ADVISOR task 1 — advisorModel rides model's exact flag-or-saved-pref merge (main.ts:441),
  // default OFF: absent config.advisorModel and no saved pref means the field never reaches host.config.
  it("a saved prefs advisorModel becomes the launch config when no --advisor-model was typed", async () => {
    const hostCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ advisorModel: "claude-opus-4-8" }),
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async () => {},
    })));
    expect(hostCalls[0].config.advisorModel).toBe("claude-opus-4-8");
  });
  it("--advisor-model WINS over the saved default", async () => {
    const hostCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--advisor-model", "claude-sonnet-4-8", "task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ advisorModel: "claude-opus-4-8" }),
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async () => {},
    })));
    expect(hostCalls[0].config.advisorModel).toBe("claude-sonnet-4-8");
  });
  it("with no saved default and no --advisor-model, the config carries no advisorModel at all (default OFF)", async () => {
    const hostCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async () => {},
    })));
    expect(hostCalls[0].config.advisorModel).toBeUndefined();
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
  // T-EFFORT — the model precedent's exact twin (`cli/main.ts`'s `persistedEffort`). WIRING TEST: this is
  // the only place a seeded prefs effort reaches `hookOpts.initialEffort` through the REAL launch function,
  // not a hand-built object — delete `persistedEffort` (or its `?? ` in the `hookOpts` line) and this test
  // goes red, proving the seam is load-bearing rather than decorative.
  it("a saved prefs effort becomes the launch effort when no --effort was typed", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ effort: "medium" }),
      makeHost: () => fakeHost,
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(clientCalls[0].hookOpts.initialEffort).toBe("medium");
  });
  it("--effort WINS over the saved default — a flag typed for this run outranks a stored preference", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--effort", "low", "task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ effort: "medium" }),
      makeHost: () => fakeHost,
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(clientCalls[0].hookOpts.initialEffort).toBe("low");
  });
  // Canon's own read-back filter (`Qdt`), applied on the READ side too: a hand-edited "max" in prefs.json
  // must not silently become every future session's default the way a `/effort max` write never could.
  it("a hand-edited, non-persistable saved effort (max) is ignored and the harness default wins", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ effort: "max" }),
      makeHost: () => fakeHost,
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(clientCalls[0].hookOpts.initialEffort).toBe("xhigh");   // DEFAULTS.effort, not "max"
  });
  it("with no saved default and no --effort, the harness default (xhigh) is used", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      makeHost: () => fakeHost,
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(clientCalls[0].hookOpts.initialEffort).toBe("xhigh");
  });
  // F9 T-AUTO A1 (qa3-03 reversal; qa3-02 stays fixed). The REPL now launches AUTO by default — the
  // benchmark qa3-03/EP-T1 was written against has moved (canon's own auto rollout, the owner's own
  // settings.json) — and the three readers of the launch mode — the host's engine config, the welcome
  // banner, and the client's hookOpts seed — must all still report the SAME value. Splitting those apart
  // is how the banner came to print one mode while the engine ran another, so they are asserted together.
  it("a bare foreground run launches in `auto`, and host, banner and hookOpts all agree", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.permissionMode).toBe("auto");        // DEFAULTS.model is auto-capable
    expect(clientCalls[0].hookOpts.initialMode).toBe("auto");       // …the status bar says so from turn 0…
    const lines = (clientCalls[0].initialEntries[0].event.lines as { text: string }[]).map((l) => l.text).join("\n");
    expect(lines).toContain("mode  auto");                          // …and so does the welcome banner
  });
  // The no-silent-swap cell (R5 §5 item 3): a defaulted (non-explicit) auto is gated on the PREDICATE
  // isAutoSupportedModel, never the transformer resolveAutoModel — so an explicit --model naming a
  // non-auto-capable model degrades the launch to `default` instead of silently swapping the model.
  it("--model claude-haiku-4-5-20251001 launches `default` everywhere, and the model is NEVER swapped", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--model", "claude-haiku-4-5-20251001", "task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.permissionMode).toBe("default");
    expect(hostCalls[0].config.model).toBe("claude-haiku-4-5-20251001");
    expect(clientCalls[0].hookOpts.initialMode).toBe("default");
    expect(clientCalls[0].hookOpts.initialModel).toBe("claude-haiku-4-5-20251001");
    const lines = (clientCalls[0].initialEntries[0].event.lines as { text: string }[]).map((l) => l.text).join("\n");
    expect(lines).toContain("mode  default");
  });
  it("--permission-mode auto still reaches all three — an explicit mode outranks the model-gated default", async () => {
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
  // New sibling of the auto cell above (R5 §5): an explicit `--permission-mode default` must still pin
  // Manual everywhere, even though the launch default is now auto — explicit always wins.
  it("--permission-mode default still reaches all three, overriding the new auto launch default", async () => {
    const hostCalls: any[] = [];
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["--permission-mode", "default", "task"], deps({
      isTTY: () => true,
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async (o) => { clientCalls.push(o); },
    })));
    expect(hostCalls[0].config.permissionMode).toBe("default");
    expect(clientCalls[0].hookOpts.initialMode).toBe("default");
    const lines = (clientCalls[0].initialEntries[0].event.lines as { text: string }[]).map((l) => l.text).join("\n");
    expect(lines).toContain("mode  default");
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
  // F8 T7 — the degraded-branch WIRING. test/tui/banner.test.ts pins welcomeBanner's own branch by handing
  // it rows/screenReader directly, which stays green even if the call site here never passes them at all
  // (this wave's Global Constraint — the previous task shipped exactly that gap). This is the arm that can
  // only pass by the launch actually reading `screenReaderEnabled(process.env)` and threading it through.
  it("a screen-reader launch reaches the CALL SITE and collapses the banner to its degraded line", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    vi.stubEnv("CLAUDE_AX_SCREEN_READER", "1");
    try {
      await captureLog(() => main(["task"], deps({
        isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      })));
    } finally { vi.unstubAllEnvs(); }
    const lines = clientCalls[0].initialEntries[0].event.lines as { text: string; segments?: unknown }[];
    expect(lines).toHaveLength(1);                       // the full box is many lines; this proves collapse
    expect(lines[0]!.segments).toBeTruthy();              // the two-span shape, not a plain text degrade
    expect(bannerText(clientCalls[0])).not.toContain("Tips for getting started");
  });
  // F8 T7 review finding — the OTHER degraded arm, driven through the `deps.rows()` seam instead of an env
  // var. `process.stdout.rows` is `undefined` in every vitest worker, so this is the only way to prove the
  // call site actually reads the injected height rather than a bare global (sabotage-verified: deleting
  // `rows: deps.rows()` at the call site turns this test red).
  it("a short-terminal launch (deps.rows() below BANNER_MIN_ROWS) reaches the call site and collapses the banner", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      rows: () => 24,
    })));
    const lines = clientCalls[0].initialEntries[0].event.lines as { text: string; segments?: unknown }[];
    expect(lines).toHaveLength(1);                       // the full box is many lines; this proves collapse
    expect(lines[0]!.segments).toBeTruthy();              // the two-span shape, not a plain text degrade
    expect(bannerText(clientCalls[0])).not.toContain("Tips for getting started");
  });
  // F8 T8 — the checklist's CALL-SITE wiring. test/tui/banner.test.ts pins startupTips/renderTips/
  // welcomeBanner as pure functions handed their facts directly, which stays green even if main.ts never
  // computes emptyWorkspace/hasClaudeMd/inHomeDir at all (this wave's Global Constraint, shipped twice
  // already). These two tests reach the facts through the REAL chain: `--cwd` points the launch at a
  // directory this test controls, and main.ts's own `opendirSync`/`existsSync`/`homedir()` reads decide
  // what the banner sees — nothing here hands the banner a fact it didn't derive itself.
  describe("the checklist facts (Task 8), reached through --cwd rather than handed in", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ccx-cwd-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    // The home-directory note is coupled to the checklist's OWN completion (banner.ts finding B: canon
    // hides the whole section, note included, once the checklist is done) — so these two tests point $HOME
    // at a FRESH, empty temp directory (real `homedir()` still reads it, via POSIX's own $HOME lookup) rather
    // than the tester's actual home, which may already hold a CLAUDE.md and would otherwise make this test's
    // outcome depend on whoever's machine it runs on.
    it("inHomeDir: a launch whose --cwd IS the real home directory appends the home-directory note", async () => {
      const fakeHome = mkdtempSync(join(tmpdir(), "ccx-home-"));
      vi.stubEnv("HOME", fakeHome);
      try {
        const clientCalls: any[] = [];
        const fakeHost = { start: async () => {}, stop: async () => {} } as any;
        await captureLog(() => main(["--cwd", homedir(), "task"], deps({
          isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
        })));
        expect(bannerText(clientCalls[0])).toContain("launched ccx in your home directory");
      } finally { vi.unstubAllEnvs(); rmSync(fakeHome, { recursive: true, force: true }); }
    });
    it("inHomeDir: a launch --cwd'd at an ordinary temp directory omits the note", async () => {
      const clientCalls: any[] = [];
      const fakeHost = { start: async () => {}, stop: async () => {} } as any;
      await captureLog(() => main(["--cwd", dir, "task"], deps({
        isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      })));
      expect(bannerText(clientCalls[0])).not.toContain("home directory");
    });
    // Review finding D: `inHomeDir` used to compare the RAW --cwd value, so a trailing slash — what shell
    // tab-completion produces (`--cwd ~/`) — survived string equality as a mismatch and silently suppressed
    // the note. `resolve(cwd)` normalizes it away.
    it("inHomeDir: a trailing slash on --cwd (tab-completion's own output) still resolves to home", async () => {
      const fakeHome = mkdtempSync(join(tmpdir(), "ccx-home-"));
      vi.stubEnv("HOME", fakeHome);
      try {
        const clientCalls: any[] = [];
        const fakeHost = { start: async () => {}, stop: async () => {} } as any;
        await captureLog(() => main(["--cwd", homedir() + "/", "task"], deps({
          isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
        })));
        expect(bannerText(clientCalls[0])).toContain("launched ccx in your home directory");
      } finally { vi.unstubAllEnvs(); rmSync(fakeHome, { recursive: true, force: true }); }
    });
    it("emptyWorkspace/hasClaudeMd: an empty --cwd offers the workspace tip", async () => {
      const clientCalls: any[] = [];
      const fakeHost = { start: async () => {}, stop: async () => {} } as any;
      await captureLog(() => main(["--cwd", dir, "task"], deps({
        isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      })));
      const text = bannerText(clientCalls[0]);
      expect(text).toContain("Ask Claude to create a new app or clone a repository");
      expect(text).not.toContain("/init");
    });
    // Review finding B (red→green): the ONLY enabled tip here (claudemd) is now complete, so the whole
    // checklist section hides — a permanently-ticked "Run /init" line was the defect this fix removes.
    it("emptyWorkspace/hasClaudeMd: a --cwd holding a real CLAUDE.md hides the checklist entirely", async () => {
      writeFileSync(join(dir, "CLAUDE.md"), "# notes\n");
      const clientCalls: any[] = [];
      const fakeHost = { start: async () => {}, stop: async () => {} } as any;
      await captureLog(() => main(["--cwd", dir, "task"], deps({
        isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      })));
      const text = bannerText(clientCalls[0]);
      expect(text).not.toContain("Tips for getting started");
      expect(text).not.toContain("/init");
      expect(text).not.toContain("✔");
    });
    // Review finding E (red→green): canon's `opendir`-based probe sees dotfiles, so a directory holding
    // ONLY `.git` is not an empty workspace — the former `readdirSync().filter(dotfile)` disagreed and
    // offered the "create a new app" tip over a real repository.
    it("emptyWorkspace: a --cwd holding only a .git directory is NOT an empty workspace (finding E)", async () => {
      mkdirSync(join(dir, ".git"));
      const clientCalls: any[] = [];
      const fakeHost = { start: async () => {}, stop: async () => {} } as any;
      await captureLog(() => main(["--cwd", dir, "task"], deps({
        isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      })));
      const text = bannerText(clientCalls[0]);
      expect(text).not.toContain("Ask Claude to create a new app or clone a repository");
      expect(text).toContain("Run /init to create a CLAUDE.md file with instructions for Claude");
    });
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

  // F10 T-MAINT item 1 — THE LOST ANSWER, RECOVERED. The banner's budget is the same 1500 ms and it still
  // loses here; what changed is that losing it no longer destroys the fact. The SAME promise, unraced,
  // reaches the REPL through `hookOpts.accountBridge`, so the auto-mode notice can still learn the user is
  // on a subscription after the banner has given up on saying so.
  it("a SLOW accountInfo loses the banner race but still reaches the REPL through the account bridge", async () => {
    const clientCalls: any[] = [];
    const clock = fakeClock();
    let settle!: (f: unknown) => void;
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: () => new Promise((r) => { settle = r; }) } as any;
    const run = captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
      delay: clock.delay,
    })));
    await clock.advance();                                                   // the 1500 ms budget elapses first
    await run;
    expect(bannerText(clientCalls[0])).toContain("model  claude-opus-5   ·   mode");   // no billing segment
    expect(clientCalls[0].hookOpts.initialTokenSource).toBeUndefined();      // …and the old channel is empty
    settle({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" });     // the handshake finally lands
    await expect(clientCalls[0].hookOpts.accountBridge.read())
      .resolves.toEqual({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" });
  });

  it("a rejecting accountInfo leaves the bridge answering undefined, and never as an unhandled rejection", async () => {
    const clientCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {}, accountInfo: async () => { throw new Error("no credentials"); } } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
    })));
    await expect(clientCalls[0].hookOpts.accountBridge.read()).resolves.toBeUndefined();
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
  it("fails on a roster row holding no conversation, naming BOTH states the absent id can mean (Task 9)", async () => {
    // The sentence used to say "has not started a conversation yet", which was the only meaning an absent
    // roster `sessionId` had before A1 made the field a liveness claim. A host that `/clear`s now lands
    // here too, and it demonstrably HAS started one — so the row asserts the reason is stated as the pair
    // the roster genuinely cannot distinguish, rather than as the half that happens to be older.
    const { err, value } = await captureLog(() => main(["--resume", "k3f9"], deps({
      isTTY: () => true, resolveResume: async () => ({ kind: "pending", short: "k3f9" }),
    })));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("Session k3f9 holds no conversation to resume");
    expect(err.join("\n")).toContain("/clear discarded the one it had");
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

  // ── FSW T6 — THE SIGNAL INTERLOCK (spec §A3) ────────────────────────────────────────────────────────
  // `process.exit` skips `runChatClient`'s `finally`, so the REPL's terminal teardown can only be reached
  // from inside this handler. The signal handler is invoked DIRECTLY rather than through `process.emit`:
  // emitting would also fire vitest's own SIGTERM listener and tear the runner down.
  // FIX ROUND F4. SIGINT was the guard's own, and the guard cannot see the host: `kill -INT` on a
  // foreground launch tore the screen down correctly and left the session unfinalized with a stale roster
  // row, where `kill -TERM` finalized. It is one of main's three now, so it gets the same drain and the
  // same `host.stop`.
  it("SIGINT drains the REPL's teardown and finalizes the host, exactly as SIGTERM does", async () => {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      const order: string[] = [];
      const fakeHost = { start: async () => {}, stop: (r: string) => { order.push(`host.stop:${r}`); return new Promise<void>((res) => setImmediate(res)); } } as any;
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { order.push("process.exit"); }) as never);
      try {
        await captureLog(() => main(["task"], deps({
          isTTY: () => true, makeHost: () => fakeHost,
          runChatClient: async (o) => {
            o.beforeExit!.push(() => order.push("alt-screen cleanup"));
            (process.listeners(sig).at(-1) as () => void)();
            expect(order).toEqual(["alt-screen cleanup", "host.stop:done"]);
            for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
          },
        })));
      } finally { exitSpy.mockRestore(); }
      expect(order.slice(0, 3)).toEqual(["alt-screen cleanup", "host.stop:done", "process.exit"]);
    }
  });
  it("passes the REPL a beforeExit array and drains it SYNCHRONOUSLY, before host.stop and before process.exit", async () => {
    const order: string[] = [];
    // `stop` records at CALL time and settles a turn later, so both halves of the claim are falsifiable:
    // a drain placed after the stop call reorders the first two entries, and a drain that awaited anything
    // would land after `process.exit`.
    const fakeHost = { start: async () => {}, stop: () => { order.push("host.stop"); return new Promise<void>((r) => setImmediate(r)); } } as any;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { order.push("process.exit"); }) as never);
    try {
      await captureLog(() => main(["task"], deps({
        isTTY: () => true, makeHost: () => fakeHost,
        runChatClient: async (o) => {
          o.beforeExit!.push(() => order.push("alt-screen cleanup"));
          const onSignal = process.listeners("SIGTERM").at(-1) as () => void;
          onSignal();
          // Synchronous, and AHEAD of the stop call — asserted before the loop can run anything at all.
          expect(order).toEqual(["alt-screen cleanup", "host.stop"]);
          for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        },
      })));
    } finally { exitSpy.mockRestore(); }
    expect(order.slice(0, 3)).toEqual(["alt-screen cleanup", "host.stop", "process.exit"]);
  });

  it("a second signal does not re-run cleanups the first one already drained", async () => {
    const runs: string[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    try {
      await captureLog(() => main(["task"], deps({
        isTTY: () => true, makeHost: () => fakeHost,
        runChatClient: async (o) => {
          o.beforeExit!.push(() => runs.push("cleanup"));
          const onSignal = process.listeners("SIGTERM").at(-1) as () => void;
          onSignal(); onSignal();
          for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        },
      })));
    } finally { exitSpy.mockRestore(); }
    expect(runs).toEqual(["cleanup"]);
  });

  it("a cleanup that throws still lets the signal finalize the host and exit", async () => {
    const order: string[] = [];
    const fakeHost = { start: async () => {}, stop: () => { order.push("host.stop"); return new Promise<void>((r) => setImmediate(r)); } } as any;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { order.push("process.exit"); }) as never);
    try {
      await captureLog(() => main(["task"], deps({
        isTTY: () => true, makeHost: () => fakeHost,
        runChatClient: async (o) => {
          o.beforeExit!.push(() => { throw new Error("writeSync failed"); });
          o.beforeExit!.push(() => order.push("second cleanup"));
          const onSignal = process.listeners("SIGTERM").at(-1) as () => void;
          expect(() => onSignal()).not.toThrow();
          for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        },
      })));
    } finally { exitSpy.mockRestore(); }
    expect(order.slice(0, 3)).toEqual(["second cleanup", "host.stop", "process.exit"]);
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
  // F9 T-AUTO A1 (plan-review catch): hostMain.ts loads no prefs of its own, so a saved model preference
  // has to be MATERIALIZED here, before the spawn, or the detachable child's launch-mode resolver would
  // see no model, fall back to DEFAULTS.model (auto-capable) and launch `auto` while a foreground run on
  // the SAME saved model launched `default` — the exact split-brain EP-T1 was written to prevent, now on
  // the model axis instead of the mode axis. No --model flag is typed in either case below.
  it("a saved unsupported model with no --model flag: --detachable forwards it, matching a foreground run", async () => {
    const spawnCalls: any[] = [];
    await captureLog(() => main(["--detachable", "task"], deps({
      loadPrefs: () => ({ model: "claude-haiku-4-5-20251001" }),
      spawnDetached: (inv) => { spawnCalls.push(inv); return { short: "12345678", banner: "backgrounded · 12345678" }; },
      prepareAttach: async () => prep({ short: "12345678" }),
      probeSocket: async () => {},
      runChatClient: async () => {},
    })));
    expect(spawnCalls[0].config.model).toBe("claude-haiku-4-5-20251001");
    const hostCalls: any[] = [];
    const fakeHost = { start: async () => {}, stop: async () => {} } as any;
    await captureLog(() => main(["task"], deps({
      isTTY: () => true,
      loadPrefs: () => ({ model: "claude-haiku-4-5-20251001" }),
      makeHost: (o) => { hostCalls.push(o); return fakeHost; },
      runChatClient: async () => {},
    })));
    expect(hostCalls[0].config.permissionMode).toBe("default");     // both launch `default` with that model
  });
  it("a saved auto-capable model alias with no --model flag: --detachable forwards it too", async () => {
    const spawnCalls: any[] = [];
    await captureLog(() => main(["--detachable", "task"], deps({
      loadPrefs: () => ({ model: "opus" }),
      spawnDetached: (inv) => { spawnCalls.push(inv); return { short: "12345678", banner: "backgrounded · 12345678" }; },
      prepareAttach: async () => prep({ short: "12345678" }),
      probeSocket: async () => {},
      runChatClient: async () => {},
    })));
    expect(spawnCalls[0].config.model).toBe("opus");                // forwarded as typed — the CHILD alias-resolves it
  });
  // bl7 T-ADVISOR task 1 — advisorModel rides model's exact materialize-before-spawn shape: hostMain.ts
  // loads no prefs of its own, so a saved advisorModel preference has to be merged into inv.config HERE,
  // before spawnDetached, or a --detachable child would silently launch with no advisor consult at all.
  it("a saved advisorModel with no --advisor-model flag: --detachable forwards it", async () => {
    const spawnCalls: any[] = [];
    await captureLog(() => main(["--detachable", "task"], deps({
      loadPrefs: () => ({ advisorModel: "claude-opus-4-8" }),
      spawnDetached: (inv) => { spawnCalls.push(inv); return { short: "12345678", banner: "backgrounded · 12345678" }; },
      prepareAttach: async () => prep({ short: "12345678" }),
      probeSocket: async () => {},
      runChatClient: async () => {},
    })));
    expect(spawnCalls[0].config.advisorModel).toBe("claude-opus-4-8");
  });
  it("--advisor-model WINS over a saved advisorModel default for --detachable", async () => {
    const spawnCalls: any[] = [];
    await captureLog(() => main(["--detachable", "--advisor-model", "claude-sonnet-4-8", "task"], deps({
      loadPrefs: () => ({ advisorModel: "claude-opus-4-8" }),
      spawnDetached: (inv) => { spawnCalls.push(inv); return { short: "12345678", banner: "backgrounded · 12345678" }; },
      prepareAttach: async () => prep({ short: "12345678" }),
      probeSocket: async () => {},
      runChatClient: async () => {},
    })));
    expect(spawnCalls[0].config.advisorModel).toBe("claude-sonnet-4-8");
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
