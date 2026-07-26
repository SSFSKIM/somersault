import { describe, it, expect } from "vitest";
import { projectRow } from "../../src/fleet/project.js";
import type { RosterRow } from "../../src/fleet/roster.js";

const roster = (over: Partial<RosterRow> = {}): RosterRow => ({
  short: "a1b2c3d4", sessionId: "sid-1", pid: 100, cwd: "/w", kind: "bg", name: "w1", state: "working", startedAt: 1, ...over,
});

describe("projectRow — the four arms", () => {
  it("arm 1: a terminal roster state projects as-is, even long after exit", () => {
    // Acceptance 3: a finished session must STILL be listed, or _poll_until_done never terminates.
    const r = projectRow({ roster: roster({ state: "done", endedAt: 9 }), pidLive: false, socketAnswers: false });
    expect(r.state).toBe("done"); expect(r.status).toBe("idle");
  });
  it("arm 1 covers stopped and error too", () => {
    expect(projectRow({ roster: roster({ state: "stopped" }), pidLive: false, socketAnswers: false }).state).toBe("stopped");
    expect(projectRow({ roster: roster({ state: "error" }), pidLive: false, socketAnswers: false }).state).toBe("error");
  });
  it("arm 1 BEATS a live host — reordering the terminal guard is the regression this catches", () => {
    // Every other arm-1 test passes pidLive:false, so moving the terminal guard below the live arms
    // keeps the suite green. This is the one that notices: a `done` session whose pid was recycled and
    // whose socket answers must still report done, not the stranger's live status.
    const r = projectRow({ roster: roster({ state: "done" }), pidLive: true, socketAnswers: true, liveStatus: { state: "working", status: "busy" } });
    expect(r.state).toBe("done"); expect(r.status).toBe("idle"); expect(r.unresponsive).toBeUndefined();
  });
  it("arm 1 reports its OWN sessionId — there is no second source to override it", () => {
    // The engine's registry is filed by the pid of the CLI subprocess the SDK spawns, not ours, so a row
    // that did match our pid is a different process. Handing the consumer a stranger's sessionId — to
    // resume, reply to or delete — is worse than handing it none, which is why ProjectInput has no
    // registry input at all any more.
    const r = projectRow({ roster: roster({ state: "done", sessionId: "sid-mine" }), pidLive: true, socketAnswers: true });
    expect(r.sessionId).toBe("sid-mine");
  });
  it("an answering socket suppresses `unresponsive` even with no live status to report", () => {
    // Deleting this branch leaves the suite green while every healthy host reads as hung.
    const r = projectRow({ roster: roster(), pidLive: true, socketAnswers: true });
    expect(r.unresponsive).toBeUndefined(); expect(r.status).toBe("busy");
  });
  it("arm 2: live pid + answering socket projects the LIVE status from the host", () => {
    const r = projectRow({ roster: roster(), pidLive: true, socketAnswers: true, liveStatus: { state: "blocked", status: "idle" } });
    expect(r.state).toBe("blocked"); expect(r.status).toBe("idle"); expect(r.unresponsive).toBeUndefined();
  });
  it("arm 3: live pid + silent socket keeps the roster state and flags unresponsive", () => {
    // A live process is not evidence of failure; adjudicating a hang is the spawner's timeout to make.
    const r = projectRow({ roster: roster({ state: "working" }), pidLive: true, socketAnswers: false });
    expect(r.state).toBe("working"); expect(r.unresponsive).toBe(true);
  });
  it("arm 4: non-terminal roster + dead pid projects error", () => {
    // Acceptance 9b: a SIGKILLed host must not report `working` forever and hang the poller.
    const r = projectRow({ roster: roster({ state: "working" }), pidLive: false, socketAnswers: false });
    expect(r.state).toBe("error"); expect(r.status).toBe("idle");
  });
  it("emits '' until the host has stamped a sessionId, and the stamped one once it has", () => {
    // The poller treats an empty sessionId as not-yet-ready and keeps waiting — that is the startup
    // window, and it must CLOSE while the turn is still running (the host stamps its row from the
    // engine's init frame), not at exit: the consumer gives up after ~60s.
    expect(projectRow({ roster: roster({ sessionId: undefined }), pidLive: true, socketAnswers: true }).sessionId).toBe("");
    expect(projectRow({ roster: roster({ sessionId: "sid-live" }), pidLive: true, socketAnswers: true }).sessionId).toBe("sid-live");
  });
  it("emits the short id as `id` and carries cwd and name", () => {
    const r = projectRow({ roster: roster({ cwd: "/repo/.claude/worktrees/wt" }), pidLive: false, socketAnswers: false });
    expect(r.id).toBe("a1b2c3d4"); expect(r.cwd).toBe("/repo/.claude/worktrees/wt"); expect(r.name).toBe("w1");
  });
});
