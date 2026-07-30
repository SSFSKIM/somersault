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

  it("both signals (in either order, or repeated) stop exactly once, and neither listener is left behind", async () => {
    for (const [first, second] of [["SIGINT", "SIGTERM"], ["SIGTERM", "SIGINT"]] as const) {
      const proc = new EventEmitter();
      let stops = 0;
      onStopSignals(() => void stops++, proc);
      expect(proc.listenerCount(first) + proc.listenerCount(second)).toBe(2);
      proc.emit(first);
      proc.emit(second);
      proc.emit(first);
      expect(stops).toBe(1);
      // Listener removal is deferred until `stop`'s (possibly-async) work settles — even a synchronous
      // `stop` here only resolves on a microtask, so the removal below isn't visible until we yield one.
      await Promise.resolve();
      // both are unregistered, so the surviving one cannot keep suppressing the default kill afterwards
      expect(proc.listenerCount("SIGINT")).toBe(0);
      expect(proc.listenerCount("SIGTERM")).toBe(0);
    }
  });

  it("keeps both listeners attached while an async `stop` is still in flight, and removes them only once it settles — the whole point of the fix (an eager removal restores the default signal disposition and lets the in-flight signal kill the process before teardown finishes)", async () => {
    const proc = new EventEmitter();
    let releaseStop: () => void = () => {};
    const stopStarted = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    let settled = false;
    onStopSignals(async () => {
      await stopStarted; // held open until the test releases it
      settled = true;
    }, proc);

    proc.emit("SIGTERM");
    // Teardown is in flight: both listeners must still be attached, or a second real signal delivered
    // right now would have nothing stopping the default kill from tearing the process down mid-shutdown.
    expect(settled).toBe(false);
    expect(proc.listenerCount("SIGINT")).toBe(1);
    expect(proc.listenerCount("SIGTERM")).toBe(1);

    releaseStop();
    await Promise.resolve();
    await Promise.resolve(); // let the `stop` continuation and the `.finally` cleanup both run

    expect(settled).toBe(true);
    expect(proc.listenerCount("SIGINT")).toBe(0);
    expect(proc.listenerCount("SIGTERM")).toBe(0);
  });

  it("a second signal arriving mid-teardown does not start a second shutdown", async () => {
    const proc = new EventEmitter();
    let starts = 0;
    let releaseStop: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    onStopSignals(async () => {
      starts++;
      await gate;
    }, proc);

    proc.emit("SIGTERM"); // first signal: starts the (held-open) teardown
    proc.emit("SIGINT"); // second signal, mid-teardown: must be a no-op
    proc.emit("SIGTERM"); // a repeat of the same signal, mid-teardown: also a no-op
    expect(starts).toBe(1);

    releaseStop();
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toBe(1); // still exactly one shutdown, even after the held-open one has settled
  });
});
