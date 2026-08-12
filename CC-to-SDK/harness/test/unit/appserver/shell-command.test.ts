// test/unit/appserver/shell-command.test.ts — M3 Task 13: `thread/shellCommand` (spec §3), the
// display-only shell escape — the TUI's `!cmd` over the wire.
//
// REAL COMMANDS in real directories, driven wire-level through `srv.connect`/`feed`. The method IS process
// execution, so a faked `runBash` would prove the handler's plumbing and nothing a client depends on: the
// exit code, the directory the command actually landed in, and what a 4 MiB flood does are all facts about
// `exec`, not about our wiring.
//
// Records are HAND-BUILT (origin-gate.test.ts's pattern) rather than attached or started. That is the
// point rather than a shortcut: the handler never touches the engine at all, so a fleet thread needs no
// socket behind it to prove where its command runs — the only engine-adjacent step in the whole path is
// dispatch's own `-33005` record lookup, which the dead-engine case below drives.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { FLEET_UNSUPPORTED, emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import { methodSchemas } from "../../../src/appserver/schema/index.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

const servers: AppServer[] = [];
const dirs: string[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

/** `realpath`, always: on darwin `mkdtemp` hands back a `/var/…` path that is a symlink to `/private/var/…`,
 *  and a command's own `pwd` prints the physical one — so the un-resolved path would fail every cwd case
 *  here for a reason that has nothing to do with the method. */
const mkdir = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), "ccx-shell-"))); dirs.push(d); return d; };

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}

/** The four required `EngineSession` members and nothing else, with `submit` recording every call — the
 *  display-only claim is checked by that array staying empty. */
function fakeSession(extra: Record<string, unknown> = {}) {
  const submitted: unknown[] = [];
  return { submitted, session: { submit: async (p: unknown) => { submitted.push(p); return { result: {} }; }, interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1", isEnded: () => false, ...extra } };
}

function addRecord(srv: AppServer, origin: "inProcess" | "fleet", session: Record<string, unknown>, over: Partial<ThreadRecord> = {}): string {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  srv.registry.add({
    id, origin, session, unattended: "park", busy: false, turnSeq: 0, interruptRequested: false,
    buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(),
    sessionId: session.sessionId as string | undefined, createdAt: now, updatedAt: now,
    settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0, ...over,
  } as unknown as ThreadRecord);
  return id;
}

/** One request, one reply. Every call forks a process, so the reply is always several ticks away. */
async function call(params: Record<string, unknown>, timeout = 5000): Promise<Record<string, unknown>> {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method: "thread/shellCommand", params }) + "\n");
  let frame: Record<string, unknown> | undefined;
  await vi.waitFor(() => { frame = parsed(lines).find((f) => f.id === id); expect(frame, "no reply for thread/shellCommand").toBeDefined(); }, { timeout });
  return frame as Record<string, unknown>;
}

const err = (frame: Record<string, unknown>): { code: number; message: string } => frame.error as { code: number; message: string };
const ok = (frame: Record<string, unknown>): { code: number; output: string; timedOut?: true } => frame.result as { code: number; output: string; timedOut?: true };

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Every marker a term-proof fixture writes its pid into. The handler DELIBERATELY abandons such a child
 *  (that residual is what its note names), so the TEST owns the ending — swept in `afterEach` as a backstop
 *  for a case that fails before reaping, because a leaked node process would outlive the whole run. */
const markers: string[] = [];
/** A command that IGNORES SIGTERM, so `exec`'s own timeout cannot end it: a no-op handler REPLACES node's
 *  default terminate disposition. It records its pid first thing, then idles well past any deadline here. */
