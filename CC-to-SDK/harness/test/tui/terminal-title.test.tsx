// harness/test/tui/terminal-title.test.tsx — Wave C Task 8 (EP-C4a), the WIRING half. The byte-level
// contract of the writer itself is `test/unit/terminal-title.test.ts`; what this file asks is only whether
// the REPL drives it — because the writer is pure and the mount site is where a port of this shape goes
// wrong (a title nobody sets, a busy flag nobody forwards, a fetch that runs every turn).
//
// Two subjects, in the order the modules stack: `useChat`'s two title rungs (the engine ai-title, fetched
// ONCE after the first completed turn per probe (d) — it is a disk read, not a wire event — and the /rename
// override), then `<ChatApp>` forwarding `state.busy` and the resolved title into an injected controller.
// The useChat half follows `useChat.test.tsx`'s `api.run = c.submit` idiom; the ChatApp half renders through
// `renderWithKeymap` like every other component test since F2 task 6.
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { renderWithKeymap } from "./keysTestUtil.js";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { useChat } from "../../src/tui/useChat.js";
import type { TerminalTitle } from "../../src/tui/terminalTitle.js";

async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** One whole turn on the host event stream — the only rendering source useChat has. */
async function runTurn(fake: FakeRemote, seq: number) {
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq }); });
  await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", uuid: `a${seq}`, message: { id: `m${seq}`, content: [{ type: "text", text: "ok" }] } } }); });
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq }); });
  await tick();
}
/** A recording stand-in for the real controller — the mount site's only observable behaviour. */
function spyTitle() {
  const titles: (string | undefined)[] = [], busy: boolean[] = [];
  let cleared = 0;
  const title: TerminalTitle = {
    setTitle: (t) => { titles.push(t); },
    setBusy: (b) => { busy.push(b); },
    clear: () => { cleared++; },
  };
  return { title, titles, busy, cleared: () => cleared };
}

describe("useChat — the engine ai-title rung (probe (d): a DISK read after the first turn)", () => {
  it("adopts `customTitle` once the first turn has COMPLETED, and does not read it before then", async () => {
    const fake = fakeRemote(); let reads = 0;
    const sink: { title?: string } = {};
    function H() {
      const c = useChat(() => fake, {}, { getSessionInfo: async () => { reads++; return { customTitle: "Fix login button", summary: "s" } as any; } });
      sink.title = c.state.aiTitle; return <Text>t:{c.state.aiTitle ?? "-"}</Text>;
    }
    const { unmount } = render(<H />);
    await tick();
    try {
      expect(reads).toBe(0);                                   // nothing fetched at mount
      expect(sink.title).toBeUndefined();
      await runTurn(fake, 1);
      await waitFor(() => sink.title === "Fix login button");
      expect(reads).toBe(1);
    } finally { unmount(); }
  });

  it("falls back to `summary` when the engine wrote no customTitle", async () => {
    const fake = fakeRemote();
    const sink: { title?: string } = {};
    function H() {
      const c = useChat(() => fake, {}, { getSessionInfo: async () => ({ summary: "Debug failing CI tests" }) as any });
      sink.title = c.state.aiTitle; return <Text>t:{c.state.aiTitle ?? "-"}</Text>;
    }
    const { unmount } = render(<H />);
    await tick();
    try {
      await runTurn(fake, 1);
      await waitFor(() => sink.title === "Debug failing CI tests");
    } finally { unmount(); }
  });

  it("reads it ONCE — a second and third turn re-fetch nothing (the engine writes one title per session)", async () => {
    const fake = fakeRemote(); let reads = 0;
    function H() {
      const c = useChat(() => fake, {}, { getSessionInfo: async () => { reads++; return { customTitle: "Topic" } as any; } });
      return <Text>t:{c.state.aiTitle ?? "-"}</Text>;
    }
    const { unmount } = render(<H />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2); await runTurn(fake, 3);
      expect(reads).toBe(1);
    } finally { unmount(); }
  });

  it("keeps the current title silently when the fetch rejects", async () => {
    // The positive control is `reads`: without it this test would pass against a harness that never fetched
    // at all (constraint 14 — an absence assertion proves nothing on its own). The fetch MUST be attempted,
    // and its rejection must neither throw nor publish.
    const fake = fakeRemote(); let reads = 0;
    const sink: { title?: string } = {};
    function H() {
      const c = useChat(() => fake, {}, { getSessionInfo: async () => { reads++; throw new Error("no such session file"); } });
      sink.title = c.state.aiTitle; return <Text>t:{c.state.aiTitle ?? "-"}</Text>;
    }
    const { unmount } = render(<H />);
    await tick();
    try {
      await runTurn(fake, 1);
      await waitFor(() => reads === 1);
      expect(sink.title).toBeUndefined();
    } finally { unmount(); }
  });
});

