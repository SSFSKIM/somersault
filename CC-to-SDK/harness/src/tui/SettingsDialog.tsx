// tui/src/SettingsDialog.tsx — the `/config` Settings shell (Wave 3 task 5): title `Settings`, tab bar
// `Status · Config · Usage · Stats`. Status/Usage/Stats render a formatter's RenderLine[] read-only,
// fetched once per tab-entry (cached in local state so re-visiting a tab doesn't re-fetch); Config is the
// only interactive tab (5 rows from settingsRows.ts, `/`-search over them). No session access here — every
// engine-touching op (applyMode/setThink/applyOutputStyle, the three tab fetchers, the Model row's picker)
// is a callback injected by useChat.ts, same convention as AddDirDialog/ThemeDialog.
//
// F2 Task 8: no `useInput`. This dialog pushes TWO contexts — `Settings` (escape, the row cursor incl. j/k and
// ctrl+p/ctrl+n, enter/space to change, `/` to search) and `Tabs` (tab/shift+tab/left/right). Search mode is
// why the scopes stay pushed while typing rather than being gated off: `/`, `j`, `k` and space must reach the
// query as literal text, but the six root globals must stay unbound — and the nulls live in the context, so
// dropping it would revive them.
//
// F6 Task 2: the tab strip is the shared `Tabs` primitive (select/Tabs.tsx), which also OWNS `tabs:next`/
// `tabs:previous` now — an action handler is innermost-wins, so registering them here as well would just
// shadow it. Two behaviours are preserved by construction rather than by the `route()` wrapper they used to
// go through: a sub-view (Theme/Output-style) early-returns above the strip, so `Tabs` is not even mounted
// there; and while the `/` query is open the strip is handed `disableNavigation`, which registers no handlers
// at all — the actions fall through to `route` → `onSearchKey` and are ignored, exactly as before.
//
// F2 final review: task 8 routed every one of those actions into ONE `onKey` that then re-read the physical
// key, which quietly made the actions physical again — `"x": "select:next"` in a user's keybindings.json
// resolved, matched, reached this component and moved nothing. The split follows the SURFACE now, not the key:
// browsing dispatches on the ACTION (one closure per handler, below), and the `/` query keeps the physical
// body, because there a rebound printable key must type itself like every other character and only the event
// can tell `up` (exit the query) from `k` (a `k`).
//
// Theme and Output-style rows are EMBEDDED sub-views (this component swaps its own render to the
// sub-component, no nested border) — Esc/Enter inside them return to the Config list via `onDone`/`onPick`/
// `onCancel`, and this component's OWN key handling is gated off (`sub !== "none"` early-return) so a
// keystroke never reaches two handlers at once; the sub-view's `Select` scope is innermost and answers first.
// The Model row instead reuses the EXISTING top-level `state.modelPicker`
// flow (`onOpenModelPicker` → useChat's `openModelPicker`) — ChatApp's overlay chain renders ModelPicker
// ABOVE this dialog's own arm (Global Constraints line 38: "goes immediately after the modelPicker arm"),
// so opening it UNMOUNTS this component and remounts it once the pick/cancel resolves. That's why the
// "did anything change" summary is NOT built by incremental in-dialog tracking (a local ref would be lost
// across that remount) — useChat's `openSettings`/`closeSettings` instead snapshot `SettingsRowCtx` on open
// and diff it against a fresh snapshot on close, which survives fine across any number of sub-dialog visits
// because that snapshot lives in the HOOK, not in this component. Only `tab` (which also must survive the
// Model round-trip) is hook state too (`state.settings.tab`); everything else here (`focusId`/`view`/`search`/
// `sub`/the per-tab fetch cache/`thinkingTouched`) is ordinary component state — losing it on a Model-row
// detour is a minor, acceptable UX cost (row cursor resets, a since-visited Status/Usage/Stats tab re-fetches).
//
// WAVE S t5: the Config tab's BROWSE list is the shared `Select` (select/Select.tsx), not a hand-rolled
// cursor. That is what gives it a WINDOW sized from the terminal height (`settingsVisibleRows` below), the
// counted `↑ N more above` / `↓ N more below` indicators, and the four paging keys — pageup/pagedown/home/end
// — that the `Settings` context binds nowhere and this component never had. Binding those four onto the old
// unwindowed list instead would have been the "resolves but moves nothing" defect F2 exists to remove: with
// five rows always on screen there is no page to turn. The `/` search arm keeps its own static list and
// deliberately does NOT mount the Select (see the render). Because the list now sizes itself from `rows`,
// this dialog crossed into ChatApp's pane-owning class and `state.settings.open` joined its `paneOwned` gate.
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { buildRows, filterRows, cycleEnum, THINKING_WARNING, type SettingsRow, type SettingsRowCtx } from "./settingsRows.js";
import { clipRowText } from "./rewindModel.js";
import type { RenderLine } from "./render.js";
import { Line } from "./Transcript.js";
import { ACCENT, currentTheme } from "./theme.js";
import { ThemeDialog } from "./ThemeDialog.js";
import { OutputStylePicker } from "./OutputStylePicker.js";
import { savePrefs as realSavePrefs } from "./prefs.js";
import { Tabs } from "./select/Tabs.js";
import { Select } from "./select/Select.js";
import { moreAbove, moreBelow, overflowRows } from "./select/overflow.js";
import type { SelectView } from "./select/selectModel.js";

