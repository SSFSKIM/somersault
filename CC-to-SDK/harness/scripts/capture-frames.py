#!/usr/bin/env python3
r"""Capture ANSI screen frames from a TUI binary under a pty — the fidelity program's instrument.

Feeds a .keys script to the child and, at each `frame:<name>` line, renders everything received so far
through pyte (a VT100 emulator) and writes the CURRENT SCREEN as NN-<name>.ansi: one line per row,
with minimal SGR sequences reconstructed from per-cell attributes. Frames are screen STATES, not raw
streams — raw pty output is not comparable across binaries (repaint strategies differ); the emulated
grid is.

Setup (once, PEP 668 blocks a bare pip on this machine):
    python3 -m venv scripts/frames/.venv && scripts/frames/.venv/bin/pip install pyte
Run every invocation of this script with that interpreter: scripts/frames/.venv/bin/python3.

Key-script grammar (one action per line, # comments and blank lines ignored):
    wait:<seconds>      sleep while pumping output
    type:<text>         write text verbatim (no Enter)
    enter               write \r
    key:<name>          esc | tab | up | down | ctrl-<letter> | a raw \xNN escape
    frame:<name>        snapshot the screen now

Usage (from harness/):
    scripts/frames/.venv/bin/python3 scripts/capture-frames.py \
        --script scripts/frames/help-overlay.keys \
        --out test/fixtures/upstream-frames/help-overlay --bin "claude" --cwd /tmp/frame-scratch
Omitting --bin runs OUR binary: node --import tsx src/cli/bin.ts --cwd <cwd>, from the harness checkout
(same guard as scripts/drive-repl.py — this must be launched from harness/).
"""
import argparse
import fcntl
import os
import pty
import re
import select
import shlex
import signal
import struct
import sys
import termios
import time

try:
    import pyte
    from pyte import graphics as pyte_graphics
    from wcwidth import wcwidth
except ImportError:
    sys.exit(
        "pyte not installed — run: python3 -m venv scripts/frames/.venv "
        "&& scripts/frames/.venv/bin/pip install pyte"
    )

KEY_MAP = {"esc": b"\x1b", "tab": b"\t", "up": b"\x1b[A", "down": b"\x1b[B"}
HEX6 = re.compile(r"^[0-9a-fA-F]{6}$")

# This script may itself run inside an active Claude Code / Agent SDK session, which sets a family
# of CLAUDE*-prefixed env vars (session id, child-session marker, effort, job dir, pid, agent tag).
# Discovered live 2026-07-31: the real `claude` binary sees CLAUDE_CODE_CHILD_SESSION and friends and
# treats itself as a NESTED child of that session — its very first frame then paints the operator's
# real name/email/org, the live conversation title, and weekly quota usage instead of a pristine cold
# boot. Golden and ccx captures must be reproducible regardless of who runs this script or from what
# context, so the child gets a scrubbed environment: everything CLAUDE*-prefixed is dropped except the
# one var our own binary needs to authenticate.
KEEP_CLAUDE_ENV = {"CLAUDE_CODE_OAUTH_TOKEN"}


def clean_child_env() -> None:
    for name in list(os.environ):
        if name in KEEP_CLAUDE_ENV:
            continue
        if name.startswith("CLAUDE") or name == "AI_AGENT":
            del os.environ[name]

