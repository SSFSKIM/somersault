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
import React, { useEffect, useRef, useState } from "react";
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
 *  prefix would render `❯ ❯ Add a new rule…`. Colour stays on the caller's `<Text>` for a second reason: the
 *  gutter and the body have to sit inside ONE styled span or an SGR reset lands between them, and every
 *  pre-existing `❯ <label>` frame assertion is written against the raw bytes. 6b's node is therefore
 *  `(focused) => <Text color={focused ? ACCENT : undefined}>{renderItem(it)}</Text>`. */
function renderItem(it: Item): React.ReactNode {
  if (it.kind === "addRule") return "Add a new rule…";
  if (it.kind === "addDir") return "Add directory…";
  if (it.kind === "rule") return <>{it.row.rule}  <Text dimColor>From {SOURCE_LABELS[it.row.source] ?? it.row.source}</Text></>;
  if (it.kind === "dir") return it.line.segments ? it.line.segments.map((s, si) => <Text key={si} dimColor={s.dim}>{s.text}</Text>) : it.line.text;
  return <>{it.e.display}  <Text dimColor>by {it.e.by}</Text></>;
}

export function PermissionsDialog({
  tab, onTabChange, denials, cwd,
  fetchSettings, fetchDirs, addRule, removeRule, removeDir,
  addDirValidate, confirmAddDir, cancelAddDir,
  onDone,
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
}) {
  const activeTab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "Allow";
  // The row cursor is a VALUE, not an index (t6a) — see `itemValue`. `undefined` = "never moved", which reads
  // as the top row (`cursorAt`). Ref-backed to match `sub` and `ruleText` below, and because `activate` reads
  // the cursor SYNCHRONOUSLY out of a key handler: through the ref that read is right by construction rather
  // than by the surrounding machinery happening to have re-rendered first.
  // NOT because a chunk's events would otherwise race a render — that hazard is real for the text-entry
  // fallback (keys/refState.ts) but NOT on this action path, and the round-6a report claimed it here in error.
  // Measured, not argued: swapping this for a plain `useState` whose `move`/`activate` read the RENDER CLOSURE
  // (no functional updater, no ref) passes the whole `test:tui` suite, back-to-back `↓↓` included, because
  // `useRegistration` refreshes the handler entry during render (keys/KeymapProvider.tsx:362-370) and Ink
  // flushes those renders synchronously between iterations of the dispatch loop. Don't re-derive a hazard from
  // this comment; if you want to change the shape, the reason to keep the ref is the one above.
  const [focusValue, setFocusValue, focusRef] = useRefState<string | undefined>(undefined);
  /** The index that cursor value last RESOLVED to, carried alongside it. A value answers "which row is mine"
   *  across a rebuild that KEEPS the row; when the row is GONE — and the commonest rebuild here is the refetch
   *  after you deleted the row you were standing on — a value can answer nothing, and a position is the only
   *  meaningful reply: the row that took the deleted one's place. Falling back to 0 instead sent the cursor to
   *  the top of the list after every delete (and, once 6b windows the list, the viewport with it), so deleting
   *  a run of rules cost an arrow press per row you had descended instead of being hold-Enter.
   *  6b hands this job to `Select`, which stores focus as an index and clamps it to `count - 1` when `options`
   *  shrinks — the same answer — so this ref goes away there and the test keeps the behaviour pinned. */
  const lastIdxRef = useRef(0);
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
  useEffect(() => { setFocusValue(undefined); lastIdxRef.current = 0; }, [activeTab]);   // a row cursor from one tab must not carry into another tab's (differently-sized) list — neither half of it

  const behavior = BEHAVIOR_OF[activeTab];
  const dirList = dirs ?? [];
  const dirLines = workspaceRows(dirList);
  const items: Item[] =
    activeTab === "Recently denied" ? denials.map((e): Item => ({ kind: "denial", e }))
    : activeTab === "Workspace" ? [{ kind: "addDir" }, ...dirList.map((d, i): Item => ({ kind: "dir", d, line: dirLines[i] }))]
    : behavior ? [{ kind: "addRule" }, ...ruleRows(settings, behavior).map((row): Item => ({ kind: "rule", row }))]
    : [];
  const values = itemValues(items);
  /** The ONE rule the cursor, the footer and `activate` all read, so they can never disagree about which row
   *  is current. A value that still names a row wins and is remembered; otherwise the remembered POSITION
   *  answers, clamped — exactly the old `Math.min(idx, items.length - 1)`, which is why an unset cursor (and
   *  an empty list) still degenerates to the top row. Recording on the way through is idempotent — it is a
   *  function of `values` and `value` alone — so calling this from a render is safe. */
  const cursorAt = (value: string | undefined): number => {
    const i = value === undefined ? -1 : values.indexOf(value);
    if (i >= 0) { lastIdxRef.current = i; return i; }
    return Math.min(lastIdxRef.current, Math.max(0, values.length - 1));
  };
  const focusIdx = cursorAt(focusValue);
  const selectedItem = items[focusIdx];

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
  /** Moves the cursor by whole rows off the LIVE value (`focusRef`), not the render's. `values` is safe to
   *  read from the render closure: only a fetch changes it, and a fetch re-renders. */
  const move = (delta: number) => {
    const next = Math.min(values.length - 1, Math.max(0, cursorAt(focusRef.current) + delta));
    if (next >= 0) setFocusValue(values[next]);
  };
  /** Takes the row's VALUE (`undefined` before the first keypress — the footer's row, i.e. the top one). */
  const activate = (value: string | undefined) => {
    const item = items[cursorAt(value)];
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
  // Each top-level handler performs its own operation instead of re-reading the physical key out of a shared
  // body — that re-read is what made a user's `"x": "select:next"` resolve, match, reach this component and
  // move nothing (final review, P2). One deliberate widening comes with it: `select:accept` is bound to
  // {enter, space}, so space now takes the highlighted row here as it always has in SettingsDialog, where the
  // old hand-rolled branch tested `key.return` alone. Nothing destructive is one keypress away — every
  // delete/remove still needs its own Enter inside the modal prompt that opens.
  useKeyActions(sub === "addDir" ? NO_ACTIONS : {
    "select:previous": route(() => move(-1)),
    "select:next": route(() => move(+1)),
    "select:accept": route(() => activate(focusRef.current)),
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
      {/* Still hand-rolled and still unwindowed (6b mounts the `Select`); what changed in 6a is that the row
          bodies live in `renderItem` and the React key is the row's own identity, so duplicate rules stop
          colliding there too. The gutter stays INSIDE this <Text> — see renderItem's note. */}
      {loading ? <Text dimColor>Loading…</Text> : items.map((item, i) => {
        const focused = i === focusIdx;
        return <Text key={values[i]} color={focused ? ACCENT : undefined}>{focused ? "❯ " : "  "}{renderItem(item)}</Text>;
      })}
      <Text> </Text>
      <Text dimColor>{activeTab === "Recently denied" ? RECENT_FOOTER : activeTab === "Workspace" && selectedItem?.kind === "dir" && selectedItem.d.source !== "session" ? MANAGED_DIR_FOOTER : DEFAULT_FOOTER}</Text>
    </Box>
  );
}
