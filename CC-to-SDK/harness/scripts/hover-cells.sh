#!/usr/bin/env bash
# harness/scripts/hover-cells.sh — F10 T-HOVER live pty acceptance: message hover (Task 1, H1) and the
# suggestion-popup hover/click (Task 2, H2/CM33), against the REAL `ccx` binary in a real tmux pane fed raw
# SGR mouse bytes. Same driver discipline as scripts/resize-matrix.sh: isolated HOME/CCX_FLEET_ROOT per cell
# (docs/parity/qa-driver.md §0), CI=false (Ink's `is-in-ci` check would otherwise disable the resize/input
# machinery this script depends on), TERM=xterm-256color, and teardown that kills ONLY the sessions this run
# created — never `kill-server`, never `kill-session -a`.
#
# THE ONE DIFFERENCE FROM resize-matrix.sh'S PIN: `CLAUDE_CODE_NO_FLICKER=1` (fullscreen) is the ONLY rung
# either cell runs under, because that is where mouse reporting is armed (altScreen.ts enters the alternate
# screen and writes `?1000h ?1002h ?1003h ?1006h`) and where the popup hoists into the dock band at all
# (D10 — the classic renderer never mounts `SuggestPopup` with a `hitRef`).
#
# `send_bytes` writes RAW bytes to the pane's stdin via `tmux send-keys -H`, so the app receives a genuine
# SGR mouse report regardless of tmux's OWN mouse mode (`send-keys -H` bypasses tmux's mouse translation
# entirely — the hex bytes land on the pty verbatim). `mouseMode()` (src/tui/mouse/mode.ts) answers "full"
# with neither `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` nor scroll-mode set, which is the default this script relies
# on.
#
# Usage:  bash scripts/hover-cells.sh [--no-build]
#         HOVER_CELLS=h1 bash scripts/hover-cells.sh --no-build   — one cell, for iterating
# Exit:   0 = every cell passed (or tmux is absent and the run SKIPPED), 1 = at least one cell failed.
# CI:     HOVER_CELLS_REQUIRE_TMUX=1 makes a missing tmux exit 1 instead of skipping (mirrors
#         RESIZE_MATRIX_REQUIRE_TMUX's own reasoning in resize-matrix.sh — a silent skip in CI is a
#         decorative net, not coverage).

set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HARNESS_DIR/dist/cli/bin.js"
BUILD=1
for arg in "$@"; do case "$arg" in --no-build) BUILD=0 ;; *) echo "unknown flag: $arg" >&2; exit 2 ;; esac; done

missing() {
  if [ -n "${HOVER_CELLS_REQUIRE_TMUX:-}" ]; then
    echo "FAIL: hover-cells needs $1, which is not on PATH, and HOVER_CELLS_REQUIRE_TMUX is set." >&2
    exit 1
  fi
  echo "SKIP: hover-cells needs $1, which is not on PATH. (Install it to run this suite.)"
  exit 0
}
command -v tmux >/dev/null 2>&1 || missing tmux
command -v node >/dev/null 2>&1 || missing node
command -v xxd >/dev/null 2>&1 || missing xxd

if [ "$BUILD" -eq 1 ]; then
  ( cd "$HARNESS_DIR" && npm run build >/dev/null ) || { echo "FAIL: build failed" >&2; exit 1; }
fi
[ -f "$BIN" ] || { echo "FAIL: $BIN not found after build" >&2; exit 1; }

pass_count=0; fail_count=0; failed_cells=""
SESSIONS=""
RUN_ID="$$"
HC_ROOT=$(mktemp -d /tmp/hover-cells-XXXXXX)
cleanup() {
  for s in $SESSIONS; do tmux kill-session -t "$s" 2>/dev/null; done   # BY NAME. never -a, never kill-server
  [ -n "${HC_ROOT:-}" ] && rm -rf "$HC_ROOT"
  return 0
}
trap cleanup EXIT INT TERM

