// Materialize the runnable engine set from the pinned bundle extraction.
//
//   npx tsx strangle/prepare.ts
//
// Since 2.1.248 the extracted payload is no longer one CJS blob but an ESM
// graph: `cli` plus ~1800 `chunk-*.js` importing each other by absolute
// `/$bunfs/root/…` specifiers, which exist only inside the compiled binary's
// virtual filesystem. Run from disk they resolve to nothing ("Cannot find
// module"), so the graph is copied out and every occurrence is rewritten to the
// copy's own location — rewritten ABSOLUTE, not relative, because the same token
// also appears in runtime asset reads, and those resolve against cwd rather than
// against the importing file.
//
// Everything here is derived from the pin (src/pin.ts) and written under
// build/ (gitignored), so bumping the pin never edits a committed engine.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUN, BUNDLE_MODULES, BUNFS, ENGINE_VERSION, REAL_BINARY } from "../src/pin.js";
import { REFORGE_ROOT } from "../src/runTurn.js";

export const BUILD_DIR = join(REFORGE_ROOT, "build");
export const GRAPH_DIR = join(BUILD_DIR, "graph");
export const STRANGLED_DIR = join(BUILD_DIR, "strangled");
export const REAL_LINK = join(BUILD_DIR, "real-binary");

/** `cli` + every `.js` — measured to be exactly the files carrying the token. */
export function textModules(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f === "cli" || f.endsWith(".js"))
    .map((f) => join(dir, f));
}

/** Copy the pristine extraction to `dest` and point its specifiers at itself. */
export function materializeGraph(dest: string): { files: number; specifiers: number } {
  if (!existsSync(join(BUNDLE_MODULES, "cli"))) {
    throw new Error(`pinned extraction missing: ${BUNDLE_MODULES} (extract ${ENGINE_VERSION} per its MAP.md)`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(BUNDLE_MODULES, dest, { recursive: true });

  let files = 0;
  let specifiers = 0;
  for (const path of textModules(dest)) {
    const src = readFileSync(path, "utf8");
    if (!src.includes(BUNFS)) continue;
    specifiers += src.split(BUNFS).length - 1;
    files++;
    writeFileSync(path, src.replaceAll(BUNFS, `${dest}/`));
  }
  if (specifiers === 0) throw new Error(`no ${BUNFS} specifiers rewritten — extraction shape changed`);
  return { files, specifiers };
}

/**
 * A graph that boots is the only evidence that a build is intact. Modifying
 * these files has a documented silent-failure mode (M2a: prepending anything
 * before the `// @bun` banner disables the bundle — exit 0, no output, no
 * error), so every path that writes a graph boot-checks it.
 */
export function bootCheck(cmd: string[], label: string): void {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (!out.includes(ENGINE_VERSION)) {
    throw new Error(`${label}: boot check failed — expected ${ENGINE_VERSION}, got ${out.slice(0, 200) || "<no output>"}`);
  }
  console.log(`  boot ok: ${label} → ${ENGINE_VERSION}`);
}

export function linkRealBinary(): void {
  if (!existsSync(REAL_BINARY)) throw new Error(`pinned binary missing: ${REAL_BINARY}`);
  mkdirSync(BUILD_DIR, { recursive: true });
  if (existsSync(REAL_LINK) || lstatSync(REAL_LINK, { throwIfNoEntry: false })) unlinkSync(REAL_LINK);
  symlinkSync(REAL_BINARY, REAL_LINK);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`pin: ${ENGINE_VERSION}`);
  linkRealBinary();
  bootCheck([REAL_LINK, "--version"], "engine-real");
  const { files, specifiers } = materializeGraph(GRAPH_DIR);
  console.log(`  graph: ${files} files rewritten, ${specifiers.toLocaleString()} specifiers → ${GRAPH_DIR}`);
  bootCheck([BUN, join(GRAPH_DIR, "cli"), "--version"], "engine-extracted");
  console.log("engines materialized");
}
