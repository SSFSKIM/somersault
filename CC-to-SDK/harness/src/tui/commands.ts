// tui/src/commands.ts — pure slash-command surface: parse + table + result-line formatters. No React/SDK side effects.
import type { CompactOutcome, ContextUsageSummary } from "../index.js";
import type { RenderLine } from "./render.js";
import { THINK_LEVELS } from "./thinkLevels.js";
import type { CommandEntry } from "./commandComplete.js";
import { formatCompactNumber, formatTokens, formatDuration, formatUsd, plural } from "./format.js";
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
  // F6 T13 (DG61). Upstream's row is `{name:"tasks", aliases:["bashes"], description:"View and manage
  // everything running in the background"}` (bundle L350769) — it has no `/bg` at all. Ours keeps `/bg` as the
  // CANONICAL name (four waves of muscle memory, and `useChat`'s dispatch arm is spelled `bg`) and takes
  // upstream's two names as aliases, so all three open the same dialog. Recorded keep-decision, not an
  // oversight. The summary is upstream's own description, and the old parenthetical died with the panel it
  // described: `k` is navigation now, and stopping is `x` (F2 task 8).
  { name: "bg", summary: "view and manage everything running in the background (aliases /tasks /bashes)", aliases: ["tasks", "bashes"] },
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

// TWO compact number forms, both upstream's, deliberately kept apart. This note replaces W-S t7's "one
// spelling for every token count" rule, which was WRONG and briefly made `/context` read `200.0k` where
// upstream reads `200k`. Upstream's export map (`cli.pretty.js` L107029) names them itself:
//   * `_d` = `formatNumber` (L107091) — ported as `formatCompactNumber`. `minimumFractionDigits` is 1 at or
//     above 1000, so `31000` reads `31.0k` and the tenth is MANDATORY.
//   * `va` = `formatTokens` (L107095) — ported as `formatTokens`. Literally `_d(e).replace(".0","")`, so the
//     same number reads `31k`. Recounted W-S t7 review: `_d` has 39 call expressions in 2.1.220 and `va` 55,
//     NOT the "three vs thirty-odd" this note first claimed — see `format.ts` for the method and the sites
//     the old census missed. The ratio is not what routes a surface; the counterpart below each arm is.
// Which form a surface takes is upstream's per-surface choice, not a house style we get to unify:
//   * `/cost` (`formatCost` below) keeps `formatCompactNumber`. Its usage block IS `E0y` (L217696), one of
//     the three `_d` sites. This is the surface the bundle settles unambiguously.
//   * `/context` (`formatContext`) and `/compact` (`formatCompact`) take `formatTokens`: upstream's context
//     and compaction readouts are `va` throughout — `Wcn` L315889, the `/context` grid L444440–444745, and
//     `Compacting at auto window (${va(o)} tokens)` L308455.
//   * `/stats` (`sessionTools.ts`) stays on `formatCompactNumber`. Upstream's `/stats` is an ALIAS of
//     `/usage`/`/cost` (L351877), and our line is cumulative per-model input/output totals — which upstream
//     spells with `_d` in the very same activity panel (`In: ${_d(l.inputTokens)} · Out: …`, L444263).
// The `tokenCount` this all replaced — our hand-rolled `n >= 1000 ? Math.round(n/100)/10 + "k" : n`, which
// never rolled over to `m` and printed `1234.6k` for `1.2m` — was a THIRD spelling with no upstream name at
// all. That is the drift its own comment was guarding against: an unnamed re-derivation of a form upstream
// already names. Two named ports, one delegating to the other, with a documented call-site rule each, are
// not that — and collapsing them onto one is what produced the regression.

// `formatHelp()` — the plain `commands:` listing — was deleted in F6 T15. F6 T14 made `/help` a tabbed
// DIALOG (`RNa`, L459684) whose Commands tab browses the LIVE catalog, which left the listing with no caller
// anywhere in the tree: not the REPL, not the daemon, not the attach path, not the public barrel. A second
// command listing that nothing renders is a second source of truth for what commands exist, and `COMMANDS`
// (still exported, still the dialog's local half) is the first.
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
/** The one surface here with NO verbatim upstream counterpart: upstream's post-compact notice (`Fl_`,
 *  L314674) prints the word `Compacted` plus hint clauses and no numbers at all, so this before→after pair
 *  is ours. `formatTokens` is the reasoned choice, not a coin flip — every compaction-adjacent token readout
 *  upstream does print is `va` (`Compacting at auto window (${va(o)} tokens)` L308455, and the whole
 *  `/autocompact` block L314729–314755), so a number in this family reading `31.0k` would be the odd one. */
