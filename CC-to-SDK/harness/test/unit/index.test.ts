import { describe, it, expect } from "vitest";
import * as api from "../../src/index.js";

describe("public API", () => {
  it("exports createHarness, resolveOptions, BUILTIN_AGENTS, BUILTIN_OUTPUT_STYLES", () => {
    expect(typeof api.createHarness).toBe("function");
    expect(typeof api.resolveOptions).toBe("function");
    expect(api.BUILTIN_AGENTS).toBeTruthy();
    expect(api.BUILTIN_OUTPUT_STYLES).toBeTruthy();
    expect(typeof api.resumeHarness).toBe("function");
    expect(typeof api.listSessions).toBe("function");
    expect(typeof api.getSessionMessages).toBe("function");
    expect(typeof api.getSessionInfo).toBe("function");
    expect(typeof api.createContextMcpServer).toBe("function");
    expect(typeof api.summarizeUsage).toBe("function");
    expect(typeof api.createCompactMcpServer).toBe("function");
    expect(typeof api.openSession).toBe("function");
    expect(typeof api.resumeSession).toBe("function");
    expect(typeof api.Session).toBe("function");
    expect(typeof api.forkSession).toBe("function");
  });
  it("exports the time-travel + limits surface (Wave 1)", () => {
    expect(typeof api.rewindSession).toBe("function");
    expect(typeof api.classifyLimitText).toBe("function");
    expect(typeof api.classifyLimitMessage).toBe("function");
  });
  it("exports the session-store mutation wrappers", () => {
    expect(typeof api.renameSession).toBe("function");
    expect(typeof api.tagSession).toBe("function");
    expect(typeof api.deleteSession).toBe("function");
  });
  it("exports the hook builders and mergeHooks", () => {
    expect(typeof api.injectContext).toBe("function");
    expect(typeof api.guardTool).toBe("function");
    expect(typeof api.blockTool).toBe("function");
    expect(typeof api.observe).toBe("function");
    expect(typeof api.mergeHooks).toBe("function");
  });
  it("exports the daemon client + dashboard snapshot (advanced-seam, increment 2)", () => {
    expect(typeof api.connectDaemon).toBe("function");
    expect(typeof api.collect).toBe("function");
  });
  it("exports the permission seam (advanced-seam, increment 3)", () => {
    expect(typeof api.createPermissionGate).toBe("function");
  });
  it("exports the PendingEntry wire type (advanced-seam, increment 4)", () => {
    const _pe: api.PendingEntry = { sessionId: "s", toolUseID: "t", toolName: "Edit", input: {}, createdAt: 0, kind: "permission" };
    expect(_pe.toolUseID).toBe("t");
  });
  it("exports the decision kinds + PendingDecision(s) (goal B, task 1)", () => {
    const k: api.DecisionKind = "question";
    const out: api.DecisionOutcome = { kind: "plan_approve", acceptEdits: true };
    const pd: api.PendingDecision = { sessionId: "s", toolUseID: "t", toolName: "AskUserQuestion", kind: k, input: {}, createdAt: 0 };
    expect(pd.kind).toBe("question");
    expect(out.kind).toBe("plan_approve");
    expect(typeof api.PendingDecisions).toBe("function");
  });
  it("exports the daemon permission client methods on connectDaemon's return (advanced-seam, increment 4)", () => {
    const c = api.connectDaemon("/x", (async () => []) as any);
    expect(typeof c.pendingPermissions).toBe("function");
    expect(typeof c.respondPermission).toBe("function");
  });
  it("does NOT export internal plumbing from the package root (boundary curation)", () => {
    for (const name of ["SessionRegistry", "MessageBus", "parseCompactOutcome"]) // value exports (type-only QueryHolder/CompactHolder are erased)
      expect(api).not.toHaveProperty(name);
  });
  it("exports the config validator + error (api-hardening)", () => {
    expect(typeof api.validateHarnessConfig).toBe("function");
    expect(typeof api.HarnessConfigError).toBe("function");
  });
  it("exports the RemoteChatSession socket client (a2a, task 7)", () => {
    expect(typeof api.RemoteChatSession).toBe("function");
    expect(typeof api.RemoteChatSession.connect).toBe("function");
  });
  it("exports remoteChatSession, the lazy ChatSession adapter (a2b, task 5)", () => {
    expect(typeof api.remoteChatSession).toBe("function");
  });
  it("exports the decision feed + bg-task mixins and their guards (goal B, task 6)", () => {
    expect(typeof api.hasDecisionFeed).toBe("function");
    expect(typeof api.hasBgTasks).toBe("function");
    const _df: api.DecisionFeed = {
      onDecision: () => () => {}, onDecisionSettled: () => () => {},
      answerDecision: async () => ({ ok: true }),
    };
    const _bg: api.BgTasks = { listBgTasks: async () => [], background: async () => false, stopBgTask: async () => {} };
    expect(typeof _df.answerDecision).toBe("function");
    expect(typeof _bg.background).toBe("function");
  });
  it("freezes the full public value-export surface (deliberate-update gate)", () => {
    const EXPECTED: string[] = [
      "BUILTIN_AGENTS",
      "BUILTIN_OUTPUT_STYLES",
      "COMPACT_TOOL",
      "CONTEXT_TOOL",
      "DEFAULTS",
      "DaemonError",
      "DaemonServer",
      "DaemonSupervisor",
      "HarnessConfigError",
      "KairosAssistant",
      "MODEL_ALIASES",
      "PendingDecisions",
      "RemoteChatSession",
      "Session",
      "StructuredRunError",
      "SwarmError",
      "SwarmRuntime",
      "TaskError",
      "TaskStore",
      "applyAssistantPersona",
      "blockTool",
      "classifyLimitMessage",
      "classifyLimitText",
      "collect",
      "connectDaemon",
      "createBriefMcpServer",
      "createCompactMcpServer",
      "createContextMcpServer",
      "createHarness",
      "createPermissionGate",
      "createPostgresSessionStore",
      "createRedisSessionStore",
      "createSwarmMcpServer",
      "createTaskMcpServer",
      "createWarmPool",
      "daemonRequest",
      "daemonSocketPath",
      "deleteSession",
      "ensurePostgresSessionStoreSchema",
      "forkSession",
      "getSessionInfo",
      "getSessionMessages",
      "guardTool",
      "hasBgTasks",
      "hasDecisionFeed",
      "hasRewind",
      "hasSessionEvents",
      "injectContext",
      "isAutoSupportedModel",
      "listSessions",
      "mergeHooks",
      "observe",
      "openSession",
      "postgresSessionStoreDDL",
      "remoteChatSession",
      "renameSession",
      "resolveAssistantPosture",
      "resolveAutoModel",
      "resolveModelAlias",
      "resolveOptions",
      "resolveTelemetryEnv",
      "resumeHarness",
      "resumeSession",
      "rewindSession",
      "runStructured",
      "sessionStoreConformance",
      "stdoutBriefSink",
      "summarizeUsage",
      "tagSession",
      "tenantHarnessConfig",
      "validateHarnessConfig",
    ];
    expect(Object.keys(api).sort()).toEqual(EXPECTED);
  });
});
