// appserver/schemaToZod.ts — M7: the JSON-Schema→zod conversion subset (VALIDATION ONLY).
//
// A client that declares dynamic tools IS the tool runtime, and the schema it declares travels two
// separate roads. Advertisement takes the FIRST: `tools/list` hands the model the client's JSON Schema
// VERBATIM, untouched by this file. Validation takes the second and is all this file is: the one consumer
// is the `CallToolRequestSchema` handler, which parses the model's `arguments` against the converted
// schema before parking the call. Nothing here ever shapes what the model is shown.
//
// That split is the whole design pressure, and it produces two rules:
//
//   NEVER THROW. The input is a client-supplied blob, hostile by assumption (`properties: null`,
//   `minLength: "3"`, a getter that throws). Every rejection is `{ok:false, keyword}`; a throw at the call
//   seam would become -32603 INTERNAL for what is a caller's malformed declaration, and — worse — would
//   leave the model's tool call parked with nobody left to settle it. Task 2 calls this converter as its
//   schema admission check at DECLARATION time, so a refusal here becomes a -32602 naming `keyword`
//   before any tool goes live.
//
//   NEVER WIDEN SILENTLY. Whatever the subset cannot express refuses instead of converting to something
//   weaker. Because the model sees the verbatim schema, a dropped `maxLength` would make the tool accept
//   arguments its own advertisement forbids. So a bound against a type it cannot constrain, an `items`
//   with no array, and `const` fighting `enum` all refuse rather than being quietly ignored.
//
// THE KEYWORD VOCABULARY (later tasks embed these strings in -32602 messages naming the offender):
//   `oneOf`                                  an unsupported keyword names ITSELF
//   `type:array`, `additionalProperties:<schema>`   a supported keyword with a value outside the subset
//   `type:object (nested objects unsupported)`      the one pinned literal — flat argument objects only
//   `properties: unsupported shape`          a keyword whose VALUE is outside its JSON Schema domain
//   `items: missing`                         a keyword the declared type requires and did not get
//   `items: too deeply nested`               an `items` recursion the converter caps rather than following
//   `minLength: not applicable to type:number`      a constraint declared against the wrong type
//   `minLength/maxLength: inconsistent range`       min > max, either kind
//   `required:b not in properties`           a dangling required entry, naming the entry
// Field keywords are named BARE, not path-qualified (`pattern`, not `properties.a.pattern`) — the
// exception is a property whose whole schema is not an object, where the property IS the offender.
//
// CODE POINTS, NOT UTF-16 UNITS. JSON Schema counts `minLength`/`maxLength` in Unicode code points; zod's
// `.min()`/`.max()` count UTF-16 code units. "😀" is one code point and two units, so `.max(1)` rejects a
// string the client's `{maxLength:1}` accepts. Every length bound is therefore a `.refine` over
// `[...value].length`, and `.min()`/`.max()` must never appear in this file.
//
// NOR MAY `.int()`, for the same class of reason on the numeric axis: zod v4's `.int()` bundles JavaScript's
// SAFE-integer range into what reads as an integrality check, and would refuse 2^53 — a value JSON carries
// exactly and a verbatim `{type:"integer"}` accepts. Integrality is a `Number.isInteger` refinement with no
// range of its own. The rule behind both: a zod helper may only be used when its domain is EXACTLY the
// keyword's; where it is narrower, the narrowing is a disagreement with the advertisement, so refine instead.
import { z } from "zod/v4";

/** A converted schema plus the object mode it was built in — `strict` is `additionalProperties === false`,
 *  reported back so the caller can say which mode rejected an argument object. `z.ZodType` is v4's name
 *  for what v3 spelled `ZodTypeAny` (the repo idiom: `src/config/validate.ts`, `schema/index.ts`). */
export type ConvertOk = { ok: true; schema: z.ZodType; strict: boolean };
export type ConvertErr = { ok: false; keyword: string };
export type ConvertResult = ConvertOk | ConvertErr;

