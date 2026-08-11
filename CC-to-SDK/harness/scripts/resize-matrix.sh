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
# WHY THERE IS NO BURST CELL, MEASURED (W2 t7, s2qa2-07). A cell for a rapid multi-width drag was written and
# then withdrawn: the tmux CLI cannot produce one at the granularity a real drag has, and the two regimes it
# CAN produce are both useless here. Separate `tmux resize-window` invocations are ~250 ms apart (measured,
# one client round-trip each), which is not a burst at all — every leg settles and the per-leg correction
# already owns it. Chaining them into one round-trip (`resize-window … \; resize-window …`) goes the other
# way: all three sizes are applied before the app's first SIGWINCH handler runs, and since `columns` is read
# live at handler time the intermediate width is never delivered to the process AT ALL — a probe process
# under a 120 → 90 → 150 → 120 chain logged `resize 150`, `resize 120` and no 90. That reflow leaves real
# residue on screen (a 30-cell tail of a 120-wide rule) and NOTHING in ccx can reach it: every repair here is
# measured off widths the process observed, and this one it never saw. Repairing it would need a screen-level
# wipe, which is the over-erase the whole wave refuses.
#   WHAT IS LEFT IS THEREFORE A BOUNDED CLAIM, and the bound is not measured (fix round 1). The regime the
# settle window handles is a drag whose legs the handler observes one at a time — a live mouse drag on a real
# emulator, which is not scriptable from here and whose inter-signal spacing this repo has NOT measured (an
# earlier "~12 ms apart (measured)" here had no recorded method and is withdrawn). The chained-tmux case above
# is the counter-example in miniature: legs that land faster than the handler runs are never delivered, and
# their residue is out of reach of any width-history repair. So s2qa2-07 is PARTIALLY addressed, with the
# unreachable remainder named, and the reachable part pinned in test/unit/resize-repaint.test.ts, not here.
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
# TEARDOWN (W-R8). Only the sessions THIS RUN CREATED are killed, one `kill-session -t <name>` each. NEVER
# `kill-server`, `kill-session -a`, or any other all-sessions form: the owner keeps long-lived sessions on the
# same tmux daemon and a Wave R agent already destroyed two of them that way. "This run created" is enforced
# twice over — every session name carries the run's pid, and `kill_cell` kills nothing that is not in
# `SESSIONS`, which a name joins only after `tmux new-session` has succeeded (see `RUN_ID` below).
#
# Usage:  bash scripts/resize-matrix.sh [--no-build]      (or: npm run test:resize-matrix)
#         RESIZE_MATRIX_CELLS=a3 bash scripts/resize-matrix.sh --no-build   — one cell, for iterating on it
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
# …AND THE NAMES ARE PER-RUN, WHICH IS THE OTHER HALF OF THE SAME RULE (external whole-branch review). With a
# FIXED name (`wr-t5-c1`) two things go wrong at once and they compound: `tmux new-session -d -s wr-t5-c1`
# FAILS with "duplicate session" if that name is already taken — by a developer's own session, or by a second
# matrix run — and every caller's failure path then calls `kill_cell`, which killed the name unconditionally.
# So the failure caused by someone else's session was answered by DESTROYING it: the W-R8 incident class this
# script's header exists to warn about, reintroduced by the recovery path. The pid suffix makes the collision
# unreachable (a live run holds its own pid, so no concurrent run can repeat it), and `kill_cell` now refuses
# any name this run did not successfully register — belt and braces, because only the second of those is a
# guarantee about what we kill rather than about what we are called.
RUN_ID="$$"
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
repeat_glyph() { local g="$1" n="$2" s="" i=0; while [ "$i" -lt "$n" ]; do s="$s$g"; i=$((i+1)); done; printf '%s\n' "$s"; }
rule_of() { repeat_glyph "$DASH" "$1"; }
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
  # …and the live A3 cell's OWN precondition checker, for the same reason and by the same construction (fix
  # round 1). `bare120` is a 120-column composer frame with NOTHING streamed above it — the exact screen the
  # A3 cell sees in the first second of a turn, and the screen its "no row is wider than 80" branch has to
  # fire on. `wide_carets` is 30 `❯` = 90 bytes but 30 columns: a byte-length check calls it wide, which is
  # why the count is over glyphs.
  { rule_of 120; echo "$CARET Try \"edit <filepath> to...\""; rule_of 120; } > "$dir/bare120"
  { repeat_glyph x 100; rule_of 120; echo "$CARET "; rule_of 120; } > "$dir/streamed"
  { repeat_glyph "$CARET" 30; rule_of 120; echo "$CARET "; rule_of 120; } > "$dir/wide_carets"
  [ "$(wide_rows_above_frame 80 "$dir/bare120")" = 0 ]  || { echo "SELF-TEST: the A3 wide-row precondition counts the composer's own rules — its failure branch can never fire"; ok=0; }
  [ "$(wide_rows_above_frame 80 "$dir/streamed")" = 1 ] || { echo "SELF-TEST: the A3 wide-row precondition misses a streamed row wider than 80"; ok=0; }
  [ "$(wide_rows_above_frame 80 "$dir/wide_carets")" = 0 ] || { echo "SELF-TEST: the A3 wide-row precondition measures bytes, not columns"; ok=0; }
  # …AND THE A3 SPINNER NEEDLES, whose whole history is a pair of assertions that could not fail (see their
  # block below). Five canned rows, each one a case the repair has to get right; the DUPLICATE frame is the
  # qa2-09 photograph itself — two spinner rows carrying two different clocks — and it is what proves the
  # count can reach 2 on a build that strands one, which no healthy live run can demonstrate.
  { echo "some streamed prose"; echo "✻ Baking… (4s · ↓ 142 tokens · thinking)"; rule_of 80; echo "$CARET "; rule_of 80; } > "$dir/sp_live"
  { echo "some streamed prose"; echo "✳ Baking… (4s · ↓ 142 tokens · thinking)"
    echo "· Baking… (11s · ↓ 380 tokens)"; rule_of 80; echo "$CARET "; rule_of 80; } > "$dir/sp_dup"
  { echo "some streamed prose"; echo "✻ Worked for 4s"; rule_of 80; echo "$CARET "; rule_of 80; } > "$dir/sp_done"
  { echo "some streamed prose"; echo "✻ Thinking…"; rule_of 80; echo "$CARET "; rule_of 80; } > "$dir/sp_placeholder"
  { echo "some streamed prose"; echo "✶ Baking… (thinking)"; rule_of 80; echo "$CARET "; rule_of 80; } > "$dir/sp_noclock"
  { echo "some streamed prose"; echo "✳ Baking…"; rule_of 80; echo "$CARET "; rule_of 80; } > "$dir/sp_bare"
  [ "$(spinner_rows "$dir/sp_live")" = 1 ]        || { echo "SELF-TEST: spinner_rows does not see a live spinner row"; ok=0; }
  [ "$(elapsed_rows "$dir/sp_live")" = 1 ]        || { echo "SELF-TEST: elapsed_rows does not see the parenthetical clock"; ok=0; }
  [ "$(spinner_clock "$dir/sp_live")" = "4s" ]    || { echo "SELF-TEST: spinner_clock misreads the clock ($(spinner_clock "$dir/sp_live"))"; ok=0; }
  [ "$(spinner_rows "$dir/sp_dup")" = 2 ]         || { echo "SELF-TEST: spinner_rows CANNOT COUNT A STRANDED DUPLICATE — the A3 cell has no teeth"; ok=0; }
  [ "$(elapsed_rows "$dir/sp_dup")" = 2 ]         || { echo "SELF-TEST: elapsed_rows cannot count a stranded duplicate"; ok=0; }
  [ "$(spinner_rows "$dir/sp_done")" = 0 ]        || { echo "SELF-TEST: the end-of-turn duration row reads as a live spinner"; ok=0; }
  [ "$(elapsed_rows "$dir/sp_done")" = 0 ]        || { echo "SELF-TEST: the end-of-turn duration row reads as an elapsed row"; ok=0; }
  [ "$(spinner_rows "$dir/sp_placeholder")" = 0 ] || { echo "SELF-TEST: the transcript's collapsed-thinking placeholder reads as a live spinner"; ok=0; }
  [ "$(spinner_rows "$dir/sp_noclock")" = 1 ] && [ "$(elapsed_rows "$dir/sp_noclock")" = 0 ] \
    || { echo "SELF-TEST: the two needles are not independent — a tail with no clock must satisfy the shape and not the content"; ok=0; }
  # The QUIET-GATED head of a turn: no parenthetical at all. The shape needle must still see it, or the cell
  # waits for the tail before it resizes and lands its shrink in whichever regime the model chose that run.
  [ "$(spinner_rows "$dir/sp_bare")" = 1 ] && [ "$(elapsed_rows "$dir/sp_bare")" = 0 ] \
    || { echo "SELF-TEST: the shape needle misses a quiet-gated spinner row (no tail yet)"; ok=0; }
  rm -rf "$dir"
  [ "$ok" = 1 ] || { echo "ABORT: frame checker self-test failed."; exit 1; }
  echo "  checker self-test: rejects the recorded broken frame and the exact-multiple residue, accepts the clean one, demands content above; the A3 wide-row precondition fires on a bare composer frame; the A3 spinner needles count a stranded duplicate as 2 and read neither the end-of-turn row nor the thinking placeholder as a spinner."
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
  # costs instead, stated at its TRUE bound (fix round 1 — the first version understated it): tmux's SESSION
  # environment, which this same user can read back with `tmux show-environment -t <session>` until the cell
  # kills the session; AND the `tmux new-session … -e NAME=value …` argv itself, which is the launching client's
  # — normally gone the moment that call returns, but when this call is what STARTS the tmux server the client
  # BECOMES the server, so a process with ppid 1 carries that argv for the server's whole life, outliving the
  # session it was passed to (measured on tmux 3.7b: killing the `-e` session left the server's argv intact;
  # it goes only when the last session does and the server exits). Both are same-uid readable only — macOS and
  # Linux both refuse another user's argv — and nothing is written to disk or echoed, which is what makes this
  # the smallest exposure available here. `${!fwd}` is an indirect expansion: the caller passes the NAME, so no
  # value appears in this script's source or in any log line. tmux ≥ 3.2 (`run_a3_cell` gates on the version).
  if [ -n "$fwd" ]; then
    tmux new-session -d -s "$s" -x "$x" -y "$y" -c "$proj" -e "$fwd=${!fwd}" "$cmd" || return 1
  else
    tmux new-session -d -s "$s" -x "$x" -y "$y" -c "$proj" "$cmd" || return 1
  fi
  SESSIONS="$SESSIONS $s"
  tmux set-option -t "$s" remain-on-exit on >/dev/null
  # READY-NEEDLE, AND IT HAS DRIFTED TWICE NOW. It was qa-driver.md §2.1's `⇧Tab to cycle`, which Wave R
  # replaced with `⏎ send` — the composer's own hint row. Wave C task 2 then DELETED that whole row (the
  # one-row footer: `ChatComposer.tsx:1091`, "HINT ROW 1 … was a ccx invention"), so from that commit every
  # cell here burned its full 60 s and reported "never reached the ready frame" — the matrix has been failing
  # closed ever since, which is how W2 t7 found it. `⏸ manual mode on` is the footer's home state
  # (`Footer.tsx`, annex §C4.c `⏸ manual mode on · ? for shortcuts · ← for agents`): it is printed by the
  # first interactive frame at every width in the matrix, it does not depend on a draft or a turn, and the
  # matrix never changes mode. The `? for shortcuts` tail is NOT in the needle — the footer suppresses it
  # whenever a statusLine is configured, and an isolated HOME is the only reason it is on screen here.
  local i=0
  while [ "$i" -lt 120 ]; do
    tmux capture-pane -t "$s" -p 2>/dev/null | grep -qF '⏸ manual mode on' && return 0
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
#
# THE HOLD (fix round 1) IS FOR THE LIVE CELL ONLY. This polls until one capture passes and then asserts on a
# FRESH capture — which is right for an idle REPL, where nothing moves between the two, and a flake channel on
# A3's mid-turn frames, where the screen is repainting continuously: a transient capture taken mid-repaint can
# show `rules=4` / `composerBlocks=2`, i.e. exactly the defect under test, and fail a healthy build. So
# `settle_frame_hold` demands the check pass on THREE consecutive captures before it stops polling — the same
# rule `settle_spinner` already carries, for the same reason. The seven idle cells keep hold=1 and are not
# slowed. Neither form can turn a broken build green: the verdict is always the final capture's, and the
# residue does not self-heal on a timer (qa-driver §5), so a broken build still fails once the window closes.
settle_frame()      { _settle_frame "$1" "$2" "$3" "${4-}" 1; }   # settle_frame <session> <cols> <label> [needle]
settle_frame_hold() { _settle_frame "$1" "$2" "$3" "${4-}" 3; }   # …with the three-capture hold, for a repainting screen
_settle_frame() {                           # _settle_frame <session> <cols> <label> <needle> <hold>
  local s="$1" x="$2" label="$3" needle="$4" need="$5" i=0 hold=0 cap; cap="$MATRIX_ROOT/cap"
  while [ "$i" -lt 24 ]; do                 # 6 s — the 160→80 step transits a four-rule frame on the way down
    tmux capture-pane -t "$s" -p > "$cap"
    if { [ -z "$needle" ] || grep -qF "$needle" "$cap"; } && check_frame "$cap" "$x" "$label" >/dev/null 2>&1; then
      hold=$((hold+1)); [ "$hold" -ge "$need" ] && break
    else hold=0; fi
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
# ONLY WHAT THIS RUN CREATED. `launch` registers a name AFTER `tmux new-session` succeeds, so a name missing
# from SESSIONS is either one we never created or one somebody else owns — and every caller reaches here on
# the failure path, where "somebody else owns it" is exactly the reason for the failure. Killing it there is
# the W-R8 incident, so it is not done: the name is simply dropped.
kill_cell() {
  case " $SESSIONS " in *" $1 "*) tmux kill-session -t "$1" 2>/dev/null ;; esac
  SESSIONS=$(echo "$SESSIONS" | sed "s/ $1//")
}

