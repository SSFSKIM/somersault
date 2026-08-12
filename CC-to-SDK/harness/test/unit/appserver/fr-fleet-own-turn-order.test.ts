// test/unit/appserver/fr-fleet-own-turn-order.test.ts — final pre-merge review R4.
// On an OWN fleet turn the user item is published by onAccepted (on the microtask after the host's prompt
// reply), while a host assistant frame bundled with (or ahead of) that reply routes synchronously through
// the event layer's onFrame. Unheld, a subscriber sees the assistant item before the user item. The fix
// holds own-turn item emission behind the same F2 ack the turn/completed edge uses, so the user item is on
// the wire first. Driven wire-level against a real fake host that streams the assistant frame INSIDE the
// prompt handler (before the reply) — the only honest way to reproduce the interleave.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-order-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

async function bootAttached() {
  const fh = await startFakeHost();
  hosts.push(fh);
  writeRoster(fh.row);
  const srv = new AppServer({}, {} as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  send(conn, { id: 2, method: "thread/attach", params: { target: fh.row.short } });
  await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
  const threadId = frame(s.lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
  s.lines.length = 0;
  return { fh, conn, lines: s.lines, threadId };
}

describe("own fleet turn item order (final review R4)", () => {
  it("the user item is on the wire BEFORE an assistant frame the host streamed ahead of the prompt reply", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    // The host streams the assistant frame synchronously inside the prompt handler, before the reply.
    fh.emitOnNextPrompt([{ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } }]);
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(notifs(lines, "item/started").some((n) => n.params.item.type === "agentMessage")).toBe(true));

    const seq = parsed(lines);
    const iUser = seq.findIndex((f) => f.method === "item/completed" && f.params?.item?.type === "userMessage");
    const iAssistantStart = seq.findIndex((f) => f.method === "item/started" && f.params?.item?.type === "agentMessage");
    const iReply = seq.findIndex((f) => f.id === 4 && f.result);
    expect(iUser).toBeGreaterThanOrEqual(0);
    expect(iAssistantStart).toBeGreaterThanOrEqual(0);
    // THE FIX: the user item precedes the assistant item, and both follow the inProgress reply that
    // published the user item (own-turn item emission is held behind the F2 ack).
    expect(iReply).toBeGreaterThanOrEqual(0);
    expect(iUser).toBeGreaterThan(iReply);
    expect(iAssistantStart).toBeGreaterThan(iUser);

    // and the turn still completes cleanly
    fh.endTurn(1, { result: "done" });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t1@e0", status: "completed" });
  });
});
