# Shared brief — the TUI-to-GUI translation study for afleet

Read this whole file before doing anything else. Every lane produces one Markdown file of
**surface cards** for one family of terminal surfaces. The orchestrator assembles the map,
the backlog and the roadmap proposal from the cards, so the cards are the product.

## 0. Absolute paths

The study lives in the somersault repository at `/Users/new/Developer/GitHub/somersault/tui-to-gui/`.
afleet, the consumer of the study, is a separate repository and is **read-only input** here:
never write under it. Every path below is absolute; never use a relative path for a read or a grep.

| What | Absolute path |
|---|---|
| afleet repo (the consumer of this study) | `/Users/new/developer/github/afleet` |
| afleet root design spec (4,785 lines; §8 shell, §7.7 command router, §8.4 cards, §14 acceptance items 1–64, §17 roadmap, Decision Log) | `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md` |
| afleet child specs (C5 shell, C6 conversation surface + C6.1 renderer, C6.2 composer, C6.3 decisions; C7 panels + leaves) | `/Users/new/developer/github/afleet/docs/doperpowers/specs/` |
| afleet Swift sources: app layer | `/Users/new/developer/github/afleet/App/` (subdirs: Activity, Agents, Composer, Consent, Decisions, Fleet, Header, Notifications, Panels, Shell, Switcher, Threads, Timeline, Views) |
| afleet Swift sources: packages | `/Users/new/developer/github/afleet/FleetKit`, `.../Workbench`, `.../ClaudeWire`, `.../AfleetCore` |
| afleet protocol gap inventory (P/R/D/X/T per affordance; README = map, `areas/` = detail, `evidence/` = live captures) | `/Users/new/developer/github/afleet/docs/tui-parity/` |
| afleet tech-debt tracker | `/Users/new/developer/github/afleet/docs/tech-debt-tracker.md` |
| **Canon: Claude Code 2.1.263 spec library** (55 chapters; cite as `SPEC 41.15.4` etc.; citations inside it are `cli.pretty.js:LINE` or `chunk-*.js:LINE`) | `/Users/new/claude-code-bundle/2.1.263/SPEC/` |
| 2.1.263 pretty-printed binary, for verifying a spec claim | `/Users/new/claude-code-bundle/2.1.263/cli.pretty.js` (grep it; `tools/where.py` resolves literals) |
| Older cuts if a version comparison matters | `/Users/new/claude-code-bundle/2.1.257/SPEC/`, `.../2.1.251/` |
| The somersault TUI clone's scorecard: 667 rows of terminal surfaces we built, with canon quirks learnt at implementation contact (§1 composer, §1a keybindings, §2 transcript, §3 chrome, §4 modals, §5 slash commands, §6 polish, §8 control plane; plus per-wave sections) | `/Users/new/Developer/GitHub/somersault/CC-to-SDK/docs/parity/tui-ux.md` |
| The clone's design specs per surface family (F5 composer, F6 dialogs/pickers/panels, wave C chrome/composer, fullscreen, wave T trust, wave S session truth) | `/Users/new/Developer/GitHub/somersault/CC-to-SDK/docs/superpowers/specs/` |
| The clone's source, if you need to see how a surface behaves in code | `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/` |
| Last week's cross-check of the spec against the clone (ledger corrections, defects, unknown unknowns) | `/Users/new/Developer/GitHub/somersault/CC-to-SDK/docs/parity/spec-crosscheck-2026-09-03.md` |

Output directory (write your file here, nowhere else):
`/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/<lane>.md`

The study's map, which the cards feed: `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md`.

## 1. What this study is

afleet is a native macOS app that hosts the unmodified `claude` binary over its headless
stream-json protocol and presents every session on the machine in a Slack-shaped window:
projects as sidebar sections, sessions as channels, an Activity view, the conversation in
the middle, and a right-hand panel with Thread, Agents, Files, Source Control, Terminal,
Browser and GitHub tabs. Seven children have merged; the app runs. Read the root spec's §1,
§2 (vocabulary), §8 (the shell) and §7.7 (the command router) first — they are the target
the terminal is translated into.

The Slack adoption is a **skeleton only**: sidebar, channels, threads, Activity, badges.
Around it afleet adds its own agent-workspace features. Do not force terminal surfaces into
Slack's widget vocabulary; pick each surface's GUI form on its merits, preferring a form the
window already has (§2 below) over a new one.

