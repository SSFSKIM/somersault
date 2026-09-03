// C12a/W9a — the three DAMAGED-FILESYSTEM scenarios, and the first use of the
// declared config precondition for anything other than "start clean".
//
// The W9 scout's §4.4 matrix has fourteen dirty-state cells and the corpus
// reached five, all of them by accident: D6–D14 are unreachable by prompting a
// model, because they are statements about the filesystem before the run rather
// than about the conversation. These three are the machinery child's proof that
// the primitive works — a seeded transcript, damaged in a named and
// replay-deterministic way, resumed by both engines, graded on all four
// surfaces.
//
// Each carries its precondition DECLARATIVELY, so the runner records it beside
// the cassette and replays against the same filesystem the recording was made
// against.
import { baseOptions, drive, projectKeyFor, resultText, type ConfigPrecondition, type Scenario, type SeedFile } from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";

/**
 * The seeded session's id. FIXED, because a precondition is a declaration: a
 * per-run id would make the seed a different file every run and the cassette
 * would be answering a conversation nobody can reproduce.
 */
const SEED_SESSION = "9a11c0de-0000-4000-8000-000000000001";
const PROMPT_ID = "9a11c0de-0000-4000-8000-000000000020";
/**
 * TWO exchanges, and two codewords, because one of each made the cycle
 * unobservable. Measured: with a single exchange the chain walk collects both
 * records and THEN sees the repeat, so a cycled seed and a healthy one produced
 * byte-identical request bodies — the fault was applied and graded nothing. With
 * two exchanges the cycle is reached before the first pair, so the healthy case
 * carries both codewords and the cycled one carries only the later. A negative is
 * evidence only if the healthy case would differ.
 */
const ALPHA = "REFORGE_SEEDED_ALPHA";
const DELTA = "REFORGE_SEEDED_DELTA";
const EXCHANGES: { prompt: string; uuid: string; reply: string; replyUuid: string }[] = [
  { prompt: `Remember the codeword ${ALPHA}. Reply with exactly OK.`, uuid: "9a11c0de-0000-4000-8000-000000000010", reply: "OK", replyUuid: "9a11c0de-0000-4000-8000-000000000011" },
  { prompt: `Also remember the codeword ${DELTA}. Reply with exactly OK.`, uuid: "9a11c0de-0000-4000-8000-000000000012", reply: "OK", replyUuid: "9a11c0de-0000-4000-8000-000000000013" },
];
const LEAF = EXCHANGES[EXCHANGES.length - 1].replyUuid;
const SEED_PATH = `projects/${projectKeyFor(SANDBOX)}/${SEED_SESSION}.jsonl`;

/**
 * An authored session transcript, in the envelope `insertMessageChain` writes
 * (W9 scout §1.5), modelled field for field on a real one the corpus produced.
 * Every value is fixed except `cwd`, which is the harness's own sandbox path and
 * has to match for the engine to resolve the project key.
 */
