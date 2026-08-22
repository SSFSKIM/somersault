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
import { NOTIF_CHANNELS, NOTIF_EVENTS, type NotifChannel, type NotifEvent } from "./desktopNotify.js";
import { isEffortLevel, type EffortLevel } from "./modelPickerModel.js";

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
/** `tui` is FSW T5's renderer setting and upstream's own key + spelling (2.1.226 settings schema: `tui:
 *  ["default","fullscreen"]`, described there as "fullscreen uses the flicker-free alt-screen renderer …
 *  equivalent to CLAUDE_CODE_NO_FLICKER=1"). It is one rung of `renderer.ts`'s decision ladder — below the
 *  env levers, above the shipped default — and is read ONCE at boot. Upstream keeps it in the settings FILE;
 *  ours lives here, the client-side seam this module already owns, like `model` and `showTurnDuration`. */
/** `prefersReducedMotion` is F8 T6's setting and canon's own key (bundle L383488 row, `r?.prefersReducedMotion
 *  ?? !1` L507998) — DEFAULT FALSE. It is one of two rungs `motion.ts`'s `reducedMotion()` reads, the other
 *  being the `CLAUDE_AX_SCREEN_READER` env var; this file only ever sees the setting half. */
/** `preferredNotifChannel`/`notifEvents` are F8 T11's settings, over Task 10's `desktopNotify.ts`: which
 *  emulator escape to emit (or `auto` to sniff) and which of the four `NotifEvent`s are enabled. Read at
 *  CALL time by the notifier's `settings()` closure (chatMain.tsx), never captured at boot — so this file
 *  stays the one seam a `/config` change flows through, like every other client-side setting here. */
/** `terminalProgressBarEnabled` is T-CH34's setting and canon's own key (bundle L46264 schema: `zt().optional()
 *  .describe("Emit OSC 9;4 progress sequences during long operations")`) — DEFAULT TRUE, canon's own polarity
 *  (`Vd("terminalProgressBarEnabled", !0)`, L563441). It rides `prefersReducedMotion`'s exact shape: a plain
 *  boolean, no closed-set validation below (a hand-edited non-boolean is never indexed or `.trim()`-called
 *  anywhere downstream, so it has no crash to guard against — same reasoning `outputStyle` gets). */
/** `effort` is T-EFFORT's default-level write: canon's `pOn` (106568-106578) writes `effortLevel` to
 *  `~/.claude/settings.json`; ours goes here, the ccx-prefs seam every other client-side setting in this
 *  file already uses (the SAME recorded divergence `model` above already carries). Written by
 *  `applyEffort` (useChat.ts) — the one choke point EVERY level-setting surface (the dialog's Enter, a
 *  typed `/effort <level>`, the `/model` picker's effort row) funnels through, canon's own `Z5t` shape
 *  (T-EFFORT R2 §2.2). Read back at `cli/main.ts`'s `initialEffort` seed, re-filtered through the SAME
 *  persistable-level gate (`isPersistableEffortLevel`) canon's read-back applies (`Qdt`, R2 §2.5) — a
 *  hand-edited `"max"` here is exactly as inert as an attempted write of it would have been. */
/** `copyOnSelect` is F9 T-MOUSE Task 7's setting and canon's own key (research r1-mouse.md §2.5: `ar().
 *  copyOnSelect ?? !0`) — DEFAULT TRUE, canon's own polarity. It rides `terminalProgressBarEnabled`'s exact
 *  shape: a plain boolean, no closed-set validation below (read only as a truthy/falsy gate in ChatApp's
 *  auto-copy latch, never indexed or `.trim()`-called, so a hand-edited non-boolean has no crash to guard
 *  against). Read live, never captured once — the same reason `terminalProgressBarEnabled` is. */
export interface CcxPrefs { theme?: ThemeId; outputStyle?: string; model?: string; showExpandedTodos?: boolean; queuedUpHintSessions?: number; exampleFiles?: { files: string[]; at: number }; hasSeenAutoModeEntryWarning?: boolean; skipDangerousModePermissionPrompt?: boolean; showTurnDuration?: boolean; promptSuggestionEnabled?: boolean; tui?: "fullscreen" | "default"; prefersReducedMotion?: boolean; preferredNotifChannel?: NotifChannel; notifEvents?: NotifEvent[]; terminalProgressBarEnabled?: boolean; effort?: EffortLevel; copyOnSelect?: boolean }

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
    // FSW T5: `tui` is a CLOSED set, like `theme` — a hand-edited `"alt-screen"` must not reach
    // `selectRenderer` as a third value its ladder has no rung for. Dropping it means the settings rung says
    // nothing and the decision falls through to the shipped default, which is the honest reading of a value
    // this file could not understand.
    if (prefs.tui !== undefined && prefs.tui !== "fullscreen" && prefs.tui !== "default") delete prefs.tui;
    // F8 T11: `preferredNotifChannel` is a CLOSED set like `theme`/`tui` — a hand-edited value `resolveChannel`
    // has no case for reaches its own exhaustiveness guard (which rings a bell rather than throw), so dropping
    // it here isn't a crash guard, it's keeping an unrecognized channel from silently overriding `auto`.
    if (prefs.preferredNotifChannel !== undefined && !NOTIF_CHANNELS.includes(prefs.preferredNotifChannel)) delete prefs.preferredNotifChannel;
    // `notifEvents` feeds `enabledEvents.includes(event)` at every notify() call — the ARRAY shape has to be
    // checked, not just its members: a hand-edited non-array (an object, a string) would reach `.includes`
    // and throw at the exact moment a permission prompt opens, turning a bad setting into a crash on the one
    // path that matters most. A malformed array is dropped whole rather than filtered, matching `theme`'s
    // drop-not-coerce rule elsewhere in this loader.
    if (prefs.notifEvents !== undefined && (!Array.isArray(prefs.notifEvents) || !prefs.notifEvents.every((e) => NOTIF_EVENTS.includes(e)))) delete prefs.notifEvents;
    // T-EFFORT: `effort` is a CLOSED set like `theme`/`tui` — SHAPE validation only (any of the five
    // `EffortLevel`s). The NARROWER persistable-subset filter (no `max`) is applied at the READ-BACK site
    // (`cli/main.ts`), not here, matching canon's own two-step shape: `Qdt` re-filters on read exactly as
    // it gates on write, but the settings FILE itself is only ever type-checked at this layer (see `model`'s
    // comment above for the same split, one line up).
    if (prefs.effort !== undefined && !isEffortLevel(prefs.effort)) delete prefs.effort;
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