export function formatCompact(o: CompactOutcome): RenderLine[] {
  return o.ok ? [{ text: `✦ compacted ${formatTokens(o.preTokens ?? 0)} → ${formatTokens(o.postTokens ?? 0)}` }]
              : [{ text: `compact: ${o.error ?? "nothing to compact"}`, dim: true }];
}
/** Our one-line digest of upstream's `/context`. The token pair is upstream's own to the formatter: `Wcn`
 *  (L315889) prints `` `**Tokens:** ${va(n)} / ${va(o)} (${i}%)` `` — same used/max/percent triple, same
 *  `formatTokens`; the interactive grid (L444440–444745) spells every cell with `va` too. */
export function formatContext(s: ContextUsageSummary): RenderLine[] {
  return [{ text: `ctx ${s.percentUsed}% · ${formatTokens(s.tokensUsed)} / ${formatTokens(s.maxTokens)} · ${s.status}`, dim: true }];
}

/** The session-cumulative usage shape from `Session.usage()` — a subset of `SDKControlGetUsageResponse`
 *  (`sdk.d.ts:3186-3205`), every name below verified against that file's spelling, with the model entry a
 *  subset of `ModelUsage` (`:1265-1282`). Optional throughout because a partial response must render rather
 *  than throw; the SDK itself declares all of these required. Four of `ModelUsage`'s ten fields
 *  (`contextWindow`, `maxOutputTokens`, `canonicalModel`, `provider`) upstream accumulates and never prints
 *  — they are typed here so a caller passing the raw response type-checks, and only `canonicalModel` is
 *  read, as the fold key `E0y` uses it for. Printing rows for the others would be an addition beyond
 *  upstream, not a fidelity repair. */
export interface SessionUsage {
  session?: {
    total_cost_usd?: number; total_api_duration_ms?: number; total_duration_ms?: number;
    total_lines_added?: number; total_lines_removed?: number;
    model_usage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; webSearchRequests?: number; costUSD?: number; contextWindow?: number; maxOutputTokens?: number; canonicalModel?: string; provider?: string }>;
  };
  subscription_type?: string | null;
}
/** Session-CUMULATIVE output tokens, across every model the session has used — the model-switch confirm's
 *  gate reads it (Wave S T12, `modelConfirmModel.ts`) and there is nowhere else in the package that already
 *  holds it (`useChat`'s `turnTokens` is per-turn and resets). Deliberately NOT folded by `canonicalModel`
 *  like `/cost`'s rows are: a total does not care which rows merged, and folding first would only add a Map.
 *  Tolerant of a partial payload for the same reason `SessionUsage` is optional throughout. */
export function totalOutputTokens(u?: SessionUsage): number {
  let n = 0;
  for (const m of Object.values(u?.session?.model_usage ?? {})) n += m.outputTokens ?? 0;
  return n;
}
type ModelRow = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; webSearchRequests: number; costUSD: number };
/** Upstream's `E0y` folds `model_usage` by CANONICAL model (`lo(rawKey)`) before rendering, so two raw ids
 *  that price as one model print one row rather than two. The SDK hands that canonical id back on the entry
 *  itself (`canonicalModel`), so we fold on it instead of re-deriving it from the key. */
