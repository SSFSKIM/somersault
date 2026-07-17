import { describe, it, expect } from "vitest";
import { resolveOptions } from "../../src/config/resolveOptions.js";
import type { HarnessConfig } from "../../src/config/types.js";

// W4.1 knob sweep — each first-class field maps to its SDK Options key (probes 53/53b/54).
const noop = () => {};
const spawn = () => ({}) as any;
const abort = new AbortController();

// [config field, sample value, options key, expected value (default: same)]
const TABLE: [keyof HarnessConfig, unknown, string, unknown?][] = [
  ["sessionId", "11111111-2222-3333-4444-555555555555", "sessionId"],
  ["title", "my session", "title"],
  ["continueSession", true, "continue"],
  ["abortController", abort, "abortController"],
  ["agent", "reviewer", "agent"],
  ["additionalDirectories", ["/srv/data"], "additionalDirectories"],
  ["skills", ["pdf"], "skills"],
  ["skills", "all", "skills"],
  ["toolConfig", { askUserQuestion: { previewFormat: "html" } }, "toolConfig"],
  ["strictMcpConfig", true, "strictMcpConfig"],
  ["betas", ["context-1m-2025-08-07"], "betas"],
  ["maxThinkingTokens", 4096, "maxThinkingTokens"],
  ["planModeInstructions", "plan tersely", "planModeInstructions"],
  ["permissionPromptToolName", "mcp__perm__ask", "permissionPromptToolName"],
  ["onElicitation", noop, "onElicitation"],
  ["onUserDialog", noop, "onUserDialog"],
  ["supportedDialogKinds", ["refusal_fallback_prompt"], "supportedDialogKinds"],
  ["spawnClaudeCodeProcess", spawn, "spawnClaudeCodeProcess"],
  ["pathToClaudeCodeExecutable", "/opt/claude/cli.js", "pathToClaudeCodeExecutable"],
  ["executable", "node", "executable"],
  ["executableArgs", ["--max-old-space-size=4096"], "executableArgs"],
  ["extraArgs", { "replay-user-messages": null }, "extraArgs"],
  ["stderr", noop, "stderr"],
  ["debug", true, "debug"],
  ["debugFile", "/tmp/claude-debug.log", "debugFile"],
  ["includeHookEvents", true, "includeHookEvents"],
  ["promptSuggestions", true, "promptSuggestions"],
  ["agentProgressSummaries", true, "agentProgressSummaries"],
];

describe("W4.1 knob sweep", () => {
  for (const [field, value, key, expected] of TABLE) {
    it(`${String(field)} → options.${key}`, () => {
      const opts = resolveOptions({ [field]: value } as HarnessConfig);
      expect(opts[key]).toEqual(expected === undefined ? value : expected);
    });
  }

  it("none set → none of the knob keys present", () => {
    const opts = resolveOptions({});
    for (const [, , key] of TABLE) expect(opts, key).not.toHaveProperty(key);
  });

  it("falsy-but-meaningful values still map (continueSession/strictMcpConfig/debug false, maxThinkingTokens 0)", () => {
    const opts = resolveOptions({ continueSession: false, strictMcpConfig: false, debug: false, maxThinkingTokens: 0, includeHookEvents: false });
    expect(opts.continue).toBe(false);
    expect(opts.strictMcpConfig).toBe(false);
    expect(opts.debug).toBe(false);
    expect(opts.maxThinkingTokens).toBe(0);
    expect(opts.includeHookEvents).toBe(false);
  });

  it("extraOptions still wins over a first-class knob", () => {
    const opts = resolveOptions({ title: "typed", extraOptions: { title: "escape-hatch" } });
    expect(opts.title).toBe("escape-hatch");
  });
});
