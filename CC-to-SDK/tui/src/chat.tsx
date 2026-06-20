// tui/src/chat.tsx — bin entry for cc-harness-chat: open an in-process Session in default mode wired to the
// ui permission broker, render <ChatApp>.
import React from "react";
import { render } from "ink";
import { openSession } from "cc-harness";
import { createUiBroker } from "./uiBroker.js";
import { ChatApp } from "./ChatApp.js";
import { parseResumeIntent, parseLaunchMode, parseLaunchThink } from "./commands.js";
import { thinkBudget } from "./thinkLevels.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : undefined; }

const ui = createUiBroker();
const launchMode = parseLaunchMode(args);
const rawMode = flag("--permission-mode");
if (rawMode && rawMode !== launchMode) process.stderr.write(`cc-harness-chat: unknown --permission-mode "${rawMode}", using default\n`);
const launchThink = parseLaunchThink(args);
const thinking = launchThink === "off" ? { type: "disabled" as const }
               : launchThink ? { type: "enabled" as const, budgetTokens: thinkBudget(launchThink) }
               : undefined;
const base = { model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: launchMode, ...(thinking ? { thinking } : {}), permissionBroker: ui.broker, contextTool: true, includePartialMessages: true, forwardSubagentText: true };
const initialResume = parseResumeIntent(args);
const makeSession = (resume?: string) => openSession({ ...base, ...(resume ? { resume } : {}) });
render(<ChatApp makeSession={makeSession} broker={ui} cwd={base.cwd} initialResume={initialResume} hookOpts={{ initialMode: launchMode, initialThink: launchThink ?? "default" }} />);
