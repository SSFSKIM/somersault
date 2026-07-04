// Build a self-contained, publishable npm package for the `cc-codex-appserver` worker.
//
// The worker depends on `cc-harness` through a local `file:../harness` link that isn't on
// npm, so it can't be published as-is. This script bundles `cc-harness` (and the worker's
// own source) into a single ESM file while keeping the Agent SDK and zod *external* — they
// stay ordinary npm dependencies and resolve natively from the consumer's node_modules, so
// the SDK's own runtime resolution of the bundled `claude` CLI is unaffected.
//
// Output: app-server/.npm-publish/ — a clean directory ready for `npm publish`.
// Prereq: `npm run build` (tsc) has produced dist/bin.js.
import { build } from "esbuild";
import { mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");            // app-server/
const repoRoot = resolve(root, "..", "..");  // codex_somersault/
const out = resolve(root, ".npm-publish");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const entry = resolve(root, "dist/bin.js");
if (!existsSync(entry)) {
  console.error(`Missing ${entry}. Run \`npm run build\` first.`);
  process.exit(1);
}

// `cc-harness` is a local file: dependency; alias it to its built entry so esbuild inlines it
// (node_modules symlink resolution is unreliable across the workspace layout).
const harnessEntry = resolve(root, "..", "harness", "dist", "index.js");
if (!existsSync(harnessEntry)) {
  console.error(`Missing ${harnessEntry}. Build cc-harness first (npm run build in ../harness).`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: resolve(out, "cc-codex-appserver.mjs"),
  alias: { "cc-harness": harnessEntry },
  external: ["@anthropic-ai/claude-agent-sdk", "zod", "zod/*"],
  logLevel: "info",
});

// Guarantee exactly one shebang on line 1: esbuild preserves the entry's shebang, so strip any
// leading shebang line(s) and prepend a single canonical one, then make the bin executable.
const bundlePath = resolve(out, "cc-codex-appserver.mjs");
let code = readFileSync(bundlePath, "utf8").replace(/^(#![^\n]*\n)+/, "");
writeFileSync(bundlePath, "#!/usr/bin/env node\n" + code);
chmodSync(bundlePath, 0o755);

const publishPkg = {
  name: "cc-codex-appserver",
  version: pkg.version,
  description:
    "Claude-backed worker (a drop-in for `codex app-server`) that powers the claude-companion Codex plugin.",
  type: "module",
  bin: { "cc-codex-appserver": "cc-codex-appserver.mjs" },
  files: ["cc-codex-appserver.mjs", "LICENSE", "README.md"],
  engines: { node: ">=18.18.0" },
  license: "Apache-2.0",
  repository: { type: "git", url: "git+https://github.com/SSFSKIM/claude-plugin-codex.git" },
  keywords: ["claude", "codex", "mcp", "agent", "plugin", "claude-companion"],
  dependencies: {
    "@anthropic-ai/claude-agent-sdk": pkg.dependencies["@anthropic-ai/claude-agent-sdk"],
    zod: pkg.dependencies.zod,
  },
};
writeFileSync(resolve(out, "package.json"), JSON.stringify(publishPkg, null, 2) + "\n");
copyFileSync(resolve(repoRoot, "LICENSE"), resolve(out, "LICENSE"));
copyFileSync(resolve(root, "README.npm.md"), resolve(out, "README.md"));

console.log("\nStaged publishable package at:", out);
console.log("Verify:  (cd", out, "&& npm pack --dry-run)");
console.log("Publish: (cd", out, "&& npm publish --access public)   # requires `npm login`");
