// §3.5 — provision the pinned runtime, project-locally.
//
//   npx tsx strangle/toolchain.ts [--check]
//
// The pinned Claude Code binary is a `bun build --compile` artifact, so the
// runtime that executes `engine-extracted`/`engine-strangled` from disk should
// be the runtime the oracle was compiled against. This installs that bun into
// `reforge/toolchain/` (gitignored) and NEVER touches `~/.bun` — the operator's
// bun is a shared tool, and pulling it onto a pre-release build so that one
// research harness can match a version would be a poor trade.
//
// `--check` only re-derives and verifies; it installs nothing.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PINNED_BUN, PINNED_BUN_REVISION, PINNED_BUN_SHA256, REAL_BINARY, TOOLCHAIN_BUN } from "../src/pin.js";
import { createHash } from "node:crypto";

/**
 * Re-derive the embedded runtime version FROM THE BINARY, so the pin constant is
 * checkable rather than merely asserted. Two independent strings carry it: the
 * HTTP user-agent (`Bun/x.y.z`) and the update-check tag (`bun-vx.y.z`). Both
 * must agree, and both must be unique — a binary that carried two different
 * versions would mean the extraction is not what we think it is.
 */
export function embeddedBunVersion(binary = REAL_BINARY): string {
  if (!existsSync(binary)) throw new Error(`pinned binary missing: ${binary}`);
  const buf = readFileSync(binary);
  const found = new Set<string>();
  for (const re of [/Bun\/(\d+\.\d+\.\d+)/g, /bun-v(\d+\.\d+\.\d+)/g]) {
    let m: RegExpExecArray | null;
    // The Mach-O is ~200 MB of mixed binary; latin1 keeps byte offsets stable
    // and never throws on invalid UTF-8 the way a utf8 decode would mangle.
    const text = buf.toString("latin1");
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  if (found.size === 0) throw new Error(`no embedded bun version found in ${binary} — extraction shape changed`);
  if (found.size > 1) throw new Error(`ambiguous embedded bun version in ${binary}: ${[...found].join(", ")}`);
  return [...found][0];
}

export function externalBunVersion(bun: string): string {
  const r = spawnSync(bun, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bun} --version failed: ${(r.stderr ?? "").trim().slice(0, 200) || `exit ${r.status}`}`);
  return (r.stdout ?? "").trim();
}

const sha256 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

/**
 * Upstream release layout. 1.4.1 has no tagged release yet (latest is 1.4.0),
 * so the tagged URL is tried first and the rolling `canary` asset is the
 * fallback — whichever one actually reports the pinned version wins, and if
 * neither does, this fails loudly rather than installing a near-miss.
 */
const ASSET = "bun-darwin-aarch64.zip";
const SOURCES = (version: string) => [
  `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${ASSET}`,
  `https://github.com/oven-sh/bun/releases/download/canary/${ASSET}`,
];

function install(version: string): void {
  const work = mkdtempSync(join(tmpdir(), "reforge-bun-"));
  try {
    for (const url of SOURCES(version)) {
      const zip = join(work, ASSET);
      rmSync(zip, { force: true });
      const dl = spawnSync("curl", ["-fsSL", "-o", zip, url], { encoding: "utf8" });
      if (dl.status !== 0 || !existsSync(zip)) {
        console.log(`  ${url} — unavailable`);
        continue;
      }
      spawnSync("unzip", ["-oq", zip, "-d", work], { encoding: "utf8" });
      const candidate = join(work, "bun-darwin-aarch64", "bun");
      if (!existsSync(candidate)) {
        console.log(`  ${url} — archive shape unexpected`);
        continue;
      }
      chmodSync(candidate, 0o755);
      const got = externalBunVersion(candidate);
      if (got !== version) {
        console.log(`  ${url} — reports ${got}, need ${version}`);
        continue;
      }
      mkdirSync(join(TOOLCHAIN_BUN, ".."), { recursive: true });
      copyFileSync(candidate, TOOLCHAIN_BUN);
      chmodSync(TOOLCHAIN_BUN, 0o755);
      console.log(`  installed ${version} from ${url}`);
      return;
    }
    throw new Error(
      `no upstream bun build reports ${version} (tried tagged release and canary). ` +
        `The runtime pin cannot be satisfied — report this rather than running on a skewed runtime.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const embedded = embeddedBunVersion();
  console.log(`embedded runtime (from the pinned binary): ${embedded}`);
  if (embedded !== PINNED_BUN) {
    console.error(`FAIL — src/pin.ts says PINNED_BUN=${PINNED_BUN} but the binary embeds ${embedded}. Update the pin.`);
    process.exit(1);
  }
  if (!existsSync(TOOLCHAIN_BUN)) {
    if (checkOnly) {
      console.error(`FAIL — ${TOOLCHAIN_BUN} missing. Run: npx tsx strangle/toolchain.ts`);
      process.exit(1);
    }
    console.log(`installing bun ${PINNED_BUN} → ${TOOLCHAIN_BUN}`);
    install(PINNED_BUN);
  }
  const version = externalBunVersion(TOOLCHAIN_BUN);
  const revision = (spawnSync(TOOLCHAIN_BUN, ["--revision"], { encoding: "utf8" }).stdout ?? "").trim();
  const hash = sha256(TOOLCHAIN_BUN);
  console.log(`toolchain bun: ${version}  revision ${revision}`);
  console.log(`  sha256 ${hash}`);
  if (version !== PINNED_BUN) {
    console.error(`FAIL — toolchain bun reports ${version}, pin requires ${PINNED_BUN}`);
    process.exit(1);
  }
  // Provenance, not a gate: the canary asset rolls, so a different revision or
  // hash is expected over time. The VERSION equality above is the §3.5 contract;
  // these two lines are what makes a drifted install visible when it happens.
  if (revision !== PINNED_BUN_REVISION) console.log(`  note: revision differs from the recorded ${PINNED_BUN_REVISION} (canary rolls; version still matches)`);
  if (hash !== PINNED_BUN_SHA256) console.log(`  note: sha256 differs from the recorded ${PINNED_BUN_SHA256}`);
  console.log(`PASS — external runtime matches the binary's embedded ${embedded}`);
}
