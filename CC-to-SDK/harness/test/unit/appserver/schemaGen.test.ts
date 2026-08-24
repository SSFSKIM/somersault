// appserver/schemaGen.test.ts — Task 6: the generated wire contract (spec §9). The artifacts under
// `harness/schema/json/` are VENDORED (committed), so the only thing that keeps them honest is a test
// that regenerates them and demands the same bytes back: a schema change with no `npm run emit-schema`
// is then a red test rather than a published contract that quietly describes last week's params.
// Shells out to the real generator (`node scripts/emit-appserver-schema.mjs`) rather than calling
// `buildArtifacts()` directly — the script's tsx hook and its CLI arms are part of what has to work.
import { describe, it, expect } from "vitest";
// NAMED, not default: under NodeNext the CJS default resolves to the module namespace and is not
// constructable at the type level, while `exports.Ajv` is both a real runtime export and a declared class.
// `ajv` is a DIRECT devDependency (^8.20.0). It first reached us transitively, through
// @anthropic-ai/claude-agent-sdk → @modelcontextprotocol/sdk; pinning it here means an SDK bump that drops
// or moves that transitive edge can no longer take this file's validation with it.
import { Ajv } from "ajv";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { methodSchemas } from "../../../src/appserver/schema/index.js";
import { SEARCH_CAPS } from "../../../src/appserver/searchScan.js";
import { threadSearchParams, threadSearchOccurrencesParams } from "../../../src/appserver/schema/search.js";

const harness = fileURLToPath(new URL("../../../", import.meta.url));
const script = "scripts/emit-appserver-schema.mjs";
const TIERS = ["stable", "experimental"] as const;
const vendoredPath = (tier: string) => join(harness, "schema", "json", tier, "appserver.json");
const vendoredText = (tier: string) => readFileSync(vendoredPath(tier), "utf8");
type VendoredDoc = { $schema: string; methods: Record<string, unknown>; results: Record<string, unknown> };
const vendored = (tier: string) => JSON.parse(vendoredText(tier)) as VendoredDoc;
/** EVERY subschema the artifact publishes — params AND results. The generic sweeps below are invariants
 *  of the document, not of the `methods` map: a result schema a strict validator cannot compile is
 *  exactly as broken as a method one, and it reaches clients by the same file. Labelled rather than
 *  spread into one object, because `config/read` is a key in BOTH maps: `{...doc.methods, ...doc.results}`
 *  would drop the method entry for precisely the methods this coverage is being widened to reach. */
const subschemas = (doc: VendoredDoc): Array<[string, unknown]> => [
  ...Object.entries(doc.methods).map(([name, schema]): [string, unknown] => [`${name} params`, schema]),
  ...Object.entries(doc.results).map(([name, schema]): [string, unknown] => [`${name} result`, schema]),
];
/** What `subschemas` must add up to, derived from the registry so no later task has to hand-edit it. */
const registeredSubschemaCount = Object.keys(methodSchemas).length + Object.values(methodSchemas).filter((e) => e.result).length;
/** The names the artifact's `results` map must carry, for one tier — read off the registry for the same
 *  reason as the count above. An equality over this (never a `toContain`) is what still catches a result
 *  the emitter dropped or invented; deriving it only stops the list from needing a hand-edit per landing. */
const registeredResults = (tier: (typeof TIERS)[number]) =>
  Object.entries(methodSchemas).filter(([, e]) => !!e.result && (e.experimental ? "experimental" : "stable") === tier).map(([name]) => name).sort();
/** A FRESH generation, run once for this file. Rows that name a specific entry read THIS rather than the
 *  vendored bytes, for the reason the `config/read` case below spells out: the vendored file is an artifact
 *  of the last `emit-schema` run, so an assertion against it stays green while the registry entry that
 *  produced it is deleted (measured — a sabotage pass that unregistered `tool/callResult` left a
 *  vendored-reading row passing). The byte-comparison rows pin fresh and vendored equal, so nothing is
 *  lost by generating. */
