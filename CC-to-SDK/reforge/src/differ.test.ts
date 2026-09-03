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
import { diffTranscripts, makeRunNormalizer, makeRunNormalizerOver, RUN_ID_KEYS } from "./differ.js";

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

// ---- C12a/W9a: the STORED envelope's six ids ------------------------------
//
// The five surfaces above grade what the engine SAID. These grade what it
// WROTE: `src/state.ts` projects each stored transcript record to its envelope,
// and the envelope carries five run-scoped ids plus the project-key slug. Each
// rule below gets the three checks §3.4 asks for — a MUST-CATCH (the
// reimplementation defect it exists to preserve), a MUST-SURVIVE NEIGHBOUR (a
// value of the same lexeme under a key that is NOT mapped, proving the rule is
// key-scoped rather than shape-scoped), and a MUTATION OF ITSELF (the same
// fixture normalized with that one key deleted from the set, which must go from
// agreeing to differing — a rule whose deletion changes nothing was never
// load-bearing).
//
// EVERY ONE OF THE SIX POINTS SOMEWHERE THE FILE DOES NOT CONTAIN, and that is
// deliberate rather than incidental: a `parentUuid` that names a record in the
// same file is already mapped through that record's own `uuid`, so the rule is
// only load-bearing for the case the store actually creates — a resumed session
// whose parent lives in the previous file, a boundary's `logicalParentUuid`
// naming an engine-internal frame, a `leafUuid` pointing past the file's head.
// That is the same argument C7/W4 made for the compact_boundary's uuids, one
// artifact over.
interface StoredIds {
  session: string;
  slug: string;
  prompt: string;
  head: string;
  reply: string;
  /** the parent of the head record — lives in the PREVIOUS session file */
  external: string;
  /** the leaf the resume pointer names */
  leaf: string;
  /** the internal frame the boundary's logical parent names */
  internal: string;
  toolUse: string;
  cwd?: string;
}

/** One stored session file, projected the way `src/state.ts` projects it. */
const stored = (i: StoredIds): unknown[] => [
  { type: "user", uuid: i.head, parentUuid: i.external, promptId: i.prompt, sessionId: i.session, slug: i.slug, cwd: i.cwd ?? "/box/sandbox", role: "user", tool_use_id: i.toolUse },
  { type: "assistant", uuid: i.reply, parentUuid: i.head, promptId: i.prompt, sessionId: i.session, slug: i.slug, cwd: i.cwd ?? "/box/sandbox", role: "assistant" },
  { type: "last-prompt", leafUuid: i.leaf, sessionId: i.session, slug: i.slug, explicit: true },
  { type: "compact_boundary", uuid: `${i.session}-b`, parentUuid: null, logicalParentUuid: i.internal, sessionId: i.session, slug: i.slug },
];

const P: StoredIds = {
  session: "9618dc32-bed6-4fe2-b87f-108832db19b5", slug: "-box-alpha-sandbox", prompt: "b9327c3f-b4c8-47e9-9900-b7ae9ba51d81",
  head: "8f315efd-0ec5-46a5-9f5e-84629d018526", reply: "1b0a55b0-2c05-4a2e-9a12-6a2a2f5b7a01", external: "e4f60250-2e8a-4a9c-8d85-06a135c4b327",
  leaf: "d5f7a9c1-1111-4bcd-9f01-aaaaaaaaaaaa", internal: "345ed50e-3be5-4fea-8637-7e7c6461cfdb", toolUse: "toolu_01SharedFromTheCassette",
};
const Q: StoredIds = {
  session: "a2660536-9727-42c0-8c2b-202c5e9daa4c", slug: "-box-bravo-sandbox", prompt: "7252fe00-725e-4007-a49a-3d1ce8f4e75c",
  head: "ae8d1652-3e90-4e36-95e7-7a6fac7b719e", reply: "0b6e6564-44fe-4182-b5c2-80a6433ceba1", external: "c11d4f26-9a7b-4d2e-8e7f-2b7b9c1d3e4f",
  leaf: "6f2c8a3e-2222-4bcd-9f01-bbbbbbbbbbbb", internal: "f0a1b2c3-d4e5-4f60-8a9b-0c1d2e3f4a5b", toolUse: "toolu_01SharedFromTheCassette",
};

check("two runs of the same engine agree once the stored envelope's six ids are mapped", !differs(stored(P), stored(Q)));

/**
 * The mutation harness. `differs` above runs its inputs through
 * `diffTranscripts`, which re-normalizes with the FULL key set — so a rule
 * deleted upstream of it is silently restored, and every mutation control would
 * pass by construction. These two compare the normalized forms directly, over
 * exactly the key set they are given.
 */
const normOver = (keys: ReadonlySet<string>, x: unknown[]): string => JSON.stringify(makeRunNormalizerOver(keys, [x])(x));
const agreesOver = (keys: ReadonlySet<string>, a: unknown[], b: unknown[]): boolean => normOver(keys, a) === normOver(keys, b);
const withoutKey = (key: string, a: unknown[], b: unknown[]): boolean =>
  !agreesOver(new Set([...RUN_ID_KEYS].filter((k) => k !== key)), a, b);

// The mutation battery is only evidence if the UNMUTATED comparison agrees —
// otherwise every "deleting the rule makes them differ" check passes on a
// difference that was there all along.
check("the mutation harness agrees with itself on the full key set", agreesOver(RUN_ID_KEYS, stored(P), stored(Q)));