const TABS = ["Status", "Config", "Usage", "Stats"] as const;
type Tab = typeof TABS[number];
const TAB_SPECS = TABS.map((t) => ({ id: t, title: t }));
const NORMAL_FOOTER = "Enter/Space to change · / to search · Esc to close";
// DELIBERATE DIVERGENCE, same class as PermissionsDialog's RECENT_FOOTER (W3 final review Finding 5):
// upstream's search footer promises "↑ to tabs" — a header-focus mode this wave doesn't ship (line 86's
// own comment). key.upArrow below just exits search, identically to Esc — dropped the dead "↑ to tabs"
// chord so the footer never advertises a focus move that doesn't happen.
const SEARCH_FOOTER = "Type to filter · Enter/↓ to select · Esc to clear";
const READONLY_FOOTER = "Tab/←/→ to switch tabs · Esc to close";

/** WAVE S t5, ROW-CLIP ROUND — THE HORIZONTAL HALF OF THE WINDOW, and the same repair (and the same reasoning)
 *  as `PERMISSIONS_ROW_INSET` (PermissionsDialog.tsx:172-196). `SETTINGS_CHROME_ROWS` reserves ROWS and
 *  `Select`'s window counts OPTIONS, which only adds up while ONE OPTION IS ONE LINE. The Model row breaks it:
 *  `Model` + two spaces + `Default (recommended)` + three spaces + `For a specific model ID, use /model.` is
 *  67 columns, and the body it is drawn into is `columns − 6`, so it takes a second LINE below 73 while still
 *  counting as one option — and the frame grows by however many wrapped rows the window happens to hold. That
 *  shortfall is not a constant (it scales with the window), so a budget term cannot express it; the repair
 *  belongs where the invariant breaks, which is the row body.
 *
 *  MEASURED on the non-debug clear-counting instrument `SETTINGS_CHROME_ROWS` describes, walking the whole
 *  five-row list twice: before the clip the composed `ChatApp` frame behind `/config` drew a full-screen
 *  `clearTerminal` at panes 12, 13 and 14 at BOTH 60 and 70 columns (2 per ten cursor moves), and none at 80 or
 *  100 — which is exactly where the arithmetic above says the Model row stops fitting. After the clip: zero at
 *  every pane from 12 to 30 at all four widths.
 *
 *  IT LIVES HERE AND NOT IN `settingsRows.ts`, deliberately, and the same three reasons Task 6 gave for
 *  `PermissionsDialog` hold — the middle one harder here than there. (1) It is not a Model-row problem: the
 *  Theme row carries a hint too (44 columns, wraps below 50) and `permissionMode`/`outputStyle` take whatever
 *  value the engine reports, so every row kind can overflow and a clip aimed at one of them fixes one of five.
 *  (2) `buildRows`' `value` IS NOT ONLY A DISPLAY STRING — `useChat` snapshots `buildRows(ctx)` on open and
 *  again on close and diffs the two row-by-row to build the Esc-close change summary, which `summarizeChanges`
 *  prints into the TRANSCRIPT as `Set Model to <value>`. A clip applied in the model would make that diff
 *  width-dependent (a resize between open and close would read as a change) and would print an ellipsised
 *  value into a permanent transcript row. `settingsRows.ts` says in its own header that it holds no React and
 *  no geometry, and `test/tui/settingsRows.test.ts` reads it as a width-free formatter. (3) The precedent both
 *  dialogs follow, `RewindPicker`'s `AnchorLine`, clips in the COMPONENT with the shared primitive and leaves
 *  its own model (`anchorLabel`) width-free. Same division, same layer as its sibling — two dialogs clipping in
 *  different layers would be the real cost.
 *
 *  THE INSET IS SIX, and the six are the same six the permissions row spends: `borderStyle="round"`'s two rules
 *  plus `paddingX={1}`'s two columns (4), and inside that `Select`'s node row spends one column on the pointer
 *  gutter and one on its `gap={1}` (Select.tsx:347-352). Verified against a rendered 60-column frame: the body
 *  occupies exactly 54 columns. The `/` search arm's own list is drawn OUTSIDE the `Select` with a two-space
 *  indent instead of that gutter+gap pair, so its body is the same 6 columns in and shares this number. */
