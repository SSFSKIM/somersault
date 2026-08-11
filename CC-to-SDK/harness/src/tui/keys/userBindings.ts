// tui/keys/userBindings.ts — the USER layer of the keymap (F2 task 9): `~/.claude/keybindings.json` read,
// validated and watched. No React, no Ink; every fs call goes through an injected dep so a test never reads the
// developer's real home (and so the watcher can be driven synchronously).
//
// The path is UPSTREAM'S OWN — a user who already customized Claude Code gets those bindings in ccx for free —
// and so is the file shape: `{ bindings: [ { context, bindings } ] }`, merged as `[...defaults, ...user]` with
// later-wins WITHIN a context (resolver.ts). User bindings are therefore purely ADDITIVE: to move a binding you
// unbind the old key with `null` and bind the new one.
//
// Two rules the validator is written under:
//  1. A user file must never take the REPL down, and never cost more than it has to. Every rule below drops
//     exactly the offending ENTRY (or, for a broken context/block header, that block) and records a typed issue;
//     only unparseable JSON costs the whole file. The defaults keep running either way.
//  2. Keys are compared CANONICALLY (normalize.ts), never as raw text — `ctrl+-` and `ctrl+_` are the same byte,
//     so a duplicate written in two spellings has to collide here, and the layers we emit are keyed canonically.
//
// Key NAMES are deliberately not whitelisted: an unknown name may simply be a key this terminal sends and we
// have not met yet. A name that looks like a typo, and a modifier spelled in caps, are therefore WARNINGS
// (`suspicious_key`) that keep the binding live — the only issue type that never drops anything.
import { readFileSync, unwatchFile as realUnwatchFile, watchFile as realWatchFile } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RESERVED_KEYS, VALID_ACTIONS, VALID_CONTEXTS, type ContextBindings } from "./bindings.js";
import { parseChordSpec, specKey } from "./normalize.js";
import type { KeyContextName } from "./types.js";

export interface BindingIssue {
  /** `suspicious_key` is ours (task 2 carry-forward): a warning that KEEPS the binding. The other five are
   *  upstream's own validation vocabulary, and all of them drop what they name. */
  type: "parse_error" | "invalid_context" | "invalid_action" | "duplicate" | "reserved" | "suspicious_key";
  detail: string;
}
export interface UserBindingsResult { layers: ContextBindings[]; issues: BindingIssue[] }
export interface LoadDeps { readFile?: (path: string, encoding: "utf8") => string }
/** The two `fs.watchFile` stat fields we compare. Node's `Stats` satisfies it; a test can hand over a literal. */
interface StatLike { mtimeMs: number; size: number }
export interface WatchDeps extends LoadDeps {
  watchFile?: (file: string, options: { interval: number }, listener: (curr: StatLike, prev: StatLike) => void) => unknown;
  unwatchFile?: (file: string, listener: (curr: StatLike, prev: StatLike) => void) => void;
  interval?: number;
}

/** Poll interval. Deviation from upstream, recorded: they watch with chokidar + a 500 ms stability threshold;
 *  we poll `fs.watchFile` at the same 500 ms rather than add a dependency. Same observable latency. */
const WATCH_MS = 500;
/** Upstream's own second action form: run a slash command as if typed. Chat-only (validated below). */
const COMMAND_RE = /^command:[a-zA-Z0-9:\-_]+$/;
const CONTEXTS = new Set<string>(VALID_CONTEXTS);
const ACTIONS = new Set<string>(VALID_ACTIONS);
/** Every multi-character name our parser can emit (parse.ts), plus `capslock`, which it cannot — the reserved
 *  registry names it, so a user may too. Only used to WARN; see the header note on whitelisting. */
const KNOWN_NAMES = new Set(["space", "tab", "enter", "escape", "backspace", "delete", "insert", "home", "end",
  "pageup", "pagedown", "up", "down", "left", "right", "capslock"]);
