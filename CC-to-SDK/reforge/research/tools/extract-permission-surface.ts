// §3.3 / C8-fix-2 doctrine — snapshot the PERMISSION SURFACE's own enumerations
// from the pinned bundle.
//
//   npx tsx research/tools/extract-permission-surface.ts [--check]
//
// WHY A FIXTURE. W6's deliverable is a permission-mode matrix, and a matrix is
// only as honest as its axes. The wave that wrote its axes by hand would be
// repeating W5's measured failure one subsystem over: an enumeration the tester
// chooses can only ever confirm the tester, and it fails SILENTLY — the table is
// complete, every cell has a verdict, and the missing rows are invisible.
//
// So every axis of the matrix is read off the artifact:
//
//   modes             the permission modes the engine accepts, WITH upstream's
//                     own one-line semantics for each (it ships them, in the
//                     schema's `.describe()`)
//   ruleBehaviors     what a permission RULE can say
//   ruleDestinations  where a rule can be written
//   decisionReasons   the kinds of `decisionReason` a decision can carry — the
//                     third axis, and the one that distinguishes two denials
//                     that look identical in a transcript
//   modeGuards        which modes are REFUSED at the mode-change seam, under
//                     what predicate, with upstream's own error text
//
// HOW EACH IS FOUND (by shape) AND CONFIRMED (by an independent signal). The
// pattern is `extract-hook-registry.ts`'s, and the reason is the same: a search
// by minified NAME churns at every pin, and a search by shape alone can latch
// onto the wrong thing. So each enumeration is located structurally and then
// checked against evidence collected from a different place in the graph:
//
//   modes             shape: the LARGEST array literal of string literals that
//                     contains both "default" and "bypassPermissions".
//                     confirmation: every member must ALSO be observed in
//                     comparison or assignment position against a `mode` /
//                     `permissionMode` binding somewhere in the bundle — a set
//                     of mode names nothing ever compares against is not the
//                     mode enumeration. And every maximal candidate (there are
//                     several: the SDK schema, the cron schema, the CLI parser)
//                     must agree on the SET, or the extraction fails rather than
//                     picking one.
//   ruleBehaviors     shape: array literals whose members are exactly the values
//                     seen in `ruleBehavior` position. confirmation: the same
//                     comparison sweep, on `ruleBehavior`.
//   decisionReasons   shape: the `case "…":` clauses of the message builder —
//                     found by its own unique anchor, the one W6 splices it on.
//                     confirmation: the `decisionReason:{type:"…"}` literals the
//                     decision functions construct, bundle-wide. The two sets do
//                     not have to be equal (a reason can be constructed in a
//                     chunk the builder never renders, and the builder handles a
//                     kind nothing here constructs), so BOTH are recorded and
//                     the asymmetry is the interesting part.
//   modeGuards        the mode-change guard's own body, located by its unique
//                     error literal, read for `<mode>` comparisons and the error
//                     each one returns.
//
// `--check` regenerates in memory and fails if the committed fixture differs, so
// a pin bump that adds a mode, renames a rule behavior or re-guards a mode
// cannot land silently.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `permission-surface-${version}.json`);

/**
 * The two members every real permission-mode enumeration has. Used to RECOGNISE
 * candidates, never to define the answer: a candidate that contains them is
 * considered, and what the fixture records is the candidate's full membership.
 */
const MODE_SEEDS = ["default", "bypassPermissions"];
/** Below this, an array of strings is some other list that happens to mention a mode. */
const MIN_MODES = 4;

/**
 * The message builder W6 owns (`createPermissionRequestMessage`), located by the
 * literal that is unique bundle-wide. Its `case` clauses ARE the decisionReason
 * enumeration — upstream has no array for this one, so the switch is the
 * artifact.
 */
const MESSAGE_BUILDER_ANCHOR = "blocked this action:";
/** The mode-change guard (`guardPermissionModeChange`), by its own unique refusal. */
const MODE_GUARD_ANCHOR = "Cannot set permission mode to bypassPermissions because the session was not launched";

