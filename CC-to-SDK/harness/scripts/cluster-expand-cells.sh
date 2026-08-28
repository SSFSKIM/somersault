#!/usr/bin/env bash
# harness/scripts/cluster-expand-cells.sh — bl6 T-CLUSTER task 3: real-binary pty acceptance for the
# expanded-cluster absorbed-thinking interleave (Tasks 1-2 of this ticket). Same driver discipline as
# scripts/linkopen-cells.sh / scripts/select-pty.sh: a PRIVATE tmux socket (`-L`), an isolated
# HOME/CCX_FLEET_ROOT per run, teardown that kills ONLY the sessions this run created (never `kill-server`
# on a shared socket, never `-a`), and SGR mouse bytes sent from THIS SAVED SCRIPT FILE only — an inline
# Bash-tool send of the identical bytes reliably drops the tap (recorded in this repo's own pty-lesson
# memory and linkopen-cells.sh's own header); a script invoked with `bash` does not.
#
# WHY FAKE-HOST, NOT A LIVE MODEL TURN: see linkopen-cells.sh's header — same reasoning, unchanged here.
# This file adds ONE new `fake-host.mjs` word producer, `thinkcluster` (two `Read` calls with a
# thinking-only assistant message sandwiched between them), and drives it through the REAL `ccx attach`
# binary to prove the expanded cluster interleaves the absorbed `∴` thinking block between its two member
# rows, in transcript order, and that a second click collapses it back.
#
# THE REPLAY-ON-FOLLOW CONTRACT (T-ATTACH, merged onto this branch): `fake-host.mjs` now buffers any frame
# pushed before the attach client's first `follow` and replays it (marked `replay: true`) to that first
# follower, in order, ahead of any later live push — draining before registering, exactly as the real
# host's `SessionHost.follow()` does. This cell deliberately exercises THAT path rather than the
# already-following one linkopen-cells.sh's cells use: `thinkcluster` is pushed to the fake host's own
# stdin BEFORE `ccx attach` is ever launched — no `warmup_follow` sentinel (that workaround was retired
# alongside the merge) — so if the frame never renders, that is a real regression in the replay contract to
# investigate, not something to paper over with a warmup push.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HARNESS_DIR/dist/cli/bin.js"
COL_OF="$HARNESS_DIR/scripts/linkopen-col-of.py"
BUILD=1
for arg in "$@"; do case "$arg" in --no-build) BUILD=0 ;; *) echo "unknown flag: $arg" >&2; exit 2 ;; esac; done