export const SETTINGS_ROW_INSET = 6;
export const settingsRowWidth = (columns: number = process.stdout.columns ?? 80): number =>
  Math.max(1, columns - SETTINGS_ROW_INSET);

/** One Config row's body, clipped to `width` and spent left to right across its two spans — the plain
 *  `label  value` head and the dim `   hint` tail, which is what the clip eats into first. `clipRowText`
 *  (rewindModel.ts:263) is the shared grapheme-wise clip `RewindPicker`, `HelpDialog` and `TaskPanel` all use,
 *  and its newline arm ends the row wherever a newline falls — the rest of that string would be a second line
 *  the window never budgeted for, and an engine-reported model id or output-style name is not ours to promise
 *  is single-line. Rendered as a FRAGMENT, not a `<Text>`: both call sites already wrap it in one that carries
 *  the focus colour, and a nested `<Text>` here would change nothing but the tree. */
function RowBody({ row, width }: { row: SettingsRow; width: number }) {
  const head = clipRowText(`${row.label}  ${row.value}`, width);
  const left = width - stringWidth(head);
  const hint = row.hint !== undefined && left > 0 ? clipRowText(`   ${row.hint}`, left) : "";
  return <>{head}{hint ? <Text dimColor>{hint}</Text> : null}</>;
}

