import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { resolveOptions } from "../config/resolveOptions.js";
import type { HarnessConfig } from "../config/types.js";
import { validateHarnessConfig } from "../config/validate.js";
import { Session, type SessionDeps } from "./session.js";

export interface OpenSessionConfig extends HarnessConfig { contextTool?: boolean; compactTool?: boolean; }
export interface SessionDepsInput { query?: SessionDeps["query"]; }

/** Open a new interactive multi-turn session. Honors the full HarnessConfig (via resolveOptions).
 *  `contextTool`/`compactTool` are session-level booleans — they wire the in-process MCP tools, never SDK options. */
export function openSession(config: OpenSessionConfig = {}, deps: SessionDepsInput = {}): Session {
  validateHarnessConfig(config);
  const query = deps.query ?? sdkQuery;
  return new Session({ query }, resolveOptions(config), { contextTool: config.contextTool, compactTool: config.compactTool });
}

/** Resume a prior session by id. `resume` PRESERVES the session_id, so the returned Session's
 *  .sessionId equals `id` once its first turn's init fires. */
export function resumeSession(id: string, config: OpenSessionConfig = {}, deps?: SessionDepsInput): Session {
  return openSession({ ...config, resume: id }, deps);
}

/** Time-travel: resume `id` only up to (and including) the message with uuid `messageId` — the
 *  conversation-rewind (Esc-Esc) primitive (probes 37/37b). The anchor may be an assistant OR a
 *  user message uuid from the persisted transcript (getSessionMessages); user-prompt uuids also
 *  anchor file-checkpoint rewind, so one anchor drives both (`session.rewind(anchor)` after the
 *  first turn restores the files too).
 *  DESTRUCTIVE by default: the rewound branch keeps the SAME session id and TRUNCATES the persisted
 *  transcript at the anchor — the tail is unrecoverable. Pass `fork: true` for a non-destructive
 *  branch: a NEW session id anchored at `messageId`, original transcript intact. */
export function rewindSession(id: string, messageId: string, config: OpenSessionConfig & { fork?: boolean } = {}, deps?: SessionDepsInput): Session {
  const { fork, ...rest } = config;
  return openSession({ ...rest, resume: id, resumeAt: messageId, ...(fork ? { forkSession: true } : {}) }, deps);
}

export { Session };
export type { SessionDeps, SessionOpts } from "./session.js";
