# bl5 round — link-click URL-opening (T-LINKOPEN) + sniff-vs-declared media-type cross-check (T-SNIFF)

Owner approved 2026-08-26 ("go ahead proceed") from the bl4 parked list. GIF/WebP downscale stays parked.
Pipeline = bl4's: canon research → compact spec + 2 plans → pre-execution codex adversarial plan review →
parallel worktree tickets (fresh sonnet implementers, per-task sonnet reviewers ≥2 own mutations,
original-reviewer re-reviews) → sequential --no-ff merges w/ full gates → whole-round codex review
(--base <pre-round-ref>) → fix waves + scoped re-reviews to zero → parity/memory close-out.

Fold-in: hover-suppression-while-expanded e2e cell rides T-LINKOPEN (same subsystem, warm pty harness).

## Progress
- [x] Research: canon link behavior — FLIP: 2.1.246 SELF-OPENS (gated alt/ctrl or Ghostty/Warp-darwin, 500ms defer, 12-scheme allowlist, $BROWSER||open, vscode stand-down). research-links.md
- [x] Research: media-type — canon DERIVES (never compares); API 400s mismatch whole-request (live-verified); FIVE chains mapped, chain-4 admitBytes PNG/JPEG-only gap found. research-sniff.md
- [x] Spec 0e97b8569c + plans 873eb0397b committed (T-SNIFF 4+verify tasks; T-LINKOPEN 5 tasks)
- [ ] Pre-execution codex adversarial review of spec+plans
- [ ] T-SNIFF ticket
- [ ] T-LINKOPEN ticket
- [ ] Merges + whole-round review campaign to zero
- [ ] Close-out (parity docs, spec retrospective, memory)

Pre-round base: eb02bd9024 (main; reforge session added 3 commits since bl4 ledger 6702416acf — their
tree stays hands-off, findings relayed only). Canon = installed 2.1.246 — NOW A MACH-O BINARY with
embedded JS (230MB), not a JS bundle; research via python mmap offset-find + windowed extraction.

## Plan review + execution start
- [x] Pre-execution codex adversarial review: 5 findings (2 high), ALL accepted (F5 partially).
  F1 ChatApp owns dispatch (modified clicks dropped at sink); F2 link-before-fold precedence (fold-row
  links toggled — latent bl4 canon divergence); F3 registry chunk-0 allowlist runs pre-bytes (needs code);
  F4 sniffer = canon b() verbatim prefix-only; F5 activation guard BUILT (1004 armed already),
  xterm.js/isVscodeTerm stand-down PARKED into D5. Folded: spec v2 + both plans, commit 66a89c9947.
- Worktrees: .claude/worktrees/bl5-t-sniff (branch bl5-t-sniff) and bl5-t-linkopen, both based 66a89c9947.
  Task briefs/reports: .doperpowers/sde/2026-08-26-bl5-t-{sniff,linkopen}/.
- T-SNIFF task 1 (sniff helper) + T-LINKOPEN task 1 (OSC8 spans + link-before-fold) dispatched in
  parallel, sonnet implementers. TASK BASE both = 66a89c9947.
- T-SNIFF Task 1: complete (039495da79 + minor-cell ae76dd287e, review clean — spec PASS, quality
  Approved; 4 mutations run, 2 red; the 1 Minor [JPEG third-byte negative cell] closed inline by
  controller as an added assertion, suite 9/9). Implementer caught a spec-text error (3-byte JPEG example vs canon's
  length<4 gate) — docs fixed on main.
- T-LINKOPEN Task 1: complete (a4d1f8a896, review clean — spec PASS, quality PASS; 4 mutations, 4 red;
  closed the old D12 accepted gap [bare prose-link rows]; P3 informational note recorded: dedupe relies on
  the two RenderLine.text producers staying mutually exclusive per row — doc-comment when adding a producer).
- T-SNIFF Task 2: complete (6ddfda1741, review clean — spec COMPLIANT, quality PASS; 4 mutations,
  3 red + 1 silent-on-dead-code P3 [sniff-null refusal provably unreachable: dims readers gate on the
  same prefixes]; F3 admit case implemented).
- ROUND MINOR ROLL-UP: imageCodec-encode.test.ts retry-ladder test is flaky STANDALONE (pass/fail
  varies across runs, pre-existing, unrelated to bl5) — surface at whole-round review for triage.
