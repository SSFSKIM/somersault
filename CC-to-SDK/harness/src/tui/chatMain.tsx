// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { render } from "ink";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import { UserKeymap } from "./keys/UserKeymap.js";
import { formatIssues, userBindingsPath } from "./keys/userBindings.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import type { InitialResume } from "./commands.js";
import { loadPrefs } from "./prefs.js";
import { refreshExampleFiles } from "./placeholder.js";
import { createCursorReports, probeReflow } from "./reflowOracle.js";
import { createResizeRepaint, parkColumn, parkSequence } from "./resizeRepaint.js";
import { setTheme } from "./theme.js";

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
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialOutputStyle?: string };
  onDetach?: () => void;
  // Test seam; default builds remoteChatSession(socketPath, { resume }).
  makeSession?: (resume?: string) => ChatSession;
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

export { physicalRows } from "./resizeRepaint.js";   // W-R t4 moved it there; this stays the import site it had

export function createResumeSafeStdout(stdout: NodeJS.WriteStream): ResumeSafeStdout {
  let suppressNextWrite = false;
  let frame: string | undefined;                 // the last live frame, as painted
  let justErased = false;                        // previous write was erase-only → the next bare write is <Static>
  let parkedCol = 0;                             // W-R t4: where the cursor sits between frames, 0 if nowhere
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
  // ink.js:121-124 — when `outputHeight >= stdout.rows` Ink writes ONE chunk of `ansiEscapes.clearTerminal +
  // this.fullStaticOutput + output`, i.e. the session's entire accumulated scrollback with the frame glued on the
  // end. Nothing in the bytes marks the seam between them, so it is never recorded: adopting it would make
  // `physicalRows` a count over the whole session and task 4's erase would eat the live transcript. The frame
  // retained across that branch is then unrelated to what is on screen and can be taller than the new live region,
  // so an erase measured off it is NOT guaranteed to land on the under-erase side; EP-R4 resynchronizes the recorded
  // geometry after this branch. `clearTerminal` is `\x1b[2J\x1b[3J\x1b[H` (and `\x1b[2J\x1b[0f` on old Windows) —
  // both open with `\x1b[2J`, which no other write Ink makes ever does.
  const record = (chunk: unknown): boolean => {
    if (typeof chunk !== "string") return false;
    if (chunk.startsWith("\x1b[2J")) { justErased = false; return false; }
    const prefix = chunk.match(INK_ERASE_PREFIX)?.[0] ?? "";
    const body = chunk.slice(prefix.length);
    if (body === "") { justErased = true; frame = undefined; return false; }
    // Ink's log() writes `str + "\n"` and its <Static> chunk ends the same way, so a body that does NOT end in a
    // newline is nobody's frame — it is another consumer of this same stdout (W-R t4: the keymap's DECSET writes,
    // suspend's cursor show/hide). Recording those used to clobber `lastFrame()` with a bare escape sequence, and
    // now would also park the cursor mid-sequence.
    if (!body.endsWith("\n")) return false;
    if (prefix === "" && justErased) { justErased = false; return false; }
    justErased = false; frame = body;
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
    const col = stdout.isTTY ? parkColumn(stdout.columns) : 0;
    if (col > 0) targetWrite(parkSequence(col));
    parkedCol = col;
  };
  const write = ((...args: any[]): boolean => {
    if (!suppressNextWrite) {
      // Ink itself never notices the park (every write it makes opens with a full-line erase or homes the column),
      // but anything else sharing this tty would paint from column 117 — ctrl+z's cursor hand-off to the shell and
      // the keymap's DECSET writes both come through here. Home the cursor for those, then put the park back if
      // the write could not have moved it; a write that PAINTS gets no park until the next frame, because padding
      // over what it just printed would erase it.
      const chunk = typeof args[0] === "string" ? args[0] as string : "";
      const foreign = parkedCol > 0 && !INK_WRITE_HEAD.test(chunk);
      if (foreign) { targetWrite("\x1b[G"); parkedCol = 0; }
      const recorded = record(args[0]);
      const wrote = targetWrite(...args);
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
  // W3 T5: seed the Settings dialog's Output-style row from the same saved prefs (defaulting like useChat's
  // own opts.initialOutputStyle fallback does) — client-tracked, no engine round-trip needed just to boot.
  const hookOpts = { ...(opts.hookOpts ?? {}), initialOutputStyle: opts.hookOpts?.initialOutputStyle ?? prefs.outputStyle ?? "default" };
  const makeSession = opts.makeSession ?? ((resume?: string) => remoteChatSession(opts.socketPath, { ...(resume ? { resume } : {}) }));
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
  // its constructor (`ink.js:77`) and repaints synchronously, so a listener added afterwards could never get ahead
  // of it, and the erase would land on top of the new frame instead of the stale one. `emit` goes straight to the
  // tty (bookkeeping, not a frame — the recorder must not adopt it), while `repaint` goes through Ink's own stdout
  // so an erase-plus-frame write re-records the frame and re-parks the cursor on it. The DSR reply comes back the
  // long way round: the keymap provider owns the ONE raw-stdin reader, and forwards unclaimed escape sequences to
  // `onUnknownSequence` — that forward has existed since task 3 and is inert until wired here.
  const reports = createCursorReports();
  const resize = createResizeRepaint({
    lastFrame: output.lastFrame, parkedColumn: output.parkedColumn,
    size: () => ({ columns: process.stdout.columns ?? 0, rows: process.stdout.rows ?? 0 }),
    emit: (s) => { if (process.stdout.isTTY) process.stdout.write(s); },
    repaint: (s) => { if (process.stdout.isTTY) output.stdout.write(s); },
    probe: (a) => probeReflow({ write: (s) => { process.stdout.write(s); }, onReply: reports.onReply, ...a }),
  });
  process.stdout.on("resize", resize.onResize);
  const app = render(
    <UserKeymap file={keybindingsFile} deps={{ onUnknownSequence: reports.deliver }}
      onIssues={(issues) => { for (const line of formatIssues(issues, keybindingsFile)) notices.notify(line); }}>
      <ChatApp makeSession={makeSession} client={opts.client} cwd={opts.cwd}
        initialPrompt={opts.initialPrompt} initialResume={opts.initialResume} initialEntries={opts.initialEntries}
        clearStaticTranscript={bridge.clearStaticTranscript} noticeBridge={notices}
        hookOpts={hookOpts} onDetach={opts.onDetach} resumeOutput={output}
        initialTodosOpen={prefs.showExpandedTodos ?? true} />
    </UserKeymap>,
    { exitOnCtrlC: false, stdout: output.stdout },
  );
  bridge.bind(() => app.clear());
  try { await app.waitUntilExit(); }
  finally {
    process.stdout.off("resize", resize.onResize);
    // Unpark before the shell gets the terminal back, or its prompt draws from column 117 on a row of our spaces.
    if (process.stdout.isTTY && output.parkedColumn() > 0) process.stdout.write("\x1b[2K\x1b[G");
  }
}
