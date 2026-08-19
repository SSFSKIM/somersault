// test/unit/appserver/fr-search-store-unreadable.test.ts — whole-branch review F1 / verifier cluster 4
// (D-M5-25a): an unreadable session store must REFUSE, not answer "no matches".
//
// THE POINT OF THIS FILE IS THAT IT INJECTS NO SESSION-STORE READER. Every other search row hands the
// handler `listSessions`/`getSessionMessages`/`getSessionInfo` fakes, and the rows that pinned D-M5-8
// handed it fakes that THROW — which is exactly why the defect survived fifteen reviews. SDK 0.3.234's
// real readers swallow every filesystem failure (`catch → []`, `undefined`), so a double that throws is
// more honest than the dependency it stands in for, and proves nothing about it. Here the store is a real
// directory tree under a temporary `CLAUDE_CONFIG_DIR`, broken with real `chmod`, and driven through a
// real server on the real wire, with `ccxDir` the only dep set (the archive markers are not what these
// rows are about, and this machine's real fleet root would otherwise colour the result).
//
// The injected-thrower rows in `search.test.ts` stay: they pin what the handler does GIVEN a failure.
// These rows pin that a failure is what the production origin produces.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { sessionStoreRoot } from "../../../src/sessions/index.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const servers: AppServer[] = [];
let root = "", cfg = "", work = "", projDir = "";
let savedConfigDir: string | undefined;

/** The SDK's own project-directory name for a cwd (`[^a-zA-Z0-9] → "-"`). Spelled HERE and nowhere in
 *  `src/`: the fixture has to plant files where the reader will look, while the production audit walks
 *  whatever directories exist and never derives one. */
const projectDirFor = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, "-");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const jsonl = (o: unknown) => JSON.stringify(o) + "\n";
function plant(id: string, text: string): void {
  const stamp = new Date().toISOString();
  writeFileSync(join(projDir, `${id}.jsonl`),
    jsonl({ type: "user", uuid: `${id}-u1`, parentUuid: null, sessionId: id, cwd: work, timestamp: stamp, message: { role: "user", content: [{ type: "text", text }] } }) +
    jsonl({ type: "assistant", uuid: `${id}-a1`, parentUuid: `${id}-u1`, sessionId: id, cwd: work, timestamp: stamp, message: { role: "assistant", content: [{ type: "text", text: `answer about ${text}` }] } }));
}

beforeEach(() => {
  // realpath because macOS's tmpdir is a symlink and the store's directory name is derived from the
  // RESOLVED cwd — a fixture planted under the unresolved path is a store the reader never looks in.
  root = realpathSync(mkdtempSync(join(tmpdir(), "m5search-")));
  cfg = join(root, "cfgdir");
  work = join(root, "work");
  mkdirSync(work, { recursive: true });
  projDir = join(cfg, "projects", projectDirFor(work));
  mkdirSync(projDir, { recursive: true });
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  plant(A, "needle alpha");
  plant(B, "needle beta");
});
afterEach(async () => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  for (const s of servers.splice(0)) await s.shutdown().catch(() => {});
  // Every break in this file is a `chmod`, so the tree has to be made removable again before `rm`.
  for (const p of [join(cfg, "projects"), projDir]) { try { chmodSync(p, 0o700); } catch { /* never created */ } }
  for (const id of [A, B]) { try { chmodSync(join(projDir, `${id}.jsonl`), 0o600); } catch { /* replaced or gone */ } }
  rmSync(root, { recursive: true, force: true });
});

/** A server on PRODUCTION session-store defaults: no `listSessions`, no `getSessionMessages`, no
 *  `getSessionInfo`. */