function termProof(dir: string): { command: string; marker: string } {
  const marker = join(dir, "pid");
  markers.push(marker);
  return { marker, command: `node -e "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>{},30000)" ${JSON.stringify(marker)}` };
}
/** Assert the abandoned child is STILL RUNNING (the residual the note claims), then end it for real. */
async function reap(marker: string): Promise<void> {
  let pid = 0;
  await vi.waitFor(() => { pid = Number(readFileSync(marker, "utf8")); expect(pid, "term-proof child never wrote its pid").toBeGreaterThan(0); }, { timeout: 5000 });
  expect(alive(pid), "the abandoned child should have outlived the reply").toBe(true);
  process.kill(pid, "SIGKILL");                       // SIGTERM is exactly what it ignores
  await vi.waitFor(() => { expect(alive(pid)).toBe(false); }, { timeout: 5000 });
}

afterEach(async () => {
  for (const m of markers.splice(0)) { try { process.kill(Number(readFileSync(m, "utf8")), "SIGKILL"); } catch { /* already reaped, or never started */ } }
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("thread/shellCommand — execution", () => {
  it("runs the command and answers the primitive's result verbatim", async () => {
    const srv = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir() });

    const res = ok(await call({ threadId, command: "echo shell-marker-42" }));

    expect(res.code).toBe(0);
    expect(res.output).toContain("shell-marker-42");
    expect("timedOut" in res).toBe(false); // omitted, not false — the primitive spreads it only when true
  });

  it("surfaces a nonzero exit code", async () => {
    const srv = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir() });

    expect(ok(await call({ threadId, command: "exit 3" })).code).toBe(3);
  });

  it("is a FULL shell string — pipes and redirection are the point, not a hazard", async () => {
    // `exec`, not `execFile`: the caller's own command IS the input (the TUI's `!` mode reasoning). A
    // handler that split on whitespace would answer this with a literal `|`.
    const srv = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir() });

    expect(ok(await call({ threadId, command: "echo one && echo two | tr a-z A-Z" })).output).toBe("one\nTWO");
  });

  it("the conversation is untouched: nothing is submitted to the engine and nothing is broadcast", async () => {
    // THE recorded deviation from Codex (spec §3, D-M3-2), pinned rather than described: their
    // shellCommand streams into the turn so the model sees the output; ours returns it to the ONE client
    // that asked. Subscribed as a watcher AND as this thread's subscriber, so any notification at all
    // would land in `lines` beside the reply.
    const srv = boot();
    const fake = fakeSession();
    const threadId = addRecord(srv, "inProcess", fake.session, { cwd: mkdir() });
    conn.feed(JSON.stringify({ id: 50, method: "thread/subscribe", params: { threadId } }) + "\n");
    await new Promise((r) => setTimeout(r, 0));
    lines.length = 0; // subscribe's own replay (a `thread/status/changed`) is not this method's traffic
    await call({ threadId, command: "echo quiet" });

    expect(fake.submitted).toEqual([]);
    expect(parsed(lines).filter((f) => typeof f.method === "string").map((f) => f.method)).toEqual([]);
  });
});

