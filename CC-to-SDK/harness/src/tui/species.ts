// tui/src/species.ts — F4 Task 10a: THE sentinel router. A `user` frame on our wire is very often not a
// prompt at all: it is engine bookkeeping (a slash-command echo, local-command stdout, an interrupt, a
// background-task notification, an MCP resource push) wearing a user frame because that is the only frame
// the transcript has. Upstream's `ERe` (bundle L426424–426532) is the ONE place that decides which, and the
// pack §9.2 enumerates its FIFTEEN exits before the fallthrough — five more than the census counted. This
// module is that switch: `classifyUserText` is the decision, `speciesLines` the per-species form, and BOTH
// the live path (`render.ts`'s user branch) and the disk path (`replay.ts`) go through it, because a
// sentinel that reaches `userEchoLines` gets band-wrapped as a prompt the human never typed.
//
// The tag constants come from §9.1 (bundle L17765) VERBATIM. `sessions/rows.ts` — the persisted-row shape
// classifier the rewind picker and transcript replay share — imports its regexes back FROM here rather than
// keeping a second copy, so the two classifiers cannot drift apart on what a `<local-command-caveat>` is.
//
// ── RECORDED UNREACHABLE (spec settlement 3) ────────────────────────────────────────────────────────────
// Three of `ERe`'s fifteen exits cannot fire on OUR wire — the Claude Agent SDK headless stream plus the
// session files on disk — so no renderer is built for them and they are absent from `SpeciesKind`. Task 11's
// parity re-score reads this list; each entry is route → bundle cite → why unreachable.
//
//  · exit 2 `planContent` (L426428 → `p4t` L425978). NOT a text sentinel at all: it is a PROP, read off the
//    UI-layer message object (`DAe.planContent`, L429357) that the CLI sets when a queued prompt carries a
//    plan-file reference (L500964). SDK messages have no such field, and our plan surface is PlanDialog plus
//    the ExitPlanMode tool row, not a user frame. A text-only router cannot reach it by construction.
//  · exit 3 `mc() && kvr(text)` (L426436 → `cqo` L425393). The agent-teams teammate transcript. Double
//    gated: `mc()` (L224777) requires BOTH the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var AND the
//    `tengu_amber_flint` statsig gate, and `kvr` (L425297) needs a `<teammate-message …>` tag that only the
//    CLI's teammate transport writes. Our swarm/ teammates ride their own bus and never emit that tag.
//  · exit 4 `<channel source="` / `A message arrived from ` (L426444 → `HWp` L426253). The same agent-teams
//    feature's channel/cross-session inbox (`aCt`/`Tye`/`ort`, L17765). Nothing on our wire writes the tag;
//    the SDK has no channel transport at all.
//
// TASK 10b adds three more surfaces to this module and, with them, three more reachability records. They are
// kept beside the renderers that own them rather than copied up here — the re-score should read all four:
//   · `errorSentinelLines` — `Dcs`/`l8o` (the usage-limit nudge), `case lir`/`<aca/>` (the login box),
//     `J2e("warning")`'s entitlement clause, and `nm(wT())`'s resolved model name.
//   · `systemNoticeLines` — the nine `dVo` branches whose subtypes are absent from `sdk.d.ts`'s system union,
//     and the structured frames that fall out of the generic exit by construction.
//   · `compactSummaryLines` — `XWo` shape A (`summarizeMetadata`) and the transcript-mode summary body, both
//     unreachable because P81 read the live frame key-by-key and neither field is on it.
// Two notes on routes that ARE shipped, for the same re-score. (a) `<mcp-resource-update` /
// `<mcp-polling-update` have READERS in 2.1.220 (L426198–426202, L426420, L426513) but no writer anywhere in
// the artifact — the injection is produced outside this bundle. It is shipped because the brief names it and
// its form is pinned verbatim by pack §9.3, but it has not been observed live. (b) `<bash-input>`,
// `<user-memory-input>` and `<fork-boilerplate>` are written by the real `claude` CLI, not by our REPL (our
// `!` bash mode is local-only, see bash.ts) — they reach us through session files the CLI authored in the
// same `~/.claude/projects` tree our session picker lists, which is exactly the path `sessions/rows.ts`
// already exists to survive.
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
// The OTHER end of the tui layer's one deliberate import cycle (render.ts:22–27 documents the shape):
// render.ts routes its user branch through this module, and this module needs the band renderer back.
// Safe ONLY while both sides stay hoisted `export function` declarations called inside function bodies —
// turning either into a `const` arrow breaks at RUNTIME (TDZ), not at typecheck.
import { userEchoLines, type Gutter, type RenderLine, type Segment } from "./render.js";
import { formatDuration } from "./format.js";
import { renderMarkdown } from "./markdown.js";
import { EXPAND_HINT_FALLBACK } from "./keys/hints.js";
import { foldToolOutput, withoutTrailingBlanks, type ResultProjection } from "./outputFold.js";
import { resolveThemeColor, themeTokens } from "./theme.js";

// ── §9.1 tag constants, bundle L17765 ──────────────────────────────────────────────────────────────────
export const TAG_COMMAND_NAME = "command-name", TAG_COMMAND_MESSAGE = "command-message", TAG_COMMAND_ARGS = "command-args";
export const TAG_BASH_INPUT = "bash-input", TAG_BASH_STDOUT = "bash-stdout", TAG_BASH_STDERR = "bash-stderr";
export const TAG_LOCAL_STDOUT = "local-command-stdout", TAG_LOCAL_STDERR = "local-command-stderr", TAG_LOCAL_CAVEAT = "local-command-caveat";
export const TAG_TICK = "tick", TAG_TASK_NOTIFICATION = "task-notification", TAG_STATUS = "status", TAG_SUMMARY = "summary";
export const TAG_MEMORY_INPUT = "user-memory-input", TAG_FORK_BOILERPLATE = "fork-boilerplate";
/** `lCt` (L17765) — the prefix `IWp` strips off a fork's directive, trailing space included. */
const FORK_DIRECTIVE_PREFIX = "Your directive: ";
/** `BC` (L104957). A user text of exactly this renders NOTHING — it is the placeholder the engine writes
 *  when a frame has no body, not something a human typed. */
