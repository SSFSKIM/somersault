# Shared brief — cross-check the 2.1.257 Harness Spec against the ccx TUI clone

## What this is for
CC-to-SDK (`/Users/new/Developer/GitHub/somersault/CC-to-SDK`) replicates Claude Code's terminal UI
(`ccx`, in `harness/src/tui/`, tests in `harness/test/tui/`) on top of the Claude Agent SDK. The program
reverse-engineered canon piecemeal, wave by wave, against installed binaries (current canon target:
**2.1.251**). A separate effort has now produced a replication-grade spec of the **2.1.257** binary:
`/Users/new/.claude/jobs/4b30d1a4/tmp/spec257/` (read its `00-README.md` table row for your chapter and
`CONVENTIONS.md` §4 for the citation format `[chunk-xxx.js:LINE]`).

Your job: read YOUR lane's spec sections against OUR implementation and scorecard, and report what we
should take from the spec. The owner will decide what becomes work; you produce the evidence.

## Our side — what to read
- `docs/parity/tui-ux.md` (2,528 lines) — the TUI scorecard. Sections §1–§8 are row tables scored
  ✅/🟡/❌ (🚫 = excluded as unreachable). Also: "Recorded additions" (things we have that canon lacks),
  per-wave "Unreachable — recorded, not built", "Deliberate divergences from upstream", "Open evidence
  gaps". Grep it for your topic before claiming we lack something.
- `docs/parity/tech-debt-tracker.md`, `docs/parity/coverage.md` (SDK capability envelope — what the
  SDK transport can/can't deliver; the "🚫 floor" in §5).
- `docs/superpowers/specs/` — per-wave design specs (grep by topic; e.g. `2026-08-31-bl10-*` for the
  dialog shell/spacing/click work, `2026-07-31-tui-clone-fidelity-design.md` master spec).
- `harness/src/tui/` (154 files; subdirs `keys/`, `mouse/`, `dialogs/`), `harness/CLAUDE.md` module map.

## The spec's quality caveats (weigh claims accordingly)
- Written from the 2.1.257 binary. Our canon is 2.1.251. `A5-cross-version-notes.md` §A5.11 lists the
  251→257 hop exhaustively; when a finding matters, check whether it's a 257-only change.
- Its own review loop did not converge (`_notes/tech-debt-tracker.md`): chapters 41/42 had the deeper
  R4 review; 28 had R2 only; 02/03/06/07/09/16/18/21/27/31/32/36/38/49 had only a capped R2 pass, so
  treat those as lower confidence. Estimated residual error mass is material.
- Therefore: any finding you label **verified** must be checked against the binary yourself. Both bundles
  are local: `~/claude-code-bundle/2.1.257/` and `~/claude-code-bundle/2.1.251/` (each has
  `cli.pretty.js`, `CHUNK-INDEX.md`, `tools/where.py`; usage in spec `CONVENTIONS.md` §3). Cite lines.
  Findings you did not verify are labeled **spec-only**.
- Our own pty evidence (tui-ux.md cites probe/pty runs) can be right where the spec is wrong. Say so
  when you see it.

## Report contract
Write ONE markdown file at the path in your dispatch. Sections, in this order:
0. **Top takeaways** — ≤7 bullets ranked by value to the program (biggest user-visible gap or wrong
   behavior first). Each names the section below that holds the detail.
1. **Corrections** — things we BUILT that canon does differently per the spec. Each: what we do
   (our `file:line`), what canon does (spec § + bundle cite), user-visible impact, verified/spec-only,
   251-vs-257 note if the hop changed it.
2. **Unknown unknowns** — canon behaviors the spec documents that tui-ux.md has NO row for and we
   haven't built. Each: one-paragraph description, cite, and a reachability note: does it need data or
   control the SDK transport may not give us (we see SDK messages/hooks/control frames, not internal
   state)? Flag, don't assert.
3. **Known gaps now specified** — rows currently ❌/🟡 in tui-ux.md where the spec supplies the exact
   mechanism/strings/constants we lacked. Cite both.
4. **Verbatim assets** — strings, constants, tables, thresholds worth pinning verbatim that we don't
   already have verbatim (check our source first). List with cites; don't paste huge blocks — point.
5. **Confirmations** — one line each: things we built that the spec confirms. Brief.
6. **Spec defects** — where the spec contradicts the bundle or our verified pty evidence.

Rules: read-only against the repo (no edits, no builds, no test runs, no running ccx). Write only your
report. Never read `.env` or print secrets. Do not touch tmux. Be concrete: cites and file:line, not
generalities. Cover your whole lane, then go deep on what matters. No length limit; rank ruthlessly.
Return to the caller: five lines max — the report path, the count per section, and the single biggest
finding.

Note: `~/claude-code-bundle/2.1.251/` has `cli.pretty.js` but no `tools/`; use plain `grep -n` on it, or
run `python3 ~/claude-code-bundle/2.1.257/tools/where.py` from inside the 2.1.251 dir if it accepts cwd.
