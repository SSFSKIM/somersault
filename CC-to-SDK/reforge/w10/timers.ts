// C13c / W10c, capability 2 — TIMER CONTROL for the six shell deadlines.
//
// ## The problem, in wall-clock seconds
//
// The executor's behaviour is gated on six deadlines (scout §5.2). Reaching the
// background hint costs 2 s of real time per scenario; reaching the stall
// detector costs 50 s; the SIGTERM->SIGKILL escalation cannot be reached at all
// without a child that ignores signals AND 1.5 s of patience. A corpus that
// pays those costs per replay is a corpus nobody runs, and a matrix graded by
// whether the machine happened to be fast enough that minute is a flaky one.
//
// ## Why a build-time constant rewrite and never an environment variable
//
// The obvious alternative is an env knob. It is not available: none of these
// six is read from the environment at this pin — they are `var NAME=<number>`
// declarators compiled into the graph — so "add a knob" would mean patching the
// engine to read one, which is the same edit as this one plus a fiction about
// where it came from. And the ORACLE is a compiled Mach-O binary: an env var
// the real binary cannot honour would silently apply to one side of a
// differential and not the other, which is worse than not having it.
//
// So the rewrite is declared honestly for what it is: the graph engines
// (`engine-extracted`, `engine-strangled`) are OURS to rewrite, the real binary
// is not, and a scenario states which engine set it runs on and why. The
// grading pair for a rewritten scenario is the identical-code pair
// extracted-vs-strangled, on which any difference is a harness defect — the
// same standing the corpus gives every other scenario, with the oracle's role
// played by the un-spliced graph.
//
// ## The derivation, and its check
//
// Nothing here is found by NAME. `kzt`, `qKt`, `plr`, `mlr`, `WKt`, `zKt` and
// `$Kt` are minified bindings that churn per pin exactly as every other one in
// this bundle does (`hui` -> `q6t` inside a single bump). Each deadline is
// located by the SHAPE OF ITS USE — the `setTimeout`/`setInterval` call or the
// `Date.now()` comparison that makes it a deadline rather than a number — and
// the binding name falls out of that match. The use-site pattern must match
// EXACTLY ONCE in the chunk and the resulting binding must have EXACTLY ONE
// numeric definition, or the derivation throws rather than rewriting a number
// it guessed at. That is a splice's `derive` contract, one layer down: the
// manifest declares the shape, the artifact supplies the name.
//
// The rewrite then re-reads the bytes at the definition it derived and refuses
// unless they are literally `<binding>=<pinned value>`. A rewrite that wrote a
// new value over something it had not confirmed would be a silent edit to an
// engine under test.
//
// ## Six deadlines, SEVEN constants
//
// The scout's list reads as six because the stall detector is one deadline made
// of two numbers — a poll interval and an idle threshold — and moving either
// one alone does not move the deadline. They are separate roles here (the
// rewrite has to name each) and one `deadline` group, so a reader of the
// fixture cannot mistake seven roles for seven independent behaviours.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";

/** One deadline's role — what moving it changes. */
export type DeadlineRole =
  | "background-hint"
  | "progress-cadence"
  | "output-file-watchdog"
  | "stall-poll"
  | "stall-idle"
  | "sigterm-to-sigkill"
  | "post-kill-liveness-poll";

export interface DeadlineSpec {
  role: DeadlineRole;
  /** the DEADLINE this constant belongs to — two roles share `stall-detector` */
  deadline: string;
  /** what the engine does when it expires, in one sentence */
  effect: string;
  /**
   * The use site, as a regular expression over the owning chunk. Group 1 is the
   * binding. Every metacharacter that could match a minified identifier is
   * written as `[\w$]+` on purpose: the SHAPE survives a pin, the names do not.
   */
  use: RegExp;
  /**
   * A second use site, when the constant has one — corroboration, never
   * derivation: it must resolve to the SAME binding or the derivation throws.
   */
  corroborate?: RegExp;
}

