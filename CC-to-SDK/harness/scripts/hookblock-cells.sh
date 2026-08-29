#!/usr/bin/env bash
# harness/scripts/hookblock-cells.sh — bl7 T-HOOKBLOCK task 4: real-binary pty acceptance for the
# expanded-cluster hook block (Tasks 1-3 of this ticket). Same driver discipline as
# scripts/cluster-expand-cells.sh (itself following linkopen-cells.sh/select-pty.sh): a PRIVATE tmux socket
# (`-L`), an isolated HOME/CCX_FLEET_ROOT per run, teardown that kills ONLY the sessions this run created
# (never `kill-server` on a shared socket, never `-a`), and SGR mouse bytes sent from THIS SAVED SCRIPT FILE
# only — an inline Bash-tool send of the identical bytes reliably drops the tap.
#
# WHY FAKE-HOST, NOT A LIVE MODEL TURN: see linkopen-cells.sh's/cluster-expand-cells.sh's own headers —
# same reasoning, unchanged here. This file adds ONE new `fake-host.mjs` word producer, `hookcluster` (two
# `Read` calls with a PreToolUse `hook_started`/`hook_response` pair sandwiched between the FIRST call and
# ITS OWN result — the normal wire order real settings-layer hooks fire in, spec D12), and drives it through
# the REAL `ccx attach` binary to prove two things:
#
#   Cell 1 (live): pushed AFTER attach, the expanded cluster shows BOTH the hook-count header ("Ran 1
#   PreToolUse hook (") and the per-hook line ("⎿ PreToolUse:Read (") positioned after the two member rows —
#   hook stamps require LIVE arrival (`useChat.ts`'s `!ev.replay` guard), which is why this cell pushes only
#   once the attach client is already following.
#
#   Cell 2 (replay, A4): pushed BEFORE `ccx attach` ever starts, so the whole `hookcluster` frame sequence
#   (including the hook pair) arrives marked `replay: true` on the client's first `follow`. The member rows
#   still render (nothing about members depends on live-only arrival) but the hook pair is swallowed by the
#   `!ev.replay` guard before it ever reaches `HookPairTracker` — so the expanded cluster must show the two
#   member rows and NO "PreToolUse" text anywhere. This is the accepted resume divergence spec D4 pins
#   deliberately: a resumed/attached session has no way to recover a hook's timing after the fact, so it
#   shows none rather than a fabricated one. If this cell ever shows "PreToolUse" in the replay path, that
#   is a real regression in the `!ev.replay` guard to investigate, not something to relax the assertion for.
set -uo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HARNESS_DIR/dist/cli/bin.js"
COL_OF="$HARNESS_DIR/scripts/linkopen-col-of.py"
BUILD=1
for arg in "$@"; do case "$arg" in --no-build) BUILD=0 ;; *) echo "unknown flag: $arg" >&2; exit 2 ;; esac; done

