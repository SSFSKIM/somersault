#!/usr/bin/env bash
# harness/scripts/select-pty.sh — F10 T-SELECT: the track's tmux pty harness (cells added by later tasks
# too). Mirrors scripts/resize-matrix.sh's discipline exactly: a PRIVATE tmux socket, per-run session names
# carrying `$$`, `SESSIONS` registered only after `new-session` succeeds, teardown that kills ONLY those
# names (never `kill-server`, never `-a`), one isolated `HOME`/project dir per cell, `CI=false` (Ink's own
# resize/render machinery is disabled under a bare `CI` truthy check — see resize-matrix.sh's own note),
# and `CLAUDE_CODE_NO_FLICKER=1` unconditionally: this whole track is the fullscreen renderer, so every cell
# here measures it, never the classic one.
#
# WHAT S1's OWN CELLS MEASURE, and the one finding that shaped how they read the screen back: a REAL Ink
# renderer, not just `ink-testing-library`, paints the CURSOR's own wrapped row as an extra, mis-indented
# terminal row at the exact inner-width boundary (measured live at 100 columns: a 140-character single-line
# draft, cursor at its end, painted across THREE terminal rows for what `wrapRows` alone calls two — the
# middle one a bare, unindented character with none of the leading two spaces every other continuation row
# carries). `test/tui/dockOrigin.test.tsx`'s own header records the same shape. The ROW COUNT and the
# COMPOSER'S OWN ORIGIN are unaffected (this project's whole pure `bufferPhysicalRows` table agrees with the
# real paint on both) — only where exactly a character lands WITHIN the cursor's own row is visually
# imprecise, so `caret-wrap` below verifies the click by SUBMITTING and reading the echoed prompt back,
# which is immune to that paint quirk, rather than by scraping the mid-edit frame for an exact column.
#
# THE OTHER FINDING, LOAD-BEARING FOR EVERY CELL HERE: a real terminal's SGR press and release must reach
# the app with NOTHING sent in between. Any `sleep` between `press` and `release` — even a fraction of a
# second — lets an intervening event (this build arms `?1003`, any-motion reporting, by default) clear the
# tap machine's own pending-press anchor (`ChatApp.tsx`'s `tapAnchorRef`) before the release can complete
# the click, and the release is then silently dropped exactly as an unrelated "different cell" release
# would be — measured: sleeping between them reproducibly appended every typed character at the buffer's
# true end instead of at the clicked cell, while a press/release/keystroke sequence with no sleep at all
# between any of the three resolved correctly every time. `tap` below never sleeps inside the gesture.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HARNESS_DIR/dist/cli/bin.js"
BUILD=1
for arg in "$@"; do case "$arg" in --no-build) BUILD=0 ;; *) echo "unknown flag: $arg" >&2; exit 2 ;; esac; done

TM="f10select"                              # the private tmux socket name (-L), never the default server
missing() {
  if [ -n "${SELECT_PTY_REQUIRE_TMUX:-}" ]; then
    echo "FAIL: select-pty needs $1, which is not on PATH, and SELECT_PTY_REQUIRE_TMUX is set." >&2
    exit 1
  fi
  echo "SKIP: select-pty needs $1, which is not on PATH. (Install it to run this suite.)"
  exit 0
}
command -v tmux >/dev/null 2>&1 || missing tmux
command -v node >/dev/null 2>&1 || missing node

pass_count=0; fail_count=0; failed_cells=""
SESSIONS=""
RUN_ID="$$"
cleanup() {
  for s in $SESSIONS; do tmux -L "$TM" kill-session -t "$s" 2>/dev/null; done   # BY NAME. never -a, never kill-server
  # A killed session's own process (the live cell's `ccx`) can still be flushing its own project-local
  # files (`~/.claude/projects/...`) for a moment after `kill-session` returns — a bare `rm -rf` racing that
  # write fails with "Directory not empty" on a dir the writer re-populated between `rm`'s readdir and its
  # rmdir. One retry after a short wait clears it without turning a real failure into a silent one.
  if [ -n "${SELECT_ROOT:-}" ]; then
    rm -rf "$SELECT_ROOT" 2>/dev/null || { sleep 0.5; rm -rf "$SELECT_ROOT" 2>/dev/null; }
  fi
  return 0
}
trap cleanup EXIT INT TERM

