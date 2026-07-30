// tui/src/addDir.ts — pure `/add-dir` validation + copy (Wave 3 task 3). Verbatim 2.1.220 strings (plan
// Global Constraints line 25-27): every failure mode gets its own verdict kind so the dialog's entry-phase
// Enter and the command-line `/add-dir <path>` arg path share ONE source of truth for both the check and
// its message. Containment is path-segment-aware (relative() + no leading "..") so `/a/bc` is never
// mistaken for a child of `/a/b`.
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { RenderLine } from "./render.js";

/** Minimal fs surface validateAddDir needs — injectable so tests never touch the real filesystem. */
export interface FsFacade { existsSync: (p: string) => boolean; statSync: (p: string) => { isDirectory(): boolean } }
const realFs: FsFacade = { existsSync, statSync };

export type AddDirVerdict =
  | { kind: "empty" }
  | { kind: "missing"; abs: string }
  | { kind: "notDir"; abs: string; parent: string }
  | { kind: "cwdSelf"; abs: string }
  | { kind: "alreadyAdded"; abs: string }
  | { kind: "subdirOfCwd"; abs: string; cwd: string }
  | { kind: "subdirOfAdded"; abs: string; dir: string }
  | { kind: "ok"; abs: string };

/** "~" / "~/rest" → the home directory; anything else passes through untouched ("~user" isn't supported —
 *  out of scope for a local dev tool, and upstream's own add-dir input doesn't need it either). */
function expandTilde(raw: string, home: string): string {
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return home + raw.slice(1);
  return raw;
}

/** True iff `child` is a PROPER descendant of `parent` — segment-aware, so `/a/bc` is never "within" `/a/b`
 *  (a naive `child.startsWith(parent)` check would wrongly say yes). */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** `/add-dir <raw>` → a verdict. `dirs` is the CURRENT additional-directory list (launch + session grants,
 *  EXCLUDING cwd — cwd is its own parameter, mirroring the host's own cwd/additionalDirectories split, see
 *  `SessionOps.listDirs`). Check order matches the upstream flow: existence → file-vs-directory →
 *  cwd-identity → already-added (exact) → subdir-of-cwd → subdir-of-an-added-dir → ok. */
export function validateAddDir(raw: string, cwd: string, dirs: string[], fs: FsFacade = realFs): AddDirVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };
  const abs = resolve(cwd, expandTilde(trimmed, homedir()));
  if (!fs.existsSync(abs)) return { kind: "missing", abs };
  if (!fs.statSync(abs).isDirectory()) return { kind: "notDir", abs, parent: dirname(abs) };
  const cwdAbs = resolve(cwd);
  if (abs === cwdAbs) return { kind: "cwdSelf", abs };
  if (dirs.includes(abs)) return { kind: "alreadyAdded", abs };
  if (isWithin(cwdAbs, abs)) return { kind: "subdirOfCwd", abs, cwd: cwdAbs };
  const parent = dirs.find((d) => isWithin(d, abs));
  if (parent) return { kind: "subdirOfAdded", abs, dir: parent };
  return { kind: "ok", abs };
}

/** A verdict → its transcript message (bold `abs`/`parent`/`cwd`/`dir` spans via `segments`). Never called
 *  for "ok" — that verdict opens the confirm dialog instead of printing anything, so it renders no lines. */
export function formatAddDirVerdict(v: AddDirVerdict): RenderLine[] {
  switch (v.kind) {
    case "empty":
      return [{ text: "Please provide a directory path." }];
    case "missing":
      return [{ text: `Path ${v.abs} was not found.`, segments: [{ text: "Path " }, { text: v.abs, bold: true }, { text: " was not found." }] }];
    case "notDir":
      return [{
        text: `${v.abs} is not a directory. Did you mean to add the parent directory ${v.parent}?`,
        segments: [{ text: v.abs, bold: true }, { text: " is not a directory. Did you mean to add the parent directory " }, { text: v.parent, bold: true }, { text: "?" }],
      }];
    case "cwdSelf":
      return [{ text: `${v.abs} is already the current working directory.`, segments: [{ text: v.abs, bold: true }, { text: " is already the current working directory." }] }];
    case "alreadyAdded":
      return [{ text: `${v.abs} is already added as a working directory.`, segments: [{ text: v.abs, bold: true }, { text: " is already added as a working directory." }] }];
    case "subdirOfCwd":
      return [{
        text: `${v.abs} is already accessible within the current working directory ${v.cwd}.`,
        segments: [{ text: v.abs, bold: true }, { text: " is already accessible within the current working directory " }, { text: v.cwd, bold: true }, { text: "." }],
      }];
    case "subdirOfAdded":
      return [{
        text: `${v.abs} is already accessible within the additional working directory ${v.dir}.`,
        segments: [{ text: v.abs, bold: true }, { text: " is already accessible within the additional working directory " }, { text: v.dir, bold: true }, { text: "." }],
      }];
    case "ok":
      return [];
  }
}

/** The dialog's terminal outcome — accept (session-only / remembered / remembered-but-save-failed) or
 *  cancel (from the entry phase with no path resolved yet, or from the confirm phase with one). */
export type AddDirOutcome =
  | { kind: "addedSession"; abs: string }
  | { kind: "addedRemembered"; abs: string }
  | { kind: "addedSaveFailed"; abs: string; err: string }
  | { kind: "cancelledEmpty" }
  | { kind: "cancelledPath"; abs: string };

const MANAGE_SUFFIX = " · /permissions to manage";

/** An outcome → its transcript message. Every ADDED result carries the dim `MANAGE_SUFFIX` — verbatim
 *  upstream copy, even on the failed-save line (the session grant already succeeded there; only the
 *  local-settings write failed, so the tool-access hint still applies). */
export function formatAddDirResult(o: AddDirOutcome): RenderLine[] {
  switch (o.kind) {
    case "addedSession":
      return [{
        text: `Added ${o.abs} as a working directory for this session${MANAGE_SUFFIX}`,
        segments: [{ text: "Added " }, { text: o.abs, bold: true }, { text: " as a working directory for this session" }, { text: MANAGE_SUFFIX, dim: true }],
      }];
    case "addedRemembered":
      return [{
        text: `Added ${o.abs} as a working directory and saved to local settings${MANAGE_SUFFIX}`,
        segments: [{ text: "Added " }, { text: o.abs, bold: true }, { text: " as a working directory and saved to local settings" }, { text: MANAGE_SUFFIX, dim: true }],
      }];
    case "addedSaveFailed":
      return [{
        text: `Added ${o.abs} as a working directory. Failed to save to local settings: ${o.err}${MANAGE_SUFFIX}`,
        segments: [{ text: "Added " }, { text: o.abs, bold: true }, { text: ` as a working directory. Failed to save to local settings: ${o.err}` }, { text: MANAGE_SUFFIX, dim: true }],
      }];
    case "cancelledEmpty":
      return [{ text: "Did not add a working directory." }];
    case "cancelledPath":
      return [{ text: `Did not add ${o.abs} as a working directory.`, segments: [{ text: "Did not add " }, { text: o.abs, bold: true }, { text: " as a working directory." }] }];
  }
}

/** One `listDirs()` row → its label. Shared with Task 7's Workspace tab so the two can never disagree
 *  about what a row says. Styling (the cwd suffix is DIM upstream) is the caller's job — this returns
 *  plain text only. */
export function dirLabel(d: { path: string; source: "cwd" | "launch" | "session" }): string {
  return d.source === "cwd" ? `${d.path} (Original working directory)` : d.path;
}