TM="bl7hook$$"                                 # the private tmux socket name (-L), never the default server
missing() {
  echo "SKIP: hookblock-cells needs $1, which is not on PATH. (Install it to run this suite.)"
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
ROOT=$(mktemp -d /tmp/hookblock-cells-XXXXXX)
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
# copy and vanish the instant the subshell exits — so the caller registers the session itself, before ever
# calling this function.
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

# wait_for_follow <fake-host-session> — bl7 T-HOOKBLOCK task 4: "manual mode on" painting on the ATTACH
# pane is NOT proof the attach client's own `follow` op has been processed by the fake host yet (there is a
# real gap between the client sending it and the handler running) — a push sent right after that text races
# the op and can land in `preFollowBuffer`, replayed with `replay:true` on drain. That starves any assertion
# depending on a LIVE-only ingest arm (live-run evidence: `useChat.ts`'s hook stamps come back empty roughly
# half the time without this barrier). `fake-host.mjs` prints "FOLLOWED" to ITS OWN stdout the instant the
# first `follow` op is actually handled — polling for that text on the fake host's pane is the real barrier.
wait_for_follow() {
  local fh="$1" i=0
  while [ "$i" -lt 40 ]; do
    tmux -L "$TM" capture-pane -t "$fh" -p -S - 2>/dev/null | grep -qF "FOLLOWED" && return 0
    sleep 0.25; i=$((i+1))
  done
  return 1
}

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

# ═══ Cell 1 — LIVE path: expanded cluster shows the hook-count header + per-hook line, after member rows ═══
run_hookblock_live_cell() {
  echo "  cell hookblock-live: clicking the collapsed cluster shows the hook block after its two Read rows (live push, hook stamps require live arrival)"
  local fh="hbl-fh-$RUN_ID" s="hbl-$RUN_ID" home="$ROOT/hbl-home" short="" rc=0
  SESSIONS="$SESSIONS $fh"                    # registered HERE, not inside the subshelled `launch_fake_host` call
  short=$(launch_fake_host "$fh" "$home") || { echo "      FAIL hookblock-live: fake-host.mjs never printed its short id"; record hookblock-live 1; kill_cell "$fh"; return; }

  launch_attach "$s" "$home" "$short" \
    || { echo "      FAIL hookblock-live: ccx attach never reached the ready frame"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }

  wait_for_follow "$fh" || { echo "      FAIL hookblock-live: fake-host.mjs never printed FOLLOWED — the attach client's own follow op never landed"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }

  # LIVE PUSH: pushed only now, with the attach client's `follow` op CONFIRMED handled (not just "mode on"
  # painted) — this is the arm the hook stamps need (`!ev.replay`), unlike the replay cell below.
  push "$fh" "hookcluster"

  # Wait for "hookcluster done" (the LAST frame in the whole burst), not just "Read 2 files" (which can
  # render as soon as both Read calls are absorbed, before the hook pair's D14 reconcile and the run's own
  # flush have necessarily settled) — clicking off that earlier, partially-settled capture raced the fold's
  # pending->flushed transition and intermittently landed on stale coordinates (observed live: the cluster
  # still expanded, but with an empty hook block). Waiting for the whole script's tail message guarantees
  # every frame — including the hook pair — has been ingested and reconciled before coordinates are read.
  wait_for_capture "$s" "hookcluster done" || { echo "      FAIL hookblock-live: the collapsed hookcluster frame never rendered"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }
  # NOTE: the COLLAPSED form already shows a standalone dim "Ran 1 PreToolUse hook (…)" line (Task 2's
  # "hooks coexist with another clause" form, toolRenderer.tsx ~1120) — that text is NOT what distinguishes
  # collapsed from expanded here, so the vacuous-premise check keys on the per-hook MEMBER line instead
  # ("⎿ PreToolUse:Read ("), which only the expanded block (Task 3) ever prints.
  if grep -qF "PreToolUse:Read (" "$CAP"; then
    echo "      FAIL hookblock-live premise: the per-hook member line is already visible on the COLLAPSED row — this cell would be vacuous"
    rc=1
  else
    echo "      ok   hookblock-live premise: collapsed summary row present (with its own standalone hook-count line), per-hook member line not yet visible"
  fi
  if ! grep -qF "Ran 1 PreToolUse hook (" "$CAP"; then
    echo "      FAIL hookblock-live: the collapsed form's own standalone hook-count line is missing pre-click — the hook pair was likely swallowed as a replay (see wait_for_follow above)"
    rc=1
  fi

  # Click the collapsed cluster row to expand it in place.
  local rc_pair; rc_pair=$(col_of "$CAP" "Read 2 files" 0) || { echo "      FAIL hookblock-live: could not locate the collapsed cluster row's column"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col row; read -r col row <<<"$rc_pair"
  plain_click "$s" "$col" "$row"
  wait_for_capture "$s" "⎿ PreToolUse:Read (" || { echo "      FAIL hookblock-live: the expanded cluster never showed the per-hook member line"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }
  if ! grep -qF "Ran 1 PreToolUse hook (" "$CAP"; then
    echo "      FAIL hookblock-live: the hook-count header is missing from the expanded capture"
    rc=1
  fi

  local expanded; expanded=$(cat "$CAP")
  if ! printf '%s' "$expanded" | grep -qF "⎿ PreToolUse:Read ("; then
    echo "      FAIL hookblock-live: no per-hook line (\"⎿ PreToolUse:Read (\") found in the expanded capture"
    rc=1
  else
    echo "      ok   hookblock-live: per-hook line present in the expanded capture"
  fi
  # Order matters: both Read member rows, THEN the hook header, THEN the per-hook line (spec §2.5 — the
  # hook block is appended AFTER the sorted member/thinking interleave, never interleaved with it).
  local line_a line_b line_head line_hook
  line_a=$(printf '%s\n' "$expanded" | grep -nF "Read(/work/alpha.txt)" | head -1 | cut -d: -f1)
  line_b=$(printf '%s\n' "$expanded" | grep -nF "Read(/work/beta.txt)" | head -1 | cut -d: -f1)
  line_head=$(printf '%s\n' "$expanded" | grep -nF "Ran 1 PreToolUse hook (" | head -1 | cut -d: -f1)
  line_hook=$(printf '%s\n' "$expanded" | grep -nF "⎿ PreToolUse:Read (" | head -1 | cut -d: -f1)
  if [ -z "$line_a" ] || [ -z "$line_b" ] || [ -z "$line_head" ] || [ -z "$line_hook" ]; then
    echo "      FAIL hookblock-live: could not locate all four of the two Read member rows / hook header / per-hook line in the expanded capture"
    printf '%s\n' "$expanded" | sed 's/^/      | /'
    rc=1
  elif [ "$line_a" -lt "$line_b" ] && [ "$line_b" -lt "$line_head" ] && [ "$line_head" -lt "$line_hook" ]; then
    echo "      ok   hookblock-live: order is Read(alpha) [line $line_a] → Read(beta) [line $line_b] → hook header [line $line_head] → per-hook line [line $line_hook]"
  else
    echo "      FAIL hookblock-live: wrong order — alpha [line $line_a], beta [line $line_b], hook header [line $line_head], per-hook line [line $line_hook]"
    printf '%s\n' "$expanded" | sed 's/^/      | /'
    rc=1
  fi

  # Collapse-click: target the per-hook line's own body text — like the member `Read(...)` header, a plain
  # click landing inside an OSC-8 link range resolves to "no target" (T-LINKOPEN) rather than toggling the
  # fold, but the hook block's lines carry no link (toolRenderer.tsx: `kind: "line"`, no href) — same
  # non-link-text caveat cluster-expand-cells.sh's own header documents for the absorbed-thinking body.
  local rc_pair2; rc_pair2=$(col_of "$CAP" "PreToolUse:Read (" 2) || { echo "      FAIL hookblock-live: could not locate the per-hook line's column"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col2 row2; read -r col2 row2 <<<"$rc_pair2"
  plain_click "$s" "$col2" "$row2"
  wait_for_capture "$s" "Read 2 files" || { echo "      FAIL hookblock-live: the collapsed summary row never came back after the second click"; record hookblock-live 1; kill_cell "$s"; kill_cell "$fh"; return; }
  # Collapsing does NOT remove "Ran 1 PreToolUse hook (" — that text is ALSO the collapsed form's own
  # standalone dim line (Task 2), so it is expected to still be present. What must disappear is the
  # per-hook MEMBER line, which only the expanded block (Task 3) ever prints.
  wait_for_capture_absence "$s" "⎿ PreToolUse:Read (" || { echo "      FAIL hookblock-live: the per-hook member line is still visible after collapsing"; rc=1; }
  if ! grep -qF "Ran 1 PreToolUse hook (" "$CAP"; then
    echo "      FAIL hookblock-live: the collapsed form's own standalone hook-count line is unexpectedly gone after collapsing"
    rc=1
  fi
  if [ "$rc" -eq 0 ]; then
    echo "      ok   hookblock-live: second click restored the summary row, kept the collapsed hook-count line, and the per-hook member line is gone"
  fi

  kill_cell "$s"; kill_cell "$fh"
  record hookblock-live "$rc"
}

# ═══ Cell 2 — REPLAY path (A4): member rows present, hook block ABSENT (spec D4 divergence, pinned) ═══════
run_hookblock_replay_cell() {
  echo "  cell hookblock-replay: a hookcluster frame pushed BEFORE attach replays with member rows but NO hook block (accepted resume divergence, spec D4)"
  local fh="hbr-fh-$RUN_ID" s="hbr-$RUN_ID" home="$ROOT/hbr-home" short="" rc=0
  SESSIONS="$SESSIONS $fh"
  short=$(launch_fake_host "$fh" "$home") || { echo "      FAIL hookblock-replay: fake-host.mjs never printed its short id"; record hookblock-replay 1; kill_cell "$fh"; return; }

  # THE REPLAY CONTRACT (T-ATTACH): push `hookcluster` to the fake host's OWN stdin BEFORE `ccx attach` even
  # starts — this is the FIRST-EVER push, no warmup sentinel ahead of it. The frame sits in `preFollowBuffer`
  # until the attach client's first `follow` op drains and replays it, marked `replay: true` — which is what
  # makes `useChat.ts`'s `!ev.replay` guard swallow the hook pair before it ever reaches `HookPairTracker`.
  push "$fh" "hookcluster"

  launch_attach "$s" "$home" "$short" \
    || { echo "      FAIL hookblock-replay: ccx attach never reached the ready frame"; record hookblock-replay 1; kill_cell "$s"; kill_cell "$fh"; return; }

  # Same settle-barrier as the live cell: wait for the whole burst's tail message, not just "Read 2 files".
  wait_for_capture "$s" "hookcluster done" || { echo "      FAIL hookblock-replay: the replayed hookcluster frame never rendered — investigate the replay-on-follow contract, do not sentinel around it"; record hookblock-replay 1; kill_cell "$s"; kill_cell "$fh"; return; }

  local rc_pair; rc_pair=$(col_of "$CAP" "Read 2 files" 0) || { echo "      FAIL hookblock-replay: could not locate the collapsed cluster row's column"; record hookblock-replay 1; kill_cell "$s"; kill_cell "$fh"; return; }
  local col row; read -r col row <<<"$rc_pair"
  plain_click "$s" "$col" "$row"
  wait_for_capture "$s" "Read(/work/beta.txt)" || { echo "      FAIL hookblock-replay: the expanded cluster never showed its member rows"; record hookblock-replay 1; kill_cell "$s"; kill_cell "$fh"; return; }

  local expanded; expanded=$(cat "$CAP")
  if ! printf '%s' "$expanded" | grep -qF "Read(/work/alpha.txt)"; then
    echo "      FAIL hookblock-replay: member row Read(/work/alpha.txt) missing from the expanded capture"
    rc=1
  else
    echo "      ok   hookblock-replay: both member rows present in the expanded capture"
  fi
  # THE PIN: no "PreToolUse" text anywhere on the pane — not the hook-count header, not the per-hook line.
  # A replayed hook frame is swallowed by useChat's `!ev.replay` guard before HookPairTracker ever sees it.
  if printf '%s' "$expanded" | grep -qF "PreToolUse"; then
    echo "      FAIL hookblock-replay: \"PreToolUse\" text found in the expanded capture — the replay divergence (spec D4) is not holding"
    printf '%s\n' "$expanded" | sed 's/^/      | /'
    rc=1
  else
    echo "      ok   hookblock-replay: no \"PreToolUse\" text anywhere — the accepted resume divergence holds"
  fi

  kill_cell "$s"; kill_cell "$fh"
  record hookblock-replay "$rc"
}

echo "bl7 T-HOOKBLOCK task 4 — pty acceptance (socket -L $TM)"
run_hookblock_live_cell
run_hookblock_replay_cell

echo "── $pass_count passed, $fail_count failed ──"
[ "$fail_count" -eq 0 ] || { echo "failed:$failed_cells"; exit 1; }
exit 0