/**
 * The six deadlines. Each `use` was verified to match exactly once in the
 * owning chunk at 2.1.251; `research/tools/extract-shell-timers.ts --check`
 * is what keeps that true across a pin.
 */
export const DEADLINES: DeadlineSpec[] = [
  {
    role: "background-hint",
    deadline: "background-hint",
    effect:
      "the elapsed-seconds gate after which the executor arms auto-backgrounding and yields " +
      "`{kind:\"background_hint\", toolUseId}` on the progress channel",
    // `…>=<binding>/1000){` — the elapsed-SECONDS comparison against a
    // millisecond constant, which is what makes the `/1000` part of the shape.
    use: />=([A-Za-z_$][\w$]*)\/1000\)\{/g,
    // …and the same constant as the timeout of the `Promise.race` that decides
    // whether the command finished before the gate at all.
    corroborate: /setTimeout\(\([\w$]+\)=>[\w$]+\(null\),([A-Za-z_$][\w$]*),[\w$]+\)\.unref\(\)/g,
  },
  {
    role: "progress-cadence",
    deadline: "progress-cadence",
    effect: "the interval on which the shared poller calls `pollProgress()` on every registered output handle",
    use: /setInterval\(\(\)=>this\.#[\w$]+\(\),([A-Za-z_$][\w$]*)\)/g,
  },
  {
    role: "output-file-watchdog",
    deadline: "output-file-watchdog",
    effect: "the interval on which a backgrounded command re-verifies its output file, killing the shell when it was replaced or removed",
    use: /\},([A-Za-z_$][\w$]*)\),this\.#[\w$]+\.unref\(\)\}/g,
  },
  {
    role: "stall-poll",
    deadline: "stall-detector",
    effect: "how often the stall detector samples the output file's size",
    use: /\},([A-Za-z_$][\w$]*)\);return [\w$]+\.unref\(\)/g,
  },
  {
    role: "stall-idle",
    deadline: "stall-detector",
    effect:
      "how long the output must be unchanged before a last line matching the interactive-prompt patterns " +
      "raises `task_local_shell_stall_detected` and a task notification",
    use: /if\(Date\.now\(\)-[\w$]+<([A-Za-z_$][\w$]*)\)return;/g,
  },
  {
    role: "sigterm-to-sigkill",
    deadline: "kill-escalation",
    effect: "how long after SIGTERM the executor escalates to a process-group SIGKILL",
    use: /process\.kill\(-[\w$]+,"SIGKILL"\)\}catch\{\}[\w$]+\([\w$]+,"SIGKILL"\)\.finally\([\w$]+\)\},([A-Za-z_$][\w$]*)\)/g,
  },
  {
    role: "post-kill-liveness-poll",
    deadline: "kill-escalation",
    effect: "how often the executor re-checks whether the SIGTERMed process is gone, so it can cancel the SIGKILL backstop",
    use: /=setInterval\(\(\)=>\{if\(![\w$]+\([\w$]+\)\)return;clearTimeout\([\w$]+\),clearInterval\([\w$]+\),[\w$]+\(\)\},([A-Za-z_$][\w$]*)\)/g,
  },
];

export interface LocatedDeadline {
  role: DeadlineRole;
  deadline: string;
  effect: string;
  /** the minified binding, DERIVED from the use site and never written down */
  binding: string;
  /** its value at this pin */
  value: number;
  /** byte offset of the value's first digit in the owning chunk */
  valueOffset: number;
  /** byte offset of the binding at each use site, in order */
  useOffsets: number[];
}

/** The chunk that owns all seven constants, located by the conjunction of the roles themselves. */
export interface TimerLocation {
  chunk: string;
  deadlines: LocatedDeadline[];
}