- T-LINKOPEN Task 2: complete (f69079e811, review clean — spec PASS, quality PASS, no severities;
  2 mutations, 2 red; allowlist byte-exact 13 entries; implementer caught the "12 entries" prose error,
  docs fixed). NOTE session-limit outage hit mid-round; both affected agents resumed via SendMessage.
- T-SNIFF Task 3: complete (62c2c13494, review clean — spec PASS, quality PASS; 3 mutations, 3 red).
- T-SNIFF Task 4: complete (c328aa1159, review clean — spec PASS, quality PASS; 3 mutations, 3 red;
  JPEG sniff-vs-dims asymmetry adjudicated CONSISTENT across chains).
- T-SNIFF Task 5 (verify): ALL PASS; live mislabelled-block cell SKIPPED-429 (weekly account cap,
  resets Aug 31 — retry then; cell committed 31b32270dc); typecheck clean, unit 3977/3977, tui 4689/4700
  (10 keyless-gated skips); all four chains source-verified vs spec. T-SNIFF TICKET COMPLETE.
- T-SNIFF MERGED to main --no-ff as 81fbd8d52f; merged-tree gates green (typecheck clean, unit
  3977/3977, tui 4689/4700 w/ 11 gated skips).
- T-LINKOPEN Task 3: review PASS/PASS with 2 P2 coverage gaps (5 mutations: 3 red, 2 silent —
  (a) modified press starting a selection undetected; (b) modified press/release cross-cell pairing
  unexercised). Fix wave dispatched; re-review by ORIGINAL reviewer required.
- T-LINKOPEN Task 3: complete (ec247186b2 + fix c9d202f00f, re-review by ORIGINAL reviewer: both P2
  gaps closed, mutations now red on the new cells; 5 mutations total, dispatch suite 10/10).
- T-LINKOPEN Task 4: complete pending review (239ac2d30e) — all three pty cells PASS in the real binary
  (self-open exact URL; fold-row link opens WITHOUT toggling, frame byte-identical; hover suppressed on
  expanded owner while other owners brighten). fake-host colon-split fix (strict widening).
- ROUND MINOR ROLL-UP (new discovery, unrelated to bl5): ccx attach drops the FIRST frame pushed after a
  fresh attach (follow() establishment race in the attach transport); reproducible; worked around in the
  pty driver with a warm-up push. Candidate backlog ticket.
- T-LINKOPEN Task 4: complete (239ac2d30e, review clean — spec PASS, quality PASS; reviewer re-ran the
  committed driver TWICE fresh, all 3 cells PASS; feature-kill mutation failed the right two cells;
  1 P3 doc-only note [no explicit pre-fix red run recorded — compensated by reviewer's own mutation]).
- T-LINKOPEN Task 5 (verify): ALL PASS — typecheck clean, unit 3997/3997, tui 4707/4718 (11 gated
  skips); parked-scope audit clean (D3/D5/D6 zero production code). T-LINKOPEN TICKET COMPLETE.
- T-LINKOPEN MERGED to main --no-ff as 07f3385b01; merged-tree gates green (typecheck clean, unit
  4012/4012, tui 4707/4718 w/ 11 gated skips). Both tickets merged.
- Whole-round codex review launched (--base eb02bd9024, gpt-5.6-sol; 18 commits, all bl5 — no
  concurrent tree in the diff).

## Whole-round review round 1 (job review-mtb3z6hw, base eb02bd9024)
3 findings, all P2, ALL ACCEPTED: (1) bind clicked href to the press anchor (streaming can move a
different link under the cell — narrowing guard, canon-silent); (2) popup pressAt must not accept
modified presses (regression vs pre-bl5 blanket drop); (3) win32 launcher missing — xdg-open ENOENT
silently; use rundll32 url.dll,FileProtocolHandler (NOT cmd/start — injection). Single fix wave
dispatched on main. (First review launch orphaned by the usage-limit outage — zombie record cancelled.)
- Fix wave complete: 476a1e8a75 (press-bound href + popup gate) + 1656f1dad3 (win32 rundll32), all three
  red-verified; suites green (unit 4015, tui 4710, dispatch/opener 51/51). Scoped re-review launched
  (base c6be8b5594).
- Scoped fix-range re-review: ZERO findings ("No actionable diff-introduced defects"). Campaign 3→0.
- Close-out: parity blocks committed 704b403366; spec retrospective written. ROUND CLOSED 2026-08-27.