export const NO_CONTENT = "(no content)";
/** `Tq` / `Wk` (L108575). Exit 9 matches by EXACT EQUALITY, not substring — quoting the sentence inside a
 *  longer prompt still gets you your own prompt row. */
export const INTERRUPT_PLAIN = "[Request interrupted by user]";
export const INTERRUPT_TOOL = "[Request interrupted by user for tool use]";
/** `zWo` (L422222–422229): two dim `Text` nodes, `"Interrupted "` and `"· What should Claude do instead?"`. */
export const INTERRUPTED_TEXT = "Interrupted · What should Claude do instead?";
/** `Cr`'s gutter children (L406895): `"  "` then `"⎿ \xa0"` — two spaces, ⎿ (U+23BF), space, NBSP. Five
 *  columns. It lives HERE rather than in toolRenderer.tsx so this pure module can use it without dragging
 *  React into `sessions/rows.ts`'s import graph; toolRenderer re-exports it, so every existing importer is
 *  unaffected and there is still exactly one `⎿` string in the codebase. */
export const TOOL_RESULT_GUTTER = "  \u23bf \u00a0" as const;
/** `oEn`'s own gutter (L425796) is `"  ⎿  "` — same five columns, but two ORDINARY spaces where `Cr` puts a
 *  space and an NBSP. Upstream really does spell the two differently; keeping both is fidelity, not a typo.
 *  It shares its BYTES with `toolRenderer`'s `GROUP_HINT_GUTTER` and that is a coincidence of two unrelated
 *  upstream constructs, not a shared constant — collapsing them would couple the local-command output form
 *  to the fold-run hint row, which can drift independently. */
export const LOCAL_OUTPUT_GUTTER = "  \u23bf  " as const;
/** `tPi` (L41482) U+21BB CLOCKWISE OPEN CIRCLE ARROW, and `UO` (L41482) U+2442 OCR FORK. */
const MCP_GLYPH = "↻", FORK_GLYPH = "\u2442";

// ── The regexes `sessions/rows.ts` imports back ────────────────────────────────────────────────────────
// Anchored at the START (`^\s*`) deliberately: rows.ts is asking "is this whole persisted row bookkeeping",
// which is a stricter question than `ERe`'s per-exit `includes`/`startsWith` mix below.
export const COMMAND_ECHO_RE = new RegExp(`^\\s*<${TAG_COMMAND_NAME}>`);
export const COMMAND_OUTPUT_RE = new RegExp(`^\\s*<${TAG_LOCAL_STDOUT}>`);
export const CAVEAT_RE = new RegExp(`^\\s*<${TAG_LOCAL_CAVEAT}>`);
/** English-string sniffing, but the only signal there is: the CLI writes this exact preamble on the
 *  continuation-summary row that replaces pre-compact history (probe 68b). */
export const COMPACT_SUMMARY_RE = /^This session is being continued from a previous conversation/;

/** Upstream `al` (L373235–373256): the inner text of the first BALANCED `<tag …>…</tag>` pair, or null.
 *  "Balanced" means the slice before the candidate opens and closes the same number of times, so a nested
 *  `<summary>` inside another `<summary>` does not hand back the wrong body. An EMPTY inner returns null —
 *  which is load-bearing, because `ERe`'s tick exit tests the return value for truthiness, not for null. */
export function tagInner(text: string, tag: string): string | null {
  if (!text.trim() || !tag.trim()) return null;
  const t = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pair = new RegExp(`<${t}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${t}>`, "gi");
  const open = new RegExp(`<${t}(?:\\s+[^>]*?)?>`, "gi"), close = new RegExp(`<\\/${t}>`, "gi");
  let match: RegExpExecArray | null, from = 0;
  while ((match = pair.exec(text)) !== null) {
    const inner = match[1] ?? "", before = text.slice(from, match.index);
    let depth = 0;
    open.lastIndex = 0; while (open.exec(before) !== null) depth++;
    close.lastIndex = 0; while (close.exec(before) !== null) depth--;
    if (depth === 0 && inner) return inner;
    from = match.index + match[0].length;
  }
  return null;
}

/** Upstream `RIe` (L149171): the three entities the transcript writer escapes, and only those. */
const unescape = (s: string): string => s.replace(/&(?:amp|lt|gt);/g, (e) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">" })[e] ?? e);

/** Every route `ERe` has that our wire can actually deliver, plus the fallthrough prompt echo. The three
 *  exits that cannot fire here are deliberately ABSENT — see the RECORDED UNREACHABLE block at the top. */
export type SpeciesKind =
  | "empty"             // exit 1  L426426 — falsy text, or exactly `(no content)`
  | "tick"              // exit 5  L426453 — a `<tick>` heartbeat prompt (scheduled/autonomous sessions)
  | "caveat"            // exit 6  L426455 — `<local-command-caveat>`
  | "bash-output"       // exit 7  L426457 — `<bash-stdout|stderr>` opening the message
  | "command-output"    // exit 8  L426465 — `<local-command-stdout|stderr>` opening the message
  | "interrupt-tool"    // exit 9a L426473 — `Wk`; F3 keeps this one on the tool row
  | "interrupt-plain"   // exit 9b L426473 — `Tq`; the standalone row this task adds
  | "bash-input"        // exit 10 L426481 — `<bash-input>`
  | "command-echo"      // exit 11 L426489 — `<command-message>`
  | "memory-input"      // exit 12 L426497 — `<user-memory-input>`
  | "task-notification" // exit 13 L426505 — `<task-notification`
  | "mcp-update"        // exit 14 L426513 — `<mcp-resource-update` / `<mcp-polling-update`
  | "fork-boilerplate"  // exit 15 L426521 — `<fork-boilerplate>`
  | "prompt";           //         L426529 — the fallthrough, `Mqo`'s banded echo

