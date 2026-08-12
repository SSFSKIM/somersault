// test/unit/appserver/fr-mcp-set-errored.test.ts — final pre-merge review R9 (refining F7).
// mcpServer/set stored the WHOLE request as `mcpServersSet` even when the receipt reported per-server
// `errors` (a partial accept), so a later engine swap's repushThreadState would replay a server the engine
// rejected. The accumulator must reflect what the engine ACCEPTED — exclude the errored names.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeSession(receipt: unknown) {
  return {
    submit: async () => ({ result: {} }),
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: () => () => {},
    sessionId: "sess-1",
    setMcpServers: async (_servers: Record<string, unknown>) => receipt,
  };
}

async function bootOneThread(receipt: unknown) {
  const srv = new AppServer({}, { sessionFactory: () => fakeSession(receipt) as never });
  const a = mkSink(); const connA = srv.connect(a.sink);
  send(connA, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
  send(connA, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id as string;
  return { srv, a, connA, threadId };
}

describe("mcpServer/set accumulates only accepted servers (final review R9)", () => {
  it("excludes a server the receipt.errors names from mcpServersSet", async () => {
    // The engine accepted "ok" and rejected "bad".
    const receipt = { added: ["ok"], removed: [], errors: { bad: "spawn failed" } };
    const { srv, connA, threadId } = await bootOneThread(receipt);
    const record = srv.registry.get(threadId)!;

    send(connA, { id: 3, method: "mcpServer/set", params: { threadId, servers: { ok: { command: "node" }, bad: { command: "nope" } } } });
    await tick();

    // The base a later swap replays must not carry "bad" — the engine never accepted it.
    expect(record.mcpServersSet).toEqual({ ok: { command: "node" } });
  });

  it("stores the whole request when no server errored (defensive: empty errors)", async () => {
    const receipt = { added: ["ok"], removed: [], errors: {} };
    const { srv, connA, threadId } = await bootOneThread(receipt);
    const record = srv.registry.get(threadId)!;

    send(connA, { id: 3, method: "mcpServer/set", params: { threadId, servers: { ok: { command: "node" } } } });
    await tick();
    expect(record.mcpServersSet).toEqual({ ok: { command: "node" } });
  });
});
