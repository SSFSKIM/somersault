// tui/src/usageFormat.ts — pure /usage + status-bar formatters (F4: probe 55 payload). rate_limits is
// populated only under the interactive credential (~/.claude/.credentials.json); a CLAUDE_CODE_OAUTH_TOKEN
// has no profile scope, so rate_limits_available comes back false — degrade honestly, never render blank.
import type { RenderLine } from "./render.js";

const WINDOWS: [string, string][] = [["five_hour", "5h"], ["seven_day", "7d"], ["seven_day_opus", "7d opus"], ["seven_day_sonnet", "7d sonnet"]];
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

/** Present windows (in WINDOWS order) that carry a numeric utilization, or [] if unavailable/none.
 * The unit (fraction 0-1 vs. already-a-percent 0-100) is inferred ONCE across the whole payload,
 * not per value: if any present window's utilization is greater than 1, the payload is expressed
 * in percent and every value is used as-is; otherwise every value is a fraction and gets ×100. This
 * disambiguates the realistic mixed case (five_hour: 43, seven_day: 1 -> 43%/1%, not 43%/100%). The
 * one case that's genuinely irreducible — a payload whose ONLY present value is exactly 1 — can't be
 * told apart from "1.0 == 100%" with a single sample, so it stays fraction-interpreted (100%). */
function presentWindows(u: unknown): { label: string; p: number; resetsAt?: string }[] {
  if (isUnavailable(u)) return [];
  const p = u as UsagePayload;
  const raw: { label: string; value: number; resetsAt?: string }[] = [];
  for (const [key, label] of WINDOWS) {
    const w = p.rate_limits![key];
    if (typeof w?.utilization === "number") raw.push({ label, value: w.utilization, resetsAt: w.resets_at });
  }
  const isPercent = raw.some((r) => r.value > 1);
  return raw.map((r) => ({ label: r.label, p: Math.round(isPercent ? r.value : r.value * 100), resetsAt: r.resetsAt }));
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
