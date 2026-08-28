#!/usr/bin/env bash
# harness/scripts/linkopen-cells.sh — bl5 T-LINKOPEN task 4: real-binary pty acceptance for transcript link
# self-open (canon 2.1.246) plus the hover-suppression-while-expanded fold-in cell. Same driver discipline
# as scripts/select-pty.sh / scripts/hover-cells.sh: a PRIVATE tmux socket (`-L`), an isolated
# HOME/CCX_FLEET_ROOT per run, teardown that kills ONLY the sessions this run created (never `kill-server`,
# never `-a`), and SGR mouse bytes sent from THIS SAVED SCRIPT FILE only — an inline Bash-tool send of the
# identical bytes reliably drops the tap (recorded in `.doperpowers/sdd/2026-08-24-bl4-t-clickgate/` and this
# repo's own pty-lesson memory); a script invoked with `bash` does not.
#
# WHY FAKE-HOST, NOT A LIVE MODEL TURN: `scripts/fake-host.mjs` speaks the exact `ccx attach` wire protocol
# (`src/host/wire.ts`) that a real interactive host speaks, so `ccx attach <short>` against it renders
# through the SAME `ChatApp`/`FullscreenViewport`/mouse-sink code a live session would — the fake host only
# replaces the MODEL, never the rendering or dispatch surface under test. This buys deterministic, offline
# transcript content (a markdown link, a `gh pr create` fold row, a two-Bash-call cluster) without spending
# live API/subscription quota. `select-pty.sh`'s own `caret-busy`/`stream-shift` cells already establish this
# pattern; this file adds three new `fake-host.mjs` word producers (`prlink`, `errcluster`, `mysteryerr`)
# alongside the pre-existing `message`/`tasks`.
#
# COLUMN MATH: `scripts/linkopen-col-of.py` locates a click target's real SGR column from a PLAIN
# (`capture-pane -p`, no `-e`) capture — see that file's own header for the `⏺`-bullet wide-glyph finding
# this driver depends on for every click below.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HARNESS_DIR/dist/cli/bin.js"
RECORDER="$HARNESS_DIR/test/fixtures/browser-recorder.sh"
COL_OF="$HARNESS_DIR/scripts/linkopen-col-of.py"
BUILD=1
for arg in "$@"; do case "$arg" in --no-build) BUILD=0 ;; *) echo "unknown flag: $arg" >&2; exit 2 ;; esac; done

TM="bl5link$$"                                # the private tmux socket name (-L), never the default server
missing() {
  echo "SKIP: linkopen-cells needs $1, which is not on PATH. (Install it to run this suite.)"
  exit 0
}
command -v tmux >/dev/null 2>&1 || missing tmux
command -v node >/dev/null 2>&1 || missing node
command -v python3 >/dev/null 2>&1 || missing python3

if [ "$BUILD" -eq 1 ]; then
  ( cd "$HARNESS_DIR" && npm run build >/dev/null ) || { echo "FAIL: build failed" >&2; exit 1; }
fi
[ -f "$BIN" ] || { echo "FAIL: $BIN not found after build" >&2; exit 1; }

pass_count=0; fail_count=0; failed_cells=""
SESSIONS=""
RUN_ID="$$"
ROOT=$(mktemp -d /tmp/linkopen-cells-XXXXXX)
cleanup() {
  for s in $SESSIONS; do tmux -L "$TM" kill-session -t "$s" 2>/dev/null; done   # BY NAME, never -a
  # `kill-server` here targets ONLY this run's own PRIVATE socket (`-L "$TM"`, minted from `$$` above and
  # touched by nothing but this run) — never the default socket, never a shared one — so it is the allowed
  # "servers you created" case, not the forbidden one; it also clears the socket FILE `capture-pane`'s stale
  # runs otherwise leave behind once every session on it is gone.
  tmux -L "$TM" kill-server 2>/dev/null
  rm -rf "$ROOT" 2>/dev/null || { sleep 0.5; rm -rf "$ROOT" 2>/dev/null; }
  return 0
}
trap cleanup EXIT INT TERM

