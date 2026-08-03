// tui/src/SettingsDialog.tsx — the `/config` Settings shell (Wave 3 task 5): title `Settings`, tab bar
// `Status · Config · Usage · Stats`. Status/Usage/Stats render a formatter's RenderLine[] read-only,
// fetched once per tab-entry (cached in local state so re-visiting a tab doesn't re-fetch); Config is the
// only interactive tab (5 rows from settingsRows.ts, `/`-search over them). No session access here — every
// engine-touching op (applyMode/setThink/applyOutputStyle, the three tab fetchers, the Model row's picker)
// is a callback injected by useChat.ts, same convention as AddDirDialog/ThemeDialog.
//
// F2 Task 8: no `useInput`. This dialog pushes TWO contexts — `Settings` (escape, the row cursor incl. j/k and
// ctrl+p/ctrl+n, enter/space to change, `/` to search) and `Tabs` (tab/shift+tab/left/right) — and routes
// EVERY one of their actions back into the single `onKey` below, which is the old handler body verbatim on
// the re-projected event. ChatComposer established that shape for the same reason: the action bodies were
// already branches of it, and one path cannot drift from itself. Search mode is why the scopes stay pushed
// while typing rather than being gated off: `/`, `j`, `k` and space must reach the query as literal text, but
// the six root globals must stay unbound — and the nulls live in the context, so dropping it would revive
// them. Routing the actions through `onKey` gets both.
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
// Model round-trip) is hook state too (`state.settings.tab`); everything else here (`idx`/`search`/`sub`/
// the per-tab fetch cache/`thinkingTouched`) is ordinary component state — losing it on a Model-row detour
// is a minor, acceptable UX cost (row cursor resets, a since-visited Status/Usage/Stats tab re-fetches).
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

const TABS = ["Status", "Config", "Usage", "Stats"] as const;
type Tab = typeof TABS[number];
const NORMAL_FOOTER = "Enter/Space to change · / to search · Esc to close";
// DELIBERATE DIVERGENCE, same class as PermissionsDialog's RECENT_FOOTER (W3 final review Finding 5):
// upstream's search footer promises "↑ to tabs" — a header-focus mode this wave doesn't ship (line 86's
// own comment). key.upArrow below just exits search, identically to Esc — dropped the dead "↑ to tabs"
// chord so the footer never advertises a focus move that doesn't happen.
const SEARCH_FOOTER = "Type to filter · Enter/↓ to select · Esc to clear";
const READONLY_FOOTER = "Tab/←/→ to switch tabs · Esc to close";

export function SettingsDialog({ tab, onTabChange, model, mode, thinkLevel, outputStyle, onDone, applyMode, setThink, applyOutputStyle, fetchStatus, fetchUsage, fetchStats, onOpenModelPicker, savePrefs = realSavePrefs }: {
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
}) {
  const activeTab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "Config";
  const [idx, setIdx] = useState(0);
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
  const rows = buildRows(ctx);
  const filtered = search !== null ? filterRows(rows, search) : rows;

  function cycleTab(delta: number) {
    const i = TABS.indexOf(activeTab);
    onTabChange(TABS[(i + delta + TABS.length) % TABS.length]);
  }

  const onKey = (e: KeyEvent | TextEvent) => {
    if (subRef.current !== "none") return;   // the embedded Theme/OutputStyle sub-view owns every key while it's showing
    const { input, key } = toKeyFlags(e);
    const q = searchRef.current;
    if (q !== null) {
      if (key.escape) { setSearch(null); return; }                    // "Esc to clear" — stays on Config, just exits search
      if (key.upArrow) { setSearch(null); return; }                   // "↑ to tabs" — simplified: no header-focus mode shipped (Global Constraints line 28)
      if (key.return || key.downArrow) {
        const picked = filterRows(rows, q)[0];                        // re-filtered from the LIVE query, not this render's
        setSearch(null);
        if (picked) { const i = rows.findIndex((r) => r.id === picked.id); if (i >= 0) setIdx(i); }
        return;
      }
      if (key.backspace || key.delete) { setSearch(q.slice(0, -1)); return; }
      if (input && input >= " " && !key.ctrl && !key.meta) setSearch(q + input);
      return;
    }
    if (key.escape) { onDone(); return; }
    if (key.tab && key.shift) { cycleTab(-1); return; }
    if (key.tab) { cycleTab(1); return; }
    if (key.leftArrow) { cycleTab(-1); return; }                       // left/right always switch tabs — enum rows
    if (key.rightArrow) { cycleTab(1); return; }                       // cycle via enter/space only (recorded simplification)
    if (activeTab !== "Config") return;                                 // rows/search only exist on the Config tab
    if (input === "/") { setSearch(""); return; }
    if (key.upArrow || input === "k" || (key.ctrl && input === "p")) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow || input === "j" || (key.ctrl && input === "n")) { setIdx((i) => Math.min(rows.length - 1, i + 1)); return; }
    if (key.return || input === " ") {
      const row = rows[idx]; if (!row) return;
      if (row.type === "boolean") { setThinkingTouched(true); void setThink(row.value === "true" ? "off" : "default"); }
      else if (row.type === "enum") { void applyMode(cycleEnum(row)); }
      else if (row.id === "theme") setSub("theme");
      else if (row.id === "model") onOpenModelPicker();
      else if (row.id === "outputStyle") setSub("outputStyle");
    }
  };
  // The scopes stay pushed in every state (their null bindings are this overlay's gate); `onKey` decides.
  useKeyScope("Settings");
  useKeyScope("Tabs");
  useKeyActions({
    "select:previous": onKey, "select:next": onKey, "select:accept": onKey,
    "confirm:no": onKey, "settings:search": onKey, "tabs:next": onKey, "tabs:previous": onKey,
  });
  useKeyFallback(onKey);

  if (sub === "theme") return <ThemeDialog hideEsc onDone={() => setSub("none")} savePrefs={savePrefs} />;
  if (sub === "outputStyle") return <OutputStylePicker current={outputStyle} onPick={(id) => { void applyOutputStyle(id); setSub("none"); }} onCancel={() => setSub("none")} />;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Settings</Text>
      <Text>
        {TABS.map((t, i) => (
          <Text key={t}>
            {i > 0 ? "  ·  " : ""}
            <Text bold={t === activeTab} color={t === activeTab ? ACCENT : undefined}>{t}</Text>
          </Text>
        ))}
      </Text>
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
          ) : (
            (search !== null ? filtered : rows).map((row) => (
              <Box key={row.id} flexDirection="column">
                <Text color={search === null && row.id === rows[idx]?.id ? ACCENT : undefined}>
                  {search === null && row.id === rows[idx]?.id ? "❯ " : "  "}{row.label}  {row.value}
                  {row.hint ? <Text dimColor>   {row.hint}</Text> : null}
                </Text>
                {row.id === "thinking" && thinkingTouched ? <Text dimColor>    {THINKING_WARNING}</Text> : null}
              </Box>
            ))
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