class DimScreen(pyte.Screen):
    """pyte Screen plus the SGR 2 state that pyte intentionally omits from Char."""

    def __init__(self, columns: int, lines: int):
        super().__init__(columns, lines)
        self.dim_buffer = [[False for _ in range(columns)] for _ in range(lines)]
        self._dim = False

    def select_graphic_rendition(self, *attrs: int) -> None:
        if not attrs or attrs == (0,):
            self._dim = False
        else:
            for attr in attrs:
                if attr == 0:
                    self._dim = False
                elif attr == 2:
                    self._dim = True
                elif attr == 22:
                    self._dim = False
        super().select_graphic_rendition(*attrs)

    def draw(self, data: str) -> None:
        x, y = self.cursor.x, self.cursor.y
        for char in data:
            width = wcwidth(char)
            if x == self.columns and width > 0:
                x = 0
                y = min(y + 1, self.lines - 1)
            if width == 1 and 0 <= y < self.lines and 0 <= x < self.columns:
                self.dim_buffer[y][x] = self._dim
            elif width == 2 and 0 <= y < self.lines and 0 <= x < self.columns:
                self.dim_buffer[y][x] = self._dim
                if x + 1 < self.columns:
                    self.dim_buffer[y][x + 1] = self._dim
            if width > 0:
                x = min(x + width, self.columns)
        super().draw(data)

    def dim_at(self, row: int, column: int) -> bool:
        return self.dim_buffer[row][column]

    def _blank(self) -> list[bool]:
        return [False for _ in range(self.columns)]

    def index(self) -> None:
        top, bottom = self.margins or (0, self.lines - 1)
        if self.cursor.y == bottom:
            for row in range(top, bottom):
                self.dim_buffer[row] = self.dim_buffer[row + 1]
            self.dim_buffer[bottom] = self._blank()
        super().index()

    def reverse_index(self) -> None:
        top, bottom = self.margins or (0, self.lines - 1)
        if self.cursor.y == top:
            for row in range(bottom, top, -1):
                self.dim_buffer[row] = self.dim_buffer[row - 1]
            self.dim_buffer[top] = self._blank()
        super().reverse_index()

    def erase_in_display(self, how: int = 0, *args, **kwargs) -> None:
        super().erase_in_display(how, *args, **kwargs)
        if how == 0:
            for row in range(self.cursor.y + 1, self.lines):
                self.dim_buffer[row] = self._blank()
            for column in range(self.cursor.x, self.columns):
                self.dim_buffer[self.cursor.y][column] = False
        elif how == 1:
            for row in range(self.cursor.y):
                self.dim_buffer[row] = self._blank()
            for column in range(self.cursor.x + 1):
                self.dim_buffer[self.cursor.y][column] = False
        elif how in (2, 3):
            self.dim_buffer = [self._blank() for _ in range(self.lines)]

    def erase_in_line(self, how: int = 0, private: bool = False) -> None:
        super().erase_in_line(how, private)
        if how == 0:
            interval = range(self.cursor.x, self.columns)
        elif how == 1:
            interval = range(self.cursor.x + 1)
        else:
            interval = range(self.columns)
        for column in interval:
            self.dim_buffer[self.cursor.y][column] = False

    def delete_characters(self, count: int | None = None) -> None:
        count = count or 1
        row, start = self.cursor.y, self.cursor.x
        super().delete_characters(count)
        dim = self.dim_buffer[row]
        for column in range(start, self.columns):
            dim[column] = dim[column + count] if column + count < self.columns else False

    def insert_characters(self, count: int | None = None) -> None:
        count = count or 1
        row, start = self.cursor.y, self.cursor.x
        super().insert_characters(count)
        dim = self.dim_buffer[row]
        for column in range(self.columns - 1, start - 1, -1):
            dim[column] = dim[column - count] if column - count >= start else False

    def delete_lines(self, count: int | None = None) -> None:
        count = count or 1
        top, bottom = self.margins or (0, self.lines - 1)
        row = self.cursor.y
        super().delete_lines(count)
        if top <= row <= bottom:
            dim = self.dim_buffer
            for y in range(row, bottom + 1):
                dim[y] = dim[y + count] if y + count <= bottom else self._blank()

    def insert_lines(self, count: int | None = None) -> None:
        count = count or 1
        top, bottom = self.margins or (0, self.lines - 1)
        row = self.cursor.y
        super().insert_lines(count)
        if top <= row <= bottom:
            dim = self.dim_buffer
            for y in range(bottom, row - 1, -1):
                dim[y] = dim[y - count] if y - count >= row else self._blank()

    def reset(self) -> None:
        super().reset()
        self.dim_buffer = [self._blank() for _ in range(self.lines)]
        self._dim = False


