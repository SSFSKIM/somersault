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
export const configWriteResult = z.object({
  status: z.enum(["ok", "okOverridden"]), version: z.string(), filePath: z.string(),
  overriddenMetadata: z.object({ message: z.string(), overridingLayer: layerName, effectiveValue: z.unknown() }).optional(),
  maskedEditIndexes: z.array(z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});
