// tui/src/HelpDialog.tsx — the `/help` dialog (F6 T14, DG62/DG63). Transcribed from 2.1.220's `RNa`
// (L459684-759) and its General panel `pei` (L459650-682): a THREE-TAB dialog — `General` / `Commands` /
// `Custom commands` — over the live command catalog, with the shortcuts grid on the General tab.
//
// The grid is NOT re-implemented here. Upstream mounts the same `Y6t` from `pei` and from the composer's `?`
// surface (L494617), so ours imports `ShortcutsGrid` from ShortcutsOverlay.tsx: one component, one entry set,
// one place a row can be added (T14 requirement 5).
//
// SIX RECORDED DIVERGENCES, all forced by what ccx has rather than by taste:
//  · FRAME COLOUR. Upstream paints `Jx`'s tab strip and `zu`'s rule in `professionalBlue` (L459743), which is
//    not one of our theme tokens. We take `permission`, the default frame role every F6 dialog already uses
//    (DialogFrame). T15 records the substitution.
//  · CUSTOM COMMANDS ARE ALWAYS EMPTY. Upstream splits the catalog with `FYH` (L459681):
//    `type !== "prompt" || source === "builtin" || source === "bundled"` is a DEFAULT command, the rest
//    (a user's `.claude/commands/*.md`, a plugin's) are CUSTOM. The SDK's `SlashCommand` carries
//    `{name, description, argumentHint, aliases}` and nothing else (sdk.d.ts L6641) — no `type`, no `source`,
//    no `isHidden` — so nothing in a live catalog can be CLASSED as custom without inventing the fact. The
//    split lives in `splitCommands` below so it is one function to change the day the shape gains a field;
//    until then the tab shows upstream's own empty state, which is the honest answer.
//  · THE `/powerup` LINE. `pei` prints "New here? Run /powerup to learn the features most people miss." on a
//    tall terminal (L459661). There is no `/powerup` in ccx, so the line is dropped rather than advertising a
//    command that does not exist.
//  · THE `/feedback` LINE IS GATED ON THE LIVE CATALOG. Upstream shows it on any terminal ≥44 rows,
//    unconditionally (L459752/L459766). `/feedback` is upstream's own client command and ccx does not
//    implement it (command-coverage.md lists it out of scope), so printing the sentence verbatim would
//    advertise a command that does not exist — the exact thing the `/powerup` line above is dropped for. THE
//    GATE IS OURS: the line renders only when the LIVE catalog actually reports a `feedback` command, which
//    probe 73's audit says it does not today, so in practice it is dropped for the same reason `/powerup` is
//    — and it self-corrects the day the engine starts reporting it, which a hard delete could not. T14 review
//    ruling (honesty beats byte-fidelity; T9's precedent).
//  · UPSTREAM'S TWO-STATE DISMISS FOOTER IS UNREACHABLE. `RNa` renders `Press <key> again to exit` while its
//    exit-state hook is armed and `<esc> to cancel` otherwise (L459757). That armed state is ctrl+c's
//    double-press, and `ctrl+c` is NULLED in the `Help` context (bindings.ts) exactly as it is under every
//    other ccx dialog — the arm can never happen here, so only the cancel arm is ported. Not an omission: the
//    other arm has no state that can produce it.
//  · A `/` SEARCH THE BROWSER DOES NOT HAVE UPSTREAM. `FIr` (L459440) is a plain scrolling `jr` with
//    `disableSelection` — no query at all. With ~105 live commands that is a lot of scrolling, so the Commands
//    tabs get SettingsDialog's own `/`-search idiom (the same one, deliberately: a query line plus a filtered
//    list, `Esc` to clear). ADDED, not transcribed; recorded for T15.
//
// KEYS (F2 machinery, no `useInput`). The dialog pushes `Help` — whose block now carries the overlay
// suppression every other dialog context has, because unlike `ShortcutsOverlay` this one CANNOT swallow:
// `swallowContexts` (keys/registry.ts) resolves the swallower as the INNERMOST live scope, and this dialog
// mounts `Tabs` and `Select` inside itself, so a swallow here would leave only `Tabs`' four keys live and eat
// its own Escape. `Select` (Commands tabs) and `Tabs` (the strip) own their keys the way they do everywhere
// else; `/` reaches us through `Select`'s `onUnhandledKey` while a list is mounted and through our own
// `useKeyFallback` while the query is open (the Select is unmounted there, so we are the innermost fallback).
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useBindingLookup, useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { formatBindingLower, withModSep } from "./keys/hints.js";
import { rankCommands, type CommandEntry } from "./commandComplete.js";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { Select, type SelectOption } from "./select/Select.js";
import { truncateLabel } from "./select/selectModel.js";
import { Tabs } from "./select/Tabs.js";
import { ShortcutsGrid } from "./ShortcutsOverlay.js";