# ── the driver (resize-matrix.sh's own launch/settle/kill_cell, trimmed to what this file needs) ───────────
launch() {                                   # launch <session> <cols> <rows>
  local s="$1" x="$2" y="$3" home proj cmd
  home="$HC_ROOT/$s-home"; proj="$HC_ROOT/$s-proj"; mkdir -p "$home/.claude/ccx" "$proj"
  # `CI=false` — see resize-matrix.sh's own header: `is-in-ci` is true on the mere PRESENCE of `CI`, and
  # GitHub Actions always exports `CI=true`; under it Ink never subscribes to input or resize at all.
  # `-u CI` (UNSET, not `CI=false`) — this file's own divergence from resize-matrix.sh's pin, found live.
  # `is-in-ci` (gates Ink's resize/input subscription) treats the literal string `"false"` as "not CI", but
  # `supports-color` (gates chalk's `dimColor`/`color` output — everything this script asserts on) checks
  # only `'CI' in env`, true for ANY value including `"false"`, and answers "no color support" once it is.
  # Under `CI=false` this script saw a real ccx frame with ZERO ANSI escapes anywhere; unsetting the
  # variable outright (rather than assigning a falsy string) satisfies both checks at once.
  cmd="env -u CI HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CLAUDE_CODE_NO_FLICKER=1 node $BIN"
  tmux new-session -d -s "$s" -x "$x" -y "$y" -c "$proj" "$cmd" || return 1
  SESSIONS="$SESSIONS $s"
  tmux set-option -t "$s" remain-on-exit on >/dev/null
  local i=0
  while [ "$i" -lt 120 ]; do
    # Mode-agnostic: a fresh isolated HOME may default to auto or manual mode depending on the build's own
    # onboarding default, and this needle only needs to prove the footer painted, not which mode it is in.
    tmux capture-pane -t "$s" -p 2>/dev/null | grep -qE 'mode on' && return 0
    sleep 0.5; i=$((i+1))
  done
  echo "      FAIL $s never reached the ready frame"; return 1
}
kill_cell() {
  case " $SESSIONS " in *" $1 "*) tmux kill-session -t "$1" 2>/dev/null ;; esac
  SESSIONS=$(echo "$SESSIONS" | sed "s/ $1//")
}
record() {                                  # record <cell-name> <status 0|1>
  if [ "$2" = 0 ]; then pass_count=$((pass_count+1)); echo "  PASS $1"
  else fail_count=$((fail_count+1)); failed_cells="$failed_cells $1"; echo "  FAIL $1"; fi
}
type_line() { tmux send-keys -t "$1" -l "$2"; }
settle() { sleep 0.4; }
# Poll until `needle` appears in the CAPTURED pane (scrollback included, `-S -`, matching resize-matrix.sh's
# own `stage_content` reasoning: a short pane can scroll the needle above the viewport before this looks).
wait_for() {                                 # wait_for <session> <needle> [<timeout-steps>]
  local s="$1" needle="$2" steps="${3:-40}" i=0 cap="$HC_ROOT/cap-wait"
  while [ "$i" -lt "$steps" ]; do
    tmux capture-pane -t "$s" -p -S - > "$cap"
    grep -qF "$needle" "$cap" && return 0
    sleep 0.25; i=$((i+1))
  done
  echo "      FAIL $s never showed \"$needle\""
  echo "      ── capture ──"; sed 's/^/      | /' "$cap"; echo "      ──────────"
  return 1
}

# ── raw SGR mouse bytes, `send-keys -H` (hex, bypasses tmux's own mouse translation entirely) ───────────────
send_bytes() { tmux send-keys -t "$1" -H $(printf '%s' "$2" | xxd -p -c1 | tr '\n' ' '); }
sgr_motion()  { send_bytes "$1" "$(printf '\033[<35;%s;%sM' "$2" "$3")"; }   # button 32|3 — any-motion
sgr_press()   { send_bytes "$1" "$(printf '\033[<0;%s;%sM'  "$2" "$3")"; }
sgr_release() { send_bytes "$1" "$(printf '\033[<0;%s;%sm'  "$2" "$3")"; }
dim_rows()    { grep -c $'\033\[2m' "$1" || true; }   # `capture-pane -e` keeps the SGR runs

# ═══ Cell h1 — message hover (H1, Task 1's transcript-row hover), keyless ═══════════════════════════════════
run_h1_cell() {
  local s="hc-h1-$RUN_ID"
  echo "  cell h1: /status hover un-dims, then restores off-block"
  launch "$s" 100 24 || { record h1 1; kill_cell "$s"; return; }
  type_line "$s" "/status"; tmux send-keys -t "$s" Enter; settle
  wait_for "$s" "Status" || { record h1 1; kill_cell "$s"; return; }
  settle
  local before="$HC_ROOT/h1-before" after="$HC_ROOT/h1-after" restored="$HC_ROOT/h1-restored"
  tmux capture-pane -t "$s" -p -e > "$before"
  local before_dim; before_dim=$(dim_rows "$before")
  if [ "$before_dim" -lt 2 ]; then
    echo "      FAIL h1 premise: fewer than 2 dim rows before hover ($before_dim)"; record h1 1; kill_cell "$s"; return
  fi
  # Hover the SECOND row of the /status block (row 6: prompt echo at ~5, block starts just under it).
  sgr_motion "$s" 5 6; settle
  tmux capture-pane -t "$s" -p -e > "$after"
  local after_dim; after_dim=$(dim_rows "$after")
  local rc=0
  if [ "$after_dim" -ge "$before_dim" ]; then
    echo "      FAIL h1: dim-row count did not drop on hover (before=$before_dim after=$after_dim)"; rc=1
  fi
  # THE BAND NEGATION: no row anywhere gained a `48;2;` background it did not already have.
  local before_bg after_bg
  before_bg=$(grep -oE '48;2;[0-9]+;[0-9]+;[0-9]+' "$before" | sort -u)
  after_bg=$(grep -oE '48;2;[0-9]+;[0-9]+;[0-9]+' "$after" | sort -u)
  if [ "$before_bg" != "$after_bg" ]; then
    echo "      FAIL h1: hover changed the set of painted backgrounds (band negation violated)"
    echo "      before: $before_bg"; echo "      after:  $after_bg"; rc=1
  fi
  # Motion OFF the block restores every dim row.
  sgr_motion "$s" 5 20; settle
  tmux capture-pane -t "$s" -p -e > "$restored"
  local restored_dim; restored_dim=$(dim_rows "$restored")
  if [ "$restored_dim" -lt "$before_dim" ]; then
    echo "      FAIL h1: dim rows did not fully restore off-block (before=$before_dim restored=$restored_dim)"; rc=1
  fi
  kill_cell "$s"
  record h1 "$rc"
}

