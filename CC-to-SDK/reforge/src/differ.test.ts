// The differ's RUN-ID MAP, and the property that makes mapping stronger than
// scrubbing (campaign spec §3.4's "every normalization rule carries a
// regression test").
//
//   npx tsx src/differ.test.ts
//
// The map exists so that ids the ENGINE mints locally — never replayed from a
// cassette, so never equal across two engines — stop producing differences that
// mean nothing, WITHOUT losing the differences that mean something. Every check
// below is one half of that bargain, and each positive check is paired with the
// negative control that proves it did not simply blind the surface: a normalizer
// that erased these fields would pass every "canonicalize alike" check and no
// "still discriminates" one.
//
// C7/W4 added the compact_boundary's own uuid fields to the map, which is the
// case with the sharpest failure mode: a boundary names messages the SDK never
// emitted, so those ids exist nowhere else in the transcript.
import { diffTranscripts, makeRunNormalizer } from "./differ.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean): void => {
  if (ok) pass++;
  else failures.push(label);
};

/** Normalize both sides against their OWN id map — what m1/run.ts does per side. */
const differs = (a: unknown[], b: unknown[]): boolean =>
  diffTranscripts(a.map(makeRunNormalizer(a)), b.map(makeRunNormalizer(b))).length > 0;

/** One transcript shaped like a compacted session: three emitted messages, then a boundary. */
function session(ids: {
  session: string;
  first: string;
  second: string;
  /** the frame the SDK never emits — a boundary can name it, nothing else can */
  internal: string;
  preserved?: string[];
}): unknown[] {
  return [
    { type: "system", subtype: "init", session_id: ids.session, uuid: ids.first },
    { type: "assistant", session_id: ids.session, uuid: ids.second, message: { content: [{ type: "text", text: "OK" }] } },
    {
      type: "system",
      subtype: "compact_boundary",
      session_id: ids.session,
      uuid: `${ids.session}-b`,
      logical_parent_uuid: ids.internal,
      compact_metadata: {
        trigger: "auto",
        pre_tokens: 69434,
        preserved_segment: { head_uuid: ids.first, anchor_uuid: ids.second, tail_uuid: ids.internal },
        preserved_messages: { anchor_uuid: ids.second, uuids: ids.preserved ?? [ids.first, ids.internal] },
      },
    },
  ];
}

const A = { session: "ac3f6c34-213f-4e2c-b142-a1b0940e7398", first: "4216877b-ff04-422f-bd9c-c21caae4ba7d", second: "2e8cf526-6ecf-4bd4-a6e2-6a055ff026c6", internal: "345ed50e-3be5-4fea-8637-7e7c6461cfdb" };
const B = { session: "a2660536-9727-42c0-8c2b-202c5e9daa4c", first: "7252fe00-725e-4007-a49a-3d1ce8f4e75c", second: "ae8d1652-3e90-4e36-95e7-7a6fac7b719e", internal: "0b6e6564-44fe-4182-b5c2-80a6433ceba1" };

// ---- the map does its job on ids nothing else can pin ----------------------
check("two runs of the same engine agree once compaction ids are mapped", !differs(session(A), session(B)));
check(
  "the engine-internal id is mapped even though no message carries it",
  JSON.stringify(session(A).map(makeRunNormalizer(session(A)))).includes("<id") &&
    !JSON.stringify(session(A).map(makeRunNormalizer(session(A)))).includes(A.internal),
);

// ---- and the consistency check survives: the NEGATIVE controls -------------
// Each one is a real reimplementation defect in the compaction surface, and each
// must still diff after normalization.
check(
  "an engine that preserved a DIFFERENT message still diffs",
  differs(session(A), session({ ...B, preserved: [B.second, B.internal] })),
);
check(
  "an engine that preserved FEWER messages still diffs",
  differs(session(A), session({ ...B, preserved: [B.first] })),
);
check(
  "an engine that reused one id where the oracle used two still diffs",
  differs(session(A), session({ ...B, internal: B.first })),
);
check(
  "a changed trigger still diffs (the map touches ids, not behaviour)",
  differs(session(A), (() => {
    const s = session(B) as { compact_metadata?: { trigger?: string } }[];
    s[2].compact_metadata!.trigger = "manual";
    return s;
  })()),
);
check(
  "a changed pre_tokens still diffs",
  differs(session(A), (() => {
    const s = session(B) as { compact_metadata?: { pre_tokens?: number } }[];
    s[2].compact_metadata!.pre_tokens = 1;
    return s;
  })()),
);

