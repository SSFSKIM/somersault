// help.ts — the three printed CLI surfaces (`--version`, `--help`, `doctor`) and the unknown-option
// error shape, all pure strings so a test can pin them without spawning ccx. Upstream is commander,
// used stock (annex §C3.1-C3.4); this file reproduces its OUTPUT rather than taking the dependency —
// commander would be a runtime dep for four printed shapes, and the grammar already lives in args.ts.
// ccx's own identity everywhere (`(cc-harness)`, `Usage: ccx …`): shape fidelity, not impersonation (D-C9).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// Same reader (and same relative path) as appserver/server.ts: `src/cli/` and `dist/cli/` are both one
// level under the package root, so this resolves in a source run and in the built binary alike.
const pkg = require("../../package.json") as { version: string };

/** `0.1.0 (cc-harness)` — upstream's `${VERSION} (Claude Code)` with our name. One line, no commit:
 *  ccx has no inlined build SHA to print (upstream's is a Bun build constant). */
export function versionLine(): string { return `${pkg.version} (cc-harness)`; }

// ---------------------------------------------------------------------------------------------
// Unknown option — commander's `unknownOption` (L392704) + `suggestSimilar` (L391980), verbatim rules.

const MAX_DISTANCE = 3;

/** Damerau-Levenshtein with commander's own length short-circuit — a pair further apart in LENGTH than
 *  the best distance we would ever accept cannot win, so it is reported as maximally distant instead of
 *  being measured. Inline rather than a dependency: it is fifteen lines. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return Math.max(a.length, b.length);
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      // The transposition arm: `--mdoel` is one swap from `--model`, not two substitutions.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The `(Did you mean …?)` tail, or `""`. Two rules that the tests pin because getting either wrong is
 *  invisible until a user typos: only `--`-prefixed words are ever compared (a bare `-z` gets nothing),
 *  and the similarity gate is STRICT — `(maxLen − distance) / maxLen > 0.4`, so exactly 0.4 is silence. */
export function suggestSimilar(word: string, candidates: string[]): string {
  if (candidates.length === 0) return "";
  const searchingOptions = word.startsWith("--");
  const w = searchingOptions ? word.slice(2) : word;
  const pool = Array.from(new Set(candidates)).map((c) => (searchingOptions ? c.replace(/^--/, "") : c));
  let similar: string[] = [];
  let best = MAX_DISTANCE;
  for (const candidate of pool) {
    if (candidate.length <= 1) continue;
    const distance = editDistance(w, candidate);
    const length = Math.max(w.length, candidate.length);
    if ((length - distance) / length <= 0.4) continue;
    // Only the CLOSEST candidates are offered — a second flag that merely clears the gate is noise.
    if (distance < best) { best = distance; similar = [candidate]; }
    else if (distance === best) similar.push(candidate);
  }
  similar.sort((a, b) => a.localeCompare(b));
  const out = searchingOptions ? similar.map((c) => `--${c}`) : similar;
  if (out.length > 1) return `\n(Did you mean one of ${out.join(", ")}?)`;
  if (out.length === 1) return `\n(Did you mean ${out[0]}?)`;
  return "";
}

/** `error: unknown option '--x'` [+ the suggestion line]. No `ccx: ` prefix and NO usage block —
 *  commander's `error()` writes exactly this to stderr and exits 1 (L392647), and main.ts reproduces
 *  both halves. Deliberately unlike every other ccx refusal, which wears the `ccx: ` prefix. */
export function unknownOptionMessage(token: string, candidates: string[] = longFlags()): string {
  const suggestion = token.startsWith("--") ? suggestSimilar(token, candidates) : "";
  return `error: unknown option '${token}'${suggestion}`;
}

// ---------------------------------------------------------------------------------------------
// The help page — commander's custom `formatHelp` (`YW_`, L392983) with its layout constants (L392997).

// `Hhn = 2`, `bhn = 2`, `zW_ = 36`, `Egp = 4` (the hanging indent of the overflow arm). HELP_WIDTH is a
// DELIBERATE DIVERGENCE: upstream reads `t.helpWidth || 80`, which commander fills from the terminal's
// column count when stdout is a TTY, so a wide terminal gets a wide help page. ccx pins 80 so the page is
// one fixed artifact — reproducible in a pipe, a CI log and a test alike, where a width-sensitive page
// would render differently in each. (`KW_ = 30`, commander's minimum description width, has no constant
// here: with the pad capped at 36 the remaining width is never below 76 − 36 = 40, so its arm is dead.)
const INDENT = 2, GAP = 2, HANG = 4, MAX_TERM_PAD = 36, HELP_WIDTH = 80;

export interface CcxOption {
  /** Long spellings, in the order they print. `--bg, --background` is one option with two longs. */
  longs: string[];
  short?: string;
  /** The value placeholder, when the flag takes one — also what the drift-guard test feeds parseCcx. */
  value?: string;
  description: string;
}

