// tui/src/banner.ts — pure welcome-banner builder. Returns RenderLine[] seeded ONCE as the first
// lines of the Static scrollback, so it scrolls away like CC's banner does AND Ink's <Static> ordering
// stays correct (a non-static banner would paradoxically render BELOW the static transcript). One style
// per RenderLine, so the box is uniformly accent-colored (CC's logo lines are colored too).
// CC ref: components/LogoV2/WelcomeV2.tsx ("✻ Welcome to Claude Code") + feedConfigs "Tips for getting started".
import type { RenderLine } from "./render.js";
import { ACCENT } from "./theme.js";
import { CCX_VERSION } from "./statusLine.js";
import { effortTitle, type EffortLevel } from "./modelPickerModel.js";
export { ACCENT };

/** Collapse $HOME to `~` so the cwd line stays short. */
export function shortCwd(cwd: string, home = process.env.HOME ?? ""): string {
  return home && (cwd === home || cwd.startsWith(home + "/")) ? "~" + cwd.slice(home.length) : cwd;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WAVE C TASK 13 (EP-C8) — the header (§C8.2) and the model/auth line (§C8.3).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** §C8.1 `I0r` (L452723): `>= 70` → `"horizontal"`, anything narrower → `"compact"`. The ONE number the
 *  header's two shapes hang off, so both live here rather than in two `if`s. */
export const BANNER_COMPACT_COLUMNS = 70;
/** The terminal width the banner sizes itself against when the caller names none. Read at CALL time, not at
 *  module load: `main.ts` seeds the banner before the REPL mounts, and a module-load read would freeze
 *  whatever width the process happened to start with. */
const cols = (columns?: number): number => columns ?? process.stdout.columns ?? 80;

/** §C8.2's `k6I` / `L6I` (L453377). Upstream renders `` ` Claude Code v2.1.220 ` `` / `" Claude Code "`;
 *  ours names ccx and ccx's own version — an AUTHORIZED DIVERGENCE (spec D-C9: shape fidelity, not
 *  impersonation), the same rule `statusLine.ts`'s `CCX_VERSION` was written under. The leading and trailing
 *  spaces are upstream's own template and are what separate the text from the border rule either side. */
export function bannerHeader(version: string = CCX_VERSION, columns?: number): string {
  return cols(columns) >= BANNER_COMPACT_COLUMNS ? ` ccx v${version} ` : " ccx ";
}
/** `offset: o5e === "compact" ? 1 : 3` (L453377) — how many border cells precede the text. */
export function bannerHeaderOffset(columns?: number): number {
  return cols(columns) >= BANNER_COMPACT_COLUMNS ? 3 : 1;
}

/** What `accountInfo()` ACTUALLY delivers headlessly — probe 101, not `sdk.d.ts`. Two fields arrive
 *  (`apiProvider`, and one credential-source field); `subscriptionType` is declared but NEVER present, which
 *  is why upstream's tier labels (`Claude Max` / `Claude Pro`) have no ccx counterpart below. `tokenSource`
 *  and `apiKeySource` are BOTH declared and the probe's own verdict names them inconsistently, so both are
 *  read and the first one present wins — the alternative is a label that vanishes on a field rename. */
export interface AccountFacts { apiProvider?: string; tokenSource?: string; apiKeySource?: string }
/** §C8.3's `r7` (L64248), verbatim — the complete non-firstParty display-name set. */
export const AUTH_PROVIDER_NAMES: Record<string, string> = {
  bedrock: "Amazon Bedrock", vertex: "Google Vertex AI", foundry: "Microsoft Foundry",
  anthropicAws: "Claude Platform on AWS", anthropicGoogleCloud: "Claude Platform on Google Cloud",
  mantle: "Amazon Bedrock (Mantle)", gateway: "Cloud gateway",
};
/** §C8.3's `cpf`, mapped onto the reachable fields. `undefined` means OMIT THE SEGMENT: upstream can print a
 *  tier because it reads one from its own auth store, and inventing "Claude Pro" from a token source we never
 *  saw a tier on would be a billing claim we cannot stand behind.
 *
 *  DIVERGENCE (forced, probe 101): upstream's first-party arm resolves `Cno()` — `Claude Enterprise` / `Claude
 *  Team` / `Claude Max` / `Claude Pro` / `Claude API`. None of those five is derivable headlessly, so the OAuth
 *  arm collapses to the one thing the token source does prove: the run bills a subscription rather than credits. */
export function billingLabel(account?: AccountFacts | null): string | undefined {
  if (!account) return undefined;
  const provider = account.apiProvider;
  // `hasOwn`, not a bare index: an `apiProvider` of "constructor"/"toString" would otherwise resolve a
  // function off the prototype chain and render it as a billing label.
  if (provider && provider !== "firstParty") return Object.hasOwn(AUTH_PROVIDER_NAMES, provider) ? AUTH_PROVIDER_NAMES[provider] : undefined;
  const source = account.tokenSource ?? account.apiKeySource;
  if (source === "CLAUDE_CODE_OAUTH_TOKEN") return "Claude subscription";
  return source ? "API Usage Billing" : undefined;      // any other credential source is metered
}

export interface BannerInfo {
  cwd: string; model?: string; mode?: string;
  /** The LAUNCH-RESOLVED effort (§C8.3 `ait`), not a setting — `main.ts` reads `config.effort ?? DEFAULTS.effort`
   *  because the banner seeds before the REPL owns any effort state. Absent = no clause at all. */
  effort?: EffortLevel;
  /** Absent (or unmappable) = no billing segment; see `billingLabel`. */
  account?: AccountFacts;
  version?: string; columns?: number;
}

/** The launch splash: an accent box + cwd/model/mode snapshot + getting-started tips. */
export function welcomeBanner(info: BannerInfo): RenderLine[] {
  const title = "✻ Welcome to Claude Code";
  const inner = Math.max(title.length, 47);                 // inner text width (between "│ " and "│")
  const bar = "─".repeat(inner + 2);
  // §C8.2: the header is BORDER TEXT on the top rule, not a line of its own — `╭───` + ` ccx v0.1.0 ` + the
  // rest of the rule. Sliced rather than concatenated so the top can never come out a cell wider than the
  // bottom (the box-alignment test reads exactly that).
  const head = bannerHeader(info.version, info.columns), off = bannerHeaderOffset(info.columns);
  const top = "╭" + bar.slice(0, off) + head + bar.slice(off + head.length) + "╮";
  // §C8.3 `ARa` = `${fQo} · ${cpf}`, where `fQo` is the display name plus `ait`'s ` with {Label} effort`.
  // DIVERGENCE (pre-existing, kept): the `·   mode` tail is not upstream — 2.1.220's banner shows no mode at
  // all (§C8.7) — and stays because Wave T's qa3-02 gate reads it: the banner, the host config and hookOpts
  // must be shown to agree on the launch mode. It is appended AFTER the annex's line, not woven into it.
  // DIVERGENCE (§C8.3 `fQo` = `p7(model)`): ccx prints the resolved model ID, not a display name. The catalog
  // that maps id → name is a `capabilities()` round-trip the banner seeds before anyone has made.
  const billing = billingLabel(info.account);
  const modelSeg = `${info.model ?? "(default)"}${info.effort ? ` with ${effortTitle(info.effort)} effort` : ""}${billing ? ` · ${billing}` : ""}`;
  const out: RenderLine[] = [
    { text: top, color: ACCENT },
    { text: "│ " + title.padEnd(inner) + " │", color: ACCENT, bold: true },
    { text: "╰" + bar + "╯", color: ACCENT },
    { text: "" },
    { text: `  cwd    ${shortCwd(info.cwd)}`, dim: true },
    { text: `  model  ${modelSeg}   ·   mode  ${info.mode ?? "default"}`, dim: true },
    { text: "" },
    { text: "  Tips for getting started" },
    { text: "  • Ask Claude to edit files, run commands, or explain code", dim: true },
    { text: "  • /help for commands · @ to reference files · ⇧Tab to change mode", dim: true },
    { text: "  • Esc to interrupt a response", dim: true },
    { text: "" },
  ];
  return out;
}