const findOnce = (src: string, re: RegExp, what: string): RegExpMatchArray => {
  const all = [...src.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
  if (all.length !== 1) throw new Error(`shell timers: ${what} matched ${all.length} time(s), expected exactly 1 — the shape moved at this pin`);
  return all[0];
};

/**
 * Derive every deadline out of one chunk's source.
 *
 * Exported so the fixture tool and the rewrite share ONE locator: two copies
 * would let the committed population and the bytes actually edited drift apart,
 * and the direction they drift in is a rewrite nobody checked.
 */
export function locateShellTimers(src: string): LocatedDeadline[] {
  return DEADLINES.map((d) => {
    const m = findOnce(src, d.use, `${d.role}'s use site`);
    const binding = m[1];
    const useOffsets = [m.index! + m[0].lastIndexOf(binding)];
    if (d.corroborate !== undefined) {
      const c = findOnce(src, d.corroborate, `${d.role}'s corroborating use site`);
      if (c[1] !== binding) {
        throw new Error(`shell timers: ${d.role}'s two use sites resolve to different bindings (${binding} vs ${c[1]}) — one of the shapes now matches something else`);
      }
      useOffsets.push(c.index! + c[0].lastIndexOf(binding));
    }
    // The DEFINITION, by the binding the use site supplied. `(?<![\w$])` and
    // `(?![\w$.])` keep `qKt=5000` from also matching `XqKt=…` or a property
    // read; exactly one match is the assertion that the binding is a
    // module-level constant rather than something reassigned.
    const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const def = findOnce(src, new RegExp(`(?<![\\w$])${escaped}=(\\d+)(?![\\w$.])`, "g"), `${d.role}'s definition of ${binding}`);
    return {
      role: d.role,
      deadline: d.deadline,
      effect: d.effect,
      binding,
      value: Number(def[1]),
      valueOffset: def.index! + def[0].length - def[1].length,
      useOffsets,
    };
  });
}

/**
 * Which chunk owns them — found by the conjunction of all seven shapes rather
 * than by a name, for the reason the header gives. A chunk that carries some of
 * them and not others is not the owner and is skipped silently; a graph where
 * NO chunk carries all seven is a pin event and throws.
 */
export function locateTimerChunk(modulesDir: string = BUNDLE_MODULES): TimerLocation {
  const found: TimerLocation[] = [];
  for (const name of readdirSync(modulesDir)) {
    if (!name.endsWith(".js")) continue;
    const src = readFileSync(join(modulesDir, name), "utf8");
    // A cheap prefilter, so 1,800 files are not each run through seven regexes.
    if (!src.includes('"SIGKILL"') || !src.includes("pollProgress")) continue;
    try {
      found.push({ chunk: name, deadlines: locateShellTimers(src) });
    } catch {
      // Carries some of the shapes and not all of them: not the owner.
    }
  }
  if (found.length !== 1) {
    throw new Error(`shell timers: ${found.length} chunk(s) carry all six deadlines (${found.map((f) => f.chunk).join(", ") || "none"}) — expected exactly 1`);
  }
  return found[0];
}

// ---- the stall detector's OTHER input: what counts as an interactive prompt --
//
// The idle threshold alone does not fire the stall detector. `_lr` takes the
// LAST non-empty line of the accumulated output and tests it against a list of
// regexes; only a line that matches raises `task_local_shell_stall_detected`.
// So the scripted child's `--prompt-tail` is a bet on that list, and a bet on
// an upstream population is exactly the thing this campaign derives rather than
// writes down — six populations have been wrong when someone counted them by
// reading. The list is located by the shape of its ONE consumer (unique across
// all 1,800 module files) and committed with the deadlines.

/** The consumer's shape: `…trimEnd().split(`\n`).pop() ?? ""; return <binding>.some((r) => r.test(t))}`. */
const PROMPT_CONSUMER = /\.trimEnd\(\)\.split\([\s\S]{1,8}\)\.pop\(\)\?\?"";return ([A-Za-z_$][\w$]*)\.some\(\([\w$]+\)=>[\w$]+\.test\([\w$]+\)\)\}/g;

export interface PromptPatterns {
  binding: string;
  /** each regex literal exactly as the bundle writes it */
  patterns: string[];
}

