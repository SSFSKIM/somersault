// ONE live take of one scenario, promoted only if it is a recording of that
// scenario.
//
// Lifted out of `m1/run.ts` by C13c, unchanged in what it does, because a THIRD
// caller now needs the same act: `w10/timed.ts` records the two scenarios whose
// deadlines the corpus runner cannot grade, and `w10/record.ts` records the six
// it can. Two copies of "record a cassette" would be two definitions of what a
// take has to survive — one of them would keep the contamination check or the
// infrastructure-failure check and the other would quietly not — and the whole
// corpus is only worth what its takes are.
//
// `docs/tech-debt-tracker.md` named exactly this shape as the fix for the seven
// cassettes that live outside the sidecar mechanism: "lift the sidecar
// write/compare out of `m1/run.ts` into a helper the three other runners call,
// keyed by their own cassette names". This is the WRITE half.
//
// ## What a take has to survive, and why each one discards rather than warns
//
//  * THE DETERMINISM CHECKS the run itself makes (`ScenarioRun.ok`): a
//    positional fallback, a gate-cache leak, a tree that never settled.
//  * CONTAMINATION. Cassettes are recordings of real prompts; if the engine's
//    config dir leaks, they capture the operator's identity, memory index and
//    personal commands — a privacy problem and a determinism problem, because
//    the recording would change whenever that state changes. This must REJECT
//    rather than flag: an earlier version set `process.exitCode` and was
//    overwritten by the final verdict, so a contaminated take was promoted and
//    reused anyway.
//  * AN INFRASTRUCTURE FAILURE. A rate limit or a gateway error captured into a
//    cassette makes every engine replay the same failure, and the scenario
//    silently measures nothing.
//  * THE SUBSTANCE CHECK, when the scenario has one AND the behaviour was the
//    live take's to produce. A take in which the behaviour never happened is not
//    a recording of that scenario; promoting it freezes a cassette that answers
//    a conversation where nothing occurred, and every replay after it grades
//    that. A scenario whose fault is AUTHORED after the take is the exception,
//    and the only one — its check describes the derived cassette, not the take.
//
// A staged path is used throughout so a re-record that hits an outage cannot
// destroy the good cassette it was refreshing (measured: `--rerecord` during an
// API outage deleted a working `plain` cassette and left the scenario
// ungradable until the outage cleared).
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deriveFaultCassette } from "./faults.js";
import { baselineSeedHash, type ConfigPrecondition, type RecordedPrecondition, type Scenario } from "./harness.js";
import { acquireSandboxLock } from "./lock.js";
import { ENGINE_VERSION } from "./pin.js";
import { runScenarioOnce } from "./runScenario.js";
import { saveTranscript } from "./runTurn.js";

/**
 * Markers whose presence in a cassette means the engine's config isolation is
 * not holding. The sandbox path legitimately sits under `$HOME`, so bare-home
 * is not a marker; the operator's real config dir and identity are.
 */
export const CONTAMINATION_MARKERS: [marker: string, label: string][] = [
  [join(homedir(), ".claude"), "operator config dir"],
  ["Memory index", "operator memory index"],
  ["@gmail.com", "operator email"],
];

/** Which markers a staged cassette carries, if any. */
export function contaminationIn(cassette: string): string[] {
  const text = readFileSync(cassette, "utf8");
  return CONTAMINATION_MARKERS.filter(([m]) => text.includes(m)).map(([, label]) => label);
}

/**
 * The failures that are the API's, not the engine's — the ones a walk should
 * wait out rather than read.
 *
 * WIDER THAN THE FIRST VERSION, and the gap was measurable: a recorder loop
 * retries on any throttle it recognises, and this predicate is what decides
 * which reason the take is discarded FOR. A refusal this list missed was
 * discarded a step later, by the substance check, as "the behaviour did not
 * happen" — a sentence that stops the walk, because a substance failure is a
 * finding to read rather than a budget to spend again. So the two vocabularies
 * are one: the account-limit wording (`usage limit`, `quota`) and the two
 * throttle statuses (429 for the rate limit itself, 529 for `Overloaded`) join
 * the gateway ones, which were the only numbers here.
 *
 * The statuses are matched on word boundaries: they are the whole token in
 * `API Error: 429 {…}`, and an unanchored `504` also sits inside a byte count.
 */
