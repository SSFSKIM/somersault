// tui/src/clipboardImage.ts — F9 T-IMAGE Task 2 (I1): the clipboard image reader + darwin re-encode
// ladder, transcribed from 2.1.236 rather than invented (`/Users/new/claude-code-bundle/2.1.236/cli.pretty.js`,
// spot-verified via `sed -n 'N,Mp'`):
//   · `uyv`  (L333974-333977) the per-platform {checkImage, saveImage} command quartet
//   · `l_t`  (L333994-334031) tier-2 read: checkImage → mkdir 0700 → saveImage → read bytes → rm -f
//   · `kIf`  (L334097-334103) the Ctrl-V text-fallback binary-garbage guard
//   · `jht`  (L231162-231230) canon's resize/quality ladder (sharp-driven) and `v$r = 512000`
//     (L174695), its post-resize byte budget. ccx has no `sharp` dependency, so THIS module's ladder
//     drives macOS's built-in `sips` CLI to the same two limits instead: resample to a 2000px max
//     dimension, then walk JPEG quality 80/60/40/20 until the 512,000-byte ceiling is met.
//
// DI seam: every shell-out goes through `deps.exec` (never invoked directly, never mocked at the
// child_process layer) — this is what lets unit tests drive checkImage/saveImage/sips failures and
// successes deterministically with zero real subprocesses. `deps.platform`/`deps.tmpdir` are likewise
// injected so platform branching and scratch-dir placement are testable without touching `process.*`.
// The ONE real subprocess cell lives in the test file, gated `runIf(darwin)`.
//
// This module is a LEAF: no composer, no transport, no chip minting. Task 3/4 call
// `readClipboardImage`/`reencodeDarwin` from the paste handler and the authoritative turn-input
// builder, respectively; the header-decoding readers and shared budgets now live in
// `../media/imageDims.js` (F10 T-MAINT item 3) and this module is one of their consumers.
//
// F10 T-IMGREACH Task 6 (I5c): darwin's ladder above is a `sips`-specific WORKAROUND for ccx having no
// `sharp` dependency — it is not what canon does, and it is not what Linux/Windows get. Canon itself
// has no `sips` step at all: it resizes platform-independently through `sharp` (r3 §2), so the prior
// Linux BMP refusal and the prior non-darwin oversized-image refusal were both a MISSING FEATURE in
// ccx, not a degradation shared with canon. `../media/imageCodec.js`'s `reencodeImage` (Task 4/5) is
// that platform-independent path: Linux's BMP rescue and BOTH non-darwin platforms' oversized-image
// handling now go through it instead of dead-ending. Deliberately NOT built here (follow-ups, not
// regressions): an opportunistic `magick`/`ffmpeg` rung for either platform, and unifying darwin's
// `sips` ladder onto the same codec so there is only one re-encode path in this file.
import { mkdir, chmod, writeFile, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { tmpdir as osTmpdir } from "node:os";
import { MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET, jpegDimensions, pngDimensions } from "../media/imageDims.js";
import { reencodeImage } from "../media/imageCodec.js";

// ---------------------------------------------------------------------------------------------
// Public result + DI types.

export type ClipboardImageResult =
  | { kind: "image"; data: Buffer; mediaType: string; dimensions: { width: number; height: number } }
  | { kind: "text"; text: string }
  | { kind: "none" }
  | { kind: "failed"; reason: string };

/** The one seam every shell-out in this module goes through. Mirrors `runBash`'s style (bash.ts) but
 *  returns a NEVER-throwing result (`code`, not an exception) — canon's own quartet is exit-code
 *  driven throughout (checkImage's exit 0/1 IS the "is there an image" answer). */
export interface ClipboardDeps {
  exec: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  platform: NodeJS.Platform;
  tmpdir: () => string;
}

/** Real wiring for production callers (Task 3's paste handler). Kept separate from `ClipboardDeps`
 *  itself so every unit test in this module supplies its own fake and never touches a real subprocess. */
export function defaultClipboardDeps(): ClipboardDeps {
  return {
    platform: process.platform,
    tmpdir: () => osTmpdir(),
    exec: (cmd, args) => new Promise((resolve) => {
      execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const e = err as (Error & { code?: unknown }) | null;
        const code = e && typeof e.code === "number" ? e.code : e ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The text-fallback binary-garbage guard, `kIf` verbatim (L334097-334103).

/** A NUL byte anywhere makes the text unpasteable. Otherwise: a prefix shorter than 32 chars can't be
 *  judged (canon's own `t.length < 32` early return), so it passes; otherwise count U+FFFD (the
 *  replacement character Node's UTF-8 decode emits per invalid byte) over the first 4096 chars and
 *  reject when that ratio is STRICTLY greater than 5% — canon's `r / t.length > 0.05`, not `>=`. */
export function isBinaryGarbage(text: string): boolean {
  if (text.includes("\x00")) return true;
  const prefix = text.slice(0, 4096);
  if (prefix.length < 32) return false;
  let replacementCount = 0;
  for (const ch of prefix) if (ch === "�") replacementCount++;
  return replacementCount / prefix.length > 0.05;
}

// ---------------------------------------------------------------------------------------------
// Scratch-dir helpers. A FRESH 0700 dir per call (rather than canon's one fixed shared path) so
// concurrent callers/tests never collide; the whole dir is removed in `finally`, which subsumes
// canon's file-only `rm -f` — nothing is left under tmpdir either way.
async function makeScratchDir(tmpdir: () => string): Promise<string> {
  const dir = join(tmpdir(), `ccx-clipboard-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  return dir;
}
async function removeScratchDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------
// Per-platform command construction. Linux/Windows are exported as pure string/argv builders — per
// the task brief these arms are "unit-tested as strings, not integration-run" (there is no Linux/
// Windows box in this dev loop to verify a live shell pipeline against), so their fidelity is pinned
// by exact-string assertions against canon rather than a mocked round-trip.

/** canon L333974: `xclip TARGETS` piped through the accepted-mimetype grep, falling back to `wl-paste -l`
 *  through the same grep when xclip is absent (`||`, not `&&` — either success is enough). */
export function linuxCheckImageCommand(): string {
  return 'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || '
    + 'wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"';
}
/** Final-review finding 8: single-quote for `sh -c`, POSIX shell style — wrap in `'...'` and escape any
 *  embedded single quote as `'\''` (close the quote, an escaped literal quote, reopen it). The scratch
 *  path this module mints (`makeScratchDir`, a `tmpdir()`-rooted UUID directory) never contains one, but a
 *  redirection target interpolated unquoted is a shell-injection / word-splitting hazard on ANY path with
 *  a space or shell metacharacter regardless of what this module happens to mint today. */
function shQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}
/** canon L333975: PNG first via xclip, PNG via wl-paste, then the BMP rescue arms of both — in that
 *  exact fallback order (`||` chain; the first tool/format that produces bytes wins). */
export function linuxSaveImageCommand(path: string): string {
  const p = shQuote(path);
  return `xclip -selection clipboard -t image/png -o > ${p} 2>/dev/null || `
    + `wl-paste --type image/png > ${p} 2>/dev/null || `
    + `xclip -selection clipboard -t image/bmp -o > ${p} 2>/dev/null || `
    + `wl-paste --type image/bmp > ${p}`;
}
/** canon L333976: a non-interactive STA PowerShell probe of `Clipboard.ContainsImage()`, exiting 1
 *  (canon's checkImage failure signal) when there is none. */
export function windowsCheckImageCommand(): string[] {
  return ["powershell", "-NoProfile", "-NonInteractive", "-Sta", "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 1 }"];
}
/** canon L333976: `Clipboard.GetImage()` saved as PNG to the scratch path. (Canon's own bundle text
 *  drops the save-path argument to `.Save(...)` — a minifier/extraction artifact, not intended
 *  behaviour — so this reconstructs the call with the path actually supplied, which is what makes the
 *  script functional PowerShell rather than a syntax error.) */
export function windowsSaveImageCommand(path: string): string[] {
  const escaped = path.replace(/`/g, "``").replace(/"/g, '`"');
  return ["powershell", "-NoProfile", "-NonInteractive", "-Sta", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); `
    + `if ($null -eq $img) { exit 1 }; $img.Save("${escaped}", [System.Drawing.Imaging.ImageFormat]::Png)`];
}

// ---------------------------------------------------------------------------------------------
// Per-platform image read. Each returns the FINAL ClipboardImageResult once checkImage confirms an
// image is present (success or `failed`, never ambiguous), or `null` to mean "no image — try text".

async function readDarwinImage(deps: ClipboardDeps): Promise<ClipboardImageResult | null> {
  const check = await deps.exec("osascript", ["-e", "the clipboard as «class PNGf»"]);
  if (check.code !== 0) return null;
  const dir = await makeScratchDir(deps.tmpdir);
  const filePath = join(dir, "clipboard.png");
  try {
    // canon's `_y` quoting: backslashes doubled, then the literal quote escaped, inside the AppleScript
    // double-quoted POSIX-file literal.
    const escaped = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const save = await deps.exec("osascript", [
      "-e", "set png_data to (the clipboard as «class PNGf»)",
      "-e", `set fp to open for access POSIX file "${escaped}" with write permission`,
      "-e", "write png_data to fp",
      "-e", "close access fp",
    ]);
    if (save.code !== 0) return { kind: "failed", reason: `clipboard image save failed (osascript exit ${save.code})` };
    const bytes = await readFile(filePath);
    const dimensions = pngDimensions(bytes);
    if (!dimensions) return { kind: "failed", reason: "clipboard image data was not a readable PNG" };
    return { kind: "image", data: bytes, mediaType: "image/png", dimensions };
  } finally {
    await removeScratchDir(dir);
  }
}

async function readLinuxImage(deps: ClipboardDeps): Promise<ClipboardImageResult | null> {
  const check = await deps.exec("sh", ["-c", linuxCheckImageCommand()]);
  if (check.code !== 0) return null;
  const dir = await makeScratchDir(deps.tmpdir);
  const filePath = join(dir, "clipboard.img");
  try {
    const save = await deps.exec("sh", ["-c", linuxSaveImageCommand(filePath)]);
    if (save.code !== 0) return { kind: "failed", reason: `clipboard image save failed (exit ${save.code})` };
    let bytes = await readFile(filePath);
    // BMP rescue: canon reads back the saved bytes and re-encodes through sharp when they're BMP
    // (`s[0]===66 && s[1]===77`, "BM"). ccx's own decoder/encoder (Task 4/5) plays that role now: it
    // decodes the BMP's pixels and re-encodes them as PNG, downscaling to `MAX_DIMENSION`/
    // `POST_PROCESS_BYTE_BUDGET` in the same call — no separate oversized-BMP case to handle.
    const isBmp = bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
    if (isBmp) {
      const re = reencodeImage({ data: bytes, mediaType: "image/bmp" },
        { maxDimension: MAX_DIMENSION, byteBudget: POST_PROCESS_BYTE_BUDGET });
      if (!re.ok) return { kind: "failed", reason: re.reason };
      return { kind: "image", data: re.value.data, mediaType: "image/png", dimensions: re.value.dimensions };
    }
    const dimensions = pngDimensions(bytes);
    if (!dimensions) return { kind: "failed", reason: "clipboard image data was not a readable PNG" };
    return { kind: "image", data: bytes, mediaType: "image/png", dimensions };
  } finally {
    await removeScratchDir(dir);
  }
}

async function readWin32Image(deps: ClipboardDeps): Promise<ClipboardImageResult | null> {
  const check = await deps.exec(windowsCheckImageCommand()[0]!, windowsCheckImageCommand().slice(1));
  if (check.code !== 0) return null;
  const dir = await makeScratchDir(deps.tmpdir);
  const filePath = join(dir, "clipboard.png");
  try {
    const saveCmd = windowsSaveImageCommand(filePath);
    const save = await deps.exec(saveCmd[0]!, saveCmd.slice(1));
    if (save.code !== 0) return { kind: "failed", reason: `clipboard image save failed (exit ${save.code})` };
    const bytes = await readFile(filePath);
    const dimensions = pngDimensions(bytes);
    if (!dimensions) return { kind: "failed", reason: "clipboard image data was not a readable PNG" };
    return { kind: "image", data: bytes, mediaType: "image/png", dimensions };
  } finally {
    await removeScratchDir(dir);
  }
}

// ---------------------------------------------------------------------------------------------
// Text fallback, guarded by `isBinaryGarbage`.
async function readTextFallback(deps: ClipboardDeps): Promise<ClipboardImageResult> {
  const cmd = deps.platform === "darwin" ? { cmd: "pbpaste", args: [] as string[] }
    : deps.platform === "linux" ? { cmd: "sh", args: ["-c", "xclip -selection clipboard -o 2>/dev/null || wl-paste 2>/dev/null"] }
    : deps.platform === "win32" ? { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"] }
    : null;
  if (!cmd) return { kind: "none" };
  const r = await deps.exec(cmd.cmd, cmd.args);
  if (r.code !== 0 || !r.stdout) return { kind: "none" };
  if (isBinaryGarbage(r.stdout)) return { kind: "none" };
  return { kind: "text", text: r.stdout };
}

/** The public entry point: platform image tier → text tier → none. Never throws — any unexpected
 *  exec/fs rejection becomes `{kind:"failed", reason}` rather than an unhandled rejection reaching the
 *  composer's Ctrl-V handler. */
export async function readClipboardImage(deps: ClipboardDeps): Promise<ClipboardImageResult> {
  try {
    const image = deps.platform === "darwin" ? await readDarwinImage(deps)
      : deps.platform === "linux" ? await readLinuxImage(deps)
      : deps.platform === "win32" ? await readWin32Image(deps)
      : null;
    if (image) return image;
    return await readTextFallback(deps);
  } catch (e) {
    return { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------------------------
// The darwin re-encode ladder. `v$r` (canon L174695) is the shared post-resize byte budget; `2000` is
// canon's per-model `image_limits.maxWidth/maxHeight` (canon L8503 — universal across the current
// catalog, so a single constant here is faithful, not a simplification of something that varies).

const JPEG_QUALITY_LADDER = [80, 60, 40, 20];

/** Re-encode an oversized image on darwin via the built-in `sips` CLI: first resample so neither
 *  dimension exceeds `MAX_DIMENSION`, then walk `JPEG_QUALITY_LADDER` until a rung's output is at or
 *  under `POST_PROCESS_BYTE_BUDGET`. Always returns JPEG (the mediaType FLIP, even for a PNG input —
 *  the quality ladder is JPEG-only, matching canon's own `fN`/`jht` fallback shape) with dimensions
 *  RE-MEASURED from the actual re-encoded bytes, never carried over from the input. `null` when even
 *  quality 20 stays over budget — the caller (Task 4's builder) degrades that to a failure text block. */
export async function reencodeDarwin(
  input: { data: Buffer; mediaType: string },
  deps: ClipboardDeps,
): Promise<{ data: Buffer; mediaType: string; dimensions: { width: number; height: number } } | null> {
  const dir = await makeScratchDir(deps.tmpdir);
  try {
    const ext = input.mediaType === "image/jpeg" || input.mediaType === "image/jpg" ? "jpg" : "png";
    const inPath = join(dir, `in.${ext}`);
    await writeFile(inPath, input.data, { mode: 0o600 });

    const resampledPath = join(dir, `resampled.${ext}`);
    const resample = await deps.exec("sips", ["--resampleHeightWidthMax", String(MAX_DIMENSION), inPath, "--out", resampledPath]);
    if (resample.code !== 0) return null;

    for (const quality of JPEG_QUALITY_LADDER) {
      const outPath = join(dir, `q${quality}.jpg`);
      const convert = await deps.exec("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(quality), resampledPath, "--out", outPath]);
      if (convert.code !== 0) continue;
      const bytes = await readFile(outPath);
      if (bytes.length > POST_PROCESS_BYTE_BUDGET) continue;
      const dimensions = jpegDimensions(bytes);
      if (!dimensions) continue; // sips produced something we can't measure — try the next rung
      return { data: bytes, mediaType: "image/jpeg", dimensions };
    }
    return null;
  } finally {
    await removeScratchDir(dir);
  }
}

// ---------------------------------------------------------------------------------------------
// F9 T-IMAGE Task 3 (I2): the paste-time ORCHESTRATION this file's own header handed to the paste
// handler — read, then re-encode when needed, so the composer's Ctrl-V handler makes exactly one call
// and never touches `deps`/the ladder constants itself. This is the only function in the file with an
// opinion about the OUTCOME shape a chip mint reads (`editor.ts`'s `insertImageChip`); everything above
// stays the leaf `readClipboardImage`/`reencodeDarwin` were built as.

/** What Ctrl-V's handler does with the result: mint a ready image chip, mint a failed one (still a chip —
 *  the turn degrades at BUILD time, canon L231262 — never a silent no-op), fall through to the ordinary
 *  text-paste path, or toast. `data` is already base64 — the one encode this module owes its caller, since
 *  `PastedEntry`'s `content` field is base64 by contract (editor.ts). */
export type ClipboardPasteOutcome =
  | { kind: "image"; content: string; mediaType: string; dimensions: { width: number; height: number } }
  | { kind: "image-failed"; reason: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

/** `readClipboardImage` → (oversized? re-encode : pass through) → base64. Darwin keeps its existing
 *  `sips`-driven ladder UNCHANGED, gated the same way as before (only overLimit reaches for it) — the
 *  common darwin case (a normal screenshot) still costs one subprocess round trip, not three, and the
 *  codec is never consulted on that platform. Every OTHER platform now routes every image through
 *  `reencodeImage` (Task 4/5) unconditionally, not only when oversized: that single call handles the
 *  ordinary in-budget case (near-no-op downscale, one encode), the oversized case (the ladder's halving
 *  retries), AND a hostile payload (the codec's own coded failure, e.g. `inflate-overrun`) — there is
 *  no longer a fast path that would hand a not-yet-decoded image straight back unexamined. */
export async function pasteClipboardImage(deps: ClipboardDeps = defaultClipboardDeps()): Promise<ClipboardPasteOutcome> {
  const r = await readClipboardImage(deps);
  if (r.kind === "none") return { kind: "none" };
  if (r.kind === "text") return { kind: "text", text: r.text };
  if (r.kind === "failed") return { kind: "image-failed", reason: r.reason };
  if (deps.platform === "darwin") {
    const overLimit = r.dimensions.width > MAX_DIMENSION || r.dimensions.height > MAX_DIMENSION || r.data.length > POST_PROCESS_BYTE_BUDGET;
    if (!overLimit) return { kind: "image", content: r.data.toString("base64"), mediaType: r.mediaType, dimensions: r.dimensions };
    const re = await reencodeDarwin({ data: r.data, mediaType: r.mediaType }, deps);
    if (!re) return { kind: "image-failed", reason: "image could not be reduced to fit the request size limit" };
    return { kind: "image", content: re.data.toString("base64"), mediaType: re.mediaType, dimensions: re.dimensions };
  }
  const re = reencodeImage({ data: r.data, mediaType: r.mediaType },
    { maxDimension: MAX_DIMENSION, byteBudget: POST_PROCESS_BYTE_BUDGET });
  if (!re.ok) return { kind: "image-failed", reason: re.reason };
  return { kind: "image", content: re.value.data.toString("base64"), mediaType: "image/png", dimensions: re.value.dimensions };
}
