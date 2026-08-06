// tui/dialogs/smallDialogOptions.ts — the pure half of the FOUR dialogs that complete the F6 kind registry:
// WebFetch, Skill, Monitor and the generic fallback. Bash and the file family each earned a module of their
// own because each carries a real body (a command parse, a diff pipeline); these four carry a body of one or
// two lines apiece, and their whole substance is the option list plus what each row means. One module keeps
// them comparable and keeps every component under 120 lines.
//
// Transcribed from 2.1.220:
//   · WebFetch  `ull` L506735-816 · `Wtm` L506721-730 (outcomes) · `qtm` L506731-734 (the row gate) ·
//                `fid` L228310-318 (the hostname)
//   · Skill     `oll` L506582-710 · `Dtm` L506560-573 · `Ptm`/`Otm` L506574-581 · `_id` L228357
//   · Monitor   `Ral` L506006-093 · `ntm` L505982-993 · `otm` L505994-997 · `itm` L505998-8005 ·
//                `hid` L228324 (the payload) · `jrn` L228116 (the subprotocol list)
//   · generic   `Gal` L506118-260 · `gtm` L506108-116 · `TDn` L506114-117
//
// FOUR THINGS ABOUT THE UPSTREAM LISTS ARE LOAD-BEARING:
//   · every "don't ask again" row upstream is gated on `showAlwaysAllow` (`Ej` L228287), which is a mix of
//     managed policy, an org cap and a per-tool suppression flag — none of it reachable from a headless
//     broker. What survives per dialog is the SECOND half of each gate, which is real data: WebFetch needs a
//     hostname, Skill needs a name (and a space, for the prefix arm), Monitor needs suggestions;
//   · Skill's two arms COEXIST — `Ptm` and `Otm` are independent tests and `oll` pushes both (L506612/L506625),
//     so a two-word skill offers three yes-rows. That is not the Bash dialog's mutually-exclusive shape;
//   · Monitor is the ONLY one of the four that cannot type a rule of its own, so it is the only one whose
//     row echoes `suggestions` verbatim. That is the whole live surface of the suggestion-first policy here:
//     where a dialog CAN type its rule (a domain, a skill, a whole tool) the typed rule is what upstream
//     sends and what we send, and where it cannot type one and has no suggestions there is simply no row;
//   · `itm` counts RULES, not suggestions, while `otm` gates on SUGGESTIONS — so an engine that suggests only
//     a directory grant renders "Yes, and add 0 suggested permission rules". Upstream's, reproduced.
//
// Recorded, NOT built: the labels' BOLD segments (`SelectOption.label` is a string — bashOptions.ts's reason);
// the generic dialog's auto-mode row (`UDr` L506124, a claude.ai entitlement); the `feedbackConfig:{type:
// "accept"}` upstream hangs on every Yes row, because the SDK's allow arm has no message field (T3).

import type { SelectOption } from "../select/Select.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";
import { noRow, yesRow, type FeedbackMode } from "./optionRows.js";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Every rule these four dialogs write goes to `localSettings` — `<cwd>/.claude/settings.local.json`, the
 *  destination that survives a relaunch (`Wtm`/`Dtm`/`gtm` all name it). */
const LOCAL_SETTINGS = "localSettings";
const allowRule = (rule: Record<string, unknown>): PermissionDecision =>
  ({ kind: "allow_with_updates", updatedPermissions: [{ type: "addRules", rules: [rule], behavior: "allow", destination: LOCAL_SETTINGS }] });

/** The one shared deny arm: `{...r && {feedback: r}}` in `Dtm`/`ntm`/`gtm`. Whitespace alone is not feedback. */
const deny = (text: string | undefined): PermissionDecision => {
  const feedback = (text ?? "").trim();
  return feedback ? { kind: "deny", feedback } : { kind: "deny" };
};

/** `Ktt` L15260 — a line clip, not a character one: keep the first `limit` lines and mark the loss with a
 *  single ellipsis glued to the last kept line. Under the limit the text is returned untouched. */
export function clipLines(text: string, limit: number): string {
  const lines = text.split("\n");
  return lines.length <= limit ? text : `${lines.slice(0, limit).join("\n")}…`;
}

