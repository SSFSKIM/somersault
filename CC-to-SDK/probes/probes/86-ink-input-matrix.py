#!/usr/bin/env python3
r"""P86 — Ink input capability matrix, measured live under a pty.

Question (gates wave F2, the declarative keymap): which key/input events can Ink 5's input layer
actually deliver to a `useInput` handler, and in what shape? Declared != reachable, so this feeds
real byte sequences into a real pty and reads back exactly what Ink handed the handler.

What it does: pty.fork() -> spawn `86-ink-input-child.tsx` under harness/node_modules/.bin/tsx with
TERM=xterm-256color, wait for its READY marker, then write each labelled sequence ONE AT A TIME with
a ~150 ms gap, draining the pty continuously so the child never blocks. Afterwards it replays the
append-ordered JSONL log to pair each fed sequence with the resulting useInput/raw-tap events, and
greps everything the child wrote to the pty for the terminal modes Ink enables on its own
(?2004h bracketed paste, ?1000h/?1006h mouse, ?1004h focus reporting).

No network, no SDK, no credentials.

Rerun (single command, from anywhere):
    python3 /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/86-ink-input-matrix.py

Options: --log <path> (JSONL destination; default a temp file), --json (machine-readable dump).
"""
import argparse
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CC_TO_SDK = HERE.parent.parent
HARNESS = CC_TO_SDK / "harness"
CHILD = HERE / "86-ink-input-child.tsx"
TSX = HARNESS / "node_modules" / ".bin" / "tsx"

COLS, ROWS = 100, 30
GAP = 0.15           # silence after each fed sequence
READY_TIMEOUT = 30.0

# (label, bytes, gap_override) — gap_override None means GAP.
MATRIX: list[tuple[str, bytes, float | None]] = [
    # --- navigation ---
    ("home CSI-H            ", b"\x1b[H", None),
    ("home SS3-H            ", b"\x1bOH", None),
    ("home CSI-1~           ", b"\x1b[1~", None),
    ("end CSI-F             ", b"\x1b[F", None),
    ("end SS3-F             ", b"\x1bOF", None),
    ("end CSI-4~            ", b"\x1b[4~", None),
    ("pageup                ", b"\x1b[5~", None),
    ("pagedown              ", b"\x1b[6~", None),
    ("insert                ", b"\x1b[2~", None),
    ("delete                ", b"\x1b[3~", None),
    # --- modified navigation ---
    ("ctrl+up               ", b"\x1b[1;5A", None),
    ("ctrl+down             ", b"\x1b[1;5B", None),
    ("shift+up              ", b"\x1b[1;2A", None),
    ("shift+down            ", b"\x1b[1;2B", None),
    ("shift+right           ", b"\x1b[1;2C", None),
    ("shift+left            ", b"\x1b[1;2D", None),
    ("alt+up                ", b"\x1b[1;3A", None),
    ("meta+up (iTerm 1;9)   ", b"\x1b[1;9A", None),
    ("ctrl+home             ", b"\x1b[1;5H", None),
    ("ctrl+end              ", b"\x1b[1;5F", None),
    ("shift+home            ", b"\x1b[1;2H", None),
    ("shift+end             ", b"\x1b[1;2F", None),
    # --- tab ---
    ("tab                   ", b"\t", None),
    ("shift+tab             ", b"\x1b[Z", None),
    # --- enter forms ---
    ("return CR             ", b"\r", None),
    ("enter LF              ", b"\n", None),
    ("ESC-CR (shift+enter)  ", b"\x1b\r", None),
    ("CSI-u shift+enter     ", b"\x1b[13;2u", None),
    ("CSI-u ctrl+enter      ", b"\x1b[13;5u", None),
    # --- control edge cases ---
    ("ctrl+_ / ctrl+- (0x1f)", b"\x1f", None),
    ("ctrl+space (0x00)     ", b"\x00", None),
    ("ctrl+h (0x08)         ", b"\x08", None),
    ("backspace (0x7f)      ", b"\x7f", None),
    ("ctrl+z (0x1a)         ", b"\x1a", None),
    # --- alt/meta letters (ESC prefix) ---
    ("alt+d                 ", b"\x1bd", None),
    ("meta+p                ", b"\x1bp", None),
    ("meta+t                ", b"\x1bt", None),
    ("meta+o                ", b"\x1bo", None),
    ("meta+w                ", b"\x1bw", None),
    ("alt+b                 ", b"\x1bb", None),
    ("alt+f                 ", b"\x1bf", None),
    ("alt+y                 ", b"\x1by", None),
    ("alt+v                 ", b"\x1bv", None),
    ("meta+m                ", b"\x1bm", None),
    ("alt+backspace         ", b"\x1b\x7f", None),
    # --- CSI-u chords (kitty/iTerm2) ---
    ("CSI-u ctrl+shift+b    ", b"\x1b[98;6u", None),
    ("CSI-u super+k (cmd+k) ", b"\x1b[107;9u", None),
    ("CSI-u super+p         ", b"\x1b[112;9u", None),
    # --- mouse ---
    ("SGR wheel-up          ", b"\x1b[<64;10;10M", None),
    ("SGR wheel-down        ", b"\x1b[<65;10;10M", None),
    ("SGR left-press        ", b"\x1b[<0;10;10M", None),
    ("SGR left-release      ", b"\x1b[<0;10;10m", None),
    ("X10 mouse report      ", b"\x1b[M\x20\x2a\x2a", None),
    # --- focus events ---
    ("focus-in              ", b"\x1b[I", None),
    ("focus-out             ", b"\x1b[O", None),
    # --- bracketed paste (ONE write) ---
    ("bracketed paste       ", b"\x1b[200~hello\nworld\x1b[201~", 0.4),
    # --- timing / chunking ---
    ("bare ESC + 500ms      ", b"\x1b", 0.5),
    ("torn CSI part 1 (ESC) ", b"\x1b", 0.05),
    ("torn CSI part 2 ([5~) ", b"[5~", None),
    ("3-byte write 'abc'    ", b"abc", None),
]

