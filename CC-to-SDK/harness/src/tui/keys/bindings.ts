// tui/keys/bindings.ts — the keymap AS DATA: the context registry, the action vocabulary, the default binding
// table, and the reserved-key registry. Pure data + types; no React, no Ink, no I/O. Everything downstream (the
// resolver, the user's keybindings.json merge, the hint strings and the shortcuts overlay) reads THIS instead of
// re-deriving key semantics at each call site.
//
// Two rules the table is written under:
//  1. Keys are written as specs (keys/normalize.ts): a chord is whitespace-separated, `ctrl+B` ≡ `ctrl+shift+b`,
//     the space key is spelled `space`. Comparison is always on the canonical form, never the raw text.
//  2. A `null` action is an explicit UNBIND for that context — "the key exists globally but does not reach here".
//     That is how today's owner gate in ChatApp.tsx:126-159 is expressed declaratively; see the block below.
import type { KeyContextName } from "./types.js";

/** The 21 valid contexts: upstream's 20 (06 §1.1/§1.2 — the 19 with default bindings plus `DiffPanel`, which
 *  validates but ships no binding upstream either) plus OUR `SelectDecision`. A context name outside this list
 *  is a config error, not a silent no-op.
 *
 *  `SelectDecision` is the one addition to upstream's registry, and it exists because upstream never had to
 *  make this distinction: its own key layer routes by OWNER, ours by context name, and a `Select` list can be
 *  either kind of owner. See the block below for the whole argument. */
export const VALID_CONTEXTS: readonly KeyContextName[] = ["Global", "Chat", "Autocomplete", "Confirmation", "Help",
  "Transcript", "HistorySearch", "Task", "ThemePicker", "Settings", "Tabs", "Attachments", "Footer",
  "MessageSelector", "DiffDialog", "DiffPanel", "ModelPicker", "Select", "SelectDecision", "Plugin", "Scroll"];

/** One context's bindings. `string` = an action name from `VALID_ACTIONS`; `null` = unbound in this context. */
export interface ContextBindings { context: KeyContextName; bindings: Record<string, string | null> }

