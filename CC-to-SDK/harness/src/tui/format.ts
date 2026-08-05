// tui/src/format.ts — F3 Task 5: the shared upstream formatter ports, lifted out of `toolFold.ts` so the fold
// row and the typed result rows read the same bytes. Pure, dependency-free, and deliberately verbatim: these
// are ports of named 2.1.220 functions, so a "nicer" rounding rule here is a fidelity bug, not an improvement.

/** Upstream `ra` (L107033–107078). The fold row calls it with NO options (R4.9); the Bash timeout suffix calls
 *  it with `hideTrailingZeros` (`eRe`, L416953), which is what turns `2m 0s` into `2m`. */
export function formatDuration(ms: number, options?: { hideTrailingZeros?: boolean; mostSignificantOnly?: boolean }): string {
  if (ms < 60000) return ms === 0 ? "0s" : ms < 1 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 1000)}s`;
  let days = Math.floor(ms / 86400000), hours = Math.floor((ms % 86400000) / 3600000), minutes = Math.floor((ms % 3600000) / 60000), seconds = Math.round((ms % 60000) / 1000);
  if (seconds === 60) { seconds = 0; minutes++; }
  if (minutes === 60) { minutes = 0; hours++; }
  if (hours === 24) { hours = 0; days++; }
  if (options?.mostSignificantOnly === true) return days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : minutes > 0 ? `${minutes}m` : `${seconds}s`;
  const hide = options?.hideTrailingZeros === true;
  if (days > 0) return hide && hours === 0 && minutes === 0 ? `${days}d` : hide && minutes === 0 ? `${days}d ${hours}h` : `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return hide && minutes === 0 && seconds === 0 ? `${hours}h` : hide && seconds === 0 ? `${hours}h ${minutes}m` : `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return hide && seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Upstream `pl` / `formatFileSize` (L22444–22454) — the `humanSize` every Read image/pdf/parts row and the
 *  WebFetch row spell out. Note the units are `KB`/`MB`/`GB` with the `.0` stripped, NOT SI `kB`. */
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")}GB`;
}

/** Upstream `yd` (bundle 229070611, the census's `_d`): `Intl` compact notation, LOWERCASED — `24100` reads
 *  `24.1k`, `1200000` reads `1.2m`. The fraction digit is not merely ALLOWED, it is MANDATORY at or above
 *  1000: `yd(e){let t=e>=1000;return fOg(t).format(e).toLowerCase()}` picks between two cached formatters
 *  (`fOg`, 229072863) that differ only in `minimumFractionDigits` — `1` above the threshold, `0` below it. So
 *  `12000` reads `12.0k` (NOT `12k`) while `907` stays `907`. Used by the Agent `Done (…)` token clause. */
const compactFormats = [
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 0 }),
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 }),
];
export const formatCompactNumber = (value: number): string => compactFormats[value >= 1000 ? 1 : 0]!.format(value).toLowerCase();

/** Upstream `Et` (L15084): the ordinary pluralizer — `1` keeps the singular, everything else (including 0)
 *  takes the plural. Read's own rows use explicit `=== 1` ternaries that agree with it; Edit's diff summary
 *  deliberately does NOT (it pluralizes with `> 1`, so `0` reads `lines`), and `$Wo` strips a trailing `s`
 *  instead — both of those stay written out at their call sites rather than hiding behind this. */
export const plural = (count: number, word: string, pluralWord = `${word}s`): string => (count === 1 ? word : pluralWord);

/** Upstream `pie` (L107103-107115) in its DEFAULT `narrow` style, which is the only style any surface of ours
 *  asks for — `RZ` (L107116) is a thin wrapper that only picks `numeric` for the `Intl.RelativeTimeFormat`
 *  branch the narrow style never reaches, so the two collapse into one function here. The unit table is
 *  upstream's, largest-first, and the walk stops at the first unit whose whole seconds fit: `5m ago`, `2h ago`,
 *  `3d ago`, and `0s ago` for anything under a second. Future dates read `in 5m` — reachable only from a clock
 *  skew, and printing `-5m ago` there would be worse than saying the future out loud. F6 T10's rewind
 *  confirmation panel prints `(<this>)` under the message it is about to restore to. */
const RELATIVE_UNITS: readonly [seconds: number, short: string][] = [
  [31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"], [1, "s"],
];
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.trunc((date.getTime() - now.getTime()) / 1000);
  for (const [unit, short] of RELATIVE_UNITS) {
    if (Math.abs(seconds) < unit) continue;
    const n = Math.trunc(seconds / unit);
    return seconds < 0 ? `${Math.abs(n)}${short} ago` : `in ${n}${short}`;
  }
  return seconds <= 0 ? "0s ago" : "in 0s";
}
