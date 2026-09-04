#!/bin/bash
# reforge-child.sh — THE SCRIPTED CHILD (C13c / W10c, scout §5.2 capability 1).
#
# Every Bash scenario in the corpus spawns a shell running `echo`, `mkdir`,
# `chmod` or `sleep`: a process whose behaviour is whatever that program happens
# to do. The executor's interesting arms are not reachable that way — `Pde.#C`
# (the exit handler), `#A` (spawn error), `#h`'s SIGTERM->SIGKILL escalation and
# `jx`'s truncation ladder are all graded by wall-clock luck against a child
# nobody specified. This is a child whose behaviour is DECLARED by its argv.
#
# ## Why bash and not node or python
#
# It runs INSIDE the engine's shell, under the X6 allowlisted environment
# (`src/env.ts`), and both engines must run it identically. `PATH` is passed
# through from the operator, so "whatever node/python is on PATH" is exactly the
# operator coupling X6 exists to remove — two engines graded against two
# different interpreters is a difference the harness would report as an engine
# defect. `bash`, `printf` and `sleep` are what the engine already requires to
# run a Bash tool call at all.
#
# ## Determinism: no clock in the bytes
#
# The output is a pure function of the argv. Nothing timestamped, nothing
# random, nothing read from the environment reaches stdout — so the same argv
# produces byte-identical output on every engine, every replay and every
# machine, and a difference in the graded stdout is a difference in the ENGINE's
# handling of it. The SCHEDULE (when the bytes leave) and the CONTENT (which
# bytes leave) are deliberately independent axes: `--every` moves the first and
# not the second, which is what makes the negative-control matrix in
# `w10/child.test.ts` able to name which field each perturbation moves.
#
# ## Exactness
#
# `--bytes N --chunks K` writes EXACTLY N bytes: K-1 chunks of floor(N/K) and a
# last chunk carrying the remainder. Each chunk begins `R<i>:` so the chunk
# COUNT is visible in the bytes themselves — perturbing `--chunks` moves the
# content, not just the timing.
#
# Usage:
#   reforge-child.sh [--bytes N] [--chunks K] [--every MS] [--exit CODE]
#                    [--ignore-term] [--hold-fd SECONDS] [--prompt-tail]
set -u

BYTES=0
CHUNKS=1
EVERY_MS=0
EXIT_CODE=0
IGNORE_TERM=0
HOLD_FD=0
PROMPT_TAIL=0

die() { printf 'reforge-child: %s\n' "$1" >&2; exit 64; }

while [ $# -gt 0 ]; do
  case "$1" in
    --bytes)       [ $# -ge 2 ] || die "--bytes needs a value"; BYTES=$2; shift 2 ;;
    --chunks)      [ $# -ge 2 ] || die "--chunks needs a value"; CHUNKS=$2; shift 2 ;;
    --every)       [ $# -ge 2 ] || die "--every needs a value"; EVERY_MS=$2; shift 2 ;;
    --exit)        [ $# -ge 2 ] || die "--exit needs a value"; EXIT_CODE=$2; shift 2 ;;
    --hold-fd)     [ $# -ge 2 ] || die "--hold-fd needs a value"; HOLD_FD=$2; shift 2 ;;
    --ignore-term) IGNORE_TERM=1; shift ;;
    --prompt-tail) PROMPT_TAIL=1; shift ;;
    *)             die "unknown argument '$1'" ;;
  esac
done

case "$BYTES$CHUNKS$EVERY_MS$EXIT_CODE$HOLD_FD" in *[!0-9]*) die "numeric arguments must be non-negative integers" ;; esac
[ "$CHUNKS" -ge 1 ] || die "--chunks must be at least 1"

# `trap '' TERM` — IGNORED, not handled. A trap with a body would run a bash
# handler and still exit; an empty action makes the signal a no-op, which is the
# only thing that forces `#h`'s 1,500 ms backstop to escalate to SIGKILL.
if [ "$IGNORE_TERM" = 1 ]; then
  trap '' TERM
fi

# A grandchild that inherits this process's stdout and OUTLIVES it. The read end
# therefore sees no EOF when this process exits, which is the condition
# `Pde`/`jx` must survive: "the child is gone and the pipe is still open". It is
# also the deliberate detachment the supervision surface grades — a scenario
# that uses this DECLARES it (`Scenario.detachedChildren`), and one that leaks a
# child without declaring it fails the state diff.
if [ "$HOLD_FD" != 0 ]; then
  ( exec sleep "$HOLD_FD" ) &
fi

# Milliseconds to the fractional seconds `sleep` takes, without any float
# arithmetic bash does not have.
sleep_ms() {
  [ "$1" = 0 ] && return 0
  sleep "$(printf '%d.%03d' $(( $1 / 1000 )) $(( $1 % 1000 )))"
}

# `printf '%*s'` produces N spaces in one call; `tr` maps them to a fixed
# filler. The obvious pure-bash alternative (append to a string in a loop) is
# quadratic and takes seconds at the 30 KB the truncation ladder needs.
fill() {
  [ "$1" -le 0 ] && return 0
  printf '%*s' "$1" '' | tr ' ' '.'
}

base=$(( BYTES / CHUNKS ))
rest=$(( BYTES - base * (CHUNKS - 1) ))

i=0
while [ "$i" -lt "$CHUNKS" ]; do
  if [ "$i" -gt 0 ]; then sleep_ms "$EVERY_MS"; fi
  if [ "$i" -eq $(( CHUNKS - 1 )) ]; then size=$rest; else size=$base; fi
  head="R$i:"
  # The trailing newline is part of the chunk's byte budget, so a chunk smaller
  # than its own header degrades to a truncated header rather than overrunning N.
  body=$(( size - ${#head} - 1 ))
  if [ "$body" -ge 0 ]; then
    printf '%s' "$head"
    fill "$body"
    printf '\n'
  else
    printf '%s' "${head:0:$size}"
  fi
  i=$(( i + 1 ))
done

# The interactive-prompt shape the stall detector looks for: `_lr` in
# chunk-fy12d89p.js tests the LAST non-empty line of the accumulated output
# against `ylr`, seven regexes. This line matches two of them independently
# (`/Continue\?/i` and `/\(y\/n\)/i`), so a pin that retires one still fires the
# arm. It is written OUTSIDE the `--bytes` budget on purpose: the schedule and
# the prompt are separate declarations.
if [ "$PROMPT_TAIL" = 1 ]; then
  printf 'Continue? (y/n) '
fi

exit "$EXIT_CODE"
