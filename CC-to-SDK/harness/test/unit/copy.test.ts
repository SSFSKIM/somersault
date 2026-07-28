// test/unit/copy.test.ts — clipboard via the platform's own tool, DI'd like bash.ts's runBash: a fake
// `spawn` records the invocation + what was written to stdin instead of touching the real clipboard.
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn as realSpawn } from "node:child_process";
import { copyToClipboard } from "../../src/tui/copy.js";

interface Call { cmd: string; args: string[]; stdin: string }

/** A fake `spawn`: returns an EventEmitter'd child whose `.stdin.end(text)` records the call and then
 *  (on the next microtask) emits either "error" or "close" — mirroring the real child_process contract
 *  closely enough for copyToClipboard's `.on("error"/"close")` handlers. Cast to `typeof realSpawn` (like
 *  spawn.ts's own DI fakes) since the real signature's overloads are wider than this test needs. */
function fakeSpawn(opts: { exitCode?: number; error?: Error } = {}) {
  const calls: Call[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdin: { end: (t: string) => void } };
    const call: Call = { cmd, args, stdin: "" };
    calls.push(call);
    child.stdin = { end: (text: string) => { call.stdin = text; queueMicrotask(() => { opts.error ? child.emit("error", opts.error) : child.emit("close", opts.exitCode ?? 0); }); } };
    return child;
  }) as unknown as typeof realSpawn;
  return { spawn, calls };
}

describe("copyToClipboard", () => {
  it("darwin spawns pbcopy with the text on stdin", async () => {
    const { spawn, calls } = fakeSpawn();
    await copyToClipboard("hello", { platform: "darwin", spawn });
    expect(calls).toEqual([{ cmd: "pbcopy", args: [], stdin: "hello" }]);
  });
  it("linux tries xclip -selection clipboard", async () => {
    const { spawn, calls } = fakeSpawn();
    await copyToClipboard("world", { platform: "linux", spawn });
    expect(calls).toEqual([{ cmd: "xclip", args: ["-selection", "clipboard"], stdin: "world" }]);
  });
  it("an unknown platform rejects with a clear message, without spawning anything", async () => {
    const { spawn, calls } = fakeSpawn();
    await expect(copyToClipboard("x", { platform: "win32", spawn })).rejects.toThrow(/no clipboard tool for win32/);
    expect(calls).toEqual([]);
  });
  it("a nonzero exit code rejects", async () => {
    const { spawn } = fakeSpawn({ exitCode: 1 });
    await expect(copyToClipboard("x", { platform: "darwin", spawn })).rejects.toThrow(/pbcopy exited 1/);
  });
  it("a spawn error (tool not installed) rejects with a clear message", async () => {
    const { spawn } = fakeSpawn({ error: new Error("ENOENT") });
    await expect(copyToClipboard("x", { platform: "linux", spawn })).rejects.toThrow(/xclip unavailable/);
  });
});
