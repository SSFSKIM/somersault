// tui/src/PermissionsDialog.tsx — the `/permissions` dialog (Wave 3 task 7): five tabs (Recently denied ·
// Allow · Ask · Deny · Workspace) over the SAME two data sources — get_settings() (rule provenance,
// permissionsModel.ts's ruleRows) and listDirs() (workspace rows, workspaceRows) — fetched once on mount
// and refetched after any mutation, so a just-added rule or just-removed directory shows up immediately
// without closing the dialog. Callback-only, no session access here (useChat.ts owns every session call,
// same convention as every other dialog in this package) — this component owns only the keys, the tab/row
// cursor, and which sub-view (if any) is showing.
//
// F6 Task 2: the tab strip is the shared `Tabs` primitive (select/Tabs.tsx), which OWNS `tabs:next`/
// `tabs:previous` now (an action handler is innermost-wins, so keeping them here would only shadow it). The
// `route()` gating they used to go through is preserved by construction: every `sub !== "none"` state
// early-returns ABOVE the strip, so `Tabs` is not mounted — including the `addDir` state whose whole point is
// that this component registers nothing. The `Tabs` SCOPE stays pushed below regardless, so tab/←/→ keep
// resolving to an action (and being swallowed by `route`) there instead of reaching the child as raw keys.
//
// F2 Task 8 (+ final review): no `useInput`. Like SettingsDialog it pushes `Settings` + `Tabs`, so the
// rule-entry sub-view keeps receiving `j`, `k`, space and `/` as literal text while the contexts' null
// bindings keep the six root globals unbound. Also like SettingsDialog, the split follows the SURFACE: the
// navigable TOP LEVEL dispatches on the ACTION (a rebind that resolves has to actually move something), while
// every sub-view keeps the physical body — see `onSubKey`. The single exception is the embedded AddDirDialog: its entry phase needs the
// keymap FALLBACK for the path it is typing, and an action handler always CONSUMES, so while that sub-view is
// up this component registers NO action handlers at all (the scopes stay, and with them the nulls) and the
// unhandled actions fall through to the child's fallback.
//
// Sub-views are EMBEDDED (SettingsDialog's own convention for Theme/Output-style): this component swaps its
// OWN render to the sub-view, no nested border, and this component's top-level handler early-returns for
// every `sub !== "none"` state so a keystroke never reaches two handlers at once. Workspace's
// "Add directory…" row is the same trick: it embeds Task 3's AddDirDialog DIRECTLY (not via the top-level
// `state.addDir` overlay slot — ChatApp's chain puts `permissions` BEFORE `addDir`, so reusing the
// top-level slot the way Settings reuses `modelPicker` would need the opposite ordering; embedding sidesteps
// that entirely and reuses the exact same addDirValidate/confirmAddDir/cancelAddDir callbacks useChat.ts
// already exposes for the standalone /add-dir path — including their existing transcript-notice behavior).
//
// WAVE S t6b: the top-level row list is the shared `Select` (select/Select.tsx), not a hand-rolled cursor —
// so it WINDOWS from the terminal height (`permissionsVisibleRows` below), reports what it clipped with the
// counted `↑ N more above` / `↓ N more below` indicators, and answers pageup/pagedown/home/end, which the
// `Settings` context binds nowhere and this dialog never had. The fix is the MIGRATION rather than four new
// bindings: binding a page key onto a list that renders every row it has is the "resolves but moves nothing"
// defect F2 exists to remove, and these lists are the genuinely unbounded ones (one per allow/ask/deny tab,
// plus the workspace directory list). Because the list sizes itself from `rows`, this dialog crossed into
// ChatApp's pane-owning class and `state.permissions.open` joined its `paneOwned` gate.
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { ruleRows, workspaceRows, SOURCE_LABELS, type RuleRow, type DenialEntry } from "./permissionsModel.js";
import type { RenderLine } from "./render.js";
import type { SettingsTarget } from "./settingsFile.js";
import type { AddDirVerdict } from "./addDir.js";
import { AddDirDialog } from "./AddDirDialog.js";
import { ACCENT } from "./theme.js";
import { Tabs } from "./select/Tabs.js";
import { Select } from "./select/Select.js";
import { moreAbove, moreBelow, overflowRows } from "./select/overflow.js";
import type { SelectView } from "./select/selectModel.js";

