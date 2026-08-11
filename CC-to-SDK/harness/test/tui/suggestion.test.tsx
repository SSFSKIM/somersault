// test/tui/suggestion.test.tsx — Wave C Task 12 (EP-C5), the rendered half: the suggestion as composer
// placeholder, its two accept keys, and the hook lifecycle around it. The pure transcription (prompt,
// post-filter, eligibility, state machine) is `test/unit/suggester.test.ts`; nothing here spawns an engine —
// the suggester is injected, and the one keyed run lives in `test/live/suggestion.test.ts`.
//
// Two subjects, in the order the modules stack:
//   1. `<ChatComposer>` wired the way `ChatApp` wires it — a host that owns the four-state slice and runs
//      `suggestionRenderStep` off the composer's slot report. Driving the REAL state machine (rather than a
//      boolean prop) is what makes "typing dismisses" and "Ctrl-C leaves it standing" mean anything: they
//      are the same slot going false, and the two statuses answer it differently.
//   2. `useChat` — the turn-end trigger, its eligibility gates, the submit reset and the retirement at the
//      `replaceDocument` boundary.
import React, { act, useState } from "react";
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWithKeymap } from "./keysTestUtil.js";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { useChat } from "../../src/tui/useChat.js";
import { EMPTY_SUGGESTION, suggestionRenderStep, suggestionText, markSuggestionAccepted, type PromptSuggestion, type Suggester } from "../../src/tui/suggester.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 30));
async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }
const waitFor = async (p: () => boolean, ms = 2000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("waitFor timed out");
};

// The composer writes the paste cache under `fleetRoot()`; point it at a temp root so no test here can touch
// the developer's real ~/.claude/ccx (the same guard `composer-frame.test.tsx` installs).
let fleetRootDir = "", priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-sg-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-sugg-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** `ChatApp`'s suggestion wiring, minimally: the slice lives above the composer, the composer reports whether
 *  it COULD paint one, and the render step decides `shown` vs the `timing` discard. `sink` mirrors the live
 *  status out so an assertion can read it without reaching into React. */
function SuggestionHost({ initial, sink, clearDraftToken = 0 }: { initial: PromptSuggestion; sink: { status: string }; clearDraftToken?: number }) {
  const [s, setS] = useState<PromptSuggestion>(initial);
  sink.status = s.status;
  return (
    <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[{ name: "clear", description: "clear" } as never]} columns={() => 60}
      clearDraftToken={clearDraftToken}
      suggestion={suggestionText(s)}
      onSuggestionSlot={(canShow) => { setS((cur) => suggestionRenderStep(cur, { canShow, now: 1000 }).next); }}
      onSuggestionAccept={() => { setS((cur) => markSuggestionAccepted(cur, 2000)); }} />
  );
}

