// tui/test/clipboardImage.test.ts — F9 T-IMAGE Task 2 (I1): the clipboard image reader + darwin
// re-encode ladder. Canon citations throughout are `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js`
// (spot-verified via `sed -n 'N,Mp'`, never `grep -o`):
//   · `uyv` (L333974-333977)  the per-platform {checkImage, saveImage} quartet strings
//   · `l_t` (L333994-334031) tier-2 read: checkImage → mkdir 0700 → saveImage → read → rm -f
//   · `kIf` (L334097-334103) the text-fallback binary-garbage guard: NUL byte anywhere, OR (on a
//     ≥32-char prefix of the first 4096 chars) a >5% ratio of U+FFFD replacement characters
//   · `jht`/`fN` (L231162-231273) the resize/quality ladder and its 512,000-byte post-ceiling (`v$r`,
//     L174695); ccx has no `sharp`, so this module's ladder drives macOS's built-in `sips` instead —
//     resample to 2000px max, then JPEG quality 80/60/40/20 until the budget is met.
//
// DI seam: every exec call goes through `deps.exec` — unit tests NEVER shell out to a real
// osascript/sips process. `deps.tmpdir`/`deps.platform` are likewise injected. fs (mkdir/write/read/rm
// on a throwaway scratch dir) is real disk I/O, not a subprocess, so it runs for real even in unit
// tests — the fake `exec` intercepts the darwin quartet's saveImage/sips commands and performs the
// disk write itself (exactly what osascript/sips would have done), which is what lets the ladder's
// SIZE-DRIVEN branching be exercised deterministically.
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  pngDimensions, jpegDimensions, isBinaryGarbage, readClipboardImage, reencodeDarwin,
  linuxCheckImageCommand, linuxSaveImageCommand, windowsCheckImageCommand, windowsSaveImageCommand,
  POST_PROCESS_BYTE_BUDGET, MAX_DIMENSION,
  type ClipboardDeps, type ClipboardImageResult,
} from "../../src/tui/clipboardImage.js";

