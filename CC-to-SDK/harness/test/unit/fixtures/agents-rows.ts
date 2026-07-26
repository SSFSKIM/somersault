import type { AgentsRow } from "../../../src/fleet/project.js";

/** One `agents --json` row, overridable field by field — the exact shape doperpowers' poller parses.
 *  Defaults describe a live, busy worker; every terminal case is a one-field override. */
export const agentsRow = (o: Partial<AgentsRow> = {}): AgentsRow =>
  ({ id: "a1b2c3d4", sessionId: "sid-1", state: "working", status: "busy", cwd: "/w", name: "w1", ...o });