function seedTranscript(): string {
  const common = {
    isSidechain: false,
    userType: "external",
    entrypoint: "sdk-cli",
    cwd: SANDBOX,
    sessionId: SEED_SESSION,
    version: "2.1.251",
    gitBranch: "main",
  };
  const rows: Record<string, unknown>[] = [];
  let parent: string | null = null;
  EXCHANGES.forEach((ex, i) => {
    rows.push({
      parentUuid: parent,
      ...common,
      promptId: `${PROMPT_ID.slice(0, -1)}${i}`,
      type: "user",
      message: { role: "user", content: [{ type: "text", text: ex.prompt }] },
      uuid: ex.uuid,
      timestamp: `2026-09-03T00:00:0${i * 2}.000Z`,
      permissionMode: "bypassPermissions",
      promptSource: "sdk",
    });
    rows.push({
      parentUuid: ex.uuid,
      ...common,
      type: "assistant",
      message: {
        model: "claude-sonnet-5",
        id: `msg_reforgeSeededDelta000${i}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: ex.reply }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 },
      },
      uuid: ex.replyUuid,
      timestamp: `2026-09-03T00:00:0${i * 2 + 1}.000Z`,
    });
    parent = ex.replyUuid;
  });
  rows.push({ type: "last-prompt", lastPrompt: EXCHANGES[EXCHANGES.length - 1].prompt, leafUuid: LEAF, sessionId: SEED_SESSION });
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const seed: SeedFile = { path: SEED_PATH, content: seedTranscript() };
const seeded = (kind: "torn-tail" | "parent-cycle"): ConfigPrecondition => ({ seed: [seed], faults: [{ kind, target: SEED_PATH }] });

const RESUME_PROMPT =
  "List every codeword from earlier in this conversation, in the order they were given, separated by a single space, and nothing else. If there is no earlier conversation, reply with exactly NONE.";

export const W9_SCENARIOS: Scenario[] = [
  {
    // THE HEALTHY SEED — the control the other two are read against. It is a
    // scenario in its own right (§4.4 D2, a resume of a file the harness wrote
    // rather than the engine) and it is also the reason the fault scenarios are
    // evidence: without it, "the cycled run carried one codeword" is a number
    // with nothing to compare to.
    tag: "store-seeded-resume",
    title: "resume an AUTHORED session file with an intact chain (the fault control)",
    precondition: { seed: [seed] },
    run: (ctx) =>
      drive(RESUME_PROMPT, {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        resume: SEED_SESSION,
      }),
    check: (msgs) => {
      const t = resultText(msgs);
      return t.includes(ALPHA) && t.includes(DELTA) ? null : `an intact seeded chain must carry BOTH codewords (result: ${t.slice(0, 80)})`;
    },
  },
  {
    // §4.4 D7. A file whose last line has no terminating newline is what a
    // process killed between two 100 ms drains leaves; the store's answer is
    // `sealTornTailOnNextAppend` / `setTailTorn`, and no prompt produces one.
    // The torn record here is the `last-prompt` checkpoint, so the RESUME
    // POINTER is what the tear destroys and the chain has to be resolved
    // implicitly — which is the arm worth grading.
    tag: "store-torn-tail",
    title: "resume a session file whose tail was torn mid-record",
    precondition: seeded("torn-tail"),
    run: (ctx) =>
      drive(RESUME_PROMPT, {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        resume: SEED_SESSION,
      }),
    // The contract: a torn tail costs the PARTIAL record and nothing else. An
    // engine that discarded the file, or stopped at the tear, answers NONE or
    // one codeword; both engines must do the same thing, and the state surface
    // carries what the seal left behind.
    check: (msgs) => {
      const t = resultText(msgs);
      return t.includes(ALPHA) && t.includes(DELTA) ? null : `a torn tail must cost only the partial record (result: ${t.slice(0, 80)})`;
    },
  },
  {
    // §4.4 D8, AND A MEASURED CORRECTION TO IT. The last two chained records
    // point at each other, so a walk up from the leaf reaches a record it has
    // already seen and everything above the cycle is unreachable — that much is
    // asserted directly by `src/precondition.test.ts`, which walks the seeded
    // file and proves the first exchange is off the chain.
    //
    // The engine carries both codewords anyway. So at this pin the HEADLESS
    // resume path does not rebuild its history by walking `parentUuid`: the
    // cycle is real, the file is damaged, and the conversation the engine sends
    // is byte-identical to the healthy control's. The scout's D8 row expects
    // `tengu_chain_parent_cycle` and a partial transcript; whatever reads that
    // way, it is not the path a `--print` resume takes. The scenario is kept
    // BECAUSE of that: it pins the measurement, so a pin bump that starts
    // truncating on a cycle reddens here rather than silently changing what
    // resume means, and C12b — which owns the chain walk and can reach it from a
    // synthetic corpus with no engine at all — inherits a measured boundary
    // instead of an assumption.
    tag: "store-parent-cycle",
    title: "resume a session file whose parentUuid chain is a cycle (measured: the headless path does not walk it)",
    precondition: seeded("parent-cycle"),
    run: (ctx) =>
      drive(RESUME_PROMPT, {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        resume: SEED_SESSION,
      }),
    check: (msgs) => {
      const t = resultText(msgs);
      if (t.length === 0) return "the engine produced no result on a cycled chain";
      return t.includes(ALPHA) && t.includes(DELTA)
        ? null
        : `the cycle now costs history, which it did not at 2.1.251 — re-adjudicate D8 (result: ${t.slice(0, 80)})`;
    },
  },
  {
    // The store's PERMISSION errno set, `{EACCES, EPERM}` — the fifth of the
    // scout's six damaged-filesystem arms (§4.3). NOT `ENOSPC`: the store fence
    // latches on `{ENOSPC, EROFS, EDQUOT, ENAMETOOLONG}`, and none of those four
    // can be raised against a chosen path by an unprivileged process on a normal
    // filesystem (see `FsFaultKind` in src/precondition.ts for the two mechanisms
    // that would reach it and why neither is bought here).
    tag: "store-read-only",
    title: "the project directory is not writable when the store tries to append",
    precondition: { seed: [{ path: `projects/${projectKeyFor(SANDBOX)}/.keep`, content: "", dirMode: 0o500 }] },
    run: (ctx) =>
      drive("Reply with exactly the single word SELFTEST_OK and nothing else.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      }),
    // The turn must still finish: a store that cannot write is an error path the
    // engine handles, not a crash, and "both engines fail the same way" is only
    // a claim if they got far enough to fail.
    check: (msgs) => (resultText(msgs).includes("SELFTEST_OK") ? null : `the turn did not complete with the store unwritable (result: ${resultText(msgs).slice(0, 60)})`),
  },
];
