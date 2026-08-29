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

describe("0.3.251 knobs (Wave C)", () => {
  it("promptCacheTtl / subagentPromptCacheTtl map into options.settings (SDK Settings keys)", () => {
    const opts = resolveOptions({ promptCacheTtl: "1h", subagentPromptCacheTtl: "5m" }) as any;
    expect(opts.settings.promptCacheTtl).toBe("1h");
    expect(opts.settings.subagentPromptCacheTtl).toBe("5m");
    expect(resolveOptions({})).not.toHaveProperty("settings");
  });

  it("mcpToolTimeoutMs stamps sdk- and stdio-shaped servers that declare no timeout of their own", () => {
    const opts = resolveOptions({
      mcpToolTimeoutMs: 30_000,
      mcpServers: {
        inproc: { type: "sdk", name: "inproc" } as any,
        piped: { command: "server-bin" } as any,             // type-less stdio form
        declared: { type: "sdk", name: "declared", timeout: 5_000 } as any,
        remote: { type: "http", url: "https://mcp.example" } as any,
      },
    }) as any;
    expect(opts.mcpServers.inproc.timeout).toBe(30_000);
    expect(opts.mcpServers.piped.timeout).toBe(30_000);
    expect(opts.mcpServers.declared.timeout).toBe(5_000);    // a server's own timeout always wins
    expect(opts.mcpServers.remote).not.toHaveProperty("timeout"); // http schema declares no timeout
  });

  it("mcpToolTimeoutMs does not mutate the caller's server configs", () => {
    const inproc = { type: "sdk", name: "inproc" } as any;
    resolveOptions({ mcpToolTimeoutMs: 30_000, mcpServers: { inproc } });
    expect(inproc).not.toHaveProperty("timeout");
  });

  it("mcpToolTimeoutMs also covers the dynamic-tool overlay merged after extraOptions", () => {
    const opts = resolveOptions({
      mcpToolTimeoutMs: 30_000,
      dynamicToolServers: { "cc-dyn": { type: "sdk", name: "cc-dyn" } as any },
    }) as any;
    expect(opts.mcpServers["cc-dyn"].timeout).toBe(30_000);
  });

  it("no mcpToolTimeoutMs → servers pass through untouched", () => {
    const opts = resolveOptions({ mcpServers: { inproc: { type: "sdk", name: "inproc" } as any } }) as any;
    expect(opts.mcpServers.inproc).not.toHaveProperty("timeout");
  });
});