describe("thread/shellCommand — the outer deadline bounds the REPLY", () => {
  // The seam's `timeout: 30_000` bounds the CHILD, not the request: `exec` kills by SIGTERM and `runBash`
  // never escalates, so a child that ignores TERM leaves that promise unsettled FOREVER and the RPC never
  // answers — the FIFO-hang class, and un-chained it lets one client stack up hung requests. The handler's
  // own outer deadline is what turns that into an honest reply.
  //
  // The deadline is injected BELOW the seam's 30 s here, which inverts production's ordering on purpose:
  // outer-fires-first is the code path under test, and honouring the real 40 s would cost 40 s of wall clock
  // to prove one branch. The complementary case — a TERM-CATCHING command outliving the seam's own 30 s, so
  // the seam answers and the outer never fires — is NOT covered: that 30 s is a hardcoded constant in
  // `src/tui/bash.ts` (a shared TUI seam this cluster must not fork), so there is no cheap scaled version of
  // it, and the un-injected tests below already pin the outer arm losing every ordinary race.

  it("abandons a SIGTERM-proof command at the outer deadline, and says so", async () => {
    const srv = boot({ shellDeadlineMs: 500 });
    const dir = mkdir();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: dir });
    const { command, marker } = termProof(dir);

    const id = nextId++;
    const t0 = Date.now();
    conn.feed(JSON.stringify({ id, method: "thread/shellCommand", params: { threadId, command } }) + "\n");
    let frame: Record<string, unknown> | undefined;
    await vi.waitFor(() => { frame = parsed(lines).find((f) => f.id === id); expect(frame, "the request never answered").toBeDefined(); }, { timeout: 10_000 });

    // Under 5 s is the whole claim: without the outer deadline this frame arrives NEVER, not late.
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(ok(frame as Record<string, unknown>)).toEqual({
      code: 1, timedOut: true,
      output: "<harness note: command ignored SIGTERM and exceeded the 0.5s harness deadline; its process may still be running>",
    });

    // The note is honest only if the residual it names is real: the child OUTLIVES the reply (asserted in
    // `reap`), and the harness has stopped waiting for it.
    await reap(marker);
    // Killing it makes `exec`'s callback finally fire — and that late settle is DISCARDED by the race, so no
    // second frame may follow. A handler that replied off both arms would corrupt the client's id map.
    await new Promise((r) => setTimeout(r, 300));
    expect(parsed(lines).filter((f) => f.id === id).length).toBe(1);
  }, 20_000);

  it("an ordinary command still answers with its OWN result — the deadline arm loses the race", async () => {
    // The other half of the race, pinned separately: a tight deadline must not colour a normal reply, and
    // `timedOut` must stay absent rather than arriving false off the abandonment shape.
    const srv = boot({ shellDeadlineMs: 5000 });
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir() });

    expect(ok(await call({ threadId, command: "echo fast" }))).toEqual({ code: 0, output: "fast" });
  });

  it("the production deadline sits ABOVE the seam's own inner timeout, so it can only fire for a TERM-proof child", async () => {
    // The tripwire for the one invariant the tests above cannot observe (they invert it on purpose). The
    // inner bound is a bare `timeout: 30_000` literal inside `src/tui/bash.ts` — not exported, and not ours
    // to export — so it is READ OUT OF THAT SOURCE rather than restated here. Restating the number would
    // make the tripwire one-directional: it would catch `SHELL_DEADLINE_MS` dropping under the seam's bound,
    // but not the seam's bound being RAISED past 40 s, which breaks the ordering from the other side. Either
    // way round the outer arm starts pre-empting the seam's own timeout, turning every ordinary hang into an
    // "ignored SIGTERM" note that is simply false. Extracted, either constant crossing the other fails here.
    const bashSrc = readFileSync(fileURLToPath(new URL("../../../src/tui/bash.ts", import.meta.url)), "utf8");
    const inner = bashSrc.match(/timeout:\s*([\d_]+)/);
    expect(inner, "src/tui/bash.ts carries no `timeout:` literal — the seam's inner bound moved or vanished").not.toBeNull();
    const innerMs = Number(inner![1].replaceAll("_", ""));
    const { SHELL_DEADLINE_MS } = await import("../../../src/appserver/workspace.js");
    expect(SHELL_DEADLINE_MS).toBeGreaterThan(innerMs);
  });
});

describe("thread/shellCommand — cwd resolution", () => {
  it("an inProcess thread runs in its start config's cwd", async () => {
    const srv = boot();
    const dir = mkdir();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: dir, config: { cwd: dir } });

    expect(ok(await call({ threadId, command: "pwd" })).output).toBe(dir);
  });

  it("an inProcess thread whose config named no cwd runs in the server's own — the same fallback threadView reports", async () => {
    const srv = boot();
    const dir = mkdir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const threadId = addRecord(srv, "inProcess", fakeSession().session);

    expect(ok(await call({ threadId, command: "pwd" })).output).toBe(dir);
  });

  it("a fleet thread runs in the roster cwd stamped at attach — not the server's", async () => {
    // The two are DIFFERENT directories on purpose: a fleet host runs wherever its roster row says, and a
    // command that quietly landed in this server's tree instead would read as working while touching the
    // wrong files. Same machine, guaranteed by the UDS transport (§3).
    const srv = boot();
    const fleetDir = mkdir();
    vi.spyOn(process, "cwd").mockReturnValue(mkdir());
    const threadId = addRecord(srv, "fleet", fakeSession().session, { cwd: fleetDir, short: "deadbeef" });

    const res = ok(await call({ threadId, command: "pwd" }));

    expect(res.code).toBe(0); // NOT -33006: the method works on both origins
    expect(res.output).toBe(fleetDir);
  });
});

