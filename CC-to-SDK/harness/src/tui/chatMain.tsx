// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { render } from "ink";
import stringWidth from "string-width";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import { UserKeymap } from "./keys/UserKeymap.js";
import { formatIssues, userBindingsPath } from "./keys/userBindings.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import type { InitialResume } from "./commands.js";
import { loadPrefs } from "./prefs.js";
import { refreshExampleFiles } from "./placeholder.js";
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
}

/** Ink's erase prefix: `ansiEscapes.eraseLines(n)` is a run of `\x1b[2K` / `\x1b[1A` closed by `\x1b[G`. It is
 *  terminal bookkeeping, not frame content — and `eraseLines(0)` is the empty string, which is why the first frame
 *  of a session (and any frame right after a `log.clear()`) arrives with no prefix at all. */
const INK_ERASE_PREFIX = /^(?:\x1b\[2K|\x1b\[1A|\x1b\[G)+/;

/** How many PHYSICAL terminal rows `frame` occupies at `width` — the reflowed height, which is what a resize
 *  changes and what Ink's own `previousLineCount` (logical lines, at the OLD width) gets wrong. Counts the frame's
 *  own lines only: Ink writes `str + "\n"` and records `split("\n").length`, i.e. logical lines + 1, so callers add
 *  that trailing term themselves — deliberately, so the convention stays visible at the point of use (W-R t4). */
export function physicalRows(frame: string, width: number): number {
  let rows = 0;
  for (const line of frame.replace(/\n$/, "").split("\n")) rows += Math.max(1, Math.ceil(stringWidth(line) / width));
  return rows;
}

export function createResumeSafeStdout(stdout: NodeJS.WriteStream): ResumeSafeStdout {
  let suppressNextWrite = false;
  let frame: string | undefined;                 // the last live frame, as painted
  let justErased = false;                        // previous write was erase-only → the next bare write is <Static>
  const targetWrite = stdout.write.bind(stdout) as (...args: any[]) => boolean;
  // Four kinds of write reach here and only one of them is the live frame. FRAME writes carry the erase prefix (or
  // none, at first paint) and content: record what remains. ERASE-ONLY writes (`Instance.clear()`) leave nothing
  // after the strip — the tree is unchanged, so keep the frame we have. STATIC writes are committed scrollback;
  // ink.js emits them as `log.clear()` → `write(staticOutput)` → `log(output)`, so the bare write immediately after
  // an erase-only one is the scrollback and the one after it is the real frame. SUPPRESSED writes never reached the
  // terminal, so they never painted anything.
  const record = (chunk: unknown): void => {
    if (typeof chunk !== "string") return;
    const prefix = chunk.match(INK_ERASE_PREFIX)?.[0] ?? "";
    const body = chunk.slice(prefix.length);
    if (body === "") { justErased = true; return; }
    if (prefix === "" && justErased) { justErased = false; return; }
    justErased = false; frame = body;
  };
  const write = ((...args: any[]): boolean => {
    if (!suppressNextWrite) { record(args[0]); return targetWrite(...args); }
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
  const app = render(
    <UserKeymap file={keybindingsFile} onIssues={(issues) => { for (const line of formatIssues(issues, keybindingsFile)) notices.notify(line); }}>
      <ChatApp makeSession={makeSession} client={opts.client} cwd={opts.cwd}
        initialPrompt={opts.initialPrompt} initialResume={opts.initialResume} initialEntries={opts.initialEntries}
        clearStaticTranscript={bridge.clearStaticTranscript} noticeBridge={notices}
        hookOpts={hookOpts} onDetach={opts.onDetach} resumeOutput={output}
        initialTodosOpen={prefs.showExpandedTodos ?? true} />
    </UserKeymap>,
    { exitOnCtrlC: false, stdout: output.stdout },
  );
  bridge.bind(() => app.clear());
  await app.waitUntilExit();
}
