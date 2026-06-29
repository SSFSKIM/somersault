// tui/test/chat.test.tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatApp } from "../src/ChatApp.js";
import { createUiBroker } from "../src/uiBroker.js";
import type { ChatSession } from "../src/useChat.js";
import type { PermissionDecision } from "cc-harness";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function pressUntil(stdin: { write: (s: string) => void }, key: string, cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { stdin.write(key); if (cond()) return; if (Date.now() - start > timeout) throw new Error(`pressUntil(${JSON.stringify(key)}) timeout`); await new Promise((r) => setTimeout(r, 5)); }
}
function fakeSession(onSubmit?: () => Promise<void>): ChatSession & { modes: string[] } {
  const s: any = { modes: [],
    async submit(_p: string, onMessage: (m: unknown) => void) { onMessage({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }); if (onSubmit) await onSubmit(); return { result: "done" }; },
    async setPermissionMode(m: string) { s.modes.push(m); }, async setModel() {}, async setMaxThinkingTokens() {}, async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
    async capabilities() { return { models: [{ value: "claude-opus-4-8" }], commands: [], mcpServers: [] }; },
    async dispose() {}, sessionId: "sess-1" };
  return s;
}

describe("<ChatApp>", () => {
  it("submits a typed prompt and streams the reply", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeSession()} broker={createUiBroker()} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));      // composer mounted → TextInput live
    stdin.write("hi");
    await waitFor(() => frame(lastFrame).includes("hi"));   // typed text landed in the composer before Enter
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("ok");
  });

  it("surfaces a gated tool as a dialog and 'a' allows it", async () => {
    const ui = createUiBroker();
    let decided: PermissionDecision | undefined;
    const session = fakeSession(async () => {
      await ui.broker.request({ toolName: "Edit", input: { file_path: "f.ts" }, toolUseID: "t", signal: new AbortController().signal }).then((d) => { decided = d; });
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} broker={ui} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("edit it");
    await waitFor(() => frame(lastFrame).includes("edit it"));   // typed text landed in the composer before Enter
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permission needed"));   // dialog up
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => decided !== undefined);
    expect(decided).toEqual({ kind: "allow_once" });
  });

  it("Ctrl-L is wired and keeps input flowing (clear-screen is an ANSI escape Static can't un-draw)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeSession()} broker={createUiBroker()} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi");   await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("ok"));
    stdin.write("\x0c"); await new Promise((r) => setTimeout(r, 30));       // Ctrl-L — must not crash
    stdin.write("more"); await waitFor(() => frame(lastFrame).includes("more"));  // composer still responsive after clear
    expect(frame(lastFrame)).toContain("more");
  });

  it("Ctrl-C while idle arms 'press again to exit'; while busy it interrupts instead", async () => {
    let release = () => {}; let interrupts = 0;
    const session: any = { modes: [],
      async submit(_p: string, onMessage: (m: unknown) => void) { onMessage({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }); await new Promise<void>((res) => { release = res; }); return { result: "done" }; },
      async setPermissionMode() {}, async setModel() {}, async setMaxThinkingTokens() {}, async interrupt() { interrupts++; }, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
      async capabilities() { return { models: [{ value: "x" }], commands: [], mcpServers: [] }; }, async usage() { return {}; }, async dispose() {}, sessionId: "s" };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} broker={createUiBroker()} cwd={process.cwd()} />);
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

  it("Tab cycles the permission ladder default → acceptEdits → auto", async () => {
    const session = fakeSession();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} broker={createUiBroker()} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("mode"));
    await pressUntil(stdin, "\t", () => session.modes.includes("auto"));   // Tab cycles default→acceptEdits→auto
    expect(session.modes[0]).toBe("acceptEdits");
    expect(session.modes).toContain("auto");
  });
});
