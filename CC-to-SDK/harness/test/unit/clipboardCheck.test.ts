// test/unit/clipboardCheck.test.ts — F10 T-IMGREACH Task 13 (I6): THE PRIVACY SEAM. Every assertion here
// pins the ONE invariant `clipboardCheck.ts` exists for — a focus-in edge can ask "is there an image on the
// clipboard" and get back a boolean, with no byte of the clipboard's actual content ever passing through
// this module's own type. `defaultCheckOnlyProcess` is never given a real `execFile` in this suite: every
// cell drives a `vi.fn` shaped exactly like Node's callback, so nothing here spawns a process.
import { describe, it, expect, vi } from "vitest";
import {
  CLIPBOARD_CHECK_MAX_BUFFER, clipboardCheckCommand, defaultCheckOnlyProcess, hasClipboardImage,
  type CheckOnlyProcess,
} from "../../src/tui/clipboardCheck.js";
import { linuxCheckImageCommand, windowsCheckImageCommand } from "../../src/tui/clipboardImage.js";

describe("defaultCheckOnlyProcess — the privacy seam", () => {
  it("I6: the check sets a LITERAL 64 KiB maxBuffer", async () => {
    const spy = vi.fn((cmd, args, opts, cb) => cb(null, "", ""));
    await defaultCheckOnlyProcess(spy as any).run("echo", ["x"]);
    expect(spy.mock.calls[0]![2]).toMatchObject({ maxBuffer: 65536 });
    expect(CLIPBOARD_CHECK_MAX_BUFFER).toBe(65536);
  });

  it("I6: reusing the 16 MiB-buffer executor FAILS this test", async () => {
    // defaultClipboardDeps().exec passes { maxBuffer: 16 * 1024 * 1024 } (clipboardImage.ts:52). Wiring the
    // hint through it must be caught HERE, not in review.
    const spy = vi.fn((cmd, args, opts, cb) => cb(null, "", ""));
    await defaultCheckOnlyProcess(spy as any).run("echo", ["x"]);
    expect((spy.mock.calls[0]![2] as any).maxBuffer).not.toBe(16 * 1024 * 1024);
  });

  it("I6: stdout is IGNORED — a check that prints megabytes still resolves only a code", async () => {
    const spy = vi.fn((cmd, args, opts, cb) => cb(null, "X".repeat(1_000_000), ""));
    await expect(defaultCheckOnlyProcess(spy as any).run("echo", ["x"])).resolves.toBe(0);
    // and the seam's TYPE is `Promise<number>` — there is no channel for the bytes at all
  });

  it("I6: a non-zero exit code (an Error with .code) resolves that code, not 1 unconditionally", async () => {
    const spy = vi.fn((cmd, args, opts, cb) => { const err = new Error("boom") as Error & { code?: number }; err.code = 42; cb(err, "", ""); });
    await expect(defaultCheckOnlyProcess(spy as any).run("echo", ["x"])).resolves.toBe(42);
  });

  it("I6: an error with no numeric .code still resolves a failure code (1)", async () => {
    const spy = vi.fn((cmd, args, opts, cb) => cb(new Error("spawn ENOENT"), "", ""));
    await expect(defaultCheckOnlyProcess(spy as any).run("nope", [])).resolves.toBe(1);
  });
});

describe("clipboardCheckCommand — platform dispatch", () => {
  it("I6: the check is PLATFORM-DISPATCHED, not hardcoded osascript", () => {
    expect(clipboardCheckCommand("darwin")).toEqual({ cmd: "osascript", args: ["-e", "the clipboard as «class PNGf»"] });
    expect(clipboardCheckCommand("linux")).toEqual({ cmd: "sh", args: ["-c", linuxCheckImageCommand()] });
    expect(clipboardCheckCommand("win32")).toEqual({ cmd: windowsCheckImageCommand()[0], args: windowsCheckImageCommand().slice(1) });
    expect(clipboardCheckCommand("freebsd" as NodeJS.Platform)).toBeNull();
  });
});

describe("hasClipboardImage — the exit-code contract", () => {
  it("I6: a non-zero exit is 'no image'; a zero exit is 'image'", async () => {
    const proc = (code: number): CheckOnlyProcess => ({ run: async () => code });
    await expect(hasClipboardImage("darwin", proc(0))).resolves.toBe(true);
    await expect(hasClipboardImage("darwin", proc(1))).resolves.toBe(false);
    await expect(hasClipboardImage("darwin", proc(127))).resolves.toBe(false);
  });

  it("I6: an unsupported platform never spawns anything", async () => {
    const run = vi.fn();
    await expect(hasClipboardImage("freebsd" as NodeJS.Platform, { run })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("I6: dispatches the platform's own command to the injected process", async () => {
    const run = vi.fn(async () => 0);
    await hasClipboardImage("linux", { run });
    expect(run).toHaveBeenCalledWith("sh", ["-c", linuxCheckImageCommand()]);
  });
});