const TABS = ["Recently denied", "Allow", "Ask", "Deny", "Workspace"] as const;
type Tab = typeof TABS[number];
const TAB_SPECS = TABS.map((t) => ({ id: t, title: t }));
type Behavior = "allow" | "ask" | "deny";
const BEHAVIOR_OF: Partial<Record<Tab, Behavior>> = { Allow: "allow", Ask: "ask", Deny: "deny" };

// Verbatim 2.1.220 copy (plan Global Constraints line 34) — every literal below is reproduced exactly,
// including the upstream typo in the User-settings destination description.
const INTRO: Record<Tab, string> = {
  "Recently denied": "Commands recently denied by the auto mode classifier.",
  Allow: "Claude Code won't ask before using allowed tools.",
  Ask: "Claude Code will always ask for confirmation before using these tools.",
  Deny: "Claude Code will always reject requests to use denied tools.",
  Workspace: "Claude Code can read files in the workspace, and make edits when auto-accept edits is on.",
};
const RECENT_EMPTY = "No recent denials. Commands denied by the auto mode classifier will appear here.";
const DELETE_LABEL: Record<Behavior, string> = { allow: "allowed", ask: "ask", deny: "denied" };
const DEST_OPTIONS: { label: string; desc: (cwd: string) => string; target: SettingsTarget }[] = [
  { label: "Project settings (local)", desc: (cwd) => `Saved in ${cwd}/.claude/settings.local.json`, target: "localSettings" },
  { label: "Project settings", desc: (cwd) => `Checked in at ${cwd}/.claude/settings.json`, target: "projectSettings" },
  { label: "User settings", desc: () => "Saved in at ~/.claude/settings.json", target: "userSettings" },   // verbatim upstream typo — keep it
];
const RULE_FLOW_FOOTER = "Enter to submit · Esc to cancel";     // covers BOTH add-rule steps (text entry + destination) — Global Constraints gives one footer for "the add-rule dialog"
// DELIBERATE DIVERGENCE from the pinned upstream string (recorded by the controller after review, W3 T7
// Finding 2 — not a drift, don't "fix" this back to the verbatim copy). Upstream's footer reads
// "Enter to approve · r to retry · ↑/↓ to navigate · Esc to cancel", but this tab is READ-ONLY here (see
// the useInput denial-branch comment below): there is no live park left once a decision has settled, so
// Enter/r are no-ops. A rendered, user-visible footer advertising two keys that do nothing is a false
// affordance — worse than an unused string, because the user SEES it and tries the keys. Dropped the two
// dead chords; kept the two that work.
const RECENT_FOOTER = "↑/↓ to navigate · Esc to cancel";
const DEFAULT_FOOTER = "↑/↓ to navigate · Enter to select · ←/→ to switch · Esc to cancel";
const MANAGED_DIR_FOOTER = "↑/↓ to navigate · ←/→ to switch · Esc to cancel";
// Not pinned by Global Constraints (which gives only "header"/"recent"/"default" — "header" belongs to an
// upstream header-focus mode this wave deliberately doesn't ship, same recorded divergence as Task 5's own
// unused "Settings dialog dismissed" string) — these three are this component's own reasonable choices,
// following the "<verb> · Esc to cancel/close" shape every other confirm-style dialog in this package uses.
const DELETE_FOOTER = "Enter to delete · Esc to cancel";
const DETAILS_FOOTER = "Esc to close";
const REMOVE_DIR_FOOTER = "Enter to remove · Esc to cancel";

type Sub = "none" | "addRuleText" | "addRuleDest" | "deleteConfirm" | "ruleDetails" | "addDir" | "removeDirConfirm";
/** Registered while the embedded AddDirDialog is up (see the header): the Settings/Tabs actions must reach
 *  NO handler here, so they fall through to that child's fallback instead of being consumed by this one. */
const NO_ACTIONS: Record<string, (e: KeyEvent) => void> = {};
type WorkspaceDir = { path: string; source: "cwd" | "launch" | "session" };

type Item =
  | { kind: "addRule" }
  | { kind: "addDir" }
  | { kind: "rule"; row: RuleRow }
  | { kind: "dir"; d: WorkspaceDir; line: RenderLine }
  | { kind: "denial"; e: DenialEntry };

/** A row's stable identity — what the cursor tracks instead of an index (Wave S t6a), and what round 6b's
 *  `Select` will address rows by. An index cannot carry the cursor: every mutation refetches and REBUILDS
 *  `items`, so "row 3" means a different row afterwards. Each value is derived from what the row already is
 *  — permissionsModel's own `RuleRow`/`DenialEntry` fields and listDirs' path — never from a parallel
 *  numbering, so it survives a rebuild that changes the list around it. `\0` is the tag/join byte because no
 *  rule string, path or tool display can contain one — so a `dir` value can never alias a `rule` one, a
 *  rule's source can never run into its text, and the two affordance rows (whose values START with it) can
 *  never be spelled by any data row. */
