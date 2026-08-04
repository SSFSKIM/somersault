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
import { userEchoLines, type Gutter, type RenderLine, type Segment } from "./render.js";
import { formatDuration } from "./format.js";
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
  /** Only `task-notification` reads it — `Za` (L41482) is `⏺` on macOS and `●` elsewhere, the same
   *  per-platform glyph `withAssistantBullet` paints. An extension to the brief's `{ width }` bag; the
   *  alternative was baking `process.platform` into a pure renderer, which Task 8 already rejected. */
  platform?: NodeJS.Platform;
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
    // `error`, then — only when both are silent — the `(No output)` note. Upstream folds each body through
    // `p2`/`y_s`; we do not, because `speciesLines` has no projection/verbose input in this task's contract.
    case "bash-output": {
      const raw = tagInner(text, TAG_BASH_STDOUT) ?? "";
      const stdout = tagInner(raw, "persisted-output") ?? unescape(raw);
      const stderr = unescape(tagInner(text, TAG_BASH_STDERR) ?? "");
      const out: RenderLine[] = [];
      if (stdout !== "") out.push(...gutterBlock(TOOL_RESULT_GUTTER, stdout.split("\n")));
      if (stderr.trim() !== "") out.push(...gutterBlock(TOOL_RESULT_GUTTER, stderr.split("\n"), { color: color("error") }));
      return out.length ? out : [gutterLine(TOOL_RESULT_GUTTER, "(No output)", { dim: true })];
    }
    // `Sqo` (L425757) → `oEn` (L425772): stdout is dropped when it is empty OR the `(no content)`
    // placeholder, stderr only when empty, and a body-less pair renders NOTHING at all (not a note).
    // `oEn` has two earlier branches this port does not carry — the `session running · …` status-chip form
    // (`wpa`, L425722) and the `◇`/`◆` prefixed form — both belong to slash commands (`/agents`) whose own
    // output shapes are outside this task; they fall through to the plain body here.
    case "command-output": {
      const stdout = (tagInner(text, TAG_LOCAL_STDOUT) ?? "").trim();
      const stderr = (tagInner(text, TAG_LOCAL_STDERR) ?? "").trim();
      const out: RenderLine[] = [];
      if (stdout && stdout !== NO_CONTENT) out.push(...gutterBlock(LOCAL_OUTPUT_GUTTER, stdout.split("\n")));
      if (stderr) out.push(...gutterBlock(LOCAL_OUTPUT_GUTTER, stderr.split("\n"), { color: color("error") }));
      return out.length ? out : null;
    }
    // `Rvr` (L425557): the assistant bullet in the STATUS colour, the summary, and a dim ` · duration`
    // clause when `duration_ms` parses to something positive. No summary ⇒ `return null`.
    case "task-notification": {
      const summary = tagInner(text, TAG_SUMMARY);
      if (!summary) return null;
      const gutter: Gutter = { text: (opts.platform ?? process.platform) === "darwin" ? "⏺ " : "● ", color: color(notificationToken(tagInner(text, TAG_STATUS))) };
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
