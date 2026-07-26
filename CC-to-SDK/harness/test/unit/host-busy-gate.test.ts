import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-busy-"));

/** A session whose turn we drive by hand, and — unlike host-follow.test.ts's fakeSession — one that
 *  tolerates being submit()ted MORE THAN ONCE without deadlocking the test: each call gets its own
 *  resolver, kept in an array rather than overwriting a single shared closure variable. That distinction
 *  matters here specifically: it is what the unguarded re-entry bug does — the second runTask() call
 *  invokes submit() again and clobbers the first call's onMessage/resolve pair — and a fixture that only
 *  supports one live call at a time can't run both the "before" and "after" of that bug without hanging. */
function fakeSession() {
  const finishers: Array<() => void> = [];
  let currentEmit: (m: unknown) => void = () => {};
  return {
    sessionId: "sid-busy",
    submit(_p: string, onMessage: (m: unknown) => void) {
      currentEmit = onMessage;
      return new Promise<unknown>((resolve) => { finishers.push(() => resolve(undefined)); });
    },
    dispose: async () => {},
    emit: (m: unknown) => currentEmit(m),
    finishAll: () => { while (finishers.length) finishers.shift()!(); },
  };
}

const hostFor = (session: ReturnType<typeof fakeSession>, kind: "bg" | "interactive" = "bg") =>
  new SessionHost({ short: "e5e5e5e5", name: "t", cwd: "/tmp", kind, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: () => session, procStartOf: async () => "start" });

describe("SessionHost.runTask re-entry", () => {
  // The Critical whole-branch finding's second required test: runTask must refuse re-entry on its OWN,
  // not merely trust the socket gate — it is public and reachable directly (RemoteChatSession.prompt()
  // is one caller, not the only one).
  it("refuses a second call while the first turn is still running", async () => {
    const s = fakeSession();
    const host = hostFor(s);
    await host.start();
    const first = host.runTask("one");                        // never resolves until finishAll()
    await expect(host.runTask("two")).rejects.toThrow(/already running/);
    s.finishAll();
    await first;
    await host.stop();
  }, 3_000);

  it("a refused re-entry does not reset the in-flight turn's buffer", async () => {
    const s = fakeSession();
    const host = hostFor(s);
    await host.start();
    const first = host.runTask("one");
    s.emit({ type: "assistant", n: 1 });
    await expect(host.runTask("two")).rejects.toThrow();
    // If the refused call had reached turnBuffer.reset() before throwing, a follower attaching NOW would
    // be replayed nothing — exactly the "replayed zero messages" regression the review demonstrated live.
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.n)).toEqual([1]);
    s.finishAll();
    await first;
    await host.stop();
  }, 3_000);

  it("once the first turn ends, a new call is accepted normally", async () => {
    const s = fakeSession();
    const host = hostFor(s);
    await host.start();
    const first = host.runTask("one");
    s.finishAll();
    await first;
    const second = host.runTask("two");
    s.finishAll();
    await expect(second).resolves.toBeUndefined();
    await host.stop();
  }, 3_000);
});
