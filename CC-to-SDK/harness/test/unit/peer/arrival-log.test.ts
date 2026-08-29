// test/unit/peer/arrival-log.test.ts — the store's DURABILITY contract, which is the only reason it is on
// disk at all: `seq` has to keep counting across a restart (a per-process counter made placement wrong),
// the cap has to shed entries without ever shrinking the `logged` total a client checks completeness
// against, and a crash between "count the victim" and "delete the victim" has to resolve toward
// over-reporting. Each test below is one of those, driven through a real filesystem root because a mocked
// fs would test the mock's ordering rather than rename's.
import { describe, expect, it, vi } from "vitest";
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsArrivalStore, contentHash16, ARRIVAL_LOG_CAP, type ArrivalEntry } from "../../../src/peer/arrivalLog.js";

// A second process writing this session's marker INSIDE the store's critical section is not something a
// test can schedule for real, so it is injected at the seam: the hook below fires the instant a marker
// rename lands — i.e. mid-section — and the two race tests use it to run a competitor there. That is a
// simulation of the race, not the race; what it exercises for real is the exclusion, and the store's
// answer when exclusion is not available.
const race = vi.hoisted(() => ({ afterMarkerRename: null as (() => void) | null }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: (from: Parameters<typeof real.renameSync>[0], to: Parameters<typeof real.renameSync>[1]) => {
      real.renameSync(from, to);
      if (String(to).endsWith("marker.json")) race.afterMarkerRename?.();
    },
  };
});

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
  it("contentHash16 is stable and 16 hex chars", () => {
    expect(contentHash16("hello")).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash16("hello")).toBe(contentHash16("hello"));
    expect(contentHash16("hello")).not.toBe(contentHash16("hello "));
  });
});
