// ONE run of one scenario against one engine, under a record or replay proxy.
//
// Lifted out of `m1/run.ts` by H1, unchanged in what it does, because a SECOND
// caller now needs the same run: `src/reseal.ts` replays a scenario against a
// candidate precondition and grades the proxy's own signals. Two copies of this
// would be two definitions of "a graded run" — one of them would keep the
// quiesce wait or the gate-cache check and the other would quietly not, and the
// re-seal's evidence is only worth what the run behind it is.
//
// It returns the proxy's three replay signals as well as the four surfaces,
// because the caller that re-seals grades on the signals and the caller that
// diffs grades on the surfaces.
import { rmSync } from "node:fs";
import { gateCacheCheck } from "./leakcheck.js";
import { fallbackVerdict, startRecordProxy, startReplayProxy, type CassetteEntry, type FallbackServe, type ServedEntry } from "./proxy.js";
import { resetSandbox, type ConfigPrecondition, type Scenario, type ScenarioContext } from "./harness.js";
import { CONFIG_DIR, enginePath, SANDBOX } from "./runTurn.js";
import { awaitQuiesce, defaultStateRoots, stateSnapshot, type StateSnapshot } from "./state.js";
import { processBaseline, processSnapshot, reapSurvivors } from "./supervision.js";

export interface ScenarioRun {
  messages: unknown[];
  events: unknown[];
  observedFile: string;
  /** §3.2's fourth surface: what the run left on disk, and how it ended. */
  state: StateSnapshot;
  /** false when this run hit a fatal positional fallback, a gate-cache leak, or never settled. */
  ok: boolean;
  /** replay only: requests no entry answered */
  unmatched: { method: string; path: string; requestBody: string }[];
  /** replay only: entries never served */
  unserved: CassetteEntry[];
  /** replay only: requests served POSITIONALLY, with the entry each was handed */
  fallbacks: FallbackServe[];
  /** replay only: the entries served, in REQUEST order — the signal the other three cannot carry */
  servedOrder: ServedEntry[];
}

export interface ScenarioRunOptions {
  scenario: Scenario;
  engineName: string;
  mode: "record" | "replay";
  cassette: string;
  /** names this run in the log and in the observed-request dump beside the cassette */
  side: string;
  precondition: ConfigPrecondition;
  /** whose fallback verdict applies (§3.4): fatal for every engine but the identical-code pair */
  engineB: string;
}

export async function runScenarioOnce(opts: ScenarioRunOptions): Promise<ScenarioRun> {
  const { scenario: s, engineName, mode, cassette, side, precondition, engineB } = opts;
  // DERIVED FROM THE CASSETTE, not from the corpus directory: for the corpus
  // this is the same `m1-<tag>-observed-<side>.jsonl` it has always been, and
  // for a cassette COPIED into a temp directory (the re-seal controls) the
  // byproduct lands beside the copy rather than in the corpus.
  const observedFile = `${cassette.replace(/\.jsonl$/, "")}-observed-${side}.jsonl`;
  rmSync(observedFile, { force: true });
  const proxy =
    mode === "record" ? await startRecordProxy(cassette, undefined, undefined, s.recordInject ?? null) : await startReplayProxy(cassette, observedFile);
  const events: unknown[] = [];
  const ctx: ScenarioContext = {
    engine: enginePath(engineName),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event, payload) => events.push({ event, payload }),
    mode, // X6: record passes the one selected credential; replay passes the placeholder
  };
  resetSandbox(precondition);
  // BEFORE the run, and after the reset: the supervision surface is a DIFFERENCE
  // over the process table (see src/supervision.ts), so what was already running
  // has to be recorded while it is still the only thing running.
  const processesBefore = processBaseline();
  let messages: unknown[];
  try {
    messages = await s.run(ctx);
  } catch (e) {
    messages = [{ type: "reforge-exception", name: (e as Error).name, message: String((e as Error).message).slice(0, 200) }];
  }
  // Taken BEFORE the next run resets the sandbox, and before the proxy closes —
  // nothing after this point touches the tree. AFTER AN OBSERVED QUIESCE: the
  // engine's transcript is written on a 100 ms timer and a long scenario's file
  // is still moving when the query resolves (measured; see src/state.ts's flush
  // header). The wait changes nothing the engine does and is applied identically
  // to every engine; a run that never settles fails rather than being snapshotted
  // mid-drain.
  const roots = defaultStateRoots(SANDBOX, CONFIG_DIR);
  const quiesce = await awaitQuiesce(roots);
  if (!quiesce.settled) console.log(`    WARN ${side}: the state roots never stopped changing (${quiesce.waitedMs} ms) — the snapshot would be of a moving file`);
  // THE TREE IS READ FIRST, at exactly the instant it was read before this
  // member existed, and the order is not incidental. `processSnapshot` samples
  // twice `settleMs` apart, so taking it first would push the filesystem read
  // ~600 ms further past the quiesce — and a scenario with a concurrent writer
  // (a backgrounded agent, a compactor's rewrite) would then be snapshotted at a
  // different point in a race the corpus already knows is one. A new surface may
  // add an observation; it may not move an existing one.
  const fsState = stateSnapshot(roots, messages);
  // …and then what the run left RUNNING, against the scenario's DECLARED
  // detachments, so a deliberate background shell is recorded without being a
  // leak.
  const { snapshot: processes } = await processSnapshot(processesBefore, { detached: s.detachedChildren, label: side });
  const state: StateSnapshot = { ...fsState, processes };
  // REAPED AFTER THE SNAPSHOT, and this is a correctness requirement rather
  // than tidiness: side A runs first, so a child it leaves is already running
  // when side B takes its baseline and B does not see it as new — the two sides
  // would then diff on a leak BOTH engines produce. Reaping makes each side's
  // baseline the same world. (It also keeps a leaked engine child from writing
  // `sessions/<pid>` files that redden a later config-dir inventory.)
  const reaped = reapSurvivors(processes);
  if (reaped > 0) console.log(`    supervision ${side}: reaped ${reaped} process(es) the run left behind`);
  const unmatched = mode === "replay" ? proxy.unmatched() : [];
  const unserved = mode === "replay" ? proxy.unserved() : [];
  const fallbacks = mode === "replay" ? proxy.fallbacks() : [];
  const servedOrder = mode === "replay" ? proxy.servedOrder() : [];
  await proxy.close();
  if (unmatched.length > 0) console.log(`    WARN ${side}: ${unmatched.length} request(s) matched no cassette entry`);
  if (unserved.length > 0) console.log(`    WARN ${side}: ${unserved.length} cassette entr(ies) never served`);
  // §3.4: a positional fallback is a warning only on the identical-code pair;
  // for any other engineB it fails the scenario.
  const fallbackOk = fallbackVerdict(engineB, side, fallbacks.length);
  // §3.3: the gate caches must never appear in the harness config dir, after
  // EITHER mode — a record writes config, and so does a replay.
  const gateOk = gateCacheCheck(CONFIG_DIR, `${s.tag}/${side}`);
  return { messages, events, observedFile, state, ok: fallbackOk && gateOk && quiesce.settled, unmatched, unserved, fallbacks, servedOrder };
}