# Reverse pyte's code->name color tables into name->code, once. Built from pyte's own tables (not
# hand-copied) so the FG/BG AIXTERM naming quirks (e.g. "brown" for ANSI yellow, a bg-side "bfight*"
# typo in some pyte builds) resolve correctly without us having to know about them.
FG_NAME_TO_CODE = {name: code for code, name in {**pyte_graphics.FG_ANSI, **pyte_graphics.FG_AIXTERM}.items()}
BG_NAME_TO_CODE = {name: code for code, name in {**pyte_graphics.BG_ANSI, **pyte_graphics.BG_AIXTERM}.items()}


def resolve_key(name: str) -> bytes:
    if name in KEY_MAP:
        return KEY_MAP[name]
    if name.startswith("ctrl-") and len(name) == 6:
        return bytes([ord(name[5]) & 0x1F])
    m = re.fullmatch(r"\\x([0-9a-fA-F]{2})", name)
    if m:
        return bytes([int(m.group(1), 16)])
    raise ValueError(f"unknown key name: {name!r}")


def color_codes(name: str, is_fg: bool) -> list[str]:
    """SGR parameter codes for one pyte color name/hex-string, or [] for 'default'."""
    if not name or name == "default":
        return []
    if HEX6.match(name):
        r, g, b = int(name[0:2], 16), int(name[2:4], 16), int(name[4:6], 16)
        return [("38" if is_fg else "48"), "2", str(r), str(g), str(b)]
    table = FG_NAME_TO_CODE if is_fg else BG_NAME_TO_CODE
    code = table.get(name)
    return [str(code)] if code is not None else []


def sgr_codes(cell, dim: bool) -> list[str]:
    codes = []
    if cell.bold:
        codes.append("1")
    if dim:
        codes.append("2")
    if cell.italics:
        codes.append("3")
    if cell.underscore:
        codes.append("4")
    if cell.blink:
        codes.append("5")
    if cell.reverse:
        codes.append("7")
    if cell.strikethrough:
        codes.append("9")
    codes += color_codes(cell.fg, True)
    codes += color_codes(cell.bg, False)
    return codes


def cell_style_key(cell, dim: bool):
    return (cell.bold, dim, cell.italics, cell.underscore, cell.blink, cell.strikethrough, cell.reverse, cell.fg, cell.bg)


def is_plain_space(cell, dim: bool) -> bool:
    return cell.data == " " and cell_style_key(cell, dim) == (False, False, False, False, False, False, False, "default", "default")


def render_line(screen, row: dict, columns: int, row_index: int) -> str:
    """One screen row -> one line of text with minimal SGR runs. Trims only trailing cells that are
    both blank AND unstyled — a styled trailing space (e.g. a highlight bar) is real content."""
    cells = [row[c] for c in range(columns)]
    end = columns
    while end > 0 and is_plain_space(cells[end - 1], screen.dim_at(row_index, end - 1)):
        end -= 1
    out = []
    prev_key = None
    for column, cell in enumerate(cells[:end]):
        dim = screen.dim_at(row_index, column)
        key = cell_style_key(cell, dim)
        if key != prev_key:
            codes = sgr_codes(cell, dim)
            out.append(f"\x1b[0;{';'.join(codes)}m" if codes else "\x1b[0m")
            prev_key = key
        out.append(cell.data)
    out.append("\x1b[0m")
    return "".join(out)