/** THE option registry: what `--help` prints and what a typo is compared against. Kept here rather than
 *  in args.ts because both consumers are printers; `test/unit/cli-surface.test.ts` guards the drift by
 *  feeding every long flag here back through parseCcx. */
export const CCX_OPTIONS: CcxOption[] = [
  { longs: ["--advisor-model"], value: "<model>", description: "Model id for the advisor consult (off by default)" },
  { longs: ["--all"], description: "Include sessions from every project" },
  { longs: ["--allow-origin"], value: "<origin>", description: "Allow a browser origin to reach serve (repeatable)" },
  { longs: ["--bg", "--background"], description: "Run the session detached in the background" },
  { longs: ["--continue"], short: "-c", description: "Continue the most recent conversation in the current directory" },
  { longs: ["--cwd"], value: "<dir>", description: "Working directory (filters the listing for agents)" },
  { longs: ["--dangerously-skip-permissions"], description: "Bypass all permission checks" },
  { longs: ["--detachable"], description: "Attach to a session that survives this terminal" },
  // Value domains are spelled with spaces, not `a|b|c`: the wrapper breaks on spaces (as commander's
  // does), and an unbreakable 55-character run would push its row past the 80-column help width.
  { longs: ["--effort"], value: "<level>", description: "Reasoning effort: low, medium, high, xhigh, max" },
  { longs: ["--emit-schema"], value: "<dir>", description: "Write serve's JSON-Schema artifacts to a directory and exit" },
  { longs: ["--help"], short: "-h", description: "Display help for command" },
  { longs: ["--idle-timeout"], value: "<seconds>", description: "Stop a detachable session after this much idle time" },
  { longs: ["--json"], description: "Machine-readable output" },
  { longs: ["--listen"], value: "<url>", description: "ws:// address for serve (default: loopback, ephemeral port)" },
  { longs: ["--model"], value: "<model>", description: "Model id or alias for this session" },
  { longs: ["--name"], short: "-n", value: "<name>", description: "Set a display name for this session" },
  { longs: ["--print"], short: "-p", description: "Print the response and exit (non-interactive)" },
  { longs: ["--permission-mode"], value: "<mode>", description: "One of default, acceptEdits, bypassPermissions, plan, dontAsk, auto" },
  { longs: ["--resume"], short: "-r", value: "<value>", description: "Resume a conversation by session id" },
  { longs: ["--settings"], value: "<file-or-json>", description: "Settings as inline JSON or a path to a JSON file" },
  { longs: ["--think"], value: "<level>", description: "Thinking budget: off, low, medium, high, xhigh, max, or a token count" },
  { longs: ["--token-file"], value: "<path>", description: "Bearer token file authorizing serve clients" },
  { longs: ["--version"], short: "-v", description: "Output the version number" },
  { longs: ["--worktree"], value: "<name>", description: "Create a git worktree for this session" },
];

/** The subcommand registry (args.ts:81-83), including `doctor`. Rendered alphabetically, as upstream's
 *  `sortSubcommands: !0` does. */
const CCX_COMMANDS: { term: string; description: string }[] = [
  { term: "agents", description: "List the background agents of this project" },
  { term: "attach <session>", description: "Attach to a running session by short id, uuid or name" },
  { term: "doctor", description: "Check the health of your ccx installation" },
  { term: "fleet gc", description: "Remove dead sessions from the fleet roster" },
  { term: "rm <session>", description: "Remove a session, its transcript row and its worktree" },
  { term: "serve", description: "Run the app-server control plane over a WebSocket" },
  { term: "stop <session>", description: "Stop a running session" },
];

/** The positional registry. Upstream declares `.argument("[prompt]", "Your prompt", String)` and
 *  `argumentTerm` (L391720) renders `e.name()` — the bare name, brackets stripped — so the row reads
 *  `prompt  Your prompt`, exactly as real `claude --help` prints it. */
const CCX_ARGUMENTS: { term: string; description: string }[] = [
  { term: "prompt", description: "Your prompt" },
];

function longFlags(): string[] { return CCX_OPTIONS.flatMap((o) => o.longs); }
function optionTerm(o: CcxOption): string {
  return [...(o.short ? [o.short] : []), ...o.longs].join(", ") + (o.value ? ` ${o.value}` : "");
}
/** commander's `compareOptions` key (L392993, verbatim):
 *    `let e = (t) => t.long?.replace(/^--/, "") ?? t.short?.replace(/^-/, "") ?? "";`
 *  LONG first, the short letter only as a fallback for an option that has no long spelling. That is why
 *  `--permission-mode` sorts under "permission-mode" and lands BEFORE `-p, --print`, not after it. */
