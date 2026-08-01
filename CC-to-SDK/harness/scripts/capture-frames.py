#!/usr/bin/env python3
r"""Capture ANSI screen frames from a TUI binary under a pty — the fidelity program's instrument.

Feeds a .keys script to the child and, at each `frame:<name>` line, renders everything received so far
through pyte (a VT100 emulator) and writes the CURRENT SCREEN as NN-<name>.ansi: one line per row,
with minimal SGR sequences reconstructed from per-cell attributes. Frames are screen STATES, not raw
streams — raw pty output is not comparable across binaries (repaint strategies differ); the emulated
grid is.

Setup (once, PEP 668 blocks a bare pip on this machine):
    python3 -m venv "$CLAUDE_JOB_DIR/tmp/frame-python-venv" && "$CLAUDE_JOB_DIR/tmp/frame-python-venv/bin/pip" install -r scripts/frames/requirements.txt
Run every invocation of this script with that interpreter: "$CLAUDE_JOB_DIR/tmp/frame-python-venv/bin/python3".

Key-script grammar (one action per line, # comments and blank lines ignored):
    wait:<seconds>      sleep while pumping output
    wait-output:<text>  wait for a raw pty marker emitted after this action begins
    type:<text>         write text verbatim (no Enter)
    enter               write \r
    key:<name>          esc | tab | up | down | ctrl-<letter> | a raw \xNN escape
    frame:<name>        snapshot the screen now

Usage (from harness/):
    "$CLAUDE_JOB_DIR/tmp/frame-python-venv/bin/python3" scripts/capture-frames.py \
        --script scripts/frames/help-overlay.keys \
        --out test/fixtures/upstream-frames/help-overlay --bin "claude" --cwd "/tmp/frame-scratch" \
        --cols 100 --rows 40 --redact-masks scripts/frames/masks.json \
        --expected-version "2.1.220 (Claude Code)"
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
import subprocess
import signal
import struct
import sys
import tempfile
import termios
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from frame_masks import (
    RedactionContract,
    RequiredStateContract,
    canonical_path,
    frame_key,
    load_redaction_contract,
    load_required_state_contract,
    preprocess_frame_for_publication,
    redact_text,
    tracked_fixture_relative,
    validate_required_state,
)

try:
    import pyte
    from pyte import graphics as pyte_graphics
    from pyte import modes as pyte_modes
    from wcwidth import wcwidth
except ImportError:
    sys.exit(
        "pyte not installed — run: python3 -m venv \"$CLAUDE_JOB_DIR/tmp/frame-python-venv\" "
        "&& \"$CLAUDE_JOB_DIR/tmp/frame-python-venv/bin/pip\" install -r scripts/frames/requirements.txt"
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
# one var untracked scratch capture may use to authenticate. All ANTHROPIC_* variables stay out: their
# credentials, profile, base URL, headers, and model overrides would supersede or perturb OAuth capture.
KEEP_CLAUDE_ENV = {"CLAUDE_CODE_OAUTH_TOKEN"}
RECOGNIZED_AUTH_ENV = {"CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"}
# Tracked ANSI goldens need the renderer's truecolor branch independently of the invoking terminal.
TRACKED_TERMINAL_ENV = {"COLORTERM": "truecolor"}
TRACKED_TERMINAL_UNSET = {
    "FORCE_COLOR", "NO_COLOR", "CI", "TF_BUILD", "AGENT_NAME", "GITHUB_ACTIONS", "GITEA_ACTIONS",
    "CIRCLECI", "TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE", "CI_NAME",
    "TEAMCITY_VERSION", "TMUX", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORFGBG",
}
ONBOARDING_COMPLETE_CONFIG = '{"hasCompletedOnboarding":true}\n'
# One second absorbs scheduler pressure before the first rendered cell; later frames use a 20 ms drain.
FIRST_FRAME_READY_SECONDS = 1.0
# Once visible output arrives, drain a just-closing PTY before publishing a first frame.
FIRST_FRAME_EXIT_DRAIN_SECONDS = 0.05
# Every later snapshot also drains a bounded 20 ms repaint tail; this preserves the former per-frame settle.
SNAPSHOT_DRAIN_SECONDS = 0.02
# forkpty returns before its child has necessarily made itself the session/process-group leader.
PROCESS_GROUP_READY_SECONDS = 0.2
PROCESS_GROUP_POLL_SECONDS = 0.005


def clean_child_env(tracked_fixture: bool) -> dict[str, str]:
    env = {
        name: value for name, value in os.environ.items()
        if name in KEEP_CLAUDE_ENV or (
            not name.startswith("CLAUDE")
            and not name.startswith("ANTHROPIC_")
            and name != "AI_AGENT"
        )
    }
    if tracked_fixture:
        for name in RECOGNIZED_AUTH_ENV | TRACKED_TERMINAL_UNSET:
            env.pop(name, None)
        env.update(TRACKED_TERMINAL_ENV)
    return env


def capture_temp_dir() -> str | None:
    job_dir = os.environ.get("CLAUDE_JOB_DIR")
    if not job_dir:
        return None
    path = Path(job_dir) / "tmp"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def terminate_captured_process_group(pid: int) -> None:
    if pid <= 0 or pid == os.getpid() or pid == os.getpgrp():
        return
    group_terminated = False
    deadline = time.monotonic() + PROCESS_GROUP_READY_SECONDS
    while time.monotonic() < deadline:
        try:
            os.killpg(pid, signal.SIGKILL)
            group_terminated = True
            break
        except (ProcessLookupError, OSError):
            time.sleep(PROCESS_GROUP_POLL_SECONDS)
    if not group_terminated:
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass

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
                        # pyte's next draw first wraps. y == bottom scrolls to a blank bottom row; above
                        # it the next row is an overwrite destination; below a partial region cursor_down()
                        # clamps back up to bottom, which can overwrite a pre-existing wide cell there.
                        bottom = self.margins.bottom if self.margins is not None else self.lines - 1
                        if y < bottom:
                            destination = y + 1, 0
                        elif y > bottom:
                            destination = bottom, 0
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
    p.add_argument("--expected-version", default=None, help="exact --version output required for tracked golden captures")
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


def validate_tracked_child_version(command: str | None, expected_version: str | None, cwd: str) -> str | None:
    if not expected_version:
        return "tracked golden output requires --expected-version"
    if not command:
        return "tracked golden output requires --bin so its version can be verified"
    try:
        argv = shlex.split(command)
    except ValueError as error:
        return f"invalid --bin command for version check: {error}"
    if not argv:
        return "tracked golden output requires a nonempty --bin command"
    try:
        version = subprocess.run([argv[0], "--version"], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    except OSError as error:
        return f"version check failed: {error}"
    if version.returncode:
        return f"version check failed with exit status {version.returncode}"
    actual_version = version.stdout.strip() or version.stderr.strip()
    if actual_version != expected_version:
        return f"version mismatch: expected {expected_version!r}, got {actual_version!r}"
    return None


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
    required_states: dict[str, RequiredStateContract] = {}
    if args.redact_masks is not None:
        try:
            for seq, line in enumerate(expected_frames, 1):
                name = f"{seq:02d}-{line.partition(':')[2]}.ansi"
                key = frame_key(args.out, name)
                redactions[name] = load_redaction_contract(args.redact_masks, key)
                if tracked_relative is not None:
                    required_states[name] = load_required_state_contract(args.redact_masks, key)
        except (OSError, ValueError, KeyError, re.error) as error:
            sys.stderr.write(f"capture-frames: invalid redaction masks: {error}\n")
            return 2
    if tracked_relative is not None:
        missing = [frame_key(args.out, name) for name, contract in redactions.items() if not contract.declared]
        if missing:
            sys.stderr.write(f"capture-frames: tracked golden output has no redaction contract for: {', '.join(missing)}\n")
            return 2
        version_error = validate_tracked_child_version(args.bin, args.expected_version, args.cwd)
        if version_error:
            sys.stderr.write(f"capture-frames: {version_error}\n")
            return 2
        missing_state = [frame_key(args.out, name) for name, contract in required_states.items() if not contract.required]
        if missing_state:
            sys.stderr.write(f"capture-frames: tracked golden output has no required state contract for: {', '.join(missing_state)}\n")
            return 2

    try:
        stage_dir = tempfile.mkdtemp(prefix=".capture-", dir=nearest_existing_canonical_ancestor(args.out))
    except (OSError, ValueError) as error:
        sys.stderr.write(f"capture-frames: cannot stage output: {error}\n")
        return 2

    screen = DimScreen(args.cols, args.rows)
    stream = pyte.ByteStream(screen)
    seen_meaningful_screen = False

    config_dir: str | None = None
    try:
        child_env = clean_child_env(tracked_relative is not None)
        config_dir = tempfile.mkdtemp(prefix=".claude-config-", dir=capture_temp_dir())
        (Path(config_dir) / ".claude.json").write_text(ONBOARDING_COMPLETE_CONFIG, encoding="utf-8")
        child_env["CLAUDE_CONFIG_DIR"] = config_dir
        child_env["TERM"] = "xterm-256color"
    except OSError as error:
        sys.stderr.write(f"capture-frames: cannot create isolated Claude config: {error}\n")
        if config_dir is not None:
            shutil.rmtree(config_dir, ignore_errors=True)
        shutil.rmtree(stage_dir, ignore_errors=True)
        return 2

    try:
        pid, fd = pty.fork()
    except OSError as error:
        sys.stderr.write(f"capture-frames: cannot start capture child: {error}\n")
        shutil.rmtree(config_dir, ignore_errors=True)
        shutil.rmtree(stage_dir, ignore_errors=True)
        return 1
    if pid == 0:
        os.environ.clear()
        os.environ.update(child_env)
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
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))
    except OSError as error:
        sys.stderr.write(f"capture-frames: cannot initialize capture terminal: {error}\n")
        terminate_captured_process_group(pid)
        try:
            os.close(fd)
        except OSError:
            pass
        shutil.rmtree(config_dir, ignore_errors=True)
        shutil.rmtree(stage_dir, ignore_errors=True)
        return 1

    def pump(seconds: float, until_content: bool = False, until_output: bytes | None = None, output_generation: bytearray | None = None) -> bool:
        """Collect output for `seconds`; False means the child closed the pty before the script finished."""
        nonlocal seen_meaningful_screen
        end = time.monotonic() + seconds
        read_size = 4096 if until_output is not None else 65536
        while time.monotonic() < end:
            readable, _, _ = select.select([fd], [], [], min(0.2, max(0, end - time.monotonic())))
            if not readable:
                continue
            try:
                data = os.read(fd, read_size)
            except OSError:
                return False
            if not data:
                return False
            if output_generation is not None:
                output_generation[:] = (output_generation + data)[-65536:]
            stream.feed(data)
            seen_meaningful_screen = seen_meaningful_screen or has_visible_content(screen)
            if until_output is not None and output_generation is not None and until_output in output_generation:
                return True
            if until_content and seen_meaningful_screen:
                return pump(FIRST_FRAME_EXIT_DRAIN_SECONDS)
        readable, _, _ = select.select([fd], [], [], 0)
        if readable:
            try:
                data = os.read(fd, read_size)
            except OSError:
                return False
            if not data:
                return False
            if output_generation is not None:
                output_generation[:] = (output_generation + data)[-65536:]
            stream.feed(data)
            seen_meaningful_screen = seen_meaningful_screen or has_visible_content(screen)
            if until_output is not None and output_generation is not None and until_output in output_generation:
                return True
            if until_content and seen_meaningful_screen:
                return pump(FIRST_FRAME_EXIT_DRAIN_SECONDS)
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
            elif action == "wait-output":
                marker = value.encode()
                if not marker:
                    fail("wait-output requires a nonempty marker")
                    break
                output_generation = bytearray()
                if not pump(FIRST_FRAME_READY_SECONDS, until_output=marker, output_generation=output_generation) or marker not in output_generation:
                    fail("wait-output marker not received")
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
                # The first zero-wait frame may arrive before a live child gets scheduled. Wait only until a
                # visible cell or child death; established screens still get a bounded repaint-tail drain.
                settle = FIRST_FRAME_READY_SECONDS if not seen_meaningful_screen else SNAPSHOT_DRAIN_SECONDS
                if not pump(settle, until_content=not seen_meaningful_screen):
                    fail(f"pty closed before {line!r}")
                    break
                if not seen_meaningful_screen:
                    fail(f"no rendered screen state before {line!r}")
                    break
                seq += 1
                out_name = f"{seq:02d}-{value}.ansi"
                rendered = render_screen(screen)
                state_failures = []
                if tracked_relative is not None:
                    state_failures = validate_required_state(rendered, required_states[out_name])
                    if state_failures:
                        fail(f"state validation failed for {frame_key(args.out, out_name)}: {', '.join(state_failures)}")
                coverage_failures = []
                if args.redact_masks is not None:
                    rendered, coverage_failures = preprocess_frame_for_publication(rendered, redactions[out_name])
                    if coverage_failures:
                        fail(f"redaction coverage failed for {frame_key(args.out, out_name)}: {', '.join(coverage_failures)}")
                if state_failures or coverage_failures:
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
        terminate_captured_process_group(pid)
        try:
            os.close(fd)
        except OSError:
            pass
        shutil.rmtree(config_dir, ignore_errors=True)

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
