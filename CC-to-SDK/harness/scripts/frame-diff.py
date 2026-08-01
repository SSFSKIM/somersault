#!/usr/bin/env python3
"""Diff two frame directories cell-for-cell after masking nondeterminism.

Run with the same interpreter used to capture (no third-party imports here, but kept uniform):
    scripts/frames/.venv/bin/python3 scripts/frame-diff.py GOLDEN_DIR OUR_DIR \
        --masks scripts/frames/masks.json [--allowlist test/fixtures/upstream-frames/allowlist.md]

masks.json separates `redactions_by_frame` (identity redaction required before tracked-golden writes)
from `by_frame` (dashboard-only comparison nondeterminism). Both are selected by
`<scenario>/<frame>.ansi`. Every match is applied per line with SGR sequences intact and replaced on
BOTH sides with the fixed token `▒` (or a capture-group-preserving equivalent). Fixed, not equal-length:
a 3s duration versus a 12s one must mask to the same string, or the mask is useless.
(Column alignment after the mask point differs from the on-screen frame; comparison is masked-text
to masked-text, so that is fine.)

Allowlist lines look like:  <script-dir>/<frame-file> sha256:<masked-pair-digest> <INVENTORY-ID> — <reason>
A differing frame is allowlisted only when its masked golden/ours pair has the reviewed digest. Every
other difference is DIVERGENT. Exit 0 = clean or exactly allowlisted only; exit 1 = malformed/stale
allowlist data or any unlisted divergence. Missing counterpart files (in either direction) are divergences
and cannot be allowlisted.
"""
import argparse
import difflib
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from frame_masks import frame_key, load_masks, load_redactions, mask_text



ALLOWLIST_DIGEST = re.compile(r"sha256:([0-9a-f]{64})$")


def masked_fingerprint(golden_lines: list[str], our_lines: list[str]) -> str:
    payload = json.dumps(
        {"golden": golden_lines, "ours": our_lines},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_allowlist(path: str | None) -> dict[str, str]:
    if not path or not os.path.exists(path):
        return {}
    entries = {}
    with open(path, encoding="utf-8") as f:
        for line_number, raw_line in enumerate(f, 1):
            line = raw_line.strip()
            if not line or line.startswith("#") or ".ansi" not in line:
                continue
            try:
                fields, reason = line.split(" — ", 1)
            except ValueError as error:
                raise ValueError(
                    f"line {line_number}: expected '<frame>.ansi sha256:<64 lowercase hex> <inventory-id> — <reason>'"
                ) from error
            parts = fields.split()
            if len(parts) != 3 or not reason.strip():
                raise ValueError(
                    f"line {line_number}: expected '<frame>.ansi sha256:<64 lowercase hex> <inventory-id> — <reason>'"
                )
            key, digest_field, inventory_id = parts
            digest_match = ALLOWLIST_DIGEST.fullmatch(digest_field)
            if not key.endswith(".ansi") or "/" not in key or not digest_match or not inventory_id:
                raise ValueError(
                    f"line {line_number}: expected '<frame>.ansi sha256:<64 lowercase hex> <inventory-id> — <reason>'"
                )
            if key in entries:
                raise ValueError(f"line {line_number}: duplicate frame key {key!r}; one reviewed fingerprint per frame is supported")
            entries[key] = digest_match.group(1)
    return entries


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

    if not os.path.isdir(args.golden_dir) or not os.path.isdir(args.our_dir):
        print("ERROR: frame input directory is nonexistent")
        return 1
    golden_files = set(f for f in os.listdir(args.golden_dir) if f.endswith(".ansi"))
    our_files = set(f for f in os.listdir(args.our_dir) if f.endswith(".ansi"))
    if not golden_files or not our_files:
        print("ERROR: frame input directory is empty")
        return 1

    try:
        allowlist = load_allowlist(args.allowlist)
    except ValueError as error:
        print(f"ERROR: invalid allowlist entry: {error}")
        return 1

    rows: list[tuple[str, str, str]] = []  # (frame_key, status, note)
    matched_allowlist_keys = set()
    divergent_keys = set()
    any_divergent = False

    for fname in sorted(golden_files | our_files):
        key = frame_key(args.golden_dir, fname)

        if fname not in golden_files or fname not in our_files:
            missing_side = "OUR_DIR" if fname not in our_files else "GOLDEN_DIR"
            status = "DIVERGENT"
            note = f"missing in {missing_side}"
            rows.append((key, status, note))
            if status == "DIVERGENT":
                any_divergent = True
            print(f"--- {key}: {note} ({status})")
            continue

        golden_raw = read_lines(os.path.join(args.golden_dir, fname))
        our_raw = read_lines(os.path.join(args.our_dir, fname))
        if not golden_raw or not our_raw:
            any_divergent = True
            rows.append((key, "DIVERGENT", "empty frame"))
            print(f"--- {key}: empty frame (DIVERGENT)")
            continue
        patterns = load_masks(args.masks, key)
        golden_lines = [mask_text(l, patterns) for l in golden_raw]
        our_lines = [mask_text(l, patterns) for l in our_raw]

        if golden_lines == our_lines:
            rows.append((key, "clean", ""))
            continue

        fingerprint = masked_fingerprint(golden_lines, our_lines)
        if allowlist.get(key) == fingerprint:
            status = "allowlisted"
            matched_allowlist_keys.add(key)
            note = ""
        else:
            status = "DIVERGENT"
            divergent_keys.add(key)
            any_divergent = True
            note = ""
            if key in allowlist:
                note = "allowlist fingerprint is stale"
        rows.append((key, status, note))
        diff = difflib.unified_diff(
            golden_lines, our_lines, fromfile=f"GOLDEN/{key}", tofile=f"OUR/{key}", lineterm=""
        )
        print(f"\n=== {key} ({status}) ===")
        print(f"fingerprint: sha256:{fingerprint}")
        if note:
            print(f"ERROR: {note}; update this entry with the fingerprint above after review")
        print("\n".join(diff))

    for key in sorted(set(allowlist) - matched_allowlist_keys - divergent_keys):
        any_divergent = True
        print(
            f"ERROR: allowlist entry for {key} is not a divergent masked comparison; "
            "remove it or replace it with a current reviewed fingerprint"
        )

    if not rows:
        print("ERROR: zero frame comparisons")
        return 1

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
