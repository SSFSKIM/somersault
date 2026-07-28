// tui/test/chat.test.tsx — reworked onto the adapter surface: `broker` prop is gone; ChatApp takes
// `client: { kind, short? }` + `onDetach?`. fakeRemote() (test/tui/helpers/fakeRemote.ts) mirrors the real
// RemoteChat wire contract (spec A2b Task 6).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function pressUntil(stdin: { write: (s: string) => void }, key: string, cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { stdin.write(key); if (cond()) return; if (Date.now() - start > timeout) throw new Error(`pressUntil(${JSON.stringify(key)}) timeout`); await new Promise((r) => setTimeout(r, 5)); }
}

describe("<ChatApp>", () => {
  it("submits a typed prompt and streams the reply", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));      // composer mounted → TextInput live
    stdin.write("hi");
    await waitFor(() => frame(lastFrame).includes("hi"));   // typed text landed in the composer before Enter
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("ok");
  });

  it("surfaces a parked permission as a dialog and 'a' allows it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    fake.parkPermission({ sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));   // dialog up
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t", decision: { kind: "allow_once" } });
  });

  it("Ctrl-L is wired and keeps input flowing (clear-screen is an ANSI escape Static can't un-draw)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi");   await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("ok"));
    stdin.write("\x0c"); await new Promise((r) => setTimeout(r, 30));       // Ctrl-L — must not crash
    stdin.write("more"); await waitFor(() => frame(lastFrame).includes("more"));  // composer still responsive after clear
    expect(frame(lastFrame)).toContain("more");
  });

  it("Ctrl-C while idle arms 'press again to exit'; while busy it interrupts instead", async () => {
    let release = () => {}; let interrupts = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      interrupt: () => { interrupts++; },
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x03");                                                      // Ctrl-C idle → arm
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-C again to exit"));
    expect(interrupts).toBe(0);
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));  // turn started, hanging
    stdin.write("\x03");                                                      // Ctrl-C busy → interrupt

    await waitFor(() => interrupts === 1);
    release();
    expect(interrupts).toBe(1);
  });

  it("Tab cycles the permission ladder default → acceptEdits → plan → auto", async () => {
    const modes: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { modes.push(m); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("mode"));
    await pressUntil(stdin, "\t", () => modes.includes("auto"));   // Tab cycles default→acceptEdits→plan→auto
    expect(modes[0]).toBe("acceptEdits");
    expect(modes).toContain("plan");
    expect(modes).toContain("auto");
  });

  it("initialPrompt submits once on mount", async () => {
    const { lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} initialPrompt="do the thing" />);
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("› do the thing");
  });

  it("Ctrl-Z detaches when attached, and does NOT deny a pending remote permission (detach ≠ deny)", async () => {
    let detachCalls = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} onDetach={() => { detachCalls++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: {}, createdAt: Date.now() };
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("\x1a");                                     // Ctrl-Z
    await new Promise((r) => setTimeout(r, 30));
    expect(detachCalls).toBe(1);
    expect(fake.answeredCalls).toEqual([]);                  // unanswered — stays parked, never denied
  });

  it("Ctrl-Z with client.kind === 'loopback' appends a not-detachable notice and does not exit", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1a");
    await waitFor(() => frame(lastFrame).includes("not detachable — run with --detachable"));
    stdin.write("still here"); await waitFor(() => frame(lastFrame).includes("still here"));   // composer still alive
  });
});
