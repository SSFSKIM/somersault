// test/live/appserver-cross-session.test.ts — M8's keyed acceptance (spec rows 7–11). Gated exactly like
// every other file under test/live/: without a key the whole describe skips, so this runs in CI as a
// no-op and against a real engine when a key is present.
//
// ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────────────────────────────
// Everything the inbound half does hangs off ONE premise no unit test can establish: that a real CLI,
// handed a message over its peer socket, replays it as a `type:"user"` frame carrying
// `origin.kind === "peer"`. That attribution is the WHOLE recognition rule (src/peer/address.ts,
// `peerArrival`) — there is deliberately no envelope-text fallback, because measuring this machine's own
// transcripts found 52 user rows containing a complete `<cross-session-message …>` envelope of which only
// 12 were real arrivals. So the unit suite proves what this server does GIVEN a stamped frame; only a
// keyed run proves the engine stamps one. LEG 1 is that proof, and every later leg presumes it.
//
// ── THE FOUR DELEGATED UNKNOWNS, AND HOW EACH IS CLOSED ────────────────────────────────────────────
// The spec (rev 5/6) names four leaves it declined to guess. Each is closed here by an ASSERTION whose
// red state IS the wrong answer — never by a leg that logs what it saw, which would close nothing and
// leave the guess standing:
//
//   U1 · the HEALTHY terminal `command_lifecycle` state's NAME. Only the failure path's `cancelled` has
//        ever been observed (the measuring run was weekly-limited). `isTerminalState` in
//        appserver/peerInbound.ts is written as "anything that is not `queued` and not `started`", so the
//        property it depends on is not the name but the NEGATION. LEG 1 asserts that negation the only
//        way it can be falsified: the adopted turn must reach `turn/completed`, which happens ONLY if the
//        healthy terminal was recognised as terminal. An engine that never leaves `started`, or that
//        re-enters `queued`, leaves the turn open and the leg times out red. The literal name is carried
//        in that leg's assertion message so Step 7 can transcribe it into the spec.
//
//   U2 · what lifecycle a FOLDED message gets. It has no turn of its own, so it may get no bracket at
//        all, or a bracket the busy gate then declines. Both are survivable; what must NOT happen is a
//        second turn. LEG 4 asserts exactly one `turn/started` across the whole exchange and a thread
//        that is idle afterwards (a following local turn is accepted), which is red under either failure:
//        a fold that opened its own turn, or one that wedged `busy` forever.
//
//   U3 · whether a BATCH emits one bracket per `command_uuid` around ONE turn. `peerInbound.ts` adopts
//        one turn at a time (`if (adopted) return`), so N brackets may yield 1 or 2 turns depending on
//        interleaving, and the design is written to survive either. LEG 5 asserts the invariant that must
//        hold under BOTH: every `turn/started` is balanced by a `turn/completed`, no arrival is lost (all
//        N arrivalUuids are announced and all N texts are present in `thread/read`), and the thread ends
//        idle. A per-uuid bracket shape that stranded an arrival, or a terminal that matched no adopted
//        uuid and left `busy` set, is red.
//
//   U4 · WHICH field of the lifecycle frame carries the uuid this server passed to `submit()` —
//        `command_uuid`, `uuid`, or neither. `isOurs` matches BOTH and leans on `beginTurn`'s busy gate to
//        make a wrong guess a no-op; LEG 6 turns that safety net into a measurement. It observes the
//        thread's own frames while a purely LOCAL turn runs and requires the submitted uuid (read off
//        `record.peerInbound.ourUuids`, which `notePeerTurnUuid` fills at submit time) to appear as
//        `command_uuid` or `uuid` on at least one `command_lifecycle` frame. If NEITHER carries it the
//        leg is red, and that red is the finding: own turns cannot be told from foreign ones by uuid at
//        all, and adoption needs a different discriminator. It does not break what shipped — the busy
//        gate keeps a mis-adoption a no-op — but it is a finding, not a detail, and must be reported as
//        one rather than worked around.
//
// ── WHAT THE LEGS MAY AND MAY NOT ASSERT ───────────────────────────────────────────────────────────
// Three shapes were checked against the shipped code before these descriptions were written, because the
// plan's first draft of them predated the code:
//   · `thread/peerMessage` params are `{ threadId, arrivalUuid, origin }` and NOTHING else. There is no
//     `turnId` and there cannot be one — at arrival the message's fate is genuinely undecided.
//   · an arrival's id is the FRAME's own uuid, never a minted one, which is the entire mechanism by which
//     `thread/read`'s replayed `userMessage` (`items/replay.ts`, id `String(frame.uuid)`) deduplicates
//     against the live item. Both paths build the row through the same `userItem(text, uuid)`, so a
//     deep-equal of the two `{type,id,text}` objects is the right assertion, not an approximation.
//   · an adopted turn goes THROUGH `beginTurn`, so its `turn/started` payload is the ordinary
//     `{ threadId, turn }` and carries NO origin field. A leg that looked for an origin marker on the
//     turn edge would be asserting a shape the design deliberately refused (rev 6: a turn edge that
//     differs by how the turn was caused is something every subscriber would have to special-case).
//   · a FOLDED arrival produces no LIVE item — `drainArrivals` needs an adopted turn's mapper and there
//     is none — so LEG 4 asserts the text through `thread/read`, not through `item/completed`.
//
// Structure follows appserver-m4/m5-acceptance.test.ts: ONE describe, sequential `it`s sharing one app
// server and its WS clients, each with its own generous timeout, cheapest leg first.
import { describe, it, expect } from "vitest";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("M8 cross-session, against a real engine", () => {
  it.todo("LEG 1 — idle (spec row 7, closes U1): the server starts a thread with crossSessionInbound:'accept'; peer/list carries a row whose threadId is that thread; peer/send to its address replies {delivered:false, statusReachable:true} with a UUID msgId; the subscriber then sees thread/peerMessage exactly once, carrying arrivalUuid, no turnId, and an origin whose kind is 'peer' and whose verifiedPeerPid is this process's own pid, followed by turn/started (payload {threadId,turn}, no origin field), the model's items, and turn/completed {status:'completed'} — the last of which can only arrive if the healthy terminal lifecycle state was recognised as terminal, so the leg names that state in its assertion message; session.unmatchedResults is unchanged across the whole exchange, and no peer/messageStatus arrives (the CLI says nothing on the success path)");
  it.todo("LEG 2 — the live item and the persisted one are ONE row (spec row 7's tail): the userMessage item emitted inside the adopted turn deep-equals the userMessage thread/read projects from the transcript — same type, same text, and the same id, which is the arrivalUuid from thread/peerMessage and the frame's own uuid rather than a minted one, so a client that reads its own history sees one message and not two");
  it.todo("LEG 3 — arrival is a fact about the THREAD, not about a turn (spec row 9): thread/peerMessage fires exactly once per message whatever fate the message meets, its params carry no turnId at all, and the userMessage item bearing that arrivalUuid is never emitted before the turn/started of the turn that owns it — arrival alone begins nothing, and the announcement is usable by a client that has no turn to attach it to");
  it.todo("LEG 4 — fold (spec row 10, closes U2): the receiver is given a turn with several sequential tool calls and the message is delivered mid-turn; the client sees thread/peerMessage and EXACTLY ONE turn/started, that turn completes carrying the model's answer to both prompts, no turn/completed names a turn id that was never started, the folded arrival's text is present in thread/read under its arrivalUuid (it has no adopted turn, so it produces no live item), session.unmatchedResults is unchanged, and a following local turn/start is accepted — which is what proves the fold left no adoption holding busy; the leg names whether the folded message got a lifecycle bracket of its own");
  it.todo("LEG 5 — batch (closes U3): several messages are sent in one burst to an idle accepting thread; every one is announced with its own distinct arrivalUuid, every turn/started is balanced by exactly one turn/completed, every sent text is present in thread/read, session.unmatchedResults is unchanged, and a following local turn/start is accepted — the invariant that holds whether the engine brackets once around one turn or once per command_uuid, and the leg names which shape it saw");
  it.todo("LEG 6 — own turns are never adopted, and the uuid correlation is MEASURED (closes U4): a purely local turn/start on an accepting thread emits exactly ONE turn/started, and the uuid this server submitted under — read from record.peerInbound.ourUuids, which notePeerTurnUuid fills beside the randomUUID that mints it — appears as command_uuid or uuid on at least one of that turn's command_lifecycle frames; if NEITHER field carries it this leg is red, and that red is reported as the finding it is rather than relaxed away");
  it.todo("LEG 7 — busy follow-up (spec row 8): the receiver is busy with a turn that will end without another model round-trip and the message is delivered mid-turn; the client sees two BALANCED lifecycles — the client's own turn completing, then an adopted turn/started/turn/completed pair — with no orphaned turn id, the adopted pair settling through the unclaimed-result hook (a result that is uuid-less and whose origin.kind is 'task-notification'), and session.unmatchedResults unchanged, which is what says that result was claimed rather than dropped");
  it.todo("LEG 8 — refuse (spec row 11): the same send into a crossSessionInbound:'refuse' thread produces no thread/peerMessage, no turn/started, no item, and no peer/messageStatus receipt before the send's correlation window closes — silence on both channels is the measured contract — while peer/send itself still succeeds, because the sender is told nothing either way");
});
