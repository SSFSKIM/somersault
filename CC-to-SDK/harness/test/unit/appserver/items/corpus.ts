// test/unit/appserver/items/corpus.ts — the transcript shapes the item pipeline is defined against.
//
// It exists for ONE assertion: `projectItems(rows, EMPTY_ARRIVALS, …)` equals `itemsFromTranscript(rows)`
// element-for-element (M9 Task 3's parity law). A law quantified over "every transcript shape" is only as
// strong as the shapes it is actually run against, so the corpus is the quantifier — and it is a shared
// file rather than a local const so a shape added for one test extends the law for every test.
//
// The shapes are the ones the suite already exercised somewhere: `replay.test.ts`'s own fixtures (the
// prompt/tool round trip, the nested subagent row, the dangling tool, the phantom bookkeeping rows, the
// four peer/quoted-envelope rows, the image turn) and `subscribe.test.ts`'s pager fixtures (a straddling
// tool_result, two concurrently-open tools, a long assistant run) — plus the degenerate ones no test had a
// reason to write down before a law needed them: the empty transcript, and the plain `[user, assistant]`
// pair whose user item a mis-restructured router would silently erase.
//
// Rows are `unknown[]` because that is what the readers take; they are deliberately RAW frame literals
// rather than builders, so a reader of a failing case sees the exact bytes that produced it.
//
// THE ROW AND ENTRY BUILDERS BELOW ARE THE SECOND HALF of that job. The reply-side suites
// (`subscribe-arrivals`, `search-arrivals`) cannot use raw fixtures — they generate rows by the dozen — so
// they spelled their own `USER`/`ASSISTANT`/`ENTRY` instead, and two copies of a row shape drift into a
// suite that agrees with itself about bytes the code no longer produces. They live here for the same
// reason `TRANSCRIPT_CORPUS` does: one definition of what a persisted row looks like, edited once.

import type { ArrivalAnchor, ArrivalEntry } from "../../../../src/peer/arrivalLog.js";

export interface TranscriptFixture { name: string; rows: unknown[] }

/** The one timestamp every built row and entry carries. A fixed value, not `new Date()`: the anchor
 *  fingerprint includes it, so a moving clock would move what the suites are asserting about. */
export const TS = "2026-08-30T00:00:00.000Z";

/** The peer origin an entry carries — the shape `peerInbound` records verbatim off a live frame. */
export const ORIGIN = { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", verifiedPeerPid: 4242 };

/** A persisted row, in the shapes `getSessionMessages` returns. `uuid` is the row's identity and — for a
 *  user row — the item id too, so a fixture's expected id list is readable off its rows. */
export const USER = (uuid: string, text: string, over: Record<string, unknown> = {}) =>
  ({ type: "user", uuid, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: text }, timestamp: TS, ...over });
export const ASSISTANT = (uuid: string, msgId: string, text: string, over: Record<string, unknown> = {}) =>
  ({ type: "assistant", uuid, session_id: "s", message: { id: msgId, content: [{ type: "text", text }] }, timestamp: TS, ...over });

/** `ENTRY`, bound to the session id the calling suite's thread runs under — the one field the two copies
 *  genuinely differed on. The `seq` counter is PER BUILDER rather than per module, so two suites sharing
 *  this file do not share a sequence and the order a store returns entries in stays each suite's own. */
export const entryBuilder = (sessionId: string) => {
  let seq = 0;
  return (id: string, text: string, anchor: ArrivalAnchor | null, over: Partial<ArrivalEntry> = {}): ArrivalEntry =>
    ({ v: 1, id, sessionId, anchor, seq: seq++, observedAt: TS, origin: ORIGIN, text, ...over });
};

/** A peer arrival as the CLI stamps one: `origin.kind === "peer"` is the whole recognition rule
 *  (src/peer/address.ts), and the persisted text carries the CLI's own preamble the sender never wrote. */
