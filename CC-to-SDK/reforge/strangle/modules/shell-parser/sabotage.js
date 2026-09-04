// SABOTAGE LAYER (§2.5) — one twin per RETAINED EXPORT, not one per chunk.
//
// `--sabotage shell-parser:<export>` takes exactly that binding from here and
// leaves the other six on `reference.js`, because §2.2 prices whole-chunk
// ownership at sabotage evidence per retained export and a single all-seven twin
// would pass as long as any one of them is live.
//
// EACH TWIN INVERTS THE ONE THING ITS EXPORT MEANS, and the red it is supposed to
// produce is written down next to it. That matters more for a parser than for a
// description module, because the parser's output does not appear anywhere in a
// transcript: what appears is the DECISION the safety chain and the permission
// classifier reached after reading it. So each twin below names the observable it
// is expected to move, not just the code it breaks.
//
// EVERY TWIN KEEPS ITS SHAPE — a parser handle that still has a `parse`, a
// function that still returns an array of strings, a Set that is still a Set —
// so a red comes from the differential surfaces rather than from a TypeError two
// frames away, which the gate's three-outcome rule reads as a CRASH and therefore
// as inconclusive rather than as evidence.
//
// Three of them import from `reference.js`. That is deliberate and it is what
// makes them twins rather than stubs: a twin of `parseCommandWithEnv` that
// returned `null` would be indistinguishable from a twin of `getParser`, and
// would prove only that something in the chain is live. Building the real result
// and then removing exactly one property is what isolates the export.
import { parseCommandWithEnv as realParseCommandWithEnv, PARSE_ABORTED as REAL_PARSE_ABORTED } from "./reference.js";

/**
 * A PARSER THAT NEVER PARSES. The handle is still a handle and `parse` still
 * returns the type it is allowed to return — `null` is upstream's own answer for
 * an over-long input or an aborted parse — but now it is the answer for every
 * input.
 *
 * Expected red: every consumer that reaches the parser through this handle takes
 * its "could not parse this command" arm. In the engine chunk that is the parse
 * cache and the command-safety chain; a command whose structure cannot be read
 * cannot be matched against a permission rule, so the decision the transcript
 * records changes.
 */
export function getParser() {
  return { parse: () => null };
}

/**
 * NO WORD IS A KEYWORD. Still a Set, still consulted the same way, and now empty.
 *
 * Expected red: the command classifier stops recognising `if`, `for`, `while`,
 * `case` and the rest as shell keywords, so a compound command is read as a
 * simple one whose command name happens to be a reserved word.
 */
export const SHELL_KEYWORDS = new Set();

/**
 * THE ENVIRONMENT PREFIX DISAPPEARS. Everything else about the result is real —
 * the tree, the command node, the original text — and only the assignments that
 * precede the command are dropped.
 *
 * This is the twin that isolates this export from `getParser`'s: a `null` here
 * would prove the chain is live without proving that THIS function's contribution
 * is. Its contribution is one array.
 *
 * Expected red: a command written as `VAR=value cmd` is read as `cmd` with no
 * environment, so anything that inspects what a command sets in its environment
 * sees nothing.
 */
export async function parseCommandWithEnv(command) {
  const real = await realParseCommandWithEnv(command);
  if (real === null) return null;
  // Spread-then-override: `envVars` keeps its position in the record, so the twin
  // differs from the real result in one VALUE and in nothing else.
  return { ...real, envVars: [] };
}

/**
 * A SECOND SENTINEL. Identical in every visible way — same type, same description
 * — and not the same symbol, so every `result === PARSE_ABORTED` comparison in
 * the graph answers false where it used to answer true.
 *
 * This is the identity-is-the-semantics twin, and it is the reason this chunk is
 * owned as a MODULE rather than as seven splices: a consumer bound to a different
 * symbol than the producer returns type-checks, reads correctly, and silently
 * stops recognising an aborted parse.
 *
 * Expected red: wherever the parser gives up, the consumer no longer notices, and
 * treats the sentinel as though it were a parse tree.
 */
export const PARSE_ABORTED = Symbol("parse-aborted");

/**
 * ALWAYS GIVE UP. The real sentinel is returned — imported, so the identity
 * comparison at each call site still succeeds — for every command, including the
 * ones that parse perfectly well.
 *
 * Expected red: every consumer of this entry point takes its abort arm, which is
 * the arm that exists for commands too long or too tangled to read. A command the
 * engine can no longer read is a command it cannot classify.
 */
export async function parseOrAbort(command) {
  if (!command) return null;
  return REAL_PARSE_ABORTED;
}

/**
 * THERE IS NO COMMAND IN THIS TREE. Still returns a node or `null`, and now it is
 * always `null`.
 *
 * Expected red: the walker is how every consumer gets from a program node to the
 * command inside it, so a null here removes the input to argv extraction, to the
 * destructive-command classifier and to per-subcommand permission aggregation.
 * The tree is still there; nothing can find its way into it.
 */
export function findCommandNode() {
  return null;
}

/**
 * ARGV IS ONLY EVER THE COMMAND NAME. Still an array of strings, still in order,
 * and now truncated after the first element.
 *
 * Written out rather than delegating to the real extractor and slicing, so the
 * twin does not depend on the function it is twinning.
 *
 * Expected red: permission rules match on a command's PREFIX — `Bash(chmod:*)`
 * matches `chmod 600 perm.txt` because the argv carries `600` and `perm.txt`
 * after `chmod`. Drop the arguments and a rule that should have matched does not,
 * so the decision the transcript records changes.
 */
export function commandArgv(node) {
  if (node.type === "declaration_command") return [];
  for (const child of node.children) {
    if (child.type === "variable_assignment") continue;
    if (child.type === "command_name" || child.type === "word") {
      const inner = child.children[0] ?? child;
      return [inner.text];
    }
  }
  return [];
}
