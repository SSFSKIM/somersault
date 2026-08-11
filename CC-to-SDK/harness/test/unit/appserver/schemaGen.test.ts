// appserver/schemaGen.test.ts — Task 6: the generated wire contract (spec §9). The artifacts under
// `harness/schema/json/` are VENDORED (committed), so the only thing that keeps them honest is a test
// that regenerates them and demands the same bytes back: a schema change with no `npm run emit-schema`
// is then a red test rather than a published contract that quietly describes last week's params.
// Shells out to the real generator (`node scripts/emit-appserver-schema.mjs`) rather than calling
// `buildArtifacts()` directly — the script's tsx hook and its CLI arms are part of what has to work.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { methodSchemas } from "../../../src/appserver/schema/index.js";

const harness = fileURLToPath(new URL("../../../", import.meta.url));
const script = "scripts/emit-appserver-schema.mjs";
const TIERS = ["stable", "experimental"] as const;
const vendoredPath = (tier: string) => join(harness, "schema", "json", tier, "appserver.json");
const vendoredText = (tier: string) => readFileSync(vendoredPath(tier), "utf8");
const vendored = (tier: string) => JSON.parse(vendoredText(tier)) as { $schema: string; methods: Record<string, unknown> };

describe("emit-appserver-schema", () => {
  it("vendored schema artifacts match a fresh generation", () => {
    const fresh = execFileSync("node", [script, "--stdout"], { cwd: harness, encoding: "utf8" });
    expect(JSON.parse(fresh)).toEqual({ stable: vendored("stable"), experimental: vendored("experimental") });
  });

  it("regenerating into a fresh directory reproduces the vendored files byte for byte", () => {
    // Structural equality above would pass on a re-indented or re-ordered artifact; a vendored file is a
    // diff a human reads, so its BYTES are the contract (2-space indent, registration order, trailing \n).
    const dir = mkdtempSync(join(tmpdir(), "ccx-schema-"));
    try {
      execFileSync("node", [script, "--out", dir], { cwd: harness, encoding: "utf8" });
      for (const tier of TIERS) expect(readFileSync(join(dir, tier, "appserver.json"), "utf8"), tier).toBe(vendoredText(tier));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("every methodSchemas entry lands in exactly one artifact", () => {
    const stable = Object.keys(vendored("stable").methods);
    const experimental = Object.keys(vendored("experimental").methods);
    expect([...stable, ...experimental].sort()).toEqual(Object.keys(methodSchemas).sort());
    expect(stable.filter((m) => experimental.includes(m))).toEqual([]); // the XOR half — never both
    // The split is BY THE MARKER, not by a hand-kept list: an entry flagged experimental is in the
    // experimental file and nowhere else, and everything else is stable.
    for (const [name, entry] of Object.entries(methodSchemas)) expect(entry.experimental ? experimental : stable, name).toContain(name);
  });

  it("marks turn/steer experimental and leaves queue-flagged turn/start stable", () => {
    // The spec's one X method that shipped. `turn/start`'s `queue` FLAG is the experimental part of Wave
    // 4's queue, not the method — a client pinning the stable artifact must still find `turn/start`.
    expect(Object.keys(vendored("experimental").methods)).toEqual(["turn/steer"]);
    expect(vendored("stable").methods).toHaveProperty(["turn/start"]);
  });

  it("every artifact is draft-7, and no method subschema redeclares the dialect", () => {
    // zod's default output is 2020-12, which the CLI's ajv rejects (Wave 4's ajv gotcha) — this is the
    // assertion that would have caught it. The dialect is declared once, at the document root.
    for (const tier of TIERS) {
      const doc = vendored(tier);
      expect(doc.$schema, tier).toBe("http://json-schema.org/draft-07/schema#");
      for (const [name, schema] of Object.entries(doc.methods)) expect(schema, `${tier} ${name}`).not.toHaveProperty("$schema");
    }
  });

  it("each method schema is a closed object with its required params", () => {
    // A spot-check that the conversion carried zod's semantics rather than emitting an empty `{}` per
    // method (which would satisfy every structural assertion above while validating nothing).
    const turnStart = vendored("stable").methods["turn/start"] as { type: string; required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
    expect(turnStart.type).toBe("object");
    expect(turnStart.required.sort()).toEqual(["input", "threadId"]);
    expect(turnStart.properties).toHaveProperty("queue"); // optional, so present in properties but not required
    expect(turnStart.additionalProperties).toBe(false);
  });
});
