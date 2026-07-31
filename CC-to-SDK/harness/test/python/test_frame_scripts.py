import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAPTURE_PATH = ROOT / "scripts" / "capture-frames.py"
DIFF_PATH = ROOT / "scripts" / "frame-diff.py"
MASKS_PATH = ROOT / "scripts" / "frames" / "masks.json"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


capture = load_module(CAPTURE_PATH, "capture_frames")
diff = load_module(DIFF_PATH, "frame_diff")


class FrameScriptsTest(unittest.TestCase):
    def child_command(self, code: str) -> str:
        return f"{shlex.quote(sys.executable)} -c {shlex.quote(code)}"

    def run_capture(self, script: str, binary: str, out: Path):
        script_path = out.parent / "case.keys"
        script_path.write_text(textwrap.dedent(script), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(CAPTURE_PATH), "--script", str(script_path), "--out", str(out), "--bin", binary, "--cwd", str(out.parent)],
            text=True,
            capture_output=True,
        )

    def run_diff(self, golden: Path, ours: Path, allowlist: Path | None = None):
        args = [sys.executable, str(DIFF_PATH), str(golden), str(ours), "--masks", str(MASKS_PATH)]
        if allowlist is not None:
            args += ["--allowlist", str(allowlist)]
        return subprocess.run(args, text=True, capture_output=True)

    def test_plain_and_dim_are_distinct_and_retained_attributes_round_trip(self):
        plain = capture.DimScreen(30, 2)
        dim = capture.DimScreen(30, 2)
        capture.pyte.ByteStream(plain).feed(b"plain")
        capture.pyte.ByteStream(dim).feed(b"\x1b[2mdim")
        self.assertNotEqual(capture.render_screen(plain), capture.render_screen(dim))
        self.assertIn(";2m", capture.render_screen(dim))

        styled = capture.DimScreen(30, 2)
        capture.pyte.ByteStream(styled).feed(b"\x1b[1;2;3;4;5;7;9mstyled")
        rendered = capture.render_screen(styled)
        for code in ("1", "2", "3", "4", "5", "7", "9"):
            self.assertIn(code, rendered)

    def test_mask_matrix_preserves_semantic_suffixes_and_counts(self):
        patterns = diff.load_masks(str(MASKS_PATH))
        self.assertNotEqual(
            diff.mask_text("Read /tmp/frame-scratch/right.ts", patterns),
            diff.mask_text("Read /tmp/frame-scratch/wrong.ts", patterns),
        )
        self.assertNotEqual(
            diff.mask_text("1 agents", patterns),
            diff.mask_text("2 agents", patterns),
        )
        for left, right in (
            ("Notify alice@example.com", "Notify bob@example.com"),
            ("Upload progress 10%", "Upload progress 90%"),
            ("Expected cost $1.00", "Expected cost $900.00"),
            ("Processed 10 tokens", "Processed 900 tokens"),
        ):
            self.assertNotEqual(diff.mask_text(left, patterns), diff.mask_text(right, patterns))
        alice = diff.mask_text("Read /Users/alice/project/right.ts", patterns)
        bob = diff.mask_text("Read /Users/bob/project/right.ts", patterns)
        self.assertEqual(alice, bob)
        self.assertIn("/project/right.ts", alice)
        self.assertIn("git@github.com:owner/repo.git", diff.mask_text("git@github.com:owner/repo.git", patterns))

    def test_frame_scoped_masks_round_trip_dashboard_identity_across_all_eight_frames(self):
        keys = [
            *(f"help-overlay/{i:02d}-frame.ansi" for i in range(1, 4)),
            *(f"composer-basics/{i:02d}-frame.ansi" for i in range(1, 6)),
        ]
        captured = "User: alice@example.com | Weekly: 98% | cost $1.00 | elapsed 3s | 10 tokens"
        stored = "User: bob@example.com | Weekly: 42% | cost $900.00 | elapsed 9s | 900 tokens"
        for key in keys:
            scoped = diff.load_masks(str(MASKS_PATH), key)
            self.assertEqual(diff.mask_text(captured, scoped), diff.mask_text(stored, scoped), key)
            self.assertNotEqual(
                diff.mask_text("Notify alice@example.com", scoped),
                diff.mask_text("Notify bob@example.com", scoped),
                key,
            )
        other = diff.load_masks(str(MASKS_PATH), "other-scenario/01-frame.ansi")
        self.assertNotEqual(diff.mask_text(captured, other), diff.mask_text(stored, other))

    def test_capture_early_exit_and_zero_frames_fail(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            early = self.run_capture("wait:0.05\nframe:boot\n", self.child_command(""), root / "early")
            self.assertNotEqual(early.returncode, 0)
            self.assertIn("pty closed", early.stderr)
            zero = self.run_capture("wait:0.01\n", self.child_command("import time; time.sleep(0.3)"), root / "zero")
            self.assertNotEqual(zero.returncode, 0)
            self.assertIn("no frame", zero.stderr)

    def test_dim_follows_bottom_margin_scroll(self):
        screen = capture.DimScreen(3, 2)
        capture.pyte.ByteStream(screen).feed(b"abcdef\x1b[2mG")
        self.assertFalse(screen.dim_at(0, 0), "scrolled plain d must not inherit dim from the later draw")
        self.assertTrue(screen.dim_at(1, 0), "wrapped G must retain dim after bottom-margin scroll")

    def test_dim_uses_current_attributes_for_erase(self):
        screen = capture.DimScreen(4, 1)
        capture.pyte.ByteStream(screen).feed(b"\x1b[2mX\x1b[0K")
        self.assertEqual(screen.buffer[0][1].data, " ")
        self.assertTrue(screen.dim_at(0, 1), "erased cells inherit the current dim cursor attribute")

    def test_dim_follows_insert_and_delete_character_mutations(self):
        inserted = capture.DimScreen(4, 1)
        capture.pyte.ByteStream(inserted).feed(b"abc\x1b[1G\x1b[4h\x1b[2mX")
        self.assertTrue(inserted.dim_at(0, 0), "inserted X keeps its dim attribute")
        self.assertFalse(inserted.dim_at(0, 1), "shifted plain a keeps its own attribute")

        deleted = capture.DimScreen(6, 1)
        capture.pyte.ByteStream(deleted).feed(b"\x1b[2mAB\x1b[0mC\x1b[1G\x1b[1P")
        self.assertTrue(deleted.dim_at(0, 0), "dim B follows A's deletion into column zero")
        self.assertFalse(deleted.dim_at(0, 1), "plain C follows the deleted dim cell")

    def test_dim_follows_insert_and_delete_line_mutations(self):
        inserted = capture.DimScreen(3, 3)
        capture.pyte.ByteStream(inserted).feed(b"\x1b[2;1H\x1b[2mA\x1b[2;1H\x1b[1L")
        self.assertTrue(inserted.dim_at(2, 0), "inserted line shifts the dim A cell with its row")

        deleted = capture.DimScreen(3, 3)
        capture.pyte.ByteStream(deleted).feed(b"\x1b[2mA\x1b[2;1H\x1b[0mB\x1b[1;1H\x1b[1M")
        self.assertFalse(deleted.dim_at(0, 0), "deleting the dim line removes its style with the row")
        self.assertEqual(deleted.buffer[0][0].data, "B")

    def test_dim_wide_cell_overwrite_clears_both_cells(self):
        screen = capture.DimScreen(4, 1)
        capture.pyte.ByteStream(screen).feed("\x1b[2m界\x1b[1G\x1b[0mZ".encode())
        self.assertFalse(screen.dim_at(0, 0))
        self.assertFalse(screen.dim_at(0, 1), "overwriting a wide cell clears the stale dim stub")

    def test_capture_writes_expected_frames_for_live_child(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = self.run_capture(
                "wait:0.05\nframe:dim\n",
                self.child_command("import sys,time; sys.stdout.write('\x1b[2mdim\x1b[0m'); sys.stdout.flush(); time.sleep(0.3)"),
                root / "valid",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / "valid" / "01-dim.ansi").exists())
            self.assertIn(";2m", (root / "valid" / "01-dim.ansi").read_text(encoding="utf-8"))

    def test_capture_partial_frames_fail(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            partial = self.run_capture(
                "wait:0.01\nframe:first\nwait:0.4\nframe:second\n",
                self.child_command("import time; print('ready', flush=True); time.sleep(0.15)"),
                root / "partial",
            )
            self.assertNotEqual(partial.returncode, 0)
            self.assertIn("pty closed", partial.stderr)

    def test_diff_rejects_missing_empty_and_missing_allowlisted_counterpart(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            missing = self.run_diff(root / "no-golden", root / "no-ours")
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("nonexistent", missing.stdout + missing.stderr)
            golden, ours = root / "golden", root / "ours"
            golden.mkdir(); ours.mkdir()
            empty = self.run_diff(golden, ours)
            self.assertNotEqual(empty.returncode, 0)
            self.assertIn("empty", empty.stdout + empty.stderr)
            (golden / "01-x.ansi").write_text("one\n", encoding="utf-8")
            (ours / "02-extra.ansi").write_text("extra\n", encoding="utf-8")
            allow = root / "allowlist.md"
            allow.write_text("golden/01-x.ansi F0-1 — temporary\n", encoding="utf-8")
            missing_counterpart = self.run_diff(golden, ours, allow)
            self.assertNotEqual(missing_counterpart.returncode, 0)
            self.assertIn("DIVERGENT", missing_counterpart.stdout)

    def test_diff_clean_divergent_and_content_allowlisted_contracts(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden, ours = root / "golden", root / "ours"
            golden.mkdir(); ours.mkdir()
            (golden / "01-x.ansi").write_text("same\n", encoding="utf-8")
            (ours / "01-x.ansi").write_text("same\n", encoding="utf-8")
            clean = self.run_diff(golden, ours)
            self.assertEqual(clean.returncode, 0)
            self.assertIn("1 clean, 0 allowlisted, 0 DIVERGENT", clean.stdout)
            (ours / "01-x.ansi").write_text("different\n", encoding="utf-8")
            divergent = self.run_diff(golden, ours)
            self.assertNotEqual(divergent.returncode, 0)
            self.assertIn("DIVERGENT", divergent.stdout)
            allow = root / "allowlist.md"
            allow.write_text("golden/01-x.ansi F0-1 — accepted content difference\n", encoding="utf-8")
            allowed = self.run_diff(golden, ours, allow)
            self.assertEqual(allowed.returncode, 0)
            self.assertIn("0 clean, 1 allowlisted, 0 DIVERGENT", allowed.stdout)


if __name__ == "__main__":
    unittest.main()
