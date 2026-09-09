# Review of `tui-to-gui/README.md` (the map) against the brief, the cards, afleet source and cli.pretty.js

Reviewed 2026-09-10. Read in full: README, SHARED-BRIEF, the Headline and For-the-map sections of
lanes A–G and the Headline of H, `open-questions.md` header and Counts, `spec-defects.md` header
and lane-D section, `surface-index.md`. Cards opened: D-45, D-24, D-57, D-23, D-17, D-21 (via
headline), D-34, D-38, D-04, D-09, D-22, D-42; B-61, B-44, B-46, B-57, B-40, B-08; A-31, A-34,
A-36, A-27, A-33; E-30, E-08, E-39, E-48, E-26, E-14, E-01, E-42; F-37, F-12, F-27, F-02, F-13,
F-34, F-43; G-37, G-47, G-22; C-18, C-59, C-24, C-27, C-39; H cards 4, 6, 9 and the product list.
Source checks: afleet `ManagedSettingsReader.swift`, `SpawnPreconditions.swift`,
`DialogCardView.swift`, `PermissionCardView.swift:36,108`, `CommandRouting.swift:430-446`,
`CommandRouter.swift:108-165`, `RouterTable.swift` (all rows named below), `ComposerModel.swift:147`,
`NotificationRouter.swift:118,158`, `TaskRunRow.swift:35`, `LaunchConfiguration.swift:151`,
`SettingPickers.swift:149,492`, `InitializeConfiguration.swift:39`; cli.pretty.js 2.1.263 lines
193612 (`/stop`), 788497 (`/loops`, `/agents` notice), 788511/788514 (`/version`), 506844 (`↳`),
531216, 835189, 795345, 423007, 643765, 79486, and a whole-file count of `⚙` (0).

Verdict up front: the map is faithful to the cards in the large majority of the claims I sampled
(roughly 30 of 34 §6/§7 claims match their card, and every binary citation I followed held). The
findings that would change what the owner does are concentrated in three places: the §5 numbers
that justify the region-based roadmap cut, three Tier 0 rows whose cited cards do not support them,
and the open-question arithmetic. Everything else is minor.

---

## Ranked findings

### 1. §5 — the "unbuilt half by region" numbers are the all-status totals, not the unbuilt counts  (e, c) — HIGH

**Where.** §5, paragraph after the counts table: "`undesigned` (157) plus `routed-only` (10) plus
`designed` (34) is the unbuilt half of the terminal, and 42 of those cards land in the Settings
window, 41 in decision cards and 62 in the composer, which is why the roadmap cut in §8 groups by
region rather than by lane."

**What is wrong.** 42 / 41 / 62 are the region totals across *all* statuses (the very next
paragraph lists "composer 62, Settings 42, decision card 41"). Recomputed from `surface-index.md`
restricted to `undesigned | routed-only | designed`: Settings **36**, decision card **16**,
composer **21**. Lane C has 32 built composer cards, so "62 unbuilt composer cards" cannot be right
on its face. The sentence is the stated rationale for cutting the roadmap by region, and it
overstates the decision-card and composer backlogs by 2.5–3x.

**Evidence.** `awk` over the index card rows (columns 4 and 5): timeline 75/28, composer 62/21,
Settings 42/36, decision card 41/16, sidebar 29/15, channel banner 19/14, header 15/10 (all/unbuilt).

**Fix.** Replace with the unbuilt counts (Settings 36, timeline 28, composer 21, decision card 16,
sidebar 15, banner 14, header 10). The region argument still holds — Settings is the largest
unbuilt region — but the roadmap children C11 (composer) and C12 (decisions) are smaller than the
sentence implies, and C13 (settings) is proportionally larger.

### 2. §5 — "the first fifteen rows of §6.1 are `built`" is false  (c) — HIGH (same paragraph as #1)

