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
# F10 S5 — a raw CSI sequence AFTER the leading ESC (e.g. "[1;2C" for shift+right), same hex-encoding trick
# as `send_sgr` above (no shell quoting of ESC, exact bytes a terminal would deliver).
send_csi() {                                # send_csi <session> <csi-text-without-ESC>
  local s="$1" text="$2" hex="1b" i ch
  for (( i=0; i<${#text}; i++ )); do printf -v ch '%02x' "'${text:$i:1}"; hex="$hex $ch"; done
  # shellcheck disable=SC2086
  tmux -L "$TM" send-keys -t "$s" -H $hex
}
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

# ── cell: word-drag (keyless) — F10 S2's own acceptance shape: a double-click drag extends by whole words ─
# Stages "alpha beta gamma" through `!echo` (a local bash-mode command — no model turn, no credential),
# double-clicks `alpha`, drags into `gamma`, releases, and checks BOTH observable halves of the gesture: the
# painted `selectionBg` run (via `capture-pane -e`, matching the general truecolor-background SGR shape
# `Line.tsx`'s chalk styling always emits, not one theme's own literal RGB triple) and the real OSC 52 write
# a completed sweep's default `copyOnSelect` latch fires on release (`ChatApp.performAutoCopy`) — read back
# from the `pipe-pane` raw log (armed before any keystroke, see `launch`) by grepping for the base64 payload
# itself: base64 never contains the ESC bytes tmux's own `$TMUX`-forced DCS passthrough doubles, so the
# encoded text survives that wrapping byte-for-byte and needs no un-escaping to find.
WORD_DRAG_B64="YWxwaGEgYmV0YSBnYW1tYQ=="   # `printf '%s' "alpha beta gamma" | base64`
run_word_drag_cell() {
  local s="wd-$RUN_ID" home rc=0
  echo "  cell word-drag (keyless): !echo stages 'alpha beta gamma', double-click alpha, drag into gamma"
  home=$(launch "$s" 100 24 "node $BIN") || { record "word-drag" 1; kill_cell "$s"; return; }
  wait_ready "$s" || { record "word-drag" 1; kill_cell "$s"; return; }
  tmux -L "$TM" send-keys -t "$s" -l "!echo alpha beta gamma"
  tmux -L "$TM" send-keys -t "$s" Enter
  local i=0
  # Anchored on the leading two-space indent `formatBashOutput` (bash.ts) always puts on a command's own
  # output line — the immediate `! echo alpha beta gamma` ECHO line above it also contains the substring
  # "alpha beta gamma" (inside the typed command itself), so an unanchored match would grab the wrong row.
  while [ "$i" -lt 40 ]; do frame "$s" | grep -qE '^  alpha beta gamma$' && break; sleep 0.25; i=$((i+1)); done
  local cap="$SELECT_ROOT/wd-cap"; frame "$s" > "$cap"
  local row; row=$(LC_ALL=C awk '/^  alpha beta gamma$/ {print NR; exit}' "$cap")
  if [ -z "$row" ]; then
    echo "      FAIL word-drag: the command's own output line never painted"
    cat "$cap" | sed 's/^/      | /'
    kill_cell "$s"; record "word-drag" 1; return
  fi
  local col_a col_g; col_a=$(LC_ALL=C awk -v n="$row" 'NR==n {print index($0, "alpha")}' "$cap")
  col_g=$(LC_ALL=C awk -v n="$row" 'NR==n {print index($0, "gamma")}' "$cap")
  local click_col=$((col_a + 2))   # inside "alpha", off either edge
  local drag_col=$((col_g + 2))    # inside "gamma"
  # THE GESTURE, ZERO SLEEP INSIDE IT (header's own rule): press+release is click 1, the second press is
  # click 2 — `multiClickSelectionAt` fires HERE, at press time, no drag needed for `hasSelection` — then the
  # drag pivots via `dragToSpanned` and the release both keeps the paint and fires the auto-copy latch.
  press   "$s" "$click_col" "$row"
  release "$s" "$click_col" "$row"
  press   "$s" "$click_col" "$row"
  drag    "$s" "$drag_col" "$row"
  release "$s" "$drag_col" "$row"
  sleep 0.5
  local frame_e; frame_e=$(tmux -L "$TM" capture-pane -t "$s" -p -e)
  local esc; esc=$(printf '\033')
  # The closing code is a bare `ESC[0m` on a real terminal render (measured, this run) rather than
  # `ink-testing-library`'s own `ESC[49m` bg-only reset (`selectionPaint.test.tsx`'s own probed constant) —
  # a real Ink instance's SGR reset is a full reset, not the narrower one the virtual-DOM harness emits, so
  # both closers are accepted here.
  if printf '%s' "$frame_e" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+malpha beta gamma${esc}\[(0|49)m"; then
    echo "      ok   word-drag: the selectionBg run covers all of 'alpha beta gamma', one contiguous span"
  else
    echo "      FAIL word-drag: no contiguous selectionBg run over 'alpha beta gamma'"
    printf '%s' "$frame_e" | sed 's/^/      | /'
    rc=1
  fi
  local log="$SELECT_ROOT/$s.log"
  if grep -aqF "$WORD_DRAG_B64" "$log"; then
    echo "      ok   word-drag: the OSC 52 payload base64-decodes to exactly 'alpha beta gamma'"
  else
    echo "      FAIL word-drag: no OSC 52 payload for 'alpha beta gamma' in the raw log"
    rc=1
  fi
  kill_cell "$s"
  record "word-drag" "$rc"
}

# ── cell: extend-chords (keyless) — F10 S5 acceptance cell 4: the six keyboard extend chords ────────────
# Stages "alpha beta gamma" through `!echo`, sweeps part of `alpha`, extends it with shift+right and reaches
# the row's end with shift+end, proves the fall-through (no selection → shift+left reaches the composer),
# and drives a `keybindings.json` override to prove the rebinding mechanism reaches a real handler.
#   THE REBOUND KEY IS `alt+right`, NOT THE BRIEF'S OWN `ctrl+shift+y` EXAMPLE, AND THAT SUBSTITUTION IS
# DELIBERATE — LIVE-VERIFIED, NOT ASSUMED. `useSelectionLifetime`'s pre-table hook (ChatApp.tsx, the same
# hook `SELECTION_CLEAR_EXEMPT_BARE`/`SELECTION_EXTEND_KEYS` gate) discards ANY live selection on ANY key
# whose raw NAME is not one of a short exempt list (escape/pageup/pagedown, ctrl+home/ctrl+end, or an
# arrow/home/end carrying shift/alt/super) — checked by KEY NAME, not by which ACTION the table resolves it
# to. `ctrl+shift+y` is not in that list, so pressing it discards the selection BEFORE `selection:copy`'s own
# handler (`hitmapRef.current?.hasSelection()` gate) ever runs, and copies nothing — measured with a live
# `ChatApp` mount and a mocked `copyText`: canon's OWN default `ctrl+shift+c` chord (F10 S3) hits the exact
# same gap and also copies nothing (0 calls). This is a pre-existing S3-era interaction, not introduced by
# this task and out of this task's scope to fix — recorded here and in the task report for the track owner.
# `alt+right`'s raw name IS `right`, which IS in `SELECTION_EXTEND_KEYS` and carries `alt`, so it is EXEMPT
# from the pre-table discard — the same reason this track's own six shift+arrow chords work at all — which
# is what lets this cell prove the keybindings.json override mechanism itself without tripping the gap.
EXTEND_CHORDS_B64="Z2FtbWE="   # `printf '%s' "gamma" | base64`
run_extend_chords_cell() {
  local s="ec-$RUN_ID" rc=0
  local home="$SELECT_ROOT/$s-home"
  echo "  cell extend-chords (keyless): !echo stages 'alpha beta gamma'; shift+right/shift+end; fall-through; keybindings.json override"
  mkdir -p "$home/.claude/ccx"
  # The override: `alt+right` (see the header above for why, not the brief's own `ctrl+shift+y` example) →
  # `selection:copy`, merged on top of the default Scroll table by the `~/.claude/keybindings.json` loader.
  # THE SHAPE IS `{"bindings": [{"context", "bindings"}]}` (`userBindings.ts`'s own `validate()`) — the
  # brief's own literal example (`{"Scroll": {...}}`, no `bindings` array) silently loads as ZERO layers
  # under the real validator (an object with no "bindings" key "contributes nothing, and says nothing" —
  # userBindings.ts:102), measured live: that exact shape produced no override at all.
  cat > "$home/.claude/keybindings.json" << 'KBJSON'
{"bindings": [{"context": "Scroll", "bindings": {"alt+right": "selection:copy"}}]}
KBJSON
  # `copyOnSelect: false` so the release itself does NOT auto-copy — the only copy in this cell is the one
  # the rebound chord fires, so its OSC 52 write is unambiguous evidence the override reached a real handler.
  cat > "$home/.claude/ccx/prefs.json" << 'PREFSJSON'
{"copyOnSelect": false}
PREFSJSON
  launch "$s" 100 24 "node $BIN" >/dev/null || { record "extend-chords" 1; kill_cell "$s"; return; }
  wait_ready "$s" || { record "extend-chords" 1; kill_cell "$s"; return; }
  tmux -L "$TM" send-keys -t "$s" -l "!echo alpha beta gamma"
  tmux -L "$TM" send-keys -t "$s" Enter
  local i=0
  while [ "$i" -lt 40 ]; do frame "$s" | grep -qE '^  alpha beta gamma$' && break; sleep 0.25; i=$((i+1)); done
  local cap="$SELECT_ROOT/ec-cap"; frame "$s" > "$cap"
  local row; row=$(LC_ALL=C awk '/^  alpha beta gamma$/ {print NR; exit}' "$cap")
  if [ -z "$row" ]; then
    echo "      FAIL extend-chords: the command's own output line never painted"
    cat "$cap" | sed 's/^/      | /'
    kill_cell "$s"; record "extend-chords" 1; return
  fi
  local col_a esc frame_e
  col_a=$(LC_ALL=C awk -v n="$row" 'NR==n {print index($0, "alpha")}' "$cap")
  esc=$(printf '\033')

  # sweep "alph" (cols col_a..col_a+3) — leaving 'a' out, so shift+right's growth to "alpha" is one column.
  press   "$s" "$col_a" "$row"
  drag    "$s" "$((col_a+3))" "$row"
  release "$s" "$((col_a+3))" "$row"
  sleep 0.5
  frame_e=$(tmux -L "$TM" capture-pane -t "$s" -p -e)
  if printf '%s' "$frame_e" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+malph${esc}\[(0|49)m"; then
    echo "      ok   extend-chords: the initial sweep covers exactly 'alph'"
  else
    echo "      FAIL extend-chords: the initial sweep did not cover exactly 'alph'"
    printf '%s' "$frame_e" | sed 's/^/      | /'
    kill_cell "$s"; record "extend-chords" 1; return
  fi

  send_csi "$s" "[1;2C"   # shift+right
  sleep 0.5
  frame_e=$(tmux -L "$TM" capture-pane -t "$s" -p -e)
  if printf '%s' "$frame_e" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+malpha${esc}\[(0|49)m"; then
    echo "      ok   extend-chords: shift+right grew the span by exactly one column ('alph' -> 'alpha')"
  else
    echo "      FAIL extend-chords: shift+right did not grow the span to exactly 'alpha'"
    printf '%s' "$frame_e" | sed 's/^/      | /'
    rc=1
  fi

  send_csi "$s" "[1;2F"   # shift+end
  sleep 0.5
  frame_e=$(tmux -L "$TM" capture-pane -t "$s" -p -e)
  if printf '%s' "$frame_e" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+malpha beta gamma${esc}\[(0|49)m"; then
    echo "      ok   extend-chords: shift+end reached the row's own end"
  else
    echo "      FAIL extend-chords: shift+end did not reach the row's own end"
    printf '%s' "$frame_e" | sed 's/^/      | /'
    rc=1
  fi

  # Clear, then the fall-through: escape, type ab, shift+left, type X — the composer must read "aXb", proving
  # the key reached the editor (no handler registered with no selection live).
  tmux -L "$TM" send-keys -t "$s" Escape
  tmux -L "$TM" send-keys -t "$s" -l "ab"
  send_csi "$s" "[1;2D"   # shift+left
  tmux -L "$TM" send-keys -t "$s" -l "X"
  sleep 0.5
  if frame "$s" | grep -qF "aXb"; then
    echo "      ok   extend-chords: shift+left with no selection fell through to the composer ('aXb')"
  else
    echo "      FAIL extend-chords: composer did not read 'aXb' after the fall-through sequence"
    frame "$s" | sed 's/^/      | /'
    rc=1
  fi

  # The keybindings.json override: sweep "gamma" (copyOnSelect is off, so release copies nothing on its
  # own), then fire the rebound `alt+right` and check the OSC 52 log for exactly gamma's own payload.
  # RE-CAPTURED, not the earlier `row`/`col_g`: the composer typing above (`ab`/`X`) can change the
  # composer's own row count and shift the transcript above it by exactly that many rows.
  local cap2="$SELECT_ROOT/ec-cap2"; frame "$s" > "$cap2"
  local row2; row2=$(LC_ALL=C awk '/^  alpha beta gamma$/ {print NR; exit}' "$cap2")
  if [ -z "$row2" ]; then
    echo "      FAIL extend-chords: 'alpha beta gamma' is no longer on screen before the rebind check"
    cat "$cap2" | sed 's/^/      | /'
    kill_cell "$s"; record "extend-chords" 1; return
  fi
  local col_g2; col_g2=$(LC_ALL=C awk -v n="$row2" 'NR==n {print index($0, "gamma")}' "$cap2")
  press   "$s" "$col_g2" "$row2"
  drag    "$s" "$((col_g2+4))" "$row2"
  release "$s" "$((col_g2+4))" "$row2"
  sleep 0.3
  send_csi "$s" "[1;3C"   # alt+right, rebound to selection:copy
  sleep 0.5
  if grep -aqF "$EXTEND_CHORDS_B64" "$SELECT_ROOT/$s.log"; then
    echo "      ok   extend-chords: the rebound alt+right chord copied exactly 'gamma' (keybindings.json override reached a real handler)"
  else
    echo "      FAIL extend-chords: no OSC 52 payload for 'gamma' after the rebound chord fired"
    frame "$s" | sed 's/^/      | /'
    rc=1
  fi
  kill_cell "$s"
  record "extend-chords" "$rc"
}

# ── cell: stream-shift (keyless) — F10 T-SELECT S4c acceptance cell 3's pty half, two arms in one cell ────
# Both arms share the same claim (a HELD sweep survives the document moving under it) but from opposite
# directions: arm 1 scrolls the STICKY window under an ordinary two-endpoint drag; arm 2 lands a delta
# GENUINELY ABOVE a sweep on the QUEUED tier (finalized/pending/streaming all paint above `queuedItems`,
# `FullscreenViewport`'s own order) while a REAL live turn is in progress. Neither releases the button before
# the shift lands — a release-then-reassert would prove nothing about the HELD case.
#
# ARM 1 IS VIA THE FAKE HOST, NOT `!bash-mode` STAGING, and that is a live-probe finding, not a style choice.
# The plan's first draft staged rows with `!seq` and appended more via a SECOND typed `!seq` command while the
# sweep was held — probed live, this reliably CLEARED the selection outright, before the append ever ran:
# `useSelectionLifetime` (F9 T-MOUSE Task 7, `ChatApp.tsx`) is a documented, deliberate rule — "every other key
# clears [the selection] but is NOT consumed — it still runs whatever it would have" — so the FIRST character
# typed into `!seq 13 17` fires `discardSelection()` before Enter is ever pressed, regardless of anything this
# track built. A held sweep and a SECOND typed command in the SAME session are mutually exclusive by design;
# proving the remap survives a shift therefore needs the shift to arrive from somewhere that sends the swept
# session no keystrokes at all. The fake host already is exactly that (step 1.21a): pushing `message:<word>`
# frames into ITS OWN stdin (the S4c stdin extension, `fake-host.mjs`) finalizes new items into the ATTACHED
# client's document without one byte reaching the attached session's own input stream.
run_stream_shift_cell() {
  local rc=0
  echo "  cell stream-shift (keyless, via fake-host.mjs) arm 1: held sweep on a row, document shifts under it"
  local s="ss-$RUN_ID" fh="ss-host-$RUN_ID" home short=""
  home="$SELECT_ROOT/$fh-home"; mkdir -p "$home/.claude/ccx"
  local fhcmd="env CCX_FLEET_ROOT=$home/.claude/ccx node $HARNESS_DIR/scripts/fake-host.mjs"
  tmux -L "$TM" new-session -d -s "$fh" -x 100 -y 30 "$fhcmd" || { record "stream-shift" 1; return; }
  SESSIONS="$SESSIONS $fh"
  local i=0
  while [ "$i" -lt 40 ]; do
    short=$(tmux -L "$TM" capture-pane -t "$fh" -p -S - 2>/dev/null | grep -oE 'SHORT=[0-9a-f]{8}' | cut -d= -f2)
    [ -n "$short" ] && break
    sleep 0.25; i=$((i+1))
  done
  if [ -z "$short" ]; then
    echo "      FAIL stream-shift arm1: fake-host.mjs never printed its short id"
    kill_cell "$fh"; record "stream-shift" 1; return
  fi
  mkdir -p "$SELECT_ROOT/$s-proj"
  # `-y 13`: measured (this run) to grant an 8-row region — eight `LN0N` items fill it exactly, so the ninth
  # through eleventh pushed below force a real sticky scroll rather than merely appending into empty space.
  local attachcmd="env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false CLAUDE_CODE_NO_FLICKER=1 node $BIN attach $short"
  tmux -L "$TM" new-session -d -s "$s" -x 100 -y 13 -c "$SELECT_ROOT/$s-proj" "$attachcmd" || { record "stream-shift" 1; kill_cell "$fh"; return; }
  SESSIONS="$SESSIONS $s"
  tmux -L "$TM" pipe-pane -t "$s" -o "cat >> '$SELECT_ROOT/$s.log'"
  # `"manual mode on"`, not the default needle: `caret-busy`'s own established fact — an ATTACH session's
  # footer reads "manual mode on · ? for shortcuts", never the fresh-CLI "…(shift+tab to cycle)" text.
  wait_ready "$s" "manual mode on" || { kill_cell "$s"; kill_cell "$fh"; record "stream-shift" 1; return; }
  local n
  for n in 01 02 03 04 05 06 07 08; do
    tmux -L "$TM" send-keys -t "$fh" -l "message:LN$n"
    tmux -L "$TM" send-keys -t "$fh" Enter
    sleep 0.15
  done
  local i2=0
  while [ "$i2" -lt 40 ]; do frame "$s" | grep -qF "LN08" && break; sleep 0.25; i2=$((i2+1)); done
  sleep 0.5
  local cap1="$SELECT_ROOT/ss-cap1"; frame "$s" > "$cap1"
  local row4; row4=$(LC_ALL=C awk '/LN04/ {print NR; exit}' "$cap1")
  if [ -z "$row4" ]; then
    echo "      FAIL stream-shift arm1: LN04 never painted"
    cat "$cap1" | sed 's/^/      | /'
    kill_cell "$s"; kill_cell "$fh"; record "stream-shift" 1; return
  fi
  # `LC_ALL=C index()` is a BYTE offset; `⏺` (the assistant bullet ahead of every message row here) is ONE
  # character but THREE bytes and TWO terminal columns (`string-width`'s own measure, matching the codebase's
  # `hitmap.ts` doc comment) — a raw byte-to-column use overshoots by exactly that one-byte deficit.
  local col4; col4=$(LC_ALL=C awk -v n="$row4" 'NR==n {print index($0, "LN04") - 1}' "$cap1")
  # Press ON "LN04" and drag three columns further — held, NO release, zero sleep inside the gesture (header's
  # own rule: nothing may land between press and drag but the drag itself).
  press "$s" "$col4" "$row4"
  drag  "$s" "$((col4 + 3))" "$row4"
  # STILL HELD, and NOT ONE KEYSTROKE into `$s` — the header comment's whole point. Three more items pushed
  # into the FAKE HOST's stdin scroll the sticky window under the untouched sweep.
  for n in 09 10 11; do
    tmux -L "$TM" send-keys -t "$fh" -l "message:LN$n"
    tmux -L "$TM" send-keys -t "$fh" Enter
    sleep 0.15
  done
  local i3=0
  while [ "$i3" -lt 40 ]; do frame "$s" | grep -qF "LN11" && break; sleep 0.25; i3=$((i3+1)); done
  sleep 0.5
  local cap2="$SELECT_ROOT/ss-cap2"; frame "$s" > "$cap2"
  local row4after; row4after=$(LC_ALL=C awk '/LN04/ {print NR; exit}' "$cap2")
  if [ -z "$row4after" ]; then
    echo "      FAIL stream-shift arm1: LN04 is gone from the frame after the push (scrolled off, not just shifted)"
    cat "$cap2" | sed 's/^/      | /'
    kill_cell "$s"; kill_cell "$fh"; record "stream-shift" 1; return
  fi
  if [ "$row4after" = "$row4" ]; then
    echo "      FAIL stream-shift arm1: LN04 did not move — the push did not actually scroll the sticky window, this cell proves nothing"
    kill_cell "$s"; kill_cell "$fh"; record "stream-shift" 1; return
  fi
  local frame_e; frame_e=$(tmux -L "$TM" capture-pane -t "$s" -p -e)
  local esc; esc=$(printf '\033')
  local row4line; row4line=$(printf '%s' "$frame_e" | sed -n "${row4after}p")
  # `word-drag`'s own accepted-closer note applies here too (bare `ESC[0m` on a real terminal, `ESC[49m` on
  # the virtual-DOM harness) — both accepted.
  if printf '%s' "$row4line" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+mLN04${esc}\[(0|49)m"; then
    echo "      ok   stream-shift arm1: the selectionBg run is still on LN04, now at row $row4after (was $row4) — not whatever now occupies row $row4"
  else
    echo "      FAIL stream-shift arm1: no selectionBg run found on LN04 at its new position"
    printf '%s' "$frame_e" | sed -n "$((row4after>1?row4after-1:1)),$((row4after+1))p" | sed 's/^/      | /'
    rc=1
  fi
  release "$s" "$((col4 + 3))" "$row4after"
  sleep 0.5
  local LN04_B64; LN04_B64=$(printf '%s' "LN04" | base64)
  if grep -aqF "$LN04_B64" "$SELECT_ROOT/$s.log"; then
    echo "      ok   stream-shift arm1: the OSC 52 payload base64-decodes to exactly the swept 'LN04'"
  else
    echo "      FAIL stream-shift arm1: no OSC 52 payload for 'LN04' in the raw log"
    rc=1
  fi
  kill_cell "$s"; kill_cell "$fh"

  echo "  cell stream-shift (keyless, via fake-host.mjs) arm 2: a delta lands ABOVE a sweep on a QUEUED row"
  local s2="ss2-$RUN_ID" fh2="ss2-host-$RUN_ID" short2=""
  home="$SELECT_ROOT/$fh2-home"; mkdir -p "$home/.claude/ccx"
  local fhcmd2="env CCX_FLEET_ROOT=$home/.claude/ccx FAKE_HOST_SCRIPT=turn-start node $HARNESS_DIR/scripts/fake-host.mjs"
  tmux -L "$TM" new-session -d -s "$fh2" -x 100 -y 30 "$fhcmd2" || { record "stream-shift" 1; return; }
  SESSIONS="$SESSIONS $fh2"
  local i3=0
  while [ "$i3" -lt 40 ]; do
    short2=$(tmux -L "$TM" capture-pane -t "$fh2" -p -S - 2>/dev/null | grep -oE 'SHORT=[0-9a-f]{8}' | cut -d= -f2)
    [ -n "$short2" ] && break
    sleep 0.25; i3=$((i3+1))
  done
  if [ -z "$short2" ]; then
    echo "      FAIL stream-shift arm2: fake-host.mjs never printed its short id"
    kill_cell "$fh2"; record "stream-shift" 1; return
  fi
  local attachlog2="$SELECT_ROOT/$s2.log"
  mkdir -p "$SELECT_ROOT/$s2-proj"
  local attachcmd2="env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false CLAUDE_CODE_NO_FLICKER=1 node $BIN attach $short2"
  tmux -L "$TM" new-session -d -s "$s2" -x 100 -y 30 -c "$SELECT_ROOT/$s2-proj" "$attachcmd2" || { record "stream-shift" 1; kill_cell "$fh2"; return; }
  SESSIONS="$SESSIONS $s2"
  tmux -L "$TM" pipe-pane -t "$s2" -o "cat >> '$attachlog2'"
  wait_ready "$s2" "manual mode on" || { kill_cell "$s2"; kill_cell "$fh2"; record "stream-shift" 1; return; }
  local i4=0 spinner_seen=0
  while [ "$i4" -lt 20 ]; do frame "$s2" | grep -qE '[✻✳✶·].*…' && { spinner_seen=1; break; }; sleep 0.25; i4=$((i4+1)); done
  if [ "$spinner_seen" != 1 ]; then
    echo "      FAIL stream-shift arm2: no live-turn spinner ever appeared"
    kill_cell "$s2"; kill_cell "$fh2"; record "stream-shift" 1; return
  fi
  # Submit a prompt WHILE busy: `useChat.ts`'s own "turn while busy → enqueue" — it QUEUES rather than sends,
  # painting at the document's tail below even the (absent, here) streaming tier. Typed and submitted BEFORE
  # any sweep begins — `useSelectionLifetime`'s "every other key clears the selection" rule (arm 1's own
  # header note) is harmless here because there is no selection yet for it to clear.
  tmux -L "$TM" send-keys -t "$s2" -l "queueword alpha beta gamma"
  sleep 0.3
  tmux -L "$TM" send-keys -t "$s2" Enter
  local i5=0
  while [ "$i5" -lt 40 ]; do frame "$s2" | grep -qF "queueword" && break; sleep 0.25; i5=$((i5+1)); done
  local cap3="$SELECT_ROOT/ss2-cap"; frame "$s2" > "$cap3"
  local qrow; qrow=$(LC_ALL=C awk '/queueword/ {print NR; exit}' "$cap3")
  if [ -z "$qrow" ]; then
    echo "      FAIL stream-shift arm2: the queued prompt never painted"
    cat "$cap3" | sed 's/^/      | /'
    kill_cell "$s2"; kill_cell "$fh2"; record "stream-shift" 1; return
  fi
  # Same byte-vs-column correction as arm 1, for the queued echo's own leading `❯ ` (`USER_GUTTER`, render.ts):
  # `❯` is ONE column but THREE bytes, a deficit of two.
  local col_a col_g2; col_a=$(LC_ALL=C awk -v n="$qrow" 'NR==n {print index($0, "alpha") - 2}' "$cap3")
  col_g2=$((col_a + 4))
  press "$s2" "$col_a" "$qrow"
  drag  "$s2" "$col_g2" "$qrow"
  sleep 0.4
  local frame2_e; frame2_e=$(tmux -L "$TM" capture-pane -t "$s2" -p -e)
  # The CLOSER differs from `word-drag`'s own plain-row check: a queued echo (`userEchoLines`) paints its own
  # band background under the whole row, so the selection's close does not return to "no background" — it
  # returns to THAT band's own `48;2;…m`, which the third alternative accepts.
  if ! printf '%s' "$frame2_e" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+malpha${esc}\[(0|49|48;2;[0-9]+;[0-9]+;[0-9]+)m"; then
    echo "      FAIL stream-shift arm2: 'alpha' was never painted before the delta lands"
    printf '%s' "$frame2_e" | sed 's/^/      | /'
    kill_cell "$s2"; kill_cell "$fh2"; record "stream-shift" 1; return
  fi
  # STILL HELD, and — exactly arm 1's own point — NOT ONE KEYSTROKE reaches `$s2`: both `message:` frames go
  # into the FAKE HOST's own stdin (the step 6.8 extension), finalizing ABOVE the queued tier
  # (finalized/pending/streaming all sit ahead of `queuedItems` in `FullscreenViewport`'s own order), landing
  # GENUINELY above the sweep, exactly acceptance cell 3's premise.
  tmux -L "$TM" send-keys -t "$fh2" -l "message:delta one"
  tmux -L "$TM" send-keys -t "$fh2" Enter
  sleep 0.3
  tmux -L "$TM" send-keys -t "$fh2" -l "message:delta two"
  tmux -L "$TM" send-keys -t "$fh2" Enter
  local i6=0
  while [ "$i6" -lt 40 ]; do frame "$s2" | grep -qF "delta two" && break; sleep 0.25; i6=$((i6+1)); done
  sleep 0.3
  local frame3_e; frame3_e=$(tmux -L "$TM" capture-pane -t "$s2" -p -e)
  if printf '%s' "$frame3_e" | grep -aqE "${esc}\[48;2;[0-9]+;[0-9]+;[0-9]+malpha${esc}\[(0|49|48;2;[0-9]+;[0-9]+;[0-9]+)m"; then
    echo "      ok   stream-shift arm2: the highlight still covers 'alpha' after two deltas land above the queued row"
  else
    echo "      FAIL stream-shift arm2: the highlight did NOT survive the delta landing above the queued row"
    printf '%s' "$frame3_e" | sed 's/^/      | /'
    rc=1
  fi
  release "$s2" "$col_g2" "$qrow"
  kill_cell "$s2"; kill_cell "$fh2"

  record "stream-shift" "$rc"
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
want_cell word-drag       && run_word_drag_cell
want_cell extend-chords   && run_extend_chords_cell
want_cell stream-shift    && run_stream_shift_cell

echo
echo "select-pty: $pass_count passed, $fail_count failed"
[ "$fail_count" = 0 ] || { echo "failed:$failed_cells"; exit 1; }
echo ok
exit 0