// ---- the array form is bound to the two keys that carry ids ----------------
check(
  "a string array under an unrelated key is NOT treated as identifiers",
  differs([{ uuid: A.first, tags: ["alpha-one-two", "bravo-one-two"] }], [{ uuid: B.first, tags: ["charlie-one-two", "delta-one-two"] }]),
);
// The length floor. A two-character value is not an identifier, so it is not
// mapped — and because these compaction keys are NOT in `SCRUB_KEYS` (unlike a
// message's own `uuid`, which is blanked by key), an unmapped value stays fully
// graded rather than quietly disappearing.
check(
  "a short value under a compaction id key is left alone and still diffs",
  differs(
    [{ type: "system", compact_metadata: { preserved_segment: { head_uuid: "ab" } } }],
    [{ type: "system", compact_metadata: { preserved_segment: { head_uuid: "cd" } } }],
  ),
);

// ---- W5's C8 round: the hook-dispatch and conversation-reset ids -----------
// `hook_id` is minted per hook INVOCATION and correlates a `hook_started` frame
// with its `hook_response`; `new_conversation_id` is what `/clear` mints. Both
// are run-scoped, and both carry a relationship the map must not dissolve.
const hookFrames = (start: string, response: string) => [
  { type: "system", subtype: "hook_started", hook_id: start, hook_name: "SessionStart:startup", hook_event: "SessionStart" },
  { type: "system", subtype: "hook_response", hook_id: response, hook_name: "SessionStart:startup", exit_code: 0, outcome: "success" },
];
check(
  "two runs of the same engine agree once hook ids are mapped",
  !differs(hookFrames(A.first, A.first), hookFrames(B.first, B.first)),
);
check(
  "a response that answers a DIFFERENT hook invocation still diffs",
  differs(hookFrames(A.first, A.first), hookFrames(B.first, B.second)),
);
check(
  "two hook invocations collapsed onto one id still diff",
  differs(
    [...hookFrames(A.first, A.first), ...hookFrames(A.second, A.second)],
    [...hookFrames(B.first, B.first), ...hookFrames(B.first, B.first)],
  ),
);
check(
  "a changed hook outcome still diffs (the map touches ids, not behaviour)",
  differs(hookFrames(A.first, A.first), [
    hookFrames(B.first, B.first)[0],
    { ...hookFrames(B.first, B.first)[1], exit_code: 2, outcome: "failure" },
  ]),
);
check(
  "two runs agree once the reset's new conversation id is mapped",
  !differs([{ type: "conversation_reset", new_conversation_id: A.internal }], [{ type: "conversation_reset", new_conversation_id: B.internal }]),
);
check(
  "a second reset that reused the FIRST reset's conversation id still diffs",
  differs(
    [
      { type: "conversation_reset", new_conversation_id: A.first },
      { type: "conversation_reset", new_conversation_id: A.second },
    ],
    [
      { type: "conversation_reset", new_conversation_id: B.first },
      { type: "conversation_reset", new_conversation_id: B.first },
    ],
  ),
);

// ---- C10/W7: the initialize response's `pid`, and the surface it arrived on --
// The raw driver sends `initialize` and reads the answer off the wire, which is
// the only way this payload is ever observed — `sdk.mjs` consumes the frame. It
// carries `process.pid`, so two engines can never agree on it. The scrub pays
// for itself with the control: everything ELSE in that payload is behaviour the
// wave now grades, and a scrub that reached the rest of it would be invisible.
const initFrame = (pid: number, mode = "default"): unknown[] => [
  {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "reforge-initialize",
      response: { pid, commands: ["clear", "compact"], models: ["sonnet"], current_permission_mode: mode, output_style: "default" },
    },
  },
];
check("two engines' initialize answers agree once the pid is scrubbed", !differs(initFrame(71791), initFrame(71807)));
check(
  "an initialize answer reporting a DIFFERENT permission mode still diffs",
  differs(initFrame(71791), initFrame(71807, "bypassPermissions")),
);
check(
  "an initialize answer that dropped a command still diffs",
  differs(initFrame(71791), [{ type: "control_response", response: { subtype: "success", request_id: "reforge-initialize", response: { pid: 71807, commands: ["clear"], models: ["sonnet"], current_permission_mode: "default", output_style: "default" } } }]),
);

console.log(`=== differ run-id map: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — engine-minted ids are mapped and every behavioural difference still fires" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