/** WAVE S t5 — the rows this dialog spends on everything that is NOT the list, counted against the composed
 *  `ChatApp` frame rather than against `SettingsDialog` alone. That denominator is Wave S t4's finding
 *  (`REWIND_CHROME_ROWS`, rewindModel.ts:60-99) and it is the whole reason the number is not 9 (this dialog's
 *  own box, and nothing else): a budget counted from the box alone composes into a frame that REACHES the
 *  pane, and Ink 5.2.1 answers `outputHeight >= stdout.rows` (`ink.js:121`) with
 *  `clearTerminal + fullStaticOutput + output` — a full-screen wipe and a whole-transcript re-dump on every
 *  render, i.e. on every cursor move.
 *
 *  7 + 2 + 1 + 1, each term against this file's own render tree (`:171-207`):
 *    · 7 — the dialog's own UNCONDITIONAL chrome:
 *        1-2  the `borderStyle="round"` box's top and bottom rules
 *        3    the bold `Settings` title
 *        4    the `<Tabs>` strip
 *        5    the blank spacer under the strip
 *        6    the blank spacer above the footer
 *        7    `NORMAL_FOOTER`
 *    · +2 — the most the three CONDITIONAL rows can cost AT ONCE, which is two of them and never all three.
 *      They are `↑ N more above`, `↓ N more below`, and `THINKING_WARNING` (`:193`, the row the Thinking-mode
 *      row grows once it is toggled). THE WARNING AND `below` ARE MUTUALLY EXCLUSIVE: the warning hangs off
 *      the LAST option, so the moment it can render the window's end IS the option count and `below` is zero.
 *      There is no cursor position that draws both, and a third reserved row would buy space nothing can ever
 *      occupy. Reserving the two that CAN coexist unconditionally is still right, for the reason the rewind
 *      budget reserves its own pair: the indicators toggle as a consequence of scrolling, and a budget that
 *      dropped them would grow the window at the top of the list and shrink it again on the first step down —
 *      resizing the list under a moving cursor.
 *        THE MUTUAL-EXCLUSION ARGUMENT IS CORRECT AND THE TWO IS STILL NOT ENOUGH, which the row-clip round
 *      measured and this line used to get wrong. `above` and the warning are NOT mutually exclusive, and the
 *      state that draws both — the cursor on the Thinking row of a list scrolled past its top — is the ordinary
 *      one at any pane short enough to window five rows. That state costs `above` (1) + the option (1) + the
 *      warning (1) = three lines where the budget reserved two, so with the warning up the composed frame
 *      REACHES the pane: measured 2 clears per ten cursor moves at panes 12, 13 and 14 at 100 columns, and 4 at
 *      panes 12 through 15 at 60, 70 and 80, where the warning takes a second line as well. See the RESIDUAL
 *      paragraph below — it is left stated rather than fixed, with the two measured closures and their costs.
 *    · +1 — `ChatStatusBar`, the one sibling this budget models because it is the only UNCONDITIONAL one
 *      (ChatApp's last row). Everything else ChatApp can draw beside this dialog is handled by its `paneOwned`
 *      gate, which Wave S t5 extends to `state.settings.open` precisely because this dialog now sizes itself
 *      from `rows`. A budget could not model those anyway: the task panel alone is seven rows.
 *    · +1 — the `>=` above: the frame must end up STRICTLY shorter than the pane, not equal to it.
 *
 *  MEASURED, AND NOT WITH `lastFrame()`. `ink-testing-library` renders Ink with `debug: true`
 *  (`node_modules/ink-testing-library/build/index.js:74`), and in debug mode Ink writes
 *  `fullStaticOutput + output` and RETURNS BEFORE the `outputHeight >= stdout.rows` check (`ink.js:104-109`) —
 *  so a frame's line count there is `staticLines + outputHeight`, not the quantity Ink compares against the
 *  pane. Under `ChatApp` the `❯ /config` command echo is a static item, so every height read that way is one
 *  row too tall. The instrument that settles it instead is `stdout.write` on a REAL (non-debug) Ink render,
 *  counting `ansiEscapes.clearTerminal` writes, with `CI` deleted from the environment first (Ink's `isInCi`
 *  branch returns BEFORE the pane check and would silence every clear) and 45 ms between keypresses (in
 *  non-debug mode Ink throttles its render callback at 32 ms, so a harness that awaits one macrotask coalesces
 *  several cursor moves into ONE render and reports zero while the frame is measurably over the pane).
 *
 *  RE-MEASURED BY THE ROW-CLIP ROUND, AND THE CLAIM THIS PARAGRAPH USED TO MAKE — "ZERO CLEARS AT EVERY PANE OF
 *  12 OR MORE" — WAS TRUE ONLY AT 80 COLUMNS AND UP, AND ONLY WITH THE WARNING DOWN. Both halves of that are
 *  now measured, sweeping panes 12 → 30 at 60, 70, 80 and 100 columns, walking the whole five-row list twice
 *  (ten cursor moves, two laps — `Select` wraps at the ends, so a walk visits every row AND every window
 *  position, which the old "top of list / bottom" pair did not):
 *    · WARNING DOWN — before the row clip, 2 clears per walk at panes 12, 13 and 14 at BOTH 60 and 70 columns
 *      (the Model row wrapping; see `SETTINGS_ROW_INSET` above), and zero at 80 and 100. AFTER the clip, ZERO
 *      at every one of the 76 cells swept. That is what this budget can now claim, and the width qualifier is
 *      gone because the clip removed the width dependence rather than the budget absorbing it.
 *    · WARNING UP — still clears, and the clip only narrows it: panes 12 → 15 at 60, 70 and 80 columns and
 *      12 → 14 at 100 (before the clip, 12 → 16 at 60/70, 12 → 15 at 80, 12 → 14 at 100). The RESIDUAL
 *      paragraph below has the two closures and what each costs.
 *
 *  IT WAS 12 UNTIL THE t5 REVIEW, by both errors at once: three conditional rows reserved where only two can
 *  ever coexist, and a `lastFrame()` measurement inflated by that static echo. 12 cost one row of visible list
 *  at panes 13 through 16 and bought nothing at any pane.
 *
 *  THE RESIDUAL IS `THINKING_WARNING`, NAMED WITH ITS NUMBERS AND DELIBERATELY NOT FIXED IN THE ROW-CLIP ROUND.
 *  It fires only after the user toggles the Thinking row in THIS dialog session (`thinkingTouched`), and only
 *  while the cursor sits on that row in a list scrolled past its top; both are then permanent for the session.
 *  Two closures were measured on the instrument above, and neither is free:
 *    (a) CLIP THE WARNING the way the row body is clipped, one `clipRowText` call at `settingsRowWidth`. It
 *        makes the residual uniform — panes 12, 13 and 14 at EVERY width instead of 12 → 15 below 94 columns —
 *        and adding `+1` to this constant on top of it leaves ONLY pane 12, which is the window's own floor
 *        (`Math.max(1, …)` saturates there and no budget can help). Measured: 2 clears at 60×12 and 100×12 and
 *        zero at every other cell from 13 to 30. NOT TAKEN, and the measurement is the reason rather than a
 *        preference: the warning is 84 columns and the body at 60 is 54, so the clipped line reads "Changing
 *        thinking mode mid-conversation will incre…" — the instrument's own `latency` probe goes false. A
 *        truncated safety warning at exactly the widths where it fires is a product call, not a geometry one,
 *        and it is the same call `permissionsWrapRows` declines for its footer.
 *    (b) RESERVE THE WARNING INSTEAD — this constant at 12 plus a `permissionsWrapRows`-shaped
 *        `settingsWrapRows(columns)` charging the extra line it takes below 94 columns. Keeps every word of the
 *        warning. Measured as its two endpoints (12 at 100 columns, 13 at 60 and 80): zero from pane 14 up at
 *        60 and 80 and from pane 13 up at 100, leaving the floor again. IT COSTS ONE ROW OF VISIBLE LIST AT
 *        PANES 13 → 16 FOR EVERYONE — including the overwhelmingly common session that never touches the
 *        Thinking row — which is exactly the trade the t5 review reverted when it took this constant from 12
 *        back to 11. Charging it only while `thinkingTouched` avoids that and does not resize the list under a
 *        moving cursor (unlike the indicators, the warning toggles on an explicit user action, once), but that
 *        is a budget change and belongs to whoever owns the next round on this dialog, not to the row clip.
 *
 *  NOTE THE CLAMP INTERACTION: `Select`'s own `clampVisible` (selectModel.ts:18,28) already reserves 8 rows
 *  and takes the `min()` of the two — so this number does not solely govern the window. It is the ceiling this
 *  dialog contributes, and being the larger of the two it is the one that binds. */
