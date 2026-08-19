// test/unit/appserver/archive.test.ts — M5 Task 5: the archive marker store (spec D-M5-3 rev 2), and
// M5 Task 9: `thread/archive`/`thread/unarchive`, the two handlers over it (second half of this file).
// Everything here writes only into its own temp directory, and every one of those goes through `mkTmp` so
// `afterAll` takes it back. The one row that exercises the DEFAULT location (no `ccxDir`) drives
// `CCX_FLEET_ROOT`/`HOME`, because the real default is a developer's live `~/.claude`.
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listArchived, createArchiveMarker, removeArchiveMarker } from "../../../src/appserver/archive.js";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import { findLiveBySessionId } from "../../../src/appserver/sessionLib.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { startFakeHost, type FakeHostControls } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";

// Every temp root this file mints is recorded and removed at the end. Bare `mkdtempSync`es left ~20
// orphan directories in $TMPDIR per suite run; the sibling config-domain.test.ts cleans each of its own.
const temps: string[] = [];
function mkTmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); temps.push(d); return d; }
afterAll(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("archive markers", () => {
  it("create/list/remove round-trip; both directions idempotent; absent dir = empty set", async () => {
    const ccxDir = mkTmp("m5ccx-");
    expect(await listArchived({ ccxDir: join(ccxDir, "never-made") })).toEqual(new Set());
    await createArchiveMarker("sess-1", { ccxDir });
    await createArchiveMarker("sess-1", { ccxDir }); // EEXIST → fine
    expect(await listArchived({ ccxDir })).toEqual(new Set(["sess-1"]));
    expect(existsSync(join(ccxDir, "archived", "sess-1"))).toBe(true);
    await removeArchiveMarker("sess-1", { ccxDir });
    await removeArchiveMarker("sess-1", { ccxDir }); // ENOENT → fine
    expect(await listArchived({ ccxDir })).toEqual(new Set());
  });
  it("a path-hostile sessionId refuses instead of composing a path", async () => {
    const ccxDir = mkTmp("m5ccx-");
    await expect(createArchiveMarker("../escape", { ccxDir })).rejects.toThrow(/sessionId/);
  });

  // ── beyond the brief ───────────────────────────────────────────────────────────────────────────────
  // The two rows above are the brief's. Each row below pins something they leave undefended; the full
  // mutation matrix that proves each one discriminates is in the task-5 report.

  it("the two ids the CHARACTER CLASS alone admits — `.` and `..` — refuse too, from BOTH entry points, and a legal id is not caught with them", async () => {
    const ccxDir = mkTmp("m5ccx-");
    // `checkId` is two rules, and the brief's row reaches only the first: `../escape` is rejected by the
    // `/`, so `sessionId === "." || sessionId === ".."` — made entirely of admitted characters — was
    // never exercised. Both compose a real path: `join(<archived>, "..")` is the ccx dir and
    // `join(<archived>, ".")` is the marker dir itself. Measured with the clause removed: a create at
    // either is an EEXIST the store SWALLOWS (a silent no-op reported as success) and a remove at either
    // is an `unlink` aimed at a live directory.
    const hostile = ["..", ".", "../escape", "a/b", "/abs", "", "sess\u0000", "~/x", "a b", "..\\win"];
    for (const id of hostile) {
      await expect(createArchiveMarker(id, { ccxDir })).rejects.toThrow(/sessionId/);
      await expect(removeArchiveMarker(id, { ccxDir })).rejects.toThrow(/sessionId/);
    }
    // The refusal precedes the `mkdir`, so a refused call leaves no trace of the store at all.
    expect(existsSync(join(ccxDir, "archived"))).toBe(false);
    expect(readdirSync(ccxDir)).toEqual([]);
    // …and the screen is not so tight that it refuses what the store actually stores. Session ids are
    // UUIDs; `.` `_` `-` are admitted because a name may not be a UUID forever, and every one of these
    // is a filename that walks nowhere.
    const legal = ["9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f", "sess_1", "sess.1", "sess-1", "A0"];
    for (const id of legal) await createArchiveMarker(id, { ccxDir });
    expect(await listArchived({ ccxDir })).toEqual(new Set(legal));
  });

  it("a traversing id handed to REMOVE does not unlink the file it names", async () => {
    const ccxDir = mkTmp("m5ccx-");
    mkdirSync(join(ccxDir, "archived"), { recursive: true });
    const victim = join(ccxDir, "victim");
    writeFileSync(victim, "not the store's to delete");
    // The screen is on both entry points, and remove is the one where skipping it deletes rather than
    // creates: `unlink(join(<archived>, "../victim"))` is a live file one directory up. Task 9 hands
    // this function a client-supplied `threadId`.
    await expect(removeArchiveMarker("../victim", { ccxDir })).rejects.toThrow(/sessionId/);
    expect(existsSync(victim)).toBe(true);
  });

  it("a failure that is not the idempotent one is raised, never swallowed into 'nothing is archived' or 'archived, sure'", async () => {
    // Each catch here is narrowed to ONE errno, and a widening would be invisible to the round-trip row:
    // every widened form still answers correctly for the happy path. These are the shapes that separate
    // "the transition happened" from "the call returned".
    //
    // (a) `<ccxDir>/archived` occupied by a regular file — what a crashed or hand-edited state dir can
    //     look like. `readdir` gives ENOTDIR (not the ENOENT `listArchived` treats as "none archived")
    //     and `mkdir` gives EEXIST from OUTSIDE the create's try, so both must surface.
    const a = mkTmp("m5ccx-");
    writeFileSync(join(a, "archived"), "");
    await expect(listArchived({ ccxDir: a })).rejects.toThrow(/ENOTDIR/);
    await expect(createArchiveMarker("sess-1", { ccxDir: a })).rejects.toThrow(/EEXIST/);
    // (b) a create failure that is NOT the idempotent EEXIST. 300 chars is a legal id by the character
    //     screen and longer than any filename this filesystem will take (NAME_MAX is 255 on macOS and
    //     Linux alike), so it needs no permission bits to reproduce and no root-only guard.
    const b = mkTmp("m5ccx-");
    await expect(createArchiveMarker("a".repeat(300), { ccxDir: b })).rejects.toThrow(/ENAMETOOLONG/);
    expect(await listArchived({ ccxDir: b })).toEqual(new Set());
    // (c) a remove failure that is NOT ENOENT: the marker path occupied by a directory. The errno differs
    //     by platform (EPERM on macOS, EISDIR on Linux), so the claim asserted is the refusal itself.
    const c = mkTmp("m5ccx-");
    mkdirSync(join(c, "archived", "sess-d"), { recursive: true });
    await expect(removeArchiveMarker("sess-d", { ccxDir: c })).rejects.toThrow();
  });

  it("a marker path occupied by a SYMLINK is refused, never followed: the file it points at keeps its bytes", async () => {
    // `wx` is O_CREAT|O_EXCL, which by definition will not follow a symlink at the target. No state the
    // store itself produces can tell `wx` from a plain `w` — the marker is always empty, so a truncating
    // create leaves byte-identical results — but this row's state is one the store does NOT produce and
    // must survive, the same class as row 5's crashed-or-hand-edited `archived/`. Here the difference
    // between the two flags is another file's contents, measured: with `flag:"w"` the target below is
    // truncated to 0 bytes and the call still resolves, so nothing downstream ever learns of it.
    const ccxDir = mkTmp("m5ccx-");
    mkdirSync(join(ccxDir, "archived"), { recursive: true });
    const precious = join(ccxDir, "precious-settings.json");
    writeFileSync(precious, '{"keep":"me"}');
    symlinkSync(join("..", "precious-settings.json"), join(ccxDir, "archived", "sess-sym"));
    await createArchiveMarker("sess-sym", { ccxDir }); // O_EXCL → EEXIST, swallowed as "already archived"
    expect(readFileSync(precious, "utf8")).toBe('{"keep":"me"}');
    expect(await listArchived({ ccxDir })).toEqual(new Set(["sess-sym"]));
  });

  it("with no ccxDir the markers live under fleetRoot() — CCX_FLEET_ROOT included — in a 0700 directory", async () => {
    // The production server constructs `new AppServer({ token })` with no deps (cli/serveMain.ts), so
    // this default IS the production path and nothing else in the suite executes it.
    //
    // It has to resolve to the SAME root serveMain's own `runDir()` does, or one process keeps its run
    // files in one root and its archive markers in another; and the suite's per-file `CCX_FLEET_ROOT`
    // backstop (test/setup/fleetRoot.ts) only keeps a default-arm test off a developer's live `~/.claude`
    // if this store reads that variable. Driving the env is the only honest way to check it — mocking
    // `os.homedir()` cannot see the override at all, and on POSIX `fleetRoot()` answers from `$HOME`
    // before it would ever call `homedir()`.
    const overrideRoot = mkTmp("m5root-");
    const fakeHome = mkTmp("m5home-");
    const prevRoot = process.env.CCX_FLEET_ROOT, prevHome = process.env.HOME;
    try {
      process.env.HOME = fakeHome;
      process.env.CCX_FLEET_ROOT = join(overrideRoot, "ccx");
      await createArchiveMarker("sess-h", {});
      expect(existsSync(join(overrideRoot, "ccx", "archived", "sess-h"))).toBe(true);
      expect(await listArchived({})).toEqual(new Set(["sess-h"]));
      expect(existsSync(join(fakeHome, ".claude"))).toBe(false); // the override won over $HOME…
      // …and both directories the store CREATED are the roster's 0700, not a default 0755 that would let
      // a co-tenant enumerate archived session ids. `mkdir` sets a mode only on what it creates, so an
      // embedder reaching this store first is the one writer that decides the root's bits.
      expect(statSync(join(overrideRoot, "ccx")).mode & 0o777).toBe(0o700);
      expect(statSync(join(overrideRoot, "ccx", "archived")).mode & 0o777).toBe(0o700);
      // With no override the root is `<home>/.claude/ccx` — the three segments fleetRoot() spells.
      delete process.env.CCX_FLEET_ROOT;
      await createArchiveMarker("sess-i", {});
      expect(existsSync(join(fakeHome, ".claude", "ccx", "archived", "sess-i"))).toBe(true);
      expect(await listArchived({})).toEqual(new Set(["sess-i"]));
    } finally {
      if (prevRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prevRoot;
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    }
  });

  it("six separate PROCESSES racing one marker directory: distinct ids all survive, one id is idempotent across processes", async () => {
    // D-M5-3's whole reason for existing: the rev-1 single-JSON sidecar died in review because two SERVER
    // PROCESSES doing read-modify-write lose each other's updates. Nothing else in this milestone leaves
    // one process, and `Promise.all` inside one would not test the claim — libuv would be scheduling both
    // halves of one program. So these are real `node` processes running the real module.
    //
    // The interleave is FORCED, not hoped for, and the forcing is MEASURED: each child samples the
    // barrier file before parking on it, and the parent releases it only after every child has parked.
    // `parked` therefore says "no child could have run its transition before the release" — the first
    // version of this row counted ready files instead, which stayed green with the barrier released
    // before the children even spawned. `overlapped` is the second half: two critical sections were
    // literally in flight at the same instant on the system-wide monotonic clock (see `race`).
    const mod = compileArchiveToJs();
    const ccxDir = mkTmp("m5ccx-");
    const distinct = ["s-a", "s-b", "s-c", "s-d", "s-e", "s-f"];
    const allParked = ["parked", "parked", "parked", "parked", "parked", "parked"];

    const one = await race(mod, ccxDir, distinct.map((id) => ({ op: "createArchiveMarker", id })));
    expect([one.parked, one.overlapped]).toEqual([allParked, true]);
    // The lost update the rev-1 sidecar had: six concurrent writers, six markers.
    expect(await listArchived({ ccxDir })).toEqual(new Set(distinct));

    const same = await race(mod, ccxDir, distinct.map(() => ({ op: "createArchiveMarker", id: "s-shared" })));
    expect([same.parked, same.overlapped]).toEqual([allParked, true]);
    // Cross-process idempotence: one process creates, five meet a file that appeared in ANOTHER process
    // between their own `mkdir` and `writeFile`, and every one of them still returns cleanly.
    expect(await listArchived({ ccxDir })).toEqual(new Set([...distinct, "s-shared"]));

    const off = await race(mod, ccxDir, distinct.map(() => ({ op: "removeArchiveMarker", id: "s-shared" })));
    expect([off.parked, off.overlapped]).toEqual([allParked, true]);
    expect(await listArchived({ ccxDir })).toEqual(new Set(distinct));
  }, 120_000);
});

// ── the cross-process harness ────────────────────────────────────────────────────────────────────────
const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The child has to be plain `node`, and plain `node` cannot import TypeScript on every version this
 *  package supports (`engines: >=18`; CI runs 18 and 22). So the REAL module is compiled once with the
 *  repo's own tsc — not re-implemented in the child, which would test a copy instead of the code. */
function compileArchiveToJs(): string {
  const out = mkTmp("m5js-");
  try {
    // `cwd` pinned: tsc resolves `@types/node` from the compiler's working directory, so inheriting
    // vitest's would tie this row to wherever the suite happened to be launched from.
    execFileSync(process.execPath, [
      join(harnessRoot, "node_modules", "typescript", "bin", "tsc"),
      join(harnessRoot, "src", "appserver", "archive.ts"),
      "--module", "nodenext", "--target", "es2022", "--skipLibCheck",
      "--rootDir", join(harnessRoot, "src"), "--outDir", out,
    ], { stdio: "pipe", cwd: harnessRoot });
  } catch (e) {
    // tsc reports on stdout and `stdio:"pipe"` swallows it, so the bare throw names nothing at all.
    throw new Error(`tsc failed compiling archive.ts:\n${(e as { stdout?: Buffer }).stdout ?? "(no output)"}`);
  }
  // `outDir` has no package.json, so node would read the emitted `.js` as CommonJS and the ESM `export`s
  // would throw at load.
  writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
  const child = join(out, "child.mjs");
  writeFileSync(child, CHILD_SRC);
  return out;
}

// `parked` is sampled BEFORE the spin, so it answers "was this child waiting when the barrier was
// released?" rather than the weaker "did this child eventually start". The hrtime clock is
// CLOCK_MONOTONIC, which is system-wide, so the two stamps are comparable across processes.
const CHILD_SRC = `import { existsSync, writeFileSync } from "node:fs";
const [mod, ccxDir, op, sessionId, ready, go, report] = process.argv.slice(2);
const m = await import(mod);
writeFileSync(ready, existsSync(go) ? "late" : "parked");
while (!existsSync(go)) { /* park until the parent has every sibling parked too */ }
const t0 = process.hrtime.bigint();
await m[op](sessionId, { ccxDir });
writeFileSync(report, t0 + " " + process.hrtime.bigint());
`;

async function race(
  outDir: string,
  ccxDir: string,
  specs: { op: string; id: string }[],
): Promise<{ parked: string[]; overlapped: boolean }> {
  const bar = mkTmp("m5race-");
  const go = join(bar, "go");
  const stderr: string[] = specs.map(() => "");
  const exits = specs.map((s, i) => {
    const kid = spawn(process.execPath, [
      // `--rootDir src` keeps the emitted tree shaped like the source: archive.js imports ../fleet/paths.js.
      join(outDir, "child.mjs"), join(outDir, "appserver", "archive.js"), ccxDir, s.op, s.id,
      join(bar, `r${i}`), go, join(bar, `t${i}`),
    ], { stdio: ["ignore", "ignore", "pipe"] });
    kid.stderr.on("data", (d: Buffer) => { stderr[i] += d.toString(); });
    return new Promise<number>((res) => kid.on("exit", (c) => res(c ?? -1)));
  });
  const deadline = Date.now() + 60_000;
  while (specs.some((_, i) => !existsSync(join(bar, `r${i}`))) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2));
  writeFileSync(go, "");
  const codes = await Promise.all(exits);
  // A non-zero child is the interesting failure, and its reason lives only in its own stderr.
  if (codes.some((c) => c !== 0)) throw new Error(`child failed: ${JSON.stringify(codes)}\n${stderr.join("\n")}`);
  const spans = specs.map((_, i) => readFileSync(join(bar, `t${i}`), "utf8").split(" ").map(BigInt));
  // "At least one PAIR of critical sections was in flight at once", not "all six were". The all-six form
  // measured timing rather than causality: the sections run 320µs–3ms while the start stamps spread over a
  // millisecond or more on a loaded box, so on a small CI runner it goes red with the barrier working
  // perfectly — and it goes red with exactly the signature of the serialisation sabotage it exists to
  // catch, leaving a later reader unable to tell flake from regression. The pairwise form still dies under
  // that sabotage, because fully serialised spans are pairwise disjoint too.
  const overlapped = spans.some((a, i) => spans.some((b, j) => j !== i && a[0] < b[1] && b[0] < a[1]));
  return { parked: specs.map((_, i) => readFileSync(join(bar, `r${i}`), "utf8")), overlapped };
}

// ══ M5 Task 9: `thread/archive` / `thread/unarchive` ═══════════════════════════════════════════════════
//
// Driven through the REAL wire (`srv.connect(sink)` + `conn.feed(...)`, search.test.ts's harness):
// `dispatch` is private, so a request is the only way in — and going through it is what makes the params
// gate, the error codes, the dispatch exemption and the server-scoped notifications observable at all.
// Nothing here reaches for a test-only hook: the one race that needs an exact interleave takes it inside
// the injected STORE dep, which is a real await on the handler's real path.

const mkSink = () => { const ls: string[] = []; return { lines: ls, sink: { write: (l: string) => void ls.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parse = (ls: string[]) => ls.map((l) => JSON.parse(l) as Record<string, any>);
const servers: AppServer[] = [];
const hosts: FakeHostControls[] = [];
let conn!: { feed(chunk: string): void };
let lines!: string[];
let nextId = 100;

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  // `watchThreads: true` is not decoration: `thread/archived`/`thread/unarchived` are SERVER-scoped
  // fan-out (broadcastServer → fanout.ts), which reaches watchers ONLY — a boot without it would make
  // every notification assertion in this block vacuously green.
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}
afterEach(async () => {
  for (const s of servers.splice(0)) await s.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
});

const feed = (method: string, params: unknown): number => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
/** Waits for ONE request's reply. A poll that gave up silently would turn a never-answered request into a
 *  confusing "cannot read property of undefined" instead of the honest "no reply". */
const reply = async (id: number, what: string): Promise<Record<string, any>> => {
  for (let i = 0; i < 400; i++) {
    const f = parse(lines).find((m) => m.id === id);
    if (f) return f;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no reply to ${what} (id ${id}) within 2s`);
};
const send = async (method: string, params: unknown): Promise<Record<string, any>> => reply(feed(method, params), method);
/** Two requests in ONE chunk, so both are dispatched in one tick — `Peer.feed` loops the frames
 *  synchronously and the second handler starts at the first handler's first `await`. Written as one chunk
 *  rather than two `feed` calls so the "same tick" claim is structural rather than incidental. */
const feedBoth = (a: { method: string; params: unknown }, b: { method: string; params: unknown }): [number, number] => {
  const ida = nextId++, idb = nextId++;
  conn.feed(JSON.stringify({ id: ida, method: a.method, params: a.params }) + "\n" + JSON.stringify({ id: idb, method: b.method, params: b.params }) + "\n");
  return [ida, idb];
};
const notifs = (method: string) => parse(lines).filter((l) => l.method === method);

/** D-M5-20's existence oracle, injected through `deps.getSessionInfo`. Records every call — the atom row
 *  below asserts the SPY was consulted, not merely that the reply looked right, because a handler that
 *  re-spelled the DI binding and dropped the `srv.deps` override reads the real session store while its
 *  tests still pass. */
function fakeStore(known: string[]) {
  const infoCalls: string[] = [];
  const rows = new Set(known);
  return { infoCalls, rows, getSessionInfo: async (id: string) => { infoCalls.push(id); return rows.has(id) ? { sessionId: id, summary: `summary of ${id}`, lastModified: 5_000 } : undefined; } };
}
// `sessionId` is deliberately widened to `undefined`: a REAL engine's getter reads undefined until the
// first turn's init frame (router.ts's routeInit), and the eager-stamp row below is about exactly that.
const fakeEngine = (sessionId: string | undefined, over: Record<string, unknown> = {}) =>
  ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId, isEnded: () => false, ...over }) as never;

function addRecord(srv: AppServer, sessionId: string, engine: Record<string, unknown> = {}): string {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  srv.registry.add({
    id, origin: "inProcess", session: fakeEngine(sessionId, engine), unattended: "park", busy: false, turnSeq: 0,
    interruptRequested: false, buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(),
    sessionId, createdAt: now, updatedAt: now, settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
  } as unknown as ThreadRecord);
  return id;
}

/** Does THIS filesystem fold case? APFS and NTFS do, ext4 does not, and the marker store's behavior
 *  genuinely differs between them — so the case row asserts the right answer for the tree it runs on
 *  rather than one that is only true on the author's laptop. */
function foldsCase(dir: string): boolean {
  writeFileSync(join(dir, "CaseProbe"), "");
  const folds = existsSync(join(dir, "caseprobe"));
  rmSync(join(dir, "CaseProbe"));
  return folds;
}

describe("thread/archive + thread/unarchive (Task 9)", () => {
  it("cold round-trip: each direction answers {ok:true}, moves the marker, announces its OWN notification, and is idempotent", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["cold-1"]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo });

    expect((await send("thread/archive", { threadId: "cold-1" })).result).toEqual({ ok: true });
    expect(existsSync(join(ccxDir, "archived", "cold-1"))).toBe(true);
    expect(notifs("thread/archived").map((n) => n.params)).toEqual([{ sessionId: "cold-1" }]);
    expect(notifs("thread/unarchived")).toEqual([]);

    // Idempotent on the store's EEXIST, and the marker is still exactly ONE file.
    expect((await send("thread/archive", { threadId: "cold-1" })).result).toEqual({ ok: true });
    expect(readdirSync(join(ccxDir, "archived"))).toEqual(["cold-1"]);

    // The mirror side, which is the one that gets forgotten: unarchive is not a variant of archive, it is
    // the other half, and it owes its own reply, its own unlink and its own notification name.
    expect((await send("thread/unarchive", { threadId: "cold-1" })).result).toEqual({ ok: true });
    expect(existsSync(join(ccxDir, "archived", "cold-1"))).toBe(false);
    expect(notifs("thread/unarchived").map((n) => n.params)).toEqual([{ sessionId: "cold-1" }]);
    expect((await send("thread/unarchive", { threadId: "cold-1" })).result).toEqual({ ok: true }); // ENOENT → fine

    // Every SUCCESSFUL call announces, including an idempotent one: the store cannot tell a fresh
    // transition from a repeat (an EEXIST and a created marker leave identical bytes), so a handler
    // claiming to announce only real transitions would be claiming knowledge it does not have.
    expect([notifs("thread/archived").length, notifs("thread/unarchived").length]).toEqual([2, 2]);
  });

  it("a session the store does not know refuses THREAD_NOT_FOUND from BOTH methods, and mints no phantom marker", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore([]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo });
    for (const method of ["thread/archive", "thread/unarchive"]) {
      const r = await send(method, { threadId: "no-such-session" });
      expect([method, r.error?.code, r.error?.message]).toEqual([method, -33004, "Thread not found"]);
      expect(r.result).toBeUndefined();
    }
    // D-M5-20's whole point: a typo must not mint permanent archive state. The refusal precedes the store,
    // so not even the directory exists.
    expect(existsSync(join(ccxDir, "archived"))).toBe(false);
    expect(notifs("thread/archived")).toEqual([]);
  });

  it("the admission rules are DIFFERENT predicates: archive admits on the store row alone, unarchive on marker-OR-row", async () => {
    // This is the row that goes red the moment the two refusals are collapsed into one shared helper.
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore([]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo });
    // A marker whose session the store has forgotten (deleted out from under it). UNARCHIVE must still
    // work — it is the only way to clear such a marker — and it must not consult the store at all, since
    // the marker already answers.
    await createArchiveMarker("forgotten", { ccxDir });
    st.infoCalls.length = 0;
    expect((await send("thread/unarchive", { threadId: "forgotten" })).result).toEqual({ ok: true });
    expect(existsSync(join(ccxDir, "archived", "forgotten"))).toBe(false);
    expect(st.infoCalls).toEqual([]); // the marker short-circuits the store read
    // …and ARCHIVE of that same forgotten session refuses: a marker is not evidence a session exists, and
    // importing unarchive's marker fallback here would re-mint exactly the phantom state D-M5-20 forbids.
    await createArchiveMarker("forgotten", { ccxDir });
    expect((await send("thread/archive", { threadId: "forgotten" })).error?.code).toBe(-33004);
    expect(st.infoCalls).toEqual(["forgotten"]);
  });

  it("all three M5 admission rules consult the INJECTED deps.getSessionInfo — the shared atom, not a re-spelled binding", async () => {
    // The failure this pins is green-for-the-wrong-reason: a handler that writes
    // `getSessionInfo(sid, {})` without the `srv.deps` override reads the REAL session store and can
    // still produce a correct-looking refusal, so asserting the reply alone proves nothing.
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["known-1"]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo, getSessionMessages: async () => [] });

    expect((await send("thread/archive", { threadId: "known-1" })).result).toEqual({ ok: true });
    expect(st.infoCalls).toEqual(["known-1"]);

    st.infoCalls.length = 0;
    expect((await send("thread/unarchive", { threadId: "known-2" })).error?.code).toBe(-33004); // no marker → the store arm
    expect(st.infoCalls).toEqual(["known-2"]);

    st.infoCalls.length = 0;
    st.rows.add("known-2");
    expect((await send("thread/unarchive", { threadId: "known-2" })).result).toEqual({ ok: true });
    expect(st.infoCalls).toEqual(["known-2"]);

    // The third rule, Task 8's, through the same atom — the reason the binding was lifted at all.
    st.infoCalls.length = 0;
    expect((await send("thread/searchOccurrences", { threadId: "known-3", searchTerm: "zz" })).error?.code).toBe(-33004);
    expect(st.infoCalls).toEqual(["known-3"]);
  });

  it("a thread this server holds LIVE refuses archive by BOTH spellings of its id — and unarchive is deliberately not guarded", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["sess-live"]);
    const srv = boot({ ccxDir, getSessionInfo: st.getSessionInfo });
    const threadId = addRecord(srv, "sess-live");
    // The store KNOWS this session, so the existence check passes: what refuses here is the live-guard and
    // nothing else. Both spellings, because `resolveThreadId` is what makes them one thread.
    for (const spelling of [threadId, "sess-live"]) {
      const r = await send("thread/archive", { threadId: spelling });
      expect([spelling, r.error?.code, r.error?.message]).toEqual([spelling, -33001, "Thread is live in this server — close it first"]);
    }
    expect(existsSync(join(ccxDir, "archived"))).toBe(false);
    // The mirror: `thread/unarchive` is NOT live-guarded, and must not be — admission itself unarchives
    // (D-M5-21), so a guard here would refuse the very state this server produces.
    await createArchiveMarker("sess-live", { ccxDir });
    expect((await send("thread/unarchive", { threadId })).result).toEqual({ ok: true });
    expect(existsSync(join(ccxDir, "archived", "sess-live"))).toBe(false);

    // …and the guard runs BEFORE the existence read, which is the case that decides the order rather than
    // merely exercising both: a thread admitted this tick has nothing persisted yet, so a handler that
    // asked the store first would answer "no such thread" about a session the client is demonstrably
    // holding. "It is live" is the truer refusal and the one a client can act on.
    const fresh = mkTmp("m5ccx-");
    const blank = fakeStore([]);
    const srv2 = boot({ ccxDir: fresh, getSessionInfo: blank.getSessionInfo });
    const unpersisted = addRecord(srv2, "sess-unpersisted");
    expect((await send("thread/archive", { threadId: unpersisted })).error?.code).toBe(-33001);
    expect(blank.infoCalls).toEqual([]);
  });

  it("a resume RESERVATION refuses archive too — an admission mid-probe has no record to find", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["racing"]);
    const srv = boot({ ccxDir, getSessionInfo: st.getSessionInfo });
    // The refcount `thread/resume` takes synchronously before its PID-liveness probe (server.ts's
    // `resumingSessions`) — the window in which a resume is real but unfindable by sessionId.
    srv.resumingSessions.set("racing", 1);
    const r = await send("thread/archive", { threadId: "racing" });
    expect([r.error?.code, r.error?.message]).toEqual([-33001, "Thread is live in this server — close it first"]);
    expect(existsSync(join(ccxDir, "archived", "racing"))).toBe(false);
    // Released → the SAME request is admitted, which is what makes the refusal above the reservation's
    // rather than some other refusal wearing its code.
    srv.resumingSessions.delete("racing");
    expect((await send("thread/archive", { threadId: "racing" })).result).toEqual({ ok: true });
  });

  it("a resume landing INSIDE the existence read is still caught: the marker is unlinked and the reply refuses BUSY (plan review F12)", async () => {
    const ccxDir = mkTmp("m5ccx-");
    let srv!: AppServer;
    // The reservation is taken DURING the store read — the one window the entry guard cannot see, and the
    // whole reason the guard is checked a SECOND time once the marker exists. Nothing test-only is
    // reached into: the await is the handler's real store read, and what lands inside it is the test's to
    // choose. Without the re-check this row replies {ok:true} and leaves a marker on a live session.
    srv = boot({ ccxDir, getSessionInfo: async (id: string) => { srv.resumingSessions.set(id, 1); return { sessionId: id, summary: "s", lastModified: 1 }; } });
    const r = await send("thread/archive", { threadId: "late" });
    expect([r.error?.code, r.error?.message]).toEqual([-33001, "Thread is live in this server — close it first"]);
    expect(existsSync(join(ccxDir, "archived", "late"))).toBe(false);
  });

  it("a real thread/resume and thread/archive dispatched in ONE tick converge in BOTH arrival orders: live, and off the shelf", async () => {
    for (const archiveFirst of [true, false]) {
      const ccxDir = mkTmp("m5ccx-");
      const st = fakeStore(["racy"]);
      const srv = boot({ ccxDir, getSessionInfo: st.getSessionInfo, sessionFactory: () => fakeEngine("racy") });
      const archive = { method: "thread/archive", params: { threadId: "racy" } };
      const resume = { method: "thread/resume", params: { sessionId: "racy" } };
      const [firstId, secondId] = archiveFirst ? feedBoth(archive, resume) : feedBoth(resume, archive);
      const [first, second] = [await reply(firstId, "first"), await reply(secondId, "second")];
      const arch = archiveFirst ? first : second;
      const res = archiveFirst ? second : first;
      // Whichever order, the archive loses: arriving second it meets a registered record, and arriving
      // first it creates its marker and then meets that same record on the re-check.
      expect([archiveFirst, arch.error?.code]).toEqual([archiveFirst, -33001]);
      expect(res.result?.thread?.sessionId).toBe("racy");
      // The end state is the claim — never "archived AND live".
      await vi.waitFor(() => expect(existsSync(join(ccxDir, "archived", "racy"))).toBe(false));
      expect(findLiveBySessionId(srv, "racy")).toBeTruthy();
    }
  });

  it("admission takes the thread off the shelf: resuming an archived session unlinks the marker and broadcasts thread/unarchived (D-M5-21)", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["shelved"]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo, sessionFactory: () => fakeEngine("shelved") });
    expect((await send("thread/archive", { threadId: "shelved" })).result).toEqual({ ok: true });
    expect(existsSync(join(ccxDir, "archived", "shelved"))).toBe(true);

    const r = await send("thread/resume", { sessionId: "shelved" });
    expect(r.result?.thread?.sessionId).toBe("shelved");
    await vi.waitFor(() => expect(existsSync(join(ccxDir, "archived", "shelved"))).toBe(false));
    await vi.waitFor(() => expect(notifs("thread/unarchived").map((n) => n.params)).toEqual([{ sessionId: "shelved" }]));
    // The announcement follows the admission it belongs to, never precedes it.
    expect(parse(lines).filter((l) => l.method === "thread/started" || l.method === "thread/unarchived").map((l) => l.method)).toEqual(["thread/started", "thread/unarchived"]);

    // …and an admission of an UNarchived session announces nothing: the broadcast reports a TRANSITION,
    // not the fact of resuming. Without this half a handler that broadcast unconditionally would pass.
    await send("thread/resume", { sessionId: "shelved" });
    await new Promise((r2) => setTimeout(r2, 30));
    expect(notifs("thread/unarchived").length).toBe(1);
  });

  it("attach takes a fleet thread off the shelf too — the OTHER admission path, and the one that gets forgotten", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const root = mkTmp("m5fleet-");
    const prev = process.env.CCX_FLEET_ROOT;
    process.env.CCX_FLEET_ROOT = root; // its own roster, so no sibling case's row is in this listing
    try {
      const fh = await startFakeHost({ status: { sessionId: "sess-fleet" } });
      hosts.push(fh);
      writeRoster(fh.row);
      boot({ ccxDir });
      await createArchiveMarker("sess-fleet", { ccxDir });
      const r = await send("thread/attach", { target: fh.row.short });
      expect(r.result?.thread?.sessionId).toBe("sess-fleet");
      await vi.waitFor(() => expect(existsSync(join(ccxDir, "archived", "sess-fleet"))).toBe(false));
      await vi.waitFor(() => expect(notifs("thread/unarchived").map((n) => n.params)).toEqual([{ sessionId: "sess-fleet" }]));
    } finally {
      if (prev === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prev;
    }
  }, 20_000);

  it("all three M5 disk readers answer for a thread whose engine has died — none is refused -33005", async () => {
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["dead-1"]);
    const srv = boot({ ccxDir, getSessionInfo: st.getSessionInfo, getSessionMessages: async () => [] });
    const threadId = addRecord(srv, "dead-1", { isEnded: () => true });
    // Each method's OWN answer, not merely "≠ -33005": a bare inequality is satisfied by METHOD_NOT_FOUND
    // too, so it would go green on a server where neither method is registered at all.
    expect((await send("thread/searchOccurrences", { threadId, searchTerm: "zz" })).result).toEqual({ data: [], nextCursor: null });
    expect((await send("thread/archive", { threadId })).error?.code).toBe(-33001); // dead, but still LIVE here
    expect((await send("thread/unarchive", { threadId })).result).toEqual({ ok: true });
    // …measured against a thread-scoped method that is NOT exempt on the SAME record, so the row proves an
    // exemption rather than a gate that has stopped firing.
    expect((await send("thread/settings/read", { threadId })).error?.code).toBe(-33005);
  });

  it("marker names are CASE-SENSITIVE while the filesystem may not be — the current, unnormalized behavior is pinned", async () => {
    // Task 5 review, Minor 3. Unreachable with today's lowercase-UUID session ids; this row is the record
    // of that assumption, so an id scheme that ever mixes case fails here instead of silently unlinking
    // another session's marker in production.
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["ABCdef", "abcdef"]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo });
    expect((await send("thread/archive", { threadId: "ABCdef" })).result).toEqual({ ok: true });
    expect((await send("thread/archive", { threadId: "abcdef" })).result).toEqual({ ok: true });
    if (foldsCase(ccxDir)) {
      // APFS/NTFS: the second create is an EEXIST on the FIRST session's file, reported as success…
      expect(readdirSync(join(ccxDir, "archived"))).toEqual(["ABCdef"]);
      expect((await send("thread/unarchive", { threadId: "abcdef" })).result).toEqual({ ok: true });
      // …and the matching remove unlinks the OTHER session's marker.
      expect(readdirSync(join(ccxDir, "archived"))).toEqual([]);
    } else {
      expect(readdirSync(join(ccxDir, "archived")).sort()).toEqual(["ABCdef", "abcdef"]);
      expect((await send("thread/unarchive", { threadId: "abcdef" })).result).toEqual({ ok: true });
      expect(readdirSync(join(ccxDir, "archived"))).toEqual(["ABCdef"]);
    }
  });

  it("the ordering is the whole defense, and the two failures the store CAN raise get DIFFERENT codes", async () => {
    // (a) `threadIdParams` is only `z.string().min(1)` (schema/core.ts), so a path-hostile threadId is
    //     well-formed. What stops it is that no such session is in the store — the existence check runs
    //     before the marker store is touched at all, from both methods.
    const ccxDir = mkTmp("m5ccx-");
    const empty = fakeStore([]);
    boot({ ccxDir, getSessionInfo: empty.getSessionInfo });
    for (const method of ["thread/archive", "thread/unarchive"]) {
      expect([method, (await send(method, { threadId: "../escape" })).error?.code]).toEqual([method, -33004]);
    }
    expect(existsSync(join(ccxDir, "archived"))).toBe(false);
    // …and the params gate itself, which both methods share.
    expect((await send("thread/archive", {})).error?.code).toBe(-32602);
    expect((await send("thread/unarchive", { threadId: "" })).error?.code).toBe(-32602);

    // (b) belt-and-braces: where a store DID hand back such an id, `checkId`'s typed refusal is a
    //     PARAMETER error — the fault is in the client's `threadId`, not in this server.
    const hostile = fakeStore(["../escape"]);
    boot({ ccxDir, getSessionInfo: hostile.getSessionInfo });
    const r = await send("thread/archive", { threadId: "../escape" });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.message).toMatch(/marker-safe/);

    // (c) an errno describes THIS SERVER's state directory, not the client's parameter, so it stays
    //     -32603 (D-M5-18a) — and it carries no absolute path, because node's own message ends in one and
    //     that one is the operator's home directory on the wire. Both methods, since they fail in
    //     different syscalls: create's `mkdir` meets EEXIST, list's `readdir` meets ENOTDIR.
    const bad = mkTmp("m5ccx-");
    writeFileSync(join(bad, "archived"), ""); // the state dir occupied by a regular file
    const known = fakeStore(["cold-x"]);
    boot({ ccxDir: bad, getSessionInfo: known.getSessionInfo });
    for (const [method, errno] of [["thread/archive", "EEXIST"], ["thread/unarchive", "ENOTDIR"]] as const) {
      const e = (await send(method, { threadId: "cold-x" })).error;
      expect([method, e?.code]).toEqual([method, -32603]);
      expect(e?.message).toContain(errno);
      expect(e?.message).not.toContain(bad);
      expect(e?.message).not.toContain("/"); // no path of any shape survived into the message
    }
  });

  // ── review wave ────────────────────────────────────────────────────────────────────────────────────
  // The seven rows below were added after the independent review. Each pins something the shipped suite
  // left undefended, and each names the construction that demonstrated the gap.

  it("the THIRD admission surface: `thread/start` carrying `resume` takes the session off the shelf too (D-M5-21)", async () => {
    // The spec names three admission surfaces — thread/resume, resume-carrying thread/start, thread/attach
    // — and this one shipped uncovered. `config` is a parsed record the server spreads into the engine
    // config, not an opaque blob, so the resume target is readable at admission and nothing about the
    // engine's init latch is involved. Reachable by any client that resumes through thread/start's
    // passthrough rather than by calling thread/resume.
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["shelved"]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo, sessionFactory: (c: Record<string, unknown>) => fakeEngine(c.resume as string) });
    expect((await send("thread/archive", { threadId: "shelved" })).result).toEqual({ ok: true });
    expect(existsSync(join(ccxDir, "archived", "shelved"))).toBe(true);

    const r = await send("thread/start", { config: { resume: "shelved" } });
    expect(r.result?.thread?.sessionId).toBe("shelved");
    await vi.waitFor(() => expect(existsSync(join(ccxDir, "archived", "shelved"))).toBe(false));
    await vi.waitFor(() => expect(notifs("thread/unarchived").map((n) => n.params)).toEqual([{ sessionId: "shelved" }]));
    // The SAME shared `autoUnarchive` as the other two surfaces, so the announcement follows the admission
    // it belongs to here exactly as it does there.
    expect(parse(lines).filter((l) => l.method === "thread/started" || l.method === "thread/unarchived").map((l) => l.method)).toEqual(["thread/started", "thread/unarchived"]);

    // The negative half: a FRESH start carries no resume, admits nothing that already existed, and
    // announces no transition. Without it, a handler that unarchived on every start would pass.
    await send("thread/start", {});
    await new Promise((r2) => setTimeout(r2, 30));
    expect(notifs("thread/unarchived").length).toBe(1);
  });

  it("…and the SAME surface stamps its resume target eagerly, so an archive arriving before the engine reports an id still refuses BUSY", async () => {
    // The other direction of the one invariant, and the direction that gets forgotten: not "admission
    // forgot to unshelve" but "the guard could not see the admission". A real engine's `sessionId` getter
    // reads undefined until the first turn's system/init frame, so without the eager stamp the record
    // carries no sessionId at all and this server cannot find its own live thread — for whole requests,
    // not for a tick.
    const ccxDir = mkTmp("m5ccx-");
    const st = fakeStore(["late-1"]);
    let emit!: (f: unknown) => void;
    const srv = boot({
      ccxDir, getSessionInfo: st.getSessionInfo,
      sessionFactory: () => fakeEngine(undefined, { onFrame: (cb: (f: unknown) => void) => { emit = cb; return () => {}; } }),
    });
    const started = await send("thread/start", { config: { resume: "late-1" } });
    expect(started.result?.thread?.sessionId).toBe("late-1");
    expect(findLiveBySessionId(srv, "late-1")).toBeTruthy();
    const r = await send("thread/archive", { threadId: "late-1" });
    expect([r.error?.code, r.error?.message]).toEqual([-33001, "Thread is live in this server — close it first"]);
    expect(existsSync(join(ccxDir, "archived", "late-1"))).toBe(false);
    // …and the engine's own init frame, when it finally lands, CONFIRMS that id rather than contradicting
    // it (router.ts's routeInit early-returns on a stamped record) — the stamp is not a guess.
    emit({ type: "system", subtype: "init", session_id: "late-1" });
    await vi.waitFor(() => expect(findLiveBySessionId(srv, "late-1")?.sessionId).toBe("late-1"));
  });

  it("a SESSION-store failure names the session store, not the marker store — and its message is path-stripped too", async () => {
    // Both handlers read TWO stores inside one handler body. A `getSessionInfo` that threw was answered as
    // `archive marker store failed: …`: the wrong subsystem named, on a message that never went through
    // the marker store's composed form at all. The errno branch was stripped, this branch was not — and
    // this is the branch that carries an operator's home directory, since the session store's failures are
    // not ours to compose.
    const ccxDir = mkTmp("m5ccx-");
    boot({ ccxDir, getSessionInfo: async () => { throw new Error("failed to parse session file /Users/operator/.claude/projects/x/abc.jsonl"); } });
    for (const method of ["thread/archive", "thread/unarchive"]) {
      const e = (await send(method, { threadId: "s-1" })).error;
      expect([method, e?.code]).toEqual([method, -32603]);
      expect(e?.message).toMatch(/^session store read failed:/);
      expect(e?.message).not.toContain("/Users/operator");
      expect(e?.message).not.toContain("/"); // no path of any shape survived into the message
    }
    // …and the MARKER store's own failure still names itself, so the two faults are told apart rather than
    // merged into one wrong answer.
    const bad2 = mkTmp("m5ccx-");
    writeFileSync(join(bad2, "archived"), "");
    boot({ ccxDir: bad2, getSessionInfo: fakeStore(["cold-x"]).getSessionInfo });
    expect((await send("thread/archive", { threadId: "cold-x" })).error?.message).toMatch(/^archive marker store failed: EEXIST/);
  });

  it("the AUTO-UNARCHIVE route strips paths too — the second half of a protection whose first half was pinned", async () => {
    // Claimed by the task report AND by the scorecard row, defended by nothing: mutating this call site to
    // interpolate node's own errno message left the whole file green. It is the half that rots first,
    // because it lives in server.ts while the strip it leans on lives in archiveDomain.ts.
    const ccxDir = mkTmp("m5ccx-");
    writeFileSync(join(ccxDir, "archived"), ""); // the state dir occupied by a regular file → ENOTDIR
    const st = fakeStore(["w-1"]);
    boot({ ccxDir, getSessionInfo: st.getSessionInfo, sessionFactory: (c: Record<string, unknown>) => fakeEngine(c.resume as string) });
    const r = await send("thread/resume", { sessionId: "w-1" });
    // The admission still succeeds — a state directory that cannot be read is not a reason to report a
    // successful admission as failed — and the failure is disclosed rather than swallowed.
    expect(r.result?.thread?.sessionId).toBe("w-1");
    await vi.waitFor(() => expect(notifs("warning").length).toBe(1));
    const w = notifs("warning")[0].params;
    expect([w.code, w.message.includes("ENOTDIR")]).toEqual(["unarchiveFailed", true]);
    expect(w.message).not.toContain(ccxDir);
    expect(w.message).not.toContain("/");
    // …and the request id is spent exactly once: an escaping rejection here would put a SECOND frame on
    // the wire for one request, which is why this route is guarded at all.
    expect(parse(lines).filter((l) => l.id === r.id).length).toBe(1);
  });

  it("a thread/attach REJOIN deliberately does NOT re-run the auto-unarchive", async () => {
    // Recorded in a comment and on the scorecard, pinned in neither direction: making the rejoin path
    // unarchive left the whole file green, so a later editor could reverse the decision unnoticed.
    const ccxDir = mkTmp("m5ccx-");
    const root = mkTmp("m5fleet-");
    const prev = process.env.CCX_FLEET_ROOT;
    process.env.CCX_FLEET_ROOT = root;
    try {
      const fh = await startFakeHost({ status: { sessionId: "sess-rejoin" } });
      hosts.push(fh);
      writeRoster(fh.row);
      boot({ ccxDir });
      const first = await send("thread/attach", { target: fh.row.short });
      expect(first.result?.thread?.sessionId).toBe("sess-rejoin");
      // A marker written while this server ALREADY holds the thread live — which only another process can
      // do. The rejoin returns the same record, mints nothing and announces nothing…
      await createArchiveMarker("sess-rejoin", { ccxDir });
      const again = await send("thread/attach", { target: fh.row.short });
      expect(again.result?.thread?.id).toBe(first.result?.thread?.id);
      await new Promise((r) => setTimeout(r, 30));
      // …so the marker stays where the other process put it, and nothing is broadcast: "opening a
      // conversation" happened once, and a transition announced per rejoin would report one that did not
      // occur. This row is the honest cost of that choice, stated rather than implied.
      expect(existsSync(join(ccxDir, "archived", "sess-rejoin"))).toBe(true);
      expect(notifs("thread/unarchived")).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prev;
    }
  }, 20_000);

  it("thread/resume AWAITS its captured admission: a failure raised after the reply is reported, never left as an unhandled rejection", async () => {
    // `admitted` is captured inside the reservation and awaited below the `finally` — the release must not
    // sit behind the shelf read (the reservation row above is why). Dropping the await left the whole file
    // green, and it is the difference between a disclosed failure and one that escapes the process.
    const ccxDir = mkTmp("m5ccx-");
    writeFileSync(join(ccxDir, "archived"), ""); // ENOTDIR → the shelf read fails → the disclosure runs
    const root = mkTmp("m5fleet-");
    const prev = process.env.CCX_FLEET_ROOT;
    process.env.CCX_FLEET_ROOT = root;
    try {
      // A non-terminal roster row is what routes this resume down the RESERVATION path; the ordinary path
      // awaits `startThread` inline and is a different line of code. The pid is one no process holds, and
      // a reused pid could not report this start stamp either, so the probe answers "gone" and admission
      // proceeds.
      writeRoster({ short: "fa5e0099", pid: 999778, cwd: "/w", kind: "bg" as const, name: "stale", state: "working" as const, startedAt: Date.now(), procStart: "1970-01-01T00:00:00Z", sessionId: "await-1" });
      const st = fakeStore(["await-1"]);
      const srv = new AppServer({}, { ccxDir, getSessionInfo: st.getSessionInfo, sessionFactory: (c: Record<string, unknown>) => fakeEngine(c.resume as string) });
      servers.push(srv);
      // A transport that dies on exactly one frame — the `warning` this admission is about to emit. That
      // throw escapes `autoUnarchive`'s own guard (it is raised BY the disclosure, not by the store), so it
      // is the one thing that can still reject the captured promise after the reply is on the wire.
      const got: string[] = [];
      let boom = true;
      const c = srv.connect({ write: (l: string) => { if (boom && l.includes("unarchiveFailed")) { boom = false; throw new Error("peer transport died"); } got.push(l); }, buffered: () => 0, end: () => {} } as PeerSink);
      c.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
      got.length = 0;
      c.feed(JSON.stringify({ id: 900, method: "thread/resume", params: { sessionId: "await-1" } }) + "\n");
      const frames = () => got.map((l) => JSON.parse(l) as Record<string, any>).filter((f) => f.id === 900);
      await vi.waitFor(() => expect(frames().length).toBe(2));
      // The admission answered first…
      expect(frames()[0].result?.thread?.sessionId).toBe("await-1");
      // …and the post-reply failure came back through dispatch's own catch, which is reachable only
      // because the handler awaited the promise it captured.
      expect([frames()[1].error?.code, frames()[1].error?.message]).toEqual([-32603, "peer transport died"]);
    } finally {
      if (prev === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prev;
    }
  });

  it("a session live in ANOTHER ccx process refuses archive too — one server must not give two answers about one session", async () => {
    // Shipped, this server refused to RESUME an id a running fleet host still held and shelved that same id
    // from the handler two lines away. D-M5-21's invariant is stated across servers, not within one, and
    // the archiving server already had the roster data it was declining to read.
    const ccxDir = mkTmp("m5ccx-");
    const root = mkTmp("m5fleet-");
    const prev = process.env.CCX_FLEET_ROOT;
    process.env.CCX_FLEET_ROOT = root;
    try {
      // Another process's session, with a pid that is certainly alive (ours). No `procStart` is the
      // roster's own "assume live" (fleet/liveness.ts) — the same reading thread/resume takes.
      const row = { short: "ab12cd34", pid: process.pid, cwd: "/w", kind: "bg" as const, name: "other", state: "working" as const, startedAt: Date.now(), sessionId: "fleet-live" };
      writeRoster(row);
      const st = fakeStore(["fleet-live"]);
      boot({ ccxDir, getSessionInfo: st.getSessionInfo, sessionFactory: (c: Record<string, unknown>) => fakeEngine(c.resume as string) });
      expect((await send("thread/resume", { sessionId: "fleet-live" })).error?.message).toBe("sessionId belongs to a running fleet session; use thread/attach");
      // The same fact, from the other handler. This method's OWN refusal is reused rather than a second one
      // invented: BUSY, because the request is well-formed and the session is merely held. (The message is
      // thread/delete's verbatim string, which every live-refusal on this wire shares.)
      const r = await send("thread/archive", { threadId: "fleet-live" });
      expect([r.error?.code, r.error?.message]).toEqual([-33001, "Thread is live in this server — close it first"]);
      expect(existsSync(join(ccxDir, "archived"))).toBe(false);
      // The control that makes the refusal LIVENESS rather than mere presence: a terminal row is a finished
      // session, and shelving one is exactly what a client reaches for.
      writeRoster({ ...row, state: "done" as const, endedAt: Date.now() });
      expect((await send("thread/archive", { threadId: "fleet-live" })).result).toEqual({ ok: true });
      expect(existsSync(join(ccxDir, "archived", "fleet-live"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prev;
    }
  });
});
