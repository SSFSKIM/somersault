// tui/src/chat.tsx — bin entry for cc-harness-chat: open an in-process Session in default mode wired to the
// ui permission broker, render <ChatApp>.
import React from "react";
import { render } from "ink";
import { openSession } from "cc-harness";
import { createUiBroker } from "./uiBroker.js";
import { ChatApp } from "./ChatApp.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : undefined; }

const ui = createUiBroker();
const base = { model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: "default" as const, permissionBroker: ui.broker, contextTool: true, includePartialMessages: true, forwardSubagentText: true };
const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) });
render(<ChatApp makeSession={makeSession} broker={ui} />);
