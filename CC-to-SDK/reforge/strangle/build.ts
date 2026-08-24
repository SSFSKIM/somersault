// M3-B — manifest-driven strangler build: produce build/cli-strangled.js from
// the PRISTINE extracted payload by excising each manifest method and delegating
// it into globalThis.__reforge, with reforge-owned module source injected as a
// prelude INSIDE the payload's CJS wrapper (the leading `// @bun @bytecode
// @bun-cjs` banner must stay byte-first — prepending anything disables the
// bundle silently: exit 0, no output).
//
//   npx tsx strangle/build.ts [--sabotage <name>|all]
//
// Anchoring rules (measured in M2a):
//  - anchors are TRUE-SUBSTRING-unique ("grep -c" counts lines and lies on this
//    effectively-one-line payload — count substrings)
//  - closure identifiers a method captures are RE-DERIVED from the matched body,
//    never hardcoded, so a version catch-up stays mechanical
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REFORGE_ROOT } from "../src/runTurn.js";

const PAYLOAD = "/Users/new/claude-code-bundle/2.1.241/modules/cli";
const METHOD = "mapToolResultToToolResultBlockParam";

interface Splice {
  /** key on globalThis.__reforge AND the modules/<name>[.sabotage].js basename */
  name: string;
  /** true-substring-unique anchor inside the target method's body */
  anchor: string;
  /** delegation export name on globalThis.__reforge */
  fn: string;
  /**
   * Derive closure-captured identifiers from the original method body, to be
   * passed as extra delegation args. Throw if the expected shape is missing —
   * a silent [] would build a delegation that references nothing it needs.
   */
  deriveArgs?: (body: string) => string[];
  /** corpus scenarios that exercise this method (the gate's targeted red-check) */
  coverage: string[];
}

export const SPLICES: Splice[] = [
  {
    name: "write-tool-result",
    // the Edit tool has a sibling "has been updated successfully" template; the
    // `.${` tail disambiguates the Write tool's
    anchor: "has been updated successfully.${",
    fn: "writeToolResultBlock",
    deriveArgs: (body) => {
      // the freshness-suffix constant: `let s = r || n ? "" : <ident>`
      const m = body.match(/[a-zA-Z_$][\w$]*\s*=\s*[a-zA-Z_$][\w$]*\s*\|\|\s*[a-zA-Z_$][\w$]*\s*\?\s*"":\s*([a-zA-Z_$][\w$]*)/);
      if (!m) throw new Error("write-tool-result: could not derive freshness-suffix identifier");
      return [m[1]];
    },
    coverage: ["file-tools"],
  },
  {
    name: "task-create-result",
    anchor: " created successfully: ",
    fn: "taskCreateResultBlock",
    coverage: ["todo-tool"],
  },
  {
    name: "glob-result",
    anchor: 'content:"No files found"};return',
    fn: "globResultBlock",
    deriveArgs: (body) => {
      // the truncation-notice function: `...e.truncated?[<ident>(e)]:[]`
      const m = body.match(/e\.truncated\?\[([A-Za-z_$][\w$]*)\(e\)\]/);
      if (!m) throw new Error("glob-result: could not derive truncation-notice identifier");
      return [m[1]];
    },
    coverage: ["search-tools"],
  },
];

// ---- CLI --------------------------------------------------------------------
const args = process.argv.slice(2);
const sabotageIdx = args.indexOf("--sabotage");
let sabotageTarget: string | null = null; // null = faithful build
if (sabotageIdx >= 0) {
  // Require an explicit value: a missing or flag-shaped one silently meaning
  // "all" is the same ambiguity that made a bad --scenario silently run the
  // whole corpus.
  const v = args[sabotageIdx + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`ABORT: --sabotage requires a value: all, ${SPLICES.map((sp) => sp.name).join(", ")}`);
    process.exit(2);
  }
  sabotageTarget = v;
  if (sabotageTarget !== "all" && !SPLICES.some((sp) => sp.name === sabotageTarget)) {
    console.error(`ABORT: unknown splice '${sabotageTarget}'. Known: all, ${SPLICES.map((sp) => sp.name).join(", ")}`);
    process.exit(2);
  }
}

// ---- splice -----------------------------------------------------------------
function balancedEnd(s: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
    else if (ch === openCh) depth++;
    else if (ch === closeCh && --depth === 0) return i;
  }
  throw new Error("unbalanced");
}

let src = readFileSync(PAYLOAD, "utf8");
const preludes: string[] = [];

for (const sp of SPLICES) {
  const anchorIdx = src.indexOf(sp.anchor);
  if (anchorIdx < 0) throw new Error(`${sp.name}: anchor not found`);
  if (src.indexOf(sp.anchor, anchorIdx + 1) >= 0) throw new Error(`${sp.name}: anchor is not unique`);

  const methodIdx = src.lastIndexOf(METHOD, anchorIdx);
  if (methodIdx < 0 || anchorIdx - methodIdx > 2000) throw new Error(`${sp.name}: method head not found near anchor`);

  const paramsOpen = src.indexOf("(", methodIdx);
  const paramsClose = balancedEnd(src, paramsOpen, "(", ")");
  const params = src.slice(paramsOpen + 1, paramsClose);
  const bodyOpen = src.indexOf("{", paramsClose);
  const bodyClose = balancedEnd(src, bodyOpen, "{", "}");
  const original = src.slice(methodIdx, bodyClose + 1);
  if (!original.includes(sp.anchor)) throw new Error(`${sp.name}: extracted method does not contain the anchor`);

  const extraArgs = sp.deriveArgs?.(original) ?? [];
  const callArgs = [...params.split(",").map((p) => p.trim()).filter(Boolean), ...extraArgs].join(",");
  const replacement = `${METHOD}(${params}){return globalThis.__reforge.${sp.fn}(${callArgs})}`;
  src = src.slice(0, methodIdx) + replacement + src.slice(bodyClose + 1);

  const sabotaged = sabotageTarget === "all" || sabotageTarget === sp.name;
  const moduleFile = join(REFORGE_ROOT, "strangle", "modules", `${sp.name}${sabotaged ? ".sabotage" : ""}.js`);
  preludes.push(readFileSync(moduleFile, "utf8"));
  console.log(
    `spliced ${sp.name}: ${original.length} chars -> ${replacement.length}-char delegation` +
      `${extraArgs.length > 0 ? ` (derived: ${extraArgs.join(", ")})` : ""}${sabotaged ? " [SABOTAGE]" : ""}`,
  );
}

// ---- prelude injection (inside the CJS wrapper, never before the banner) ----
const WRAPPER_OPEN = "__dirname) {";
const wrapperIdx = src.indexOf(WRAPPER_OPEN);
if (wrapperIdx < 0) throw new Error("CJS wrapper opening not found — payload shape changed");
const injectAt = wrapperIdx + WRAPPER_OPEN.length;
const out = src.slice(0, injectAt) + preludes.join("\n") + src.slice(injectAt);

const outDir = join(REFORGE_ROOT, "build");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "cli-strangled.js");
writeFileSync(outFile, out);
console.log(`strangled build written: ${outFile} (${SPLICES.length} splices, variant: ${sabotageTarget ?? "faithful"})`);
