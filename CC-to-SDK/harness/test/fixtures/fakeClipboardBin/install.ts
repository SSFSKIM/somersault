// test/fixtures/fakeClipboardBin/install.ts — F10 T-IMGREACH Task 6 (I5c): installs the xclip/
// wl-paste/powershell fakes (this directory's `xclip`/`wl-paste`/`powershell` POSIX-sh scripts) on a
// PRIVATE, per-call PATH prepend, so `clipboardImage.ts`'s literal `deps.exec("xclip", ...)` /
// `deps.exec("powershell", ...)` calls — resolved through PATH, with `deps.exec` set to the REAL
// `child_process.execFile` — actually run these scripts. This is what makes a test exercise
// PRODUCTION dispatch rather than a mock agreeing with itself (plan-review r2 F-WIN): the fake
// intercepts the literal executable name on any host OS, so a `platform: "win32"` override run on a
// macOS dev machine still proves the Windows arm's argv shape is real, executable PowerShell-shaped
// dispatch, not just a pinned string.
//
// Every mutation this makes — `PATH` and the four `CCX_FAKE_CLIPBOARD_*` env vars — is undone in
// `finally`, including a var that was unset going in (deleted, not left as the literal string
// "undefined"), so concurrent/later tests never observe this call's environment.
import { mkdtemp, rm, copyFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_IMAGES_DIR = join(BIN_DIR, "..", "images");
const FAKE_BINS = ["xclip", "wl-paste", "powershell"] as const;
const ENV_KEYS = ["CCX_FAKE_CLIPBOARD_MIME", "CCX_FAKE_CLIPBOARD_FIXTURE", "CCX_FAKE_CLIPBOARD_LOG"] as const;

export interface FakeClipboardOptions {
  /** The mimetype the xclip/wl-paste probe announces, and the save step's gate (`CCX_FAKE_CLIPBOARD_MIME`).
   *  Unused by the powershell fake, whose probe only checks whether a fixture was supplied at all. */
  mime?: string;
  /** Filename under test/fixtures/images/ the save step streams back as the "clipboard" payload. Omit
   *  to simulate "no image on the clipboard" — every probe fails, matching a genuinely empty clipboard. */
  fixture?: string;
}
export interface FakeClipboardEnv {
  /** Where each RECOGNIZED fake-binary invocation is logged, one line per call (see each script's own
   *  header comment for exactly which shapes it logs). */
  logPath: string;
  /** The private directory prepended to PATH for the duration of the call. */
  dir: string;
}

/** Installs the three fakes on a private PATH, runs `fn`, then restores PATH and every
 *  `CCX_FAKE_CLIPBOARD_*` env var exactly as found — and removes the temp dir, so nothing under
 *  `os.tmpdir()` outlives the call regardless of how `fn` resolves. */
export async function withFakeClipboard<T>(
  opts: FakeClipboardOptions,
  fn: (env: FakeClipboardEnv) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ccx-fake-clipboard-bin-"));
  const originalPath = process.env.PATH;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  const logPath = join(dir, "invocations.log");
  try {
    for (const bin of FAKE_BINS) {
      const dest = join(dir, bin);
      await copyFile(join(BIN_DIR, bin), dest);
      await chmod(dest, 0o755);
    }
    process.env.PATH = `${dir}:${originalPath ?? ""}`;
    if (opts.mime === undefined) delete process.env.CCX_FAKE_CLIPBOARD_MIME;
    else process.env.CCX_FAKE_CLIPBOARD_MIME = opts.mime;
    if (opts.fixture === undefined) delete process.env.CCX_FAKE_CLIPBOARD_FIXTURE;
    else process.env.CCX_FAKE_CLIPBOARD_FIXTURE = join(FIXTURES_IMAGES_DIR, opts.fixture);
    process.env.CCX_FAKE_CLIPBOARD_LOG = logPath;
    return await fn({ logPath, dir });
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
    await rm(dir, { recursive: true, force: true });
  }
}