/** `ma` L15098 — a UTF-16 CODE UNIT clip with a lone-surrogate guard, which is what `jrn` truncates with.
 *  Deliberately not `truncateLabel`: that one measures display width and appends its own ellipsis. */
function clipUnits(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit), last = head.charCodeAt(limit - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/** `Ej`'s `renderedToolUseMessage` (L228287) is `tool.renderToolUseMessage(input)` — a per-tool renderer that
 *  lives INSIDE the engine and never crosses the headless wire (the SDK forwards `toolName` + `input` and
 *  nothing else). The pre-F6 generic body reconstructed it from the first argument and that reconstruction
 *  carries over here unchanged, minus the `$ ` Bash prefix: no Bash consult reaches these four dialogs. */
export const TOOL_USE_CLIP = 140;
export function renderedToolUse(input: Record<string, unknown>): string {
  const first = Object.values(input ?? {})[0];
  const text = first === undefined ? "" : str(first) ?? JSON.stringify(first) ?? "";
  return text.length > TOOL_USE_CLIP ? `${text.slice(0, TOOL_USE_CLIP - 1)}…` : text;
}

// ── WebFetch ─────────────────────────────────────────────────────────────────────────────────────────

/** `fid` L228310-318. A URL that will not parse — or an input carrying no string `url` at all — yields the
 *  EMPTY STRING, which is `qtm`'s own signal to drop the domain row entirely. */
export function fetchHostname(input: Record<string, unknown>): string {
  const url = str(input.url);
  if (url === undefined) return "";
  try { return new URL(url).hostname; } catch { return ""; }
}

/** What the BODY prints. It has to be the same field `fetchHostname` reads, and `renderedToolUse`'s
 *  first-argument guess is not: WebFetch's input is `{url, prompt}` and nothing pins the key order the engine
 *  sends, so a `{prompt, url}` payload would print the prompt above a domain row naming the host — a dialog
 *  disagreeing with itself about what is being approved. The generic fallback stays for an input that somehow
 *  carries no string `url`, since the body must still render something. */
export function fetchUrl(input: Record<string, unknown>): string {
  return str(input.url) ?? renderedToolUse(input);
}

/** L506752-771. The No row is a PLAIN label that names `(esc)` in its own text — upstream hangs no
 *  `feedbackConfig` on it (unlike Skill/Monitor/generic), so it can never become a text row and this dialog
 *  has no Tab-to-feedback affordance at all. The `(esc)` in the label is the footer the others get.
 *
 *  ONE DELIBERATE DIVERGENCE FROM THE LABEL (wave T t8, spec W-T18 / A15): upstream reads `No, and tell
 *  Claude what to do differently (esc)` (L506767-770), and that clause is undeliverable in BOTH harnesses —
 *  no `feedbackConfig` on the row, no feedback arm in `Wtm` (L506721-730), so the row can only ever send a
 *  bare deny. Transcribing it faithfully transcribed a promise the dialog breaks, which is the one class of
 *  fidelity this wave trades away. The `(esc)` STAYS, and no `ConsultFooter` is mounted here: this body is
 *  footerless by transcription, so the label is the only place its escape hint can live. */
export function fetchOptions({ hostname }: { hostname: string }): SelectOption[] {
  const options: SelectOption[] = [yesRow(false)];
  if (hostname !== "") options.push({ label: `Yes, and don't ask again for ${hostname}`, value: "yes-dont-ask-again-domain" });
  options.push({ label: "No (esc)", value: "no" });
  return options;
}

/** `Wtm` L506721-730. `toolName` rides through from the payload exactly as upstream's `t.toolName` does,
 *  rather than being hard-coded to "WebFetch": the rule has to name the tool the engine will match against. */
export function fetchDecision(value: string, ctx: { toolName: string; hostname: string }): PermissionDecision {
  if (value === "yes-dont-ask-again-domain") return allowRule({ toolName: ctx.toolName, ruleContent: `domain:${ctx.hostname}` });
  if (value === "no") return { kind: "deny" };
  return { kind: "allow_once" };
}

// ── Skill ────────────────────────────────────────────────────────────────────────────────────────────

/** `Dh` L159451. */
const SKILL = "Skill";

/** `_id` L228357, reachable half only. Upstream falls back to `permissionResult.metadata.command.name` when
 *  the input carries no `skill`; `metadata` is engine-internal and never crosses the wire, so the input is
 *  our only source and an absent one leaves the name empty — which suppresses both don't-ask-again rows. */
export function skillOf(input: Record<string, unknown>): string {
  return str(input.skill) ?? "";
}

/** `Otm` L506578-581 + `Dtm`'s own `substring` (L506567). The gate is `indexOf(" ") > 0`, not `>= 0`: a name
 *  that STARTS with a space has no first word to prefix on. */
export function skillPrefix(skill: string): string | undefined {
  const space = skill.indexOf(" ");
  return space > 0 ? skill.slice(0, space) : undefined;
}

export function skillOptions({ skill, cwd, feedback }: { skill: string; cwd: string; feedback?: FeedbackMode }): SelectOption[] {
  const options: SelectOption[] = [yesRow(false)];
  if (skill !== "") options.push({ label: `Yes, and don't ask again for ${skill} in ${cwd}`, value: "yes-exact" });
  const prefix = skillPrefix(skill);
  if (prefix !== undefined) options.push({ label: `Yes, and don't ask again for ${prefix}:* commands in ${cwd}`, value: "yes-prefix" });
  options.push(noRow(feedback?.no ?? false));
  return options;
}

/** `Dtm` L506560-573. */
export function skillDecision(value: string, ctx: { skill: string; text?: string }): PermissionDecision {
  if (value === "yes-exact") return allowRule({ toolName: SKILL, ruleContent: ctx.skill });
  if (value === "yes-prefix") return allowRule({ toolName: SKILL, ruleContent: `${skillPrefix(ctx.skill) ?? ctx.skill}:*` });
  if (value === "no") return deny(ctx.text);
  return { kind: "allow_once" };
}

// ── Monitor ──────────────────────────────────────────────────────────────────────────────────────────

export interface MonitorPayload {
  command?: string;
  /** Present only when BOTH halves are strings (`hid`: `n !== void 0 && o !== void 0`). */
  mcp?: { server: string; tool: string };
  ws?: { url: string; protocols?: string[] };
  /** `hid`'s default is 30000 — the body divides it by 1000 and prints seconds. */
  intervalMs: number;
  description?: string;
}

/** `hid` L228324-327 over `LCs` L228328-333, `xCs` L228107-115 and `FMy` L228334-340. Upstream additionally
 *  runs every string through `H_` (L228091), which replaces unprintable code points with U+FFFD before they
 *  reach the terminal; our `Line`/`Text` path already refuses to paint control characters, so the scrub is
 *  recorded rather than re-implemented. */
export function monitorPayload(input: Record<string, unknown>): MonitorPayload {
  const payload: MonitorPayload = { intervalMs: typeof input.interval_ms === "number" ? input.interval_ms : 30000 };
  const command = str(input.command);
  if (command !== undefined) payload.command = command;
  const mcp = isRecord(input.mcp) ? input.mcp : undefined;
  const server = mcp && str(mcp.server), tool = mcp && str(mcp.tool);
  if (server !== undefined && tool !== undefined) payload.mcp = { server, tool };
  const ws = isRecord(input.ws) ? input.ws : undefined;
  const url = ws && str(ws.url);
  if (url !== undefined) {
    const protocols = asArray(ws?.protocols).filter((p): p is string => typeof p === "string");
    payload.ws = { url: hrefOf(url), ...(protocols.length > 0 ? { protocols } : {}) };
  }
  const description = str(input.description);
  if (description !== undefined) payload.description = description;
  return payload;
}

/** `FMy` L228334-340 — normalise through `URL.href`, or keep the raw string when it will not parse. */
const hrefOf = (url: string): string => { try { return new URL(url).href; } catch { return url; } };

/** `jrn` L228116-120: the first four, each clipped at 48 code units, each quoted, with the remainder counted. */
const SUBPROTOCOL_SHOWN = 4, SUBPROTOCOL_WIDTH = 48;
export function subprotocolList(protocols: readonly string[]): string {
  const shown = protocols.slice(0, SUBPROTOCOL_SHOWN).map((p) => (p.length > SUBPROTOCOL_WIDTH ? `${clipUnits(p, SUBPROTOCOL_WIDTH)}…` : p));
  const rest = protocols.length - shown.length;
  return `${shown.map((p) => `"${p}"`).join(", ")}${rest > 0 ? ` (+${rest} more)` : ""}`;
}

/** `itm` L505998-8005. The rule count and the suggestion count are DIFFERENT numbers and upstream uses each
 *  in a different place — this label counts rules, while `otm` (below) gates on suggestions. */
export function suggestionRowLabel(suggestions: readonly PermissionUpdateLike[]): string {
  const rules = suggestions.filter((u) => u.type === "addRules").flatMap((u) => asArray(u.rules)).filter(isRecord);
  const only = rules.length === 1 ? rules[0]! : undefined;
  const content = only && str(only.ruleContent);
  return content ? `Yes, and don't ask again for ${str(only!.toolName) ?? ""}(${content})` : `Yes, and add ${rules.length} suggested permission rules`;
}

/** L506035-052 over `otm` L505994-997. */
export function monitorOptions({ suggestions = [], feedback }: { suggestions?: readonly PermissionUpdateLike[]; feedback?: FeedbackMode }): SelectOption[] {
  const options: SelectOption[] = [yesRow(false)];
  if (suggestions.length > 0) options.push({ label: suggestionRowLabel(suggestions), value: "yes-apply-suggestions" });
  options.push(noRow(feedback?.no ?? false));
  return options;
}

/** `ntm` L505982-993 — the suggestion payload is echoed object-for-object, never reconstructed. */
export function monitorDecision(value: string, ctx: { text?: string; suggestions?: readonly PermissionUpdateLike[] } = {}): PermissionDecision {
  if (value === "yes-apply-suggestions") return { kind: "allow_with_updates", updatedPermissions: [...(ctx.suggestions ?? [])] };
  if (value === "no") return deny(ctx.text);
  return { kind: "allow_once" };
}

// ── the generic fallback ─────────────────────────────────────────────────────────────────────────────

/** `Ej` L228287 decides this by asking the TOOL for its display name and testing `endsWith(" (MCP)")` — a
 *  registry lookup no client can make. Our reachable substitute is the wire name's `mcp__` prefix, which the
 *  SDK stamps on every MCP tool (toolFold.ts already routes on it). A DIVERGENCE, recorded in T15: a native
 *  tool could in principle carry the suffix without the prefix, and would render without the marker here.
 *  Upstream also STRIPS the suffix off the displayed name; we have no display name to strip, so the wire
 *  name is what the body prints. */
export function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

/** L506150-176. `userFacingName` is what the LABEL names; `gtm`'s rule names the raw `toolName` — upstream
 *  keeps the two apart and so do we (they are the same string headlessly, but the roles are not). */
export function genericOptions({ userFacingName, cwd, feedback }: { userFacingName: string; cwd: string; feedback?: FeedbackMode }): SelectOption[] {
  return [
    yesRow(false),
    // CANON PIN, wave T t8 (spec W-T16). A trust review filed this row as a defect — "it says commands in this
    // directory, then grants the whole tool everywhere, forever" — and BOTH halves are wrong. The copy is
    // upstream verbatim (L506166); the content-less whole-tool rule `genericDecision` writes is upstream
    // verbatim too (L506109, and see its own comment below); and the grant is not "everywhere" — it goes to
    // `localSettings`, i.e. `<cwd>/.claude/settings.local.json` (LOCAL_SETTINGS, `:43-45`), which IS the
    // directory the label names. Nothing to narrow, nothing to re-word: this is a transcription, and the
    // exact-string assertion in `test/tui/small-dialog-options.test.ts` pins it so it is not "fixed" later.
    { label: `Yes, and don't ask again for ${userFacingName} commands in ${cwd}`, value: "yes-dont-ask-again" },
    noRow(feedback?.no ?? false),
  ];
}

/** `gtm` L506108-116. The rule carries NO `ruleContent`: this is a whole-tool grant, the only one of the four. */
export function genericDecision(value: string, ctx: { toolName: string; text?: string }): PermissionDecision {
  if (value === "yes-dont-ask-again") return allowRule({ toolName: ctx.toolName });
  if (value === "no") return deny(ctx.text);
  return { kind: "allow_once" };
}
