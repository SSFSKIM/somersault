// test/tui/duration-row.test.tsx — Wave C Task 7 (EP-C4d): the `✻ {Verb} for {duration}` row a COMPLETED
// turn leaves behind, and the `showTurnDuration` pref that removes it.
//
// Two subjects, in the order the modules stack: `<Line>` painting `turnDurationLine()` (the all-dim pin —
// the pure half's `dim` flags are in `test/unit/duration-row.test.ts`, this is the only place they become
// real SGR bytes), then `useChat` appending it at turn end.
//
// The `useChat` half follows `auto-mode-notice.test.tsx`'s idiom rather than driving `<ChatApp>`: it mirrors
// the PROJECTED items off the hook, so an assertion reads row text instead of a wrapped frame, and it drives
// the host event stream directly (`fake.pushEvent`) because that is the only rendering source useChat has.
// The clock is injected (`deps.now`) and the verb picker with it — plan constraint 15: no real time, and a
// uniform-random verb would otherwise make every expected string a regex.
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { Line } from "../../src/tui/Line.js";
import { useChat } from "../../src/tui/useChat.js";
import { turnDurationLine } from "../../src/tui/durationRow.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";
import { INTERRUPT_TOOL } from "../../src/tui/species.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-duration-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

describe("<Line> paints the duration row entirely dim (`Aha`, L428699/L428703)", () => {
  it("emits ONE dim run covering the glyph and the sentence, with no colour and no un-dimmed span", () => {
    const frame = render(<Line l={turnDurationLine(4000, { pickVerb: () => "Worked" })} />).lastFrame() ?? "";
    expect(frame.replace(/\x1b\[[0-9;]*m/g, "")).toContain("✻ Worked for 4s");
    // `\x1b[2m` opens dim and `\x1b[22m` closes it. Every visible character must sit inside such a pair —
    // so stripping the dim runs out leaves nothing but the SGR frame Ink puts around the whole <Text>.
    expect(frame.replace(/\x1b\[2m.*?\x1b\[22m/gs, "").replace(/\x1b\[[0-9;]*m/g, "").trim()).toBe("");
    expect(frame).not.toMatch(/\x1b\[3[0-79]m|\x1b\[38;/);   // no foreground colour anywhere on the row
  });
});

/** Mirrors the hook's projected transcript into `sink` on every render — `auto-mode-notice.test.tsx`'s Host,
 *  with the three seams this row needs: a movable clock, a fixed verb, and the seeded pref. `api` hands the
 *  toggle back out so the persistence test can drive it. */
function Host({ fake, env, sink, clock, verb = "Worked", show, savePrefs, api }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { text: string }; clock: { ms: number }; verb?: string; show?: boolean; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; api?: { setShow?: (v: boolean) => void } }) {
  const c = useChat(() => fake, { ...(show === undefined ? {} : { initialShowTurnDuration: show }) }, { env, savePrefs, now: () => clock.ms, pickTurnVerb: () => verb });
  // FSW T3: read the WHOLE finalized projection, not just its committed head. `staticItems` is now only
  // the part that has left the live window and been written into <Static>; `finalizedItems` is the transcript
  // these content assertions are actually about.
  sink.text = [...c.state.finalizedItems, ...c.state.pendingItems].flatMap(itemLines).join("|");
  if (api) api.setShow = c.setShowTurnDuration;
  return <Text>b:{String(c.state.busy)}</Text>;
}

/** One whole turn on the wire: start, one assistant frame, end — with `ms` of injected wall clock spent
 *  between the two turn events. `extra` frames (an interrupt sentinel, say) ride between them. */
async function runTurn(fake: FakeRemote, clock: { ms: number }, ms: number, extra: unknown[] = []) {
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
  await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "a1", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }); });
  for (const data of extra) await act(async () => { fake.pushEvent({ kind: "message", data }); });
  clock.ms += ms;
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); });
  await tick();
}

