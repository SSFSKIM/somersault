// test/unit/handlers.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Peer } from "../../src/peer.js";
import { AppServer, toUsageTotals } from "../../src/handlers.js";
import type { OpenFn } from "../../src/handlers.js";
import { recordThread } from "../../src/threads.js";
import { fakeOpen } from "../../src/_fake.js";

// A fake Session whose submit() streams one assistant message then resolves with a result string.
function fakeSession() {
  return {
    submit: async (_p: string, onMessage: (m: any) => void) => {
      onMessage({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } });
      return { result: "final text" };
    },
    usage: async () => ({ input_tokens: 60, output_tokens: 40 }),
    dispose: async () => {},
  } as any;
}

function wire() {
  const out: any[] = [];
  const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
  const server = new AppServer(peer, { open: () => fakeSession() });
  return { out, peer };
}

describe("toUsageTotals", () => {
  it("sums the probe-32 nested model_usage, folding cache into input", () => {
    const u = { session: { model_usage: {
      "claude-opus-4-8": { inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 200, cacheCreationInputTokens: 50 },
      "claude-haiku-4-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    } } };
    expect(toUsageTotals(u)).toEqual({ inputTokens: 360, outputTokens: 45, totalTokens: 405 });
  });
  it("returns zeros for an empty/unknown shape (lenient, no throw)", () => {
    expect(toUsageTotals({})).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(toUsageTotals(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});

describe("sandbox wiring (threadStart)", () => {
  function captureCfg(deps: { autoReview?: boolean; network?: boolean }) {
    let captured: any;
    const peer = new Peer((_o) => {}, (m, p, id) => server.handleRequest(m, p, id), () => {});
    const server = new AppServer(peer, { ...deps, open: (cfg) => { captured = cfg; return fakeSession(); } });
    return { peer, server, cfg: () => captured };
  }

  it("translates a workspace-write posture into cfg.sandbox + credential deny settings", () => {
    const h = captureCfg({ autoReview: true, network: true });
    h.server.handleRequest("thread/start", { cwd: "/tmp/ws", sandbox: "workspace-write" }, 1);
    expect(h.cfg().sandbox).toMatchObject({
      enabled: true, autoAllowBashIfSandboxed: true, excludedCommands: ["gh *", "docker *"],
      network: { allowedDomains: expect.arrayContaining(["github.com"]) },
    });
    expect(h.cfg().settings).toEqual({ permissions: { deny: expect.any(Array) } });
  });

  it("danger-full-access leaves the worker unsandboxed (no cfg.sandbox/settings)", () => {
    const h = captureCfg({ autoReview: true, network: true });
    h.server.handleRequest("thread/start", { cwd: "/tmp/ws", sandbox: "danger-full-access" }, 1);
    expect(h.cfg().sandbox).toBeUndefined();
    expect(h.cfg().settings).toBeUndefined();
  });
});

describe("dynamic tool brokering", () => {
  it("relays a dynamic-tool call to the client via item/tool/call and feeds the reply back to the agent", async () => {
    const out: any[] = [];
    // The session drives one broker call mid-turn and folds the reply into its final text.
    const openDrivesTool: OpenFn = (_cfg, ctx) => ({
      submit: async (_p: string, onMsg: (m: any) => void) => {
        onMsg({ type: "assistant", message: { content: [{ type: "text", text: "calling" }] } });
        const r = await ctx.broker!.call("linear_graphql", { query: "Q" });
        return { result: `got: ${(r.contentItems ?? []).map((c) => c?.text ?? "").join("")}` };
      },
      usage: async () => ({}), dispose: async () => {},
    } as any);
    let server!: AppServer;
    // The sink emulates the client: it answers any item/tool/call request with a fixed result.
    const peer: Peer = new Peer(
      (o: any) => { out.push(o); if (o.method === "item/tool/call") peer.feed(JSON.stringify({ id: o.id, result: { contentItems: [{ type: "inputText", text: "OK-42" }], success: true } }) + "\n"); },
      (m, p, id) => server.handleRequest(m, p, id),
      () => {},
    );
    server = new AppServer(peer, { open: openDrivesTool });
    const spec = { name: "linear_graphql", description: "d", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } };
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", dynamicTools: [spec] } }) + "\n");
    const threadId = out.find((o) => o.id === 1).result.thread.id;
    peer.feed(JSON.stringify({ id: 2, method: "turn/start", params: { threadId, input: [{ type: "text", text: "go" }], cwd: "/w" } }) + "\n");
    await new Promise((r) => setTimeout(r, 20));
    const call = out.find((o) => o.method === "item/tool/call");
    expect(call.params).toMatchObject({ tool: "linear_graphql", arguments: { query: "Q" }, threadId });
    expect(typeof call.params.callId).toBe("string");
    const fa = out.find((o) => o.method === "item/completed" && o.params?.item?.phase === "final_answer");
    expect(fa.params.item.text).toBe("got: OK-42");
    // documented lifecycle: item/started + item/completed for the dynamicToolCall item
    expect(out.some((o) => o.method === "item/started" && o.params?.item?.type === "dynamicToolCall")).toBe(true);
    expect(out.some((o) => o.method === "item/completed" && o.params?.item?.type === "dynamicToolCall" && o.params?.item?.success === true)).toBe(true);
  });

  it("does NOT register a broker server when no dynamicTools are advertised", async () => {
    const cfgs: any[] = [];
    const captureOpen: OpenFn = (cfg) => { cfgs.push(cfg); return fakeSession(); };
    let server!: AppServer;
    const peer = new Peer(() => {}, (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open: captureOpen });
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w" } }) + "\n");
    expect(cfgs[0]?.mcpServers).toBeUndefined();
  });
});

describe("posture wiring in handlers", () => {
  function captureOpen(capturedCfgs: any[]): OpenFn {
    return (cfg) => {
      capturedCfgs.push(cfg);
      return {
        submit: async (_p: string, onMsg: (m: any) => void) => { onMsg({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }); return { result: "ok" }; },
        usage: async () => ({}), dispose: async () => {},
      } as any;
    };
  }

  it("autoReview:true -> open cfg permissionMode:'auto'", async () => {
    const cfgs: any[] = [];
    let server!: AppServer;
    const peer = new Peer(() => {}, (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open: captureOpen(cfgs), autoReview: true });
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", approvalPolicy: "on-request" } }) + "\n");
    expect(cfgs[0]?.permissionMode).toBe("auto");
  });

  it("on-request + no autoReview -> open cfg permissionMode:'default'", async () => {
    const cfgs: any[] = [];
    let server!: AppServer;
    const peer = new Peer(() => {}, (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open: captureOpen(cfgs), autoReview: false });
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", approvalPolicy: "on-request" } }) + "\n");
    expect(cfgs[0]?.permissionMode).toBe("default");
  });

  it("on-request + no autoReview -> open cfg has permissionBroker set", async () => {
    const cfgs: any[] = [];
    let server!: AppServer;
    const peer = new Peer(() => {}, (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open: captureOpen(cfgs), autoReview: false });
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", approvalPolicy: "on-request" } }) + "\n");
    expect(cfgs[0]?.permissionBroker).toBeDefined();
  });

  it("autoReview:true -> open cfg does NOT have permissionBroker", async () => {
    const cfgs: any[] = [];
    let server!: AppServer;
    const peer = new Peer(() => {}, (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open: captureOpen(cfgs), autoReview: true });
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", approvalPolicy: "on-request" } }) + "\n");
    expect(cfgs[0]?.permissionBroker).toBeUndefined();
  });
});

describe("AppServer happy path", () => {
  it("initialize returns userAgent + platformOs (no Claude-specific capability)", () => {
    const { out, peer } = wire();
    peer.feed(JSON.stringify({ id: 1, method: "initialize", params: { capabilities: {} } }) + "\n");
    expect(out[0]).toMatchObject({ id: 1, result: { userAgent: "cc-codex-appserver" } });
    expect((out[0] as any).result.capabilities).toBeUndefined();
  });
  it("thread/start returns {thread:{id}} and turn/start streams to a MANDATORY final_answer + turn/completed", async () => {
    const { out, peer } = wire();
    peer.feed(JSON.stringify({ id: 1, method: "initialize", params: {} }) + "\n");
    peer.feed(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    peer.feed(JSON.stringify({ id: 2, method: "thread/start", params: { cwd: "/w" } }) + "\n");
    const tsResp = out.find((o) => o.id === 2);
    const threadId = tsResp.result.thread.id;
    expect(typeof threadId).toBe("string");
    peer.feed(JSON.stringify({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "go" }], cwd: "/w" } }) + "\n");
    await new Promise((r) => setTimeout(r, 10));               // let the async turn drain
    const turnResp = out.find((o) => o.id === 3);
    expect(turnResp.result.turn.id).toBeDefined();
    const methods = out.filter((o) => o.method).map((o) => o.method);
    expect(methods).toContain("turn/started");
    const finalAnswer = out.find((o) => o.method === "item/completed" && o.params?.item?.phase === "final_answer");
    expect(finalAnswer.params.item.text).toBe("final text");
    expect(methods).toContain("turn/completed");
  });
});

describe("thread/resume", () => {
  function wireDirect(open: OpenFn) {
    const out: any[] = [];
    let server!: AppServer;
    const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open });
    return { out, server };
  }

  it("reopens via cfg.resume and keeps the thread id", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    process.env.CC_APPSERVER_STATE_DIR = dir;
    try {
      recordThread("thr_deadbeef", "sdk_prev", "/w", dir);
      const opened: any[] = [];
      const { out, server } = wireDirect((cfg) => { opened.push(cfg); return fakeSession(); });
      server.handleRequest("thread/resume", { threadId: "thr_deadbeef", cwd: "/w", approvalPolicy: "never" }, 7);
      expect(out.find((o) => o.id === 7)?.result).toEqual({ thread: { id: "thr_deadbeef" } });
      expect(opened[0].resume).toBe("sdk_prev");
      expect(out.some((o) => o.method === "thread/started")).toBe(true);
    } finally {
      delete process.env.CC_APPSERVER_STATE_DIR;
    }
  });

  it("unknown threadId -> INVALID_PARAMS (-32602)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    process.env.CC_APPSERVER_STATE_DIR = dir;
    try {
      const { out, server } = wireDirect(() => fakeSession());
      server.handleRequest("thread/resume", { threadId: "thr_missing", cwd: "/w" }, 8);
      const err = out.find((o) => o.id === 8);
      expect(err?.error?.code).toBe(-32602);
    } finally {
      delete process.env.CC_APPSERVER_STATE_DIR;
    }
  });

  it("disposes a still-live registry entry before a second thread/resume overwrites it", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    process.env.CC_APPSERVER_STATE_DIR = dir;
    try {
      recordThread("thr_deadbeef", "sdk_prev", "/w", dir);
      let disposed = false;
      let opens = 0;
      // thread/resume reuses params.threadId verbatim (no allocId), so resuming the SAME threadId twice
      // — e.g. a Director retry/reconnect — is the exact collision this fix guards against.
      const { out, server } = wireDirect(() => {
        opens += 1;
        return opens === 1 ? { ...fakeSession(), dispose: async () => { disposed = true; } } : fakeSession();
      });
      server.handleRequest("thread/resume", { threadId: "thr_deadbeef", cwd: "/w" }, 7);
      expect(out.find((o) => o.id === 7)?.result).toEqual({ thread: { id: "thr_deadbeef" } });
      expect(disposed).toBe(false); // first session is still the live registry entry, untouched so far
      server.handleRequest("thread/resume", { threadId: "thr_deadbeef", cwd: "/w" }, 8);
      expect(out.find((o) => o.id === 8)?.result).toEqual({ thread: { id: "thr_deadbeef" } });
      expect(disposed).toBe(true); // the stale first session was disposed before the second install
    } finally {
      delete process.env.CC_APPSERVER_STATE_DIR;
    }
  });
});

