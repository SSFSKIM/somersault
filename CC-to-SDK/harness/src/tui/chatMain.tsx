// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { writeSync } from "node:fs";
import { render } from "ink";
import { createAltScreenGuard, createChatTeardown, resolveTerminalName, type AltScreenGuard } from "./altScreen.js";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import { UserKeymap } from "./keys/UserKeymap.js";
import { formatIssues, userBindingsPath } from "./keys/userBindings.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import type { InitialResume } from "./commands.js";
import { loadPrefs, type CcxPrefs } from "./prefs.js";
import { TMUX_CC_NOTICE, makeTmuxProbe, selectRenderer, type RendererChoice, type RendererMode } from "./renderer.js";
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
import { reducedMotion } from "./motion.js";
import { createDesktopNotifier, NOTIF_DEFAULT_EVENTS } from "./desktopNotify.js";
import { createProgressBar, progressBarCapability } from "./progressBar.js";
import { PROGRESS_TEARDOWN_CLEAR } from "./terminalEscapes.js";

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
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialEffort?: string; initialOutputStyle?: string; initialShowTurnDuration?: boolean; initialPromptSuggestionEnabled?: boolean; initialPrefersReducedMotion?: boolean; initialTerminalProgressBarEnabled?: boolean; initialCopyOnSelect?: boolean; statusLine?: StatusLineConfig; promptLatch?: PromptLatch };
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
  /** FSW T9 (D21) — ARM AN ERASE IN FRONT OF THE NEXT PAINT. A resize invalidates the whole alternate-screen
   *  frame: log-update's `previousLineCount` describes rows the terminal has since moved, so its next erase
   *  lands in the wrong place and the repaint composes over residue. Canon's answer is a one-shot FLAG rather
   *  than a per-frame cost — `needsEraseBeforePaint`, set by the resize handler (bundle L180640) and cleared on
   *  use (L180759), where it unshifts `$uy` in front of the paint.
   *    A SEPARATE CROSS-CALL FLAG, not a `setFrameCorrector` in disguise (T8 review, amendment two). The
   *  corrector's channel is set and consumed inside ONE `write` call and is guarded by `frame !== undefined` —
   *  which is false on exactly the first paint after a resize, the paint this exists for — and fullscreen
   *  constructs no corrector at all. This flag is set from the resize listener and read by a later call.
   *    ALT-SCREEN ONLY, like `park()`. `ESC[2J` on the main screen blanks a viewport whose live `<Static>` rows
   *  may not be in scrollback yet (the t8 over-erase). The guard lives here rather than in the caller's
   *  discipline because the mode is what makes the escape safe. */
  eraseNextPaint(): void;
  /** FSW T15 FIX ROUND (review C1) — THE SCREEN CHANGED UNDER LOG-UPDATE, WHICH DOES NOT KNOW.
   *
   *  Ink owns ONE log-update for the process, and its `previousLineCount` is a fact about a SCREEN rather than
   *  about a buffer: `/tui` swaps the screen without swapping the renderer, so the first write after the swap
   *  opens with `eraseLines(the count from the screen we just left)` and spends it on the one we just arrived
   *  at. The LEAVE edge is where that is destructive — measured at 24 rows, a fullscreen-booted session
   *  flipping to `default` wrote `eraseLines(24)` after rmcup and took sixteen rows of the user's own shell
   *  with it, rows nothing in this process will ever repaint. (The ENTER edge survives on luck: `ENTER_ALT`
   *  ends in `2J`+`H`, so the stale erase runs against a blank alternate screen with the cursor at home.
   *  `EXIT_ALT` carries no such cover, which is the whole difference between the two edges.)
   *
   *  Canon discharges the same obligation and never meets the second edge, because it has none:
   *  `resetFramesForAltScreen` (bundle L181086) ends in `this.log.reset()` on every alt-screen ENTRY, and
   *  canon's own `/tui` relaunches the process instead of flipping a live one. Ink 5.2.1 exposes no such
   *  reset — `render()` hands back five methods and `build/instances.js` is not an importable subpath — so the
   *  discharge happens HERE, where the erase bytes are already parsed and already rewritable: the count owed
   *  to the main screen is saved on the way out, restored on the way back, and the first log-update erase on
   *  the destination screen is clamped to it. ONE clamp is enough — the write carrying it re-syncs
   *  log-update's own counter to the screen it just painted.
   *
   *  IT IS A RESTORE AND NOT CANON'S RESET-TO-ZERO, because our leave edge really does return to a screen with
   *  our own frame still on it: `1049l` puts back the main buffer and the cursor `1049h` saved, so the rows the
   *  last classic frame painted are exactly what the next erase is entitled to take. Zero would strand a
   *  duplicate of that frame above the new one — the under-erase direction, cosmetic, and the wrong answer
   *  where a better one is in hand. The one case the saved count cannot cover is a RESIZE during the
   *  alternate-screen trip, which reflows the main buffer under a count taken before it; that lands on the
   *  under-erase side as well. */
  noteScreenChange(to: "alt" | "main"): void;
}

