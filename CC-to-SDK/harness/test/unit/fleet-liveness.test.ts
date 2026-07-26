import { describe, it, expect } from "vitest";
import { procStartOf, isPidLive, socketAnswers } from "../../src/fleet/liveness.js";

const ps = (out: string | undefined) => ({ procStartOf: async () => out });

// Records the argv/env procStartOf would have spawned, so no test ever runs a real `ps`.
function spy(stdout: string | Error) {
  const seen: { file?: string; args?: string[]; env?: NodeJS.ProcessEnv } = {};
  const run = async (file: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    Object.assign(seen, { file, args, env: opts.env });
    if (stdout instanceof Error) throw stdout;
    return { stdout };
  };
  return { seen, deps: { run } };
}

describe("procStartOf", () => {
  it("asks ps under LC_ALL=C TZ=UTC — a locale/zone-formatted lstart silently fails the string compare", async () => {
    // Not cosmetic: an earlier investigation compared a Korean-locale ps value, saw a mismatch, and
    // concluded the whole interop mechanism was fragile. The C locale + UTC IS the contract.
    const { seen, deps } = spy("Sat Jul 25 02:55:52 2026\n");
    expect(await procStartOf(77, deps)).toBe("Sat Jul 25 02:55:52 2026");
    expect(seen.file).toBe("ps");
    expect(seen.args).toEqual(["-o", "lstart=", "-p", "77"]);
    expect(seen.env?.LC_ALL).toBe("C");
    expect(seen.env?.TZ).toBe("UTC");
  });
  it("is undefined when ps prints nothing — no such pid", async () => {
    expect(await procStartOf(77, spy("\n").deps)).toBeUndefined();
  });
  it("is undefined when ps exits non-zero — a numeric exit code IS 'no such pid'", async () => {
    expect(await procStartOf(77, spy(Object.assign(new Error("exit 1"), { code: 1 })).deps)).toBeUndefined();
  });
  it("RETHROWS when the probe itself broke — a ps we could not run, or one the timeout killed", async () => {
    // Neither says anything about the pid; swallowing them as "gone" reports live sessions as dead.
    await expect(procStartOf(77, spy(Object.assign(new Error("spawn ps ENOENT"), { code: "ENOENT" })).deps))
      .rejects.toThrow(/ENOENT/);
    await expect(procStartOf(77, spy(Object.assign(new Error("timed out"), { code: 1, killed: true })).deps))
      .rejects.toThrow(/timed out/);
  });
});

describe("isPidLive", () => {
  it("is live when procStart matches", async () => {
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", ps("Sat Jul 25 02:55:52 2026"))).toBe(true);
  });
  it("is DEAD when procStart differs — the PID-reuse guard", async () => {
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", ps("Sun Jul 26 09:00:00 2026"))).toBe(false);
  });
  it("is dead when the process is gone", async () => {
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", ps(undefined))).toBe(false);
  });
  it("treats a missing stored procStart as live, matching the binary's gB()", async () => {
    expect(await isPidLive(10, undefined, ps("anything"))).toBe(true);
  });
  it("is LIVE when the probe itself breaks — a broken `ps` must not condemn a running session", async () => {
    // `ps` missing from PATH, or killed by the 1s timeout, tells us nothing about the pid. Answering
    // "dead" there projects `error` over a healthy worker and terminates a doperpowers poller early.
    const boom = { procStartOf: async () => { throw Object.assign(new Error("spawn ps ENOENT"), { code: "ENOENT" }); } };
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", boom)).toBe(true);
  });
});

describe("socketAnswers", () => {
  it("is true when connect succeeds", async () => {
    expect(await socketAnswers("/x.sock", { connect: async () => "ok" })).toBe(true);
  });
  it("is true on EBUSY — busy still means alive, as the binary's Jnd() has it", async () => {
    expect(await socketAnswers("/x.sock", { connect: async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); } })).toBe(true);
  });
  it("is false on ENOENT/ECONNREFUSED — a stale socket file", async () => {
    expect(await socketAnswers("/x.sock", { connect: async () => { throw Object.assign(new Error("gone"), { code: "ECONNREFUSED" }); } })).toBe(false);
  });
});
