// tui/src/commands.ts — pure slash-command surface: parse + table + result-line formatters. No React/SDK side effects.
import type { CompactOutcome, ContextUsageSummary } from "../index.js";
import type { RenderLine } from "./render.js";
import { THINK_LEVELS } from "./thinkLevels.js";
import type { CommandEntry } from "./commandComplete.js";
import { formatElapsed } from "./spinner.js";
import type { SettingsRow } from "./settingsRows.js";
import { THEME_LABELS } from "./theme.js";   // leaf module, no React — safe to import into this pure file

export interface ParsedCommand { name: string; args: string }

/** Leading "/" → {name, args}; non-slash or bare "/" → null. */
export function parseCommand(input: string): ParsedCommand | null {
  const t = input.trim();
  if (!t.startsWith("/")) return null;
  const body = t.slice(1).trim();
  if (!body) return null;                                       // bare "/" is not a command
  const sp = body.indexOf(" ");
  return sp < 0 ? { name: body, args: "" } : { name: body.slice(0, sp), args: body.slice(sp + 1).trim() };
}

/** One row of the local command table. `aliases` is upstream's own descriptor field (`gM_`, bundle L353066:
 *  `{name:"rewind", aliases:["checkpoint","undo"], …}`) and it means what it means there — a SECOND NAME for
 *  the same command, not a second command: the alias dispatches to the canonical arm (`JFy`, L243133:
 *  `e.name === t || … || e.aliases?.includes(t)`) and it is a fuzzy-search key on the canonical row rather
 *  than a row of its own (`eRb`'s `aliasKey`, L489928). `/settings` and `/allowed-tools` predate this field
 *  and stay as they are — separate rows with "alias of …" summaries and their own switch arms — because the
 *  help listing has printed them for four waves and collapsing them is a visible change this task does not own. */
export interface CommandRow { name: string; summary: string; aliases?: string[] }

export const COMMANDS: CommandRow[] = [
  { name: "model", summary: "<name> — switch model (no arg shows current)" },
  { name: "compact", summary: "compact the conversation context" },
  { name: "context", summary: "show context-window usage" },
  { name: "cost", summary: "show session cost + token usage" },
  { name: "status", summary: "show model · mode · context · session" },
  { name: "clear", summary: "clear the screen (session context kept)" },
  { name: "resume", summary: "resume a prior session" },
  { name: "continue", summary: "resume the most-recent session" },
  { name: "yolo", summary: "enable bypassPermissions (ungated tool access)" },
  { name: "think", summary: "<off|low|medium|high|xhigh|max|N> — set thinking budget (no arg shows current)" },
  { name: "mcp", summary: "[reconnect <name> | toggle <name> on|off] — MCP server status / controls" },
  { name: "bg", summary: "list background tasks (k/x stops one)" },
  { name: "history", summary: "search prompt history in the full-screen picker (Ctrl-R searches inline)" },
  { name: "rewind", summary: "rewind to a previous message (Esc Esc · aliases /checkpoint /undo)", aliases: ["checkpoint", "undo"] },
  { name: "add-dir", summary: "<path> — add a new working directory" },
  { name: "theme", summary: "change the theme" },
  { name: "config", summary: "open the Settings dialog (Status · Config · Usage · Stats)" },
  { name: "settings", summary: "alias of /config" },
  { name: "permissions", summary: "manage allow and deny tool permission rules" },
  { name: "allowed-tools", summary: "alias of /permissions" },
  { name: "output-style", summary: "output style moved to /config" },
  { name: "keybindings", summary: "open your keyboard shortcuts file (~/.claude/keybindings.json)" },
  { name: "usage", summary: "show plan usage / rate-limit windows" },
  { name: "copy", summary: "copy the last response to the clipboard" },
  { name: "export", summary: "[file|clipboard] — export the conversation as markdown" },
  { name: "files", summary: "list files touched in this conversation" },
  { name: "diff", summary: "show uncommitted changes (git status + diff --stat)" },
  { name: "stats", summary: "conversation + token/cost statistics" },
  { name: "session", summary: "show this session's id, title, tag and resume hint" },
  { name: "rename", summary: "<title> — rename this session (shows current without args)" },
  { name: "tag", summary: "<name> — toggle a searchable tag on this session" },
  { name: "help", summary: "list commands" },
  { name: "exit", summary: "leave the REPL (alias: /quit · same as Ctrl-D ×2)" },
  { name: "detach", summary: "detach this client, leave the session running (reattach with ccx attach)" },
  { name: "quit", summary: "leave the REPL (alias: /exit)" },
];