record() {                                  # record <cell-name> <status 0|1>
  if [ "$2" = 0 ]; then pass_count=$((pass_count+1)); echo "  PASS $1"
  else fail_count=$((fail_count+1)); failed_cells="$failed_cells $1"; echo "  FAIL $1"; fi
}

# ── one matrix cell: launch at the first size, stage content, walk the steps ───────────────────────────────
run_cell() {                                # run_cell <name> <w0>x<h0> [<w>x<h> …]
  local name="$1"; shift
  local first="$1"; shift
  local s="wr-t5-$name-$RUN_ID" w0="${first%x*}" h0="${first#*x}" rc=0
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
  local s="wr-t5-a5-$RUN_ID" rc=0 cap="$MATRIX_ROOT/cap"
  echo "  cell a5: launch 120x40 (placeholder painted) -> 100x40 -> shrink 80x24 -> submit -> no stranded placeholder"
  # …AND THE PLACEHOLDER HAS TO BE TURNED ON NOW (W2 t7). Wave C task 12 made `promptSuggestionEnabled` default
  # FALSE (spec D-C4), which also silences the first-run `Try "…"` template this cell strands — so from that
  # commit precondition 1 below failed on every run and the cell asserted nothing. It is a PREFERENCE, not a
  # product change, so the cell states it: the same `~/.claude/ccx/prefs.json` a user would set, inside the
  # per-cell HOME `launch` builds (`CCX_FLEET_ROOT=$home/.claude/ccx`, so this is that file) and nowhere near
  # the operator's own. Written before launch, because `loadPrefs` runs before the first render.
  mkdir -p "$MATRIX_ROOT/$s-home/.claude/ccx"
  printf '{"promptSuggestionEnabled":true}\n' > "$MATRIX_ROOT/$s-home/.claude/ccx/prefs.json"
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

# ── the G1 cell: growing out of a HEIGHT-CLIPPED tall surface (W2 t7, s2qa2-05) ────────────────────────────
# The other half of task 7, and the only place its grow edge is observable at all: the unit tests drive a FAKE
# proxy, so they pin ChatApp's decision and can say nothing about whether the decision is ever reached on a
# real terminal. The fix's first review found exactly that gap — the shipped edge read `tallWrites()` live from
# a passive effect, which Ink's own synchronous repaint for the same SIGWINCH had already stood down.
#
# THE DEFECT. At 60x15 the `/model` picker's frame reaches the pane height, so Ink takes `ink.js:118`: it writes
# `clearTerminal + fullStaticOutput + output` straight to stdout and log-update never sees it, leaving its
# `previousLineCount` describing an older, shorter frame. Growing the pane lets the frame fit again, so the next
# render goes back through log-update — which erases that stale count and paints below whatever it missed,
# stranding the picker's top rows. The tell is the picker's own title appearing TWICE.
#
# THE PRECONDITION IS PROVABLE FROM OUTSIDE, WHICH IS WHY THIS CELL IS HONEST. "Did Ink take the tall branch"
# is not visible in a pane capture — but its side effect is: the proxy strips `ESC[3J` from that chunk
# (chatMain.tsx, "AND THE `ESC[3J` COMES OUT"), so the `fullStaticOutput` the same chunk carries APPENDS a
# complete second copy of the session's committed transcript to SCROLLBACK. So the staged `/status` echo row,
# counted over `capture-pane -S -`, goes from one to two the moment the branch fires. A run where it does not
# fails the precondition rather than passing an assertion that could not have failed.
#
# AND IT HAS TEETH, MEASURED AS AN A/B ON THE SHIPPED BINARY. With the grow edge reading `tallWrites()` live
# from the passive effect (the version this cell was written to falsify), the same sequence leaves `Select
# model` on screen TWICE after the grow — the picker's title, subtitle and first rows stranded above Ink's new
# frame, with the whole picker painted again below them. Reading the latch instead: once.
run_g1_cell() {
  local s="w2-t7-g1-$RUN_ID" rc=0 cap="$MATRIX_ROOT/cap-g1" hist="$MATRIX_ROOT/hist-g1" i=0 before=0 after=0 n=0 hold=0
  echo "  cell g1: launch 60x15, open /model (frame is screen-tall) -> grow 60x40 -> 'Select model' exactly once"
  launch "$s" 60 15 || { record "g1" 1; kill_cell "$s"; return; }
  stage_content "$s" || { record "g1" 1; kill_cell "$s"; return; }
  tmux capture-pane -t "$s" -p -S - > "$hist"
  before=$(grep -cF "$CARET /status" "$hist")
  # THE PICKER IS FOUND BY ITS FOOTER, NOT ITS TITLE. At 60x15 the title is exactly what the pane does NOT hold:
  # the frame is taller than the pane, so `Select model` is off the top — which is the whole reason this cell
  # exists, and why the post-grow assertion below is a count of 1 rather than a count that was already 1.
  type_line "$s" "/model"
  while [ "$i" -lt 40 ]; do
    tmux capture-pane -t "$s" -p > "$cap"; grep -qF 'enter to set as default' "$cap" && break
    sleep 0.25; i=$((i+1))
  done
  if ! grep -qF 'enter to set as default' "$cap"; then
    echo "      FAIL g1 precondition: the /model picker never painted at 60x15"
    sed 's/^/      | /' "$cap"; kill_cell "$s"; record "g1" 1; return
  fi
  # PRECONDITION 2 — the picker's frame actually took the tall branch (see the header). One extra copy of the
  # committed transcript in scrollback per tall render; without one, the grow below has nothing to strand and a
  # green assertion would prove nothing.
  tmux capture-pane -t "$s" -p -S - > "$hist"
  after=$(grep -cF "$CARET /status" "$hist")
  if [ "$after" -le "$before" ]; then
    echo "      FAIL g1 precondition: the picker frame did not take Ink's tall branch at 60x15 (scrollback copies of the staged row: $before -> $after) — nothing would be stranded by the grow"
    kill_cell "$s"; record "g1" 1; return
  fi
  printf '      ok   %-28s picker up, tall branch taken (scrollback copies %s -> %s)\n' "g1 preconditions" "$before" "$after"
  tmux resize-window -t "$s" -x 60 -y 40 || { echo "      FAIL resize-window failed"; kill_cell "$s"; record "g1" 1; return; }
  # settle_frame's discipline, with this cell's own assertion: poll for a settled screen, never send a key while
  # waiting (a keystroke forces a repaint that HIDES the residue), and take the verdict from the final capture.
  i=0
  while [ "$i" -lt 24 ]; do
    tmux capture-pane -t "$s" -p > "$cap"
    n=$(grep -cF 'Select model' "$cap")
    if [ "$n" = 1 ]; then hold=$((hold+1)); [ "$hold" -ge 3 ] && break; else hold=0; fi
    sleep 0.25; i=$((i+1))
  done
  tmux capture-pane -t "$s" -p > "$cap"
  n=$(grep -cF 'Select model' "$cap")
  if [ "$n" = 1 ]; then printf '      ok   %-28s Select model appears exactly once after the grow\n' "g1 grow 60x40"
  else
    printf '      FAIL %-28s Select model appears %s time(s) after the grow (want 1)\n' "g1 grow 60x40" "$n"
    echo "      ── frame ──"; sed 's/^/      | /' "$cap"; echo "      ───────────"; rc=1
  fi
  tmux send-keys -t "$s" Escape                        # close the picker before teardown
  kill_cell "$s"
  record "g1" "$rc"
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
#
# ⚠ AND AS OF THE REPAIR BELOW IT IS RED ON THIS BUILD, ON THE PRODUCT AND NOT ON THE INSTRUMENT. With the
# needles re-authored the cell reproduces qa2-09 verbatim: an early mid-turn shrink strands the spinner row it
# was painting, frozen at the second of the resize, above the assistant text that arrives afterwards, while the
# live spinner carries on below it — `spinnerRows=2` for about seventeen seconds, after which the corpse leaves
# by scrolling off the top rather than by being erased, and in one run of five it outlived the interrupt too.
# Measured 5/5 on an early shrink and 0/2 on a late one (a shrink that lands once the screen is already
# scrolling shows nothing), which is the regime split the shrink timing below is pinned to. The composer
# geometry is repaired in the same frames (`check_frame` is green throughout), so this is the ONE live row
# `resizeRepaint.ts`'s correction does not reach. Filed as a product defect; the cell stays honest and red
# until it is fixed, and must not be re-timed to land its shrink where the defect hides.
#
# THE NEEDLES ROTTED ONCE ALREADY, AND THE LESSON IS WHY THEY LOOK LIKE THIS. Both used to key on the literal
# `esc to interrupt`, which Wave C task 6 deleted from the spinner tail and re-homed on the FOOTER — so the old
# `spinner_rows` counted the footer and returned 1 the instant any turn began, on any build, healthy or not
# (measured `escRows=1 elapsedRows=0` against a healthy build with one spinner up; full mechanism in git
# history, this block's Wave-C-era comment). Two rules fall out of that and both are structural, not
# incidental:
#   · NEVER KEY ON AFFORDANCE TEXT. The footer hint spells whatever chord is bound to `chat:cancel`
#     (Footer.tsx's own note), so `esc to interrupt` is wrong twice over — wrong surface, and not even a
#     constant on the surface it lives on. Key on what the spinner IS.
#   · KEY ON TWO INDEPENDENT LAYERS, so one drifting cannot silently green the other: `spinner_rows` on the
#     row's SHAPE, `elapsed_rows` on its CONTENT.
#
# WHAT THE SPINNER ACTUALLY RENDERS TODAY (TurnSpinner.tsx, spinner.ts): one row, `{glyph} {Gerund}… {tail}` —
# an animated glyph from `SPINNER_FRAMES` (`· ✢ ✳ ✶ ✻ ✽`, pulsed out and back), a single-token gerund with a
# U+2026 ellipsis, and canon `C0p`'s dim parenthetical `({elapsed} · {↓|↑} {N} tokens · {phase})`.
#   · `spinner_rows` counts rows of that SHAPE — glyph, gerund, ellipsis. This is the count the cell asserts:
#     exactly 1 while the turn runs, 0 once it has ended.
#   · `elapsed_rows` counts the subset whose parenthetical LEADS WITH A CLOCK (`formatDuration`: `4s`,
#     `1m 5s`, `1h 2m 3s` — spaced and unpadded). That is the segment a stranded copy freezes.
#
# THE TWO GATES, AND WHY THE SHAPE NEEDLE STOPS SHORT OF THE TAIL (spinner.ts `spinnerStatus`). Every tail
# segment is behind a WIDTH gate (`room = columns - (messageWidth + 2) - 5`; at the 80/100/120 columns this
# cell uses, a clock of three or four glyphs clears it with ~50 to spare) and behind the QUIET gate — `loud =
# verbose || hasPhase || tokens > 0 || elapsedMs > 16 s` — so a turn that has produced nothing yet renders a
# BARE `✻ Baking…` and the parenthetical simply is not there. A first draft folded the parenthetical into the
# shape needle, and that decided WHEN THE CELL RESIZES: the tail arrives in about a second when the model
# opens with a thinking burst (`hasPhase`) and not for twenty-five when it does not (nothing is loud until
# tokens flow), and the two land the shrink in two completely different regimes. Measured, that is the whole
# verdict — see the shrink step below. So the shape needle is gate-free and fires within a second of any turn,
# the clock is asserted in its own step once it is guaranteed to exist, and every count assertion holds
# `elapsed_rows <= spinner_rows`: a clock can only ride a spinner row, which pins 0 of each after the turn
# ends while leaving the head of a turn free to be briefly clockless.
#
# AND IT IS WHY THE END-OF-TURN ROW CANNOT READ AS A SPINNER. `durationRow.ts` prints `✻ Worked for 4s` when a
# turn finishes — the SAME U+273B glyph, dim, with a duration on it. It has no ellipsis and no parenthetical,
# so neither needle sees it, which is what lets `settle_spinner "$s" 0` after the interrupt mean "the spinner
# is gone" instead of "the turn never happened". The transcript's collapsed-thinking placeholder (`✻ Thinking…`,
# render.ts) is excluded by the same clause — it wears the glyph and the ellipsis but never a parenthetical.
# All five of those cases are pinned in `self_test`, including a two-spinner frame the count must catch.
SPINNER_GLYPH='(·|✢|✳|✶|✻|✽)'                       # `SPINNER_FRAMES` (spinner.ts) as an alternation: a byte
                                                    # class would match the shared UTF-8 lead byte of all six.
SPINNER_ROW="^${SPINNER_GLYPH} [^ ]+…"              # glyph · single-token gerund · U+2026
SPINNER_CLOCK='\(([0-9]+d )?([0-9]+h )?([0-9]+m )?[0-9]+(\.[0-9])?s'   # `formatDuration`, all four rollovers
# The ONE literal the shape needle has to step over: `render.ts`'s collapsed-thinking placeholder, a transcript
# row that wears the same glyph and the same ellipsis and is not a spinner. It is a frozen constant, where the
# spinner's glyph animates over six frames and its gerund over 186 verbs — so excluding the exact string costs
# at most one polling frame in the 1-in-1116 case where the live spinner happens to spell it too.
THINKING_PLACEHOLDER_ROW='✻ Thinking…'
spinner_rows() {                                    # spinner_rows <capture-file>
  LC_ALL=C awk -v skip="$THINKING_PLACEHOLDER_ROW" -v re="$SPINNER_ROW" '
    { line = $0; sub(/[ \t]+$/, "", line); if (line != skip && line ~ re) n++ } END { print n+0 }' "$1"
}
elapsed_rows() { LC_ALL=C grep -cE "${SPINNER_ROW} ${SPINNER_CLOCK}( ·|\))" "$1"; }
# The clock itself, for the "it is still ticking" assertion below — a stranded copy of the row keeps whatever
# time it was painted at, so a live spinner and its corpse differ in exactly this field.
spinner_clock() { LC_ALL=C grep -oE "${SPINNER_ROW} ${SPINNER_CLOCK}" "$1" | tail -1 | sed 's/.*(//'; }
# How many rows of the STREAMED REGION — everything ABOVE the composer's first rule — are wider than <width>.
# Measured on the PRE-shrink capture, because `capture-pane` already folds every row to the pane width, so
# SP-R0's "a line longer than the new width" can only be observed before the resize.
#
# THE REGION BOUND IS THE ENTIRE POINT (fix round 1). The first version measured the WHOLE capture, and the
# composer's own two rules are one glyph per column — 360 BYTES each at 120 columns. The count was therefore
# ≥ 2 on the very first poll of a screen with no streamed text on it at all, so precondition 2 below could
# never fail and the cell was free to assert a "mid-stream" shrink over an empty transcript. Stopping at the
# first rule leaves exactly the streamed region, which is what SP-R0's second condition is about. The bare-
# composer case is pinned in `self_test` above so this cannot silently regress.
#
# GLYPHS, NOT BYTES. `length()` under LC_ALL=C counts bytes, and a prose row carrying a handful of multi-byte
# glyphs would measure over-wide while occupying fewer columns than the shrink target — a precondition that
# passes on a row that could not actually be stranded. Counting UTF-8 LEAD bytes (every byte outside the
# 0x80–0xBF continuation range) is the column count for the text this cell streams, and needs no locale.
wide_rows_above_frame() {                   # wide_rows_above_frame <width> <capture-file>
  LC_ALL=C awk -v w="$1" -v dash="$DASH" '
    function glyphs(s,   i, c, n) { n = 0; for (i = 1; i <= length(s); i++) { c = substr(s, i, 1); if (c < "\200" || c >= "\300") n++ } return n }
    { line = $0; sub(/[ \t]+$/, "", line)
      if (line ~ ("^(" dash ")+$")) exit                        # the composer frame starts here; stop
      if (glyphs(line) > w) c++ }
    END { print c+0 }
  ' "$2"
}
# settle_frame's discipline applied to the spinner count: poll, never sleep on a fixed delay, and never send a
# key during the wait (a keystroke forces a partial repaint that HIDES residue). The extra rule here is the
# HOLD — the count must be right on three consecutive captures, because a live turn repaints continuously and
# a single good capture between two repaints proves nothing.
#
# AND THE WINDOW IS SHORT ON PURPOSE, WHICH IS THE OTHER HALF OF THE REPAIR. The convergence window every
# other assertion here uses is safe because an idle screen only ever gets better. A STREAMING one has a second
# way to reach the wanted count, and it is not a repair: text arriving under a stranded row scrolls that row
# off the top of the pane, so a long enough poll rewards the defect for waiting. Measured on this build, a
# stranded spinner row stays visible for about seventeen seconds and then leaves that way — so a fifteen-second
# window was a coin toss. Eight seconds is far more than a healthy repaint needs (one frame) and far less than
# scroll-away takes. A build with the filed defect therefore fails here rather than outliving the poll.
settle_spinner() {                          # settle_spinner <session> <expected-count> <label>
  local s="$1" want="$2" label="$3" i=0 hold=0 cap="$MATRIX_ROOT/cap-a3" n m
  while [ "$i" -lt 32 ]; do                 # 8 s — see above; NOT a convergence window
    tmux capture-pane -t "$s" -p > "$cap"
    n=$(spinner_rows "$cap"); m=$(elapsed_rows "$cap")
    if [ "$n" = "$want" ] && [ "$m" -le "$want" ]; then hold=$((hold+1)); [ "$hold" -ge 3 ] && break; else hold=0; fi
    sleep 0.25; i=$((i+1))
  done
  tmux capture-pane -t "$s" -p > "$cap"
  n=$(spinner_rows "$cap"); m=$(elapsed_rows "$cap")
  if [ "$n" = "$want" ] && [ "$m" -le "$want" ]; then printf '      ok   %-28s spinnerRows=%s elapsedRows=%s\n' "$label" "$n" "$m"; return 0; fi
  printf '      FAIL %-28s spinnerRows=%s elapsedRows=%s (want %s spinner rows, no more clocks than rows)\n' "$label" "$n" "$m" "$want"
  [ "$want" = 1 ] && [ "$n" = 0 ] && echo "      NB zero rows where one was expected means the TURN ENDED before this step — inconclusive, not a spinner defect. Lengthen A3_PROMPT and rerun."
  echo "      ── frame ──"; sed 's/^/      | /' "$cap"; echo "      ───────────"
  return 1
}
# The clock, asserted where it is guaranteed to exist rather than where the resize has to happen. `loud` opens
# on a thinking burst within a second, or on the first tokens, or at the 16 s quiet threshold — so this poll is
# generous where `settle_spinner`'s is deliberately not, and it is the one place the cell will sit and wait.
settle_tail() {                             # settle_tail <session> <label>
  local s="$1" label="$2" i=0 cap="$MATRIX_ROOT/cap-a3" n m
  while [ "$i" -lt 100 ]; do                # 25 s — covers the quiet threshold with room to spare
    tmux capture-pane -t "$s" -p > "$cap"
    [ "$(elapsed_rows "$cap")" = 1 ] && break
    sleep 0.25; i=$((i+1))
  done
  n=$(spinner_rows "$cap"); m=$(elapsed_rows "$cap")
  if [ "$n" = 1 ] && [ "$m" = 1 ]; then printf '      ok   %-28s spinnerRows=%s elapsedRows=%s\n' "$label" "$n" "$m"; return 0; fi
  printf '      FAIL %-28s spinnerRows=%s elapsedRows=%s (want 1 of each)\n' "$label" "$n" "$m"
  echo "      ── frame ──"; sed 's/^/      | /' "$cap"; echo "      ───────────"
  return 1
}
# …and the other half of "the row survived the resize": it is the LIVE one. A duplicate stranded by a repaint
# is a dead copy of a row painted at an earlier second, so the surviving row's clock must still be moving.
# Sampled twice with a gap wider than the clock's one-second resolution; equal readings fail. (A resize that
# strands a copy usually fails the COUNT first — this catches the other shape, where the live row is the one
# erased and what is left behind is the corpse.)
spinner_ticks() {                           # spinner_ticks <session> <label>
  local s="$1" label="$2" cap="$MATRIX_ROOT/cap-a3" t0 t1
  tmux capture-pane -t "$s" -p > "$cap"; t0=$(spinner_clock "$cap")
  sleep 2
  tmux capture-pane -t "$s" -p > "$cap"; t1=$(spinner_clock "$cap")
  if [ -n "$t0" ] && [ -n "$t1" ] && [ "$t0" != "$t1" ]; then
    printf '      ok   %-28s clock advanced %s -> %s\n' "$label" "$t0" "$t1"; return 0
  fi
  printf '      FAIL %-28s clock did not advance (%s -> %s)\n' "$label" "${t0:-<none>}" "${t1:-<none>}"
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
  local s="wr-t6-a3-$RUN_ID" rc=0 cap="$MATRIX_ROOT/cap-a3" fwd="" i=0 wide=0
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
  # PRECONDITION 1 — the turn is really in flight. Resizing an idle REPL is cell c1, not this one. The needle
  # is the gate-free SHAPE, so this clears about a second into any turn and the shrink below lands EARLY and
  # at the same point every run, whatever the model does with its first breath (see the needle block).
  settle_spinner "$s" 1 "a3 spinner up" || { echo "      FAIL a3 precondition: no live spinner to resize under"; kill_cell "$s"; record "a3" 1; return; }
  # PRECONDITION 2 — SP-R0's second condition, asserted rather than assumed: STREAMED rows (above the composer
  # frame — see `wide_rows_above_frame`, and the self-test that proves this branch can fire) wider than the
  # width the next step shrinks to. Polled, because the first seconds of a turn carry the prompt echo and
  # nothing else.
  while [ "$i" -lt 40 ]; do
    tmux capture-pane -t "$s" -p > "$cap"
    wide=$(wide_rows_above_frame 80 "$cap"); [ "$wide" != 0 ] && break
    sleep 0.25; i=$((i+1))
  done
  if [ "$wide" = 0 ]; then
    echo "      FAIL a3 precondition: no streamed row is wider than 80 — the shrink below could not strand anything"
    sed 's/^/      | /' "$cap"; kill_cell "$s"; record "a3" 1; return
  fi
  printf '      ok   %-28s %s streamed row(s) wider than 80 are on screen, spinner live\n' "a3 preconditions" "$wide"
  # THE SHRINK, MID-STREAM. Both assertions run on the settled screen: the spinner count (this cell's own)
  # and check_frame's composer/rule verdict (every other cell's), because a mid-turn resize must not break the
  # composer geometry either. The frame verdict takes the HOLD form here and nowhere else: text is still
  # arriving under the composer, so a single capture snatched mid-repaint can show the four-rule / two-composer
  # shape transiently on a healthy build (fix round 1).
  tmux resize-window -t "$s" -x 80 -y 40 || { echo "      FAIL resize-window failed"; rc=1; }
  settle_spinner    "$s" 1 "a3 shrink 80x40" || rc=1
  settle_frame_hold "$s" 80 "a3 frame 80x40" || rc=1
  tmux resize-window -t "$s" -x 100 -y 40 || { echo "      FAIL resize-window failed"; rc=1; }
  settle_spinner    "$s" 1 "a3 grow 100x40" || rc=1
  settle_frame_hold "$s" 100 "a3 frame 100x40" || rc=1
  # …and now the CONTENT half, in the one place the tail is guaranteed: the surviving row carries a clock, and
  # that clock is still moving. A row stranded by a repaint is a dead copy frozen at the second it was painted,
  # so a build that erases the LIVE row and keeps the corpse — the shape the count alone cannot tell apart —
  # fails here instead.
  settle_tail   "$s" "a3 clock present" || rc=1
  spinner_ticks "$s" "a3 clock advancing" || rc=1
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
#
# CELL SELECTION, for iterating on one cell without paying for the other eight: `RESIZE_MATRIX_CELLS=a3`
# (space- or comma-separated names) runs only what it names. Unset — the CI and the DoD form — runs all nine.
# A filtered run still prints its own tally, so it can never be mistaken for a full one.
want_cell() {                               # want_cell <name>
  [ -z "${RESIZE_MATRIX_CELLS:-}" ] && return 0
  case " $(printf '%s' "$RESIZE_MATRIX_CELLS" | tr ',' ' ') " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}
want_cell c1 && run_cell c1 120x40 80x24 120x40
want_cell c2 && run_cell c2 120x40 60x15 120x40
want_cell c3 && run_cell c3 80x24 160x40 80x24
want_cell c4 && run_cell c4 120x40 100x40 90x40 80x40   # the accumulation cell (A2): three shrinks, no reset between
want_cell h1 && run_cell h1 120x24 120x40               # height-only control
want_cell h2 && run_cell h2 80x40 80x15                 # height-only control
want_cell a5 && run_a5_cell
want_cell g1 && run_g1_cell                    # W2 t7 (s2qa2-05): clip-then-grow out of Ink's tall branch
want_cell a3 && run_a3_cell                    # live (task 6, A3); skips cleanly with no credential

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
