import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-settings-"));

const user = (text: string, uuid: string) => ({ type: "user", uuid, message: { role: "user", content: text } });
const assistant = (uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });

/** A fake HostSession exposing applyFlagSettings/getSettings spies, mirroring host-control.test.ts's
 *  fakeSession() fixture. `calls` records every applyFlagSettings payload IN ORDER — the accumulator
 *  tests assert against it directly. */
function fakeSession(over: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const fake = {
    submit: vi.fn(async () => ({ result: {} })),
    sessionId: "sid-1",
    dispose: vi.fn(async () => {}),
    onFrame: vi.fn(() => () => {}),
    applyFlagSettings: vi.fn(async (s: Record<string, unknown>) => { calls.push(s); }),
    getSettings: vi.fn(async () => ({ effective: { permissionMode: "default" }, sources: [], applied: [] })),
    ...over,
  };
  return { calls, fake };
}

const hostFor = (session: unknown, opens?: unknown[], config: Record<string, unknown> = {}) =>
  new SessionHost(
    { short: "5e77c0de", name: "t", cwd: "/work", kind: "interactive", detached: true, config: config as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: (c: unknown) => { opens?.push(c); return session as any; }, procStartOf: async () => "start" },
  );

const emptyPerms = { allow: [] as string[], ask: [] as string[], deny: [] as string[], additionalDirectories: [] as string[] };

describe("host settings ops", () => {
  it("get_settings passes through the session's unwrapped response", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(await host.getSettings()).toEqual({ effective: { permissionMode: "default" }, sources: [], applied: [] });
    await host.stop();
  });

  it("add_dir sends the COMPLETE permissions object, accumulating across calls", async () => {
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    await host.addDir("/a");
    await host.addDir("/b");
    expect(calls).toEqual([
      { permissions: { ...emptyPerms, additionalDirectories: ["/a"] } },
      { permissions: { ...emptyPerms, additionalDirectories: ["/a", "/b"] } },
    ]);
    await host.stop();
  });

  it("remove_dir re-sends the object without the path", async () => {
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    await host.addDir("/a");
    await host.addDir("/b");
    calls.length = 0;
    await host.removeDir("/a");
    expect(calls).toEqual([{ permissions: { ...emptyPerms, additionalDirectories: ["/b"] } }]);
    await host.stop();
  });

  it("add_rule/remove_rule accumulate in the same single permissions object as dirs", async () => {
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    await host.addDir("/a");
    await host.addRule("allow", "WebFetch");
    // the second call carries BOTH the dir and the rule — one whole-object permissions send, not two
    expect(calls[calls.length - 1]).toEqual({ permissions: { ...emptyPerms, allow: ["WebFetch"], additionalDirectories: ["/a"] } });
    await host.removeRule("allow", "WebFetch");
    expect(calls[calls.length - 1]).toEqual({ permissions: { ...emptyPerms, additionalDirectories: ["/a"] } });
    await host.stop();
  });

  it("set_output_style applies {outputStyle} and records it", async () => {
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    await host.setOutputStyle("concise");
    expect(calls).toEqual([{ outputStyle: "concise" }]);
    await host.stop();
  });

  it("REPLAYS accumulated flag state after resumeSession", async () => {
    // Same fake session instance is reused across both opens (swapEngine's openSession call), so its
    // `calls` array observes the replay's own applyFlagSettings sends once cleared of the pre-resume ones.
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    await host.addDir("/a");
    await host.setOutputStyle("concise");
    calls.length = 0;
    await host.resumeSession("resume-1");
    expect(calls).toContainEqual({ permissions: { ...emptyPerms, additionalDirectories: ["/a"] } });
    expect(calls).toContainEqual({ outputStyle: "concise" });
    await host.stop();
  });

  it("REPLAYS accumulated flag state after rewind too", async () => {
    // rewind() calls the same swapEngine (host.ts) — a hook placed only in resumeSession would miss it.
    const { calls, fake } = fakeSession({
      rewind: vi.fn(async (_uuid: string, _o?: { dryRun?: boolean }) => ({ canRewind: true, filesChanged: [], insertions: 0, deletions: 0 })),
    });
    const getMessages = vi.fn(async () => [user("A", "uA"), assistant("aA"), user("B", "uB")]);
    const host = new SessionHost(
      { short: "5e77c0d2", name: "t", cwd: "/work", kind: "interactive", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
      { openSession: () => fake as any, getMessages, disposeGraceMs: 20 },
    );
    await host.start();
    await host.addDir("/a");
    await host.setOutputStyle("concise");
    calls.length = 0;
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "both");
    expect(calls).toContainEqual({ permissions: { ...emptyPerms, additionalDirectories: ["/a"] } });
    expect(calls).toContainEqual({ outputStyle: "concise" });
    await host.stop();
  });

  it("list_dirs = cwd first (source 'cwd'), then launch config dirs, then session adds", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake, undefined, { additionalDirectories: ["/launch1", "/launch2"] });
    await host.start();
    await host.addDir("/session1");
    expect(host.listDirs()).toEqual([
      { path: "/work", source: "cwd" },
      { path: "/launch1", source: "launch" },
      { path: "/launch2", source: "launch" },
      { path: "/session1", source: "session" },
    ]);
    await host.stop();
  });

  it("add_dir surfaces engine failure as {ok:false,error} and does NOT record the dir", async () => {
    const { fake } = fakeSession({ applyFlagSettings: vi.fn(async () => { throw new Error("denied"); }) });
    const host = hostFor(fake);
    await host.start();
    await expect(host.addDir("/a")).rejects.toThrow("denied");
    // retry-safety: a failed grant must not leave a phantom row the next add_dir/replay re-sends as fact
    expect(host.listDirs().some((d) => d.path === "/a")).toBe(false);
    await host.stop();
  });
});
