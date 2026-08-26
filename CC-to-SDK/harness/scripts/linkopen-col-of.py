#!/usr/bin/env python3
"""scripts/linkopen-col-of.py — bl5 T-LINKOPEN task 4's terminal-column locator.

`tmux capture-pane -p` prints the pane's VISIBLE text (no SGR/OSC bytes at all — verified live: an OSC 8
hyperlink around a label contributes its wrapped text and nothing else, so a link's plain-capture position
is the label's own position). A naive `awk index()` byte or character offset still misreads a row's real
SGR mouse COLUMN whenever a wide glyph sits before the target: this build's own `⏺` assistant-message bullet
(U+23FA) measures live as ONE Python string character but TWO real terminal columns (matching this repo's
established `select-pty.sh`/`hover-cells.sh` finding for other wide glyphs, e.g. `❯`) — a per-character
count would place every later click one column short. This walks the line char by char, crediting `⏺` (and
any other East-Asian-wide/fullwidth codepoint, `unicodedata.east_asian_width` in {"W","F"}) two columns and
everything else one, to land on the SAME 1-based column an SGR mouse report needs.

Usage: linkopen-col-of.py <captured-plain-text-file> <needle> [char-offset-into-needle]
Prints "<col> <row>" (both 1-based, row counting from the top of the capture) for the FIRST line
containing `needle`, or exits 1 with "NOTFOUND" on stderr. `char-offset-into-needle` (default 0) shifts the
returned column further into the needle — e.g. offset 2 lands solidly inside a short link label rather than
on its very first (edge) cell, which is deliberately how every caller in this file's sibling driver uses it.
"""
import sys
import unicodedata


def width(ch: str) -> int:
    if ch == "⏺":
        return 2
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    path, needle = sys.argv[1], sys.argv[2]
    offset = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.read().split("\n")
    for i, line in enumerate(lines, start=1):
        idx = line.find(needle)
        if idx == -1:
            continue
        col = 1
        for ch in line[:idx]:
            col += width(ch)
        print(f"{col + offset} {i}")
        return
    print("NOTFOUND", file=sys.stderr)
    sys.exit(1)


main()