record() {                                    # record <cell-name> <status 0|1>
  if [ "$2" = 0 ]; then pass_count=$((pass_count+1)); echo "  PASS $1"
  else fail_count=$((fail_count+1)); failed_cells="$failed_cells $1"; echo "  FAIL $1"; fi
}
kill_cell() {
  case " $SESSIONS " in *" $1 "*) tmux -L "$TM" kill-session -t "$1" 2>/dev/null ;; esac
  SESSIONS=$(echo "$SESSIONS" | sed "s/ $1//")
}

# ── the mouse gesture, saved-script-file discipline (see this file's own header) ────────────────────────
send_sgr() {                                  # send_sgr <session> <button> <col> <row> <M|m>
  local s="$1" text hex="1b" i ch
  text="$(printf '[<%d;%d;%d%s' "$2" "$3" "$4" "$5")"
  for (( i=0; i<${#text}; i++ )); do printf -v ch '%02x' "'${text:$i:1}"; hex="$hex $ch"; done
  # shellcheck disable=SC2086
  tmux -L "$TM" send-keys -t "$s" -H $hex
}
plain_click() { send_sgr "$1" 0 "$2" "$3" M; send_sgr "$1" 0 "$2" "$3" m; }     # button 0, no modifier
alt_click()   { send_sgr "$1" 8 "$2" "$3" M; send_sgr "$1" 8 "$2" "$3" m; }     # button 0 + alt bit (8)
hover_at()    { send_sgr "$1" 35 "$2" "$3" M; }                                 # any-motion report, button-less

col_of() { python3 "$COL_OF" "$1" "$2" "${3:-0}"; }                            # col_of <capfile> <needle> [offset] → "col row"

capture()      { tmux -L "$TM" capture-pane -t "$1" -p -S -; }                 # plain (no SGR) — for locating columns
capture_sgr()  { tmux -L "$TM" capture-pane -t "$1" -p -e -S -; }              # with SGR — for dim/color assertions
is_dim()   { printf '%s' "$1" | grep -qF $'\x1b[2m'; }

wait_for_capture() {                          # wait_for_capture <session> <needle> [<steps>] → writes to $CAP
  local s="$1" needle="$2" steps="${3:-40}" i=0
  CAP="$ROOT/cap-$RANDOM"
  while [ "$i" -lt "$steps" ]; do
    capture "$s" > "$CAP"
    grep -qF "$needle" "$CAP" && return 0
    sleep 0.25; i=$((i+1))
  done
  echo "      FAIL $s never showed \"$needle\""
  sed 's/^/      | /' "$CAP"
  return 1
}

# ── the two processes every cell needs: fake-host.mjs (the model stand-in) and `ccx attach` (real binary) ──
# `launch_fake_host` is always invoked as `short=$(launch_fake_host ...)` — a command SUBSTITUTION, which
# bash runs in a SUBSHELL. A `SESSIONS="$SESSIONS $s"` written inside it (as `launch_attach` below, invoked
# directly rather than substituted, safely does) would mutate only that subshell's copy and vanish the
# instant the subshell exits — reproduced live: every fake-host session leaked past `cleanup()` until this
# was moved to the caller, which already knows the session name before ever calling this function.
launch_fake_host() {                          # launch_fake_host <session> <home-dir> → prints the SHORT id
  local s="$1" home="$2" i=0 short=""
  mkdir -p "$home/.claude/ccx"
  tmux -L "$TM" new-session -d -s "$s" -x 100 -y 30 "env CCX_FLEET_ROOT=$home/.claude/ccx node $HARNESS_DIR/scripts/fake-host.mjs" || return 1
  while [ "$i" -lt 40 ]; do
    short=$(tmux -L "$TM" capture-pane -t "$s" -p -S - 2>/dev/null | grep -oE 'SHORT=[0-9a-f]{8}' | cut -d= -f2)
    [ -n "$short" ] && { echo "$short"; return 0; }
    sleep 0.25; i=$((i+1))
  done
  return 1
}
push() { tmux -L "$TM" send-keys -t "$1" -l "$2"; tmux -L "$TM" send-keys -t "$1" Enter; sleep 0.3; }  # push <fake-host-session> <word>

launch_attach() {                             # launch_attach <session> <home-dir> <short> <extra-env...>
  local s="$1" home="$2" short="$3"; shift 3
  local proj="$ROOT/$s-proj"; mkdir -p "$proj"
  tmux -L "$TM" new-session -d -s "$s" -x 100 -y 40 -c "$proj" \
    "env HOME=$home CCX_FLEET_ROOT=$home/.claude/ccx TERM=xterm-256color CI=false CLAUDE_CODE_NO_FLICKER=1 $* node $BIN attach $short" || return 1
  SESSIONS="$SESSIONS $s"
  local i=0
  while [ "$i" -lt 40 ]; do
    capture "$s" | grep -qF "mode on" && return 0
    sleep 0.25; i=$((i+1))
  done
  return 1
}

# ═══ Cell 1 — self-open: a markdown link's alt-click reaches the $BROWSER recorder ══════════════════════
run_self_open_cell() {
  echo "  cell self-open: alt-click on a rendered markdown link invokes \$BROWSER with the exact URL"
  local fh="lo1-fh-$RUN_ID" s="lo1-$RUN_ID" home="$ROOT/lo1-home" short="" rc=0
  SESSIONS="$SESSIONS $fh"                    # registered HERE, not inside the subshelled `launch_fake_host` call
  short=$(launch_fake_host "$fh" "$home") || { echo "      FAIL self-open: fake-host.mjs never printed its short id"; record self-open 1; kill_cell "$fh"; return; }
  local out="$ROOT/lo1-opened.txt"
  # TERM_PROGRAM=iTerm.app: on BOTH allowlists this cell needs — `hyperlinksSupported` (markdownInline.ts's
  # `HYPERLINK_TERMS`, so the assistant text actually gets an OSC-8 link at all) and the brief's own pin.
  launch_attach "$s" "$home" "$short" "TERM_PROGRAM=iTerm.app" "BROWSER=$RECORDER" "LINKOPEN_RECORDER_OUT=$out" \
    || { echo "      FAIL self-open: ccx attach never reached the ready frame"; record self-open 1; kill_cell "$s"; kill_cell "$fh"; return; }
  push "$fh" "message:See [my link](https://example.com/self-open-target) for details"
  wait_for_capture "$s" "my link" || { record self-open 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local rc_pair; rc_pair=$(col_of "$CAP" "my link" 2) || { echo "      FAIL self-open: could not locate the link's own column"; record self-open 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col row; read -r col row <<<"$rc_pair"
  alt_click "$s" "$col" "$row"
  local i=0
  while [ "$i" -lt 10 ] && [ ! -s "$out" ]; do sleep 0.25; i=$((i+1)); done       # 500ms defer + slack, per the brief
  if [ "$(cat "$out" 2>/dev/null)" = "https://example.com/self-open-target" ]; then
    echo "      ok   self-open: recorder received the exact URL within $(echo "scale=2; $i*0.25" | bc 2>/dev/null || echo "~2.5")s"
  else
    echo "      FAIL self-open: recorder file holds $(cat "$out" 2>/dev/null || echo "(nothing)"), expected the exact URL"; rc=1
  fi
  kill_cell "$s"; kill_cell "$fh"
  record self-open "$rc"

  echo "  cell self-open (F2): alt-click on a T-PRLINK fold row's link opens it AND does not toggle the fold"
  local fh2="lo2-fh-$RUN_ID" s2="lo2-$RUN_ID" home2="$ROOT/lo2-home" short2="" rc2=0
  SESSIONS="$SESSIONS $fh2"                   # registered HERE, not inside the subshelled `launch_fake_host` call
  short2=$(launch_fake_host "$fh2" "$home2") || { echo "      FAIL fold-link: fake-host.mjs never printed its short id"; record fold-link 1; kill_cell "$fh2"; return; }
  local out2="$ROOT/lo2-opened.txt"
  launch_attach "$s2" "$home2" "$short2" "TERM_PROGRAM=iTerm.app" "BROWSER=$RECORDER" "LINKOPEN_RECORDER_OUT=$out2" \
    || { echo "      FAIL fold-link: ccx attach never reached the ready frame"; record fold-link 1; kill_cell "$s2"; kill_cell "$fh2"; return; }
  push "$fh2" "prlink"
  wait_for_capture "$s2" "Created PR #12" || { record fold-link 1; kill_cell "$s2"; kill_cell "$fh2"; return; }
  local before; before=$(cat "$CAP")
  local rc_pair2; rc_pair2=$(col_of "$CAP" "#12" 1) || { echo "      FAIL fold-link: could not locate the PR link's own column"; record fold-link 1; kill_cell "$s2"; kill_cell "$fh2"; return; }
  local col2 row2; read -r col2 row2 <<<"$rc_pair2"
  alt_click "$s2" "$col2" "$row2"
  local j=0
  while [ "$j" -lt 10 ] && [ ! -s "$out2" ]; do sleep 0.25; j=$((j+1)); done
  if [ "$(cat "$out2" 2>/dev/null)" != "https://github.com/o/r/pull/12" ]; then
    echo "      FAIL fold-link: recorder file holds $(cat "$out2" 2>/dev/null || echo "(nothing)"), expected the PR URL"; rc2=1
  else
    echo "      ok   fold-link: recorder received the exact PR URL"
  fi
  sleep 0.3
  local after; after=$(capture "$s2")
  if [ "$after" != "$before" ]; then
    echo "      FAIL fold-link: the fold row's own frame changed after the alt-click (it should not have toggled)"
    echo "      ── before ──"; echo "$before" | sed 's/^/      | /'
    echo "      ── after  ──"; echo "$after" | sed 's/^/      | /'
    rc2=1
  else
    echo "      ok   fold-link: the frame is byte-identical before/after — the fold did not toggle"
  fi
  # Prove the row really IS a live fold anchor (a plain click on its NON-link text toggles it) — otherwise
  # the "did not toggle" assertion above would be trivially true of a row that can never toggle at all.
  local rc_pair3; rc_pair3=$(col_of "$CAP" "Created" 0)
  local col3 row3; read -r col3 row3 <<<"$rc_pair3"
  plain_click "$s2" "$col3" "$row3"
  wait_for_capture "$s2" "gh pr create --fill" 8 || { echo "      FAIL fold-link: a plain click on the SAME row's non-link text never expanded it — the row is not a real fold anchor, so the toggle-negation above proves nothing"; rc2=1; }
  kill_cell "$s2"; kill_cell "$fh2"
  record fold-link "$rc2"
}

# ═══ Cell 2 — hover-suppression-while-expanded (spec fold-in) ═══════════════════════════════════════════
run_hover_suppress_cell() {
  echo "  cell hover-suppress: an EXPANDED clickable owner does not brighten on hover; a different one still does"
  local fh="lo3-fh-$RUN_ID" s="lo3-$RUN_ID" home="$ROOT/lo3-home" short="" rc=0
  SESSIONS="$SESSIONS $fh"                    # registered HERE, not inside the subshelled `launch_fake_host` call
  short=$(launch_fake_host "$fh" "$home") || { echo "      FAIL hover-suppress: fake-host.mjs never printed its short id"; record hover-suppress 1; kill_cell "$fh"; return; }
  launch_attach "$s" "$home" "$short" \
    || { echo "      FAIL hover-suppress: ccx attach never reached the ready frame"; record hover-suppress 1; kill_cell "$s"; kill_cell "$fh"; return; }
  push "$fh" "errcluster"
  push "$fh" "mysteryerr"
  wait_for_capture "$s" "+2 lines" || { record hover-suppress 1; kill_cell "$s"; kill_cell "$fh"; return; }

  # Expand the "Read 2 files" cluster (a genuine fold toggle, click on the collapsed clause row).
  local rc_pair; rc_pair=$(col_of "$CAP" "Read 2 files" 0) || { echo "      FAIL hover-suppress: could not locate the collapsed cluster row"; record hover-suppress 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col row; read -r col row <<<"$rc_pair"
  plain_click "$s" "$col" "$row"
  wait_for_capture "$s" "(No output)" || { echo "      FAIL hover-suppress: the cluster's own member body ((No output)) never appeared after expanding"; record hover-suppress 1; kill_cell "$s"; kill_cell "$fh"; return; }

  local sgr_cap; sgr_cap=$(capture_sgr "$s")
  local no_out_line; no_out_line=$(printf '%s\n' "$sgr_cap" | grep "No output")
  if ! is_dim "$no_out_line"; then
    echo "      FAIL hover-suppress premise: the expanded member's own '(No output)' row is not dim BEFORE any hover — this cell would be vacuous"
    rc=1
  else
    echo "      ok   hover-suppress premise: '(No output)' is genuinely dim on the expanded owner before hover"
  fi
  local rc_pair2; rc_pair2=$(col_of "$CAP" "No output" 0)
  local ncol nrow; read -r ncol nrow <<<"$rc_pair2"
  hover_at "$s" "$ncol" "$nrow"
  sleep 0.4
  sgr_cap=$(capture_sgr "$s")
  no_out_line=$(printf '%s\n' "$sgr_cap" | grep "No output")
  if ! is_dim "$no_out_line"; then
    echo "      FAIL hover-suppress: hovering the EXPANDED owner un-dimmed '(No output)' — hover-suppression-while-expanded is broken"
    rc=1
  else
    echo "      ok   hover-suppress: '(No output)' stayed dim under the pointer — the expanded owner did not brighten"
  fi

  # The distractor: the still-collapsed Mystery error's own "+2 lines" marker DOES brighten on hover.
  local capnow; capnow=$(capture "$s") ; echo "$capnow" > "$CAP"
  local rc_pair3; rc_pair3=$(col_of "$CAP" "+2 lines" 0)
  local mcol mrow; read -r mcol mrow <<<"$rc_pair3"
  sgr_cap=$(capture_sgr "$s")
  local marker_line; marker_line=$(printf '%s\n' "$sgr_cap" | grep -F "+2 lines")
  if ! is_dim "$marker_line"; then
    echo "      FAIL hover-suppress premise: the distractor's own '+2 lines' marker is not dim before hover — this arm would be vacuous"
    rc=1
  fi
  hover_at "$s" "$mcol" "$mrow"
  sleep 0.4
  sgr_cap=$(capture_sgr "$s")
  marker_line=$(printf '%s\n' "$sgr_cap" | grep -F "+2 lines")
  if is_dim "$marker_line"; then
    echo "      FAIL hover-suppress: the DIFFERENT (non-expanded) clickable owner did not brighten on hover"
    rc=1
  else
    echo "      ok   hover-suppress: the different, non-expanded clickable owner brightened normally on hover"
  fi
  kill_cell "$s"; kill_cell "$fh"
  record hover-suppress "$rc"
}

echo "bl5 T-LINKOPEN task 4 — pty acceptance (socket -L $TM)"
run_self_open_cell
run_hover_suppress_cell

echo "── $pass_count passed, $fail_count failed ──"
[ "$fail_count" -eq 0 ] || { echo "failed:$failed_cells"; exit 1; }
exit 0
