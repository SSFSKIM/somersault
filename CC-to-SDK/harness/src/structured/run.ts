import { z } from "zod";
import { createHarness, type HarnessDeps } from "../harness.js";
import type { HarnessConfig } from "../config/types.js";
import { turnFailureOf } from "../session/turnResult.js";

/** A structured run that produced no parseable structured_output: a result frame that reported failure
 *  (incl. the SDK's own `error_max_structured_output_retries`), or a result with the field absent.
 *  Schema mismatches on a PRESENT structured_output throw zod's ZodError instead (more informative). */
export class StructuredRunError extends Error {
  readonly subtype?: string;
  readonly raw: unknown; // the offending result message (or the message list when none arrived)
  constructor(message: string, subtype: string | undefined, raw: unknown) {
    super(message); this.name = "StructuredRunError"; this.subtype = subtype; this.raw = raw;
  }
}

/** One-shot typed structured output: Zod schema → `outputFormat: json_schema` (via zod 4's native
 *  z.toJSONSchema) → one harness run → validated `result.structured_output` (probe 53 ✅ headless).
 *  Runs through createHarness, so the full HarnessConfig seam (model/permissions/sandbox/…) applies;
 *  any caller-set `outputFormat` is replaced by the schema's. */
export async function runStructured<S extends z.ZodType>(
  schema: S, prompt: string, config: HarnessConfig = {}, deps: HarnessDeps = {},
): Promise<z.infer<S>> {
  // target draft-7: the CLI validates the schema with ajv, which does NOT register the 2020-12
  // meta-schema zod emits by default ("--json-schema is not a valid JSON Schema" — caught live).
  const harness = createHarness({ ...config, outputFormat: { type: "json_schema", schema: z.toJSONSchema(schema, { target: "draft-7" }) } }, deps);
  const { messages } = await harness.run(prompt);
  const result = (messages as any[]).find((m) => m?.type === "result");
  if (!result) throw new StructuredRunError("structured run produced no result message", undefined, messages);
  // Task 14: `subtype` is NOT the classifier. Probe 96 measured the SDK reporting a dead connection as
  // `subtype:"success"` with `is_error:true`, so keying on subtype made a transport failure look like a
  // run that merely forgot its structured_output — and reported the "no structured_output" message for it.
  const failure = turnFailureOf(result);
  if (failure) throw new StructuredRunError(`structured run failed: ${failure.message}`, result.subtype, result);
  if (result.structured_output === undefined) throw new StructuredRunError("result carried no structured_output", result.subtype, result);
  return schema.parse(result.structured_output);
}
