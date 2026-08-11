#!/usr/bin/env python3
r"""P86b — can an Ink app take input from `useStdin()` directly, with no `useInput` anywhere?

Follow-up to P86 (`86-ink-input-matrix.py`). P86 proved Ink's `useInput` flattens every key onto a
fixed 14-boolean record, collapsing home/end/insert (and ctrl+home/ctrl+end, and shift+home/shift+end)
into indistinguishable events. That makes the obvious question for wave F2: can we skip `useInput`
entirely and consume `useStdin().stdin` at the root?

This settles it live, plus the rest of P86 §5's "not determined" list:
  (a) do bytes arrive verbatim on a `useStdin()` data listener, or is the single leading-ESC strip
      P86 saw a `useInput`-layer effect only?
  (b) do chunk boundaries match writes?
  (c) does Ink still exit on ctrl+C with zero `useInput` hooks, and does `exitOnCtrlC:false` stop it?
      (i.e. does Ink keep its own internal input listener regardless?)
  (d) does rendering still work normally, with no focus-manager interference?
  (e) does Ink restore termios on unmount? (tcgetattr on the pty master, before / during / after)
  plus: can non-UTF-8 bytes (X10 mouse coordinates > 127) be recovered after Ink forces
      `stdin.setEncoding('utf8')`, and does `useFocus` change the tab/shift+tab events `useInput` sees?

Runs five child configurations back to back and prints one report per configuration:
    A  useStdin raw consumer, exitOnCtrlC=true         -> (a)(b)(c-on)(d)(e)
    B  useStdin raw consumer, exitOnCtrlC=false        -> (c-off)
    C  useStdin raw consumer, encoding=latin1          -> non-UTF-8 byte recovery
    D  useFocus focusables + useInput                  -> useFocus vs tab/shift+tab
    E  DIRECT process.stdin.setRawMode, Ink never engaged, exitOnCtrlC=true
                                                       -> is Ink's ctrl+C exit / utf8 forcing /
                                                          termios restore tied to its setRawMode?

No network, no SDK, no credentials.

Rerun (single command, from anywhere):
    python3 /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/86b-ink-rawstdin-matrix.py

Options: --log-dir <dir> (where the JSONL logs land; default a temp dir).
"""
import argparse
import fcntl
import json
import os
import pty
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
HARNESS = HERE.parent.parent / "harness"
CHILD = HERE / "86b-ink-rawstdin-child.tsx"
TSX = HARNESS / "node_modules" / ".bin" / "tsx"

COLS, ROWS = 100, 30
GAP = 0.15
READY_TIMEOUT = 30.0

# The representative subset: every P86 collision case, one of each misparsed family, and the controls.
RAW_MATRIX: list[tuple[str, bytes]] = [
    ("home            ", b"\x1b[H"),
    ("end             ", b"\x1b[F"),
    ("insert          ", b"\x1b[2~"),
    ("ctrl+home       ", b"\x1b[1;5H"),
    ("ctrl+end        ", b"\x1b[1;5F"),
    ("alt+d           ", b"\x1bd"),
    ("ctrl+_ (0x1f)   ", b"\x1f"),
    ("CSI-u ctrl+sh+b ", b"\x1b[98;6u"),
    ("SGR wheel-up    ", b"\x1b[<64;10;10M"),
    ("focus-in        ", b"\x1b[I"),
    ("bracketed paste ", b"\x1b[200~ab\x1b[201~"),
    ("bare ESC        ", b"\x1b"),
    ("CR              ", b"\r"),
    ("plain text abc  ", b"abc"),
    # ctrl+C precedes the high-byte feed on purpose: a lone 0xc8 leaves an incomplete sequence in the
    # utf8 decoder, which flushes as U+FFFD prepended to the NEXT chunk. A first run had the order
    # reversed and ctrl+C arrived as "�\x03" — Ink's `input === '\x03'` test then never matched
    # and the exitOnCtrlC result was a false negative.
    ("ctrl+C (0x03)   ", b"\x03"),
    ("X10 hi-bytes    ", b"\x1b[M\x20\xc8\xc8"),   # coords > 127: the utf8 hazard
]
FOCUS_MATRIX: list[tuple[str, bytes]] = [
    ("tab             ", b"\t"),
    ("shift+tab       ", b"\x1b[Z"),
    ("tab again       ", b"\t"),
    ("ctrl+C (0x03)   ", b"\x03"),
]
QUIT = ("quit sentinel Q ", b"Q")


def esc(s: str) -> str:
    return json.dumps(s)


def lflags(attrs) -> str:
    lf = attrs[3]
    names = []
    for name in ("ICANON", "ECHO", "ISIG", "IEXTEN"):
        if lf & getattr(termios, name):
            names.append(name)
    return "|".join(names) if names else "(none)"


