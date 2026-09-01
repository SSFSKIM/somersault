# bl10 fix wave 2 — fixer B report (F1: PTY suites staged with `/status`, now a modal dialog)

Status: **DONE** for the assigned finding (F1), with one pre-existing, unrelated defect surfaced rather
than papered over (see "hover-cells.sh h1" below).

Files touched (only the two named, no `git add -A` used anywhere):
- `CC-to-SDK/harness/scripts/resize-matrix.sh`
- `CC-to-SDK/harness/scripts/hover-cells.sh`

## The restaging

`/status` was converted to a Settings-dialog opener (`src/tui/useChat.ts`, `case "status"` →
`openSettings("Status")`). Both scripts now stage transcript content with a LOCAL, keyless, dialogless `!`
bash command instead — the same family the `M1` cell in `resize-matrix.sh` already proved out (`! echo`,
now confirmed resolved of the popup-overflow defect that once forced it):

```
STAGE_CMD="printf 'stg1\nstg2\nstg3'"
STAGE_ECHO="! ${STAGE_CMD}"     # the echoed transcript row, verbatim
STAGE_LAST="  stg3"             # the LAST output row — staging is only done once this paints
```

`runBashMode` (`useChat.ts`) echoes `! ${command}` synchronously, then appends `formatBashOutput`'s
two-space-indented output lines (one per printf line) as a SECOND, later, async transcript append. Three
output rows were chosen deliberately: `hover-cells.sh`'s h1 needs a genuine middle row to hover, and this
gives it one.

### Per-site premise changes

