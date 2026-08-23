// test/unit/schemaToZod.test.ts — M7 Task 1: the JSON-Schema→zod conversion subset.
//
// WHAT THIS FILE PINS. `jsonSchemaToZod` is the VALIDATION half of M7's dynamic tools and nothing else:
// advertisement hands the model the client's schema VERBATIM (plan header), so this converter is only ever
// asked "do these arguments satisfy what the client declared?". Two properties follow from that, and every
// row below is one of them.
//
//   TOTAL. The input is a client-supplied blob and hostile by assumption. Conversion returns
//   `{ok:false, keyword}` for everything it cannot carry and NEVER throws — a throw at the call seam would
//   surface as -32603 (an INTERNAL error) for what is in fact a caller's malformed declaration, and would
//   also leave the model's tool call parked with nobody to settle it. The totality block below drives the
//   value domain of every keyword, including a property whose getter throws.
//
//   NO SILENT WIDENING. A constraint the subset cannot express refuses rather than converting to something
//   weaker. The model is being shown the verbatim schema, so a dropped `maxLength` means the tool accepts
//   arguments its own advertisement forbids — the one failure mode a validation-only layer must not have.
//   That is why bounds against the wrong type, `items` without a type, and `const`+`enum` all refuse
//   instead of being ignored.
//
// CODE POINTS, NOT UTF-16 UNITS (plan r5 finding 5). JSON Schema counts `minLength`/`maxLength` in Unicode
// code points; zod's `.min()`/`.max()` count UTF-16 code units. "😀" is ONE code point and TWO units, so
// `.max(1)` would reject a string the client's advertised `{maxLength:1}` accepts. The astral rows are the
// regression guard on that difference, and they are the reason the implementation may not use `.max()`.
//
// KEYWORD STRINGS ARE THE CONTRACT. Later M7 tasks embed `keyword` verbatim in -32602 messages naming the
// offender, so these assertions are on the exact string, never on `.ok === false` alone.
import { describe, it, expect } from "vitest";
import { jsonSchemaToZod } from "../../src/appserver/schemaToZod.js";

/** Convert and require success — the refusal keyword rides the failure message so a broken row reads. */
function converted(schema: Record<string, unknown>) {
  const result = jsonSchemaToZod(schema);
  if (!result.ok) throw new Error(`expected conversion to succeed; refused with ${result.keyword}`);
  return result;
}

/** Convert and require refusal, handing back the keyword to assert on. */
function refusal(schema: Record<string, unknown>): string {
  const result = jsonSchemaToZod(schema);
  if (result.ok) throw new Error("expected conversion to refuse, but it succeeded");
  return result.keyword;
}

describe("jsonSchemaToZod — object roots", () => {
  it("converts an empty object root and accepts the zero-argument call", () => {
    // The MCP contract makes `arguments` optional, so a zero-argument tool has to parse `{}` (plan header).
    const { schema, strict } = converted({ type: "object", properties: {} });
    expect(strict).toBe(false);
    expect(schema.parse({})).toEqual({});
  });

  it("treats a root with no declared type as the object it structurally is", () => {
    const { schema } = converted({ properties: { a: { type: "string" } } });
    expect(schema.parse({ a: "x" })).toEqual({ a: "x" });
  });

  it("honors required — listed properties are demanded, unlisted ones are optional", () => {
    const { schema } = converted({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    });
    expect(schema.parse({ a: "x" })).toEqual({ a: "x" });
    expect(schema.safeParse({ b: 1 }).success).toBe(false);
    expect(schema.safeParse({ a: 1 }).success).toBe(false);
  });

  it("passes unknown keys THROUGH by default — extras survive parse", () => {
    // JSON Schema admits extra keys unless additionalProperties says otherwise, so the default object mode
    // is loose and the extra must still be in the parsed value (a stripping object would silently drop
    // arguments the client's own schema accepts).
    const { schema, strict } = converted({ type: "object", properties: { a: { type: "string" } } });
    expect(strict).toBe(false);
    expect(schema.parse({ a: "x", extra: 1 })).toEqual({ a: "x", extra: 1 });
  });

  it("goes strict ONLY for additionalProperties:false", () => {
    const closed = converted({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false });
    expect(closed.strict).toBe(true);
    expect(closed.schema.parse({ a: "x" })).toEqual({ a: "x" });
    expect(closed.schema.safeParse({ a: "x", extra: 1 }).success).toBe(false);

    const open = converted({ type: "object", properties: { a: { type: "string" } }, additionalProperties: true });
    expect(open.strict).toBe(false);
    expect(open.schema.parse({ a: "x", extra: 1 })).toEqual({ a: "x", extra: 1 });
  });

  it("allows a root description", () => {
    expect(converted({ type: "object", description: "a tool", properties: {} }).strict).toBe(false);
  });
});