# ═══ Cell h2 — popup hover/click (H2/CM33, this task), keyless ══════════════════════════════════════════════
run_h2_cell() {
  local s="hc-h2-$RUN_ID"
  echo "  cell h2: palette hover swaps rows, arrows take it back, click accepts"
  launch "$s" 80 24 || { record h2 1; kill_cell "$s"; return; }
  tmux send-keys -t "$s" -l "/"; settle
  wait_for "$s" "/model" || { record h2 1; kill_cell "$s"; return; }
  settle
  local cap="$HC_ROOT/h2-cap"
  tmux capture-pane -t "$s" -p -e > "$cap"
  # The five painted rows, in order: model, compact, context, cost, status (commands.ts's own COMMANDS
  # order — an empty query ranks unchanged). Find the SECOND painted row's terminal row number.
  local row2; row2=$(grep -n '/compact' "$cap" | head -1 | cut -d: -f1)
  local row1; row1=$(grep -n '/model' "$cap" | head -1 | cut -d: -f1)
  if [ -z "$row2" ] || [ -z "$row1" ]; then
    echo "      FAIL h2: could not locate the palette's first two rows in the capture"
    echo "      ── capture ──"; sed 's/^/      | /' "$cap"; echo "      ──────────"
    record h2 1; kill_cell "$s"; return
  fi
  local rc=0
  # Hover row 2 (`/compact`) — it should lose its dim run and row 1 (`/model`) should gain one (canon's
  # `!isSelected` colour-agnostic needle — see suggestPopup.tsx's `dimColor={!selected}`).
  sgr_motion "$s" 5 "$row2"; settle
  tmux capture-pane -t "$s" -p -e > "$cap"
  local line1 line2
  line1=$(sed -n "${row1}p" "$cap"); line2=$(sed -n "${row2}p" "$cap")
  if printf '%s' "$line2" | grep -qF $'\033[2m'; then echo "      FAIL h2: hovered row (/compact) is still dim"; rc=1; fi
  if ! printf '%s' "$line1" | grep -qF $'\033[2m'; then echo "      FAIL h2: un-hovered keyboard row (/model) lost its dim"; rc=1; fi
  # Two Downs: the keyboard takes the highlight back onto a keyboard-chosen row and the hovered row dims again.
  tmux send-keys -t "$s" Down; tmux send-keys -t "$s" Down; settle
  tmux capture-pane -t "$s" -p -e > "$cap"
  line2=$(sed -n "${row2}p" "$cap")
  if ! printf '%s' "$line2" | grep -qF $'\033[2m'; then echo "      FAIL h2: hovered row did not re-dim after two Downs (arrow-clear)"; rc=1; fi
  # Press + release on the THIRD painted row (`/context`) — the composer line must hold that command.
  local row3; row3=$(grep -n '/context' "$cap" | head -1 | cut -d: -f1)
  if [ -z "$row3" ]; then echo "      FAIL h2: could not locate the third painted row (/context)"; rc=1
  else
    sgr_press "$s" 5 "$row3"; sleep 0.05; sgr_release "$s" 5 "$row3"; settle
    tmux capture-pane -t "$s" -p > "$cap"
    if ! grep -qF '/context' "$cap"; then
      echo "      FAIL h2: composer does not hold /context after the click"
      echo "      ── capture ──"; sed 's/^/      | /' "$cap"; echo "      ──────────"; rc=1
    fi
  fi
  kill_cell "$s"
  record h2 "$rc"
}

CELLS="${HOVER_CELLS:-h1 h2}"
echo "hover-cells: $CELLS"
for c in $CELLS; do
  case "$c" in
    h1) run_h1_cell ;;
    h2) run_h2_cell ;;
    *) echo "unknown cell: $c" >&2; exit 2 ;;
  esac
done

echo
echo "hover-cells: $pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ] || { echo "failed:$failed_cells"; exit 1; }
exit 0
