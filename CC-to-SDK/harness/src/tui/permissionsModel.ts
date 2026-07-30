// tui/src/permissionsModel.ts — pure model for the `/permissions` dialog (Wave 3 task 7): turns the
// engine's get_settings() response into per-behavior rule rows with provenance, a workspace directory list
// into display lines, and folds one settled decision into the recent-denials ledger. No React/session here
// — PermissionsDialog.tsx is the only consumer, mirroring settingsRows.ts's own pure-formatter convention
// (no session access, independently testable).
import type { RenderLine } from "./render.js";
import { toolTarget } from "./render.js";

export interface RuleRow { rule: string; source: string; readOnly: boolean }

// get_settings response → per-behavior rows. sources[] entries look like {source: "flagSettings"|"userSettings"|
// "projectSettings"|"localSettings"|"policySettings"|..., settings:{permissions?:{allow?:[],ask?:[],deny?:[]}}}.
// A rule is readOnly unless its source is "flagSettings" (ours) — display strings verbatim:
export const SOURCE_LABELS: Record<string, string> = {
  userSettings: "user settings", projectSettings: "shared project settings", localSettings: "project local settings",
  flagSettings: "command line arguments", policySettings: "enterprise managed settings", cliArg: "CLI argument",
  command: "command configuration", session: "current session", toolsNarrowing: "CLI tool narrowing", mcpServerPolicy: "MCP server policy",
};

/** get_settings()'s `{effective, sources, applied}` shape (probe 75 Q5; plan Global Constraints line 23/57)
 *  → the ONE behavior's rules across every source that declares one, provenance-tagged and sorted case-
 *  insensitively — the dialog never re-sorts what this already produced. Every rule added through this
 *  dialog's own add-rule flow lands in the "flagSettings" layer (SettingsOps.addRule — the host's flag-
 *  state accumulator, W3 T1), which is the ONLY source this dialog treats as ours to remove; a rule loaded
 *  from an actual settings file (or policy/CLI-arg/etc.) is read-only here even if it happens to say the
 *  exact same tool name. */
export function ruleRows(settings: unknown, behavior: "allow" | "ask" | "deny"): RuleRow[] {
  const sources = (settings as { sources?: unknown } | null | undefined)?.sources;
  if (!Array.isArray(sources)) return [];
  const rows: RuleRow[] = [];
  for (const entry of sources) {
    const e = entry as { source?: unknown; settings?: { permissions?: Record<string, unknown> } } | null;
    if (typeof e?.source !== "string") continue;
    const rules = e.settings?.permissions?.[behavior];
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) if (typeof rule === "string") rows.push({ rule, source: e.source, readOnly: e.source !== "flagSettings" });
  }
  return rows.sort((a, b) => a.rule.localeCompare(b.rule, undefined, { sensitivity: "base" }));
}

/** `listDirs()` rows → display lines for the Workspace tab — the SINGLE source of truth for how a
 *  directory row reads, so the dialog can never drift from what this says (mirrors addDir.ts's own
 *  `dirLabel` doc comment, which flags itself as shared with this exact task). Not `dirLabel` itself: that
 *  helper returns one concatenated string, and the cwd/launch suffixes here must be DIM while the path
 *  stays plain, which needs `segments` (the same split addDir.ts's own formatAddDirResult uses for its
 *  MANAGE_SUFFIX). cwd gets upstream's own "(Original working directory)"; launch dirs get an ours-only
 *  "(from launch config)" — NOT pinned upstream copy, since upstream has no launch-config concept, only a
 *  label our own three-source split needs (recorded divergence). Session dirs (the only REMOVABLE ones)
 *  render plain — interactivity is the caller's job, this only decides what a row SAYS. */
export function workspaceRows(dirs: { path: string; source: string }[]): RenderLine[] {
  return dirs.map((d) => {
    if (d.source === "cwd") return { text: `${d.path} (Original working directory)`, segments: [{ text: d.path }, { text: " (Original working directory)", dim: true }] };
    if (d.source === "launch") return { text: `${d.path} (from launch config)`, segments: [{ text: d.path }, { text: " (from launch config)", dim: true }] };
    return { text: d.path };
  });
}

/** A `patch` factory for settingsFile.ts's `mergeSettingsFile` — the inverse of that module's own
 *  `appendToArray`: drops `value` from `current[...path]` if present, with the exact same shallow-clone-
 *  along-path discipline (siblings at every level survive untouched; the caller's own `current` is never
 *  mutated in place). Lives here rather than settingsFile.ts because this task's file list doesn't touch
 *  that module and this is the pure file this task DOES create — Task 5's own precedent ("just an inline
 *  patch function, no new settingsFile.ts export needed") argues against growing that file for a single
 *  caller; keeping it here as a named, independently-tested export (rather than inlining it in useChat.ts)
 *  is the same idea, just made testable per this task's Step-1 TDD requirement. Used by the rule-delete
 *  flow: a rule added via this dialog is ALWAYS also persisted to one of the three settings files (the
 *  destination picker has no "session only" option), so removing it must undo both the flag-layer grant AND
 *  that file write — see useChat.ts's `removePermRule`. */
export function removeFromArray(path: string[], value: string): (current: any) => any {
  return (current: any) => {
    const next: any = current && typeof current === "object" ? { ...current } : {};
    let cursor = next;
    for (const key of path.slice(0, -1)) {
      cursor[key] = cursor[key] && typeof cursor[key] === "object" && !Array.isArray(cursor[key]) ? { ...cursor[key] } : {};
      cursor = cursor[key];
    }
    const leaf = path[path.length - 1];
    const arr: string[] = Array.isArray(cursor[leaf]) ? cursor[leaf] : [];
    cursor[leaf] = arr.filter((v) => v !== value);
    return next;
  };
}

export interface DenialEntry { display: string; by: string; at: number }

/** `dropPending`'s ledger hook: a settled `{kind:"deny"}` decision appends `{display, by, at}` — `display`
 *  is `toolName(targetSummary)`, reusing render.ts's own `toolTarget` (the SAME helper the live tool-use
 *  line uses) so the ledger and the transcript can never describe the same call differently. Anything else
 *  (allow/question_answer/plan_approve/plan_reject) is a no-op. Capped at the 20 MOST RECENT entries
 *  (oldest evicted first) — a session that racks up more auto-mode denials than that shouldn't grow the
 *  Recently-denied tab unbounded. Pure + independently testable (Step 1) — no React/session here. */
export function appendDenial(ledger: DenialEntry[], decision: string, toolName: string, input: Record<string, unknown>, by: string, at: number): DenialEntry[] {
  if (decision !== "deny") return ledger;
  const summary = toolTarget(toolName, input);
  return [...ledger, { display: summary ? `${toolName}(${summary})` : toolName, by, at }].slice(-20);
}