describe("useChat — the end-of-turn duration row", () => {
  it("appends `✻ Worked for 4s` when a turn COMPLETES, measured from turn start to turn end", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 1000 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} />);
    await tick();
    try {
      await runTurn(fake, clock, 4000);
      expect(sink.text).toContain("Worked for 4s");
    } finally { unmount(); }
  });

  it("spells the duration with `formatDuration` — a 65 s turn reads `1m 5s`, spaced", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} verb="Sautéed" />);
    await tick();
    try {
      await runTurn(fake, clock, 65_000);
      expect(sink.text).toContain("Sautéed for 1m 5s");
    } finally { unmount(); }
  });

  it("appends ONE row per turn, each clocked against its OWN start", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} />);
    await tick();
    try {
      await runTurn(fake, clock, 4000);
      await runTurn(fake, clock, 9000);
      expect(sink.text).toContain("Worked for 4s");
      expect(sink.text).toContain("Worked for 9s");                       // NOT 13s — the second turn re-stamped
      expect(sink.text.split("Worked for").length - 1).toBe(2);
    } finally { unmount(); }
  });

  it("stays silent when the seeded `showTurnDuration` is false", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} show={false} />);
    await tick();
    try {
      await runTurn(fake, clock, 4000);
      expect(sink.text).not.toContain("Worked for");
      expect(sink.text).not.toContain("✻");
    } finally { unmount(); }
  });

  it("`setShowTurnDuration` flips the row off live AND persists the flag (the /config row's handler)", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const saves: Partial<CcxPrefs>[] = [], api: { setShow?: (v: boolean) => void } = {};
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} api={api} savePrefs={(patch) => { saves.push(patch); }} />);
    await tick();
    try {
      await runTurn(fake, clock, 1000);
      expect(sink.text).toContain("Worked for 1s");
      await act(async () => { api.setShow!(false); });
      expect(saves).toEqual([{ showTurnDuration: false }]);
      await runTurn(fake, clock, 7000);
      expect(sink.text).not.toContain("Worked for 7s");
      await act(async () => { api.setShow!(true); });
      expect(saves).toEqual([{ showTurnDuration: false }, { showTurnDuration: true }]);
      await runTurn(fake, clock, 8000);
      expect(sink.text).toContain("Worked for 8s");
    } finally { unmount(); }
  });

  it("stays silent on an INTERRUPTED turn — the sentinel frame disqualifies the turn that carried it", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} />);
    await tick();
    try {
      const sentinel = { type: "user", uuid: "s1", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: INTERRUPT_TOOL }] } };
      await runTurn(fake, clock, 4000, [sentinel]);
      expect(sink.text).not.toContain("Worked for");
      // …and the NEXT, clean turn is unaffected: the disqualification is per-turn, not sticky.
      await runTurn(fake, clock, 2000);
      expect(sink.text).toContain("Worked for 2s");
    } finally { unmount(); }
  });

  it("stays silent on a turn that ENDED IN ERROR", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} />);
    await tick();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      clock.ms += 4000;
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 1, error: "boom" }); });
      await tick();
      expect(sink.text).toContain("boom");
      expect(sink.text).not.toContain("Worked for");
    } finally { unmount(); }
  });

  it("stays silent for a MID-TURN JOINER — a replayed frame proves the clock started before this client did", async () => {
    // `Host.follow()` (host.ts:490-501) hands a client attaching mid-turn a SYNTHETIC `turn:start`, then the
    // turn buffer so far as `replay:true` message frames. The synthetic start stamped `turnStartRef` with the
    // ATTACH instant, so the joined turn ended with a row measuring the attach rather than the work — the
    // same fabrication the replayed-Agent stamps were fixed for. The first replayed frame now drops the
    // clock: ccx cannot honestly measure this turn, so it prints no row for it at all.
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} />);
    await tick();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 4 }); });
      await act(async () => { fake.pushEvent({ kind: "message", replay: true, data: { type: "assistant", parent_tool_use_id: null, uuid: "r1", message: { id: "m1", content: [{ type: "text", text: "from before the attach" }] } } }); });
      clock.ms += 4000;
      await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "r2", message: { id: "m2", content: [{ type: "text", text: "live" }] } } }); });
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 4 }); });
      await tick();
      expect(sink.text).toContain("from before the attach");   // it DID render the joined turn
      expect(sink.text).not.toContain("Worked for");           // …and measured none of it
      // The suppression is per-turn: the first turn this client sees START TO FINISH is measured normally.
      await runTurn(fake, clock, 3000);
      expect(sink.text).toContain("Worked for 3s");
    } finally { unmount(); }
  });

  it("stays silent for the IDLE follow tail — a bare truncated start opens no turn, so its end clocks nothing", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" }, clock = { ms: 0 };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} clock={clock} />);
    await tick();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", truncated: true }); });
      clock.ms += 4000;
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "end" }); });
      await tick();
      expect(sink.text).not.toContain("Worked for");
    } finally { unmount(); }
  });
});
