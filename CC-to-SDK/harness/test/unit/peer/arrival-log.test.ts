// test/unit/peer/arrival-log.test.ts — the store's DURABILITY contract, which is the only reason it is on
// disk at all: `seq` has to keep counting across a restart (a per-process counter made placement wrong),
// the cap has to shed entries without ever shrinking the `logged` total a client checks completeness
// against, and a crash between "count the victim" and "delete the victim" has to resolve toward
// over-reporting. Each test below is one of those, driven through a real filesystem root because a mocked
// fs would test the mock's ordering rather than rename's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsArrivalStore, contentHash16, ARRIVAL_LOG_CAP, type ArrivalEntry } from "../../../src/peer/arrivalLog.js";

// A second process writing this session's marker INSIDE the store's critical section is not something a
// test can schedule for real, so it is injected at the seam: the hook below fires the instant a marker
// rename lands — i.e. mid-section — and the two race tests use it to run a competitor there. That is a
// simulation of the race, not the race; what it exercises for real is the exclusion, and the store's
// answer when exclusion is not available.
const race = vi.hoisted(() => ({
  afterMarkerRename: null as (() => void) | null,
  afterLockUnlink: null as ((path: string) => void) | null,
  beforeListing: null as ((path: string) => void) | null,
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: (from: Parameters<typeof real.renameSync>[0], to: Parameters<typeof real.renameSync>[1]) => {
      real.renameSync(from, to);
      if (String(to).endsWith("marker.json")) race.afterMarkerRename?.();
    },
    // The other half of the same instrument: the instant a delete lands inside a lock, which is where a
    // successor's claim would race a breaker's judgment.
    unlinkSync: (path: Parameters<typeof real.unlinkSync>[0]) => {
      real.unlinkSync(path);
      if (String(path).includes(LOCK_DIR)) race.afterLockUnlink?.(String(path));
    },
    // The THIRD seam, and the one that schedules a competitor BETWEEN a snapshot's two reads rather than
    // inside a critical section: it fires immediately before a session directory is listed. Whichever of
    // the two reads a snapshot does first, the competitor lands between them — which is what makes the
    // read ORDER, and only the read order, decide the answer.
    readdirSync: ((path: Parameters<typeof real.readdirSync>[0], opts?: never) => {
      if (!String(path).includes(LOCK_DIR)) race.beforeListing?.(String(path));
      return real.readdirSync(path, opts);
    }) as typeof real.readdirSync,
  };
});
const LOCK_DIR = ".marker.lock";
/** A claim in the format the lock's own break path screens for: `<pid>-<hex>.<lease>`. `staleMs` back puts
 *  it past the 5s lease; `0` makes it a live holder's. */
const claimName = (agedMs: number) => `${process.pid}-abcdef123456.${Date.now() - agedMs}`;

/** A competing process's eviction, done the way the store does one and RESPECTING THE LOCK: claim it,
 *  drop the oldest entry, write the count derived from the base it read before our append began. Same
 *  base means it writes the same `dropped` WE write — bytes identical to ours, which is why no read-back
 *  can ever notice this one. Returns whether it got to run: excluded is the correct outcome, and the only
 *  thing standing between this fixture and a silently short count. */
const competingEviction = (dir: string, base: { dropped: number; seqHigh: number }): boolean => {
  let fd: number;
  try { fd = openSync(join(dir, ".marker.lock"), "wx", 0o600); } catch { return false; }
  try {
    unlinkSync(join(dir, readdirSync(dir).filter((f) => f.startsWith("e-")).sort()[0]));
    writeFileSync(join(dir, "marker.json"), JSON.stringify({ dropped: base.dropped + 1, seqHigh: base.seqHigh }));
    return true;
  } finally { closeSync(fd); unlinkSync(join(dir, ".marker.lock")); }
};

const entry = (n: number, over: Partial<ArrivalEntry> = {}): ArrivalEntry => ({
  v: 1, id: `id-${String(n).padStart(3, "0")}`, sessionId: "s1",
  anchor: { afterUuid: `u${n}`, prevUuid: n > 0 ? `u${n - 1}` : null, fp: { type: "assistant", hash: contentHash16(`row${n}`) } },
  seq: n, observedAt: new Date().toISOString(), origin: { kind: "peer" }, text: `m${n}`, ...over,
});