interface Chunk {
  file: string;
  text: string;
  sf: ts.SourceFile;
}

function readChunks(dir: string): Chunk[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      return { file, text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS) };
    });
}

/** Every array literal whose elements are ALL string literals, with its chunk and offset. */
function stringArrays(c: Chunk): { members: string[]; offset: number }[] {
  const out: { members: string[]; offset: number }[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isArrayLiteralExpression(n) && n.elements.length > 0 && n.elements.every(ts.isStringLiteral)) {
      out.push({ members: n.elements.map((e) => (e as ts.StringLiteral).text), offset: n.getStart(c.sf) });
    }
    ts.forEachChild(n, walk);
  };
  walk(c.sf);
  return out;
}

/**
 * The INDEPENDENT signal: every string literal the graph compares against, or
 * assigns to, a property of the given name.
 *
 * A text sweep on purpose — it shares no machinery with the AST search above, so
 * a bug in one cannot silently validate the other. Covers the four shapes a
 * minified bundle writes: `p:"v"`, `p==="v"`, `p!=="v"`, and `p==="v"` reached
 * through an optional chain (`?.p==="v"`), which the same regex already spans.
 */
function comparands(chunks: Chunk[], property: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${property}\\s*(?::|===|!==|==|!=)\\s*"([^"\\\\]*)"`, "g");
  for (const c of chunks) for (const m of c.text.matchAll(re)) out.add(m[1]);
  return out;
}

/** Balanced-brace body of the declaration carrying `anchor`, searched from the anchor outward. */
function bodyCarrying(c: Chunk, anchor: string): { source: string; offset: number } | null {
  const at = c.text.indexOf(anchor);
  if (at < 0) return null;
  let node: ts.Node | undefined;
  const walk = (n: ts.Node): void => {
    if (n.getStart(c.sf) <= at && at < n.getEnd() && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))) node = n;
    ts.forEachChild(n, walk);
  };
  walk(c.sf);
  return node ? { source: node.getText(c.sf), offset: node.getStart(c.sf) } : null;
}

/**
 * Every `.describe("…")` argument in a chunk, as its DECODED string value.
 *
 * Through the AST rather than a text scan, so escapes and embedded apostrophes
 * are upstream's characters and not the minifier's spelling of them.
 */
function describeStrings(c: Chunk): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "describe" &&
      n.arguments.length === 1 &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      out.push((n.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(n, walk);
  };
  walk(c.sf);
  return out;
}

