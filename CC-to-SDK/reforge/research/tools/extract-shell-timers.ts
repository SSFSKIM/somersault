// §3.3 — snapshot the SIX SHELL DEADLINES from the pinned bundle.
//
//   npx tsx research/tools/extract-shell-timers.ts [--check]
//
// WHY A FIXTURE. C13c's second capability rewrites seven compiled-in constants
// in a graph engine so that a corpus scenario can reach the background hint, the
// stall detector and the SIGTERM->SIGKILL escalation without paying 2 s, 50 s
// and 1.5 s of wall clock per replay. A rewrite is only as trustworthy as the
// derivation that found what to rewrite, and every population this campaign has
// carried as a hand-written number has been wrong at least once — the hook
// events, the control-protocol arms, the prompt sections, the helper belt, the
// moat-tool belt, the shutdown latch's importers, the parser's declaration
// count. So the deadlines are derived from the artifact, committed under the
// pin, and `--check` fails when they move.
//
// EXACT, NOT A FLOOR, in every field. The bundle is pinned; a constant changing
// value, a binding being renamed, a use site moving or a second chunk starting
// to carry the same shapes are all pin events that have to be read rather than
// absorbed. The one place a floor would be defensible — "at least six
// deadlines" — is the one place it would be useless, because the rewrite needs
// each individual number.
//
// NOTHING IS FOUND BY NAME. `kzt`, `$Kt`, `qKt`, `plr`, `mlr`, `WKt` and `zKt`
// are minified bindings that churn per pin exactly as the parser's did
// (`hui` -> `q6t` inside one bump), and the chunk's file name is
// content-addressed. Each deadline is located by the SHAPE OF ITS USE — the
// `setTimeout`/`setInterval` call or the `Date.now()` comparison that makes it
// a deadline rather than a number — and the binding falls out of the match.
// The chunk is located by the conjunction of all seven shapes.
//
// THE PROMPT PATTERNS RIDE ALONG, and they are not a deadline. The stall
// detector needs BOTH an expired idle threshold and a last output line that
// looks like an interactive prompt; the scripted child's `--prompt-tail` is a
// bet on the second half. Deriving the list from its one consumer turns that
// bet into something `--check` defends — and a pin that retired the pattern the
// child emits would otherwise leave a scenario that runs, produces output, and
// grades an arm that never fired.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";
import { DEADLINES, locatePromptPatterns, locateTimerChunk, matchesPromptPatterns } from "../../w10/timers.js";
import { PROMPT_TAIL } from "../../w10/child.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `shell-timers-${version}.json`);

export interface ShellTimersFixture {
  engineVersion: string;
  chunk: { name: string; bytes: number };
  /** how many DEADLINES the seven constants make up — the stall detector is two of them */
  deadlineGroups: string[];
  deadlines: {
    role: string;
    deadline: string;
    binding: string;
    value: number;
    valueOffset: number;
    useOffsets: number[];
    effect: string;
  }[];
  promptPatterns: {
    binding: string;
    patterns: string[];
    /** the line `w10/child.ts` emits for `--prompt-tail`, and which of the patterns it satisfies */
    childTail: string;
    childTailMatches: string[];
  };
}

export function extractShellTimers(modulesDir: string = BUNDLE_MODULES): ShellTimersFixture {
  const located = locateTimerChunk(modulesDir);
  const path = join(modulesDir, located.chunk);
  const src = readFileSync(path, "utf8");
  const prompts = locatePromptPatterns(src);
  const childTailMatches = matchesPromptPatterns(PROMPT_TAIL, prompts.patterns);
  if (childTailMatches.length < 2) {
    // Two, not one: the child's tail is written to satisfy two patterns
    // independently so that a pin retiring either one still fires the arm. One
    // match is a warning that the redundancy is gone; zero is a scenario that
    // grades nothing.
    throw new Error(
      `shell timers: the scripted child's --prompt-tail ${JSON.stringify(PROMPT_TAIL)} matches ${childTailMatches.length} of ` +
        `${prompts.patterns.length} interactive-prompt pattern(s) at this pin — it is written to match two. Update w10/child.ts's PROMPT_TAIL.`,
    );
  }
  return {
    engineVersion: ENGINE_VERSION,
    chunk: { name: located.chunk, bytes: statSync(path).size },
    deadlineGroups: [...new Set(DEADLINES.map((d) => d.deadline))],
    deadlines: located.deadlines.map((d) => ({
      role: d.role,
      deadline: d.deadline,
      binding: d.binding,
      value: d.value,
      valueOffset: d.valueOffset,
      useOffsets: d.useOffsets,
      effect: d.effect,
    })),
    promptPatterns: { binding: prompts.binding, patterns: prompts.patterns, childTail: PROMPT_TAIL, childTailMatches },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extractShellTimers();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(`  chunk: ${fx.chunk.name} ${fx.chunk.bytes.toLocaleString()} B — the one chunk carrying all seven shapes`);
  console.log(`  ${fx.deadlineGroups.length} deadline(s) over ${fx.deadlines.length} constant(s): ${fx.deadlineGroups.join(", ")}`);
  for (const d of fx.deadlines) {
    console.log(`    ${d.role.padEnd(24)} ${d.binding.padEnd(5)} = ${String(d.value).padStart(6)} ms  @${d.valueOffset}  used at ${d.useOffsets.join(", ")}  [${d.deadline}]`);
  }
  console.log(`  interactive-prompt patterns: ${fx.promptPatterns.binding} carries ${fx.promptPatterns.patterns.length}`);
  console.log(`    the child's tail ${JSON.stringify(fx.promptPatterns.childTail)} satisfies ${fx.promptPatterns.childTailMatches.length}: ${fx.promptPatterns.childTailMatches.join(" ")}`);

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-shell-timers.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