**Where.** §5: "First, `built` (159) is the status of the card's surface, not of its fidelity: §6
lists the built surfaces whose form drops something, and the first fifteen rows of §6.1 are `built`."

**What is wrong.** Per the index, the §6.1 rows in order are: D-45 *designed*, D-24 built, D-57
built, B-61 *undesigned*, B-44 *undesigned*, B-46 *undesigned*, A-31 built, E-30/E-42/F-09/F-18
*routed-only*, E-08 *designed*, E-39 *designed*, E-48 *designed*, F-37 *undesigned*, F-12 built,
E-26 built … Only about a third of the first fifteen are `built`.

**Fix.** Delete the clause, or reword to what is true: §6.1 is about behaviour in shipped code
regardless of the surface's status (an XML bubble is a defect in a `built` renderer even though the
command-echo *surface* is `undesigned`).

### 3. §6.1 / Tier 0 — `/fast` is not broken on `main`; the E-30 card misread the router  (a) — HIGH for Tier 0 accuracy

**Where.** §6.1 row "E-30, E-42, F-09, F-18 | `/fast`, `/agents`, `/tasks`, `/resume` route to
native surfaces the picker model rejects; typing them does nothing"; Tier 1 rank 1 "Unblocks E-30 …";
§8 C9.

**What is wrong.** The card (E-30 *afleet today*) says `CommandRouter.picker(for:)` sends the bare
`/fast` to `.native("fastPicker")`, which `pickerSurfaces` rejects. The source says otherwise:
`RouterTable.swift:43` routes `/fast` to `.applyFlagSetting(key: "fastMode")`, and
`CommandRouter.swift:113-117` only falls to `.native(picker(for:))` when `flagValue` returns nil —
and `flagValue` (`:154-159`) **always** returns a value for `fastMode` (`.bool(!current)`, the
toggle). The comment on line 114 says exactly this: "`/fast` is a toggle and needs no argument".
This code has been on `main` since 2026-09-05 (`git blame 65a64ea`), before the study ran. So
`/fast` sends `apply_flag_settings {fastMode: <toggled>}` today; E-30's status should be `built`
(with the readback and header control still to design), not `routed-only` and "broken end to end".
`/agents`, `/tasks` and `/resume` really are `.native("agents"|"tasks"|"switcher")` and really do
fall through (`SettingPickers.swift:149,492`); that half of the row stands.

**Fix.** Remove `/fast` and E-30 from the §6.1 row and from Tier 1 rank 1's unblock list; move E-30
to §6.2 (a working toggle with no visible state). Ask lane E to correct the card and the index row.
(Aside for lane E, not a README defect: E-39 says afleet declares `supportedDialogKinds: []`;
`InitializeConfiguration.swift:39` defaults to two kinds, which is what lane D reports.)

### 4. §6.1 / Tier 0 — D-45 and D-57 rows contradict the cards they cite  (d, c) — HIGH for owner trust in Tier 0