afleet already has a *protocol* accounting of the terminal (`docs/tui-parity/`): for each
affordance, can the wire supply its data (P), must the host rebuild it (R), is the data
missing (D), is it unreachable (X), or terminal-only (T). **That work is done; do not redo
it.** Cite its verdicts. What does not exist is the **UX translation**: surface by surface,
what the terminal draws and lets the user do, and what that becomes in the window — where it
lands, which widget carries it, which states and copy it keeps, what it drops, what it gains.
That is what your cards supply.

Stance, fixed by the owner: **faithful by default, exceed where the GUI can.** Keep each
surface's information, states, ordering and copy unless a GUI reason says otherwise; when
you change something, say what and why. Mark explicitly the places the GUI can do more than
the terminal (images, real diffs, search, persistent panels, hover, multiple windows).

Canon is **2.1.263**, the installed CLI, and the spec library at that version.

## 2. The window's region vocabulary

Use these names for placement. They come from the root spec §8.1 and the merged children.

- **Sidebar**: Activity row, project sections, channel rows with badges, Background, Archived.
- **Channel header**: title, branch, model, mode, effort readbacks; context meter; menus (MCP, reload, rename, fork, send to background, open in terminal, stop everything, background all, prompt suggestions).
- **Timeline**: the message list; rows are message, cluster (folded tool calls), thinking disclosure, tool call, tool result forms, decision cards, task run row, turn summary, compact boundary, notice rows, opaque row, sent file.
- **Channel banner**: a strip above the timeline (rate limit, auth, trust, contended session, managed settings).
- **Composer**: field; shortcut bar (`/ commands  @ files  ! shell`); pickers (mode, model, effort); queue chip; ghost text; inline refusal explanation above the field; attachments.
- **Decision card**: inline in the timeline; six kinds plus two dialog cards (root §8.4).
- **Panel** (right column, tabbed, any tab pops out to a window): Thread, Agents, Files (Monaco + native viewers), Source Control, Terminal (GhosttyKit panes), Browser, GitHub.
- **Activity view**: cross-channel query of decisions, notifications, failures, denials, rate limits, auth.
- **Quick switcher**: Cmd+K over projects, channels, jobs.
- **Settings window**: app-level (C5 §9: Environment, Engine, ConfigHome, Storage, Developer). Currently afleet's own settings, not Claude Code's.
- **Consent sheet**: modal sheet for spawn-time consent (project MCP servers, bypass disclaimer).
- **Notifications**: macOS `UNUserNotification`.
- **Menu bar**: the macOS application menu bar and its shortcuts (largely unused so far — a legitimate destination for many terminal keybindings and commands).
- Widget forms available for anything new: inline card, popover, sheet, dedicated panel tab, Settings pane, context menu, hover actions on a row, toast, banner, dedicated window.

## 3. afleet status legend

For every card, state afleet's status **from evidence you read**, not from memory:

- `built` — code exists on `main`; name the directory or file (e.g. `App/Decisions/PermissionCardView.swift`) and the child spec section.
- `designed` — the root spec or a child spec specifies it but no code implements it; cite the section. Note: a one-line router entry in §7.7 ("`/mcp` → MCP popover from `mcp_status`") is a *route*, not a design; classify such as `routed-only`.
- `routed-only` — §7.7 names a native destination but nothing specifies its form.
- `undesigned` — no spec mentions it.
- `superseded` — a terminal-specific mechanism the GUI replaces wholesale (say by what).
- `out-of-scope` — the root spec §3 or §17.8 excludes it (say which line).

When something is `built`, look at the code long enough to say whether the built form keeps
what the terminal had. If it loses something, the card says so and proposes the delta.

## 4. The card schema

One `###` heading per surface. Surfaces are what a user sees or does, not code units. A
surface may be as small as the jump-to-bottom pill or as large as the `/config` panel;
split when states or jobs differ. Number cards `<LANE>-nn`.

