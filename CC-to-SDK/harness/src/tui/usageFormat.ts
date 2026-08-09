// tui/src/usageFormat.ts — pure /usage + status-bar formatters (F4: probe 55 payload). rate_limits is
// populated only under the interactive credential (~/.claude/.credentials.json); a CLAUDE_CODE_OAUTH_TOKEN
// has no profile scope, so rate_limits_available comes back false — degrade honestly, never render blank.
import type { RenderLine } from "./render.js";

// The fixed windows, in display order. `model_scoped` is additive and dynamic (the server names each
// bucket), and `extra_usage` has a different shape entirely — both are handled separately below.
const WINDOWS: [string, string][] = [["five_hour", "5h"], ["seven_day", "7d"], ["seven_day_oauth_apps", "7d apps"], ["seven_day_opus", "7d opus"], ["seven_day_sonnet", "7d sonnet"]];
const bar = (p: number): string => "▓".repeat(Math.round(p / 10)).padEnd(10, "░");
const hhmm = (iso?: string): string => typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) + "Z" : "";

export const UNAVAILABLE = "plan usage not available under this credential (claude setup-token has no profile scope)";

interface RateWindow { utilization?: number; resets_at?: string }
interface UsagePayload { rate_limits_available?: boolean; rate_limits?: Partial<Record<string, RateWindow>> | null }

/** Whether the payload is genuinely unreachable under this credential (vs. just no windows present). */
function isUnavailable(u: unknown): boolean {
  const p = u && typeof u === "object" ? (u as UsagePayload) : undefined;
  return !p || p.rate_limits_available === false || !p.rate_limits;
}

/** Every present window carrying a numeric utilization, or [] if unavailable/none: the fixed WINDOWS in
 * display order, then the server's dynamic `model_scoped` buckets (labelled by their display_name), then
 * `extra_usage` when enabled.
 *
 * `utilization` is a PERCENTAGE, 0-100 — the SDK's own type says so on every window ("Percentage of the
 * window used, 0-100", sdk.d.ts SDKControlGetUsageResponse). An earlier revision inferred the unit from
 * the values (treating <=1 as a fraction and scaling by 100), which rendered a genuine 1% as 100% and
 * fired the >=80% warning on a nearly-unused plan. Do not reintroduce unit inference: read the declared
 * contract, not the sample. */
function presentWindows(u: unknown): { label: string; p: number; resetsAt?: string }[] {
  if (isUnavailable(u)) return [];
  const p = u as UsagePayload;
  const out: { label: string; p: number; resetsAt?: string }[] = [];
  const rl = p.rate_limits as Record<string, unknown>;
  for (const [key, label] of WINDOWS) {
    const w = rl[key] as RateWindow | null | undefined;
    if (typeof w?.utilization === "number") out.push({ label, p: Math.round(w.utilization), resetsAt: w.resets_at });
  }
  for (const m of (Array.isArray(rl.model_scoped) ? rl.model_scoped : []) as { display_name?: string; utilization?: number; resets_at?: string }[])
    if (typeof m?.utilization === "number") out.push({ label: String(m.display_name ?? "model"), p: Math.round(m.utilization), resetsAt: m.resets_at });
  const extra = rl.extra_usage as { is_enabled?: boolean; utilization?: number } | null | undefined;
  if (extra?.is_enabled && typeof extra.utilization === "number") out.push({ label: "extra", p: Math.round(extra.utilization) });
  return out;
}

/** `/usage` — one bar row per present rate-limit window, or the honest-unavailable line. */
export function formatUsage(u: unknown): RenderLine[] {
  if (isUnavailable(u)) return [{ text: UNAVAILABLE, dim: true }];
  const out: RenderLine[] = [{ text: "Plan usage", bold: true }];
  for (const { label, p, resetsAt } of presentWindows(u))
    out.push({ text: `  ${label.padEnd(10)}${bar(p)} ${p}%${resetsAt ? ` · resets ${hhmm(resetsAt)}` : ""}`, dim: true });
  return out;
}

/** The notification-queue key the warning below posts under. Wave C Task 14 (spec D-C3) moved the CONSUMER —
 *  this text was a chip on the status bar Wave C Task 2 retired, and is now a queued notification `useChat`
 *  posts when it CHANGES. The formatter did not move; it lives here with the rest of the usage vocabulary. */
export const USAGE_WARNING_KEY = "usage-warning";

/** Plan-usage warning: the max utilization across windows once it reaches 80%, else undefined. */
export function usageWarning(u: unknown): string | undefined {
  const windows = presentWindows(u);
  if (!windows.length) return undefined;
  const max = windows.reduce((a, b) => (b.p > a.p ? b : a));
  return max.p >= 80 ? `⚠ ${max.label} ${max.p}%` : undefined;
}

/** `/status`'s compact usage row: "5h 43% · 7d 12%", or undefined if unavailable/no windows. */
export function usageSummaryLine(u: unknown): string | undefined {
  const windows = presentWindows(u);
  return windows.length ? windows.map((w) => `${w.label} ${w.p}%`).join(" · ") : undefined;
}
