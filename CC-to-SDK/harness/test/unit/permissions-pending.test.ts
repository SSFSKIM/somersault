import { describe, expect, it, vi } from "vitest";
import { PendingPermissions } from "../../src/permissions/pending.js";
import type { PermissionRequest } from "../../src/permissions/types.js";

const req = (toolUseID: string, signal = new AbortController().signal): PermissionRequest =>
  ({ toolName: "Bash", input: { command: "ls" }, toolUseID, signal });

describe("PendingPermissions", () => {
  it("settles the awaited promise when answered", async () => {
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const decision = p.brokerFor("s1").request(req("t1"));
    expect(p.list()).toHaveLength(1);
    expect(p.respond("t1", { kind: "allow_once" })).toBe(true);
    await expect(decision).resolves.toEqual({ kind: "allow_once" });
    expect(p.list()).toHaveLength(0);
  });

  it("does not leak: an answered entry is gone and its timer is cancelled", () => {
    const cancel = vi.fn();
    const p = new PendingPermissions({ expireAfterMs: 1000, schedule: () => cancel });
    void p.brokerFor("s1").request(req("t1"));
    p.respond("t1", { kind: "deny" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(p.list()).toHaveLength(0);
  });

  it("rejects a duplicate answer rather than resolving twice", async () => {
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const decision = p.brokerFor("s1").request(req("t1"));
    expect(p.respond("t1", { kind: "allow_once" })).toBe(true);
    expect(p.respond("t1", { kind: "deny" })).toBe(false);   // second answer is refused, not applied
    await expect(decision).resolves.toEqual({ kind: "allow_once" });
  });

  it("denies everything on teardown so nothing is left awaited", async () => {
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const a = p.brokerFor("s1").request(req("t1"));
    const b = p.brokerFor("s2").request(req("t2"));
    p.denyAll();
    await expect(a).resolves.toEqual({ kind: "deny" });
    await expect(b).resolves.toEqual({ kind: "deny" });
  });

  it('expireAfterMs "never" schedules NO timer at all', () => {
    const schedule = vi.fn(() => () => {});
    const p = new PendingPermissions({ expireAfterMs: "never", schedule });
    void p.brokerFor("s1").request(req("t1"));
    expect(schedule).not.toHaveBeenCalled();     // not "a very long timer" — none
    expect(p.list()).toHaveLength(1);
  });

  it("expires to deny when a finite policy is given", async () => {
    let fire = () => {};
    const p = new PendingPermissions({ expireAfterMs: 50, schedule: (fn) => { fire = fn; return () => {}; } });
    const decision = p.brokerFor("s1").request(req("t1"));
    fire();
    await expect(decision).resolves.toEqual({ kind: "deny" });
  });

  it("settles on abort so an interrupted turn cannot leave an awaited promise", async () => {
    const ac = new AbortController();
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const decision = p.brokerFor("s1").request(req("t1", ac.signal));
    ac.abort();
    await expect(decision).resolves.toEqual({ kind: "deny" });
  });
});