/** `items` may nest (an array of arrays), so conversion recurses; this keeps that recursion finite against
 *  a pathological declaration. It is NOT the declaration cap — Task 2's `MAX_SCHEMA_DEPTH` owns that, and
 *  measures the whole schema rather than this one axis. */
const MAX_ITEMS_NESTING = 8;

const ROOT_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "description"]);
const FIELD_KEYWORDS = new Set([
  "type",
  "description",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "items",
]);
const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);

type FieldOk = { ok: true; schema: z.ZodType };
type FieldResult = FieldOk | ConvertErr;

const refuse = (keyword: string): ConvertErr => ({ ok: false, keyword });

/** Own-key presence, not `!== undefined`: a keyword the client wrote down with an explicit `undefined` is a
 *  MALFORMED keyword, not an absent one. Treating it as absent would drop the constraint the client
 *  advertised — the silent widening this file forbids — so presence decides and the value check refuses. */
const hasOwn = (raw: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(raw, key);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A short, BOUNDED rendering of an offending value for the keyword string. Bounded because the value came
 *  off the wire: a keyword ends up inside an error message, and an unbounded one would let a client choose
 *  how long that message is. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "<array>";
  if (typeof value === "object") return "<schema>";
  // Every remaining kind is rendered through the SAME truncation: a function stringifies to its whole
  // source text and a symbol to its whole description, so truncating only strings would leave the
  // boundedness this function promises true of the wire path by accident rather than by construction.
  const text = typeof value === "string" ? value : String(value);
  return text.length <= 40 ? text : `${text.slice(0, 40)}…`;
}

/** Does a literal (an `enum` member or a `const`) belong to the declared type? */
function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return typeof value === "boolean";
  }
}

/** `minLength`/`maxLength`: string-only, non-negative integers (JSON Schema's own domain), consistent. */
function lengthBounds(raw: Record<string, unknown>, type: string): ConvertErr | { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {};
  for (const key of ["minLength", "maxLength"] as const) {
    if (!hasOwn(raw, key)) continue;
    const value = raw[key];
    if (type !== "string") return refuse(`${key}: not applicable to type:${type}`);
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return refuse(`${key}: unsupported shape`);
    if (key === "minLength") out.min = value;
    else out.max = value;
  }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    return refuse("minLength/maxLength: inconsistent range");
  }
  return out;
}

/** `minimum`/`maximum`: numeric-only, FINITE (Infinity constrains nothing and NaN compares false to
 *  everything, so both would be an assertion the tool cannot honor), consistent. */
function numberBounds(raw: Record<string, unknown>, type: string): ConvertErr | { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {};
  for (const key of ["minimum", "maximum"] as const) {
    if (!hasOwn(raw, key)) continue;
    const value = raw[key];
    if (type !== "number" && type !== "integer") return refuse(`${key}: not applicable to type:${type}`);
    if (typeof value !== "number" || !Number.isFinite(value)) return refuse(`${key}: unsupported shape`);
    if (key === "minimum") out.min = value;
    else out.max = value;
  }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    return refuse("minimum/maximum: inconsistent range");
  }
  return out;
}

/** The base validator for one field, before bounds: a literal (`const`), a union of literals (`enum`), an
 *  array over its converted `items`, or the plain typed validator. */