function itemValue(it: Item): string {
  switch (it.kind) {
    case "addRule": return "\0addRule";
    case "addDir": return "\0addDir";
    case "rule": return `rule\0${it.row.source}\0${it.row.rule}`;
    case "dir": return `dir\0${it.d.path}`;
    // `DenialEntry` is `{display, by, at}` (permissionsModel.ts:84) — no toolUseID, no command, and no single
    // field unique on its own. This is the composite the row's React key already used.
    case "denial": return `denial\0${it.e.at}\0${it.e.display}`;
  }
}
/** …and the collision rule, because NOTHING upstream of here guarantees uniqueness: `ruleRows` emits one row
 *  per (source, rule) pair and one settings file may list the same rule twice, and two denials can share a
 *  millisecond and a display string. Repeats get an occurrence suffix, so a value still depends only on the
 *  row's own content plus how many byte-identical rows precede it — stable across any rebuild that does not
 *  add or drop one of those identical twins, and unique within the tab for any realistic input. Two rows the
 *  user cannot tell apart are the only ones whose identities can swap, and swapping those is unobservable.
 *  NOT unique by construction, though, and the counter-example is worth naming here so nobody rediscovers it
 *  as a bug: the suffix is spelled `\0#<n>`, so a single source listing `["X\0#1", "X", "X"]` hands the third
 *  row the value the first already has. That is the same premise `itemValue` rests on above — it takes a
 *  literal NUL byte inside a rule string in a settings file — so the `seen` map is deliberately not re-probed
 *  for a free slot. If a NUL ever becomes spellable here, that probe is the fix. */
function itemValues(items: Item[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base = itemValue(it), n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}\0#${n}`;
  });
}
/** One row's BODY, with NO `❯ `/`  ` gutter and no colour — the caller owns both. 6b hands this to `Select`
 *  as a `node`, and `Select` draws the pointer in its own gutter (`Select.tsx:282`), so a body that kept the
 *  prefix would render `❯ ❯ Add a new rule…`. The colour lives on the node's own wrapping `<Text>` (see the
 *  `<Select>` below): `focused` is the argument `Select` passes, and dropping the ACCENT would leave the
 *  pointer as the row's only focus affordance.
 *  ONE CONSEQUENCE FOR TESTS, and it caught eight pre-existing assertions in this repo: the gutter and the
 *  body are now SEPARATE styled spans, so the raw frame carries `❯`, an SGR reset, then the label. Match
 *  `❯ <label>` against an ANSI-STRIPPED frame, never against the raw bytes. */
function renderItem(it: Item): React.ReactNode {
  if (it.kind === "addRule") return "Add a new rule…";
  if (it.kind === "addDir") return "Add directory…";
  if (it.kind === "rule") return <>{it.row.rule}  <Text dimColor>From {SOURCE_LABELS[it.row.source] ?? it.row.source}</Text></>;
  if (it.kind === "dir") return it.line.segments ? it.line.segments.map((s, si) => <Text key={si} dimColor={s.dim}>{s.text}</Text>) : it.line.text;
  return <>{it.e.display}  <Text dimColor>by {it.e.by}</Text></>;
}
/** The same row as ONE plain string — `Select`'s `label`, which a `node` row degrades to for measurement and
 *  for the fallback render. Unused in practice here (no row carries a `description`, so `isTwoColumn` is false
 *  and nothing measures a label column), but it is the contract's own field and a wrong one would surface as a
 *  mis-measured column the day a description appears. */
function itemLabel(it: Item): string {
  if (it.kind === "addRule") return "Add a new rule…";
  if (it.kind === "addDir") return "Add directory…";
  if (it.kind === "rule") return `${it.row.rule}  From ${SOURCE_LABELS[it.row.source] ?? it.row.source}`;
  if (it.kind === "dir") return it.line.segments ? it.line.segments.map((s) => s.text).join("") : it.line.text;
  return `${it.e.display}  by ${it.e.by}`;
}

