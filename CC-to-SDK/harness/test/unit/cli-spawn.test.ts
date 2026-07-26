import { describe, it, expect, vi } from "vitest";
import { spawnDetached } from "../../src/cli/spawn.js";
import { parseHostArgv } from "../../src/cli/hostMain.js";
import { parseCcx } from "../../src/cli/args.js";

function fakeSpawner() {
  const calls: any[] = [];
  return { calls, spawn: (cmd: string, args: string[], opts: any) => {
    const call = { cmd, args, opts, handlers: {} as Record<string, (e: any) => void> };
    calls.push(call);
    return { pid: 4242, unref: () => { calls.push({ unref: true }); }, on: (ev: string, fn: (e: any) => void) => { call.handlers[ev] = fn; } };
  } };
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
  it("fails loudly against a spawner that cannot unref, rather than skipping the detach", () => {
    // `child.unref?.()` would no-op here: the parent shell then stays held open by a child it believes
    // it detached. unref and the error listener are both mandatory ChildProcess contract, so call them
    // unconditionally and let a stand-in that lacks either one break in the open.
    expect(() => spawnDetached(parseCcx(["--bg", "task"]), { spawn: () => ({ pid: 1, on: () => {} }) as any, rand: () => 0 }))
      .toThrow(/unref is not a function/);
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
  it("marks a spawn without --bg as interactive, in the env and in the child's markers", () => {
    // kind is what gates the host's turn-finalize: an interactive host must NOT be frozen at `done` by
    // its first turn, so a kind that arrives wrong is a session that lies about its state for its whole life.
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--detachable", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_KIND).toBe("interactive");
    const args: string[] = s.calls[0].args;
    expect(args[args.indexOf("--__kind") + 1]).toBe("interactive");
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
  it("forwards --settings as JSON text, because the parser hands it back as an object", () => {
    // parseCcx resolves --settings (inline JSON or a file path) into an OBJECT. Pushed into argv raw it
    // stringifies to "[object Object]" and the child's re-parse throws: a gateway daemon dead at startup.
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "--settings", '{"env":{"A":"1"}}', "task"]), { spawn: s.spawn, rand: () => 0 });
    const args: string[] = s.calls[0].args;
    const forwarded = args[args.indexOf("--settings") + 1];
    expect(forwarded).toBe('{"env":{"A":"1"}}');
    expect(parseCcx(["--bg", "--settings", forwarded, "task"]).config.settings).toEqual({ env: { A: "1" } });
  });
  it("carries the parent's execArgv, so a child forked under a loader can still boot", () => {
    // Under `tsx` the loader lives ONLY in execArgv and process.argv[1] is a .ts file: dropping execArgv
    // leaves bare node, which does not remap our `./x.js` specifiers to .ts, so the child dies at its
    // first relative import — after the parent already printed a success banner nobody can retract.
    const s = fakeSpawner();
    const saved = process.execArgv;
    process.execArgv = ["--import", "tsx"];
    try { spawnDetached(parseCcx(["--bg", "task"]), { spawn: s.spawn, rand: () => 0 }); }
    finally { process.execArgv = saved; }
    const args: string[] = s.calls[0].args;
    expect(args.slice(0, 3)).toEqual(["--import", "tsx", process.argv[1]]);
  });
  it("hands the resolved cwd to the child, so parallel daemons do not share one checkout", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "--cwd", "/tmp/wt-3", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.cwd).toBe("/tmp/wt-3");
    const bare = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "task"]), { spawn: bare.spawn, rand: () => 0 });
    expect(bare.calls[0].opts.cwd).toBe(process.cwd());
  });
  it("reports a failed spawn instead of dying on an unhandled error event", () => {
    // stdio is ignored by design, so exec failure has no other channel — and an 'error' event with no
    // listener THROWS, killing the parent with a stack trace right after its success banner.
    const s = fakeSpawner();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
      const onError = s.calls[0].handlers.error;
      expect(onError).toBeTypeOf("function");
      onError(new Error("spawn ENOENT"));
      expect(err).toHaveBeenCalledWith(expect.stringContaining("00000000"));
      expect(err).toHaveBeenCalledWith(expect.stringContaining("spawn ENOENT"));
    } finally { err.mockRestore(); }
  });
  it("scrubs the parent agent's session variables from the child env", () => {
    // Probe 60: a kind=bg child that inherits CLAUDE_JOB_DIR adopts the PARENT's job. The agents view
    // then renders the parent job's id, name and state, and our session is unfindable by pid,
    // sessionId or name. daemon-spawn.sh runs inside an agent, so this is the production path.
    const s = fakeSpawner();
    const keys = ["CLAUDE_JOB_DIR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION"] as const;
    // Snapshot rather than blank-delete on the way out: these are Claude Code's OWN variables, so a
    // suite run inside a Claude Code session would otherwise strip the real ambient values — from a
    // process.env that vitest workers share across files.
    const saved = keys.map((k) => [k, process.env[k]] as const);
    Object.assign(process.env, { CLAUDE_JOB_DIR: "/x/jobs/475ad71d", CLAUDE_CODE_SESSION_ID: "sid-parent", CLAUDE_CODE_CHILD_SESSION: "1" });
    try {
      spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
      const env = s.calls[0].opts.env;
      expect(env.CLAUDE_JOB_DIR).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
      expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_NAME).toBe("w1");   // our own identity still gets through
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});

