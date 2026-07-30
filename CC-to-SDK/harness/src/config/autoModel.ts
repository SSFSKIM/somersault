// harness/src/config/autoModel.ts
/** Models that support `auto` permission mode on the Anthropic API. On an unsupported model `auto`
 *  silently falls back to `default` (probe 18d), so the daemon forces a supported model when autonomy is
 *  requested. Membership is LIVE-VERIFIED, never inferred from a version number: probe 72 ran 18d's
 *  discriminator (default blocks a benign cwd edit, working auto approves it) on the Claude-5 generation
 *  and all three passed. Pass a tier alias through resolveModelAlias BEFORE this gate — "opus" is not an
 *  id and would be treated as unsupported. */
export const DEFAULT_AUTO_MODEL = "claude-sonnet-5";

const SUPPORTED = new Set([
  "claude-fable-5", "claude-opus-5", "claude-sonnet-5",                                      // probe 72
  "claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8",              // probe 18d + docs
]);

export function isAutoSupportedModel(model: string | undefined): boolean {
  return model !== undefined && SUPPORTED.has(model);
}

/** The model an autonomous session actually runs on: the requested one if it supports `auto`, else DEFAULT. */
export function resolveAutoModel(model?: string): string {
  return isAutoSupportedModel(model) ? model! : DEFAULT_AUTO_MODEL;
}