def render_screen(screen) -> str:
    lines = [render_line(screen, screen.buffer[r], screen.columns, r) for r in range(screen.lines)]
    return "\n".join(lines) + "\n"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--script", required=True, help="path to a .keys file")
    p.add_argument("--out", required=True, help="directory to write NN-<name>.ansi frames into")
    p.add_argument("--bin", default=None, help="command to exec as the child; omit to run our own binary")
    p.add_argument("--cwd", required=True, help="working directory for the child (the TUI's --cwd or process cwd)")
    p.add_argument("--cols", type=int, default=100)
    p.add_argument("--rows", type=int, default=40)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    root = os.getcwd()
    entry = os.path.join(root, "src", "cli", "bin.ts")
    if not args.bin and not os.path.exists(entry):
        sys.exit(f"run me from harness/ — {entry} not found")

    with open(args.script, encoding="utf-8") as f:
        script_lines = [ln.rstrip("\n") for ln in f if ln.strip() and not ln.strip().startswith("#")]

    os.makedirs(args.out, exist_ok=True)

    screen = DimScreen(args.cols, args.rows)
    stream = pyte.ByteStream(screen)
    captured: list[bytes] = []

    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        clean_child_env()
        if args.bin:
            os.chdir(args.cwd)
            argv = shlex.split(args.bin)
            os.execvp(argv[0], argv)
        else:
            # cwd stays harness/ for node module resolution (tsx lives here); the REPL's own working
            # directory is passed with --cwd, same split as scripts/drive-repl.py.
            os.execvp("node", ["node", "--import", "tsx", entry, "--cwd", args.cwd])

    # Node does not read COLUMNS/LINES for a TTY; set the window size on the master fd before the
    # child paints anything, or every capture is an 80x24 frame regardless of --cols/--rows.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))

    def pump(seconds: float) -> bool:
        """Collect output for `seconds`; False means the child closed the pty before the script finished."""
        end = time.time() + seconds
        while time.time() < end:
            readable, _, _ = select.select([fd], [], [], min(0.2, max(0, end - time.time())))
            if not readable:
                continue
            try:
                data = os.read(fd, 65536)
            except OSError:
                return False
            if not data:
                return False
            captured.append(data)
            stream.feed(data)
        readable, _, _ = select.select([fd], [], [], 0)
        if readable:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return False
            if not data:
                return False
            captured.append(data)
            stream.feed(data)
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done == pid:
                return False
        except ChildProcessError:
            return False
        return True

    expected_frames = [line for line in script_lines if line.startswith("frame:")]
    seq = 0
    frames_written = []
    failed = False

    def fail(message: str) -> None:
        nonlocal failed
        failed = True
        sys.stderr.write(f"capture-frames: {message}\n")

    try:
        for line in script_lines:
            action, _, value = line.partition(":")
            if action == "wait":
                if not pump(float(value)):
                    fail(f"pty closed during {line!r}")
                    break
            elif action in ("type", "enter", "key"):
                if not pump(0):
                    fail(f"pty closed before {line!r}")
                    break
                data = value.encode() if action == "type" else b"\r" if action == "enter" else resolve_key(value)
                written = os.write(fd, data)
                if written != len(data):
                    fail(f"short write during {line!r}: {written}/{len(data)} bytes")
                    break
            elif action == "frame":
                if not pump(0):
                    fail(f"pty closed before {line!r}")
                    break
                seq += 1
                out_name = f"{seq:02d}-{value}.ansi"
                try:
                    with open(os.path.join(args.out, out_name), "w", encoding="utf-8") as fh:
                        fh.write(render_screen(screen))
                except OSError as error:
                    fail(f"frame write failed for {line!r}: {error}")
                    break
                frames_written.append(out_name)
            else:
                fail(f"unknown action in key script: {line!r}")
                break
    except (OSError, ValueError) as error:
        fail(f"pty/action error: {error}")
    finally:
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass

    if not frames_written:
        fail("script produced no frame")
    if len(frames_written) != len(expected_frames):
        fail(f"incomplete capture: expected {len(expected_frames)} frame(s), wrote {len(frames_written)}")
    sys.stderr.write(f"capture-frames: wrote {len(frames_written)} frame(s) to {args.out}: {frames_written}\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
