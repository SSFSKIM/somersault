import { connect } from "node:net";
import type { FleetState } from "./roster.js";
import type { HostStatus } from "../host/ops.js";

/** A budget for the WHOLE exchange, not an inactivity window. `socket.setTimeout` is reset by every
 *  byte — so a peer dribbling bytes with no newline holds the probe open forever — and node clears it
 *  outright when the socket is destroyed. Only a plain timer nothing can reset actually bounds this. */
const DEADLINE_MS = 250;
/** HostServer bounds an inbound frame at 256 KiB; an unbounded reply buffer is that same leak facing
 *  the other way, and `agents` runs in a poller's loop. */
const MAX_REPLY = 256 * 1024;

/** Exhaustive by construction: add a FleetState without listing it here and this fails to typecheck. */
const STATES: Record<FleetState, true> = { working: true, blocked: true, done: true, error: true, stopped: true };

/** A reply we cannot use is `undefined`, never a half-filled row: `{"ok":true}` with no `state` would
 *  otherwise reach projectRow and serialize as `"state": undefined`, breaking the row contract the
 *  poller reads with `.get("state")`. Validate every field we actually project. */
function parseStatus(line: string): HostStatus | undefined {
  let j: any;
  try { j = JSON.parse(line); } catch { return undefined; }
  if (!j?.ok || typeof j.state !== "string" || !Object.hasOwn(STATES, j.state)) return undefined;
  if (j.status !== "busy" && j.status !== "idle") return undefined;
  return { state: j.state as FleetState, status: j.status, ...(typeof j.waitingFor === "string" ? { waitingFor: j.waitingFor } : {}) };
}

/** One `status` op over a host's UDS. `undefined` means "no usable answer" — this never throws and,
 *  more importantly, never stays pending: reply, parse failure, error, EOF (`close`), oversize reply
 *  and the deadline all settle it exactly once. A pending probe would hang `collectFleet`, and a
 *  listing that never prints teaches a polling shell nothing at all. */
export async function askStatus(path: string): Promise<HostStatus | undefined> {
  return await new Promise((resolve) => {
    const s = connect({ path }, () => s.write(JSON.stringify({ op: "status" }) + "\n"));
    let buf = "", settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = (v?: HostStatus) => { if (settled) return; settled = true; clearTimeout(timer); s.destroy(); resolve(v); };
    timer = setTimeout(() => done(undefined), DEADLINE_MS);
    s.on("data", (d) => {
      buf += d; const i = buf.indexOf("\n");
      if (i >= 0) return done(parseStatus(buf.slice(0, i)));
      if (buf.length > MAX_REPLY) done(undefined);
    });
    s.on("error", () => done(undefined));
    // the reachable one: HostServer.close() destroys open connections during `ccx stop`, after our
    // request frame has been read — a peer-initiated EOF with no reply in it
    s.on("close", () => done(undefined));
  });
}
