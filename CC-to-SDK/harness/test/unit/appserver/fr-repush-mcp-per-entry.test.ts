// test/unit/appserver/fr-repush-mcp-per-entry.test.ts — final pre-merge review R10 (refining fix-wave-1).
// repushThreadState replayed the MCP toggle/override maps in ONE step; if an early entry applied to the
// replacement engine and a later one threw, the whole step was marked lost and the ENTIRE map cleared —
// but the early mutation is live on the engine, so the mirror diverged and the NEXT swap reverted it. The
// fix replays and reconciles per entry: the applied one stays, only the failed one is dropped.
import { describe, it, expect, vi } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

function mkEngine(toggleImpl: (name: string, enabled: boolean) => Promise<void>) {
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: () => () => {},
    sessionId: "s1",
    toggleMcpServer: toggleImpl,
    isEnded: () => false,
  } as never;
}

describe("MCP toggle replay reconciles per entry across a swap (final review R10)", () => {
  it("a mid-loop throw drops only the failed toggle; the applied one stays in the accumulator", async () => {
    const applied: string[] = [];
    const engines = [
      mkEngine(async () => {}),                                     // index 0: seed the toggles (all ok)
      mkEngine(async (name) => { if (name === "B") throw new Error("engine refused B"); applied.push(name); }), // index 1: B throws
    ];
    let n = 0;
    const srv = new AppServer({}, { sessionFactory: () => engines[Math.min(n++, engines.length - 1)] });
    const s = mkSink();
    const c = srv.connect(s.sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id as string;
    const record = srv.registry.get(threadId)!;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();

    // Seed two toggles on the first engine (commit-after-accept).
    send(c, { id: 4, method: "mcpServer/toggle", params: { threadId, name: "A", enabled: false } });
    send(c, { id: 5, method: "mcpServer/toggle", params: { threadId, name: "B", enabled: false } });
    await tick();
    expect(record.mcpToggles).toEqual({ A: false, B: false });
    s.lines.length = 0;

    // A clear swaps to the replacement engine, whose toggle for B throws.
    send(c, { id: 6, method: "thread/clear", params: { threadId } });
    await waitFor(() => expect(parsed(s.lines).some((f) => f.id === 6 && f.result)).toBe(true));

    // A applied and is live on the replacement, so it STAYS; only B is dropped.
    expect(record.mcpToggles).toEqual({ A: false });
    expect(applied).toEqual(["A"]);
    // and the loss is named
    const warn = parsed(s.lines).find((f) => f.method === "warning" && f.params?.code === "stateRepushFailed");
    expect(warn?.params.message).toContain("mcpToggles");
  });
});
