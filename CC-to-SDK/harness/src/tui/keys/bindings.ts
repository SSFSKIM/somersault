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

/** The 22 valid contexts: upstream's 20 (06 §1.1/§1.2 — the 19 with default bindings plus `DiffPanel`, which
 *  validates but ships no binding upstream either) plus OUR `SelectDecision` and `SessionPicker`. A context
 *  name outside this list is a config error, not a silent no-op.
 *
 *  BOTH additions exist for the same reason, and it is always the same reason: upstream's key layer routes by
 *  OWNER (and, for the resume picker, by a raw `onKeyDown` on the container — `moi`, bundle L476609, which
 *  reads `space`/`ctrl+r`/`/`/printables straight off the event), while ours routes by CONTEXT NAME. A
 *  surface upstream never had to name therefore needs a name here.
 *   · `SelectDecision` — a `Select` list can be an overlay OR a decision surface; see its block below.
 *   · `SessionPicker` — the resume picker's own keys (`space` = preview, `ctrl+r` = rename) cannot live in
 *     `Select`: that context is SHARED by every list in the app and it explicitly unbinds `ctrl+r`, and an
 *     unbind resolves as CONSUMED, so no fallback could ever see the key. See its block below. */
export const VALID_CONTEXTS: readonly KeyContextName[] = ["Global", "Chat", "Autocomplete", "Confirmation", "Help",
  "Transcript", "HistorySearch", "Task", "ThemePicker", "Settings", "Tabs", "Attachments", "Footer",
  "MessageSelector", "DiffDialog", "DiffPanel", "ModelPicker", "Select", "SelectDecision", "SessionPicker",
  "Plugin", "Scroll", "EffortDialog"];

/** One context's bindings. `string` = an action name from `VALID_ACTIONS`; `null` = unbound in this context. */
export interface ContextBindings { context: KeyContextName; bindings: Record<string, string | null> }

