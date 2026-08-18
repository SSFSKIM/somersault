// src/appserver/schema/config.ts — the config trio's params AND results (spec D-M5-12/18/19).
import { z } from "zod/v4";

export const configReadParams = z.object({ includeLayers: z.boolean().optional(), cwd: z.string().min(1).optional() });
const layerName = z.enum(["user", "project", "local", "managed"]);
export const configReadResult = z.object({
  config: z.record(z.string(), z.unknown()),
  origins: z.record(z.string(), z.union([layerName, z.array(layerName)])),
  versions: z.record(z.string(), z.string()),
  incomplete: z.literal(true),
  layers: z.array(z.object({ name: layerName, filePath: z.string(), config: z.record(z.string(), z.unknown()).optional(), raw: z.string().optional(), disabledReason: z.string().optional() })).optional(),
});
export const keyPathParam = z.array(z.string().min(1)).min(1).max(32);
export const configTargetParam = z.enum(["user", "project", "local"]);
const mergeStrategy = z.enum(["replace", "upsert"]);
export const configValueWriteParams = z.object({
  keyPath: keyPathParam, value: z.unknown(), mergeStrategy,
  target: configTargetParam.default("user"), cwd: z.string().min(1).optional(), expectedVersion: z.string().min(1).optional(),
});
export const configBatchWriteParams = z.object({
  edits: z.array(z.object({ keyPath: keyPathParam, value: z.unknown(), mergeStrategy })).min(1).max(64),
  target: configTargetParam.default("user"), cwd: z.string().min(1).optional(), expectedVersion: z.string().min(1).optional(),
});
/** `overriddenMetadata.effectiveValue` is OPTIONAL: it is the merged view's value at the masked edit's
 *  keyPath, and that path does not always resolve — a higher layer holding a scalar where the edit wrote
 *  into an object leaves the keyPath with no value in the merged config at all, and the key is then absent.
 *  Absence, not `null`: a settings file may legitimately hold a null leaf, so `null` would be ambiguous
 *  with a real value while absence is not.
 *
 *  `uncheckedEditIndexes` names the edits LEFT OUT of the masking answer — a literal "." somewhere on the
 *  path makes the effective view's dotted leaf addressing ambiguous (D-M5-12), and a verdict drawn from it
 *  would be a guess. It is the machine-readable form of the matching `warnings` sentence: `status: "ok"`
 *  with an index listed here means "not reported as overridden", never "verified in force". */
export const configWriteResult = z.object({
  status: z.enum(["ok", "okOverridden"]), version: z.string(), filePath: z.string(),
  overriddenMetadata: z.object({ message: z.string(), overridingLayer: layerName, effectiveValue: z.unknown().optional() })
    .describe("describes ONE masked edit — the first, i.e. maskedEditIndexes[0]. A batch whose edits are masked by different layers reports only that one here; the full set is maskedEditIndexes")
    .optional(),
  maskedEditIndexes: z.array(z.number().int()).optional(),
  uncheckedEditIndexes: z.array(z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});
