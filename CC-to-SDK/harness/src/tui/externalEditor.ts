// tui/src/externalEditor.ts — Ctrl-X Ctrl-E / Ctrl-G: edit the composer buffer in $EDITOR (CC's
// chat:externalEditor). spawnSync blocks the whole event loop, so Ink cannot repaint while the editor
// owns the terminal — that blocking IS the handoff. Raw mode must be released first or the editor
// inherits a raw stdin and its own keymap breaks; always restored in finally.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EditorIO { spawn?: typeof spawnSync; setRaw?: (on: boolean) => void; editorCmd?: string }

/** Round-trip `text` through the user's editor. Returns the edited text (trailing newline stripped),
 *  or null when the editor errored/exited non-zero — the caller keeps the original buffer. */
export function editExternal(text: string, io: EditorIO = {}): string | null {
  const spawn = io.spawn ?? spawnSync;
  const setRaw = io.setRaw ?? ((on: boolean) => { try { if (process.stdin.isTTY) process.stdin.setRawMode(on); } catch { /* no tty */ } });
  const [cmd, ...args] = (io.editorCmd ?? process.env.VISUAL ?? process.env.EDITOR ?? "vi").split(/\s+/).filter(Boolean);
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
