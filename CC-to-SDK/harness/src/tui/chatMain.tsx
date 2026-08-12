// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { writeSync } from "node:fs";
import { render } from "ink";
import { createAltScreenGuard, createChatTeardown, resolveTerminalName } from "./altScreen.js";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import { UserKeymap } from "./keys/UserKeymap.js";
import { formatIssues, userBindingsPath } from "./keys/userBindings.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import type { InitialResume } from "./commands.js";
import { loadPrefs } from "./prefs.js";
import { selectRenderer } from "./renderer.js";
import { readSettingsFile } from "./settingsFile.js";
import { resolveStatusLineConfig, type StatusLineConfig } from "./statusLine.js";
import type { PromptLatch } from "../hooks/promptLatch.js";
import { turnDurationEnabled } from "./durationRow.js";
import { promptSuggestionEnabled } from "./suggester.js";
import { refreshExampleFiles } from "./placeholder.js";
import { createCursorReports, probeReflow } from "./reflowOracle.js";
import { createResizeRepaint, parkColumn, parkSequence, type FrameWriteInfo } from "./resizeRepaint.js";
import { setTheme } from "./theme.js";
import { createTerminalTitle } from "./terminalTitle.js";

export interface ChatClientOpts {
  socketPath: string;
  client: { kind: "loopback" | "attached"; short?: string };
  cwd: string;
  initialPrompt?: string;
  // Launch-time --resume: useChat's resumeInto owns replay + the adapter's resume op.
  initialResume?: InitialResume;
  // The ONE ordered bootstrap stream (F1 Task 4): persisted disk rows and identified local notices in a
  // single array whose order IS the total order. No parallel `initialLines`/`initialMessages` channel.
  initialEntries?: readonly TranscriptBootstrapEntry[];
  // --permission-mode / --think, threaded so the status bar and Tab ladder start on the REAL mode.
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialEffort?: string; initialOutputStyle?: string; initialShowTurnDuration?: boolean; initialPromptSuggestionEnabled?: boolean; statusLine?: StatusLineConfig; promptLatch?: PromptLatch };
  onDetach?: () => void;
  // Test seam; default builds remoteChatSession(socketPath, { resume }).
  makeSession?: (resume?: string) => ChatSession;
  /** WAVE C TASK 8 (EP-C4a) — `--name`, so the terminal title can say what this session is before the engine
   *  has generated an ai-title for it. Only the foreground launch has one; `ccx attach` does not. */
  name?: string;
  /** FSW T6 (spec §A3, plan review I8) — THE SIGNAL INTERLOCK'S TRANSPORT. `cli/main.ts`'s
   *  SIGINT/SIGTERM/SIGHUP handler exits via `process.exit`, which never runs the `finally` below; anything
   *  that must happen before the process dies registers itself here and the handler drains it
   *  SYNCHRONOUSLY, ahead of `host.stop`. The owner is main, not this module: only one place may own a
   *  signal handler, and the launch that registered all three at :424 is it. ITS PRESENCE IS ALSO THE
   *  DECLARATION (fix round F8): absent means `ccx attach` — no host to stop, no handler at all — and the
   *  alt-screen guard takes those signals itself. */
  beforeExit?: Array<() => void>;
}

// Ink owns a stable stdout identity from initial render. On resume it clears based on stale terminal-relative
// state before replaying its frame, so this boundary suppresses that first synchronous clear only.
export interface ResumeSafeStdout {
  stdout: NodeJS.WriteStream;
  repaint(runInkWrite: () => void): void;
  /** The last live frame Ink painted, erase prefix stripped, or undefined before the first one (W-R t2). */
  lastFrame(): string | undefined;
  /** The column the cursor is parked in, or 0 if it is not parked (W-R t4 — see `parkSequence`). */
  parkedColumn(): number;
  /** W-R t8: how many of Ink's tall-frame chunks (`ink.js:118-122`) have gone out since the screen was last
   *  known to be in sync — 0 meaning log-update's counters still describe what is painted. A COUNT and not a
   *  flag because the recovery must not fire on the very commit whose own frame took the branch, and "did this
   *  commit bump it" is the only question that separates the two.
   *    IT REPORTS CURRENT STATE, NOT HISTORY (t8 review). A RECORDED FRAME WRITE stands it back down by itself:
   *  that write went through log-update, so `previousOutput`/`previousLineCount` describe the screen again and
   *  the zero-byte-close dedupe the recovery exists for cannot happen from here. The first version cleared only
   *  on `screenResynced()`, which made this "a tall chunk was EVER written since the last pager close" — the `?`
   *  overlay, `/help`, `/model` and the launch frame itself were all measured bumping it at 50x8 — and ChatApp's
   *  repaint then fired on a screen it had not prepared and destroyed six live transcript rows. */
  tallWrites(): number;
  /** …and the caller's acknowledgement that it has repainted the viewport from a known state, which also puts
   *  the count back to 0. Nearly redundant in the real path now (the forced repaint rides `writeToStdout`, whose
   *  third call IS a recorded frame write), kept because the acknowledgement is the caller's to make: a repaint
   *  that declined to write (no tty) must leave the count standing, and only the caller knows which it did. */
  screenResynced(): void;
  /** W2 t7 (s2qa2-05) — THE SAME FACT, CAPTURED BEFORE INK CAN ERASE IT. `tallWrites()` reports current state,
   *  and Ink's own SIGWINCH handler (`ink.js:83`, synchronous) runs between the signal and React's passive
   *  effects: on a grow that lets a clipped frame fit again it writes that frame through log-update, which is
   *  both the write that strands the tall surface's header rows and the RECORDED FRAME WRITE that stands the
   *  count down. A consumer reading the count from an effect therefore reads 0 in exactly the case it needs a
   *  1. So ccx's own resize listener — attached before `render()`, and therefore ahead of Ink's — calls
   *  `noteResizeSignal()`, and the recovery reads the latch instead. The stand-down itself is NOT loosened
   *  (`:135`-`:150`, the t8 over-erase); this only moves the READ to before the erasure.
   *    IT SPANS THE SIGNALS OF ONE FLUSH, NOT THE LAST OF THEM (external review, finding C). A drag emits
   *  SIGWINCHes faster than React flushes passive effects, and only the FIRST of a burst can see the tall write
   *  standing — Ink handles each signal synchronously and its fitting frame stands the count down before the
   *  next one arrives. Re-stating the fact at every signal therefore reported `false` to the one effect that
   *  ran for the whole burst. So the observations accumulate; what bounds them is the READ (see below), not a
   *  reset here. */
  noteResizeSignal(): void;
  /** …and it is one-shot: a fact about the signals since the reader last looked, consumed when it looks. THAT
   *  is what keeps the accumulation above from becoming a latch that outlives its burst and fires a viewport
   *  wipe on an ordinary screen (the t8 over-erase): ChatApp consumes on every size it observes, a shrink
   *  included, so nothing survives a flush that saw it. */
  takeTallAtSignal(): boolean;
  /** qa2-09 — how many writes have DETACHED THE SCREEN FROM THE FRAME RECORD: an erase-only write (`log.clear()`,
   *  which is the head of every `<Static>` commit) or Ink's tall-frame `clearTerminal`. Both re-lay everything
   *  above the live frame — the first puts committed transcript in between it and whatever was above it, the
   *  second wipes the screen — and the resize repairs are counts of rows ABOVE the frame, taken earlier. A
   *  COUNT, not a flag, because the only question is whether the screen moved BETWEEN two instants the reader
   *  chooses; nothing here is consumed, so two readers cannot rob each other. */
  detachedWrites(): number;
  /** W-R t4b: the resize correction, applied to the write that would otherwise create residue. Called for every
   *  frame write that carries an erase prefix and has a recorded frame in front of it; whatever it returns is
   *  injected between that prefix and the body, inside the SAME write. Set once, from `runChatClient` — the proxy
   *  is built before the resize machinery exists, which is the only reason this is a setter. */
  setFrameCorrector(fn: (info: FrameWriteInfo) => string): void;
}

