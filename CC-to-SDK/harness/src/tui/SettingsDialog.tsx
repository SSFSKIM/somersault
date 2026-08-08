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
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { buildRows, filterRows, cycleEnum, THINKING_WARNING, type SettingsRowCtx } from "./settingsRows.js";
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
 *      resizing the list under a moving cursor. RESIDUAL, stated rather than fixed: the warning literal is 84
 *      columns and wraps to two lines below ~90, and this budget is height-only (no `rewindWrapRows`
 *      equivalent). Not worth one here — the Config catalog is a FIXED FIVE ROWS, so `Math.min` with the row
 *      count, not this budget, is what decides the window at every pane of 16 or more.
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
 *  counting `ansiEscapes.clearTerminal` writes: swept panes 10 → 26 at 100 columns in three cursor states
 *  (top of list; bottom; bottom with the warning up), this budget draws ZERO clears at every pane of 12 or
 *  more in all three. The worst state at the tightest pane is a frame of 11 against a pane of 12 — the strict
 *  inequality, with the slack of exactly one the budget is built to leave. Below 12 the window is already at
 *  its floor of one row and no budget can help.
 *
 *  IT WAS 12 UNTIL THE t5 REVIEW, by both errors at once: three conditional rows reserved where only two can
 *  ever coexist, and a `lastFrame()` measurement inflated by that static echo. 12 cost one row of visible list
 *  at panes 13 through 16 and bought nothing at any pane.
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
                <Text>{"  "}{row.label}  {row.value}{row.hint ? <Text dimColor>   {row.hint}</Text> : null}</Text>
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
                      <Text color={focused ? ACCENT : undefined}>{r.label}  {r.value}{r.hint ? <Text dimColor>   {r.hint}</Text> : null}</Text>
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
