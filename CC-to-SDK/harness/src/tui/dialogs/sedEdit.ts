// tui/dialogs/sedEdit.ts — "this Bash command is really a file edit": the sed-in-place matcher (F6 T4).
// Transcribed from 2.1.220's `c1t` (L227825-227910, the matcher), `Qod` (L227911-227934, the simulation)
// and the reachable half of `DCs` (L228484-494, the descriptor that consumes both).
//
// `c1t` is an argv walk, NOT a regex. Upstream gets its argv from tree-sitter-bash: `cAo` (L359954) first
// rejects anything that is not ONE `command` node — pipelines, `&&` chains, redirections, command and
// process substitutions — then `c1t` rejects any child whose node type is outside `HMy` (L227935:
// command_name · word · string · raw_string · number · concatenation; note `variable_assignment` is NOT in
// that set), and finally `Mx`/`ZRt` (L359788/L143886) flatten the node into argv with `Xco` (L143914)
// unescaping words and stripping the outer quotes off strings.
//
// We ship no bash grammar, so `splitSimpleCommand` below reaches the same verdicts by scanning. Where it
// cannot be sure it REJECTS, and a rejected command simply renders as the ordinary Bash dialog — the safe
// direction, since the only thing at stake is whether the human sees a diff preview or a command line.

import { resolve as resolvePath } from "node:path";
import { randomBytes } from "node:crypto";

/** What `c1t` returns (L227909) and what `DCs` consumes. `flags`/`extendedRegex` are what make the
 *  simulation faithful, so they travel with the pattern rather than being re-derived downstream. */
export interface SedEdit {
  filePath: string;
  pattern: string;
  replacement: string;
  flags: string;
  extendedRegex: boolean;
}

/** `Tke`, the parse ceiling `cAo`/`Mx` share (L359789/L359955). */
const MAX_COMMAND = 10_000;

/** Unquoted characters that mean "this is not one simple command". `$` is handled separately: it is only an
 *  expansion when something expandable follows it, so `s/foo$/bar/` stays a plain word. */
