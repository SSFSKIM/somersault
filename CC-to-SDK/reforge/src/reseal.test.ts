// Controls for the precondition RE-SEAL (H1, `src/reseal.ts`).
//
// The mechanism's claim is narrow and load-bearing: "this declaration changed,
// and the request stream did not, so the cassette is the cassette of the new
// experiment too". A claim like that is only worth what its NEGATIVE is worth —
// if a declaration that genuinely changes what the engine sends also re-sealed,
// the mechanism would be a rubber stamp on exactly the case the sidecar exists
// to catch, and every wave after this one would seal its way past a real drift.
//
// So three replays of ONE scenario, `store-seeded-resume`, whose declaration
// seeds a session transcript that the engine RESUMES — which means the seeded
// bytes travel into the request body, so the healthy case and the damaged one
// demonstrably differ:
//
//   1. an inert extra seed file under `projects/<key>/` (a file nothing reads)
//      → RE-SEALED, and the new sidecar carries the provenance of the one it
//        replaced;
//   2. the same seed with the prior ASSISTANT text changed → REFUSED, naming the
//      request, the entry it was positionally served, and the byte at which the
//      canonical body stops matching;
//   3. no seed at all, so the resume has nothing to resume → REFUSED for a
//      DIFFERENT reason: entries the engine never asked for.
//
// Every replay runs against a COPY of the cassette and sidecar in a temp
// directory. The corpus is never written to: a control that mutated the corpus
// would be a control that grades a different corpus every time it runs.
//
//   npx tsx src/reseal.test.ts
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declarationSha256, projectKeyFor, type ConfigPrecondition, type Scenario } from "./harness.js";
import { baselineSeedHash } from "./precondition.js";
import { ENGINE_VERSION } from "./pin.js";
import { firstOutOfOrder, resealScenario, type ResealResult } from "./reseal.js";
import { startReplayProxy, type CassetteEntry } from "./proxy.js";
import { REFORGE_ROOT, SANDBOX } from "./runTurn.js";
import { W9_SCENARIOS } from "../w9/scenarios.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const scenario = W9_SCENARIOS.find((s) => s.tag === "store-seeded-resume") as Scenario;
const declared = scenario.precondition as ConfigPrecondition;
const seed = (declared.seed ?? [])[0];
const CASSETTE = join(REFORGE_ROOT, "cassettes", `m1-${scenario.tag}.jsonl`);
const SIDECAR = join(REFORGE_ROOT, "cassettes", `m1-${scenario.tag}.precondition.json`);

/**
 * The engine's own log lines, relayed but DEFANGED. A refusal control makes the
 * proxy print `FAIL <side>: … served POSITIONALLY`, which is the mechanism
 * working — but this suite is a gate phase, and an unprefixed `FAIL` line in a
 * PASSING phase's output is a red herring in the one artifact people read when
 * something is actually red.
 */
async function quietly(label: string, fn: () => Promise<ResealResult>): Promise<ResealResult> {
  const original = console.log;
  const captured: string[] = [];
  console.log = (...args: unknown[]) => captured.push(args.map(String).join(" "));
  try {
    return await fn();
  } finally {
    console.log = original;
    console.log(`  ${label} — the replay said: ${captured.length === 0 ? "nothing (a clean replay is silent)" : ""}`);
    for (const line of captured) console.log(`    | ${line.trim()}`);
  }
}

