// appserver/schema/emit.ts — the published wire contract, generated from `methodSchemas` (spec §9: zod is
// the single source of truth, so the JSON Schema a client validates against is DERIVED, never hand-written).
// Lives in src/ rather than in scripts/ because two callers need it: `npm run emit-schema` (the vendored
// artifacts under harness/schema/json/) and `ccx serve --emit-schema DIR`, which must run the same
// generation from dist/ on a machine that has the installed package and no repo scripts/ directory.
//
// TWO FILES, not one document with a per-method flag: `stable/appserver.json` is the surface a client may
// pin, `experimental/appserver.json` holds the `experimental: true` entries. A consumer that must not build
// on an X method then gets a hard "unknown method" from validating against the stable artifact alone,
// instead of a marker it has to remember to read; and the two files diff independently, so a wave that
// only moves experimental shapes leaves the stable contract visibly untouched. A method is in exactly one
// of them — graduating it is flipping its marker in the registry and regenerating.
//
// draft-7, not zod's default 2020-12: the CLI's ajv rejects 2020-12 outright (Wave 4's ajv gotcha). No new
// dependency does the conversion — zod v4 ships `z.toJSONSchema` natively.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { methodSchemas } from "./index.js";

export const DRAFT_7 = "http://json-schema.org/draft-07/schema#";
export interface SchemaArtifact { $schema: string; methods: Record<string, unknown> }
export type SchemaTier = "stable" | "experimental";

/** A DEFAULTED param is optional to the client, required only to the server. zod converts in its `io:
 *  "output"` view, which describes the object AFTER parsing — so `unattended: z.enum([…]).default("park")`
 *  lands in `required`, and a draft-7 validator run without `useDefaults` (ajv's default, and the only
 *  honest setting for validating a REQUEST) rejects `thread/start {config:{…}}` — a call the server itself
 *  accepts. Flipping to `io:"input"` is the wrong repair: measured, it drops `additionalProperties:false`,
 *  trading an over-strict artifact for an under-strict one. Instead keep the output view and relax exactly
 *  the one keyword that is wrong — a key whose own emitted schema carries a `default` cannot be required.
 *  Recursive, since a nested object (initialize's `clientInfo`) has the same problem for the same reason. */
function relaxDefaultedRequired(node: unknown): void {
  if (Array.isArray(node)) { for (const child of node) relaxDefaultedRequired(child); return; }
  if (!node || typeof node !== "object") return;
  const schema = node as { properties?: Record<string, unknown>; required?: unknown };
  if (schema.properties && Array.isArray(schema.required)) {
    const kept = (schema.required as string[]).filter((key) => {
      const property = schema.properties![key];
      return !(property && typeof property === "object" && Object.hasOwn(property, "default"));
    });
    // Dropped entirely when nothing survives, matching what zod emits for an all-optional object — an
    // artifact should not carry `"required": []` in one place and no key at all in another.
    if (kept.length) schema.required = kept; else delete schema.required;
  }
  for (const child of Object.values(node as Record<string, unknown>)) relaxDefaultedRequired(child);
}

/** The per-method `$schema` zod emits is DROPPED: the document declares the dialect once at its root, and
 *  draft-7 says the keyword should not appear in subschemas. */
function methodJsonSchema(params: z.ZodType): unknown {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(params, { target: "draft-7" }) as Record<string, unknown>;
  relaxDefaultedRequired(rest);
  return rest;
}

/** Walks the registry in REGISTRATION order (both artifacts inherit it) — the generated file then reads in
 *  the same order as `schema/index.ts` and as the scorecard's prose, and a re-run never reshuffles a diff. */
export function buildArtifacts(): Record<SchemaTier, SchemaArtifact> {
  const artifacts: Record<SchemaTier, SchemaArtifact> = { stable: { $schema: DRAFT_7, methods: {} }, experimental: { $schema: DRAFT_7, methods: {} } };
  for (const [name, entry] of Object.entries(methodSchemas)) artifacts[entry.experimental ? "experimental" : "stable"].methods[name] = methodJsonSchema(entry.params);
  return artifacts;
}

/** ONE serialization for every writer. The vendored artifacts are compared byte-for-byte against a fresh
 *  run (test/unit/appserver/schemaGen.test.ts), so the 2-space indent and the trailing newline are part of
 *  the contract rather than formatting taste. */
export function artifactText(artifact: SchemaArtifact): string { return `${JSON.stringify(artifact, null, 2)}\n`; }

/** Writes `<dir>/{stable,experimental}/appserver.json` and returns the paths written, in that order. */
export function writeArtifacts(dir: string): string[] {
  const artifacts = buildArtifacts();
  return (Object.keys(artifacts) as SchemaTier[]).map((tier) => {
    mkdirSync(join(dir, tier), { recursive: true });
    const path = join(dir, tier, "appserver.json");
    writeFileSync(path, artifactText(artifacts[tier]));
    return path;
  });
}