describe("the suggestion as composer placeholder (annex §C5.4 render path)", () => {
  it("paints it dim with the first character inverted — upstream's placeholder path, not a new one", async () => {
    const sink = { status: "" };
    const { lastFrame } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} />);
    await settle();
    const raw = lastFrame() ?? "";
    expect(raw).toContain("\x1b[7mr\x1b[27m");         // the cursor block IS the first character
    // …and the rest is dim: `vt.dim(...)` is SGR 2 and NOTHING else — the run carries no colour of its own
    // (the frame's own rules are coloured, which is why this looks at the suggestion's run rather than at the
    // whole frame).
    expect(raw).toContain("\x1b[2mun the tests\x1b[22m");
    expect(/\x1b\[2mun the tests\x1b\[22m/.test(raw)).toBe(true);
    expect(sink.status).toBe("shown");                 // generated → shown, stamped by the render (L495702)
  });

  it("OUTRANKS the fresh-session `Try \"…\"` template", async () => {
    const sink = { status: "" };
    const { lastFrame } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "commit this" }} sink={sink} />);
    await settle();
    expect(strip(lastFrame() ?? "")).toContain("commit this");
    expect(strip(lastFrame() ?? "")).not.toContain('Try "');
  });

  it("Tab accepts it into the buffer, cursor at the end", async () => {
    const sink = { status: "" };
    const { lastFrame, stdin } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} />);
    await settle();
    stdin.write("\t");
    await waitFor(() => sink.status === "accepted");
    const raw = lastFrame() ?? "";
    expect(strip(raw)).toContain("run the tests");
    expect(raw).not.toContain("\x1b[2mun the tests");   // it is BUFFER text now, not dim ghost text
  });

  it("Right arrow accepts it too (annex §C5.5)", async () => {
    const sink = { status: "" };
    const { lastFrame, stdin } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "commit this" }} sink={sink} />);
    await settle();
    stdin.write("\x1b[C");
    await waitFor(() => sink.status === "accepted");
    expect(strip(lastFrame() ?? "")).toContain("commit this");
  });

  it("a slash-command suggestion switches the composer's mode as it lands", async () => {
    const sink = { status: "" };
    const { lastFrame, stdin } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "/clear" }} sink={sink} />);
    await settle();
    stdin.write("\t");
    await waitFor(() => sink.status === "accepted");
    expect(strip(lastFrame() ?? "")).toContain("/clear");
  });

  // REVIEW finding #4: this used to claim it pinned Tab-vs-the-completion-popup. It cannot — the popup term
  // in the accept guard is unreachable under the empty-buffer term (typing `/` to open the popup is itself
  // what makes the buffer non-empty), and deleting that term leaves this file entirely green. What the case
  // DOES pin, and what is worth pinning, is the empty-buffer rule: once there is any text, Tab belongs to the
  // popup and never to the suggestion.
  it("Tab stops accepting the moment the buffer has text — even with the suggestion still live", async () => {
    const sink = { status: "" };
    const { lastFrame, stdin } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} />);
    await settle();
    stdin.write("/");                                   // buffer no longer empty (and the slash popup is up)
    await waitFor(() => strip(lastFrame() ?? "").includes("/clear"));
    stdin.write("\t");
    await settle();
    expect(sink.status).not.toBe("accepted");
  });

  // REVIEW finding #8: retitled. The `timing` discard is the NEXT case's subject; this one asserts the
  // opposite outcome, which is the other half of the transition table — a suggestion the empty composer
  // already SHOWED is not taken back when the user starts typing.
  it("a suggestion already `shown` SURVIVES the user typing over it (only `generated` times out)", async () => {
    const sink = { status: "" };
    const { stdin } = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} />);
    await settle();
    expect(sink.status).toBe("shown");                  // the empty composer showed it first
    stdin.write("x");
    await settle();
    expect(sink.status).toBe("shown");                  // already SHOWN: it survives, per the transition table
  });

  it("a suggestion that lands while the user is already typing never reaches the screen", async () => {
    // The `timing` arm: the buffer is non-empty on the very first slot report, so `generated` is discarded
    // without ever being shown — which is the whole point of the reset (a stale suggestion under a buffer
    // the user has moved on from).
    const sink = { status: "" };
    const view = renderWithKeymap(<SuggestionHost initial={EMPTY_SUGGESTION} sink={sink} />);
    await settle();
    view.stdin.write("already typing");
    await waitFor(() => strip(view.lastFrame() ?? "").includes("already typing"));
    view.rerender(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} />);
    await settle();
    expect(strip(view.lastFrame() ?? "")).not.toContain("run the tests");
  });

  it("survives Ctrl-C: clearing the buffer brings the shown suggestion back", async () => {
    const sink = { status: "" };
    const view = renderWithKeymap(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} clearDraftToken={0} />);
    await settle();
    expect(sink.status).toBe("shown");
    view.stdin.write("draft");
    await waitFor(() => strip(view.lastFrame() ?? "").includes("draft"));
    expect(strip(view.lastFrame() ?? "")).not.toContain("run the tests");
    // Ctrl-C's clear channel: ChatApp bumps the token, the composer clears its buffer (`clearDraftToken`).
    view.rerender(<SuggestionHost initial={{ status: "generated", text: "run the tests" }} sink={sink} clearDraftToken={1} />);
    await waitFor(() => strip(view.lastFrame() ?? "").includes("run the tests"));
    expect(sink.status).toBe("shown");
  });
});

/** `useChat` under a scripted suggester: every request is recorded, and the reply is whatever the test set. */
function fakeSuggester() {
  const calls: string[] = [];
  const rec = { spawned: 0, retired: 0, aborted: 0, reply: "run the tests" as string | null, calls };
  const create = (): Suggester => {
    rec.spawned++;
    return {
      async request(ctx) { calls.push(ctx.transcriptTail); return rec.reply; },
      abort() { rec.aborted++; },
      retire() { rec.retired++; },
    };
  };
  return { create, rec };
}