/** `pei`'s one-sentence pitch (L459656), em dash and all. */
export const HELP_INTRO = "Claude understands your codebase, makes edits with your permission, and executes commands — right from your terminal.";
/** L459748. Upstream renders it through its link component; a terminal that cannot hyperlink prints the URL,
 *  which is what we print unconditionally. */
export const HELP_DOCS_URL = "https://code.claude.com/docs/en/overview";
export const HELP_DOCS_LABEL = "For more help:";
/** L459752, shown only on a terminal at least `THF` rows tall (L459766) — AND, here, only when the command it
 *  names is really there. See the header's fifth divergence for why the extra gate exists. */
export const HELP_FEEDBACK_LINE = "Something else? Use /feedback to report bugs or request features.";
export const FEEDBACK_COMMAND = "feedback";
/** The gate itself, exported so a test can state it as the rule rather than re-deriving it from two renders. */
export const showsFeedbackLine = (commands: readonly CommandEntry[], rows: number): boolean =>
  rows >= HELP_TALL_ROWS && commands.some((c) => c.name === FEEDBACK_COMMAND);
/** `THF = 44` (L459766) — and `_Hf = 44` (L459682), the same number gating `pei`'s compact layout. */
export const HELP_TALL_ROWS = 44;
/** `FIr`'s two titles (L459726/L459734) and its empty state (L459734). */
export const BROWSE_DEFAULT_TITLE = "Browse default commands";
export const BROWSE_CUSTOM_TITLE = "Browse custom commands";
export const NO_CUSTOM_COMMANDS = "No custom commands found";
/** Ours (see the header's fourth divergence) — SettingsDialog's two footers, reworded for a read-only browser
 *  (there is nothing here to Enter on) and DERIVED rather than typed: every chord they name comes from the
 *  live table, so a rebind moves the footer with the key. `/` is not in the table at all — it reaches this
 *  dialog through the keymap fallback — so it stays the literal it is. */
export const browseFooter = (escChord: string, tabChord: string): string =>
  `/ to search · ${tabChord} to switch tabs · ${escChord} to close`;
export const browseSearchFooter = (escChord: string): string => `Type to filter · ${escChord} to clear`;

export type HelpTab = "general" | "commands" | "custom";
/** `RNa`'s three `tp` panels, in its order (L459719-459732). */
export const HELP_TABS: readonly { id: HelpTab; title: string }[] = [
  { id: "general", title: "General" }, { id: "commands", title: "Commands" }, { id: "custom", title: "Custom commands" },
];

/** `FYH` (L459681) mapped onto `CommandEntry`, which carries no `type`/`source`/`isHidden` — see the header's
 *  second divergence. Every command a live catalog can report is therefore a DEFAULT one. */
export function splitCommands(commands: readonly CommandEntry[]): { defaults: CommandEntry[]; custom: CommandEntry[] } {
  return { defaults: [...commands], custom: [] };
}

/** `FIr`'s row model (L459455-459461): dedup by name, sort by name, `/name` as the label, the description
 *  clipped to `columns - 10`. */
export function browserOptions(commands: readonly CommandEntry[], columns: number): SelectOption[] {
  const width = Math.max(1, columns - 10);
  const seen = new Set<string>();
  return commands
    .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.name, label: `/${c.name}`, description: truncateLabel(c.description, width) }));
}

/** `K_f` (L459450): how many rows of the list fit under this dialog's chrome. */
export const browserVisibleRows = (rows: number): number => Math.max(1, Math.floor((rows - 10) / 2));

