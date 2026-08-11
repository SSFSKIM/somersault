# Frame diff allowlist

Known, accepted divergences between `test/fixtures/upstream-frames/` (the real `claude` 2.1.220
goldens) and a `ccx` capture, checked by `scripts/frame-diff.py --allowlist`. A divergent frame
counts as clean-with-note only when its post-mask golden/ours pair matches the reviewed fingerprint;
any other difference still fails the diff.

Format (one entry per line, `#` for comments):

    <script-dir>/<frame-file> sha256:<64-lowercase-hex> <INVENTORY-ID> — <reason>

Run the diff first. For every divergent frame it prints `fingerprint: sha256:<digest>` after applying
that frame's comparison masks. Copy that digest only after reviewing the masked diff. A changed masked
pair, a clean/missing/empty frame, malformed entry, or duplicate frame key fails closed.

Example:

    # help-overlay/02-help.ansi sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef F0-123 — real binary's help overlay layout not yet ported

Empty as of F0 (2026-07-31): no divergence has been triaged into an inventory item yet — every
frame difference from `scripts/frame-diff.py` on this task is expected raw DIVERGENT output, per
the task-9 brief (the fidelity waves that would close these gaps haven't run).