/** WAVE S t6b — the rows this dialog spends on everything that is NOT the list, counted against the composed
 *  `ChatApp` frame rather than against `PermissionsDialog` alone. Same denominator, and for the same reason, as
 *  `SETTINGS_CHROME_ROWS` (SettingsDialog.tsx:81-133) and Wave S t4's `REWIND_CHROME_ROWS`: a budget counted
 *  from the box alone composes into a frame that REACHES the pane, and Ink 5.2.1 answers
 *  `outputHeight >= stdout.rows` (`ink.js:121`) with `clearTerminal + fullStaticOutput + output` — a
 *  full-screen wipe and a whole-transcript re-dump on every render, i.e. on every cursor move.
 *
 *  9 + 2 + 1 + 1, each term against this file's own render tree (the final `return` below):
 *    · 9 — the dialog's own UNCONDITIONAL chrome. NINE, not the seven Settings spends: this dialog draws an
 *      intro line and one more blank spacer than that one does.
 *        1-2  the `borderStyle="round"` box's top and bottom rules
 *        3    the bold `Permissions` title
 *        4    the `<Tabs>` strip
 *        5    the blank spacer under the strip
 *        6    `INTRO[activeTab]`
 *        7    the blank spacer above the list
 *        8    the blank spacer above the footer
 *        9    the footer (`RECENT_FOOTER` / `MANAGED_DIR_FOOTER` / `DEFAULT_FOOTER` — exactly one of them)
 *    · +2 — the two indicator rows, `↑ N more above` and `↓ N more below`. BOTH, unconditionally, even though
 *      a window at either end of the list draws only one: they toggle as a CONSEQUENCE of scrolling, so a
 *      budget that reserved them conditionally would grow the window at the top of the list and shrink it
 *      again on the first step down — resizing the list under a moving cursor. Same call the rewind and
 *      settings budgets make.
 *        `RECENT_EMPTY` (the "No recent denials…" line) is the third conditional row and is deliberately NOT
 *      reserved: it renders only on the `Recently denied` tab with ZERO denials, which is exactly the state
 *      whose list is empty and whose indicators are therefore both off. It cannot coexist with either.
 *    · +1 — `ChatStatusBar`, the one sibling this budget models because it is the only UNCONDITIONAL one
 *      (ChatApp's last row). Everything else ChatApp can draw beside this dialog is handled by its `paneOwned`
 *      gate, which t6b extends to `state.permissions.open` precisely because this dialog now sizes itself from
 *      `rows`. A budget could not model those anyway: the task panel alone is seven rows.
 *    · +1 — the `>=` above: the frame must end up STRICTLY shorter than the pane, not equal to it.
 *
 *  MEASURED, AND NOT WITH `lastFrame()`, for the reason `SETTINGS_CHROME_ROWS` spells out in full:
 *  `ink-testing-library` renders with `debug: true` and that branch RETURNS BEFORE the `outputHeight >=
 *  stdout.rows` check (`ink.js:104-109`), so a frame's line count there is `staticLines + outputHeight` and any
 *  dialog reached by TYPING a slash command reads one row too tall. The instrument is `stdout.write` on a
 *  NON-DEBUG Ink render, counting `ansiEscapes.clearTerminal` writes. Swept panes 12 → 30 at 100 columns on the
 *  real `ChatApp` behind `/permissions`, in three states (Allow tab at the top of a 30-rule list; Allow at the
 *  bottom, both indicators live; Workspace with eight directories): ZERO clears at every pane of 14 or more in
 *  all three. Below 14 the window is already at its floor of one row and no budget can help.
 *
 *  RESIDUAL, stated rather than fixed — the same one Settings records and it bites slightly harder here. This
 *  budget is HEIGHT-ONLY: the Workspace intro is 88 columns and wraps to two lines below ~92, and a workspace
 *  path longer than the content width wraps its row. Terms 3 and 4 above (`ChatStatusBar` and Ink's `>=`)
 *  absorb one such wrap, which is what the 100-column sweep exercises for the intro; a 15-row pane at 80
 *  columns on the Workspace tab spends both and has no slack left. A `columns` term (rewindWrapRows' shape) is
 *  the fix if that combination ever matters.
 *
 *  NOTE THE CLAMP INTERACTION, as in Settings: `Select`'s own `clampVisible` (selectModel.ts:18,28) already
 *  reserves 8 rows and takes the `min()` of the two — so this number does not solely govern the window. It is
 *  the ceiling this dialog contributes, and being the larger of the two it is the one that binds. */
