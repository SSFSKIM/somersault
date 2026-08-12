// test/tui/mode-refusal.test.tsx — Wave T Task 16: a runtime permission-mode change the ENGINE REFUSES must
// not paint. `allowDangerouslySkipPermissions` is set only from the LAUNCH mode (resolveOptions.ts), and the
// bundled CLI enforces that one layer down (cli.pretty.js:562709 — "Cannot set permission mode to
// bypassPermissions because the session was not launched with --dangerously-skip-permissions"), so a runtime
// flip arrives back as a rejected setPermissionMode. The chip must stay on the previous mode and the refusal
// must be visible, the same rule (and the same ordering) as host.ts's applyPlanUpgrade.
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { useChat } from "../../src/tui/useChat.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-moderefuse-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

type Ctl = { applyMode(next: string): Promise<void> };
function Host({ fake, env, sink, ctl, initialMode, initialModel }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { text: string }; ctl: { c?: Ctl }; initialMode?: string; initialModel?: string }) {
  const c = useChat(() => fake, { initialMode, initialModel }, { env });
  // FSW T3: read the WHOLE finalized projection, not just its committed head. `staticItems` is now only
  // the part that has left the live window and been written into <Static>; `finalizedItems` is the transcript
  // these content assertions are actually about.
  sink.text = [...c.state.finalizedItems, ...c.state.pendingItems].flatMap(itemLines).join("|");
  ctl.c = { applyMode: c.applyMode };
  return <Text>m:{c.state.mode}|mo:{c.state.model ?? "-"}</Text>;
}

describe("useChat — a refused permission-mode change", () => {
  it("leaves the chip on the previous mode and reports the refusal", async () => {
    const env = tmpRoot(), sink = { text: "" }, ctl: { c?: Ctl } = {};
    const asked: string[] = [];
    const fake = fakeRemote({ setPermissionMode: (m: string) => { asked.push(m); throw new Error("Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions"); } });
    const r = render(<Host fake={fake} env={env} sink={sink} ctl={ctl} initialMode="plan" />);
    await tick();
    await act(async () => { await ctl.c!.applyMode("bypassPermissions"); });
    await tick();
    expect(asked).toEqual(["bypassPermissions"]);
    expect(r.lastFrame()).toContain("m:plan");                                              // the chip did NOT move
    expect(sink.text).toContain("✗ bypassPermissions refused by the engine");
    expect(sink.text).toContain("was not launched with --dangerously-skip-permissions");    // the engine's own words
    expect(sink.text).toContain("staying in plan");
    r.unmount();
  });

  it("an accepted change still moves the chip and says nothing", async () => {
    const env = tmpRoot(), sink = { text: "" }, ctl: { c?: Ctl } = {};
    const fake = fakeRemote({ setPermissionMode: () => {} });
    const r = render(<Host fake={fake} env={env} sink={sink} ctl={ctl} initialMode="default" />);
    await tick();
    await act(async () => { await ctl.c!.applyMode("plan"); });
    await tick();
    expect(r.lastFrame()).toContain("m:plan");
    expect(sink.text).not.toContain("refused by the engine");
    r.unmount();
  });

  // `auto` is model-gated and carries its OWN refusal one layer down (cli.pretty.js:562713, "Cannot set
  // permission mode to auto"). The model swap happens first and independently, so a refused `auto` must
  // still leave the chip put — the swapped model is not undone, but the mode never becomes a lie.
  it("a refused auto leaves the chip on the previous mode too", async () => {
    const env = tmpRoot(), sink = { text: "" }, ctl: { c?: Ctl } = {};
    const fake = fakeRemote({ setPermissionMode: () => { throw new Error("Cannot set permission mode to auto"); } });
    const r = render(<Host fake={fake} env={env} sink={sink} ctl={ctl} initialMode="acceptEdits" />);
    await tick();
    await act(async () => { await ctl.c!.applyMode("auto"); });
    await tick();
    expect(r.lastFrame()).toContain("m:acceptEdits");
    expect(sink.text).toContain("✗ auto refused by the engine");
    expect(sink.text).toContain("staying in acceptEdits");
    r.unmount();
  });
});

// The auto arm's model swap is the same class of claim: it moved `model` and announced the switch off a
// `.catch(() => {})`, so a refused setModel painted a model the session isn't running.
describe("useChat — applyMode's auto model swap", () => {
  it("a refused model swap reports it and leaves the model chip put", async () => {
    const env = tmpRoot(), sink = { text: "" }, ctl: { c?: Ctl } = {};
    const fake = fakeRemote({ setModel: () => { throw new Error("model not available"); } });
    const r = render(<Host fake={fake} env={env} sink={sink} ctl={ctl} initialMode="default" initialModel="claude-haiku-4-5" />);
    await tick();
    await act(async () => { await ctl.c!.applyMode("auto"); });
    await tick();
    expect(r.lastFrame()).toContain("mo:claude-haiku-4-5");                             // the model chip did NOT move
    expect(sink.text).toContain("✗ auto — model swap to claude-sonnet-5 failed (model not available)");
    expect(sink.text).not.toContain("↻ auto — switched model to");                      // and it never claimed success
    expect(r.lastFrame()).toContain("m:auto");                                          // the mode itself was accepted
    r.unmount();
  });

  it("an accepted swap still moves the model chip and announces it — swap first, then the mode", async () => {
    const env = tmpRoot(), sink = { text: "" }, ctl: { c?: Ctl } = {};
    const order: string[] = [];
    const fake = fakeRemote({ setModel: (m?: string) => { order.push(`model:${m}`); }, setPermissionMode: (m: string) => { order.push(`mode:${m}`); } });
    const r = render(<Host fake={fake} env={env} sink={sink} ctl={ctl} initialMode="default" initialModel="claude-haiku-4-5" />);
    await tick();
    await act(async () => { await ctl.c!.applyMode("auto"); });
    await tick();
    expect(order).toEqual(["model:claude-sonnet-5", "mode:auto"]);                       // the gate ordering still holds
    expect(r.lastFrame()).toContain("mo:claude-sonnet-5");
    expect(sink.text).toContain("↻ auto — switched model to claude-sonnet-5 (claude-haiku-4-5 doesn't support auto)");
    r.unmount();
  });
});