/** `case "x":` clause values of the switch inside a function body, in source order. */
function switchCases(source: string): string[] {
  const sf = ts.createSourceFile("body.js", `(${source})`, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) out.push(n.expression.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

export interface PermissionSurfaceFixture {
  engineVersion: string;
  generatedBy: string;
  modes: {
    /** the enumeration, in upstream's own declaration order */
    names: string[];
    /** upstream's one-line semantics per mode, parsed out of the schema's describe() */
    semantics: Record<string, string>;
    /** where the agreeing candidates were found, for hand-verification */
    sources: { chunk: string; offset: number; members: string[] }[];
    /** how many of the enumeration's members are observed in comparison position */
    confirmed: number;
    /**
     * Mode names observed in comparison position that the enumeration does NOT
     * contain. Recorded rather than dropped: a live mode nothing enumerates
     * would be exactly the blind spot this fixture exists to remove.
     */
    comparandsNotEnumerated: string[];
  };
  ruleBehaviors: { names: string[]; sources: { chunk: string; offset: number }[]; confirmed: number };
  ruleDestinations: { names: string[]; sources: { chunk: string; offset: number }[]; confirmed: number };
  decisionReasons: {
    /** the message builder's own `case` clauses, in source order */
    rendered: string[];
    /** kinds the graph CONSTRUCTS, from `decisionReason:{type:"…"}` bundle-wide */
    constructed: string[];
    /** constructed but never rendered by the builder's switch (it handles them before/after) */
    constructedNotRendered: string[];
    /** rendered but never constructed under a `decisionReason:` key anywhere */
    renderedNotConstructed: string[];
    builder: { chunk: string; offset: number };
  };
  /** the mode-change seam's refusals, read off the guard's own body */
  modeGuards: { chunk: string; offset: number; guarded: { mode: string; refusals: string[] }[] };
}

export function extract(modulesDir = BUNDLE_MODULES, version = ENGINE_VERSION): PermissionSurfaceFixture {
  const chunks = readChunks(modulesDir);

  // ---- 1. modes ------------------------------------------------------------
  const modeCandidates: { chunk: string; offset: number; members: string[] }[] = [];
  for (const c of chunks) {
    for (const a of stringArrays(c)) {
      if (a.members.length < MIN_MODES) continue;
      if (!MODE_SEEDS.every((s) => a.members.includes(s))) continue;
      modeCandidates.push({ chunk: c.file, offset: a.offset, members: a.members });
    }
  }
  if (modeCandidates.length === 0) throw new Error("no permission-mode enumeration found: no string array of >=4 members carries both seeds");
  const widest = Math.max(...modeCandidates.map((c) => c.members.length));
  const maximal = modeCandidates.filter((c) => c.members.length === widest);
  const canonical = [...maximal[0].members];
  for (const c of maximal) {
    const same = c.members.length === canonical.length && c.members.every((m) => canonical.includes(m));
    if (!same) {
      throw new Error(
        `permission-mode enumerations DISAGREE at this pin: ${JSON.stringify(canonical)} vs ${JSON.stringify(c.members)} (${c.chunk}@${c.offset}). ` +
          `Two maximal candidates with different membership means the shape no longer identifies one enumeration — re-derive before trusting the matrix's axis.`,
      );
    }
  }
  const modeComparands = new Set([...comparands(chunks, "mode"), ...comparands(chunks, "permissionMode")]);
  const confirmedModes = canonical.filter((m) => modeComparands.has(m));
  if (confirmedModes.length !== canonical.length) {
    throw new Error(
      `permission-mode enumeration NOT confirmed: ${canonical.filter((m) => !modeComparands.has(m)).join(", ")} never appear in ` +
        `\`mode\`/\`permissionMode\` comparison position anywhere in the bundle. The array found by shape is not the mode enumeration.`,
    );
  }

  // upstream's own semantics, from the schema's describe(): `'x' - Sentence.`
  //
  // The prose is taken from the STRING LITERAL, isolated first, rather than
  // scanned for in the raw chunk: two of the sentences contain an apostrophe of
  // their own ("Don't prompt for permissions"), so a regex that treats `'` as
  // the delimiter silently truncates them.
  const semantics: Record<string, string> = {};
  for (const c of chunks) {
    for (const doc of describeStrings(c)) {
      if (!canonical.every((m) => doc.includes(`'${m}' - `))) continue;
      for (const m of doc.matchAll(/'([A-Za-z]+)' - ([\s\S]*?)(?= '[A-Za-z]+' - |$)/g)) {
        if (!canonical.includes(m[1])) continue;
        const text = m[2].replace(/\s+/g, " ").trim().replace(/[.\s]*$/, ".");
        if (!(m[1] in semantics) || text.length > semantics[m[1]].length) semantics[m[1]] = text;
      }
    }
  }
  const missingSemantics = canonical.filter((m) => !(m in semantics));
  if (missingSemantics.length > 0) {
    throw new Error(
      `permission-mode semantics incomplete: no describe() text found for ${missingSemantics.join(", ")}. ` +
        `Upstream documents every mode in the schema it declares them in; a gap means the describe() shape moved.`,
    );
  }

  // ---- 2. rule behaviors and destinations ----------------------------------
  const behaviorComparands = comparands(chunks, "ruleBehavior");
  const behaviorSources: { chunk: string; offset: number }[] = [];
  let behaviors: string[] = [];
  for (const c of chunks) {
    for (const a of stringArrays(c)) {
      if (a.members.length < 2 || !a.members.every((m) => behaviorComparands.has(m))) continue;
      if (!a.members.includes("allow") || !a.members.includes("deny")) continue;
      if (a.members.length > behaviors.length) {
        behaviors = [...a.members];
        behaviorSources.length = 0;
      }
      if (a.members.length === behaviors.length) behaviorSources.push({ chunk: c.file, offset: a.offset });
    }
  }
  if (behaviors.length === 0) throw new Error("no rule-behavior enumeration found");

  const destinationComparands = new Set([...comparands(chunks, "destination"), ...comparands(chunks, "source")]);
  const destinationSources: { chunk: string; offset: number }[] = [];
  let destinations: string[] = [];
  for (const c of chunks) {
    for (const a of stringArrays(c)) {
      if (a.members.length < 3 || !a.members.every((m) => destinationComparands.has(m))) continue;
      if (!a.members.includes("localSettings") || !a.members.includes("userSettings")) continue;
      if (a.members.length > destinations.length) {
        destinations = [...a.members];
        destinationSources.length = 0;
      }
      if (a.members.length === destinations.length) destinationSources.push({ chunk: c.file, offset: a.offset });
    }
  }
  if (destinations.length === 0) throw new Error("no rule-destination enumeration found");

  // ---- 3. decisionReason kinds --------------------------------------------
  const builderChunk = chunks.find((c) => c.text.includes(MESSAGE_BUILDER_ANCHOR));
  if (!builderChunk) throw new Error(`the permission-message builder's anchor (${MESSAGE_BUILDER_ANCHOR}) is gone from the bundle`);
  const builder = bodyCarrying(builderChunk, MESSAGE_BUILDER_ANCHOR);
  if (!builder) throw new Error("the permission-message builder's anchor resolved to no enclosing function");
  const rendered = switchCases(builder.source);
  // The classifier kind is handled BEFORE the switch (its message has a
  // different shape), so it is a rendered kind the case list does not carry.
  for (const m of builder.source.matchAll(/type==="([A-Za-z]+)"/g)) if (!rendered.includes(m[1])) rendered.push(m[1]);
  if (rendered.length === 0) throw new Error("the permission-message builder carries no case clauses — its shape moved");

  const constructed = new Set<string>();
  for (const c of chunks) for (const m of c.text.matchAll(/decisionReason:\{type:"([A-Za-z]+)"/g)) constructed.add(m[1]);

  // ---- 4. the mode-change guard's refusals ---------------------------------
  const guardChunk = chunks.find((c) => c.text.includes(MODE_GUARD_ANCHOR));
  if (!guardChunk) throw new Error(`the mode-change guard's anchor (${MODE_GUARD_ANCHOR}) is gone from the bundle`);
  const guard = bodyCarrying(guardChunk, MODE_GUARD_ANCHOR);
  if (!guard) throw new Error("the mode-change guard's anchor resolved to no enclosing function");
  const guarded: { mode: string; refusals: string[] }[] = [];
  for (const mode of canonical) {
    // `r==="<mode>"` opens a refusal block; collect every string literal the
    // block returns as an `error`, in order.
    const at = guard.source.indexOf(`==="${mode}"`);
    if (at < 0) continue;
    const tail = guard.source.slice(at);
    const stop = canonical.map((m) => tail.indexOf(`==="${m}"`, 1)).filter((i) => i > 0);
    const block = tail.slice(0, stop.length > 0 ? Math.min(...stop) : tail.length);
    // Every refusal TEXT the block can return, in order. Not just the first
    // operand of each `error:`: two of these are ternaries whose arms are
    // different messages, and a guard that stopped emitting one of them is
    // exactly the kind of silent narrowing this fixture exists to catch. A bare
    // identifier is resolved through the chunk's own `X="…"` declaration, so a
    // refusal held in a constant is recorded as its bytes rather than its name.
    const refusals: string[] = [];
    for (const m of block.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|error:([A-Za-z_$][\w$]*)/g)) {
      if (m[3] !== undefined) {
        // A binding the guard DECLARES is a local (`let o=A7()`) whose value is
        // computed, not a message; resolving it against the chunk would find
        // some unrelated one-character minified assignment 4 MB away. Only a
        // free identifier can be a module-level refusal constant.
        const local = new RegExp(`(?:let|var|const)\\s+${m[3].replace(/\$/g, "\\$")}\\s*=`).test(guard.source);
        if (local) continue;
        const decl = guardChunk.text.match(new RegExp(`(?<![\\w$.])${m[3].replace(/\$/g, "\\$")}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        refusals.push(decl ? (JSON.parse(`"${decl[1]}"`) as string) : `<unresolved binding ${m[3]}>`);
        continue;
      }
      const text = m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2];
      // the mode names themselves and the guard's own result keys are not messages
      if (canonical.includes(text) || text.length < 12) continue;
      refusals.push(text);
    }
    if (refusals.length > 0) guarded.push({ mode, refusals });
  }
  if (guarded.length === 0) throw new Error("the mode-change guard refuses no mode — its shape moved");

  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-permission-surface.ts",
    modes: {
      names: canonical,
      semantics: Object.fromEntries(canonical.map((m) => [m, semantics[m]])),
      sources: maximal.map((c) => ({ chunk: c.chunk, offset: c.offset, members: c.members })).sort((a, b) => a.chunk.localeCompare(b.chunk)),
      confirmed: confirmedModes.length,
      comparandsNotEnumerated: [...modeComparands].filter((m) => !canonical.includes(m) && /^(default|plan|auto|dontAsk|acceptEdits|bypass)/.test(m)).sort(),
    },
    ruleBehaviors: {
      names: behaviors,
      sources: behaviorSources.sort((a, b) => a.chunk.localeCompare(b.chunk) || a.offset - b.offset),
      confirmed: behaviors.filter((b) => behaviorComparands.has(b)).length,
    },
    ruleDestinations: {
      names: destinations,
      sources: destinationSources.sort((a, b) => a.chunk.localeCompare(b.chunk) || a.offset - b.offset),
      confirmed: destinations.filter((d) => destinationComparands.has(d)).length,
    },
    decisionReasons: {
      rendered,
      constructed: [...constructed].sort(),
      constructedNotRendered: [...constructed].filter((k) => !rendered.includes(k)).sort(),
      renderedNotConstructed: rendered.filter((k) => !constructed.has(k)).sort(),
      builder: { chunk: builderChunk.file, offset: builder.offset },
    },
    modeGuards: { chunk: guardChunk.file, offset: guard.offset, guarded },
  };
}

/** The committed fixture — the matrix's axes, for the probe, the scenarios and the oracle. */
export function readFixture(version = ENGINE_VERSION): PermissionSurfaceFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as PermissionSurfaceFixture;
}

/** The mode axis, in upstream's own declaration order. */
export function permissionModes(version = ENGINE_VERSION): string[] {
  return readFixture(version).modes.names;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(`  modes (${fx.modes.names.length}, all confirmed in comparison position): ${fx.modes.names.join(", ")}`);
  console.log(`    agreeing enumerations: ${fx.modes.sources.map((s) => `${s.chunk}@${s.offset}`).join(", ")}`);
  if (fx.modes.comparandsNotEnumerated.length > 0) console.log(`    UNENUMERATED mode-shaped comparands: ${fx.modes.comparandsNotEnumerated.join(", ")}`);
  console.log(`  rule behaviors (${fx.ruleBehaviors.names.length}): ${fx.ruleBehaviors.names.join(", ")}`);
  console.log(`  rule destinations (${fx.ruleDestinations.names.length}): ${fx.ruleDestinations.names.join(", ")}`);
  console.log(`  decisionReason kinds: ${fx.decisionReasons.rendered.length} rendered, ${fx.decisionReasons.constructed.length} constructed`);
  console.log(`    constructed but not rendered: ${fx.decisionReasons.constructedNotRendered.join(", ") || "none"}`);
  console.log(`    rendered but not constructed: ${fx.decisionReasons.renderedNotConstructed.join(", ") || "none"}`);
  console.log(`  mode-change guard refuses: ${fx.modeGuards.guarded.map((g) => `${g.mode} (${g.refusals.length})`).join(", ")}`);

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-permission-surface.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