for (const [key, mutate, defect] of [
  // A record chained to the wrong parent — the defect the whole subsystem exists
  // to avoid, and the one `m2/cross-resume`'s shape diff passes.
  ["parentUuid", (i: StoredIds) => { const r = stored(i) as Record<string, unknown>[]; r[1].parentUuid = r[3].uuid; return r; }, "a record chained to the WRONG parent"],
  // A boundary that relinked to the wrong internal frame: `GVt`'s relink is the
  // arm D3 grades, and its whole output is this one field.
  ["logicalParentUuid", (i: StoredIds) => { const r = stored(i) as Record<string, unknown>[]; r[3].logicalParentUuid = i.head; return r; }, "a boundary relinked to a different frame"],
  // A resume pointer naming a different leaf — resuming a PREFIX of the
  // conversation rather than the conversation.
  ["leafUuid", (i: StoredIds) => { const r = stored(i) as Record<string, unknown>[]; r[2].leafUuid = i.head; return r; }, "a resume pointer naming a different leaf"],
  // Two prompt ids where the oracle minted one: the correlation that makes a
  // turn's records one turn.
  ["promptId", (i: StoredIds) => { const r = stored(i) as Record<string, unknown>[]; r[1].promptId = i.internal; return r; }, "two promptIds where the oracle minted one"],
  // Two session ids inside one file: a pointer reset that fired mid-file.
  ["sessionId", (i: StoredIds) => { const r = stored(i) as Record<string, unknown>[]; r[3].sessionId = i.internal; return r; }, "two sessionIds inside one file"],
  // Records written under two different project keys — the relocation defect
  // (§4.4 D14) seen from the store side.
  ["slug", (i: StoredIds) => { const r = stored(i) as Record<string, unknown>[]; r[3].slug = "-box-elsewhere-sandbox"; return r; }, "records split across two project keys"],
] as [string, (i: StoredIds) => unknown[], string][]) {
  check(`${key}: ${defect} still diffs after mapping`, differs(stored(P), mutate(Q)));
  check(`${key}: deleting the rule from the map makes two healthy runs DIFFER (the rule is load-bearing)`, withoutKey(key, stored(P), stored(Q)));
}

// THE `slug` RULE, AND THE OVERLOAD THAT MADE IT TWO CORRECTIONS. The property
// name carries the project key, a per-run three-word name written into the
// envelope of every record after a compaction, and (in records the headless
// corpus never reaches) an artifact name. All three are mapped; what survives is
// the one-to-one map's weaker claim, which is asserted here.
check(
  "the per-run three-word slug a compaction mints is mapped, so two runs agree",
  !differs(
    [{ type: "user", slug: "encapsulated-noodling-neumann", sessionId: P.session }],
    [{ type: "user", slug: "linear-launching-squirrel", sessionId: Q.session }],
  ),
);
check(
  "…and the project key, which begins with the flattened separator, is mapped too",
  !differs([{ type: "user", slug: P.slug, sessionId: P.session }], [{ type: "user", slug: Q.slug, sessionId: Q.session }]),
);
check(
  "…while an engine that used TWO slugs where the oracle used one still diffs",
  differs(
    [{ type: "user", slug: "encapsulated-noodling-neumann", sessionId: P.session }, { type: "user", slug: "encapsulated-noodling-neumann", sessionId: P.session }],
    [{ type: "user", slug: "linear-launching-squirrel", sessionId: Q.session }, { type: "user", slug: "ancient-splashing-wall", sessionId: Q.session }],
  ),
);

// MUST-SURVIVE NEIGHBOURS. Each is the same lexeme as a mapped key, under a key
// the map does NOT carry, and each must still discriminate — this is what makes
// the rules key-scoped rather than a licence to erase every uuid-shaped string.
check(
  "a tool_use_id is REPLAYED from the cassette, so a different one still diffs",
  differs(stored(P), stored({ ...Q, toolUse: "toolu_01ADifferentBlockEntirely" })),
);
check(
  "…and two engines serving the SAME cassette agree on it",
  !differs(stored(P), stored(Q)),
);
check(
  "the record's cwd is behaviour (relocation writes it), so a different cwd still diffs",
  differs(stored(P), stored({ ...Q, cwd: "/box/elsewhere" })),
);
// The slug rule's other half: it is mapped so that it can be replaced INSIDE the
// state surface's path strings, which is where `src/state.ts` puts it.
check(
  "the slug is replaced inside a path string too, so two machines' project dirs agree",
  !differs(
    [{ path: `projects/${P.slug}/${P.session}.jsonl`, slug: P.slug, sessionId: P.session }],
    [{ path: `projects/${Q.slug}/${Q.session}.jsonl`, slug: Q.slug, sessionId: Q.session }],
  ),
);
check(
  "…while a file written under a DIFFERENT directory than its own slug still diffs",
  differs(
    [{ path: `projects/${P.slug}/${P.session}.jsonl`, slug: P.slug, sessionId: P.session }],
    [{ path: `projects/${Q.slug}/sub/${Q.session}.jsonl`, slug: Q.slug, sessionId: Q.session }],
  ),
);

console.log(`=== differ run-id map: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — engine-minted ids are mapped and every behavioural difference still fires" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
