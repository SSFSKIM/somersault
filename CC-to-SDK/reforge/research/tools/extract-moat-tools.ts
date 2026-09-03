// §3.3 — snapshot the MOAT-TOOL DESCRIPTION BELT from two artifacts at once.
//
//   npx tsx research/tools/extract-moat-tools.ts [--check]
//
// WHY A FIXTURE. C11a's scope is a population — "the 16 moat-tool description
// builders that render into every graded request body" — and this campaign has
// now been wrong four times about a population it carried as a hand-written
// number (hook events, control-protocol arms, prompt sections, the hook-helper
// belt). Every one of those was fixed the same way and every fix became a gate
// phase. A wave whose whole claim is "these are the N declarations" has to be
// able to fail when N moves.
//
// TWO ARTIFACTS, NOT ONE. The W8 scout's own method note is that the recorded
// cassette bodies are an enumeration artifact and not merely a grading surface:
// they answer *what the engine actually presented*, where the bundle answers
// only *what its code could present*. So the derivation runs in both directions
// and each side confirms the other:
//
//   1. THE CORPUS SIDE. Every recorded request body's `tools` array, read off
//      `cassettes/*.jsonl`. That gives the catalog SHAPES (which tools appear
//      together, and in how many bodies), and for each tool the exact
//      description bytes the engine sent.
//   2. THE BUNDLE SIDE. For each tool's rendered description, the DECLARATIONS
//      that produce it, found by walking the rendered text in windows and
//      asking which graph declaration each window uniquely lives in. Nothing is
//      looked up by name: a window that occurs once in 1,802 modules names its
//      carrier, and a description whose windows land in two carriers HAS two
//      carriers (Workflow does; the belt's row for it says so).
//   3. THE ANCHOR. Each carrier's shortest unique untainted window, by
//      `anchor-enum.ts` — the doctrine's own rule, mechanically, rather than a
//      hand-picked sentence. W7.6a's correction was that a claim about a
//      mechanism must be measured by that mechanism's definition; this fixture
//      is where W8a inherits it.
//
// WHAT `--check` COMPARES: EVERY FIELD IT WRITES. The bundle side exactly — a
// pin bump that moves a description, re-points a builder or changes an anchor
// reddens here. The corpus side is exact on BYTES and on the catalog SHAPES, and
// a FLOOR on every count that can only grow, deliberately: C11b adds nine to
// eleven recordings and C11c/C11d more, and a fixture that fails every time the
// corpus GROWS is a tax on every later wave. Growth is fine; drift is not.
//
// "Every field" is the correction rather than the design. The first version
// compared the per-tool rows and the bundle half, so `counts`, `catalogs` and
// `outsideW8` were stated and never read — and `bodiesWithTools` was four bodies
// stale while this tool printed PASS and printed the stale number in the same
// breath. EVERY NUMBER A FIXTURE STATES IS A CLAIM, and a claim nothing compares
// is prose that looks like evidence.
//
// WHAT THIS IS NOT. The full tool catalog — `Y0()`'s 67 elements with a guard
// expression apiece — is C11b's `tool-catalog-<pin>.json` and deliberately not
// here. This fixture answers one narrower question: which declarations does the
// description belt have to own, and what does the corpus already grade them on.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";
import { freeIdentifiers } from "../../strangle/scope.js";
import { anchorFor, bundle, exactScans, resetExactScans, type AnchorMeasurement } from "./anchor-enum.js";
import { ENGINE_PROMPT_SCRUBS } from "../../src/canonical.js";

/** The shared engine-prose clock scrub (src/canonical.ts), applied to a rendered description. */
const applyEnginePromptScrubs = (text: string): string => ENGINE_PROMPT_SCRUBS.reduce((acc, [re, to]) => acc.replace(re, to), text);

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `moat-tools-${version}.json`);
const CASSETTE_DIR = join(TOOL_DIR, "..", "..", "cassettes");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * THE W8 TOOL SET, as the campaign's cut names it — and the ONE list in this
 * tool that is written down rather than derived.
 *
 * It is a scope statement, not a measurement: the ledger assigns C11 these
 * twenty rows, and `WebFetch`/`WebSearch`/`Skill`/`Agent`/`Bash`/the file tools
 * are other waves' even though they sit in the same catalog. So it is checked
 * rather than trusted — every name here must be present in the recorded corpus
 * (or the extractor throws), and the corpus side additionally reports every
 * OTHER tool it saw, so a catalog that grows a moat tool is visible rather than
 * silently outside the list.
 */
