// test/unit/warning-channel.test.ts — Wave-2 Task 4 (s2qa3-11). The SDK answers `canUseTool` +
// `bypassPermissions` with `process.emitWarning(…, { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" })`, and Node's
// DEFAULT warning listener prints that straight to stderr — i.e. over the Ink frame, right after the bypass
// consent gate. These tests pin the takeover: routing is a pure function (no subprocess, no real stderr), and
// the installer owns the channel outright (Node's own listener gone, exactly one of ours).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("covers the sibling allowedTools warning by PREFIX, not by exact code", () => {
    const { stderr, debug, sink } = fakeSink();
    routeWarning(warn("allowedTools is shadowed", { code: "CLAUDE_SDK_ALLOWED_TOOLS_SHADOWED" }), sink);
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
