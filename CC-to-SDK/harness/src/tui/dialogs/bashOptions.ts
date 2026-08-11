// tui/dialogs/bashOptions.ts — the Bash permission dialog's pure half (F6 T6): which rows the option list
// holds, what the prefix row starts out saying, and what each row MEANS. Transcribed from 2.1.220's `$Qf`
// (L504855-878, the list), `aDn` (L505204-223, the outcome per value), `dZf`'s prefix seed (L505225-236)
// over `TIo`/`SSd` (L277676/L277704), and `Wdi` (L504780-804, the suggestions-summary sentence) with its
// three list formatters `gsl`/`zMn`/`J5b` (L504765/L504770/L504753).
//
// Four things about the upstream list are load-bearing and easy to lose:
//   · the two middle arms are MUTUALLY EXCLUSIVE and both are gated on `suggestions.length > 0` (L504864-873).
//     A consult the engine had nothing to say about gets Yes/No and nothing else — there is no
//     "don't ask again" row invented out of the command alone;
//   · which of the two shows is decided by the SUGGESTION SHAPE, not by the command: anything that is not a
//     plain Bash rule (a directory grant, another tool's rule) cannot be expressed as a command prefix, so
//     the editable row steps aside for `Wdi`'s summary sentence (L504865);
//   · `Wdi`'s command arm types an ASCII apostrophe while the editable row's label types U+2019. Upstream is
//     inconsistent here and we reproduce it exactly — the tests pin both;
//   · an EMPTY prefix is not a cancel: `allowEmptySubmitToCancel` carries the empty submit to the handler and
//     `aDn` downgrades it to a plain allow (L505215-216).
//
// Recorded as NOT BUILT, all upstream-side: the async prefix refinement (`dZf` L505240-257 re-seeds the row
// from a real command parse — `Wed`/`pTs` — and we ship the synchronous arm only); `n6b`'s redirection strip
// (`I2e` L360019 is a full tree-sitter bash parse); `zMn`/`J5b`'s BOLD segments, because `SelectOption.label`
// is a string; and `resetCursorOnUpdate`, which our `Select` has no equivalent for.

import type { SelectOption } from "../select/Select.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";
import { noRow, yesRow, type FeedbackMode } from "./optionRows.js";
import { basename, sep } from "node:path";

/** `ri`, the tool every rule here is keyed to. */
const BASH = "Bash";
/** L504864 — the ONE label upstream curls the apostrophe in (U+2019). */
export const PREFIX_LABEL = "Yes, and don’t ask again for";
export const PREFIX_PLACEHOLDER = "command prefix (e.g., npm run *)";

// ── reading the engine's suggestion payload ──────────────────────────────────────────────────────────
// `PermissionUpdateLike` is deliberately opaque (permissions/types.ts): the payload is echoed VERBATIM and
// never reconstructed, so everything below only ever READS it, defensively.

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string => (typeof v === "string" ? v : "");
type Rule = Record<string, unknown>;

const rulesOf = (u: PermissionUpdateLike): Rule[] =>
  u.type === "addRules" ? asArray(u.rules).filter((r): r is Rule => typeof r === "object" && r !== null) : [];
const addedRules = (suggestions: readonly PermissionUpdateLike[]): Rule[] => suggestions.flatMap(rulesOf);
const contentsFor = (suggestions: readonly PermissionUpdateLike[], toolName: string): string[] =>
  addedRules(suggestions).filter((r) => asString(r.toolName) === toolName).map((r) => asString(r.ruleContent));
const directoriesOf = (suggestions: readonly PermissionUpdateLike[]): string[] =>
  suggestions.filter((u) => u.type === "addDirectories").flatMap((u) => asArray(u.directories)).map(asString).filter(Boolean);

/** L504865: a suggestion the editable prefix row cannot express — a directory grant, or a rule for some other
 *  tool. Either one sends the list to `Wdi`'s summary row instead. */
const beyondPrefix = (suggestions: readonly PermissionUpdateLike[]): boolean =>
  suggestions.some((u) => u.type === "addDirectories" || rulesOf(u).some((r) => asString(r.toolName) !== BASH));

// ── the prefix seed (`dZf` L505225-236) ──────────────────────────────────────────────────────────────

/** `vIo` L278881. */
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** `wIo` L278882 — heads that carry no meaning of their own, so no prefix taken from them is safe. */
const WRAPPERS = new Set(["sh", "bash", "zsh", "fish", "csh", "tcsh", "ksh", "dash", "cmd", "powershell", "pwsh",
  "env", "xargs", "command", "builtin", "noglob", "nice", "stdbuf", "nohup", "timeout", "time", "watch", "ionice",
  "chrt", "setsid", "taskset", "strace", "ltrace", "script", "flock", "unshare", "nsenter", "sudo", "doas",
  "pkexec", "su", "runuser"]);
