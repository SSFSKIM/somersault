// test/live/appserver-m3-acceptance.test.ts — M3 Task 17: the spec's `## Testing & acceptance` scenario
// ("Keyed live acceptance (one scenario, M2-style)") executed as written, in ONE keyed run against a REAL
// detached ccx host and a REAL engine — plus the four live obligations the execution ledger accumulated
// (see OBLIGATION 1-4 below, each named at the `it` that discharges it).
//
// Shape and discipline are `appserver-m2-acceptance.test.ts`'s, deliberately: ONE describe, sequential `it`s
// sharing state over ONE app server, ONE spawned host and ONE fleet thread. The sequence is stateful end to
// end — a park cannot be observed on a session nobody attached, a foreign swap cannot invalidate a cursor
// nobody minted — so independent-per-`it` servers would multiply the keyed cost and still not test the
// sequence. Each step keeps its own generous timeout so a failure names its leg. "Each observation is an
// assertion, not a log line", with two deliberate exceptions, both of which exist to SETTLE an open
// empirical question rather than to check one: `SWAP-WALLCLOCK` (obligation 1 — the evidence
// `SWAP_TIMEOUT_MS`'s sizing was only ever reasoned from code) and `STOP-PID` (P106's recorded finding that
// a terminal roster row is not proof the host process is gone).
//
// THE FLEET HALF RUNS AGAINST `dist/`, NOT `src/`. `spawnDetached` re-enters the ccx binary, so the host
// this test drives is the BUILT one — and the M3 §1a host-wire revisions (swap announces, prompt uuid,
// status model/thinking, agents catalog, turn-end result/failure, structured `decision_settled.answer`) are
// exactly what the app-server side asserts here. A stale `dist/` would therefore fail this file for reasons
// that have nothing to do with the app server, so beforeAll refuses to run against one (see `newestMtime`).
//
// Cost/keying: haiku throughout, prompts minimal, and every "make the turn take real wall-clock time" beat
// is a `sleep` rather than a verbose prompt — wall clock is free, tokens are not. The spawned host's
// permission shape is P106's, for P106's reason (its run-1 scar): the turn's OWN work must be ALLOWED
// (`sleep`) and the park must be a SEPARATE, LATER trigger (`touch`), or the park lands on the first tool
// call and the turn never becomes observable at all. Both rule syntaxes for each — `cmd:*` is the legacy
// PREFIX form (word boundary; deliberately refuses a compound command) and `cmd *` the newer wildcard form
// — which is also why every prompt insists on ONE command per Bash call.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";
import { ERR } from "../../src/appserver/rpc.js";
import { SWAP_TIMEOUT_MS } from "../../src/appserver/fleetEngine.js";
import { decodeFrame } from "../../src/host/wire.js";
import { spawnDetached } from "../../src/cli/spawn.js";
import type { CcxInvocation } from "../../src/cli/args.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { readRoster, TERMINAL } from "../../src/fleet/roster.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const HAIKU = "claude-haiku-4-5-20251001";
const HOST_NAME = "m3-acceptance";
const FIXTURE = "m3-acceptance-fixture.txt";
const FIXTURE_TEXT = "m3-acceptance fixture bytes\n";
/** The payload that proves §1a-e's structured `answer` travelled: a bare `allow_once` goes over the host
 *  wire in the LEGACY FLAT form (fleetEngine.ts's `flat` rule), so only an outcome carrying a payload can
 *  show that the whole object — not just its kind string — reaches `decision/resolved`. */
const PARK_MARKER = "m3-acceptance updatedInput marker";
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "..", "dist", "cli", "bin.js");
const SRC = join(HERE, "..", "..", "src");

const sleep = (ms: number): Promise<void> => delay(ms);
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Poll `f` until it yields a value, up to `ms`. Returns undefined on expiry so a caller can name its own
 *  failure instead of catching a generic timeout. */
async function until<T>(f: () => T | undefined, ms: number, every = 250): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() >= deadline) return undefined;
    await sleep(every);
  }
}

/** Signal 0 delivers nothing and throws ESRCH when nobody is there. `ms = 0` is one instantaneous check. */
async function pidGone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    try { process.kill(pid, 0); } catch { return true; }
    if (Date.now() >= deadline) return false;
    await sleep(250);
  }
}

/** THIS process's direct children. Used ONLY as a before/after diff around one `thread/start`, which is
 *  what keeps the reopen leg's SIGKILL aimed at the engine this test just created and at nothing else —
 *  the spawned fleet host is a child of this process too (`detached` does not reparent while the parent
 *  lives), and killing it here would be exactly the shared-daemon mistake teardown is careful to avoid.
 *  `pgrep` exits 1 with no matches, which `execFileSync` raises — an empty list, not a failure. */
function childPids(): number[] {
  try {
    return execFileSync("pgrep", ["-P", String(process.pid)], { encoding: "utf8" })
      .split("\n").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  } catch { return []; }
}

/** Newest mtime anywhere under `dir` — the staleness guard for the built binary (see the file header). */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (entry.isFile()) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

interface Notif { method: string; params: any }
/** An RPC refusal, carried as a decorated Error so a leg can assert the CODE and the DATA rather than a
 *  message substring — obligation 4's whole subject is which code a receipt maps onto. */
interface RpcErr extends Error { rpc: true; code: number; data?: Record<string, unknown> }

/** The same minimal WS JSON-RPC "lite" client the M1/M2 live files use (spec §4: no jsonrpc field),
 *  mirrored rather than imported because none of them exports it. One addition this run needs: a rejection
 *  carries `code`/`data` (see RpcErr). */