/** `ERe`'s branch order, kept EXACTLY — the order is the contract, not an implementation detail. A caveat
 *  row that also carries a `<command-message>` is invisible (6 before 11); a message that OPENS with
 *  `<bash-stdout>` is output even if it also contains `<bash-input>` (7 before 10). Note the deliberate
 *  startsWith/includes asymmetry the pack calls out: the two output species must OPEN the message, every
 *  other tag may sit anywhere in it.
 *
 *  ONE deviation from the literal switch, at exit 11: upstream tests `<command-message>` alone, but half our
 *  disk rows carry `<command-name>` with no `<command-message>` beside it, and the CLI's OWN bookkeeping
 *  predicate (L373082) keys on `<${BN}>` = `command-name` for exactly that reason. Without the fallback a
 *  replayed `/help` echo would paint its raw XML into the transcript. Classification stays a superset of
 *  upstream's; nothing upstream calls an echo is called anything else here. */
export function classifyUserText(text: string): SpeciesKind {
  if (typeof text !== "string" || !text || text.trim() === NO_CONTENT) return "empty";
  if (tagInner(text, TAG_TICK)) return "tick";
  if (text.includes(`<${TAG_LOCAL_CAVEAT}>`)) return "caveat";
  if (text.startsWith(`<${TAG_BASH_STDOUT}`) || text.startsWith(`<${TAG_BASH_STDERR}`)) return "bash-output";
  if (text.startsWith(`<${TAG_LOCAL_STDOUT}`) || text.startsWith(`<${TAG_LOCAL_STDERR}`)) return "command-output";
  if (text === INTERRUPT_TOOL) return "interrupt-tool";
  if (text === INTERRUPT_PLAIN) return "interrupt-plain";
  if (text.includes(`<${TAG_BASH_INPUT}>`)) return "bash-input";
  if (text.includes(`<${TAG_COMMAND_MESSAGE}>`) || text.includes(`<${TAG_COMMAND_NAME}>`)) return "command-echo";
  if (text.includes(`<${TAG_MEMORY_INPUT}>`)) return "memory-input";
  if (text.includes(`<${TAG_TASK_NOTIFICATION}`)) return "task-notification";
  if (text.includes("<mcp-resource-update") || text.includes("<mcp-polling-update")) return "mcp-update";
  if (text.includes(`<${TAG_FORK_BOILERPLATE}>`)) return "fork-boilerplate";
  return "prompt";
}

export interface SpeciesOptions {
  width?: number;
  /** `task-notification`, the system notices and the compact-summary boundary read it — `Za` (L41482) is `⏺`
   *  on macOS and `●` elsewhere, the same per-platform glyph `withAssistantBullet` paints. An extension to
   *  the brief's `{ width }` bag; the alternative was baking `process.platform` into a pure renderer, which
   *  Task 8 already rejected. */
  platform?: NodeJS.Platform;
  /** Task 10b. How much of a folded body the caller wants — `bash-output` is a FOLDED surface upstream
   *  (`r4e` → `p2`/`y_s`) and a detail projection must show all of it, exactly as a tool result's does.
   *  Absent = the transcript's compact form, which is what every non-projecting caller means. */
  projection?: ResultProjection;
  /** Task 10b. The resolved `(chord to expand)` sentence from the LIVE keymap; see `keys/hints.ts`. Absent =
   *  no keymap in scope, so `pA`'s literal fallback stands; empty = the user unbound `app:toggleTranscript`,
   *  so no clause is printed at all (E2). */
  expandHint?: string;
  /** `VAr`'s own `verbose` prop (L422715), which only `lca` reads — a verbose read never truncates an API
   *  error at 1 000 characters. Derived by the caller from the projection, not from a second source. */
  verbose?: boolean;
}

// ── Line helpers ───────────────────────────────────────────────────────────────────────────────────────
const gutterLine = (gutter: string, text: string, style?: { color?: string; dim?: boolean }): RenderLine =>
  ({ text, ...style, gutter: { text: gutter, dim: true } });
/** A guttered BLOCK: the marker rides row 0 and every later row is indented under it, the same shape
 *  `withAssistantBullet` and `withThinkingGutter` use (upstream renders the body as a sibling column of a
 *  fixed-width gutter box, so a wrapped row aligns under the text and not under the glyph). */
function gutterBlock(gutter: string, lines: readonly string[], style?: { color?: string; dim?: boolean }): RenderLine[] {
  const pad = " ".repeat(stringWidth(gutter));
  return lines.map((text, i) => (i === 0 ? gutterLine(gutter, text, style) : { text: pad + text, ...style }));
}
/** The same block over ALREADY-STYLED lines: each row keeps its own attributes (which is what lets a folded
 *  body's dim `… +N lines` marker sit under an error-coloured stderr without inheriting the colour). */
function gutterRows(gutter: string, lines: readonly RenderLine[]): RenderLine[] {
  const pad = " ".repeat(stringWidth(gutter));
  return lines.map((line, i) => (i === 0 ? { ...line, gutter: { text: gutter, dim: true } } : { ...line, text: pad + line.text }));
}
/** `p2` (L420173) → `y_s` (L186474) on one raw body: three compact rows, upstream's four-row exception, and
 *  the overflow marker whose hint is the threaded one. `width` is the FULL column budget — `foldToolOutput`
 *  subtracts its own ten columns for the gutter it renders behind. */
const foldBody = (body: string, width: number, opts: SpeciesOptions): readonly RenderLine[] =>
  foldToolOutput(withoutTrailingBlanks(body.split("\n")), width, {
    projection: opts.projection ?? "compact", compactRows: 3, revealOneExtraWithoutMarker: true,
    ...(opts.expandHint === undefined ? {} : { expandHint: opts.expandHint }),
  });

/** The banded species — `T3t` (bash input), `IWp` (fork boilerplate) — put `backgroundColor` on their Box,
 *  not on their Texts, so the band stretches the full column the same way `Mqo`'s does; Task 8 already
 *  settled that reading and `userEchoLines` already pads to `width - 1` for upstream's `paddingRight: 1`.
 *  This is a SEPARATE, much smaller builder rather than a generalisation of `userEchoLines` because those
 *  components genuinely are separate upstream: no 10 000-char fold, no `(N lines hidden)` rule, no pointer. */
