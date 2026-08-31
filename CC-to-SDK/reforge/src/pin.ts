// The pinned upstream reference — ONE definition. The engine wrappers (via the
// artifacts prepare.ts materializes), the graph materializer, the strangler
// build, and the gate's boot check all read the pin from here.
//
// Bumping the pin:
//   1. extract the new version into ~/claude-code-bundle/<v>/ per its MAP.md
//   2. change ENGINE_VERSION below
//   3. npx tsx strangle/prepare.ts     (materializes + boot-checks both engines)
//   4. re-record cassettes — the engine stamps its own version into the system
//      prompt, so cassettes recorded against the previous pin stop hash-matching
//      and would be served positionally (the proxy reports this, it is not silent)
//   5. npx tsx strangle/gate.ts        (re-anchor any splice the build reports missing)
export const ENGINE_VERSION = "2.1.251";

export const BUNDLE_MODULES = `/Users/new/claude-code-bundle/${ENGINE_VERSION}/modules`;
export const REAL_BINARY = `/Users/new/.local/share/claude/versions/${ENGINE_VERSION}`;

/** The compile-target runtime. The extracted graph is a silent no-op under node. */
export const BUN = process.env.BUN ?? "/Users/new/.bun/bin/bun";

/**
 * The virtual-filesystem prefix a `bun build --compile` binary resolves its own
 * modules through. It exists only inside the binary, so every occurrence has to
 * be rewritten when the graph is run from disk.
 */
export const BUNFS = "/$bunfs/root/";
