// harness/src/cli/attach.ts — resolve a target to a live socket + build the replay lines.
import { resolveTarget } from "./lifecycle.js";
import { hostSocketPath } from "../fleet/paths.js";
import { TERMINAL } from "../fleet/roster.js";
import { getSessionMessages } from "../sessions/index.js";
import { replayLines } from "../tui/replay.js";
import type { RenderLine } from "../tui/render.js";

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
export async function prepareAttach(target: string, deps: PrepareAttachDeps = {}): Promise<{ socketPath: string; short: string; sessionId?: string; cwd: string; initialLines: RenderLine[] }> {
  const row = (deps.resolve ?? resolveTarget)(target);
  if (TERMINAL.has(row.state)) throw new Error(`session ${row.short} has ended (${row.state}) — resume it with: ccx --resume ${row.sessionId ?? "<uuid>"}`);
  let initialLines: RenderLine[] = [];
  if (row.sessionId) {
    try { initialLines = replayLines(await (deps.messages ?? ((id, o) => getSessionMessages(id, o)))(row.sessionId, { cwd: row.cwd }), { id: row.sessionId }); }
    catch { initialLines = [{ text: "⚠ no persisted history yet — showing live turn only", dim: true }]; }
  }
  return { socketPath: hostSocketPath(row.pid), short: row.short, sessionId: row.sessionId, cwd: row.cwd, initialLines };
}
