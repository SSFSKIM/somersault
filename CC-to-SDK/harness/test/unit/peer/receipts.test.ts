// test/unit/peer/receipts.test.ts — the correlation map's LIFECYCLE, which is the whole difficulty: the
// common outcomes (delivered, refused) produce no receipt at all, so nothing about the success path ever
// signals that an entry can be released. Every rule below exists because "wait for the receipt" is not a
// cleanup strategy when the receipt may never come.
import { describe, it, expect } from "vitest";
import { ReceiptMap, RETENTION_MS, PER_CONN_CAP, GLOBAL_CAP, type ReceiptStatus } from "../../../src/peer/receipts.js";

function mk(now = { t: 0 }) {
  const seen: Array<{ msgId: string; status: ReceiptStatus; reason?: string; from: string }> = [];
  const map = new ReceiptMap<{ connId: number }>({ deliver: (_conn, msgId, status, reason, from) => { seen.push({ msgId, status, ...(reason ? { reason } : {}), from }); } }, { now: () => now.t });
  const track = (msgId: string, connId: number) => map.track(msgId, { connId });
  return { map, seen, now, track };
}

describe("ReceiptMap", () => {
  it("routes a receipt to the connection that sent the message", () => {
    const { map, seen, track } = mk();
    track("m-1", 7);
    expect(map.route({ orig_msg_id: "m-1", status: "held", reason: "parity", from: "uds:/a.sock" })).toBe(true);
    expect(seen).toEqual([{ msgId: "m-1", status: "held", reason: "parity", from: "uds:/a.sock" }]);
  });

  it("ignores a receipt for a msgId it never tracked", () => {
    const { map, seen, track } = mk();
    expect(map.route({ orig_msg_id: "nope", status: "held", from: "uds:/a.sock" })).toBe(false);
    expect(seen).toEqual([]);
  });

  it("ignores a frame with no orig_msg_id — a non-UUID msg_id costs correlation, and silence is correct", () => {
    const { map, track } = mk();
    track("m-1", 7);
    expect(map.route({ status: "held", from: "uds:/a.sock" })).toBe(false);
  });

  it("KEEPS the entry after held, because expired can still follow", () => {
    const { map, seen, track } = mk();
    track("m-1", 7);
    map.route({ orig_msg_id: "m-1", status: "held", from: "uds:/a.sock" });
    expect(map.size()).toBe(1);
    map.route({ orig_msg_id: "m-1", status: "expired", from: "uds:/a.sock" });
    expect(seen.map(s => s.status)).toEqual(["held", "expired"]);
    expect(map.size()).toBe(0);
  });

  it("releases immediately on every terminal status", () => {
    for (const status of ["expired", "delivered", "refused", "denied", "dropped"] as ReceiptStatus[]) {
      const { map, track } = mk();
      track("m-1", 7);
      map.route({ orig_msg_id: "m-1", status, from: "uds:/a.sock" });
      expect(map.size()).toBe(0);
    }
  });

  it("drops a connection's entries when it closes", () => {
    const { map, track } = mk();
    track("m-1", 7); track("m-2", 8);
    map.dropConnection(7);
    expect(map.size()).toBe(1);
    expect(map.route({ orig_msg_id: "m-1", status: "held", from: "uds:/a.sock" })).toBe(false);
  });

  it("expires entries past the retention window and TELLS the sender", () => {
    const now = { t: 0 };
    const { map, seen, track } = mk(now);
    track("m-1", 7);
    now.t = RETENTION_MS + 1;
    map.sweep();
    expect(map.size()).toBe(0);
    expect(seen).toEqual([{ msgId: "m-1", status: "dropped", reason: "correlation expired", from: "" }]);
  });

  it("evicts oldest-first at the per-connection cap, and says so", () => {
    const { map, seen, track } = mk();
    for (let i = 0; i <= PER_CONN_CAP; i++) track(`m-${i}`, 7);
    expect(map.size()).toBe(PER_CONN_CAP);
    expect(seen[0]).toEqual({ msgId: "m-0", status: "dropped", reason: "correlation evicted", from: "" });
  });

  it("evicts oldest-first at the global cap across connections", () => {
    const { map, track } = mk();
    for (let i = 0; i <= GLOBAL_CAP; i++) track(`g-${i}`, i % 64);
    expect(map.size()).toBe(GLOBAL_CAP);
  });
});
