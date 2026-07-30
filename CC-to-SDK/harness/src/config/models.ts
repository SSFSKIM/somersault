// harness/src/config/models.ts — tier alias → explicit model id.
//
// The SDK's own catalog (supportedModels(), probe 72) reports TIER ALIASES as its values, not model ids:
//   default → Sonnet 5 · sonnet → Sonnet 5 · opus → Opus 4.8 · haiku → Haiku 4.5 · claude-fable-5[1m]
// So anything that forwards the string "opus" — a `--model opus` flag, `/model opus`, or the /model
// picker sending back the entry it was given — lands on Opus 4.8, because that is what the CLI's alias
// table currently means. We pin the Claude-5 generation on our side instead.
//
// `default` and `haiku` are deliberately NOT aliased: the SDK's targets there are already current
// (Sonnet 5 and Haiku 4.5, which has no 5-generation successor), and pinning `default` would freeze a
// recommendation that is meant to move.
export const MODEL_ALIASES: Record<string, string> = {
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
