#!/usr/bin/env bash
# harness/scripts/resize-matrix.sh — Wave R acceptance A12: the QA-2 width matrix, scripted.
#
# WHY THIS EXISTS. Wave R's P0 (`qa2-10`, the stale full-width rules and the doubled composer block after a
# shrink) had ZERO regression coverage: no test in this repo resizes anything. Unit and Ink tests cannot
# supply it either — the defect lives in what the process WRITES to a real terminal across a SIGWINCH, which
# `ink-testing-library` has no notion of. So this drives the shipped binary under tmux and reads the frames
# back, which is the only place the defect is observable.
#
# THE THREE REPRODUCTION CONDITIONS (SP-R0). A cell that misses any one of them shows a clean screen on a
# BROKEN build and proves nothing, so every cell below establishes all three before it asserts:
#   1. a width SHRINK (a widening alone never strands a too-long line),
#   2. at least one emitted frame line LONGER than the new width — the composer's two full-width rules,
#   3. at least one row of CONTENT above the frame — staged with `/status`, which paints a real transcript
#      block with no model turn and therefore no API key (see "keyless" below).
#
# WHY tmux AND NOT `scripts/capture-frames.py` (W-R2). pyte TRUNCATES long lines instead of reflowing them,
# so the stale-rule remainder — the actual tell — never appears in a pyte frame. A green pyte run says
# nothing about a resize fix. tmux reflows like a real terminal.
#
# NO MARKER PRE-FILL IS NEEDED HERE. `tmux capture-pane` cannot tell a painted blank from an unwritten cell,
# so any assertion of the form "this row is blank" must pre-fill the screen with a marker first. Every
# assertion below is POSITIVE (a rule of the wrong width is present / a second composer block is present /
# no content sits above the frame), so the ambiguity never arises.
#
# KEYLESS BY DEFAULT. Nothing in the matrix proper runs a model turn. `HOME` and `CCX_FLEET_ROOT` point at a
# scratch dir per cell (the non-negotiable isolation rule in docs/parity/qa-driver.md §0 — an unisolated run
# once wrote to the operator's live ~/.claude), and the content above the composer comes from `/status`, a
# local command.
#
# THE ONE EXCEPTION IS THE A3 CELL (Wave R task 6, `run_a3_cell` below), which resizes DURING a streaming turn
# and therefore cannot be faked: it runs only when `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is already
# in the environment, and SKIPS with a message otherwise. It is not part of the CI-required set — CI has no
# credential, `RESIZE_MATRIX_REQUIRE_TMUX` does not reach it, and a skipped A3 records neither a pass nor a
# fail. Nothing here ever reads `../.env` or prints either variable. The remaining live cell of the wave's
# matrix (the two-turn cell) is still controller-run and deliberately not here.
#
# TEARDOWN (W-R8). Only the sessions this script named are killed, one `kill-session -t <name>` each. NEVER
# `kill-server`, `kill-session -a`, or any other all-sessions form: the owner keeps long-lived sessions on the
# same tmux daemon and a Wave R agent already destroyed two of them that way.
#
# Usage:  bash scripts/resize-matrix.sh [--no-build]      (or: npm run test:resize-matrix)
# Exit:   0 = every cell passed (or tmux is absent and the run SKIPPED), 1 = at least one cell failed.
# CI:     .github/workflows/cc-to-sdk.yml runs this on the node-22 leg with RESIZE_MATRIX_REQUIRE_TMUX=1,
#         which makes a missing tmux exit 1 instead of skipping. Two environment traps are handled below and
#         both are fatal if reinstated: the flag must not be named `CI_*`, and each ccx child needs `CI=false`.

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HARNESS_DIR/dist/cli/bin.js"
BUILD=1
for arg in "$@"; do case "$arg" in --no-build) BUILD=0 ;; *) echo "unknown flag: $arg" >&2; exit 2 ;; esac; done

