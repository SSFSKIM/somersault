import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { renderAgents } from "../../src/cli/agents.js";
import type { AgentsRow } from "../../src/fleet/project.js";
import { agentsRow } from "../unit/fixtures/agents-rows.js";

/** The python filter from doperpowers `_lib.sh:_poll_until_done`, copied BYTE-FOR-BYTE out of the
 *  `python3 -c '...'` string (comment and all; `_poll_uuid` runs the same body minus that comment).
 *  Reformatting it would make this a test against our paraphrase — the mistake that killed design
 *  rev 1. If our JSON does not satisfy THIS, spawn/resume hang until the watcher times out. */
const FILTER = `
import json, os, sys
s = os.environ["DAEMON_SHORT"]
try:
    d = json.load(sys.stdin)
except Exception:
    d = []
for a in d:
    # A row with an empty sessionId is unusable (and would jumble the whitespace
    # parsing downstream) — keep polling until the uuid materializes.
    if a.get("id") == s and a.get("sessionId"):
        st = a.get("state", "")
        if st == "working" and a.get("status") == "idle":
            st = "done"
        print(a.get("sessionId"), st, a.get("cwd", "")); break
`;

/** execFileSync, not execFile: only the *Sync/spawn family accepts `input`. `execFile` would leave the
 *  child's stdin open and unwritten, and the filter's `json.load(sys.stdin)` would block forever. */
function poll(rows: AgentsRow[], short: string): string {
  const json = renderAgents(rows, { json: true, all: true });   // the poller always passes --json --all
  return execFileSync("python3", ["-c", FILTER], {
    env: { ...process.env, DAEMON_SHORT: short }, input: json, encoding: "utf8", timeout: 10_000,
  }).trim();
}

/** The shell reads the filter's line as `read -r uuid state cwd`, then terminates on
 *  `case "$state" in done | blocked | error)`. So field 1 is what decides the loop. */
const state = (line: string): string => line.split(" ")[1] ?? "";

describe("doperpowers _poll_until_done contract", () => {
  it("extracts uuid, state and cwd from a working row", () => {
    expect(poll([agentsRow()], "a1b2c3d4")).toBe("sid-1 working /w");
  });
  it("terminates on a done row — the acceptance-3 case that rev 1 would have broken", () => {
    // A finished session must STILL be listed. If `agents` dropped it, the filter would print nothing,
    // $state would stay empty, and the watcher would poll a finished worker until DAEMON_TIMEOUT.
    const line = poll([agentsRow({ state: "done", status: "idle" })], "a1b2c3d4");
    expect(line).toBe("sid-1 done /w");
    expect(state(line)).toBe("done");                // the token the shell's terminating case arm matches
  });
  it("coerces working+idle to done, exactly as the script does", () => {
    expect(poll([agentsRow({ state: "working", status: "idle" })], "a1b2c3d4")).toBe("sid-1 done /w");
  });
  it("terminates on blocked and on error", () => {
    expect(state(poll([agentsRow({ state: "blocked", status: "idle" })], "a1b2c3d4"))).toBe("blocked");
    expect(state(poll([agentsRow({ state: "error", status: "idle" })], "a1b2c3d4"))).toBe("error");
  });
  it("does NOT terminate this poller on stopped — a real hazard, pinned rather than fixed", () => {
    // `stopped` is one of OUR fleet states (fleet/roster.ts TERMINAL), and our JSON here is correct —
    // but this filter's shell only matches `case "$state" in done | blocked | error)`, so a session
    // that finalizes as `stopped` prints a well-formed line that loop just ignores until DAEMON_TIMEOUT.
    // We can't fix this from our side (a different doperpowers script handles `stopped` correctly);
    // this test only makes sure the next reader trips over the fact instead of rediscovering it live.
    expect(poll([agentsRow({ state: "stopped", status: "idle" })], "a1b2c3d4")).toBe("sid-1 stopped /w");
  });
  it("yields nothing while sessionId is empty — the startup window keeps the poller waiting", () => {
    const rows = [agentsRow({ sessionId: "" })];
    expect(poll(rows, "a1b2c3d4")).toBe("");
    // Empty output alone can't prove THIS is why: it's also what the filter prints for a dropped row,
    // a renamed key, malformed JSON, or a wrong id — a mutation run confirmed it (renaming sessionId
    // throughout broke five tests and left this one standing). Assert the row genuinely made it into
    // our own JSON mid-startup, so "silently dropped" would fail here instead of surviving unnoticed.
    const rendered = JSON.parse(renderAgents(rows, { json: true, all: true }));
    expect(rendered).toContainEqual(expect.objectContaining({ id: "a1b2c3d4", sessionId: "" }));
  });
  it("reports a worktree cwd verbatim, since the script uses it to locate the worktree", () => {
    expect(poll([agentsRow({ state: "done", status: "idle", cwd: "/repo/.claude/worktrees/wt" })], "a1b2c3d4"))
      .toBe("sid-1 done /repo/.claude/worktrees/wt");
  });
});
