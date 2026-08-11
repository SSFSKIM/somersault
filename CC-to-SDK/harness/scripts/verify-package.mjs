// Release-gate acceptance: prove the package works WHEN INSTALLED (not just in-repo).
// build -> npm pack -> install the tarball into a throwaway project -> assert the library
// imports, both subpath exports resolve under the package NAME (an export map is only ever
// half-tested in-repo, where relative paths resolve whether or not the map is right),
// files:["dist","schema"] shipped no src/, and the bin carries the node shebang.
// Needs network access: the temp install pulls the SDK + zod from the registry.
// Uses execFileSync (no shell) so interpolated paths can't be reinterpreted as commands.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const run = (file, args, opts = {}) => execFileSync(file, args, { stdio: "inherit", ...opts });
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// 1. build + pack. prepack rebuilds; the explicit build keeps the step legible.
//    Take the tarball name from npm's own --json output rather than reconstructing
//    it — scoped names don't follow `${name}-${version}.tgz`.
run("npm", ["run", "build"]);
const packOut = execFileSync("npm", ["pack", "--json"], { cwd: root }).toString();
const tarball = join(root, JSON.parse(packOut.slice(packOut.indexOf("[")))[0].filename);

const dir = mkdtempSync(join(tmpdir(), "cc-harness-verify-"));
try {
  // assert inside try so a name miss never leaks the tarball (cleanup is in finally)
  assert(existsSync(tarball), `npm pack reported a tarball that is not on disk: ${tarball}`);

  // 2. install the tarball into a throwaway project
  run("npm", ["init", "-y"], { cwd: dir, stdio: "ignore" });
  run("npm", ["install", tarball], { cwd: dir });
  const pkgDir = join(dir, "node_modules", pkg.name);

  // 3. library smoke: the public exports resolve at runtime — root barrel, the cc-harness/appserver
  //    subpath (gap 11), and the two vendored schema artifacts. The artifacts are resolved with
  //    createRequire().resolve + fs rather than imported as JSON modules: the export exists to make the
  //    FILES reachable, and JSON-module import is a Node-version/import-attributes question the package
  //    deliberately does not answer (src/appserver/index.ts documents the same contract).
  const probe = join(dir, "probe.mjs");
  writeFileSync(probe, [
    'import * as m from "cc-harness";',
    'import * as as from "cc-harness/appserver";',
    'import { createRequire } from "node:module";',
    'import { readFileSync } from "node:fs";',
    'const need = ["createHarness","DaemonSupervisor","DaemonServer","daemonRequest","SwarmRuntime","TaskStore"];',
    'const missing = need.filter((k) => typeof m[k] === "undefined");',
    'if (missing.length) { console.error("MISSING exports: " + missing.join(", ")); process.exit(1); }',
    'const asNeed = ["AppServer","listenWs","methodSchemas"];',
    'const asMissing = asNeed.filter((k) => typeof as[k] === "undefined");',
    'if (asMissing.length) { console.error("MISSING cc-harness/appserver exports: " + asMissing.join(", ")); process.exit(1); }',
    'const require = createRequire(import.meta.url);',
    // An `exports` map is CLOSED, so ./package.json only resolves because the map names it — and it
    // resolves in-repo whether or not the map does, which is exactly the half this installed proof covers.
    'const selfPkg = JSON.parse(readFileSync(require.resolve("cc-harness/package.json"), "utf8"));',
    'if (selfPkg.name !== "cc-harness") { console.error("BAD cc-harness/package.json export"); process.exit(1); }',
    'for (const tier of ["stable","experimental"]) {',
    '  const doc = JSON.parse(readFileSync(require.resolve(`cc-harness/appserver/schema/${tier}.json`), "utf8"));',
    '  if (doc.$schema !== "http://json-schema.org/draft-07/schema#" || !Object.keys(doc.methods || {}).length) {',
    '    console.error("BAD schema artifact: " + tier); process.exit(1); }',
    '}',
    'console.log("library import OK (" + need.length + " root + " + asNeed.length + " appserver exports, 2 schema artifacts, package.json subpath)");',
  ].join("\n"));
  run(process.execPath, [probe], { cwd: dir });

  // 4. files:["dist","schema"] smoke: dist + the vendored artifacts shipped, src did not
  assert(existsSync(join(pkgDir, "dist", "index.js")), "installed package missing dist/index.js");
  assert(existsSync(join(pkgDir, "dist", "appserver", "index.js")), "installed package missing dist/appserver/index.js");
  assert(existsSync(join(pkgDir, "dist", "appserver", "index.d.ts")), "installed package missing dist/appserver/index.d.ts");
  for (const tier of ["stable", "experimental"])
    assert(existsSync(join(pkgDir, "schema", "json", tier, "appserver.json")), `installed package missing schema/json/${tier}/appserver.json (files:["schema"] not honored)`);
  assert(!existsSync(join(pkgDir, "src")), "installed package leaked src/ (files:[dist,schema] not honored)");

  // 5. bin smoke: exists, non-empty, node shebang
  const bin = join(pkgDir, "dist", "cli.js");
  assert(existsSync(bin), "installed bin dist/cli.js missing");
  const binSrc = readFileSync(bin, "utf8");
  assert(binSrc.length > 0, "installed bin dist/cli.js is empty");
  const firstLine = binSrc.split("\n", 1)[0];
  assert(firstLine === "#!/usr/bin/env node", `bin shebang wrong: ${JSON.stringify(firstLine)}`);

  console.log("verify-package: PASS");
} finally {
  rmSync(tarball, { force: true });
  rmSync(dir, { recursive: true, force: true });
}
