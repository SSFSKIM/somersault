// test/unit/appserver/archive.test.ts — M5 Task 5: the archive marker store (spec D-M5-3 rev 2).
// Everything here writes only into its own `mkdtemp` directory. The one row that exercises the DEFAULT
// location (no `ccxDir`) redirects `os.homedir()` to a temp dir first, because the real one is a
// developer's live `~/.claude`.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listArchived, createArchiveMarker, removeArchiveMarker } from "../../../src/appserver/archive.js";

describe("archive markers", () => {
  it("create/list/remove round-trip; both directions idempotent; absent dir = empty set", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
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
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    await expect(createArchiveMarker("../escape", { ccxDir })).rejects.toThrow(/sessionId/);
  });

  // ── beyond the brief ───────────────────────────────────────────────────────────────────────────────
  // The two rows above are the brief's. Each row below pins something they leave undefended; the full
  // mutation matrix that proves each one discriminates is in the task-5 report.

  it("the two ids the CHARACTER CLASS alone admits — `.` and `..` — refuse too, from BOTH entry points, and a legal id is not caught with them", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
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
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
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
    const a = mkdtempSync(join(tmpdir(), "m5ccx-"));
    writeFileSync(join(a, "archived"), "");
    await expect(listArchived({ ccxDir: a })).rejects.toThrow(/ENOTDIR/);
    await expect(createArchiveMarker("sess-1", { ccxDir: a })).rejects.toThrow(/EEXIST/);
    // (b) a create failure that is NOT the idempotent EEXIST. 300 chars is a legal id by the character
    //     screen and longer than any filename this filesystem will take (NAME_MAX is 255 on macOS and
    //     Linux alike), so it needs no permission bits to reproduce and no root-only guard.
    const b = mkdtempSync(join(tmpdir(), "m5ccx-"));
    await expect(createArchiveMarker("a".repeat(300), { ccxDir: b })).rejects.toThrow(/ENAMETOOLONG/);
    expect(await listArchived({ ccxDir: b })).toEqual(new Set());
    // (c) a remove failure that is NOT ENOENT: the marker path occupied by a directory. The errno differs
    //     by platform (EPERM on macOS, EISDIR on Linux), so the claim asserted is the refusal itself.
    const c = mkdtempSync(join(tmpdir(), "m5ccx-"));
    mkdirSync(join(c, "archived", "sess-d"), { recursive: true });
    await expect(removeArchiveMarker("sess-d", { ccxDir: c })).rejects.toThrow();
  });

  it("with no ccxDir the markers live under <home>/.claude/ccx/archived", async () => {
    // The production server constructs `new AppServer({ token })` with no deps (cli/serveMain.ts), so
    // this default IS the production path and nothing else in the suite executes it.
    //
    // DIVERGENCE, pinned deliberately rather than fixed — see the Task 5 report. This is a SECOND
    // definition of `~/.claude/ccx`; the repo's own is `fleetRoot()` in src/fleet/paths.ts, which honours
    // `$HOME` and the `CCX_FLEET_ROOT` override that ops and this very suite use to stay off a real home
    // directory. This one honours neither, so under an override one process keeps its run files in one
    // root and its archive markers in another. The last two assertions are what make that visible.
    const fakeHome = mkdtempSync(join(tmpdir(), "m5home-"));
    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:os")>()),
      homedir: () => fakeHome,
    }));
    try {
      const fresh = await import("../../../src/appserver/archive.js");
      await fresh.createArchiveMarker("sess-h", {});
      expect(existsSync(join(fakeHome, ".claude", "ccx", "archived", "sess-h"))).toBe(true);
      expect(await fresh.listArchived({})).toEqual(new Set(["sess-h"]));
      expect(process.env.CCX_FLEET_ROOT).toBeTruthy(); // the suite's per-file backstop is on…
      expect(existsSync(join(process.env.CCX_FLEET_ROOT!, "archived", "sess-h"))).toBe(false); // …and unread
    } finally {
      vi.doUnmock("node:os");
      vi.resetModules();
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
    // before the children even spawned. `overlapped` is the second half: the critical sections were
    // literally in flight at the same instant on the system-wide monotonic clock.
    const mod = compileArchiveToJs();
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
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
  const out = mkdtempSync(join(tmpdir(), "m5js-"));
  execFileSync(process.execPath, [
    join(harnessRoot, "node_modules", "typescript", "bin", "tsc"),
    join(harnessRoot, "src", "appserver", "archive.ts"),
    "--module", "nodenext", "--target", "es2022", "--skipLibCheck", "--outDir", out,
  ], { stdio: "pipe" });
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
  const bar = mkdtempSync(join(tmpdir(), "m5race-"));
  const go = join(bar, "go");
  const stderr: string[] = specs.map(() => "");
  const exits = specs.map((s, i) => {
    const kid = spawn(process.execPath, [
      join(outDir, "child.mjs"), join(outDir, "archive.js"), ccxDir, s.op, s.id,
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
  const started = spans.map((s) => s[0]).reduce((a, b) => (a > b ? a : b));
  const ended = spans.map((s) => s[1]).reduce((a, b) => (a < b ? a : b));
  return { parked: specs.map((_, i) => readFileSync(join(bar, `r${i}`), "utf8")), overlapped: started < ended };
}
