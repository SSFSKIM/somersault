// tui/src/banner.ts — pure welcome-banner builder. Returns RenderLine[] seeded ONCE as the first
// lines of the Static scrollback, so it scrolls away like CC's banner does AND Ink's <Static> ordering
// stays correct (a non-static banner would paradoxically render BELOW the static transcript). One style
// per RenderLine, so the box is uniformly accent-colored (CC's logo lines are colored too).
// CC ref: components/LogoV2/WelcomeV2.tsx ("✻ Welcome to Claude Code") + feedConfigs "Tips for getting started".
import type { RenderLine } from "./render.js";
import { ACCENT } from "./theme.js";
import { TICK } from "./figures.js";
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
/** canon `dKm` (L500971) — the row threshold canon's first branch (`Gqe`, L500758) collapses the box below. */
export const BANNER_MIN_ROWS = 30;
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

/** What `accountInfo()` ACTUALLY delivers headlessly — probe 101, not `sdk.d.ts`. Under OAuth exactly two
 *  fields arrive, `apiProvider` and `tokenSource`; `subscriptionType` is declared but NEVER present, which
 *  is why upstream's tier labels (`Claude Max` / `Claude Pro`) have no ccx counterpart below.
 *
 *  On the SECOND field, corrected in t13 review: the probes-doc verdict was right all along — the live field
 *  is `tokenSource`. What was stale was the PROBE SCRIPT's own summary line, which printed `apiKeySource`
 *  (a field that never arrives) and so read as a contradiction; that line is fixed in probe 101. The
 *  `?? apiKeySource` fallback below stays anyway: `apiKeySource` is declared in `sdk.d.ts` and the API-KEY
 *  arm has never been observed at all (every run to date was OAuth), so reading both costs one `??` and
 *  covers the one credential path we have no evidence about. */
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// F8 TASK 8 — the getting-started checklist (spec D-F8-7). canon's tip inventory (L384137) is TWO entries,
// mutually exclusive on whether this is a fresh workspace, and both completable — replacing ccx's former
// three static tips (spec D-F8-7's only deliberate content deletion): a checklist whose entries can never
// complete is a checklist in shape only, and the affordances they named stay reachable from `? for
// shortcuts`.
//
// Review finding B: canon HIDES the whole section — header, rows and the home-dir note alike — once every
// completable, enabled tip is complete (`v4v`/`oMi`, L384140/L384155-384156: `n = !r.filter(({isCompletable,
// isEnabled}) => isCompletable && isEnabled).every(({isComplete}) => isComplete)`, and the caller only ever
// builds the section when `n` is true — L559798 `Enc(Xsl())` runs inside `if (imo)`). Without `isCompletable`
// a repo that already has a CLAUDE.md — most of them — would print a permanent tick forever, which is worse
// than the three static tips this task deleted. DEFERRED (deliberately, out of this task's scope): canon's
// other two hide rungs, a persisted `hasCompletedProjectOnboarding` flag and `projectOnboardingSeenCount >=
// 4`, need new persisted preference state this task does not add.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface Tip { key: string; text: string; isEnabled: boolean; isComplete: boolean; isCompletable: boolean }

export function startupTips(facts: { emptyWorkspace: boolean; hasClaudeMd: boolean }): Tip[] {
  return [
    { key: "workspace", text: "Ask Claude to create a new app or clone a repository", isComplete: false, isCompletable: true, isEnabled: facts.emptyWorkspace },
    { key: "claudemd", text: "Run /init to create a CLAUDE.md file with instructions for Claude", isComplete: facts.hasClaudeMd, isCompletable: true, isEnabled: !facts.emptyWorkspace },
  ];
}

/** `v4v`/`oMi`'s `n` (L384140/L384156): whether the section shows at all. Vacuously true (hidden) when no
 *  tip is both completable and enabled — the same "nothing left to say" verdict canon reaches. */
export function tipsVisible(tips: readonly Tip[]): boolean {
  return !tips.filter((t) => t.isCompletable && t.isEnabled).every((t) => t.isComplete);
}