# ── skip cleanly on a laptop that cannot run this — but NEVER in CI ────────────────────────────────────────
# A developer machine without tmux should not turn the suite red; a CI job that silently skips forever is a
# decorative net, which is the exact thing this matrix exists to replace. So `RESIZE_MATRIX_REQUIRE_TMUX=1`
# (set by .github/workflows/cc-to-sdk.yml, which installs tmux itself) turns the skip into a hard failure.
#
# THE NAME IS NOT `CI_REQUIRE_TMUX`, AND THAT IS DELIBERATE — see the `CI=false` note in `launch` below.
# `is-in-ci` treats ANY environment variable whose name starts with `CI_` as proof of a CI environment, so
# the obvious name for this flag silently disabled the very rendering the matrix measures (measured: all 7
# cells "never reached the ready frame").
missing() {                                 # missing <what>
  if [ -n "${RESIZE_MATRIX_REQUIRE_TMUX:-}" ]; then
    echo "FAIL: resize matrix needs $1, which is not on PATH, and RESIZE_MATRIX_REQUIRE_TMUX is set." >&2
    exit 1
  fi
  echo "SKIP: resize matrix needs $1, which is not on PATH. (Install it to run this suite.)"
  exit 0
}
command -v tmux >/dev/null 2>&1 || missing tmux
command -v node >/dev/null 2>&1 || missing node

DASH="─"                                   # U+2500, 3 bytes — the composer's rule glyph
CARET="❯"                                  # U+276F, the composer prompt

pass_count=0; fail_count=0; failed_cells=""
SESSIONS=""                                # every session name we created, for teardown
cleanup() {
  for s in $SESSIONS; do tmux kill-session -t "$s" 2>/dev/null; done   # BY NAME. never -a, never kill-server
  [ -n "${MATRIX_ROOT:-}" ] && rm -rf "$MATRIX_ROOT"
  return 0
}
trap cleanup EXIT INT TERM

