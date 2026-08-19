// test/unit/appserver/fr-delete-live-host-roster.test.ts — M5 fix wave A, finding A1.
//
// `thread/delete`'s cross-process live-guard (D-M5-21c) asks the roster "does a ccx process hold this
// conversation?" and the roster answers with `row.sessionId`. That field was written only from inside a
// turn, so a host that HELD a conversation without having run a turn on it — every `ccx --resume <id>`
// sitting at its prompt, and every terminal-side `/resume` until the next message — had a row that did
// not name what it held. The guard read "not live" and erased the transcript with `{ok:true}`; the same
// staleness inverted made the conversation the host had LEFT undeletable.
//
// WHY THE REAL HOST. The bug is not in the guard's logic — it is in the value the guard reads, and the
// only writer of that value is `SessionHost`. A test that wrote roster rows itself (as every other
// roster-touching case in this suite legitimately does, because their subject is the guard) would be
// asserting against rows a test author kept current by hand, which is precisely the property production
// did not have. So these rows drive the real host: real `writeRoster`, real row shape, real transitions,
// with only the SDK engine faked — and the real `procStartOf`, uninjected, so `isPidLive` answers about a
// genuinely running process (this one) rather than about a stamp no `ps` will ever confirm.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../../src/host/host.js";
import type { HostSession } from "../../../src/host/host.js";
import { listRoster } from "../../../src/fleet/roster.js";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));

/** An engine whose `sessionId` is undefined until a turn's init frame — the real getter's shape
 *  (router.ts's routeInit), and the whole reason the host cannot wait for it. `idAtInit` is what this
 *  engine reports once a turn runs; a RESUMED engine reports nothing until then, which is what makes the
 *  host's own `resumedFrom` the only truth in between. */
function fakeEngine(idAtInit: string | undefined): HostSession {
  let sid: string | undefined;
  return {
    get sessionId() { return sid; },
    async submit(_p: string, onMessage: (m: unknown) => void) {
      sid = idAtInit;
      onMessage({ type: "system", subtype: "init", session_id: idAtInit });
      return { result: {} };
    },
    async dispose() {},
    onFrame: () => () => {},
    isEnded: () => false,
  } as unknown as HostSession;
}

let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
const hosts: SessionHost[] = [];
const servers: AppServer[] = [];
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-delete-live-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop().catch(() => {});
  for (const s of servers.splice(0)) await s.shutdown().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

/** A host of the shape a terminal runs: interactive, detached, its own short. `openSession` is handed the
 *  config the host actually opens with, so the fake can answer the way a resumed engine does. */
async function startHost(short: string, config: Record<string, unknown>, idsAtInit: (resume: string | undefined) => string | undefined): Promise<SessionHost> {
  const h = new SessionHost({ short, name: short, cwd: "/w", kind: "interactive", detached: true, config },
    { openSession: (c) => fakeEngine(idsAtInit(c.resume)) });
  hosts.push(h);
  await h.start();
  return h;
}

