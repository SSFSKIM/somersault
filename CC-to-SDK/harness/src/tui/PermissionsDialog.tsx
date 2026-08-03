// tui/src/PermissionsDialog.tsx — the `/permissions` dialog (Wave 3 task 7): five tabs (Recently denied ·
// Allow · Ask · Deny · Workspace) over the SAME two data sources — get_settings() (rule provenance,
// permissionsModel.ts's ruleRows) and listDirs() (workspace rows, workspaceRows) — fetched once on mount
// and refetched after any mutation, so a just-added rule or just-removed directory shows up immediately
// without closing the dialog. Callback-only, no session access here (useChat.ts owns every session call,
// same convention as every other dialog in this package) — this component owns only the keys, the tab/row
// cursor, and which sub-view (if any) is showing.
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

const TABS = ["Recently denied", "Allow", "Ask", "Deny", "Workspace"] as const;
type Tab = typeof TABS[number];
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
  const [idx, setIdx] = useState(0);
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
  useEffect(() => { setIdx(0); }, [activeTab]);                          // a row cursor from one tab must not carry into another tab's (differently-sized) list

  function cycleTab(delta: number) {
    const i = TABS.indexOf(activeTab);
    onTabChange(TABS[(i + delta + TABS.length) % TABS.length]);
  }

  const behavior = BEHAVIOR_OF[activeTab];
  const dirList = dirs ?? [];
  const dirLines = workspaceRows(dirList);
  const items: Item[] =
    activeTab === "Recently denied" ? denials.map((e): Item => ({ kind: "denial", e }))
    : activeTab === "Workspace" ? [{ kind: "addDir" }, ...dirList.map((d, i): Item => ({ kind: "dir", d, line: dirLines[i] }))]
    : behavior ? [{ kind: "addRule" }, ...ruleRows(settings, behavior).map((row): Item => ({ kind: "rule", row }))]
    : [];
  const clampedIdx = Math.min(idx, Math.max(0, items.length - 1));
  const selectedItem = items[clampedIdx];

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
  const activate = () => {
    const item = items[clampedIdx];
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
    "select:previous": route(() => setIdx((i) => Math.max(0, i - 1))),
    "select:next": route(() => setIdx((i) => Math.min(Math.max(0, items.length - 1), i + 1))),
    "select:accept": route(activate),
    "confirm:no": route(() => onDone()),
    "settings:search": route(() => {}),                // `/` opens no query here — this dialog has no search
    "tabs:next": route(() => cycleTab(1)),
    "tabs:previous": route(() => cycleTab(-1)),
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
      <Text>
        {TABS.map((t, i) => (
          <Text key={t}>{i > 0 ? "  ·  " : ""}<Text bold={t === activeTab} color={t === activeTab ? ACCENT : undefined}>{t}</Text></Text>
        ))}
      </Text>
      <Text> </Text>
      <Text dimColor>{INTRO[activeTab]}</Text>
      {activeTab === "Recently denied" && denials.length === 0 ? <Text dimColor>{RECENT_EMPTY}</Text> : null}
      <Text> </Text>
      {loading ? <Text dimColor>Loading…</Text> : items.map((item, i) => {
        const selected = i === clampedIdx;
        if (item.kind === "addRule") return <Text key="add-rule" color={selected ? ACCENT : undefined}>{selected ? "❯ " : "  "}Add a new rule…</Text>;
        if (item.kind === "addDir") return <Text key="add-dir" color={selected ? ACCENT : undefined}>{selected ? "❯ " : "  "}Add directory…</Text>;
        if (item.kind === "rule") return (
          <Text key={item.row.rule} color={selected ? ACCENT : undefined}>
            {selected ? "❯ " : "  "}{item.row.rule}  <Text dimColor>From {SOURCE_LABELS[item.row.source] ?? item.row.source}</Text>
          </Text>
        );
        if (item.kind === "dir") return (
          <Text key={item.d.path} color={selected ? ACCENT : undefined}>
            {selected ? "❯ " : "  "}
            {item.line.segments ? item.line.segments.map((s, si) => <Text key={si} dimColor={s.dim}>{s.text}</Text>) : item.line.text}
          </Text>
        );
        return (
          <Text key={`${item.e.at}-${item.e.display}`} color={selected ? ACCENT : undefined}>
            {selected ? "❯ " : "  "}{item.e.display}  <Text dimColor>by {item.e.by}</Text>
          </Text>
        );
      })}
      <Text> </Text>
      <Text dimColor>{activeTab === "Recently denied" ? RECENT_FOOTER : activeTab === "Workspace" && selectedItem?.kind === "dir" && selectedItem.d.source !== "session" ? MANAGED_DIR_FOOTER : DEFAULT_FOOTER}</Text>
    </Box>
  );
}
