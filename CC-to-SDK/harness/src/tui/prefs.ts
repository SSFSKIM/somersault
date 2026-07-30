// tui/src/prefs.ts — OUR OWN client preferences at ~/.claude/ccx/prefs.json (Wave 3 task 4). This is a
// DIFFERENT thing from settingsFile.ts: that module reads/writes Claude Code's own settings files
// (.claude/settings*.json — the engine reads those at next launch); this one is ccx's own client-side
// state (currently just the picked theme), never merged with or routed through settingsFile.ts. Reuses
// fleet/paths.ts's fleetRoot() for the directory (so CCX_FLEET_ROOT test overrides isolate this from the
// real file exactly like every other fleet path — roster/, run/, and now prefs.json all live there).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fleetRoot } from "../fleet/paths.js";
import type { ThemeId } from "./theme.js";

export interface CcxPrefs { theme?: ThemeId; outputStyle?: string }

function prefsPath(env?: NodeJS.ProcessEnv): string { return join(fleetRoot(env), "prefs.json"); }

/** Missing file (ENOENT) or corrupt JSON → `{}`, never a throw — a first run or a hand-edited garbage
 *  file must not crash boot. */
export function loadPrefs(env?: NodeJS.ProcessEnv): CcxPrefs {
  try {
    const parsed = JSON.parse(readFileSync(prefsPath(env), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as CcxPrefs) : {};
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
