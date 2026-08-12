// tui/src/externalEditor.ts — Ctrl-X Ctrl-E / Ctrl-G: edit the composer buffer in $EDITOR (CC's
// chat:externalEditor). spawnSync blocks the whole event loop, so Ink cannot repaint while the editor
// owns the terminal — that blocking IS the handoff. Raw mode must be released first or the editor
// inherits a raw stdin and its own keymap breaks; always restored in finally.
//
// THE RULE FOR NEW CALLERS (FSW T12): any caller reachable from the FULLSCREEN renderer must pass `around`
// — the alt-screen guard's `aroundSubprocess` — or the child's own rmcup on exit silently desynchronizes the
// guard from the terminal and the next frame paints over the user's shell scrollback. Wiring it is free on
// the main screen: an unarmed guard's wrapper just runs the child where we stand. The four wired today, all
// through ChatApp's `aroundSubprocess` prop: the composer's ctrl+g / ctrl+x ctrl+e and the plan dialog's
// editor (both `editExternal`), the transcript dump's `v` and `/keybindings` (both `openInEditor`, the
// latter via useChat's `deps.openEditor`).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface EditorIO { spawn?: typeof spawnSync; setRaw?: (on: boolean) => void; editorCmd?: string;
  /** Run once an editor is known to exist, before it is spawned — `/keybindings` writes its starter file here.
   *  Inside `openInEditor` rather than at the call site so that "no editor configured" creates nothing at all. */
  prepare?: () => void;
  /** The O_NONBLOCK repair below, injectable so a test can watch it fire. Defaults to `restoreTtyNonblock`. */
  restoreTty?: () => void;
  /** FSW T12 — WHAT THE CHILD IS RUN INSIDE. On the alternate screen the editor may not paint into a surface
   *  we are about to discard, so the fullscreen callers pass T6's `guard.aroundSubprocess`: rmcup before the
   *  spawn, smcup after it, canon's own asymmetric handoff (L180653-180662, and `wDo`'s enter/exit pair at
   *  L317707/L317719). Absent — classic launches, every test that does not care — means run it where we
   *  stand, which is what a main-screen editor has always done. It wraps the spawn AND the O_NONBLOCK repair,
   *  so nothing can run the loop between the child's exit and that fix. */
  around?: <T>(run: () => T) => T }

// ── restoreTtyNonblock: the fix for a real-TTY deadlock that only a real terminal can produce ────────────
//
// DIAGNOSIS (measured on the built ccx under tmux, deterministic 3/3). O_NONBLOCK is a property of the OPEN
// FILE DESCRIPTION, not of the fd — so a child spawned with stdio "inherit" shares ours, and whatever the
// child leaves it as is what WE get back. Node puts fd 0 in non-blocking mode for its libuv tty watcher; vi
// (like most curses editors) restores the description to BLOCKING when it exits. The moment it did, a
// still-armed libuv tty watcher in our loop issued `read()` on a blocking tty and the MAIN THREAD parked
// inside `uv__stream_io → read()` forever: no event loop, so SIGCHLD was never reaped (the editor stayed a
// zombie), the child's "close" never fired, and the composer sat on `Save and close editor to continue...`
// with the whole app dead. `sample` showed the blocked read; `lsof +fg` showed the tty fds with no NB flag.
//
// Upstream tolerates the blocking fd because it never awaits: its external edit is spawnSync (bundle
// L317767/L317708), each loop iteration rides a keypress, and a read that blocks briefly on a tty the user
// is typing at is invisible. We take the same spawnSync handoff (see `editExternal`) AND repair the flag,
// because the app has tty fds beyond `process.stdin` (fd 11/15 observed) whose watchers we cannot pause.
//
// The repair has to happen in the same synchronous stretch as the editor's return — nothing may run the
// loop in between. perl is the smallest thing that can do it: its inherited stdin IS the same open file
// description, so its fcntl repairs OUR fd 0. Every failure mode (no perl, no tty, spawn throws) is
// swallowed — a missing interpreter must never break an edit that already succeeded.
const NONBLOCK_PERL = "use Fcntl qw(F_GETFL F_SETFL O_NONBLOCK); my $f = fcntl(STDIN, F_GETFL, 0); fcntl(STDIN, F_SETFL, $f | O_NONBLOCK);";

export function restoreTtyNonblock(io: { spawn?: typeof spawnSync; isTTY?: boolean } = {}): void {
  if (!(io.isTTY ?? process.stdin.isTTY)) return;                 // no tty inherited → nothing shared, nothing to repair
  const run = io.spawn ?? spawnSync;
  try { run("/usr/bin/perl", ["-e", NONBLOCK_PERL], { stdio: ["inherit", "ignore", "ignore"] }); } catch { /* no perl / spawn refused */ }
}

/** The editor command as the user configured it, or null when neither variable is set. `||`, not `??`, for the
 *  reason spelled out in `editExternal` below: an exported-but-empty VISUAL/EDITOR means "unset" in every shell. */
const editorArgv = (io: { editorCmd?: string }): string[] | null => {
  const argv = (io.editorCmd || process.env.VISUAL || process.env.EDITOR || "").split(/\s+/).filter(Boolean);
  return argv.length > 0 ? argv : null;
};