/** The 9 local engine-driving commands as CommandEntry[] (the palette merges these with the live catalog).
 *  Aliases ride ALONG on the canonical entry rather than becoming entries of their own — that is upstream's
 *  shape (one row, `aliasKey` as an extra search key) and it is why typing `/undo` narrows to the `/rewind`
 *  row instead of showing a duplicate. */
export const LOCAL_COMMAND_ENTRIES: CommandEntry[] = COMMANDS.map((c) => ({ name: c.name, description: c.summary, source: "local", ...(c.aliases ? { aliases: c.aliases } : {}) }));
/** Local command names — dispatch routes these to the engine switch (never submit-as-prompt). Aliases are in
 *  here too: `/undo` must not be forwarded to the model as a prompt just because the switch spells it `rewind`. */
export const LOCAL_NAMES = new Set(COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]));

const ALIAS_TO_NAME = new Map(COMMANDS.flatMap((c) => (c.aliases ?? []).map((a) => [a, c.name] as const)));
/** An alias → the command it names; anything else unchanged (`JFy`, L243133). Applied ONCE, where the parsed
 *  command meets the dispatch switch, so every arm keeps matching on canonical names only. */
export const canonicalCommand = (name: string): string => ALIAS_TO_NAME.get(name) ?? name;

/** 31000→"31k", 18500→"18.5k". Exported because /stats renders the same counts (sessionTools.ts) — two
 *  copies would let /cost and /stats disagree about the same number the first time the rule changes. */
export const tokenCount = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);

export function formatHelp(): RenderLine[] {
  return [{ text: "commands:", dim: true }, ...COMMANDS.map((c) => ({ text: `  /${c.name}  ${c.summary}`, dim: true }))];
}
export function formatModel(next?: string, current?: string): RenderLine[] {
  return next ? [{ text: `model → ${next}` }] : [{ text: `model: ${current ?? "(default)"}`, dim: true }];
}
/** F6 T11 — the /model PICKER's confirmation, upstream's `y`/`k` at L471427 (identical string at L315166):
 *  `Set model to <bold name>` plus exactly one of the two tails. The name is the model's DISPLAY name, and it
 *  is bold, which is why this is segments rather than one `text` (the dim/bold pair `formatModel` never
 *  needed). `formatModel`'s `model → X` stays where it is: it is the /model COMMAND's line, and the command
 *  has no default-vs-session distinction to report. */
export const SET_MODEL_DEFAULT_TAIL = " and saved as your default for new sessions";
export const SET_MODEL_SESSION_TAIL = " for this session only";
export function formatModelSet(name: string, saveDefault: boolean): RenderLine[] {
  return [{ text: "", segments: [
    { text: "Set model to " }, { text: name, bold: true },
    { text: saveDefault ? SET_MODEL_DEFAULT_TAIL : SET_MODEL_SESSION_TAIL },
  ] }];
}
export function formatThink(next?: string, current?: string): RenderLine[] {
  return next ? [{ text: `thinking → ${next}` }] : [{ text: `thinking: ${current ?? "default"}`, dim: true }];
}
export function formatCompact(o: CompactOutcome): RenderLine[] {
  return o.ok ? [{ text: `✦ compacted ${tokenCount(o.preTokens ?? 0)} → ${tokenCount(o.postTokens ?? 0)}` }]
              : [{ text: `compact: ${o.error ?? "nothing to compact"}`, dim: true }];
}
export function formatContext(s: ContextUsageSummary): RenderLine[] {
  return [{ text: `ctx ${s.percentUsed}% · ${tokenCount(s.tokensUsed)} / ${tokenCount(s.maxTokens)} · ${s.status}`, dim: true }];
}

/** The session-cumulative usage shape from Session.usage() (SDKControlGetUsageResponse subset). */
export interface SessionUsage {
  session?: { total_cost_usd?: number; total_duration_ms?: number; model_usage?: Record<string, { inputTokens?: number; outputTokens?: number; costUSD?: number }> };
  subscription_type?: string | null;
}
const sum = (ms: Record<string, { inputTokens?: number; outputTokens?: number }>, key: "inputTokens" | "outputTokens"): number =>
  Object.values(ms).reduce((a, m) => a + (m[key] ?? 0), 0);

