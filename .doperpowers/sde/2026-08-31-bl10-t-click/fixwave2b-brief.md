# bl10 fix wave 2 — fixer B brief (F1: PTY suites stage with `/status`, now a modal dialog)

Repo: `/Users/new/Developer/GitHub/somersault` (work on `main`, in place). You own ONLY
`CC-to-SDK/harness/scripts/resize-matrix.sh` and `CC-to-SDK/harness/scripts/hover-cells.sh`
(plus running the suites). Do NOT touch `src/`, `reforge/`, `ptc-surface/`. Stage explicit
paths only — never `git add -A` (a concurrent session shares this checkout). Commit without
Co-Authored-By.

## The finding (P1, verified)

This round converted `/status` from a local text command (which committed eleven transcript
rows: the `❯ /status` echo, a `Status` header, nine detail rows) into a modal Settings-dialog
opener (`src/tui/useChat.ts`, `case "status"` → `openSettings("Status")`). Two CI-required PTY
suites still type `/status` to stage transcript content and then assume the composer is active:

- `resize-matrix.sh` — `stage_content()` at ~:343 (used by many cells; the surrounding comments
  :30, :327-348 document the eleven-row premise), the a5 cell at ~:474-481 (counts the echo row
  position), and the scrollback cell at ~:523-540 (counts copies of the echo row).
- `hover-cells.sh` — cell h1 at ~:121-135 hovers rows of "the /status block".

With the dialog open, the transcript pane unmounts (Settings is pane-owning), staged rows never
commit, and subsequent typed commands land in the dialog, not the composer. The suites have
never run green against the merged tree (the battery that passed ran on a branch that pre-dated
the conversion).

## The fix

Do NOT revert the `/status` conversion (it is spec-mandated canon parity). Restage the scripts
with a LOCAL, keyless, dialogless command that commits real transcript rows. The proven
precedent is `! echo` staging — see resize-matrix.sh ~:823-834, which documents that one cell
already stages with `! echo` and that the defect which once forced a workaround is resolved. A
`! printf` with several lines can substitute where a cell needs a multi-row block (h1 hovers
the second row of the staged block, so stage at least 3 output rows there).

Non-negotiable discipline: these scripts are densely commented and every comment states a
premise the assertions depend on (row counts, needle strings, why the order of operations is
what it is). For each staging site: read the surrounding comment block, re-derive the row
accounting for the new staging command, update BOTH the needles/greps and the comments so they
stay truthful (e.g. the ":331 eleven rows" premise, a5's echo-row line arithmetic, the
scrollback cell's echo-copy counting). A comment that now lies is a defect. Keep the staged
needle strings unique enough not to collide with the launch banner or composer chrome (the
comments explain the `❯ ` caret rule — preserve that reasoning with the new echo form, which
for `! ` commands may differ; verify empirically what the echo row actually looks like by
capturing a frame before locking needles).

## Verification (required, not optional)

1. Build first: from `CC-to-SDK/harness/`, `npm run build` (the scripts drive the built binary).
2. Run the full `resize-matrix.sh` battery and `hover-cells.sh`. Read each script's header for
   its own invocation instructions. Environment rules, binding:
   - private tmux socket only (the scripts use `tmux -L` with their own socket name — keep it),
   - NEVER `tmux kill-server`; tear down only the named sessions the scripts created,
   - never touch a tmux session named `PTC`,
   - isolated HOME as the scripts already arrange; do not point anything at the real `~/.claude`.
3. Both suites must pass. If a cell fails, diagnose whether it is your restaging (fix it) or a
   pre-existing defect (record it precisely in the report; do not paper over it by weakening an
   assertion).
4. Run tools foreground and read their output the same turn — never end a turn waiting on a
   background notification. If a run is long, poll it with foreground sleeps inside the same
   Bash call or rerun foreground.

## Report

Full report (per staging site: old premise → new premise, needle changes, and the suite
outputs/tallies) to
`/Users/new/Developer/GitHub/somersault/.doperpowers/sde/2026-08-31-bl10-t-click/fixwave2b-report.md`.
Return only: status (DONE/BLOCKED), commit hashes, one-line suite summary, concerns.