// ---------------------------------------------------------------------------------------------
// Fixture builders. `solidPng` is copied verbatim (mechanism, not just shape) from probe 113's
// hand-rolled PNG generator — cc-to-sdk/probes/probes/113-image-content-block.ts — the same
// deterministic IHDR/IDAT/IEND-via-zlib approach, so this suite carries no image-library dependency.
function solidPng(r: number, g: number, b: number, size = 64): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 3);
    raw[o] = 0;
    for (let x = 0; x < size; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A minimal but structurally real baseline JPEG: SOI, then one SOF0 segment carrying width/height
// (the thing jpegDimensions actually parses), then filler bytes appended to hit an exact total byte
// length (this is what lets the reencode-ladder tests pin exact sizes on either side of the
// 512,000-byte budget — a single COM segment can't carry that much since its own length field is a
// 16-bit count, so the filler goes AFTER an EOI instead). Not a real photographic JPEG —
// jpegDimensions returns as soon as it finds the SOF0 segment, so nothing after it is ever read.
function fakeJpeg(width: number, height: number, totalLen: number): Buffer {
  const sof = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1 + 3); // marker(2) + len(2) + precision(1) + h(2) + w(2) + numComp(1) + comp(3)
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(11, 2); // length field value INCLUDES itself: 2(len)+1(prec)+2(h)+2(w)+1(numComp)+3(comp1) = 11
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 1; // 1 component
  sof[10] = 1; sof[11] = 0x11; sof[12] = 0; // component id, sampling, quant table
  const soi = Buffer.from([0xff, 0xd8]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const fixedLen = soi.length + sof.length + eoi.length;
  const filler = Buffer.alloc(Math.max(0, totalLen - fixedLen), 0x00);
  return Buffer.concat([soi, sof, eoi, filler]);
}

// ---------------------------------------------------------------------------------------------
describe("pngDimensions — IHDR bytes 16-24", () => {
  it("reads width/height off a real PNG", () => {
    expect(pngDimensions(solidPng(255, 0, 0, 64))).toEqual({ width: 64, height: 64 });
  });
  it("reads distinct width vs height (byte-order sanity — not accidentally transposed)", () => {
    const png = solidPng(1, 2, 3, 64);
    // Rebuild IHDR by hand with 100x50 to catch a width/height swap bug.
    const custom = Buffer.from(png);
    custom.writeUInt32BE(100, 16); // IHDR width
    custom.writeUInt32BE(50, 20);  // IHDR height
    expect(pngDimensions(custom)).toEqual({ width: 100, height: 50 });
  });
  it("returns null on a too-short buffer", () => {
    expect(pngDimensions(Buffer.from([137, 80, 78, 71]))).toBeNull();
  });
  it("returns null when the PNG signature bytes are wrong", () => {
    const bad = Buffer.alloc(32);
    expect(pngDimensions(bad)).toBeNull();
  });
});

describe("jpegDimensions — SOF scan", () => {
  it("reads width/height off a hand-rolled SOF0 segment", () => {
    expect(jpegDimensions(fakeJpeg(320, 240, 200))).toEqual({ width: 320, height: 240 });
  });
  it("returns null on a buffer missing the SOI marker", () => {
    expect(jpegDimensions(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
  it("returns null on a truncated SOI-only buffer with no SOF", () => {
    expect(jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe("isBinaryGarbage — canon kIf, pinned at its exact threshold", () => {
  it("a NUL byte anywhere is garbage regardless of length", () => {
    expect(isBinaryGarbage("ab\u0000cd")).toBe(true);
  });
  it("a prefix under 32 chars is never judged (too short to have a meaningful ratio)", () => {
    // 100% U+FFFD, but only 3 chars — canon's `t.length < 32` short-circuits to false.
    expect(isBinaryGarbage("\uFFFD\uFFFD\uFFFD")).toBe(false);
  });
  it("exactly 5% U+FFFD over a 100-char prefix is NOT garbage — the boundary is strictly >", () => {
    const text = "\uFFFD".repeat(5) + "a".repeat(95);
    expect(text.length).toBe(100);
    expect(isBinaryGarbage(text)).toBe(false);
  });
  it("6% U+FFFD over the same 100-char prefix IS garbage — one char over the line flips it", () => {
    const text = "\uFFFD".repeat(6) + "a".repeat(94);
    expect(text.length).toBe(100);
    expect(isBinaryGarbage(text)).toBe(true);
  });
  it("ordinary printable text is never garbage", () => {
    expect(isBinaryGarbage("hello world, this is plainly printable text over 32 chars")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// A fake `exec` that answers a fixed script of {cmd, args} → result, matched by exact cmd + args[0]
// prefix (osascript's -e args differ call to call). Some entries additionally perform a real disk
// write, standing in for what osascript/sips would have produced on the file they were told to write.
type Call = { cmd: string; args: string[] };
function fakeExec(
  script: (call: Call) => Promise<{ code: number; stdout: string; stderr: string }> | { code: number; stdout: string; stderr: string },
): ClipboardDeps["exec"] {
  return async (cmd, args) => script({ cmd, args });
}
const OK = { code: 0, stdout: "", stderr: "" };
const FAIL = { code: 1, stdout: "", stderr: "" };

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(osTmpdir(), "ccx-clipboardimage-test-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("readClipboardImage — darwin tier-2 quartet (canon uyv/l_t)", () => {
  it("checkImage exit 0 → saveImage writes the file → read it back → kind:image with real dims", async () => {
    const png = solidPng(10, 20, 30, 32);
    const { writeFile } = await import("node:fs/promises");
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => osTmpdir(),
      exec: fakeExec(async (call) => {
        if (call.cmd === "osascript" && call.args[1] === "the clipboard as «class PNGf»") return OK;
        if (call.cmd === "osascript" && call.args.some((a) => a.startsWith("set png_data"))) {
          // Extract the scratch file path osascript was told to write, out of the `open for access
          // POSIX file "<path>"` arg, and actually write the fixture bytes there.
          const openArg = call.args.find((a) => a.includes("open for access POSIX file"))!;
          const m = /POSIX file "([^"]+)"/.exec(openArg)!;
          await writeFile(m[1], png);
          return OK;
        }
        return FAIL;
      }),
    };
    const result = await readClipboardImage(deps);
    expect(result.kind).toBe("image");
    if (result.kind === "image") {
      expect(result.mediaType).toBe("image/png");
      expect(result.dimensions).toEqual({ width: 32, height: 32 });
      expect(result.data.equals(png)).toBe(true);
    }
  });

  it("deletes the scratch file/dir after a successful read (no leftover under tmpdir)", async () => {
    const png = solidPng(1, 1, 1, 16);
    const { writeFile, readdir } = await import("node:fs/promises");
    const before = await readdir(osTmpdir());
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => osTmpdir(),
      exec: fakeExec(async (call) => {
        if (call.cmd === "osascript" && call.args[1] === "the clipboard as «class PNGf»") return OK;
        const openArg = call.args.find((a) => a.includes("open for access POSIX file"));
        if (openArg) { const m = /POSIX file "([^"]+)"/.exec(openArg)!; await writeFile(m[1], png); return OK; }
        return FAIL;
      }),
    };
    await readClipboardImage(deps);
    const after = await readdir(osTmpdir());
    // Any ccx-clipboard-* scratch dir this call created must be gone again.
    expect(after.filter((n) => n.startsWith("ccx-clipboard-")).length)
      .toBe(before.filter((n) => n.startsWith("ccx-clipboard-")).length);
  });

  it("checkImage nonzero exit (no image on clipboard) falls through to the text tier", async () => {
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => osTmpdir(),
      exec: fakeExec(async (call) => {
        if (call.cmd === "osascript" && call.args[1] === "the clipboard as «class PNGf»") return FAIL;
        if (call.cmd === "pbpaste") return { code: 0, stdout: "hello from the text clipboard", stderr: "" };
        return FAIL;
      }),
    };
    const result = await readClipboardImage(deps);
    expect(result).toEqual({ kind: "text", text: "hello from the text clipboard" });
  });

  it("checkImage exit 0 but saveImage fails → kind:failed, not silently none", async () => {
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => osTmpdir(),
      exec: fakeExec(async (call) => {
        if (call.cmd === "osascript" && call.args[1] === "the clipboard as «class PNGf»") return OK;
        return FAIL; // saveImage fails
      }),
    };
    const result = await readClipboardImage(deps);
    expect(result.kind).toBe("failed");
  });

  it("no image and no usable text → kind:none", async () => {
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => osTmpdir(),
      exec: fakeExec(async () => FAIL),
    };
    const result = await readClipboardImage(deps);
    expect(result).toEqual({ kind: "none" });
  });

  it("text tier rejects binary garbage — falls to none rather than pasting garbage", async () => {
    const deps: ClipboardDeps = {
      platform: "darwin",
      tmpdir: () => osTmpdir(),
      exec: fakeExec(async (call) => {
        if (call.cmd === "osascript" && call.args[1] === "the clipboard as «class PNGf»") return FAIL;
        if (call.cmd === "pbpaste") return { code: 0, stdout: "ab\u0000cd", stderr: "" };
        return FAIL;
      }),
    };
    const result: ClipboardImageResult = await readClipboardImage(deps);
    expect(result).toEqual({ kind: "none" });
  });
});

describe("linux/windows command construction — string-only, not integration-run", () => {
  it("linux checkImage matches canon's xclip-then-wl-paste TARGETS grep, verbatim", () => {
    expect(linuxCheckImageCommand()).toBe(
      'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || ' +
      'wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
    );
  });
  it("linux saveImage tries png then bmp across both xclip and wl-paste, in canon's order", () => {
    const cmd = linuxSaveImageCommand("/tmp/x.png");
    expect(cmd).toBe(
      "xclip -selection clipboard -t image/png -o > /tmp/x.png 2>/dev/null || " +
      "wl-paste --type image/png > /tmp/x.png 2>/dev/null || " +
      "xclip -selection clipboard -t image/bmp -o > /tmp/x.png 2>/dev/null || " +
      "wl-paste --type image/bmp > /tmp/x.png",
    );
  });
  it("windows checkImage is a PowerShell Clipboard.ContainsImage probe", () => {
    const cmd = windowsCheckImageCommand();
    expect(cmd[0]).toBe("powershell");
    expect(cmd.join(" ")).toContain("System.Windows.Forms.Clipboard]::ContainsImage()");
  });
  it("windows saveImage saves the Clipboard image as PNG to the given path", () => {
    const cmd = windowsSaveImageCommand("C:\\tmp\\x.png");
    expect(cmd.join(" ")).toContain("[System.Windows.Forms.Clipboard]::GetImage()");
    expect(cmd.join(" ")).toContain("C:\\tmp\\x.png");
    expect(cmd.join(" ")).toContain("ImageFormat]::Png");
  });
});

// ---------------------------------------------------------------------------------------------
describe("reencodeDarwin — sips ladder, resample then JPEG quality 80/60/40/20 to the 512,000 budget", () => {
  it("constants match canon's post-processing budget and per-model dimension ceiling", () => {
    expect(POST_PROCESS_BYTE_BUDGET).toBe(512_000);
    expect(MAX_DIMENSION).toBe(2000);
  });

  it("the type FLIP: a PNG input comes back as image/jpeg with re-measured dimensions", async () => {
    const bigPng = solidPng(200, 30, 40, 40);
    await withScratch(async (dir) => {
      const { writeFile, readFile } = await import("node:fs/promises");
      const deps: ClipboardDeps = {
        platform: "darwin",
        tmpdir: () => dir,
        exec: fakeExec(async (call) => {
          if (call.cmd === "sips" && call.args.includes("--resampleHeightWidthMax")) {
            const outPath = call.args[call.args.indexOf("--out") + 1];
            await writeFile(outPath, bigPng); // "resample" is a no-op copy for this test's fixture
            return OK;
          }
          if (call.cmd === "sips" && call.args.includes("formatOptions")) {
            const quality = Number(call.args[call.args.indexOf("formatOptions") + 1]);
            const outPath = call.args[call.args.indexOf("--out") + 1];
            // First quality tried (80) already fits — proves a single ladder rung is enough when the
            // source is already small; jpegDimensions re-measures from the ACTUAL bytes written.
            const jpeg = fakeJpeg(40, 40, quality === 80 ? 100 : 900_000);
            await writeFile(outPath, jpeg);
            return OK;
          }
          return FAIL;
        }),
      };
      const result = await reencodeDarwin({ data: bigPng, mediaType: "image/png" }, deps);
      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe("image/jpeg"); // the FLIP — input was image/png
      expect(result!.dimensions).toEqual({ width: 40, height: 40 });
      expect(result!.data.length).toBeLessThanOrEqual(POST_PROCESS_BYTE_BUDGET);
    });
  });

  it("walks the full 80/60/40/20 ladder until a rung fits under the budget", async () => {
    const src = solidPng(9, 9, 9, 20);
    await withScratch(async (dir) => {
      const { writeFile } = await import("node:fs/promises");
      const triedQualities: number[] = [];
      const deps: ClipboardDeps = {
        platform: "darwin",
        tmpdir: () => dir,
        exec: fakeExec(async (call) => {
          if (call.cmd === "sips" && call.args.includes("--resampleHeightWidthMax")) {
            const outPath = call.args[call.args.indexOf("--out") + 1];
            await writeFile(outPath, src);
            return OK;
          }
          if (call.cmd === "sips" && call.args.includes("formatOptions")) {
            const quality = Number(call.args[call.args.indexOf("formatOptions") + 1]);
            triedQualities.push(quality);
            const outPath = call.args[call.args.indexOf("--out") + 1];
            // Every rung except the last (20) produces an oversized file; only quality 20 fits.
            const size = quality === 20 ? 400_000 : 600_000;
            await writeFile(outPath, fakeJpeg(20, 20, size));
            return OK;
          }
          return FAIL;
        }),
      };
      const result = await reencodeDarwin({ data: src, mediaType: "image/png" }, deps);
      expect(triedQualities).toEqual([80, 60, 40, 20]);
      expect(result).not.toBeNull();
      expect(result!.data.length).toBe(400_000);
    });
  });

  it("still over budget at quality 20 → null (caller degrades to a failure text block)", async () => {
    const src = solidPng(9, 9, 9, 20);
    await withScratch(async (dir) => {
      const { writeFile } = await import("node:fs/promises");
      const deps: ClipboardDeps = {
        platform: "darwin",
        tmpdir: () => dir,
        exec: fakeExec(async (call) => {
          if (call.cmd === "sips" && call.args.includes("--resampleHeightWidthMax")) {
            const outPath = call.args[call.args.indexOf("--out") + 1];
            await writeFile(outPath, src);
            return OK;
          }
          if (call.cmd === "sips" && call.args.includes("formatOptions")) {
            const outPath = call.args[call.args.indexOf("--out") + 1];
            await writeFile(outPath, fakeJpeg(20, 20, 600_000)); // every rung stays over budget
            return OK;
          }
          return FAIL;
        }),
      };
      const result = await reencodeDarwin({ data: src, mediaType: "image/png" }, deps);
      expect(result).toBeNull();
    });
  });

  it("resample step failing (sips exit nonzero) → null, no quality ladder attempted", async () => {
    await withScratch(async (dir) => {
      const deps: ClipboardDeps = {
        platform: "darwin",
        tmpdir: () => dir,
        exec: fakeExec(async () => FAIL),
      };
      const result = await reencodeDarwin({ data: solidPng(1, 1, 1, 10), mediaType: "image/png" }, deps);
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The one darwin-gated LIVE cell (real osascript, no clipboard fixture is set — this repo never
// arranges the actual macOS clipboard, so exercising this on a dev/CI mac reliably hits the "no
// image" branch): must resolve to none/text and never throw.
describe.runIf(process.platform === "darwin")("live darwin integration", () => {
  it("real osascript against whatever the clipboard holds resolves without throwing", async () => {
    const { execFile } = await import("node:child_process");
    const realExec: ClipboardDeps["exec"] = (cmd, args) => new Promise((resolve) => {
      execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === "number"
          ? (err as unknown as { code: number }).code : err ? 1 : 0;
        resolve({ code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
      });
    });
    const deps: ClipboardDeps = { platform: "darwin", tmpdir: () => osTmpdir(), exec: realExec };
    const result = await readClipboardImage(deps);
    expect(["none", "text", "image", "failed"]).toContain(result.kind);
  });
});
