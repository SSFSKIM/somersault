// harness/src/config/models.ts — tier alias → explicit model id.
//
// The SDK's own catalog (supportedModels(), probe 72) reports TIER ALIASES as its values, not model ids:
//   default → Sonnet 5 · sonnet → Sonnet 5 · opus → Opus 4.8 · haiku → Haiku 4.5 · claude-fable-5[1m]
// So anything that forwards the string "opus" — a `--model opus` flag, `/model opus`, or the /model
// picker sending back the entry it was given — lands on Opus 4.8, because that is what the CLI's alias
// table currently means. We pin the Claude-5 generation on our side instead.
//
// `default` maps to Opus 5 by OWNER DECISION (2026-07-30), not by mirroring the SDK: the catalog's
// `default` means Sonnet 5, and this harness wants its unqualified default to be the opus tier — the same
// choice DEFAULTS.model makes. It is deliberately NOT left to the SDK's moving recommendation.
// `haiku` IS left to the SDK: its target is already current and there is no 5-generation successor.
export const MODEL_ALIASES: Record<string, string> = {
  default: "claude-opus-5",
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  fable: "claude-fable-5",
};

/** Resolve a tier alias to its explicit model id. Anything else — a full id, the catalog's
 *  `claude-fable-5[1m]` variant, an unknown string — passes through unchanged; `undefined` stays
 *  `undefined` so callers can keep using `?? DEFAULTS.model`. Matching is case- and space-insensitive
 *  because the user-facing name is capitalized ("Opus" in the picker, "Sonnet" in the docs). */
export function resolveModelAlias(model?: string): string | undefined {
  if (model === undefined) return undefined;
  return MODEL_ALIASES[model.trim().toLowerCase()] ?? model;
}