// ── CTRL-C-FALLS-THROUGH (Wave 2 task 3, EP-D2c; s2qa4-11). The overlay suppression sets below are five root
// globals, not six: `ctrl+c` is NOT among them, and no context may re-add it as a null.
//
// The other five OPEN a surface (history search, the pager, the todo panel, the bg panel, the model picker)
// on top of one that already owns the screen, so an overlay is right to eat them. `ctrl+c` does not open
// anything — it is the exit gesture, bound in `Global` to `app:interrupt`, whose handler runs ChatApp's
// 800 ms double-press arm. Unbinding it did not "keep the key local", it DELETED the only way out: an
// explicit unbind resolves `{type:"unbound"}` and `KeymapProvider`'s dispatch treats that as CONSUMED, so it
// reaches no lower scope and no fallback — and because the REPL reads raw stdin, `\x03` is a keystroke rather
// than a signal, so there is no SIGINT underneath to catch what the table dropped. Ctrl-C Ctrl-C over
// `/model` was simply a no-op. Canon binds the same latch on the dialog's own scope (L184112/L183445) and
// exits on the second press inside the window.
//   Consistent with the two blocks that already said so: `Confirmation` and `SelectDecision` both leave
// `ctrl+c` deliberately ABSENT so it stays live over a parked decision. This makes the overlays agree.
//   `Transcript` and `HistorySearch` are the exception and stay as they are: they REBIND ctrl+c
// (`transcript:exit` / `historySearch:cancel`) because those surfaces genuinely own the key — a binding
// shadows Global exactly as an unbind did, and closing the surface is the local meaning of the gesture.

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
    // F9 T-IMAGE (I2), canon L174817: `ctrl+v` mac/linux, `alt+v` windows, BOTH under wsl — and since this
    // table has no platform axis (ccx targets darwin first; see RESERVED_KEYS's own unconditional macOS
    // block for the same call made once already), both bind unconditionally rather than growing one. A
    // terminal that never delivers one of the two costs nothing for having it bound.
    "ctrl+v": "chat:imagePaste", "alt+v": "chat:imagePaste",
  }},
  { context: "Autocomplete", bindings: {   // pushed by ChatComposer while a / or @ popup is open (state.command || state.mention)
    "escape": "autocomplete:dismiss",
    "tab": "autocomplete:accept",          // up/down stay in the composer fallback (editor list nav)
  }},
  { context: "Task", bindings: {        // pushed while a turn is running in the foreground
    "ctrl+x ctrl+b": "task:background", // NEW (KB18) — upstream's chord alias
  }},
  // F6 T14: the `?` overlay pushes this and ALSO swallows (F0 escape-only), so for it the nulls below are
  // redundant. `/help`'s dialog cannot swallow — `swallowContexts` (registry.ts) resolves the swallower as the
  // INNERMOST live scope, and that dialog mounts `Tabs` and `Select` inside itself, so a swallow there would
  // leave only the tab strip's four keys live and eat its own Escape. It is an "overlay" owner like Settings
  // and Select, so it takes their suppression set instead: FIVE root globals (see CTRL-C-FALLS-THROUGH below)
  // plus the two Chat keys whose scope survives one passive flush, plus ctrl+b's chord alias.
  // QA WAVE 2 DELTA — and the `?` overlay needs ctrl+c SPELLED OUT, which is why this context binds a key it
  // could otherwise inherit. Absence is enough everywhere Task 3 reached, because an unbound key falls through
  // to `Global`. It is not enough under a SWALLOW: `swallowContexts` narrows resolution to the swallower's own
  // context and `Global` is not in that list, so the overlay ate the exit gesture with no null anywhere to
  // explain it. Naming Global's own action here is the narrowest repair — the press resolves in `Help`,
  // `handlerFor` finds ChatApp's one `app:interrupt` handler (action lookup spans the whole stack), and the
  // 800 ms arm behind it is the same one every other surface reaches. The dialog that shares this context —
  // `/help`, which does not swallow — is unaffected: it resolved to the identical action through `Global`.
  // First press ARMS only: `onFirstPress`'s draft clear is gated on `composerOwns`, and this overlay owns the
  // input (ChatApp's `inputOwnerRef` reads "shortcuts"), which is canon's own `h5u`/`Pee` split (D-W10).
  { context: "Help", bindings: {
    "escape": "help:dismiss",
    "ctrl+c": "app:interrupt",
    "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null, "ctrl+x ctrl+b": null,
  }},
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
    // FSW BACKLOG 5 — the wheel, on the pager's own line pair. It has to be bound HERE as well as in `Scroll`
    // because the fullscreen tree SWAPS the two rather than stacking them: `RegionPager` renders INSTEAD OF
    // `FullscreenViewport` (ChatApp.tsx:1181-1189), so for as long as the pager is open no `Scroll` block is
    // mounted at all. Unbound here, a tick would resolve to nothing — the wheel would be DEAD on the one
    // surface that exists to be read, not misdirected onto something underneath it.
    "wheelup": "scroll:lineUp", "wheeldown": "scroll:lineDown",
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
  // FSW TASK 11 — `Scroll`, upstream's own name for "a scrollable view is focused (fullscreen layout)". It has
  // been in VALID_CONTEXTS since F2 and bound NOTHING, because until the fullscreen renderer grew a virtual
  // region there was no such view: the main screen scrolls in the TERMINAL, not in the app.
  //
  // FOUR KEYS OF CANON'S BLOCK (bundle 446135-446250, grounding §3.5), and the rest deliberately left unbound.
  // The block there also carries `wheelup`/`wheeldown` and seven selection-extension/copy chords; mouse and
  // in-frame selection are not in this wave, and an action name that resolves but reaches no handler is the
  // dishonest rebind F2 exists to remove (the same reasoning that held ModelPicker's effort pair back at F6).
  //
  // FSW BACKLOG 5 TAKES THE WHEEL PAIR BACK, ON THE OWNER'S BUG REPORT, AND THE EXCLUSION ABOVE WAS RIGHT WHEN
  // IT WAS WRITTEN. `wheelup`/`wheeldown` were unproducible: ccx never armed mouse reporting, so no tick could
  // ever reach the table. What made that a BUG rather than a missing feature is what the terminal does instead
  // — with the alternate screen up and reporting off it translates wheel ticks into bare ARROW KEYS, which
  // reached the composer and walked prompt history. So the pair is not "mouse support"; it is the correction
  // that stops the wheel meaning something else. `altScreen.ts` arms canon's `scroll` set, `parse.ts` names the
  // two ticks (canon `RUu`, L169140), and one tick is one LINE — canon's own delta (L181212 dispatches ±1).
  // Click, motion, hover and selection remain unbound and unarmed.
  //
  // PGUP/PGDN ARE HALF PAGES, AND THAT IS NOT A TYPO OF UPSTREAM'S OR OURS. Canon binds them to
  // `scroll:pageUp`/`pageDown` and then its handler moves `floor(getViewportHeight() / 2)` (446159-446174) —
  // the action NAME says page, the behaviour is half. We keep the behaviour and fix the name by pointing the
  // keys at the half-page entries of the SAME `PAGER_ACTIONS` map, which is why this is a per-context binding
  // rather than an edit to that map: `Transcript` (ctrl+O) names the full-page entries with the same two keys,
  // and its own PgUp semantics are separately grounded. One map, two contexts, no surface renamed to describe
  // the other.
  //
  // NO SUPPRESSION BLOCK, unlike every dialog above. This is the BACKGROUND context of the fullscreen renderer,
  // not an overlay over it: the composer is still live in the dock below, and all six root globals must keep
  // falling through to `Global`. The context is registered by `FullscreenViewport` with canon's own gate —
  // `isActive: t && !cbr()` (446211), i.e. live in fullscreen EXCEPT while a history search owns the dock,
  // where the search's own PgUp/PgDn are the ones that must fire.
  //
  // FSW TASK 12 ADDS THE FIFTH KEY, AND IT IS A PRINTABLE ONE. `v` is canon's transcript dump (L549336, and
  // advertised on canon's own transcript screen as `v to open in ${editor}`, L547303): render the whole
  // conversation to a file and open it in `$VISUAL`/`$EDITOR`. It is the scrollback escape hatch — this
  // renderer's exit gives the user their shell back with the conversation absent, on purpose — so it belongs
  // to the surface that HAS no scrollback, i.e. here rather than in the ctrl+O pager's block (plan review I5).
  //   THE COLLISION IS REAL AND IS HANDLED ONE LAYER OUT. Canon can bind a bare letter because its `v` lives
  // on a transcript SCREEN with no composer (`zPe = lr === "transcript"`, L549291); ours is the background
  // context of a renderer whose composer is live in the dock, resolution finds no `v` in `Chat`, and a
  // handler registered unconditionally would eat the letter out of every word typed. It is not the TABLE's
  // job to know that — a per-key gate is not something a context block can express — so `FullscreenViewport`
  // registers the handler only while the jump pill is up, and `KeymapProvider` falls a matched action with no
  // handler through to the composer (`:177-180`). The key is bound here; whether it is LIVE is a property of
  // what the screen is currently saying.
  { context: "Scroll", bindings: {
    "pageup": "scroll:halfPageUp", "pagedown": "scroll:halfPageDown",
    "ctrl+home": "scroll:top", "ctrl+end": "scroll:bottom",
    "wheelup": "scroll:lineUp", "wheeldown": "scroll:lineDown",
    "v": "scroll:dumpTranscript",
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
  // F6 T10 rebuilt the rewind picker on the `Select` primitive, and this block shrank to what Select does not
  // already do. The picker still pushes `MessageSelector`, but it now sits OUTSIDE the `Select` its list is —
  // so up/down/j/k/ctrl+n/ctrl+p/enter all resolve one layer in, at `Select`, and their old entries here would
  // have been a lie in the table (the actions they named have no handler any more). What Select has no key for
  // is upstream's jump pair, so those eight keys stay, RETARGETED onto Select's own first/last actions:
  // resolution finds them in this context, and `handlerFor` (registry.ts) looks a handler up by ACTION NAME
  // across the whole stack, so Select's `select:first`/`select:last` answer them. The picker keeps `home`/`end`
  // from Select as well — a superset of what it had, not a trade.
  // `escape` stays a MessageSelector action because it is the ONE key the picker must still answer with no
  // Select mounted: the empty state ("Nothing to rewind to yet.") renders no list at all.
  { context: "MessageSelector", bindings: {
    "escape": "messageSelector:dismiss",
    "ctrl+up": "select:first", "shift+up": "select:first", "alt+up": "select:first", "shift+k": "select:first",          // KB14, retargeted (F6 T10)
    "ctrl+down": "select:last", "shift+down": "select:last", "alt+down": "select:last", "shift+j": "select:last",        // KB14, retargeted (F6 T10)
    // RewindPicker is an "overlay" owner (state.rewindPicker.open) — same suppression as Select/Settings, minus
    // ctrl+c (CTRL-C-FALLS-THROUGH).
    "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null,   // same passive-flush sub-tick hole as Transcript's (t7 review)
    "ctrl+x ctrl+b": null,          // …and ctrl+b's chord alias with it (final review; see Select)
  }},
  // F6 T11. Upstream's own block, transcribed WHOLE from the keymap table at L186118. F6 held the two EFFORT
  // keys back (DG48: the effort axis was a probe-gated non-goal, and an action name that resolves but reaches
  // no handler is the dishonest rebind F2 exists to remove); WAVE C TASK 11 ships the axis and they come back
  // with it, handled by `ModelPicker.tsx`.
  //
  // No suppression block, and that is upstream's shape too: the picker always has a `Select` mounted inside
  // it, and `Select`'s own nulls (below) kill the six root globals for the whole time it is on screen.
  { context: "ModelPicker", bindings: {
    "left": "modelPicker:decreaseEffort", "right": "modelPicker:increaseEffort", "s": "modelPicker:thisSessionOnly",
  }},
  // WAVE C TASK 11 — the STANDALONE `/effort` dialog (annex §C6.4). Upstream has no context for it: `L447278`
  // reads left/right/return/escape raw off its own container, exactly as the resume picker does, so ccx —
  // which routes every key through a named context — has to give it one. Its two arrows are the SAME actions
  // the picker binds (one handler name, two surfaces); accept/cancel REUSE `Select`'s action names rather
  // than minting `effort:confirm`/`effort:cancel`, the same retargeting `MessageSelector` does onto
  // `select:first`/`select:last` — the dialog has one value, not a list, so there is no `Select` inside it to
  // answer them and no ambiguity in borrowing the names.
  //   It DOES need the suppression block the ModelPicker block can do without, and that is the whole reason
  // the two differ: with no inner `Select` mounted, nothing else in this dialog kills the root globals.
  // (ctrl+c is not one of them any more — CTRL-C-FALLS-THROUGH.)
  { context: "EffortDialog", bindings: {
    "left": "modelPicker:decreaseEffort", "right": "modelPicker:increaseEffort",
    "enter": "select:accept", "escape": "select:cancel",
    "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null,   // same passive-flush sub-tick hole as Transcript's (t7 review)
    "ctrl+x ctrl+b": null,          // …and ctrl+b's chord alias with it
  }},
  // F6 T11 — the resume picker. Upstream has NO context for it: `moi` (L476609) hangs a raw `onKeyDown` on
  // its container and reads `space`/`ctrl+r`/`/`/printables off the event, reaching for existing contexts
  // only to cancel its rename (`Mn("confirm:no", …, {context:"Settings", isActive: te==="rename"})`,
  // L476537). We route by context name, so the surface needs one — and it CANNOT be `Select`:
  //   · `Select` is shared by every list in the app; `space`/`ctrl+r` there would move preview and rename
  //     into the theme picker, the bg panel and every permission dialog;
  //   · `Select` explicitly unbinds `ctrl+r` (below), and an unbind resolves `{type:"unbound"}`, which
  //     `dispatch` treats as CONSUMED — a rename bound "by fallback" could never fire at all.
  // The picker pushes this context PREEMPTIVELY (SessionPicker.tsx says why: an ordinary scope would sit
  // BELOW its own `Select`, whose `ctrl+r: null` would then eat the rename key). So these three keys win
  // everywhere, at every stage — including `escape` in the list stage, where the inner Select's
  // `select:cancel` consequently never resolves. `sessionPicker:dismiss` routes the list stage to the same
  // function the Select's `onCancel` names, which is what keeps that behaviour-neutral; it also answers
  // escape in the rename and preview stages, where no Select is mounted at all.
  //
  // The handlers are registered PER MODE (SessionPicker.tsx), not per binding: with no handler a matched
  // action falls through to the fallback (KeymapProvider's dispatch), which is how `space` types a space
  // into the rename field instead of opening a preview.
  { context: "SessionPicker", bindings: {
    "space": "sessionPicker:preview", "ctrl+r": "sessionPicker:rename", "escape": "sessionPicker:dismiss",
    // Wave S T10: the two widen controls (`fr`, L476542). They MUST be bound here — SessionPicker.tsx's own
    // fallback drops anything with `key.ctrl` set, so an unbound \x01 would reach nobody. `ctrl+b` (upstream's
    // third, all-branches) stays NULL below: CTRL-B-1, a permanent recorded divergence, not an omission to fix.
    "ctrl+a": "sessionPicker:allProjects", "ctrl+w": "sessionPicker:allWorktrees",
    // An overlay owner, like Select/Settings/MessageSelector — and it needs its OWN copy of the suppression
    // rather than leaning on the inner Select's, because rename and preview unmount that Select. ctrl+r is
    // REBOUND above rather than nulled (HistorySearch's precedent, same reasoning: the surface owns the key);
    // ctrl+c is absent for the opposite reason — nobody here owns it (CTRL-C-FALLS-THROUGH).
    "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+b": null,
    "alt+p": null, "alt+t": null,
    "ctrl+x ctrl+b": null,
  }},
  { context: "Select", bindings: {
    "up": "select:previous", "down": "select:next", "j": "select:next", "k": "select:previous",
    "ctrl+n": "select:next", "ctrl+p": "select:previous",
    "enter": "select:accept", "escape": "select:cancel",
    "pageup": "select:pageUp", "pagedown": "select:pageDown", "home": "select:first", "end": "select:last",  // NEW (KB15)
    // The list overlays (SessionPicker, ModelPicker, BgTasksPanel…) are all "overlay" owners: ChatApp.tsx:145
    // returned before every root global, so none of Global's six reached them. FIVE of the six still do not —
    // ctrl+c is the exception the block above names (CTRL-C-FALLS-THROUGH), and it was the expensive one: this
    // context is pushed by EVERY list in the app, so its null is what made Ctrl-C Ctrl-C a no-op over `/model`.
    // ctrl+d has no root handler at all — its owner check is the composer's (ChatComposer.tsx:165), and the
    // composer is unmounted behind an overlay.
    "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
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
    // F6 T9-fix: a decision dialog can be TALLER THAN THE SCREEN (the plan dialog is), so it needs a reading
    // path — and these are the pager's own two keys for it (`Transcript` above, same actions, same halves).
    // ctrl+d TOOK THE PLACE OF A `null` here and still does that null's whole job: its only purpose was to
    // stop Global's `app:exit` firing under a dialog whose composer is unmounted, and a context that BINDS
    // the key shadows Global just as an unbind does. It has to be a binding rather than the Select's
    // `onUnhandledKey`, because an explicit unbind resolves to `{type:"unbound"}`, which `dispatch` treats as
    // CONSUMED — an unbound key never reaches a fallback at all. A dialog that registers no handler for these
    // (every permission body) falls through to whoever owns the actions below it: nowhere on the main screen,
    // but in FULLSCREEN the region's `Scroll` context claims both, so ctrl+u/ctrl+d scroll the transcript
    // above the dock while a permission dialog is up. Safe — the dialog lives in the dock's disjoint row band
    // and PlanDialog registers its own handlers and still wins — but a DELIBERATE DIVERGENCE: the live capture
    // (fullscreen grounding L2.3) records both keys as inert in canonical fullscreen.
    "ctrl+u": "scroll:halfPageUp", "ctrl+d": "scroll:halfPageDown",
    // alt+p/alt+t are CHAT keys whose scope is already off the stack (the nulls only close the passive-flush
    // sub-tick). ctrl+c/ctrl+o/ctrl+t/ctrl+r/ctrl+b are deliberately ABSENT — a decision dialog keeps every
    // root global, and adding a null here would be the defect this context fixes.
    "alt+p": null, "alt+t": null,
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
    // F6 T9, upstream `tYf` L501036 (`iMn.ctrl && iMn.key === "g"` inside the plan dialog's own `Zl`
    // onKeyDown): the `Ready to code?` dialog opens its plan in $EDITOR. Upstream reads the chord as a raw
    // key event and PRINTS it as a hardcoded literal (`$e({chord:"ctrl+g"})`, L501126) rather than resolving
    // it from a keymap; ours goes through the table so a rebind moves the key, which is the whole point of
    // F2. It is the same physical chord Chat binds to `chat:externalEditor` and, exactly like shift+tab
    // above, the two never resolve together: the composer's `Chat` scope is off the stack while a dialog
    // owns the keyboard. A dialog that registers no handler falls through to the Select's fallback, where a
    // ctrl-modified key is already inert.
    "ctrl+g": "confirm:editExternal",
    // Wave T t7, upstream L505015 (`pA("confirm:toggleExplanation","Confirmation","ctrl+e")` inside `ZMn`):
    // the consult dialogs' "explain this command" toggle. Registered by a body only when an explainer
    // transport is wired (BashPermission.tsx), and a body that registers no handler falls through to the
    // fallback exactly as it does for shift+tab/ctrl+g above — which is what keeps the feedback row's
    // readline ctrl+e (end-of-line) working in every dialog that has no explainer.
    "ctrl+e": "confirm:toggleExplanation",
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
    // SettingsDialog (with PermissionsDialog/ThemeDialog/AddDirDialog) is an "overlay" owner — same suppression,
    // ctrl+c excepted (CTRL-C-FALLS-THROUGH).
    "ctrl+d": null, "ctrl+o": null, "ctrl+t": null, "ctrl+r": null, "ctrl+b": null,
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
  "chat:cancel", "chat:clearInput", "chat:cycleMode", "chat:killAgents", "chat:externalEditor", "chat:modelPicker", "chat:thinkingToggle", "chat:imagePaste",
  "autocomplete:dismiss", "autocomplete:accept",
  "help:dismiss", "help:show",
  "transcript:exit", "transcript:toggleShowAll",
  "scroll:halfPageUp", "scroll:halfPageDown", "scroll:fullPageUp", "scroll:fullPageDown", "scroll:lineUp", "scroll:lineDown",
  "scroll:top", "scroll:bottom", "scroll:pageUp", "scroll:pageDown",
  "scroll:dumpTranscript",                        // FSW T12 — `v`, the fullscreen scrollback escape hatch
  "historySearch:next", "historySearch:accept", "historySearch:cancel", "historySearch:execute", "historySearch:cycleScope",
  // The other five messageSelector actions retired with F6 T10 (see the MessageSelector block): the picker's
  // list IS a `Select` now, so moving/accepting there are Select's actions, and a name this table no longer
  // binds must not stay validatable — `keys-bindings.test.ts` pins VALID_ACTIONS to exactly the table's use.
  "messageSelector:dismiss",
  // F6 T11 + WAVE C TASK 11. `modelPicker:decreaseEffort`/`increaseEffort` are upstream's other two ModelPicker
  // actions, held back at F6 with the effort axis and declared now that it ships (both the picker's row and the
  // standalone EffortDialog bind them). The five `sessionPicker:*` names are OURS — upstream reads those keys
  // raw (see the block); the last two arrived with Wave S T10's widen controls.
  "modelPicker:thisSessionOnly", "modelPicker:decreaseEffort", "modelPicker:increaseEffort",
  "sessionPicker:preview", "sessionPicker:rename", "sessionPicker:dismiss",
  "sessionPicker:allProjects", "sessionPicker:allWorktrees",
  "select:previous", "select:next", "select:accept", "select:cancel", "select:pageUp", "select:pageDown", "select:first", "select:last",
  "confirm:yes", "confirm:no", "confirm:previous", "confirm:next", "confirm:cycleMode", "confirm:editExternal", "confirm:toggleExplanation",
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
