// cli/serveSignals.test.ts — `ccx serve`'s stop-signal wiring, asserted through the real exported
// onStopSignals with an injected emitter. No process signals, no port, no filesystem.
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { onStopSignals } from "../../../src/cli/serveMain.js";

describe("onStopSignals", () => {
  it("SIGTERM runs the guarded shutdown — a service manager, a container runtime and a plain `kill` all send it", () => {
    // Only SIGINT was handled, so SIGTERM killed the process outright: server.shutdown() never ran, parked
    // decisions were never settled and no subscriber ever got thread/closed.
    const proc = new EventEmitter();
    let stops = 0;
    onStopSignals(() => void stops++, proc);
    proc.emit("SIGTERM");
    expect(stops).toBe(1);
  });

  it("SIGINT still runs it", () => {
    const proc = new EventEmitter();
    let stops = 0;
    onStopSignals(() => void stops++, proc);
    proc.emit("SIGINT");
    expect(stops).toBe(1);
  });

  it("both signals (in either order, or repeated) stop exactly once, and neither listener is left behind", () => {
    for (const [first, second] of [["SIGINT", "SIGTERM"], ["SIGTERM", "SIGINT"]] as const) {
      const proc = new EventEmitter();
      let stops = 0;
      onStopSignals(() => void stops++, proc);
      expect(proc.listenerCount(first) + proc.listenerCount(second)).toBe(2);
      proc.emit(first);
      proc.emit(second);
      proc.emit(first);
      expect(stops).toBe(1);
      // both are unregistered, so the surviving one cannot keep suppressing the default kill afterwards
      expect(proc.listenerCount("SIGINT")).toBe(0);
      expect(proc.listenerCount("SIGTERM")).toBe(0);
    }
  });
});