const box = mkdtempSync(join(tmpdir(), "reforge-reseal-"));
try {
  const started = Date.now();

  // ---- 0. the ORDER, which the other three signals cannot carry ------------
  // No engine, and none needed: the claim is about the MATCHER, so it is watched
  // where the matcher lives. A cassette copy is replayed twice — once in the
  // recorded order, once with two requests swapped — and the whole point is that
  // the swapped run is CLEAN on unmatched, on fallbacks and on unserved. Those
  // three are sets, and a set has no order; only `servedOrder` tells the two runs
  // apart, which is why re-sealing on the other three alone would have sealed a
  // sidecar against a stream nobody compared.
  //
  // `m1-file-tools` rather than this suite's own scenario, because
  // `store-seeded-resume` makes a single POST and a single request cannot be out
  // of order with itself.
  {
    const cassette = join(box, "order.jsonl");
    copyFileSync(join(REFORGE_ROOT, "cassettes", "m1-file-tools.jsonl"), cassette);
    const entries = readFileSync(cassette, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CassetteEntry);
    const replayable = entries.filter((e) => e.repeat !== true);
    check("the ordering control has enough requests to reorder", replayable.length >= 3, `${replayable.length} replayable entr(ies)`);

    const replay = async (order: CassetteEntry[]): Promise<{ seqs: number[]; clean: boolean; detail: string }> => {
      const proxy = await startReplayProxy(cassette);
      try {
        for (const e of order) {
          const r = await fetch(`http://127.0.0.1:${proxy.port}${e.path}`, {
            method: e.method,
            // HEAD and GET may not carry one, and the recorded body is empty anyway.
            body: e.requestBody.length > 0 ? e.requestBody : undefined,
          });
          await r.text();
        }
        const unmatched = proxy.unmatched().length;
        const fallbacks = proxy.fallbacks().length;
        const unserved = proxy.unserved().filter((e) => e.repeat !== true).length;
        return {
          seqs: proxy.servedOrder().filter((e) => !e.repeat).map((e) => e.seq),
          clean: unmatched === 0 && fallbacks === 0 && unserved === 0,
          detail: `unmatched ${unmatched}, fallbacks ${fallbacks}, unserved ${unserved}`,
        };
      } finally {
        await proxy.close();
      }
    };

    const straight = await replay(replayable);
    check("the recorded stream replays clean on all three set-shaped signals", straight.clean, straight.detail);
    check("…and its served entries rise, which IS the recorded order", firstOutOfOrder(straight.seqs.map((seq) => ({ seq, repeat: false }))) === -1, straight.seqs.join(", "));

    // The same requests, two of them swapped: an identical SET, a different
    // stream.
    const swapped = [...replayable];
    [swapped[swapped.length - 2], swapped[swapped.length - 1]] = [swapped[swapped.length - 1], swapped[swapped.length - 2]];
    const reordered = await replay(swapped);
    check("a REORDERED stream is still clean on all three — which is the hole", reordered.clean, reordered.detail);
    check("…and it is the ORDER that catches it", firstOutOfOrder(reordered.seqs.map((seq) => ({ seq, repeat: false }))) > 0, reordered.seqs.join(", "));
    check("…at the swap, named by position", firstOutOfOrder(reordered.seqs.map((seq) => ({ seq, repeat: false }))) === replayable.length - 1,
      `${firstOutOfOrder(reordered.seqs.map((seq) => ({ seq, repeat: false })))} of ${replayable.length}: ${reordered.seqs.join(", ")}`);
    console.log(`  control 0 — recorded order served ${straight.seqs.join(", ")}; swapped served ${reordered.seqs.join(", ")} (${reordered.detail})`);
  }

  // ---- 1. a declaration that cannot reach the model RE-SEALS ---------------
  {
    const cassette = join(box, "positive.jsonl");
    const sidecar = join(box, "positive.precondition.json");
    copyFileSync(CASSETTE, cassette);
    copyFileSync(SIDECAR, sidecar);
    const before = JSON.parse(readFileSync(sidecar, "utf8")) as { declared: ConfigPrecondition };
    const inert: ConfigPrecondition = {
      ...declared,
      seed: [...(declared.seed ?? []), { path: `projects/${projectKeyFor(SANDBOX)}/reforge-reseal-control.txt`, content: "nothing reads this file\n" }],
    };
    const r = await quietly("control 1 (inert seed file)", () => resealScenario({ scenario, declared: inert, cassette, sidecar }));
    check("an inert extra seed file re-seals: the replay is clean on all three proxy signals", r.resealed, r.reason ?? "");
    const after = JSON.parse(readFileSync(sidecar, "utf8"));
    check("…the sidecar now seals the NEW declaration", JSON.stringify(after.declared) === JSON.stringify(inert));
    check("…on the CURRENT baseline seed", after.baselineSha256 === baselineSeedHash(ENGINE_VERSION));
    check("…and carries the provenance of the sidecar it replaced",
      after.resealedFrom?.declaredSha256 === declarationSha256(before.declared),
      JSON.stringify(after.resealedFrom));
    // C13c/W10c — the DETACHMENT declaration survives the re-seal. A sidecar
    // that dropped it would reintroduce the drift it exists to remove: the
    // runner compares `recorded.detached` against the scenario's, and a
    // scenario declaring `[]` against a sidecar declaring nothing is a
    // difference. Both directions are asserted, because "absent stays absent"
    // is what keeps every pre-C13c sidecar from drifting.
    check("…and a scenario that declares NO detachments still writes none",
      !("detached" in after), JSON.stringify(after).slice(0, 200));
    {
      const declaring = { ...scenario, detachedChildren: ["reforge-child.sh"] as const };
      const r2 = await quietly("control 1b (a declared detachment)", () => resealScenario({ scenario: declaring, declared: inert, cassette, sidecar }));
      const sealed = JSON.parse(readFileSync(sidecar, "utf8"));
      check("…while a scenario that DOES declare one seals it beside the precondition",
        r2.resealed && JSON.stringify(sealed.detached) === JSON.stringify(["reforge-child.sh"]),
        `${r2.reason ?? ""} ${JSON.stringify(sealed.detached)}`);
    }
    // NON-VACUITY, stated rather than implied. A re-seal that "passed" because
    // the engine never ran would have left every entry unserved and been refused
    // — so a clean re-seal already proves the traffic happened. The byproduct
    // beside the copy says so out loud, and says how much.
    const observed = readFileSync(join(box, "positive-observed-reseal.jsonl"), "utf8").split("\n").filter(Boolean);
    check("…and the engine really replayed: every recorded exchange was requested", observed.length === 2, `${observed.length} observed request(s)`);
    check("…which is a hash, not a clock or a path (a fixture carries neither)",
      !/\d{4}-\d{2}-\d{2}|\/Users\//.test(JSON.stringify(after.resealedFrom ?? {})),
      JSON.stringify(after.resealedFrom));
  }

  // ---- 2. a declaration that CHANGES THE STREAM is refused, by name --------
  {
    const cassette = join(box, "stream.jsonl");
    const sidecar = join(box, "stream.precondition.json");
    copyFileSync(CASSETTE, cassette);
    copyFileSync(SIDECAR, sidecar);
    const untouched = readFileSync(sidecar, "utf8");
    // The seeded PRIOR ASSISTANT TEXT, taken from the scenario's own seed rather
    // than re-derived, so this control cannot drift away from what w9 declares.
    // The resume replays that text into the request body, which is what makes
    // the healthy case and this one differ — the property the control needs.
    const damaged: ConfigPrecondition = {
      ...declared,
      seed: [{ ...seed, content: seed.content.replaceAll('"text":"OK"', '"text":"SURE"') }],
    };
    check("the control actually changed the seeded assistant text", damaged.seed![0].content !== seed.content);
    const r = await quietly("control 2 (the prior assistant text differs)", () => resealScenario({ scenario, declared: damaged, cassette, sidecar }));
    check("a declaration the model CAN see is REFUSED", !r.resealed, JSON.stringify(r.written ?? {}).slice(0, 120));
    check("…and the refusal names the request that no longer matches", (r.reason ?? "").includes("POSITIONALLY") && (r.reason ?? "").includes("/v1/messages"), r.reason ?? "");
    check("…with the byte position at which the recorded and replayed bodies diverge", /first differs at byte \d+/.test(r.reason ?? ""), r.reason ?? "");
    check("…and that position is IN the changed text, which is why this is evidence", (r.reason ?? "").includes("SURE"), (r.reason ?? "").slice(0, 400));
    check("…and the sidecar is untouched", readFileSync(sidecar, "utf8") === untouched);
    console.log(`  control 2's refusal: ${(r.reason ?? "").slice(0, 460)}`);
  }

  // ---- 3. a declaration under which the engine asks for LESS ---------------
  {
    const cassette = join(box, "fewer.jsonl");
    const sidecar = join(box, "fewer.precondition.json");
    copyFileSync(CASSETTE, cassette);
    copyFileSync(SIDECAR, sidecar);
    const untouched = readFileSync(sidecar, "utf8");
    // Nothing seeded at all: the session the scenario resumes does not exist, so
    // the engine has nothing to send and the cassette's entries go unrequested.
    const r = await quietly("control 3 (the resumed session is not there)", () => resealScenario({ scenario, declared: {}, cassette, sidecar }));
    check("a declaration under which the engine makes FEWER requests is REFUSED", !r.resealed, JSON.stringify(r.written ?? {}).slice(0, 120));
    check("…for its OWN reason: entries nothing asked for, named by seq", /never requested under this declaration \(seq [\d, ]+\)/.test(r.reason ?? ""), r.reason ?? "");
    check("…and the sidecar is untouched", readFileSync(sidecar, "utf8") === untouched);
    console.log(`  control 3's refusal: ${(r.reason ?? "").slice(0, 460)}`);
  }

  console.log(`  three replays in ${Math.round((Date.now() - started) / 1000)} s`);
} finally {
  rmSync(box, { recursive: true, force: true });
}

console.log(`=== precondition re-seal: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "PASS — an unreachable change re-seals; a change the model can see is refused by name" : `FAIL — ${failures.length} control(s) failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
