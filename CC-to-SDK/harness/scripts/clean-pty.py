#!/usr/bin/env python3
"""Strip ANSI escapes from a drive-repl.py capture so it can be read (or diffed).

    python3 scripts/drive-repl.py /tmp/w '!echo hi' '/exit' | python3 scripts/clean-pty.py

An Ink app repaints the whole frame on every state change, so a capture contains the
same screen many times. --tail keeps only the last N non-blank lines, which is usually
the final frame plus the scrollback that matters.
"""
import re
import sys

ESCAPES = (
    re.compile(r"\x1b\[[0-9;?]*[A-Za-z]"),   # CSI
    re.compile(r"\x1b[=>]"),                 # keypad mode
    re.compile(r"\x1b\][^\x07]*\x07"),       # OSC
)

tail = None
if "--tail" in sys.argv:
    tail = int(sys.argv[sys.argv.index("--tail") + 1])

text = sys.stdin.read()
for pattern in ESCAPES:
    text = pattern.sub("", text)
lines = [line.rstrip() for line in text.split("\n") if line.strip()]
sys.stdout.write("\n".join(lines[-tail:] if tail else lines) + "\n")