/** `/cost` — total cost (or "included in <plan>" on subscription auth), tokens, duration, per-model rows. */
export function formatCost(u: SessionUsage): RenderLine[] {
  const s = u.session ?? {}; const models = s.model_usage ?? {};
  const cost = s.total_cost_usd ?? 0;
  const costText = cost > 0 ? `$${cost.toFixed(4)}` : u.subscription_type ? `included in your ${u.subscription_type} plan` : "$0.00";
  const out: RenderLine[] = [
    { text: "Session cost", bold: true },
    { text: `  total      ${costText}` },
    { text: `  tokens     ${tokenCount(sum(models, "inputTokens"))} in · ${tokenCount(sum(models, "outputTokens"))} out`, dim: true },
    { text: `  duration   ${formatElapsed(s.total_duration_ms ?? 0)}`, dim: true },
  ];
  for (const [name, m] of Object.entries(models))
    out.push({ text: `  ${name}  ${tokenCount(m.inputTokens ?? 0)} in · ${tokenCount(m.outputTokens ?? 0)} out${m.costUSD ? ` · $${m.costUSD.toFixed(4)}` : ""}`, dim: true });
  return out;
}

/** `/status` — a one-glance snapshot of the live session (purely local state, no SDK call). */
export function formatStatus(s: { model?: string; mode: string; thinkLevel?: string; ctxPct?: number; sessionId?: string; cwd?: string; usage?: string }): RenderLine[] {
  const out: RenderLine[] = [
    { text: "Status", bold: true },
    { text: `  model      ${s.model ?? "(default)"}`, dim: true },
    { text: `  mode       ${s.mode}`, dim: true },
    { text: `  thinking   ${s.thinkLevel ?? "default"}`, dim: true },
  ];
  if (s.ctxPct != null) out.push({ text: `  context    ${s.ctxPct}% used`, dim: true });
  if (s.cwd) out.push({ text: `  cwd        ${s.cwd}`, dim: true });
  if (s.sessionId) out.push({ text: `  session    ${s.sessionId.slice(0, 8)}`, dim: true });
  if (s.usage) out.push({ text: `  usage      ${s.usage}`, dim: true });
  return out;
}
export function formatUnknown(name: string): RenderLine[] {
  return [{ text: `Unknown command: /${name} · try /help`, color: "red" }];
}

// ---- U1: catalogued client-side controls (TUI/UX sprint Wave 1) ----
// The live SDK catalog carries names that are CLIENT features in real Claude Code (2.1.220 bundle:
// type "local"/"local-jsx"), so running them as a prompt turn hands the model a command it cannot act
// on. Each gets an explicit message instead. /review and /doctor are DELIBERATELY absent: both are
// prompt-type upstream, so submit-as-turn is exactly how they work. /rename and /tag are implemented
// locally (Task 6), so they are absent too.
export const CLIENT_SIDE_NOTES: Record<string, string> = {
  agents: "removed upstream — ask Claude to create/manage subagents, or edit .claude/agents/",
  color: "prompt-bar color is a Claude Code UI setting with no equivalent here",
  effort: "effort maps to the thinking budget here — use /think <off|low|medium|high|xhigh|max|N>",
  "extra-usage": "renamed /usage-credits upstream; for plan usage here use /usage",
  fast: "fast mode is a Claude Code client toggle the Agent SDK doesn't expose",
  heapdump: "dumps the Claude Code CLI's own JS heap — not applicable to ccx",
};
/** U1 honesty line: name the feature, say why it can't run here, never forward it to the model. */
export function formatClientSide(name: string): RenderLine[] {
  return [{ text: `/${name}: ${CLIENT_SIDE_NOTES[name]}`, dim: true }];
}

// ---- /mcp (W3.5) ----
export type McpAction = { kind: "status" } | { kind: "reconnect"; name: string } | { kind: "toggle"; name: string; enabled: boolean };

/** `/mcp` args → an action, or null for malformed input (caller prints usage). */
export function parseMcpArgs(args: string): McpAction | null {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: "status" };
  if (parts[0] === "reconnect" && parts[1]) return { kind: "reconnect", name: parts[1] };
  if (parts[0] === "toggle" && parts[1] && (parts[2] === "on" || parts[2] === "off")) return { kind: "toggle", name: parts[1], enabled: parts[2] === "on" };
  return null;
}

/** Status rows from Session.mcpServerStatus() ([{name, status}, …] — shape tolerated loosely). */
export function formatMcpStatus(servers: unknown[]): RenderLine[] {
  if (!servers.length) return [{ text: "mcp: no servers", dim: true }];
  return [{ text: "MCP servers", bold: true }, ...servers.map((s) => {
    const r = s as { name?: string; status?: string; state?: string };
    return { text: `  ${r.name ?? "?"}  ${r.status ?? r.state ?? "?"}`, dim: true };
  })];
}
export function formatMcpUsage(): RenderLine[] {
  return [{ text: "usage: /mcp · /mcp reconnect <name> · /mcp toggle <name> on|off (advisory — a tool call can revive a disabled server)", dim: true }];
}

