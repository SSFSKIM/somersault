// tui/src/advisorModel.ts — bl8 T-ADVCMD Task 1: the pure catalog/eligibility half of canon 2.1.251's
// `/advisor` command (research-config-picker.md §2). Transcribed off `Dxe`/`ale`/`M8`/`ede`/`Zue`/`E`
// (chunk-wzpysq06.js, @185590859-185595300); ranks off the binary's model catalog (@155174245-155184801):
// haiku-4-5 → 1, sonnet-4-5 → 2, sonnet-5 → 3, opus-4-7/opus-4-8/opus-5 → 4, fable-5 → 5, floor `Aqt` = 2.
//
// SCOPE: ccx's own alias table (`resolveModelAlias`) only ever resolves `fable`/`opus`/`sonnet`/`haiku` to
// `claude-fable-5`/`claude-opus-5`/`claude-sonnet-5`/`haiku` (the newest generation of each tier — ccx has
// no separate alias for the older sonnet-4-5/opus-4-7/opus-4-8 rows canon's table also lists), so
// `ADVISOR_RANKS` below is keyed on exactly those four resolved ids, each carrying canon's rank for that
// SPECIFIC generation. A stray literal old id (e.g. a hand-set `--model claude-opus-4-8`) reads as
// "no rank entry" — conservative (treated as advisor-unsupported), not a bug: nothing in ccx ever produces
// that string on its own.
//
// WHY CLIENT-SIDE VALIDATION IS LOAD-BEARING (P119, docs/superpowers/specs/2026-08-30-bl8-qy-advisor-
// design.md §1): probed live against canon's engine — `advisorModel` accepts tier aliases end-to-end, but
// an INVALID value fails SILENTLY (`is_error:false`, the advisor tool simply never mounts; no error frame,
// no `Advisor unavailable (…)` row). The server will not catch a typo for us, so `applyAdvisorChoice` below
// is the only gate a bad `/advisor <arg>` ever passes through.
import { resolveModelAlias } from "../config/models.js";

/** Canon's per-generation advisor rank table (see header). Keyed on `resolveModelAlias`'s OWN resolved ids
 *  (or the alias itself when `resolveModelAlias` passes it through unchanged, as it does for `"haiku"` —
 *  ccx has no 5-generation successor to point that alias at, so the id ccx ever carries for it stays the
 *  literal alias string; see `config/models.ts`'s own comment on the same fact). */
export const ADVISOR_RANKS: Readonly<Record<string, number>> = {
  haiku: 1,
  [resolveModelAlias("sonnet")!]: 3,
  [resolveModelAlias("opus")!]: 4,
  [resolveModelAlias("fable")!]: 5,
};
/** Canon's `Aqt`. Eligible ADVISOR = rank >= this floor; `haiku` (rank 1) supports being advised but can
 *  never itself be the advisor. */
export const ADVISOR_RANK_FLOOR = 2;

const rankOf = (model: string): number | undefined => ADVISOR_RANKS[resolveModelAlias(model) ?? model];

/** Canon's `Rqt`, verbatim order — the fixed 3-entry catalog `Dxe()` filters. No fable-consent branch
 *  (`bG`): D12 dropped ccx's fable-consent flow entirely, so `Dxe`'s OR clause collapses to eligibility
 *  alone. */
const CATALOG_ALIASES: readonly string[] = ["fable", "opus", "sonnet"];

/** Canon's `Dxe()`: the catalog aliases whose resolved rank clears the floor, in canon's own order. */
export function advisorCatalog(): readonly string[] {
  return CATALOG_ALIASES.filter((alias) => {
    const r = rankOf(alias);
    return r !== undefined && r >= ADVISOR_RANK_FLOOR;
  });
}

/** Canon's `M8`: a main model SUPPORTS having an advisor at all iff it has ANY rank entry — the floor does
 *  not apply here, only to being chosen AS an advisor. A model with no entry (unknown to ccx's rank table)
 *  does not support the advisor. */
export function supportsAdvisor(model: string): boolean {
  return rankOf(model) !== undefined;
}

/** Canon's `ale`: PAIRING — can `advisor` advise `mainModel`? Missing a rank on either side is canon's own
 *  lenient default (`return!0`), not an omission: an unranked model (main or advisor) never blocks a pick,
 *  it only forfeits the "less capable" note below. */
export function canAdvise(mainModel: string, advisor: string): boolean {
  const main = rankOf(mainModel);
  const adv = rankOf(advisor);
  if (main === undefined || adv === undefined) return true;
  return main <= adv;
}

