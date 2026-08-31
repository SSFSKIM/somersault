// The pinned upstream reference — ONE definition. The engine wrappers (via the
// artifacts prepare.ts materializes), the graph materializer, the strangler
// build, and the gate's boot check all read the pin from here.
//
// Bumping the pin:
//   1. extract the new version into ~/claude-code-bundle/<v>/ per its MAP.md
//   2. change ENGINE_VERSION below
//   3. re-extract the embedded runtime version and update PINNED_BUN:
//        strings -a <binary> | grep -oE 'bun-v[0-9]+\.[0-9]+\.[0-9]+' | sort -u
//      then `npx tsx strangle/toolchain.ts` to install it project-locally
//   4. npx tsx strangle/prepare.ts     (materializes + boot-checks both engines;
//      REFUSES to proceed if the external bun's version differs from PINNED_BUN)
//   5. regenerate the gate-defaults fixture and review its diff:
//        npx tsx research/tools/extract-gate-defaults.ts
//   6. re-record cassettes — the engine stamps its own version into the system
//      prompt, so cassettes recorded against the previous pin stop hash-matching
//      (a positional fallback is now FATAL for non-extracted engines, §3.4)
//   7. npx tsx strangle/gate.ts        (re-anchor any splice the build reports missing)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_VERSION = "2.1.251";

export const BUNDLE_ROOT = `/Users/new/claude-code-bundle/${ENGINE_VERSION}`;
export const BUNDLE_MODULES = `${BUNDLE_ROOT}/modules`;
/** The whitespace-formatted single-file rendering of the same payload — the readable surface for bundle-wide scans. */
export const BUNDLE_PRETTY = `${BUNDLE_ROOT}/cli.pretty.js`;
export const REAL_BINARY = `/Users/new/.local/share/claude/versions/${ENGINE_VERSION}`;

/**
 * §3.5 — the runtime, pinned to what the binary actually embeds.
 *
 * The pinned Mach-O carries `Bun/1.4.1` (HTTP user-agent) and `bun-v1.4.1`
 * (update-check URL) — see `strangle/toolchain.ts`, which re-derives this from
 * the binary rather than trusting the constant. Until this pin, the external bun
 * running `engine-extracted`/`engine-strangled` was 1.3.14: a whole minor behind
 * the runtime the oracle is compiled against, so "extracted equals real" was
 * riding partly on runtime luck.
 *
 * PROVENANCE, stated honestly: 1.4.1 has no tagged upstream release (latest is
 * bun-v1.4.0). The only public build that reports `1.4.1` today is the rolling
 * `canary` asset — installed here as `1.4.1-canary.1+d9b769812`. So the version
 * STRING matches the binary's embedded runtime exactly, while the underlying
 * commit is not provably the commit Anthropic compiled against. That is a real
 * residual, recorded rather than rounded up; it is still strictly closer than a
 * whole minor version of skew.
 */
export const PINNED_BUN = "1.4.1";
export const PINNED_BUN_REVISION = "1.4.1-canary.1+d9b769812";
export const PINNED_BUN_SHA256 = "5c90553e4f7dc1c7065ebbdddcdd0a7d3b67ff62ec7d47333626393d353ef9c8";

const REFORGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The compile-target runtime. The extracted graph is a silent no-op under node.
 *
 * Project-LOCAL by default (`reforge/toolchain/bun`, gitignored, installed by
 * `strangle/toolchain.ts`): the operator's `~/.bun` is a shared tool and must not
 * be dragged onto a pre-release runtime just because reforge needs one. `BUN` in
 * the environment still overrides, which is how the engine wrappers receive it.
 */
export const TOOLCHAIN_BUN = join(REFORGE_ROOT, "toolchain", "bun");
export const BUN = process.env.BUN ?? TOOLCHAIN_BUN;

/**
 * The virtual-filesystem prefix a `bun build --compile` binary resolves its own
 * modules through. It exists only inside the binary, so every occurrence has to
 * be rewritten when the graph is run from disk.
 */
export const BUNFS = "/$bunfs/root/";
