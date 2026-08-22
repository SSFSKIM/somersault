// test/unit/copy.test.ts — the pre-Task-7 `copyToClipboard` wrapper (native-only, `Promise<void>`, REJECTS
// on total failure) over F9 T-MOUSE Task 7's rewritten native chain in `copy.ts`. The dual-channel half
// (OSC 52 byte shapes, the toast text, tmux/screen chunking, the SSH skip, `copyText`'s own never-rejects
// contract) is `test/tui/copyChannels.test.ts`'s own scope — this file stays narrowly on `copyToClipboard`,
// which `/copy`/`/export clipboard` fall back to only when no `copyText` dep is injected (every existing
// test for those two commands injects one, so this file is the ONLY place the real chain runs in CI).
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn as realSpawn } from "node:child_process";
import { copyToClipboard } from "../../src/tui/copy.js";

interface Call { cmd: string; args: string[]; stdin: string }

/** A fake `spawn`: returns an EventEmitter'd child whose `.stdin.end(text)` records the call and then (on
 *  the next microtask) emits either "error" or "close" per `behavior(cmd)` — one function rather than one
 *  fixed outcome, so a single fake can make ONE tool in a fallback chain (e.g. `wl-copy`) fail while its
 *  successor (`xclip`) succeeds, which the new multi-tool chain needs to exercise its fallback at all. */
function fakeSpawn(behavior: (cmd: string) => { exitCode?: number; error?: Error } = () => ({})) {
  const calls: Call[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdin: { end: (t: string) => void } };
    const call: Call = { cmd, args, stdin: "" };
    calls.push(call);
    const outcome = behavior(cmd);
    child.stdin = { end: (text: string) => { call.stdin = text; queueMicrotask(() => { outcome.error ? child.emit("error", outcome.error) : child.emit("close", outcome.exitCode ?? 0); }); } };
    return child;
  }) as unknown as typeof realSpawn;
  return { spawn, calls };
}

describe("copyToClipboard (the legacy native-only wrapper)", () => {
  it("darwin spawns pbcopy with the text on stdin", async () => {
    const { spawn, calls } = fakeSpawn();
    await copyToClipboard("hello", { platform: "darwin", spawn });
    expect(calls).toEqual([{ cmd: "pbcopy", args: [], stdin: "hello" }]);
  });

  it("linux tries wl-copy first, for BOTH the clipboard and primary selections independently", async () => {
    const { spawn, calls } = fakeSpawn();
    await copyToClipboard("world", { platform: "linux", spawn });
    expect(calls).toEqual([
      { cmd: "wl-copy", args: [], stdin: "world" },
      { cmd: "wl-copy", args: ["--primary"], stdin: "world" },
    ]);
  });

  it("linux falls to xclip when wl-copy is not installed, once per selection", async () => {
    const { spawn, calls } = fakeSpawn((cmd) => (cmd === "wl-copy" ? { error: new Error("ENOENT") } : {}));
    await copyToClipboard("world", { platform: "linux", spawn });
    expect(calls.map((c) => c.cmd)).toEqual(["wl-copy", "xclip", "wl-copy", "xclip"]);
    expect(calls[1]).toEqual({ cmd: "xclip", args: ["-selection", "clipboard"], stdin: "world" });
    expect(calls[3]).toEqual({ cmd: "xclip", args: ["-selection", "primary"], stdin: "world" });
  });

  it("an unknown platform rejects with a clear message, without spawning anything", async () => {
    const { spawn, calls } = fakeSpawn();
    // was "win32" until win32 became supported (clip.exe) — pick a platform we genuinely have no tool for
    await expect(copyToClipboard("x", { platform: "aix", spawn })).rejects.toThrow(/no working clipboard tool for aix/);
    expect(calls).toEqual([]);
  });

  it("a nonzero exit code from every tool in the chain rejects", async () => {
    const { spawn } = fakeSpawn(() => ({ exitCode: 1 }));
    await expect(copyToClipboard("x", { platform: "darwin", spawn })).rejects.toThrow(/no working clipboard tool for darwin/);
  });

  it("a spawn error (no tool installed anywhere in the chain) rejects with a clear message", async () => {
    const { spawn } = fakeSpawn(() => ({ error: new Error("ENOENT") }));
    await expect(copyToClipboard("x", { platform: "linux", spawn })).rejects.toThrow(/no working clipboard tool for linux/);
  });

  it("spawns clip on win32 (the command is advertised in /help and the shortcuts overlay on every platform)", async () => {
    const { spawn, calls } = fakeSpawn();
    await copyToClipboard("hello", { platform: "win32", spawn });
    expect(calls).toEqual([{ cmd: "clip", args: [], stdin: "hello" }]);
  });

  it("win32 falls to the PowerShell EncodedCommand when clip is not installed", async () => {
    const { spawn, calls } = fakeSpawn((cmd) => (cmd === "clip" ? { error: new Error("ENOENT") } : {}));
    await copyToClipboard("hello", { platform: "win32", spawn });
    expect(calls[0]!.cmd).toBe("clip");
    expect(calls[1]!.cmd).toBe("powershell");
    expect(calls[1]!.args).toContain("-EncodedCommand");
    expect(calls[1]!.stdin).toBe("hello");
  });
});