function baseSchema(raw: Record<string, unknown>, type: string, depth: number): FieldResult {
  const hasConst = hasOwn(raw, "const");
  const hasEnum = hasOwn(raw, "enum");
  if (hasConst && hasEnum) return refuse("const: conflicts with enum");
  if (hasConst) {
    if (type === "array") return refuse("const: not applicable to type:array");
    if (!matchesType(raw.const, type)) return refuse("const: unsupported shape");
    return { ok: true, schema: z.literal(raw.const as string | number | boolean) };
  }
  if (hasEnum) {
    if (type === "array") return refuse("enum: not applicable to type:array");
    const members = raw.enum;
    if (!Array.isArray(members) || members.length === 0 || !members.every((m) => matchesType(m, type))) {
      return refuse("enum: unsupported shape");
    }
    const literals = members.map((m) => z.literal(m as string | number | boolean));
    return { ok: true, schema: literals.length === 1 ? literals[0]! : z.union(literals) };
  }
  switch (type) {
    case "string":
      return { ok: true, schema: z.string() };
    case "number":
      return { ok: true, schema: z.number() };
    case "integer":
      // `.int()` IS A NARROWING, not just an integrality check: zod v4 attaches JavaScript's SAFE-integer
      // range to it, so it refuses 2^53 — a value JSON represents exactly and the verbatim-advertised
      // `{type:"integer"}` accepts. That would put the advertisement and the validator into exactly the
      // disagreement this file exists to prevent, only in the other direction. Integrality is
      // `Number.isInteger` and nothing more; the only range an integer field carries is the client's own
      // `minimum`/`maximum`, which ride the refinements below. (`.int()` must never appear in this file,
      // for the same reason `.min()`/`.max()` must not.)
      return { ok: true, schema: z.number().refine((v) => typeof v !== "number" || Number.isInteger(v), "must be an integer") };
    case "boolean":
      return { ok: true, schema: z.boolean() };
    default: {
      const items = raw.items;
      if (items === undefined) return refuse("items: missing");
      if (!isPlainObject(items)) return refuse("items: unsupported shape");
      const inner = convertField(items, depth + 1);
      if (!inner.ok) return inner;
      return { ok: true, schema: z.array(inner.schema) };
    }
  }
}

/** One property of the argument object (or one `items` schema, which obeys the same allowlist). */
function convertField(raw: Record<string, unknown>, depth: number): FieldResult {
  if (depth > MAX_ITEMS_NESTING) return refuse("items: too deeply nested");

  // THE TYPE IS CHECKED BEFORE THE ALLOWLIST because the type decides which keywords are even meaningful.
  // A nested object declaration carries `properties`, which is not a FIELD keyword — scanning first would
  // answer "properties" to every nested object and bury the one refusal a client needs to read.
  const type = raw.type;
  if (type === "object") return refuse("type:object (nested objects unsupported)");
  if (type !== undefined && (typeof type !== "string" || (!SCALAR_TYPES.has(type) && type !== "array"))) {
    return refuse(`type:${describeValue(type)}`);
  }
  // The scan comes next, and a missing type after it: a schema carrying keywords from outside the subset
  // is better described by naming one of them than by reporting the type it also lacks.
  for (const key of Object.keys(raw)) if (!FIELD_KEYWORDS.has(key)) return refuse(key);
  if (type === undefined) return refuse("type: missing");
  if (raw.description !== undefined && typeof raw.description !== "string") {
    return refuse("description: unsupported shape");
  }
  if (raw.items !== undefined && type !== "array") return refuse(`items: not applicable to type:${type}`);

  const lengths = lengthBounds(raw, type);
  if ("ok" in lengths) return lengths;
  const numbers = numberBounds(raw, type);
  if ("ok" in numbers) return numbers;

  const base = baseSchema(raw, type, depth);
  if (!base.ok) return base;

  // Bounds ride as refinements ON TOP of whatever base was built, so a bound declared alongside an `enum`
  // still applies (dropping it there would be exactly the silent widening this layer forbids).
  //
  // EACH REFINEMENT IS TOTAL ON ITS OWN — it declines to judge a value of the wrong runtime type and lets
  // the base validator own that failure. A bound only survives `lengthBounds`/`numberBounds` for the type it
  // can constrain, and zod aborts a schema's remaining checks once the base type check fails, so a number
  // cannot reach a length refine today. But that second half is a LIBRARY-INTERNAL ordering rule, and
  // `[...5]` throws TypeError — inside `safeParse`, at the call seam, which is exactly the -32603 this file
  // exists to prevent. Totality here must not depend on it. (Pinned by the non-string row in the suite.)
  let schema = base.schema;
  if (lengths.min !== undefined) {
    const min = lengths.min;
    schema = schema.refine((v) => typeof v !== "string" || [...v].length >= min, `must be at least ${min} characters`);
  }
  if (lengths.max !== undefined) {
    const max = lengths.max;
    schema = schema.refine((v) => typeof v !== "string" || [...v].length <= max, `must be at most ${max} characters`);
  }
  if (numbers.min !== undefined) {
    const min = numbers.min;
    schema = schema.refine((v) => typeof v !== "number" || v >= min, `must be >= ${min}`);
  }
  if (numbers.max !== undefined) {
    const max = numbers.max;
    schema = schema.refine((v) => typeof v !== "number" || v <= max, `must be <= ${max}`);
  }
  return { ok: true, schema };
}

