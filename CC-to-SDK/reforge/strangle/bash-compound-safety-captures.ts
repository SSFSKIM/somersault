// Copy-ready capture inventory for C13b's three engine-chunk runtime roots.
// This file does not mutate the shared manifest. It derives every identifier
// from the pinned AST and refuses an omitted or extra semantic mapping.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { resolveAnchor } from "./anchor.js";
import { assertSignature, chunkAst, selectExcision } from "./ast.js";
import { freeIdentifiers } from "./scope.js";

import {
  BASH_SAFETY_ROOTS,
  COPY_READY_BASH_SAFETY_CAPTURES,
} from "./bash-compound-safety-capture-specs.js";

const modules = new Map<string, string>();
for (const file of readdirSync(BUNDLE_MODULES)) {
  if (file.endsWith(".js")) {
    const path = join(BUNDLE_MODULES, file);
    modules.set(path, readFileSync(path, "utf8"));
  }
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const retoken = (body: string, identifier: string, replacement: string) =>
  body.replace(
    new RegExp(`(?<![\\w$])${escapeRegex(identifier)}(?![\\w$])`, "g"),
    replacement,
  );

const found: Record<string, string[]> = {};
let perturbationChecks = 0;
for (const [name, spec] of Object.entries(BASH_SAFETY_ROOTS)) {
  const resolved = resolveAnchor(
    modules,
    {
      name,
      anchor: spec.anchor,
      coLiteral: "coLiteral" in spec ? spec.coLiteral : undefined,
    },
    basename,
  );
  const sourceFile = chunkAst(resolved.path, resolved.source);
  const cut = selectExcision(name, sourceFile, resolved.offsets, "free-function", {
    params: spec.params,
    ancestry: ["SourceFile"],
  });
  assertSignature(name, cut, { params: spec.params, ancestry: ["SourceFile"] });
  found[name] = freeIdentifiers(cut.node);
  const captures = COPY_READY_BASH_SAFETY_CAPTURES[
    name as keyof typeof COPY_READY_BASH_SAFETY_CAPTURES
  ];
  const declared = captures.map(({ derive }) => derive(cut.original));
  const actual = found[name];
  const missing = actual.filter((identifier) => !declared.includes(identifier));
  const extra = declared.filter((identifier) => !actual.includes(identifier));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${name}: capture mapping differs from pinned AST; missing mappings [${missing.join(", ")}], extra mappings [${extra.join(", ")}]`,
    );
  }
  if (new Set(declared).size !== declared.length) {
    throw new Error(`${name}: capture mapping repeats an identifier`);
  }
  const semanticNames = captures.map(({ as }) => as);
  if (new Set(semanticNames).size !== semanticNames.length) {
    throw new Error(`${name}: capture mapping repeats a semantic name`);
  }
  for (const capture of captures) {
    const identifier = capture.derive(cut.original);
    const renamed = `Z${identifier}Z`;
    const tracked = capture.derive(retoken(cut.original, identifier, renamed));
    if (tracked !== renamed) {
      throw new Error(
        `${name}.${capture.as}: rename not tracked; expected ${renamed}, got ${tracked}`,
      );
    }
    let failedLoudly = false;
    try {
      capture.derive(retoken(cut.original, identifier, "1"));
    } catch {
      failedLoudly = true;
    }
    if (!failedLoudly) {
      throw new Error(`${name}.${capture.as}: destroyed capture did not fail loudly`);
    }
    perturbationChecks += 2;
  }
}

export const DERIVED_BASH_SAFETY_CAPTURES = found;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`bash safety captures @ ${ENGINE_VERSION}`);
  for (const [name, identifiers] of Object.entries(found)) {
    console.log(`${name}: ${identifiers.length} [${identifiers.join(", ")}]`);
  }
  console.log(`capture derivation perturbation: PASS (${perturbationChecks} checks)`);
}
