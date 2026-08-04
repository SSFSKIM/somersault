// tui/src/externalEditor.ts — Ctrl-X Ctrl-E / Ctrl-G: edit the composer buffer in $EDITOR (CC's
// chat:externalEditor). spawnSync blocks the whole event loop, so Ink cannot repaint while the editor
// owns the terminal — that blocking IS the handoff. Raw mode must be released first or the editor
// inherits a raw stdin and its own keymap breaks; always restored in finally.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EditorIO { spawn?: typeof spawnSync; setRaw?: (on: boolean) => void; editorCmd?: string;
  /** Run once an editor is known to exist, before it is spawned — `/keybindings` writes its starter file here.
   *  Inside `openInEditor` rather than at the call site so that "no editor configured" creates nothing at all. */
  prepare?: () => void }

/** The editor command as the user configured it, or null when neither variable is set. `||`, not `??`, for the
 *  reason spelled out in `editExternal` below: an exported-but-empty VISUAL/EDITOR means "unset" in every shell. */
const editorArgv = (io: { editorCmd?: string }): string[] | null => {
  const argv = (io.editorCmd || process.env.VISUAL || process.env.EDITOR || "").split(/\s+/).filter(Boolean);
  return argv.length > 0 ? argv : null;
};

/** Open an EXISTING file in the user's editor, in place — no temp round-trip, nothing read back (`/keybindings`,
 *  which hands the user their own `~/.claude/keybindings.json`; the watcher picks the edit up on save). Unlike
 *  `editExternal` there is NO `vi` default: a caller that has a read-only fallback surface must be able to tell
 *  "the user has no editor configured" apart from "the editor ran". Same raw-mode handoff discipline. */
export function openInEditor(file: string, io: EditorIO = {}): "no-editor" | "opened" | "failed" {
  const argv = editorArgv(io);
  if (!argv) return "no-editor";
  const spawn = io.spawn ?? spawnSync;
  const setRaw = io.setRaw ?? ((on: boolean) => { try { if (process.stdin.isTTY) process.stdin.setRawMode(on); } catch { /* no tty */ } });
  const [cmd, ...args] = argv;
  io.prepare?.();
  try {
    setRaw(false);
    const r = spawn(cmd, [...args, file], { stdio: "inherit" });
    return r.error || r.status !== 0 ? "failed" : "opened";
  } finally { setRaw(true); }
}

/** Round-trip `text` through the user's editor. Returns the edited text (trailing newline stripped),
 *  or null when the editor errored/exited non-zero — the caller keeps the original buffer. */
export function editExternal(text: string, io: EditorIO = {}): string | null {
  const spawn = io.spawn ?? spawnSync;
  const setRaw = io.setRaw ?? ((on: boolean) => { try { if (process.stdin.isTTY) process.stdin.setRawMode(on); } catch { /* no tty */ } });
  // One resolver, shared with openInEditor — including its `||`-not-`??` handling of an exported-but-EMPTY
  // VISUAL/EDITOR. That case matters here specifically: an undefined `cmd` makes spawnSync throw
  // ERR_INVALID_ARG_TYPE straight into ink's useInput handler (ChatComposer calls this with no try/catch, so
  // it crashes the whole REPL). The `vi` default is this function's alone — openInEditor deliberately has none.
  const [cmd, ...args] = editorArgv(io) ?? ["vi"];
  const dir = mkdtempSync(join(tmpdir(), "ccx-edit-"));
  const file = join(dir, "PROMPT.md");
  writeFileSync(file, text);
  try {
    setRaw(false);
    const r = spawn(cmd, [...args, file], { stdio: "inherit" });
    if (r.error || r.status !== 0) return null;
    try { return readFileSync(file, "utf8").replace(/\n$/, ""); } catch { return null; }   // file deleted / atomic-rename quirk — keep original buffer
  } finally {
    setRaw(true);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup */ }
  }
}

export interface EditorIOAsync extends Omit<EditorIO, "spawn"> { spawn?: typeof spawn }

/** F5 Task 2 (CM8): the SAME round-trip, awaited instead of blocking. `editExternal` above stops the event
 *  loop for the whole edit, which is why upstream's `Save and close editor to continue...` row could never
 *  paint here — Ink has no chance to repaint between the spawn and the exit. This form yields, so the
 *  composer can hold an `editorInFlight` frame for the duration and drop it on resolve.
 *
 *  Everything else is `editExternal` verbatim: the same argv resolver (including its `||`-not-`??` handling
 *  of an exported-but-empty VISUAL/EDITOR and its `vi` default), the same temp round-trip, the same
 *  null-means-keep-the-buffer contract, and the same raw-mode discipline — released before the child owns
 *  the terminal, restored in the settle path whatever happened. A spawn that never starts (ENOENT) rejects
 *  on "error", so that arm returns null too rather than hanging the in-flight row forever.
 *
 *  Raw mode is NOT the whole handoff for this form, and this function cannot do the rest of it. `spawnSync`
 *  above hands the terminal over by stopping the event loop; awaiting does not, so the harness's own stdin
 *  listener keeps reading fd 0 while the child is on it. The party that owns that listener is the keymap
 *  provider, so the caller wraps this call in its `suspendInput` (KeymapProvider.tsx) — see ChatComposer's
 *  `chat:externalEditor`. The `setRaw` pair here stays for callers with no provider above them. */
export function editExternalAsync(text: string, io: EditorIOAsync = {}): Promise<string | null> {
  const launch = io.spawn ?? spawn;
  const setRaw = io.setRaw ?? ((on: boolean) => { try { if (process.stdin.isTTY) process.stdin.setRawMode(on); } catch { /* no tty */ } });
  const [cmd, ...args] = editorArgv(io) ?? ["vi"];
  const dir = mkdtempSync(join(tmpdir(), "ccx-edit-"));
  const file = join(dir, "PROMPT.md");
  writeFileSync(file, text);
  const finish = (result: string | null): string | null => {
    setRaw(true);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup */ }
    return result;
  };
  return new Promise<string | null>((resolve) => {
    setRaw(false);
    let settled = false;
    const settle = (result: string | null) => { if (settled) return; settled = true; resolve(finish(result)); };
    try {
      const child = launch(cmd, [...args, file], { stdio: "inherit" });
      child.on("error", () => settle(null));
      child.on("close", (code) => {
        if (code !== 0) { settle(null); return; }
        try { settle(readFileSync(file, "utf8").replace(/\n$/, "")); } catch { settle(null); }   // deleted / atomic-rename quirk
      });
    } catch { settle(null); }                                   // a synchronous spawn throw (bad argv shape)
  });
}