describe("useChat — the /rename rung, which outranks the ai-title unconditionally (recorded skip: no `terminalTitleFromRename`)", () => {
  it("publishes the new title the moment the rename succeeds", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {}; const sink: { title?: string } = {};
    function H() {
      const c = useChat(() => fake, {}, { renameSession: async () => {}, getSessionInfo: async () => ({ customTitle: "Topic" }) as any });
      api.run = c.submit; sink.title = c.state.renameTitle; return <Text>t:{c.state.renameTitle ?? "-"}</Text>;
    }
    const { unmount } = render(<H />);
    await tick();
    try {
      api.run!("/rename my session");
      await waitFor(() => sink.title === "my session");
    } finally { unmount(); }
  });

  it("does not publish anything when the rename call fails", async () => {
    // Same shape as the ai-title failure test: `calls` is the positive control, so the assertion below is
    // "the rename ran and did not publish" rather than the vacuous "nothing happened".
    const fake = fakeRemote(); let calls = 0;
    const api: { run?: (s: string) => void } = {}; const sink: { title?: string } = {};
    function H() {
      const c = useChat(() => fake, {}, { renameSession: async () => { calls++; throw new Error("nope"); } });
      api.run = c.submit; sink.title = c.state.renameTitle; return <Text>t:{c.state.renameTitle ?? "-"}</Text>;
    }
    const { unmount } = render(<H />);
    await tick();
    try {
      api.run!("/rename my session");
      await waitFor(() => calls === 1);
      await tick();
      expect(sink.title).toBeUndefined();
    } finally { unmount(); }
  });
});

describe("<ChatApp> — the mount site", () => {
  it("sets the launch title from `name` at mount, with no busy state yet", async () => {
    const spy = spyTitle();
    const { unmount } = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} name="worker-7" terminalTitle={spy.title} />);
    await tick();
    try {
      expect(spy.titles).toContain("worker-7");
      expect(spy.busy.filter((b) => b)).toHaveLength(0);
    } finally { unmount(); }
  });

  it("falls back to `ccx` when the launch carried no --name", async () => {
    const spy = spyTitle();
    const { unmount } = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} terminalTitle={spy.title} />);
    await tick();
    try { expect(spy.titles).toContain("ccx"); } finally { unmount(); }
  });

  it("forwards `state.busy` through a whole turn — true at start, false at end", async () => {
    const spy = spyTitle(); const fake = fakeRemote();
    const { unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} terminalTitle={spy.title} />);
    await tick();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await waitFor(() => spy.busy.includes(true));
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); });
      await waitFor(() => spy.busy.lastIndexOf(false) > spy.busy.lastIndexOf(true));
    } finally { unmount(); }
  });

  it("adopts the engine ai-title over the launch name once the first turn has completed", async () => {
    const spy = spyTitle(); const fake = fakeRemote();
    const { unmount } = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} name="worker-7" terminalTitle={spy.title}
        deps={{ getSessionInfo: async () => ({ customTitle: "Fix login button" }) as any }} />,
    );
    await tick();
    try {
      await runTurn(fake, 1);
      await waitFor(() => spy.titles.includes("Fix login button"));
      expect(spy.titles.indexOf("worker-7")).toBeLessThan(spy.titles.indexOf("Fix login button"));
    } finally { unmount(); }
  });
});