function boot(): (method: string, params: unknown) => Promise<any> {
  const srv = new AppServer({} as never, { ccxDir: join(root, "ccx") });
  servers.push(srv);
  const lines: string[] = [];
  const conn = srv.connect({ write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  let nextId = 100;
  return async (method, params) => {
    const id = nextId++;
    conn.feed(JSON.stringify({ id, method, params }) + "\n");
    for (let i = 0; i < 400; i++) {
      const hit = lines.map((l) => JSON.parse(l)).find((m: any) => m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no reply to ${method}`);
  };
}

describe("thread/search on the PRODUCTION session store — an unreadable store refuses", () => {
  it("baseline: the real readers, the real store — both methods find the planted needle", async () => {
    // The control this whole file rests on. Without it a later row could pass because the store was
    // never reachable at all, which is the same green as a store that was read and refused correctly.
    expect(sessionStoreRoot()).toBe(join(cfg, "projects"));
    const send = boot();
    const r = await send("thread/search", { searchTerm: "needle" });
    expect(r.error).toBeUndefined();
    expect(new Set(r.result.data.map((d: any) => d.thread.sessionId))).toEqual(new Set([A, B]));
    const o = await send("thread/searchOccurrences", { threadId: A, searchTerm: "needle" });
    expect(o.error).toBeUndefined();
    expect(o.result.data.length).toBeGreaterThan(0);
  });

  it("an unreadable TRANSCRIPT is an error on both methods — not a page missing that session, and not `Thread not found`", async () => {
    chmodSync(join(projDir, `${A}.jsonl`), 0o000);
    const send = boot();
    const r = await send("thread/search", { searchTerm: "needle" });
    // Measured before the fix: `{"data":[{…B…}],"nextCursor":null}` — session A silently gone, no
    // `skipped`, no warning, and the terminal cursor claiming there is nothing more.
    expect(r.result).toBeUndefined();
    expect([r.error.code, r.error.message.startsWith("session store read failed: EACCES")]).toEqual([-32603, true]);
    // The sharpest half: the SAME file made this method deny the thread EXISTS, because the store's
    // existence oracle answers `undefined` for a file it cannot open.
    const o = await send("thread/searchOccurrences", { threadId: A, searchTerm: "needle" });
    expect(o.result).toBeUndefined();
    expect(o.error.code).toBe(-32603);
    expect(o.error.message).not.toBe("Thread not found");
  });

  it("an unreadable project directory, and an unreadable STORE ROOT, refuse — acceptance criterion 5's own words", async () => {
    const send = boot();
    chmodSync(projDir, 0o000);
    const perDir = await send("thread/search", { searchTerm: "needle" });
    expect(perDir.result).toBeUndefined();
    expect(perDir.error.code).toBe(-32603);
    chmodSync(projDir, 0o700);

    chmodSync(join(cfg, "projects"), 0o000);
    const perRoot = await send("thread/search", { searchTerm: "needle" });
    // Before the fix this was literally `{"data":[],"nextCursor":null}` — the terminal "nothing here"
    // answer for a store that was never read.
    expect(perRoot.result).toBeUndefined();
    expect(perRoot.error.code).toBe(-32603);
    chmodSync(join(cfg, "projects"), 0o700);

    // …and the refusal is not a latch: a store made readable again answers again.
    const back = await send("thread/search", { searchTerm: "needle" });
    expect(back.error).toBeUndefined();
    expect(back.result.data.length).toBe(2);
  });

  it("a DIRECTORY where a transcript belongs refuses too — a store entry the reader can never open", async () => {
    rmSync(join(projDir, `${A}.jsonl`));
    mkdirSync(join(projDir, `${A}.jsonl`));
    const send = boot();
    const r = await send("thread/search", { searchTerm: "needle" });
    expect(r.result).toBeUndefined();
    expect([r.error.code, r.error.message.startsWith("session store read failed: EISDIR")]).toEqual([-32603, true]);
  });

  it("an absent store is an honest empty page, and a store with nothing matching is too", async () => {
    // The other side of the contract, and the reason the audit distinguishes ENOENT from every other
    // errno: a store that was never written must not refuse, or a first-run client can never search.
    rmSync(join(cfg, "projects"), { recursive: true });
    const send = boot();
    const empty = await send("thread/search", { searchTerm: "needle" });
    expect([empty.error, empty.result]).toEqual([undefined, { data: [], nextCursor: null }]);
    mkdirSync(projDir, { recursive: true });
    plant(A, "needle alpha");
    const miss = await send("thread/search", { searchTerm: "haystack" });
    expect([miss.error, miss.result]).toEqual([undefined, { data: [], nextCursor: null }]);
  });

  it("no refusal puts an absolute path on the wire — the strip the archive routes already had", async () => {
    // The latent half of this finding, made live by the rows above: node composes an fs errno as
    // `EACCES: permission denied, open '/Users/<operator>/…'`, and these two methods used to answer
    // `e.message` verbatim where `thread/archive` stripped it.
    chmodSync(join(projDir, `${A}.jsonl`), 0o000);
    const send = boot();
    for (const [method, params] of [
      ["thread/search", { searchTerm: "needle" }],
      ["thread/searchOccurrences", { threadId: A, searchTerm: "needle" }],
    ] as const) {
      const e = (await send(method, params)).error;
      expect([method, e?.message.includes(root), e?.message.includes("/")]).toEqual([method, false, false]);
      expect(e.message).toContain("<path>");
    }
  });
});
