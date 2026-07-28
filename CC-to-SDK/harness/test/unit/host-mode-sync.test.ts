import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-mode-sync-"));

/** Same fake-session + drive pattern as host-frames.test.ts: `onFrame(cb)` stores the callback,
 *  `drive(m)` invokes it exactly like Session's read-loop would. `setPermissionMode` is overridable per
 *  test so a test can observe call order/count or force a rejection. */
function fakeSession(over: Record<string, unknown> = {}) {
  let cb: ((m: unknown) => void) | undefined;
  const setPermissionModeCalls: string[] = [];
  const fake = {
    submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); return { result: {} }; },
    sessionId: "sid-1",
    dispose: async () => {},
    onFrame: (c: (m: unknown) => void) => { cb = c; return () => { cb = undefined; }; },
    setPermissionMode: async (m: string) => { setPermissionModeCalls.push(m); },
    ...over,
  };
  return { fake, drive: (m: unknown) => cb?.(m), setPermissionModeCalls };
}

const hostFor = (session: unknown, config: Record<string, unknown> = {}) =>
  new SessionHost(
    { short: "e0e0e0e0", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: config as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: () => session as any, procStartOf: async () => "start" },
  );

describe("host mode sync (one source of truth, last-write-wins)", () => {
  it("initializes mode from resolvedPermissionMode and reports it in status()", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake, { permissionMode: "plan" });
    await host.start();
    expect(host.status().permissionMode).toBe("plan");
    await host.stop();
  });

  it("a status frame overwrites the mode and emits state", async () => {
    const { fake, drive } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    drive({ type: "system", subtype: "status", status: null, permissionMode: "acceptEdits" });
    expect(host.status().permissionMode).toBe("acceptEdits");
    const stateEvents = seen.filter((e) => e.kind === "state") as Extract<HostEvent, { kind: "state" }>[];
    expect(stateEvents.some((e) => e.status.permissionMode === "acceptEdits")).toBe(true);
    await host.stop();
  });

  it("set_permission_mode control op writes the mode AFTER the session call succeeds and emits state", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    await host.control({ op: "set_permission_mode", mode: "default" });
    expect(host.status().permissionMode).toBe("default");
    const stateEvents = seen.filter((e) => e.kind === "state") as Extract<HostEvent, { kind: "state" }>[];
    expect(stateEvents.some((e) => e.status.permissionMode === "default")).toBe(true);
    await host.stop();
  });

  it("a REJECTING set_permission_mode leaves the mode untouched", async () => {
    const { fake } = fakeSession({ setPermissionMode: async () => { throw new Error("nope"); } });
    const host = hostFor(fake, { permissionMode: "plan" });
    await host.start();
    expect(host.status().permissionMode).toBe("plan");
    await expect(host.control({ op: "set_permission_mode", mode: "default" })).rejects.toThrow("nope");
    expect(host.status().permissionMode).toBe("plan");
    await host.stop();
  });

  it("plan upgrade fires on the status frame, not on answer release (the ordering rule)", async () => {
    const { fake, drive, setPermissionModeCalls } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    const decision = host.broker().request({
      toolName: "ExitPlanMode", input: {}, toolUseID: "p1", kind: "plan", signal: new AbortController().signal,
    });
    host.answer("p1", { kind: "plan_approve", acceptEdits: true }, "test");
    await decision;
    // The answer alone must NOT have called setPermissionMode yet.
    expect(setPermissionModeCalls).toEqual([]);
    expect((host as any).planUpgradePending).toBe(true);
    // Now drive the CLI's own post-approval status frame.
    drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    // applyPlanUpgrade is async (await session.setPermissionMode) — give it a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(setPermissionModeCalls).toEqual(["acceptEdits"]);
    expect(host.status().permissionMode).toBe("acceptEdits");
    expect((host as any).planUpgradePending).toBe(false);
    const stateEvents = seen.filter((e) => e.kind === "state") as Extract<HostEvent, { kind: "state" }>[];
    expect(stateEvents.some((e) => e.status.permissionMode === "acceptEdits")).toBe(true);
    await host.stop();
  });

  it("turn-end belt: a pending upgrade with no status frame is applied when the turn ends", async () => {
    const { fake, setPermissionModeCalls } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    // Simulate a plan already approved with acceptEdits, but no status frame ever arrives.
    (host as any).planUpgradePending = true;
    await host.runTask("go");
    expect(setPermissionModeCalls).toEqual(["acceptEdits"]);
    expect(host.status().permissionMode).toBe("acceptEdits");
    expect((host as any).planUpgradePending).toBe(false);
    await host.stop();
  });

  // Final-review finding 1: resumeSession() used to open the fresh engine from the LAUNCH config only,
  // never re-consulting `this.mode` — so a live Tab-laddered (or plan-earned) mode choice silently
  // evaporated on /resume while status() kept reporting it. Chosen repair: open the resumed engine at
  // the CURRENT runtime mode (carries live user intent across the resume), not re-seeded from the launch
  // config (which would silently discard that choice with no notice). Whichever repair, the host's
  // reported mode and the engine's actual mode must agree afterward — this pins that invariant AND the
  // specific engine-open call.
  it("resumeSession opens the new engine at the CURRENT runtime mode, not the launch config's", async () => {
    const { fake } = fakeSession();
    const opens: any[] = [];
    const host = new SessionHost(
      { short: "e0e0e0e1", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: { permissionMode: "acceptEdits" } as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
      { openSession: (c: unknown) => { opens.push(c); return fake as any; }, procStartOf: async () => "start" },
    );
    await host.start();
    expect(host.status().permissionMode).toBe("acceptEdits");
    await host.control({ op: "set_permission_mode", mode: "default" });   // live Tab-ladder choice
    expect(host.status().permissionMode).toBe("default");
    await host.resumeSession("resume-id-1");
    // The resumed engine must be opened at the LIVE runtime mode ("default"), not the launch config's
    // stale "acceptEdits" — and status() must agree with what the engine actually has.
    expect(opens[1]).toMatchObject({ resume: "resume-id-1", permissionMode: "default" });
    expect(host.status().permissionMode).toBe("default");
    await host.stop();
  });

  it("a failed/interrupted turn clears planUpgradePending in the catch, not just the try", async () => {
    const fake = {
      sessionId: "sid-1",
      submit: async () => { throw new Error("turn failed"); },
      dispose: async () => {},
      setPermissionMode: async () => {},
    };
    const host = hostFor(fake);
    await host.start();
    (host as any).planUpgradePending = true;
    await expect(host.runTask("go")).rejects.toThrow("turn failed");
    expect((host as any).planUpgradePending).toBe(false);
    await host.stop();
  });
});