def run_config(label: str, mode: str, exit_on_ctrl_c: bool, encoding: str, direct: bool,
               log_path: Path) -> dict:
    log_path.write_text("")
    env = dict(os.environ)
    env.update({
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "P86B_LOG": str(log_path),
        "P86B_MODE": mode,
        "P86B_EXIT_ON_CTRL_C": "1" if exit_on_ctrl_c else "0",
        "P86B_ENCODING": encoding,
        "P86B_DIRECT": "1" if direct else "0",
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

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    termios_before = termios.tcgetattr(master)
    out = bytearray()
    result: dict = {"label": label, "mode": mode, "exitOnCtrlC": exit_on_ctrl_c,
                     "encoding": encoding or "(ink default)", "direct": direct}

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

    def alive() -> bool:
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return False
        return done == 0

    deadline = time.time() + READY_TIMEOUT
    while b"P86B READY" not in out and time.time() < deadline:
        pump(0.1)
    if b"P86B READY" not in out:
        result["error"] = "child never printed READY"
        result["pty"] = out.decode("utf8", "replace")
        try:
            os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
        os.close(master)
        return result
    pump(0.3)
    result["termios_raw_active"] = lflags(termios.tcgetattr(master))

    matrix = FOCUS_MATRIX if mode == "focus" else RAW_MATRIX
    exited_at: str | None = None
    with log_path.open("a") as lf:
        for lab, seq in matrix + [QUIT]:
            if not alive():
                exited_at = exited_at or lab
                break
            lf.write(json.dumps({"kind": "feed", "label": lab.strip(),
                                 "hex": seq.hex()}) + "\n")
            lf.flush()
            try:
                os.write(master, seq)
            except OSError:
                exited_at = exited_at or lab
                break
            pump(GAP)
            if lab.startswith("ctrl+C") and not alive():
                exited_at = "ctrl+C"
                break
    pump(0.5)

    result["exited_before_quit_at"] = exited_at
    result["alive_after_matrix"] = alive()
    # give a clean unmount time to land, then read termios again
    for _ in range(20):
        if not alive():
            break
        pump(0.1)
    result["clean_exit"] = not alive()
    try:
        result["termios_after_exit"] = lflags(termios.tcgetattr(master))
    except OSError as exc:
        result["termios_after_exit"] = f"(unreadable: {exc})"
    result["termios_before"] = lflags(termios_before)

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    os.close(master)

    groups: list[dict] = []
    current: dict | None = None
    meta: list[dict] = []
    for line in log_path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("kind") == "feed":
            current = {"label": rec["label"], "hex": rec["hex"], "events": []}
            groups.append(current)
        elif rec.get("kind") in ("data", "input"):
            (current["events"] if current else meta).append(rec)
        else:
            meta.append(rec)
    result["groups"] = groups
    result["meta"] = meta
    result["pty_bytes"] = len(out)
    result["render_updates"] = out.count(b"events=")
    result["pty_tail"] = out.decode("utf8", "replace")[-300:]
    result["focus_one"] = out.count(b"[one:focused]")
    result["focus_two"] = out.count(b"[two:focused]")
    return result


def report(r: dict) -> None:
    print("=" * 110)
    print(f"CONFIG {r['label']}\n  mode={r['mode']} exitOnCtrlC={r['exitOnCtrlC']} "
          f"encoding={r['encoding']} direct={r['direct']}")
    print("=" * 110)
    if "error" in r:
        print("  ERROR:", r["error"])
        print(r.get("pty", "")[:2000])
        return
    for m in r["meta"]:
        print(f"  meta: {json.dumps(m, sort_keys=True)}")
    print(f"  termios lflags: before={r['termios_before']}  raw-active={r['termios_raw_active']}  "
          f"after-exit={r['termios_after_exit']}")
    print(f"  render updates seen in pty output: {r['render_updates']}  (pty bytes {r['pty_bytes']})")
    if r["mode"] == "focus":
        print(f"  focus frames: [one:focused] x{r['focus_one']}   [two:focused] x{r['focus_two']}")
    print(f"  exited before quit sentinel at: {r['exited_before_quit_at']}   clean_exit={r['clean_exit']}")
    print(f"  pty tail: {esc(r['pty_tail'])}")
    print()
    for g in r["groups"]:
        fed = bytes.fromhex(g["hex"])
        print(f"  --- {g['label']:<18} fed hex={g['hex']:<28} ({len(fed)} bytes)")
        if not g["events"]:
            print("        (no event)")
        for e in g["events"]:
            if e["kind"] == "data":
                same = "VERBATIM" if e["hex"] == g["hex"] else "DIFFERS"
                print(f"        data: isBuffer={e['isBuffer']} len={e['len']} hex={e['hex']} "
                      f"[{same}] text={esc(e['text'])}")
            else:
                flags = ",".join(n for n, v in e["key"].items() if v is True) or "-"
                print(f"        useInput: input={esc(e['input'])} flags=[{flags}]")
    print()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log-dir", default=None)
    args = ap.parse_args()
    if not TSX.exists():
        print(f"FAIL: tsx not found at {TSX}", file=sys.stderr)
        return 2
    log_dir = Path(args.log_dir) if args.log_dir else Path(tempfile.mkdtemp(prefix="p86b-"))
    log_dir.mkdir(parents=True, exist_ok=True)

    node_v = subprocess.run(["node", "-v"], capture_output=True, text=True).stdout.strip()
    ink_v = json.loads((HARNESS / "node_modules" / "ink" / "package.json").read_text())["version"]
    print(f"P86b — ink {ink_v} · node {node_v} · TERM=xterm-256color · winsize {COLS}x{ROWS}")
    print(f"logs: {log_dir}")
    print()

    configs = [
        # label,                                          mode,    exitOnCtrlC, encoding, direct
        ("A  useStdin raw consumer, exitOnCtrlC=true",    "raw",   True,  "",       False),
        ("B  useStdin raw consumer, exitOnCtrlC=false",   "raw",   False, "",       False),
        ("C  useStdin raw consumer, encoding=latin1",     "raw",   False, "latin1", False),
        ("D  useFocus focusables + useInput",             "focus", False, "",       False),
        ("E  DIRECT process.stdin.setRawMode (Ink never engaged), exitOnCtrlC=true",
                                                          "raw",   True,  "",       True),
    ]
    for i, (label, mode, eoc, enc, direct) in enumerate(configs):
        report(run_config(label, mode, eoc, enc, direct, log_dir / f"{i}.jsonl"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