const PEER_ROW = {
  type: "user",
  uuid: "cccccccc-1111-4111-8111-cccccccccccc",
  parent_tool_use_id: null,
  message: { role: "user", content: "Another Claude session sent a message: <cross-session-message from=\"uds:/a.sock\" from-session=\"s1\" hop-chain=\"a\" from-name=\"peer\" from-mode=\"prompting\">hello</cross-session-message>" },
  origin: { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", body: "hello", verifiedPeerPid: 4242, msg_id: "m-1" },
};

/** The quoted envelope: an ordinary local prompt that CONTAINS a complete envelope. Measured on this
 *  machine's transcripts (2026-08-27), 40 of 52 such rows are exactly this — which is why recognition is
 *  the origin stamp and never the text. */
const QUOTED = 'Review this change for security vulnerabilities.\n\n<cross-session-message from="uds:/a.sock" from-name="peer" from-mode="prompting">\nhello\n</cross-session-message>\n\nDoes the escaping hold?';

export const TRANSCRIPT_CORPUS: TranscriptFixture[] = [
  { name: "empty transcript", rows: [] },
  {
    // The round-6 prompt-erasure case, and the reason it is first: a router that lost the DIRECT top-level
    // user path still passes every fixture whose user rows carry tool_results, and erases exactly this one.
    name: "plain [user, assistant] — an ordinary prompt and its answer",
    rows: [
      { type: "user", uuid: "u-plain", message: { content: "hello" } },
      { type: "assistant", uuid: "a-plain", message: { id: "msg_P", content: [{ type: "text", text: "hi back" }] } },
    ],
  },
  {
    name: "prompt, assistant with a tool_use, and its tool_result (replay.test.ts's base fixture)",
    rows: [
      { type: "user", uuid: "u-p", message: { content: "run ls" } },
      { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
    ],
  },
  {
    name: "a nested (subagent) user row, which neither path itemizes",
    rows: [
      { type: "user", uuid: "u-p", message: { content: "run ls" } },
      { type: "user", uuid: "u-nested", parent_tool_use_id: "toolu_agent", message: { content: "do the subtask" } },
      { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
    ],
  },
  {
    name: "a dangling tool_use that only finalize closes",
    rows: [{ type: "assistant", uuid: "u-a2", message: { id: "msg_B", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "pwd" } }] } }],
  },
  {
    name: "phantom CLI bookkeeping rows ahead of a real turn",
    rows: [
      { type: "user", uuid: "u-echo", message: { content: "<command-name>/compact</command-name>" } },
      { type: "user", uuid: "u-out", message: { content: "<local-command-stdout>ok</local-command-stdout>" } },
      { type: "user", uuid: "u-caveat", message: { content: "<local-command-caveat>careful</local-command-caveat>" } },
      { type: "user", uuid: "u-compact", message: { content: "This session is being continued from a previous conversation summary." } },
      { type: "user", uuid: "u-p", message: { content: "run ls" } },
      { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
    ],
  },
  { name: "a peer arrival row", rows: [PEER_ROW] },
  {
    name: "a peer row whose framer supplied no body (the envelope is the only text)",
    rows: [{
      type: "user", uuid: "88888888-1111-4111-8111-888888888888", parent_tool_use_id: null,
      message: { role: "user", content: 'Another Claude session sent a message:\n<cross-session-message from="uds:/a.sock" from-name="peer" from-mode="prompting">\nhello\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user.' },
      origin: { kind: "peer", from: "uds:/a.sock" },
    }],
  },
  {
    // Probe 121's measured batch (CLI 2.1.250): the engine folded several sent messages into one row
    // carrying TWO envelopes under ONE uuid, while `origin.body` names only the causing one.
    name: "a peer row carrying two sibling envelopes (the collapsed batch)",
    rows: [{
      type: "user", uuid: "42364455-1111-4111-8111-424242424242", parent_tool_use_id: null,
      message: { role: "user", content: '<cross-session-message from="uds:/a.sock" from-name="peer" from-mode="prompting">\nfirst message\n</cross-session-message>\n<cross-session-message from="uds:/a.sock" from-name="peer" from-mode="prompting">\nsecond message\n</cross-session-message>' },
      origin: { kind: "peer", from: "uds:/a.sock", body: "first message", msg_id: "m-batch" },
    }],
  },
  {
    name: "a local prompt quoting an envelope, stamped and unstamped",
    rows: [
      { type: "user", uuid: "77777777-1111-4111-8111-777777777777", parent_tool_use_id: null, message: { role: "user", content: QUOTED }, origin: { kind: "human" } },
      { type: "user", uuid: "66666666-1111-4111-8111-666666666666", parent_tool_use_id: null, message: { role: "user", content: QUOTED } },
    ],
  },
  {
    name: "an image turn (a content ARRAY, not a string)",
    rows: [{
      type: "user", uuid: "u-img",
      message: { content: [{ type: "text", text: "hi " }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
    }],
  },
  {
    // subscribe.test.ts (g): the tool_result lands 20 rows after the tool_use, so the item order the
    // projector produces is NOT the row order — an arrival anchored inside the straddle must not disturb it.
    name: "a straddling tool_result, 20 filler rows later",
    rows: [
      { type: "user", uuid: "p", message: { content: "start" } },
      { type: "assistant", message: { id: "mtool", content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: { command: "ls" } }] } },
      ...Array.from({ length: 20 }, (_, i) => ({ type: "assistant", message: { id: `mf${i}`, content: [{ type: "text", text: `filler${i}` }] } })),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "done" }] } },
    ],
  },
  {
    // subscribe.test.ts (i): toolA opens first and never resolves, toolB opens second and DOES — so the
    // finalize tail reorders items against the rows, in registration order. The shape most likely to expose
    // a router that emits from the wrong place.
    name: "two concurrently-open tools, only one of which resolves",
    rows: [
      { type: "user", uuid: "p", message: { content: "start" } },
      { type: "assistant", message: { id: "mA", content: [{ type: "tool_use", id: "toolA", name: "Bash", input: { command: "sleep 100" } }] } },
      { type: "assistant", message: { id: "mB", content: [{ type: "tool_use", id: "toolB", name: "Bash", input: { command: "echo hi" } }] } },
      { type: "assistant", message: { id: "mC", content: [{ type: "tool_use", id: "toolC", name: "Bash", input: { command: "sleep 200" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolB", content: "hi" }] } },
      { type: "assistant", message: { id: "mF1", content: [{ type: "text", text: "filler1" }] } },
      { type: "assistant", message: { id: "mF2", content: [{ type: "text", text: "filler2" }] } },
      { type: "assistant", message: { id: "mD", content: [{ type: "tool_use", id: "toolD", name: "Bash", input: { command: "sleep 300" } }] } },
    ],
  },
  {
    name: "a long assistant-only run (rows with no uuid at all)",
    rows: Array.from({ length: 30 }, (_, i) => ({ type: "assistant", message: { id: `m${i}`, content: [{ type: "text", text: `t${i}` }] } })),
  },
  {
    // A `system` row and a `result` row reach the reader in some configurations and are itemized by
    // neither path; a row with no `type` at all is what a corrupt line deserializes to.
    name: "rows neither path itemizes (system, result, typeless)",
    rows: [
      { type: "system", subtype: "init", session_id: "s", uuid: "sys-1" },
      { type: "user", uuid: "u-p", message: { content: "run ls" } },
      { type: "result", subtype: "success", is_error: false },
      { uuid: "junk" },
    ],
  },
];