export const DEFAULT_BINDINGS: readonly ContextBindings[] = [
  { context: "Global", bindings: {
    "ctrl+c": "app:interrupt",          // arm/double-press exit semantics live in the handler (F0)
    "ctrl+d": "app:exit",               // timed double-press contract (F0)
    "ctrl+o": "app:toggleTranscript",
    "ctrl+t": "app:toggleTodos",
    "ctrl+r": "history:search",
    "ctrl+b": "task:background",        // busy → background the turn; idle → open bg panel (ccx divergence, recorded)
  }},
  { context: "Chat", bindings: {
    "escape": "chat:cancel",            // busy interrupt / esc-esc clear-or-rewind (F0 semantics in handler)
    "ctrl+l": "chat:clearInput",
    "shift+tab": "chat:cycleMode",
    "ctrl+x ctrl+k": "chat:killAgents",
    "ctrl+x ctrl+e": "chat:externalEditor",
    "ctrl+g": "chat:externalEditor",
    "ctrl+x ctrl+g": "chat:externalEditor",  // ccx-specific: preserves the pinned ctrl+x→ctrl+g behavior (components.test.tsx:515-520) under the chord machine
    "ctrl+d": "app:exit",               // handler registered by ChatComposer with the empty-buffer gate + 800 ms arm (ChatComposer.tsx:173-180) — NOT by ChatApp
    "alt+p": "chat:modelPicker",        // NEW (KB8) — upstream meta+p
    "alt+t": "chat:thinkingToggle",     // NEW (KB8) — upstream meta+t
  }},
  { context: "Autocomplete", bindings: {   // pushed by ChatComposer while a / or @ popup is open (state.command || state.mention)
    "escape": "autocomplete:dismiss",
    "tab": "autocomplete:accept",          // up/down stay in the composer fallback (editor list nav)
  }},
  { context: "Task", bindings: {        // pushed while a turn is running in the foreground
    "ctrl+x ctrl+b": "task:background", // NEW (KB18) — upstream's chord alias
  }},
  { context: "Help", bindings: { "escape": "help:dismiss" }},   // + swallowAll while mounted (F0 escape-only)
  { context: "Transcript", bindings: {
    "escape": "transcript:exit", "q": "transcript:exit", "ctrl+c": "transcript:exit",
    "ctrl+u": "scroll:halfPageUp", "ctrl+d": "scroll:halfPageDown",
    "ctrl+b": "scroll:fullPageUp", "ctrl+f": "scroll:fullPageDown",
    "ctrl+n": "scroll:lineDown", "ctrl+p": "scroll:lineUp",
    "g": "scroll:top", "shift+g": "scroll:bottom", "j": "scroll:lineDown", "k": "scroll:lineUp",
    "space": "scroll:fullPageDown", "b": "scroll:fullPageUp",
    "up": "scroll:lineUp", "down": "scroll:lineDown", "pageup": "scroll:pageUp", "pagedown": "scroll:pageDown",
    "home": "scroll:top", "end": "scroll:bottom",   // NEW — deliverable now (P86: parser-level identity)
    "ctrl+e": "transcript:toggleShowAll",           // F1-shipped (TranscriptPager.tsx) — MUST stay bound
    "ctrl+o": "transcript:exit",                    // preserves ctrl+o-closes-the-pager (Global's toggleTranscript only opens)
    // The pager was an owner-gated surface: ChatApp killed every root global inside it except its own ctrl+o
    // close arm. Four of the six are rebound above as pager operations; these two were simply dead, and must
    // say so — otherwise moving the pager onto the scope stack (task 7) would NEWLY fire history-search and
    // the todo panel from inside it, through Global.
    "ctrl+r": null, "ctrl+t": null,
    // Chat's alt+p/alt+t (model picker / thinking) could otherwise fire through a still-registered Chat scope
    // in the passive-flush sub-tick after this overlay mounts (two keys in one chunk) — t7 review.
    "alt+p": null, "alt+t": null,
    // ctrl+b is REBOUND above (scroll:fullPageUp), which left its chord alias as the one Global-family key still
    // reaching `Task` from inside the pager: `ctrl+x ctrl+b` backgrounded the running turn from a surface that
    // owns every other key on screen (final review, deferred t8 minor). Same null, same zero cost, as Select's.
    "ctrl+x ctrl+b": null,
  }},
  { context: "HistorySearch", bindings: {
    "ctrl+r": "historySearch:next", "escape": "historySearch:accept", "tab": "historySearch:accept",
    "ctrl+c": "historySearch:cancel", "enter": "historySearch:execute", "ctrl+s": "historySearch:cycleScope",
    // owner === "overlay" (state.historyOpen, ChatApp.tsx:80): the root globals never reach the visible overlay.
    // ctrl+r/ctrl+c above are rebindings, not survivals; the remaining four are dead today and stay dead.
    "ctrl+o": null, "ctrl+t": null, "ctrl+b": null, "ctrl+d": null,
    "alt+p": null, "alt+t": null,   // same passive-flush sub-tick hole as Transcript's (t7 review)
    "ctrl+x ctrl+b": null,          // …and ctrl+b's chord alias with it (final review; see Select)
  }},
  { context: "MessageSelector", bindings: {
    "up": "messageSelector:up", "down": "messageSelector:down", "enter": "messageSelector:select",
    "escape": "messageSelector:dismiss",
    "k": "messageSelector:up", "j": "messageSelector:down",                       // NEW (KB14)
    "ctrl+p": "messageSelector:up", "ctrl+n": "messageSelector:down",             // NEW (KB14)
    "ctrl+up": "messageSelector:top", "shift+up": "messageSelector:top", "alt+up": "messageSelector:top", "shift+k": "messageSelector:top",          // NEW (KB14)
    "ctrl+down": "messageSelector:bottom", "shift+down": "messageSelector:bottom", "alt+down": "messageSelector:bottom", "shift+j": "messageSelector:bottom", // NEW (KB14)
    // RewindPicker is an "overlay" owner (state.rewindPicker.open) — same total suppression as Select/Settings.
    "ctrl+c": null, "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null,   // same passive-flush sub-tick hole as Transcript's (t7 review)
    "ctrl+x ctrl+b": null,          // …and ctrl+b's chord alias with it (final review; see Select)
  }},
  { context: "Select", bindings: {
    "up": "select:previous", "down": "select:next", "j": "select:next", "k": "select:previous",
    "ctrl+n": "select:next", "ctrl+p": "select:previous",
    "enter": "select:accept", "escape": "select:cancel",
    "pageup": "select:pageUp", "pagedown": "select:pageDown", "home": "select:first", "end": "select:last",  // NEW (KB15)
    // The list overlays (SessionPicker, ModelPicker, BgTasksPanel…) are all "overlay" owners: ChatApp.tsx:145
    // returns before every root global, so none of Global's six reaches them. ctrl+d has no root handler at all —
    // its owner check is the composer's (ChatComposer.tsx:165), and the composer is unmounted behind an overlay.
    "ctrl+c": null, "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null,   // same passive-flush sub-tick hole as Transcript's (t7 review)
    // …and ctrl+b's CHORD ALIAS with it (t8 review). `Task` stays pushed for the whole turn and sits below
    // every overlay, so unbinding only the plain key left `ctrl+x ctrl+b` backgrounding the turn from inside
    // the picker — one key dead while its alias fired, the split this table exists to remove. Free: a null
    // chord never arms its own prefix (resolver.ts), it is only consulted during the pending walk.
    "ctrl+x ctrl+b": null,
  }},
  // F6 T2 review, Important 1. `Select`'s eight actions with `Confirmation`'s SUPPRESSION set instead of its
  // own — the context a list pushes when it is a DECISION surface (a dialog answering the model) rather than an
  // OVERLAY (a picker the user opened). The distinction is upstream's, expressed in its owner gate; ours is a
  // context stack, so it needs a second name. Without it, moving QuestionDialog's multiSelect onto the `Select`
  // primitive silently killed five root globals over a parked question — Ctrl-C could no longer arm the exit
  // hint and Ctrl-O could no longer open the pager, both of which stay live over the single-select branch's
  // `Confirmation` scope deliberately (see that block's comment, and ChatApp.tsx:126-159).
  //
  // Every F6 surface that answers the MODEL passes `context="SelectDecision"` to `Select`/`MultiSelect`;
  // pickers the USER opened keep the default `"Select"`. Tasks 5-9 (permission and plan dialogs) inherit this.
  { context: "SelectDecision", bindings: {
    "up": "select:previous", "down": "select:next", "j": "select:next", "k": "select:previous",
    "ctrl+n": "select:next", "ctrl+p": "select:previous",
    "enter": "select:accept", "escape": "select:cancel",
    "pageup": "select:pageUp", "pagedown": "select:pageDown", "home": "select:first", "end": "select:last",
    // Only the two `Confirmation` kills, for exactly its reasons: the composer that owns ctrl+d is unmounted
    // while a dialog is up, and alt+p/alt+t are CHAT keys whose scope is already off the stack (the nulls only
    // close the passive-flush sub-tick). ctrl+c/ctrl+o/ctrl+t/ctrl+r/ctrl+b are deliberately ABSENT — a
    // decision dialog keeps every root global, and adding a null here would be the defect this context fixes.
    "ctrl+d": null, "alt+p": null, "alt+t": null,
  }},
  { context: "Confirmation", bindings: {
    "enter": "confirm:yes", "escape": "confirm:no", "up": "confirm:previous", "down": "confirm:next",
    "y": "confirm:yes", "n": "confirm:no",          // F0 fix, re-homed
    // F6 T7, upstream L505895 (`co({"confirm:cycleMode": A}, {context:"Confirmation"})` inside `Cem`): the
    // file dialog's session rows PRINT this chord inside their own labels ("…during this session (shift+tab)",
    // `tal` L505626), so the label is a lie unless the key it names picks that row. It is the same physical
    // chord as Chat's `chat:cycleMode`, and that is not a collision: with T5's active-gating the composer's
    // `Chat` scope is off the stack while a dialog owns the keyboard, so exactly one of the two ever resolves.
    // A dialog that registers no handler for it (Bash, the generic body) falls through to the fallback, which
    // is where shift+tab already went before this line existed — adding it changes nothing for them.
    "shift+tab": "confirm:cycleMode",
    // owner === "decision" fell THROUGH the old gate (only "overlay" returned early), so ctrl+c/o/r/t/b stay
    // live over a visible dialog — deliberately, per the ChatApp comment — and must not be unbound here.
    // Only ctrl+d is dead: the composer that owns it is unmounted while the dialog is up. (F6 t5 tested that
    // premise and it held — upstream hides the prompt input whenever a dialog is VISIBLE, `KVf` L549494; the
    // one state in which the composer outlives a parked decision is SUPPRESSION, where no dialog renders and
    // this context is not on the stack at all.)
    "ctrl+d": null,
    // alt+p/alt+t are CHAT keys, not root globals: with the composer unmounted behind any Confirmation surface
    // the Chat scope is off the stack and they already resolve to nothing. The nulls make the passive-flush
    // sub-tick (where the Chat scope is still registered for one flush) behave the same as the steady state
    // instead of newly opening the model picker over a dialog — same hole as Transcript's (t7 review).
    "alt+p": null, "alt+t": null,
  }},
  { context: "Settings", bindings: {
    "escape": "confirm:no", "up": "select:previous", "down": "select:next", "k": "select:previous",
    "j": "select:next", "ctrl+p": "select:previous", "ctrl+n": "select:next",
    "space": "select:accept", "enter": "select:accept", "/": "settings:search",
    // SettingsDialog (with PermissionsDialog/ThemeDialog/AddDirDialog) is an "overlay" owner — same suppression.
    "ctrl+c": null, "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null,   // same passive-flush sub-tick hole as Transcript's (t7 review)
    "ctrl+x ctrl+b": null,          // ctrl+b's chord alias, dead here for the same reason (see Select)
  }},
  { context: "Tabs", bindings: {
    "tab": "tabs:next", "shift+tab": "tabs:previous", "right": "tabs:next", "left": "tabs:previous",
  }},
];

