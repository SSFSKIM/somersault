// appserver/exports.test.ts — Task 7 (gap 11): the `cc-harness/appserver` subpath export.
// Four things rot independently, so each gets its own assertion: (1) the BARREL's value surface — a
// curated list, same deliberate-update discipline as test/unit/index.test.ts; (2) the type-only
// re-exports, which only a compiler can check, so they are exercised as typed locals; (3) the
// package.json export MAP that makes any of it reachable under the package name; and (4) whether the
// files those map entries name are actually BUILT (dist) and actually SHIPPED (the `files` globs — an
// export pointing outside them resolves in-repo and 404s for every installed consumer).
// The installed-tarball proof — import through the real package name out of a throwaway `npm install` —
// is scripts/verify-package.mjs. This file is its network-free in-repo counterpart, not a copy of it.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as appserver from "../../../src/appserver/index.js";
import type { AppServerDeps, EngineSession, MethodSchema, ThreadRecord, WsListenOpts } from "../../../src/appserver/index.js";

const harness = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(harness, "package.json"), "utf8")) as {
  files: string[]; exports: Record<string, unknown>;
};
const DIST_ENTRY = "dist/appserver/index.js";

/** The pack list npm itself computes from `files` — the only honest answer to "does this ship?", since a
 *  glob's reach is npm's business, not a regex's. `--ignore-scripts` skips `prepack` (the build is done
 *  once, below, and re-running it per test would triple the file's runtime for nothing). */
function packedFiles(): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: harness, encoding: "utf8" });
  return (JSON.parse(out.slice(out.indexOf("["))) as [{ files: { path: string }[] }])[0].files.map((f) => f.path);
}

describe("cc-harness/appserver subpath export", () => {
  it("freezes the barrel's value-export surface (deliberate-update gate)", () => {
    expect(Object.keys(appserver).sort()).toEqual(["AppServer", "listenWs", "methodSchemas"]);
    expect(typeof appserver.AppServer).toBe("function");
    expect(typeof appserver.listenWs).toBe("function");
    // Not merely present — the registry a consumer validates against, with this milestone's methods in it.
    expect(appserver.methodSchemas["thread/rewind"]).toBeTruthy();
    expect(appserver.methodSchemas["turn/steer"]?.experimental).toBe(true);
  });

  it("re-exports the types a consumer needs to write its own deps, opts and engine (compile-time)", () => {
    const opts: WsListenOpts = { host: "127.0.0.1", port: 0, allowOrigins: ["https://example.test"], token: "t" };
    const deps: AppServerDeps = { sessionFactory: () => engine };
    const schema: MethodSchema = appserver.methodSchemas["initialize"];
    const engine: EngineSession = {
      submit: async () => ({ result: null }), interrupt: async () => null,
      dispose: async () => {}, onFrame: () => () => {},
    };
    const record: Pick<ThreadRecord, "id" | "origin" | "busy"> = { id: "t1", origin: "inProcess", busy: false };
    expect([opts.port, typeof deps.sessionFactory, !!schema.params, typeof engine.submit, record.id])
      .toEqual([0, "function", true, "function", "t1"]);
  });

  it("declares the subpath in package.json exports", () => {
    expect(pkg.exports["./appserver"]).toEqual({ types: "./dist/appserver/index.d.ts", import: "./dist/appserver/index.js" });
    // Direct-path form: a JSON artifact has no types/import split to make.
    expect(pkg.exports["./appserver/schema/stable.json"]).toBe("./schema/json/stable/appserver.json");
    expect(pkg.exports["./appserver/schema/experimental.json"]).toBe("./schema/json/experimental/appserver.json");
  });

  it("builds the barrel into dist at the exact paths the export map names", { timeout: 120_000 }, () => {
    // Self-healing rather than skip-if-absent: a conditional assertion is a green light on an unbuilt
    // tree, which is precisely the state that would ship a broken export map. CI builds before
    // test:unit, so this arm normally costs nothing.
    if (!existsSync(join(harness, DIST_ENTRY))) execFileSync("npm", ["run", "build"], { cwd: harness, stdio: "inherit" });
    for (const target of [DIST_ENTRY, "dist/appserver/index.d.ts"]) expect(existsSync(join(harness, target)), target).toBe(true);
  });

  it("ships every path the export map names (the `files` globs)", { timeout: 120_000 }, () => {
    expect(pkg.files).toContain("schema"); // else the two JSON exports resolve in-repo and 404 once installed
    const packed = new Set(packedFiles());
    for (const target of [DIST_ENTRY, "dist/appserver/index.d.ts", "schema/json/stable/appserver.json", "schema/json/experimental/appserver.json"])
      expect(packed.has(target), `${target} missing from the pack list`).toBe(true);
  });

  it("points the JSON exports at the real generated artifacts", () => {
    for (const subpath of ["./appserver/schema/stable.json", "./appserver/schema/experimental.json"]) {
      const doc = JSON.parse(readFileSync(join(harness, pkg.exports[subpath] as string), "utf8")) as { $schema: string; methods: Record<string, unknown> };
      expect(doc.$schema, subpath).toBe("http://json-schema.org/draft-07/schema#");
      expect(Object.keys(doc.methods).length, subpath).toBeGreaterThan(0);
    }
    // The two tiers together ARE the registry — a stale vendored pair would otherwise ship happily
    // (schemaGen.test.ts owns the byte-for-byte round trip; this is the export map's own sanity check).
    const names = ["stable", "experimental"].flatMap((tier) =>
      Object.keys((JSON.parse(readFileSync(join(harness, "schema", "json", tier, "appserver.json"), "utf8")) as { methods: Record<string, unknown> }).methods));
    expect(names.sort()).toEqual(Object.keys(appserver.methodSchemas).sort());
  });
});
