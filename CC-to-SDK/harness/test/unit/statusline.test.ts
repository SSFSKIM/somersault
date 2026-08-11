// test/unit/statusline.test.ts — Wave C Task 9 (EP-C2a): the statusLine hook's config resolution, its
// executor and its cadence driver. Canon is annex §C2.1 (the zod schema), §C2.4 (`b0b`'s triggers) and
// §C2.5 (`B8s`'s execution, whose entire error strategy is SILENCE).
//
// TWO SEAMS, NO REAL WORLD. `fakeSpawn` below stands in for `child_process.spawn` — the assertions read the
// argv, the stdin payload, the env and the cwd off the recorded call instead of running anything — and
// `fakeClock` is the whole clock (plan constraint 15: no `await sleep`, no vitest fake timers), so a
// 300 ms debounce and a 600 s timeout are tested in the same millisecond. Exactly ONE test spawns for real
// (`/bin/sh` echoing a line), to prove the argv this module builds is a shape a real shell accepts.
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn as realSpawn } from "node:child_process";
import {
  resolveStatusLineConfig, runStatusLine, createStatusLineDriver,
  STATUS_LINE_DEBOUNCE_MS, STATUS_LINE_TIMEOUT_MS, type StatusLineConfig,
  buildStatusLinePayload, statusLineRows, CCX_VERSION, type StatusLineSnapshot,
} from "../../src/tui/statusLine.js";

const CMD: StatusLineConfig = { type: "command", command: "my-status" };

interface SpawnCall { cmd: string; args: string[]; opts: any; child: FakeChild }
type FakeChild = EventEmitter & {
  stdout: EventEmitter; stderr: EventEmitter;
  stdin: EventEmitter & { write(s: string): boolean; end(): void };
  kill(sig?: string): boolean;
  kills: string[]; written: string[]; ended: boolean;
  /** Emit output then close, the way a real child does. */
  finish(code: number, stdout?: string, stderr?: string): void;
};

/** A fake `spawn`: an EventEmitter'd child with EventEmitter'd stdio, recording what was written to stdin and
 *  every signal it was killed with. Cast to `typeof realSpawn` like copy.test.ts's own fake — the real
 *  signature's overloads are far wider than this module uses. */
function fakeSpawn(opts: { throws?: Error } = {}) {
  const calls: SpawnCall[] = [];
  const spawn = ((cmd: string, args: string[], o: any) => {
    if (opts.throws) throw opts.throws;
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const stdin = new EventEmitter() as FakeChild["stdin"];
    child.written = []; child.kills = []; child.ended = false;
    stdin.write = (s: string) => { child.written.push(s); return true; };
    stdin.end = () => { child.ended = true; };
    child.stdin = stdin;
    child.kill = (sig = "SIGTERM") => { child.kills.push(sig); return true; };
    child.finish = (code, out, err) => {
      if (out) child.stdout.emit("data", Buffer.from(out));
      if (err) child.stderr.emit("data", Buffer.from(err));
      child.emit("close", code, null);
    };
    calls.push({ cmd, args, opts: o, child });
    return child;
  }) as unknown as typeof realSpawn;
  return { spawn, calls, last: (): FakeChild => calls[calls.length - 1].child };
}

/** doublePress.test.ts's synthetic clock, verbatim in shape: `advance` runs due timers in order. */
function fakeClock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const delays: number[] = [];                             // every ms value ever handed to setTimeout, in order
  return {
    delays,
    deps: {
      now: (): number => now,
      setTimeout: (fn: () => void, ms: number): unknown => { delays.push(ms); const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (h: unknown): void => { timers.delete(h as number); },
    },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        let id = -1, at = Infinity;
        for (const [k, t] of timers) if (t.at <= target && t.at < at) { id = k; at = t.at; }
        if (id < 0) break;
        const t = timers.get(id)!; timers.delete(id); now = t.at; t.fn();
      }
      now = target;
    },
    pending: (): number => timers.size,
  };
}

/** Let queued microtasks (the promise chain inside a run) drain. */
const tick = (): Promise<void> => new Promise((r) => { setImmediate(r); });

/** Run `fn` with an `unhandledRejection` listener installed and return whatever it caught. The listener is
 *  load-bearing twice over: it is the assertion (an escaped rejection shows up in the array), and it stops
 *  node's default `--unhandled-rejections=throw` from killing the worker before the expect can run — which is
 *  what makes these two tests a RED rather than a crash. Two ticks, because node raises the event a full turn
 *  after the microtask queue drains. */
async function watchRejections(fn: () => void | Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onRej = (e: unknown): void => { seen.push(e); };
  process.on("unhandledRejection", onRej);
  try { await fn(); await tick(); await tick(); } finally { process.off("unhandledRejection", onRej); }
  return seen;
}