export type InitialResume = { kind: "id"; id: string } | { kind: "continue" };

/** The session id with the greatest lastModified, or undefined for an empty list. */
export function pickMostRecent(sessions: { sessionId: string; lastModified: number }[]): string | undefined {
  let best: { sessionId: string; lastModified: number } | undefined;
  for (const s of sessions) if (!best || s.lastModified > best.lastModified) best = s;
  return best?.sessionId;
}

/** CLI args → an initial-resume intent: `--resume <id>` / `--continue` / `-c`. */
export function parseResumeIntent(args: string[]): InitialResume | undefined {
  const ri = args.indexOf("--resume");
  if (ri >= 0 && args[ri + 1]) return { kind: "id", id: args[ri + 1] };
  if (args.includes("--continue") || args.includes("-c")) return { kind: "continue" };
  return undefined;
}

export const PERMISSION_MODES = ["default", "acceptEdits", "auto", "bypassPermissions", "plan", "dontAsk"] as const;
export type LaunchMode = typeof PERMISSION_MODES[number];

/** `--permission-mode <m>` → a valid SDK permission mode, or "default" if absent/unknown. */
export function parseLaunchMode(args: string[]): LaunchMode {
  const i = args.indexOf("--permission-mode");
  const m = i >= 0 ? args[i + 1] : undefined;
  return m && (PERMISSION_MODES as readonly string[]).includes(m) ? (m as LaunchMode) : "default";
}

/** `--think <level>` → a valid level name (off|low|medium|high|xhigh|max), or undefined if absent/unknown. */
export function parseLaunchThink(args: string[]): string | undefined {
  const i = args.indexOf("--think");
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && (THINK_LEVELS as readonly string[]).includes(v) ? v : undefined;
}

// ---- /config key=value (W3.6) ----
// theme.ts's own id list — theme's setter (setTheme) mutates its module-level `current`/`ACCENT` state
// BEFORE it would fail on a bad id (it indexes THEMES[id].claude only after assigning `current = id`), so
// an unvalidated bad id would corrupt currentTheme() for the rest of the process, not just this one call.
// permissionMode needs no such list here — its row already carries `options` (settingsRows.ts's single
// source, exported as PERMISSION_MODE_OPTIONS); model/outputStyle have no fixed domain to check (same as
// how /model and the Output-style picker never client-side-validate an id either).
const THEME_IDS = THEME_LABELS.map(([id]) => id);

export type ConfigArgResult =
  | { kind: "open" }
  | { kind: "error"; lines: RenderLine[] }
  | { kind: "set"; id: SettingsRow["id"]; value: string; lines: RenderLine[] };

/** `/config` (bare) → open; `/config key=value` → validated against `rows` — the SAME model
 *  SettingsDialog renders (`buildRows(...)`, passed in by the caller) — so this can never drift from what
 *  the dialog itself considers a real row/value. Only decides WHAT to set, never HOW: the caller applies
 *  `{id, value}` through the same functions the dialog uses (applyMode/setThink/applyOutputStyle) or the
 *  direct theme/model mechanism their own standalone commands use, so a rejected parse can never partially
 *  mutate state. Every error string here is Global Constraints' verbatim `/config key=value` copy. */
export function parseConfigArg(arg: string, rows: SettingsRow[]): ConfigArgResult {
  const s = arg.trim();
  if (!s) return { kind: "open" };
  const eq = s.indexOf("=");
  if (eq < 0) return { kind: "error", lines: [{ text: `Expected key=value, got "${s}". Run /config to see what's available.`, color: "red" }] };
  const key = s.slice(0, eq).trim();
  const value = s.slice(eq + 1).trim();
  const row = rows.find((r) => r.id === key);
  if (!row) return { kind: "error", lines: [{ text: `${key} isn't a /config setting. Run /config to see what's available.`, color: "red" }] };
  if (row.type === "boolean") {
    if (value !== "true" && value !== "false") return { kind: "error", lines: [{ text: `${key} takes true or false, not "${value}".`, color: "red" }] };
    if (value === "false" && row.value === "false") return { kind: "error", lines: [{ text: `${key} is already off.`, dim: true }] };
    return { kind: "set", id: row.id, value, lines: [{ text: `Set ${key} to ${value}` }] };
  }
  const domain = row.type === "enum" ? (row.options ?? []) : row.id === "theme" ? THEME_IDS : undefined;
  if (domain && !domain.includes(value)) return { kind: "error", lines: [{ text: `${key} takes one of: ${domain.join(", ")}.`, color: "red" }] };
  return { kind: "set", id: row.id, value, lines: [{ text: `Set ${key} to ${value}` }] };
}