function bandLines(lead: string, leadColor: string, body: string, bodyColor: string, band: string, width: number): RenderLine[] {
  const inner = Math.max(stringWidth(lead) + 1, Math.floor(width) - 1);
  const content = Math.max(1, inner - stringWidth(lead));
  const rows = body.split("\n").flatMap((line) => wrapAnsi(line, content, { trim: false, hard: true }).split("\n"));
  const blank = " ".repeat(stringWidth(lead));
  return rows.map((row, i) => {
    const head = i === 0 ? lead : blank;
    const tail = row + " ".repeat(Math.max(0, inner - stringWidth(head) - stringWidth(row)));
    return { text: head + tail, bg: band, segments: [{ text: head, color: i === 0 ? leadColor : bodyColor, bg: band }, { text: tail, color: bodyColor, bg: band }] };
  });
}

/** `Za` (L41484): the assistant/system bullet, `⏺` on macOS and `●` everywhere else, plus the column its
 *  `minWidth: 2` box pads to. Every bulleted row in this module goes through it. */
const bulletGlyph = (platform?: NodeJS.Platform): string => ((platform ?? process.platform) === "darwin" ? "⏺ " : "● ");
/** `ojp` (L425550): the status word a task notification carries picks the bullet's theme token. */
const notificationToken = (status: string | null): "success" | "error" | "warning" | "text" =>
  status === "completed" ? "success" : status === "failed" ? "error" : status === "killed" ? "warning" : "text";

/** `Dqo` (L426197–426204): both update shapes, in the order upstream scans them (every resource first, then
 *  every polling entry) — so a text carrying both lists resources above polls regardless of source order. */
