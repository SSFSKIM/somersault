// test/tui/copyChannels.test.ts — F9 T-MOUSE Task 7: `copyText`/`copyToastText` (research r1-mouse.md
// §2.5's `yP`/`i2n`/`Mts`). Pure — no React, no Ink — DI'd `env`/`platform`/`spawn` exactly like
// `test/unit/copy.test.ts`'s own `copyToClipboard` fixture, with a per-command `behavior` hook added
// because the new chain needs a fallback tool to succeed while its predecessor fails.
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn as realSpawn } from "node:child_process";
import { copyText, copyToastText, type CopyResult } from "../../src/tui/copy.js";

interface Call { cmd: string; args: string[]; stdin: string }

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
/** Always-fails spawn: the fastest way to force `nativeCopy` to `false` without caring which platform's
 *  chain ran (SSH tests, OSC-52-shape tests — none of them are ABOUT the native half). */
const deadSpawn = () => fakeSpawn(() => ({ error: new Error("ENOENT") })).spawn;

const decode = (b64: string): string => Buffer.from(b64, "base64").toString("utf8");

describe("copyText — OSC 52 byte shapes", () => {
  it("plain form: ESC ] 52 ; c ; <b64> BEL, on a terminal with neither $TMUX nor $STY", async () => {
    const r = await copyText("hello", { env: {}, platform: "aix", spawn: deadSpawn() });
    const b64 = Buffer.from("hello", "utf8").toString("base64");
    expect(r.oscBytes).toBe(`\x1b]52;c;${b64}\x07`);
  });

  it("tmux passthrough: ESC Ptmux; + the plain OSC52 with its ESC doubled + ESC \\\\", async () => {
    const r = await copyText("hi", { env: { TMUX: "/tmp/tmux-1000/default,1234,0" }, platform: "aix", spawn: deadSpawn() });
    const b64 = Buffer.from("hi", "utf8").toString("base64");
    const plain = `\x1b]52;c;${b64}\x07`;
    const expected = `\x1bPtmux;${plain.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
    expect(r.oscBytes).toBe(expected);
    // Byte-shape sanity: exactly one doubled ESC pair (the plain form's own single ESC), framed by the DCS
    // open/close, and the OSC body (`]52;c;`) survives untouched inside it.
    expect(r.oscBytes).toBe(`\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`);
  });

  it("screen chunking: DCS-wrapped at the chunk boundary, re-opened per chunk, BEL+ST terminated", async () => {
    const text = "x".repeat(120);                                 // base64 of 120 bytes is 160 chars — 3 chunks at 76
    const r = await copyText(text, { env: { STY: "12345.pts-0.host" }, platform: "aix", spawn: deadSpawn() });
    const b64 = Buffer.from(text, "utf8").toString("base64");
    expect(b64.length).toBeGreaterThan(152);                        // proves this fixture actually spans >2 chunks
    const chunks: string[] = [];
    for (let i = 0; i < b64.length; i += 76) chunks.push(b64.slice(i, i + 76));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    let expected = "";
    chunks.forEach((chunk, i) => { expected += i === 0 ? `\x1bP\x1b]52;c;${chunk}` : `\x1b\\\x1bP${chunk}`; });
    expected += "\x07\x1b\\";
    expect(r.oscBytes).toBe(expected);
    // The chunk BOUNDARY itself: the first chunk is exactly 76 base64 chars before the re-open sequence.
    expect(r.oscBytes).toContain(`\x1bP\x1b]52;c;${b64.slice(0, 76)}\x1b\\\x1bP${b64.slice(76, 152)}`);
  });

  it("screen: a payload that fits in one chunk still gets the DCS wrap (no spurious re-open)", async () => {
    const r = await copyText("short", { env: { STY: "1.pts-0.host" }, platform: "aix", spawn: deadSpawn() });
    const b64 = Buffer.from("short", "utf8").toString("base64");
    expect(r.oscBytes).toBe(`\x1bP\x1b]52;c;${b64}\x07\x1b\\`);
    expect(r.oscBytes).not.toContain("\x1b\\\x1bP");                // no second chunk was opened
  });

  it("round-trips: decoding the base64 payload out of each channel's own bytes recovers the original text", async () => {
    const text = "grüße 你好";                              // non-ASCII, proves utf8 (not latin1) encoding
    const plain = await copyText(text, { env: {}, platform: "aix", spawn: deadSpawn() });
    const tmux = await copyText(text, { env: { TMUX: "x" }, platform: "aix", spawn: deadSpawn() });
    const screen = await copyText(text, { env: { STY: "x" }, platform: "aix", spawn: deadSpawn() });
    // No `$` anchor: the plain form's BEL IS its last byte, but the tmux passthrough appends its own DCS
    // terminator (`ESC \`) AFTER that BEL, so anchoring to end-of-string would never match the wrapped form.
    const plainB64 = /;([A-Za-z0-9+/=]+)\x07/.exec(plain.oscBytes!)![1]!;
    expect(decode(plainB64)).toBe(text);
    const tmuxB64 = /;([A-Za-z0-9+/=]+)\x07/.exec(tmux.oscBytes!.replace(/\x1b\x1b/g, "\x1b"))![1]!;
    expect(decode(tmuxB64)).toBe(text);
    // screen: reassemble by stripping the DCS framing back out.
    const screenB64 = screen.oscBytes!.replace(/^\x1bP\x1b\]52;c;/, "").replace(/\x1b\\\x1bP/g, "").replace(/\x07\x1b\\$/, "");
    expect(decode(screenB64)).toBe(text);
  });
});

describe("copyText — SSH skips the native spawn but still returns oscBytes", () => {
  it("SSH_CONNECTION set: no spawn call at all, channel demotes to osc52 (no $TMUX)", async () => {
    const { spawn, calls } = fakeSpawn();                          // would succeed if ever called
    const r = await copyText("secret", { env: { SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22" }, platform: "darwin", spawn });
    expect(calls).toEqual([]);
    expect(r.channel).toBe("osc52");
    expect(r.oscBytes).toBe(`\x1b]52;c;${Buffer.from("secret", "utf8").toString("base64")}\x07`);
  });

  it("SSH_CONNECTION set AND $TMUX set: still no spawn, channel is tmux-buffer, oscBytes is the passthrough form", async () => {
    const { spawn, calls } = fakeSpawn();
    const r = await copyText("secret", { env: { SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22", TMUX: "x" }, platform: "darwin", spawn });
    expect(calls).toEqual([]);
    expect(r.channel).toBe("tmux-buffer");
    expect(r.oscBytes).toContain("\x1bPtmux;");
  });

  it("without SSH, the SAME platform/env DOES spawn — proving the skip is SSH-specific, not a platform gap", async () => {
    const { spawn, calls } = fakeSpawn();
    const r = await copyText("secret", { env: {}, platform: "darwin", spawn });
    expect(calls).toEqual([{ cmd: "pbcopy", args: [], stdin: "secret" }]);
    expect(r.channel).toBe("native");
  });
});

describe("copyText — linux PRIMARY spawn is recorded alongside CLIPBOARD", () => {
  it("both selections spawn wl-copy independently when it succeeds", async () => {
    const { spawn, calls } = fakeSpawn();
    const r = await copyText("hi", { env: {}, platform: "linux", spawn });
    expect(calls).toEqual([
      { cmd: "wl-copy", args: [], stdin: "hi" },
      { cmd: "wl-copy", args: ["--primary"], stdin: "hi" },
    ]);
    expect(r.channel).toBe("native");
  });

  it("falls to xclip -selection primary when wl-copy --primary is unavailable, independent of clipboard's own (successful) outcome", async () => {
    // `fakeSpawn`'s `behavior` only sees `cmd`, not `args` — `wl-copy` is invoked twice (once per selection),
    // so this wraps a plain success-everywhere spawn to fail ONLY the invocation that carries `--primary`,
    // proving the two selections are independent attempts rather than "stop once anything has worked".
    const { spawn: ok, calls } = fakeSpawn();
    const wrapped = ((cmd: string, args: string[], opts: unknown) => {
      if (cmd === "wl-copy" && args.includes("--primary")) {
        const child = new EventEmitter() as EventEmitter & { stdin: { end: (t: string) => void } };
        calls.push({ cmd, args, stdin: "" });
        child.stdin = { end: () => queueMicrotask(() => child.emit("error", new Error("ENOENT"))) };
        return child;
      }
      return (ok as unknown as (c: string, a: string[], o: unknown) => unknown)(cmd, args, opts);
    }) as unknown as typeof realSpawn;
    await copyText("hi", { env: {}, platform: "linux", spawn: wrapped });
    expect(calls.map((c) => `${c.cmd} ${c.args.join(" ")}`)).toEqual([
      "wl-copy ",
      "wl-copy --primary",
      "xclip -selection primary",
    ]);
  });
});

describe("copyText — deps.write is an opt-in convenience", () => {
  it("calls deps.write with the same oscBytes it returns, when provided", async () => {
    let written: string | undefined;
    const r = await copyText("hi", { env: {}, platform: "aix", spawn: deadSpawn(), write: (b) => { written = b; } });
    expect(written).toBe(r.oscBytes);
  });
  it("never calls write when the dep is absent — no throw, no side effect", async () => {
    await expect(copyText("hi", { env: {}, platform: "aix", spawn: deadSpawn() })).resolves.toBeDefined();
  });
});

describe("copyToastText — the three verbatim strings, and the <mod> table", () => {
  it("native", () => {
    expect(copyToastText("native", 12, undefined)).toBe("copied 12 chars to clipboard");
  });
  it("tmux-buffer", () => {
    expect(copyToastText("tmux-buffer", 7, undefined)).toBe("copied 7 chars to tmux buffer · paste with prefix + ]");
  });
  it("osc52, Apple_Terminal → Fn", () => {
    expect(copyToastText("osc52", 40, "Apple_Terminal")).toBe(
      "sent 40 chars via OSC 52 · if paste fails, hold Fn while selecting for native copy");
  });
  it("osc52, iTerm.app → Option", () => {
    expect(copyToastText("osc52", 40, "iTerm.app")).toBe(
      "sent 40 chars via OSC 52 · if paste fails, hold Option while selecting for native copy");
  });
  it("osc52, anything else (incl. undefined) → Shift", () => {
    expect(copyToastText("osc52", 40, undefined)).toBe(
      "sent 40 chars via OSC 52 · if paste fails, hold Shift while selecting for native copy");
    expect(copyToastText("osc52", 40, "vscode")).toBe(
      "sent 40 chars via OSC 52 · if paste fails, hold Shift while selecting for native copy");
  });
});

describe("copyText — never rejects", () => {
  it("a fully-dead native chain still resolves with the osc52 fallback, not a throw", async () => {
    const r: CopyResult = await copyText("x", { env: {}, platform: "linux", spawn: deadSpawn() });
    expect(r.channel).toBe("osc52");
    expect(r.oscBytes).not.toBeNull();
  });
});