const W8_TOOLS = [
  "AskUserQuestion", "CronCreate", "CronDelete", "CronList", "EnterPlanMode", "EnterWorktree",
  "ExitPlanMode", "ExitWorktree", "ListAgents", "RemoteTrigger", "ReportFindings", "ScheduleWakeup",
  "SendMessage", "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "TaskUpdate", "Workflow",
] as const;

/**
 * How the rendered description is cut into locator windows.
 *
 * A window has to be long enough to be unique in 34 MB of minified source and
 * short enough that an interpolation boundary does not swallow a whole builder.
 * 48 characters with a 24-character stride was chosen by measurement: it
 * attributes every byte of seventeen of the twenty descriptions to a single
 * carrier, and the three it splits are exactly the three whose `prompt` composes
 * more than one declaration.
 */
const WINDOW = 48;
const STRIDE = 24;

/** The bundle escapes every non-ASCII character; an anchor must be written the same way (scout §3a). */
const escapeNonAscii = (s: string) => s.replace(/[^\x00-\x7F]/g, (c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`);

/**
 * THE WAYS THE BUNDLE COULD HAVE WRITTEN THESE CHARACTERS — every quoting style,
 * because a search over SOURCE is a search through a quoting layer.
 *
 * W8a's anchor lesson was "quoting is an escape layer": the same sentence reads
 * `user's` inside a double-quoted literal and `user\'s` inside a single-quoted
 * one, so an anchor counted in one style can be unique and point at the wrong
 * file. The same rule holds for THIS search, and it fails worse here. A window
 * written in one style does not merely miss its producer — it can match some
 * other declaration that happens to quote the other way, and the fixture then
 * records a NON-PRODUCER as a carrier. ScheduleWakeup's offset-1488 window did
 * exactly that: its builder single-quotes the apostrophe, so the raw needle
 * missed the builder and matched the tool's own zod `.describe(…)` copy instead,
 * and the fixture grew a third "carrier" that is the memoized schema getter.
 *
 * So a window is searched for as each style would render it: the enclosing
 * quote, the backslash and every non-ASCII character escaped, plus the control
 * characters for the two QUOTED styles — a template literal carries its newlines
 * literally, which is why they get a form of their own rather than a shared one.
 * Hits are summed over the forms, so a sentence that occurs once per style stays
 * AMBIGUOUS rather than being attributed to whichever style was tried first.
 */
const sourceForms = (s: string): string[] => {
  const escaped = escapeNonAscii(s).replace(/\\(?!u[0-9a-f]{4})/g, "\\\\");
  const controls = (t: string) => t.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return [
    ...new Set([
      controls(escaped).replace(/'/g, "\\'"),
      controls(escaped).replace(/"/g, '\\"'),
      escaped.replace(/`/g, "\\`").replace(/\$\{/g, "\\${"),
    ]),
  ];
};

export interface CatalogShape {
  /** the tool names, sorted as the engine sorts them */
  tools: string[];
  /** request bodies carrying exactly this catalog */
  bodies: number;
  /** cassette files carrying it */
  files: number;
}

export interface Carrier {
  /** graph module the declaration lives in */
  chunk: string;
  /** minified binding name — recorded for humans, never used to find anything */
  name: string;
  kind: string;
  bytes: number;
  offset: number;
  /** the excision shape a manifest row would declare for it */
  shape: "free-function" | "variable-declarator" | "sibling-method" | "other";
  /** free variables of the declaration — the capture inventory a row owes */
  free: string[];
  /** is the initializer a plain literal, i.e. can the build compare its VALUE? */
  literalValued: boolean | null;
  anchor: AnchorMeasurement | null;
  /** locator windows of the rendered description attributed to this carrier */
  windows: number;
}

export interface ToolRow {
  name: string;
  /** exact bytes of the description the engine sent */
  renderedBytes: number;
  renderedSha256: string;
  /**
   * The `input_schema` the same bodies carried, as canonical JSON.
   *
   * Recorded but NOT spliced by C11a: the schema is a zod object built by a
   * memoized getter, so owning it means owning a zod construction rather than a
   * string, and the belt's argument (prose is the behaviour, and a value that
   * moves while its name stays put is invisible to everything else) does not
   * carry over unchanged. The bytes are here so the deferral has a size.
   */
  schemaBytes: number;
  schemaSha256: string;
  /** cassette files carrying this tool — a FLOOR, because the corpus grows */
  cassetteFilesAtLeast: number;
  /** distinct description texts seen across the corpus (1 for every W8 tool at this pin) */
  variants: number;
  /** windows the locator could place, of the windows it tried */
  located: number;
  windows: number;
  carriers: Carrier[];
}

export interface FormatterRow {
  /** the tool whose `mapToolResultToToolResultBlockParam` this is */
  tool: string;
  chunk: string;
  bytes: number;
  offset: number;
  free: string[];
  anchor: AnchorMeasurement | null;
  /** the manifest row that already owns it, when one does */
  ownedBy: string | null;
}

export interface MoatFixture {
  engineVersion: string;
  generatedBy: string;
  counts: {
    graphModules: number;
    cassetteFiles: number;
    bodiesWithTools: number;
    catalogShapes: number;
    /** tools in the catalog the most recorded bodies carry — the headless baseline */
    baselineCatalog: number;
    w8Tools: number;
    /** of the W8 tools, how many the corpus never EXECUTES (description-and-schema only) */
    describedOnly: number;
    carriers: number;
    carriersAnchorable: number;
    descriptionBytes: number;
    anchorScans: number;
  };
  /** every catalog shape the corpus recorded, largest first */
  catalogs: CatalogShape[];
  /** tools the corpus presented that are NOT in the W8 set — other waves' rows, listed so the boundary is visible */
  outsideW8: { name: string; renderedBytes: number; variants: number }[];
  tools: ToolRow[];
  formatters: FormatterRow[];
}

// ---- the corpus side --------------------------------------------------------

interface CorpusFacts {
  files: number;
  bodies: number;
  shapes: CatalogShape[];
  /** tool -> description text -> cassette files */
  byTool: Map<string, Map<string, Set<string>>>;
  /** tool -> canonical input_schema JSON, from the same bodies */
  schemas: Map<string, string>;
}

function readCorpus(): CorpusFacts {
  // RECORDED cassettes only, and the exclusion is PATTERN-EXACT rather than a
  // substring. A replay writes `<base>-observed-A|A2|B.jsonl` beside the
  // cassette it replayed, so the directory carries about three of those per
  // recording and a count over the whole directory would depend on how many
  // times someone ran the gate rather than on what the corpus contains.
  //
  // The first version of this filter dropped every name CONTAINING `-observed-`
  // and silently took seventeen files with it: `m3-flip-observed-*` (fifteen
  // flip-liveness measurements, including the ONE cassette in which `PowerShell`
  // is presented at all) and `m2-xresume-observed-*` (two) share the substring
  // for an unrelated reason. A population defined by a substring is a population
  // whose boundary nobody has looked at.
  //
  // They are OBSERVATION DUMPS, not record-mode cassettes — a replay proxy wrote
  // them from what the engine actually sent while replaying one — and they are
  // in the corpus for that reason and not by being recordings: the bodies are
  // real bodies from a real engine, which is all the presentation side asks. The
  // distinction is worth keeping because it is exactly what made them dangerous:
  // a dump is written per RUN, so one that is appended to instead of replaced
  // makes the denominator a function of how often the gate ran (see
  // `startReplayProxy`, which now truncates).
  const REPLAY_BYPRODUCT = /-observed-(A|A2|B)\.jsonl$/;
  const files = readdirSync(CASSETTE_DIR).filter((f) => f.endsWith(".jsonl") && !REPLAY_BYPRODUCT.test(f)).sort();
  const shapes = new Map<string, { bodies: number; files: Set<string>; tools: string[] }>();
  const byTool = new Map<string, Map<string, Set<string>>>();
  const schemas = new Map<string, string>();
  let bodies = 0;
  for (const f of files) {
    for (const line of readFileSync(join(CASSETTE_DIR, f), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let rec: { requestBody?: string };
      try {
        rec = JSON.parse(line) as { requestBody?: string };
      } catch {
        continue;
      }
      if (!rec.requestBody) continue;
      let body: { tools?: { name: string; description?: string; input_schema?: unknown }[] };
      try {
        body = JSON.parse(rec.requestBody) as { tools?: { name: string; description?: string; input_schema?: unknown }[] };
      } catch {
        continue;
      }
      if (!Array.isArray(body.tools) || body.tools.length === 0) continue;
      bodies++;
      const names = body.tools.map((t) => t.name).sort();
      const key = names.join(" ");
      const shape = shapes.get(key) ?? { bodies: 0, files: new Set<string>(), tools: names };
      shape.bodies++;
      shape.files.add(f);
      shapes.set(key, shape);
      for (const t of body.tools) {
        const per = byTool.get(t.name) ?? new Map<string, Set<string>>();
        // THE SHARED CLOCK RULE, applied here for the same reason the replay
        // hash applies it (C12a/W9a). WebSearch's description renders THE CURRENT
        // MONTH ("The current month is August 2026"), so a corpus recorded across
        // a month boundary carries two byte-different descriptions for a tool
        // nothing changed — and this fixture compares its bytes EXACTLY. The
        // proxy has scrubbed that sentence since C10.6-fix; a fixture that did
        // not was measuring a calendar. Measured on 2026-09-03: four recordings
        // taken in September reddened this phase against 51 bodies recorded in
        // August, 1,319 B against 1,322 B, entirely on the month name.
        const description = applyEnginePromptScrubs(t.description ?? "");
        const seen = per.get(description) ?? new Set<string>();
        seen.add(f);
        per.set(description, seen);
        byTool.set(t.name, per);
        if (!schemas.has(t.name)) schemas.set(t.name, JSON.stringify(t.input_schema ?? null));
      }
    }
  }
  if (bodies === 0) throw new Error(`no recorded request bodies under ${CASSETTE_DIR} — the corpus side cannot be derived`);
  return {
    files: files.length,
    bodies,
    shapes: [...shapes.values()].sort((a, b) => b.tools.length - a.tools.length || b.bodies - a.bodies)
      .map((s) => ({ tools: s.tools, bodies: s.bodies, files: s.files.size })),
    byTool,
    schemas,
  };
}

// ---- the bundle side --------------------------------------------------------

const AST = new Map<string, ts.SourceFile>();
function astOf(file: string, text: string): ts.SourceFile {
  let sf = AST.get(file);
  if (sf === undefined) {
    sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    AST.set(file, sf);
  }
  return sf;
}

/**
 * The declaration that OWNS the byte at `at` — which is not the innermost one.
 *
 * A carrier is a unit a manifest row could excise, and a builder's local
 * `const o = …` is not one: it is a declaration and it does contain the bytes,
 * but nothing can splice it on its own, because excising the enclosing function
 * takes it along. Reading the innermost declaration made CronCreate look
 * composed of three declarations and SendMessage of two when each has a single
 * producer, and "this description has three carriers" is a claim about the
 * SPLICE surface rather than about the AST.
 *
 * So the walk keeps the OUTERMOST declaration containing the byte, with the one
 * exception the campaign's own splice shapes require: a method of an object
 * literal IS independently excisable — that is what the S-method transform does,
 * and TaskOutput's description is owned that way — so an object-literal member
 * wins over the declarator that holds the object.
 */
function carrierAt(sf: ts.SourceFile, at: number): ts.Node | null {
  const enclosing: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (n.getStart(sf) > at || at >= n.getEnd()) return;
    if (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) enclosing.push(n);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  if (enclosing.length === 0) return null;
  const member = [...enclosing].reverse().find((n) => ts.isMethodDeclaration(n) && ts.isObjectLiteralExpression(n.parent));
  return member ?? enclosing[0];
}

function shapeOf(n: ts.Node): Carrier["shape"] {
  if (ts.isFunctionDeclaration(n)) return "free-function";
  if (ts.isVariableDeclaration(n)) return "variable-declarator";
  if (ts.isMethodDeclaration(n)) {
    return ts.isObjectLiteralExpression(n.parent) ? "sibling-method" : "other";
  }
  return "other";
}

/**
 * Can the build compare this declarator's VALUE against upstream's bytes?
 *
 * `null` for anything that is not a declarator — the question does not arise —
 * and the same narrow reading of "literal" `strangle/ast.ts` uses, because that
 * is the code that will refuse the row.
 */
function literalValued(n: ts.Node): boolean | null {
  if (!ts.isVariableDeclaration(n) || n.initializer === undefined) return null;
  const lit = (e: ts.Node): boolean => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true;
    if (ts.isTemplateExpression(e)) return e.templateSpans.every((s) => lit(s.expression));
    if (ts.isParenthesizedExpression(e)) return lit(e.expression);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return lit(e.left) && lit(e.right);
    return false;
  };
  return lit(n.initializer);
}

/**
 * Which declarations produce `rendered`, by locating its own text in the graph.
 *
 * The rendered description is the artifact; the graph is searched for it rather
 * than the other way round. A window that occurs exactly once names its carrier
 * outright; a window that occurs zero times fell across an interpolation, and a
 * window that occurs many times is prose too generic to place. Both are counted,
 * so `located / windows` is the derivation's own confidence rather than a claim.
 *
 * "Occurs once" is counted over every SOURCE FORM the window could have (see
 * `sourceForms`) and resolved to the OWNING declaration (see `carrierAt`), which
 * is what makes the count a statement about producers rather than about quoting
 * accidents and local bindings.
 */
function carriersFor(rendered: string): { carriers: Map<ts.Node, { file: string; hits: number }>; located: number; windows: number } {
  const graph = bundle();
  const carriers = new Map<ts.Node, { file: string; hits: number }>();
  let located = 0;
  let windows = 0;
  for (let i = 0; i + WINDOW <= rendered.length; i += STRIDE) {
    windows++;
    const needles = sourceForms(rendered.slice(i, i + WINDOW));
    let hitFile: string | null = null;
    let hitAt = -1;
    let hits = 0;
    for (const m of graph) {
      for (const needle of needles) {
        let at = m.text.indexOf(needle);
        while (at >= 0) {
          hits++;
          if (hits > 1) break;
          hitFile = m.file;
          hitAt = at;
          at = m.text.indexOf(needle, at + 1);
        }
        if (hits > 1) break;
      }
      if (hits > 1) break;
    }
    if (hits !== 1 || hitFile === null) continue;
    const text = graph.find((m) => m.file === hitFile)!.text;
    const node = carrierAt(astOf(hitFile, text), hitAt);
    if (node === null) continue;
    located++;
    const prev = carriers.get(node) ?? { file: hitFile, hits: 0 };
    prev.hits++;
    carriers.set(node, prev);
  }
  return { carriers, located, windows };
}

function describeCarrier(node: ts.Node, file: string, hits: number): Carrier {
  const text = bundle().find((m) => m.file === file)!.text;
  const sf = astOf(file, text);
  const { anchor } = anchorFor(node, sf, text);
  const name = (node as ts.NamedDeclaration).name;
  return {
    chunk: file,
    name: name && ts.isIdentifier(name) ? name.text : ts.isMethodDeclaration(node) ? node.name.getText(sf) : "<anonymous>",
    kind: ts.SyntaxKind[node.kind],
    bytes: node.getEnd() - node.getStart(sf),
    offset: node.getStart(sf),
    shape: shapeOf(node),
    free: freeIdentifiers(node).sort(),
    literalValued: literalValued(node),
    anchor,
    windows: hits,
  };
}

/**
 * The `mapToolResultToToolResultBlockParam` members of the W8 tool objects.
 *
 * Found by shape rather than by name: every one of them is a two-parameter
 * method of an object literal that also declares `prompt` and `userFacingName`,
 * which is the tool-object shape the campaign has been splicing since W1. The
 * tool's own name comes from the same object's `name` property, resolved one hop
 * through the chunk's declarations and its import list.
 */
function formatters(ownedBy: ReadonlyMap<string, string>): FormatterRow[] {
  const rows: FormatterRow[] = [];
  for (const { file, text } of bundle()) {
    if (!text.includes("mapToolResultToToolResultBlockParam")) continue;
    const sf = astOf(file, text);
    const localStrings = new Map<string, string>();
    const importedFrom = new Map<string, { from: string; name: string }>();
    ts.forEachChild(sf, (n) => {
      if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteral(d.initializer)) localStrings.set(d.name.text, d.initializer.text);
        }
      }
      if (ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
        const from = (n.moduleSpecifier as ts.StringLiteral).text.split("/").pop()!;
        for (const el of n.importClause.namedBindings.elements) {
          importedFrom.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
        }
      }
    });
    const resolveName = (e: ts.Expression): string | null => {
      if (ts.isStringLiteral(e)) return e.text;
      if (!ts.isIdentifier(e)) return null;
      const local = localStrings.get(e.text);
      if (local !== undefined) return local;
      const imp = importedFrom.get(e.text);
      if (imp === undefined) return null;
      const other = bundle().find((m) => m.file === imp.from);
      if (other === undefined) return null;
      const osf = astOf(other.file, other.text);
      let out: string | null = null;
      ts.forEachChild(osf, (n) => {
        if (!ts.isVariableStatement(n)) return;
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === imp.name && d.initializer && ts.isStringLiteral(d.initializer)) out = d.initializer.text;
        }
      });
      return out;
    };
    const visit = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        const props = new Map(n.properties.filter((p) => p.name !== undefined).map((p) => [p.name!.getText(sf), p]));
        const fmt = props.get("mapToolResultToToolResultBlockParam");
        const nameProp = props.get("name");
        if (fmt !== undefined && props.has("prompt") && nameProp !== undefined && ts.isPropertyAssignment(nameProp)) {
          const tool = resolveName(nameProp.initializer);
          if (tool !== null && (W8_TOOLS as readonly string[]).includes(tool)) {
            const { anchor } = anchorFor(fmt, sf, text);
            rows.push({
              tool,
              chunk: file,
              bytes: fmt.getEnd() - fmt.getStart(sf),
              offset: fmt.getStart(sf),
              free: freeIdentifiers(fmt).sort(),
              anchor,
              ownedBy: ownedBy.get(tool) ?? null,
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return rows.sort((a, b) => a.tool.localeCompare(b.tool));
}

/**
 * The manifest rows that already own a W8 formatter — recorded so the fixture
 * says which of the scout's "zero-capture formatters" are new work.
 *
 * Written here rather than imported from the manifest on purpose: importing it
 * would make a research fixture depend on the splice surface it exists to
 * measure, and the point of the column is to catch the manifest and the scout
 * disagreeing.
 */
const ALREADY_OWNED = new Map<string, string>([
  ["TaskCreate", "task-create-result"],
  ["TaskGet", "task-get-result"],
  ["TaskList", "task-list-result"],
  ["TaskUpdate", "task-update-result"],
]);

export function extract(version = ENGINE_VERSION): MoatFixture {
  resetExactScans();
  const corpus = readCorpus();
  const tools: ToolRow[] = [];
  let descriptionBytes = 0;
  for (const name of W8_TOOLS) {
    const per = corpus.byTool.get(name);
    if (per === undefined) throw new Error(`${name}: the W8 set names a tool no recorded request body presents — the scope statement and the corpus disagree`);
    const [rendered, seenIn] = [...per].sort((a, b) => b[1].size - a[1].size)[0];
    descriptionBytes += rendered.length;
    const { carriers, located, windows } = carriersFor(rendered);
    tools.push({
      name,
      renderedBytes: rendered.length,
      renderedSha256: sha256(rendered),
      schemaBytes: (corpus.schemas.get(name) ?? "").length,
      schemaSha256: sha256(corpus.schemas.get(name) ?? ""),
      cassetteFilesAtLeast: seenIn.size,
      variants: per.size,
      located,
      windows,
      carriers: [...carriers].map(([node, hit]) => describeCarrier(node, hit.file, hit.hits)).sort((a, b) => b.windows - a.windows),
    });
  }
  const w8 = new Set<string>(W8_TOOLS);
  const outsideW8 = [...corpus.byTool].filter(([n]) => !w8.has(n)).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([n, per]) => {
      const [rendered] = [...per].sort((a, b) => b[1].size - a[1].size)[0];
      return { name: n, renderedBytes: rendered.length, variants: per.size };
    });
  const fmt = formatters(ALREADY_OWNED);
  const baseline = [...corpus.shapes].sort((a, b) => b.bodies - a.bodies)[0].tools.length;
  const allCarriers = tools.flatMap((t) => t.carriers);
  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-moat-tools.ts",
    counts: {
      graphModules: bundle().length,
      cassetteFiles: corpus.files,
      bodiesWithTools: corpus.bodies,
      catalogShapes: corpus.shapes.length,
      baselineCatalog: baseline,
      w8Tools: W8_TOOLS.length,
      describedOnly: tools.filter((t) => ALREADY_OWNED.get(t.name) === undefined).length,
      carriers: allCarriers.length,
      carriersAnchorable: allCarriers.filter((c) => c.anchor !== null).length,
      descriptionBytes,
      anchorScans: exactScans(),
    },
    catalogs: corpus.shapes,
    outsideW8,
    tools,
    formatters: fmt,
  };
}

export function readFixture(version = ENGINE_VERSION): MoatFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as MoatFixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const body = `${JSON.stringify(fx, null, 2)}\n`;

  console.log(`pin: ${fx.engineVersion}`);
  console.log(
    `  corpus: ${fx.counts.bodiesWithTools} request bodies over ${fx.counts.cassetteFiles} cassettes, ` +
      `${fx.counts.catalogShapes} distinct catalogs, baseline ${fx.counts.baselineCatalog} tools`,
  );
  console.log(
    `  belt: ${fx.counts.w8Tools} W8 tools, ${fx.counts.describedOnly} with no owned formatter, ` +
      `${fx.counts.descriptionBytes} description bytes + ${fx.tools.reduce((n, t) => n + t.schemaBytes, 0)} schema bytes rendered`,
  );
  console.log(
    `  carriers: ${fx.counts.carriers} declarations produce them, ${fx.counts.carriersAnchorable} anchorable ` +
      `(shortest unique untainted window over ${fx.counts.graphModules} modules, ${fx.counts.anchorScans} exact scans)`,
  );
  const split = fx.tools.filter((t) => t.carriers.length > 1);
  console.log(`  composed of more than one declaration: ${split.length === 0 ? "none" : split.map((t) => `${t.name}=${t.carriers.length}`).join(", ")}`);
  const owned = fx.formatters.filter((f) => f.ownedBy !== null);
  console.log(`  formatters: ${fx.formatters.length} W8 result formatters, ${owned.length} already owned (${owned.map((f) => f.ownedBy).join(", ")})`);

  if (!checkOnly) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, body);
    console.log(`wrote ${out}`);
    process.exit(0);
  }
  if (!existsSync(out)) {
    console.log(`FAIL — no committed fixture at ${out}`);
    process.exit(1);
  }
  const committed = JSON.parse(readFileSync(out, "utf8")) as MoatFixture;
  const problems: string[] = [];
  // The corpus half is a FLOOR on counts and exact on bytes: later waves record
  // more cassettes, and a fixture that reddens on growth taxes every one of them.
  const grown = new Map(fx.tools.map((t) => [t.name, t]));
  for (const t of committed.tools) {
    const now = grown.get(t.name);
    if (now === undefined) {
      problems.push(`${t.name}: no longer presented by any recorded request body`);
      continue;
    }
    if (now.renderedSha256 !== t.renderedSha256) problems.push(`${t.name}: the rendered description changed (${t.renderedBytes} B -> ${now.renderedBytes} B)`);
    if (now.schemaSha256 !== t.schemaSha256) problems.push(`${t.name}: the rendered input_schema changed (${t.schemaBytes} B -> ${now.schemaBytes} B)`);
    if (now.cassetteFilesAtLeast < t.cassetteFilesAtLeast) {
      problems.push(`${t.name}: presented in ${now.cassetteFilesAtLeast} cassettes, below the recorded floor of ${t.cassetteFilesAtLeast}`);
    }
  }
  // EVERY NUMBER THIS FIXTURE STATES IS COMPARED, and the ones that can only grow
  // are compared as FLOORS. The first version compared the per-tool rows and the
  // bundle half and nothing else, so `counts`, `catalogs` and `outsideW8` were
  // written down and then never read: `bodiesWithTools` sat at a value four
  // request bodies stale while `--check` printed PASS, because the check could
  // not see the field it was printing. A fixture that compares a subset of its
  // own fields is a fixture whose other fields are prose.
  const floor = (label: string, now: number, was: number): void => {
    if (now < was) problems.push(`${label}: ${now}, below the recorded floor of ${was}`);
  };
  floor("cassetteFiles", fx.counts.cassetteFiles, committed.counts.cassetteFiles);
  floor("bodiesWithTools", fx.counts.bodiesWithTools, committed.counts.bodiesWithTools);
  floor("catalogShapes", fx.counts.catalogShapes, committed.counts.catalogShapes);
  // The rest of `counts` is EXACT, including `baselineCatalog`: "the catalog the
  // most bodies carry is 22 tools" is a claim the wave's documents quote, and a
  // corpus that moves it has moved something every one of them says.
  for (const k of ["graphModules", "baselineCatalog", "w8Tools", "describedOnly", "carriers", "carriersAnchorable", "descriptionBytes", "anchorScans"] as const) {
    if (fx.counts[k] !== committed.counts[k]) problems.push(`counts.${k}: ${committed.counts[k]} -> ${fx.counts[k]}`);
  }
  // A recorded catalog SHAPE may gain bodies and files; it may not vanish. (A
  // NEW shape is growth and passes — that is C11b recording a tool.)
  const shapeNow = new Map(fx.catalogs.map((c) => [c.tools.join(" "), c]));
  for (const c of committed.catalogs) {
    const now = shapeNow.get(c.tools.join(" "));
    if (now === undefined) {
      problems.push(`catalog shape of ${c.tools.length} tools (${c.tools.slice(0, 3).join(", ")}…) is no longer recorded by any body`);
      continue;
    }
    floor(`catalog[${c.tools.length} tools].bodies`, now.bodies, c.bodies);
    floor(`catalog[${c.tools.length} tools].files`, now.files, c.files);
  }
  // The tools OUTSIDE the W8 set are the boundary of this wave's scope, so they
  // are checked the same way the inside is: present, and byte-identical.
  const outsideNow = new Map(fx.outsideW8.map((o) => [o.name, o]));
  for (const o of committed.outsideW8) {
    const now = outsideNow.get(o.name);
    if (now === undefined) problems.push(`${o.name}: outside the W8 set and no longer presented by any recorded body`);
    else if (now.renderedBytes !== o.renderedBytes) problems.push(`${o.name} (outside W8): the rendered description changed (${o.renderedBytes} B -> ${now.renderedBytes} B)`);
  }
  // The bundle half is exact.
  // The exact half. `cassetteFilesAtLeast` is a floor and is compared above;
  // `variants` is dropped for the same reason — a later wave recording a lean
  // model would add a second description text for a tool without anything
  // having drifted, and a fixture that reddens on corpus GROWTH taxes every
  // wave after it. The DOMINANT variant's bytes and sha stay exact.
  const bundleSide = (f: MoatFixture) =>
    JSON.stringify({ tools: f.tools.map((t) => ({ ...t, cassetteFilesAtLeast: 0, variants: 0 })), formatters: f.formatters });
  if (bundleSide(fx) !== bundleSide(committed)) problems.push("the bundle-derived half (carriers, anchors, captures, formatters) differs from the committed fixture");
  if (problems.length > 0) {
    for (const p of problems) console.log(`  FAIL  ${p}`);
    console.log(`FAIL — regenerate with: npx tsx research/tools/extract-moat-tools.ts`);
    process.exit(1);
  }
  console.log("PASS — committed fixture matches the pinned bundle and the recorded corpus");
}
