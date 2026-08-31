// Live: the modelSwitchPolicy config knob governs a REAL setModel on the engine (Wave D, probe 121).
// Two sessions: a tiny cache-forfeiture cap must reject setModel with the prefixed policy reason and
// leave the session on its model; a permissive policy with annotate+tap must land the switch (next
// assistant frame on the new model) with both hook phases observed.
import { describe, it, expect } from "vitest";
import { openSession } from "../../src/session/index.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("model-switch policy (live)", () => {
  it("a warm-cache cap denies setModel with the policy's reason and the model stays put", async () => {
    const s = openSession({
      model: "claude-haiku-4-5-20251001", maxTurns: 2, settingSources: [],
      modelSwitchPolicy: { maxCacheWriteUsd: 0.000001 },
    });
    const models: string[] = [];
    const seeModels = (m: any) => { if (m?.type === "assistant" && m?.message?.model) models.push(String(m.message.model)); };
    try {
      await s.submit("Reply with exactly: OK", seeModels);
      await expect(s.setModel("sonnet")).rejects.toThrow(/cc-harness modelSwitchPolicy: .*forfeit a warm prompt cache/);
      await s.submit("Reply with exactly: OK2", seeModels);
    } finally { await s.dispose(); }
    expect(models.length).toBeGreaterThan(1);
    expect(models.every((m) => m.startsWith("claude-haiku"))).toBe(true);
  }, 180_000);

  it("a permissive policy lands the switch, fires both tap phases, and annotate runs on Post", async () => {
    const phases: string[] = [];
    let annotated = "";
    const s = openSession({
      model: "claude-haiku-4-5-20251001", maxTurns: 2, settingSources: [],
      modelSwitchPolicy: {
        allowModels: ["haiku", "sonnet"],
        onSwitch: (phase, _input, denied) => { phases.push(denied ? `${phase}:denied` : phase); },
        annotate: (input) => { annotated = `switched to ${input.to_model}`; return annotated; },
      },
    });
    const models: string[] = [];
    const seeModels = (m: any) => { if (m?.type === "assistant" && m?.message?.model) models.push(String(m.message.model)); };
    try {
      await s.submit("Reply with exactly: OK", seeModels);
      await s.setModel("sonnet");
      await s.submit("Reply with exactly: OK2", seeModels);
    } finally { await s.dispose(); }
    expect(phases).toEqual(["pre", "post"]);
    expect(annotated).toMatch(/^switched to claude-sonnet/);
    expect(models.some((m) => m.startsWith("claude-sonnet"))).toBe(true);
  }, 180_000);
});