**Where.** §6.1 rows D-45 ("`ManagedSettingsReader.isPending` hashes the raw file and looks for
`approvedHash`; a managed deployment never spawns") and D-57 ("every dialog card claims five
minutes; `dialogExpiry` is always nil"); Tier 0 items 1 and 3.

**What is wrong.** Both statements are **true against the source** — I confirmed
`ManagedSettingsReader.swift:16-22` (raw-payload SHA-256, top-level `approvedHash`, fail-closed;
`SpawnPreconditions.swift:33` refuses to spawn on `isPending`) and `DialogCardView.swift:46` (`standard`
passes `dialogExpiry: nil`, so `text` yields "This dialog expires in 5 minutes.") — but the cards
the README cites say the opposite. D-45 *afleet today*: "`designed`, not built … Nothing in
`App/Consent/` implements it" (the lane looked in `App/Consent/` and missed `FleetKit/…/Preconditions/`;
lane A's A-27 card independently lists `managedSettingsPending` as a built `ChannelBanner` case).
D-57 *afleet today*: "the card never says a deadline exists", when `DialogDeadline.text` is
precisely that sentence. The two defects are recorded only in lane D's *Spec defects* section
(`spec-defects.md:209-219`), and `surface-index.md` carries D-45 as `designed`. The Retrospective
says only two lane findings were corrected from outside; these two were not reconciled at all.

**Fix.** Cite `spec-defects.md` (lane D, "afleet specs and code") beside D-45 and D-57 in §6.1, or
better, have lane D correct the two *afleet today* paragraphs and the index status (D-45 →
`built`, with the hash-shape defect). Also note in the D-45 row that the reader additionally skips
canon's harmless-payload predicate (spec-defects says so; the README row's "with a predicate that
skips harmless payloads" reads as if the card said it — the card does not).

### 5. Tier 0 — D-17 is listed as a live defect; the card says it is unverified and asks for a probe  (a) — MEDIUM

**Where.** §6.1 row D-17 "the persistent-grant row ignores the organisation ask ceiling and
rule-minting-forbidden sources | the row is hidden when policy forbids it"; Tier 0 "D-17 grant
suppressions".

**What is wrong.** D-17 *afleet today*: "An org-capped ask that still carries suggestions would
therefore show *Always allow* … The engine may or may not send suggestions in that case —
unverified"; *Open*: "Does the engine send `permission_suggestions` on an org-capped ask? … Worth
one probe." The README turns a conditional into a shipped bug. Separately, the
"rule-minting-forbidden request sources" suppression belongs to D-21 (D headline bullet 5), not D-17.

**Fix.** Keep D-17's *fix* in Tier 0 if the owner wants defence in depth (reading the ceiling from
`decision_reason` is S and harmless), but label it "suppression not implemented; whether it bites
depends on a probe (open-questions §2)", and cite D-21 for the second suppression.

### 6. §10 and the file table — the open-question counts do not add up  (e) — MEDIUM

**Where.** File table row for `open-questions.md` and §10 first paragraph: "215 non-empty ones, of
which 153 are owner decisions … 35 are probes … and 17 are build-time unknowns."

**What is wrong.** 153 + 35 + 17 = 205. `open-questions.md` *Counts* explains the gap: 3 cards are
dual-tagged owner/probe (E-01, E-16, F-01) and **13** Open paragraphs are unclassified bookkeeping
notes (B-31, B-32, B-62, C-14, C-34, D-06, D-07, E-35, E-55, F-36, G-09, G-19, G-21):
153 + 35 − 3 + 17 + 13 = 215. The README omits both terms, so a reader who adds the numbers
concludes ten questions went missing.

**Fix.** "215 live Open paragraphs: 153 owner decisions in 19 themes, 35 probes (3 cards carry
both), 17 build-time unknowns, and 13 cross-lane notes with no decision in them."

### 7. Lane findings the map dropped  (b) — MEDIUM collectively; each minor alone

- **B for-the-map 4, scroll anchoring (B-56).** "The terminal's most carefully engineered UX rule …
  afleet has the first [anchor correction] and not the second [freeze the range for two frames after
  a width change] … this is not a nicety." The README cites B-56 only as a region-map row and never
  states the gap; it is in neither §6.2 nor the backlog. Fix: a §6.2 row (B-56 | anchor without the
  width-change freeze | rows that change height after draw jump the reading position) and a Tier 2
  entry or a line in C10.
- **B for-the-map 8 / headline 7, the two protected divergences.** afleet *escapes* raw HTML and
  *sanitises host-side* where canon does neither; "a future 'faithfulness' pass could plausibly
  undo either." Under the map's own stance (faithful by default) this is exactly the rule that needs
  to live at map level. Fix: one bullet in §4.2 naming both as deliberate deviations (B-48, B-57).
