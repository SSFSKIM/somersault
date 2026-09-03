// §3.5 — provision the pinned ORACLE and the pinned RUNTIME, project-locally.
//
//   npx tsx strangle/toolchain.ts [--check]
//
// TWO pins, one shape. The pinned Claude Code binary is a `bun build --compile`
// artifact, so the runtime that executes `engine-extracted`/`engine-strangled`
// from disk should be the runtime the oracle was compiled against; and the
// oracle itself is a specific 197 MB of bytes that the campaign's every
// equivalence claim is measured against. Both are installed into
// `reforge/toolchain/` (gitignored), both are identified by a pinned sha256, and
// neither is accepted on any weaker evidence.
//
// What this does NOT touch, in either direction: `~/.bun` (the operator's bun is
// a shared tool, and dragging it onto a pre-release build so one research
// harness can match a version would be a poor trade) and
// `~/.local/share/claude` (Claude Code's own auto-updater owns that directory,
// prunes it on its own schedule — which is exactly why the oracle no longer
// lives there — and the operator's `claude` symlink is not ours to move).
//
// `--check` only re-derives and verifies; it installs nothing.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_INSTALL_DIR,
  ENGINE_DOWNLOAD_URL,
  ENGINE_MANIFEST_URL,
  ENGINE_PLATFORM,
  ENGINE_VERSION,
  PINNED_BUN,
  PINNED_BUN_REVISION,
  PINNED_BUN_SHA256,
  PINNED_ENGINE_SHA256,
  REAL_BINARY,
  TOOLCHAIN_BUN,
  TOOLCHAIN_ENGINE,
} from "../src/pin.js";
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

export const sha256 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

// ---- the ORACLE pin ---------------------------------------------------------

/**
 * §3.5 — the ORACLE pin is the exact bytes, for the same reason the runtime's is.
 *
 * The oracle used to be read straight out of `~/.local/share/claude/versions/`,
 * which is the auto-updater's cache. That is a moving target of a different kind
 * from bun's rolling canary: not bytes that change under a stable name, but a
 * name that DISAPPEARS. It did, mid-C16b, and side A of every differential began
 * failing on a dangling `build/real-binary` symlink.
 *
 * So the bytes are provisioned into `reforge/toolchain/` and identified by hash,
 * and accepting different bytes requires editing `PINNED_ENGINE_SHA256`. The
 * failure is legible: a wrong oracle reports a hash mismatch naming both digests
 * rather than producing a campaign-wide diff nobody can attribute.
 *
 * HASH ONLY, no boot check here: `strangle/prepare.ts` already boot-checks
 * `engine-real --version` against `ENGINE_VERSION`, and running an unverified
 * 197 MB binary to ask it its version is the order this file refuses on
 * principle (see `assertBunPin`).
 */
export function assertEnginePin(binary = TOOLCHAIN_ENGINE): { version: string; sha256: string } {
  if (!existsSync(binary)) {
    throw new Error(`pinned oracle missing: ${binary}. Provision it: npx tsx strangle/toolchain.ts`);
  }
  const hash = sha256(binary);
  if (hash !== PINNED_ENGINE_SHA256) {
    throw new Error(
      `oracle pin violation: ${binary}\n  sha256 ${hash}\n  pinned ${PINNED_ENGINE_SHA256}\n` +
        `  These are not the pinned ${ENGINE_VERSION} bytes. Every equivalence claim in the campaign is measured against ` +
        `this binary, so accepting different bytes is a pin bump, not a default: re-verify against the release manifest ` +
        `(${ENGINE_MANIFEST_URL}) and update PINNED_ENGINE_SHA256 in src/pin.ts.`,
    );
  }
  return { version: ENGINE_VERSION, sha256: hash };
}

/**
 * The published checksum, re-read at install time. `PINNED_ENGINE_SHA256` is a
 * constant in this repo; the manifest is upstream's own statement about the same
 * release. Checking them against each other is what makes the pin verifiable
 * rather than merely asserted — and a disagreement is a refusal, because exactly
 * one of the two is then wrong and this file cannot tell which.
 */
