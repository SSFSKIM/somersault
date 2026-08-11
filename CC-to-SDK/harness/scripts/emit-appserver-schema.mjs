#!/usr/bin/env node
// scripts/emit-appserver-schema.mjs — generate the app-server's draft-7 JSON-Schema artifacts.
//
//   node scripts/emit-appserver-schema.mjs            # -> harness/schema/json/{stable,experimental}/appserver.json
//   node scripts/emit-appserver-schema.mjs --out DIR  # ... into DIR (what `ccx serve --emit-schema DIR` runs)
//   node scripts/emit-appserver-schema.mjs --stdout   # one {stable, experimental} JSON on stdout (round-trip test)
//
// NO new dependency: zod v4 converts natively (`z.toJSONSchema(schema, {target:"draft-7"})`), so the
// originally planned `zod-to-json-schema` never enters the tree.
//
// The generation itself is `src/appserver/schema/emit.ts`, not this file — `ccx serve --emit-schema` has to
// run the SAME code from dist/, where scripts/ does not ship. This is only the CLI around it, and it loads
// the TypeScript through tsx's ESM hook (tsx is already a devDependency) so the registry keeps exactly one
// source of truth: the .ts. A build step is deliberately not required — the artifacts must be regenerable
// from a clean checkout with nothing compiled.
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
const { buildArtifacts, writeArtifacts } = await import("../src/appserver/schema/emit.ts");

const argv = process.argv.slice(2);
if (argv.includes("--stdout")) {
  process.stdout.write(JSON.stringify(buildArtifacts()));
} else {
  const at = argv.indexOf("--out");
  // Resolved against THIS file, not the cwd: `npm run emit-schema` and a bare `node harness/scripts/…`
  // from the repo root must write the same vendored files.
  const dir = at === -1 ? fileURLToPath(new URL("../schema/json", import.meta.url)) : argv[at + 1];
  if (!dir) { console.error("emit-appserver-schema: --out requires a directory"); process.exit(2); }
  for (const path of writeArtifacts(dir)) console.log(`wrote ${path}`);
}