function Host({ fake, env, sink, sugg, enabled, mode }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { status: string; text: string | null; api?: ReturnType<typeof useChat> }; sugg: () => Suggester; enabled?: boolean; mode?: string }) {
  const c = useChat(() => fake, { ...(enabled === undefined ? {} : { initialPromptSuggestionEnabled: enabled }), ...(mode ? { initialMode: mode } : {}) }, { env, createSuggester: sugg, now: () => 5000 });
  sink.status = c.state.promptSuggestion.status;
  sink.text = suggestionText(c.state.promptSuggestion);
  sink.api = c;
  return <Text>b:{String(c.state.busy)}</Text>;
}

/** One whole turn on the wire, with one top-level assistant message in it. */
async function runTurn(fake: FakeRemote, n: number, o: { error?: string; text?: string } = {}) {
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: n }); });
  await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", uuid: `a${n}`, message: { id: `m${n}`, content: [{ type: "text", text: o.text ?? "ok" }] } } }); });
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq: n, ...(o.error ? { error: o.error } : {}) }); });
  await tick();
}

describe("useChat — the turn-end trigger and the suggester's lifecycle (spec EP-C5)", () => {
  it("asks for a suggestion at turn end once the conversation has two assistant messages", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1);
      expect(s.rec.calls).toHaveLength(0);                       // `early_conversation`: one assistant message
      await runTurn(fake, 2);
      await waitFor(() => sink.status === "generated");
      expect(s.rec.calls).toHaveLength(1);
      expect(s.rec.spawned).toBe(1);                             // lazily, and exactly once
      expect(sink.text).toBe("run the tests");
    } finally { unmount(); }
  });

  it("carries the conversation tail — the prompts this client sent and the replies it saw", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null, api: undefined as ReturnType<typeof useChat> | undefined }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await act(async () => { sink.api!.submit("fix the bug"); });
      await tick();
      await runTurn(fake, 1, { text: "fixed it" });
      await runTurn(fake, 2, { text: "tests written" });
      await waitFor(() => s.rec.calls.length >= 1);
      const last = s.rec.calls[s.rec.calls.length - 1];
      expect(last).toContain("user: fix the bug");
      expect(last).toContain("assistant: tests written");
    } finally { unmount(); }
  });

  it("NEVER asks with the setting off — the default (spec D-C4)", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2); await runTurn(fake, 3);
      expect(s.rec.calls).toHaveLength(0);
      expect(s.rec.spawned).toBe(0);                             // and no engine was ever opened
    } finally { unmount(); }
  });

  it("stays silent after a turn that ENDED IN ERROR (`last_response_error`)", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2, { error: "boom" });
      expect(s.rec.calls).toHaveLength(0);
      await runTurn(fake, 3);                                    // …and the next clean turn is unaffected
      await waitFor(() => s.rec.calls.length === 1);
    } finally { unmount(); }
  });

  it("stays silent in plan mode (`plan_mode`)", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled mode="plan" />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2);
      expect(s.rec.calls).toHaveLength(0);
    } finally { unmount(); }
  });

  it("drops a suggestion the post-filter rejected — the slice stays `empty`", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null }, s = fakeSuggester();
    s.rec.reply = null;
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2);
      await waitFor(() => s.rec.calls.length === 1);
      await tick();
      expect(sink.status).toBe("empty");
    } finally { unmount(); }
  });

  it("RESETS on submit (`logOutcomeAtSubmission`, L495609)", async () => {
    // The host's submit is inert here on purpose: the DEFAULT fake runs a whole turn synchronously, whose end
    // immediately generates the next suggestion — so the reset would be true for a tick and then invisible.
    const env = tmpRoot(), fake = fakeRemote({ submit: async () => ({ result: "done" }) }), sink = { status: "", text: null as string | null, api: undefined as ReturnType<typeof useChat> | undefined }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2);
      await waitFor(() => sink.status === "generated");
      await act(async () => { sink.api!.submit("something else"); });
      await tick();
      expect(sink.status).toBe("empty");
    } finally { unmount(); }
  });

  it("RETIRES the suggester at the replaceDocument boundary — /clear must not leak the old conversation", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null, api: undefined as ReturnType<typeof useChat> | undefined }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2);
      await waitFor(() => sink.status === "generated");
      await act(async () => { sink.api!.clear(); });
      await tick();
      expect(s.rec.retired).toBe(1);
      expect(sink.status).toBe("empty");                         // the pending suggestion goes with it
      // The next eligible turn spawns a FRESH suggester (the counters restart with the conversation).
      await runTurn(fake, 3); await runTurn(fake, 4);
      await waitFor(() => s.rec.spawned === 2);
    } finally { unmount(); }
  });

  it("retires on teardown, so an exiting REPL leaves no engine behind", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    await runTurn(fake, 1); await runTurn(fake, 2);
    await waitFor(() => s.rec.calls.length === 1);
    await act(async () => { unmount(); });
    expect(s.rec.retired).toBe(1);
  });

  // REVIEW finding #10. Turning the row OFF is not "off from the next turn": the eligibility chain alone
  // would leave the suggestion already on screen standing and the warm engine running for a feature the user
  // just switched off. Both halves are asserted, and the second one is the leak.
  it("turning the setting OFF drops the suggestion on screen AND retires the warm session", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null, api: undefined as ReturnType<typeof useChat> | undefined }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2);
      await waitFor(() => sink.status === "generated");
      expect(s.rec.spawned).toBe(1);
      await act(async () => { sink.api!.setPromptSuggestionEnabled(false); });
      await tick();
      expect(sink.status).toBe("empty");                          // the ghost text goes at once
      expect(s.rec.retired).toBe(1);                              // …and so does the engine behind it
      await runTurn(fake, 3);                                     // and nothing revives it while it is off
      await tick();
      expect(s.rec.calls).toHaveLength(1);
      expect(s.rec.spawned).toBe(1);
    } finally { unmount(); }
  });

  it("turning it back ON asks again at the next turn end, on a FRESH session", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { status: "", text: null as string | null, api: undefined as ReturnType<typeof useChat> | undefined }, s = fakeSuggester();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} sugg={s.create} enabled />);
    await tick();
    try {
      await runTurn(fake, 1); await runTurn(fake, 2);
      await waitFor(() => s.rec.calls.length === 1);
      await act(async () => { sink.api!.setPromptSuggestionEnabled(false); });
      await act(async () => { sink.api!.setPromptSuggestionEnabled(true); });
      await runTurn(fake, 3);
      await waitFor(() => s.rec.calls.length === 2);
      expect(s.rec.spawned).toBe(2);
    } finally { unmount(); }
  });
});

