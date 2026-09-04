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
//  * THE SUBSTANCE CHECK, when the scenario has one. A take in which the
//    behaviour never happened is not a recording of that scenario; promoting it
//    freezes a cassette that answers a conversation where nothing occurred, and
//    every replay after it grades that.
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

/** Does this capture carry an infrastructure failure rather than engine behaviour? */
export const capturedInfraFailure = (messages: readonly unknown[]): boolean =>
  messages.some((m) => {
    const t = (m as { type?: string }).type;
    const msg = String((m as { message?: unknown }).message ?? "");
    return t === "reforge-exception" && /rate limit|temporarily limiting|overloaded|502|503|504/i.test(msg);
  });

export interface RecordOptions {
  scenario: Scenario;
  /** the precondition the scenario DECLARES — what gets applied and written down */
  declared: ConfigPrecondition;
  cassette: string;
  sidecar: string;
  /** whose fallback verdict applies (§3.4) */
  engineB: string;
  /**
   * Grade the take's substance before promoting it. Default true. Off only for
   * a scenario whose `check` cannot run against a live take (none today; the
   * flag exists so a caller has to say so rather than silently skip).
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
    if (hits.length > 0) return discard(`the cassette contains ${hits.join(", ")} — config isolation is not holding`);
  }
  if (capturedInfraFailure(rec.messages)) {
    return discard(`the recording captured an infrastructure failure (not engine behaviour)${existsSync(cassette) ? " — the previous cassette is kept" : ""}`);
  }
  if (opts.requireSubstance !== false && s.check) {
    const failure = s.check(rec.messages, rec.events);
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