export const capturedInfraFailure = (messages: readonly unknown[]): boolean =>
  messages.some((m) => {
    const t = (m as { type?: string }).type;
    const msg = String((m as { message?: unknown }).message ?? "");
    return t === "reforge-exception" && /rate limit|temporarily limiting|usage limit|quota|overloaded|\b(?:429|502|503|504|529)\b/i.test(msg);
  });

/**
 * The engine-minted paths a RECORDED TURN may not name, and why this is a
 * promotion rule rather than advice.
 *
 * A run-scoped id in a REPLY is harmless — the differ maps it and the hash
 * scrubs it. A run-scoped id in a REQUEST is not, because it is an argument the
 * turn depends on: if the model reads `…/<session>/tasks/b12345678.output`, then
 * the next request body carries that path AND the file's contents, and the next
 * run mints a different id over a directory that does not exist. Scrubbing
 * cannot repair it in the safe direction — erasing the id makes the recorded
 * turn match a request for a task that is not there — so the only fix is a take
 * in which the model never asked. That fix lives in the PROMPT, and the prompt
 * is the thing a fix round changes and then forgets to re-record.
 *
 * MEASURED TWICE, which is why it is enforced here rather than remembered:
 * `bash-background-control`'s first cassette froze a task-retrieval id
 * (`6596b14`), and `bash-timeout-background`'s froze a Read of the
 * auto-backgrounded task's output file. The second survived review because it
 * kept REPLAYING — the recording's own file was still on disk, outside the
 * sandbox that every reset wipes — until the machine rebooted and took `/tmp`
 * with it.
 *
 * Anchored on the engine's own directory names rather than on the bare `b`+8
 * shape, which would also match prose.
 */
export const MINTED_PATH_IN_REQUEST = /\/(?:tasks\/b[0-9a-z]{8}\.output|tool-results\/b[0-9a-z]{8}\.(?:txt|json))/;

/**
 * Which of a staged cassette's recorded TOOL CALLS name one, with the input
 * that does.
 *
 * The tool_use INPUTS only. A tool RESULT naming the path is the engine
 * answering, and a result is a reply; the defect is the model asking, because
 * that is what puts the path in the request the replay has to match.
 */