- **E for-the-map, last bullet.** Three built surfaces "beat the terminal outright" and are "worth
  protecting, not extending": `/logout`'s census (E-44), the `.mcp.json` re-consent hash (E-18),
  the Background section standing in for the daemon hub (E-56). §9's "Where afleet already leads"
  lists only H's items. Fix: add them to that bullet or to §4.4.
- **G for-the-map, dead-code designs.** G names three finished designs behind false predicates:
  tab status (G-61), FleetView's `remote` tab and launch composer (G-05), the coordinator UI panel
  (G-43). Tier 3 names only tab status and `/loops`. Fix: extend the Tier 3 sentence.
- **E-48's owner ask.** The card's *Open* asks the owner to reconsider root §17.8's *Deferred*
  placement of usage-limit auto-continue ("a fleet-defining feature rather than a nicety"). §10 has
  no item for it; Tier 2 item 13 just says "auto-continue L". Fix: add to §10 (it is a §17.8 scope
  question, like item 5).
- **D for-the-map, recovery over prevention.** "Where afleet adds a confirmation the terminal lacks
  … it should carry the recovery sentence too, or the GUI is strictly more frightening and no
  safer" (D-58, D-61). Not in §4. Minor; one line in §4.1 next to "A refusal names its remedy".
- **H headline 7.** The lane names four fleet-level gaps; §9's last bullet lists three and drops
  per-channel cost attribution. Minor.

### 8. §9 — the Roo warning is stated backwards  (a) — MINOR

**Where.** §9: "One product ships the warning that matters: queued messages must never act as
approval for the next action."

**What is wrong.** H card 6 and headline 6: Roo Code *documents a hazard* — "Queued messages act as
approval for the next action" — and H's recommendation is that afleet "write down that afleet's
queue never carries approval." No product ships the rule; one ships the hazard the rule guards
against. Fix: "One product documents the hazard that matters (Roo: queued messages act as approval
for the next action); the rule for afleet's composer is that they never do."

### 9. Tier 0 — "all S" and the A-34 placement  (c) — MINOR

Index costs: D-45 S/M, D-24 S/M, D-38 S/M, A-34 S/M; the rest S. A-34 (title precedence) appears in
Tier 0 "live defects" but the README itself files it under §6.2 fidelity, and the card calls it "the
cheapest high-value gap", not a defect. Fix: "S, four of them S/M", and move A-34 to the top of
Tier 2 or leave it in C8 with a note that it is a fidelity item riding along because it is cheap.

### 10. Tier 3 — two cards listed as "closed by a card, no build" are not  (c) — MINOR