function foldByModel(ms: NonNullable<NonNullable<SessionUsage["session"]>["model_usage"]>): Map<string, ModelRow> {
  const by = new Map<string, ModelRow>();
  for (const [name, m] of Object.entries(ms)) {
    const key = m.canonicalModel ?? name;
    const r = by.get(key) ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 };
    r.inputTokens += m.inputTokens ?? 0; r.outputTokens += m.outputTokens ?? 0; r.cacheReadInputTokens += m.cacheReadInputTokens ?? 0;
    r.cacheCreationInputTokens += m.cacheCreationInputTokens ?? 0; r.webSearchRequests += m.webSearchRequests ?? 0; r.costUSD += m.costUSD ?? 0;
    by.set(key, r);
  }
  return by;
}
/** The one column every `/cost` value starts at. Upstream hard-codes the four labels' trailing spaces and
 *  pads model names to 21 ahead of a body that opens with two more — both land here, so both halves of the
 *  block read off this constant rather than off two hand-counted literals that can drift apart. */
const COST_COL = 23;

/** `/cost` — a TRANSCRIPTION of upstream's `Aze` (`cli.pretty.js` L217733-217739) and the `E0y` usage block
 *  it embeds (L217683-217704), replacing the `Session cost`/total/tokens/duration layout this harness had
 *  invented. Four aligned label rows, then either `Usage by model:` plus a right-aligned row per model or,
 *  with no models at all, upstream's single `Usage:` line. The whole block is `vt.dim` upstream, hence
 *  `dim: true` on every line. Two deliberate divergences, both recorded in `docs/parity/tui-ux.md`:
 *  1. Upstream appends ` (costs may be inaccurate due to usage of unknown models)` to the cost when its
 *     pricing table misses a model. We have no such signal off the SDK, and inventing one would be worse
 *     than omitting the caveat, so the clause is absent rather than guessed.
 *  2. Upstream always prints a dollar figure. On subscription auth that figure is a fiction — the turns bill
 *     a Pro/Max plan, not a card — so a zero total with a `subscription_type` present prints the plan
 *     instead. It sits in the transcribed row's VALUE slot, so the layout stays upstream's to the column;
 *     only the string inside it is ours. Kept from U4 as a real affordance for OAuth users. */
export function formatCost(u: SessionUsage): RenderLine[] {
  const s = u.session ?? {};
  const cost = s.total_cost_usd ?? 0;
  const added = s.total_lines_added ?? 0, removed = s.total_lines_removed ?? 0;
  const out: RenderLine[] = [
    { text: "Total cost:".padEnd(COST_COL) + (cost === 0 && u.subscription_type ? `included in your ${u.subscription_type} plan` : formatUsd(cost)), dim: true },
    { text: "Total duration (API):".padEnd(COST_COL) + formatDuration(s.total_api_duration_ms ?? 0), dim: true },
    { text: "Total duration (wall):".padEnd(COST_COL) + formatDuration(s.total_duration_ms ?? 0), dim: true },
    // UNCONDITIONAL, on purpose. The W-S t7 brief carried a checkbox asserting this row is omitted when
    // nothing was edited; upstream `Aze` prints `Total code changes: 0 lines added, 0 lines removed` with no
    // guard, and the re-cut's own rule was to follow upstream's omission rule rather than the plan's. The
    // only clause upstream omits in this whole block is the web-search one below. Do not re-add a zero-guard
    // here citing that checkbox — the checkbox is the thing that was wrong.
    { text: "Total code changes:".padEnd(COST_COL) + `${added} ${plural(added, "line")} added, ${removed} ${plural(removed, "line")} removed`, dim: true },
  ];
  const models = foldByModel(s.model_usage ?? {});
  if (models.size === 0) { out.push({ text: "Usage:".padEnd(COST_COL) + "0 input, 0 output, 0 cache read, 0 cache write", dim: true }); return out; }
  out.push({ text: "Usage by model:", dim: true });
  for (const [name, m] of models)
    // The web-search clause appears ONLY above zero — upstream's own "omit what was not used" rule, and the
    // only conditional clause in the block: the four cache/token counts print their zeros.
    out.push({ text: `${name}:`.padStart(COST_COL - 2) + `  ${formatCompactNumber(m.inputTokens)} input, ${formatCompactNumber(m.outputTokens)} output, ${formatCompactNumber(m.cacheReadInputTokens)} cache read, ${formatCompactNumber(m.cacheCreationInputTokens)} cache write`
      + (m.webSearchRequests > 0 ? `, ${formatCompactNumber(m.webSearchRequests)} web search` : "") + ` (${formatUsd(m.costUSD)})`, dim: true });
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
