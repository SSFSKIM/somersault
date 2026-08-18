// test/unit/appserver/archive.test.ts — M5 Task 5: the archive marker store (spec D-M5-3 rev 2).
// Everything here writes only into its own temp directory, and every one of those goes through `mkTmp` so
// `afterAll` takes it back. The one row that exercises the DEFAULT location (no `ccxDir`) drives
// `CCX_FLEET_ROOT`/`HOME`, because the real default is a developer's live `~/.claude`.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listArchived, createArchiveMarker, removeArchiveMarker } from "../../../src/appserver/archive.js";

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