MODE_PATTERNS = {
    "?2004h bracketed paste ON": rb"\x1b\[\?2004h",
    "?2004l bracketed paste OFF": rb"\x1b\[\?2004l",
    "?1000h mouse (normal) ON": rb"\x1b\[\?1000h",
    "?1002h mouse (btn-event) ON": rb"\x1b\[\?1002h",
    "?1003h mouse (any-event) ON": rb"\x1b\[\?1003h",
    "?1006h mouse SGR ON": rb"\x1b\[\?1006h",
    "?1015h mouse urxvt ON": rb"\x1b\[\?1015h",
    "?1004h focus reporting ON": rb"\x1b\[\?1004h",
    "?1049h alt screen ON": rb"\x1b\[\?1049h",
    "?25l cursor hide": rb"\x1b\[\?25l",
    "?25h cursor show": rb"\x1b\[\?25h",
}


def esc(b: bytes | str) -> str:
    s = b.decode("utf8", "replace") if isinstance(b, bytes) else b
    return json.dumps(s)


def set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=None, help="JSONL log path (default: temp file)")
    ap.add_argument("--json", action="store_true", help="also dump machine-readable JSON")
    ap.add_argument("--term", default="xterm-256color", help="TERM for the child (input decoding should be terminfo-independent)")
    args = ap.parse_args()

    if not TSX.exists():
        print(f"FAIL: tsx not found at {TSX}", file=sys.stderr)
        return 2

    log_path = Path(args.log) if args.log else Path(tempfile.mkstemp(prefix="p86-", suffix=".jsonl")[1])
    log_path.write_text("")

    env = dict(os.environ)
    env.update({
        "TERM": args.term,
        "COLORTERM": "truecolor",
        "P86_LOG": str(log_path),
        "NO_COLOR": "",
    })
    env.pop("CI", None)

    pid, master = pty.fork()
    if pid == 0:
        os.chdir(HARNESS)
        try:
            os.execve(str(TSX), [str(TSX), str(CHILD)], env)
        except Exception as exc:  # pragma: no cover
            os.write(2, f"exec failed: {exc}\n".encode())
        os._exit(127)

    set_winsize(master, ROWS, COLS)
    out = bytearray()

    def pump(seconds: float) -> None:
        deadline = time.time() + seconds
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            r, _, _ = select.select([master], [], [], min(remaining, 0.05))
            if r:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    return
                if not chunk:
                    return
                out.extend(chunk)

    # 1. wait for mount
    ready_deadline = time.time() + READY_TIMEOUT
    while b"P86 READY" not in out and time.time() < ready_deadline:
        pump(0.1)
    ready = b"P86 READY" in out
    if not ready:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        print("FAIL: child never printed READY marker. pty output follows:", file=sys.stderr)
        print(out.decode("utf8", "replace"), file=sys.stderr)
        return 2
    pump(0.3)  # let the raw tap register

    # 2. feed the matrix, one sequence at a time, marking the log as we go
    with log_path.open("a") as lf:
        for label, seq, gap in MATRIX:
            lf.write(json.dumps({"kind": "feed", "label": label.strip(), "bytes": seq.decode("utf8", "replace")}) + "\n")
            lf.flush()
            os.write(master, seq)
            pump(gap if gap is not None else GAP)
        lf.write(json.dumps({"kind": "feed", "label": "__end__", "bytes": ""}) + "\n")
        lf.flush()
    pump(0.5)

    # 3. shut the child down
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    pump(0.4)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    os.close(master)

    # 4. replay the log in append order -> pair stimulus with events
    groups: list[dict] = []
    current: dict | None = None
    rawtap_registered = False
    for line in log_path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        kind = rec.get("kind")
        if kind == "feed":
            current = {"label": rec["label"], "bytes": rec["bytes"], "events": []}
            groups.append(current)
        elif kind == "rawtap-registered":
            rawtap_registered = True
        elif current is not None:
            current["events"].append(rec)
        else:
            groups.append({"label": "(before first feed)", "bytes": "", "events": [rec]})
    groups = [g for g in groups if g["label"] != "__end__"]

    # 5. report
    print("=" * 110)
    print("P86 — Ink input capability matrix")
    print(f"  ink        : {json.loads((HARNESS / 'node_modules' / 'ink' / 'package.json').read_text())['version']}")
    node_v = subprocess.run(["node", "-v"], capture_output=True, text=True).stdout.strip()
    print(f"  node       : {node_v}")
    print(f"  TERM       : {args.term}  COLORTERM=truecolor  winsize={COLS}x{ROWS}")
    print(f"  log        : {log_path}")
    print(f"  raw tap    : {'REGISTERED' if rawtap_registered else 'NOT REGISTERED'}")
    print("=" * 110)
    print()
    for g in groups:
        ins = [e for e in g["events"] if e["kind"] == "input"]
        raws = [e for e in g["events"] if e["kind"] == "raw"]
        print(f"--- {g['label']}  fed={esc(g['bytes'])}")
        if not ins:
            print("      useInput: (none)")
        for e in ins:
            k = e["key"]
            flags = ",".join(n for n, v in k.items() if v is True) or "-"
            print(f"      useInput: input={esc(e['input'])} flags=[{flags}] key={json.dumps(k, sort_keys=True)}")
        if not raws:
            print("      raw tap : (none)")
        for e in raws:
            print(f"      raw tap : {esc(e['raw'])} parsed={json.dumps(e.get('parsed'), sort_keys=True)}")
        print()

    print("=" * 110)
    print("Terminal modes Ink emitted on its own (grep over everything the child wrote to the pty):")
    for name, pat in MODE_PATTERNS.items():
        hits = len(re.findall(pat, bytes(out)))
        print(f"  {'YES' if hits else 'no ':>3}  {name}" + (f"  x{hits}" if hits else ""))
    print(f"  (total pty bytes captured: {len(out)})")
    print("=" * 110)

    if args.json:
        print()
        print(json.dumps({"groups": groups, "rawtap_registered": rawtap_registered}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