/** Exactly the action names the table uses, plus `help:show` — bound to nothing by default (the `?` that opens the
 *  overlay is composer-local) but nameable in a user rebinding, so it must validate. ChatApp registers its handler
 *  (final review): an action that validates and resolves but reaches nobody is a rebind that silently does nothing. */
export const VALID_ACTIONS: readonly string[] = [
  "app:interrupt", "app:exit", "app:toggleTranscript", "app:toggleTodos", "history:search", "task:background",
  "chat:cancel", "chat:clearInput", "chat:cycleMode", "chat:killAgents", "chat:externalEditor", "chat:modelPicker", "chat:thinkingToggle",
  "autocomplete:dismiss", "autocomplete:accept",
  "help:dismiss", "help:show",
  "transcript:exit", "transcript:toggleShowAll",
  "scroll:halfPageUp", "scroll:halfPageDown", "scroll:fullPageUp", "scroll:fullPageDown", "scroll:lineUp", "scroll:lineDown",
  "scroll:top", "scroll:bottom", "scroll:pageUp", "scroll:pageDown",
  "historySearch:next", "historySearch:accept", "historySearch:cancel", "historySearch:execute", "historySearch:cycleScope",
  "messageSelector:up", "messageSelector:down", "messageSelector:select", "messageSelector:dismiss", "messageSelector:top", "messageSelector:bottom",
  "select:previous", "select:next", "select:accept", "select:cancel", "select:pageUp", "select:pageDown", "select:first", "select:last",
  "confirm:yes", "confirm:no", "confirm:previous", "confirm:next", "confirm:cycleMode",
  "settings:search",
  "tabs:next", "tabs:previous",
];