/** Ink's erase prefix: `ansiEscapes.eraseLines(n)` is a run of `\x1b[2K` / `\x1b[1A` closed by `\x1b[G`. It is
 *  terminal bookkeeping, not frame content — and `eraseLines(0)` is the empty string, which is why the first frame
 *  of a session (and any frame right after a `log.clear()`) arrives with no prefix at all. */
const INK_ERASE_PREFIX = /^(?:\x1b\[2K|\x1b\[1A|\x1b\[G)+/;

/** Writes that begin their own line: Ink's erase run, and the `clearTerminal` the tall-frame branch opens with.
 *  Everything else would start painting from wherever the park left the cursor, so it gets homed first. */
const INK_WRITE_HEAD = /^(?:\x1b\[2K|\x1b\[1A|\x1b\[G|\x1b\[2J)/;

/** A write that is nothing but escape sequences — no printable cell, so it leaves the cursor exactly where it
 *  found it. The keymap's DECSET 2004 pair and suspend's cursor show/hide are the ones that matter: they arrive
 *  between frames, and treating them like painted output would drop the park until the NEXT frame — which, at
 *  launch, is not until after the first resize, i.e. exactly when the oracle needed it. */
const ESCAPES_ONLY = /^(?:\x1b\[[0-9;?]*[a-zA-Z]|\x1b[78])+$/;

/** The scrollback-erasing head of `ansiEscapes.clearTerminal` (base.js:124), which is `\x1b[2J\x1b[3J\x1b[H` on
 *  every platform but pre-1607 Windows (whose arm is `\x1b[2J\x1b[0f` and has nothing to strip). Matched as this
 *  exact two-escape prefix so only the tall-frame head is ever rewritten and the `\x1b[H` behind it — which Ink
 *  needs, it paints from there — is untouched, as is any `\x1b[3J` occurring later in the chunk as content. */
const CLEAR_SCROLLBACK_HEAD = "\x1b[2J\x1b[3J";

/** FSW T8 (spec §A4a) — DECSET 2026, the SYNCHRONIZED UPDATE pair (canon's mode table L177069,
 *  `SYNCHRONIZED_UPDATE: 2026`). The fullscreen renderer paints through stock log-update with no `<Static>` in
 *  its tree, so every paint is a full-frame erase-and-rewrite and the window between the two halves is the
 *  flicker the renderer is named after ("flicker-free" is canon's own word for it, settings copy L42039). A
 *  terminal that implements 2026 buffers everything between the pair and presents it as one update; one that
 *  does not implements neither escape and ignores both, and the paint is byte-for-byte what it would have been
 *  — which is the recorded divergence in §A4a rather than a fallback to write.
 *    KNOWN BOUNDED DIVERGENCE (plan m1): the pair goes around ONE write, and two of Ink's seams are three.
 *  `writeToStdout` (`ink.js:140`-`:155`) and `writeToStderr` (`:157`-`:171`) are each `log.clear()` →
 *  `write(data)` → `log(lastOutput)`, and only that third call is a recorded frame write — the erase and the
 *  payload go out unwrapped ahead of it, so a paint reached through those seams can tear. `/clear` and every
 *  `console.*` under `patchConsole` (render.js's default, which this app does not turn off) reach them.
 *  RECORDED, NOT FIXED: spanning three writes means holding bytes inside the proxy until a flush condition it
 *  cannot know, and these are user-initiated one-offs rather than the per-keystroke path the wrap exists for. */
const SYNC_BEGIN = "\x1b[?2026h", SYNC_END = "\x1b[?2026l";

export { physicalRows } from "./resizeRepaint.js";   // W-R t4 moved it there; this stays the import site it had

/** FSW T3 FIX ROUND (review C1) — ONE SIGWINCH listener, three things to do, and the order is the contract.
 *  `readers` runs first: those are the two measurements that must see the screen as it stands BEFORE anything
 *  repaints it (`noteResizeSignal` latches whether a tall write is outstanding; `resizeRepaint.onResize`
 *  measures off the last recorded frame). Subscribers run second: today that is ChatApp's size commit, which
 *  synchronously re-renders and therefore WRITES — put ahead of the readers it would destroy their evidence,
 *  put behind Ink's own handler (`ink.js:77`, registered during `render()`) it would arrive after Ink had
 *  already measured the old, taller tree against the new row count and taken the tall-frame branch.
 *  Extracted from `runChatClient` only so that ordering has somewhere to be asserted; it has no other caller. */
export function createResizeChain(readers: () => void): { fire: () => void; subscribe: (cb: () => void) => () => void } {
  const subscribers = new Set<() => void>();
  return {
    fire: () => { readers(); for (const cb of [...subscribers]) cb(); },
    subscribe: (cb) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
  };
}

/** FSW T8: `altMode` is the alternate screen, and it is FIXED PER CONSTRUCTION because the renderer choice is —
 *  `selectRenderer` runs once at boot and a resize never re-runs it (spec §L2.1), so a proxy cannot outlive the
 *  screen it was built for. `runChatClient` has the choice in hand before it builds this (the `selectRenderer`
 *  call precedes the `createResumeSafeStdout` one), so no setter is needed and none is offered: a mode that
 *  could change mid-session would mean a frame recorded under one set of rules and erased under another. */
export function createResumeSafeStdout(stdout: NodeJS.WriteStream, opts: { altMode?: boolean } = {}): ResumeSafeStdout {
  const altMode = opts.altMode === true;
  let suppressNextWrite = false;
  let frame: string | undefined;                 // the last live frame, as painted
  let widthAtPaint = 0;                          // W-R t4b: …and the terminal width it was painted at
  let justErased = false;                        // previous write was erase-only → the next bare write is <Static>
  let dropped: string | undefined;               // …and the frame that erase threw away, for the restore check below
  let parkedCol = 0;                             // W-R t4: where the cursor sits between frames, 0 if nowhere
  let tall = 0;                                  // W-R t8: tall-frame chunks written since the screen was last in sync
  let tallAtSignal = false;                      // W2 t7: …and whether one was outstanding at any SIGWINCH since the last read
  let detached = 0;                              // qa2-09: writes that re-laid the screen above the frame (see `detachedWrites`)
  let corrector: ((info: FrameWriteInfo) => string) | undefined;   // W-R t4b: the resize correction, set by runChatClient
  let rewritten: string | undefined;             // …and the chunk it produced, consumed by the write that made it
  const targetWrite = stdout.write.bind(stdout) as (...args: any[]) => boolean;
  // Five kinds of write reach here and only one of them is the live frame. FRAME writes carry the erase prefix (or
  // none, at first paint) and content: record what remains. ERASE-ONLY writes (`log.clear()`, `Instance.clear()`)
  // leave nothing after the strip — including the ZERO-LENGTH `eraseLines(0)` Ink emits when `previousLineCount` is
  // 0, which is the shape of every launch that bootstraps a <Static> transcript. Those rows are off the screen now,
  // so the recorded frame is DROPPED: nothing is painted, and `lastFrame()` must not claim otherwise. STATIC writes
  // are committed scrollback; ink.js emits them as `log.clear()` → `write(staticOutput)` → `log(output)`, so the
  // bare write immediately after an erase-only one is the scrollback and the one after it is the real frame — which
  // re-records inside the same synchronous burst. After a bare `app.clear()` no frame follows, `lastFrame()` stays
  // undefined, and task 4 erases NOTHING rather than a stale (possibly much taller) frame's worth of live
  // transcript. SUPPRESSED writes never reached the terminal, so they never painted anything. TALL-FRAME writes are
  // ink.js:118-122 — when `outputHeight >= stdout.rows` Ink writes ONE chunk of `ansiEscapes.clearTerminal +
  // this.fullStaticOutput + output`, i.e. the session's entire accumulated scrollback with the frame glued on the
  // end. Nothing in the bytes marks the seam between them, so it is never recorded: adopting it would make
  // `physicalRows` a count over the whole session and task 4's erase would eat the live transcript.
  //   W-R t8 RESYNCHRONIZES HERE, AND DOWNWARD IS THE ONLY DIRECTION AVAILABLE. The frame this branch used to
  // RETAIN is unrelated to what is on screen and can be taller than the new live region, so an erase measured off
  // it is not guaranteed to land on the under-erase side (task 4b's review); `widthAtPaint` goes with it, or the
  // corrector measures a region off a frame that no longer describes the screen and the injected erase walks
  // upward into the replayed scrollback the correction never repaints. What we know AFTER this write is only
  // that the viewport holds this chunk's own bytes and nothing else — not where its frame begins — so the honest
  // record is no frame at all, and `tallWrites` carries the one fact a recovery needs: log-update was bypassed,
  // its counters are stale, and nothing it writes from here on lands where it thinks. ChatApp acts on that when
  // the tall surface comes down; the proxy cannot, because Ink makes NO write to correct (measured live at 60x15:
  // closing the pager emits zero bytes — the post-close frame is byte-identical to the pre-pager one and
  // `log-update.js:13` swallows it).
  //   AND A RECORDED FRAME WRITE PUTS THE COUNT BACK TO 0 (t8 review). The count has to answer "is the screen in
  // that state NOW", not "was it ever". It first cleared only on `screenResynced()`, which made it a history
  // flag: any tall surface bumps it — the `?` overlay, `/help` (twice), `/model` and the launch frame were all
  // measured taking the branch at 50x8 — and nothing but a pager close ever cleared it, so the next pager close
  // fired a viewport wipe over a screen it had not prepared. The reviewer's A/B on the shipped binary destroyed
  // six of six live transcript rows that way (`?` cycled at 60x15, resize to 120x40, three `! echo` markers,
  // ctrl+o — not tall at that size — Escape); with the wipe removed, six of six survived. That same repro was
  // re-run against this line as an A/B (tmux session `wr-t8-fix-crit`): with the clearing removed, 0 of 6 marker
  // rows survived the pager cycle, on screen or in scrollback; with it in, 6 of 6, both. A frame write is the
  // exact answer, because it is exactly what removes the hazard the wipe exists for: it went through log-update,
  // so `previousOutput`/`previousLineCount` describe the screen again and a later close cannot dedupe to zero
  // bytes. THE ACCEPTED TRADE: if an ordinary frame lands between a tall write and the pager close, the close
  // now skips the repaint and any pager rows the new frame's erase did not reach stay on screen. That is the
  // UNDER-erase direction — bounded by the frame's own height, cosmetic, and cleared by the next full repaint —
  // and it is the side to be wrong on. The over-erase direction eats committed transcript that is not in
  // scrollback yet, which is the defect above.
  //   AND THE `ESC[3J` COMES OUT. `clearTerminal` is `\x1b[2J\x1b[3J\x1b[H` (and `\x1b[2J\x1b[0f` on old Windows)
  // — both open with `\x1b[2J`, which no other write Ink makes ever does. `\x1b[2J` blanks the screen Ink is
  // about to paint on, which is all this branch needs; `\x1b[3J` additionally erases the terminal's SCROLLBACK,
  // which is where this app's committed transcript and everything the user had on screen before launch live.
  // Task 7 settled the same point for `/clear` from the 2.1.220 bundle (clearViewport.ts, note 1) and its review
  // measured this branch doing it: marker rows 60 → 0, session `wr-t7-rev-tall2`. Stripping one escape from the
  // prefix is the whole intervention — every other byte, the `fullStaticOutput` replay included, is passed
  // through as Ink wrote it. That replay is LOAD-BEARING and is deliberately not touched: `\x1b[2J` erases the
  // rows above the frame without scrolling them anywhere, so the replay is the only thing that puts the visible
  // transcript back into history. Suppressing it would need the seam we just said the bytes do not carry, and
  // would trade a duplicated transcript for a destroyed one.
  //   WHAT THAT RESIDUAL COSTS, MEASURED (t8 review — the earlier wording understated it). Keeping the replay
  // while `\x1b[3J` no longer wipes history means every tall render APPENDS ONE COMPLETE COPY of the session's
  // accumulated static output to scrollback: counted live in the review, a pane went 88 → 172 → 256 → 340 across three
  // tall renders, and since `fullStaticOutput` only ever grows (ink.js:24, appended at :106/:117, reset only in
  // the constructor at :57) each copy is bigger than the last. At tmux's default `history-limit` of 2000, a
  // 500-line transcript plus four tall renders evicts every real scrollback line the user had. Pre-strip the
  // same sequence destroyed history outright, so this is strictly the better failure — but it is a failure, and
  // the pager re-takes the branch on EVERY keystroke inside it, so it compounds per scroll.
  //   THE CANON CONTEXT FOR BOTH HALVES. Upstream 2.1.220 has NO tall-frame branch at all — no `fullStaticOutput`
  // and no log-update anywhere in the bundle. Its only main-screen full repaint is the IN-PLACE viewport erase
  // `yJr` (L176988, selected at L177121: `s += a.altScreen ? Rms() : yJr(a.viewportRows)`), which blanks the
  // viewport row by row and never touches history; the `2J`+`3J` arm (`Rms`, L176982) is ALT-SCREEN-ONLY. So the
  // strip moves ccx toward canon (no main-screen scrollback erase) while the duplication moves it away (canon
  // replays nothing, because it never cleared the rows in the first place). The real fix is upstream of both:
  // Ink's clear path resetting `fullStaticOutput`, or `<Static>` not accumulating across a static-epoch bump.
  // BOTH NON-FRAME BRANCHES ALSO FORGET THE PARK (W-R t4 review). `parkedCol` claims the cursor is sitting in a
  // row of our own padding; a `\x1b[2J…\x1b[H` or an `eraseLines` run moves it somewhere else entirely, and the
  // proxy is the only thing that knows. Measured on the tall-frame branch: `parkedColumn()` reported 117 while the
  // cursor was at column 20. Three things read that lie, all of them badly — `probeReflow` gets a `colBefore` the
  // cursor is not in, so the reply cannot match and the verdict caches as `"truncate"` for the whole session
  // (permanently disabling the correction; the rarer coincidental match caches a false `"reflow"` on an unmeasured
  // terminal); the exit unpark erases whatever row the cursor is genuinely on; and a following escapes-only write
  // would re-park, padding a row Ink is about to repaint from. Zero means "not parked", which is the truth after
  // either write.
  // AND ONE WRITE THAT LOOKS EXACTLY LIKE <Static> AND IS NOT: INK'S OWN RESTORE (external whole-branch review).
  // `writeToStderr` (`ink.js:157`-`:171`) is `log.clear()` → `stderr.write(data)` → `log(this.lastOutput)`, and
  // `patchConsole` (render.js's default, which this app does not turn off) routes every `console.error` through
  // it. Only the first and third of those touch stdout: the middle write goes to the SEPARATE stderr stream and
  // the proxy never sees it — which is the whole difference from `writeToStdout`, whose visible middle write is
  // what drops the latch there (see the `justErased` note below). So the restore arrives with the latch still up,
  // with NO erase prefix (`log.clear()` just set `previousLineCount = 0`, and `eraseLines(0)` is the empty string)
  // and newline-terminated (`log-update.js:12` appends it) — byte-shaped exactly like a <Static> flush, and skipped
  // as one. The frame the `log.clear()` dropped then never comes back: `lastFrame()` stays undefined, the cursor
  // stays unparked, and the next shrink skips its correction (the under-erase direction — stale rows, no loss).
  //   THE ONE THING THAT SEPARATES THEM IS THE BYTES. A restore re-writes `Instance.lastOutput`, which is the same
  // string the dropped frame was recorded from, so it is byte-identical to it; a <Static> chunk is committed
  // transcript and is not. `dropped` remembers exactly one frame — the one an erase-only write threw away — and any
  // write that is not the restore clears it, so <Static> classification is otherwise untouched. A run of erase-only
  // writes does NOT clear it (`frame` is already undefined by the second, so there is nothing to overwrite it with):
  // that run is Ink's own `repaint()` seam, where the suppressed `log.clear()` is followed by a second erase-only
  // write before the restore, and the frame it dropped is the one still owed back.
  const record = (chunk: unknown): boolean => {
    if (typeof chunk !== "string") return false;
    if (chunk.startsWith("\x1b[2J")) {
      justErased = false; dropped = undefined; parkedCol = 0; frame = undefined; widthAtPaint = 0; tall += 1; detached += 1;
      // …ON THE MAIN SCREEN ONLY (FSW T8, plan m2/D6). Everything the paragraph above argues is an argument
      // about SCROLLBACK: `\x1b[3J` erases it, and inline that is where this app's committed transcript and the
      // user's pre-launch screen live. The alternate screen has no scrollback — that is what it is — so the
      // escape has nothing to destroy there, and canon writes both deliberately: `Rms()` (L176982) is `2J`+`3J`
      // +`H` and L177121 selects it precisely on `altScreen`. The strip is a main-screen rule and it comes off
      // with the main screen. `clearViewport.ts`'s `screenClear` is the same decision on the same axis, for
      // `/clear`'s own payload rather than for Ink's tall-frame head.
      if (!altMode && chunk.startsWith(CLEAR_SCROLLBACK_HEAD)) rewritten = "\x1b[2J" + chunk.slice(CLEAR_SCROLLBACK_HEAD.length);
      return false;
    }
    const prefix = chunk.match(INK_ERASE_PREFIX)?.[0] ?? "";
    const body = chunk.slice(prefix.length);
    if (body === "") { justErased = true; if (frame !== undefined) dropped = frame; frame = undefined; parkedCol = 0; detached += 1; return false; }
    // Ink's log() writes `str + "\n"` and its <Static> chunk ends the same way, so a body that does NOT end in a
    // newline is nobody's frame — it is another consumer of this same stdout (W-R t4: the keymap's DECSET writes,
    // suspend's cursor show/hide). Recording those used to clobber `lastFrame()` with a bare escape sequence, and
    // now would also park the cursor mid-sequence.
    // …and a write that is not a frame BREAKS the erase→static→frame triple, so the `justErased` latch has to
    // fall with it (W-R t7). The triple is emitted inside one synchronous `onRender` and nothing can interleave
    // with it, but `/clear` deliberately writes BETWEEN a `log.clear()` and the frame that follows it — Ink's
    // own `writeToStdout` (`ink.js:140`-`:155`) is `log.clear()` → `write(data)` → `log(this.lastOutput)`.
    // Leaving the latch up there made that forced frame read as <Static> scrollback: not recorded, and the
    // cursor left unparked until the next keystroke, which is exactly when the reflow oracle needs it most.
    if (!body.endsWith("\n")) { justErased = false; dropped = undefined; return false; }
    // …unless it is the restore, in which case those exact bytes ARE back on the screen and the record has to say
    // so: log-update wrote it, so `previousOutput`/`previousLineCount` describe the pane again (`tall = 0` below is
    // the same fact a frame write asserts), and the park has to go back on the frame it was taken off.
    const restore = prefix === "" && justErased && dropped !== undefined && body === dropped;
    if (prefix === "" && justErased && !restore) { justErased = false; dropped = undefined; return false; }
    dropped = undefined;
    // W-R t4b: THE RESIZE CORRECTION IS APPLIED HERE, BECAUSE THIS IS WHERE THE RESIDUE IS CREATED. Ink's prefix
    // erases the previous frame's LOGICAL line count; if that frame has since re-wrapped taller, the rows it no
    // longer covers stay on screen and this body paints below them. Everything the correction needs is exact at
    // this instant and none of it is a prediction about Ink's timing: the depth of Ink's own erase is countable in
    // its prefix (`eraseLines(n)` carries n − 1 `\x1b[1A`s), `frame`/`widthAtPaint` are the previous write's, the
    // park is the one still sitting on screen (a frame write opens with an erase or a column home, so the `foreign`
    // branch above never cleared it), and the width is read live. A frame with no prefix has nothing above it to
    // correct (`eraseLines(0)` is empty — first frame of a session, or the one after a clear), and with no recorded
    // frame there is no measurement to correct FROM, which is the same refusal `lastFrame()` has always meant.
    if (prefix !== "" && frame !== undefined && corrector !== undefined) {
      const seq = corrector({ inkErases: (prefix.match(/\x1b\[1A/g)?.length ?? 0) + 1, prevFrame: frame,
        parkedCol, widthAtPaint, width: stdout.columns ?? 0, rows: stdout.rows ?? 0 });
      if (seq) rewritten = prefix + seq + body;
    }
    justErased = false; frame = body; widthAtPaint = stdout.columns ?? 0; tall = 0;   // …and the screen is back in sync (see above)
    return true;
  };
  // W-R t4: PARK THE CURSOR ON EVERY FRAME. `probeReflow` can only answer when the cursor is past the new right
  // edge, and the new width is not known until SIGWINCH has already fired — so the column has to be chosen in
  // advance, off the CURRENT width, and re-chosen after every paint. The padding is load-bearing, not cosmetic:
  // tmux clamps a reflowing cursor to its line's used cells, so a bare column move on the blank row Ink leaves the
  // cursor on reports column 1 after the drag and tells us nothing (measured). Parking only after a RECORDED frame
  // is equally load-bearing: after an erase-only write Ink's `previousLineCount` is 0, its next write carries no
  // erase prefix, and a parked column would displace that frame sideways.
  const park = (): void => {
    // …AND NOT ON THE ALTERNATE SCREEN (FSW T8, plan m3). The park is padding written into a row of the screen
    // so that a REFLOW carries the cursor with it; the alternate screen does not reflow (no scrollback to reflow
    // out of), and T9 does not construct `createResizeRepaint` there at all — so the one consumer the padding
    // exists for, `probeReflow`, is never built. The frame is fixed-height and owns every row it has, so the
    // padding would be damage rather than merely useless. WHAT ELSE READS THE PARK, AND WHY 0 IS FINE FOR EACH:
    // the exit teardown's unpark is `> 0`-guarded (`altScreen.ts:233`), so it writes nothing; the `foreign`
    // branch below is `parkedCol > 0 && …`, so it goes dark and every non-Ink write passes through unhomed and
    // un-re-parked; and `createChatTeardown`/`createResizeRepaint` both take `parkedColumn` as a reader that has
    // always been allowed to answer 0 (it does, on any non-tty and any terminal under 8 columns).
    if (altMode) return;
    const col = stdout.isTTY ? parkColumn(stdout.columns) : 0;
    if (col > 0) targetWrite(parkSequence(col));
    parkedCol = col;
  };
  const write = ((...args: any[]): boolean => {
    if (!suppressNextWrite) {
      // Ink itself never notices the park (every write it makes opens with a full-line erase or homes the column),
      // but anything else sharing this tty would paint from column 117 — the keymap's DECSET writes and suspend's
      // cursor show/hide both come through here. Home the cursor for those, then put the park back if the write
      // could not have moved it; a write that PAINTS gets no park until the next frame, because padding over what
      // it just printed would erase it.
      // WHAT THIS DOES *NOT* DO, stated because the previous version of this comment claimed otherwise (t4 review):
      // it does not hand an unparked cursor to the shell on ctrl+z. `suspendProcess` and `suspendInput` write only
      // escape sequences (`\x1b[?25h`, `\x1b[?2004l`), so each one is homed, written, and then RE-PARKED by the
      // rule above — the shell inherits the cursor at column 117 on a row of our spaces. That re-park is the same
      // rule the launch sequence depends on (the DECSET pair and the cursor hide are the only writes between the
      // first frame and the first resize; dropping the park for them made the first probe report `colBefore = 0`),
      // so it is not removable from here, and telling the two apart inside the proxy is not possible — the bytes
      // are identical. A live tmux ctrl+z under bash showed no visible damage, so it stays as measured cosmetics
      // rather than a guess at a fix; the EXIT path unparks explicitly (see `runChatClient`'s `finally`).
      const chunk = typeof args[0] === "string" ? args[0] as string : "";
      const foreign = parkedCol > 0 && !INK_WRITE_HEAD.test(chunk);
      if (foreign) { targetWrite("\x1b[G"); parkedCol = 0; }
      const recorded = record(args[0]);
      // ONE CHUNK, ALWAYS (W-R t4b). The correction and Ink's own erase are two halves of one erase run: split
      // across two writes, anything else sharing this tty could land between them.
      const corrected = rewritten; rewritten = undefined;
      // …AND IN ALTMODE THAT ONE CHUNK IS ALSO ONE UPDATE (FSW T8). The wrap goes HERE, at the write, and not
      // one line earlier, for the same reason the correction is applied inside `record` rather than around it:
      // `record` matches `INK_ERASE_PREFIX` against the bytes INK wrote, and a chunk opening on `\x1b[?2026h`
      // matches no erase prefix — the frame would stop being recorded, which is the gate task 4 erases from.
      // It also goes OUTSIDE the injected correction, because that erase is part of the paint it corrects and
      // the two must land in the same update. Only a RECORDED FRAME WRITE is wrapped: `recorded` already draws
      // the line between a paint of the live frame and the erases, <Static> flushes and foreign escapes that
      // are not one, and wrapping those would nest a second update inside the frame write behind them.
      const payload = altMode && recorded ? SYNC_BEGIN + (corrected ?? args[0] as string) + SYNC_END : corrected;
      const wrote = payload === undefined ? targetWrite(...args) : targetWrite(payload, ...args.slice(1));
      if (recorded || (foreign && ESCAPES_ONLY.test(chunk))) park();
      return wrote;
    }
    suppressNextWrite = false;
    const callback = args.find((arg) => typeof arg === "function") as (() => void) | undefined;
    if (callback) queueMicrotask(callback);
    return true;
  }) as NodeJS.WriteStream["write"];
  const stream = new Proxy(stdout, {
    get(target, key) {
      if (key === "write") return write;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as NodeJS.WriteStream;

  return {
    stdout: stream,
    lastFrame() { return frame; },
    parkedColumn() { return parkedCol; },
    tallWrites() { return tall; },
    screenResynced() { tall = 0; },
    noteResizeSignal() { tallAtSignal ||= tall > 0; },   // accumulates over the burst; the READ is what clears it
    takeTallAtSignal() { const was = tallAtSignal; tallAtSignal = false; return was; },
    detachedWrites() { return detached; },
    setFrameCorrector(fn) { corrector = fn; },
    repaint(runInkWrite) {
      suppressNextWrite = true;
      try { runInkWrite(); } finally { suppressNextWrite = false; }
    },
  };
}

/** The Static-clear seam (F1 Task 4). `useChat` must wipe Ink's append-only `<Static>` BEFORE it bumps the
 *  static epoch on a rewind, `/clear` or a real session swap — but `app.clear()` only exists after
 *  `render()` returns, and a launch-time reset (an `initialResume` that lands first) can ask for it before
 *  then. The bridge coalesces every pre-bind request into ONE pending clear and delegates each later one
 *  directly: never dropped, never replayed twice, and never a public `ChatClientOpts` field. */
export interface DeferredClearBridge { clearStaticTranscript(): void; bind(clear: () => void): void }

export function createDeferredClearBridge(): DeferredClearBridge {
  let clearInk: (() => void) | undefined, pendingClear = false;
  return {
    clearStaticTranscript() { if (clearInk) clearInk(); else pendingClear = true; },
    bind(clear) { clearInk = clear; if (pendingClear) { pendingClear = false; clearInk(); } },
  };
}

/** The same shape for TEXT going the other way (F2 task 9): the `~/.claude/keybindings.json` watcher sits above
 *  the tree and has findings to report — at launch, before `useChat` has a transcript at all, and again on every
 *  edit while the REPL runs. `console.error` is not an option (it would corrupt the live Ink frame), so notices
 *  queue here until the transcript binds, then go straight through. Ordered, replayed exactly once. */
export interface NoticeBridge { notify(text: string): void; bind(push: (text: string) => void): void }

export function createNoticeBridge(): NoticeBridge {
  let push: ((text: string) => void) | undefined; const queued: string[] = [];
  return {
    notify(text) { if (push) push(text); else queued.push(text); },
    bind(next) { push = next; for (const text of queued.splice(0)) next(text); },
  };
}

export async function runChatClient(opts: ChatClientOpts): Promise<void> {
  const prefs = loadPrefs();                             // W3 T4: apply a saved theme BEFORE the first render
  if (prefs.theme) setTheme(prefs.theme);
  // FSW T5 (spec §A2): WHICH RENDERER, DECIDED ONCE. Here and nowhere else — this is the only point in the
  // process that has the real TTY, the real env and the prefs file in hand at the same time, and the
  // decision must not move again: a resize never re-evaluates it (§L2.1), so every consumer reads this one
  // value. Today only `/status` does (F9); T8/T9 add the branch that actually mounts a different renderer,
  // which is why nothing below this line changes shape yet.
  const renderer = selectRenderer({ isTTY: Boolean(process.stdout.isTTY), env: process.env, prefs });
  // W3 T5: seed the Settings dialog's Output-style row from the same saved prefs (defaulting like useChat's
  // own opts.initialOutputStyle fallback does) — client-tracked, no engine round-trip needed just to boot.
  // W-C T7: and the `Show turn duration` row from the same read (`Dc("showTurnDuration", !0)` — default TRUE).
  const hookOpts = {
    ...(opts.hookOpts ?? {}),
    initialOutputStyle: opts.hookOpts?.initialOutputStyle ?? prefs.outputStyle ?? "default",
    initialShowTurnDuration: opts.hookOpts?.initialShowTurnDuration ?? turnDurationEnabled(prefs),
    // W-C T12: and the `Prompt suggestions` row from the same read — but DEFAULT FALSE (spec D-C4), so an
    // install that has never touched the setting neither generates suggestions nor shows the first-run
    // `Try "…"` template that upstream gates on the same key.
    initialPromptSuggestionEnabled: opts.hookOpts?.initialPromptSuggestionEnabled ?? promptSuggestionEnabled(prefs),
    // W-C T10 (EP-C2): the ONE place ccx reads a settings file for its own UI, and the one place it can be:
    // canon L154558 honours `statusLine` from the USER file only (a checked-out project may not install a
    // command on the machine that checks it out), and every layer below this is a pure function or a hook a
    // test mounts — none of them may touch `~/.claude`. `resolveStatusLineConfig` also owns the
    // `disableAllHooks` guard, so the whole setting is decided in this one expression.
    statusLine: opts.hookOpts?.statusLine ?? resolveStatusLineConfig(readSettingsFile("userSettings", opts.cwd)),
    // FSW T5: handed down, never re-derived — see the `selectRenderer` call above. No `??` override on this
    // one: unlike the seeded prefs beside it, a caller-supplied renderer choice could contradict the terminal
    // this process is actually painting into.
    rendererChoice: renderer,
  };
  const buildSession = opts.makeSession ?? ((resume?: string) => remoteChatSession(opts.socketPath, { ...(resume ? { resume } : {}) }));
  // FSW T6: the resume pointer needs an id, and this is the only place upstream of the tree that can see
  // one. The adapter's `sessionId` is a LIVE getter (client/chatAdapter.ts:98) that tracks clears, rewinds
  // and resumes, so holding the latest session is enough — no new channel out of the React tree, and the
  // pointer names whatever conversation the user was actually in when they quit.
  let liveSession: ChatSession | undefined;
  const makeSession = (resume?: string) => { const s = buildSession(resume); liveSession = s; return s; };
  const output = createResumeSafeStdout(process.stdout);
  const bridge = createDeferredClearBridge();                 // created BEFORE render: useChat may ask on mount
  // F2 task 5: the keymap owns raw stdin for the whole tree (its own parser + binding table + chord machine),
  // which is only safe because this render already passes `exitOnCtrlC: false` — Ink must not exit underneath
  // the table's own ctrl+c semantics. Components below register scopes/actions/fallbacks; ctrl+z stays
  // pre-table and routes to the same suspendProcess path ChatApp uses — ChatApp registers it itself
  // (`useKeySuspend`, task 6), since building the SuspendDeps needs the real tty from `useStdin`/`useStdout`
  // plus the resumeOutput repaint owner, none of which exist up here. `KeymapDeps.suspend` stays the
  // provider-level fallback for trees that render no ChatApp.
  // F2 task 9: the USER layer. <UserKeymap> loads ~/.claude/keybindings.json (upstream's own path, so an
  // existing Claude Code keymap applies here) before the first render, keeps watching it, and feeds the live
  // layers to the provider — an edit applies to the next keypress. Its validation findings are transcript
  // notices, which is why they route through a bridge: at launch there is no transcript yet, and on a reload
  // there is no console to print into.
  const keybindingsFile = userBindingsPath();
  const notices = createNoticeBridge();
  // F5 task 8 — `DVf` (bundle L495100): top up the `Try "${file}"` example-file cache if it is empty or over
  // a week old. Fire-and-forget and deliberately HERE rather than in the composer: it shells out to `git log`
  // exactly once per process, while the composer is remounted behind every dialog. A `setTimeout(0)` keeps
  // the (synchronous) git call off the first paint; upstream gets the same effect from an async spawn. The
  // composer reads the CACHE at mount, so like upstream the very first session in a repo shows `<filepath>`
  // and the harvested names appear from the next launch on.
  const harvest = setTimeout(() => refreshExampleFiles({ cwd: opts.cwd }), 0);
  harvest.unref?.();
  // W-R t4: the resize correction. The listener goes up BEFORE render() on purpose — Ink subscribes to `resize` in
  // its constructor (`ink.js:77`) and repaints synchronously, so a listener added afterwards could never see a
  // narrowing before Ink has acted on it. What it does with that head start changed in task 4b: it no longer emits
  // anything itself, it MEASURES (one probe per terminal) and publishes the verdict, because a SIGWINCH does not
  // imply an Ink write — the throttle can defer it and the dedupe can drop it entirely. `repaint` (the first
  // shrink's after-the-fact repair, the one correction that cannot be applied at the write because the verdict is
  // not in yet) goes through Ink's own stdout so its erase-plus-frame write re-records the frame and re-parks the
  // cursor on it. The DSR reply comes back the long way round: the keymap provider owns the ONE raw-stdin reader,
  // and forwards unclaimed escape sequences to `onUnknownSequence` — a forward that has existed since task 3.
  const reports = createCursorReports();
  const resize = createResizeRepaint({
    lastFrame: output.lastFrame, parkedColumn: output.parkedColumn,
    size: () => ({ columns: process.stdout.columns ?? 0, rows: process.stdout.rows ?? 0 }),
    repaint: (s) => { if (process.stdout.isTTY) output.stdout.write(s); },
    probe: (a) => probeReflow({ write: (s) => { process.stdout.write(s); }, onReply: reports.onReply, ...a }),
    detached: output.detachedWrites,
  });
  // …and this is the correction itself: every frame write Ink makes passes the proxy, and the ones that would
  // leave residue get the missing erase injected into the same chunk. The proxy is built before the resize
  // machinery (Ink's stdout has to exist first), hence the setter rather than a constructor argument. The
  // decision lives in the resize module, not in a closure here: a write is either corrected where it is made or
  // its shortfall is owed to the repair that runs when the verdict lands, and only one of those two can be true.
  output.setFrameCorrector(resize.frameWrite);
  // W2 t7 (s2qa2-05): THE ORDER IS THE WHOLE POINT OF DOING IT HERE. This listener is ahead of Ink's, so it is
  // the last moment at which "a tall write is outstanding" is still true for the screen the user is looking at —
  // Ink's own handler repaints synchronously on the next line of the same signal and stands the count down.
  // FSW T3 FIX ROUND (review C1): …AND CHATAPP'S SIZE COMMIT IS THE THIRD LINK OF THIS SAME CHAIN, for the
  // same reason the other two are here. Ink's own handler (`ink.js:77`, registered inside `render()` below)
  // re-lays-out and re-serializes the EXISTING element tree against the NEW row count and checks
  // `outputHeight >= stdout.rows` while doing it — so a component that learns the new size any later than
  // this has already had its old, taller tree measured against the shorter terminal. Measured before this
  // wiring, at 40 → 24 rows with a full live window: one `clearTerminal` write and a 44-row frame against a
  // 24-row pane, i.e. the whole session reprinted on the one frame the wave exists to protect. Afterwards:
  // none. It works because Ink runs React in LEGACY mode (`ink.js:59`), where a `setState` from a plain
  // event callback flushes synchronously — the re-render, the re-layout and the write all land before Node
  // reaches the next listener.
  //   ORDER WITHIN THE CHAIN IS NOT FREE EITHER, which is why this is a fan-out from here rather than
  // ChatApp prepending its own listener (its default does exactly that, for embedders that have no chain).
  // Both lines above read the screen as it stands BEFORE anything repaints it: `noteResizeSignal` latches
  // whether a tall write is outstanding, and `resize.onResize` measures off the last recorded frame. A size
  // commit ahead of them writes a frame, stands `tallWrites()` down and re-records — and the W2-t7 grow
  // resync, whose whole job is to repair a stranded tall surface, would never fire again.
  const resizeChain = createResizeChain(() => { output.noteResizeSignal(); resize.onResize(); });
  const onTerminalResize = resizeChain.fire;
  process.stdout.on("resize", onTerminalResize);
  // W-C T8 (EP-C4a): the OSC 0 title writer. Created HERE, beside the resize listener, for the same two
  // reasons: it is a process-level concern with a teardown obligation (the `finally` below clears the title
  // before the shell gets the terminal back), and its writes must bypass Ink entirely — a title escape is not
  // newline-terminated, so the resume-safe proxy above would classify it FOREIGN ("nobody's frame", :219) and
  // drop the `justErased`/`dropped` latches with it, perturbing the W-R resize state machine once per 960 ms
  // animation tick for a write that changes nothing on the pane.
  // THIS IS ALSO THE CONTAINMENT: only the REPL builds one, so a daemon/HOST session — which never
  // calls `runChatClient` — cannot retitle a terminal it does not own.
  const title = createTerminalTitle({ write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); } });
  // ── FSW T6 (spec §A3/§A6) — THE ALT-SCREEN GUARD AND THE EXIT GUARANTEE ──────────────────────────────
  // CONSTRUCTED ON EVERY LAUNCH, ARMED BY NOBODY YET. `enter()` is the arming, and only the fullscreen
  // renderer calls it (T9); until then every method here is inert and this block costs a classic launch two
  // signal listeners and nothing on the wire. It is built BEFORE `render()` because that is where T9 enters
  // — the screen has to be taken before Ink paints its first frame into it.
  //   `writeSync` on fd 1, not `process.stdout.write`: the teardown's callers are `process.exit` and a dying
  // process, neither of which drains an async write queue. `appRef` gives the guard canon `zuy`'s unmount
  // attempt (L181502) without a forward reference — Ink does not exist yet on this line.
  //   THE UPGRADE GATE READS A RESOLVED NAME, NOT `TERM_PROGRAM` (T6 review F5). Canon feeds `Ybe()` from
  // `Z.terminal` = `oeh()` (L22139), and kitty — the terminal the feature is named after — sets no
  // `TERM_PROGRAM` at all, so the raw variable could never reach two of canon's seven.
  //   AND WHO OWNS THE SIGNALS IS DECLARED, NOT SNIFFED (review F8). `beforeExit` present means main
  // registered the handlers and will drain our teardown out of that array; absent (`ccx attach`) means
  // nobody will, and the guard takes the signals itself. One expression decides both, so they cannot
  // disagree — a launch that owned the signals but passed no array used to get no cleanup at all.
  const appRef: { current?: { unmount(): void } } = {};
  const terminalName = resolveTerminalName(process.env);
  const altGuard = createAltScreenGuard({
    writeSync: (s) => { if (process.stdout.isTTY) writeSync(1, s); },
    ...(terminalName ? { termProgram: terminalName } : {}),
    unmount: () => { appRef.current?.unmount(); },
    signalsOwned: opts.beforeExit !== undefined,
  });
  const stopSignalSafety = altGuard.installSignalSafety();
  // ONE TEARDOWN, BOTH ROUTES (review F1). Everything the REPL owes the terminal, in the order §A6 requires,
  // latched so the route that does not win runs nothing. The signal route drains it out of `beforeExit`
  // (`cli/main.ts:424`) ahead of `host.stop` and `process.exit`; the graceful route reaches the `finally`
  // below. They are not exclusive — the guard's unmount settles `waitUntilExit()`, so a signal makes the
  // `finally` run too, which is exactly the microtask that used to paint the title reset and the unpark onto
  // the user's shell screen AFTER rmcup.
  const teardown = createChatTeardown({
    offResizeListener: () => process.stdout.off("resize", onTerminalResize),
    stopResize: () => resize.stop(),           // W2 t7 — drop the settle window with it: it WRITES when it fires
    clearTitle: () => title.clear(),           // `a0u` (L148428) — hand the terminal back with an empty title
    parkedColumn: output.parkedColumn,
    stopSignalSafety,
    guard: altGuard,
    sessionId: () => liveSession?.sessionId,   // read LATE — see the live-getter note above
    write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); },
  });
  if (opts.beforeExit) opts.beforeExit.push(teardown);
  const app = render(
    <UserKeymap file={keybindingsFile} deps={{ onUnknownSequence: reports.deliver }}
      onIssues={(issues) => { for (const line of formatIssues(issues, keybindingsFile)) notices.notify(line); }}>
      <ChatApp makeSession={makeSession} client={opts.client} cwd={opts.cwd}
        initialPrompt={opts.initialPrompt} initialResume={opts.initialResume} initialEntries={opts.initialEntries}
        clearStaticTranscript={bridge.clearStaticTranscript} noticeBridge={notices}
        hookOpts={hookOpts} onDetach={opts.onDetach} resumeOutput={output} onResize={resizeChain.subscribe}
        initialTodosOpen={prefs.showExpandedTodos ?? true}
        {...(opts.name ? { name: opts.name } : {})} terminalTitle={title} />
    </UserKeymap>,
    { exitOnCtrlC: false, stdout: output.stdout },
  );
  appRef.current = app;
  bridge.bind(() => app.clear());
  // `/exit`, the double-ctrl-C arm and `ccx attach`'s onDetach all reach here the same way — they settle
  // Ink's `waitUntilExit()` — so all three print the resume pointer (the deliberate divergence from canon's
  // graceful-only hint). A signal got there first? Then this is a no-op and the pointer is already out.
  try { await app.waitUntilExit(); } finally { teardown(); }
}
