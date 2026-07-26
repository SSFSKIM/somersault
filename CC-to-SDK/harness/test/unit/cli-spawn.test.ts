import { describe, it, expect } from "vitest";
import { spawnDetached } from "../../src/cli/spawn.js";
import { parseCcx } from "../../src/cli/args.js";

function fakeSpawner() {
  const calls: any[] = [];
  return { calls, spawn: (cmd: string, args: string[], opts: any) => { calls.push({ cmd, args, opts }); return { pid: 4242, unref: () => { calls.push({ unref: true }); } }; } };
}

describe("spawnDetached", () => {
  it("returns an 8-hex short id and the exact banner", () => {
    const s = fakeSpawner();
    const r = spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(r.short).toBe("00000000");
    expect(r.banner).toBe("backgrounded · 00000000");
  });
  it("detaches the child and unrefs it so the parent shell can exit", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.detached).toBe(true);
    expect(s.calls[0].opts.stdio).toEqual(["ignore", "ignore", "ignore"]);
    expect(s.calls.some((c) => c.unref)).toBe(true);
  });
  it("passes identity through env, never by writing a registry row", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "-n", "worker-3", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_NAME).toBe("worker-3");
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_KIND).toBe("bg");
  });
  it("defaults the name to the short id when -n is absent", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_NAME).toBe("00000000");
  });
  it("forwards the short id and the task to the child entry point", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "-n", "w1", "do the thing"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].args).toContain("--__host");
    expect(s.calls[0].args).toContain("00000000");
    expect(s.calls[0].args).toContain("do the thing");
  });
  it("forwards the config flags, so the child re-parses the same permission mode", () => {
    // Without this, doperpowers' `--bg --permission-mode auto` worker silently runs on the DEFAULT
    // mode and parks at its first tool. Acceptance 18 dies here.
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "--permission-mode", "auto", "--model", "m1", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    const args: string[] = s.calls[0].args;
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("auto");
    expect(args[args.indexOf("--model") + 1]).toBe("m1");
  });
  it("scrubs the parent agent's session variables from the child env", () => {
    // Probe 60: a kind=bg child that inherits CLAUDE_JOB_DIR adopts the PARENT's job. The agents view
    // then renders the parent job's id, name and state, and our session is unfindable by pid,
    // sessionId or name. daemon-spawn.sh runs inside an agent, so this is the production path.
    const s = fakeSpawner();
    Object.assign(process.env, { CLAUDE_JOB_DIR: "/x/jobs/475ad71d", CLAUDE_CODE_SESSION_ID: "sid-parent", CLAUDE_CODE_CHILD_SESSION: "1" });
    try {
      spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
      const env = s.calls[0].opts.env;
      expect(env.CLAUDE_JOB_DIR).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
      expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_NAME).toBe("w1");   // our own identity still gets through
    } finally {
      delete process.env.CLAUDE_JOB_DIR; delete process.env.CLAUDE_CODE_SESSION_ID; delete process.env.CLAUDE_CODE_CHILD_SESSION;
    }
  });
});