/** The interactive-prompt patterns the stall detector recognises, derived from their consumer. */
export function locatePromptPatterns(src: string): PromptPatterns {
  const consumer = findOnce(src, PROMPT_CONSUMER, "the interactive-prompt matcher");
  const binding = consumer[1];
  const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const def = findOnce(src, new RegExp(`(?<![\\w$])${escaped}=\\[`, "g"), `the definition of ${binding}`);
  const start = def.index! + def[0].length;
  const end = src.indexOf("];", start);
  if (end < 0) throw new Error(`shell timers: ${binding}'s array literal is unterminated`);
  // Split on the commas BETWEEN regex literals: each element is `/…/flags`, and
  // a comma inside a character class or a group is not preceded by a flag run
  // and a slash. Splitting on `/i,/` style boundaries is what the shape gives.
  const body = src.slice(start, end);
  const patterns = body.split(/(?<=\/[a-z]*),(?=\/)/).map((p) => p.trim());
  if (patterns.length === 0 || !patterns.every((p) => p.startsWith("/"))) {
    throw new Error(`shell timers: ${binding} is not a list of regex literals — got ${JSON.stringify(body.slice(0, 120))}`);
  }
  return { binding, patterns };
}

/** Does this line match at least one of the derived patterns? The child's `--prompt-tail` bet, checkable. */
export function matchesPromptPatterns(line: string, patterns: readonly string[]): string[] {
  const trimmed = line.trimEnd();
  return patterns.filter((p) => {
    const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(p);
    return m !== null && new RegExp(m[1], m[2]).test(trimmed);
  });
}

// ---- the rewrite ------------------------------------------------------------

/** What a scenario declares: a new value, in milliseconds, per role. */
export type TimerProfile = Partial<Record<DeadlineRole, number>>;

export interface TimerRewrite {
  role: DeadlineRole;
  binding: string;
  from: number;
  to: number;
}

/**
 * Apply a profile to one chunk's source.
 *
 * THE CHECK, and it is the whole reason this is a derivation rather than a
 * `sed`: before writing, the bytes at the derived offset must be literally
 * `<binding>=<pinned value>`. A rewrite that wrote over something it had not
 * confirmed would be a silent edit to an engine under test — which is the exact
 * failure mode a differential harness cannot detect, because BOTH sides would
 * carry it.
 *
 * Edits are applied back to front so each offset is still the one the
 * derivation reported when its turn comes.
 */
export function rewriteShellTimers(src: string, profile: TimerProfile): { source: string; applied: TimerRewrite[] } {
  const located = locateShellTimers(src);
  const applied: TimerRewrite[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  for (const [role, to] of Object.entries(profile) as [DeadlineRole, number][]) {
    const d = located.find((x) => x.role === role);
    if (d === undefined) throw new Error(`shell timers: no deadline named '${role}'`);
    if (!Number.isInteger(to) || to < 0) throw new Error(`shell timers: ${role} must be rewritten to a non-negative integer, got ${to}`);
    const digits = String(d.value);
    const at = src.slice(d.valueOffset - d.binding.length - 1, d.valueOffset + digits.length);
    if (at !== `${d.binding}=${digits}`) {
      throw new Error(`shell timers: refusing to rewrite ${role} — expected \`${d.binding}=${digits}\` at ${d.valueOffset}, found ${JSON.stringify(at)}`);
    }
    edits.push({ start: d.valueOffset, end: d.valueOffset + digits.length, text: String(to) });
    applied.push({ role, binding: d.binding, from: d.value, to });
  }
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { source: out, applied };
}

/** A profile's identity — what a build directory is keyed on, so two profiles never share one. */
export const profileKey = (profile: TimerProfile, salt: string): string =>
  createHash("sha256")
    .update(JSON.stringify(Object.entries(profile).sort()) + "\0" + salt + "\0" + ENGINE_VERSION)
    .digest("hex")
    .slice(0, 12);

/** A profile as one line, for a log and for a scenario's stated reason. */
export const describeProfile = (profile: TimerProfile): string =>
  (Object.entries(profile) as [DeadlineRole, number][]).map(([r, v]) => `${r}=${v}ms`).join(", ") || "<none>";