describe("resolveStatusLineConfig — annex §C2.1 (the zod object at L42035)", () => {
  it("a full valid config resolves with every known field", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", padding: 2, refreshInterval: 5, hideVimModeIndicator: true } }))
      .toEqual({ type: "command", command: "s.sh", padding: 2, refreshInterval: 5, hideVimModeIndicator: true });
  });
  it("the minimal config is type + command", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh" } })).toEqual({ type: "command", command: "s.sh" });
  });
  it("no settings, no statusLine key, or a non-object statusLine → undefined", () => {
    expect(resolveStatusLineConfig(undefined)).toBeUndefined();
    expect(resolveStatusLineConfig({})).toBeUndefined();
    expect(resolveStatusLineConfig({ statusLine: null })).toBeUndefined();
    expect(resolveStatusLineConfig({ statusLine: "s.sh" })).toBeUndefined();
    expect(resolveStatusLineConfig({ statusLine: ["s.sh"] })).toBeUndefined();
  });
  it("`type` is a literal: anything but \"command\" (including absent) → undefined", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "shell", command: "s.sh" } })).toBeUndefined();
    expect(resolveStatusLineConfig({ statusLine: { command: "s.sh" } })).toBeUndefined();
  });
  it("a missing or non-string `command` → undefined", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command" } })).toBeUndefined();
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: 7 } })).toBeUndefined();
  });
  it("a non-number `padding` fails the WHOLE object — it has no `.catch`", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", padding: "2" } })).toBeUndefined();
  });
  it("a non-boolean `hideVimModeIndicator` fails the whole object too", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", hideVimModeIndicator: "yes" } })).toBeUndefined();
  });
  it("`refreshInterval`'s `.catch(void 0)` drops THAT FIELD, never the config", () => {
    for (const bad of [0, -1, 0.5, "5", null, NaN]) {
      expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", padding: 1, refreshInterval: bad } }))
        .toEqual({ type: "command", command: "s.sh", padding: 1 });
    }
  });
  it("`refreshInterval` at the boundary (1) is kept; a fractional value above the minimum is a number and is kept", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", refreshInterval: 1 } })?.refreshInterval).toBe(1);
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", refreshInterval: 2.5 } })?.refreshInterval).toBe(2.5);
  });
  it("unknown keys are stripped (zod strips by default) — the resolved object carries only the schema's fields", () => {
    expect(resolveStatusLineConfig({ statusLine: { type: "command", command: "s.sh", nope: 1, timeout: 30 } }))
      .toEqual({ type: "command", command: "s.sh" });
  });
  it("`disableAllHooks: true` un-configures a perfectly valid statusLine (§C2.5's other startup guard)", () => {
    const valid = { type: "command", command: "s.sh", padding: 2, refreshInterval: 5 };
    expect(resolveStatusLineConfig({ statusLine: valid, disableAllHooks: true })).toBeUndefined();
  });
  it("`disableAllHooks` false, absent, or merely truthy leaves the config alone — the gate is `=== true`", () => {
    const valid = { type: "command", command: "s.sh" };
    expect(resolveStatusLineConfig({ statusLine: valid, disableAllHooks: false })).toEqual(valid);
    expect(resolveStatusLineConfig({ statusLine: valid })).toEqual(valid);
    expect(resolveStatusLineConfig({ statusLine: valid, disableAllHooks: "yes" })).toEqual(valid);
  });
});