# ── the frame checker ─────────────────────────────────────────────────────────────────────────────────────
# THE PASS CONDITION, verbatim from the plan: "exactly one composer block and zero rules at any width other
# than the current one". Plus the third reproduction condition as a live self-check — a cell whose content
# scrolled away is not a cell, it is a false green, so an empty region above the frame FAILS the cell rather
# than passing it quietly.
#   · a RULE is a line made only of `─`. Its width is its byte length / 3 (LC_ALL=C keeps awk on bytes, which
#     is the one length that needs no locale to be correct).
#   · a COMPOSER BLOCK is a `❯` line directly under a rule. The transcript's own echo rows also start with
#     `❯` (`❯ /status`), so the rule above is what distinguishes the live composer from its echoes — and the
#     doubled-composer defect shows up as exactly two of them.
#   · the rule COUNT is pinned at exactly 2 (the composer's own pair), not merely "at least 2", and that is
#     the check that carries the 160→80 cell. A width test alone is blind at exact multiples: a stranded
#     160-wide rule wraps into two lines that are each PERFECTLY 80 wide, so every rule on a residue-carrying
#     screen measures "correct". Only the count gives it away. This build does briefly paint four during the
#     160→80 step and settles back to two within the convergence window below — the assertion is on the
#     settled frame, which is what a user sees.
check_frame() {                            # check_frame <capture-file> <width> <label>
  local file="$1" w="$2" label="$3" out verdict
  out=$(LC_ALL=C awk -v w="$w" -v dash="$DASH" -v caret="$CARET" '
    { line=$0; sub(/[ \t]+$/, "", line)
      isRule = (line ~ ("^(" dash ")+$"))
      if (isRule) { rules++; n = length(line)/3; if (n != w) { bad++; badlist = badlist " " n } if (!firstRule) firstRule = NR }
      else {
        if (prevRule && line ~ ("^" caret)) comp++
        if (!firstRule && line ~ /[^ ]/) content++
      }
      prevRule = isRule
    }
    END { printf "rules=%d wrongWidth=%d(%s) composerBlocks=%d contentAboveFrame=%d",
                 rules+0, bad+0, (badlist == "" ? "-" : substr(badlist,2)), comp+0, content+0
          if (bad+0 == 0 && comp+0 == 1 && rules+0 == 2 && content+0 >= 1) printf " OK"; else printf " BAD" }
  ' "$file")
  verdict="${out##* }"
  if [ "$verdict" = "OK" ]; then printf '      ok   %-28s %s\n' "$label" "${out% *}"; return 0; fi
  printf '      FAIL %-28s %s\n' "$label" "${out% *}"
  echo "      ── frame ──"; sed 's/^/      | /' "$file"; echo "      ───────────"
  return 1
}

# ── the checker's own self-test ───────────────────────────────────────────────────────────────────────────
# A frame check that cannot fail is worse than no check. These three canned frames run BEFORE any session is
# launched: the broken one is the shape docs/parity/qa-driver.md §5 recorded live (a 120-wide rule hard-wrapped
# into 80 + 40, and the composer painted twice), and if the checker greens it the whole run aborts.
rule_of() { local n="$1" s=""; local i=0; while [ "$i" -lt "$n" ]; do s="$s$DASH"; i=$((i+1)); done; printf '%s\n' "$s"; }
self_test() {
  local dir; dir=$(mktemp -d /tmp/wr-t5-self-XXXXXX)
  { echo "  Tips for getting started"; rule_of 80; echo "$CARET Try \"edit <filepath> to...\""; rule_of 80; } > "$dir/clean"
  { echo "  Tips for getting started"; rule_of 80; rule_of 40; echo "$CARET Try \"edit <filepath> to...\""
    rule_of 80; rule_of 40; echo "$CARET Try \"edit <filepath> to...\""; } > "$dir/broken"
  { rule_of 80; echo "$CARET Try \"edit <filepath> to...\""; rule_of 80; } > "$dir/nocontent"
  # The exact-multiple case the width test cannot see: a stale 160-wide rule at width 80 is two lines of
  # exactly 80. Every rule here measures correct; only the COUNT is wrong.
  { echo "  Tips for getting started"; rule_of 80; rule_of 80
    rule_of 80; echo "$CARET Try \"edit <filepath> to...\""; rule_of 80; } > "$dir/multiple"
  local ok=1
  check_frame "$dir/clean" 80 "self-test/clean" >/dev/null 2>&1 || { echo "SELF-TEST: the checker rejects a CLEAN frame"; ok=0; }
  check_frame "$dir/broken" 80 "self-test/broken" >/dev/null 2>&1 && { echo "SELF-TEST: the checker ACCEPTS the recorded broken frame — it has no teeth"; ok=0; }
  check_frame "$dir/nocontent" 80 "self-test/no-content" >/dev/null 2>&1 && { echo "SELF-TEST: the checker accepts a frame with no content above it"; ok=0; }
  check_frame "$dir/multiple" 80 "self-test/exact-multiple" >/dev/null 2>&1 && { echo "SELF-TEST: the checker accepts residue whose width is an exact multiple"; ok=0; }
  rm -rf "$dir"
  [ "$ok" = 1 ] || { echo "ABORT: frame checker self-test failed."; exit 1; }
  echo "  checker self-test: rejects the recorded broken frame and the exact-multiple residue, accepts the clean one, demands content above."
}

# ── session helpers (docs/parity/qa-driver.md §2) ─────────────────────────────────────────────────────────
launch() {                                  # launch <session> <cols> <rows> [<env-var-name-to-forward>]
  local s="$1" x="$2" y="$3" fwd="${4-}" home proj cmd
  home="$MATRIX_ROOT/$s-home"; proj="$MATRIX_ROOT/$s-proj"; mkdir -p "$home/.claude/ccx" "$proj"
  # `CI=false` IS LOAD-BEARING, AND WITHOUT IT THIS SUITE CANNOT RUN ON ANY CI RUNNER AT ALL. Ink asks
  # `is-in-ci`, which is true when `CI` or `CONTINUOUS_INTEGRATION` is merely PRESENT, or when any variable
  # named `CI_*` is — and GitHub Actions always exports `CI=true`. Under that flag `ink.js:76` never
  # subscribes to `resize` and `:111` writes STATIC OUTPUT ONLY: no live frame, no repaint, no SIGWINCH
  # handling. That is precisely the machinery this matrix measures, so every cell would report "never
  # reached the ready frame" — a red CI step that looks like a product regression and is not one.
  # `is-in-ci` short-circuits on the literal `"false"`, which is the one lever that beats all three clauses.
  # It is also the honest value here: the pane below is a real PTY being driven as an interactive user.
  cmd="env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false node $BIN"
  # THE CREDENTIAL, WHEN THERE IS ONE (task 6's A3 cell), GOES THROUGH `-e` AND NOT THROUGH `$cmd`. Appending
  # it there would put it in the argv of the shell tmux runs, visible in `ps` for the whole life of the
  # session; with `-e` the child's argv is the `env … node bin.js` line and nothing else (measured). What `-e`
  # costs instead is tmux's SESSION environment, which this same user can read back with
  # `tmux show-environment -t <session>` until the cell kills the session, plus the launching tmux client's own
  # argv while that one call runs. That is the smallest exposure available here: nothing is written to disk and
  # nothing is echoed. `${!fwd}` is an indirect expansion — the caller passes the NAME, so no value appears in
  # this script's source or in any log line. tmux ≥ 3.2 (`run_a3_cell` gates on the version before asking).
  if [ -n "$fwd" ]; then
    tmux new-session -d -s "$s" -x "$x" -y "$y" -c "$proj" -e "$fwd=${!fwd}" "$cmd" || return 1
  else
    tmux new-session -d -s "$s" -x "$x" -y "$y" -c "$proj" "$cmd" || return 1
  fi
  SESSIONS="$SESSIONS $s"
  tmux set-option -t "$s" remain-on-exit on >/dev/null
  # READY-NEEDLE. NOT qa-driver.md §2.1's `⇧Tab to cycle`, which this build no longer prints anywhere (its
  # footer reads `⇧Tab mode` and the tips line `⇧Tab to change mode`) — that needle burns its whole timeout
  # against a REPL that was ready in a second. `⏎ send` is the composer's own hint row and survives every
  # width in the matrix, wrapping but never disappearing.
  local i=0
  while [ "$i" -lt 120 ]; do
    tmux capture-pane -t "$s" -p 2>/dev/null | grep -qF '⏎ send' && return 0
    sleep 0.5; i=$((i+1))
  done
  echo "      FAIL $s never reached the ready frame"; return 1
}
type_line() { tmux send-keys -t "$1" -l "$2"; sleep 0.3; tmux send-keys -t "$1" Enter; }
# Condition 3, staged: `/status` is a LOCAL command — it paints an echo row and a five-line block with no
# model turn, so the screen has real content above the composer on a machine with no API key at all.
stage_content() {                           # stage_content <session>
  local s="$1" i=0
  type_line "$s" "/status"
  while [ "$i" -lt 40 ]; do tmux capture-pane -t "$s" -p | grep -qF "$CARET /status" && return 0; sleep 0.25; i=$((i+1)); done
  echo "      FAIL $s never painted the staged /status content"; return 1
}
# Give the app a bounded window to converge WITHOUT further input, then assert on the settled screen.
# EVERY frame assertion goes through here — a one-shot capture right after launch or a submit is a timing
# gamble a slow CI runner will eventually lose (t5-fix re-review, finding A). Polling rather than a fixed
# sleep is deliberate on both sides: a slow-but-correct repaint is not a defect, and the defect this guards
# does not self-heal on a timer (qa-driver §5), so a broken build still fails after the window closes. No key
# is ever sent during the wait — a keystroke forces a partial repaint that HIDES the residue. The optional
# needle gates the check on some text having arrived first (a5 waits for its submit echo this way); the
# frame check still runs loudly on the final capture either way, so a missing needle cannot mask a failure.
settle_frame() {                            # settle_frame <session> <cols> <label> [needle]
  local s="$1" x="$2" label="$3" needle="${4-}" i=0 cap; cap="$MATRIX_ROOT/cap"
  while [ "$i" -lt 24 ]; do                 # 6 s — the 160→80 step transits a four-rule frame on the way down
    tmux capture-pane -t "$s" -p > "$cap"
    if [ -z "$needle" ] || grep -qF "$needle" "$cap"; then
      check_frame "$cap" "$x" "$label" >/dev/null 2>&1 && break
    fi
    sleep 0.25; i=$((i+1))
  done
  tmux capture-pane -t "$s" -p > "$cap"
  check_frame "$cap" "$x" "$label"
}
resize_to() {                               # resize_to <session> <cols> <rows> <label>
  local s="$1" x="$2" y="$3" label="$4"
  tmux resize-window -t "$s" -x "$x" -y "$y" || { echo "      FAIL resize-window failed"; return 1; }
  local got; got=$(tmux display -p -t "$s" '#{pane_width}x#{pane_height}')
  [ "$got" = "${x}x${y}" ] || { echo "      FAIL pane is $got, asked for ${x}x${y}"; return 1; }
  settle_frame "$s" "$x" "$label"
}
kill_cell() { tmux kill-session -t "$1" 2>/dev/null; SESSIONS=$(echo "$SESSIONS" | sed "s/ $1//"); }

record() {                                  # record <cell-name> <status 0|1>
  if [ "$2" = 0 ]; then pass_count=$((pass_count+1)); echo "  PASS $1"
  else fail_count=$((fail_count+1)); failed_cells="$failed_cells $1"; echo "  FAIL $1"; fi
}

# ── one matrix cell: launch at the first size, stage content, walk the steps ───────────────────────────────
run_cell() {                                # run_cell <name> <w0>x<h0> [<w>x<h> …]
  local name="$1"; shift
  local first="$1"; shift
  local s="wr-t5-$name" w0="${first%x*}" h0="${first#*x}" rc=0
  echo "  cell $name: $first$(for st in "$@"; do printf ' -> %s' "$st"; done)"
  launch "$s" "$w0" "$h0" || { record "$name" 1; kill_cell "$s"; return; }
  stage_content "$s" || { record "$name" 1; kill_cell "$s"; return; }
  local cap="$MATRIX_ROOT/cap"
  settle_frame "$s" "$w0" "start ${w0}x${h0}" || rc=1
  for step in "$@"; do
    resize_to "$s" "${step%x*}" "${step#*x}" "$step" || rc=1
  done
  kill_cell "$s"
  record "$name" "$rc"
}

# ── the A5 cell: a submit AFTER a shrink must leave no composer placeholder behind ─────────────────────────
# A5 is the other half of the P0: the residue that survives into the STATIC region. Upstream's placeholder
# (`Try "…"`) is the string that gets stranded, so its presence at or above the submitted prompt is the
# failure. The submit is a local command for the same keyless reason as `stage_content`.
#
# THE ORDER IS THE WHOLE CELL, AND THE OBVIOUS ORDER IS WRONG (fix round 1). The first draft staged `/status`
# BEFORE the shrink, which made this assertion unfailable: `pickPlaceholder` (src/tui/placeholder.ts:145-155)
# returns NOTHING once `submitCount >= 1`, so the placeholder was already gone before the cell looked for it —
# green on a build with the correction stubbed out. The genuine repro SHRINKS FIRST, while the placeholder is
# still painted, and takes its "content above the frame" from the launch banner instead of from `/status`.
# Both preconditions below are asserted rather than assumed, so this cell cannot quietly go vacuous again.
#
# WHY THERE ARE TWO SHRINKS AND NOT ONE. A session's FIRST shrink is repaired by `correctionAfterRepaint`
# (the verdict is not in yet when Ink writes); every LATER shrink is repaired by `frameWriteCorrection` at the
# write itself (resizeRepaint.ts's header). A single-shrink cell therefore exercises only the first of those —
# measured: with `frameWriteCorrection` stubbed to `""` a one-shrink a5 stays green. 120→100 warms the
# verdict, 100→80 is the shrink under test, and the cell now goes red for a stub of EITHER corrector.
run_a5_cell() {
  local s="wr-t5-a5" rc=0 cap="$MATRIX_ROOT/cap"
  echo "  cell a5: launch 120x40 (placeholder painted) -> 100x40 -> shrink 80x24 -> submit -> no stranded placeholder"
  launch "$s" 120 40 || { record "a5" 1; kill_cell "$s"; return; }
  settle_frame "$s" 120 "a5 start 120x40" || rc=1
  # PRECONDITION 1 — the string whose residue is under test is on screen BEFORE the shrink. (The launch banner
  # is also what satisfies check_frame's content-above-the-frame demand here.)
  if ! grep -qF 'Try "' "$cap"; then
    echo "      FAIL a5 precondition: no composer placeholder at launch — the cell would assert on nothing"
    sed 's/^/      | /' "$cap"; kill_cell "$s"; record "a5" 1; return
  fi
  resize_to "$s" 100 40 "a5 warm 100x40" || rc=1        # first shrink: puts a MEASURED verdict on the terminal
  resize_to "$s" 80 24 "a5 shrink 80x24" || rc=1        # the shrink under test, corrected at the write itself
  # PRECONDITION 2 — it survived the shrink as LIVE composer text. The question this cell asks is whether the
  # copy of it painted at the OLD width gets stranded when the submit repaints, so it has to still be there.
  tmux capture-pane -t "$s" -p > "$cap"
  if ! grep -qF 'Try "' "$cap"; then
    echo "      FAIL a5 precondition: the placeholder vanished at the shrink — nothing left to strand"
    sed 's/^/      | /' "$cap"; kill_cell "$s"; record "a5" 1; return
  fi
  printf '      ok   %-28s placeholder painted at 120 and still live at 80\n' "a5 preconditions"
  type_line "$s" "/status"
  # One bounded poll covers both waits: the echo must have arrived AND the frame must have settled. A broken
  # build never converges, so this changes flake exposure only, not detection (t5-fix re-review, finding A).
  settle_frame "$s" 80 "a5 after submit" "$CARET /status" || rc=1
  # …and the A5 assertion proper: the echo of the submitted prompt is on screen, and NO placeholder row
  # survives at or above it.
  local echo_line placeholder
  echo_line=$(grep -nF "$CARET /status" "$cap" | tail -1 | cut -d: -f1)
  if [ -z "$echo_line" ]; then echo "      FAIL the submitted prompt never echoed"; rc=1
  else
    placeholder=$(head -n "$echo_line" "$cap" | grep -cF 'Try "')
    if [ "$placeholder" != 0 ]; then
      echo "      FAIL $placeholder composer placeholder row(s) stranded at/above the submitted prompt"
      sed 's/^/      | /' "$cap"; rc=1
    else printf '      ok   %-28s no placeholder above the submitted prompt\n' "a5 residue"; fi
  fi
  kill_cell "$s"
  record "a5" "$rc"
}

# ── the live A3 cell: a resize DURING a streaming turn (Wave R task 6, qa2-09) ─────────────────────────────
# `qa2-09` photographed up to FOUR `esc to interrupt` rows carrying THREE different elapsed times in one frame
# after a mid-turn resize, and its claim that this self-heals at end of turn was refuted by measurement (spec
# §12 item 14): every stale row survived the interrupt verbatim. Both halves are asserted here — one spinner
# row while the turn runs, and none once Esc has ended it.
#
# WHY THIS ONE CANNOT BE KEYLESS. Every other cell stages its content with `/status`, a local command. A3's
# subject is the LIVE TURN's own chrome: a spinner that reprints on its own timer while text streams under it.
# There is nothing to resize into without a model actually answering, so this cell is gated on a credential
# and skips (recording neither pass nor fail) when there is none. The component-level regression guard for the
# same acceptance is `test/tui/resize-midturn.test.tsx`, which is keyless and runs in CI; it can prove that
# ChatApp never mounts a second spinner, and cannot see repaint residue at all. This cell is the other half.
spinner_rows() { grep -cF 'esc to interrupt' "$1"; }                        # spinner.ts:67's tail, verbatim
elapsed_rows() { grep -cE '\(([0-9]+m )?[0-9]+s( · [0-9]+ tokens)? · esc to interrupt\)' "$1"; }   # …with its clock
# How many captured rows are longer than <width>. Measured on the PRE-shrink capture, because `capture-pane`
# already folds every row to the pane width — SP-R0's "a line longer than the new width" can only be observed
# before the resize. Byte length (LC_ALL=C) slightly overstates for multi-byte glyphs; that only makes this
# precondition easier to satisfy, and it gates nothing but the cell's own honesty.
wide_rows() { LC_ALL=C awk -v w="$1" '{ line=$0; sub(/[ \t]+$/, "", line); if (length(line) > w) c++ } END { print c+0 }' "$2"; }
# settle_frame's discipline applied to the spinner count: poll, never sleep on a fixed delay, and never send a
# key during the wait (a keystroke forces a partial repaint that HIDES residue). The extra rule here is the
# HOLD — the count must be right on three consecutive captures, because a live turn repaints continuously and
# a single good capture between two repaints proves nothing. A build with the filed defect never reaches the
# hold: the stale rows do not self-heal (qa-driver §5).
settle_spinner() {                          # settle_spinner <session> <expected-count> <label>
  local s="$1" want="$2" label="$3" i=0 hold=0 cap="$MATRIX_ROOT/cap-a3" n m
  while [ "$i" -lt 40 ]; do                 # 10 s
    tmux capture-pane -t "$s" -p > "$cap"
    n=$(spinner_rows "$cap")
    if [ "$n" = "$want" ]; then hold=$((hold+1)); [ "$hold" -ge 3 ] && break; else hold=0; fi
    sleep 0.25; i=$((i+1))
  done
  tmux capture-pane -t "$s" -p > "$cap"
  n=$(spinner_rows "$cap"); m=$(elapsed_rows "$cap")
  if [ "$n" = "$want" ] && [ "$m" = "$want" ]; then printf '      ok   %-28s escRows=%s elapsedRows=%s\n' "$label" "$n" "$m"; return 0; fi
  printf '      FAIL %-28s escRows=%s elapsedRows=%s (want %s of each)\n' "$label" "$n" "$m" "$want"
  [ "$want" = 1 ] && [ "$n" = 0 ] && echo "      NB zero rows where one was expected means the TURN ENDED before this step — inconclusive, not a spinner defect. Lengthen A3_PROMPT and rerun."
  echo "      ── frame ──"; sed 's/^/      | /' "$cap"; echo "      ───────────"
  return 1
}
# `new-session -e` landed in tmux 3.2. Older tmux can still run every keyless cell, so this gates the live
# cell only rather than the whole script — and it is a SKIP, because forwarding the credential any other way
# would put it in an argv that lingers.
tmux_has_session_env() {
  local v maj min
  v=$(tmux -V 2>/dev/null | awk '{print $2}'); [ -n "$v" ] || return 1
  maj="${v%%.*}"; min=$(printf '%s' "${v#*.}" | tr -dc '0-9')
  [ -n "$maj" ] && [ -n "$min" ] || return 1
  [ "$maj" -gt 3 ] || { [ "$maj" -eq 3 ] && [ "$min" -ge 2 ]; }
}
# EIGHT PARAGRAPHS, NO LISTS, NO CODE, NO TOOLS — every clause is load-bearing. Length: the cell has to
# shrink, re-grow and interrupt INSIDE one turn, and each of those steps polls for a settled frame, so the
# answer must stream for tens of seconds rather than a couple. Prose and not a list: SP-R0's second condition
# is an emitted row LONGER than the post-shrink width, which flowing paragraphs at 120 columns supply and a
# list of short items does not. No tools: a permission dialog mid-turn would replace the composer and end the
# stream, which is a different acceptance entirely.
A3_PROMPT='Write eight long paragraphs of flowing prose, roughly 800 words in total, about why redrawing a terminal user interface after a window resize is difficult. No lists, no headings, no code, no tools.'
run_a3_cell() {
  local s="wr-t6-a3" rc=0 cap="$MATRIX_ROOT/cap-a3" fwd="" i=0 wide=0
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then fwd=CLAUDE_CODE_OAUTH_TOKEN          # subscription-billed; preferred
  elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then fwd=ANTHROPIC_API_KEY
  else
    echo "  SKIP a3 (live): no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment — a mid-turn resize needs a real streaming turn. Not part of the CI-required set."
    return 0
  fi
  tmux_has_session_env || { echo "  SKIP a3 (live): tmux is older than 3.2, which is where 'new-session -e' arrived — the only way this cell can hand the child a credential without leaving it in a lingering argv."; return 0; }
  echo "  cell a3 (live, forwarding \$$fwd): 120x40, submit a multi-second turn -> shrink 80x40 mid-stream -> grow 100x40 -> Esc"
  launch "$s" 120 40 "$fwd" || { record "a3" 1; kill_cell "$s"; return; }
  settle_frame "$s" 120 "a3 start 120x40" || rc=1
  type_line "$s" "$A3_PROMPT"
  # PRECONDITION 1 — the turn is really in flight. Resizing an idle REPL is cell c1, not this one.
  settle_spinner "$s" 1 "a3 spinner up" || { echo "      FAIL a3 precondition: no live spinner to resize under"; kill_cell "$s"; record "a3" 1; return; }
  # PRECONDITION 2 — SP-R0's second condition, asserted rather than assumed: rows wider than the width the
  # next step shrinks to. Polled, because the first seconds of a turn carry the prompt echo and nothing else.
  while [ "$i" -lt 40 ]; do
    tmux capture-pane -t "$s" -p > "$cap"
    wide=$(wide_rows 80 "$cap"); [ "$wide" != 0 ] && break
    sleep 0.25; i=$((i+1))
  done
  if [ "$wide" = 0 ]; then
    echo "      FAIL a3 precondition: no streamed row is wider than 80 — the shrink below could not strand anything"
    sed 's/^/      | /' "$cap"; kill_cell "$s"; record "a3" 1; return
  fi
  printf '      ok   %-28s %s row(s) wider than 80 are on screen, spinner live\n' "a3 preconditions" "$wide"
  # THE SHRINK, MID-STREAM. Both assertions run on the settled screen: the spinner count (this cell's own)
  # and check_frame's composer/rule verdict (every other cell's), because a mid-turn resize must not break the
  # composer geometry either.
  tmux resize-window -t "$s" -x 80 -y 40 || { echo "      FAIL resize-window failed"; rc=1; }
  settle_spinner "$s" 1 "a3 shrink 80x40" || rc=1
  settle_frame   "$s" 80 "a3 frame 80x40" || rc=1
  tmux resize-window -t "$s" -x 100 -y 40 || { echo "      FAIL resize-window failed"; rc=1; }
  settle_spinner "$s" 1 "a3 grow 100x40" || rc=1
  settle_frame   "$s" 100 "a3 frame 100x40" || rc=1
  # …AND THE INTERRUPT, which is the half the original finding got wrong. Esc on a busy turn is always
  # interrupt (ChatApp's onInterrupt), so no second key is needed and none is sent.
  tmux send-keys -t "$s" Escape
  settle_spinner "$s" 0 "a3 after interrupt" || rc=1
  settle_frame   "$s" 100 "a3 frame after interrupt" || rc=1
  kill_cell "$s"
  record "a3" "$rc"
}

# ── run ───────────────────────────────────────────────────────────────────────────────────────────────────
echo "Wave R — QA-2 width matrix (A12)"
self_test

if [ "$BUILD" = 1 ]; then
  echo "  building ccx (dist/) …"
  ( cd "$HARNESS_DIR" && npm run build >/dev/null 2>&1 ) || { echo "ABORT: npm run build failed."; exit 1; }
fi
[ -f "$BIN" ] || { echo "ABORT: $BIN missing (run npm run build)."; exit 1; }

# Isolation proof (qa-driver §0): the real prefs file must be byte-identical before and after. Recorded rather
# than assumed — the one incident this discipline exists for was a run that wrote to the operator's live file.
REAL_PREFS="$HOME/.claude/ccx/prefs.json"
prefs_stamp() { [ -f "$REAL_PREFS" ] || { echo "absent"; return; }; ls -l "$REAL_PREFS" 2>/dev/null | awk '{print $5, $6, $7, $8}'; }
PREFS_BEFORE=$(prefs_stamp)

# `/tmp` LITERALLY, not `$TMPDIR`. The isolated HOME holds the fleet's UDS socket
# (`$HOME/.claude/ccx/run/<pid>.sock`), and macOS's per-user `$TMPDIR` — `/var/folders/<2>/<24>/T/` — pushes
# that path past the 104-byte `sun_path` limit: every session died on bind with status 1 and a truncated
# error, which reads exactly like "the REPL never started". Discovered the hard way here; keep the root short.
MATRIX_ROOT=$(mktemp -d /tmp/wr-t5-matrix-XXXXXX)

# The QA-2 width matrix (plan Global Constraints). The first four shrink; the last two are the height-only
# controls, which must stay clean — they are the "did the fix over-erase?" half of the matrix.
run_cell c1 120x40 80x24 120x40
run_cell c2 120x40 60x15 120x40
run_cell c3 80x24 160x40 80x24
run_cell c4 120x40 100x40 90x40 80x40          # the accumulation cell (A2): three shrinks, no reset between
run_cell h1 120x24 120x40                      # height-only control
run_cell h2 80x40 80x15                        # height-only control
run_a5_cell
run_a3_cell                                    # live (task 6, A3); skips cleanly with no credential

PREFS_AFTER=$(prefs_stamp)
if [ "$PREFS_BEFORE" != "$PREFS_AFTER" ]; then
  echo "  FAIL isolation: $REAL_PREFS changed during the run ($PREFS_BEFORE -> $PREFS_AFTER)"
  fail_count=$((fail_count+1)); failed_cells="$failed_cells isolation"
else
  echo "  isolation held: $REAL_PREFS unchanged ($PREFS_BEFORE)"
fi

echo
echo "matrix: $pass_count passed, $fail_count failed"
[ "$fail_count" = 0 ] || { echo "failed:$failed_cells"; exit 1; }
exit 0