function manifestChecksum(): string {
  const r = spawnSync("curl", ["-fsSL", ENGINE_MANIFEST_URL], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`release manifest unreachable: ${ENGINE_MANIFEST_URL} (${(r.stderr ?? "").trim().slice(0, 200) || `exit ${r.status}`})`);
  const manifest = JSON.parse(r.stdout) as { version?: string; platforms?: Record<string, { checksum?: string; size?: number }> };
  if (manifest.version !== ENGINE_VERSION) throw new Error(`release manifest is for ${manifest.version}, not the pinned ${ENGINE_VERSION}`);
  const checksum = manifest.platforms?.[ENGINE_PLATFORM]?.checksum;
  if (typeof checksum !== "string") throw new Error(`release manifest has no ${ENGINE_PLATFORM} checksum — the manifest shape changed`);
  return checksum;
}

/**
 * Provision the oracle. TWO sources, in the order that costs least:
 *
 *  1. the auto-updater's cache, IF it still holds bytes that hash to the pin.
 *     Read-only, a plain copy out; the campaign gets its own copy and the
 *     updater may prune the original whenever it likes. This is what makes the
 *     move free on a machine that already has the version.
 *  2. Anthropic's release endpoint, verified against both the published
 *     manifest checksum and the pin constant.
 */
