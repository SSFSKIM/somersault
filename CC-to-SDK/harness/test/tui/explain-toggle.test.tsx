// tui/test/explain-toggle.test.tsx — the ctrl+e explanation inside the Bash consult (Wave T task 7).
// Transcribed from 2.1.220's `ZMn` (L505015-52, the toggle hook), `Rsl`/`eDn` (L505053-104, the render) and
// `dZf`'s own header row (L505286): while the explanation is visible the command line DIMS and the plain
// description row is REPLACED by the block, and the footer's last hint flips `explain` → `hide`.
//
// The one deliberate divergence, pinned by the last describe here: upstream gates the affordance on a
// setting (`Kdi()` = `permissionExplainerEnabled !== false`, L504907-09); ccx gates it on whether a
// TRANSPORT was injected, because W-T13 leaves the shipping build with none. Both spell the same rule —
// no explainer, no `ctrl+e` hint and no key.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { BashPermission } from "../../src/tui/dialogs/BashPermission.js";
import type { ExplainRequest, ExplainTransport } from "../../src/tui/dialogs/explainCommand.js";
import type { PermissionDecision } from "../../src/permissions/types.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const CTRL_E = "\x05";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const GOOD = { explanation: "Runs the package build script.", reasoning: "I need the bundle before testing.", risk: "Overwrites the dist directory", riskLevel: "LOW" as const };

/** A transport that records every call, so "one shot" is provable rather than assumed. */
function fake(answer: (req: ExplainRequest) => Promise<unknown>) {
  const calls: ExplainRequest[] = [];
  const t: ExplainTransport = (req) => { calls.push(req); return answer(req); };
  return Object.assign(t, { calls });
}

async function mount(explainCommand?: ExplainTransport, extra: { description?: string } = {}) {
  const got: PermissionDecision[] = [];
  const view = render(<BashPermission req={{ input: { command: "npm run build" }, ...extra }} cwd="/repo" explainCommand={explainCommand} onDecision={(d) => got.push(d)} />);
  await waitFor(() => (view.lastFrame() ?? "").length > 0);
  return { ...view, got, frame: () => view.lastFrame() ?? "", text: () => plain(view.lastFrame() ?? "") };
}

describe("ctrl+e in the Bash consult (`ZMn` L505015-52)", () => {
  it("renders the explanation, the reasoning and the risk row, and flips the footer verb to hide", async () => {
    const t = fake(async () => GOOD);
    const v = await mount(t);
    expect(v.text()).toContain("esc cancel · tab amend · ctrl+e explain");
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes(GOOD.explanation));
    const f = v.text();
    expect(f).toContain(GOOD.reasoning);
    expect(f).toContain("Low risk:");
    expect(f).toContain(GOOD.risk);
    expect(f).toContain("esc cancel · tab amend · ctrl+e hide");
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.prompt).toContain("npm run build");     // the generator's prompt, not the raw command
  });

  it("dims the command line and hides the plain description row while the explanation is up (L505286)", async () => {
    const v = await mount(fake(async () => GOOD), { description: "Build the bundle" });
    expect(v.text()).toContain("Build the bundle");
    expect(v.frame()).not.toContain("\x1b[2mnpm run build");   // undimmed before the toggle
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes(GOOD.explanation));
    expect(v.frame()).toContain("\x1b[2mnpm run build");       // dimColor={visible}
    expect(v.text()).not.toContain("Build the bundle");
  });

  it("a second ctrl+e hides it again — visibility only, no second request", async () => {
    const t = fake(async () => GOOD);
    const v = await mount(t, { description: "Build the bundle" });
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes(GOOD.explanation));
    v.stdin.write(CTRL_E);
    await waitFor(() => !v.text().includes(GOOD.explanation));
    expect(v.text()).toContain("Build the bundle");            // the description row is back
    expect(v.text()).toContain("esc cancel · tab amend · ctrl+e explain");
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes(GOOD.explanation));
    expect(t.calls).toHaveLength(1);                           // the promise is kept, not re-issued
  });

  it("shows `Loading explanation…` until the transport answers", async () => {
    let settle!: (v: unknown) => void;
    const v = await mount(fake(() => new Promise((r) => { settle = r; })));
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes("Loading explanation…"));
    expect(v.text()).not.toContain(GOOD.explanation);
    settle(GOOD);
    await waitFor(() => v.text().includes(GOOD.explanation));
    expect(v.text()).not.toContain("Loading explanation…");
  });

  it("says `Explanation unavailable` when the request fails (L505055-60)", async () => {
    const v = await mount(fake(async () => { throw new Error("upstream 529"); }));
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes("Explanation unavailable"));
    expect(v.text()).toContain("esc cancel · tab amend · ctrl+e hide");
  });

  it("says `Explanation unavailable` when the transport answers with a malformed object", async () => {
    const v = await mount(fake(async () => ({ explanation: "x", riskLevel: "NUCLEAR" })));
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes("Explanation unavailable"));
  });

  it("aborts the in-flight request when the dialog unmounts", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const v = await mount(fake((req) => { seen.push(req.signal); return new Promise(() => {}); }));
    v.stdin.write(CTRL_E);
    await waitFor(() => seen.length === 1);
    expect(seen[0]!.aborted).toBe(false);
    v.unmount();
    await tick();
    expect(seen[0]!.aborted).toBe(true);
  });

  it("leaves the dialog's own keys alone — y still allows while the explanation is visible", async () => {
    const v = await mount(fake(async () => GOOD));
    v.stdin.write(CTRL_E);
    await waitFor(() => v.text().includes(GOOD.explanation));
    v.stdin.write("y");
    await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "allow_once" });
  });
});

// Upstream's `permissionExplainerEnabled: false` arm (`Kdi`, L504907-09): the hook still runs, `enabled` is
// false, the action registers inert and the footer drops the hint. Ours is the no-transport arm.
describe("the disabled arm — no explainer wired (`Kdi()` false, L504907-09)", () => {
  it("advertises no ctrl+e hint and does nothing when the key is pressed", async () => {
    const v = await mount(undefined, { description: "Build the bundle" });
    expect(v.text()).toContain("esc cancel · tab amend");
    expect(v.text()).not.toContain("ctrl+e");
    v.stdin.write(CTRL_E);
    await tick(); await tick();
    expect(v.text()).not.toContain("Loading explanation…");
    expect(v.text()).not.toContain("Explanation unavailable");
    expect(v.text()).toContain("Build the bundle");            // still the plain description row
    expect(v.frame()).not.toContain("\x1b[2mnpm run build");   // and the command is still undimmed
    expect(v.got).toEqual([]);
  });
});