describe("runStatusLine — annex §C2.5, the success path", () => {
  it("runs the command through a shell with the payload on stdin, and normalizes stdout", async () => {
    const { spawn, calls, last } = fakeSpawn();
    const p = runStatusLine(CMD, '{"session_id":"abc"}', { spawn, cwd: "/repo", projectDir: "/repo", columns: 120, lines: 40, exists: () => true });
    last().finish(0, "  first  \n\n   \n  second \n\n");
    expect(await p).toBe("first\nsecond");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[calls[0].args.length - 1]).toBe("my-status");
    expect(last().written).toEqual(['{"session_id":"abc"}']);
    expect(last().ended).toBe(true);
    expect(calls[0].opts.cwd).toBe("/repo");
    expect(calls[0].opts.env.CLAUDE_PROJECT_DIR).toBe("/repo");
    expect(calls[0].opts.env.COLUMNS).toBe("120");
    expect(calls[0].opts.env.LINES).toBe("40");
  });
  it("the child inherits the FULL parent env alongside the three injected keys", async () => {
    const { spawn, calls, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, cwd: "/repo", env: { PATH: "/bin", MY_VAR: "keep" }, exists: () => true });
    last().finish(0, "x");
    await p;
    expect(calls[0].opts.env.PATH).toBe("/bin");
    expect(calls[0].opts.env.MY_VAR).toBe("keep");
  });
  it("a single line comes back trimmed; CRLF output loses the carriage returns to the per-line trim", async () => {
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true });
    last().finish(0, "\r\n  one \r\n\r\n two\r\n");
    expect(await p).toBe("one\ntwo");
  });
  it("stdout arriving in several chunks is joined before normalization", async () => {
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true });
    last().stdout.emit("data", Buffer.from("he"));
    last().stdout.emit("data", Buffer.from("llo\nwor"));
    last().stdout.emit("data", Buffer.from("ld\n"));
    last().emit("close", 0, null);
    expect(await p).toBe("hello\nworld");
  });
  it("exit 0 with blank-only stdout is `undefined`, not an empty string (upstream's `if (l)` gate)", async () => {
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true });
    last().finish(0, "   \n\n  \n");
    expect(await p).toBeUndefined();
  });
  it("stderr on a SUCCESSFUL run reaches the debug log and never the return value", async () => {
    const { spawn, last } = fakeSpawn();
    const debug: string[] = [];
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true, debug: (m) => { debug.push(m); } });
    last().finish(0, "ok", "a warning\n");
    expect(await p).toBe("ok");
    expect(debug.join("\n")).toContain("a warning");
  });
});

describe("runStatusLine — annex §C2.5, every failure is silence", () => {
  it("a nonzero exit resolves undefined, never throws, and logs stderr to debug only", async () => {
    const { spawn, last } = fakeSpawn();
    const debug: string[] = [];
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true, debug: (m) => { debug.push(m); } });
    last().finish(2, "would-have-been-text", "boom\n");
    expect(await p).toBeUndefined();
    expect(debug.join("\n")).toContain("boom");
  });
  it("a spawn `error` event (ENOENT) resolves undefined", async () => {
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true });
    last().emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    expect(await p).toBeUndefined();
  });
  it("a spawn that THROWS synchronously resolves undefined instead of rejecting", async () => {
    const { spawn } = fakeSpawn({ throws: new Error("EACCES") });
    await expect(runStatusLine(CMD, "{}", { spawn, exists: () => true })).resolves.toBeUndefined();
  });
  it("an EPIPE on stdin is swallowed — the run still settles from the child's own close", async () => {
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true });
    last().stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    last().finish(0, "still here");
    expect(await p).toBe("still here");
  });
  it("a run that never closes is SIGTERM'd at the timeout and resolves undefined; a late close changes nothing", async () => {
    const clock = fakeClock();
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true, timeoutMs: 600_000, ...clock.deps });
    clock.advance(599_999);
    expect(last().kills).toEqual([]);
    clock.advance(1);
    expect(last().kills).toEqual(["SIGTERM"]);
    expect(await p).toBeUndefined();
    last().finish(0, "too late");
    expect(await p).toBeUndefined();
  });
  it("the timeout timer is cleared on a normal close (no stray timer outlives the run)", async () => {
    const clock = fakeClock();
    const { spawn, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true, ...clock.deps });
    last().finish(0, "done");
    await p;
    expect(clock.pending()).toBe(0);
  });
  it("an aborted run is SIGTERM'd and resolves undefined even if the child then exits 0 with text", async () => {
    const { spawn, last } = fakeSpawn();
    const ac = new AbortController();
    const p = runStatusLine(CMD, "{}", { spawn, exists: () => true, signal: ac.signal });
    ac.abort();
    expect(last().kills).toEqual(["SIGTERM"]);
    last().finish(0, "stale");
    expect(await p).toBeUndefined();
  });
  it("a signal already aborted before the call never spawns at all", async () => {
    const { spawn, calls } = fakeSpawn();
    const ac = new AbortController(); ac.abort();
    expect(await runStatusLine(CMD, "{}", { spawn, exists: () => true, signal: ac.signal })).toBeUndefined();
    expect(calls).toEqual([]);
  });
  it("a vanished session cwd falls back rather than making spawn throw ENOENT", async () => {
    const { spawn, calls, last } = fakeSpawn();
    const p = runStatusLine(CMD, "{}", { spawn, cwd: "/gone", fallbackCwd: "/original", exists: (p2) => p2 !== "/gone" });
    last().finish(0, "x");
    await p;
    expect(calls[0].opts.cwd).toBe("/original");
  });
  it("the default timeout is ten minutes and the debounce is 300 ms (xm L223612 / Dee L484890)", () => {
    expect(STATUS_LINE_TIMEOUT_MS).toBe(600_000);
    expect(STATUS_LINE_DEBOUNCE_MS).toBe(300);
  });
});

