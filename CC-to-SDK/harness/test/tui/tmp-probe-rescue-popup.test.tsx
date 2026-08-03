// THROWAWAY PROBE (whole-branch review) — delete after run. Reproduces: busy turn + queued message +
// open '/' command popup, then Ctrl-C (ChatApp-level interrupt → queue rescue prefill lands while the
// composer is still mounted with the popup open), then Enter. Question: does Enter submit the merged
// rescued buffer, or does the stale command popup hijack it via submitCommand?
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout: " + cond.toString()); await new Promise((r) => setTimeout(r, 5)); }
}

describe("probe: rescue prefill vs open command popup", () => {
  it("Ctrl-C rescue with '/mod' popup open, then Enter", async () => {
    const submitted: string[] = [];
    let interrupted = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async (p: string) => { submitted.push(p); fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
      interrupt: async () => { interrupted++; },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("⟳"));            // busy
    stdin.write("one"); await waitFor(() => frame(lastFrame).includes("one"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("⋯ queued: one")); // queued
    stdin.write("/mod");                                             // command popup opens (buffer was empty)
    await waitFor(() => frame(lastFrame).includes("/model"));        // popup shows matches
    stdin.write("\x03");                                             // Ctrl-C: busy → interrupt + rescue
    await waitFor(() => interrupted === 1);
    await waitFor(() => !frame(lastFrame).includes("⋯ queued:"));    // queue rescued into composer
    const afterRescue = frame(lastFrame);
    console.log("=== FRAME AFTER RESCUE ===\n" + afterRescue + "\n===");
    stdin.write("\r");                                               // Enter — user resends the rescued text
    await new Promise((r) => setTimeout(r, 100));
    console.log("=== SUBMITTED ===", JSON.stringify(submitted));
    console.log("=== FRAME AFTER ENTER ===\n" + frame(lastFrame) + "\n===");
    expect(submitted.length).toBeGreaterThanOrEqual(1);
  }, 15000);
});
