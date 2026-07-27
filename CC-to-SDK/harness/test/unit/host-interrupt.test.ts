import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { readRoster } from "../../src/fleet/roster.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-interrupt-"));

/** Mirrors probe 63: interrupting a turn parked at a `tool_use` makes the message stream THROW rather
 *  than return a result — `submit()`'s promise rejects the moment `session.interrupt()` runs, not
 *  before. That's the exact mechanism the "interrupt records a crash" bug rides on: runTask's own catch
 *  fires as a DIRECT side effect of the interrupt SessionHost.interrupt() just issued. */
function fakeSession() {
  let reject: (e: Error) => void = () => {};
  return {
    sessionId: "sid-int",
    submit(_p: string, _onMessage: (m: unknown) => void) {
      return new Promise<unknown>((_resolve, rej) => { reject = rej; });
    },
    dispose: async () => {},
    interrupt: async () => { reject(new Error("Claude Code returned an error result: … stop_reason=tool_use")); },
  };
}

const hostWith = (session: ReturnType<typeof fakeSession>, env: NodeJS.ProcessEnv, kind: "bg" | "interactive" = "bg") =>
  new SessionHost({ short: "12ab34cd", name: "t", cwd: "/tmp", kind, detached: kind === "bg", config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });

describe("SessionHost.interrupt on a background host", () => {
  it("records the roster as `stopped`, not `error`, even though the interrupted turn's own catch fires", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const host = hostWith(fakeSession(), env);
    await host.start();
    const turn = host.runTask("go");
    await host.interrupt();
    // Prove the mechanism actually fired — the turn's own catch really did run, racing the roster write.
    await expect(turn).rejects.toThrow();
    expect(readRoster("12ab34cd", env)?.state).toBe("stopped");
  });

  it("an interactive host's roster is untouched by interrupt (finalize stays background-gated)", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const host = hostWith(fakeSession(), env, "interactive");
    await host.start();
    const turn = host.runTask("go");
    await host.interrupt();
    await expect(turn).rejects.toThrow();
    expect(readRoster("12ab34cd", env)?.state).toBe("working");   // never finalized outside `stop()`
  });
});