class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly notifications: Notif[] = [];
  readonly onNotification: Array<(n: Notif) => void> = [];
  private waiters: Array<{ pred: (n: Notif) => boolean; resolve: (n: Notif) => void }> = [];
  constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (typeof m.id !== "undefined" && (Object.prototype.hasOwnProperty.call(m, "result") || Object.prototype.hasOwnProperty.call(m, "error"))) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) {
          const err = new Error(m.error.message) as RpcErr;
          err.rpc = true; err.code = m.error.code; err.data = m.error.data;
          p.reject(err);
        } else p.resolve(m.result);
        return;
      }
      if (typeof m.method === "string") {
        const n: Notif = { method: m.method, params: m.params ?? {} };
        this.notifications.push(n);
        const i = this.waiters.findIndex((w) => w.pred(n));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(n); }
        for (const cb of [...this.onNotification]) { try { cb(n); } catch { /* a hook's failure is not the client's */ } }
      }
    });
  }
  /** Index of the next notification to arrive — hand it to `waitFor`/`since` to scope a wait to a step. */
  mark(): number { return this.notifications.length; }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timed out after ${timeoutMs}ms waiting for a reply to ${method} (id ${id})`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(label: string, timeoutMs: number, pred: (n: Notif) => boolean, from = 0): Promise<Notif> {
    const existing = this.notifications.slice(from).find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { pred, resolve: (n: Notif) => { clearTimeout(timer); resolve(n); } };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label} (saw since mark: ${this.notifications.slice(from).map((n) => n.method).join(", ") || "<nothing>"})`));
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
  /** Every notification since `from`, in arrival order — the ORDER is the evidence in obligation 3. */
  since(from: number): Notif[] { return this.notifications.slice(from); }
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Await a call that MUST be refused, and hand back the refusal. A resolved call is the failure. */
async function rpcError(label: string, p: Promise<unknown>): Promise<RpcErr> {
  let value: unknown;
  try { value = await p; }
  catch (e) {
    if ((e as RpcErr)?.rpc === true) return e as RpcErr;
    throw e;                                   // a transport/timeout failure is not the refusal under test
  }
  throw new Error(`${label}: expected an RPC refusal, got ${JSON.stringify(value)}`);
}

/** Text of every agentMessage item seen since `from`, joined — a turn's "result content" on the wire. */
function agentText(client: RpcClient, from: number): string {
  return client.since(from)
    .filter((n) => n.method === "item/completed" && n.params.item?.type === "agentMessage")
    .map((n) => String(n.params.item.text ?? "")).join("\n");
}

interface RawFrame { i: number; atMs: number; raw: Record<string, unknown> }

/** A RAW NDJSON peer of the host's unix socket — the FOREIGN client of the fleet legs: it starts the turn
 *  the app server attaches into (a turn the app server did not start is the only way `foreign` is a real
 *  category), and it is what issues the host-side `clear` in the swap leg. Raw on purpose: the subject of
 *  those legs is the WIRE, and driving them through the harness's own client would be measuring the client.
 *  The frame codec is the shared one (`host/wire.ts`) so this peer and `fleetEngine.ts` cannot drift on
 *  what a frame is. */
class HostWire {
  private sock?: Socket;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, (b: Record<string, unknown>) => void>();
  private watchers = new Set<(f: RawFrame) => void>();
  readonly frames: RawFrame[] = [];
  constructor(readonly name: string) {}

  async connect(socketPath: string): Promise<void> {
    const sock = connect(socketPath);
    this.sock = sock;
    await new Promise<void>((res, rej) => {
      const onErr = (e: Error) => rej(new Error(`${this.name}: connect ${socketPath} failed: ${e.message}`));
      sock.once("error", onErr);
      sock.once("connect", () => { sock.off("error", onErr); res(); });
    });
    sock.on("error", () => { /* a host that tore the socket down under us is a measurement, not a throw */ });
    sock.on("data", (chunk) => {
      this.buf += chunk.toString("utf8");
      for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        const raw = decodeFrame(line) as Record<string, unknown> | undefined;
        if (!raw) continue;
        const f: RawFrame = { i: this.frames.length, atMs: Date.now(), raw };
        this.frames.push(f);
        if (raw["t"] === "event") { for (const w of [...this.watchers]) w(f); continue; }
        if (typeof raw["id"] !== "number") continue;
        const id = raw["id"] as number;
        const r = this.pending.get(id);
        if (r) { this.pending.delete(id); r(raw); }
      }
    });
  }

  send(op: Record<string, unknown>, ms = 30_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const p = new Promise<Record<string, unknown>>((res, rej) => {
      this.pending.set(id, res);
      const t = setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`${this.name}: no reply to ${String(op["op"])} within ${ms}ms`)); }, ms);
      (t as { unref?: () => void }).unref?.();
    });
    this.sock?.write(JSON.stringify({ ...op, id }) + "\n");
    return p;
  }

  /** Fire and hand back the id WITHOUT waiting — `stop` tears the sockets down before its reply is written
   *  (P106 Q5), so awaiting one waits forever. */
  fireAndForget(op: Record<string, unknown>): number {
    const id = this.nextId++;
    this.sock?.write(JSON.stringify({ ...op, id }) + "\n");
    return id;
  }

  waitEvent(label: string, pred: (raw: Record<string, unknown>) => boolean, ms: number): Promise<RawFrame> {
    const seen = this.frames.find((f) => f.raw["t"] === "event" && pred(f.raw));
    if (seen) return Promise.resolve(seen);
    return new Promise<RawFrame>((res, rej) => {
      const w = (f: RawFrame) => { if (pred(f.raw)) { this.watchers.delete(w); res(f); } };
      this.watchers.add(w);
      const t = setTimeout(() => { if (this.watchers.delete(w)) rej(new Error(`${this.name}: ${label} never arrived within ${ms}ms`)); }, ms);
      (t as { unref?: () => void }).unref?.();
    });
  }

  destroy(): void { this.sock?.destroy(); }
}

