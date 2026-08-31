// test/unit/peer/reader-predicate-contract.test.ts — `readerVisible` (appserver/peerSeed.ts) against the
// transcript reader it claims to mirror.
//
// WHY THE PREDICATE EXISTS AT ALL. An anchor names the last frame the observer saw that the reader will
// ALSO return; a frame the reader drops can never be named, because the row will not be in the window a
// later `thread/read` resolves against. So the observer keeps its own copy of the reader's drop rule — and
// a copy of somebody else's rule is a copy that can go stale. Both directions of drift are damage, and
// they are not symmetric:
//   · the predicate DROPS a frame the reader keeps → the anchor never advances onto that row, so every
//     later arrival is recorded one row too early and RENDERS in the wrong place. A misplacement is worse
//     than a withholding, because nothing on the wire says it happened.
//   · the predicate KEEPS a frame the reader drops → the anchor names a row `thread/read` never sees, and
//     every arrival behind it is withheld forever. Visible in `arrivals.logged`, but still a loss.
//
// WHEN TO UPDATE THIS FILE: the SDK bump, i.e. step 3 of `docs/parity/drift-ritual.md` ("bump all four
// package.jsons … then `npm run typecheck && npm run test:unit`"). This test is a tripwire of the same
// family the ritual already names (`index.test.ts`, `knobs.test.ts`) and it fails LOUDLY rather than
// letting arrivals move: if a release changes which rows `getSessionMessages` returns, the second block
// below goes red, and the repair is to change `readerVisible` to match the reader — never to relax the
// assertion. The first block's table is a golden over the shared corpus, so a NEW corpus shape also
// reddens it until its verdict is written down.
//
// THE READER IS THE REAL ONE, driven through a `SessionStore` rather than a file. `getSessionMessages`
// routes a store-backed read through the same parse/filter body as a file-backed one (the store path and
// the file path both end in the SDK's shared filter), so this exercises the shipped drop rule while
// touching no filesystem and — the rule Task 2 learned the hard way — never the operator's real
// `~/.claude`.
import { describe, it, expect } from "vitest";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { readerVisible } from "../../../src/appserver/peerInbound.js";
import { TRANSCRIPT_CORPUS } from "../appserver/items/corpus.js";

/** The reader refuses a session id that is not a UUID before it reads anything at all. */
const SESSION = "11111111-1111-4111-8111-111111111111";
const TS = "2026-08-30T00:00:00.000Z";

/** A store that serves ONE transcript. `load` is the only method the read path calls; the rest satisfy the
 *  interface. Deliberately not `InMemorySessionStore`: that one keys by a projectKey the SDK derives from
 *  `dir`, and a test that had to reproduce that derivation would be testing the derivation. */
const storeOf = (rows: SessionStoreEntry[]): SessionStore => ({
  append: async () => {},
  load: async (key: SessionKey) => (key.sessionId === SESSION && !key.subpath ? rows : null),
  listSessions: async () => [],
  listSessionSummaries: async () => [],
  delete: async () => {},
  listSubkeys: async () => [],
});

const readBack = async (rows: SessionStoreEntry[], opts: { includeSystemMessages?: boolean } = {}): Promise<string[]> =>
  (await getSessionMessages(SESSION, { sessionStore: storeOf(rows), ...opts })).map((m) => m.uuid);

/** THE READER DROPS ROWS IN TWO PLACES, and a fixture has to respect the difference or it measures the
 *  wrong one. The FLAG rule (`isMeta`/`isSidechain`/`teamName`, and `system` without the opt-in) runs on a
 *  conversation chain that has already been built, so a flagged row is a perfectly ordinary link and the
 *  rows behind it survive its removal — which is what a real transcript looks like, a peer arrival sitting
 *  between two turns. A row with no uuid, or with a type outside the reader's conversation set, never
 *  enters the chain at all, so making one a PARENT would break the walk and every assertion behind it
 *  would be about the walk rather than about the drop rule. Those rows are marked `offChain` here: present
 *  in the transcript, pointed at by nobody.
 *
 *  `chained` links every other row to the previous linking row, so the fixtures below read top to bottom. */
type FixtureRow = Record<string, unknown> | { readonly offChain: Record<string, unknown> };
const offChain = (row: Record<string, unknown>): FixtureRow => ({ offChain: row });

function chained(rows: FixtureRow[]): SessionStoreEntry[] {
  let parentUuid: string | null = null;
  return rows.map((entry) => {
    const isOff = "offChain" in entry && typeof entry.offChain === "object";
    const row = (isOff ? (entry as { offChain: Record<string, unknown> }).offChain : entry) as Record<string, unknown>;
    // Through `unknown`: `SessionStoreEntry` requires a `type`, and one of the fixtures below is a line
    // that deserialized WITHOUT one — the shape a corrupt transcript really has, and one the reader must
    // survive. Narrowing it away would delete the case.
    const linked = { session_id: SESSION, sessionId: SESSION, timestamp: TS, parentUuid, ...row } as unknown as SessionStoreEntry;
    if (!isOff && typeof row.uuid === "string" && row.uuid) parentUuid = row.uuid;
    return linked;
  });
}

