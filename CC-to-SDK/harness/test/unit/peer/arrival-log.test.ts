// test/unit/peer/arrival-log.test.ts — the store's DURABILITY contract, which is the only reason it is on
// disk at all: `seq` has to keep counting across a restart (a per-process counter made placement wrong),
// the cap has to shed entries without ever shrinking the `logged` total a client checks completeness
// against, and a crash between "count the victim" and "delete the victim" has to resolve toward
// over-reporting. Each test below is one of those, driven through a real filesystem root because a mocked
// fs would test the mock's ordering rather than rename's.
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsArrivalStore, contentHash16, ARRIVAL_LOG_CAP, type ArrivalEntry } from "../../../src/peer/arrivalLog.js";

// The lost-increment race needs a SECOND PROCESS writing this session's marker between our rename and our
// read-back, which no test can schedule for real. So it is INJECTED at that seam: the hook fires the
// instant a marker rename lands, and one test below uses it to hand-write the count a competing writer
// would have left behind. That is a simulation of the race, not the race — what it exercises for real is
// the store's response to finding a marker that is not the one it just wrote.
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
  it("a lost dropped increment degrades instead of under-reporting (injected two-writer race)", () => {
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
