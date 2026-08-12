import { describe, expect, it, vi } from "vitest";
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
  const calls: string[] = [];                     // both setters in ONE array: the auto swap's ORDER is the contract
  const fake = {
    submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); return { result: {} }; },
    sessionId: "sid-1",
    dispose: async () => {},
    onFrame: (c: (m: unknown) => void) => { cb = c; return () => { cb = undefined; }; },
    setPermissionMode: async (m: string) => { setPermissionModeCalls.push(m); calls.push(`mode:${m}`); },
    setModel: async (m?: string) => { calls.push(`model:${m}`); },
    ...over,
  };
  return { fake, drive: (m: unknown) => cb?.(m), setPermissionModeCalls, calls };
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
    host.answer("p1", { kind: "plan_approve", mode: "acceptEdits" }, "test");
    await decision;
    // The answer alone must NOT have called setPermissionMode yet.
    expect(setPermissionModeCalls).toEqual([]);
    expect((host as any).planUpgradeMode).toBe("acceptEdits");
    // Now drive the CLI's own post-approval status frame.
    drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    // applyPlanUpgrade is async (await session.setPermissionMode) — give it a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(setPermissionModeCalls).toEqual(["acceptEdits"]);
    expect(host.status().permissionMode).toBe("acceptEdits");
    expect((host as any).planUpgradeMode).toBeUndefined();
    const stateEvents = seen.filter((e) => e.kind === "state") as Extract<HostEvent, { kind: "state" }>[];
    expect(stateEvents.some((e) => e.status.permissionMode === "acceptEdits")).toBe(true);
    await host.stop();
  });

  it("turn-end belt: a pending upgrade with no status frame is applied when the turn ends", async () => {
    const { fake, setPermissionModeCalls } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    // Simulate a plan already approved with acceptEdits, but no status frame ever arrives.
    (host as any).planUpgradeMode = "acceptEdits";
    await host.runTask("go");
    expect(setPermissionModeCalls).toEqual(["acceptEdits"]);
    expect(host.status().permissionMode).toBe("acceptEdits");
    expect((host as any).planUpgradeMode).toBeUndefined();
    await host.stop();
  });

  // ── Wave T Task 10: the applier grants what the decision NAMED, and never lies about it ──────────────
  it("the applier sets the mode the decision carried, not a hard-coded acceptEdits", async () => {
    const { fake, drive, setPermissionModeCalls } = fakeSession();
    const host = hostFor(fake, { model: "claude-sonnet-5" });                    // already auto-capable
    await host.start();
    const decision = host.broker().request({ toolName: "ExitPlanMode", input: {}, toolUseID: "p1", kind: "plan", signal: new AbortController().signal });
    host.answer("p1", { kind: "plan_approve", mode: "auto" }, "test");
    await decision;
    drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(setPermissionModeCalls).toEqual(["auto"]);
    expect(host.status().permissionMode).toBe("auto");
    await host.stop();
  });

  // `default` is what the ENGINE flips to by itself ten milliseconds after the allow (probe 97), so the
  // manually-approve arm arms nothing — exactly as the old acceptEdits:false answer did.
  it("a `default` grant arms no upgrade at all", async () => {
    const { fake, drive, setPermissionModeCalls } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const decision = host.broker().request({ toolName: "ExitPlanMode", input: {}, toolUseID: "p1", kind: "plan", signal: new AbortController().signal });
    host.answer("p1", { kind: "plan_approve", mode: "default" }, "test");
    await decision;
    expect((host as any).planUpgradeMode).toBeUndefined();
    drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(setPermissionModeCalls).toEqual([]);
    await host.stop();
  });

  // `auto` is MODEL-gated, so granting it without swapping the model first cannot work. Probe 99 measured
  // what actually happens on the RUNTIME setter: the engine REFUSES ("auto mode unavailable for this
  // model") rather than falling back to `default` in silence, so the swap is what makes the grant SUCCEED
  // — not, as this comment used to claim, what prevents a lying chip. Same ordering as useChat.applyMode.
  it("granting `auto` on a model that cannot run it swaps the model FIRST", async () => {
    const { fake, drive, calls } = fakeSession();
    const host = hostFor(fake, { model: "claude-haiku-4-5" });
    await host.start();
    (host as any).planUpgradeMode = "auto";
    drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["model:claude-sonnet-5", "mode:auto"]);
    expect(host.status().permissionMode).toBe("auto");
    await host.stop();
  });

  it("granting `auto` on a model that already supports it swaps nothing", async () => {
    const { fake, drive, calls } = fakeSession();
    const host = hostFor(fake, { model: "claude-opus-5" });
    await host.start();
    (host as any).planUpgradeMode = "auto";
    drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["mode:auto"]);
    await host.stop();
  });

  // The OTHER half of that guard, and the arm no test reached before — every test here seeds a model
  // through the config, and `resolvedModel` falls back to DEFAULTS.model, so `this.model` is never
  // undefined at construction. It becomes undefined the reachable way: `set_model`'s model field is
  // OPTIONAL (ops.ts:43, and host-ops.test.ts:226 parses a bare `{op:"set_model"}` as valid), after which
  // host.ts:313 writes `resolveModelAlias(undefined)` and it stays undefined for the life of the host.
  // Refusing to swap a model we cannot see is correct — resolving it to DEFAULT_AUTO_MODEL would downgrade
  // a session the user configured on purpose, which is exactly why useChat.applyMode refuses too — but the
  // grant that follows is then UNVERIFIED, so the applier must say so instead of writing `auto` in silence.
  it("granting `auto` with NO known model swaps nothing and reports that it could not be checked", async () => {
    const { fake, drive, calls } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    await host.control({ op: "set_model" });                                    // the model field is optional: this UNSETS it
    calls.length = 0;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      (host as any).planUpgradeMode = "auto";
      drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toEqual(["mode:auto"]);                                     // the swap is skipped, as designed
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0]![0])).toContain("auto mode");
      expect(String(err.mock.calls[0]![0])).toContain("will refuse the mode");
    } finally { err.mockRestore(); }
    expect(host.status().permissionMode).toBe("auto");
    await host.stop();
  });

  it("a REJECTED plan-upgrade setter leaves the chip on the engine's real mode and REPORTS it", async () => {
    const { fake, drive } = fakeSession({ setPermissionMode: async () => { throw new Error("nope"); } });
    const host = hostFor(fake);
    await host.start();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      (host as any).planUpgradeMode = "acceptEdits";
      drive({ type: "system", subtype: "status", status: null, permissionMode: "default" });
      await new Promise((r) => setTimeout(r, 0));
      expect(host.status().permissionMode).toBe("default");                     // NOT the mode we failed to get
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0]![0])).toContain("acceptEdits");
      expect(String(err.mock.calls[0]![0])).toContain("nope");
    } finally { err.mockRestore(); }
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

  it("a CLEARED model is not resurrected by a later swap: the replacement opens with no model and status omits it (final review R7)", async () => {
    // set_model with no model field UNSETS this.model (control() -> resolveModelAlias(undefined) -> undefined).
    // The swap must then override engineConfig's LAUNCH model explicitly, or it comes back while status()
    // (which omits an unset model) keeps advertising none — a mirror/engine divergence.
    const { fake } = fakeSession();
    const opens: any[] = [];
    const host = new SessionHost(
      { short: "e0e0e0e2", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: { model: "claude-sonnet-5" } as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
      { openSession: (c: unknown) => { opens.push(c); return fake as any; }, procStartOf: async () => "start" },
    );
    await host.start();
    expect(host.status().model).toBe("claude-sonnet-5");                 // launch model is live
    await host.control({ op: "set_model" });                            // the model field is optional: this CLEARS it
    expect(host.status().model).toBeUndefined();                        // status omits a cleared model
    await host.resumeSession("resume-id-1");                            // a swap
    // The replacement opens with model EXPLICITLY undefined — the launch "claude-sonnet-5" does not come back.
    expect(opens[1]).toMatchObject({ resume: "resume-id-1" });
    expect(opens[1].model).toBeUndefined();
    expect(host.status().model).toBeUndefined();                        // …and status still agrees
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
    (host as any).planUpgradeMode = "acceptEdits";
    await expect(host.runTask("go")).rejects.toThrow("turn failed");
    expect((host as any).planUpgradeMode).toBeUndefined();
    await host.stop();
  });
});