/** Ink's erase prefix: `ansiEscapes.eraseLines(n)` is a run of `\x1b[2K` / `\x1b[1A` closed by `\x1b[G`. It is
 *  terminal bookkeeping, not frame content — and `eraseLines(0)` is the empty string, which is why the first frame
 *  of a session (and any frame right after a `log.clear()`) arrives with no prefix at all. */
const INK_ERASE_PREFIX = /^(?:\x1b\[2K|\x1b\[1A|\x1b\[G)+/;

/** How many rows one of those prefixes erases: `eraseLines(n)` carries n − 1 `\x1b[1A`s. */
const eraseDepth = (prefix: string): number => (prefix.match(/\x1b\[1A/g)?.length ?? 0) + 1;

/** `ansiEscapes.eraseLines(n)` rebuilt — the ONE place this file writes an erase prefix instead of reading
 *  one (`noteScreenChange`, below, is the only caller). `eraseLines(0)` is the empty string, which is already
 *  the exact bytes for "erase nothing", so the clamp needs no special case at the bottom of its range. */
const eraseLinesSeq = (n: number): string => (n <= 0 ? "" : "\x1b[2K" + "\x1b[1A\x1b[2K".repeat(n - 1) + "\x1b[G");

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
 *  terminal that implements 2026 buffers everything between the pair and presents it as one update.
 *    DELIBERATE DIVERGENCE — WE EMIT IT UNCONDITIONALLY AND CANON DOES NOT. Canon gates the pair: `Dms`
 *  (L177106) emits it only when its skip flag is false, and both call sites (L180802, L181310) pass
 *  `skipSyncMarkers()` (L180678), which skips unless stdout is a TTY, TTY handlers are attached, AND `Lee()`
 *  says the terminal is on a twelve-branch capability ALLOW-LIST: `TERM_PROGRAM` in {iTerm.app, WezTerm,
 *  WarpTerminal, ghostty, contour, vscode, alacritty, mintty, rio, Tabby}, JetBrains terminals,
 *  `KONSOLE_VERSION >= 211200`, kitty, `xterm-ghostty`, `foot*`, `ZED_TERM`, `VTE_VERSION >= 6800`, or the
 *  `CLAUDE_CODE_FORCE_SYNC_OUTPUT` override — and under `TMUX` only when a LIVE PROBE said yes (`E2u`/`b2u`,
 *  L176997). An allow-list that specific exists because 2026 to an unknown terminal is NOT free: one that
 *  honors BSU and drops ESU holds the display. The named exposure is our own: TMUX is this wave's QA
 *  environment, and it is precisely the case canon refuses without a positive probe. Nothing here can
 *  unbalance the pair (one concatenation, one `targetWrite`), so the divergence is recorded rather than gated
 *  — but T17 OWES the matrix a proof, BEFORE T16 flips the renderer default on: the wrap must be shown INERT
 *  on a terminal outside canon's allow-list and on bare tmux with no probe.
 *    KNOWN BOUNDED DIVERGENCE (plan m1): the pair goes around ONE write, and two of Ink's seams are three.
 *  `writeToStdout` (`ink.js:140`-`:155`) and `writeToStderr` (`:157`-`:171`) are each `log.clear()` →
 *  `write(data)` → `log(lastOutput)`, and only that third call is a recorded frame write — the erase and the
 *  payload go out unwrapped ahead of it, so a paint reached through those seams can tear. `/clear` and every
 *  `console.*` under `patchConsole` (render.js's default, which this app does not turn off) reach them.
 *  RECORDED, NOT FIXED — and NOT because bytes would have to be held: opening on the erase and closing on the
 *  frame behind it would hold nothing (the `justErased`/`dropped` latch already models that triple). The
 *  reason is that an erase-only write is not guaranteed to HAVE a frame behind it — a bare `app.clear()`, an
 *  unmount, a crash between the two — and each of those would leave the terminal inside an OPEN synchronized
 *  update with no closer. An unbalanced pair is the one failure here that can freeze a display; a tear is
 *  cosmetic and user-initiated. That asymmetry, not flush difficulty, is why m1 stays unfixed. */
const SYNC_BEGIN = "\x1b[?2026h", SYNC_END = "\x1b[?2026l";

/** FSW T9 (D21) — canon `$uy` (bundle L181490) = `h1 + fI` = `ESC[2J` + `ESC[H`, byte for byte, and it is
 *  DELIBERATELY NOT the `Rms()` form (`2J` + `3J` + `H`, L176982) that `clearAltScreen` carries. The two answer
 *  different questions on the same screen: `Rms` is a RESET — `/clear`'s payload, which is entitled to drop the
 *  alternate screen's own saved lines — while this is a REPAINT, the one-shot in front of the first frame after
 *  a resize, and the saved lines are not the resize's business. Canon keeps them apart at exactly that seam:
 *  L180759 unshifts `$uy`, L177121 selects `Rms()`. */
const ALT_ERASE = "\x1b[2J\x1b[H";

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

/** FSW T8: `altMode` is the alternate screen — every screen rule the proxy applies keys off it (the `ESC[3J`
 *  strip and the park are main-screen only; the 2026 wrap and D21's erase are alt-screen only).
 *    FSW T15 MADE IT A READER, and the reason is exactly the invariant the first version of this comment
 *  claimed: the mode may not be captured at construction, because `/tui` now changes it mid-session while this
 *  proxy — built once, wrapping the one `process.stdout` — outlives the flip. Each of those rules is a
 *  PER-WRITE decision, so each one asks at the write. It is not a setter: nothing here owns the mode, and a
 *  second place that could be told about a flip is a second place that can be told late. */
export function createResumeSafeStdout(stdout: NodeJS.WriteStream, opts: { altMode?: () => boolean } = {}): ResumeSafeStdout {
  const altMode = opts.altMode ?? (() => false);
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
  let pendingErase = false;                      // FSW T9 (D21): a resize is owed a full repaint — see `eraseNextPaint`
  let mainScreenCount = 0;                       // T15 fix: log-update's line count for the MAIN screen, held across an alt trip
  let mainScreenPark = 0;                        // …and the column its cursor was parked in when we left it
  let eraseBudget: number | undefined;           // …and what the first erase on the screen we just moved to may spend
  const targetWrite = stdout.write.bind(stdout) as (...args: any[]) => boolean;
  /** The clamp itself (see `noteScreenChange`). Armed at a screen boundary and spent on the first prefix that
   *  is genuinely log-update's — a bare `\x1b[G` is somebody homing a cursor, not an erase, so it is left alone
   *  and the budget waits for the write that matters. */
  const spendEraseBudget = (prefix: string): string => {
    if (eraseBudget === undefined || !prefix.includes("\x1b[2K")) return prefix;
    const budget = eraseBudget; eraseBudget = undefined;
    return eraseDepth(prefix) <= budget ? prefix : eraseLinesSeq(budget);
  };
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
      eraseBudget = undefined;                   // T15 fix: this chunk blanks the screen itself, so nothing is owed in front of it
      // …ON THE MAIN SCREEN ONLY (FSW T8, plan m2/D6). Everything the paragraph above argues is an argument
      // about SCROLLBACK: `\x1b[3J` erases it, and inline that is where this app's committed transcript and the
      // user's pre-launch screen live. The alternate screen has no scrollback — that is what it is — so the
      // escape has nothing to destroy there, and canon writes both deliberately: `Rms()` (L176982) is `2J`+`3J`
      // +`H` and L177121 selects it precisely on `altScreen`. The strip is a main-screen rule and it comes off
      // with the main screen. `clearViewport.ts`'s `screenClear` is the same decision on the same axis, for
      // `/clear`'s own payload rather than for Ink's tall-frame head.
      if (!altMode() && chunk.startsWith(CLEAR_SCROLLBACK_HEAD)) rewritten = "\x1b[2J" + chunk.slice(CLEAR_SCROLLBACK_HEAD.length);
      return false;
    }
    const inkPrefix = chunk.match(INK_ERASE_PREFIX)?.[0] ?? "";
    const body = chunk.slice(inkPrefix.length);
    // FSW T15 FIX ROUND (review C1) — AND IT IS CLAMPED HERE, in front of every other rule, because every one
    // of them wants the prefix that is actually going to the terminal: the corrector measures Ink's erase off
    // it, the `justErased` latch is decided by whether it is empty, and the depth is the whole finding. The
    // rewrite is seeded into `rewritten` — the same one-chunk channel the corrector and D21's erase use, and
    // both of them compose on top of it below by rebuilding from `prefix`.
    const prefix = spendEraseBudget(inkPrefix);
    if (prefix !== inkPrefix) rewritten = prefix + body;
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
      const seq = corrector({ inkErases: eraseDepth(prefix), prevFrame: frame,
        parkedCol, widthAtPaint, width: stdout.columns ?? 0, rows: stdout.rows ?? 0 });
      if (seq) rewritten = prefix + seq + body;
    }
    // FSW T9 (D21) — AND THE ONE-SHOT ERASE RIDES OUT HERE, on the recorded-frame path and nowhere else. It is
    // read-and-cleared rather than merely read: "the next PAINT", not the next write, is the contract — Ink's
    // clear→static→frame burst puts two non-paints in front of the frame, and an erase spent on the `log.clear()`
    // is an erase the frame behind it never gets. It composes OUTSIDE the corrector's rewrite above (the erase
    // precedes whatever chunk is going out, corrected or raw) and INSIDE the 2026 wrap applied at the write site,
    // which is what makes the wipe and the repaint one atomic update — the m1 tear, closed for this one case.
    // Injecting through `rewritten` and not around `record` is also what keeps the classification honest: `record`
    // has already read Ink's raw bytes, so the `\x1b[2J` we are about to prepend cannot be mistaken for the
    // tall-frame head by the very branch that tests for it.
    //   …AND IT IS SPENT ON THE SCREEN THAT ARMED IT (T15). A resize can land between `/tui default` and the
    // paint that follows it; `\x1b[2J` in front of THAT chunk would blank a main-screen viewport whose live
    // `<Static>` rows are not in scrollback yet — the t8 over-erase, arriving by a new route. Consumed either
    // way, because the erase belongs to a frame that is no longer coming.
    if (pendingErase) { pendingErase = false; if (altMode()) rewritten = ALT_ERASE + (rewritten ?? chunk); }
    // …and the screen is back in sync (see above) — INCLUDING log-update's own counter, which this write has
    // just re-derived from the frame it painted, so a boundary clamp that was never spent is now stale (T15 fix).
    justErased = false; frame = body; widthAtPaint = stdout.columns ?? 0; tall = 0; eraseBudget = undefined;
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
    //   …AND IT CLEARS THE RECORD RATHER THAN MERELY DECLINING (T15). Nothing is parked on the alternate
    // screen, so 0 is the truth there — and after a `/tui` INTO fullscreen the last classic frame's column is
    // still sitting in this variable, where three readers would take it for a live park (the `foreign` branch
    // below homing a cursor that is already home, the exit teardown erasing a row of the frame just before
    // rmcup, `resizeRepaint` measuring from it if a flip back re-armed it mid-burst).
    if (altMode()) { parkedCol = 0; return; }
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
      const payload = altMode() && recorded ? SYNC_BEGIN + (corrected ?? args[0] as string) + SYNC_END : corrected;
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
    eraseNextPaint() { if (altMode()) pendingErase = true; },
    noteScreenChange(to) {
      // The two facts that BELONG to the main screen are saved and restored as a pair, because they describe
      // the same thing: what this process left painted there. Everything else is dropped, which is the honest
      // record for a screen nothing in here has painted yet — `frame` is the erase the corrector would measure
      // from and `tall` is a claim about log-update's counters, and after a screen change neither describes
      // what the user is looking at. `pendingErase` is deliberately NOT touched: the D21 flag is already
      // spend-gated on `altMode()` at the paint, and one rule in one place beats two.
      if (to === "alt") { mainScreenCount = frame === undefined ? 0 : frame.split("\n").length; mainScreenPark = parkedCol; parkedCol = 0; eraseBudget = 0; }
      else { eraseBudget = mainScreenCount; parkedCol = mainScreenPark; }
      frame = undefined; widthAtPaint = 0; justErased = false; dropped = undefined; tall = 0;
    },
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

/** FSW T15 — `/tui`'s TWO HALVES ABOVE THE REACT TREE. `select` answers which renderer the setting now names;
 *  `apply` performs everything that must be true BEFORE the next paint. They are separate because the command
 *  needs the answer to print (and to decide whether anything changed) and the tree needs it as state — one
 *  call, two consumers, no second evaluation of the ladder. */
export interface RendererSwitch {
  /** Re-run the boot ladder with `tui` in its settings rung. A rung ABOVE that one still wins — a pipe, a
   *  screen reader, `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, tmux `-CC`, Windows over SSH — which is why this
   *  returns a choice rather than echoing the request, and why the reason word comes back with it. */
  select(tui: "fullscreen" | "default"): RendererChoice;
  /** Move the live mode and take/hand back the screen, in that order and synchronously. */
  apply(next: RendererChoice): void;
}

/** THE FLIP, AS TWO SIDE EFFECTS THAT MUST NOT BE SEPARATED BY A PAINT.
 *
 *  `live.mode` is what the output proxy and the resize chain read on their next write; the guard's escape is
 *  what the terminal reads. Both happen here, ahead of the `setState` that re-renders the tree, so the order
 *  on the wire is enter-then-frame going in and rmcup-then-classic-paint coming out — spec §A6's rule
 *  ("nothing fullscreen may paint to the main screen") applied to a boundary that is not an exit.
 *
 *  IT IS NOT `createChatTeardown`. That is latched once per process ON PURPOSE: it is the EXIT's order, and it
 *  ends with the resume pointer. A flip is not an exit, so it takes `guard.leave()` — the same bytes minus the
 *  unmount and the bracketed-paste reset — and the guard is re-enterable across as many flips as the user
 *  wants (`enter()`/`leave()` are each `armed`-guarded and idempotent).
 *
 *  Extracted from `runChatClient` so the ordering has somewhere to be asserted, exactly as `createResizeChain`
 *  was; it has no other caller. */
export function createRendererSwitch(deps: { prefs: CcxPrefs; isTTY: boolean; env: NodeJS.ProcessEnv; guard: AltScreenGuard; live: { mode: RendererMode }; output: Pick<ResumeSafeStdout, "noteScreenChange">; tmuxProbe?: (env: NodeJS.ProcessEnv) => boolean }): RendererSwitch {
  return {
    // The probe comes in from the boot call (T16) rather than being made here: `/tui` re-walks the whole
    // ladder, and the tmux rung's answer was settled once at startup — a keystroke must not spawn anything.
    select: (tui) => selectRenderer({ isTTY: deps.isTTY, env: deps.env, prefs: { ...deps.prefs, tui }, tmuxProbe: deps.tmuxProbe }),
    apply(next) {
      const was = deps.live.mode;
      deps.live.mode = next.mode;
      if (next.mode === was) return;
      // FIX ROUND (review C1) — AND THE THIRD SIDE EFFECT IS THE ONE NOBODY CAN SEE, so it goes first. Ink's
      // log-update owes the screen we are leaving an erase it is about to spend on the screen we are arriving
      // at; `noteScreenChange` moves that debt with us. Ahead of the escape because it only READS this
      // process's record of what is painted — no bytes — and behind it the guard's rmcup would already have
      // handed the terminal back with the debt still standing (`noteScreenChange`'s header).
      deps.output.noteScreenChange(next.mode === "fullscreen" ? "alt" : "main");
      if (next.mode === "fullscreen") deps.guard.enter(); else deps.guard.leave();
    },
  };
}

/** FSW T15 — THE RENDERER MODE IS REACT STATE, AND THIS IS THE ONLY COMPONENT ABOVE IT.
 *
 *  `ChatApp` may not unmount when `/tui` runs — the transcript, the composer draft, every dialog's internal
 *  state and the keymap registry's mount order all live inside it — so the state that changes has to sit
 *  ABOVE that element and reach it as a prop at a stable position: no `key`, no conditional wrapper, nothing
 *  between them that exists in only one mode (plan review C5). That is the whole content of this component,
 *  and it is why it is a component at all rather than a closure in `runChatClient`.
 *
 *  Everything else is passed straight through, which also means `spy.tree.props.children.props` still reads
 *  ChatApp's props at boot: the only two this adds are the ones ChatApp cannot be given from outside React. */
export function ChatRoot({ rendererSwitch, ...props }: { rendererSwitch: RendererSwitch } & React.ComponentProps<typeof ChatApp>): React.ReactElement {
  // `renderer` is optional only for tests that mount this component without one; `runChatClient` always
  // passes the boot choice. The fallback reason is `not_tty` and NOT `default_off` (T16 review, minor 8):
  // `default_off` is a word the post-flip ladder can no longer produce at all, so a `/status` printing it
  // would be naming a rung that does not exist — and the launch this fallback actually describes, a mount
  // with no terminal behind it, is the ladder's own top rung.
  const [choice, setChoice] = React.useState<RendererChoice>(props.renderer ?? { mode: "classic", reason: "not_tty" });
  // …and the callback closes over NOTHING that can go stale: `apply` compares against the holder above the
  // tree, which is the same value the output proxy reads, so there is one record of "which screen are we on"
  // and no render of this component can disagree with it.
  const switchRenderer = React.useCallback((tui: "fullscreen" | "default"): RendererChoice => {
    const next = rendererSwitch.select(tui);
    // The screen and the process-level mode move FIRST; the paint is the `setState` behind them. Ink runs
    // React in legacy mode, so this flushes synchronously — but the guard writes with `writeSync` on fd 1,
    // so the ordering holds even where the paint is deferred by Ink's own throttle.
    rendererSwitch.apply(next);
    setChoice(next);
    return next;
  }, [rendererSwitch]);
  // …and `select` goes down UNWRAPPED beside it (external review, finding 3): `/tui`'s busy gate needs the
  // ladder's verdict without the flip, and this component has nothing to add to that question — no state of
  // its own moves when it is asked.
  return <ChatApp {...props} renderer={choice} switchRenderer={switchRenderer} selectRenderer={rendererSwitch.select} />;
}

export async function runChatClient(opts: ChatClientOpts): Promise<void> {
  const prefs = loadPrefs();                             // W3 T4: apply a saved theme BEFORE the first render
  if (prefs.theme) setTheme(prefs.theme);
  // FSW T5 (spec §A2): WHICH RENDERER, DECIDED ONCE. Here and nowhere else — this is the only point in the
  // process that has the real TTY, the real env and the prefs file in hand at the same time, and the
  // decision must not move again: a resize never re-evaluates it (§L2.1), so every consumer reads this one
  // value. `/status` prints it (F9), the output proxy takes its screen rules from it (T8), and from T9 it is
  // what decides which machinery below gets CONSTRUCTED at all.
  //   FSW T16 restored canon's tmux `-CC` shell-out to that rung (renderer.ts divergence 1, withdrawn), so the
  // probe is built HERE, once, and shared with the `/tui` switch below: the ladder is walked twice in a
  // process's life and tmux is asked at most once.
  const tmuxProbe = makeTmuxProbe();
  const renderer = selectRenderer({ isTTY: Boolean(process.stdout.isTTY), env: process.env, prefs, tmuxProbe });
  // FSW T9 (spec §A2a) — THE ONE BOOLEAN THE WHOLE BRANCH READS. Derived once, beside the decision, so no
  // line below re-derives it and none of them can disagree about which screen this process is painting into.
  //   FSW T15 MOVED IT INTO A HOLDER, and the boolean is now only the BOOT value. `/tui` swaps the renderer
  // under a live session, so every consumer above the React tree that keeps a screen rule — the output
  // proxy's four, the resize chain's readers — has to ask which screen it is on AT THE MOMENT IT ACTS rather
  // than remember which one this process started on. `live.mode` is that single answer; `ChatRoot` moves it
  // (through `createRendererSwitch`) in the same synchronous step that takes or hands back the screen, so no
  // paint can land between the two. The React tree does not read this holder — it reads the `renderer` prop,
  // which is the same fact as component state.
  const fullscreen = renderer.mode === "fullscreen";
  const live = { mode: renderer.mode };
  const fullscreenNow = (): boolean => live.mode === "fullscreen";
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
    // F8 T6: and the `Reduce motion` row from the same read — DEFAULT FALSE, canon's own polarity.
    initialPrefersReducedMotion: opts.hookOpts?.initialPrefersReducedMotion ?? (prefs.prefersReducedMotion ?? false),
    // T-CH34: and the `Terminal progress bar` row from the same read — DEFAULT TRUE, canon's own polarity.
    initialTerminalProgressBarEnabled: opts.hookOpts?.initialTerminalProgressBarEnabled ?? (prefs.terminalProgressBarEnabled ?? true),
    // F9 T-MOUSE Task 7: and the `Copy on select` row from the same read — DEFAULT TRUE, canon's own polarity.
    initialCopyOnSelect: opts.hookOpts?.initialCopyOnSelect ?? (prefs.copyOnSelect ?? true),
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
  // FSW T8/T9: the proxy's screen rules are the renderer's — 2026-wrapped paints, no park, no `ESC[3J` strip,
  // and the D21 erase-before-paint channel armed (see `eraseNextPaint`). T15: read LIVE, per write, because
  // `/tui` can move the screen under a proxy that is built once.
  const output = createResumeSafeStdout(process.stdout, { altMode: fullscreenNow });
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
  // FSW T16 fix round — THE ONE RUNG THAT OWES THE USER A SENTENCE, and it goes out on the bridge the
  // keybindings watcher already uses, for the same reason: at boot there is no transcript to append to and no
  // console to print into without corrupting the first frame. The bridge queues it and `useChat` flushes it
  // on mount as an ordinary dim notice.
  //   WHY THIS RUNG AND NO OTHER. Every other classic verdict is something the user did — a pin, a settings
  // key, a pipe — and `/status` is the right place to look those up. `tmux_cc_off` is ccx overruling the
  // fullscreen default from inside a window that gives no clue why, for a user who is in that window
  // PRECISELY BECAUSE their environment does not advertise itself. Canon says the same sentence at the same
  // rung (renderer.ts's `TMUX_CC_NOTICE`); it says it to a debug log, and we say it where it can be read.
  //   ONCE, because this is the boot path and it runs once. `/tui` re-walks the ladder later and deliberately
  // does NOT come back through here: `formatTuiResult` already answers that keystroke with the same reason
  // word, and a second copy of this line would be the repetition canon's own once-per-process flag avoids.
  if (renderer.reason === "tmux_cc_off") notices.notify(TMUX_CC_NOTICE);
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
  //   FSW T9 (spec §A2a) — NONE OF IT RUNS IN FULLSCREEN. Every line of the stack below is an answer to one
  // question — "the frame is taller than the terminal thinks it is; where is the residue?" — and the
  // fullscreen frame makes that question unaskable by giving the tree `rows − 1` rows and clipping. So the
  // repaint, the frame corrector, the reflow probe and the park are all silent there, and fullscreen's whole
  // repaint contract is the D21 one-shot below.
  //   FSW T15 MOVED THE GATE FROM CONSTRUCTION TO EFFECT, and that is a real change of shape rather than a
  // refactor. T9 could gate on construction because the screen was decided for the life of the process; `/tui`
  // ends that. A session that BOOTS fullscreen and flips to classic would have no repaint stack to turn back
  // on, and one that boots classic and flips the other way would have a live one writing main-screen repairs
  // into an alternate-screen frame — the same bug from either end. So the stack is always BUILT (its
  // constructor arms no timer, writes nothing and reads the size once) and every seam that could act asks the
  // live mode: the two chain readers below, and the corrector here.
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
  // The empty string is the module's own "nothing to inject", so a fullscreen frame passes through untouched.
  output.setFrameCorrector((info) => (fullscreenNow() ? "" : resize.frameWrite(info)));
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
  //   FSW T9 — THE CHAIN STAYS, ITS READERS CHANGE. What is being fanned out here is the terminal's new size,
  // and ChatApp needs that on either screen (every geometry consumer in the tree reads its resize state, and
  // the fullscreen frame's own height IS `size.rows`). Only the two READERS are main-screen measurements, and
  // in fullscreen they are replaced by the one thing a resize owes the alternate screen: D21's erase before the
  // next paint. Same position in the same chain, and for the same reason the readers hold it — this runs before
  // Ink's own synchronous handler, so the flag is up before the repaint that must carry it.
  //   FSW T15 — …AND WHICH READERS RUN IS DECIDED AT THE SIGNAL, not at boot. A resize is exactly the kind of
  // event that can arrive on either side of a `/tui`, and both readers are screen-specific: `onResize`
  // measures a main-screen frame, `eraseNextPaint` arms an alt-screen-only escape (the proxy's own guard would
  // drop it anyway, which is precisely the belt this branch is the braces for).
  const resizeChain = createResizeChain(() => {
    if (fullscreenNow()) { output.eraseNextPaint(); return; }
    output.noteResizeSignal(); resize.onResize();
  });
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
  // F8 T6: the STARTUP value only — this object is long-lived, not a rendered component, so a mid-session
  // `/config` toggle reaches it on the next relaunch rather than the next frame (recorded asymmetry, task
  // report). The three rendered consumers below read the resolver live, every render.
  const title = createTerminalTitle({ write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); }, reducedMotion: reducedMotion(prefs) });
  // F8 T11: Task 10's OS notifier, wired to useChat's two real seams (permission park, empty-queue settle).
  // `settings` reads through `loadPrefs()` on EVERY call, not the `prefs` object loaded once above —
  // `savePrefs` writes a new object to disk and never mutates the one loaded at boot, so closing over
  // `prefs` here would be a startup snapshot wearing a call-time signature. A re-read per event is
  // affordable at these rates (at most two per turn) and is what makes `settings: () => …`'s contract
  // honest: a `/config` change takes effect on the very next notification.
  const notifier = createDesktopNotifier({
    write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); },
    // ONE read per call, not two: two separate `loadPrefs()` calls read and parse the file twice, and the
    // two fields could in principle come from different versions of it. Bind the call, read both fields off
    // the same object — still call-time, not construction-time, so the comment above still holds.
    settings: () => {
      const p = loadPrefs();
      return { preferredNotifChannel: p.preferredNotifChannel ?? "auto", enabledEvents: p.notifEvents ?? NOTIF_DEFAULT_EVENTS };
    },
  });
  // T-CH34 — the OSC 9;4 progress bar. `progressBarCapability(process.env)` is canon's `Wnr()` gate, resolved
  // ONCE here (TERM_PROGRAM does not change mid-session, same treatment `terminalName` below gets) and reused
  // for BOTH the live driver's writer gate and the two teardown call sites (`altGuard`'s process-exit net,
  // `teardown.clearProgress` below) — one capability answer, not three independently-sniffed copies.
  const progressBarCap = progressBarCapability(process.env);
  const progressBar = createProgressBar({ write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); }, capability: progressBarCap });
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
    progressBarCapability: progressBarCap,
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
                                               // (…and it is built on every launch since T15 — see the gate above)
    clearTitle: () => title.clear(),           // `a0u` (L148428) — hand the terminal back with an empty title
    // T-CH34 — the graceful-exit half of canon's `dsi()` progress limb. The UNWRAPPED constant, direct
    // `writeSync`, gated on CAPABILITY only (never `terminalProgressBarEnabled`) — NOT `progressBar.clear()`,
    // whose driver writes through the passthrough-wrapped live-path builder and would disagree with canon's
    // own asymmetry (`Koi` bypasses `tI`/`Fq` entirely at both of ITS call sites too).
    clearProgress: () => { if (progressBarCap && process.stdout.isTTY) writeSync(1, PROGRESS_TEARDOWN_CLEAR); },
    parkedColumn: output.parkedColumn,
    stopSignalSafety,
    guard: altGuard,
    sessionId: () => liveSession?.sessionId,   // read LATE — see the live-getter note above
    write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); },
  });
  if (opts.beforeExit) opts.beforeExit.push(teardown);
  // ── FSW T9 — TAKE THE SCREEN. `enter()` IS the arming (T6): every other method on the guard has been inert
  // until this line, and a classic launch never reaches it. The position is the contract in both directions.
  // AFTER the teardown is registered, because from here on an exit of any kind — signal, throw, `/exit` — owes
  // the terminal an rmcup, and a screen taken before anything can give it back is the one failure §A3 exists
  // to prevent. BEFORE `render()`, because `render()` paints Ink's first frame synchronously: armed any later
  // and that frame lands on the user's shell screen and is then hidden behind the smcup, which is both a
  // visible flash and a scrollback line nobody asked for.
  //   …and `renderer={renderer}` below is a PROP at a stable element position (plan review C5) — no `key`, no
  // wrapper that exists in only one mode — because T15's `/tui` flips it on a LIVE session and ChatApp may not
  // unmount when it does. T15 arrived: the value below is the BOOT choice, `ChatRoot` holds it as state from
  // there on, and this line is unchanged, which was the point of writing it this way.
  if (fullscreen) altGuard.enter();
  // FSW T15 — the flip's two halves, over the guard built above and the holder every screen rule reads.
  const rendererSwitch = createRendererSwitch({ prefs, isTTY: Boolean(process.stdout.isTTY), env: process.env, guard: altGuard, live, output, tmuxProbe });
  // EXTERNAL REVIEW, FINDING 1 — THE TRY STARTS AT `render()`, NOT AT `waitUntilExit()`.
  //   The screen is already taken on the line above, and everything between there and the await can throw:
  // `render()` builds the Ink instance and paints the first frame SYNCHRONOUSLY, so a component that throws
  // on mount, a Yoga failure or a bad keybindings file throws out of this call. Left outside the guard, that
  // throw left the alternate screen entered, the resize/title/signal handlers live, and the error printed by
  // `bin.ts` onto a screen the shell discards a moment later — a launch that dies with no visible reason.
  //   Everything the terminal is owed is already ONE function (`teardown`), and it is already latched and
  // already safe here: its unmount limb reads `appRef.current?`, which is simply unset when `render()` never
  // returned. So the fix is only where the `try` begins. The error is not caught — `finally` runs the teardown
  // FIRST, so by the time it reaches `bin.ts`'s `console.error` the main screen is back and the message is on
  // it, which is the whole point of moving the boundary.
  try {
    const app = render(
      <UserKeymap file={keybindingsFile} deps={{ onUnknownSequence: reports.deliver }}
        onIssues={(issues) => { for (const line of formatIssues(issues, keybindingsFile)) notices.notify(line); }}>
        <ChatRoot rendererSwitch={rendererSwitch} makeSession={makeSession} client={opts.client} cwd={opts.cwd}
          initialPrompt={opts.initialPrompt} initialResume={opts.initialResume} initialEntries={opts.initialEntries}
          clearStaticTranscript={bridge.clearStaticTranscript} noticeBridge={notices}
          hookOpts={hookOpts} onDetach={opts.onDetach} resumeOutput={output} onResize={resizeChain.subscribe}
          initialTodosOpen={prefs.showExpandedTodos ?? true}
          renderer={renderer} aroundSubprocess={altGuard.aroundSubprocess} altHandoff={altGuard.handoff}
          {...(opts.name ? { name: opts.name } : {})} terminalTitle={title} progressBar={progressBar} deps={{ notifier }} />
      </UserKeymap>,
      { exitOnCtrlC: false, stdout: output.stdout },
    );
    appRef.current = app;
    bridge.bind(() => app.clear());
    // `/exit`, the double-ctrl-C arm and `ccx attach`'s onDetach all reach here the same way — they settle
    // Ink's `waitUntilExit()` — so all three print the resume pointer (the deliberate divergence from canon's
    // graceful-only hint). A signal got there first? Then this is a no-op and the pointer is already out.
    await app.waitUntilExit();
  } finally { teardown(); }
}