describe("account/read", () => {
  function wireDirect(open: OpenFn) {
    const out: any[] = [];
    let server!: AppServer;
    const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open });
    return { out, server };
  }

  it("maps accountInfo, caches across calls (single ephemeral session opened+disposed once)", async () => {
    let opens = 0;
    let disposed = false;
    const open: OpenFn = () => {
      opens++;
      return { ...fakeSession(), accountInfo: async () => ({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty" }), dispose: async () => { disposed = true; } } as any;
    };
    const { out, server } = wireDirect(open);
    server.handleRequest("account/read", {}, 4);
    await new Promise((r) => setTimeout(r, 10));
    expect(out.find((o) => o.id === 4)?.result).toEqual({ account: { authenticated: true, method: "oauth-token", provider: "firstParty" } });
    expect(disposed).toBe(true); // ephemeral session disposed right after the accountInfo() call
    server.handleRequest("account/read", {}, 5);
    await new Promise((r) => setTimeout(r, 10));
    expect(out.find((o) => o.id === 5)?.result).toEqual({ account: { authenticated: true, method: "oauth-token", provider: "firstParty" } });
    expect(opens).toBe(1); // cached — second call did not reopen a session
  });

  it("open() throwing -> {authenticated:false}, no method/provider, and caches the failure (no reopen)", async () => {
    let opens = 0;
    const open: OpenFn = () => { opens++; throw new Error("boom"); };
    const { out, server } = wireDirect(open);
    server.handleRequest("account/read", {}, 4);
    await new Promise((r) => setTimeout(r, 10));
    expect(out.find((o) => o.id === 4)?.result).toEqual({ account: { authenticated: false } });
    server.handleRequest("account/read", {}, 5);
    await new Promise((r) => setTimeout(r, 10));
    expect(out.find((o) => o.id === 5)?.result).toEqual({ account: { authenticated: false } });
    expect(opens).toBe(1); // failure is cached too — second call never re-opened
  });

  it("session.accountInfo() rejecting still disposes the session -> {authenticated:false}", async () => {
    let disposed = false;
    const open: OpenFn = () => ({ ...fakeSession(), accountInfo: async () => { throw new Error("rpc down"); }, dispose: async () => { disposed = true; } } as any);
    const { out, server } = wireDirect(open);
    server.handleRequest("account/read", {}, 4);
    await new Promise((r) => setTimeout(r, 10));
    expect(out.find((o) => o.id === 4)?.result).toEqual({ account: { authenticated: false } });
    expect(disposed).toBe(true); // disposal runs on the failure path too (finally), not just on success
  });
});

describe("turn/interrupt", () => {
  function wireFake() {
    const out: any[] = [];
    let server!: AppServer;
    const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open: fakeOpen });
    return { out, peer };
  }

  it("aborts a hanging turn -> {} reply then turn/failed", async () => {
    const { out, peer } = wireFake();
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", approvalPolicy: "never" } }) + "\n");
    const threadId = out.find((o) => o.id === 1).result.thread.id;
    peer.feed(JSON.stringify({ id: 2, method: "turn/start", params: { threadId, input: [{ type: "text", text: "please HANG" }] } }) + "\n");
    peer.feed(JSON.stringify({ id: 3, method: "turn/interrupt", params: { threadId } }) + "\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(out.find((o) => o.id === 3)?.result).toEqual({});
    expect(out.some((o) => o.method === "turn/failed")).toBe(true);
  });

  it("unknown threadId -> INVALID_PARAMS (-32602)", () => {
    const { out, peer } = wireFake();
    peer.feed(JSON.stringify({ id: 1, method: "turn/interrupt", params: { threadId: "thr_missing" } }) + "\n");
    const err = out.find((o) => o.id === 1);
    expect(err?.error?.code).toBe(-32602);
  });

  it("interrupting an idle (already-resolved) turn is a benign no-op -> {} reply, no turn/failed", async () => {
    const { out, peer } = wireFake();
    peer.feed(JSON.stringify({ id: 1, method: "thread/start", params: { cwd: "/w", approvalPolicy: "never" } }) + "\n");
    const threadId = out.find((o) => o.id === 1).result.thread.id;
    peer.feed(JSON.stringify({ id: 2, method: "turn/start", params: { threadId, input: [{ type: "text", text: "go" }] } }) + "\n");
    await new Promise((r) => setTimeout(r, 20)); // let the turn complete normally first
    peer.feed(JSON.stringify({ id: 3, method: "turn/interrupt", params: { threadId } }) + "\n");
    await new Promise((r) => setTimeout(r, 5));
    expect(out.find((o) => o.id === 3)?.result).toEqual({});
    expect(out.some((o) => o.method === "turn/failed")).toBe(false);
  });
});

describe("thread/name/set and config/read", () => {
  function wireDirect(open: OpenFn) {
    const out: any[] = [];
    let server!: AppServer;
    const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
    server = new AppServer(peer, { open });
    return { out, server };
  }

  it("thread/name/set replies {}", () => {
    const { out, server } = wireDirect(() => fakeSession());
    server.handleRequest("thread/name/set", { threadId: "thr_123", name: "My Thread" }, 1);
    expect(out.find((o) => o.id === 1)?.result).toEqual({});
  });

  it("config/read replies {config:{model: DEFAULTS.model}}", () => {
    const { out, server } = wireDirect(() => fakeSession());
    server.handleRequest("config/read", {}, 2);
    expect(out.find((o) => o.id === 2)?.result).toEqual({ config: { model: "claude-opus-4-8" } });
  });
});
