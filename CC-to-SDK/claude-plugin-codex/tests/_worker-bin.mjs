import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve the cc-codex-appserver worker entry that the integration tests spawn (as `node <path>`
// under CC_APPSERVER_FAKE=1). Resolution order:
//   1. CLAUDE_COMPANION_APPSERVER_BIN env override
//   2. the installed `cc-codex-appserver` npm package (a devDependency of the standalone plugin repo)
//   3. a monorepo dev checkout at ../../app-server/dist/bin.js
// This lets the identical test files run both from the CC-to-SDK monorepo and from the published
// standalone repo. Returns null if none resolve (integration tests then fail loudly, as intended).
export function workerBin() {
  const override = (process.env.CLAUDE_COMPANION_APPSERVER_BIN ?? "").trim();
  if (override) return override;

  const require = createRequire(import.meta.url);
  try {
    const pkgJson = require.resolve("cc-codex-appserver/package.json");
    return resolve(dirname(pkgJson), "cc-codex-appserver.mjs");
  } catch {
    // not installed as a package — fall through to the dev checkout
  }

  const dev = resolve(dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
  return existsSync(dev) ? dev : null;
}