const uuidsOf = (rows: unknown[]): string[] => rows.filter((r) => readerVisible(r)).map((r) => String((r as { uuid: string }).uuid));

describe("the predicate over every corpus shape (spec: seeding)", () => {
  // A golden per shape rather than a re-implementation of the rule beside it: an oracle written in the same
  // sentences as the subject agrees with a broken subject. Written as ONE object so a corpus shape added
  // without a verdict fails here — which is the property that keeps the quantifier honest as the corpus
  // grows.
  const ACCEPTED: Record<string, string[]> = {
    "empty transcript": [],
    "plain [user, assistant] — an ordinary prompt and its answer": ["u-plain", "a-plain"],
    "prompt, assistant with a tool_use, and its tool_result (replay.test.ts's base fixture)": ["u-p", "u-a", "u-r"],
    // A nested (subagent) row IS reader-visible — the reader returns it and the ITEM router is what drops
    // it. So it can legitimately anchor an arrival, and a predicate that "helpfully" dropped it here would
    // leave every arrival behind it a row early.
    "a nested (subagent) user row, which neither path itemizes": ["u-p", "u-nested", "u-a", "u-r"],
    "a dangling tool_use that only finalize closes": ["u-a2"],
    // Phantom CLI bookkeeping rows are the same case: dropped from ITEMS, returned by the READER, and
    // therefore nameable by an anchor.
    "phantom CLI bookkeeping rows ahead of a real turn": ["u-echo", "u-out", "u-caveat", "u-compact", "u-p", "u-a", "u-r"],
    // The corpus's peer rows carry NO `isMeta` — they are the item pipeline's view of a peer row, where
    // recognition is `origin.kind` and the flag is irrelevant. A row as the CLI actually persists one does
    // carry it, and the reader drops it; that is the shape the on-disk block below pins.
    "a peer arrival row": ["cccccccc-1111-4111-8111-cccccccccccc"],
    "a peer row whose framer supplied no body (the envelope is the only text)": ["88888888-1111-4111-8111-888888888888"],
    "a peer row carrying two sibling envelopes (the collapsed batch)": ["42364455-1111-4111-8111-424242424242"],
    "a local prompt quoting an envelope, stamped and unstamped": ["77777777-1111-4111-8111-777777777777", "66666666-1111-4111-8111-666666666666"],
    "an image turn (a content ARRAY, not a string)": ["u-img"],
    // The uuid clause doing real work: filler rows carry none, so they are unaddressable and only the one
    // row that has a uuid can anchor anything.
    "a straddling tool_result, 20 filler rows later": ["p"],
    "two concurrently-open tools, only one of which resolves": ["p"],
    "a long assistant-only run (rows with no uuid at all)": [],
    "rows neither path itemizes (system, result, typeless)": ["u-p"],
  };

  it("accepts exactly the rows the table names, on every shape the corpus holds", () => {
    expect(Object.fromEntries(TRANSCRIPT_CORPUS.map((f) => [f.name, uuidsOf(f.rows)]))).toEqual(ACCEPTED);
  });
});