| Site | Old premise | New premise |
|---|---|---|
| `resize-matrix.sh` `stage_content()` (~:355, was ~:341) | `/status` commits an eleven-row block (echo + `Status` header + nine detail rows); the echo (`❯ /status`) is the completion needle. | `!` bash mode commits a four-row block (echo + three output rows); the completion needle is `$STAGE_LAST` (the **last** output row), not the echo — the output is a second, async append, so waiting on the echo alone can return before the block is fully painted (a real race for `g1`'s immediate scrollback count and would have been one for hover-cells' h1). |
| `resize-matrix.sh` `check_frame()`'s caret-collision note (~:146) | The transcript's own echo rows also start with `❯` (`❯ /status`) — that's what the "rule above a `❯` line" distinction guards against. | Bash-mode echoes start with `!`, not `❯`, so `stage_content`'s rows never collide with a live composer block. The caret collision is now specific to the two LIVE-TURN cells (`a3`, `m1`'s streaming half), which still submit real prompts through the composer. |
| `resize-matrix.sh` `run_a5_cell()` (~:471, was ~:454) | Typed `/status`; anchored the "no stranded placeholder" check on the last `❯ /status` line. | Types `$STAGE_ECHO`; anchors on the last `$STAGE_ECHO` line (unchanged in kind — still the FIRST row of the newly submitted block, still found via `tail -1`). |
| `resize-matrix.sh` `run_g1_cell()`'s scrollback-copy count (~:552/:569) | Counted copies of `❯ /status` in scrollback before/after opening `/model`, to prove Ink's tall-render branch fired. | Counts copies of `$STAGE_ECHO` instead — same method, same assertion. Verified live: `1 -> 3` copies (`g1` passed). |
| `resize-matrix.sh`'s "why `-S -`" reasoning (~:350) | Measured claim: `/status`'s eleven-row block overflows a 15-row pane DURING staging itself, so the echo scrolls out of the viewport before painting finishes — this is what originally forced scrollback reads. | Re-measured: the new four-row block does NOT overflow a 15-row pane on its own (confirmed live at 60x15 — everything stays in the viewport after staging). `-S -` is kept anyway (harmless superset), and `g1` still genuinely needs it for a separate reason — the `/model` picker's OWN frame growth is what later pushes committed rows into real scrollback, which is what `g1`'s own before/after count depends on. |
| `resize-matrix.sh` M1 cell's own comment (~:853) | Framed as "`! echo`, NOT `/status`" (contrasting with what `stage_content` used at the time). | Noted that `stage_content` also moved to a `!` bash command now, and m1 keeps its OWN marker rather than sharing `stage_content`'s — for the pre-existing scope-isolation reason (not folding the popup-budget mechanism into this cell's needle), independent of and predating this restage. |
| `hover-cells.sh` `launch()` (~:63) | No permission-mode pin; a fresh isolated HOME onboards into whatever the product default currently is (`auto`), which paints an "Auto mode lets Claude…" explanatory tip block above the composer. | Pinned `--permission-mode default` (manual), mirroring `resize-matrix.sh`'s own precedent for exactly this class of drift. Removes the tip block, making the frame layout `h1` depends on for its hardcoded row numbers deterministic. |
| `hover-cells.sh` `run_h1_cell()` (~:132) | Typed `/status`, waited for `Status` (which, post-conversion, also appears inside the dialog — so the wait no longer reliably detects staging completion), hovered hardcoded row 6 ("second row of the /status block"). | Types `$STAGE_ECHO`, waits for `$STAGE_LAST`, hovers row 7 — re-measured at launch 100x24 with the mode pin: row 4 = echo, rows 6/7/8 = `  stg1`/`  stg2`/`  stg3`. Row 7 (`stg2`) is genuinely the SECOND output row. |

## Verification

Built via `npm run build` from `CC-to-SDK/harness/` (clean). Ran both scripts foreground, full battery,
default cell sets, reading output in the same turn throughout — no background waits. Isolated per-cell
`HOME`/`CCX_FLEET_ROOT`, tmux's own default socket exactly as the scripts already use it (neither script
uses `tmux -L`; verified this is simply not part of either script's existing design, not something I removed).
No `tmux kill-server` or `-a` ever issued; the pre-existing `PTC` session was never touched, and `tmux
list-sessions` after every run showed only `PTC` remaining.

**`resize-matrix.sh`: 10 passed, 0 failed.** (`a3` and `m1`'s streaming half SKIP cleanly — no
`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` in this environment, which is documented, expected, and not
part of the CI-required set.)

**`hover-cells.sh`: 1 passed (h2), 1 failed (h1).** h2 was untouched and unaffected (it never staged
`/status`). h1's failure is genuine and, as detailed below, not fixable by restaging.

## hover-cells.sh h1 — a pre-existing, independent defect (not papered over)

The restage removes the actual F1 symptom cleanly: h1 no longer types into a Settings dialog, no longer
hangs, and its "content painted" precondition (`before_dim=5 >= 2`) passes with correct row accounting.
But the cell's CORE assertion — hovering a staged local block un-dims it — now fails: `before_dim=5
after_dim=5`, byte-identical `capture-pane -e` frames before and after the hover motion.

This is NOT caused by the `/status`→dialog conversion. It is caused by an EARLIER, separate, already-shipped
and already-unit-tested product change: **T-CLICKGATE Task 2** (bl4, commit `f06085c8e`, merged into `main`
at `05d9eedda` on 2026-08-24 — a full week before this round's `bl10-t-click` work started). That change
narrowed hover-triggered un-dimming to owners stamped `clickable: true`, which only `toolRenderer.tsx`'s
tool-result gutter-blocks and advisor results ever carry. Plain local/`visual` transcript events —
`/status`'s old rendering AND this restage's `!` bash-mode output, identically — have never been stamped
`clickable` and never will be under the current design.

The repository's own test suite already documents this as INTENDED behavior:
`test/tui/hover.test.tsx:407-436`, describe block "H1: message-level hover grouping over a multi-line local
event — gated on `clickable` now (T-CLICKGATE Task 2)", whose fixture is two staged "status"-style local
events and whose comment states outright: *"Pre-T-CLICKGATE this cell proved the OPPOSITE ('un-dims EVERY
dim line of it')… this owner is never in `clickableOwners`… must now leave every one of them untouched."*

I confirmed this live, independently of the unit test, by hovering the staged block directly in a real tmux
pane: the `capture-pane -e` frame is byte-for-byte identical before and after the SGR motion event. No local,
keyless command — bash mode or any other — can ever be `clickable` under the current gate, so no choice of
staging command fixes this; the only way to give h1 a genuinely hoverable subject would be a fabricated
`--resume` session file carrying a real tool-result event, which is a materially larger, product-facing test
redesign outside this fix wave's scope (restage two named sites, don't touch `src/`).

Per the brief's own instruction, I did not weaken the assertion to force a green. h1 fails honestly, with a
header comment in `hover-cells.sh` explaining the root cause, the commit, and the corroborating unit test, so
the next person to look at a red h1 does not re-diagnose this from scratch.

## Commits

Two commits on `main`, each staging only its named file:
1. `CC-to-SDK/harness/scripts/resize-matrix.sh` — restage `/status` → local `!` bash content.
2. `CC-to-SDK/harness/scripts/hover-cells.sh` — same restage, `--permission-mode default` pin, and the
   T-CLICKGATE Task 2 finding documented on `run_h1_cell`.

(Hashes recorded in the top-level reply.)
