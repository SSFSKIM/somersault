// test/unit/warning-channel.test.ts — Wave-2 Task 4 (s2qa3-11). The SDK answers `canUseTool` +
// `bypassPermissions` with `process.emitWarning(…, { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" })`, and Node's
// DEFAULT warning listener prints that straight to stderr — i.e. over the Ink frame, right after the bypass
// consent gate. These tests pin the takeover: routing is a pure function (no subprocess, no real stderr), and
// the installer owns the channel outright (Node's own listener gone, exactly one of ours).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { routeWarning, installWarningChannel } from "../../src/cli/warningChannel.js";

/** The two sinks the router writes to, recorded instead of written. */
function fakeSink() {
  const stderr: string[] = [];
  const debug: string[] = [];
  return { stderr, debug, sink: { stderr: (l: string) => { stderr.push(l); }, debug: (l: string) => { debug.push(l); } } };
}

const warn = (message: string, o: { code?: string; name?: string } = {}): Error & { code?: string } => {
  const e = new Error(message) as Error & { code?: string };
  e.name = o.name ?? "Warning";
  if (o.code) e.code = o.code;
  return e;
};

describe("routeWarning", () => {
  it("drops a CLAUDE_SDK_ warning off stderr and into the debug seam", () => {
    const { stderr, debug, sink } = fakeSink();
    routeWarning(warn("canUseTool is shadowed by bypassPermissions", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" }), sink);
    expect(stderr).toEqual([]);
    expect(debug).toEqual(["CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: canUseTool is shadowed by bypassPermissions"]);
  });

  // The SDK today emits BOTH shadowing branches (bypassPermissions, and bare `allowedTools` entries) under the
  // single code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` — there is no sibling code to cover. The router still matches
  // by PREFIX so a code the SDK adds later is routed the same way without a second edit; this pins that, with a
  // code the SDK does not emit standing in for the hypothetical future one.
  it("routes any CLAUDE_SDK_ code by PREFIX, not by the one exact code the SDK emits today", () => {
    const { stderr, debug, sink } = fakeSink();
    routeWarning(warn("some future shadowing warning", { code: "CLAUDE_SDK_SOMETHING_NEW" }), sink);
    expect(stderr).toEqual([]);
    expect(debug.length).toBe(1);
  });

  it("re-prints every other warning ONCE, in ccx's own stderr shape", () => {
    const { stderr, debug, sink } = fakeSink();
    routeWarning(warn("something else happened", { code: "OTHER" }), sink);
    expect(stderr).toEqual(["ccx: warning: something else happened"]);
    expect(debug).toEqual([]);
  });

  it("keeps a non-plain warning name (DeprecationWarning etc.) and needs no code at all", () => {
    const { stderr, sink } = fakeSink();
    routeWarning(warn("fs.rmdir is deprecated", { name: "DeprecationWarning" }), sink);
    expect(stderr).toEqual(["ccx: warning: DeprecationWarning: fs.rmdir is deprecated"]);
  });
});

// Every test above injects a fake sink, so NONE of them can see the sink production actually uses. These call
// `routeWarning` with no sink argument, which is the shape `installWarningChannel()` runs in `bin.ts`. Two things
// are pinned that a fake sink cannot pin: the writes go through `console.error` (Ink's `patchConsole` routes that
// through `writeToStderr`, which clears the frame, writes, and repaints — a bare `process.stderr.write` would
// paint over a live frame instead), and the CCX_DEBUG guard on the debug sink is really there.
describe("the default sink (no sink injected — what bin.ts actually runs)", () => {
  let errors: unknown[][] = [];
  let spy: ReturnType<typeof vi.spyOn>;
  const savedDebug = process.env.CCX_DEBUG;
  beforeEach(() => { errors = []; spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a); }); });
  afterEach(() => {
    spy.mockRestore();
    if (savedDebug === undefined) delete process.env.CCX_DEBUG; else process.env.CCX_DEBUG = savedDebug;
  });

  it("prints an SDK-coded warning NOWHERE without CCX_DEBUG", () => {
    delete process.env.CCX_DEBUG;
    routeWarning(warn("canUseTool will be ignored", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" }));
    expect(errors).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints an SDK-coded warning exactly once, via console.error, WITH CCX_DEBUG", () => {
    process.env.CCX_DEBUG = "1";
    routeWarning(warn("canUseTool will be ignored", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" }));
    expect(errors).toEqual([["CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: canUseTool will be ignored"]]);
  });

  it("prints an other-coded warning exactly ONCE, via console.error, regardless of CCX_DEBUG", () => {
    delete process.env.CCX_DEBUG;
    routeWarning(warn("something else happened", { code: "OTHER" }));
    expect(errors).toEqual([["ccx: warning: something else happened"]]);
    process.env.CCX_DEBUG = "1";
    routeWarning(warn("and again", { code: "OTHER" }));
    expect(errors).toEqual([["ccx: warning: something else happened"], ["ccx: warning: and again"]]);
  });
});

describe("installWarningChannel", () => {
  let saved: ((...a: unknown[]) => void)[] = [];
  beforeEach(() => { saved = process.listeners("warning") as unknown as typeof saved; });
  afterEach(() => {
    process.removeAllListeners("warning");
    for (const l of saved) process.on("warning", l as never);
  });

  it("takes the channel over: Node's default listener is gone and exactly one listener is ours", () => {
    installWarningChannel(fakeSink().sink);
    expect(process.listeners("warning").length).toBe(1);
    // installing twice must not double-print
    installWarningChannel(fakeSink().sink);
    expect(process.listeners("warning").length).toBe(1);
  });

  it("a real process.emitWarning with the SDK code reaches the debug seam and never stderr", async () => {
    const { stderr, debug, sink } = fakeSink();
    installWarningChannel(sink);
    process.emitWarning("canUseTool will be ignored", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" });
    await new Promise((r) => setImmediate(r));     // emitWarning emits on nextTick, never synchronously
    expect(stderr).toEqual([]);
    expect(debug).toEqual(["CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: canUseTool will be ignored"]);
  });

  it("a real process.emitWarning with any other code is re-printed once in ccx shape", async () => {
    const { stderr, debug, sink } = fakeSink();
    installWarningChannel(sink);
    process.emitWarning("y", { code: "OTHER" });
    await new Promise((r) => setImmediate(r));
    expect(stderr).toEqual(["ccx: warning: y"]);
    expect(debug).toEqual([]);
  });
});
