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
  it("mountRun runs IMMEDIATELY and undebounced, and a successful result reaches onText", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: string[] = [];
    const d = createStatusLineDriver(CMD, () => "{payload}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    expect(r.runs).toHaveLength(1);
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
  it("an undefined result (any failure) leaves the previous text standing — onText is not called", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: string[] = [];
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    r.runs[0].resolve("FIRST");
    await tick();
    d.poke("tokenUsage"); clock.advance(300);
    r.runs[1].resolve(undefined);
    await tick();
    expect(texts).toEqual(["FIRST"]);
    d.dispose();
  });
  it("a new run aborts the in-flight predecessor, and the predecessor's late result is dropped", async () => {
    const clock = fakeClock(), r = fakeRunner();
    const texts: string[] = [];
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
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
    expect(r.runs).toHaveLength(1);                       // the mount run
    clock.advance(2000);
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
    const texts: string[] = [];
    const d = createStatusLineDriver({ ...CMD, refreshInterval: 1 }, () => "{}", (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
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
    const texts: string[] = [];
    let boom = false;
    const d = createStatusLineDriver(CMD, () => { if (boom) throw new Error("x"); return "{}"; }, (t) => { texts.push(t); }, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
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
    const texts: string[] = [];
    const run = (): Promise<string | undefined> => Promise.resolve("TEXT");
    let boom = true;
    const d = createStatusLineDriver(CMD, () => "{}", (t) => { texts.push(t); if (boom) throw new Error("setState after unmount"); }, { runStatusLine: run, ...clock.deps });
    const seen = await watchRejections(async () => { d.mountRun(); await tick(); });
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
    const seen = await watchRejections(async () => { d.mountRun(); await tick(); });
    expect(seen).toEqual([]);
    d.dispose();
  });
  it("`refreshInterval: Infinity` (which the schema accepts) clamps to setTimeout's max instead of collapsing to 1 ms", () => {
    const clock = fakeClock(), r = fakeRunner();
    const d = createStatusLineDriver({ ...CMD, refreshInterval: Infinity }, () => "{}", () => {}, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    expect(clock.delays).toEqual([2_147_483_647]);         // node clamps >2^31−1 to 1 ms — a hot loop that never updates
    d.dispose();
  });
  it("the payload is rebuilt per run, so a run carries the state at ITS moment, not the driver's construction", () => {
    const clock = fakeClock(), r = fakeRunner();
    let n = 0;
    const d = createStatusLineDriver(CMD, () => `payload-${++n}`, () => {}, { runStatusLine: r.run, ...clock.deps });
    d.mountRun();
    d.poke("model"); clock.advance(300);
    expect(r.runs.map((x) => x.payload)).toEqual(["payload-1", "payload-2"]);
    d.dispose();
  });
});
