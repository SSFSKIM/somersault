// UPSTREAM-DIFFERENTIAL CONTRACT TEST for the owned bash parser (C13a / W10a).
//
//   npx tsx strangle/parser-parity.test.ts
//
// `strangle/modules/shell-parser/` replaces `chunk-fgwne0fb.js` whole: 62,907
// bytes of hand-written recursive-descent tokenising and parsing, reimplemented
// behind the same seven exports. §2.2 prices whole-chunk ownership at "the whole
// export surface", and §2.4 buys a reimplemented body against "the differential
// surfaces its output flows into PLUS a contract test where its domain is wider
// than the corpus". Here the gap between the two is the widest in the campaign:
// every Bash call in the recorded corpus parses through this module, and the
// commands it issues are NINETEEN distinct strings read off the cassettes, whose
// names are `echo`, `mkdir`, `chmod`, `cd`, `pwd`, `sleep` and one deliberately
// missing binary — one `;` list between them and nothing else compound. The
// domain is every string a model can put in a `command` field.
//
// ## THE ORACLE IS UPSTREAM'S OWN BYTES
//
// Nothing here is hand-written as an expectation. The pinned chunk is read out of
// the bundle, its one import and its export clause are removed, and the remaining
// body is evaluated in a closure that hands back the seven bindings — the same
// move `strangle/hooks-parity.test.ts` makes with `freshModuleState`, one level
// out. Each of the seven is located BY SHAPE, never by minified name, because
// those names churn per pin; a pin bump that moves a shape fails here loudly
// rather than quietly comparing something else.
//
// Both sides then parse the same string and the two trees are compared
// STRUCTURALLY — node type, byte range, text and children, in order, to any
// depth. That is a stronger comparison than the differential surface can make: a
// scenario only ever sees the argv the classifier extracted, while this sees
// every node the parser built on the way there.
//
// ## WHY THE COMPARISON IS OVER BYTE RANGES AND NOT JUST SHAPE
//
// The parser emits UTF-8 byte offsets over a UTF-16 string, maintained by two
// mechanisms that must agree (an incremental counter in the scanner, a lazily
// built table for random access). A reimplementation can get every node type and
// every parent-child relation right and still be wrong about where each node
// starts — and the consumers of this parser slice the ORIGINAL COMMAND with those
// offsets. So the offsets are part of the compared value, not metadata about it.
//
// ## RED DIRECTION
//
// A comparison that has never failed is a comparison nobody has calibrated. Every
// partition in `strangle/parser-corpus.ts` declares a red direction — the shape of
// wrongness a bad parser would show there — and this file applies exactly that
// corruption to a copy of the owned tree for that partition's first case and
// requires the comparator to catch it. A partition whose control passes silently
// would not have noticed a wrong parser either, and fails.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { PARTITIONS, LENGTH_CAP_CASES, ENTRY_POINT_CASES, ENTRY_POINT_NON_STRING, type Partition } from "./parser-corpus.js";
import {
  getParser as ownedGetParser,
  SHELL_KEYWORDS as ownedShellKeywords,
  parseCommandWithEnv as ownedParseCommandWithEnv,
  PARSE_ABORTED as ownedParseAborted,
  parseOrAbort as ownedParseOrAbort,
  findCommandNode as ownedFindCommandNode,
  commandArgv as ownedCommandArgv,
} from "./modules/shell-parser/reference.js";

const CHUNK = "chunk-fgwne0fb.js";

let checks = 0;
const failures: string[] = [];

function fail(label: string, detail: string): void {
  failures.push(`${label}: ${detail}`);
}

function eq(label: string, upstream: unknown, owned: unknown): void {
  checks++;
  const a = JSON.stringify(upstream);
  const b = JSON.stringify(owned);
  if (a === b) return;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  fail(label, `differs at offset ${at}\n    upstream: ${a.slice(Math.max(0, at - 40), at + 60)}\n    owned:    ${b.slice(Math.max(0, at - 40), at + 60)}`);
}

/**
 * A control: the two values MUST differ. Used to prove that a comparison which
 * passes is a comparison that could have failed — the campaign's standing rule
 * that a negative is evidence only when the healthy case would differ.
 */
function mustDiffer(label: string, a: unknown, b: unknown): void {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) return;
  fail(`CONTROL ${label}`, "the deliberately wrong value compared EQUAL — this comparison cannot see the defect it exists to see");
}

// ---- 1. the upstream side, from the pinned bytes ----------------------------