function boot(deps: Partial<AppServerDeps> = {}) {
  const deleted: string[] = [];
  const srv = new AppServer({}, {
    deleteSession: async (id: string) => { deleted.push(id); },
    getSessionInfo: async (id: string) => ({ sessionId: id, summary: `summary of ${id}`, lastModified: 5_000 }),
    listSessions: async () => [],
    ...deps,
  } as AppServerDeps);
  servers.push(srv);
  const s = mkSink();
  const c = srv.connect(s.sink);
  c.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "A" } } }) + "\n");
  let next = 100;
  const del = async (sessionId: string): Promise<Record<string, any>> => {
    const id = next++;
    c.feed(JSON.stringify({ id, method: "thread/delete", params: { threadId: sessionId } }) + "\n");
    for (let i = 0; i < 400; i++) {
      const f = parsed(s.lines).find((m) => m.id === id);
      if (f) return f;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no reply to thread/delete ${sessionId}`);
  };
  return { srv, deleted, del };
}

const rosterIds = () => listRoster().map((r) => r.sessionId);

describe("thread/delete vs a conversation a live host holds but has not run a turn on (M5 fix wave A, A1)", () => {
  it("a terminal resumed onto a conversation and idle at its prompt makes it UNDELETABLE — before any turn exists to stamp the row", async () => {
    await startHost("aaaaaaaa", { resume: "sess-held" }, () => "sess-held");
    // The claim is about the ROW first: the host names what it holds from its first instant on disk.
    expect(rosterIds()).toEqual(["sess-held"]);

    const { deleted, del } = boot();
    const r = await del("sess-held");
    expect([r.error?.code, r.error?.message]).toEqual([ERR.BUSY, "Thread is live in another ccx process; close it there first"]);
    expect(deleted).toEqual([]);

    // …and the guard has not simply become "refuse everything": a conversation no host on this roster
    // holds still deletes. Without this half the row above passes on a server that refused unconditionally.
    expect((await del("sess-cold")).result).toEqual({ ok: true });
    expect(deleted).toEqual(["sess-cold"]);
  });

  it("a terminal-side /resume moves the protection WITH the host: the conversation it walked to is refused, the one it left is released", async () => {
    // The opposite failure direction, and the one that is cheap when it is wrong: a row naming a session
    // nobody holds refuses a delete the user can retry, while a row that has not caught up erases a
    // transcript nobody can get back. Both come from the same stale field, so both are pinned.
    const h = await startHost("bbbbbbbb", {}, (resume) => (resume === undefined ? "sess-first" : undefined));
    await h.runTask("hello");                    // the engine mints sess-first; the per-turn stamp records it
    expect(rosterIds()).toEqual(["sess-first"]);

    await h.resumeSession("sess-second");        // /resume in the terminal — no turn after it
    expect(rosterIds()).toEqual(["sess-second"]);

    const { deleted, del } = boot();
    const held = await del("sess-second");
    expect([held.error?.code, held.error?.message]).toEqual([ERR.BUSY, "Thread is live in another ccx process; close it there first"]);
    expect((await del("sess-first")).result).toEqual({ ok: true });
    expect(deleted).toEqual(["sess-first"]);
  });

  it("a /clear releases the conversation the host walked away from — an absent id means 'holds nothing', never 'not known yet'", async () => {
    // The clearing half of the same write. Left un-cleared, the row keeps naming a conversation this host
    // has discarded, and that conversation is undeletable for as long as the terminal stays open.
    const h = await startHost("cccccccc", { resume: "sess-dropped" }, () => undefined);
    expect(rosterIds()).toEqual(["sess-dropped"]);

    await h.clearSession();
    expect(rosterIds()).toEqual([undefined]);

    const { deleted, del } = boot();
    expect((await del("sess-dropped")).result).toEqual({ ok: true });
    expect(deleted).toEqual(["sess-dropped"]);
  });

  it("a FORKING launch resume names nothing: `--bg --resume` reads the parent into a new id and holds neither yet", async () => {
    // D-M5-21b's predicate, on the roster side. hostMain pairs `--bg --resume` with `forkSession`, and the
    // parent is READ rather than held — stamping it would make a cold conversation permanently undeletable
    // by a host that never opens it. The fork's own id arrives at its first turn, like any fresh session's.
    const h = await startHost("dddddddd", { resume: "sess-parent", forkSession: true }, () => "sess-forked");
    expect(rosterIds()).toEqual([undefined]);

    const { deleted, del } = boot();
    expect((await del("sess-parent")).result).toEqual({ ok: true });
    expect(deleted).toEqual(["sess-parent"]);

    await h.runTask("hello");
    expect(rosterIds()).toEqual(["sess-forked"]);
    expect((await del("sess-forked")).error?.code).toBe(ERR.BUSY);
  });
});