describe("jsonSchemaToZod — root keyword refusals", () => {
  it("refuses a root keyword outside the subset, naming it", () => {
    expect(refusal({ type: "object", properties: {}, oneOf: [{ type: "object" }] })).toBe("oneOf");
    expect(refusal({ $ref: "#/definitions/x" })).toBe("$ref");
  });

  it("refuses a schema-valued additionalProperties", () => {
    // Only the boolean form is in the subset; the schema form declares a constraint on EVERY extra key,
    // which neither object mode can carry.
    expect(refusal({ type: "object", properties: {}, additionalProperties: { type: "string" } })).toBe(
      "additionalProperties:<schema>",
    );
  });

  it("refuses a dangling required entry, naming the entry", () => {
    expect(refusal({ type: "object", properties: { a: { type: "string" } }, required: ["b"] })).toBe(
      "required:b not in properties",
    );
    expect(refusal({ type: "object", required: ["b"] })).toBe("required:b not in properties");
  });

  it("refuses a non-object root type", () => {
    expect(refusal({ type: "array", items: { type: "string" } })).toBe("type:array");
  });
});

describe("jsonSchemaToZod — the field subset", () => {
  const full = {
    type: "object",
    description: "the whole field allowlist in one schema",
    properties: {
      name: { type: "string", description: "a name", minLength: 1, maxLength: 5 },
      count: { type: "integer", minimum: 0, maximum: 10 },
      ratio: { type: "number" },
      flag: { type: "boolean" },
      mode: { type: "string", enum: ["fast", "slow"] },
      kind: { type: "string", const: "fixed" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["name", "count"],
    additionalProperties: false,
  } satisfies Record<string, unknown>;

  const valid = { name: "abc", count: 3, ratio: 0.5, flag: true, mode: "fast", kind: "fixed", tags: ["x", "y"] };

  it("converts every allowlisted field keyword and accepts a conforming argument object", () => {
    expect(converted(full).schema.parse(valid)).toEqual(valid);
  });

  it("enforces each converted constraint", () => {
    const { schema } = converted(full);
    const reject = (patch: Record<string, unknown>) => expect(schema.safeParse({ ...valid, ...patch }).success).toBe(false);
    reject({ name: "abcdef" }); // maxLength 5
    reject({ name: "" }); // minLength 1
    reject({ count: 1.5 }); // integer
    reject({ count: 11 }); // maximum
    reject({ count: -1 }); // minimum
    reject({ ratio: "0.5" }); // number
    reject({ flag: "true" }); // boolean
    reject({ mode: "medium" }); // enum membership
    reject({ kind: "other" }); // const
    reject({ tags: [1] }); // items type
    expect(schema.safeParse({ count: 3 }).success).toBe(false); // required name
  });

  it("keeps a bound declared ALONGSIDE an enum — no silent widening", () => {
    const { schema } = converted({
      type: "object",
      properties: { a: { type: "string", enum: ["ab", "c"], maxLength: 1 } },
      required: ["a"],
    });
    expect(schema.parse({ a: "c" })).toEqual({ a: "c" });
    expect(schema.safeParse({ a: "ab" }).success).toBe(false);
  });
});

describe("jsonSchemaToZod — field keyword refusals", () => {
  const field = (spec: Record<string, unknown>) => ({ type: "object", properties: { a: spec } });

  it("refuses the FIRST unknown field keyword, naming it", () => {
    expect(refusal(field({ type: "string", pattern: "^x", format: "email" }))).toBe("pattern");
  });

  it("refuses a nested object, as a field and inside items", () => {
    expect(refusal(field({ type: "object", properties: {} }))).toBe("type:object (nested objects unsupported)");
    expect(refusal(field({ type: "array", items: { type: "object" } }))).toBe("type:object (nested objects unsupported)");
  });

  it("refuses a field with no type and a type outside the subset", () => {
    expect(refusal(field({ description: "untyped" }))).toBe("type: missing");
    expect(refusal(field({ type: "date" }))).toBe("type:date");
    expect(refusal(field({ type: ["string", "null"] }))).toBe("type:<array>");
  });

  it("refuses a bound declared against a type it cannot constrain", () => {
    // Dropping it would be the silent widening this layer exists to prevent.
    expect(refusal(field({ type: "number", minLength: 1 }))).toBe("minLength: not applicable to type:number");
    expect(refusal(field({ type: "string", minimum: 1 }))).toBe("minimum: not applicable to type:string");
    expect(refusal(field({ type: "string", items: { type: "string" } }))).toBe("items: not applicable to type:string");
  });

  it("refuses an array with no items and a const that fights an enum", () => {
    expect(refusal(field({ type: "array" }))).toBe("items: missing");
    expect(refusal(field({ type: "string", const: "a", enum: ["a", "b"] }))).toBe("const: conflicts with enum");
  });
});

describe("jsonSchemaToZod — totality: conversion never throws", () => {
  const field = (spec: Record<string, unknown>) => ({ type: "object", properties: { a: spec } });

  it("refuses hostile values in every keyword's domain", () => {
    expect(refusal({ type: "object", properties: null })).toBe("properties: unsupported shape");
    expect(refusal({ type: "object", properties: { a: null } })).toBe("properties.a: unsupported shape");
    expect(refusal({ type: "object", properties: {}, required: "a" })).toBe("required: unsupported shape");
    expect(refusal({ type: "object", properties: {}, description: 7 })).toBe("description: unsupported shape");
    expect(refusal(field({ type: "string", minLength: "3" }))).toBe("minLength: unsupported shape");
    expect(refusal(field({ type: "number", maximum: Infinity }))).toBe("maximum: unsupported shape");
    expect(refusal(field({ type: "number", minimum: NaN }))).toBe("minimum: unsupported shape");
    expect(refusal(field({ type: "array", items: null }))).toBe("items: unsupported shape");
    expect(refusal(field({ type: "string", enum: [] }))).toBe("enum: unsupported shape");
    expect(refusal(field({ type: "string", enum: [1] }))).toBe("enum: unsupported shape");
    expect(refusal(field({ type: "integer", enum: [1.5] }))).toBe("enum: unsupported shape");
    expect(refusal(field({ type: "string", const: {} }))).toBe("const: unsupported shape");
    expect(refusal(field({ type: "string", const: 1 }))).toBe("const: unsupported shape");
    expect(refusal(field({ type: "string", description: 7 }))).toBe("description: unsupported shape");
  });

  it("enforces a property named __proto__ instead of dropping it", () => {
    // `JSON.parse` puts `__proto__` on the params as a REAL own key, and assigning it into a `{}` shape
    // would hit Object.prototype's setter — the constraint would vanish and the tool would accept anything
    // for a property its own advertisement types. The declaration is built the way the wire delivers it.
    const declared = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
    const { schema } = converted(declared);
    expect(schema.safeParse(JSON.parse('{"__proto__":"x"}')).success).toBe(true);
    expect(schema.safeParse(JSON.parse('{"__proto__":5}')).success).toBe(false);
  });

  it("refuses a non-object root instead of throwing on it", () => {
    expect(refusal(null as unknown as Record<string, unknown>)).toBe("root: unsupported shape");
    expect(refusal([] as unknown as Record<string, unknown>)).toBe("root: unsupported shape");
  });

  it("swallows a throwing property access into a refusal", () => {
    // The defensive wrap: nothing a client can put in a JSON-RPC param should ever become -32603.
    const hostile: Record<string, unknown> = { type: "object" };
    Object.defineProperty(hostile, "properties", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => jsonSchemaToZod(hostile)).not.toThrow();
    expect(refusal(hostile)).toBe("root: unsupported shape");
  });
});

describe("jsonSchemaToZod — bounds", () => {
  const field = (spec: Record<string, unknown>) => ({ type: "object", properties: { a: spec }, required: ["a"] });

  it("demands non-negative integers for the length bounds", () => {
    // JSON Schema's own requirement: minLength/maxLength are non-negative integers.
    expect(refusal(field({ type: "string", minLength: -1 }))).toBe("minLength: unsupported shape");
    expect(refusal(field({ type: "string", maxLength: 1.5 }))).toBe("maxLength: unsupported shape");
    expect(converted(field({ type: "string", minLength: 0, maxLength: 0 })).schema.parse({ a: "" })).toEqual({ a: "" });
  });

  it("refuses an inconsistent range of either kind", () => {
    expect(refusal(field({ type: "string", minLength: 2, maxLength: 1 }))).toBe("minLength/maxLength: inconsistent range");
    expect(refusal(field({ type: "number", minimum: 5, maximum: 1 }))).toBe("minimum/maximum: inconsistent range");
    // Equal endpoints are a legal one-value range, not an inconsistency.
    expect(converted(field({ type: "number", minimum: 5, maximum: 5 })).schema.parse({ a: 5 })).toEqual({ a: 5 });
  });

  it("counts CODE POINTS, not UTF-16 units", () => {
    // "😀" is one code point and two UTF-16 units — zod's .max(1) would reject it, JSON Schema accepts it.
    const max1 = converted(field({ type: "string", maxLength: 1 })).schema;
    expect(max1.parse({ a: "😀" })).toEqual({ a: "😀" });
    expect(max1.safeParse({ a: "ab" }).success).toBe(false);

    const min2 = converted(field({ type: "string", minLength: 2 })).schema;
    expect(min2.safeParse({ a: "😀" }).success).toBe(false);
    expect(min2.parse({ a: "😀a" })).toEqual({ a: "😀a" });
  });
});