record() {                                  # record <cell-name> <status 0|1>
  if [ "$2" = 0 ]; then pass_count=$((pass_count+1)); echo "  PASS $1"
  else fail_count=$((fail_count+1)); failed_cells="$failed_cells $1"; echo "  FAIL $1"; fi
}
kill_cell() {
  case " $SESSIONS " in *" $1 "*) tmux -L "$TM" kill-session -t "$1" 2>/dev/null ;; esac
  SESSIONS=$(echo "$SESSIONS" | sed "s/ $1//")
}

# ── the mouse gesture, and `row_of` for locating a needle's own painted row ─────────────────────────────
send_sgr() {                                # send_sgr <session> <button> <col> <row> <M|m>
  # An SGR mouse report as raw bytes: ESC [ < b ; col ; row (M press/drag | m release). `-H` hex, so no
  # shell quoting of ESC is involved and the bytes are exactly what a terminal would deliver.
  local s="$1" text hex="1b" i ch
  text="$(printf '[<%d;%d;%d%s' "$2" "$3" "$4" "$5")"
  for (( i=0; i<${#text}; i++ )); do printf -v ch '%02x' "'${text:$i:1}"; hex="$hex $ch"; done
  # shellcheck disable=SC2086
  tmux -L "$TM" send-keys -t "$s" -H $hex
}
press()   { send_sgr "$1" 0  "$2" "$3" M; }   # left button down
drag()    { send_sgr "$1" 32 "$2" "$3" M; }   # motion with button 0 held
release() { send_sgr "$1" 0  "$2" "$3" m; }
row_of()  { LC_ALL=C grep -n -- "$2" "$1" | head -1 | cut -d: -f1; }   # 1-based pane row of a needle
# THE GESTURE ITSELF, WITH ZERO SLEEP INSIDE IT (see the header) — press, release, then whatever the caller
# wants typed next, back to back in ONE call so nothing can land between the press and the completing key.
tap_and_type() {                            # tap_and_type <session> <col> <row> <text>
  press   "$1" "$2" "$3"
  release "$1" "$2" "$3"
  tmux -L "$TM" send-keys -t "$1" -l "$4"
}

launch() {                                  # launch <session> <cols> <rows> <argv-string>
  local s="$1" x="$2" y="$3" argv="$4" home proj log cmd
  home="$SELECT_ROOT/$s-home"; proj="$SELECT_ROOT/$s-proj"; log="$SELECT_ROOT/$s.log"
  mkdir -p "$home/.claude/ccx" "$proj"
  # ONE STRING, exactly as resize-matrix.sh's own `launch` builds it — tmux runs a multi-argument
  # `new-session` command list through the user's shell only when it is a SINGLE argument; passing the
  # pieces separately is not the same thing and is not what this is proven against.
  # CI=false (see the header): a truthy CI/CI_* env disables Ink's resize/live-render machinery outright.
  # CLAUDE_CODE_NO_FLICKER=1 pins the fullscreen renderer unconditionally — this whole track measures it.
  cmd="env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false CLAUDE_CODE_NO_FLICKER=1 $argv"
  tmux -L "$TM" new-session -d -s "$s" -x "$x" -y "$y" -c "$proj" "$cmd" || return 1
  SESSIONS="$SESSIONS $s"
  # `pipe-pane` attached BEFORE anything is typed, so the arming sequence and every OSC 52 write land in the
  # raw log too (step 1.21's own requirement) — useful for diagnosing a cell that stages but never paints.
  tmux -L "$TM" pipe-pane -t "$s" -o "cat >> '$log'"
  echo "$home"
}
wait_ready() {                              # wait_ready <session> [<needle>]
  # `mode on (shift+tab to cycle)` rather than resize-matrix.sh's `⏸ manual mode on`: a fresh, prefs-less
  # HOME in this tree defaults to AUTO mode (`⏵⏵ auto mode on …`), not manual — measured, this run — so the
  # manual-only needle never appears at all. This half of the string is shared by both footers.
  local s="$1" needle="${2:-mode on (shift+tab to cycle)}" i=0
  while [ "$i" -lt 120 ]; do
    tmux -L "$TM" capture-pane -t "$s" -p -S - 2>/dev/null | grep -qF "$needle" && return 0
    sleep 0.5; i=$((i+1))
  done
  echo "      FAIL $s never reached the ready frame (needle: $needle)"; return 1
}
frame() { tmux -L "$TM" capture-pane -t "$1" -p; }                     # frame <session>
scrollback() { tmux -L "$TM" capture-pane -t "$1" -p -S -; }           # scrollback <session>

# ── the checker's own self-test — a tap that cannot fail is worse than no tap ───────────────────────────
self_test() {
  # `tap_and_type` against a session that does not exist must fail loudly rather than hang or silently no-op
  # — `tmux send-keys` on a missing target exits non-zero, which is what this checks.
  if tap_and_type "no-such-session-$RUN_ID" 1 1 "x" 2>/dev/null; then
    echo "SELF-TEST: tap_and_type did not fail against a nonexistent session"; return 1
  fi
  return 0
}

# ── cell: caret-wrap (keyless) — acceptance cell 1's wrapped-draft arm ──────────────────────────────────
# A single 140-character draft line wraps to (at least) two physical rows in a 100-column composer
# (innerWidth 98). Clicking the wrapped continuation and typing must insert THERE, not append at the
# buffer's true end. Verified by SUBMITTING and reading the echoed prompt back (see the header on why the
# mid-edit frame is the wrong instrument for this one claim).
run_caret_wrap_cell() {
  local s="cw-$RUN_ID" home rc=0
  echo "  cell caret-wrap (keyless): 100x30, a 140-char draft wraps, click the continuation, submit, check the echo"
  home=$(launch "$s" 100 30 "node $BIN") || { record "caret-wrap" 1; kill_cell "$s"; return; }
  wait_ready "$s" || { record "caret-wrap" 1; kill_cell "$s"; return; }
  # 90 a's then 50 b's: the wrap boundary falls inside the b run, so the continuation's own content ("b"s
  # only) is what a correct click resolves into — a wrong (end-of-buffer) resolution instead lands the typed
  # character at the string's very tail, which the echo check below distinguishes from a mid-run placement.
  local draft; draft="$(printf 'a%.0s' $(seq 1 90))$(printf 'b%.0s' $(seq 1 50))"
  tmux -L "$TM" send-keys -t "$s" -l "$draft"
  local i=0
  while [ "$i" -lt 40 ]; do frame "$s" | grep -qF "aaaaaaaaaa" && break; sleep 0.25; i=$((i+1)); done
  local cap="$SELECT_ROOT/cw-cap"; frame "$s" > "$cap"
  # The composer's closing rule, and the row right above it: for a two-chunk wrap that is the properly
  # indented continuation (the mid-boundary artifact row the header describes sits ABOVE it, unindented).
  # Built as string concatenation INSIDE awk (resize-matrix.sh's own `check_frame` technique), not as a
  # ready-made `-v` pattern: under `LC_ALL=C`, a multi-byte UTF-8 glyph handed to `-v` as a literal pattern
  # does not match itself byte-for-byte the way concatenating it into the regex at awk's own parse time does
  # (measured — the literal-pattern form matched zero rules against a real captured frame).
  local close_row; close_row=$(LC_ALL=C awk -v dash="─" '$0 ~ ("^(" dash ")+$") {last=NR} END {print last+0}' "$cap")
  if [ "$close_row" = 0 ]; then echo "      FAIL caret-wrap: no composer rule found"; kill_cell "$s"; record "caret-wrap" 1; return; fi
  local cont_row=$((close_row - 1))
  tap_and_type "$s" 5 "$cont_row" "Z"
  sleep 0.5
  tmux -L "$TM" send-keys -t "$s" Enter
  i=0
  while [ "$i" -lt 40 ]; do scrollback "$s" | grep -qE 'b{3,}Z' && break; sleep 0.25; i=$((i+1)); done
  if scrollback "$s" | grep -qE 'b{3,}Zb'; then
    echo "      ok   caret-wrap: Z landed inside the wrapped continuation's own content"
  elif scrollback "$s" | grep -qE 'b{3,}Z *$'; then
    echo "      FAIL caret-wrap: Z landed at the run's own end, not inside it — could be a correct near-boundary click OR a silent append; treating as inconclusive-fail"
    rc=1
  else
    echo "      FAIL caret-wrap: Z never appeared where a correct click would leave it"
    echo "      ── scrollback tail ──"; scrollback "$s" | tail -20 | sed 's/^/      | /'; echo "      ──────────────"
    rc=1
  fi
  kill_cell "$s"
  record "caret-wrap" "$rc"
}

# ── cell: caret-busy (keyless) — acceptance cell 1's busy-turn arm, via the fake host (step 1.21a) ──────
# `state.busy` is set only by the `turn`/`start` EVENT HANDLER (useChat.ts), and the task panel only by
# the TaskCreate/tool_result message pair — both reach the REPL over the attach socket, so a fake host that
# pushes them buys this cell with no model turn and no credential at all.
run_caret_busy_cell() {
  local s="cb-$RUN_ID" fh="cb-host-$RUN_ID" home rc=0 short=""
  echo "  cell caret-busy (keyless, via fake-host.mjs): attach against a fake host pushing turn-start + 3 tasks"
  home="$SELECT_ROOT/$fh-home"; mkdir -p "$home/.claude/ccx"
  local fhcmd="env CCX_FLEET_ROOT=$home/.claude/ccx FAKE_HOST_SCRIPT=turn-start,tasks:3 node $HARNESS_DIR/scripts/fake-host.mjs"
  # Wide/tall enough that neither printed line wraps or scrolls out of the small captured viewport — a
  # narrow pane here once split `SHORT=<id>` across two visual rows and made the id ungrabbable.
  tmux -L "$TM" new-session -d -s "$fh" -x 80 -y 10 "$fhcmd" || { record "caret-busy" 1; return; }
  SESSIONS="$SESSIONS $fh"
  local i=0
  while [ "$i" -lt 40 ]; do
    short=$(tmux -L "$TM" capture-pane -t "$fh" -p -S - 2>/dev/null | grep -oE 'SHORT=[0-9a-f]{8}' | cut -d= -f2)
    [ -n "$short" ] && break
    sleep 0.25; i=$((i+1))
  done
  if [ -z "$short" ]; then
    echo "      FAIL caret-busy: fake-host.mjs never printed its short id"; kill_cell "$fh"; record "caret-busy" 1; return
  fi
  # The ATTACH session shares the FAKE HOST's own `HOME`/`CCX_FLEET_ROOT` (the roster row and the socket
  # both live there) — deliberately NOT `launch()`, which would mint a second, unrelated isolated root.
  local attachlog="$SELECT_ROOT/$s.log"
  mkdir -p "$SELECT_ROOT/$s-proj"
  local attachcmd="env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false CLAUDE_CODE_NO_FLICKER=1 node $BIN attach $short"
  tmux -L "$TM" new-session -d -s "$s" -x 100 -y 24 -c "$SELECT_ROOT/$s-proj" "$attachcmd" || { record "caret-busy" 1; kill_cell "$fh"; return; }
  SESSIONS="$SESSIONS $s"
  tmux -L "$TM" pipe-pane -t "$s" -o "cat >> '$attachlog'"
  # BOTH needles, and the cell FAILS (not skips) if either never appears — the spinner row and a task-panel
  # row are two independently-fed occupants (turn/start vs tasks_changed-shaped message pairs), and a build
  # that silently drops one is exactly the regression this cell exists to catch.
  local ok=1
  wait_ready "$s" "todo-item-3" || ok=0
  wait_ready "$s" "manual mode on" || ok=0
  if [ "$ok" != 1 ]; then
    echo "      FAIL caret-busy: did not see both the task panel and the ready composer"
    frame "$s" | sed 's/^/      | /'
    kill_cell "$s"; kill_cell "$fh"; record "caret-busy" 1; return
  fi
  local i2=0 spinner_seen=0
  while [ "$i2" -lt 20 ]; do
    frame "$s" | grep -qE '[✻✳✶·].*…' && { spinner_seen=1; break; }
    sleep 0.25; i2=$((i2+1))
  done
  if [ "$spinner_seen" != 1 ]; then
    echo "      FAIL caret-busy: no spinner row (matching [✻✳✶·].*…) ever appeared"
    frame "$s" | sed 's/^/      | /'
    kill_cell "$s"; kill_cell "$fh"; record "caret-busy" 1; return
  fi
  echo "      ok   caret-busy preconditions: task panel + live-turn spinner both painted"
  tmux -L "$TM" send-keys -t "$s" -l "$(printf '0000000000\x0a1111111111\x0a2222222222')"
  i2=0
  while [ "$i2" -lt 40 ]; do frame "$s" | grep -qF "2222222222" && break; sleep 0.25; i2=$((i2+1)); done
  local cap="$SELECT_ROOT/cb-cap"; frame "$s" > "$cap"
  local row0; row0=$(row_of "$cap" "0000000000")
  if [ -z "$row0" ]; then echo "      FAIL caret-busy: draft never painted"; kill_cell "$s"; kill_cell "$fh"; record "caret-busy" 1; return; fi
  local col0; col0=$(LC_ALL=C awk -v n="$row0" 'NR==n {print index($0, "0000000000")}' "$cap")
  tap_and_type "$s" "$((col0 + 4))" "$row0" "Z"
  sleep 0.5
  if frame "$s" | grep -qE "0+Z0+"; then
    echo "      ok   caret-busy: the click during a busy turn + open task panel repositioned the caret"
  else
    echo "      FAIL caret-busy: Z did not land in the first draft line"
    frame "$s" | sed 's/^/      | /'
    rc=1
  fi
  kill_cell "$s"; kill_cell "$fh"
  record "caret-busy" "$rc"
}

# ── cell: caret-busy-live — the same claim against a real engine (credential-gated) ─────────────────────
# Corroboration, not the acceptance evidence: caret-busy above is what acceptance cell 1 is scored on. Gated
# exactly as resize-matrix.sh's run_a3_cell is — forwarded via `new-session -e` so no secret reaches an
# argv this script writes, SKIPPED with a message when neither credential is set, and SKIPPED on tmux older
# than 3.2 (the version `new-session -e` arrived in).
tmux_has_session_env() {
  local v maj min
  v=$(tmux -V 2>/dev/null | awk '{print $2}'); [ -n "$v" ] || return 1
  maj="${v%%.*}"; min=$(printf '%s' "${v#*.}" | tr -dc '0-9')
  [ -n "$maj" ] && [ -n "$min" ] || return 1
  [ "$maj" -gt 3 ] || { [ "$maj" -eq 3 ] && [ "$min" -ge 2 ]; }
}
run_caret_busy_live_cell() {
  local s="cbl-$RUN_ID" home fwd="" rc=0
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then fwd=CLAUDE_CODE_OAUTH_TOKEN
  elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then fwd=ANTHROPIC_API_KEY
  else echo "  SKIP caret-busy-live: no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in the environment."; return 0; fi
  tmux_has_session_env || { echo "  SKIP caret-busy-live: tmux is older than 3.2 ('new-session -e' is unavailable)."; return 0; }
  echo "  cell caret-busy-live (live, forwarding \$$fwd): a real turn, click the first draft line while it streams"
  home="$SELECT_ROOT/$s-home"; mkdir -p "$home/.claude/ccx/run" "$SELECT_ROOT/$s-proj"
  # The credential goes through `-e` and NOT the command string: appending it there would put it in the
  # argv of the shell tmux runs, visible in `ps` for the session's whole life (resize-matrix.sh's own
  # `run_a3_cell` note, verbatim reasoning). Every other var is non-secret and baked into the string.
  local livecmd="env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false CLAUDE_CODE_NO_FLICKER=1 node $BIN"
  tmux -L "$TM" new-session -d -s "$s" -x 100 -y 24 -c "$SELECT_ROOT/$s-proj" -e "$fwd=${!fwd}" "$livecmd" || { record "caret-busy-live" 1; return; }
  SESSIONS="$SESSIONS $s"
  wait_ready "$s" || { kill_cell "$s"; record "caret-busy-live" 1; return; }
  tmux -L "$TM" send-keys -t "$s" -l "count slowly from 1 to 40, one number per line"
  sleep 0.3; tmux -L "$TM" send-keys -t "$s" Enter
  local i=0 spinner_seen=0
  while [ "$i" -lt 60 ]; do frame "$s" | grep -qE '[✻✳✶·].*…' && { spinner_seen=1; break; }; sleep 0.5; i=$((i+1)); done
  if [ "$spinner_seen" != 1 ]; then
    echo "      FAIL caret-busy-live: no spinner ever appeared after submit"
    kill_cell "$s"; record "caret-busy-live" 1; return
  fi
  tmux -L "$TM" send-keys -t "$s" -l "$(printf '0000000000\x0a1111111111\x0a2222222222')"
  i=0
  while [ "$i" -lt 40 ]; do frame "$s" | grep -qF "2222222222" && break; sleep 0.25; i=$((i+1)); done
  local cap="$SELECT_ROOT/cbl-cap"; frame "$s" > "$cap"
  local row0; row0=$(row_of "$cap" "0000000000")
  if [ -z "$row0" ]; then echo "      FAIL caret-busy-live: draft never painted over live output"; kill_cell "$s"; record "caret-busy-live" 1; return; fi
  local col0; col0=$(LC_ALL=C awk -v n="$row0" 'NR==n {print index($0, "0000000000")}' "$cap")
  tap_and_type "$s" "$((col0 + 4))" "$row0" "Z"
  sleep 0.5
  if frame "$s" | grep -qE "0+Z0+"; then
    echo "      ok   caret-busy-live: the click during a real streaming turn repositioned the caret"
  else
    echo "      FAIL caret-busy-live: Z did not land in the first draft line"
    frame "$s" | sed 's/^/      | /'
    rc=1
  fi
  tmux -L "$TM" send-keys -t "$s" Escape
  kill_cell "$s"
  record "caret-busy-live" "$rc"
}

# ── run ──────────────────────────────────────────────────────────────────────────────────────────────────
echo "F10 T-SELECT S1 — the caret-origin pty harness (FULLSCREEN renderer, CLAUDE_CODE_NO_FLICKER=1)"
self_test || { echo "SELF-TEST FAILED — aborting before any session is launched"; exit 1; }

if [ "$BUILD" = 1 ]; then
  echo "  building ccx (dist/) …"
  ( cd "$HARNESS_DIR" && npm run build >/dev/null 2>&1 ) || { echo "ABORT: npm run build failed."; exit 1; }
fi
[ -f "$BIN" ] || { echo "ABORT: $BIN missing (run npm run build)."; exit 1; }

SELECT_ROOT=$(mktemp -d /tmp/f10-select-pty-XXXXXX)

want_cell() {
  [ -z "${SELECT_PTY_CELLS:-}" ] && return 0
  case " $(printf '%s' "$SELECT_PTY_CELLS" | tr ',' ' ') " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}
want_cell caret-wrap      && run_caret_wrap_cell
want_cell caret-busy      && run_caret_busy_cell
want_cell caret-busy-live && run_caret_busy_live_cell

echo
echo "select-pty: $pass_count passed, $fail_count failed"
[ "$fail_count" = 0 ] || { echo "failed:$failed_cells"; exit 1; }
echo ok
exit 0
