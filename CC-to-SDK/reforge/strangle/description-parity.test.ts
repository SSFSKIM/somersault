// UPSTREAM-DIFFERENTIAL CONTRACT TEST for the four owned description functions.
//
//   npx tsx strangle/description-parity.test.ts
//
// §2.4 buys ownership of a reimplemented body against "the differential surfaces
// its output flows into PLUS a contract test where its domain is wider than the
// corpus". For the descriptions the corpus's domain is very narrow indeed: Glob's
// and Grep's text appears in exactly two of the 24 scenarios' requests, and the
// subagent-steer arm and the PDF-capability arm are pinned by the gate
// environment and by the session model. Those are the branches
// strangle/attestation.ts records as reviewed exclusions, and THIS is what grades
// them.
//
// It does not hand-write expectations. It extracts the four functions from the
// PINNED BUNDLE, evaluates each with stubbed ports, and requires byte identity
// with the owned module over the full cross-product of their branches. So the
// oracle is upstream itself — which makes an excluded branch better evidenced
// than a rendered one, not worse: a differential red only ever compares what a
// scenario happened to render.
//
// The extraction regexes are deliberately shape-based and fail loudly, for the
// same reason the manifest's derivations are: a pin bump that moves a body must
// break this test rather than quietly compare something else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { globDescription, GLOB_TOOL_NAME, REPL_TOOL_NAME } from "./modules/glob-description/reference.js";
import { readDescription } from "./modules/read-description/reference.js";
import { grepDescription } from "./modules/grep-description/reference.js";
import { webFetchDescription } from "./modules/webfetch-description/reference.js";

let checks = 0;
const failures: string[] = [];

function chunk(name: string): string {
  return readFileSync(join(BUNDLE_MODULES, name), "utf8");
}

/** One shape-anchored extraction. Throws when the shape is gone. */
function extract(label: string, source: string, re: RegExp): string {
  const m = source.match(re);
  if (!m) throw new Error(`${label}: upstream shape not found — ${re}`);
  return m[0];
}

/**
 * A tool-name constant the upstream body interpolates, taken from the pinned
 * bundle rather than written down here. It is a LOCATOR, not a transcription: if
 * upstream ever stops declaring that literal the match fails and this test throws
 * instead of quietly comparing two copies of a stale string. The comparison it
 * enables is real — the owned side reads shared/tool-names.js, so a drifted owned
 * constant shows up as a body mismatch.
 */
function toolName(label: string, chunkName: string, literal: string): string {
  return extract(label, chunk(chunkName), new RegExp(`var [\\w$]+="${literal}"`)).split('"')[1];
}

function eq(label: string, upstream: string, owned: string): void {
  checks++;
  if (upstream === owned) return;
  let at = 0;
  while (at < upstream.length && upstream[at] === owned[at]) at++;
  failures.push(
    `${label}: differs at offset ${at}\n    upstream: ${JSON.stringify(upstream.slice(Math.max(0, at - 30), at + 40))}\n    owned:    ${JSON.stringify(owned.slice(Math.max(0, at - 30), at + 40))}`,
  );
}