describe("runStatusLine — one real child, to prove the argv is a shape a shell accepts", () => {
  it("echoes a line through the real /bin/sh", async () => {
    if (process.platform === "win32") return;
    expect(await runStatusLine({ type: "command", command: "printf '  hi \\n\\n  there\\n'" }, "{}", {})).toBe("hi\nthere");
  });
});

/** A controllable `runStatusLine` stand-in for the driver tests: each call parks, and the test settles it. */
function fakeRunner() {
  const runs: { payload: string; signal?: AbortSignal; resolve: (v: string | undefined) => void; aborted: () => boolean }[] = [];
  const run = (_cfg: StatusLineConfig, payload: string, deps: { signal?: AbortSignal } = {}): Promise<string | undefined> =>
    new Promise((resolve) => { runs.push({ payload, signal: deps.signal, resolve, aborted: () => !!deps.signal?.aborted }); });
  return { run, runs };
}

describe("createStatusLineDriver — annex §C2.4 (`b0b`'s four triggers)", () => {
  // W2 T6 FLIPPED THIS CELL. It used to read "mountRun runs IMMEDIATELY and undebounced" — upstream's own
  // shape, and the reason ccx ran the script TWICE per boot: the immediate run published a payload built
  // before the catalog, the host's first `state` frame, the effort capability and the mount-time context
  // read had landed, and the deltas they caused re-ran it 300 ms later. `mountRun` now goes through the
  // same trailing window, so a boot coalesces into ONE run carrying the settled state. See the interface
  // doc on `StatusLineDriver.mountRun`.
  it("mountRun coalesces the whole boot into ONE debounced run, and its result reaches onText", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: (string | undefined)[] = [];
    const d = createStatusLineDriver(CMD, () => "{payload}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    expect(r.runs).toHaveLength(0);                       // not yet — the boot window is open
    d.poke("model"); d.poke("state-delta");               // everything that lands while ccx boots
    clock.advance(300);
    expect(r.runs).toHaveLength(1);                       // …is ONE run, not one plus a correction
    expect(r.runs[0].payload).toBe("{payload}");
    r.runs[0].resolve("STATUS");
    await tick();
    expect(texts).toEqual(["STATUS"]);
    d.dispose();
  });
  it("poke is debounced 300 ms and coalesces a burst into ONE run", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const d = createStatusLineDriver(CMD, () => "{}", () => {}, { runStatusLine: r.run, ...clock.deps });
    d.poke("tokenUsage"); clock.advance(100);
    d.poke("permissionMode"); clock.advance(100);
    d.poke("model");
    expect(r.runs).toHaveLength(0);                       // nothing yet — the window restarted on each poke
    clock.advance(299);
    expect(r.runs).toHaveLength(0);
    clock.advance(1);
    expect(r.runs).toHaveLength(1);
    d.dispose();
  });
  // W2 T6 / SPEC D-W6 FLIPPED THIS CELL TOO, and it is the one behaviour change a user sees. It used to
  // read "an undefined result leaves the previous text standing — onText is not called", which is the
  // reading Wave C took from an annex that says both things. The bundle settles it: `y0b` (L484821)
  // forwards `undefined` to `onResult` unconditionally, `onResult` (L484883) writes it into state, and the
  // slot collapses to `null` in the main-screen renderer (L484981). So a failing script REMOVES the row
  // rather than leaving yesterday's text on screen pretending to be current.
  it("an undefined result (any failure, and an exit-0 script that printed nothing) is PUBLISHED — the row comes down", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: (string | undefined)[] = [];
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun(); clock.advance(300);
    r.runs[0].resolve("FIRST");
    await tick();
    d.poke("tokenUsage"); clock.advance(300);
    r.runs[1].resolve(undefined);
    await tick();
    expect(texts).toEqual(["FIRST", undefined]);
    // …and a later good run puts it back, so the row is a live reading rather than a one-way door.
    d.poke("tokenUsage"); clock.advance(300);
    r.runs[2].resolve("THIRD");
    await tick();
    expect(texts).toEqual(["FIRST", undefined, "THIRD"]);
    d.dispose();
  });
  // The two generation guards are what keep the flip above safe: a SUPERSEDED run's late `undefined` must
  // not take down the row its successor just wrote, and a result arriving after unmount must not be
  // published at all. Both were load-bearing before only for text; now they are load-bearing for failure.
  it("a SUPERSEDED run's late failure does not take down its successor's row", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: (string | undefined)[] = [];
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun(); clock.advance(300);
    d.poke("model"); clock.advance(300);
    expect(r.runs).toHaveLength(2);
    r.runs[1].resolve("NEW");
    r.runs[0].resolve(undefined);                          // the aborted predecessor, answering late
    await tick();
    expect(texts).toEqual(["NEW"]);
    d.dispose();
  });
  it("a new run aborts the in-flight predecessor, and the predecessor's late result is dropped", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: (string | undefined)[] = [];
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun(); clock.advance(300);
    expect(r.runs[0].aborted()).toBe(false);
    d.poke("tokenUsage"); clock.advance(300);
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0].aborted()).toBe(true);
    r.runs[1].resolve("NEW");
    r.runs[0].resolve("STALE");
    await tick();
    expect(texts).toEqual(["NEW"]);
    d.dispose();
  });
  it("refreshInterval polls in SECONDS, and the poll tick goes through the SAME debounce upstream routes it through", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const d = createStatusLineDriver({ ...CMD, refreshInterval: 2 }, () => "{}", () => {}, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    clock.advance(300);
    expect(r.runs).toHaveLength(1);                       // the boot run, one debounce window in
    clock.advance(1700);
    expect(r.runs).toHaveLength(1);                       // the tick only ARMED the 300 ms debounce (`Lc(B, …)`)
    clock.advance(300);
    expect(r.runs).toHaveLength(2);
    clock.advance(2000 + 300);
    expect(r.runs).toHaveLength(3);                       // and it keeps ticking
    d.dispose();
  });
  it("without refreshInterval, pure idle produces no re-invocations at all (QA-6's 30 s of silence)", () => {
    const clock = fakeClock(), r = fakeRunner();
    const d = createStatusLineDriver(CMD, () => "{}", () => {}, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    clock.advance(30_000);
    expect(r.runs).toHaveLength(1);
    d.dispose();
  });
  it("dispose cancels a pending debounce, stops the poll, aborts the in-flight run, and makes later pokes inert", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: (string | undefined)[] = [];
    const d = createStatusLineDriver({ ...CMD, refreshInterval: 1 }, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun(); clock.advance(300);
    d.poke("tokenUsage");
    d.dispose();
    expect(r.runs[0].aborted()).toBe(true);
    expect(clock.pending()).toBe(0);                      // debounce AND poll timers both gone
    clock.advance(10_000);
    d.poke("model"); d.mountRun();
    clock.advance(10_000);
    expect(r.runs).toHaveLength(1);
    r.runs[0].resolve("LATE");
    await tick();
    expect(texts).toEqual([]);                            // a result delivered after unmount never reaches setState
    d.dispose();                                          // idempotent
  });
  it("a `buildPayload` that throws inside the debounce timer skips THAT run and leaves the driver working", () => {
    const clock = fakeClock(), r = fakeRunner();
    let boom = true;
    const d = createStatusLineDriver(CMD, () => { if (boom) throw new Error("no session yet"); return "{ok}"; }, () => {}, { runStatusLine: r.run, ...clock.deps });
    d.poke("tokenUsage");
    expect(() => clock.advance(300)).not.toThrow();        // the timer callback is bare — a throw here is uncatchable
    expect(r.runs).toEqual([]);                            // skipped, not run with a broken payload
    boom = false;
    d.poke("model"); clock.advance(300);
    expect(r.runs.map((x) => x.payload)).toEqual(["{ok}"]); // and the next poke still lands
    d.dispose();
  });
  it("a `buildPayload` that throws does NOT abort the run already in flight", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: (string | undefined)[] = [];
    let boom = false;
    const d = createStatusLineDriver(CMD, () => { if (boom) throw new Error("x"); return "{}"; }, (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun(); clock.advance(300);
    boom = true;
    d.poke("tokenUsage"); clock.advance(300);
    expect(r.runs[0].aborted()).toBe(false);               // killing a good run for a payload we never built is pure loss
    r.runs[0].resolve("STILL GOOD");
    await tick();
    expect(texts).toEqual(["STILL GOOD"]);
    d.dispose();
  });
  it("an `onText` that throws is swallowed — no unhandled rejection, and later runs still deliver", async () => {
    const clock = fakeClock();
    const texts: (string | undefined)[] = [];
    const run = (): Promise<string | undefined> => Promise.resolve("TEXT");
    let boom = true;
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); if (boom) throw new Error("setState after unmount"); }, { runStatusLine: run, ...clock.deps });
    const seen = await watchRejections(async () => { d.mountRun(); clock.advance(300); await tick(); });
    expect(seen).toEqual([]);
    boom = false;
    d.poke("model"); clock.advance(300);
    await tick();
    expect(texts).toEqual(["TEXT", "TEXT"]);
    d.dispose();
  });
  it("a runner that REJECTS is swallowed too — the driver's contract does not depend on runStatusLine keeping its own", async () => {
    const clock = fakeClock();
    const run = (): Promise<string | undefined> => Promise.reject(new Error("someone rewrote runStatusLine"));
    const d = createStatusLineDriver(CMD, () => "{}", () => {}, { runStatusLine: run, ...clock.deps });
    const seen = await watchRejections(async () => { d.mountRun(); clock.advance(300); await tick(); });
    expect(seen).toEqual([]);
    d.dispose();
  });
  it("`refreshInterval: Infinity` (which the schema accepts) clamps to setTimeout's max instead of collapsing to 1 ms", () => {
    const clock = fakeClock(), r = fakeRunner();
    const d = createStatusLineDriver({ ...CMD, refreshInterval: Infinity }, () => "{}", () => {}, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    expect(clock.delays).toEqual([STATUS_LINE_DEBOUNCE_MS, 2_147_483_647]);   // node clamps >2^31−1 to 1 ms — a hot loop that never updates
    d.dispose();
  });
  it("the payload is rebuilt per run, so a run carries the state at ITS moment, not the driver's construction", () => {
    const clock = fakeClock(), r = fakeRunner();
    let n = 0;
    const d = createStatusLineDriver(CMD, () => `payload-${++n}`, () => {}, { runStatusLine: r.run, ...clock.deps });
    d.mountRun(); clock.advance(300);
    d.poke("model"); clock.advance(300);
    expect(r.runs.map((x) => x.payload)).toEqual(["payload-1", "payload-2"]);
    d.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WAVE C TASK 10 (EP-C2b): the stdin payload and the render transform. Both are pure — the payload
// builder takes a snapshot of ccx state and returns the object `JSON.stringify` goes over, and the
// render transform takes the script's stdout and returns the exact strings the footer hands Ink.
// Canon: annex §C2.2 (the documented stdin contract), §C2.3 (`H0b`/`_0b`, the authoritative builder)
// and §C2.6 (`m3f`'s carry-forward and `wc`'s forced dim).

/** A snapshot with every optional input present — the golden below is its complete transcription. */
const FULL: StatusLineSnapshot = {
  sessionId: "sess-1",
  sessionName: "Fixing the parser",
  cwd: "/repo/app",
  projectDir: "/repo",
  addedDirs: ["/repo/docs"],
  model: "claude-opus-4-6",
  modelDisplayName: "Opus 4.6",
  outputStyle: "Explanatory",
  thinkingEnabled: true,
  context: { totalTokens: 40_000, maxTokens: 200_000 },
  usage: { session: { total_cost_usd: 1.25, total_duration_ms: 9000, total_api_duration_ms: 4000, total_lines_added: 12, total_lines_removed: 3,
    model_usage: { "claude-opus-4-6": { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 900, cacheCreationInputTokens: 200 } } } },
  version: "9.9.9",
  effort: "xhigh",                                   // WAVE C TASK 11 — the conditional `effort` block (§C6/§C2.2)
  // W2 T6 (EP-D4) — the two hook-fed identity fields and the rate-limit windows. All three arrive on a
  // snapshot the mount site assembles; the builder's only job is the reshape.
  transcriptPath: "/home/u/.claude/projects/-repo-app/sess-1.jsonl",
  promptId: "11111111-2222-3333-4444-555555555555",
};

/** `FULL` plus a `session.usage()` reading that CAN see the plan windows. Kept separate because the
 *  golden above is the shape a `claude setup-token` credential produces — no windows at all. */
const FULL_RATED: StatusLineSnapshot = {
  ...FULL,
  usage: { ...FULL.usage, rate_limits_available: true,
    rate_limits: { five_hour: { utilization: 42, resets_at: "2026-08-11T20:00:00Z" }, seven_day: { utilization: 7.5, resets_at: null } } },
};

describe("buildStatusLinePayload (annex §C2.2-§C2.3)", () => {
  it("is the golden object, field for field, when every input is present", () => {
    expect(buildStatusLinePayload(FULL)).toEqual({
      session_id: "sess-1",
      transcript_path: "/home/u/.claude/projects/-repo-app/sess-1.jsonl",
      cwd: "/repo/app",
      prompt_id: "11111111-2222-3333-4444-555555555555",
      session_name: "Fixing the parser",
      model: { id: "claude-opus-4-6", display_name: "Opus 4.6" },
      workspace: { current_dir: "/repo/app", project_dir: "/repo", added_dirs: ["/repo/docs"] },
      version: "9.9.9",
      output_style: { name: "Explanatory" },
      cost: { total_cost_usd: 1.25, total_duration_ms: 9000, total_api_duration_ms: 4000, total_lines_added: 12, total_lines_removed: 3 },
      context_window: {
        total_input_tokens: 40_000, total_output_tokens: 50, context_window_size: 200_000,
        current_usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 900 },
        used_percentage: 20, remaining_percentage: 80,
      },
      exceeds_200k_tokens: false,
      fast_mode: false,
      effort: { level: "xhigh" },
      thinking: { enabled: true },
    });
  });
  // WAVE C TASK 11 flipped this cell: `effort` was ABSENT at Task 10 because `state.effort` did not exist and
  // a block built off a value nothing sets would be a lie a script could read. It exists now, so the block is
  // present — CONDITIONALLY, exactly as upstream's `...Fk(y) && { effort: … }` is (a model without effort
  // support, or a client that has never been told a level, still carries no key).
  // W2 T6 FLIPPED FOUR NAMES OUT OF THE ABSENT LIST AND INTO THE ORDER. The Wave C key set omitted
  // `transcript_path`, `prompt_id`, `fast_mode` and `rate_limits` for reasons canon Q3 retired: the first
  // two ride on every hook input, `fast_mode` is an unconditional boolean upstream, and `rate_limits` is
  // already in ccx's hand (`session.usage()`). What stays out is what canon itself drops.
  it("carries exactly canon's key set, in canon's own order — and none of the blocks canon drops", () => {
    // `toEqual` treats an `undefined` value as an absent key, so the key LIST is what pins "omitted, not null".
    expect(Object.keys(buildStatusLinePayload(FULL_RATED))).toEqual([
      "session_id", "transcript_path", "cwd", "prompt_id", "session_name", "model", "workspace", "version",
      "output_style", "cost", "context_window", "exceeds_200k_tokens", "fast_mode", "effort", "thinking",
      "rate_limits",
    ]);
    // `permission_mode` is the one the hook-input shape declares and the payload does NOT carry: `H0b`
    // calls `Kf()` with no arguments, so it (and `agent_id`) are `undefined` and JSON.stringify drops them.
    for (const absent of ["permission_mode", "agent_id", "agent_type", "vim", "agent", "remote", "pr", "worktree"])
      expect(absent in buildStatusLinePayload(FULL_RATED)).toBe(false);
  });
  it("`fast_mode` is an UNCONDITIONAL literal false — ccx exposes no fast-mode control, and canon never omits the key", () => {
    expect(buildStatusLinePayload({ cwd: "/x", thinkingEnabled: false }).fast_mode).toBe(false);
    expect("fast_mode" in buildStatusLinePayload({ cwd: "/x", thinkingEnabled: false })).toBe(true);
  });
  it("`transcript_path`/`prompt_id` are absent before the first prompt and present after it (canon's per-moment table)", () => {
    const preTurn = buildStatusLinePayload({ cwd: "/x", thinkingEnabled: false, sessionId: "minted-uuid" });
    expect("transcript_path" in preTurn).toBe(false);
    expect("prompt_id" in preTurn).toBe(false);
    expect(preTurn.session_id).toBe("minted-uuid");        // …but the identity is NEVER absent (D-W4)
    const postTurn = buildStatusLinePayload({ cwd: "/x", thinkingEnabled: false, sessionId: "engine-id", transcriptPath: "/p.jsonl", promptId: "pid" });
    expect(postTurn.transcript_path).toBe("/p.jsonl");
    expect(postTurn.prompt_id).toBe("pid");
  });
  // THE UNIT PIN IS THE VERIFICATION for this block, and deliberately so: `rate_limits_available` is false
  // under an API key AND under a `claude setup-token` OAuth token (no profile scope), which are the only two
  // credentials this project has. No live cell can reach the populated arm, so the mapping is pinned here.
  it("`rate_limits` maps the SDK's `utilization` onto canon's `used_percentage` WITHOUT rescaling", () => {
    // The SDK declares utilization as "Percentage of the window used, 0-100" — canon's own `* 100` exists
    // because ITS source is a 0-1 response header. Multiplying here would render 42% as 4200%.
    expect(buildStatusLinePayload(FULL_RATED).rate_limits).toEqual({
      five_hour: { used_percentage: 42, resets_at: "2026-08-11T20:00:00Z" },
      seven_day: { used_percentage: 7.5, resets_at: null },
    });
  });
  it("`rate_limits` is ABSENT under a credential that cannot see the buckets, and before the first reading", () => {
    expect("rate_limits" in buildStatusLinePayload(FULL)).toBe(false);                       // no usage reading with windows
    const blind = { ...FULL, usage: { ...FULL.usage, rate_limits_available: false, rate_limits: null } };
    expect("rate_limits" in buildStatusLinePayload(blind)).toBe(false);                      // setup-token / API key
    const empty = { ...FULL, usage: { ...FULL.usage, rate_limits_available: true, rate_limits: {} } };
    expect("rate_limits" in buildStatusLinePayload(empty)).toBe(false);                      // available, no windows yet
  });
  it("`rate_limits` carries only the windows that answered — canon's own `...w.five_hour && {…}` spread", () => {
    const one = { ...FULL, usage: { ...FULL.usage, rate_limits_available: true, rate_limits: { five_hour: { utilization: 3, resets_at: "z" }, seven_day: { utilization: null, resets_at: null } } } };
    expect(buildStatusLinePayload(one).rate_limits).toEqual({ five_hour: { used_percentage: 3, resets_at: "z" } });
  });
  it("omits `effort` when the snapshot carries no level (an unsupported model, or a client never told one)", () => {
    const { effort: _drop, ...noEffort } = FULL;
    expect("effort" in buildStatusLinePayload(noEffort)).toBe(false);
  });
  it("pre-first-turn: `current_usage` and both percentages are NULL, and the two conditional keys are ABSENT", () => {
    const p = buildStatusLinePayload({ cwd: "/repo", thinkingEnabled: false, version: "9.9.9" });
    expect(p.context_window).toEqual({
      total_input_tokens: 0, total_output_tokens: 0, context_window_size: 0,
      current_usage: null, used_percentage: null, remaining_percentage: null,
    });
    expect("session_id" in p).toBe(false);            // the BUILDER still omits what it is not given (useChat always gives one)
    expect(p.fast_mode).toBe(false);
    expect("session_name" in p).toBe(false);
    expect(p.cost).toEqual({ total_cost_usd: 0, total_duration_ms: 0, total_api_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0 });
    expect(p.model).toEqual({ id: "", display_name: "" });
    expect(p.workspace).toEqual({ current_dir: "/repo", project_dir: "/repo", added_dirs: [] });
    expect(p.output_style).toEqual({ name: "default" });
    expect(p.thinking).toEqual({ enabled: false });
  });
  it("`display_name` falls back to the id when no catalog entry was ever fetched", () => {
    expect(buildStatusLinePayload({ ...FULL, modelDisplayName: undefined }).model).toEqual({ id: "claude-opus-4-6", display_name: "claude-opus-4-6" });
  });
  it("`exceeds_200k_tokens` is the live context size against upstream's own 200k line", () => {
    expect(buildStatusLinePayload({ ...FULL, context: { totalTokens: 200_000, maxTokens: 1_000_000 } }).exceeds_200k_tokens).toBe(false);
    expect(buildStatusLinePayload({ ...FULL, context: { totalTokens: 200_001, maxTokens: 1_000_000 } }).exceeds_200k_tokens).toBe(true);
  });
  it("defaults the version to ccx's own package version", () => {
    expect(buildStatusLinePayload({ cwd: "/x", thinkingEnabled: false }).version).toBe(CCX_VERSION);
    expect(CCX_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("statusLineRows (annex §C2.6 — `m3f` carry-forward + `wc`'s forced dim)", () => {
  const DIM = "\x1b[2m";
  it("wraps a plain line in dim and closes it, so nothing bleeds into the footer row below", () => {
    expect(statusLineRows("~/repo (main)")).toEqual([`${DIM}~/repo (main)\x1b[0m`]);
  });
  it("keeps the script's OWN colour and forces dim back on AFTER every escape it emits", () => {
    const [row] = statusLineRows("\x1b[32mok\x1b[0m done");
    expect(row).toBe(`${DIM}\x1b[32m${DIM}ok\x1b[0m${DIM} done\x1b[0m`);
  });
  it("replays every earlier line's escapes as a prefix on each later line (`m3f`)", () => {
    const rows = statusLineRows("\x1b[31mred\nsecond\nthird");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(`${DIM}\x1b[31m${DIM}red\x1b[0m`);
    expect(rows[1]).toBe(`${DIM}\x1b[31m${DIM}second\x1b[0m`);        // carried from line 1
    expect(rows[2]).toBe(`${DIM}\x1b[31m${DIM}third\x1b[0m`);         // line 2 emitted none of its own
  });
  it("accumulates escapes from ALL earlier lines, in order", () => {
    const rows = statusLineRows("\x1b[31ma\n\x1b[1mb\nc");
    expect(rows[2]).toBe(`${DIM}\x1b[31m${DIM}\x1b[1m${DIM}c\x1b[0m`);
  });
  it("carries an OSC-8 hyperlink open across lines too (`E0b`'s second alternative)", () => {
    const rows = statusLineRows("\x1b]8;;https://x\x07link\nnext");
    expect(rows[1]).toContain("\x1b]8;;https://x\x07");
  });
  it("leaves an empty string alone rather than emitting a bare escape pair", () => {
    expect(statusLineRows("")).toEqual([]);
  });
});
