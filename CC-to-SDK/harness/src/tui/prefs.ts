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

/** `queuedUpHintSessions` is upstream's `queuedCommandUpHintCount` (bundle L377294 default, L495114 gate, L495115 literal) — how many
 *  sessions have already shown `Press up to edit queued messages`; the hint stops at `QUEUED_UP_HINT_LIMIT`.
 *  `exampleFiles` is the git-log harvest `placeholder.ts` draws the `Try "…"` filename from, cached with the
 *  stamp that decides its weekly expiry (upstream keeps the two as `exampleFiles` + `exampleFilesGeneratedAt`;
 *  one record here so a half-written pair can't outlive its stamp). */
/** `model` is F6 T11's default-model write: the /model picker's Enter path ("set as default") lands here.
 *  RECORDED DIVERGENCE — upstream writes it to `~/.claude/settings.json` (`Dcn`, bundle L315170:
 *  `yi("userSettings", {model})`), which its own engine reads at next launch. Ours goes to the ccx prefs
 *  file, the client-side seam this module already owns; nothing reads it back at boot yet. */
/** `showExpandedTodos` is F6 T13's Ctrl-T write and upstream's own flag name (bundle L377294 default,
 *  L401025-401031 writer): the todo panel's open state, saved as it is toggled and restored at boot by
 *  chatMain. Upstream's default is FALSE; ours is true when the key is absent — see ChatApp's prop. */
/** `hasSeenAutoModeEntryWarning` is Wave-T T2's once-per-install gate for the auto-mode entry notice, and
 *  upstream's own flag name (bundle L454516 gate, L547951 writer): set the first time this install lands in
 *  `auto`, never cleared. Upstream keeps it in the app config; ours lives here, the client-side seam. */
/** `skipDangerousModePermissionPrompt` is Wave-T T15's once-per-install record that the bypass-permissions
 *  consent was accepted, and upstream's own flag name (bundle L554052 writer, `M8()` L43492 gate — which reads
 *  it across four settings scopes; ours has the one). Written only by the accept arm of the consent dialog,
 *  never cleared: once accepted, neither a bypass launch nor `/yolo` asks again. */
/** `showTurnDuration` is Wave-C T7's end-of-turn `✻ Worked for 4s` row, and upstream's own setting name
 *  (bundle L42035 schema, L428650 read). DEFAULT TRUE — absent means shown, only an explicit `false` removes
 *  the row, which is what `durationRow.ts`'s `turnDurationEnabled` encodes. Upstream keeps it in the settings
 *  FILE (`~/.claude/settings.json`) and surfaces it as the `Show turn duration` `/config` row; ours lives
 *  here, the client-side seam this module already owns, behind that same row and label. */
/** `promptSuggestionEnabled` is Wave-C T12's ghost-text follow-up suggestion (EP-C5), and upstream's own
 *  setting name (bundle L42035 schema, L235104 read, L315485 the `/config` row). THE POLARITY IS FLIPPED,
 *  deliberately: upstream's schema says "when absent or true, prompt suggestions are enabled", ours ships OFF
 *  and only an explicit `true` turns it on — the feature costs ~$0.0045 and ~5 s per turn on our warm
 *  suggester session (probe 100c), and upstream's own two feature-flag call sites default it off too. That
 *  reading lives in `suggester.ts`'s `promptSuggestionEnabled`, and it is why the `/config` row writes BOTH
 *  polarities explicitly where upstream deletes the key to mean "on". */
export interface CcxPrefs { theme?: ThemeId; outputStyle?: string; model?: string; showExpandedTodos?: boolean; queuedUpHintSessions?: number; exampleFiles?: { files: string[]; at: number }; hasSeenAutoModeEntryWarning?: boolean; skipDangerousModePermissionPrompt?: boolean; showTurnDuration?: boolean; promptSuggestionEnabled?: boolean }

function prefsPath(env?: NodeJS.ProcessEnv): string { return join(fleetRoot(env), "prefs.json"); }

/** Missing file (ENOENT) or corrupt JSON → `{}`, never a throw — a first run or a hand-edited garbage
 *  file must not crash boot. Values are validated too, not just JSON-shape: a `theme` that isn't one of
 *  THEMES's keys (hand-edited, or a future release renaming/dropping an id) is dropped rather than handed
 *  to chatMain's `setTheme()`, which indexes `THEMES[id]` unchecked and throws on a miss — this is the
 *  one field that feeds a lookup table, so it's the one that needs the check. `model` gets the same
 *  treatment for the same reason, one level down: cli/main.ts forwards it into the host config unvalidated
 *  and `resolveModelAlias` calls `.trim()` on it, so a hand-edited `"model": 5` would crash a foreground
 *  launch (codex review, F6 close). Only the TYPE is checked — which model ids exist is the engine's
 *  question, not this file's, and an unknown string is already handled downstream. `outputStyle` isn't
 *  indexed anywhere (config/outputStyle.ts falls back to treating an unrecognized string as a literal
 *  persona), so it has no equivalent crash to guard against and is left as-is. */
export function loadPrefs(env?: NodeJS.ProcessEnv): CcxPrefs {
  try {
    const parsed = JSON.parse(readFileSync(prefsPath(env), "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    const prefs = parsed as CcxPrefs;
    // hasOwnProperty, NOT `in`: `in` walks the prototype chain, so a file naming "constructor" (or
    // "toString") passes the guard and setTheme then reads `.claude` off Object.prototype's member —
    // no throw, but ACCENT and every token silently become undefined and the UI loses its colors.
    if (prefs.theme !== undefined && !Object.prototype.hasOwnProperty.call(THEMES, prefs.theme)) delete prefs.theme;
    if (prefs.model !== undefined && (typeof prefs.model !== "string" || prefs.model.trim() === "")) delete prefs.model;
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
