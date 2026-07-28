// tui/src/usageFormat.ts — pure /usage + status-bar formatters (F4: probe 55 payload). rate_limits is
// populated only under the interactive credential (~/.claude/.credentials.json); a CLAUDE_CODE_OAUTH_TOKEN
// has no profile scope, so rate_limits_available comes back false — degrade honestly, never render blank.
import type { RenderLine } from "./render.js";

const WINDOWS: [string, string][] = [["five_hour", "5h"], ["seven_day", "7d"], ["seven_day_opus", "7d opus"], ["seven_day_sonnet", "7d sonnet"]];
const pct = (u: unknown): number | undefined => typeof u === "number" ? Math.round(u <= 1 ? u * 100 : u) : undefined;
const bar = (p: number): string => "▓".repeat(Math.round(p / 10)).padEnd(10, "░");
const hhmm = (iso?: string): string => typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) + "Z" : "";

export const UNAVAILABLE = "plan usage not available under this credential (claude setup-token has no profile scope)";

interface RateWindow { utilization?: number; resets_at?: string }
interface UsagePayload { rate_limits_available?: boolean; rate_limits?: Partial<Record<string, RateWindow>> | null }

/** Present windows (in WINDOWS order) that carry a numeric utilization, or [] if unavailable/none. */
function presentWindows(u: unknown): { label: string; p: number; resetsAt?: string }[] {
  const p = u && typeof u === "object" ? (u as UsagePayload) : undefined;
  if (!p || p.rate_limits_available === false || !p.rate_limits) return [];
  const out: { label: string; p: number; resetsAt?: string }[] = [];
  for (const [key, label] of WINDOWS) {
    const w = p.rate_limits[key];
    const value = pct(w?.utilization);
    if (value != null) out.push({ label, p: value, resetsAt: w?.resets_at });
  }
  return out;
}
/** Whether the payload is genuinely unreachable under this credential (vs. just no windows present). */
function isUnavailable(u: unknown): boolean {
  const p = u && typeof u === "object" ? (u as UsagePayload) : undefined;
  return !p || p.rate_limits_available === false || !p.rate_limits;
}

/** `/usage` — one bar row per present rate-limit window, or the honest-unavailable line. */
export function formatUsage(u: unknown): RenderLine[] {
  if (isUnavailable(u)) return [{ text: UNAVAILABLE, dim: true }];
  const out: RenderLine[] = [{ text: "Plan usage", bold: true }];
  for (const { label, p, resetsAt } of presentWindows(u))
    out.push({ text: `  ${label.padEnd(10)}${bar(p)} ${p}%${resetsAt ? ` · resets ${hhmm(resetsAt)}` : ""}`, dim: true });
  return out;
}

/** Status-bar warning: the max utilization across windows once it reaches 80%, else undefined. */
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
