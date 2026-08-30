// harness/src/cli/attach.ts — resolve a target to a live socket + build the replay lines.
import { resolveTarget } from "./lifecycle.js";
import { hostSocketPath } from "../fleet/paths.js";
import { TERMINAL } from "../fleet/roster.js";
import { getSessionMessages } from "../sessions/index.js";
import { diskStampOf } from "../sessions/rows.js";
import type { TranscriptBootstrapEntry } from "../tui/transcriptModel.js";

export interface PrepareAttachDeps {
  resolve?: typeof resolveTarget;
  messages?: (id: string, opts: { cwd?: string }) => Promise<unknown[]>;
}

/** Resolve + read the PAST (disk) half of the attach replay. The LIVE half (mid-turn buffer, parked
 *  permissions, current state) arrives over the socket via the adapter's replay-first event stream —
 *  probe 62 proved the disk transcript contains COMPLETED turns only, so disk-then-follow covers
 *  everything, and there is deliberately no uuid-dedup layer: host.follow() only replays a `turn start`
 *  for an IN-FLIGHT turn, and an idle buffer replay (whose content the disk transcript already covers)
 *  gets no start frame — the REPL's no-live-turn guard drops it without needing to compare uuids. */
export async function prepareAttach(target: string, deps: PrepareAttachDeps = {}): Promise<{ socketPath: string; short: string; sessionId?: string; cwd: string; initialEntries: TranscriptBootstrapEntry[]; diskStamp?: { lastUuid?: string; count: number } }> {
  const row = (deps.resolve ?? resolveTarget)(target);
  if (TERMINAL.has(row.state)) throw new Error(`session ${row.short} has ended (${row.state}) — resume it with: ccx --resume ${row.sessionId ?? "<uuid>"}`);
  // ONE ordered, identity-bearing stream (F1 Task 4) — never a flattened `RenderLine[]` and never a second
  // local channel beside it: disk rows stay raw so the client's document owns projection, and the fallback
  // notice travels as the local envelope it actually is rather than masquerading as persisted history.
  let initialEntries: TranscriptBootstrapEntry[] = [];
  // bl9 D14: the disk stamp of THIS read, over the same raw rows `initialEntries` was built from. `ccx
  // attach` reads disk before it follows (below → main.ts → the Ink mount → the socket connect), so the
  // transcript can be truncated by a concurrent rewind in the gap between this read and the follow ack.
  // `useChat`'s post-follow reconcile re-reads once and compares against this stamp — undefined here (no
  // session, or the read failed) means there is nothing to reconcile against, which is the reconcile's own
  // no-op guard (A5).
  let diskStamp: { lastUuid?: string; count: number } | undefined;
  if (row.sessionId) {
    try {
      const messages = await (deps.messages ?? ((id, o) => getSessionMessages(id, o)))(row.sessionId, { cwd: row.cwd });
      initialEntries = messages.map((message) => ({ kind: "sdk", source: "disk", message: message as Record<string, unknown> }));
      diskStamp = diskStampOf(messages);
    } catch {
      initialEntries = [{ kind: "local", identity: "attach:no-persisted-history", event: { kind: "notice", lines: [{ text: "⚠ no persisted history yet — showing live turn only", dim: true }] } }];
    }
  }
  return { socketPath: hostSocketPath(row.pid), short: row.short, sessionId: row.sessionId, cwd: row.cwd, initialEntries, diskStamp };
}