let freshRun: Record<string, VendoredDoc> | undefined;
const fresh = (tier: (typeof TIERS)[number]): VendoredDoc =>
  (freshRun ??= JSON.parse(execFileSync("node", [script, "--stdout"], { cwd: harness, encoding: "utf8" })) as Record<string, VendoredDoc>)[tier]!;

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

  /** FIX WAVE H / H4. A zod refinement in `schema/` is not a private guard — it EMITS into this vendored,
   *  client-facing artifact, which is the only thing a client can validate against. `searchTerm` was an
   *  unconstrained `z.string()` on both search methods with the 2–256 bound enforced in the handlers and
   *  stated only in prose, so a conforming validator accepted requests the published methods then refused
   *  `-32602`: the artifact was wrong about the contract it exists to describe. Both methods, because the
   *  sibling inherited the shape verbatim.
   *
   *  Asserted against `SEARCH_CAPS` rather than against the literals, so the row goes red if the numbers
   *  are changed in one place only — which is what publishing them from the caps table is FOR. And the
   *  refusal is exercised through a real validator, because "the keyword is present" is a weaker claim
   *  than "a conforming client refuses what the server refuses". */
  it("both search methods publish the term bounds they enforce — a conforming validator refuses what they refuse", () => {
    const doc = vendored("stable");
    // The SOURCE side first: the artifact's keywords are only true because the params schema carries the
    // checks that emitted them. Asserted here rather than left to the byte-pin row above, so that dropping
    // the refinement fails THIS row — the one that names the property — and not only the pin.
    for (const [name, schema] of [["thread/search", threadSearchParams], ["thread/searchOccurrences", threadSearchOccurrencesParams]] as const) {
      const of = (term: string) => (name === "thread/search" ? { searchTerm: term } : { threadId: "t", searchTerm: term });
      expect(`${name} parses 1 unit: ${schema.safeParse(of("a")).success}`).toBe(`${name} parses 1 unit: false`);
      expect(`${name} parses ${SEARCH_CAPS.maxTerm + 1} units: ${schema.safeParse(of("x".repeat(SEARCH_CAPS.maxTerm + 1))).success}`)
        .toBe(`${name} parses ${SEARCH_CAPS.maxTerm + 1} units: false`);
      expect(`${name} parses 2 units: ${schema.safeParse(of("ab")).success}`).toBe(`${name} parses 2 units: true`);
    }
    for (const method of ["thread/search", "thread/searchOccurrences"]) {
      const schema = doc.methods[method] as { properties: { searchTerm: Record<string, unknown> } };
      expect(`${method} minLength=${schema.properties.searchTerm.minLength}`).toBe(`${method} minLength=${SEARCH_CAPS.minTerm}`);
      expect(`${method} maxLength=${schema.properties.searchTerm.maxLength}`).toBe(`${method} maxLength=${SEARCH_CAPS.maxTerm}`);
      const validate = new Ajv({ strict: true, allErrors: true }).compile(schema as object);
      const params = (term: string) => (method === "thread/search" ? { searchTerm: term } : { threadId: "t", searchTerm: term });
      expect(`${method} 1 unit accepted by the published schema: ${validate(params("a"))}`).toBe(`${method} 1 unit accepted by the published schema: false`);
      expect(`${method} ${SEARCH_CAPS.maxTerm + 1} units accepted: ${validate(params("x".repeat(SEARCH_CAPS.maxTerm + 1)))}`)
        .toBe(`${method} ${SEARCH_CAPS.maxTerm + 1} units accepted: false`);
      // …and both legal boundaries still validate, or the published bound would refuse requests the
      // methods answer — the same off-by-one, in the other direction.
      expect(`${method} 2 units: ${validate(params("ab"))}`).toBe(`${method} 2 units: true`);
      expect(`${method} ${SEARCH_CAPS.maxTerm} units: ${validate(params("x".repeat(SEARCH_CAPS.maxTerm)))}`).toBe(`${method} ${SEARCH_CAPS.maxTerm} units: true`);
    }
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

  it("publishes a result schema for config/read and none for thread/start", () => {
    // M5's `MethodSchema.result` (spec D-M5-19), as the artifact sees it: declaring one publishes the
    // response shape, and the 59 methods that declare none publish nothing — the slot is incremental, so
    // "absent" has to stay a legible state rather than an empty object every method carries.
    // The results live in their own top-level map because a method entry must stay a schema a strict
    // validator can compile (emit.ts's note); the last two assertions are that claim, checked.
    // Read off a FRESH generation, not the vendored file: the vendored bytes are an artifact of the last
    // `emit-schema` run, so asserting on them would leave this case green while the registry entry or the
    // emission itself was deleted (measured — the byte-comparison cases above were the only ones that
    // fired). The two are pinned equal by those cases, so nothing is lost by generating here.
    const stable = (JSON.parse(execFileSync("node", [script, "--stdout"], { cwd: harness, encoding: "utf8" })) as Record<string, VendoredDoc>).stable;
    expect(stable).toEqual(vendored("stable"));
    expect(Object.keys(stable.results).sort()).toEqual(registeredResults("stable"));
    expect(stable.methods).toHaveProperty(["config/read"]);
    expect(stable.results).not.toHaveProperty(["thread/start"]);
    const result = stable.results["config/read"] as { type: string; required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
    expect(result.type).toBe("object");
    expect(result.required.sort()).toEqual(["config", "incomplete", "origins", "versions"]); // `layers` is includeLayers-only
    expect(result.properties).toHaveProperty("layers");
    const ajv = new Ajv({ strict: true });
    expect(() => ajv.compile(result)).not.toThrow();
    expect(() => ajv.compile(stable.methods["config/read"] as object)).not.toThrow();
  });

  it("publishes M7's settlement method with BOTH halves, and initialize's downgrade marker", () => {
    // The two registrations Task 8 made, read off the published document rather than off the registry:
    // `tool/callResult` is the method a client's tool runtime calls, and its ack is what a generated
    // client validates the reply against. `initialize`'s result is the F9 defence — an OLD server strips
    // an unknown `dynamicTools` param silently and starts the thread toolless, so a client that intends
    // to declare must be able to read `dynamicTools: true` off the handshake FIRST. Neither is usable
    // from the artifact unless the artifact carries it, which is what this row checks.
    const stable = fresh("stable");
    expect(stable.methods).toHaveProperty(["tool/callResult"]);
    expect(stable.results).toHaveProperty(["tool/callResult"]);
    expect(stable.results).toHaveProperty(["initialize"]);
    const ack = stable.results["tool/callResult"] as { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
    expect(ack.type).toBe("object");
    expect(ack.additionalProperties).toBe(false); // a closed `{}`: the settlement's whole reply
    const init = stable.results["initialize"] as { required: string[]; properties: { dynamicTools: { const?: unknown; enum?: unknown[] } } };
    expect(init.required.sort()).toEqual(["dynamicTools", "platformOs", "userAgent", "version"]);
    // The marker is pinned to `true`, not to `boolean`: a server that cannot host dynamic tools omits the
    // field, and publishing `boolean` would tell a client to write a `false` branch that never runs.
    expect(init.properties.dynamicTools.const ?? init.properties.dynamicTools.enum).toEqual(true);
  });

  it("the thread-status shape stays internal — no artifact carries waitingOn", () => {
    // A deliberate product decision from M7 Task 5: `waitingOn` is a live status field the server
    // broadcasts, not a published contract, and the status enum is free to grow a kind without a wire
    // change. Nothing registers a status schema, so nothing may publish one — asserted over the RAW text
    // because the field could otherwise arrive nested inside any method's or result's shape. Both the
    // published bytes and a fresh generation: the first is what clients hold, the second is what the
    // registry would publish the moment anyone regenerates.
    for (const tier of TIERS) {
      expect(vendoredText(tier), tier).not.toContain("waitingOn");
      expect(JSON.stringify(fresh(tier)), `${tier} fresh`).not.toContain("waitingOn");
    }
  });

  it("every artifact is draft-7, and no subschema — params or result — redeclares the dialect", () => {
    // zod's default output is 2020-12, which the CLI's ajv rejects (Wave 4's ajv gotcha) — this is the
    // assertion that would have caught it. The dialect is declared once, at the document root.
    for (const tier of TIERS) {
      const doc = vendored(tier);
      expect(doc.$schema, tier).toBe("http://json-schema.org/draft-07/schema#");
      for (const [label, schema] of subschemas(doc)) expect(schema, `${tier} ${label}`).not.toHaveProperty("$schema");
    }
  });

  it("never requires a field that carries a default — params or result", () => {
    // A defaulted param is optional to the CLIENT and required only after the server has parsed it. zod's
    // `io:"output"` view says otherwise, so the artifact is post-processed; this is the invariant, checked
    // over every registered method rather than over the three `unattended` fields that happen to have one
    // today (a count written here would be one more thing to update per landing wave). Results go through
    // the same `methodJsonSchema` pipeline, so they inherit both the bug and its repair.
    for (const tier of TIERS) {
      for (const [label, schema] of subschemas(vendored(tier))) {
        const { properties = {}, required = [] } = schema as { properties?: Record<string, object>; required?: string[] };
        for (const key of required) expect(properties[key], `${tier} ${label}.${key}`).not.toHaveProperty("default");
      }
    }
  });

  it("compiles under the CLI's own ajv in draft-7 mode, with zero errors", () => {
    // The Wave 4 ajv gotcha, as an executable check rather than a comment: `new Ajv()` IS draft-7 (ajv 8
    // exposes 2019/2020 as separate entry points), and `strict: true` is its own default, so anything zod
    // emitted that draft-7 does not understand fails here. RESULTS are swept too: measured, a result field
    // as ordinary as `z.iso.datetime()` emits `format: "date-time"`, which this ajv throws on — and with
    // the sweep reading `methods` alone the whole file stayed green while that shipped.
    const ajv = new Ajv({ strict: true });
    const failures: string[] = [];
    let compiled = 0;
    for (const tier of TIERS) {
      for (const [label, schema] of subschemas(vendored(tier))) {
        compiled++;
        try { ajv.compile(schema as object); } catch (e) { failures.push(`${label}: ${(e as Error).message}`); }
      }
    }
    expect(failures).toEqual([]);
    // Counted off the registry (params + declared results), so a later task registering a result moves
    // this expectation by itself — the count stays a real claim instead of a number kept alive by hand.
    expect(compiled).toBe(registeredSubschemaCount);
  });

  it("validates a thread/start request that omits its defaulted param — without useDefaults, and still closed", () => {
    // The concrete regression: `unattended` defaults to "park", so the output-view schema listed it in
    // `required` and this exact call — one the server accepts — failed validation. `useDefaults` is left
    // OFF on purpose: a validator that fills defaults in is checking a REPAIRED request, not the one on
    // the wire. The unknown-key half pins that the repair did not cost `additionalProperties: false`.
    const validate = new Ajv({ strict: true }).compile(vendored("stable").methods["thread/start"] as object);
    expect(validate({ config: { model: "x" } })).toBe(true);
    expect(validate({})).toBe(true); // every thread/start param is optional or defaulted
    expect(validate({ config: {}, notAParam: 1 })).toBe(false);
    expect(validate.errors?.map((e) => e.keyword)).toContain("additionalProperties");
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