function installEngine(): void {
  const seed = join(CLAUDE_INSTALL_DIR, ENGINE_VERSION);
  mkdirSync(join(TOOLCHAIN_ENGINE, ".."), { recursive: true });
  if (existsSync(seed) && statSync(seed).isFile() && sha256(seed) === PINNED_ENGINE_SHA256) {
    copyFileSync(seed, TOOLCHAIN_ENGINE);
    chmodSync(TOOLCHAIN_ENGINE, 0o755);
    console.log(`  copied the pinned bytes out of ${seed} (no download needed)`);
    return;
  }
  const published = manifestChecksum();
  if (published !== PINNED_ENGINE_SHA256) {
    throw new Error(
      `oracle pin disagrees with upstream: the ${ENGINE_PLATFORM} release manifest publishes ${published}, src/pin.ts pins ` +
        `${PINNED_ENGINE_SHA256}. One of the two is wrong and this file cannot tell which — resolve it deliberately.`,
    );
  }
  const work = mkdtempSync(join(tmpdir(), "reforge-engine-"));
  try {
    const candidate = join(work, "claude");
    const dl = spawnSync("curl", ["-fsSL", "-o", candidate, ENGINE_DOWNLOAD_URL], { encoding: "utf8" });
    if (dl.status !== 0 || !existsSync(candidate)) throw new Error(`download failed: ${ENGINE_DOWNLOAD_URL}`);
    const got = sha256(candidate);
    if (got !== PINNED_ENGINE_SHA256) {
      throw new Error(`downloaded oracle does not match the pin\n  sha256 ${got}\n  pinned ${PINNED_ENGINE_SHA256}\n  ${ENGINE_DOWNLOAD_URL}`);
    }
    chmodSync(candidate, 0o755);
    copyFileSync(candidate, TOOLCHAIN_ENGINE);
    chmodSync(TOOLCHAIN_ENGINE, 0o755);
    console.log(`  downloaded ${ENGINE_VERSION} from ${ENGINE_DOWNLOAD_URL} (checksum matches the published manifest)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * §3.5 — the runtime pin is the EXACT BYTES, not the version string.
 *
 * The surrogate is provisioned from bun's rolling `canary` asset, because 1.4.1
 * has no tagged release. A rolling asset is a moving target: "reports 1.4.1" was
 * the only thing checked, so tomorrow's canary — a different compiler, a
 * different commit, arbitrary behavior changes — would install silently, and a
 * `BUN` env override pointing at any binary that printed `1.4.1` would be
 * accepted. Version equality is a weak identity for something the equivalence
 * claim rides on.
 *
 * So identity is `PINNED_BUN_SHA256`, and accepting different bytes requires
 * editing that constant. Warning-only provenance notes are gone.
 *
 * HASH BEFORE EXECUTION, deliberately: an unverified binary is not run to ask it
 * its version. That also makes the failure legible — tampered bytes report a
 * hash mismatch rather than a codesign kill.
 *
 * What this does NOT claim: that the surrogate is the build Anthropic compiled
 * the oracle against. See `PINNED_BUN` in `src/pin.ts` — the version string
 * matches the binary's embedded runtime exactly, the underlying commit is not
 * provably the same, and that residual is recorded rather than rounded up.
 */
export function assertBunPin(bun: string): { version: string; revision: string; sha256: string } {
  if (!existsSync(bun)) {
    throw new Error(`pinned runtime missing: ${bun}. Provision it: npx tsx strangle/toolchain.ts`);
  }
  const hash = sha256(bun);
  if (hash !== PINNED_BUN_SHA256) {
    throw new Error(
      `runtime pin violation: ${bun}\n  sha256 ${hash}\n  pinned ${PINNED_BUN_SHA256}\n` +
        `  These are not the verified surrogate's bytes. The canary asset rolls, so a re-download can legitimately differ — ` +
        `but accepting it is a decision, not a default: re-verify the build and update PINNED_BUN_SHA256 in src/pin.ts.`,
    );
  }
  const version = externalBunVersion(bun);
  if (version !== PINNED_BUN) {
    throw new Error(`runtime pin violation: ${bun} hashes as the pinned surrogate but reports ${version}, not ${PINNED_BUN} — the pin constants disagree with each other.`);
  }
  const revision = (spawnSync(bun, ["--revision"], { encoding: "utf8" }).stdout ?? "").trim();
  if (revision !== PINNED_BUN_REVISION) {
    throw new Error(`runtime pin violation: ${bun} reports revision ${revision}, pinned ${PINNED_BUN_REVISION}`);
  }
  return { version, revision, sha256: hash };
}

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
      // The pin is the BYTES. A source whose asset has rolled past the verified
      // surrogate is reported and skipped — never installed with a warning.
      const got = sha256(candidate);
      if (got !== PINNED_BUN_SHA256) {
        console.log(`  ${url} — sha256 ${got.slice(0, 16)}… does not match the pinned surrogate (${PINNED_BUN_SHA256.slice(0, 16)}…)`);
        continue;
      }
      mkdirSync(join(TOOLCHAIN_BUN, ".."), { recursive: true });
      copyFileSync(candidate, TOOLCHAIN_BUN);
      chmodSync(TOOLCHAIN_BUN, 0o755);
      console.log(`  installed ${version} from ${url}`);
      return;
    }
    throw new Error(
      `no upstream source still serves the pinned ${version} surrogate — sha256 ${PINNED_BUN_SHA256} (tried the tagged ` +
        `release and canary). The canary asset has rolled past it. The runtime pin cannot be satisfied by download: ` +
        `report this rather than running on unverified bytes.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");

  // The ORACLE first: everything below reads bytes out of it.
  if (!existsSync(TOOLCHAIN_ENGINE)) {
    if (checkOnly) {
      console.error(`FAIL — ${TOOLCHAIN_ENGINE} missing. Run: npx tsx strangle/toolchain.ts`);
      process.exit(1);
    }
    console.log(`provisioning the pinned oracle ${ENGINE_VERSION} → ${TOOLCHAIN_ENGINE}`);
    installEngine();
  }
  let engine: ReturnType<typeof assertEnginePin>;
  try {
    engine = assertEnginePin();
  } catch (e) {
    console.error(`FAIL — ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`toolchain oracle: ${ENGINE_VERSION} at ${TOOLCHAIN_ENGINE}`);
  console.log(`  sha256 ${engine.sha256} (matches the pin)`);

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
  let pinned: ReturnType<typeof assertBunPin>;
  try {
    pinned = assertBunPin(TOOLCHAIN_BUN);
  } catch (e) {
    console.error(`FAIL — ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`toolchain bun: ${pinned.version}  revision ${pinned.revision}`);
  console.log(`  sha256 ${pinned.sha256} (matches the pin)`);
  console.log(`PASS — both pins are the BYTES: the oracle is the pinned ${ENGINE_VERSION} and the external runtime is the verified surrogate matching its embedded ${embedded}`);
}
