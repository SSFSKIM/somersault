// test/unit/clipboardImage-codec.test.ts — F10 T-IMGREACH Task 6 (I5c): proves the Task 4/5 codec
// (`../../src/media/imageCodec.js`) is actually REACHED by `pasteClipboardImage`'s Linux and Windows
// dispatch, not merely importable. Every cell here uses `deps.exec` wired to the REAL
// `child_process.execFile` (`defaultClipboardDeps()`, never a hand-rolled fake `exec`) against fake
// `xclip`/`wl-paste`/`powershell` binaries installed on a PRIVATE PATH prepend
// (`../fixtures/fakeClipboardBin/install.ts`) — `deps.platform` is the only override, so what runs is
// production dispatch resolving a literal executable name through PATH, exactly as it would on a real
// Linux or Windows host (plan-review r2 F-WIN: no injected-exec shortcut for Windows — the same
// mechanism proves both non-darwin arms).
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as imageCodec from "../../src/media/imageCodec.js";
import { pasteClipboardImage, defaultClipboardDeps, type ClipboardDeps } from "../../src/tui/clipboardImage.js";
import { pngDimensions, MAX_DIMENSION } from "../../src/media/imageDims.js";
import { withFakeClipboard } from "../fixtures/fakeClipboardBin/install.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");

// ---------------------------------------------------------------------------------------------
describe("I5c — Linux dispatch, through real fake binaries and the real exec", () => {
  it("the Linux branch RESCUES a BMP clipboard — real fake binaries, real exec, real dispatch", async () => {
    await withFakeClipboard({ mime: "image/bmp", fixture: "clipboard-v5.bmp" }, async () => {
      const out = await pasteClipboardImage({ ...defaultClipboardDeps(), platform: "linux" });
      expect(out.kind).toBe("image");
      if (out.kind !== "image") return;
      expect(out.mediaType).toBe("image/png"); // BMP was re-encoded, not refused
      const dims = pngDimensions(Buffer.from(out.content, "base64"));
      expect(dims).toEqual({ width: 64, height: 48 });
    });
  });

  it("the Linux branch RESIZES an oversized PNG instead of refusing it", async () => {
    await withFakeClipboard({ mime: "image/png", fixture: "oversized-3200x1800.png" }, async () => {
      const out = await pasteClipboardImage({ ...defaultClipboardDeps(), platform: "linux" });
      expect(out.kind).toBe("image");
      if (out.kind !== "image") return;
      const dims = pngDimensions(Buffer.from(out.content, "base64"))!;
      expect(dims).toBeTruthy();
      expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(MAX_DIMENSION);
      expect(dims.width).toBeLessThan(3200);
    });
  });

  it("a HOSTILE clipboard image fails with the codec's own reason, and nothing is left behind", async () => {
    await withFakeClipboard({ mime: "image/png", fixture: "bomb.png" }, async () => {
      const out = await pasteClipboardImage({ ...defaultClipboardDeps(), platform: "linux" });
      expect(out.kind).toBe("image-failed");
      if (out.kind !== "image-failed") return;
      expect(out.reason).toMatch(/expands past its declared size/);
    });
    // The scratch dir this run's readLinuxImage minted (`ccx-clipboard-*`) is swept in its own
    // `finally`, regardless of the codec's downstream failure.
    expect(readdirSync(tmpdir()).filter((d) => d.startsWith("ccx-clipboard-"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5c — Windows dispatch, the SAME mechanism, private-PATH fake `powershell`", () => {
  it("the Windows branch takes the same ladder — probe AND save, both real dispatch", async () => {
    await withFakeClipboard({ fixture: "oversized-3200x1800.png" }, async () => {
      const out = await pasteClipboardImage({ ...defaultClipboardDeps(), platform: "win32" });
      expect(out.kind).toBe("image");
      if (out.kind !== "image") return;
      expect(out.mediaType).toBe("image/png");
      const dims = pngDimensions(Buffer.from(out.content, "base64"))!;
      expect(dims).toBeTruthy();
      expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(MAX_DIMENSION);
    });
  });

  it("the Windows PROBE is honoured — no fixture means no image, and the save is never invoked", async () => {
    await withFakeClipboard({ fixture: undefined }, async ({ logPath }) => {
      const out = await pasteClipboardImage({ ...defaultClipboardDeps(), platform: "win32" });
      expect(out.kind).not.toBe("image");
      // Exactly one recognized invocation (the probe) — the powershell fake only logs its
      // `ContainsImage`/`.Save(` shapes, so a second line would mean the save step ran despite the
      // probe reporting no image, and zero lines would mean the probe itself was never dispatched.
      const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      expect(lines).toEqual(["probe"]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5c — darwin is UNCHANGED, and the guard that says so", () => {
  it("darwin still runs osascript and never consults the codec", async () => {
    const codecSpy = vi.spyOn(imageCodec, "reencodeImage");
    const calls: string[] = [];
    const png = readFileSync(join(FIXTURES_DIR, "rgb8-64x48.png"));
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => tmpdir(),
      exec: async (cmd, args) => {
        calls.push(cmd);
        if (cmd === "osascript" && args[1] === "the clipboard as «class PNGf»") return { code: 0, stdout: "", stderr: "" };
        const openArg = args.find((a) => a.includes("open for access POSIX file"));
        if (openArg) {
          const m = /POSIX file "([^"]+)"/.exec(openArg)!;
          const { writeFile } = await import("node:fs/promises");
          await writeFile(m[1], png);
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "" };
      },
    };
    const out = await pasteClipboardImage(deps);
    expect(calls).toContain("osascript");
    expect(calls).not.toContain("sh"); // never took the Linux `sh -c` path
    expect(codecSpy).not.toHaveBeenCalled(); // the codec was never consulted on darwin's fast path
    expect(out.kind).toBe("image");
    if (out.kind === "image") expect(out.mediaType).toBe("image/png");
    codecSpy.mockRestore();
  });
});
