import fcntl
import importlib.util
import os
import pty
import re
import select
import signal
import struct
import sys
import tempfile
import termios
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAPTURE_PATH = ROOT / "scripts" / "capture-frames.py"
ENTRY_PATH = ROOT / "test" / "fixtures" / "suspend-entry.tsx"
CURSOR_HIDE = b"\x1b[?25l"
CURSOR_SHOW = b"\x1b[?25h"
SHELL_PROMPT = b"__CCX_SHELL_PROMPT__ "
TUI_READY = b"__CCX_TUI_READY__"
INPUT_READY = b"__CCX_INPUT_READY__"
SHELL_MARKER = b"__CCX_SHELL_MARKER__"


def load_capture():
    spec = importlib.util.spec_from_file_location("suspend_capture", CAPTURE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


capture = load_capture()


class SuspendPtyTest(unittest.TestCase):
    def test_ctrl_z_shell_output_fg_preserves_screen_and_cursor_lifecycle(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            home, config, tmp = root / "home", root / "config", root / "tmp"
            home.mkdir(); config.mkdir(); tmp.mkdir()
            env = {
                "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(tmp),
                "CLAUDE_CONFIG_DIR": str(config), "TERM": "xterm-256color", "COLORTERM": "truecolor",
                "COLUMNS": "100", "LINES": "40", "LANG": os.environ.get("LANG", "C.UTF-8"),
            }
            pid, fd = pty.fork()
            if pid == 0:
                os.chdir(ROOT)
                os.environ.clear(); os.environ.update(env)
                os.execvpe("/bin/bash", ["bash", "--noprofile", "--norc", "-i"], env)

            raw = bytearray()
            tui_pgrp = None
            try:
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))

                def pump_until(marker: bytes, occurrences: int = 1, timeout: float = 10, after: int = 0) -> None:
                    deadline = time.monotonic() + timeout
                    while time.monotonic() < deadline:
                        if bytes(raw[after:]).count(marker) >= occurrences:
                            return
                        readable, _, _ = select.select([fd], [], [], 0.1)
                        if not readable:
                            continue
                        try:
                            chunk = os.read(fd, 65536)
                        except OSError as error:
                            self.fail(f"pty closed waiting for marker: {error}")
                        if not chunk:
                            self.fail("pty closed waiting for marker")
                        raw.extend(chunk)
                    self.fail(f"timed out waiting for marker count {occurrences}")

                os.write(fd, b"PS1='__CCX_SHELL_PROMPT__ '; set -m\r")
                pump_until(SHELL_PROMPT, 2)
                os.write(fd, f"node --import tsx {ENTRY_PATH}\r".encode())
                pump_until(TUI_READY)
                pump_until(INPUT_READY)
                tui_pgrp = os.tcgetpgrp(fd)

                before_suspend = len(raw)
                os.write(fd, b"\x1a")
                pump_until(SHELL_PROMPT, after=before_suspend)
                suspended = bytes(raw[before_suspend:])
                cursor_show = suspended.find(CURSOR_SHOW)
                self.assertNotEqual(cursor_show, -1)
                self.assertLess(cursor_show, suspended.find(SHELL_PROMPT))

                marker_start = len(raw)
                os.write(fd, b"printf '__CCX_SHELL_MARKER__\\n'\r")
                pump_until(SHELL_MARKER, 2, after=marker_start)
                before_fg = len(raw)
                os.write(fd, b"fg\r")
                pump_until(TUI_READY, after=before_fg)
                resumed = bytes(raw[before_fg:])
                cursor_hide = resumed.find(CURSOR_HIDE)
                self.assertNotEqual(cursor_hide, -1)
                self.assertLess(cursor_hide, resumed.find(TUI_READY))

                screen = capture.DimScreen(100, 40)
                capture.pyte.ByteStream(screen).feed(bytes(raw))
                visible = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", capture.render_screen(screen))
                self.assertIn(SHELL_MARKER.decode(), visible)

                exit_start = len(raw)
                os.write(fd, b"\x04")
                pump_until(SHELL_PROMPT, after=exit_start)
                self.assertIn(CURSOR_SHOW, bytes(raw[before_fg:]))
                os.write(fd, b"exit\r")
            finally:
                for group in (tui_pgrp, pid):
                    if group and group != os.getpgrp():
                        try:
                            os.killpg(group, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    try:
                        reaped, _ = os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        break
                    if reaped == pid:
                        break
                    time.sleep(0.01)
                os.close(fd)


if __name__ == "__main__":
    unittest.main()