A-33 (OSC 9;4) is `built` in part and the card proposes a second OS signal ("afleet should build
the second" — a busy/idle Dock signal distinct from the badge count); F-45 `/exit` is `undesigned`,
not `superseded`. Fix: drop A-33 from the superseded list (keep its inheritance sentence in §3.1)
and check F-45's card before listing it.

### 11. §5 — the by-region list sums to 384, not 400  (e) — MINOR

Seven regions are omitted: consent sheet 4, panel:Browser 3, panel:Thread 3, panel:Source Control
2, toast 2, panel:Terminal 1, quick switcher 1. Fix: "… Activity 7, seven smaller regions 16; 48
have no GUI surface."

### 12. §8 C9 acceptance — "`/mod` completes with the keyboard and Enter submits the typed line" passes today  (e) — MINOR

C-27 records that afleet's Enter on `/mod` already "sends the literal text `/mod`" — as the defect.
Canon's rule is: Enter with a selection accepts; Enter with *nothing selected* submits as typed, for
four suggestion types. Fix: "Tab and Enter accept the selected row; Enter with nothing selected
submits the line as typed."

### 13. §6.2 — A-34 "a two-rung title"  (a) — MINOR

The card describes three rungs on the sidebar row ("custom, else AI title, else first prompt", root
§8.2) missing canon's top and bottom rungs, and a literal `"afleet"` for the root window. Fix:
"three rungs with an invented bottom rung".

### 14. §7 — F-02's rank versus its lane's own ranking  (c) — MINOR, judgment call

Lane F headline 6 calls the limit chip plus Usage pane "the highest user value per unit cost in this
lane" (index: high / M); the README places it at Tier 2 item 13, below items the lane ranks lower
(e.g. item 7 Background panel, high / M; item 10 `/help`, high / M). Cross-lane ranking is the
orchestrator's call, but the map should say why a lane's top item dropped, since the owner will
read the lane and ask. Fix: one clause, or move it up beside item 3.

---

## Things I checked that held (so the owner need not re-check them)

- Binary: `/stop` = "Stop this background session; transcript and worktree are kept" (193612);
  `/loops` `isEnabled: () => !1` (788497); `/version` twice `!1` (788511, 788514); `⚙` absent, `↳ … background`
  at 506844; "Claude is waiting for your input" 531216; "Waiting for permission…" 835189 and 511212;
  the three-sentence rejection constant at 795345; "from the ${G} agent" at 423007; `Xw = 150` at
  643765; `<command-name>` wrapper regex at 79486; "The /agents wizard has been removed" at 788497;
  `dangerousSettingsHash` record field at 35960-36039.
- afleet: `unstatedDenial` is the one-sentence string (PermissionCardView.swift:36); `/permissions`
  prints "N applied setting(s)" (CommandRouting.swift:435-437); `/memory` prints a file count (:440-441);
  `isSending` is `private(set)` on the model with no view reader (ComposerModel.swift:147);
  notification title "afleet — <type>" and body "The turn ended with <subtype>." (NotificationRouter.swift:118,158);
  `TaskRunRow.activeForm(of:)` exists (:35); `/stop` → `.interrupt` and `/reload-plugins` refusal
  copy (RouterTable.swift:52,97); `/doctor` refusal (:95); `pickerSurfaces` two entries; the
  checkpointing env var is set (LaunchConfiguration.swift:151); `supportedDialogKinds` two kinds.
- Cards vs README: D-24, D-23, D-34, D-38, D-09 (41 kinds, thirteen advertisements), D-10/D-11
  (twelve routes, sixteen patterns), D-04 (150 ms), D-22 (no `ctrl+e explain`), D-42 copy; B-61,
  B-44, B-46, B-57, B-40/B-18, B-08; A-31, A-36, A-27 (seven `ChannelBanner` cases, none canon's);
  E-08, E-39, E-48, E-26, E-14 (seven dead control requests), E-42; F-37, F-12, F-27, F-02, F-13
  (44-row suppression), F-34, F-43, F-19; G-37, G-47, G-22; C-18, C-59 (26 vs 23), C-24, C-39;
  H: fourteen managers, 41 products, eight products with comments, peek rung.
- Counts: per-lane cards and per-status totals in §5 sum correctly (400 / 159 / 34 / 10 / 157 / 26 / 14);
  "315 of 400" Exceeds flags matches the index; open-questions theme counts sum to 153; the G
  coverage gap sentence in the Retrospective matches G's spec-defects (line 3696).

## Counts per category

- (a) misstatements of a card or source: 4 (#3 `/fast`, #5 D-17, #8 Roo, #13 A-34)
- (b) important lane findings omitted: 7 items, grouped in #7 (B-56 scroll anchoring is the one worth a backlog line)
- (c) internal inconsistencies: 5 (#2, #9, #10, #14; #4 is also c)
- (d) assertions without a card behind them: 1 (#4 — source-backed, card-contradicted)
- (e) writing defects that mislead: 4 (#1, #6, #11, #12)

Minor: #8 through #14 and all but the first item of #7. Would change a decision: #1–#4 (the
region numbers behind the roadmap cut, and three of the sixteen Tier 0 items), and #5–#6 would
change how the owner reads Tier 0 and §10 even if not what they decide.