const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Upstream's own file, so an existing Claude Code keymap applies to ccx unchanged. `home` is injectable for the
 *  same reason `settingsFile.ts`'s is: a test must never resolve to the real `~/.claude`. */
export function userBindingsPath(deps?: { home?: string }): string {
  return join(deps?.home ?? homedir(), ".claude", "keybindings.json");
}

/** What `/keybindings` writes when the file does not exist yet, so the editor opens something that explains
 *  itself. JSON has no comments, so the guidance rides in `$docs` keys (unknown top-level keys are ignored).
 *  Both inner forms are documented because both are accepted (`readEntries`) and a user who copies upstream's
 *  schema writes the array one — being shown only the object map would read as "the other form is wrong". */
export const STARTER_KEYBINDINGS = `{
  "$docs": "Each block is { \\"context\\": one of Global|Chat|Autocomplete|Confirmation|Help|Transcript|HistorySearch|Task|Settings|Tabs|MessageSelector|Select, \\"bindings\\": <object map or array> }. Chords are space-separated (\\"ctrl+x ctrl+e\\"). Modifiers: ctrl, alt (= meta/opt), shift, super (= cmd); a capital letter means shift (\\"ctrl+G\\" is ctrl+shift+g). Edits apply live.",
  "$docs-forms": "Object map: { \\"ctrl+g\\": \\"chat:externalEditor\\" }. Array: [ { \\"key\\": \\"ctrl+g\\", \\"action\\": \\"chat:externalEditor\\" } ]. Both accept the same keys and actions.",
  "$docs-unbind": "\\"action\\": null unbinds a default IN THAT CONTEXT, and the key stops there — the next context down does not inherit it. User bindings are additive, so to MOVE a binding, unbind the old key with null and bind the new one. In the array form an entry with no \\"action\\" at all is a typo, not an unbind, and is ignored.",
  "$docs-example": "[ { \\"context\\": \\"Chat\\", \\"bindings\\": { \\"shift+tab\\": null, \\"alt+m\\": \\"chat:cycleMode\\", \\"ctrl+k\\": \\"command:clear\\" } } ]",
  "bindings": [
  ]
}
`;

/** Read + validate. A missing file is not an error (the common case): empty layers, no issues. */
export function loadUserBindings(file: string, deps: LoadDeps = {}): UserBindingsResult {
  const read = deps.readFile ?? readFileSync;
  let text: string;
  try { text = String(read(file, "utf8")); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { layers: [], issues: [] };
    return { layers: [], issues: [{ type: "parse_error", detail: `could not read ${file}: ${(e as Error).message} — no user bindings applied` }] };
  }
  let root: unknown;
  try { root = JSON.parse(text); }
  catch (e) { return { layers: [], issues: [{ type: "parse_error", detail: `not valid JSON: ${(e as Error).message} — no user bindings applied` }] }; }
  return validate(root);
}

/** The whole validator, on already-parsed JSON. Split out so the shape rules are testable without a file and so
 *  `loadUserBindings` stays a thin read + JSON.parse. */
