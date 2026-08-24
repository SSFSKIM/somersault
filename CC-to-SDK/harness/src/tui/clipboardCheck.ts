// tui/src/clipboardCheck.ts — F10 T-IMGREACH Task 13 (I6): THE PRIVACY SEAM behind the ambient clipboard
// hint. A focus-in edge (or, on a terminal with no DECSET 1004 support, the session's first keypress) must
// answer one yes/no question — "is there an image on the clipboard right now" — without ever materializing
// the clipboard's bytes to decide it. `clipboardImage.ts`'s own reader (`defaultClipboardDeps().exec`) is the
// WRONG tool for that: it buffers 16 MiB of stdout and RETURNS it, because the paste path genuinely needs the
// bytes once the user asked for them. Reusing it here would read the user's clipboard image on every focus-in,
// to answer a question whose only two possible answers are "yes" and "no".
//
// So this module's `run()` resolves an EXIT CODE and nothing else — that is the whole of the guarantee, and
// it lives in the TYPE (`Promise<number>`), not merely in how the one production caller happens to use it:
// there is no channel through which the clipboard's bytes could reach whatever holds this seam. The commands
// themselves are the same per-platform CHECK half `clipboardImage.ts` already dispatches (canon's `uyv`
// quartet, L333974-333977 — `linuxCheckImageCommand`/`windowsCheckImageCommand` are re-exported from there
// rather than re-derived, so the two modules cannot drift on what "checkImage" means); this module supplies
// only the darwin literal (canon hardcodes `osascript` unconditionally, r3 §3) and the discard-everything
// process wrapper.
import { execFile } from "node:child_process";
import { linuxCheckImageCommand, windowsCheckImageCommand } from "./clipboardImage.js";

/** A literal 64 KiB — small on purpose. `defaultClipboardDeps().exec` (clipboardImage.ts) passes 16 MiB
 *  because it returns the image; this seam never reads its own stdout, so the cap exists only to bound a
 *  runaway probe, and a small one doubles as canon's own large-image behaviour: a clipboard image big enough
 *  to blow this buffer never got a chance to print anything meaningful anyway. */
export const CLIPBOARD_CHECK_MAX_BUFFER = 64 * 1024;

/** The whole capability, typed narrow enough that a leak is a compile error, not a review finding: nothing
 *  this interface can express carries clipboard bytes anywhere. */
export interface CheckOnlyProcess {
  run(cmd: string, args: string[]): Promise<number>;
}

/** execFile with stdout/stderr DISCARDED (never read out of the callback) and `CLIPBOARD_CHECK_MAX_BUFFER`.
 *  `execFileImpl` is a DI seam only for the rare case a caller wants a differently-bound `execFile`; every
 *  test in this module's own suite injects a `vi.fn` here instead of spawning a real process. */
export function defaultCheckOnlyProcess(execFileImpl: typeof execFile = execFile): CheckOnlyProcess {
  return {
    run: (cmd, args) => new Promise<number>((resolve) => {
      execFileImpl(cmd, args, { maxBuffer: CLIPBOARD_CHECK_MAX_BUFFER }, (err) => {
        const e = err as (Error & { code?: unknown }) | null;
        resolve(e && typeof e.code === "number" ? e.code : e ? 1 : 0);
      });
    }),
  };
}

/** PLATFORM-DISPATCHED — the deliberate delta from canon (r3 §3), whose own check is hardcoded `osascript`
 *  and therefore de-facto macOS-only. `linux`/`win32` reuse `clipboardImage.ts`'s own CHECK half verbatim
 *  (the `sh -c` wrapper matches how that module already runs the same string); `darwin`'s literal is
 *  `readDarwinImage`'s own probe (clipboardImage.ts:155), transcribed rather than imported since it is one
 *  line with no shared shape to factor out. Any other platform (`freebsd`, …): `null` — nothing to run, and
 *  `hasClipboardImage` below never spawns a process for it. */
export function clipboardCheckCommand(platform: NodeJS.Platform): { cmd: string; args: string[] } | null {
  if (platform === "darwin") return { cmd: "osascript", args: ["-e", "the clipboard as «class PNGf»"] };
  if (platform === "linux") return { cmd: "sh", args: ["-c", linuxCheckImageCommand()] };
  if (platform === "win32") { const [cmd, ...args] = windowsCheckImageCommand(); return { cmd: cmd!, args }; }
  return null;
}

/** canon's own exit-code contract: 0 is "there is an image", anything else — including a probe that could
 *  not even run — is "no". An unsupported platform answers `false` without spawning anything at all. */
export async function hasClipboardImage(platform: NodeJS.Platform, proc: CheckOnlyProcess): Promise<boolean> {
  const command = clipboardCheckCommand(platform);
  if (!command) return false;
  return (await proc.run(command.cmd, command.args)) === 0;
}
