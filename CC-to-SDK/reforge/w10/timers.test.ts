// C13c / W10c — controls for the shell-deadline derivation and its rewrite.
//
//   npx tsx w10/timers.test.ts
//
// The rewrite edits an engine that is then graded. That is the one class of
// change a differential harness cannot catch by itself: a wrong edit applies to
// BOTH sides of the comparison, so both sides agree and the measurement is of
// something nobody named. Every check below is therefore about a REFUSAL — the
// derivation declining to guess, and the rewrite declining to write over bytes
// it has not confirmed — because the passing direction is the one that has an
// oracle (the graph boots and the values read back) and the refusing direction
// is the one that does not.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES } from "../src/pin.js";
import { PROMPT_TAIL } from "./child.js";
import { DEADLINES, locatePromptPatterns, locateShellTimers, locateTimerChunk, matchesPromptPatterns, profileKey, rewriteShellTimers } from "./timers.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
const throws = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const located = locateTimerChunk();
const SRC = readFileSync(join(BUNDLE_MODULES, located.chunk), "utf8");

// ---- the derivation finds what it claims, and only there --------------------
check("exactly one chunk in the graph carries all seven shapes", located.deadlines.length === DEADLINES.length, `${located.deadlines.length} deadline(s)`);
check("every deadline resolves to a binding and a numeric value",
  located.deadlines.every((d) => /^[A-Za-z_$][\w$]*$/.test(d.binding) && Number.isInteger(d.value) && d.value >= 0),
  JSON.stringify(located.deadlines.map((d) => `${d.role}=${d.binding}:${d.value}`)));
check("…and each value offset points at the digits the derivation reported",
  located.deadlines.every((d) => SRC.slice(d.valueOffset, d.valueOffset + String(d.value).length) === String(d.value)));
check("…and each binding's definition is preceded by that binding",
  located.deadlines.every((d) => SRC.slice(d.valueOffset - d.binding.length - 1, d.valueOffset) === `${d.binding}=`));
check("the seven constants make five deadlines (a poll and its threshold are one)",
  new Set(located.deadlines.map((d) => d.deadline)).size === 5,
  [...new Set(located.deadlines.map((d) => d.deadline))].join(", "));
check("no two roles resolve to the same binding", new Set(located.deadlines.map((d) => d.binding)).size === DEADLINES.length);

// ---- the derivation REFUSES rather than guessing ----------------------------
{
  // A shape that no longer matches: the derivation must say so, not fall back
  // to a name it happens to remember.
  const d = located.deadlines.find((x) => x.role === "sigterm-to-sigkill")!;
  const broken = SRC.replace('process.kill(-', "process.kill(+");
  const why = throws(() => locateShellTimers(broken));
  check("a moved use site is a refusal, not a fallback", why !== null && /matched 0 time/.test(why), String(why).slice(0, 140));
  check("…and the refusal names the role whose shape moved", why !== null && why.includes("sigterm-to-sigkill"), String(why).slice(0, 140));
  void d;
}
{
  // A second definition of the same binding — what a pin that split a constant
  // into two builds would look like. A derivation that took the first would
  // rewrite one of two live values.
  const d = located.deadlines.find((x) => x.role === "progress-cadence")!;
  const doubled = `var ${d.binding}=${d.value};` + SRC;
  const why = throws(() => locateShellTimers(doubled));
  check("a second definition of the same binding is a refusal", why !== null && /matched 2 time/.test(why), String(why).slice(0, 140));
}
{
  // The corroborating use site of the background hint must resolve to the SAME
  // binding. Point one of the two at something else and the derivation refuses
  // rather than trusting whichever it matched first.
  const d = located.deadlines.find((x) => x.role === "background-hint")!;
  const at = d.useOffsets[1];
  const split = SRC.slice(0, at) + "zZq".padEnd(d.binding.length, "_") + SRC.slice(at + d.binding.length);
  const why = throws(() => locateShellTimers(split));
  check("two use sites that disagree about the binding are a refusal",
    why !== null && (/different bindings/.test(why) || /matched 0 time/.test(why)), String(why).slice(0, 160));
}