export const SETTINGS_CHROME_ROWS = 11;
/** THE DEFAULT IS LOAD-BEARING, do not drop it. `rows` is an optional prop and existing tests render this
 *  dialog with no size props at all (keys-migration-dialogs.test.tsx:553). Without it
 *  `settingsVisibleRows(undefined)` is NaN, which threads through `clampVisible` and `windowBounds` to
 *  `{start: NaN, end: 1}` and `options.slice(NaN, 1)` — a list permanently stuck at ONE row with navigation
 *  broken. `Select` defaults its own `rows` the same way (Select.tsx:146). */
export const settingsVisibleRows = (rows: number = process.stdout.rows ?? 24): number =>
  Math.max(1, rows - SETTINGS_CHROME_ROWS);

export function SettingsDialog({ tab, onTabChange, model, mode, thinkLevel, outputStyle, onDone, applyMode, setThink, applyOutputStyle, fetchStatus, fetchUsage, fetchStats, onOpenModelPicker, savePrefs = realSavePrefs, rows, columns }: {
  tab: string;
  onTabChange: (tab: string) => void;
  model?: string;
  mode: string;
  thinkLevel: string;
  outputStyle: string;
  onDone: () => void;
  applyMode: (mode: string) => Promise<void>;
  setThink: (level: string) => Promise<void>;
  applyOutputStyle: (id: string) => Promise<void>;
  fetchStatus: () => Promise<RenderLine[]>;
  fetchUsage: () => Promise<RenderLine[]>;
  fetchStats: () => Promise<RenderLine[]>;
  onOpenModelPicker: () => void;
  savePrefs?: typeof realSavePrefs;
  /** The terminal's size, threaded by `ChatApp` from Wave R task 1's size state — the same pair every other
   *  geometry-taking dialog in that chain gets. Optional so a bare-rendered test keeps working; the default
   *  lives in `settingsVisibleRows`/`Select`, not here, so both readers agree on it. */
  rows?: number; columns?: number;
}) {
  const activeTab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "Config";
  // Keyed by row ID, not index: the `/` search picks a ROW, and `Select`'s `defaultFocusValue` is a value.
  const [focusId, setFocusId] = useState<string>("theme");
  const [view, setView] = useState<SelectView | undefined>(undefined);
  // Both are ref-backed (keys/refState.ts): the key handler BRANCHES on them and the query ACCUMULATES into
  // them, and one stdin chunk dispatches several events with no render — a closure read would be one chunk stale.
  const [search, setSearch, searchRef] = useRefState<string | null>(null);   // null = browsing; "" = searching, empty query
  const [sub, setSub, subRef] = useRefState<"none" | "theme" | "outputStyle">("none");
  const [thinkingTouched, setThinkingTouched] = useState(false);      // THINKING_WARNING shows once toggled, this dialog session
  const [tabLines, setTabLines] = useState<Partial<Record<Tab, RenderLine[]>>>({});

  // Fetch a read-only tab's lines once per entry (not on every render) — Status/Usage/Stats only.
  useEffect(() => {
    if (activeTab === "Config" || tabLines[activeTab] !== undefined) return;
    const fetcher = activeTab === "Status" ? fetchStatus : activeTab === "Usage" ? fetchUsage : fetchStats;
    let cancelled = false;
    void fetcher()
      .then((lines) => { if (!cancelled) setTabLines((t) => ({ ...t, [activeTab]: lines })); })
      .catch((e) => { if (!cancelled) setTabLines((t) => ({ ...t, [activeTab]: [{ text: `✗ ${(e as Error).message}`, color: "red" }] })); });
    return () => { cancelled = true; };
  }, [activeTab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ctx: SettingsRowCtx = { theme: currentTheme(), model, outputStyle, mode, thinkLevel };
  // NOT `rows` any more (Wave S t5): that name is the TERMINAL HEIGHT prop now, and two things called `rows`
  // in one component is how a geometry bug hides.
  const configRows = buildRows(ctx);
  const filtered = search !== null ? filterRows(configRows, search) : configRows;

  // The `/` search query is a TEXT-ENTRY surface: while it is open EVERY route — action handler or keymap
  // fallback — lands here and is read as characters, which is the whole reason the scopes stay pushed while
  // typing (`j`, `k`, space and `/` must reach the query, while the six root globals stay unbound). This body
  // is the pre-review handler's search branch verbatim, physical flags and all: `up` exits the query while `k`
  // types a `k`, and the two are the same ACTION, so only the event can tell them apart.
  const onSearchKey = (e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    const q = searchRef.current ?? "";
    if (key.escape) { setSearch(null); return; }                    // "Esc to clear" — stays on Config, just exits search
    if (key.upArrow) { setSearch(null); return; }                   // "↑ to tabs" — simplified: no header-focus mode shipped (Global Constraints line 28)
    if (key.return || key.downArrow) {
      const picked = filterRows(configRows, q)[0];                  // re-filtered from the LIVE query, not this render's
      // THE ONE LINE OF THIS HANDLER WAVE S t5 CHANGED (everything else here is byte-identical): the focus is
      // keyed by row ID now, so the pick IS the id and the `findIndex` lookup it used to need is gone.
      //   AND IT MOVED ABOVE `setSearch(null)`, which is not cosmetic. Closing the query is what REMOUNTS the
      // `Select`, and `defaultFocusValue` is read once, in that mount's `useState` initializer. Under Ink's
      // reconciler these two updates are not reliably batched — with the old order the Select mounted on
      // `focusId` still "theme", and its own mount-time `onFocus` report then wrote that back over the pending
      // pick, so the search selected a row and the list stayed on the first one (caught red by
      // settings-dialog.test.tsx's "hands the row the search picked back to the remounted list").
      if (picked) setFocusId(picked.id);
      setSearch(null);
      return;
    }
    if (key.backspace || key.delete) { setSearch(q.slice(0, -1)); return; }
    if (input && input >= " " && !key.ctrl && !key.meta) setSearch(q + input);
  };
  /** Every registration below goes through this. Two states are not an action's to decide, and both branch on
   *  the LIVE ref (one stdin chunk dispatches several events with no render in between): the embedded
   *  Theme/Output-style sub-view owns every key while it shows, and the search query reads them all as text. */
  const route = (op: () => void) => (e: KeyEvent | TextEvent) => {
    if (subRef.current !== "none") return;
    if (searchRef.current !== null) { onSearchKey(e); return; }
    op();
  };
  /** Rows and the search box exist only on the Config tab — the other three render a formatter's output. */
  const onConfig = (op: () => void) => () => { if (activeTab === "Config") op(); };
  /** Takes the row from the value `Select` hands back, rather than re-reading an index it no longer owns. */
  const acceptRow = (id: string) => {
    const row = configRows.find((r) => r.id === id); if (!row) return;
    if (row.type === "boolean") { setThinkingTouched(true); void setThink(row.value === "true" ? "off" : "default"); }
    else if (row.type === "enum") { void applyMode(cycleEnum(row)); }
    else if (row.id === "theme") setSub("theme");
    else if (row.id === "model") onOpenModelPicker();
    else if (row.id === "outputStyle") setSub("outputStyle");
  };
  // The scopes stay pushed in every state (their null bindings are this overlay's gate).
  useKeyScope("Settings");
  useKeyScope("Tabs");
  // WAVE S t5 — MOVEMENT AND ACCEPTANCE BELONG TO THE INNER `Select` NOW (W-S3). It pushes the `Select`
  // context innermost, so its eight actions resolve there, including the four — select:pageUp/pageDown/first/
  // last — this component never had at all. Registering them here as well would only shadow it, and the
  // migration is the fix rather than binding four new handlers: this list renders every row it has today, so
  // bound paging keys would resolve, match, reach a handler and move nothing.
  //   Both surfaces this component still owns keep their registrations, both still `route()`d. While the `/`
  // query is open the `Select` is NOT MOUNTED, so select:* resolves to an action with no handler and falls
  // through to the fallback below — which is `route` → `onSearchKey`, exactly where those keys landed before.
  useKeyActions({
    "settings:search": route(onConfig(() => setSearch(""))),
    "confirm:no": route(() => onDone()),
    // `tabs:next`/`tabs:previous` belong to the embedded <Tabs> now (see the header). Enum rows still cycle
    // via enter/space only — the recorded simplification is unchanged.
  });
  // Nothing else is this dialog's: browsing has no key the table does not name, so the fallback exists purely
  // to feed the search query (and to be swallowed while a sub-view is up).
  useKeyFallback(route(() => {}));

  if (sub === "theme") return <ThemeDialog hideEsc onDone={() => setSub("none")} savePrefs={savePrefs} />;
  if (sub === "outputStyle") return <OutputStylePicker current={outputStyle} onPick={(id) => { void applyOutputStyle(id); setSub("none"); }} onCancel={() => setSub("none")} />;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Settings</Text>
      <Tabs tabs={TAB_SPECS} active={activeTab} onChange={onTabChange} disableNavigation={search !== null} />
      <Text> </Text>
      {activeTab === "Config" ? (
        <>
          {search !== null ? (
            <Box flexDirection="row">
              {search.length ? <Text>{search}</Text> : <Text dimColor>Search settings…</Text>}
              <Text inverse>{" "}</Text>
            </Box>
          ) : null}
          {search !== null && filtered.length === 0 ? (
            <Text dimColor>{`No settings match "${search}"`}</Text>
          ) : search !== null ? (
            /* THE `/` QUERY'S OWN LIST, UNCHANGED — and the `Select` is deliberately not mounted over it.
               While the query is open every key is text (that is why the scopes stay pushed), and a mounted
               `Select` would eat `j`/`k`/enter/space before they could reach the query. Unmounting is also
               what makes `defaultFocusValue` pick up the row the search selected when the query closes. */
            filtered.map((row) => (
              <Box key={row.id} flexDirection="column">
                <Text>{"  "}<RowBody row={row} width={settingsRowWidth(columns)} /></Text>
                {row.id === "thinking" && thinkingTouched ? <Text dimColor>    {THINKING_WARNING}</Text> : null}
              </Box>
            ))
          ) : (
            <>
              {view && overflowRows(view, configRows.length).above > 0
                ? <Text dimColor>{moreAbove(overflowRows(view, configRows.length).above)}</Text> : null}
              <Select
                options={configRows.map((r) => ({
                  value: r.id, label: r.label,
                  // `focused` is USED, not ignored: the focused row has been ACCENT since W3 t5 and dropping
                  // that would leave the pointer gutter as the only focus affordance. The `❯ `/`  ` prefix is
                  // NOT reproduced here — `Select` draws it in its own gutter (Select.tsx:282), and repeating
                  // it renders `❯ ❯ Theme` and breaks every frame assertion that greps for `❯ Theme`.
                  node: (focused: boolean) => (
                    <Box flexDirection="column">
                      <Text color={focused ? ACCENT : undefined}><RowBody row={r} width={settingsRowWidth(columns)} /></Text>
                      {r.id === "thinking" && thinkingTouched ? <Text dimColor>    {THINKING_WARNING}</Text> : null}
                    </Box>
                  ),
                }))}
                hideIndexes
                visibleOptionCount={settingsVisibleRows(rows)}
                defaultFocusValue={focusId}
                onFocus={setFocusId}
                onViewChange={setView}
                onChange={acceptRow}
                onCancel={onDone}
                rows={rows} columns={columns}
              />
              {view && overflowRows(view, configRows.length).below > 0
                ? <Text dimColor>{moreBelow(overflowRows(view, configRows.length).below)}</Text> : null}
            </>
          )}
          <Text> </Text>
          <Text dimColor>{search !== null ? SEARCH_FOOTER : NORMAL_FOOTER}</Text>
        </>
      ) : (
        <>
          {tabLines[activeTab] === undefined ? <Text dimColor>Loading…</Text> : tabLines[activeTab]!.map((l, i) => <Line key={i} l={l} />)}
          <Text> </Text>
          <Text dimColor>{READONLY_FOOTER}</Text>
        </>
      )}
    </Box>
  );
}