function validate(root: unknown): UserBindingsResult {
  const issues: BindingIssue[] = [], layers: ContextBindings[] = [];
  // Upstream writes `{ $schema, $docs, bindings: [...] }`; a bare array is accepted too, since that is what a
  // hand-written file usually looks like and rejecting it would teach nothing.
  const blocks = Array.isArray(root) ? root : isRecord(root) ? root.bindings : undefined;
  if (blocks === undefined) {
    if (!isRecord(root)) issues.push({ type: "parse_error", detail: "the top level must be an object with a \"bindings\" array — no user bindings applied" });
    return { layers, issues };   // an object with no `bindings` key (e.g. only $schema) contributes nothing, and says nothing
  }
  if (!Array.isArray(blocks)) {
    issues.push({ type: "parse_error", detail: "\"bindings\" must be an array of { context, bindings } blocks — no user bindings applied" });
    return { layers, issues };
  }
  blocks.forEach((block, index) => {
    if (!isRecord(block)) { issues.push({ type: "parse_error", detail: `block ${index + 1} is not an object — block ignored` }); return; }
    const context = block.context;
    if (typeof context !== "string" || !CONTEXTS.has(context)) {
      issues.push({ type: "invalid_context", detail: `unknown context ${JSON.stringify(context)} (block ${index + 1}) — block ignored` });
      return;
    }
    const entries = readEntries(block.bindings, context, issues);
    if (!entries) return;
    // Keyed canonically, so a duplicate under two spellings collides HERE (later wins, like the merge itself).
    const out = new Map<string, string | null>();
    for (const [rawKey, action] of entries) {
      const checked = checkEntry(context, rawKey, action, issues);
      if (!checked) continue;
      if (out.has(checked.key)) issues.push({ type: "duplicate", detail: `${context} ${JSON.stringify(rawKey)} is bound twice in one block (canonically ${checked.key}) — the last one wins` });
      out.set(checked.key, checked.action);
    }
    if (out.size > 0) layers.push({ context: context as KeyContextName, bindings: Object.fromEntries(out) });
  });
  return { layers, issues };
}

/** Both inner forms: the object map `{ "ctrl+g": "chat:externalEditor" }` and the array of `{ key, action }`
 *  records the schema documents. Normalized to raw (key, action) pairs; null when the block is unusable. */
function readEntries(bindings: unknown, context: string, issues: BindingIssue[]): [string, unknown][] | null {
  if (isRecord(bindings)) return Object.entries(bindings);
  if (!Array.isArray(bindings)) {
    issues.push({ type: "parse_error", detail: `${context}: "bindings" must be an object or an array of { key, action } — block ignored` });
    return null;
  }
  const out: [string, unknown][] = [];
  bindings.forEach((entry, i) => {
    if (!isRecord(entry) || typeof entry.key !== "string") {
      issues.push({ type: "parse_error", detail: `${context}: binding ${i + 1} has no "key" string — binding ignored` });
      return;
    }
    // A MISSING `action` is a half-typed entry, not an unbind. `entry.action ?? null` would have turned the
    // plausible typo `{ "key": "ctrl+g" }` into a silent unbind of ctrl+g — the loudest outcome from the
    // quietest mistake. Only an EXPLICIT null unbinds, which is what the object map already requires. Own
    // property, not `in`: a file naming "constructor" must not read an action off Object.prototype.
    if (!Object.prototype.hasOwnProperty.call(entry, "action")) {
      issues.push({ type: "invalid_action", detail: `${context} ${JSON.stringify(entry.key)}: binding ${i + 1} has no "action" — binding ignored (write "action": null to unbind)` });
      return;
    }
    out.push([entry.key, entry.action]);
  });
  return out;
}

/** One (key, action) pair against every rule. Returns the canonical key + action to install, or null when the
 *  entry is dropped. Warnings that keep the binding are pushed on the way out. */