function convertRoot(schema: Record<string, unknown>): ConvertResult {
  if (!isPlainObject(schema)) return refuse("root: unsupported shape");

  // A tool's input schema is an object by the MCP contract, so the root `type` is a restatement rather
  // than a declaration — optional, but wrong if it says anything else. Checked before the allowlist scan
  // for the same reason as in `convertField`: an array-typed root would otherwise be refused for its
  // `items`, which is only a foreign keyword BECAUSE the root is not the object it claims to be.
  const type = schema.type;
  if (type !== undefined && type !== "object") return refuse(`type:${describeValue(type)}`);
  for (const key of Object.keys(schema)) if (!ROOT_KEYWORDS.has(key)) return refuse(key);
  if (schema.description !== undefined && typeof schema.description !== "string") {
    return refuse("description: unsupported shape");
  }

  const additional = schema.additionalProperties;
  if (additional !== undefined && typeof additional !== "boolean") {
    return refuse(`additionalProperties:${describeValue(additional)}`);
  }
  const strict = additional === false;

  const properties = schema.properties;
  if (properties !== undefined && !isPlainObject(properties)) return refuse("properties: unsupported shape");
  const declared = isPlainObject(properties) ? properties : {};

  const required = schema.required;
  let requiredNames: string[] = [];
  if (required !== undefined) {
    if (!Array.isArray(required) || required.some((name) => typeof name !== "string")) {
      return refuse("required: unsupported shape");
    }
    requiredNames = required as string[];
    for (const name of requiredNames) {
      if (!Object.prototype.hasOwnProperty.call(declared, name)) return refuse(`required:${name} not in properties`);
    }
  }

  // `Object.create(null)`, not `{}`: a property named `__proto__` (which `JSON.parse` puts on the params
  // as a real own key) would hit Object.prototype's setter on a literal — the entry would vanish from the
  // shape and the declared constraint would go unenforced, which is the silent widening this file exists
  // to prevent. A null-prototype shape carries it and zod validates it. NOTE for the call seam: zod's
  // PARSED OUTPUT still cannot carry that key, so a caller must park the arguments it validated, not the
  // parse result.
  const shape: Record<string, z.ZodType> = Object.create(null);
  for (const [name, raw] of Object.entries(declared)) {
    if (!isPlainObject(raw)) return refuse(`properties.${name}: unsupported shape`);
    const field = convertField(raw, 0);
    if (!field.ok) return field;
    shape[name] = requiredNames.includes(name) ? field.schema : field.schema.optional();
  }

  // Loose by default: JSON Schema admits extra keys unless `additionalProperties:false` says otherwise,
  // and a STRIPPING object (zod's plain `z.object`) would drop arguments the client's own schema accepts
  // before the client's runtime ever saw them.
  return { ok: true, schema: strict ? z.strictObject(shape) : z.looseObject(shape), strict };
}

/** Convert a declared tool input schema into the validator its calls are parsed against. Total: every
 *  input either converts or names the keyword that stopped it, and nothing escapes as a throw — the outer
 *  catch is the last-resort net under a hostile object (a throwing getter, an exotic proxy). */
export function jsonSchemaToZod(schema: Record<string, unknown>): ConvertResult {
  try {
    return convertRoot(schema);
  } catch {
    return refuse("root: unsupported shape");
  }
}
