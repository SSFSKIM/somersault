// tui/clearViewport.ts — `/clear`'s screen reset (Wave R task 7, EP-R2). Two measured facts fix its whole
// shape: one from the 2.1.220 bundle (what the payload may contain) and one from Ink's own source (why the
// repaint has to be forced, and by what).
//
// 1. THE PAYLOAD IS VIEWPORT-ONLY, BECAUSE UPSTREAM'S INLINE ARM IS. Upstream keeps two clear sequences and
//    picks between them by screen mode — `Dms`, bundle L177120-177121: `s += a.altScreen ? Rms() : yJr(
//    a.viewportRows)`. `Rms` (L176982) is `h1 + lsr + fI` = `ESC[2J` `ESC[3J` `ESC[H`, and `lsr` is `ESC[3J`
//    (L166402), which erases the terminal's SCROLLBACK — that arm is the ALT-SCREEN one. The inline arm is
//    `yJr` (L176988) = `fI + (YIe + Mps(1)).repeat(rows) + fI` = `ESC[H` + (`ESC[2K` `ESC[1B`) × the viewport
//    height + `ESC[H`: it blanks the viewport's rows one at a time, homes the cursor, and never touches
//    history. `viewportRows` is the whole viewport (`e.viewport.height`, L178442). ccx renders inline and its
//    committed transcript lives in exactly the scrollback `ESC[3J` would destroy, so this is the arm to clone.
// 2. THE REPAINT HAS TO BE FORCED, AND INK'S OWN `writeToStdout` IS THE FORCE. `/clear` changes nothing Ink
//    renders LIVE: the transcript is `<Static>` (already committed to scrollback), so the post-clear frame —
//    composer plus status bar — is byte-identical to the pre-clear one. Both of Ink's dedupes then swallow it.
//    `Instance.onRender` writes the live frame only `if (!hasStaticOutput && output !== this.lastOutput)`
//    (ink.js:132), and a wiped `<Static>` renders `'\n'`, which `hasStaticOutput` (ink.js:103) reads as empty;
//    `Instance.clear()` (ink.js:213-217) is nothing but `this.log.clear()`, which resets log-update's
//    `previousOutput`/`previousLineCount` (log-update.js:20-24) and leaves `this.lastOutput` (assigned at
//    ink.js:135) untouched. So after an erase NOTHING is written and the pane stays blank until the next
//    keystroke changes `output`. That is the P0 this module exists to remove.
//      `writeToStdout` (ink.js:140-155) is `this.log.clear()` → `stdout.write(data)` → `this.log(
//    this.lastOutput)`, and that third call is a render log-update CANNOT skip: its early return is
//    `output === previousOutput` (log-update.js:13) and the `log.clear()` one line earlier just set
//    `previousOutput = ''`. It never consults `Instance.lastOutput`, so Ink's frame dedupe is not in the path
//    at all. Upstream forces the same way and for the same reason — `forceRedraw` (L180978) calls
//    `this.log.forceFullReset()` (L178271) and then `this.onRender()` UNCONDITIONALLY.
//      WHY NOT RE-WRITE THE RECORDED FRAME BYTES OURSELVES, the way task 4's own first-shrink repair does (and
//    which task 4 had left a `prefix`-taking primitive in resizeRepaint.ts for this caller to reuse — measuring
//    our way here retired it, so it is gone). Because `/clear` runs `app.clear()` first (replaceDocument's Static
//    seam) and that zeroes log-update's `previousLineCount`. Re-writing the frame ourselves would leave N rows
//    painted while log-update believes 0 are, so its next render emits `eraseLines(0)` and paints the FOLLOWING
//    frame BELOW ours — a duplicate composer block, the exact residue class this wave exists to delete. Going
//    through `writeToStdout` leaves `previousOutput`/`previousLineCount` describing the screen, which is the same
//    invariant `correctionAfterRepaint` states it depends on.

/** Upstream `yJr` (bundle L176988), byte for byte. `rows` is the viewport height; 0 collapses to a bare home,
 *  which is what a terminal that reports no size deserves. Carries no `ESC[3J` and no `ESC[2J` — a viewport
 *  wipe is all that is being asked for, and both of those reach past it. */
export function eraseViewport(rows: number): string {
  return "\x1b[H" + "\x1b[2K\x1b[1B".repeat(Math.max(0, rows)) + "\x1b[H";
}

/** Upstream `Rms` (bundle L176982) = `h1` + `lsr` + `fI` = `ESC[2J` `ESC[3J` `ESC[H`, byte for byte — the OTHER
 *  arm of note 1, restored by FSW task 8 (spec §A4a/D6) on the axis upstream keeps it on. The `ESC[3J` that makes
 *  this sequence wrong inline is exactly what makes it right on the alternate screen: that screen HAS no
 *  scrollback, so there is nothing for it to destroy, and the alternate screen's own saved lines (which some
 *  emulators keep) are ours to reset. The viewport-erase is the wrong arm there for the mirror reason — it blanks
 *  the frame's rows one at a time and leaves the screen's state describing a paint we are about to replace.
 *    KNOWN GAP, NOT AN OVERSIGHT — CANON CLEARS INSIDE THE SYNC PAIR AND WE DO NOT. In `Dms` (L177106-177121)
 *  the `clearTerminal` op is appended to the SAME string the DECSET 2026 BSU opens and the ESU closes, so
 *  canon's clear is presented atomically with the repaint behind it. In ccx the clear arrives at the output
 *  proxy as a separate, non-recorded write (Ink's `writeToStdout` seam: `log.clear()` → `write(data)` →
 *  `log(lastOutput)`) and only that third write is wrapped — so a fullscreen `/clear` can show the wipe before
 *  the repaint lands. Same class as the m1 divergence recorded on `SYNC_BEGIN` in `chatMain.tsx`, and it is
 *  left to T9 (which owns routing `/clear` through this arm) and T17 (which owns proving it) with eyes open. */
export function clearAltScreen(): string { return "\x1b[2J\x1b[3J\x1b[H"; }

/** Upstream's dispatch, verbatim (`Dms`, L177120-177121: `s += a.altScreen ? Rms() : yJr(a.viewportRows)`). The
 *  mode is the ONLY input that selects the arm; `rows` reaches the inline arm only, because `Rms()` takes none. */
export function screenClear(mode: { altScreen: boolean; rows: number }): string {
  return mode.altScreen ? clearAltScreen() : eraseViewport(mode.rows);
}

/** Ink's `useStdout()` value, narrowed to what the reset reads: the stream (for `isTTY`/`rows`) and the
 *  `writeToStdout` that carries the forced repaint. */
export interface InkStdout { stdout: { isTTY?: boolean; rows?: number } | undefined; write(data: string): void }

/** Wipe the screen and repaint the live frame in one Ink-sanctioned move. Returns whether anything was
 *  written — off a tty there is no viewport to wipe and no cursor addressing to do it with, exactly the gate
 *  the old `process.stdout.isTTY` check applied. `altScreen` defaults to false because every caller that exists
 *  today is a main-screen one; the fullscreen renderer (T9) passes the mode it was constructed with, the same
 *  one-value-decided-once `RendererChoice` the output proxy's `altMode` comes from. */
export function clearViewport(ink: InkStdout, mode?: { altScreen?: boolean }): boolean {
  const out = ink.stdout;
  if (!out?.isTTY) return false;
  ink.write(screenClear({ altScreen: mode?.altScreen ?? false, rows: out.rows ?? 0 }));
  return true;
}