/** `Gsn` L278884 — the env assignments a command may carry and still be prefixable. */
const SAFE_ENV = new Set(["GOEXPERIMENT", "GOOS", "GOARCH", "CGO_ENABLED", "GO111MODULE", "RUST_BACKTRACE",
  "RUST_LOG", "NODE_ENV", "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE", "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
  "PYTEST_DEBUG", "ANTHROPIC_API_KEY", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_TIME", "CHARSET", "TERM",
  "COLORTERM", "NO_COLOR", "FORCE_COLOR", "TZ", "LS_COLORS", "LSCOLORS", "GREP_COLOR", "GREP_COLORS",
  "GCC_COLORS", "TIME_STYLE", "BLOCK_SIZE", "BLOCKSIZE", "COLUMNS", "LINES", "CLICOLOR", "CLICOLOR_FORCE", "CI",
  "DEBIAN_FRONTEND", "GIT_TERMINAL_PROMPT"]);
/** The shape both prefix finders require of the word they keep. */
const WORD = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The words after the leading env assignments, or null when one of them is not on the safe list — which is
 *  upstream's flat refusal to prefix a command carrying an env it does not recognise. */
function afterEnv(command: string): string[] | null {
  const words = command.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && ENV_ASSIGNMENT.test(words[i]!)) {
    if (!SAFE_ENV.has(words[i]!.slice(0, words[i]!.indexOf("=")))) return null;
    i++;
  }
  return words.slice(i);
}

/** `TIo` L277676 — `npm run`, `git status`: a command plus a subcommand-shaped second word. */
export function twoWordPrefix(command: string): string | null {
  const words = afterEnv(command);
  if (words === null || words.length < 2) return null;
  if (WRAPPERS.has(words[0]!.split("/").pop()!)) return null;
  return WORD.test(words[1]!) ? words.slice(0, 2).join(" ") : null;
}

/** `SSd` L277704 — the bare head, when it is a plain lowercase name and not a wrapper. */
export function oneWordPrefix(command: string): string | null {
  const words = afterEnv(command);
  const head = words?.[0];
  if (!head || !WORD.test(head) || WRAPPERS.has(head)) return null;
  return head;
}

/** L505225-236, REACHABLE PATHS ONLY. Upstream's initializer has two halves and the first one is dead here:
 *  it consults a suggested rule's `ruleContent` solely inside the `subcommandResults` branch, and that is a
 *  TYPED decision reason the headless wire never forwards (probe 78 A1, see consentReason.ts). Every path we
 *  can actually be on is the else-half — `TIo`, then `SSd`, then the raw command — so the seed is a pure
 *  function of the COMMAND and the suggestions do not enter it. That is what makes `npm run test` seed
 *  `npm run *` rather than echoing a rule's own `npm run:*` back at the human.
 *  The async refinement upstream layers on top (L505240-257) is recorded, not built. */
export function prefixSeed(command: string): string {
  const two = twoWordPrefix(command);
  if (two) return `${two} *`;
  const one = oneWordPrefix(command);
  if (one) return `${one} *`;
  return command;
}

// ── the suggestions summary (`Wdi` L504780-804) ──────────────────────────────────────────────────────

