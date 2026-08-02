// tui/src/prefs.ts — OUR OWN client preferences at ~/.claude/ccx/prefs.json (Wave 3 task 4). This is a
// DIFFERENT thing from settingsFile.ts: that module reads/writes Claude Code's own settings files
// (.claude/settings*.json — the engine reads those at next launch); this one is ccx's own client-side
// state (currently just the picked theme), never merged with or routed through settingsFile.ts. Reuses
// fleet/paths.ts's fleetRoot() for the directory (so CCX_FLEET_ROOT test overrides isolate this from the
// real file exactly like every other fleet path — roster/, run/, and now prefs.json all live there).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fleetRoot } from "../fleet/paths.js";
import { THEMES, type ThemeId } from "./theme.js";

export interface CcxPrefs { theme?: ThemeId; outputStyle?: string }

function prefsPath(env?: NodeJS.ProcessEnv): string { return join(fleetRoot(env), "prefs.json"); }

/** Missing file (ENOENT) or corrupt JSON → `{}`, never a throw — a first run or a hand-edited garbage
 *  file must not crash boot. Values are validated too, not just JSON-shape: a `theme` that isn't one of
 *  THEMES's keys (hand-edited, or a future release renaming/dropping an id) is dropped rather than handed
 *  to chatMain's `setTheme()`, which indexes `THEMES[id]` unchecked and throws on a miss — this is the
 *  one field that feeds a lookup table, so it's the one that needs the check. `outputStyle` isn't indexed
 *  anywhere (config/outputStyle.ts falls back to treating an unrecognized string as a literal persona), so
 *  it has no equivalent crash to guard against and is left as-is. */
export function loadPrefs(env?: NodeJS.ProcessEnv): CcxPrefs {
  try {
    const parsed = JSON.parse(readFileSync(prefsPath(env), "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    const prefs = parsed as CcxPrefs;
    // hasOwnProperty, NOT `in`: `in` walks the prototype chain, so a file naming "constructor" (or
    // "toString") passes the guard and setTheme then reads `.claude` off Object.prototype's member —
    // no throw, but ACCENT and every token silently become undefined and the UI loses its colors.
    if (prefs.theme !== undefined && !Object.prototype.hasOwnProperty.call(THEMES, prefs.theme)) delete prefs.theme;
    return prefs;
  } catch { return {}; }
}

/** Read-merge-write, mkdir -p. `patch` is shallow-merged over whatever's already on disk (loadPrefs's own
 *  tolerant read), so an unknown/future key already in the file survives a save that doesn't mention it. */
export function savePrefs(patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv): void {
  const path = prefsPath(env);
  const next = { ...loadPrefs(env), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
}