function optionSortKey(o: CcxOption): string { return (o.longs[0] ?? o.short!).replace(/^-+/, ""); }

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** commander's `I4o` (L392956): term at indent 2, description aligned into the pad column — UNLESS the
 *  term is wider than the pad (L392972-976), where there is no column left to align into and the
 *  description moves to its own line at a hanging indent of `INDENT + HANG`, wrapped that much narrower.
 *  `padEnd` alone cannot express the second arm: past the pad it is a no-op, which would butt the
 *  description straight against the term with no gap. Exported for the test that drives it — the pad is
 *  the max real term length (capped at 36) and no ccx term reaches the cap, so the arm is unreachable
 *  from `helpText()` and would otherwise stay unproven until the first 37-character flag. */
export function formatItems(items: { term: string; description: string }[], pad: number): string[] {
  const lead = " ".repeat(INDENT + pad + GAP);
  const hang = " ".repeat(INDENT + HANG);
  return items.flatMap(({ term, description }) =>
    term.length > pad
      ? [" ".repeat(INDENT) + term, ...wrap(description, HELP_WIDTH - hang.length).map((part) => hang + part)]
      : wrap(description, HELP_WIDTH - lead.length).map((part, k) =>
        k === 0 ? " ".repeat(INDENT) + term.padEnd(pad + GAP) + part : lead + part));
}

export function helpText(): string {
  const options = [...CCX_OPTIONS].sort((a, b) => optionSortKey(a).localeCompare(optionSortKey(b)))
    .map((o) => ({ term: optionTerm(o), description: o.description }));
  // ONE pad across every section, like commander's `padWidth(e, t)` (L391813) — which maxes over the
  // argument, option AND subcommand terms together — capped at `zW_ = 36`.
  const pad = Math.min(MAX_TERM_PAD, Math.max(...[...CCX_ARGUMENTS, ...options, ...CCX_COMMANDS].map((i) => i.term.length)));
  return [
    "Usage: ccx [options] [command] [prompt]",
    "",
    "cc-harness (ccx) - starts an interactive session by default, use -p/--print for non-interactive output",
    "",
    // `formatHelp` pushes the sections in this order (L392989): Arguments, Options, [Global Options],
    // Commands. ccx has no global-options layer (one flat command), so that section never appears.
    "Arguments:",
    ...formatItems(CCX_ARGUMENTS, pad),
    "",
    "Options:",
    ...formatItems(options, pad),
    "",
    "Commands:",
    ...formatItems(CCX_COMMANDS, pad),
  ].flatMap((line) => (line.length > HELP_WIDTH ? wrap(line, HELP_WIDTH) : [line])).join("\n");
}

// ---------------------------------------------------------------------------------------------
// doctor — upstream's identity block (L411293) reduced to the facts ccx can actually establish.

export interface DoctorFacts { ccxVersion: string; node: string; sdk: string; platform: string; invoked: string }

/** The SDK's own version, read from the installed package. `require("@anthropic-ai/claude-agent-sdk/
 *  package.json")` throws ERR_PACKAGE_PATH_NOT_EXPORTED — the manifest is not an export — so resolve the
 *  entry point and walk up to the manifest beside it. `unknown` rather than a throw: doctor's whole job
 *  is to report on a possibly-broken installation, so it must survive one. */
function sdkVersion(): string {
  try {
    let dir = dirname(require.resolve("@anthropic-ai/claude-agent-sdk"));
    for (let i = 0; i < 4; i++) {
      try { return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version; }
      catch { dir = dirname(dir); }
    }
  } catch { /* not installed at all */ }
  return "unknown";
}

export function doctorFacts(): DoctorFacts {
  return {
    ccxVersion: pkg.version, node: process.version, sdk: sdkVersion(),
    platform: `${process.platform}-${process.arch}`,
    // argv[1] is the bin as invoked. Upstream distinguishes installation path from invoked binary; ccx has
    // one path, so it prints the one it can prove.
    invoked: process.argv[1] ?? "(unknown)",
  };
}

/** Upstream's block, minus every line whose fact ccx does not have (no installer, no auto-update channel,
 *  no package manager, no multi-install detection) — a doctor that printed those would be inventing them.
 *  Exit 0 unconditionally is main's business; there are no warnings to raise yet, so the closing line is
 *  always the no-issues one (L411330's else arm). */
export function doctorReport(facts: DoctorFacts = doctorFacts()): string {
  return [
    "ccx doctor",
    "",
    `Running: cc-harness (${facts.ccxVersion})`,
    `Node: ${facts.node}`,
    `SDK: @anthropic-ai/claude-agent-sdk ${facts.sdk}`,
    `Platform: ${facts.platform}`,
    `Invoked: ${facts.invoked}`,
    "",
    "No installation issues found.",
  ].join("\n");
}
