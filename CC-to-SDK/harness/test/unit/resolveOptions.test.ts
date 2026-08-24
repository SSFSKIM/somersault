import { describe, it, expect } from "vitest";
import { resolveOptions } from "../../src/config/resolveOptions.js";

describe("resolveOptions", () => {
  it("produces CC-faithful defaults", () => {
    const o: any = resolveOptions({});
    expect(o.settingSources).toEqual(["user", "project", "local"]);
    expect(o.systemPrompt.type).toBe("preset");          // fork advertisement lives in .append by default
    expect(o.systemPrompt.append).toContain("fork");
    expect(o.tools).toEqual({ type: "preset", preset: "claude_code" });
    expect(o.enableFileCheckpointing).toBe(true);
    expect(o.agents["Explore"].disallowedTools).toContain("Write");
  });
  it("applies harness-wide defaults (opus-5 / auto / xhigh) when omitted", () => {
    const o: any = resolveOptions({});
    expect(o.model).toBe("claude-opus-5");
    expect(o.permissionMode).toBe("auto");
    expect(o.effort).toBe("xhigh");
  });
  it("default-auto does NOT override an explicit model (only explicit auto gates)", () => {
    const o: any = resolveOptions({ model: "claude-haiku-4-5" });
    expect(o.model).toBe("claude-haiku-4-5");   // explicit model preserved; auto is only the default → no gate
    expect(o.permissionMode).toBe("auto");      // mode still defaults to auto
  });
  it("wires outputStyle into systemPrompt.append and never leaks it into Options", () => {
    const o: any = resolveOptions({ outputStyle: "explanatory" });
    expect(o.systemPrompt.append).toContain("educational");
    expect(o).not.toHaveProperty("outputStyle"); // phantom option must not reach the SDK
  });
  it("sets allowDangerouslySkipPermissions when bypassPermissions is used", () => {
    const o: any = resolveOptions({ permissionMode: "bypassPermissions" });
    expect(o.permissionMode).toBe("bypassPermissions");
    expect(o.allowDangerouslySkipPermissions).toBe(true);
  });
  it("does not set allowDangerouslySkipPermissions for other permission modes", () => {
    const o: any = resolveOptions({ permissionMode: "default" });
    expect(o).not.toHaveProperty("allowDangerouslySkipPermissions");
  });
  it("threads provider env, sandbox, model, mcp, plugins, cwd, maxTurns", () => {
    const o: any = resolveOptions({
      provider: "bedrock", sandbox: true, model: "claude-opus-4-8",
      mcpServers: { x: { type: "stdio", command: "echo" } }, cwd: "/tmp", maxTurns: 5,
    });
    expect(o.env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(o.sandbox).toEqual({ enabled: true });
    expect(o.model).toBe("claude-opus-4-8");
    expect(o.mcpServers).toBeTruthy();
    expect(o.cwd).toBe("/tmp");
    expect(o.maxTurns).toBe(5);
  });
  it("disableProjectContext clears sources and excludes dynamic sections", () => {
    const o: any = resolveOptions({ disableProjectContext: true });
    expect(o.settingSources).toEqual([]);
    expect(o.systemPrompt.excludeDynamicSections).toBe(true);
  });
  it("merges env over process.env so PATH/HOME/auth are not erased", () => {
    // SDK `env` replaces the whole subprocess environment; resolveOptions must
    // spread process.env so a single provider flag does not wipe inherited vars.
    const o: any = resolveOptions({ provider: "bedrock" });
    expect(o.env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(o.env.PATH).toBe(process.env.PATH);
  });
  it("does not set env (inherits process.env) when there are no overrides", () => {
    // forkSubagent default-on sets a subprocess env flag, so opt out to assert the bare-inherit path.
    const o: any = resolveOptions({ forkSubagent: false });
    expect(o.env).toBeUndefined();
  });
  it("enables fork-subagent by default: env flag + system-prompt advertisement, process.env preserved", () => {
    const o: any = resolveOptions({});
    expect(o.env.CLAUDE_CODE_FORK_SUBAGENT).toBe("1");
    expect(o.env.PATH).toBe(process.env.PATH);                       // process.env still spread, not erased
    expect(o.systemPrompt.append).toContain('subagent_type "fork"'); // advertised so the model picks it (33d)
  });
  it("forkSubagent:false omits the env flag and the advertisement (clean defaults restored)", () => {
    const o: any = resolveOptions({ forkSubagent: false });
    expect(o.env).toBeUndefined();
    expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });
  it("workflow is OFF by default: no Workflow allowlist entry, no advertisement", () => {
    const o: any = resolveOptions({});
    expect(o.allowedTools ?? []).not.toContain("Workflow");
    expect(String(o.systemPrompt.append ?? "")).not.toContain("Workflow tool");
  });
  it("workflow:true allowlists Workflow + Task retrieval tools AND advertises the async pattern", () => {
    const o: any = resolveOptions({ workflow: true });
    for (const t of ["Workflow", "TaskOutput", "TaskGet", "TaskList"]) expect(o.allowedTools).toContain(t);
    expect(o.systemPrompt.append).toContain("Workflow tool");
    expect(o.systemPrompt.append).toContain("TaskOutput");             // the retrieval half of the loop
  });
  it("workflow:true dedupes against caller-provided allowedTools", () => {
    const o: any = resolveOptions({ workflow: true, allowedTools: ["Workflow", "Read"] });
    expect(o.allowedTools.filter((t: string) => t === "Workflow")).toHaveLength(1);
    expect(o.allowedTools).toContain("Read");
  });
  it("threads resume and sessionStore when set, omits them otherwise", () => {
    const store = { append: async () => {}, load: async () => null } as any;
    const o: any = resolveOptions({ resume: "sess-abc", sessionStore: store });
    expect(o.resume).toBe("sess-abc");
    expect(o.sessionStore).toBe(store);
    const bare: any = resolveOptions({});
    expect(bare).not.toHaveProperty("resume");
    expect(bare).not.toHaveProperty("sessionStore");
  });
  it("emits persistSession for true and false, omits when undefined", () => {
    expect((resolveOptions({ persistSession: false }) as any).persistSession).toBe(false);
    expect((resolveOptions({ persistSession: true }) as any).persistSession).toBe(true);
    expect(resolveOptions({})).not.toHaveProperty("persistSession");
  });
  it("passes config.hooks through to options.hooks, omits when absent", () => {
    const hooks = { PostToolUse: [{ hooks: [async () => ({})] }] };
    const o: any = resolveOptions({ hooks });
    expect(o.hooks).toBe(hooks);
    expect(resolveOptions({})).not.toHaveProperty("hooks");
  });
  it("threads the turn-control fields through, omits them when absent", () => {
    const o: any = resolveOptions({
      effort: "high",
      thinking: { type: "enabled", budgetTokens: 1024 },
      maxBudgetUsd: 0.5,
      taskBudget: { total: 60000 },
      includePartialMessages: true,
      forwardSubagentText: true,
    });
    expect(o.effort).toBe("high");
    expect(o.thinking).toEqual({ type: "enabled", budgetTokens: 1024 });
    expect(o.maxBudgetUsd).toBe(0.5);
    expect(o.taskBudget).toEqual({ total: 60000 });
    expect(o.includePartialMessages).toBe(true);
    expect(o.forwardSubagentText).toBe(true);
    const bare: any = resolveOptions({});
    for (const k of ["thinking", "maxBudgetUsd", "taskBudget", "includePartialMessages", "forwardSubagentText"])
      expect(bare).not.toHaveProperty(k);
  });
  it("emits maxBudgetUsd:0 (guards on !== undefined, not truthiness)", () => {
    expect((resolveOptions({ maxBudgetUsd: 0 }) as any).maxBudgetUsd).toBe(0);
  });
  it("passes outputFormat straight through to options.outputFormat (probe 36), omitted when absent", () => {
    const o: any = resolveOptions({ outputFormat: { type: "json_schema", schema: { type: "object" } } });
    expect(o.outputFormat).toEqual({ type: "json_schema", schema: { type: "object" } });
    expect(resolveOptions({})).not.toHaveProperty("outputFormat");
  });
  it("forces a supported model when permissionMode is auto (model-gated)", () => {
    expect((resolveOptions({ permissionMode: "auto", model: "claude-haiku-4-5" }) as any).model).toBe("claude-sonnet-5");
    expect((resolveOptions({ permissionMode: "auto", model: "claude-opus-4-8" }) as any).model).toBe("claude-opus-4-8");   // still auto-capable
    expect((resolveOptions({ permissionMode: "auto", model: "claude-fable-5" }) as any).model).toBe("claude-fable-5");    // probe 72
    expect((resolveOptions({ permissionMode: "auto" }) as any).model).toBe("claude-opus-5");
  });
  it("does not touch the model for non-auto modes", () => {
    expect((resolveOptions({ permissionMode: "default", model: "claude-haiku-4-5" }) as any).model).toBe("claude-haiku-4-5");
  });
  it("wires the time-travel knobs: resumeAt → resumeSessionAt, forkSession passthrough (probes 37/37b)", () => {
    const o: any = resolveOptions({ resume: "sid", resumeAt: "uuid-1", forkSession: true });
    expect(o.resume).toBe("sid");
    expect(o.resumeSessionAt).toBe("uuid-1");
    expect(o.forkSession).toBe(true);
    const bare: any = resolveOptions({});
    expect(bare).not.toHaveProperty("resumeSessionAt");
    expect(bare).not.toHaveProperty("forkSession");
  });
});

// `extraOptions` is spread LAST and is meant to win — it is the escape hatch for SDK options this config has
// no first-class field for. But the config it merges into is not always written by the same actor: the app
// server BUILDS a config around a client-supplied one (server.ts's `buildConfig`, review.ts's `reviewConfig`),
// and for those keys "the escape hatch wins" means a client can reach in and switch off a guarantee the
// server established on someone else's behalf. So a short list of keys is re-asserted after the merge — and
// only when the server actually computed one, which is what keeps the hatch open everywhere it defeats
// nothing.
describe("resolveOptions — extraOptions cannot defeat a server-established guarantee", () => {
  const broker = { request: async () => ({ kind: "deny" as const }) };
  const onElicitation = async () => ({ action: "cancel" as const });

  it("keeps the computed cwd — the isolation boundary a review's re-rooting rests on", () => {
    const o: any = resolveOptions({ cwd: "/repo/target", extraOptions: { cwd: "/etc" } });
    expect(o.cwd).toBe("/repo/target");
  });

  it("keeps the resolved disallowedTools — the read-only policy is not a suggestion", () => {
    const o: any = resolveOptions({ disallowedTools: ["Edit", "Write"], extraOptions: { disallowedTools: [] } });
    expect(o.disallowedTools).toEqual(["Edit", "Write"]);
  });

  it("keeps the permission gate wired, so no client can unhook canUseTool", () => {
    // The whole park-a-decision keystone hangs off this one option: nulled, every tool call the engine makes
    // is auto-approved with no decision ever reaching a client.
    const o: any = resolveOptions({ permissionBroker: broker, extraOptions: { canUseTool: null } });
    expect(typeof o.canUseTool).toBe("function");
  });

  it("keeps the elicitation bridge wired, so no client can disable it", () => {
    const o: any = resolveOptions({ onElicitation, extraOptions: { onElicitation: null } });
    expect(o.onElicitation).toBe(onElicitation);
  });

  it("still lets the escape hatch win for an ordinary key, and for a reserved key nobody claimed", () => {
    // Reversing the spread wholesale would break the hatch's whole purpose, so the reservation is narrow in
    // both directions: any other key still wins, and even a reserved key wins when the server computed no
    // value for it — there is no guarantee to defeat in that case.
    const ordinary: any = resolveOptions({ title: "typed", extraOptions: { title: "escape-hatch", someFutureOption: 1 } });
    expect(ordinary.title).toBe("escape-hatch");
    expect(ordinary.someFutureOption).toBe(1);
    const unclaimed: any = resolveOptions({ extraOptions: { cwd: "/somewhere" } });
    expect(unclaimed.cwd).toBe("/somewhere");
  });
});

// M7 Task 7: the dynamic-tool overlay is the app server's own — a client declares TOOLS, the server decides
// which MCP servers publish them, and `dynamicToolServers` is how that decision is carried to one engine
// build. It is merged AFTER the escape hatch, onto the object this function returns, because everything the
// naming invariant rests on (`mcp__<namespace>__<tool>`) rides in it.
describe("resolveOptions — the server-owned dynamic-tool overlay", () => {
  const overlay = { ops: { type: "sdk", name: "ops", instance: {} } };

  it("merges the overlay into mcpServers beside the caller's own servers", () => {
    const o: any = resolveOptions({ mcpServers: { theirs: { type: "sdk", name: "theirs", instance: {} } } as any, dynamicToolServers: overlay });
    expect(Object.keys(o.mcpServers).sort()).toEqual(["ops", "theirs"]);
    expect(o.mcpServers.ops).toBe(overlay.ops);
  });

  it("wins over an extraOptions.mcpServers that would otherwise clobber the whole map", () => {
    // The hatch is spread last and REPLACES mcpServers wholesale. Merged before it, the overlay would
    // vanish with no error anywhere — the thread's declared tools simply never reach the model.
    const o: any = resolveOptions({ extraOptions: { mcpServers: { hatch: { type: "sdk", name: "hatch", instance: {} } } }, dynamicToolServers: overlay });
    expect(Object.keys(o.mcpServers).sort()).toEqual(["hatch", "ops"]);
    expect(o.mcpServers.ops).toBe(overlay.ops);
  });

  it("never mutates the caller's own mcpServers map", () => {
    const mine = { theirs: { type: "sdk", name: "theirs", instance: {} } } as any;
    resolveOptions({ mcpServers: mine, dynamicToolServers: overlay });
    expect(Object.keys(mine)).toEqual(["theirs"]);
  });

  it("forces CLAUDE_AGENT_SDK_MCP_NO_PREFIX off, even against an extraOptions.env that replaced the whole env", () => {
    // A truthy value strips the `mcp__<server>__` prefix from every tool name and collapses every namespace
    // into one flat space — the whole naming invariant rides on it being off for a declaring thread.
    const o: any = resolveOptions({ extraOptions: { env: { CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1", KEEP: "yes" } }, dynamicToolServers: overlay });
    expect(o.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX).toBe("");
    expect(o.env.KEEP).toBe("yes");
  });

  it("leaves a NON-declaring config's mcpServers and env exactly as they were", () => {
    const o: any = resolveOptions({ mcpServers: { theirs: { type: "sdk", name: "theirs", instance: {} } } as any, env: { CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1" } });
    expect(Object.keys(o.mcpServers)).toEqual(["theirs"]);
    expect(o.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX).toBe("1");
  });
});