describe("fsArrivalStore", () => {
  it("round-trips entries sorted by (seq, id) and counts them", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    store.append(entry(2)); store.append(entry(1));
    expect(store.readAll("s1").map((e) => e.seq)).toEqual([1, 2]);
    expect(store.counts("s1")).toEqual({ logged: 2, dropped: 0 });
    expect(store.readAll("other")).toEqual([]);
  });
  it("nextSeq continues from the store across a re-open (criterion 11's substrate)", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    fsArrivalStore(root).append(entry(7));
    expect(fsArrivalStore(root).nextSeq("s1")).toBe(8);   // a NEW store instance = a restart
  });
  it("evicts oldest past the cap, and logged still reports the pre-eviction total (criterion 17)", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    for (let i = 0; i < ARRIVAL_LOG_CAP + 3; i++) store.append(entry(i));
    expect(store.readAll("s1")).toHaveLength(ARRIVAL_LOG_CAP);
    expect(store.readAll("s1")[0].seq).toBe(3);
    expect(store.counts("s1")).toEqual({ logged: ARRIVAL_LOG_CAP + 3, dropped: 3 });
  });
  it("a counted-but-not-deleted victim is re-unlinked on the next append (over-report-safe recovery)", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    // Simulate the crash window: bump the marker as append would, but leave the victim file on disk.
    store.append(entry(ARRIVAL_LOG_CAP));               // normal eviction of seq 0
    const dir = join(root, "s1");
    // hand-write a marker claiming one MORE drop than files reflect, naming the victim it never unlinked
    // — which is exactly what a crash between the marker write and the unlink leaves behind.
    const marker = JSON.parse(readFileSync(join(dir, "marker.json"), "utf8"));
    const victim = readdirSync(dir).filter((f) => f.startsWith("e-")).sort()[0];
    writeFileSync(join(dir, "marker.json"), JSON.stringify({ ...marker, dropped: marker.dropped + 1, pending: victim }));
    const reopened = fsArrivalStore(root);
    reopened.append(entry(ARRIVAL_LOG_CAP + 1));
    expect(readdirSync(dir)).not.toContain(victim);      // paid for once, deleted for real
    const counts = reopened.counts("s1");
    expect(counts.dropped).toBeGreaterThanOrEqual(2);    // never under-reports
    expect(reopened.readAll("s1").length + counts.dropped).toBe(counts.logged);
  });
  it("append throws on an unwritable directory and markDegraded survives a re-open", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    store.append(entry(0));
    chmodSync(join(root, "s1"), 0o500);
    try { expect(() => store.append(entry(1))).toThrow(); } finally { chmodSync(join(root, "s1"), 0o700); }
    store.markDegraded("s1");
    expect(fsArrivalStore(root).isDegraded("s1")).toBe(true);
  });
  it("a session that has never been written is not degraded", () => {
    expect(fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-"))).isDegraded("s1")).toBe(false);
  });
  it("markDegraded preserves the dropped count it found, and never rewrites it as zero", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i <= ARRIVAL_LOG_CAP; i++) store.append(entry(i));   // one eviction
    expect(store.counts("s1").dropped).toBe(1);
    store.markDegraded("s1");
    const reopened = fsArrivalStore(root);
    expect(reopened.isDegraded("s1")).toBe(true);
    expect(reopened.counts("s1")).toEqual({ logged: ARRIVAL_LOG_CAP + 1, dropped: 1 });
  });
  it("a same-base competitor is excluded from the marker RMW, so the count stays exact", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));   // no eviction yet: no marker file
    const dir = join(root, "s1");
    // The competitor's base is the marker as it stood before this append — absent, so `dropped: 0`. It
    // therefore writes the very value we write, the lost update that leaves no trace to read back.
    let ran: boolean | null = null;
    race.afterMarkerRename = () => {
      race.afterMarkerRename = null;
      ran = competingEviction(dir, { dropped: 0, seqHigh: -1 });
    };
    try { store.append(entry(ARRIVAL_LOG_CAP)); } finally { race.afterMarkerRename = null; }
    expect(ran).toBe(false);                                            // the lock held it out
    expect(store.counts("s1")).toEqual({ logged: ARRIVAL_LOG_CAP + 1, dropped: 1 });
    expect(store.isDegraded("s1")).toBe(false);                         // exact, so nothing to disclaim
  });
  it("a lock a live competitor never releases degrades the count but still records the message", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    store.append(entry(0));
    writeFileSync(join(root, "s1", ".marker.lock"), "");                // fresh mtime: a live holder
    const started = Date.now();
    store.append(entry(1));
    expect(Date.now() - started).toBeLessThan(1000);                    // bounded wait, never a block
    expect(store.readAll("s1").map((e) => e.seq)).toEqual([0, 1]);      // the message is not lost
    expect(store.isDegraded("s1")).toBe(true);                          // but the count no longer claims
    expect(fsArrivalStore(root).isDegraded("s1")).toBe(true);
  });
  it("a writer that ignores the lock entirely is still caught by the read-back assertion", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    // Stand in for the competing process: overwrite the marker inside the store's write/read-back window,
    // which is what a lost read-modify-write looks like from this side. One shot, then disarm.
    race.afterMarkerRename = () => {
      race.afterMarkerRename = null;
      writeFileSync(join(root, "s1", "marker.json"), JSON.stringify({ dropped: 99, seqHigh: 99 }));
    };
    try { store.append(entry(ARRIVAL_LOG_CAP)); } finally { race.afterMarkerRename = null; }
    expect(store.isDegraded("s1")).toBe(true);
    expect(fsArrivalStore(root).isDegraded("s1")).toBe(true);   // and the flag reached the disk
  });
  it("an unreadable marker is degraded and UNKNOWN, never silently zero (the power-loss shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i <= ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    writeFileSync(join(root, "s1", "marker.json"), "");                  // truncated, not deleted
    const reopened = fsArrivalStore(root);
    expect(reopened.isDegraded("s1")).toBe(true);
    reopened.markDegraded("s1");
    // The lost count is not fabricated back as a 0 that would under-report: the flag goes out alone.
    expect(JSON.parse(readFileSync(join(root, "s1", "marker.json"), "utf8"))).toEqual({ degraded: true });
  });
  it("a sequence past six digits is still an entry, and the order is the NUMBER rather than the name", () => {
    // The padding is six wide, so seq 1,000,000 writes `e-1000000-…` and lexical order puts it BEFORE
    // `e-999999-…`. Both halves are asserted here because either alone would pass a half-fix: a widened
    // pattern that still sorted names would return these three backwards.
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    for (const n of [1_000_001, 999_999, 1_000_000]) store.append(entry(n));
    expect(store.readAll("s1").map((e) => e.seq)).toEqual([999_999, 1_000_000, 1_000_001]);
    expect(store.counts("s1")).toEqual({ logged: 3, dropped: 0 });
    expect(store.nextSeq("s1")).toBe(1_000_002);
  });
  it("degradation is a LATCH: a marker write cannot clear a flag another writer set meanwhile", () => {
    // The unlocked degrade write is deliberate (loud beats blocked) and therefore lands INSIDE another
    // writer's critical section. The seam runs it there: a second store instance — a second process, with
    // its own in-memory latch — degrades the session between the holder's two marker writes. The holder's
    // second write must not carry its own stale `degraded: false` over the top.
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    const other = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    race.afterMarkerRename = () => { race.afterMarkerRename = null; other.markDegraded("s1"); };
    try { store.append(entry(ARRIVAL_LOG_CAP)); } finally { race.afterMarkerRename = null; }
    // A THIRD instance reads only what reached the disk, which is the whole question: an in-memory latch
    // this process happens to hold says nothing to the next `thread/read` in another one.
    expect(fsArrivalStore(root).isDegraded("s1")).toBe(true);
    expect(store.counts("s1").dropped).toBe(1);            // …and the count it was protecting is intact
  });
  it("a corpse's claim is broken, and the count that follows is exact", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    // A holder that died mid-section: the claim it published, with a lease older than the lock's own.
    const lock = join(root, "s1", LOCK_DIR);
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(join(lock, claimName(60_000)), "");
    store.append(entry(ARRIVAL_LOG_CAP));
    expect(store.counts("s1")).toEqual({ logged: ARRIVAL_LOG_CAP + 1, dropped: 1 });
    expect(store.isDegraded("s1")).toBe(false);     // recovered, not merely survived
    expect(existsSync(lock)).toBe(false);
  });
  it("a breaker NEVER removes the claim a successor published into the directory it just emptied", () => {
    // The defect this lock shape exists for, driven deterministically: our breaker judges a corpse and
    // deletes it, and in that instant another writer claims the emptied directory. Under a pathname-only
    // delete both would proceed; here the removal is `rmdir`, whose emptiness precondition IS the test.
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    store.append(entry(0));
    const lock = join(root, "s1", LOCK_DIR);
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(join(lock, claimName(60_000)), "");
    const successor = join(lock, claimName(0));
    race.afterLockUnlink = () => { race.afterLockUnlink = null; writeFileSync(successor, ""); };
    try { store.append(entry(1)); } finally { race.afterLockUnlink = null; }

    expect(existsSync(successor)).toBe(true);       // the live claim stands
    expect(store.readAll("s1").map((e) => e.seq)).toEqual([0, 1]);   // the message is still recorded
    expect(store.isDegraded("s1")).toBe(true);      // …and the count declines to claim, rather than guessing
  });
  it("contentHash16 is stable and 16 hex chars", () => {
    expect(contentHash16("hello")).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash16("hello")).toBe(contentHash16("hello"));
    expect(contentHash16("hello")).not.toBe(contentHash16("hello "));
  });
});