function checkEntry(context: string, rawKey: string, action: unknown, issues: BindingIssue[]): { key: string; action: string | null } | null {
  const where = `${context} ${JSON.stringify(rawKey)}`;
  const chord = parseChordSpec(rawKey);
  if (!chord) { issues.push({ type: "parse_error", detail: `${where}: unparseable key spec — binding ignored` }); return null; }
  const key = chord.map(specKey).join(" ");
  // An explicit `null` unbind is never a rebinding, so it is exempt from the reserved registry: a user must stay
  // able to say "ctrl+c does nothing HERE" (the default table does exactly that in five contexts).
  if (action !== null) for (const member of chord) {
    const reserved = RESERVED_KEYS[specKey(member)];
    if (reserved?.severity === "error") { issues.push({ type: "reserved", detail: `${where}: ${reserved.reason} — binding ignored` }); return null; }
    if (reserved?.severity === "warning") issues.push({ type: "reserved", detail: `${where}: ${reserved.reason} — binding kept, but ccx handles that key before the keymap` });
  }
  if (action !== null) {
    if (typeof action !== "string") { issues.push({ type: "invalid_action", detail: `${where}: an action must be a string or null, got ${JSON.stringify(action)} — binding ignored` }); return null; }
    if (!ACTIONS.has(action)) {
      if (!COMMAND_RE.test(action)) { issues.push({ type: "invalid_action", detail: `${where}: ${JSON.stringify(action)} is not a known action — binding ignored` }); return null; }
      if (context !== "Chat") { issues.push({ type: "invalid_action", detail: `${where}: ${JSON.stringify(action)} runs a slash command, which is only legal in the Chat context — binding ignored` }); return null; }
    }
  }
  for (const mod of capsModifiers(rawKey)) issues.push({ type: "suspicious_key", detail: `${where}: modifier ${JSON.stringify(mod)} is spelled in caps — binding kept (key specs are lowercase by convention)` });
  for (const member of chord) {
    const name = member.name;
    if (name.length === 1 || KNOWN_NAMES.has(name) || FUNCTION_KEY.test(name)) continue;
    // Honest about WHY it will not match: the old wording ("unless your terminal sends that key") promised a
    // recovery that does not exist — even a terminal that sends the key gives us bytes our parser names
    // differently, so the binding stays dead until the spec is spelled the way parse.ts names it.
    issues.push({ type: "suspicious_key", detail: `${where}: unknown key name ${JSON.stringify(name)} — binding kept, but nothing will match it: that is not a name this keypress parser produces` });
  }
  return { key, action: action as string | null };
}

/** Modifier tokens spelled with a capital. Legal (normalize.ts lowercases them) but never how upstream's docs or
 *  our tables write one, so it usually means the spec was typed from memory — worth saying, not worth dropping.
 *  A single uppercase KEY name is untouched: `ctrl+G` is the documented shorthand for `ctrl+shift+g`. */
function capsModifiers(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.trim().split(/\s+/)) {
    const tokens = part.split("+");
    tokens.pop();                                   // the last token is the key name, not a modifier
    for (const t of tokens) if (t !== "" && t !== t.toLowerCase()) out.push(t);
  }
  return out;
}

/** The user-facing rendering of a load: a heading naming the file and the count, then one line per issue. Capped
 *  — a file broken in twenty places would otherwise push the whole transcript off screen at launch, and the
 *  first five say the same thing. Plain strings; the caller decides whether they are transcript notices, and
 *  in ccx they are (a live Ink frame has no console to print into). */
export function formatIssues(issues: readonly BindingIssue[], file: string, max = 5): string[] {
  if (issues.length === 0) return [];
  const lines = [`⚠ ${file}: ${issues.length} problem${issues.length === 1 ? "" : "s"}`];
  for (const issue of issues.slice(0, max)) lines.push(`  ${issue.type}: ${issue.detail}`);
  if (issues.length > max) lines.push(`  …and ${issues.length - max} more`);
  return lines;
}

/** Poll the file and re-load on every real change; returns the stop function. Does NOT fire for the initial
 *  contents — the caller has already loaded them (that is the startup path, and it needs the issues anyway).
 *  A deletion re-loads to empty layers, which is the honest answer: the defaults come back. */
export function watchUserBindings(file: string, onChange: (result: UserBindingsResult) => void, deps: WatchDeps = {}): () => void {
  const watchFile = deps.watchFile ?? realWatchFile;
  const unwatchFile = deps.unwatchFile ?? realUnwatchFile;
  let stopped = false;
  const listener = (curr: StatLike, prev: StatLike) => {
    if (stopped) return;                                                     // a poll already in flight when stop() ran
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;    // a tick with nothing behind it
    onChange(loadUserBindings(file, deps));
  };
  watchFile(file, { interval: deps.interval ?? WATCH_MS }, listener);
  return () => {
    if (stopped) return;
    stopped = true;
    unwatchFile(file, listener);
  };
}