describe("the predicate against the READER (the drift pin)", () => {
  /** One transcript carrying every shape the drop rule distinguishes, chained as a real one would be. */
  const TRANSCRIPT = chained([
    { type: "user", uuid: "u-1", message: { role: "user", content: "hello" } },
    { type: "assistant", uuid: "a-1", message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "hi" }] } },
    // The peer arrival's own persisted shape (measured, M1/M2): `isMeta`, which is WHY history loses the
    // question and why this milestone exists.
    { type: "user", uuid: "meta-1", isMeta: true, message: { role: "user", content: "a peer arrival, as persisted" } },
    { type: "user", uuid: "side-1", isSidechain: true, message: { role: "user", content: "a sidechain row" } },
    { type: "user", uuid: "team-1", teamName: "squad", message: { role: "user", content: "a teammate's row" } },
    { type: "assistant", uuid: "a-meta", isMeta: true, message: { id: "msg_2", role: "assistant", content: [{ type: "text", text: "a meta assistant row" }] } },
    { type: "system", uuid: "sys-1", subtype: "init", message: { role: "system", content: "init" } },
    // Nested, and kept by both sides — see the corpus table above.
    { type: "user", uuid: "nested-1", parent_tool_use_id: "toolu_x", message: { role: "user", content: "the subagent's prompt" } },
    // Rows nobody can name: no uuid, a non-conversation type, a line that deserialized to no type at all.
    offChain({ type: "user", message: { role: "user", content: "no uuid, so not addressable" } }),
    offChain({ type: "result", subtype: "success", is_error: false }),
    offChain({ uuid: "junk-1" }),
    { type: "user", uuid: "u-2", message: { role: "user", content: "after the flagged rows" } },
    { type: "assistant", uuid: "a-2", message: { id: "msg_3", role: "assistant", content: [{ type: "text", text: "done" }] } },
  ]);

  it("returns EXACTLY the rows the predicate accepts, in the same order", async () => {
    expect(await readBack(TRANSCRIPT)).toEqual(uuidsOf(TRANSCRIPT));
    // Named positively too, so a day when both sides silently return nothing is not a green run.
    expect(uuidsOf(TRANSCRIPT)).toEqual(["u-1", "a-1", "nested-1", "u-2", "a-2"]);
  });

  it("`system` is a DELIBERATE non-mirror, and only of the reader as this server calls it", async () => {
    // `includeSystemMessages` defaults false and neither caller that matters passes it (the observer's seed
    // read, and `thread/read`'s pager). A predicate that admitted `system` would let `system/init` — which
    // arrives every turn, and would therefore be the most common anchor of all — name a row those callers
    // never receive, withholding every arrival behind it forever. So the divergence is asserted, not
    // tolerated: the reader CAN return the row, and this server never asks it to.
    expect(await readBack(TRANSCRIPT, { includeSystemMessages: true })).toEqual(["u-1", "a-1", "sys-1", "nested-1", "u-2", "a-2"]);
    expect(readerVisible(TRANSCRIPT.find((r) => r.uuid === "sys-1"))).toBe(false);
  });

  it("each field of the drop rule flips the reader and the predicate together", async () => {
    // The transcript above is one list difference; this is the same claim per field, so a failure names the
    // field. The variant sits in the MIDDLE of a chain, `link` saying which of the reader's two drop stages
    // it belongs to (see `chained`): a FLAG-dropped row is still a link, a structurally-invisible one is
    // not, and marking that wrong would let a chain artefact pass for a drop-rule agreement.
    const cases: Array<{ label: string; row: Record<string, unknown>; visible: boolean; link: boolean }> = [
      { label: "an ordinary user row", row: { type: "user", uuid: "v-1", message: { role: "user", content: "x" } }, visible: true, link: true },
      { label: "an ordinary assistant row", row: { type: "assistant", uuid: "v-1", message: { id: "m", role: "assistant", content: [{ type: "text", text: "x" }] } }, visible: true, link: true },
      { label: "isMeta", row: { type: "user", uuid: "v-1", isMeta: true, message: { role: "user", content: "x" } }, visible: false, link: true },
      { label: "isSidechain", row: { type: "user", uuid: "v-1", isSidechain: true, message: { role: "user", content: "x" } }, visible: false, link: true },
      { label: "teamName", row: { type: "user", uuid: "v-1", teamName: "squad", message: { role: "user", content: "x" } }, visible: false, link: true },
      // Falsy values of the same fields are NOT drops — the reader tests truthiness, and a predicate that
      // tested presence would drop every row a CLI writes the flags out as `false` on.
      { label: "isMeta: false / teamName: \"\"", row: { type: "user", uuid: "v-1", isMeta: false, isSidechain: false, teamName: "", message: { role: "user", content: "x" } }, visible: true, link: true },
      { label: "type: system", row: { type: "system", uuid: "v-1", subtype: "init", message: { role: "system", content: "x" } }, visible: false, link: true },
      { label: "type: progress", row: { type: "progress", uuid: "v-1", message: { role: "user", content: "x" } }, visible: false, link: true },
      { label: "type: attachment", row: { type: "attachment", uuid: "v-1", message: { role: "user", content: "x" } }, visible: false, link: true },
      { label: "type: result", row: { type: "result", uuid: "v-1", subtype: "success" }, visible: false, link: false },
      { label: "no type at all", row: { uuid: "v-1", message: { role: "user", content: "x" } }, visible: false, link: false },
      { label: "no uuid", row: { type: "user", message: { role: "user", content: "x" } }, visible: false, link: false },
      // The one case where the two sides agree for DIFFERENT reasons, said out loud rather than counted as
      // agreement: the predicate refuses it because an anchor keyed on `""` names nothing, and the reader
      // leaves it out because a row no other row can point at is not on the conversation chain.
      { label: "an empty uuid", row: { type: "user", uuid: "", message: { role: "user", content: "x" } }, visible: false, link: false },
    ];

    for (const { label, row, visible, link } of cases) {
      const rows = chained([
        { type: "user", uuid: "head", message: { role: "user", content: "head" } },
        link ? row : offChain(row),
        { type: "assistant", uuid: "tail", message: { id: "m-tail", role: "assistant", content: [{ type: "text", text: "tail" }] } },
      ]);
      const expected = visible ? ["head", "v-1", "tail"] : ["head", "tail"];
      expect([label, readerVisible(rows[1])]).toEqual([label, visible]);
      expect([label, await readBack(rows)]).toEqual([label, expected]);
    }
  });
});