```
### <LANE>-nn · <Surface name>

**Terminal.** What it draws, when, its states, its keys, its exact copy where copy matters.
Cite SPEC 263 sections; quote strings verbatim in backticks. Two to eight sentences; use a
small table for states or variants when there are more than three.

**Job.** The user need it serves, in one or two sentences. (What would be lost if it vanished.)

**Wire.** The tui-parity class (P/R/D/X/T) and the mechanism, citing the area file row or
README finding. One to three sentences. Do not re-derive; if the inventory is silent, say so
and give your best reading with "unverified".

**afleet today.** Status per §3 with the citation. If built, what the built form keeps and
loses against the terminal.

**GUI form.** The proposal: region (§2), widget, layout, states, interactions, keyboard,
copy. Faithful by default; every deviation named with its reason. Mark `[exceeds]` where the
GUI does more. Where placement or composition matters, an ASCII wireframe in a fenced block
(box-drawing characters, ≤ 100 columns, like the root spec §8.1). Not every card needs one;
the ones that establish a layout do.

**Drops / keeps / gains.** Three short lists (may be one line each).

**Open.** Questions only the owner can answer (taste, product), and unknowns only a probe or
a build can answer. Empty is fine.
```

Keep prose literal. No metaphors. Name files and sections so a reader can go there.

## 5. Verification rules

1. Cite SPEC 263 by section (`SPEC 41.18.5`). For any claim that a card's GUI form depends
   on (a string, a threshold, a state list, an ordering), open the cited SPEC section and
   read it; do not quote from memory or from the older cuts.
2. The spec library's own review did not converge on every chapter. When a claim is
   surprising or load-bearing, grep `cli.pretty.js` at 2.1.263 for the literal and note
   `(verified in cli.pretty.js:LINE)`. Budget: a handful per lane, spent on what matters.
3. afleet status claims come from reading afleet's files. Cite the path.
4. Where the somersault clone learnt a canon quirk at implementation contact (the
   scorecard rows say things like "canon-verified", "probe NN", "byte-verified"), carry it
   into the Terminal paragraph with the row's evidence. The clone's *own* design choices
   are not canon; only the quirks it verified against the binary are.
5. Never claim the wire can or cannot do something beyond what tui-parity recorded; flag
   with "unverified" instead.
6. Distinguish `fullscreen` and `inline` renderer behaviour where the terminal differs
   (SPEC 41.12); the GUI has one answer, but say which terminal state you translated.

## 6. Coverage rule

Your lane's denominator is listed in your task prompt. Cover **all** of it. A terminal-only
mechanism gets a short card with status `superseded` and one sentence on what replaces it —
it still gets a card, so the map can show the full denominator. If you find a surface in
your family that the task prompt did not list, add it and say so in your header note.

## 7. Output contract

Your file, in this order:

1. A header block: lane name, date, the SPEC chapters and afleet files you read, the
   denominator you covered with any additions, and the verification you spent (which
   `cli.pretty.js` greps, which afleet files opened).
2. **Headline** — at most seven bullets: the translations that most change what afleet
   should build, and the biggest place the built app loses something the terminal has.
3. The cards, grouped under `##` sub-families in the order a user meets them.
4. **Ranking input** — a table: card id, surface, afleet status, user value (high/med/low
   with a phrase), build cost (S/M/L with a phrase), depends-on (other cards or afleet
   seams). The orchestrator ranks across lanes from these rows.
5. **For the map** — three to ten bullets of cross-cutting observations: a widget several
   of your surfaces share, a region that is overloaded, a principle the terminal follows
   that the GUI should keep (e.g. never steal the composer mid-draft).
6. **Spec defects** — anything wrong or missing in SPEC 263, tui-parity, or the afleet specs
   that you hit, with the citation. Short.

Length: as long as the denominator needs; a card is typically 150–400 words. No padding, no
restating the brief. Write the file incrementally (header and first sub-family early), so a
partial result survives if you run out of budget.

## 8. What not to do

- Do not design protocol changes or afleet internals; a card names the wire route it relies
  on and stops there.
- Do not write Swift.
- Do not redo the P/R/D/X/T classification.
- Do not read the whole 10,000-line SPEC 41 top to bottom; navigate by the section numbers
  in your task prompt and by grep.
- Do not treat the somersault clone's layout as canon.
- Do not use relative paths.

## 9. Resuming a partial file

The first run of this study was cut off. If a file already exists at your output path, it is
your own earlier partial output: its header block, headline and the cards it contains are
yours to keep. Read it first. Keep the card ids it uses, continue numbering from the last one,
cover the rest of your denominator, and then rewrite the header block, the headline and the
end-of-file sections (ranking input, for the map, spec defects) so they describe the whole
file, not the fragment. Do not restart from scratch and do not discard verified content; do
fix anything in the fragment you now know to be wrong.