// ---- the rewrite ------------------------------------------------------------
{
  const profile = { "stall-idle": 1_200, "background-hint": 300, "sigterm-to-sigkill": 200 } as const;
  const { source, applied } = rewriteShellTimers(SRC, profile);
  check("the rewrite reports every role it applied", applied.length === 3, JSON.stringify(applied.map((a) => a.role)));
  check("…each with the value it replaced", applied.every((a) => a.from === located.deadlines.find((d) => d.role === a.role)!.value));
  const after = locateShellTimers(source);
  check("…and reading the rewritten source back reports the new values",
    after.find((d) => d.role === "stall-idle")!.value === 1_200 &&
      after.find((d) => d.role === "background-hint")!.value === 300 &&
      after.find((d) => d.role === "sigterm-to-sigkill")!.value === 200,
    after.map((d) => `${d.role}=${d.value}`).join(" "));
  check("…while every deadline NOT in the profile is untouched",
    after.filter((d) => !(d.role in profile)).every((d) => d.value === located.deadlines.find((x) => x.role === d.role)!.value),
    after.filter((d) => !(d.role in profile)).map((d) => `${d.role}=${d.value}`).join(" "));
  // The blast radius, measured rather than assumed: three numbers each one
  // digit shorter — 45000->1200, 2000->300, 1500->200 — so exactly three bytes
  // leave the chunk and nothing else moves.
  check("…and the edit is exactly the digits, nothing else", SRC.length - source.length === 3, `${SRC.length - source.length} byte(s) removed`);
  check("…so the two sources differ only inside the three declarators",
    (() => {
      let first = 0;
      while (first < source.length && SRC[first] === source[first]) first++;
      // the earliest edit is `sigterm-to-sigkill`'s, at its own value offset
      const earliest = Math.min(...applied.map((a) => located.deadlines.find((d) => d.role === a.role)!.valueOffset));
      return first === earliest;
    })());
}
{
  // The rewrite's own check: bytes that are not what the derivation reported.
  // Constructed by moving the value under the derivation's feet, which is what
  // a stale offset would look like.
  const d = located.deadlines.find((x) => x.role === "output-file-watchdog")!;
  const shifted = SRC.slice(0, d.valueOffset - d.binding.length - 1) + "x".repeat(d.binding.length + 1) + SRC.slice(d.valueOffset - 1);
  const why = throws(() => rewriteShellTimers(shifted, { "output-file-watchdog": 50 }));
  check("the rewrite refuses when the bytes are not the declarator it derived", why !== null, String(why).slice(0, 160));
}
check("a profile naming an unknown role is a refusal",
  throws(() => rewriteShellTimers(SRC, { "not-a-deadline": 5 } as never)) !== null);
check("a profile with a negative or fractional value is a refusal",
  throws(() => rewriteShellTimers(SRC, { "stall-idle": -1 })) !== null && throws(() => rewriteShellTimers(SRC, { "stall-idle": 1.5 })) !== null);

// ---- the profile key separates profiles -------------------------------------
check("two profiles never share a build directory",
  profileKey({ "stall-idle": 1 }, "x") !== profileKey({ "stall-idle": 2 }, "x"));
check("…and neither do two bases, or two base builds of the same profile",
  profileKey({ "stall-idle": 1 }, "a") !== profileKey({ "stall-idle": 1 }, "b"));
check("…while the same profile written in a different key order is the same build",
  profileKey({ "stall-idle": 1, "stall-poll": 2 }, "x") === profileKey({ "stall-poll": 2, "stall-idle": 1 }, "x"));

// ---- the stall detector's other input ---------------------------------------
{
  const p = locatePromptPatterns(SRC);
  check("the interactive-prompt patterns derive from their one consumer", p.patterns.length === 7, `${p.patterns.length} pattern(s): ${p.patterns.join(" ")}`);
  check("…each of them a regex literal", p.patterns.every((x) => /^\/[\s\S]*\/[a-z]*$/.test(x)), p.patterns.join(" "));
  const hits = matchesPromptPatterns(PROMPT_TAIL, p.patterns);
  check("…and the scripted child's --prompt-tail satisfies TWO of them, so retiring either still fires the arm",
    hits.length >= 2, `${hits.length}: ${hits.join(" ")}`);
  check("…while a line the detector would ignore matches none",
    matchesPromptPatterns("R0:.........", p.patterns).length === 0);
  check("…and the match is against the line's TRIMMED end, as `_lr` reads it",
    matchesPromptPatterns("Are you sure you want to proceed?   ", p.patterns).length > 0);
}

console.log(`=== shell deadlines: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "PASS — every deadline is derived by shape, and every wrong input is a refusal rather than a guess" : `FAIL — ${failures.length} control(s) failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
