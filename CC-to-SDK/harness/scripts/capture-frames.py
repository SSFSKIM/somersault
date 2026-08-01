#!/usr/bin/env python3
r"""Capture ANSI screen frames from a TUI binary under a pty — the fidelity program's instrument.

Feeds a .keys script to the child and, at each `frame:<name>` line, renders everything received so far
through pyte (a VT100 emulator) and writes the CURRENT SCREEN as NN-<name>.ansi: one line per row,
with minimal SGR sequences reconstructed from per-cell attributes. Frames are screen STATES, not raw
streams — raw pty output is not comparable across binaries (repaint strategies differ); the emulated
grid is.

Setup (once, PEP 668 blocks a bare pip on this machine):
    python3 -m venv scripts/frames/.venv && scripts/frames/.venv/bin/pip install -r scripts/frames/requirements.txt
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
        --out test/fixtures/upstream-frames/help-overlay --bin "claude" --cwd /tmp/frame-scratch \
        --cols 100 --rows 40 --redact-masks scripts/frames/masks.json
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
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from frame_masks import RedactionContract, canonical_path, frame_key, load_redaction_contract, redact_text, tracked_fixture_relative

try:
    import pyte
    from pyte import graphics as pyte_graphics
    from pyte import modes as pyte_modes
    from wcwidth import wcwidth
except ImportError:
    sys.exit(
        "pyte not installed — run: python3 -m venv scripts/frames/.venv "
        "&& scripts/frames/.venv/bin/pip install -r scripts/frames/requirements.txt"
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

class DimChar(tuple):
    """A pyte-compatible character tuple with SGR 2 stored as a real cell attribute."""

    __slots__ = ()
    _fields = pyte.screens.Char._fields + ("dim",)

    def __new__(cls, data=" ", fg="default", bg="default", bold=False, italics=False,
                underscore=False, strikethrough=False, reverse=False, blink=False, dim=False):
        return tuple.__new__(cls, (data, fg, bg, bold, italics, underscore, strikethrough, reverse, blink, dim))

    def __getattr__(self, name):
        try:
            return self[self._fields.index(name)]
        except ValueError as error:
            raise AttributeError(name) from error

    def _replace(self, **changes):
        values = dict(zip(self._fields, self))
        unknown = set(changes) - set(self._fields)
        if unknown:
            raise TypeError(f"Got unexpected field names: {sorted(unknown)!r}")
        values.update(changes)
        return type(self)(**values)

    def _asdict(self):
        return dict(zip(self._fields, self))


class DimScreen(pyte.Screen):
    """pyte Screen whose cell records carry SGR 2 through every pyte mutation."""

    @property
    def default_char(self):
        return DimChar(reverse=pyte_modes.DECSCNM in self.mode)

    def reset(self) -> None:
        super().reset()
        self.cursor.attrs = self.default_char

    def select_graphic_rendition(self, *attrs: int) -> None:
        super().select_graphic_rendition(*attrs)
        dim = getattr(self.cursor.attrs, "dim", False)
        for attr in attrs:
            if attr == 0:
                dim = False
            elif attr == 2:
                dim = True
            elif attr == 22:
                dim = False
        self.cursor.attrs = self.cursor.attrs._replace(dim=dim)

    def _clear_wide_cell_at(self, row: int, column: int) -> None:
        """Erase both pyte cells of the wide glyph under either cursor half."""
        if not (0 <= row < self.lines and 0 <= column < self.columns):
            return
        cell = self.buffer[row][column]
        if cell.data == "" and column and wcwidth(self.buffer[row][column - 1].data) == 2:
            self.buffer[row][column - 1] = self.default_char
            self.buffer[row][column] = self.default_char
        elif cell.data and wcwidth(cell.data) == 2 and column + 1 < self.columns and self.buffer[row][column + 1].data == "":
            self.buffer[row][column] = self.default_char
            self.buffer[row][column + 1] = self.default_char

    def draw(self, data: str) -> None:
        # pyte represents a wide glyph as a leading character plus an empty continuation cell. Clear every
        # pair intersecting the next draw's actual destination span, after prior characters have wrapped or
        # scrolled. Processing a full PTY chunk in one speculative prepass is wrong at a bottom-row pending
        # wrap: the first next character scrolls the old row away, so its wide cells are not destinations.
        if pyte_modes.IRM in self.mode:
            super().draw(data)
            return
        for char in data:
            width = wcwidth(char)
            destination = None
            if width > 0:
                x, y = self.cursor.x, self.cursor.y
                if x == self.columns:
                    if pyte_modes.DECAWM in self.mode:
                        # pyte's next draw first wraps. At the bottom margin it also scrolls, yielding a
                        # blank destination, whereas above it the next row is an overwrite destination.
                        bottom = self.margins.bottom if self.margins is not None else self.lines - 1
                        if y < bottom:
                            destination = y + 1, 0
                    else:
                        # With autowrap disabled, pyte backs up by the incoming character width instead.
                        destination = y, x - width
                else:
                    destination = y, x
                if destination is not None:
                    row, column = destination
                    for covered in range(column, min(column + width, self.columns)):
                        self._clear_wide_cell_at(row, covered)
            super().draw(char)

    def dim_at(self, row: int, column: int) -> bool:
        return self.buffer[row][column].dim


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


def has_visible_content(screen) -> bool:
    return any(screen.buffer[row][column].data not in ("", " ") for row in range(screen.lines) for column in range(screen.columns))


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--script", required=True, help="path to a .keys file")
    p.add_argument("--out", required=True, help="directory to write NN-<name>.ansi frames into")
    p.add_argument("--bin", default=None, help="command to exec as the child; omit to run our own binary")
    p.add_argument("--cwd", required=True, help="working directory for the child (the TUI's --cwd or process cwd)")
    p.add_argument("--cols", type=int, default=100)
    p.add_argument("--rows", type=int, default=40)
    p.add_argument("--redact-masks", default=None, help="mask file required when writing under test/fixtures/upstream-frames")
    return p.parse_args()


def nearest_existing_canonical_ancestor(path: str) -> Path:
    candidate = canonical_path(path).parent
    while not candidate.exists():
        parent = candidate.parent
        if parent == candidate:
            raise ValueError(f"no existing ancestor for output path {path!r}")
        candidate = parent
    if not candidate.is_dir():
        raise ValueError(f"output ancestor is not a directory: {candidate}")
    return candidate


def main() -> int:
    args = parse_args()
    root = os.getcwd()
    entry = os.path.join(root, "src", "cli", "bin.ts")
    if not args.bin and not os.path.exists(entry):
        sys.exit(f"run me from harness/ — {entry} not found")

    with open(args.script, encoding="utf-8") as f:
        script_lines = [ln.rstrip("\n") for ln in f if ln.strip() and not ln.strip().startswith("#")]

    expected_frames = [line for line in script_lines if line.startswith("frame:")]
    try:
        tracked_relative = tracked_fixture_relative(args.out)
    except ValueError as error:
        sys.stderr.write(f"capture-frames: {error}\n")
        return 2
    if tracked_relative is not None and args.redact_masks is None:
        sys.stderr.write("capture-frames: tracked golden output requires --redact-masks\n")
        return 2
    redactions: dict[str, RedactionContract] = {}
    if args.redact_masks is not None:
        try:
            for seq, line in enumerate(expected_frames, 1):
                name = f"{seq:02d}-{line.partition(':')[2]}.ansi"
                redactions[name] = load_redaction_contract(args.redact_masks, frame_key(args.out, name))
        except (OSError, ValueError, KeyError, re.error) as error:
            sys.stderr.write(f"capture-frames: invalid redaction masks: {error}\n")
            return 2
    if tracked_relative is not None:
        missing = [frame_key(args.out, name) for name, contract in redactions.items() if not contract.declared]
        if missing:
            sys.stderr.write(f"capture-frames: tracked golden output has no redaction contract for: {', '.join(missing)}\n")
            return 2

    try:
        stage_dir = tempfile.mkdtemp(prefix=".capture-", dir=nearest_existing_canonical_ancestor(args.out))
    except (OSError, ValueError) as error:
        sys.stderr.write(f"capture-frames: cannot stage output: {error}\n")
        return 2

    screen = DimScreen(args.cols, args.rows)
    stream = pyte.ByteStream(screen)
    seen_meaningful_screen = False

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
        nonlocal seen_meaningful_screen
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
            stream.feed(data)
            seen_meaningful_screen = seen_meaningful_screen or has_visible_content(screen)
        readable, _, _ = select.select([fd], [], [], 0)
        if readable:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return False
            if not data:
                return False
            stream.feed(data)
            seen_meaningful_screen = seen_meaningful_screen or has_visible_content(screen)
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done == pid:
                return False
        except ChildProcessError:
            return False
        return True

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
                # A zero-wait frame can race an immediately-exiting child. Settle only long enough to observe
                # pty EOF/waitpid, then require that this live capture has rendered at least one real cell.
                if not pump(0.02):
                    fail(f"pty closed before {line!r}")
                    break
                if not seen_meaningful_screen:
                    fail(f"no rendered screen state before {line!r}")
                    break
                seq += 1
                out_name = f"{seq:02d}-{value}.ansi"
                rendered = render_screen(screen)
                if args.redact_masks is not None:
                    rendered, coverage_failures = redact_text(rendered, redactions[out_name])
                    if coverage_failures:
                        fail(f"redaction coverage failed for {frame_key(args.out, out_name)}: {', '.join(coverage_failures)}")
                        break
                try:
                    with open(os.path.join(stage_dir, out_name), "w", encoding="utf-8") as fh:
                        fh.write(rendered)
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
    if failed:
        shutil.rmtree(stage_dir, ignore_errors=True)
        return 1
    try:
        os.makedirs(args.out, exist_ok=True)
        for out_name in frames_written:
            os.replace(os.path.join(stage_dir, out_name), os.path.join(args.out, out_name))
        for stale in Path(args.out).glob("*.ansi"):
            if stale.name not in frames_written:
                stale.unlink()
    except OSError as error:
        # A validation failure never touches the destination. A crash during this portable merge can leave
        # stale frames, but cannot publish an unvalidated one; the next successful capture converges the set.
        sys.stderr.write(f"capture-frames: frame publication failed: {error}\n")
        shutil.rmtree(stage_dir, ignore_errors=True)
        return 1
    shutil.rmtree(stage_dir)
    sys.stderr.write(f"capture-frames: wrote {len(frames_written)} frame(s) to {args.out}: {frames_written}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
