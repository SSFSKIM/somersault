#!/usr/bin/env python3
"""Diff two frame directories cell-for-cell after masking nondeterminism.

Run with the same interpreter used to capture (no third-party imports here, but kept uniform):
    scripts/frames/.venv/bin/python3 scripts/frame-diff.py GOLDEN_DIR OUR_DIR \
        --masks scripts/frames/masks.json [--allowlist test/fixtures/upstream-frames/allowlist.md]

masks.json: {"patterns": ["regex", ...]} — every match (applied per line, on the text with SGR
sequences intact) is replaced with the FIXED token '▒' on BOTH sides before comparison. Fixed, not
equal-length: a 3s duration versus a 12s one must mask to the same string, or the mask is useless.
(Column alignment after the mask point differs from the on-screen frame; comparison is masked-text
to masked-text, so that is fine.)

Allowlist lines look like:  <script-dir>/<frame-file> <INVENTORY-ID> — <reason>
A differing frame that is allowlisted counts as clean-with-note; any other difference is DIVERGENT.
Exit 0 = clean or allowlisted only; exit 1 = at least one unlisted divergence. Missing counterpart
files (in either direction) are divergences too.
"""
import argparse
import difflib
import json
import os
import re
import sys

MASK_TOKEN = "▒"  # ▒


def load_masks(path: str) -> list[re.Pattern]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return [re.compile(p) for p in data.get("patterns", [])]


def mask_text(text: str, patterns: list[re.Pattern]) -> str:
    for pattern in patterns:
        text = pattern.sub(MASK_TOKEN, text)
    return text


def load_allowlist(path: str | None) -> set[str]:
    if not path or not os.path.exists(path):
        return set()
    keys = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            keys.add(line.split()[0])
    return keys


def read_lines(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        return f.read().splitlines()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("golden_dir")
    p.add_argument("our_dir")
    p.add_argument("--masks", required=True)
    p.add_argument("--allowlist", default=None)
    args = p.parse_args()

    patterns = load_masks(args.masks)
    allowlist = load_allowlist(args.allowlist)
    script_name = os.path.basename(os.path.normpath(args.golden_dir))

    golden_files = set(f for f in os.listdir(args.golden_dir) if f.endswith(".ansi")) if os.path.isdir(args.golden_dir) else set()
    our_files = set(f for f in os.listdir(args.our_dir) if f.endswith(".ansi")) if os.path.isdir(args.our_dir) else set()

    rows: list[tuple[str, str, str]] = []  # (frame_key, status, note)
    any_divergent = False

    for fname in sorted(golden_files | our_files):
        key = f"{script_name}/{fname}"

        if fname not in golden_files or fname not in our_files:
            missing_side = "OUR_DIR" if fname not in our_files else "GOLDEN_DIR"
            status = "allowlisted" if key in allowlist else "DIVERGENT"
            note = f"missing in {missing_side}"
            rows.append((key, status, note))
            if status == "DIVERGENT":
                any_divergent = True
            print(f"--- {key}: {note} ({status})")
            continue

        golden_lines = [mask_text(l, patterns) for l in read_lines(os.path.join(args.golden_dir, fname))]
        our_lines = [mask_text(l, patterns) for l in read_lines(os.path.join(args.our_dir, fname))]

        if golden_lines == our_lines:
            rows.append((key, "clean", ""))
            continue

        status = "allowlisted" if key in allowlist else "DIVERGENT"
        if status == "DIVERGENT":
            any_divergent = True
        rows.append((key, status, ""))
        diff = difflib.unified_diff(
            golden_lines, our_lines, fromfile=f"GOLDEN/{key}", tofile=f"OUR/{key}", lineterm=""
        )
        print(f"\n=== {key} ({status}) ===")
        print("\n".join(diff))

    print("\nSUMMARY")
    print(f"{'FRAME':50} STATUS")
    for key, status, note in rows:
        suffix = f" ({note})" if note else ""
        print(f"{key:50} {status}{suffix}")

    counts = {"clean": 0, "allowlisted": 0, "DIVERGENT": 0}
    for _, status, _ in rows:
        counts[status] += 1
    print(f"\n{counts['clean']} clean, {counts['allowlisted']} allowlisted, {counts['DIVERGENT']} DIVERGENT")

    return 1 if any_divergent else 0


if __name__ == "__main__":
    sys.exit(main())