/** canon's `Enc` (L559388): enabled only, incomplete first, the shared `TICK()` glyph on the complete,
 *  home-dir note last. The sort key is `Number(isComplete)` and `Array.prototype.sort` is stable, so two
 *  tips sharing a completion state keep their inventory order. Pure formatting only — whether this is
 *  called at all is `tipsVisible`'s call, made once by `welcomeBanner` below. */
export function renderTips(tips: readonly Tip[], inHomeDir: boolean): RenderLine[] {
  const rows = tips.filter((t) => t.isEnabled).slice()
    .sort((a, b) => Number(a.isComplete) - Number(b.isComplete))
    .map((t) => ({ text: `  ${t.isComplete ? TICK() + " " : ""}${t.text}`, dim: true }));
  if (inHomeDir) rows.push({ text: "  Note: You have launched ccx in your home directory. For the best experience, launch it in a project directory instead.", dim: true });
  return rows;
}

export interface BannerInfo {
  cwd: string; model?: string; mode?: string;
  /** Whether the launch cwd holds no visible entries, and whether it already has a `CLAUDE.md` — the two
   *  facts `startupTips` branches on. Absent = both false, which reads as "not an empty workspace, no
   *  CLAUDE.md yet" (the `claudemd` tip, uncompleted) — the safer default when the caller hasn't looked. */
  emptyWorkspace?: boolean; hasClaudeMd?: boolean;
  /** Whether the launch cwd IS the user's home directory — appends the checklist's trailing note. */
  inHomeDir?: boolean;
  /** The effort the launch NAMED (§C8.3 `ait`) — `main.ts` passes `config.effort` and nothing else, NOT
   *  `?? DEFAULTS.effort` (t13 review finding 4): a defaulted launch has no business asserting an axis the
   *  model may not have (`--model haiku` has none), and at seed time there is no catalog to ask. Absent =
   *  no clause at all, which is the honest rendering of "the user did not say". */
  effort?: EffortLevel;
  /** Absent (or unmappable) = no billing segment; see `billingLabel`. */
  account?: AccountFacts;
  version?: string; columns?: number;
  /** Terminal height at seed time. Absent = unknown, which renders the FULL form: a banner that hid itself
   *  because nobody measured would be worse than one row too many. */
  rows?: number;
  /** `renderer.screenReaderEnabled(env)`, resolved by the caller so one verdict serves both consumers. */
  screenReader?: boolean;
}

/** The launch splash: an accent box + cwd/model/mode snapshot + getting-started tips. */
export function welcomeBanner(info: BannerInfo): RenderLine[] {
  // canon `Gqe`'s first branch (L500758): `if (o7O || i7O < dKm)` — a screen reader, or a terminal too short
  // for the box. TWO SPANS, as canon's is: the greeting coloured and the version dim. Ours carries ccx's own
  // `✻` where canon opens on the bare words, so the degraded form and the full form (whose title line is
  // `✻ Welcome to Claude Code`) agree with each other (spec D-F8-12).
  if (info.screenReader === true || (info.rows !== undefined && info.rows < BANNER_MIN_ROWS)) {
    const head = "✻ Welcome to Claude Code", tail = ` ccx v${info.version ?? CCX_VERSION}`;
    return [{ text: head + tail, segments: [{ text: head, color: ACCENT }, { text: tail, dim: true }] }];
  }
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
  // Finding B: the WHOLE section — header included — is gated on `tipsVisible`, mirroring canon's own
  // `if (imo) Enc(Xsl())` (L559798): a checklist with nothing left to say is not drawn at all, not drawn
  // with every row ticked.
  const tips = startupTips({ emptyWorkspace: info.emptyWorkspace === true, hasClaudeMd: info.hasClaudeMd === true });
  const out: RenderLine[] = [
    { text: top, color: ACCENT },
    { text: "│ " + title.padEnd(inner) + " │", color: ACCENT, bold: true },
    { text: "╰" + bar + "╯", color: ACCENT },
    { text: "" },
    { text: `  cwd    ${shortCwd(info.cwd)}`, dim: true },
    { text: `  model  ${modelSeg}   ·   mode  ${info.mode ?? "default"}`, dim: true },
    { text: "" },
    ...(tipsVisible(tips) ? [{ text: "  Tips for getting started" }, ...renderTips(tips, info.inHomeDir === true)] : []),
    { text: "" },
  ];
  return out;
}