live("M3 acceptance: fleet adoption, workspace and shell over one live host — plus the inProcess reopen leg", () => {
  let root = "";
  let sessionCwd = "";      // the SPAWNED host's cwd — the tree fs/search, fs/read and shellCommand answer for
  let reopenCwd = "";       // the inProcess reopen thread's own scratch tree
  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let wsA: WebSocket;
  let wsB: WebSocket;
  let a: RpcClient;         // the driver, and a watcher (initialize{watchThreads:true})
  let b: RpcClient;         // the SECOND WS client — it answers the park, and never drives a turn
  let raw: HostWire;        // the FOREIGN host client (see HostWire)
  let hostShort = "";
  let hostPid = 0;
  let threadId = "";        // the fleet thread (re-minted by the re-attach leg)
  let reopenThreadId = "";
  let foreignTurnId = "";   // the derived id (`t<seq>@e<epoch>`) of the turn the raw client started
  let foreignLiveFrom = 0;  // A's notification index at which the busy-attach replay ended and live news began
  let parkToolUseId = "";
  let parkTouchTarget = "";  // the path the parked `touch` named — the disk evidence that the allow landed
  let preSwapCursor = "";   // a `thread/read` cursor minted at epoch 0 — the foreign swap must invalidate it
  const held = new Set<string>();   // thread ids this test is holding, for teardown

  // The parkless safety net (M2's pattern, same reason): every leg after the deliberate park must NOT park,
  // and an unanswered consult would hang that leg until its timeout and report a misleading failure.
  // Armed per THREAD, so the reopen leg's own deliberate park is never auto-answered; the ids it answered
  // are asserted empty at the end of each half, so the net can never silently mask a park.
  const autoAllowThreads = new Set<string>();
  const autoAllowed: string[] = [];
  // OBLIGATION 2's tripwire, armed for the whole file: `thread/reopen` resolves promises whose query died,
  // and the SDK's own control-response write to a dead transport is the thing that could reject with nobody
  // listening. Collected rather than merely left to vitest's default so the reopen leg can NAME it.
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)); };

  /** Teardown for the ONE host this test spawned, by the pid off its own roster row — never a broad kill
   *  (agents-never-kill-shared-daemons). The ladder is P106's, and escalating past the first rung is itself
   *  a finding: the host's own `stop` op, then SIGTERM to that pid, then SIGKILL to that pid. */
  async function endSpawnedHost(): Promise<void> {
    if (!hostPid || await pidGone(hostPid, 0)) return;
    try {
      const c = new HostWire("teardown");
      await c.connect(hostSocketPath(hostPid));
      c.fireAndForget({ op: "stop" });
      await pidGone(hostPid, 15_000);
      c.destroy();
    } catch { /* the socket may already be gone: teardown got that far */ }
    if (await pidGone(hostPid, 0)) return;
    try { process.kill(hostPid, "SIGTERM"); } catch { /* it went away between the check and the signal */ }
    if (await pidGone(hostPid, 10_000)) return;
    try { process.kill(hostPid, "SIGKILL"); } catch { /* ditto */ }
    await pidGone(hostPid, 5_000);
  }

  beforeAll(async () => {
    // `realpathSync`: on macOS `tmpdir()` is a symlink (/var -> /private/var), and this path is compared
    // against a shell's own `pwd` (the shellCommand leg) and against `threadView.cwd`.
    root = realpathSync(mkdtempSync(join(tmpdir(), "cc-appserver-m3-")));
    sessionCwd = join(root, "cwd"); reopenCwd = join(root, "reopen");
    const fleetRoot = join(root, "fleet");
    for (const d of [sessionCwd, reopenCwd, fleetRoot]) mkdirSync(d, { recursive: true });
    writeFileSync(join(sessionCwd, FIXTURE), FIXTURE_TEXT);
    // Confines BOTH sides: the spawned child inherits it (spawnDetached forwards process.env), and
    // `fleet/list`/`thread/attach` read it at call time through fleet/paths.ts. The real fleet is never
    // touched, and every artifact of this run dies with `root`.
    process.env.CCX_FLEET_ROOT = fleetRoot;
    process.on("unhandledRejection", onUnhandled);

    expect(existsSync(BIN), `${BIN} is missing — run \`npm run build\` before the keyed run`).toBe(true);
    // The host under test is the BUILT binary (see the file header): a `dist/` older than `src/` would run
    // this scenario against a host that predates the §1a wire revisions it asserts.
    const binAge = statSync(BIN).mtimeMs;
    const srcAge = newestMtime(SRC);
    expect(binAge, `dist/ is older than src/ (bin ${new Date(binAge).toISOString()} vs src ${new Date(srcAge).toISOString()}) — run \`npm run build\` before the keyed run`).toBeGreaterThan(srcAge);

    server = new AppServer({}); // no token: this run exercises the control plane, not auth (wsTransport.test.ts owns that)
    listener = await listenWs(server, {});
    wsA = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    wsB = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(wsA);
    b = new RpcClient(wsB);
    a.onNotification.push((n) => {
      if (n.method !== "decision/requested" || !autoAllowThreads.has(n.params.threadId)) return;
      const entry = n.params.decision;
      if (entry?.kind !== "permission") return;  // only the kind the net knows how to answer
      autoAllowed.push(`${n.params.threadId}:${entry.toolUseId}`);
      void a.call("decision/respond", { threadId: n.params.threadId, toolUseId: entry.toolUseId, answer: { kind: "allow_once" } }).catch(() => {});
    });
    const initA = await a.call("initialize", { clientInfo: { name: "m3-acceptance-a" }, watchThreads: true });
    expect(initA.userAgent).toBe("cc-harness-appserver");
    await b.call("initialize", { clientInfo: { name: "m3-acceptance-b" }, watchThreads: true });

    // THE SPAWN SEAM, used exactly as production does. `spawnDetached` builds the child's argv as
    // [...execArgv, process.argv[1], "--__host", …] — in production argv[1] IS the binary and execArgv is
    // empty; under vitest argv[1] is tinypool's entry and execArgv carries the runner's own `--conditions`
    // flags, which would follow the child into a different module-resolution universe. Both are swapped for
    // the call and put back, so the child is the same `node dist/cli/bin.js --__host …` a real `ccx` forks.
    const inv: CcxInvocation = {
      command: "run", bg: false, detachable: true, print: false, json: false, all: false,
      continue: false, version: false, help: false, name: HOST_NAME,
      listen: { host: "127.0.0.1", port: 0 }, allowOrigins: [],
      // A backstop, not a mechanism: every path below ends with an explicit stop. If this file dies between
      // the spawn and teardown, the host reaps itself rather than outliving the run.
      idleTimeoutSec: 900,
      config: {
        cwd: sessionCwd,
        // `default`, explicitly: the ONE mode in which the broker is consulted at all, and it overrides
        // whatever `defaultMode` the developer's own settings carry (an `auto` there hands the decision to
        // the classifier and parks nothing).
        permissionMode: "default",
        model: HAIKU,
        settings: { permissions: { allow: ["Bash(sleep:*)", "Bash(sleep *)"], ask: ["Bash(touch:*)", "Bash(touch *)"] } },
      },
    };
    const argv1 = process.argv[1];
    const execArgv = process.execArgv;
    process.argv[1] = BIN;
    process.execArgv = [];
    let spawned: { short: string; banner: string };
    try { spawned = spawnDetached(inv); }
    finally { process.argv[1] = argv1; process.execArgv = execArgv; }
    hostShort = spawned.short;
    expect(hostShort).toMatch(/^[0-9a-f]{8}$/);

    // The roster row is written inside start(), before the engine opens; the socket follows right after.
    const row = await until(() => readRoster(hostShort), 60_000);
    expect(row, `host ${hostShort} never wrote a roster row within 60s`).toBeTruthy();
    hostPid = row!.pid;
    const sock = hostSocketPath(hostPid);
    expect(await until(() => (existsSync(sock) ? true : undefined), 60_000), `host ${hostShort} (pid ${hostPid}) never opened ${sock}`).toBe(true);

    raw = new HostWire("foreign");
    await raw.connect(sock);
    const follow = await raw.send({ op: "follow" });
    expect(follow.ok, `the foreign client could not follow the host: ${JSON.stringify(follow)}`).toBe(true);
  }, 180_000);

  afterAll(async () => {
    // Failure-tolerant, and ordered so the process-level rung runs LAST and unconditionally: a wedged host
    // is the one residue this file must never leave behind (P106's run-1 scar), and an earlier step
    // throwing must not skip it.
    try {
      for (const id of [...held]) { try { await a?.call("thread/close", { threadId: id }, 20_000); } catch { /* already closed */ } }
      try { await server?.shutdown(); } catch { /* best-effort */ }
      raw?.destroy();
      wsA?.close(); wsB?.close();
      try { await listener?.close(); } catch { /* best-effort */ }
    } finally {
      try { await endSpawnedHost(); } catch { /* best-effort */ }
      process.off("unhandledRejection", onUnhandled);
      if (root) rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("fleet/list shows the spawned session before anything attaches", async () => {
    const listed = await a.call("fleet/list", {}, 60_000);
    const row = listed.data.find((r: any) => r.short === hostShort);
    expect(row, `fleet/list does not show ${hostShort}: ${JSON.stringify(listed.data)}`).toBeTruthy();
    expect(row.pid).toBe(hostPid);
    expect(row.cwd).toBe(sessionCwd);
    expect(row.name).toBe(HOST_NAME);
    expect(row.kind).toBe("interactive");
    expect(typeof row.startedAt).toBe("number");
    // The LIVE half of the join (collectFleet's probe fold), not the roster's recorded state: a host whose
    // socket answers is neither terminal nor unresponsive.
    expect(["working", "blocked"], `unexpected live state ${JSON.stringify(row.state)}`).toContain(row.state);
    expect(row.unresponsive).toBeUndefined();
    // `threadId` is the ONE column this server owns, and nothing holds this row yet.
    expect(row.threadId, "fleet/list claimed a threadId before any attach").toBeUndefined();
  }, 120_000);

  it("OBLIGATION 3 — thread/attach into a BUSY foreign turn: the replay burst precedes the live turn's tail", async () => {
    // The turn is the FOREIGN client's, which is what makes the attach an adoption rather than a start:
    // `sleep 12` buys the wall clock this leg needs (P103b's lesson — real elapsed time, not a verbose
    // prompt that finishes in one burst), and the `touch` parks LATER, in the same turn, for the park leg.
    const prompt = await raw.send({
      op: "prompt",
      text: "Do exactly this using the Bash tool, one command per tool call, never chaining with && or ; : "
        + "first run `sleep 12`, then run `touch m3-park.txt`. Then reply with exactly: DONE",
    });
    expect(prompt.ok, `the foreign prompt was refused: ${JSON.stringify(prompt)}`).toBe(true);
    expect(typeof prompt.seq).toBe("number");
    // Attach only once there is something to replay: the first assistant frame means the engine is up and
    // has committed to a tool call, so the host's turn buffer holds real content.
    await raw.waitEvent("the foreign turn's first assistant frame",
      (r) => r["kind"] === "message" && (r["data"] as Record<string, unknown>)?.["type"] === "assistant", 180_000);

    const markA = a.mark();
    const attached = await a.call("thread/attach", { target: hostShort }, 60_000);
    threadId = attached.thread.id;
    held.add(threadId);
    expect(threadId).toBeTruthy();
    expect(attached.thread.origin).toBe("fleet");
    expect(attached.thread.short).toBe(hostShort);
    expect(attached.thread.name).toBe(HOST_NAME);
    expect(attached.thread.cwd).toBe(sessionCwd);
    // The settings mirror seeded from the host's own `status` BEFORE the record published (§1e) — model is
    // §1a-c's addition, and without it the attach reply would describe a thread whose model it never learned.
    expect(attached.thread.model).toBe(HAIKU);
    expect(attached.thread.permissionMode).toBe("default");
    // The watcher fan-out: `thread/attach` announces an adoption exactly as `thread/start` announces a start.
    const announced = await a.waitFor("thread/started (the adoption)", 30_000, (n) => n.method === "thread/started" && n.params.thread?.id === threadId, markA);
    expect(announced.params.thread.origin).toBe("fleet");

    // THE ORDER EVIDENCE. The follow replay is released by `activate()` — after the reply, after
    // thread/started — into a record with no subscribers yet, so what a client actually receives is the
    // SUBSCRIBE-time replay of it: turn/started (the in-flight foreign turn), then the buffered item events,
    // then thread/status/changed LAST. Everything after that closing status frame is live. One short is one
    // record (a second attach is idempotent), so this single burst is the only place the ordering is
    // observable at all.
    const markSub = a.mark();
    for (const [name, client] of [["a", a], ["b", b]] as const) {
      const sub = await client.call("thread/subscribe", { threadId }, 30_000);
      expect(sub.subscribed, `${name} could not subscribe`).toBe(true);
    }
    const burst = a.since(markSub);
    const iStart = burst.findIndex((n) => n.method === "turn/started");
    const iItem = burst.findIndex((n) => n.method.startsWith("item/"));
    const iStatus = burst.findIndex((n) => n.method === "thread/status/changed");
    const tags = burst.map((n) => n.method).join(" -> ");
    expect(iStart, `the busy-attach replay carried no turn/started — the host's mid-turn replay never opened a turn window: ${tags}`).toBeGreaterThanOrEqual(0);
    expect(iItem, `the busy-attach replay carried no item events — the buffered messages were not itemized: ${tags}`).toBeGreaterThan(iStart);
    expect(iStatus, `the busy-attach replay did not close with thread/status/changed: ${tags}`).toBeGreaterThan(iItem);
    // `active`, not the whole shape: if the model reached the `touch` before this attach landed, the same
    // burst legitimately also carries the park, and the closing status then reads `waitingOn:"decision"`.
    expect(burst[iStatus].params.status.state, `the busy-attach replay closed with ${JSON.stringify(burst[iStatus].params.status)}`).toBe("active");
    // The turn id is DERIVED from the host's seq at the CURRENT epoch, never minted (§1b) — which is what
    // makes a foreign turn first-class here.
    foreignTurnId = burst[iStart].params.turn.id;
    expect(foreignTurnId).toBe(`t${prompt.seq}@e0`);
    expect(burst[iStart].params.turn.status).toBe("inProgress");
    // Everything from here on is LIVE, and the next `it`s read from this index: the turn's own tail cannot
    // arrive until the park inside it has been answered, which is the leg after next.
    foreignLiveFrom = markSub + iStatus + 1;
  }, 600_000);

  it("OBLIGATION 4 — the park: a wrong-kind answer is -32602 with the host's own message; the SECOND client settles it", async () => {
    // The park was raised inside the turn above (the `touch` ask rule) and is either already on this wire or
    // about to be — either way `waitFor` from index 0 finds it, since only one decision has been raised.
    const requested = await a.waitFor("decision/requested (the touch park)", 300_000,
      (n) => n.method === "decision/requested" && n.params.threadId === threadId);
    const entry = requested.params.decision;
    expect(entry.kind).toBe("permission");
    expect(entry.toolName, `the park is not the Bash(touch) one this leg is about: ${JSON.stringify(entry)}`).toBe("Bash");
    parkToolUseId = String(entry.toolUseId);
    expect(parkToolUseId).toBeTruthy();
    // The park's own command, read off the wire rather than assumed from the prompt — the next leg proves
    // the allow reached the engine by looking for what THIS call was going to create.
    const command = String((entry.input as Record<string, unknown>)?.command ?? "");
    expect(command, `the parked call is not the ask-ruled touch: ${JSON.stringify(entry.input)}`).toMatch(/^touch\s+\S+$/);
    parkTouchTarget = command.split(/\s+/)[1];
    // The park is a VIEW of the host's park, and it reaches the SECOND client too — B never asked for it and
    // structurally could not have, since the thread did not exist when B connected.
    const onB = await b.waitFor("decision/requested on the OTHER client", 60_000,
      (n) => n.method === "decision/requested" && n.params.decision?.toolUseId === parkToolUseId);
    expect(onB.params.threadId).toBe(threadId);
    // The park's turn id: a UI must be able to attach it to the turn row it belongs to.
    expect(requested.params.turnId).toBe(foreignTurnId);

    // (a) OBLIGATION 4's tripwire. The receipt strings were live-measured once (P106, 2026-08-11) and never
    // re-measured; this is the mapping that proves host.ts's wording has not drifted underneath the bridge.
    const mismatch = await rpcError("a question_answer against a permission park",
      a.call("decision/respond", { threadId, toolUseId: parkToolUseId, answer: { kind: "question_answer", answers: { m3: "wrong-family" } } }, 30_000));
    expect(mismatch.code).toBe(ERR.INVALID_PARAMS);
    expect(mismatch.message, `the kind-mismatch receipt is not the host's own wording: ${JSON.stringify(mismatch.message)}`).toMatch(/^kind mismatch: permission park cannot take question_answer/);
    // The park SURVIVES a refused answer (host.ts refuses BEFORE settling), which is what makes (b) possible
    // — and what a client with a mistyped answer depends on.
    expect((await a.call("decision/list", { threadId }, 30_000)).data.map((d: any) => d.toolUseId),
      "the kind-mismatched answer consumed the park it was refused for").toContain(parkToolUseId);

    // (b) The answer, from the SECOND WS client — the one that never drove a turn. `updatedInput` is what
    // makes this outcome STRUCTURED on the host wire (a bare allow_once travels in the legacy flat form),
    // so it is the only shape that can prove §1a-e's `answer` field carries the whole payload.
    const updatedInput = { ...(entry.input as Record<string, unknown>), description: PARK_MARKER };
    const markA = a.mark(); const markB = b.mark();
    const answered = await b.call("decision/respond", { threadId, toolUseId: parkToolUseId, answer: { kind: "allow_once", updatedInput } }, 60_000);
    expect(answered.ok).toBe(true);
    for (const [name, client, mark] of [["the answering client", b, markB], ["the OTHER client", a, markA]] as const) {
      const resolved = await client.waitFor(`decision/resolved on ${name}`, 60_000,
        (n) => n.method === "decision/resolved" && n.params.toolUseId === parkToolUseId, mark);
      // Attribution is the HOST's `decision_settled.by`, not a local claim: for a fleet park this server is
      // one client of that host among others, and it answers under one label whichever WS peer asked.
      expect(String(resolved.params.by), `decision/resolved.by is not this server's host label: ${JSON.stringify(resolved.params.by)}`).toMatch(/^ccx-appserver-\d+$/);
      expect(resolved.params.answer, `${name} received no structured answer: ${JSON.stringify(resolved.params)}`).toEqual({ kind: "allow_once", updatedInput });
    }

    // (c) The lost race, on the same id, arriving after the park is gone: `{ok:true, alreadyAnsweredBy}` is
    // NOT a refusal host-side, and -33002 with `data.by` is the exact shape a second answer to a LOCAL park
    // gets — one shape whichever origin raced it.
    const late = await rpcError("a second answer to a settled park",
      a.call("decision/respond", { threadId, toolUseId: parkToolUseId, answer: { kind: "allow_once" } }, 30_000));
    expect(late.code).toBe(ERR.ALREADY_SETTLED);
    expect(String(late.data?.by), `the lost race named no winner: ${JSON.stringify(late.data)}`).toMatch(/^ccx-appserver-\d+$/);

    // The deliberate park has been observed; nothing after this may park (see the net's declaration).
    autoAllowThreads.add(threadId);
  }, 600_000);

  it("the answered foreign turn completes, and its tail lands AFTER the replay burst (obligation 3's other half)", async () => {
    // Split from the attach leg deliberately: a parked turn cannot end, so the terminal event this asserts
    // is only reachable once the leg above answered. `foreignLiveFrom` is the index the busy-attach replay
    // closed at, so every notification this leg reads is provably live rather than replayed — which is what
    // makes "the replayed frames came FIRST" an ordering claim rather than a presence one.
    const done = await a.waitFor("turn/completed (the foreign turn)", 300_000,
      (n) => n.method === "turn/completed" && n.params.turn?.id === foreignTurnId, foreignLiveFrom);
    expect(done.params.turn.status, `the foreign turn did not complete cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");
    expect(agentText(a, foreignLiveFrom), "the foreign turn's reply never reached this client as an agentMessage item").toContain("DONE");
    // The allow reached the ENGINE, not just the host: the tool call the park gated actually ran, in the
    // session's own cwd. The target is the one the parked call itself named (captured in the leg above).
    expect(existsSync(resolve(sessionCwd, parkTouchTarget)), `the allowed \`touch ${parkTouchTarget}\` never ran — the answer did not reach the engine`).toBe(true);
  }, 600_000);

  it("turn/start through the app server: turn/started, the reply's content, turn/completed", async () => {
    const markA = a.mark(); const markB = b.mark();
    const turn = await a.call("turn/start", { threadId, input: "Reply with exactly: m3-turn-ok" }, 60_000);
    const turnId = turn.turn.id;
    expect(turn.turn.status).toBe("inProgress");
    // Derived, not minted, for an OWN turn too — and at the same epoch, since nothing has swapped yet.
    expect(turnId, `an own fleet turn was minted rather than derived: ${turnId}`).toMatch(/^t\d+@e0$/);
    expect(turnId).not.toBe(foreignTurnId);
    // The subscriber that never asked hears the same lifecycle: the fleet event layer is the SOLE owner of
    // it, so own and foreign turns look identical on the wire.
    const startedOnB = await b.waitFor("turn/started on the OTHER client", 60_000, (n) => n.method === "turn/started" && n.params.turn?.id === turnId, markB);
    expect(startedOnB.params.turn.status).toBe("inProgress");
    const user = a.since(markA).find((n) => n.method === "item/completed" && n.params.item?.type === "userMessage");
    expect(user, "no userMessage item was emitted for the own turn — the §1a-b uuid stitch has nothing to join on").toBeTruthy();
    expect(String(user!.params.item.text)).toContain("m3-turn-ok");
    const done = await a.waitFor("turn/completed (the own turn)", 300_000, (n) => n.method === "turn/completed" && n.params.turn?.id === turnId, markA);
    expect(done.params.turn.status, `the own fleet turn did not complete: ${JSON.stringify(done.params.turn)}`).toBe("completed");
    expect(agentText(a, markA), "the own turn produced no agent reply on the wire").toContain("m3-turn-ok");
  }, 600_000);

  it("turn/interrupt ends a turn that is in flight", async () => {
    const markA = a.mark();
    const turn = await a.call("turn/start", { threadId, input: "Using the Bash tool, run exactly one command: `sleep 30`. Then reply with exactly: DONE" }, 60_000);
    const turnId = turn.turn.id;
    await a.waitFor("turn/started (the interrupt target)", 60_000, (n) => n.method === "turn/started" && n.params.turn?.id === turnId, markA);
    // Wait for real output so the interrupt lands mid-work rather than before the model has begun.
    await a.waitFor("the first non-prompt item of the interrupted turn", 180_000,
      (n) => (n.method === "item/started" || n.method === "item/completed") && n.params.turnId === turnId && n.params.item?.type !== "userMessage", markA);
    const interrupted = await a.call("turn/interrupt", { threadId }, 60_000);
    expect(interrupted.interrupted).toBe(true);
    // The terminal event is the HOST's own turn end, whatever it says (§1e): this server synthesizes no
    // local status for a fleet turn, so both a clean end and a thrown one are legitimate outcomes here —
    // what must hold is that the turn ENDS and the thread goes idle.
    const done = await a.waitFor("turn/completed (the interrupted turn)", 300_000, (n) => n.method === "turn/completed" && n.params.turn?.id === turnId, markA);
    expect(["completed", "failed", "interrupted"], `an interrupted fleet turn reached no terminal state: ${JSON.stringify(done.params.turn)}`).toContain(done.params.turn.status);
    const idle = await until(() => {
      const last = a.notifications.filter((n) => n.method === "thread/status/changed" && n.params.threadId === threadId).pop();
      return last?.params.status?.state === "idle" ? last : undefined;
    }, 60_000);
    expect(idle, "the thread never went idle after the interrupt").toBeTruthy();
  }, 600_000);

  it("fleet thread/read pages the persisted transcript and mints an epoch-0 cursor", async () => {
    // Deliberately BEFORE the swap leg, not after it as the spec's prose order reads: a `clear` drops the
    // record's sessionId, so a read taken afterwards is an empty page that proves nothing about paging. The
    // cursor minted here is what the swap leg then shows invalidated, which is the stronger form of the same
    // claim (the transcript IS paged, and the epoch bump IS what stops the walk).
    const page1 = await a.call("thread/read", { threadId, limit: 2 }, 120_000);
    expect(page1.data.length, "the fleet thread read back an empty transcript").toBeGreaterThan(0);
    expect(page1.data.length).toBeLessThanOrEqual(2);
    expect(typeof page1.nextCursor, `three turns produced a single page: ${JSON.stringify(page1)}`).toBe("string");
    expect(String(page1.nextCursor), "the cursor is not qualified by the thread's epoch").toMatch(/^0:\d+$/);
    preSwapCursor = String(page1.nextCursor);
    const page2 = await a.call("thread/read", { threadId, cursor: preSwapCursor, limit: 2 }, 120_000);
    expect(page2.data.length, "the second page came back empty").toBeGreaterThan(0);
    // Pages walk oldest-ward and do not repeat themselves.
    const first = new Set(page1.data.map((i: any) => i.id));
    expect(page2.data.some((i: any) => first.has(i.id)), `the second page repeated the first: ${JSON.stringify(page2.data.map((i: any) => i.id))}`).toBe(false);
  }, 300_000);

  it("OBLIGATION 1 — foreign swap: a raw `clear` on the host socket announces thread/rewound and invalidates the cursor", async () => {
    const markA = a.mark(); const markB = b.mark();
    // WALL CLOCK, measured rather than reasoned: `SWAP_TIMEOUT_MS` (300s) bounds this exact operation from
    // the app server's side (fleetEngine.ts's forwarded swap ops), and until this run its headroom could
    // only be argued from the code — the host's side is a dry run, a checkpoint restore, a fresh `claude`
    // spawn and a flag-state replay. Printed as evidence (one of this file's two deliberate log lines) and
    // asserted against the constant it sizes.
    const t0 = Date.now();
    const cleared = await raw.send({ op: "clear" }, SWAP_TIMEOUT_MS);
    const replyMs = Date.now() - t0;
    expect(cleared.ok, `the host refused the foreign clear: ${JSON.stringify(cleared)}`).toBe(true);
    const rewound = await a.waitFor("thread/rewound (the foreign clear)", SWAP_TIMEOUT_MS, (n) => n.method === "thread/rewound" && n.params.threadId === threadId, markA);
    const announceMs = Date.now() - t0;
    console.log("SWAP-WALLCLOCK: " + JSON.stringify({ op: "clear", hostReplyMs: replyMs, rewoundAnnouncedMs: announceMs, swapTimeoutMs: SWAP_TIMEOUT_MS, headroomFactor: Number((SWAP_TIMEOUT_MS / Math.max(replyMs, announceMs, 1)).toFixed(1)) }));
    expect(Math.max(replyMs, announceMs), `a host-side swap took ${Math.max(replyMs, announceMs)}ms against a ${SWAP_TIMEOUT_MS}ms deadline — the constant's headroom is gone`).toBeLessThan(SWAP_TIMEOUT_MS);

    // §1a-a: a `clear` announces like a rewind does, and `cleared` is the POSITIVE tag that separates the
    // two on one notification. The id is explicitly null, never a missing key.
    expect(rewound.params.cleared).toBe(true);
    expect(rewound.params).toHaveProperty("sessionId");
    expect(rewound.params.sessionId).toBe(null);
    // Both scopes: a swap changes what the thread IS, so the second client hears it too.
    await b.waitFor("thread/rewound on the OTHER client", 30_000, (n) => n.method === "thread/rewound" && n.params.threadId === threadId, markB);

    // THE EPOCH IS THE POINT. The rows the pre-swap cursor addressed are not the rows those offsets address
    // now, so the walk is refused rather than silently answered from a different conversation.
    const stale = await rpcError("a pre-swap read cursor", a.call("thread/read", { threadId, cursor: preSwapCursor }, 60_000));
    expect(stale.code).toBe(ERR.INVALID_PARAMS);
    expect(stale.message).toBe("cursor invalidated by a rewind; re-read from the start");
    // …and a fresh read is legal again: the conversation the host swapped in has no persisted rows yet.
    const fresh = await a.call("thread/read", { threadId }, 60_000);
    expect(fresh.data).toEqual([]);
    expect(fresh.nextCursor).toBe(null);
  }, 600_000);

  it("fs/search finds a file in the session's tree and fs/read round-trips its bytes", async () => {
    // Rooted on the SESSION's own cwd — which is exactly how a client uses this pair: it reads `cwd` off the
    // thread view and hands it back as a search root. A scratch fixture rather than a checked-in repo file
    // so the assertion is byte-exact and cannot drift with the tree.
    // Idempotent by `short` (§1e): the same record comes back, nothing is dialled and nothing is announced —
    // and the `cwd` it reports is the root this leg searches, which is the promise `threadCwd` exists to keep.
    const again = await a.call("thread/attach", { target: hostShort }, 60_000);
    expect(again.thread.id, "a second attach for one target minted a second thread").toBe(threadId);
    expect(again.thread.cwd).toBe(sessionCwd);
    const found = await a.call("fs/search", { query: "m3-acceptance-fixture", roots: [sessionCwd] }, 60_000);
    const match = found.matches.find((m: any) => m.path === FIXTURE);
    expect(match, `fs/search did not find ${FIXTURE} under ${sessionCwd}: ${JSON.stringify(found.matches)}`).toBeTruthy();
    expect(match.root, "the match does not carry the root that produced it").toBe(sessionCwd);
    expect(typeof match.score).toBe("number");
    // An empty query is a legal request with an empty answer, not a listing dressed up as a search.
    expect((await a.call("fs/search", { query: "   ", roots: [sessionCwd] }, 30_000)).matches).toEqual([]);

    const read = await a.call("fs/read", { path: join(sessionCwd, FIXTURE) }, 60_000);
    expect(Buffer.from(read.dataBase64, "base64").toString("utf8"), "fs/read did not round-trip the file's bytes").toBe(FIXTURE_TEXT);
    expect(read.size).toBe(Buffer.byteLength(FIXTURE_TEXT));
    // A relative path is refused rather than resolved against THIS server's cwd, which is not the client's.
    const relative = await rpcError("a relative fs/read path", a.call("fs/read", { path: FIXTURE }, 30_000));
    expect(relative.code).toBe(ERR.INVALID_PARAMS);
    expect(relative.message).toBe("path must be absolute");
  }, 180_000);

  it("thread/shellCommand runs in the session's own cwd", async () => {
    const shell = await a.call("thread/shellCommand", { threadId, command: `pwd && cat ${FIXTURE}` }, 60_000);
    expect(shell.code, `the shell command failed: ${JSON.stringify(shell)}`).toBe(0);
    expect(shell.timedOut).toBeUndefined();
    // Both halves of "where this thread lives": the directory the shell reports, and a relative read that
    // could only succeed there. `threadCwd` is the one answer behind the thread view and this exec.
    expect(shell.output.split("\n")[0], "the command did not run in the thread's cwd").toBe(sessionCwd);
    expect(shell.output).toContain(FIXTURE_TEXT.trim());
  }, 180_000);

  it("thread/close detaches without ending the host, and a re-attach adopts the same session again", async () => {
    const markA = a.mark();
    expect((await a.call("thread/close", { threadId }, 60_000)).ok).toBe(true);
    const closed = await a.waitFor("thread/closed (the detach)", 30_000, (n) => n.method === "thread/closed" && n.params.threadId === threadId, markA);
    expect(closed.params.reason, "a plain close claimed a reason — a detach is not a stop").toBeUndefined();
    held.delete(threadId);
    autoAllowThreads.delete(threadId);

    // CLOSE IS NOT STOP: the host is still there, still answering its own wire, still holding the
    // conversation. Asked on the FOREIGN socket, which this server's detach never touched.
    expect(await pidGone(hostPid, 0), "thread/close killed the host process").toBe(false);
    const status = await raw.send({ op: "status" });
    expect(status.ok, `the host stopped answering after the detach: ${JSON.stringify(status)}`).toBe(true);
    expect(typeof status.state, `the host's status reply lost its state: ${JSON.stringify(status)}`).toBe("string");

    const reattached = await a.call("thread/attach", { target: hostShort }, 60_000);
    threadId = reattached.thread.id;
    held.add(threadId);
    autoAllowThreads.add(threadId);
    expect(reattached.thread.short).toBe(hostShort);
    expect(reattached.thread.id, "the re-attach reused the closed thread's id").not.toBe(closed.params.threadId);
    for (const client of [a, b]) expect((await client.call("thread/subscribe", { threadId }, 30_000)).subscribed).toBe(true);
    // The listing now names the holder — the one column this server owns.
    const listed = await a.call("fleet/list", {}, 60_000);
    expect(listed.data.find((r: any) => r.short === hostShort)?.threadId).toBe(threadId);
  }, 300_000);

  it("thread/stop ends the host and fleet/list reads terminal", async () => {
    const markA = a.mark();
    expect((await a.call("thread/stop", { threadId }, 120_000)).ok).toBe(true);
    const closed = await a.waitFor("thread/closed (stopped)", 60_000, (n) => n.method === "thread/closed" && n.params.threadId === threadId, markA);
    expect(closed.params.reason, "a stop did not distinguish itself from a plain close").toBe("stopped");
    held.delete(threadId);
    autoAllowThreads.delete(threadId);

    const row = readRoster(hostShort);
    expect(row, "the roster row vanished instead of finalizing").toBeTruthy();
    expect(TERMINAL.has(row!.state), `the roster row is not terminal: ${JSON.stringify(row)}`).toBe(true);
    expect(row!.state, "an operator stop recorded something other than `stopped`").toBe("stopped");
    const listed = await a.call("fleet/list", {}, 60_000);
    const listedRow = listed.data.find((r: any) => r.short === hostShort);
    expect(listedRow.state).toBe("stopped");
    expect(typeof listedRow.endedAt).toBe("number");
    expect(listedRow.threadId, "fleet/list still names a holder for a stopped session").toBeUndefined();
    // RECORDED, NOT ASSERTED (P106's finding, and this file's second deliberate log line): a terminal roster
    // row and a closed socket are not proof the process is gone — teardown bounds dispose at a grace and
    // then leaves, so whatever the SDK still holds open can keep the event loop alive. afterAll's ladder
    // reaps it either way; what this run adds is a second measurement of how often it has to.
    console.log("STOP-PID: " + JSON.stringify({ pid: hostPid, exitedWithin20s: await pidGone(hostPid, 20_000) }));
    // Nothing parked after the deliberate park (the net's own honesty check for the fleet half).
    expect(autoAllowed, `a decision parked after the acceptance park — a leg above only passed because the net answered for it: ${JSON.stringify(autoAllowed)}`).toEqual([]);
  }, 300_000);

  it("OBLIGATION 2 — inProcess reopen: a park survives its engine's death, the recovery settles it, and a follow-up turn works", async () => {
    // The reopen leg is the canUseTool-over-dead-transport probe (ledger minor 54): `reset()` resolves
    // promises whose query has already ended, and the SDK's own control-response write to a dead subprocess
    // is where an unhandled rejection would surface. Everything below is arranged so that path is actually
    // taken — a park OUTSTANDING at the moment the engine dies.
    const before = new Set(childPids());
    const started = await a.call("thread/start", {
      // `settingSources: []` is load-bearing exactly as in the M1/M2 acceptances: a developer's own
      // `~/.claude/settings.json` would pre-authorize the write and the park this leg needs would never
      // happen. `default`, not bypass, for the same reason.
      config: { permissionMode: "default", cwd: reopenCwd, settingSources: [], model: HAIKU },
      unattended: "park",
    }, 120_000);
    reopenThreadId = started.thread.id;
    held.add(reopenThreadId);
    expect(started.thread.origin).toBe("inProcess");
    expect((await a.call("thread/subscribe", { threadId: reopenThreadId }, 30_000)).subscribed).toBe(true);

    const markA = a.mark();
    const turn = await a.call("turn/start", { threadId: reopenThreadId, input: "Create a file note.txt in the current directory containing exactly: m3-reopen-ok" }, 60_000);
    const deadTurnId = turn.turn.id;
    const requested = await a.waitFor("decision/requested (the park to strand)", 300_000,
      (n) => n.method === "decision/requested" && n.params.threadId === reopenThreadId, markA);
    const strandedId = String(requested.params.decision.toolUseId);
    expect(requested.params.decision.kind).toBe("permission");

    // THE DEATH. The engine's own `dispose()` cannot be used here and that is the whole point: it is
    // `input.close(); await done`, and `done` cannot resolve while a turn sits inside canUseTool holding one
    // of our parked promises (the C1 circular wait server.ts's closeRecord documents). So the engine dies the
    // way a real one does — its CLI child goes away — aimed by a before/after diff of THIS process's
    // children so nothing else, the spawned fleet host included, is ever in range.
    const spawnedPids = childPids().filter((p) => !before.has(p));
    expect(spawnedPids.length, "no new child process appeared for the inProcess engine — the SIGKILL has nothing to aim at").toBeGreaterThan(0);
    for (const pid of spawnedPids) { try { process.kill(pid, "SIGKILL"); } catch { /* it exited on its own */ } }

    const failed = await a.waitFor("turn/completed (the turn the death took with it)", 120_000,
      (n) => n.method === "turn/completed" && n.params.turn?.id === deadTurnId, markA);
    expect(failed.params.turn.status).toBe("failed");
    // The engine handle, read the way the M2 acceptance reads it — this test owns the server object, and
    // `isEnded()` is the ONLY dead-engine signal the wire's own -33005 gate is allowed to consult.
    const record: any = server.registry.get(reopenThreadId);
    expect(record, "the record vanished when its engine died — a dead thread must stay addressable").toBeTruthy();
    expect(await until(() => (record.session.isEnded() ? true : undefined), 60_000), "the engine never latched isEnded after its child was killed").toBe(true);
    const gone = await rpcError("a live-transport method on a dead thread", a.call("thread/usage/read", { threadId: reopenThreadId }, 30_000));
    expect(gone.code).toBe(ERR.ENGINE_GONE);

    // THE RECOVERY. Armed first: every turn from here on must not park (the net), and the ghost park below
    // is settled by the reopen itself rather than answered by anyone.
    autoAllowThreads.add(reopenThreadId);
    const markR = a.mark();
    const reopened = await a.call("thread/reopen", { threadId: reopenThreadId }, 300_000);
    expect(reopened.ok).toBe(true);
    // The dead conversation's park is SETTLED, not left listing: its awaiter is provably gone, and a client
    // that was told about a park is owed a terminal event for it.
    const ghost = await a.waitFor("decision/resolved (the stranded park)", 60_000,
      (n) => n.method === "decision/resolved" && n.params.toolUseId === strandedId, markR);
    expect(ghost.params.by).toBe("system");
    expect(ghost.params.answer).toEqual({ kind: "deny" });
    // The established "engine swapped, resync" signal: the epoch moved, so every outstanding cursor is stale.
    const rewound = await a.waitFor("thread/rewound (the reopen)", 60_000, (n) => n.method === "thread/rewound" && n.params.threadId === reopenThreadId, markR);
    expect(rewound.params).toHaveProperty("sessionId");
    expect((await a.call("decision/list", { threadId: reopenThreadId }, 30_000)).data, "a ghost park is still listing after the reopen").toEqual([]);

    // …and the thread is a working thread again, on a real engine.
    const markF = a.mark();
    const turn2 = await a.call("turn/start", { threadId: reopenThreadId, input: "Reply with exactly: reopened-ok" }, 60_000);
    const done = await a.waitFor("turn/completed (the post-reopen turn)", 300_000, (n) => n.method === "turn/completed" && n.params.turn?.id === turn2.turn.id, markF);
    expect(done.params.turn.status, `the recovered thread could not complete a turn: ${JSON.stringify(done.params.turn)}`).toBe("completed");
    expect(agentText(a, markF)).toContain("reopened-ok");

    expect((await a.call("thread/close", { threadId: reopenThreadId }, 60_000)).ok).toBe(true);
    held.delete(reopenThreadId);
    // OBLIGATION 2's verdict. Vitest fails a run on an unhandled rejection anyway; asserting it HERE is what
    // names the suspect — the reopen's `reset()` resolving canUseTool promises whose transport is gone.
    expect(unhandled, `unhandled rejection(s) during this run — the dead-transport reopen path above is the suspect this tripwire exists for:\n${unhandled.join("\n---\n")}`).toEqual([]);
    expect(autoAllowed, `a decision parked on the recovered thread: ${JSON.stringify(autoAllowed)}`).toEqual([]);
  }, 900_000);
});