/** A chmod fixture proves nothing where the mode is not enforced — Windows, or root, which reads through a
 *  0o300 directory. The precedent is `arrivals-clear-degraded.test.ts`'s own guard. */
const noModeEnforcement = process.platform === "win32" || process.getuid?.() === 0;

describe("the default root follows CLAUDE_CONFIG_DIR", () => {
  // The sidecar holds the FULL TEXT of a peer message and annotates a transcript, and both of those live
  // under whatever directory the engine was pointed at — which this harness's own tenant preset points per
  // tenant (config/tenantPreset.ts). A sidecar rooted at the literal `~/.claude` therefore writes one
  // tenant's message text into a namespace it does not serve. One spelling for the whole harness:
  // `claudeConfigDir`, the same function the fleet registry and the config domain resolve through.
  const saved = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; });

  it("writes under $CLAUDE_CONFIG_DIR when it is set, and not under the host user's home", () => {
    const tenant = mkdtempSync(join(tmpdir(), "tenant-"));
    process.env.CLAUDE_CONFIG_DIR = tenant;
    const store = fsArrivalStore();                     // NO explicit root: this is the production default
    store.append(entry(0));
    expect(existsSync(join(tenant, "cc-harness", "arrivals", "s1"))).toBe(true);
    expect(store.readAll("s1").map((e) => e.seq)).toEqual([0]);
    rmSync(tenant, { recursive: true, force: true });
  });

  it("falls back to $HOME/.claude with the variable unset, which is where it always was", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(join(tmpdir(), "home-"));
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    try {
      fsArrivalStore().append(entry(0));
      expect(existsSync(join(home, ".claude", "cc-harness", "arrivals", "s1"))).toBe(true);
    } finally {
      if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("a directory that is THERE but not listable is degraded, never empty", () => {
  // ENOENT is the one honest empty — a session that never logged. Every other errno is an inability to read
  // something that IS there, and answering it with `{logged: 0, dropped: 0}` certifies a complete history
  // the store cannot see. `sessions/storeAudit.ts` states the same rule for the transcript store.
  it.skipIf(noModeEnforcement)("latches degraded on an EACCES listing rather than reporting zero", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    fsArrivalStore(root).append(entry(0));
    fsArrivalStore(root).append(entry(1));
    const dir = join(root, "s1");
    // 0o300 — write and traverse, no LIST. `readdir` fails EACCES while `open` of a named path still
    // succeeds, which is exactly the shape that made an unlistable directory read as an empty one.
    chmodSync(dir, 0o300);
    try {
      const store = fsArrivalStore(root);              // a fresh instance: the latch must come from the read
      expect(store.readAll("s1")).toEqual([]);         // it genuinely cannot list them
      expect(store.isDegraded("s1")).toBe(true);       // …and says so, rather than certifying zero
      expect(store.countsSnapshot("s1")).toBeNull();
    } finally { chmodSync(dir, 0o700); }
  });

  it("an absent session is still the honest empty, and not degraded", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    expect(store.readAll("never-logged")).toEqual([]);
    expect(store.countsSnapshot("never-logged")).toEqual({ logged: 0, dropped: 0 });
    expect(store.isDegraded("never-logged")).toBe(false);
  });
});