describe("thread/shellCommand — gates", () => {
  it("an unknown thread answers -33004", async () => {
    boot();
    expect(err(await call({ threadId: "thr_nope", command: "echo hi" })).code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("a dead engine answers -33005 — the STANDARD gate, so a dead thread reads consistently dead", async () => {
    // Deliberately NOT in ENGINE_GONE_EXEMPT even though this handler could physically answer: a thread
    // whose engine is gone is dead for every method a client can name on it, and one surface that keeps
    // working invites a client to treat the thread as half-alive (spec §3, clarified during planning).
    const srv = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession({ isEnded: () => true }).session, { cwd: mkdir() });

    expect(err(await call({ threadId, command: "echo hi" })).code).toBe(ERR.ENGINE_GONE);
  });

  it("a BUSY thread still runs its command — un-chained, and not queued behind a turn that never ends", async () => {
    // The opposite deliberate choice from the gate above, and the TUI's own precedent: `!` works mid-turn.
    // The chain stays UNSETTLED across the call, so a handler that took `record.chain` the way every
    // thread-scoped method does would simply never reply and `call`'s deadline would fail this. It is
    // released at the end rather than left pending forever only because `shutdown()` awaits every chain.
    const srv = boot();
    let release = (): void => {};
    const chain = new Promise<void>((r) => { release = r; });
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir(), busy: true, turnStartedBroadcast: true, chain });

    expect(ok(await call({ threadId, command: "echo mid-turn" })).output).toBe("mid-turn");
    release();
  });

  it("refuses malformed params with -32602", async () => {
    const srv = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir() });

    expect(err(await call({ threadId })).code).toBe(ERR.INVALID_PARAMS);        // no command
    expect(err(await call({ threadId, command: "" })).code).toBe(ERR.INVALID_PARAMS); // empty command
    expect(err(await call({ command: "echo hi" })).code).toBe(ERR.INVALID_PARAMS);    // no thread named
  });
});

describe("thread/shellCommand — registration", () => {
  it("is registered, stable, and NOT origin-gated", async () => {
    expect(methodSchemas["thread/shellCommand"]).toBeDefined();
    expect(methodSchemas["thread/shellCommand"].experimental).toBeUndefined();
    expect(FLEET_UNSUPPORTED.has("thread/shellCommand")).toBe(false);
  });

  it("the params schema carries the deviation note, so the generated artifact does too", async () => {
    // A client reading the published schema is exactly the reader who would otherwise assume Codex's
    // semantics from the method name — the note is the only place the shape cannot carry it.
    const { shellCommandParams } = await import("../../../src/appserver/schema/workspace.js");
    expect(shellCommandParams.description).toBe("unsandboxed; output returns to the calling client only — the model never sees it (deviation from Codex's stream-into-turn)");
  });

  it("floods truncate at the primitive's 4 MiB cap instead of hanging or erroring the request", async () => {
    // Measured, not assumed (node 24): `exec` stops buffering at `maxBuffer`, kills the child and reports
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER — a string code, so `runBash`'s numeric-code branch maps it to a
    // plain exit 1 with `killed` unset, which is why this does NOT read as `timedOut`. The client's
    // guarantee is the one that matters: a `cat` of something enormous still answers.
    const srv = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession().session, { cwd: mkdir() });

    const res = ok(await call({ threadId, command: `node -e "process.stdout.write('x'.repeat(5*1024*1024))"` }));

    expect(res.code).not.toBe(0);
    expect(res.output.length).toBe(4 * 1024 * 1024);
    expect("timedOut" in res).toBe(false);
  });
});
