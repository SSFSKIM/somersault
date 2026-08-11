// Live: a tier alias resolves to an id the ENGINE accepts, and it is the Claude-5 one.
// Probe 72 found the SDK's own catalog still maps `opus` → Opus 4.8, so config.model:"opus" must be
// translated by us. This test reads the model back off the engine's init frame — not off our config —
// because the only failure that matters is the engine silently running something else.
import { describe, it, expect } from "vitest";
import { openSession } from "../../src/session/index.js";
import { MODEL_ALIASES } from "../../src/config/models.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("model tier aliases (live)", () => {
  for (const [alias, id] of Object.entries(MODEL_ALIASES)) {
    it(`--model ${alias} runs on ${id}`, async () => {
      const s = openSession({ model: alias, permissionMode: "auto", maxTurns: 2, settingSources: [] });
      const reported: string[] = [];
      try {
        await s.submit("Reply with exactly the word OK.", (m: any) => {
          if (m?.type === "system" && m?.subtype === "init" && m?.model) reported.push(String(m.model));
          if (m?.type === "result" && m?.modelUsage) reported.push(...Object.keys(m.modelUsage));
        });
      } finally { await s.dispose(); }
      // The engine may report the id with a suffix (dated snapshot, or the catalog's [1m] context variant),
      // so assert the id is a PREFIX of what came back rather than demanding an exact match.
      expect(reported.length).toBeGreaterThan(0);
      expect(reported.some((r) => r.startsWith(id))).toBe(true);
    }, 120_000);
  }
});