describe("parseHostArgv", () => {
  it("reads the markers positionally and re-parses only what follows them", () => {
    const { short, kind, inv } = parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "bg", "--model", "m1", "do the thing"]);
    expect(short).toBe("0a1b2c3d"); expect(kind).toBe("bg");
    expect(inv.config.model).toBe("m1"); expect(inv.prompt).toBe("do the thing");
  });
  it("keeps a flag value and a prompt that happen to repeat a marker word", () => {
    // The value-based filter removed six tokens here instead of four, leaving just ["--model"]: the
    // model value AND the prompt eaten, and the host started on a task nobody asked for.
    const { inv } = parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "bg", "--model", "--__host", "task"]);
    expect(inv.config.model).toBe("--__host"); expect(inv.prompt).toBe("task");
  });
  it("throws on missing markers instead of naming a roster row after a stray token", () => {
    // indexOf(-1) + 1 = 0, so `short` used to become the first token and kind became "--__host" — a
    // defined value that defeats `?? "bg"`, which then skips the bg turn-finalize and strands the poller.
    expect(() => parseHostArgv(["task"])).toThrow(/--__host is internal/);
    expect(() => parseHostArgv(["--model", "m1", "--__kind", "bg"])).toThrow(/--__host is internal/);
  });
  it("rejects a short id that is not 8 lowercase hex", () => {
    expect(() => parseHostArgv(["--__host", "nope", "--__kind", "bg"])).toThrow(/8-hex short id/);
  });
  it("rejects a kind outside bg|interactive", () => {
    expect(() => parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "--model", "m1"])).toThrow(/bg\|interactive/);
  });
  it("reads an optional --__worktree marker positionally, after the kind", () => {
    const { worktree, inv } = parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "bg", "--__worktree", "/repo/.claude/worktrees/wt", "--model", "m1", "task"]);
    expect(worktree).toBe("/repo/.claude/worktrees/wt");
    expect(inv.config.model).toBe("m1"); expect(inv.prompt).toBe("task");
  });
  it("leaves the worktree unset when the marker is absent, without eating the next flag", () => {
    const { worktree, inv } = parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "bg", "--model", "m1", "task"]);
    expect(worktree).toBeUndefined();
    expect(inv.config.model).toBe("m1"); expect(inv.prompt).toBe("task");
  });
  it("rejects a relative --__worktree, because rm refuses to act on one", () => {
    // rmSession throws on a non-absolute worktree, so a row written from a relative marker could never
    // be removed. Refuse it here, where the failure is still visible, not on the row three days later.
    expect(() => parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "bg", "--__worktree", "wt", "task"])).toThrow(/absolute path/);
    expect(() => parseHostArgv(["--__host", "0a1b2c3d", "--__kind", "bg", "--__worktree"])).toThrow(/absolute path/);
  });
  it("forwards the resolved worktree path from the invocation into the markers", () => {
    const s = fakeSpawner();
    const inv = parseCcx(["--bg", "-n", "w1", "task"]);
    inv.worktreePath = "/repo/.claude/worktrees/wt";
    spawnDetached(inv, { spawn: s.spawn, rand: () => 0 });
    const args: string[] = s.calls[0].args;
    expect(args[args.indexOf("--__worktree") + 1]).toBe("/repo/.claude/worktrees/wt");
  });
  it("round-trips the argv spawnDetached builds, markers first", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "--permission-mode", "auto", "-n", "w1", "do it"]), { spawn: s.spawn, rand: () => 0 });
    const args: string[] = s.calls[0].args;
    expect(args[process.execArgv.length]).toBe(process.argv[1]);   // markers start right after the script path
    const { short, kind, inv } = parseHostArgv(args.slice(process.execArgv.length + 1));
    expect(short).toBe("00000000"); expect(kind).toBe("bg");
    expect(inv.config.permissionMode).toBe("auto"); expect(inv.prompt).toBe("do it");
  });
});