const source = readFileSync(join(BUNDLE_MODULES, CHUNK), "utf8");

/** One shape-anchored derivation over the pinned chunk. Throws when the shape moved. */
function derive(role: string, re: RegExp): string {
  const m = source.match(re);
  if (!m) throw new Error(`${CHUNK}: could not derive '${role}' by shape — ${re}. The pin moved; re-derive before comparing anything.`);
  return m[1];
}

// The export clause is the surface; the roles below must exactly account for it.
const exportClause = derive("export clause", /export\{([^}]*)\}/);
const exportOrder = exportClause.split(",");

const UPSTREAM_NAMES = {
  // `function ZE(){return Re}` where `var Re={parse:ze}` — the only zero-argument
  // function in the chunk that returns a module-scope object literal.
  getParser: derive("getParser", /var ([A-Za-z_$][\w$]*)=\{parse:[A-Za-z_$][\w$]*\};function [A-Za-z_$][\w$]*\(\)\{return \1\}/) && derive("getParser", /var [A-Za-z_$][\w$]*=\{parse:[A-Za-z_$][\w$]*\};function ([A-Za-z_$][\w$]*)\(\)\{return [A-Za-z_$][\w$]*\}/),
  // the reserved-word set, anchored on its first three members in order
  shellKeywords: derive("shellKeywords", /([A-Za-z_$][\w$]*)=new Set\(\["if","then","elif"/),
  // the async entry that returns the four-key record
  parseCommandWithEnv: derive("parseCommandWithEnv", /async function ([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\)\{if\(![A-Za-z_$][\w$]*\|\|[A-Za-z_$][\w$]*\.length>/),
  // the sentinel, anchored on its description
  parseAborted: derive("parseAborted", /var ([A-Za-z_$][\w$]*)=Symbol\("parse-aborted"\)/),
  // the async entry that reports the abort telemetry
  parseOrAbort: derive("parseOrAbort", /async function ([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\)\{if\(![A-Za-z_$][\w$]*\)return null;if\([A-Za-z_$][\w$]*\.length>/),
  // the recursive walker, anchored on the pipeline arm it is the only carrier of
  findCommandNode: derive("findCommandNode", /function ([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\)\{let\{type:[A-Za-z_$][\w$]*,children:[A-Za-z_$][\w$]*\}=/),
  // the argv extractor, anchored on the declaration-command arm it opens with
  commandArgv: derive("commandArgv", /function ([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\)\{if\([A-Za-z_$][\w$]*\.type==="declaration_command"\)/),
  // the telemetry import's local binding
  telemetry: derive("telemetry import", /^import\{([A-Za-z_$][\w$]*)\}from"/m),
} as const;

/** Every telemetry call the upstream module made, in order. */
const upstreamTelemetry: { event: string; fields: unknown }[] = [];

// The eval'd closure reaches the recorder as a free variable, so it has to be
// on the global object before the first parse runs.
(globalThis as { __upstreamTelemetry?: unknown[] }).__upstreamTelemetry = upstreamTelemetry;

const upstream = (() => {
  const body = source
    .replace(/^import\{[^}]*\}from"[^"]*";/m, "")
    .replace(/export\{[^}]*\};?\s*$/, "");
  const names = UPSTREAM_NAMES;
  // `eval` is the point, not a shortcut: the oracle has to be UPSTREAM'S OWN
  // BYTES, read out of the pinned bundle this test also hashes its derivations
  // against. The input is a file on this machine at a version `src/pin.ts`
  // fixes, never anything from a network or a user, and it is the same move
  // every parity suite in this directory makes (§2.4's "upstream bodies bound to
  // upstream bytes"). Re-writing it as a transformed import would grade a
  // transformation instead.
  // eslint-disable-next-line no-eval
  return eval(
    `(() => { const ${names.telemetry} = (event, fields) => { __upstreamTelemetry.push({ event, fields }); };\n${body}\nreturn { getParser:${names.getParser}, shellKeywords:${names.shellKeywords}, parseCommandWithEnv:${names.parseCommandWithEnv}, parseAborted:${names.parseAborted}, parseOrAbort:${names.parseOrAbort}, findCommandNode:${names.findCommandNode}, commandArgv:${names.commandArgv} }; })()`,
  ) as {
    getParser: () => { parse: (src: string, budgetMs?: number) => Node | null };
    shellKeywords: Set<string>;
    parseCommandWithEnv: (c: unknown) => Promise<{ rootNode: Node; envVars: string[]; commandNode: Node | null; originalCommand: string } | null>;
    parseAborted: symbol;
    parseOrAbort: (c: unknown) => Promise<Node | symbol | null>;
    findCommandNode: (n: Node, parent: Node | null) => Node | null;
    commandArgv: (n: Node) => string[];
  };
})();

interface Node {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  children: Node[];
}

console.log(`shell-parser parity vs the pinned bundle @ ${ENGINE_VERSION} (${CHUNK})`);

// ---- 2. the surface itself ---------------------------------------------------
{
  eq("the chunk exports exactly seven names", exportOrder.length, 7);
  const derived = [
    UPSTREAM_NAMES.getParser,
    UPSTREAM_NAMES.shellKeywords,
    UPSTREAM_NAMES.parseCommandWithEnv,
    UPSTREAM_NAMES.parseAborted,
    UPSTREAM_NAMES.parseOrAbort,
    UPSTREAM_NAMES.findCommandNode,
    UPSTREAM_NAMES.commandArgv,
  ];
  eq("…and every one of them is accounted for by a shape derivation", [...derived].sort(), [...exportOrder].sort());

  // The keyword set: a constant no scenario renders in full, compared element by
  // element against the pinned chunk's own declaration.
  eq("SHELL_KEYWORDS matches upstream's set", [...upstream.shellKeywords].sort(), [...ownedShellKeywords].sort());
  mustDiffer("a keyword set missing `esac`", [...upstream.shellKeywords].sort(), [...ownedShellKeywords].filter((k) => k !== "esac").sort());

  // The sentinel is compared by DESCRIPTION rather than identity, deliberately:
  // each module constructs its own, and identity across module instances is not
  // the contract. What IS the contract is that each module's own consumers can
  // compare with `===`, which the next block checks on both sides.
  eq("PARSE_ABORTED is a symbol with upstream's description", { t: typeof upstream.parseAborted, d: upstream.parseAborted.description }, { t: typeof ownedParseAborted, d: ownedParseAborted.description });
}

// ---- 3. the structural comparator, and its own controls ----------------------

/**
 * Compare two parse trees. Returns the path of the first difference, or null.
 *
 * Byte ranges and text are part of the compared value: the consumers of this
 * parser slice the original command with `startIndex`/`endIndex`, so a tree that
 * is structurally right and numerically wrong is a defect this must see.
 */
function diffTree(a: Node | null, b: Node | null, path = "root"): string | null {
  if (a === null || b === null) {
    if (a === b) return null;
    return `${path}: upstream ${a === null ? "null" : a.type} vs owned ${b === null ? "null" : b.type}`;
  }
  if (a.type !== b.type) return `${path}: type ${JSON.stringify(a.type)} vs ${JSON.stringify(b.type)}`;
  if (a.startIndex !== b.startIndex) return `${path}[${a.type}]: startIndex ${a.startIndex} vs ${b.startIndex}`;
  if (a.endIndex !== b.endIndex) return `${path}[${a.type}]: endIndex ${a.endIndex} vs ${b.endIndex}`;
  if (a.text !== b.text) return `${path}[${a.type}]: text ${JSON.stringify(a.text)} vs ${JSON.stringify(b.text)}`;
  if (a.children.length !== b.children.length) {
    return `${path}[${a.type}]: ${a.children.length} children vs ${b.children.length} (${a.children.map((c) => c.type).join(",")} vs ${b.children.map((c) => c.type).join(",")})`;
  }
  for (let i = 0; i < a.children.length; i++) {
    const d = diffTree(a.children[i], b.children[i], `${path}.${a.type}[${i}]`);
    if (d) return d;
  }
  return null;
}

const clone = (n: Node): Node => ({ type: n.type, text: n.text, startIndex: n.startIndex, endIndex: n.endIndex, children: n.children.map(clone) });

/** Every node of a tree, deepest first, so a corruption lands INSIDE it rather than at its root. */
function deepestFirst(n: Node): Node[] {
  return [...n.children.flatMap(deepestFirst), n];
}

/**
 * Apply one partition's declared red direction to a copy of a healthy tree.
 *
 * Returns null when no node in the tree can carry that corruption — which is not
 * a shrug: a `childOrder` control over a tree whose every node has at most one
 * child would reverse a one-element array and compare equal, reporting a
 * calibrated comparator that had in fact been handed a no-op. The caller turns a
 * null into a failure for exactly that reason.
 */
function corrupt(tree: Node, kind: Partition["control"]): Node | null {
  const bad = clone(tree);
  const nodes = deepestFirst(bad);
  if (kind === "childOrder") {
    // Two children whose ORDER is observable: reversing needs at least two, and
    // reversing two identical siblings changes nothing.
    const target = nodes.find((n) => n.children.length >= 2 && JSON.stringify(n.children) !== JSON.stringify([...n.children].reverse()));
    if (!target) return null;
    target.children = [...target.children].reverse();
    return bad;
  }
  if (kind === "childCount") {
    const target = nodes.find((n) => n.children.length >= 1);
    if (!target) return null;
    target.children = target.children.slice(0, -1);
    return bad;
  }
  const target = nodes[0];
  if (kind === "type") target.type = `${target.type}_WRONG`;
  else if (kind === "byteRange") target.endIndex = target.endIndex + 1;
  else target.text = `${target.text}!`;
  return bad;
}

// ---- 4. every partition, every case -----------------------------------------

// A generous budget rather than the 50 ms default: the parser aborts on a
// deadline, and a deadline is wall-clock. Two runs of the same input under a
// 50 ms budget can legitimately disagree on a loaded machine, which would make
// this test flaky in the one direction a parity test must never be — a red that
// is not a defect. Both sides get the same number, so the budget is not a
// difference between them; what it removes is the clock.
const BUDGET_MS = 20000;

const upstreamParser = upstream.getParser();
// The owned module is plain ESM `.js` with no annotations (`checkJs` is off, per
// tsconfig's note on dual-wiring), so TypeScript infers `object` for its node
// returns. The cast states the shape ONCE, here, rather than at every use — and
// it is not a claim the test takes on trust: `diffTree` reads all five fields on
// both sides, so a node that does not have them fails the comparison rather than
// slipping through.
const ownedParser = ownedGetParser() as unknown as { parse: (command: string, budgetMs?: number) => Node | null };
const ownedFind = ownedFindCommandNode as unknown as (n: Node, parent: Node | null) => Node | null;
const ownedArgv = ownedCommandArgv as unknown as (n: Node) => string[];
const ownedWithEnv = ownedParseCommandWithEnv as unknown as (c: string) => Promise<{ rootNode: Node; envVars: string[]; commandNode: Node | null; originalCommand: string } | null>;

let cases = 0;
for (const partition of PARTITIONS) {
  if (partition.cases.length === 0) {
    fail(`partition ${partition.name}`, "has NO cases — a partition is a claim that a region of the domain is graded, and a claim over nothing passes vacuously (§3.1)");
    continue;
  }
  const reds: string[] = [];
  for (const command of partition.cases) {
    cases++;
    checks++;
    const u = upstreamParser.parse(command, BUDGET_MS);
    const o = ownedParser.parse(command, BUDGET_MS);
    const d = diffTree(u, o);
    if (d && reds.length < 4) reds.push(`  ${JSON.stringify(command)}\n      ${d}`);
    else if (d) reds.push("");
  }
  const shown = reds.filter((r) => r !== "");
  if (reds.length > 0) {
    fail(`partition ${partition.name}`, `${reds.length}/${partition.cases.length} case(s) diverge:\n${shown.join("\n")}`);
  }

  // The red direction for this partition, applied to a healthy owned tree — the
  // FIRST case in the partition that can carry it, so the control is about the
  // partition's own material rather than about a string chosen to make it easy.
  checks++;
  let controlApplied = false;
  for (const command of partition.cases) {
    const healthy = ownedParser.parse(command, BUDGET_MS);
    if (healthy === null) continue;
    const bad = corrupt(healthy, partition.control);
    if (bad === null) continue;
    controlApplied = true;
    if (diffTree(healthy, bad) === null) {
      fail(
        `partition ${partition.name} control`,
        `a deliberately wrong owned tree (${partition.control}) compared EQUAL on ${JSON.stringify(command)} — this partition would not have seen a parser that gets ${partition.control} wrong`,
      );
    }
    break;
  }
  if (!controlApplied) {
    fail(
      `partition ${partition.name} control`,
      `no case in this partition produces a tree that can carry a ${partition.control} corruption, so the red direction was never applied — the control is vacuous`,
    );
  }
}

console.log(`  ${PARTITIONS.length} partitions, ${cases} command strings, each compared node-for-node against the pinned chunk`);

// ---- 5. the derived entry points --------------------------------------------
// The four exports above `parse` are what the rest of the shell subsystem calls,
// and each derives something from a tree rather than returning it. A parser can
// be right and a derivation wrong, so each is compared on its own.
{
  const walked = PARTITIONS.flatMap((p) => p.cases);
  let argvChecked = 0;
  let commandNodeFound = 0;
  for (const command of walked) {
    const u = upstreamParser.parse(command, BUDGET_MS);
    const o = ownedParser.parse(command, BUDGET_MS);
    if (u === null || o === null) {
      checks++;
      if ((u === null) !== (o === null)) fail("parse nullity", `${JSON.stringify(command)}: upstream ${u === null ? "null" : "tree"} vs owned ${o === null ? "null" : "tree"}`);
      continue;
    }
    checks++;
    const uc = upstream.findCommandNode(u, null);
    const oc = ownedFind(o, null);
    const d = diffTree(uc, oc);
    if (d) fail("findCommandNode", `${JSON.stringify(command)}: ${d}`);
    if (uc !== null) {
      commandNodeFound++;
      checks++;
      argvChecked++;
      eq(`commandArgv ${JSON.stringify(command)}`, upstream.commandArgv(uc), ownedArgv(oc as Node));
    }
  }
  console.log(`  findCommandNode over all ${walked.length} strings, commandArgv over the ${argvChecked} that have a command node`);
  checks++;
  if (commandNodeFound < 200) fail("commandArgv coverage", `only ${commandNodeFound} strings produced a command node — too few for the argv extractor to be graded`);
}

// ---- 6. the two async entry points, the cap, and the abort sentinel ----------
{
  const capFromChunk = Number(derive("length cap", /var ([A-Za-z_$][\w$]*)=1e4,/) && source.match(/var [A-Za-z_$][\w$]*=(1e4),/)![1].replace("1e4", "10000"));
  eq("the length cap is read from the pinned chunk, not written down", capFromChunk, 10000);

  /**
   * One `parseCommandWithEnv` result, compared in FULL — all four keys of the
   * record it returns.
   *
   * `commandNode` is the key that used to be left out, and it is the one the
   * consumers of this entry point actually read: the classifier wants the
   * command inside the tree, not the tree. The export is corpus-dark (its
   * manifest row is `darkOver: bash-tool, perm-rule-deny`), so this suite is the
   * ONLY grading it gets, and a returned key nobody compares is a key nobody
   * grades — a reimplementation could hand back the right root, the right
   * assignments and the wrong command node and pass.
   *
   * `diffTree` carries the nullity comparison itself, on both `rootNode` and
   * `commandNode`, so a side that answers `null` where the other answers a node
   * is a named difference rather than a skipped check.
   */
  const withEnv = async (label: string, command: unknown): Promise<void> => {
    checks++;
    const u = await upstream.parseCommandWithEnv(command);
    const o = await ownedWithEnv(command as string);
    eq(`parseCommandWithEnv ${label}`, u === null ? null : { envVars: u.envVars, originalCommand: u.originalCommand }, o === null ? null : { envVars: o.envVars, originalCommand: o.originalCommand });
    if (u === null || o === null) return;
    const dRoot = diffTree(u.rootNode, o.rootNode);
    if (dRoot) fail(`parseCommandWithEnv rootNode ${label}`, dRoot);
    const dCommand = diffTree(u.commandNode, o.commandNode);
    if (dCommand) fail(`parseCommandWithEnv commandNode ${label}`, dCommand);
  };

  const run = async (): Promise<void> => {
    for (const { label, command } of LENGTH_CAP_CASES(capFromChunk)) {
      await withEnv(`at ${label} (len ${command.length})`, command);
    }

    // Every entry-point case, from the corpus file the coverage driver reads the
    // same list out of. That sharing is the point: a string only the driver had
    // would earn `contract` attestation credit for a branch this suite never
    // compared, so `strangle/parser-corpus.ts` owns the list and both consumers
    // import it.
    for (const command of ENTRY_POINT_CASES) {
      await withEnv(JSON.stringify(command), command);
    }
    // The non-string caller, which is how `parseCommandWithEnv` reaches its catch
    // arm — `parse` throws on it and the entry point answers `null`.
    await withEnv("a caller that passes a non-string with a `length`", ENTRY_POINT_NON_STRING);

    // The RED DIRECTION for the `commandNode` comparison, applied the way the
    // partitions' controls are: a healthy owned result with exactly that key
    // blinded, which the comparison must report AND must name. A twin that
    // returns `commandNode: null` is not hypothetical — it is what an owned
    // module that forgot to call the walker would return, and it is the sabotage
    // shape `findCommandNode`'s own twin already uses one level down.
    {
      checks++;
      const command = "A=1 ls -la";
      const u = await upstream.parseCommandWithEnv(command);
      const o = await ownedWithEnv(command);
      if (u === null || o === null || u.commandNode === null) {
        fail("CONTROL parseCommandWithEnv commandNode", `${JSON.stringify(command)} produced no command node on the upstream side, so blinding the owned one compares equal and the control is vacuous`);
      } else {
        const d = diffTree(u.commandNode, { ...o, commandNode: null }.commandNode);
        if (d === null) fail("CONTROL parseCommandWithEnv commandNode", "an owned twin returning `commandNode: null` compared EQUAL — this comparison cannot see the defect it exists to see");
        else if (!d.includes("owned null")) fail("CONTROL parseCommandWithEnv commandNode", `the difference was seen but not named as a missing command node: ${d}`);
      }
    }

    // ---- parseOrAbort: three abort causes, and the telemetry each emits ----
    // Upstream's three call sites are three DIFFERENT reasons, and only the last
    // reports `panic: true`. Each is driven here, with the port trace compared.
    const ownedTelemetry: { event: string; fields: unknown }[] = [];
    const record = (event: string, fields: unknown): void => {
      ownedTelemetry.push({ event, fields });
    };
    const both = async (label: string, command: unknown): Promise<void> => {
      checks++;
      upstreamTelemetry.length = 0;
      ownedTelemetry.length = 0;
      const u = await upstream.parseOrAbort(command);
      const o = await ownedParseOrAbort(command, record);
      const uKind = u === null ? "null" : typeof u === "symbol" ? (u === upstream.parseAborted ? "ABORTED" : "other-symbol") : "tree";
      const oKind = o === null ? "null" : typeof o === "symbol" ? (o === ownedParseAborted ? "ABORTED" : "other-symbol") : "tree";
      eq(`parseOrAbort ${label} verdict`, uKind, oKind);
      eq(`parseOrAbort ${label} telemetry`, upstreamTelemetry, ownedTelemetry);
      if (uKind === "tree" && oKind === "tree") {
        const d = diffTree(u as Node, o as Node);
        if (d) fail(`parseOrAbort ${label} tree`, d);
      }
    };

    // The same shared list, through the other entry point. It carries the healthy
    // commands, the empty command, and cause 2 of 3 — a parse that returned null,
    // reached by a heredoc delimiter the parser refuses to guess about, which
    // aborts inside `parse` and is caught there, so the caller sees null rather
    // than a throw. panic:false.
    for (const command of ENTRY_POINT_CASES) {
      await both(JSON.stringify(command), command);
    }
    // Cause 1 of 3: over the length cap, reported with panic:false — driven at the
    // boundary rather than well past it, so the side that refuses one character
    // early is a red.
    for (const { label, command } of LENGTH_CAP_CASES(capFromChunk)) {
      await both(`at ${label} (len ${command.length})`, command);
    }
    // Cause 3 of 3: the parse THREW. Unreachable from any string, because `parse`
    // catches everything it can raise — so it is reached the only way it can be,
    // by a caller that passes a non-string with a `length`. That is not a
    // hypothetical shape: `parseOrAbort` is called on a `command` field that the
    // engine has already read off a tool-use block, and this is the arm that
    // decides what happens when that field is not what it should be. panic:true.
    await both("a parse that throws", ENTRY_POINT_NON_STRING);

    checks++;
    if (upstreamTelemetry.length === 0) fail("parseOrAbort telemetry", "no telemetry was recorded by any case — the port trace comparison is vacuous");

    // The control: a recorder that drops the `panic` flag must be seen.
    upstreamTelemetry.length = 0;
    await upstream.parseOrAbort(ENTRY_POINT_NON_STRING);
    mustDiffer("telemetry without the panic flag", upstreamTelemetry, upstreamTelemetry.map((t) => ({ event: t.event, fields: { cmdLength: 5 } })));
  };

  await run();
}

// ---- 7. verdict --------------------------------------------------------------
console.log(`\n=== shell-parser parity: ${checks} checks over ${cases} command strings, ${PARTITIONS.length} partitions ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(failures.length === 0 ? "\nPASS — the owned parser is node-for-node identical to the pinned chunk over every partition, and every partition's red direction is caught" : "\nFAIL");
process.exit(failures.length === 0 ? 0 : 1);