const META = new Set(["|", "&", ";", "<", ">", "(", ")", "{", "}", "`", "\n"]);
const EXPANDS = /[A-Za-z0-9_{(]/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Flatten a command string into argv, or `null` when it is anything other than ONE simple command.
 *  Quote handling mirrors `Xco`/`$Vg` (L143914-143920): a backslash outside quotes escapes the next
 *  character, `'…'` is literal, and `"…"` keeps its contents verbatim minus the delimiters (upstream's
 *  `string` node survives `HMy` with any expansion inside it left as text — so do we). */
export function splitSimpleCommand(command: string): string[] | null {
  if (command.length > MAX_COMMAND) return null;
  const argv: string[] = [];
  let token = "", started = false, i = 0;
  const flush = () => { if (started) { argv.push(token); token = ""; started = false; } };
  while (i < command.length) {
    const ch = command[i]!;
    if (ch === " " || ch === "\t") { flush(); i++; continue; }
    if (ch === "#" && !started) break;                        // a `comment` child; upstream filters them out
    if (ch === "\\") {
      if (i + 1 >= command.length) return null;               // a trailing backslash is a line continuation
      token += command[i + 1]; started = true; i += 2; continue;
    }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return null;
      token += command.slice(i + 1, end); started = true; i = end + 1; continue;
    }
    if (ch === '"') {
      started = true; i++;
      for (;;) {
        if (i >= command.length) return null;
        const c = command[i]!;
        if (c === '"') { i++; break; }
        if (c === "\\" && (command[i + 1] === '"' || command[i + 1] === "\\")) { token += command[i + 1]; i += 2; continue; }
        token += c; i++;
      }
      continue;
    }
    if (ch === "$" && EXPANDS.test(command[i + 1] ?? "")) return null;
    if (META.has(ch)) return null;
    token += ch; started = true; i++;
  }
  flush();
  if (argv.length === 0) return null;
  if (ASSIGNMENT.test(argv[0]!)) return null;                 // `variable_assignment` is outside `HMy`
  return argv;
}

/** `c1t` L227825-227910. `null` for everything that is not an in-place `s///` against one file. */
export function parseSedEdit(command: string): SedEdit | null {
  const trimmed = command.trim();
  const argv = splitSimpleCommand(trimmed);
  if (argv === null || argv[0] !== "sed") return null;

  const rest = argv.slice(1);
  let inPlace = false, extendedRegex = false;
  let script: string | null = null, file: string | null = null;
  let u = 0;
  while (u < rest.length) {
    const arg = rest[u]!;
    if (arg === "-i" || arg === "--in-place") {               // L227836-227845
      inPlace = true; u++;
      // The NEXT token is a backup suffix — and is therefore swallowed — only when it is empty or starts
      // with a dot. Anything else is the script or the file and must stay in the walk.
      if (u < rest.length) {
        const next = rest[u]!;
        if (!next.startsWith("-") && (next === "" || next.startsWith("."))) u++;
      }
      continue;
    }
    if (arg.startsWith("-i")) { inPlace = true; u++; continue; }                                  // `-i.bak`
    if (arg === "-E" || arg === "-r" || arg === "--regexp-extended") { extendedRegex = true; u++; continue; }
    if (arg === "-e" || arg === "--expression") {                                                 // L227856
      if (u + 1 < rest.length) {
        if (script !== null) return null;                     // upstream accepts exactly one script
        script = rest[u + 1]!; u += 2; continue;
      }
      return null;
    }
    if (arg.startsWith("--expression=")) {
      if (script !== null) return null;
      script = arg.slice(13); u++; continue;
    }
    if (arg.startsWith("-")) return null;                     // any other flag: not a shape we can preview
    if (script === null) script = arg;
    else if (file === null) file = arg;
    else return null;                                         // a second operand — more than one target
    u++;
  }
  if (!inPlace || !script || !file) return null;
  if (isWindowsNetworkPath(file)) return null;                // `Kk(c, !0)` L227882, windows-only
  if (!script.match(/^s\//)) return null;

  // L227885-227910: walk the `s/pattern/replacement/flags` body by hand so an escaped `\/` stays inside the
  // field it belongs to. `slice(2)` drops the leading `s/`.
  const body = script.slice(2);
  const field = { pattern: "", replacement: "", flags: "" };
  let mode: keyof typeof field = "pattern", g = 0;
  while (g < body.length) {
    const ch = body[g]!;
    if (ch === "\\" && g + 1 < body.length) { field[mode] += ch + body[g + 1]; g += 2; continue; }
    if (ch === "/") {
      if (mode === "pattern") mode = "replacement";
      else if (mode === "replacement") mode = "flags";
      else return null;                                       // a fourth field — not an `s///`
      g++; continue;
    }
    field[mode] += ch; g++;
  }
  if (mode !== "flags") return null;                          // unterminated
  if (!/^[gpimIM1-9]*$/.test(field.flags)) return null;
  return { filePath: file, pattern: field.pattern, replacement: field.replacement, flags: field.flags, extendedRegex };
}

/** `Kk(e, !0)` L146349, reduced. Upstream guards a dozen UNC spellings; every one of them is behind
 *  `Pt() !== "windows" → return !1`, so on the platforms this harness runs on the whole check is dead.
 *  Kept as the two head forms so a Windows run still refuses to "preview" a network write. */
function isWindowsNetworkPath(p: string): boolean {
  if (process.platform !== "win32") return false;
  return /^[\\/]{2}/.test(p) || /(?<!:)[\\/]{2,}[^ \t\r\n\f\v\\/]/.test(p);
}

// `Qod`'s BRE→JS placeholders (L227934). Real NUL-delimited sentinels, exactly as upstream, so a pattern
// containing the literal word "PLUS" cannot collide with them.
const PH = { backslash: "\0BACKSLASH\0", plus: "\0PLUS\0", question: "\0QUESTION\0", pipe: "\0PIPE\0", lparen: "\0LPAREN\0", rparen: "\0RPAREN\0" };

/** `Qod` L227911-227934: what the file WOULD look like after the sed runs. Pure — the caller supplies the
 *  content. sed's regex dialect is not JavaScript's: without `-E`/`-r` the metacharacters `+ ? | ( )` are
 *  literal and their BACKSLASHED forms are the operators, which is what the placeholder round-trip below
 *  swaps over. `&` in the replacement is sed's whole-match reference (JS `$&`), and `\&` is a literal one. */
export function simulateSedEdit(content: string, sed: SedEdit): string {
  let flags = "";
  if (sed.flags.includes("g")) flags += "g";
  if (sed.flags.includes("i") || sed.flags.includes("I")) flags += "i";
  if (sed.flags.includes("m") || sed.flags.includes("M")) flags += "m";

  let pattern = sed.pattern.replace(/\\\//g, "/");
  if (!sed.extendedRegex) {
    pattern = pattern
      .replace(/\\\\/g, PH.backslash).replace(/\\\+/g, PH.plus).replace(/\\\?/g, PH.question)
      .replace(/\\\|/g, PH.pipe).replace(/\\\(/g, PH.lparen).replace(/\\\)/g, PH.rparen)
      .replace(/\+/g, "\\+").replace(/\?/g, "\\?").replace(/\|/g, "\\|").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
      .replaceAll(PH.backslash, "\\\\").replaceAll(PH.plus, "+").replaceAll(PH.question, "?")
      .replaceAll(PH.pipe, "|").replaceAll(PH.lparen, "(").replaceAll(PH.rparen, ")");
  }
  // A random sentinel (upstream's own trick, L227928) parks `\&` while every bare `&` becomes `$&`.
  const parked = `___ESCAPED_AMPERSAND_${randomBytes(8).toString("hex")}___`;
  const replacement = sed.replacement
    .replace(/\\\//g, "/").replace(/\\&/g, parked).replace(/&/g, "$$&").replaceAll(parked, "&");
  try {
    return content.replace(new RegExp(pattern, flags), replacement);
  } catch {
    return content;                                           // an un-compilable pattern previews as a no-op
  }
}

export interface SedPreview {
  /** Absolute, the way `DCs` resolves it before showing it (L228485). */
  filePath: string;
  oldContent: string;
  newContent: string;
  /** The Edit-shaped edit list the file dialog renders; empty when nothing would change. */
  edits: { old_string: string; new_string: string; replace_all: false }[];
  /** Set only when `edits` is empty — upstream's `no-changes` body (L228493). */
  message?: string;
}

/** The reachable half of `DCs` (L228484-494). The fs read is a dependency rather than a call so the
 *  preview is testable and so the dialog can decide its own read policy; `readFile` returns `undefined`
 *  for "not there". Upstream's third arm — the network-path body — is unreachable here: `parseSedEdit`
 *  has already refused UNC targets. */
export function sedEditPreview(sed: SedEdit, deps: { readFile: (path: string) => string | undefined; cwd?: string }): SedPreview {
  const filePath = resolvePath(deps.cwd ?? process.cwd(), sed.filePath);
  const read = deps.readFile(filePath);
  const oldContent = read ?? "";
  const newContent = simulateSedEdit(oldContent, sed);
  if (oldContent !== newContent) {
    return { filePath, oldContent, newContent, edits: [{ old_string: oldContent, new_string: newContent, replace_all: false }] };
  }
  return { filePath, oldContent, newContent, edits: [], message: read === undefined ? "File does not exist" : "Pattern did not match any content" };
}
