// tui/src/externalEditor.ts — Ctrl-X Ctrl-E / Ctrl-G: edit the composer buffer in $EDITOR (CC's
// chat:externalEditor). spawnSync blocks the whole event loop, so Ink cannot repaint while the editor
// owns the terminal — that blocking IS the handoff. Raw mode must be released first or the editor
// inherits a raw stdin and its own keymap breaks; always restored in finally.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EditorIO { spawn?: typeof spawnSync; setRaw?: (on: boolean) => void; editorCmd?: string;
  /** Run once an editor is known to exist, before it is spawned — `/keybindings` writes its starter file here.
   *  Inside `openInEditor` rather than at the call site so that "no editor configured" creates nothing at all. */
  prepare?: () => void }

/** The editor command as the user configured it, or null when neither variable is set. `||`, not `??`, for the
 *  reason spelled out in `editExternal` below: an exported-but-empty VISUAL/EDITOR means "unset" in every shell. */
const editorArgv = (io: EditorIO): string[] | null => {
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
  // `||`, not `??`: an exported-but-EMPTY VISUAL/EDITOR means "unset" in every shell, and `??` would
  // accept it — leaving `cmd` undefined so spawnSync throws ERR_INVALID_ARG_TYPE straight into ink's
  // useInput handler (ChatComposer calls this with no try/catch, so that crashes the whole REPL).
  // The destructuring default catches the residue: a whitespace-only value splits to no tokens at all.
  const [cmd = "vi", ...args] = (io.editorCmd || process.env.VISUAL || process.env.EDITOR || "vi").split(/\s+/).filter(Boolean);
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
