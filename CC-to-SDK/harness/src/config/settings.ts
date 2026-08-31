import { DEFAULTS, type HarnessConfig, type SettingSource } from "./types.js";

export interface ResolvedSettings {
  settingSources: SettingSource[];
  settings?: Record<string, unknown>;
  managedSettings?: Record<string, unknown>;
  systemPromptExcludeDynamic: boolean;
}

/** Fold the typed SDK-`Settings` fields into the inline settings object (autocompact, plus bl7 T-ADVISOR's
 *  advisorModel). Typed fields win on key collision; returns undefined when nothing is set (preserves
 *  prior behavior). Renamed from `mergeAutoCompact` — its one call site is right below, so the rename is
 *  mechanical. */
function mergeSettings(config: HarnessConfig): Record<string, unknown> | undefined {
  const base: Record<string, unknown> = config.settings ? { ...config.settings } : {};
  if (config.autoCompactEnabled !== undefined) base.autoCompactEnabled = config.autoCompactEnabled;
  if (config.autoCompactWindow !== undefined) base.autoCompactWindow = config.autoCompactWindow;
  if (config.promptCacheTtl !== undefined) base.promptCacheTtl = config.promptCacheTtl;
  if (config.subagentPromptCacheTtl !== undefined) base.subagentPromptCacheTtl = config.subagentPromptCacheTtl;
  if (config.advisorModel !== undefined) base.advisorModel = config.advisorModel;
  return Object.keys(base).length ? base : undefined;
}

export function resolveSettings(config: HarnessConfig): ResolvedSettings {
  const settingSources = config.disableProjectContext
    ? []
    : config.settingSources ?? DEFAULTS.settingSources;
  const systemPromptExcludeDynamic =
    config.excludeDynamicSections ?? config.disableProjectContext ?? false;
  return {
    settingSources,
    settings: mergeSettings(config),
    managedSettings: config.managedSettings,
    systemPromptExcludeDynamic,
  };
}