/** The name to PRINT for the configured editor, or null when there is none — upstream's `Ox(qV())` pair
 *  (L212975 / L317720), which the plan dialog's ctrl+g row is gated on (`q$b &&`, L501126). Two deliberate
 *  shortfalls, both recorded: `qV` falls back to probing PATH for `code`/`vi`/`nano` when neither VISUAL nor
 *  EDITOR is set (we answer null, and the caller hides the row, which is upstream's own no-editor rendering);
 *  and `Ox` maps the command through an IDE display-name table (`Cursor`, `VS Code`…) that has no client-side
 *  equivalent, so the BASENAME of the command is what we print. `vi -c foo` therefore reads `vi`. */
export function editorDisplayName(io: { editorCmd?: string } = {}): string | null {
  const argv = editorArgv(io);
  return argv ? basename(argv[0]!) : null;
}

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
  const restoreTty = io.restoreTty ?? (() => restoreTtyNonblock());
  const around = io.around ?? (<T,>(run: () => T) => run());
  io.prepare?.();
  try {
    setRaw(false);
    const r = around(() => {
      const out = spawn(cmd, [...args, file], { stdio: "inherit" });
      restoreTty();                                               // BEFORE anything can run the loop — see restoreTtyNonblock
      return out;
    });
    return r.error || r.status !== 0 ? "failed" : "opened";
  } finally { setRaw(true); }
}

/** Round-trip `text` through the user's editor. Returns the edited text (trailing newline stripped),
 *  or null when the editor errored/exited non-zero — the caller keeps the original buffer.
 *
 *  THIS is the form the app uses (ChatComposer's `chat:externalEditor`), and the blocking is deliberate:
 *  see `restoreTtyNonblock` above and the warning on `editExternalAsync` below. A frozen event loop cannot
 *  have a watcher fire mid-edit, which is exactly what makes the handoff safe. The composer pays for the
 *  frozen frame by painting its `Save and close editor to continue...` row and letting Ink flush it BEFORE
 *  calling in (a deferred macrotask), so the row is on screen for the whole edit — upstream's own UX. */
export function editExternal(text: string, io: EditorIO = {}): string | null {
  const spawn = io.spawn ?? spawnSync;
  const restoreTty = io.restoreTty ?? (() => restoreTtyNonblock());
  const setRaw = io.setRaw ?? ((on: boolean) => { try { if (process.stdin.isTTY) process.stdin.setRawMode(on); } catch { /* no tty */ } });
  // One resolver, shared with openInEditor — including its `||`-not-`??` handling of an exported-but-EMPTY
  // VISUAL/EDITOR. That case matters here specifically: an undefined `cmd` makes spawnSync throw
  // ERR_INVALID_ARG_TYPE straight into ink's useInput handler (ChatComposer calls this with no try/catch, so
  // it crashes the whole REPL). The `vi` default is this function's alone — openInEditor deliberately has none.
  const [cmd, ...args] = editorArgv(io) ?? ["vi"];
  const dir = mkdtempSync(join(tmpdir(), "ccx-edit-"));
  const file = join(dir, "PROMPT.md");
  writeFileSync(file, text);
  const around = io.around ?? (<T,>(run: () => T) => run());
  try {
    setRaw(false);
    const r = around(() => {
      const out = spawn(cmd, [...args, file], { stdio: "inherit" });
      // The repair runs on BOTH arms and before either of them, in the same synchronous stretch as the return:
      // nothing else can run the loop between the editor's exit and this line.
      restoreTty();
      return out;
    });
    if (r.error || r.status !== 0) return null;
    try { return readFileSync(file, "utf8").replace(/\n$/, ""); } catch { return null; }   // file deleted / atomic-rename quirk — keep original buffer
  } finally {
    setRaw(true);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup */ }
  }
}

export interface EditorIOAsync extends Omit<EditorIO, "spawn"> { spawn?: typeof spawn }

/** ⚠️ NEVER CALL THIS WITH A REAL INHERITED TTY. It deadlocks the process — deterministically, unrecoverably.
 *
 *  F5 Task 2 (CM8) shipped this form to hold upstream's `Save and close editor to continue...` row while the
 *  editor ran, and a real-TTY verification killed it: awaiting means our event loop is still alive when the
 *  editor exits, and the editor exits having restored the SHARED open file description to blocking mode. The
 *  next libuv tty watcher to fire calls `read()` on it and the main thread never comes back — no SIGCHLD, no
 *  "close" event, no resolve, no repaint, no keys. The full diagnosis is on `restoreTtyNonblock` above.
 *  `suspendInput` is not a defence: it pauses `process.stdin`, and the app has other tty fds whose watchers
 *  it cannot reach. Isolated repros survive; the real app does not (3/3).
 *
 *  The app path is therefore `editExternal` (spawnSync), paint-then-block — upstream's shape, which the plan
 *  review had flagged and we overrode. This function survives for callers with NO inherited terminal: tests
 *  driving an injected `spawn`, and any headless/DI caller whose child does not own fd 0. It is otherwise
 *  `editExternal` verbatim: same argv resolver (incl. `||`-not-`??` for an exported-but-empty VISUAL/EDITOR
 *  and the `vi` default), same temp round-trip, same null-means-keep-the-buffer contract, same raw-mode
 *  discipline. A spawn that never starts (ENOENT) rejects on "error", so that arm returns null too. */
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
