// test/unit/appserver/fr-host-unarchive.test.ts — M5 fix wave I, finding scalpel-3#3.
//
// D-M5-21: "opening a conversation takes it off the shelf", and it is what makes "a live thread is never
// hidden from the default list" true ACROSS servers. The app server honours it on its three admission
// surfaces plus the fourth it only observes. A HOST admitting a conversation was a fifth surface and
// honoured it nowhere: `SessionHost.resumeSession` swapped the engine and moved the roster row, and the
// marker stayed. An unattached `ccx --resume <archived id>` — the shape an operator reaches for when they
// come back to a conversation they shelved — therefore left it LIVE in front of them and HIDDEN from every
// client's default listing, for the host's whole idle life. It is not the transient criterion 7 accepts:
// that one is cleared by "the next unarchive or admission", and this admission was not one.
//
// WHY THE REAL HOST, for the same reason `fr-delete-live-host-roster.test.ts` gives: the subject is what
// the host DOES when it takes a conversation under itself, and the host is the only thing that does it.
// Real `SessionHost`, real marker store, real filesystem — only the SDK engine is faked.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../../src/host/host.js";
import type { HostSession } from "../../../src/host/host.js";
import { createArchiveMarker, listArchived } from "../../../src/appserver/archive.js";

/** A resumed engine reports no id until its first turn's init frame — the real getter's shape, and the
 *  reason the host's own `resumedFrom` is the only truth in between. */
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
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ccx-fr-host-unarchive-"));
  process.env.CCX_FLEET_ROOT = root;
  // ASSERTED, not assumed: every marker this file plants or reads must be under the temp root, or the row
  // would be editing the operator's own shelf and would look identical to one that worked.
  expect(process.env.CCX_FLEET_ROOT).toBe(root);
});
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

const shelved = async (): Promise<string[]> => [...await listArchived({ ccxDir: root })].sort();
/** The shelf transition is fire-and-forget — there is no reply to carry its failure, and a marker store
 *  that cannot be reached must not fail a resume the operator is already looking at — so a row waits for
 *  the EFFECT rather than for a promise. On exhaustion it returns the shelf as it actually is, so an effect
 *  that never arrives fails the row as the state it left rather than as a timeout. */
const waitForShelf = async (want: string[]): Promise<string[]> => {
  for (let i = 0; i < 200; i++) {
    const now = await shelved();
    if (JSON.stringify(now) === JSON.stringify(want)) return now;
    await new Promise((r) => setTimeout(r, 5));
  }
  return shelved();
};

async function startHost(short: string, config: Record<string, unknown>): Promise<SessionHost> {
  const h = new SessionHost({ short, name: short, cwd: "/w", kind: "interactive", detached: true, config },
    { openSession: (c) => fakeEngine(c.resume as string | undefined) });
  hosts.push(h);
  await h.start();
  return h;
}

describe("a host takes the conversation it opens off the shelf (D-M5-21, fix wave I)", () => {
  it("a LAUNCH resume onto an archived conversation clears its marker — and leaves every other one alone", async () => {
    await createArchiveMarker("sess-mine", { ccxDir: root });
    await createArchiveMarker("sess-someone-else", { ccxDir: root });
    expect(await shelved()).toEqual(["sess-mine", "sess-someone-else"]);
    await startHost("aaaa1111", { resume: "sess-mine" });
    // The one this host now holds is off the shelf; the one it does not is untouched, which is what says
    // the repair is scoped to the conversation admitted rather than to the store.
    expect(await waitForShelf(["sess-someone-else"])).toEqual(["sess-someone-else"]);
  });

  it("a terminal-side /resume onto an archived conversation clears it too — the swap is an admission", async () => {
    await createArchiveMarker("sess-later", { ccxDir: root });
    const h = await startHost("aaaa2222", {});
    // The CONTROL: a host that has not taken this conversation leaves the marker exactly where it is, so
    // the row below is measuring the resume and not the host's mere existence.
    expect(await shelved()).toEqual(["sess-later"]);
    await h.resumeSession("sess-later");
    expect(await waitForShelf([])).toEqual([]);
  });

  it("a FORKING launch does not unshelve the conversation it reads (D-M5-21b)", async () => {
    // The same carve-out `start()` already makes for the roster: a forking resume names the SOURCE
    // conversation rather than the id this host will hold, so clearing its marker would take a
    // conversation off the shelf that never opened here.
    await createArchiveMarker("sess-parent", { ccxDir: root });
    await startHost("aaaa3333", { resume: "sess-parent", forkSession: true });
    await new Promise((r) => setTimeout(r, 60));
    expect(await shelved()).toEqual(["sess-parent"]);
  });

  it("a host on no conversation at all shelves nothing, and a marker store it cannot reach does not fail it", async () => {
    // Absence of an id is not an id, and the store is best-effort: pointing the root at a path that cannot
    // hold a directory makes every marker write and delete fail, and the host must still start and resume.
    const h = await startHost("aaaa4444", {});
    expect(await shelved()).toEqual([]);
    // A root that IS A FILE — this host's own roster row — so every marker call under it fails ENOTDIR.
    const fileRoot = join(root, "roster", "aaaa4444.json");
    expect(statSync(fileRoot).isFile()).toBe(true);
    process.env.CCX_FLEET_ROOT = fileRoot;
    try { await expect(h.resumeSession("sess-anything")).resolves.toBeUndefined(); }
    finally { process.env.CCX_FLEET_ROOT = root; }
  });
});