/** Canon's `Hm`: alias/id → canonical id → display name. ccx has no bundled static model-metadata table
 *  (unlike canon's client, which carries one) and this module is pure — no live SDK catalog to consult — so
 *  the map below covers exactly the four ids `ADVISOR_RANKS` cares about; anything else falls back to the
 *  id itself, same as canon's own fallback shape when a picker row is missing. */
const ADVISOR_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  haiku: "Haiku 4.5",
  [resolveModelAlias("sonnet")!]: "Sonnet 5",
  [resolveModelAlias("opus")!]: "Opus 5",
  [resolveModelAlias("fable")!]: "Fable 5",
};
export function advisorDisplayName(aliasOrId: string): string {
  const id = resolveModelAlias(aliasOrId) ?? aliasOrId;
  return ADVISOR_DISPLAY_NAMES[id] ?? id;
}

// ── The dialog's literals (research-config-picker.md "Reusable literals"), verbatim ──────────────────────
export const ADVISOR_TITLE = "Advisor (experimental)";
export const ADVISOR_BLURB =
  "When Claude needs stronger judgment — a complex decision, an ambiguous failure, a problem it's circling without progress — it escalates to the advisor model for guidance, then resumes. The advisor runs server-side and uses additional tokens.";
export const ADVISOR_RECOMMEND_PREFIX = "Recommended setup: ";
export const ADVISOR_RECOMMEND_BODY =
  "Sonnet as the main model with Opus as the advisor. For certain workloads this gives near-Opus performance with reduced token usage.";
export const ADVISOR_LINK = "https://claude.com/blog/the-advisor-strategy";
export const ADVISOR_OFF_LABEL = "No advisor";
export const advisorUnsupportedWarning = (name: string): string =>
  `The current main model (${name}) does not support the advisor.`;

/** bl8 T-ADVCMD Task 4 (spec §3.4, canon `jxe` @178890000): the launch-time discoverability notice. Canon
 *  re-derives "on"/"pairing" off `ale(mainLoopModel, advisorModel)` on every change and re-posts only on a
 *  state FLIP; ccx's own copy (spec §3.4, A12) is a one-shot posted at mount off the same `canAdvise`
 *  check. The fable-consent branch remains out of scope here (D12). The main-model-unsupported suppression
 *  (`M8` gate) was left to consuming code by design, not dropped — useChat.ts's startup-notice effect now
 *  gates on `supportsAdvisor` before choosing paired/unpaired text, closing it. */
export const ADVISOR_NOTICE_KEY = "advisor-experimental";
export const ADVISOR_NOTICE_PAIRED_TEXT = "Advisor Tool (experimental) is on and may use more tokens · /advisor";
export const ADVISOR_NOTICE_UNPAIRED_TEXT =
  "Advisor will not activate on the main model (advisor is less capable); subagents may still use it and may use more tokens · /advisor";

/** Canon's `E` (`applyAdvisor`), minus the remote/`(this session only)` branch (D10: ccx always live-
 *  applies AND persists) and the fable-consent branch (D12: dropped). Pure: no I/O, no persistence — the
 *  caller (a later task) reads `action`/`model` off the result to drive `setAdvisorModel` + the prefs
 *  write, and prints `message` verbatim as the command's result line. `current` is accepted for interface
 *  symmetry with that caller; this function does not special-case an already-current choice — canon's own
 *  apply is idempotent (re-picking the active advisor just re-runs the same branch), and so is this one. */
export function applyAdvisorChoice(
  choice: string,
  mainModel: string,
  current: string | undefined,
): { action: "set"; model: string; message: string } | { action: "off"; message: string } | { action: "invalid"; message: string } {
  void current;
  const c = choice.trim().toLowerCase();
  if (c === "off" || c === "unset") return { action: "off", message: "Advisor disabled" };

  const resolved = resolveModelAlias(c) ?? c;
  const rank = ADVISOR_RANKS[resolved];
  if (rank === undefined || rank < ADVISOR_RANK_FLOOR) {
    const options = [...advisorCatalog(), "off"].join(", ");
    return { action: "invalid", message: `${advisorDisplayName(resolved)} cannot be used as an advisor. Valid options: ${options}` };
  }

  const advisorName = advisorDisplayName(resolved);
  const mainName = advisorDisplayName(mainModel);
  let message = `Advisor set to ${advisorName}`;
  if (!supportsAdvisor(mainModel)) {
    message += `\nNote: the current main model (${mainName}) does not support the advisor. It will activate when you switch to a supported main model.`;
  } else if (!canAdvise(mainModel, resolved)) {
    message += `\nNote: ${advisorName} is less capable than the current main model (${mainName}), so the advisor will not activate. Choose a more capable advisor, or switch to a smaller main model.`;
  }
  return { action: "set", model: resolved, message };
}