export const PERMISSIONS_CHROME_ROWS = 13;
/** THE DEFAULT IS LOAD-BEARING, do not drop it — `SettingsDialog.tsx:135-139` carries the full argument.
 *  `rows` is optional and plenty of existing tests render this dialog with no size props at all; without the
 *  default `permissionsVisibleRows(undefined)` is NaN, which threads through `clampVisible` and `windowBounds`
 *  to `options.slice(NaN, 1)` — a list permanently stuck at ONE row with navigation broken. */
export const permissionsVisibleRows = (rows: number = process.stdout.rows ?? 24): number =>
  Math.max(1, rows - PERMISSIONS_CHROME_ROWS);

export function PermissionsDialog({
  tab, onTabChange, denials, cwd,
  fetchSettings, fetchDirs, addRule, removeRule, removeDir,
  addDirValidate, confirmAddDir, cancelAddDir,
  onDone, rows, columns,
}: {
  tab: string;
  onTabChange: (tab: string) => void;
  denials: DenialEntry[];
  cwd: string;
  fetchSettings: () => Promise<unknown>;
  fetchDirs: () => Promise<WorkspaceDir[]>;
  addRule: (behavior: Behavior, rule: string, target: SettingsTarget) => Promise<void>;
  removeRule: (behavior: Behavior, rule: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
  addDirValidate: (raw: string) => Promise<AddDirVerdict>;
  // Promise<void>, not void: useChat's confirmAddDir is async (it awaits session.addDir(abs) before
  // returning) — the type here must say so, or a caller can't chain refreshDirs onto its completion
  // (final review Finding 6, see the onConfirm handler below).
  confirmAddDir: (abs: string, remember: boolean) => Promise<void>;
  cancelAddDir: (abs?: string) => void;
  onDone: () => void;
  /** The terminal's size, threaded by `ChatApp` from Wave R task 1's size state — the same pair every other
   *  geometry-taking dialog in that chain gets (t6b). Optional so a bare-rendered test keeps working; the
   *  default lives in `permissionsVisibleRows`/`Select`, not here, so both readers agree on it. */
  rows?: number; columns?: number;
}) {
  const activeTab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "Allow";
  // The row cursor is a VALUE, not an index (t6a) — see `itemValue`. As of t6b the cursor LIVES IN THE
  // `Select`; this is a MIRROR of what its `onFocus` last reported, kept for the two readers that are not the
  // list: the footer (which row's kind decides `MANAGED_DIR_FOOTER`) and the `defaultFocusValue` seed. It is
  // deliberately NOT ref-backed any more — nothing reads it synchronously out of a key handler now that
  // `activate` is handed the row's value by `Select`'s own `onChange`, and an unused ref is a claim about a
  // hazard that no longer exists.
  //   THE DELETE-CURSOR BEHAVIOUR IS `Select`'S NOW, and it is the same answer 6a's index fallback gave: focus
  // is stored as an index (Select.tsx:160-163) and `normalize()` clamps it to `count - 1` when `options`
  // shrinks (Select.tsx:172-175), so deleting the row you are standing on leaves the cursor on the row that
  // took its place rather than at the top of the list. permissions-dialog.test.tsx keeps that pinned.
  const [focusValue, setFocusValue] = useState<string | undefined>(undefined);
  /** The window `Select` last reported, which is the only place the counted indicators can come from — the
   *  scroll window lives in that component's reducer and a copy recomputed here would drift (Select.tsx:103). */
  const [view, setView] = useState<SelectView | undefined>(undefined);
  // Ref-backed (keys/refState.ts): `sub` is what every key handler branches on and `ruleText` is what one
  // accumulates into, and a single stdin chunk dispatches several events before any render.
  const [sub, setSub, subRef] = useRefState<Sub>("none");
  const [ruleText, setRuleText, ruleTextRef] = useRefState("");
  const [destIdx, setDestIdx] = useState(0);
  const [selectedRule, setSelectedRule] = useState<RuleRow | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  // undefined = "not fetched yet" (renders "Loading…"), distinct from a genuinely empty {}/[] response.
  const [settings, setSettings] = useState<unknown>(undefined);
  const [dirs, setDirs] = useState<WorkspaceDir[] | undefined>(undefined);

  async function refreshSettings() { try { setSettings(await fetchSettings()); } catch { setSettings({}); } }
  async function refreshDirs() { try { setDirs(await fetchDirs()); } catch { setDirs([]); } }
  useEffect(() => { void refreshSettings(); void refreshDirs(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // A row cursor from one tab must not carry into another tab's (differently-sized) list. THIS EFFECT ALONE
  // DOES NOT DO IT: `Select` reads `defaultFocusValue` only in its `useState` initializers (Select.tsx:160-167)
  // and a tab change does not remount it, so its internal `view.focus` would survive and Allow-row-20 → a short
  // tab → back would land on row 20 again with no keypress. `key={activeTab}` on the `<Select>` is what
  // remounts it; this effect only clears THIS component's two mirrors so the seed and the footer agree.
  useEffect(() => { setFocusValue(undefined); setView(undefined); }, [activeTab]);

  const behavior = BEHAVIOR_OF[activeTab];
  const dirList = dirs ?? [];
  const dirLines = workspaceRows(dirList);
  const items: Item[] =
    activeTab === "Recently denied" ? denials.map((e): Item => ({ kind: "denial", e }))
    : activeTab === "Workspace" ? [{ kind: "addDir" }, ...dirList.map((d, i): Item => ({ kind: "dir", d, line: dirLines[i] }))]
    : behavior ? [{ kind: "addRule" }, ...ruleRows(settings, behavior).map((row): Item => ({ kind: "rule", row }))]
    : [];
  // ONE call per render, shared by the options array and the footer's cursor — `itemValues` walks the whole
  // list and its occurrence suffixes have to be the SAME numbering both readers see.
  const values = itemValues(items);
  /** The row the FOOTER reads (`MANAGED_DIR_FOOTER` vs `DEFAULT_FOOTER`). `?? items[0]` is load-bearing:
   *  `focusValue` is `undefined` until `Select`'s mount-time `onFocus` fires, and the footer renders before
   *  that — and a value whose row a refetch has just removed lands here too, one render before `Select`'s
   *  clamp reports the replacement. Both degenerate to the top row, which is what the pre-6a clamp did. */
  const selectedItem = items[focusValue === undefined ? -1 : values.indexOf(focusValue)] ?? items[0];

  /** The six sub-views, verbatim from the pre-review handler and deliberately still PHYSICAL (final review):
   *  two of them are text entry (the rule name), and the other four are modal prompts whose only keys are the
   *  `Enter`/`Esc` their own footers spell out — while `select:accept` is bound to {enter, SPACE}, so
   *  dispatching them on the ACTION would newly delete a permission rule, or remove a workspace directory, on
   *  a stray space. The navigable top level is the surface a rebind is actually about, and that is where the
   *  action dispatch went. */
  const onSubKey = (e: KeyEvent | TextEvent) => {
    const sub = subRef.current;                      // shadows the render value ON PURPOSE: a handler must branch
                                                     // on the LIVE sub-view, not the one this render was built from
    if (sub === "addDir") return;                    // the embedded AddDirDialog owns every key while it's showing
    const { input, key } = toKeyFlags(e);
    if (sub === "addRuleText") {
      if (key.escape) { setSub("none"); return; }
      if (key.return) { if (ruleTextRef.current.trim()) { setDestIdx(0); setSub("addRuleDest"); } return; }
      if (key.backspace || key.delete) { setRuleText(ruleTextRef.current.slice(0, -1)); return; }
      if (input && input >= " " && !key.ctrl && !key.meta) setRuleText(ruleTextRef.current + input);
      return;
    }
    if (sub === "addRuleDest") {
      if (key.escape) { setSub("none"); return; }
      if (key.upArrow) { setDestIdx((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setDestIdx((i) => Math.min(DEST_OPTIONS.length - 1, i + 1)); return; }
      if (key.return) {
        const b = behavior!; const target = DEST_OPTIONS[destIdx].target; const rule = ruleTextRef.current.trim();
        setSub("none");
        void addRule(b, rule, target).then(refreshSettings);
      }
      return;
    }
    if (sub === "deleteConfirm") {
      if (key.escape) { setSub("none"); return; }
      if (key.return) {
        const b = behavior!; const rule = selectedRule!.rule;
        setSub("none");
        void removeRule(b, rule).then(refreshSettings);
      }
      return;
    }
    if (sub === "ruleDetails") { if (key.escape || key.return) setSub("none"); return; }
    if (sub === "removeDirConfirm") {
      if (key.escape) { setSub("none"); return; }
      if (key.return) {
        const path = selectedDir!;
        setSub("none");
        void removeDir(path).then(refreshDirs);
      }
      return;
    }
  };
  /** Every registration below goes through this: a sub-view keeps the physical body above, the top level gets
   *  the semantic op. Branching on the LIVE ref, never the render value — one stdin chunk dispatches several
   *  events with no render in between. */
  const route = (op: () => void) => (e: KeyEvent | TextEvent) => {
    if (subRef.current === "addDir") return;
    if (subRef.current !== "none") { onSubKey(e); return; }
    op();
  };
  /** Takes the row's VALUE, which is what `Select`'s `onChange` hands back — the row the cursor was on when
   *  the key was dispatched, read out of `Select`'s own live window rather than out of a render closure here. */
  const activate = (value: string) => {
    const item = items[values.indexOf(value)];
    if (!item) return;
    if (item.kind === "addRule") { setRuleText(""); setSub("addRuleText"); return; }
    if (item.kind === "addDir") { setSub("addDir"); return; }
    if (item.kind === "rule") { setSelectedRule(item.row); setSub(item.row.readOnly ? "ruleDetails" : "deleteConfirm"); return; }
    if (item.kind === "dir") { if (item.d.source === "session") { setSelectedDir(item.d.path); setSub("removeDirConfirm"); } return; }
    // denial: no live park is left to act on once a decision has already settled — this tab is a READ-ONLY
    // log. Accepting is intentionally a no-op here (↑/↓ still moves the cursor); the footer no longer claims
    // otherwise (RECENT_FOOTER, Finding 2 divergence note).
  };
  useKeyScope("Settings");
  useKeyScope("Tabs");
  // WAVE S t6b — MOVEMENT AND ACCEPTANCE BELONG TO THE INNER `Select` NOW (W-S3). It pushes the `Select`
  // context innermost, so its eight actions resolve there, including the four — select:pageUp/pageDown/first/
  // last — this component never had at all; registering them here as well would only shadow it. Upstream's own
  // Permissions gets pageup/pagedown from `jr`'s raw handler and has no home/end anywhere, so the full
  // four-key set (and the counted indicators) is a recorded divergence, W-S11.
  //   BOTH `useKeyScope` CALLS STAY. The six sub-views render with NO `Select` mounted at all — each
  // early-returns above it — and they rely on the `Settings`/`Tabs` contexts' null bindings to keep the six
  // root globals unbound while they own the keyboard. Their keys also stay PHYSICAL (`onSubKey`): four of them
  // are destructive confirms, and `select:accept` is bound to {enter, SPACE}, so dispatching them on the ACTION
  // would delete a permission rule on a stray space.
  //   The one deliberate widening t6a's registration introduced survives the move unchanged: space takes the
  // highlighted row at the TOP LEVEL, exactly as it does in SettingsDialog. Nothing destructive is one keypress
  // away — every delete/remove still needs its own Enter inside the modal prompt that opens.
  useKeyActions(sub === "addDir" ? NO_ACTIONS : {
    "confirm:no": route(() => onDone()),
    "settings:search": route(() => {}),                // `/` opens no query here — this dialog has no search
    // `tabs:next`/`tabs:previous` belong to the embedded <Tabs> now (see the header).
  });
  // The top level has no key the table does not name, so the fallback exists purely to feed the sub-views'
  // text entry (and to be swallowed while the embedded AddDirDialog owns the keyboard).
  useKeyFallback(route(() => {}));

  if (sub === "addRuleText") return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>{`Add ${behavior} permission rule`}</Text>
      <Text>Permission rules are a tool name, optionally followed by a specifier in parentheses.</Text>
      <Text dimColor>e.g., <Text bold>WebFetch</Text> or <Text bold>Bash(ls *)</Text></Text>
      <Box flexDirection="row">
        {ruleText.length ? <Text>{ruleText}</Text> : <Text dimColor>Enter permission rule…</Text>}
        <Text inverse>{" "}</Text>
      </Box>
      <Text dimColor>{RULE_FLOW_FOOTER}</Text>
    </Box>
  );
  if (sub === "addRuleDest") return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Where should this rule be saved?</Text>
      <Text> </Text>
      {DEST_OPTIONS.map((o, i) => (
        <Box key={o.label} flexDirection="column">
          <Text color={i === destIdx ? ACCENT : undefined}>{i === destIdx ? "❯ " : "  "}{o.label}</Text>
          <Text dimColor>    {o.desc(cwd)}</Text>
        </Box>
      ))}
      <Text dimColor>{RULE_FLOW_FOOTER}</Text>
    </Box>
  );
  if (sub === "deleteConfirm" && selectedRule && behavior) return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>{`Delete ${DELETE_LABEL[behavior]} tool?`}</Text>
      <Text bold>{selectedRule.rule}</Text>
      <Text>Are you sure you want to delete this permission rule?</Text>
      <Text dimColor>{DELETE_FOOTER}</Text>
    </Box>
  );
  if (sub === "ruleDetails" && selectedRule) return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Rule details</Text>
      <Text bold>{selectedRule.rule}</Text>
      <Text dimColor>{`From ${SOURCE_LABELS[selectedRule.source] ?? selectedRule.source}`}</Text>
      <Text> </Text>
      <Text>This rule comes from a read-only source and cannot be modified here.</Text>
      <Text dimColor>{DETAILS_FOOTER}</Text>
    </Box>
  );
  if (sub === "addDir") return (
    <AddDirDialog
      onValidate={addDirValidate}
      // Chain refreshDirs onto confirmAddDir's OWN promise, exactly like the add-rule/remove-rule/remove-dir
      // branches above — confirmAddDir awaits session.addDir(abs) before it resolves, and ops from separate
      // socket chunks dispatch concurrently, so firing refreshDirs unchained (as this used to) could have the
      // listing return BEFORE the add landed, silently dropping the new directory until the user bounced tabs
      // (final review Finding 6). setSub("none") still fires immediately, same as every sibling flow.
      onConfirm={(abs, remember) => { setSub("none"); void confirmAddDir(abs, remember).then(refreshDirs); }}
      onCancel={(abs) => { cancelAddDir(abs); setSub("none"); }}
    />
  );
  if (sub === "removeDirConfirm" && selectedDir) return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Remove directory from workspace?</Text>
      <Text bold>{selectedDir}</Text>
      <Text>Claude Code will no longer have access to files in this directory.</Text>
      <Text dimColor>{REMOVE_DIR_FOOTER}</Text>
    </Box>
  );

  const loading = activeTab === "Workspace" ? dirs === undefined : activeTab !== "Recently denied" && settings === undefined;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Permissions</Text>
      <Tabs tabs={TAB_SPECS} active={activeTab} onChange={onTabChange} />
      <Text> </Text>
      <Text dimColor>{INTRO[activeTab]}</Text>
      {activeTab === "Recently denied" && denials.length === 0 ? <Text dimColor>{RECENT_EMPTY}</Text> : null}
      <Text> </Text>
      {/* WAVE S t6b — the list is the shared `Select`, windowed from `rows`, with upstream's counted overflow
          indicators OUTSIDE it (select/overflow.ts) because the window lives in the list's own reducer.
          `key={activeTab}` is the remount lever: `defaultFocusValue` is a MOUNT-TIME seed, so without it a
          cursor deep in the Allow list would survive a trip through a shorter tab. */}
      {loading ? <Text dimColor>Loading…</Text> : (
        <>
          {view && overflowRows(view, items.length).above > 0
            ? <Text dimColor>{moreAbove(overflowRows(view, items.length).above)}</Text> : null}
          <Select
            key={activeTab}
            options={items.map((it, i) => ({
              value: values[i]!, label: itemLabel(it),
              // `focused` is USED, not ignored: the focused row has been ACCENT since W3 t7 and dropping that
              // would leave the pointer gutter as the only affordance. The `❯ `/`  ` prefix is NOT reproduced —
              // `Select` draws it in its own gutter (Select.tsx:282); repeating it renders `❯ ❯ Add a new rule…`.
              node: (focused: boolean) => <Text color={focused ? ACCENT : undefined}>{renderItem(it)}</Text>,
            }))}
            hideIndexes
            visibleOptionCount={permissionsVisibleRows(rows)}
            // Spread, not a bare prop: `undefined` would be passed through as an explicit "focus nothing" and
            // `options.findIndex` would answer -1 → 0 anyway, but the seed is only meaningful once `onFocus`
            // has reported something, and saying so here keeps the mount-time contract readable.
            {...(focusValue !== undefined ? { defaultFocusValue: focusValue } : {})}
            onFocus={setFocusValue}
            onViewChange={setView}
            onChange={activate}
            onCancel={onDone}
            rows={rows} columns={columns}
          />
          {view && overflowRows(view, items.length).below > 0
            ? <Text dimColor>{moreBelow(overflowRows(view, items.length).below)}</Text> : null}
        </>
      )}
      <Text> </Text>
      <Text dimColor>{activeTab === "Recently denied" ? RECENT_FOOTER : activeTab === "Workspace" && selectedItem?.kind === "dir" && selectedItem.d.source !== "session" ? MANAGED_DIR_FOOTER : DEFAULT_FOOTER}</Text>
    </Box>
  );
}