describe("countsSnapshot — one marker read answers both questions", () => {
  // `isDegraded` then `counts` is TWO marker reads, and another process on this session can degrade the
  // store between them: the reply then publishes numbers taken from a marker that had already stopped
  // vouching for them. One operation, one read, one answer.
  it("returns the counts while the store can vouch for them", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    store.append(entry(0)); store.append(entry(1));
    expect(store.countsSnapshot("s1")).toEqual({ logged: 2, dropped: 0 });
  });
  it("returns null the moment it cannot — including a marker another process degraded", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    fsArrivalStore(root).append(entry(0));
    fsArrivalStore(root).markDegraded("s1");           // a second process, with its own in-memory latch
    expect(fsArrivalStore(root).countsSnapshot("s1")).toBeNull();
  });
  it("null covers the UNKNOWN dropped count too, which `counts` can only report as a zero", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i <= ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    writeFileSync(join(root, "s1", "marker.json"), "");                  // truncated: the count is lost
    expect(fsArrivalStore(root).countsSnapshot("s1")).toBeNull();
  });
});

describe("a count is sampled FILES FIRST, so a concurrent eviction can only over-report", () => {
  // The count is two reads of two things that move together — the entry files and the `dropped` marker —
  // and an eviction between them changes both. Which read goes first therefore decides the DIRECTION of the
  // error, and only one direction is permitted (this file's header: a count must never come out short).
  //
  //   marker first: `dropped` is sampled at 0, the eviction lands, the listing sees the post-eviction 32 —
  //   32 reported for 33 arrivals, an UNDER-report that certifies a history as complete while it is missing
  //   a message. Forbidden.
  //   files first: the listing is sampled, then `dropped` — which only ever grows, so the sum is at least
  //   the true count at the instant of the listing, and at worst counts the victim twice. Over-report, the
  //   direction that reveals a gap that isn't there.
  //
  // `beforeListing` runs the competitor immediately before the directory is listed, which puts it AFTER the
  // marker read under the old order and BEFORE it under the new one — one fixture, both orders, no timing.
  const evictingCompetitor = (root: string) => () => {
    race.beforeListing = null;                       // one-shot: the competitor's own append lists too
    fsArrivalStore(root).append(entry(ARRIVAL_LOG_CAP));
  };

  it("countsSnapshot never reports fewer arrivals than the session received", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));   // at the cap, and no marker yet
    race.beforeListing = evictingCompetitor(root);
    let snap: { logged: number; dropped: number } | null;
    try { snap = store.countsSnapshot("s1"); } finally { race.beforeListing = null; }

    // 33 arrivals exist. The reply may say 33, or 34 if it counted the victim on both sides — never 32.
    expect(snap).not.toBeNull();
    expect(snap!.logged).toBeGreaterThanOrEqual(ARRIVAL_LOG_CAP + 1);
    expect(store.readAll("s1").length + store.countsSnapshot("s1")!.dropped).toBe(ARRIVAL_LOG_CAP + 1);
  });

  it("counts() takes the same order, because the same pair moves the same way", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    race.beforeListing = evictingCompetitor(root);
    let counts: { logged: number; dropped: number };
    try { counts = store.counts("s1"); } finally { race.beforeListing = null; }
    expect(counts.logged).toBeGreaterThanOrEqual(ARRIVAL_LOG_CAP + 1);
  });

  it("nextSeq keeps the OPPOSITE order deliberately, and a competitor's append cannot lower it", () => {
    // The asymmetry is not an oversight. `nextSeq` wants the LARGEST value it can justify — a seq below
    // another writer's collides — and `seqHigh` only moves on eviction while the listing sees every append,
    // so the freshest read must be the LISTING. Reading files last is what makes a concurrent append raise
    // this answer instead of being missed by it.
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    race.beforeListing = evictingCompetitor(root);
    let next: number;
    try { next = store.nextSeq("s1"); } finally { race.beforeListing = null; }
    expect(next).toBeGreaterThan(ARRIVAL_LOG_CAP);   // past the competitor's own entry, never back onto it
  });
});

describe("deleteSession — delete DESTROYS where clear detaches", () => {
  it("removes the session's entries and its marker, and the id then starts empty", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i <= ARRIVAL_LOG_CAP; i++) store.append(entry(i));   // entries AND a marker
    expect(existsSync(join(root, "s1"))).toBe(true);

    store.deleteSession("s1");

    expect(existsSync(join(root, "s1"))).toBe(false);
    // A re-admitted id starts empty rather than inheriting a count for text that is gone.
    expect(store.readAll("s1")).toEqual([]);
    expect(store.countsSnapshot("s1")).toEqual({ logged: 0, dropped: 0 });
    expect(store.nextSeq("s1")).toBe(0);
  });
  it("is ENOENT-tolerant: deleting a session that never logged is a success", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    expect(() => store.deleteSession("never-logged")).not.toThrow();
  });
  it("clears the degraded latch along with the history it was a statement about", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    store.append(entry(0));
    store.markDegraded("s1");
    expect(store.isDegraded("s1")).toBe(true);
    store.deleteSession("s1");
    expect(store.isDegraded("s1")).toBe(false);
    expect(fsArrivalStore(root).isDegraded("s1")).toBe(false);
  });
});