interface McpUpdate { kind: "resource" | "polling"; server: string; target: string; reason?: string }
function mcpUpdates(text: string): McpUpdate[] {
  const out: McpUpdate[] = [];
  const resource = /<mcp-resource-update\s+server="([^"]+)"\s+uri="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g;
  for (let m = resource.exec(text); m !== null; m = resource.exec(text)) out.push({ kind: "resource", server: m[1] ?? "", target: m[2] ?? "", reason: m[3] });
  const polling = /<mcp-polling-update\s+type="([^"]+)"\s+server="([^"]+)"\s+tool="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g;
  for (let m = polling.exec(text); m !== null; m = polling.exec(text)) out.push({ kind: "polling", server: m[2] ?? "", target: m[3] ?? "", reason: m[4] });
  return out;
}
/** `lWp` (L426206–426214): a `file://` URI collapses to its basename, anything else over 40 chars is cut to
 *  39 plus an ellipsis. Applied to RESOURCE targets only — a polling target is a tool name already. */
function mcpTarget(uri: string): string {
  if (uri.startsWith("file://")) { const path = uri.slice(7), parts = path.split("/"); return parts[parts.length - 1] || path; }
  return uri.length > 40 ? uri.slice(0, 39) + "…" : uri;
}

/** One species → its lines, or `null` for the routes that deliberately paint nothing (`ERe` returns `null`
 *  for empty/tick/caveat; F3 returns nothing for the TOOL-form interrupt because the tool row it belongs to
 *  already says `Interrupted · What should Claude do instead?` and a second line would say it twice).
 *
 *  Every theme token is resolved PER CALL, never captured at module scope, so a /theme switch — the picker's
 *  live preview included — repaints on the very next render. */
export function speciesLines(kind: SpeciesKind, text: string, opts: SpeciesOptions = {}): RenderLine[] | null {
  const width = Math.floor(opts.width ?? 80), tokens = themeTokens();
  const color = (name: keyof typeof tokens) => resolveThemeColor(tokens[name] as string);
  switch (kind) {
    case "empty": case "tick": case "caveat": case "interrupt-tool":
      return null;
    // `BP` (L422234) → `<Cr height={1}>` + `zWo`'s two dim spans. F3 suppressed BOTH interrupt forms because
    // the tool row carried the text; the PLAIN form has no tool row behind it (`query.interrupt()` between
    // turns, or during pure text generation), so before this task it vanished with no surface anywhere.
    case "interrupt-plain":
      return [gutterLine(TOOL_RESULT_GUTTER, INTERRUPTED_TEXT, { dim: true })];
    // `fqo` (L425646): the SAME band, pointer and colours as `Mqo`, which is `userEchoLines` — so the echo
    // goes through the one prompt renderer rather than a second hand-rolled `❯ `.
    case "command-echo": {
      const name = tagInner(text, TAG_COMMAND_MESSAGE) ?? tagInner(text, TAG_COMMAND_NAME)?.replace(/^\//, "") ?? null;
      if (!name) return null;
      if (tagInner(text, "skill-format") === "true") return userEchoLines(`Skill(${name})`, { width });
      const args = tagInner(text, TAG_COMMAND_ARGS);
      return userEchoLines(`/${[name, args].filter(Boolean).join(" ")}`, { width });
    }
    // `T3t` (L416902): `! ` in `bashBorder` beside the command in `text`, over the bash band.
    case "bash-input": {
      const command = tagInner(text, TAG_BASH_INPUT);
      return command ? bandLines("! ", color("bashBorder"), command, color("text"), color("bashMessageBackgroundColor"), width) : null;
    }
    // `IWp` (L426355): the whole boilerplate block goes, then the `Your directive: ` prefix, leaving only
    // what the parent actually asked the fork to do. Glyph is dim; the directive is not.
    case "fork-boilerplate": {
      const stripped = text.replace(new RegExp(`<${TAG_FORK_BOILERPLATE}>[\\s\\S]*?<\\/${TAG_FORK_BOILERPLATE}>\\n*`), "");
      const body = stripped.startsWith(FORK_DIRECTIVE_PREFIX) ? stripped.slice(FORK_DIRECTIVE_PREFIX.length) : stripped;
      if (!body.trim()) return null;
      const band = color("userMessageBackground");
      const rows = bandLines(`${FORK_GLYPH} `, color("text"), body.trim(), color("text"), band, width);
      // The glyph alone is dim (`<Text aria-label="fork:" dimColor>`), so row 0's lead segment overrides.
      return rows.map((row, i) => (i === 0 && row.segments ? { ...row, segments: [{ ...row.segments[0]!, dim: true }, ...row.segments.slice(1)] as Segment[] } : row));
    }
    // `Aqo` (L425934): here the backgroundColor sits on the TEXTS, not the Box — so the memory band is
    // exactly as wide as its content, unlike every other banded species. Then a `⎿` acknowledgement row.
    case "memory-input": {
      const memory = tagInner(text, TAG_MEMORY_INPUT);
      if (!memory) return null;
      const bg = color("memoryBackgroundColor");
      // Upstream picks the acknowledgement at RANDOM from ["Got it.","Good to know.","Noted."] (`N1`). Our
      // transcript re-renders a retained entry many times over its life, so a random pick would flicker the
      // line on every repaint — the first phrase, deterministically, is the only shape our architecture can
      // wear. A recorded divergence, not a port.
      return [
        { text: `# ${memory} `, segments: [{ text: "#", color: color("remember"), bg }, { text: ` ${memory} `, color: color("text"), bg }] },
        gutterLine(TOOL_RESULT_GUTTER, "Got it.", { dim: true }),
      ];
    }
    // `pqo` (L425614) → `r4e` (L423453): stdout (preferring a `<persisted-output>` body), then stderr in
    // `error`, then — only when both are silent — the `(No output)` note.
    // TASK 10b CLOSES the first of Task 10a's two recorded gaps: each body goes through `p2`/`y_s` — the very
    // `foldToolOutput` a Bash TOOL result already uses, same three rows, same four-row exception, same
    // `… +N lines (ctrl+o to expand)` marker — because this species IS that body wearing a user frame, and
    // rendering it unfolded meant a 4 000-line `!` command painted 4 000 rows into Static. The marker's hint
    // is the THREADED one, so a rebind moves it here exactly as it moves it on a tool row.
    // The marker is dim and carries NO colour, which is why stderr's error colour is applied to the content
    // rows only — same rule `errorBody` follows for a failed tool.
    // STILL RECORDED (unchanged): `r4e` first runs stderr through `w6p`/`C6p` (cleaning + a `cwdResetWarning`
    // row whose presence also blocks `(No output)`) — not ported, cosmetic and bounded.
    case "bash-output": {
      const raw = tagInner(text, TAG_BASH_STDOUT) ?? "";
      const stdout = tagInner(raw, "persisted-output") ?? unescape(raw);
      const stderr = unescape(tagInner(text, TAG_BASH_STDERR) ?? "");
      const out: RenderLine[] = [];
      if (stdout !== "") out.push(...gutterRows(TOOL_RESULT_GUTTER, foldBody(stdout, width, opts)));
      if (stderr.trim() !== "") out.push(...gutterRows(TOOL_RESULT_GUTTER, foldBody(stderr, width, opts).map((l) => (l.dim ? l : { ...l, color: color("error") }))));
      return out.length ? out : [gutterLine(TOOL_RESULT_GUTTER, "(No output)", { dim: true })];
    }
    // `Sqo` (L425757) → `oEn` (L425772): stdout is dropped when it is empty OR the `(no content)`
    // placeholder, stderr only when empty, and a body-less pair renders NOTHING at all (not a note).
    // TASK 10b CLOSES the t10a-review gap: the stdout body is upstream's MARKDOWN (`km`, L421121) and is
    // rendered through the one `renderMarkdown` walker now, so a `/help`-style local command that emits
    // `**bold**` or a fenced block reads as one — not as raw asterisks. STDERR stays PLAIN: `oEn` puts only
    // the stdout body inside `km` and leaves stderr an ordinary error-coloured Text, and running a failure
    // message through a markdown walker would silently eat a `*` a shell actually printed.
    // NO fold on either side, unlike `bash-output` above — `oEn` has no `p2` call at all.
    // `oEn` has two earlier branches this port does not carry — the `session running · …` status-chip form
    // (`wpa`, L425722) and the `◇`/`◆` prefixed form — both belong to slash commands (`/agents`) whose own
    // output shapes are outside this task; they fall through to the plain body here.
    case "command-output": {
      const stdout = (tagInner(text, TAG_LOCAL_STDOUT) ?? "").trim();
      const stderr = (tagInner(text, TAG_LOCAL_STDERR) ?? "").trim();
      const out: RenderLine[] = [];
      if (stdout && stdout !== NO_CONTENT) out.push(...gutterRows(LOCAL_OUTPUT_GUTTER, renderMarkdown(stdout, { width })));
      if (stderr) out.push(...gutterBlock(LOCAL_OUTPUT_GUTTER, stderr.split("\n"), { color: color("error") }));
      return out.length ? out : null;
    }
    // `Rvr` (L425557): the assistant bullet in the STATUS colour, the summary, and a dim ` · duration`
    // clause when `duration_ms` parses to something positive. No summary ⇒ `return null`.
    case "task-notification": {
      const summary = tagInner(text, TAG_SUMMARY);
      if (!summary) return null;
      const gutter: Gutter = { text: bulletGlyph(opts.platform), color: color(notificationToken(tagInner(text, TAG_STATUS))) };
      const ms = Number(tagInner(text, "duration_ms"));
      const clause = Number.isFinite(ms) && ms > 0 ? ` · ${formatDuration(ms)}` : "";
      return [clause
        ? { text: summary + clause, gutter, segments: [{ text: summary }, { text: clause, dim: true }] }
        : { text: summary, gutter }];
    }
    // `fSH` (L426194–426196), pack §9.3 VERBATIM: `↻ <server>: <target> · <reason>` — the glyph in
    // `success`, the server dim, the TARGET in `suggestion` (the census missed that), the reason dim.
    case "mcp-update": {
      const updates = mcpUpdates(text);
      if (updates.length === 0) return null;
      return updates.map((u) => {
        const target = u.kind === "resource" ? mcpTarget(u.target) : u.target;
        const segments: Segment[] = [
          { text: MCP_GLYPH, color: color("success") }, { text: " " },
          { text: `${u.server}:`, dim: true }, { text: " " },
          { text: target, color: color("suggestion") },
        ];
        if (u.reason) segments.push({ text: ` · ${u.reason}`, dim: true });
        return { text: segments.map((s) => s.text).join(""), segments };
      });
    }
    case "prompt":
      return userEchoLines(text, { width });
  }
}

// ══ F4 Task 10b ═════════════════════════════════════════════════════════════════════════════════════════
// Three more "what is this frame really?" decisions, all of them upstream switches that run BEFORE anything
// paints, and all of them reachable on our wire.

// ── The compact boundary — `XWo` shape B (L422282–422305) ──────────────────────────────────────────────
/** P81 caught `system/compact_boundary` live, so the boundary is a real row rather than a guess: `⏺` in the
 *  `text` colour beside a BOLD `Compact summary`, with `$e`'s hint clause nested inside that same bold Text
 *  behind one literal space (`children: ["Compact summary", NAr]`) and carrying its own `dimColor`.
 *
 *  We keep BOTH attributes on the hint segment even though F1 measured that chalk drops bold whenever dim is
 *  also set — because upstream's Ink drops it identically, so mirroring the props reproduces the pixels AND
 *  the source. Setting only `dim` would look the same today and lie about the shape.
 *
 *  SHAPE A (`summarizeMetadata`: bold `Summarized conversation`, the `Summarized N messages up to this
 *  point` body, `Context: “…”`, and a hint whose description is `expand history` rather than `expand`) is
 *  RECORDED UNREACHABLE: P81 read the live frame key-by-key and it carries `compact_metadata` — trigger,
 *  pre/post tokens, preserved-uuid anchors — and no `summarizeMetadata` at all. There is no message count
 *  and no direction on our wire, so shape A has no input.
 *  The TRANSCRIPT-MODE body (`jyt = iRe && <Cr>{summaryText}</Cr>`) is unreachable for the same reason: the
 *  boundary frame carries no summary text, and `getSessionMessages` strips even the `isCompactSummary` flag
 *  off the row that does (P81's TR36 trap) — which is exactly why `replay.ts` keeps its own honest
 *  `context compacted earlier` divider off `rows.ts`'s `compact_summary` shape instead of this form.
 *  `marginTop: 1` is not modelled, consistent with every other `addMargin`/`marginTop` in this clone. */
export const COMPACT_SUMMARY_TITLE = "Compact summary";
export function compactSummaryLines(expandHint: string = EXPAND_HINT_FALLBACK, platform?: NodeJS.Platform): RenderLine[] {
  const segments: Segment[] = [{ text: COMPACT_SUMMARY_TITLE, bold: true }];
  if (expandHint !== "") segments.push({ text: ` ${expandHint}`, bold: true, dim: true });
  return [{
    text: segments.map((s) => s.text).join(""),
    gutter: { text: bulletGlyph(platform), color: resolveThemeColor(themeTokens().text) },
    segments,
  }];
}

// ── `VAr` error sentinels (L422714–422860), constants from L157931 / L104957 / L108575 ─────────────────
// P80 settled the channel: an API failure is NOT a throw and NOT a `result` subtype — the CLI's `hey()`
// error factory (L157566+) wraps every one of these conditions with `_u()` (L373192), which mints an
// ORDINARY assistant text frame stamped `isApiErrorMessage: true`. P80 §C watched that frame arrive with
// `error:"invalid_request"` while the trailing `result` frame said `subtype:"success"` — so the subtype is
// the one field a client must not key on, and the text itself is what upstream switches over.
export const API_ERROR = "API Error";                                            // `kE`
export const PROMPT_TOO_LONG = "Prompt is too long";                             // `XG`
export const CREDIT_BALANCE_LOW = "Credit balance is too low";                   // `PYr`
export const NOT_LOGGED_IN = "Not logged in · Please run /login";           // `lir`
export const INVALID_API_KEY = "Invalid API key · Fix external API key";    // `cir`
export const OAUTH_REVOKED = "OAuth token revoked · Please run /login";     // `uir`
export const DISABLED_ORG_UPDATE = "Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable";              // `Apo`
export const DISABLED_ORG_UNSET = "Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead"; // `Spo`
export const GATEWAY_AUTH_FAILED = "Authentication error · The gateway could not authenticate with its upstream provider — contact your gateway administrator";  // `vpo`
export const REQUEST_TIMED_OUT = "Request timed out";                            // `ect`
export const OPUS_HIGH_LOAD = "Opus is experiencing high load, please use /model to switch to Sonnet";   // `Qlt`
export const FABLE_HIGH_LOAD = "Fable is experiencing high load, please use /model to switch to Sonnet"; // `Zlt`
export const API_ERROR_ABORTED = "API Error: Request was aborted.";              // `wq` (L108575)
export const NO_RESPONSE_REQUESTED = "No response requested.";                   // `die` (L104957)
/** `JG` (L157167) also admits the four cloud-credential prefixes, which reach `lca` exactly as `API Error` does. */
const JG_PREFIXES: readonly string[] = [
  API_ERROR, `Please run /login · ${API_ERROR}`,
  "AWS credentials expired or invalid", "AWS authentication failed",
  "Google Cloud credentials expired or invalid", "Google Cloud authentication failed",
];
/** `c8o = 1000` (L422927) — `lca`'s cap, applied to the TRIMMED text and only when not verbose. */
export const API_ERROR_TRUNCATION = 1000;

/** Word-wrap one body to a width, the same call `userEchoLines` makes (`hard` keeps an unbreakable token in). */
const wrapBody = (text: string, width: number): string[] =>
  text.split("\n").flatMap((line) => wrapAnsi(line, Math.max(1, width), { trim: false, hard: true }).split("\n"));
/** `Sha`'s body box (L428616) and `lca`'s (L422904) are both `columns - 10`. */
const BODY_INSET = 10;
/** One bulleted block: `Za` in `token`, the body wrapped in the same colour beside it, continuation rows
 *  aligned under the TEXT (the body is a sibling column of a `minWidth: 2` box, never under the glyph). */
function bulletBlock(body: string, width: number, token: string | undefined, platform: NodeJS.Platform | undefined, extra?: { dim?: boolean; bold?: boolean; dot?: boolean }): RenderLine[] {
  const style = { ...(token === undefined ? {} : { color: token }), ...(extra?.dim ? { dim: true } : {}), ...(extra?.bold ? { bold: true } : {}) };
  const rows = wrapBody(body, width - BODY_INSET);
  const dot = extra?.dot !== false;
  // TWO columns, not `stringWidth(glyph)`: upstream's gutter is a `minWidth: 2` Box (L428613/422900) and the
  // body is its sibling column, so the continuation indent is the BOX width — the same literal `"  "`
  // `withAssistantBullet` uses. `⏺` measures 2 on its own but the pair `"⏺ "` measures 3, and indenting by
  // that would step every wrapped row one column past the first.
  const glyph = bulletGlyph(platform), pad = "  ";
  return rows.map((text, i) => (i === 0 && dot
    ? { text, ...style, gutter: { text: glyph, ...(token === undefined ? {} : { color: token }) } }
    : { text: (dot ? pad : "") + text, ...style }));
}

/** `undefined` = "this is not a sentinel, render it as an ordinary assistant message"; `[]` = "it IS one and
 *  it deliberately paints nothing" (`dHr`'s empty guard and `case die`). The branch ORDER is upstream's and
 *  is the contract — `dHr` runs before everything, and the two default-path predicates run in their own
 *  order after the switch misses.
 *
 * ── RECORDED UNREACHABLE / UNPORTED (Task 10b) ─────────────────────────────────────────────────────────
 *  · `Dcs` (L156524) → `l8o`. The usage-limit nudge: a predicate over TWENTY-ONE prefixes ("You've hit
 *    your", "You're now using usage credits", …) routing to an INTERACTIVE component that takes an
 *    `onOpenRateLimitOptions` callback and opens the upgrade flow. It has no line form to port, and inventing
 *    one would put a button's text on a transcript row. The predicate is reachable (`hey` mints these through
 *    the same `_u` channel), so the text still arrives — it simply falls through to the ordinary assistant
 *    render, which is the graceful degradation.
 *  · `case lir` → `<aca/>` (L422750). A dedicated login component, same class of surface: our REPL has no
 *    OAuth flow to drive from a transcript row, so `Not logged in · Please run /login` falls through to the
 *    ordinary render, where the sentence still says exactly what to do.
 *  · `J2e("warning")` (L314602), the ` · /model {alias}` clause `XG` and default-predicate-1 append. It reads
 *    `Dl_()`, the 1M-context entitlement record, which nothing on our wire carries — so the clause is always
 *    absent here rather than fabricated. Both call sites already treat it as optional.
 *  · `nm(wT())` in `Qlt`/`Zlt` (L422800/422813): the resolved display name of the configured Sonnet model
 *    (`wT`, L71385, reads `ANTHROPIC_DEFAULT_SONNET_MODEL` or the family default). We render the family word
 *    `Sonnet` — which is what the sentinel text itself names — rather than resolving a model id the renderer
 *    has no honest source for. A recorded degradation, one word wide. */
export function errorSentinelLines(text: string, opts: SpeciesOptions = {}): RenderLine[] | undefined {
  const width = Math.floor(opts.width ?? 80), tokens = themeTokens();
  const color = (name: keyof typeof tokens) => resolveThemeColor(tokens[name] as string);
  const errorRow = (body: string): RenderLine[] => [gutterLine(TOOL_RESULT_GUTTER, body, { color: color("error") })];
  // `dHr` (L374375) — the guard before the switch. Whitespace-only or the `(no content)` placeholder.
  if (typeof text !== "string" || text.trim() === "" || text.trim() === NO_CONTENT) return [];
  switch (text) {
    case NO_RESPONSE_REQUESTED: return [];
    // `Z.DISABLE_COMPACT` picks which escape hatch the row advertises; the warning clause is recorded above.
    case PROMPT_TOO_LONG:
      return errorRow(`Context limit reached · ${process.env.DISABLE_COMPACT ? "/clear to continue" : "/compact or /clear to continue"}`);
    case CREDIT_BALANCE_LOW:
      return errorRow("Credit balance too low · Add funds: https://platform.claude.com/settings/billing");
    // The three sentinels that echo THEMSELVES. `Apo`/`Spo`/`vpo` share one branch upstream and differ from
    // `cir`/`uir` only in carrying no `height: 1` — a distinction our line substrate has no place for.
    case INVALID_API_KEY: case OAUTH_REVOKED:
    case DISABLED_ORG_UPDATE: case DISABLED_ORG_UNSET: case GATEWAY_AUTH_FAILED:
      return errorRow(text);
    case REQUEST_TIMED_OUT: {
      const ms = process.env.API_TIMEOUT_MS;
      return errorRow(ms ? `${REQUEST_TIMED_OUT} (API_TIMEOUT_MS=${ms}ms, try increasing it)` : REQUEST_TIMED_OUT);
    }
    // `gap: 1` on the column is a real blank row between the two sentences, not styling.
    case OPUS_HIGH_LOAD: case FABLE_HIGH_LOAD: {
      const family = text === OPUS_HIGH_LOAD ? "Opus 4." : "Fable 5.";
      return [
        gutterLine(TOOL_RESULT_GUTTER, `We are experiencing high demand for ${family}`, { color: color("error") }),
        { text: "" },
        { text: "To continue immediately, use /model to switch to Sonnet and continue coding." },
      ];
    }
    // `<BP/>` — the SAME row `ERe` exit 9 paints for a plain interrupt. An aborted request is an interruption.
    case API_ERROR_ABORTED:
      return [gutterLine(TOOL_RESULT_GUTTER, INTERRUPTED_TEXT, { dim: true })];
  }
  // default, predicate 1 — the shape P80 §C proved live: `Prompt is too long · the request is ~N tokens …`.
  if (text.startsWith(`${PROMPT_TOO_LONG} · `)) return errorRow(`${text} · /clear to start fresh`);
  // default, predicate 2 — `JG` → `lca` (L422868): a WARNING bullet (not the error `⎿` row), the body at
  // `columns - 10`, the bare-`API Error` rewrite, the 1 000-character cap, and — only when that cap actually
  // fired — the expand offer, which is `<Bg/>`, the very component every other hint on screen is.
  if (JG_PREFIXES.some((p) => text.startsWith(p))) {
    const rewritten = (text === API_ERROR ? `${API_ERROR}: Please wait a moment and try again.` : text).trim();
    const truncated = opts.verbose !== true && rewritten.length > API_ERROR_TRUNCATION;
    const shown = truncated ? rewritten.slice(0, API_ERROR_TRUNCATION) + "…" : rewritten;
    const rows = bulletBlock(shown, width, color("warning"), opts.platform);
    const hint = opts.expandHint ?? EXPAND_HINT_FALLBACK;
    if (!truncated || hint === "") return rows;
    return [...rows, { text: `  ${hint}`, dim: true }];       // `<Bg/>` is a sibling of the body INSIDE the column
  }
  return undefined;
}

// ── `dVo` system subtypes (L428358–428518) → `Sha` (L428608) ───────────────────────────────────────────
/** Upstream's per-subtype switch, restricted to the subtypes THIS wire delivers. `null` = paints nothing.
 *
 *  The generic exit is the load-bearing one: `dVo` reads `message.content`, and `typeof content !== "string"`
 *  is an unconditional `return null` (L428510). Every structured SDK system frame — `memory_recall`
 *  (mode + memories[]), `notification` (`text`, not `content`), `api_retry`, `mirror_error`,
 *  `permission_denied`, `plugin_install`, `worker_shutting_down`, `files_persisted`, the `hook_*` trio,
 *  `session_state_changed`, `task_*`, `status`, `init`, `compact_boundary` — falls out there by
 *  construction. That is fidelity, not an omission: upstream renders none of them through this component
 *  either, and the ones we DO surface (task frames, the compact boundary) have their own routes.
 *
 * ── RECORDED UNREACHABLE (Task 10b) ────────────────────────────────────────────────────────────────────
 *  Nine of `dVo`'s branches key on subtypes absent from `sdk.d.ts`'s system union entirely, so no renderer
 *  is built for them: `turn_duration`, `memory_saved`, `away_summary`, `agents_killed`, `model_fallback`,
 *  `bridge_status`, `scheduled_task_fire`, `permission_retry`, `stop_hook_summary`. They are CLI-internal UI
 *  message kinds, not wire frames. `api_error` is in the same class but IS ported, as a `null`, because the
 *  pack (§9.6 correction 1) exists specifically to correct the census's claim that it has a dedicated
 *  branch — porting the correction is cheaper than re-litigating it later.
 *  `local_command_output` is the reverse case: it is on the wire and has NO `dVo` branch, so it takes the
 *  generic row, which is precisely what its sdk.d.ts doc ("Displayed as assistant-style text") describes. */
const SILENT_SUBTYPES: ReadonlySet<string> = new Set(["thinking", "model_refusal_no_fallback", "api_error"]);
/** `lq()` (L77579) = `!CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK && !YCe()`. The env half is portable and ported;
 *  `YCe()` is an internal gate with no wire signal, so it reads as false here. */
const refusalFallbackEnabled = (): boolean => !process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK;
/** `dW` at L428415: a hand-rolled FIVE-column gutter, `"  ⎿  "` — two ordinary spaces where `Cr` puts a
 *  space and an NBSP. Same width as `TOOL_RESULT_GUTTER`, different bytes, and upstream really does spell
 *  the two differently; it shares its bytes with `LOCAL_OUTPUT_GUTTER` by coincidence, not by construction. */
const REFUSAL_TIP = "  ⎿  Tip: You can configure model switch behavior in /config";

export function systemNoticeLines(frame: Record<string, unknown>, opts: SpeciesOptions = {}): RenderLine[] | null {
  const subtype = typeof frame.subtype === "string" ? frame.subtype : "";
  const level = typeof frame.level === "string" ? frame.level : undefined;
  const width = Math.floor(opts.width ?? 80), tokens = themeTokens();
  const color = (name: keyof typeof tokens) => resolveThemeColor(tokens[name] as string);
  if (subtype === "thinking" || subtype === "model_refusal_no_fallback") return null;
  // `lq() && subtype === "model_refusal_fallback"` (L428402): a warning bullet, the content BOLD in warning,
  // then the dim tip. Note the gate is on the branch, not on the subtype — a disabled fallback falls THROUGH
  // to the generic row below, which is why the check sits here rather than in the silent set.
  if (subtype === "model_refusal_fallback" && refusalFallbackEnabled()) {
    const content = typeof frame.content === "string" ? frame.content : "";
    if (content === "") return null;
    return [...bulletBlock(content, width, color("warning"), opts.platform, { bold: true }), { text: REFUSAL_TIP, dim: true }];
  }
  // Pack §9.6 correction 2 (L428497): the BLANKET info gate. It sits after the nine subtype branches (so it
  // cannot silence them) and before everything below, `stop_hook_summary` alone excepted.
  if (subtype !== "stop_hook_summary" && opts.verbose !== true && level === "info") return null;
  if (SILENT_SUBTYPES.has(subtype)) return null;
  const content = frame.content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (trimmed === "") return null;
  // `Sha`'s level→presentation table (§9.5) verbatim: `info` alone loses the dot and gains `dimColor`;
  // `warning`/`notice` name a token; anything else (including `suggestion`) keeps the dot and no colour.
  const token = level === "warning" ? color("warning") : level === "notice" ? color("inactive") : undefined;
  return bulletBlock(trimmed, width, token, opts.platform, { dim: level === "info", dot: level !== "info" });
}