export function mintedPathsIn(cassette: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(cassette, "utf8").split("\n").filter(Boolean)) {
    let body: unknown;
    try {
      body = JSON.parse(JSON.parse(line).requestBody as string);
    } catch {
      continue; // a non-JSON body (the boot HEAD) carries no tool call
    }
    for (const m of (body as { messages?: { content?: unknown }[] }).messages ?? []) {
      if (!Array.isArray(m.content)) continue;
      for (const blk of m.content as { type?: string; name?: string; input?: unknown }[]) {
        if (blk.type !== "tool_use") continue;
        const input = JSON.stringify(blk.input ?? null);
        if (MINTED_PATH_IN_REQUEST.test(input)) out.push(`${blk.name}(${input.slice(0, 160)})`);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Is this take's substance the LIVE take's to prove?
 *
 * Only when the scenario has a check at all, the caller has not turned the check
 * off — and the scenario's behaviour is not AUTHORED after the fact. That last
 * clause is the C13c fix-round correction. A `deriveFault` scenario records a
 * healthy turn and then has its first exchange rewritten into a failure
 * (`deriveFaultCassette`, below); its check describes the DERIVED cassette, so
 * it is false of every live take by construction. `hooks-stop-failure` asserts
 * StopFailure fired and Stop did not, which is exactly what a healthy turn
 * cannot show — so the check discarded the good recording every time and the
 * scenario could not be re-recorded at all.
 *
 * The claim is not dropped, it is graded where it is true: `m1/run.ts` runs the
 * same `check` on the replay of the derived cassette.
 *
 * A predicate rather than a conditional in place, because "which takes are
 * graded live" is the sort of rule that is worth a control, and the alternative
 * control is a live take.
 */
export const gradesSubstanceLive = (s: Scenario, requireSubstance?: boolean): boolean =>
  requireSubstance !== false && s.check !== undefined && s.deriveFault === undefined;

export interface RecordOptions {
  scenario: Scenario;
  /** the precondition the scenario DECLARES — what gets applied and written down */
  declared: ConfigPrecondition;
  cassette: string;
  sidecar: string;
  /** whose fallback verdict applies (§3.4) */
  engineB: string;
  /**
   * Grade the take's substance before promoting it. Default true, and already
   * off for a `deriveFault` scenario without anyone asking (see below): the flag
   * is for a caller that wants to skip the check for some OTHER reason, and it
   * exists so that caller has to say so rather than silently skip.
   */
  requireSubstance?: boolean;
}

export interface RecordOutcome {
  ok: boolean;
  /** why it was discarded, when it was */
  reason: string | null;
  /** API exchanges in the promoted cassette */
  exchanges: number;
  messages: unknown[];
}

/** Record one scenario live through `engine-real`, and promote the take only if it survives. */
export async function recordCassette(opts: RecordOptions): Promise<RecordOutcome> {
  const { scenario: s, declared, cassette, sidecar, engineB } = opts;
  const staged = `${cassette}.recording`;
  // THE LOCK BEFORE THE FIRST DESTRUCTIVE ACT, not at the reset a layer down.
  // `runScenarioOnce` → `resetSandbox` takes it, but the staged file is deleted
  // on the way there — so a recorder that a live sibling is about to refuse
  // would still have destroyed that sibling's in-flight take first. Acquiring
  // here is free when the caller (or its parent) already holds it: the lock
  // short-circuits on true ownership and exempts a holder's own children.
  acquireSandboxLock(`recordCassette (${s.tag}: staged cassette + sandbox/ + config/)`);
  rmSync(staged, { force: true });

  const rec = await runScenarioOnce({ scenario: s, engineName: "engine-real", mode: "record", cassette: staged, side: "record", precondition: declared, engineB });
  const discard = (reason: string): RecordOutcome => {
    rmSync(staged, { force: true });
    return { ok: false, reason, exchanges: 0, messages: rec.messages };
  };

  if (!rec.ok) return discard("the recording failed its determinism checks");
  saveTranscript(`m1-${s.tag}-record`, { engine: "engine-real", messages: rec.messages, durationMs: 0 });

  if (existsSync(staged)) {
    const hits = contaminationIn(staged);
    // "LEAK" verbatim, because `m2/relay.ts`'s REASON_RE looks for that word:
    // a discard whose cause cannot survive the relay to the gate's log is a red
    // phase with no reason under it, which is the defect that module exists for.
    if (hits.length > 0) return discard(`LEAK: the cassette contains ${hits.join(", ")} — config isolation is not holding`);
    // …and the other way a take is unreplayable: a recorded tool call that names
    // a path only this run mints (see `MINTED_PATH_IN_REQUEST`). Checked before
    // the substance check, because a take that names one is not a weaker
    // recording of the behaviour — it is a recording that cannot be replayed at
    // all, and the reason has to say which call did it so the fix lands in the
    // prompt rather than in a scrub.
    const minted = mintedPathsIn(staged);
    if (minted.length > 0) {
      return discard(
        `the take names an ENGINE-MINTED path in a recorded tool call, so the turn can never be replayed — ${minted.join(" ; ")}. ` +
          `Forbid the retrieval in the turn where the tool result names the path.`,
      );
    }
  }
  if (capturedInfraFailure(rec.messages)) {
    return discard(`the recording captured an infrastructure failure (not engine behaviour)${existsSync(cassette) ? " — the previous cassette is kept" : ""}`);
  }
  if (gradesSubstanceLive(s, opts.requireSubstance)) {
    const failure = s.check!(rec.messages, rec.events);
    if (failure !== null) return discard(`the live take did not exercise the behaviour — ${failure}`);
  }

  // A scenario whose firing condition is an API FAILURE authors it here, before
  // promotion, so the committed cassette IS the graded one and a re-record
  // cannot quietly promote the healthy take.
  if (s.deriveFault) deriveFaultCassette(staged, staged, s.deriveFault);

  const exchanges = existsSync(staged) ? readFileSync(staged, "utf8").split("\n").filter(Boolean).length : 0;
  renameSync(staged, cassette);
  // ALWAYS written, including for the empty declaration: the empty declaration
  // is still a filesystem — the baseline seed — and a cassette with no sidecar
  // records nothing about the world it was recorded against.
  writeFileSync(
    sidecar,
    JSON.stringify(
      {
        declared,
        baselineSha256: baselineSeedHash(ENGINE_VERSION),
        ...(s.detachedChildren !== undefined ? { detached: [...s.detachedChildren] } : {}),
      } satisfies RecordedPrecondition,
      null,
      2,
    ) + "\n",
  );
  return { ok: true, reason: null, exchanges, messages: rec.messages };
}
