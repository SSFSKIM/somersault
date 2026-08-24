// M2a — strangler build step: produce build/cli-strangled.js from the PRISTINE
// extracted payload by (1) locating a target method via a unique string-literal
// anchor (literals survive minification and — measured — version churn),
// (2) excising its balanced-brace body, (3) replacing it with a delegation into
// globalThis.__reforge, and (4) prepending our owned module source as a prelude.
//
//   npx tsx strangle/build.ts [--sabotage]
//
// The manifest is pinned to 2.1.241. On a version catch-up, anchors relocate
// mechanically; captured closure identifiers (here: the freshness-suffix
// constant) are re-derived from the matched body, not hardcoded.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REFORGE_ROOT } from "../src/runTurn.js";

const PAYLOAD = "/Users/new/claude-code-bundle/2.1.241/modules/cli";
const sabotage = process.argv.includes("--sabotage");

const src = readFileSync(PAYLOAD, "utf8");

// ---- locate the target method by anchor -------------------------------------
// NOTE: the payload is effectively one line — `grep -c` counts LINES and lied
// (said 1); true substring count of the bare phrase is 2 (the Edit tool has a
// sibling template). The `.${` tail disambiguates the Write-tool template.
const ANCHOR = "has been updated successfully.${"; // true-count 1 in the payload
const anchorIdx = src.indexOf(ANCHOR);
if (anchorIdx < 0) throw new Error("anchor not found");
if (src.indexOf(ANCHOR, anchorIdx + 1) >= 0) throw new Error("anchor is not unique");

const METHOD = "mapToolResultToToolResultBlockParam";
const methodIdx = src.lastIndexOf(METHOD, anchorIdx);
if (methodIdx < 0 || anchorIdx - methodIdx > 2000) throw new Error("method head not found near anchor");

// balance parens for the parameter list, then braces for the body
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

const paramsOpen = src.indexOf("(", methodIdx);
const paramsClose = balancedEnd(src, paramsOpen, "(", ")");
const bodyOpen = src.indexOf("{", paramsClose);
const bodyClose = balancedEnd(src, bodyOpen, "{", "}");
const original = src.slice(methodIdx, bodyClose + 1);
if (!original.includes(ANCHOR)) throw new Error("extracted method does not contain the anchor");

// re-derive the closure-scoped freshness-suffix identifier from the body itself
const suffixMatch = original.match(/[a-zA-Z_$][\w$]*\s*=\s*[a-zA-Z_$][\w$]*\s*\|\|\s*[a-zA-Z_$][\w$]*\s*\?\s*"":\s*([a-zA-Z_$][\w$]*)/);
if (!suffixMatch) throw new Error("could not derive freshness-suffix identifier from method body");
const suffixIdent = suffixMatch[1];

const replacement = `${METHOD}(e,t){return globalThis.__reforge.writeToolResultBlock(e,t,${suffixIdent})}`;
const patched = src.slice(0, methodIdx) + replacement + src.slice(bodyClose + 1);

// ---- prelude: our owned module source ---------------------------------------
const moduleFile = join(
  REFORGE_ROOT,
  "strangle",
  "modules",
  sabotage ? "write-tool-result.sabotage.js" : "write-tool-result.js",
);
const prelude = readFileSync(moduleFile, "utf8");

// The payload opens with the magic banner `// @bun @bytecode @bun-cjs`, which
// must be the FIRST bytes — prepending anything (even a comment-free statement)
// silently disables the bundle: it boots to exit 0 with no output. Measured by
// isolation test t2 vs t3. So inject the prelude INSIDE the CJS wrapper.
const WRAPPER_OPEN = "__dirname) {";
const wrapperIdx = src.indexOf(WRAPPER_OPEN);
if (wrapperIdx < 0) throw new Error("CJS wrapper opening not found — payload shape changed");
const injectAt = wrapperIdx + WRAPPER_OPEN.length;
if (injectAt > methodIdx) throw new Error("wrapper opening is after the patch site — unexpected layout");
const withPrelude = patched.slice(0, injectAt) + prelude + patched.slice(injectAt);

const outDir = join(REFORGE_ROOT, "build");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "cli-strangled.js");
writeFileSync(outFile, withPrelude);

console.log(`strangled build written: ${outFile}`);
console.log(`  variant: ${sabotage ? "SABOTAGE" : "faithful"}`);
console.log(`  replaced ${original.length} chars of bundle method with ${replacement.length}-char delegation`);
console.log(`  derived freshness-suffix identifier: ${suffixIdent}`);