/** Keys a USER may not rebind (upstream `vQr`/`d_s`/`p_s`, 06 §1.4), keyed by the canonical spec string — so
 *  `cmd+c` and `super+c` hit the same entry. Validation-only: the default table above still binds a few of these
 *  (ctrl+c/ctrl+d) because ccx hardcodes their semantics; that is the grandfathered set, pinned by the tests.
 *  The macOS block is included unconditionally — ccx targets darwin first, and reserving a super+ chord costs
 *  nothing on Linux, where the terminal does not deliver it anyway. `ctrl+z` is a warning, not an error: ccx
 *  handles SIGTSTP pre-table (task 5), above context dispatch. */
export const RESERVED_KEYS: Record<string, { reason: string; severity: "error" | "warning" }> = {
  "ctrl+c": { reason: "Cannot be rebound - used for interrupt/exit (hardcoded)", severity: "error" },
  "ctrl+d": { reason: "Cannot be rebound - used for exit (hardcoded)", severity: "error" },
  "ctrl+m": { reason: "Cannot be rebound - identical to Enter in terminals (both send CR)", severity: "error" },
  "capslock": { reason: "Caps Lock is not delivered to terminal applications", severity: "error" },
  "ctrl+z": { reason: "Unix process suspend (SIGTSTP)", severity: "warning" },
  "ctrl+\\": { reason: "Terminal quit signal (SIGQUIT)", severity: "error" },
  "super+c": { reason: "macOS system copy", severity: "error" },
  "super+v": { reason: "macOS system paste", severity: "error" },
  "super+x": { reason: "macOS system cut", severity: "error" },
  "super+q": { reason: "macOS quit application", severity: "error" },
  "super+w": { reason: "macOS close window/tab", severity: "error" },
  "super+tab": { reason: "macOS app switcher", severity: "error" },
  "super+space": { reason: "macOS Spotlight", severity: "error" },
};