export function HelpDialog({ commands, onClose, rows = process.stdout.rows ?? 24, columns = process.stdout.columns ?? 80, initialTab = "general", fullscreen = false }: {
  commands: readonly CommandEntry[];
  onClose: () => void;
  rows?: number;
  columns?: number;
  initialTab?: HelpTab;
  /** The alternate-screen renderer is mounting this, so the grid's fullscreen-only rows are live (FSW T14
   *  review M5). Passed straight through: this dialog and the `?` overlay print the SAME grid, and a row that
   *  appeared in one and not the other would be two answers to one question. */
  fullscreen?: boolean;
}) {
  const [tab, setTab, tabRef] = useRefState<HelpTab>(initialTab);
  // Ref-backed for the reason SettingsDialog's is: one stdin chunk dispatches several events with no render
  // between them, so a closure read of the query would be a chunk stale. `null` = browsing, `""` = searching.
  const [search, setSearch, searchRef] = useRefState<string | null>(null);
  const { defaults, custom } = splitCommands(commands);
  const lookup = useBindingLookup();
  const chord = (action: string) => withModSep(formatBindingLower(lookup(action)[0]));
  const escChord = chord("help:dismiss"), tabChord = chord("tabs:next");

  useKeyScope("Help");
  useKeyActions({ "help:dismiss": () => { if (searchRef.current !== null) setSearch(null); else onClose(); } });
  /** Everything the list (or, on the General tab, the table) did not consume. `/` opens the query; while the
   *  query is open every printable key types into it and Backspace edits it. Escape never arrives here — it
   *  resolves at `Help` above (or at `Select`, whose `onCancel` is this dialog's close). */
  const onUnhandledKey = (e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    const q = searchRef.current;
    if (q === null) { if (input === "/" && tabRef.current !== "general") setSearch(""); return; }
    if (key.backspace || key.delete) { setSearch(q.slice(0, -1)); return; }
    if (input && input >= " " && !key.ctrl && !key.meta) setSearch(q + input);
  };
  // Registered unconditionally, and INACTIVE-by-position rather than by flag: with a `Select` mounted the
  // Select's own fallback is innermost and this one never fires, which is exactly why the Select forwards to
  // the same function through `onUnhandledKey`.
  useKeyFallback(onUnhandledKey);

  const changeTab = (id: string) => { setSearch(null); setTab(id as HelpTab); };

  const browser = (entries: CommandEntry[], title: string, emptyMessage?: string) => {
    if (entries.length === 0 && emptyMessage) return <Text dimColor>{emptyMessage}</Text>;
    const filtered = search ? rankCommands(entries, search) : entries;
    return (
      <Box flexDirection="column">
        <Text>{title}</Text>
        {search !== null ? (
          <Box flexDirection="row">
            {search.length ? <Text>{search}</Text> : <Text dimColor>Search commands…</Text>}
            <Text inverse>{" "}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          {search !== null
            ? (filtered.length === 0
              ? <Text dimColor>{`No commands match "${search}"`}</Text>
              : browserOptions(filtered, columns).slice(0, browserVisibleRows(rows)).map((o) => (
                <Box key={o.value} flexDirection="row" gap={2}>
                  <Text>{o.label}</Text><Text dimColor>{o.description}</Text>
                </Box>
              )))
            // `disableSelection` (L459459) has no analogue on our `Select`: this list is a READER, so Enter
            // picks nothing (`onChange` is a no-op) and Escape closes the dialog, which is what upstream's
            // `onCancel: XJe` does too.
            : <Select options={browserOptions(filtered, columns)} onChange={() => {}} onCancel={onClose}
                hideIndexes visibleOptionCount={browserVisibleRows(rows)} rows={rows} columns={columns}
                onUnhandledKey={onUnhandledKey} />}
        </Box>
        <Text> </Text>
        <Text dimColor>{search !== null ? browseSearchFooter(escChord) : browseFooter(escChord, tabChord)}</Text>
      </Box>
    );
  };

  // `dei = rows < _Hf` (L459651): a short terminal loses the outer padding and the gap between the blocks.
  const compact = rows < HELP_TALL_ROWS;
  return (
    <DialogFrame title="Help" color="permission">
      <Tabs tabs={HELP_TABS} active={tab} onChange={changeTab} disableNavigation={search !== null} />
      <Text> </Text>
      {tab === "general" ? (
        <Box flexDirection="column" paddingY={compact ? 0 : 1} gap={compact ? 0 : 1}>
          <Box flexShrink={0}><Text>{HELP_INTRO}</Text></Box>
          <Box flexDirection="column">
            <Box flexShrink={0}><Text bold>Shortcuts</Text></Box>
            <ShortcutsGrid gap={2} fixedWidth fullscreen={fullscreen} />
          </Box>
        </Box>
      ) : tab === "commands" ? browser(defaults, BROWSE_DEFAULT_TITLE)
        : browser(custom, BROWSE_CUSTOM_TITLE, NO_CUSTOM_COMMANDS)}
      <Box marginTop={1} flexShrink={0}><Text>{HELP_DOCS_LABEL} {HELP_DOCS_URL}</Text></Box>
      {showsFeedbackLine(commands, rows) ? <Box marginTop={1} flexShrink={0}><Text dimColor>{HELP_FEEDBACK_LINE}</Text></Box> : null}
      {/* L459757: `<esc> to cancel`, italic and dim, with the chord resolved from the table like every other
          hint in this package — upstream's own `pc("help:dismiss","Help","esc")` (L459697). */}
      <Box marginTop={1} flexShrink={0}><Text dimColor italic>{escChord} to cancel</Text></Box>
    </DialogFrame>
  );
}