TM="bl6clus$$"                                 # the private tmux socket name (-L), never the default server
missing() {
  echo "SKIP: cluster-expand-cells needs $1, which is not on PATH. (Install it to run this suite.)"
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
ROOT=$(mktemp -d /tmp/cluster-expand-cells-XXXXXX)
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

col_of() { python3 "$COL_OF" "$1" "$2" "${3:-0}"; }                            # col_of <capfile> <needle> [offset] → "col row"

capture()      { tmux -L "$TM" capture-pane -t "$1" -p -S -; }                 # plain (no SGR) — for locating columns

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
wait_for_capture_absence() {                  # wait_for_capture_absence <session> <needle> [<steps>] → writes to $CAP
  local s="$1" needle="$2" steps="${3:-20}" i=0
  CAP="$ROOT/cap-$RANDOM"
  while [ "$i" -lt "$steps" ]; do
    capture "$s" > "$CAP"
    grep -qF "$needle" "$CAP" || return 0
    sleep 0.25; i=$((i+1))
  done
  echo "      FAIL $s still shows \"$needle\" after ${steps} steps"
  sed 's/^/      | /' "$CAP"
  return 1
}

# ── the two processes every cell needs: fake-host.mjs (the model stand-in) and `ccx attach` (real binary) ──
# `launch_fake_host` is always invoked as `short=$(launch_fake_host ...)` — a command SUBSTITUTION, which
# bash runs in a SUBSHELL. A `SESSIONS="$SESSIONS $s"` written inside it would mutate only that subshell's
# copy and vanish the instant the subshell exits (linkopen-cells.sh's own header records this live finding)
# — so the caller registers the session itself, before ever calling this function.
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

# ═══ Cell — expanded cluster interleaves absorbed thinking with member rows, in the REAL binary ═════════
run_cluster_expand_cell() {
  echo "  cell cluster-expand: clicking the collapsed cluster shows the ∴ thinking body between its two Read rows; a second click collapses it back"
  local fh="cx-fh-$RUN_ID" s="cx-$RUN_ID" home="$ROOT/cx-home" short="" rc=0
  SESSIONS="$SESSIONS $fh"                    # registered HERE, not inside the subshelled `launch_fake_host` call
  short=$(launch_fake_host "$fh" "$home") || { echo "      FAIL cluster-expand: fake-host.mjs never printed its short id"; record cluster-expand 1; kill_cell "$fh"; return; }

  # THE REPLAY CONTRACT: push `thinkcluster` to the fake host's OWN stdin BEFORE `ccx attach` even starts —
  # this is the FIRST-EVER push, no warmup sentinel ahead of it. The frame sits in `preFollowBuffer` until
  # the attach client's first `follow` op drains and replays it.
  push "$fh" "thinkcluster"

  launch_attach "$s" "$home" "$short" \
    || { echo "      FAIL cluster-expand: ccx attach never reached the ready frame"; record cluster-expand 1; kill_cell "$s"; kill_cell "$fh"; return; }

  # Step 1: the collapsed summary row must have arrived via replay (no live push happens after this point
  # for the cluster's own content — everything the REPL shows here came out of the pre-follow buffer).
  wait_for_capture "$s" "Read 2 files" || { echo "      FAIL cluster-expand: the replayed thinkcluster frame never rendered — investigate the replay-on-follow contract, do not sentinel around it"; record cluster-expand 1; kill_cell "$s"; kill_cell "$fh"; return; }
  if grep -qF "zebra quartz reasoning" "$CAP"; then
    echo "      FAIL cluster-expand premise: the thinking phrase is already visible on the COLLAPSED row — this cell would be vacuous"
    rc=1
  else
    echo "      ok   cluster-expand premise: collapsed summary row present, thinking phrase not yet visible"
  fi

  # Step 2: click the collapsed cluster row to expand it in place.
  local rc_pair; rc_pair=$(col_of "$CAP" "Read 2 files" 0) || { echo "      FAIL cluster-expand: could not locate the collapsed cluster row's column"; record cluster-expand 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col row; read -r col row <<<"$rc_pair"
  plain_click "$s" "$col" "$row"
  wait_for_capture "$s" "zebra quartz reasoning" || { echo "      FAIL cluster-expand: the expanded cluster never showed the absorbed thinking phrase"; record cluster-expand 1; kill_cell "$s"; kill_cell "$fh"; return; }

  # Assert: the ∴ gutter is present, and the phrase sits strictly BETWEEN the two Read member rows, in
  # capture line order (order matters — this is the T-CLUSTER Task 2 ordering contract, not just presence).
  local expanded; expanded=$(cat "$CAP")
  if ! printf '%s' "$expanded" | grep -qF "∴"; then
    echo "      FAIL cluster-expand: no ∴ gutter line found in the expanded capture"
    rc=1
  else
    echo "      ok   cluster-expand: ∴ gutter line present in the expanded capture"
  fi
  local line_a line_think line_b
  line_a=$(printf '%s\n' "$expanded" | grep -nF "Read(/work/alpha.txt)" | head -1 | cut -d: -f1)
  line_think=$(printf '%s\n' "$expanded" | grep -nF "zebra quartz reasoning" | head -1 | cut -d: -f1)
  line_b=$(printf '%s\n' "$expanded" | grep -nF "Read(/work/beta.txt)" | head -1 | cut -d: -f1)
  if [ -z "$line_a" ] || [ -z "$line_think" ] || [ -z "$line_b" ]; then
    echo "      FAIL cluster-expand: could not locate all three of Read(/work/alpha.txt)/thinking phrase/Read(/work/beta.txt) in the expanded capture"
    printf '%s\n' "$expanded" | sed 's/^/      | /'
    rc=1
  elif [ "$line_a" -lt "$line_think" ] && [ "$line_think" -lt "$line_b" ]; then
    echo "      ok   cluster-expand: order is Read(/work/alpha.txt) [line $line_a] → thinking phrase [line $line_think] → Read(/work/beta.txt) [line $line_b]"
  else
    echo "      FAIL cluster-expand: wrong order — Read(/work/alpha.txt) [line $line_a], thinking phrase [line $line_think], Read(/work/beta.txt) [line $line_b]"
    printf '%s\n' "$expanded" | sed 's/^/      | /'
    rc=1
  fi

  # Step 3: click again to collapse. Any row tagged with the cluster's fold anchor toggles it, but the
  # `Read(...)` member header's own path argument is an OSC-8 hyperlink (T-LINKOPEN): a plain click landing
  # inside a link range resolves to "no target" so it never fights an alt-click aimed at opening it, and
  # that swallows the fold toggle too (verified live: clicking the member header did nothing here). The
  # absorbed thinking body's own text carries no link, so click there instead — it is tagged with the same
  # fold anchor as every other row this cluster's expansion drew.
  local rc_pair2; rc_pair2=$(col_of "$CAP" "First I skim" 2) || { echo "      FAIL cluster-expand: could not locate the thinking body text's column"; record cluster-expand 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col2 row2; read -r col2 row2 <<<"$rc_pair2"
  plain_click "$s" "$col2" "$row2"
  wait_for_capture "$s" "Read 2 files" || { echo "      FAIL cluster-expand: the collapsed summary row never came back after the second click"; record cluster-expand 1; kill_cell "$s"; kill_cell "$fh"; return; }
  wait_for_capture_absence "$s" "zebra quartz reasoning" || { echo "      FAIL cluster-expand: the thinking phrase is still visible after collapsing"; rc=1; }
  if [ "$rc" -eq 0 ]; then
    echo "      ok   cluster-expand: second click restored the summary row and the thinking phrase is gone"
  fi

  kill_cell "$s"; kill_cell "$fh"
  record cluster-expand "$rc"
}

echo "bl6 T-CLUSTER task 3 — pty acceptance (socket -L $TM)"
run_cluster_expand_cell

echo "── $pass_count passed, $fail_count failed ──"
[ "$fail_count" -eq 0 ] || { echo "failed:$failed_cells"; exit 1; }
exit 0
