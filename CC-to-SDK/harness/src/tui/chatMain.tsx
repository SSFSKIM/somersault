// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { render } from "ink";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import type { RenderLine } from "./render.js";
import type { InitialResume } from "./commands.js";

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
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string };
  onDetach?: () => void;
  // Test seam; default builds remoteChatSession(socketPath, { resume }).
  makeSession?: (resume?: string) => ChatSession;
}

export async function runChatClient(opts: ChatClientOpts): Promise<void> {
  const makeSession = opts.makeSession ?? ((resume?: string) => remoteChatSession(opts.socketPath, { ...(resume ? { resume } : {}) }));
  const app = render(
    <ChatApp makeSession={makeSession} client={opts.client} cwd={opts.cwd}
      initialPrompt={opts.initialPrompt} initialResume={opts.initialResume} initialLines={opts.initialLines}
      hookOpts={opts.hookOpts} onDetach={opts.onDetach} />,
    { exitOnCtrlC: false },
  );
  await app.waitUntilExit();
}
