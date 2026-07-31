# Frame diff allowlist

Known, accepted divergences between `test/fixtures/upstream-frames/` (the real `claude` 2.1.220
goldens) and a `ccx` capture, checked by `scripts/frame-diff.py --allowlist`. A divergent frame
listed here counts as clean-with-note instead of DIVERGENT; any other difference still fails the
diff.

Format (one entry per line, `#` for comments):

    <script-dir>/<frame-file> <INVENTORY-ID> — <reason>

Example:

    # help-overlay/02-help.ansi F0-123 — real binary's help overlay layout not yet ported

Empty as of F0 (2026-07-31): no divergence has been triaged into an inventory item yet — every
frame difference from `scripts/frame-diff.py` on this task is expected raw DIVERGENT output, per
the task-9 brief (the fidelity waves that would close these gaps haven't run).