/** `BGl` L41848 — undo the rule grammar's backslash escapes before showing a path to a human. */
const unescapeRule = (s: string) => s.replace(/\\([\\[\]!#()|+^$*?\s])/g, "$1");
const uniq = (xs: string[]) => [...new Set(xs)];

/** `zMn` L504770 — basenames, each with a trailing separator; two join with "and", more elide. */
function pathList(paths: string[]): string {
  const names = paths.map((p) => basename(p) || p);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]}${sep}`;
  if (names.length === 2) return `${names[0]}${sep} and ${names[1]}${sep}`;
  return `${names[0]}${sep}, ${names[1]}${sep} and ${names.length - 2} more`;
}

/** `gsl` L504765 over `J5b` L504753 — a list too long to read becomes the word "similar". */
function commandList(cmds: string[]): string {
  if (cmds.join(", ").length > 50) return "similar";
  if (cmds.length === 0) return "";
  if (cmds.length === 1) return cmds[0]!;
  if (cmds.length === 2) return `${cmds[0]} and ${cmds[1]}`;
  return `${cmds.slice(0, -1).join(", ")}, and ${cmds.at(-1)}`;
}

/** `Wdi` L504780-804, all five arms. Returns the sentence, or undefined where upstream returns null (a
 *  suggestion set that names no path, no directory and no command has nothing to summarise). `cwd` is the
 *  SESSION's working directory — the command arm is the only one that names it. */
export function suggestionSummary(suggestions: readonly PermissionUpdateLike[], cwd: string): string | undefined {
  const reads = contentsFor(suggestions, "Read")
    .map((c) => unescapeRule(c.replace(/\/\*\*$/, "").replace(/^\.\//, ""))).filter(Boolean);
  const cmds = uniq(contentsFor(suggestions, BASH).filter(Boolean)
    .map((c) => (c.endsWith(":*") || c.endsWith(" *") ? c.slice(0, -2) : c)));
  const dirs = directoriesOf(suggestions);
  const hasDirs = dirs.length > 0, hasReads = reads.length > 0, hasCmds = cmds.length > 0;

  if (hasReads && !hasDirs && !hasCmds) return `Yes, allow reading from ${pathList(reads)} from this project`;
  if (hasDirs && !hasReads && !hasCmds) return `Yes, and always allow access to ${pathList(dirs)} from this project`;
  // The ONE arm that names the cwd — and the one upstream types with an ASCII apostrophe (L504791).
  if (hasCmds && !hasDirs && !hasReads) return `Yes, and don't ask again for ${commandList(cmds)} commands in ${cwd}`;
  const paths = [...dirs, ...reads];
  if ((hasDirs || hasReads) && !hasCmds) return `Yes, and always allow access to ${pathList(paths)} from this project`;
  if ((hasDirs || hasReads) && hasCmds) {
    return paths.length === 1 && cmds.length === 1
      ? `Yes, and allow access to ${pathList(paths)} and ${commandList(cmds)} commands`
      : `Yes, and allow ${pathList(paths)} access and ${commandList(cmds)} commands`;
  }
  return undefined;
}

// ── the list, and what each row means ────────────────────────────────────────────────────────────────

export interface BashOptionsArgs {
  command: string;
  suggestions?: readonly PermissionUpdateLike[];
  /** Only the `no` half is ever honoured: the SDK's allow arm carries no message field, so allow-side
   *  feedback is unreachable and the Yes row stays a plain pick-one row (T3 req 3). */
  feedback?: FeedbackMode;
  /** The SESSION's working directory — read only by the summary row's command arm. */
  cwd: string;
}

/** `$Qf` L504855-878, narrowed to the arms a Bash consult can reach (the auto-mode row is a claude.ai
 *  entitlement — `UDr` L504815, its row L504872 — and is recorded out of reach). */
export function bashOptions({ command, suggestions = [], feedback, cwd }: BashOptionsArgs): SelectOption[] {
  const options: SelectOption[] = [yesRow(false)];
  // Upstream additionally wraps BOTH middle rows in `Kur()` (L504863) = `!Afe()` (L228129-134), which is off
  // only when managed policy settings set `allowManagedPermissionRulesOnly` — a surface this harness has no
  // equivalent of, so it is not modeled and the gate is the suggestion payload alone.
  if (suggestions.length > 0) {
    if (!beyondPrefix(suggestions)) {
      options.push({
        type: "input", label: PREFIX_LABEL, value: "yes-prefix-edited", placeholder: PREFIX_PLACEHOLDER,
        initialValue: prefixSeed(command), allowEmptySubmitToCancel: true,
        showLabelWithValue: true, labelValueSeparator: ": ",
      });
    } else {
      const label = suggestionSummary(suggestions, cwd);
      if (label) options.push({ label, value: "yes-apply-suggestions" });
    }
  }
  options.push(noRow(feedback?.no ?? false));
  return options;
}

/** `aDn` L505204-223. `text` is whatever the chosen INPUT row held (the prefix, or the deny feedback);
 *  `suggestions` is the engine's payload, echoed object-for-object.
 *
 *  Upstream's allow arms all carry `updatedInput: t.input` — the input UNCHANGED, since this dialog has no
 *  edit affordance. Ours omit it: `allow_once.updatedInput` is a FULL REPLACEMENT on the SDK side (T3), so
 *  sending an unchanged copy buys nothing and risks everything. */
export function bashDecision(value: string, ctx: { text?: string; suggestions?: readonly PermissionUpdateLike[] } = {}): PermissionDecision {
  const text = (ctx.text ?? "").trim();
  switch (value) {
    case "yes-apply-suggestions":
      return { kind: "allow_with_updates", updatedPermissions: [...(ctx.suggestions ?? [])] };
    case "yes-prefix-edited":
      return text
        ? { kind: "allow_with_updates", updatedPermissions: [{ type: "addRules", rules: [{ toolName: BASH, ruleContent: text }], behavior: "allow", destination: "localSettings" }] }
        : { kind: "allow_once" };
    case "no":
      return text ? { kind: "deny", feedback: text } : { kind: "deny" };
    default:
      return { kind: "allow_once" };
  }
}
