// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { render } from "ink";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import type { RenderLine } from "./render.js";
import type { InitialResume } from "./commands.js";
import { loadPrefs } from "./prefs.js";
import { setTheme } from "./theme.js";

export interface ChatClientOpts {
  socketPath: string;
  client: { kind: "loopback" | "attached"; short?: string };
  cwd: string;
  initialPrompt?: string;
  // Launch-time --resume: useChat's resumeInto owns replay + the adapter's resume op.
  initialResume?: InitialResume;
  // Pre-rendered transcript replay (attach, Task 8) or the banner.
  initialLines?: RenderLine[];
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
}

export function createResumeSafeStdout(stdout: NodeJS.WriteStream): ResumeSafeStdout {
  let suppressNextWrite = false;
  const targetWrite = stdout.write.bind(stdout) as (...args: any[]) => boolean;
  const write = ((...args: any[]): boolean => {
    if (!suppressNextWrite) return targetWrite(...args);
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
    repaint(runInkWrite) {
      suppressNextWrite = true;
      try { runInkWrite(); } finally { suppressNextWrite = false; }
    },
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
  const app = render(
    <ChatApp makeSession={makeSession} client={opts.client} cwd={opts.cwd}
      initialPrompt={opts.initialPrompt} initialResume={opts.initialResume} initialLines={opts.initialLines}
      hookOpts={hookOpts} onDetach={opts.onDetach} resumeOutput={output} />,
    { exitOnCtrlC: false, stdout: output.stdout },
  );
  await app.waitUntilExit();
}
