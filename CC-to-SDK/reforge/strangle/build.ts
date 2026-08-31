// Manifest-driven strangler build: materialize a runnable copy of the PINNED
// extraction, excise each manifest method from whichever chunk owns it, and
// delegate it into `globalThis.__reforge`.
//
//   npx tsx strangle/build.ts [--sabotage <name>|all]
//
// Anchoring rules (measured in M2a, re-confirmed by the 2.1.241 → 2.1.251 bump):
//  - anchors are TRUE-SUBSTRING-unique across the WHOLE graph ("grep -c" counts
//    lines and lies on these effectively-one-line chunks — count substrings)
//  - closure identifiers a method captures are RE-DERIVED from the matched body,
//    never hardcoded. This is what makes a version catch-up mechanical: across
//    the bump all three method bodies were byte-identical modulo minified names
//    (the write tool's freshness suffix went `hui` → `q6t`, glob's truncation
//    notice `yzv` → `APn`), so nothing but the derivation had to run again.
//
// Packaging note: the pre-2.1.248 payload was one CJS blob, so the prelude was
// injected as source inside its `(function(exports, require, …) {` opening. The
// graph is ESM now, so each owning chunk instead gets an `import` of the
// reforge-owned module placed after its banner — imports hoist, so the module
// initializes before the chunk body that delegates into it. The banner must
// still stay byte-first (prepending disables the bundle silently), and the build
// boot-checks either way.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BUN, ENGINE_VERSION } from "../src/pin.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { METHOD, SPLICES } from "./manifest.js";
import { bootCheck, materializeGraph, STRANGLED_DIR, textModules } from "./prepare.js";

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

// ---- helpers ----------------------------------------------------------------
const countSubstring = (haystack: string, needle: string) => haystack.split(needle).length - 1;

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

/** Place a statement after the leading banner//comment block, never before it. */
function injectAfterBanner(src: string, statement: string): string {
  let i = 0;
  for (;;) {
    const nl = src.indexOf("\n", i);
    if (nl < 0) throw new Error("no code line found after banner");
    const line = src.slice(i, nl).trim();
    if (line !== "" && !line.startsWith("//")) break;
    i = nl + 1;
  }
  return src.slice(0, i) + statement + "\n" + src.slice(i);
}

// ---- build ------------------------------------------------------------------
const { files, specifiers } = materializeGraph(STRANGLED_DIR);
console.log(`graph: ${files} files rewritten, ${specifiers.toLocaleString()} specifiers → ${STRANGLED_DIR}`);

const sources = new Map<string, string>();
for (const path of textModules(STRANGLED_DIR)) sources.set(path, readFileSync(path, "utf8"));

const preludesFor = new Map<string, string[]>();

for (const sp of SPLICES) {
  // Uniqueness is a whole-GRAPH property, not a per-file one: a second match in
  // another chunk would make "which method did we excise?" a coin flip.
  const hits = [...sources].map(([p, s]) => [p, countSubstring(s, sp.anchor)] as const).filter(([, c]) => c > 0);
  const total = hits.reduce((a, [, c]) => a + c, 0);
  if (total === 0) {
    throw new Error(`${sp.name}: anchor not found anywhere in the ${ENGINE_VERSION} graph — re-anchor it`);
  }
  if (total > 1) {
    const where = hits.map(([p, c]) => `${relative(STRANGLED_DIR, p)}x${c}`).join(", ");
    throw new Error(`${sp.name}: anchor is not unique — ${total} matches (${where})`);
  }

  const path = hits[0][0];
  const src = sources.get(path)!;
  const anchorIdx = src.indexOf(sp.anchor);
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
  sources.set(path, src.slice(0, methodIdx) + replacement + src.slice(bodyClose + 1));

  const sabotaged = sabotageTarget === "all" || sabotageTarget === sp.name;
  const moduleFile = join(REFORGE_ROOT, "strangle", "modules", `${sp.name}${sabotaged ? ".sabotage" : ""}.js`);
  readFileSync(moduleFile); // fail loudly here rather than at boot
  preludesFor.set(path, [...(preludesFor.get(path) ?? []), moduleFile]);
  console.log(
    `spliced ${sp.name} in ${relative(STRANGLED_DIR, path)}: ${original.length} chars -> ${replacement.length}-char delegation` +
      `${extraArgs.length > 0 ? ` (derived: ${extraArgs.join(", ")})` : ""}${sabotaged ? " [SABOTAGE]" : ""}`,
  );
}

for (const [path, modules] of preludesFor) {
  const statement = modules.map((m) => `import ${JSON.stringify(m)};`).join("");
  writeFileSync(path, injectAfterBanner(sources.get(path)!, statement));
}

bootCheck([BUN, join(STRANGLED_DIR, "cli"), "--version"], "engine-strangled");
console.log(
  `strangled build written: ${STRANGLED_DIR} (${SPLICES.length} splices across ${preludesFor.size} chunk(s), ` +
    `variant: ${sabotageTarget ?? "faithful"})`,
);