// ── REVIEW finding #6: the prop THREAD, at the layer the review changed ──────────────────────────────────
// `ChatApp` passes `suggestionEnabled={state.promptSuggestionEnabled}` into the composer, where it gates the
// first-run `Try "…"` template as well as the suggestion itself (placeholder rule 4). Nothing pinned that
// wire, so the whole knock-on of shipping the setting OFF by default — a fresh ccx session showing no
// template — rested on an unasserted prop. These two drive the real `ChatApp`, one per polarity.
describe("ChatApp threads `promptSuggestionEnabled` down to the placeholder ladder", () => {
  const bare = () => ({ env: tmpRoot(), fake: fakeRemote(), sugg: fakeSuggester() });
  it("OFF (ccx's default): a fresh session offers no `Try \"…\"` template either", async () => {
    const { env, fake, sugg } = bare();
    const { lastFrame, unmount } = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={tmpdir()}
        hookOpts={{ initialPromptSuggestionEnabled: false }} deps={{ env, createSuggester: sugg.create }} />);
    await tick();
    try { expect(strip(lastFrame() ?? "")).not.toContain('Try "'); } finally { unmount(); }
  });
  it("ON: the same fresh session does show one", async () => {
    const { env, fake, sugg } = bare();
    const { lastFrame, unmount } = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={tmpdir()}
        hookOpts={{ initialPromptSuggestionEnabled: true }} deps={{ env, createSuggester: sugg.create }} />);
    await tick();
    try { expect(strip(lastFrame() ?? "")).toContain('Try "'); } finally { unmount(); }
  });
});