console.log(`description parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// ---- Glob (S-chunk) ---------------------------------------------------------
{
  const src = chunk("chunk-y30v0ja7.js");
  const fn = extract("glob/O_n", src, /function [\w$]+\([\w$]+\)\{if\([\w$]+\([\w$]+\)\)return'Fast file pattern matching[\s\S]*?\}(?=var )/);
  const consts = extract("glob/templates", src, /var [\w$]+=`- Fast file pattern matching tool[\s\S]*?`;(?=var )/);
  const name = fn.match(/function ([\w$]+)/)![1];
  const agent = toolName("primitives/yt", "chunk-k8vt31j7.js", "Agent");
  const make = (lean: boolean, steer: string) =>
    // eslint-disable-next-line no-eval
    eval(`(() => { const yt=${JSON.stringify(agent)}; ${consts} const td=()=>${lean}, Jk=()=>${JSON.stringify(steer)}; ${fn} return ${name}; })()`) as (m?: string) => string;
  for (const lean of [true, false]) {
    for (const steer of ["default", "no_nudges"]) {
      eq(`glob lean=${lean} steer=${steer}`, make(lean, steer)("m"), globDescription("m", () => lean, () => steer));
    }
  }
  // The two constant exports, against the chunk's own declarations.
  eq("glob tool name", extract("glob/ti", src, /var [\w$]+="Glob"/).split('"')[1], GLOB_TOOL_NAME);
  eq("repl tool name", extract("glob/$s", src, /var [\w$]+="REPL"/).split('"')[1], REPL_TOOL_NAME);
}

// ---- Read -------------------------------------------------------------------
{
  const src = chunk("chunk-hx5r9amq.js");
  const fn = extract("read/cYn", src, /function [\w$]+\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{if\([\w$]+\([\w$]+\)\)return`Reads a file from the local filesystem\.[\s\S]*?`\}(?=\nexport)/);
  const note = extract("read/n", src, /var [\w$]+=`\n- Do NOT re-read a file[\s\S]*?`,/).replace(/,$/, ";");
  // The default line budget, located in the bundle rather than written down: the
  // owned side reads DEFAULT_LINE_BUDGET, so a drift shows up as a body mismatch.
  const budget = Number(extract("read/jVe", src, /,[\w$]+=2000,/).match(/=(\d+),/)![1]);
  const name = fn.match(/function ([\w$]+)/)![1];
  const make = (lean: boolean, pdf: boolean) =>
    // eslint-disable-next-line no-eval
    eval(`(() => { ${note} const jVe=${budget}; const td=()=>${lean}, BVe=()=>${pdf}; ${fn} return ${name}; })()`) as (
      m: string,
      t: string,
      s: string,
      r: string,
    ) => string;
  const args: [string, string, string] = ["LINE_NUMBERING", "MAX_SIZE", "OFFSET_LIMIT"];
  for (const lean of [true, false]) {
    for (const pdf of [true, false]) {
      eq(
        `read lean=${lean} pdf=${pdf}`,
        make(lean, pdf)("m", args[0], args[1], args[2]),
        readDescription("m", args[0], args[1], args[2], () => lean, () => pdf),
      );
    }
  }
}

// ---- Grep -------------------------------------------------------------------
{
  const src = chunk("chunk-hdmehzg7.js");
  const fn = extract("grep/gmn", src, /function [\w$]+\([\w$]+\)\{if\([\w$]+\([\w$]+\)\)return`Content search built on ripgrep[\s\S]*?`\}(?=class )/);
  const name = fn.match(/function ([\w$]+)/)![1];
  const make = (lean: boolean, steer: string) =>
    // eslint-disable-next-line no-eval
    eval(
      `(() => { const Qe=${JSON.stringify(toolName("primitives/Qe", "chunk-bsdtxcdc.js", "Bash"))},` +
        ` Xo=${JSON.stringify(toolName("grep/Xo", "chunk-hdmehzg7.js", "Grep"))},` +
        ` yt=${JSON.stringify(toolName("primitives/yt", "chunk-k8vt31j7.js", "Agent"))};` +
        ` const td=()=>${lean}, Jk=()=>${JSON.stringify(steer)}; ${fn} return ${name}; })()`,
    ) as (m: string) => string;
  for (const lean of [true, false]) {
    for (const steer of ["default", "counter_steer"]) {
      eq(`grep lean=${lean} steer=${steer}`, make(lean, steer)("m"), grepDescription("m", () => lean, () => steer));
    }
  }
}

// ---- WebFetch ---------------------------------------------------------------
{
  const src = chunk("chunk-qe0j59w7.js");
  const fn = extract("webfetch/eYn", src, /function [\w$]+\([\w$]+,[\w$]+=!1\)\{if\([\w$]+\([\w$]+\)\)return`Fetches a URL[\s\S]*?`\}(?=function )/);
  const notes = extract("webfetch/u", src, /function u\(\)\{return`\n- Fetches content from a specified URL[\s\S]*?`\}/);
  const name = fn.match(/function ([\w$]+)/)![1];
  const ttl = () => "15 minutes";
  const make = (lean: boolean) =>
    // eslint-disable-next-line no-eval
    eval(`(() => { const r=()=>"15 minutes"; const td=()=>${lean}; ${notes}\n${fn} return ${name}; })()`) as (m: string, t: boolean) => string;
  for (const lean of [true, false]) {
    for (const artifact of [true, false]) {
      eq(`webfetch lean=${lean} artifact=${artifact}`, make(lean)("m", artifact), webFetchDescription("m", artifact, () => lean, ttl));
    }
  }
}

console.log(`\n=== description parity: ${checks} check(s) across the full branch cross-product ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
// 16 arm comparisons + 2 constants. A run that compared fewer has lost a branch.
if (checks < 18) {
  console.log(`\nFAIL — only ${checks} comparison(s); the cross-product is incomplete`);
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "\nPASS — every arm is byte-identical to the pinned upstream" : "\nFAIL");
  process.exitCode = failures.length === 0 ? 0 : 1;
}
