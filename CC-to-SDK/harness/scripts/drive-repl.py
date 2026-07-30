#!/usr/bin/env python3
"""Drive the real `ccx` REPL through a pty and print what a human would have seen.

The observe half of the UI observe→fix loop. Every TUI defect found on 2026-07-30 was
invisible to the in-process Ink tests and visible here in one run: the slash-command
palette capped at 8, `/exit` unhandled, and a quietly-successful `!` command rendering
nothing at all. Ink tests prove components; this proves the binary.

Usage (from harness/):
    set -a; . ../.env; set +a
    python3 scripts/drive-repl.py /tmp/scratchdir '!echo hi' '/help' '/exit'

Each argument after the working directory is typed, then Enter is sent SEPARATELY.
That separation is load-bearing: one write containing both the text and "\\r" is a
PASTE (multi-char input with an embedded newline), which the editor correctly turns
into a newline rather than a submit. Writing them together fakes a bug that does not
exist — it cost a false "Enter does not submit" report before this was understood.

Boot and per-line waits are wall-clock, not output-driven: an Ink full-screen app
repaints continuously, so there is no quiet prompt to synchronize on. Raise BOOT_WAIT
if the banner has not appeared before the first line is typed.

Exit: Ctrl-D is sent after the last line. Output is raw, escape sequences included;
pipe through scripts/clean-pty.py (or the inline recipe in its docstring) to read it.
"""
import os
import pty
import select
import signal
import sys
import time

BOOT_WAIT = 12.0      # seconds to let the REPL paint its banner before typing
TYPE_SETTLE = 1.0     # seconds between the typed text and its Enter
LINE_WAIT = 8.0       # seconds to collect output after each Enter

if len(sys.argv) < 3:
    sys.exit(__doc__)

workdir = sys.argv[1]
lines = sys.argv[2:]
root = os.getcwd()
entry = os.path.join(root, "src", "cli", "bin.ts")
if not os.path.exists(entry):
    sys.exit(f"run me from harness/ — {entry} not found")

captured: list[str] = []
pid, fd = pty.fork()
if pid == 0:
    # The child must inherit this cwd for node module resolution (tsx lives in
    # harness/node_modules); the REPL's own working directory is passed with --cwd.
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLUMNS"] = "100"
    os.environ["LINES"] = "40"
    os.execvp("node", ["node", "--import", "tsx", entry, "--cwd", workdir])


def pump(seconds: float) -> bool:
    """Collect output for `seconds`. Returns False once the pty closes (child exited)."""
    end = time.time() + seconds
    while time.time() < end:
        readable, _, _ = select.select([fd], [], [], 0.2)
        if not readable:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return False
        if not data:
            return False
        captured.append(data.decode("utf8", "replace"))
    return True


try:
    if not pump(BOOT_WAIT):
        captured.append("\n<<pty closed during boot>>\n")
    else:
        for line in lines:
            os.write(fd, line.encode())
            pump(TYPE_SETTLE)
            os.write(fd, b"\r")
            if not pump(LINE_WAIT):
                # Expected for /exit — the REPL is supposed to leave here.
                captured.append(f"\n<<pty closed after {line!r}>>\n")
                break
        else:
            os.write(fd, b"\x04")           # Ctrl-D
            pump(3.0)
except OSError as e:
    captured.append(f"\n<<OSError {e}>>\n")
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    sys.stdout.write("".join(captured))
