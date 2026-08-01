import importlib.util
import json
import os
import re
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
FRAME_REQUIREMENTS_PATH = ROOT / "scripts" / "frames" / "requirements.txt"
F0_PLAN_PATH = ROOT.parent / "docs" / "superpowers" / "plans" / "2026-07-31-tui-clone-f0.md"
LIVE_CHILD_KEEPALIVE_SECONDS = 5
PARTIAL_CHILD_KEEPALIVE_SECONDS = 0.15


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


capture = load_module(CAPTURE_PATH, "capture_frames")
diff = load_module(DIFF_PATH, "frame_diff")


class FrameScriptsTest(unittest.TestCase):
    def synthetic_child_command(self, code: str) -> str:
        return f"{shlex.quote(sys.executable)} -c {shlex.quote(code)}"

    def live_child_command(self, code: str) -> str:
        return self.synthetic_child_command(
            f"import time\n{code}\ntime.sleep({LIVE_CHILD_KEEPALIVE_SECONDS})"
        )

    def partial_child_command(self, code: str) -> str:
        return self.synthetic_child_command(
            f"import time\n{code}\ntime.sleep({PARTIAL_CHILD_KEEPALIVE_SECONDS})"
        )

    def dead_child_command(self) -> str:
        return self.synthetic_child_command("")

    def run_capture(self, script: str, binary: str, out: Path, redact_masks: Path | None = None, script_parent: Path | None = None, cwd: Path | None = None):
        script_path = (script_parent or out.parent) / "case.keys"
        script_path.parent.mkdir(parents=True, exist_ok=True)
        script_path.write_text(textwrap.dedent(script), encoding="utf-8")
        args = [sys.executable, str(CAPTURE_PATH), "--script", str(script_path), "--out", str(out), "--bin", binary, "--cwd", str(cwd or out.parent)]
        if redact_masks is not None:
            args += ["--redact-masks", str(redact_masks)]
        return subprocess.run(args, text=True, capture_output=True)

    def run_diff(self, golden: Path, ours: Path, allowlist: Path | None = None, masks: Path = MASKS_PATH):
        args = [sys.executable, str(DIFF_PATH), str(golden), str(ours), "--masks", str(masks)]
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

    def test_mask_matrix_preserves_transcript_semantics_and_unrelated_identity(self):
        patterns = diff.load_masks(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        for left, right in (
            ("Read /tmp/frame-scratch/right.ts", "Read /tmp/frame-scratch/wrong.ts"),
            ("1 agents", "2 agents"),
            ("Notify alice@example.com", "Notify bob@example.com"),
            ("Upload progress 10%", "Upload progress 90%"),
            ("Expected cost $1.00; Took 3s; Processed 10 tokens", "Expected cost $900.00; Took 9s; Processed 900 tokens"),
            ("uuid 123e4567-e89b-12d3-a456-426614174000", "uuid 123e4567-e89b-12d3-a456-426614174001"),
            ("Read /Users/alice/project/right.ts", "Read /Users/bob/project/right.ts"),
        ):
            self.assertNotEqual(diff.mask_text(left, patterns), diff.mask_text(right, patterns))
        self.assertIn("git@github.com:owner/repo.git", diff.mask_text("git@github.com:owner/repo.git", patterns))

    def test_frame_scoped_masks_collapse_only_dashboard_quota_and_status_values(self):
        keys = [
            *(f"help-overlay/{i:02d}-frame.ansi" for i in range(1, 4)),
            *(f"composer-basics/{i:02d}-frame.ansi" for i in range(1, 6)),
        ]
        quota_a = "\x1b[0m                            \x1b[0;38;2;255;193;7mYou've used 98% of your weekly limit · resets Aug 5 at 1pm (Asia/Seoul)\x1b[0m"
        quota_b = "\x1b[0m                            \x1b[0;38;2;255;193;7mYou've used 2% of your weekly limit · resets Sep 30 at 11pm (UTC)\x1b[0m"
        status_a = "\x1b[0;34m[Fable 5]\x1b[0;38;2;153;153;153m \x1b[0;38;2;253;185;49m$1.00\x1b[0;38;2;153;153;153m · \x1b[0;38;2;253;185;49m3s\x1b[0m"
        status_b = "\x1b[0;34m[Fable 5]\x1b[0;38;2;153;153;153m \x1b[0;38;2;253;185;49m$900.00\x1b[0;38;2;153;153;153m · \x1b[0;38;2;253;185;49m9s\x1b[0m"
        for key in keys:
            scoped = diff.load_masks(str(MASKS_PATH), key)
            self.assertEqual(diff.mask_text(quota_a, scoped), diff.mask_text(quota_b, scoped), key)
            self.assertEqual(diff.mask_text(status_a, scoped), diff.mask_text(status_b, scoped), key)
            self.assertNotEqual(diff.mask_text("Notify alice@example.com", scoped), diff.mask_text("Notify bob@example.com", scoped), key)
        other = diff.load_masks(str(MASKS_PATH), "other-scenario/01-frame.ansi")
        self.assertNotEqual(diff.mask_text(quota_a, other), diff.mask_text(quota_b, other))

    def test_capture_and_diff_share_canonical_nested_frame_keys_for_scoped_masks(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            fixture_root = root / "test" / "fixtures" / "upstream-frames"
            golden = fixture_root / "new" / "scenario"
            golden.mkdir(parents=True)
            ours = root / "scratch"
            ours.mkdir()
            (golden / "01-frame.ansi").write_text("SECRET-GOLDEN\n", encoding="utf-8")
            (ours / "01-frame.ansi").write_text("SECRET-OURS\n", encoding="utf-8")
            masks = root / "masks.json"
            masks.write_text(json.dumps({"by_frame": {
                "new/scenario/01-frame.ansi": [{"pattern": "SECRET-[A-Z]+", "replacement": "▒"}],
            }}), encoding="utf-8")

            aliases = [
                (golden, "new/scenario/01-frame.ansi"),
                (golden / "nested" / "..", "new/scenario/01-frame.ansi"),
                (fixture_root / "help-overlay", "help-overlay/01-frame.ansi"),
                (root / "scratch", "scratch/01-frame.ansi"),
            ]
            (golden / "nested").mkdir()
            linked_root = root / "linked-root"
            linked_root.symlink_to(fixture_root, target_is_directory=True)
            aliases.append((linked_root / "new" / "scenario", "new/scenario/01-frame.ansi"))
            scratch_alias = root / "scratch-alias"
            scratch_alias.symlink_to(ours, target_is_directory=True)
            aliases.append((scratch_alias, "scratch/01-frame.ansi"))
            for directory, expected in aliases:
                with self.subTest(directory=directory):
                    self.assertEqual(capture.frame_key(str(directory), "01-frame.ansi"), expected)
                    self.assertEqual(diff.frame_key(str(directory), "01-frame.ansi"), expected)

            compared = self.run_diff(golden, ours, masks=masks)
            self.assertEqual(compared.returncode, 0, compared.stdout + compared.stderr)
            self.assertIn("1 clean, 0 allowlisted, 0 DIVERGENT", compared.stdout)
            self.assertNotIn("SECRET-GOLDEN", compared.stdout + compared.stderr)
            self.assertNotIn("SECRET-OURS", compared.stdout + compared.stderr)

    def test_synthetic_unredacted_identities_round_trip_to_all_stored_goldens_without_git_history(self):
        fixtures = ROOT / "test" / "fixtures" / "upstream-frames"
        for stored in sorted(fixtures.glob("*/*.ansi")):
            expected = stored.read_text(encoding="utf-8")
            synthetic = expected.replace("▒'s Organization", "fixture@example.test's Organization")
            synthetic = re.sub(r"▒(?=\x1b\[[0-9;]*m:\x1b\[[0-9;]*m/)", "fixture@host", synthetic)
            synthetic = re.sub(r"(\x1b\[0;1m)▒(\x1b\[0m)", r"\1Welcome back Fixture User!\2", synthetic)
            self.assertNotIn("▒", synthetic, stored.name)
            key = "/".join(stored.relative_to(fixtures).parts)
            self.assertEqual(diff.mask_text(synthetic, diff.load_redactions(str(MASKS_PATH), key)), expected, key)

    def test_capture_early_exit_and_zero_frames_fail(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            early = self.run_capture("wait:0.05\nframe:boot\n", self.dead_child_command(), root / "early")
            self.assertNotEqual(early.returncode, 0)
            self.assertIn("pty closed", early.stderr)
            zero = self.run_capture("wait:0.01\n", self.live_child_command("import time"), root / "zero")
            self.assertNotEqual(zero.returncode, 0)
            self.assertIn("no frame", zero.stderr)

    def test_capture_immediately_dead_child_never_reports_or_writes_a_frame(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for attempt in range(10):
                out = root / f"dead-{attempt}"
                result = self.run_capture("frame:boot\n", "true", out)
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self.assertFalse(list(out.glob("*.ansi")), result.stderr)

    def test_capture_zero_wait_live_child_with_rendered_screen_succeeds(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = self.run_capture(
                "frame:boot\n",
                self.live_child_command("import sys,time; sys.stdout.write('ready'); sys.stdout.flush()"),
                root / "live",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("ready", (root / "live" / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_capture_refuses_unredacted_tracked_golden_writes_and_redacts_when_explicit(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command("import sys,time; sys.stdout.write('\\x1b[0;1mWelcome back Test Identity!\\x1b[0m             \\x1b[0;38;2;215;119;87m│\\x1b[0m Ask Claude to create'); sys.stdout.flush()")
            refused = self.run_capture("wait:0.05\nframe:boot\n", child, out)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("--redact-masks", refused.stderr)
            self.assertFalse(list(out.glob("*.ansi")))
            one_identity_masks = root / "masks-one-identity.json"
            one_identity_masks.write_text(json.dumps({"redactions_by_frame": {
                "help-overlay/01-boot.ansi": {
                    "patterns": [{"name": "greeting", "pattern": "Welcome back [^!\\x1b]*!", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            captured = self.run_capture("wait:0.05\nframe:boot\n", child, out, one_identity_masks)
            self.assertEqual(captured.returncode, 0, captured.stderr)
            frame = (out / "01-boot.ansi").read_text(encoding="utf-8")
            self.assertIn("▒", frame)
            self.assertNotIn("Test Identity", frame)

    def test_tracked_fixture_relative_uses_canonical_containment(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            fixture_root = root / "test" / "fixtures" / "upstream-frames"
            fixture_root.mkdir(parents=True)
            linked_root = root / "linked-root"
            linked_root.symlink_to(fixture_root, target_is_directory=True)
            self.assertEqual(capture.tracked_fixture_relative(str(fixture_root)), "")
            self.assertEqual(capture.frame_key(str(fixture_root), "01-boot.ansi"), "01-boot.ansi")
            self.assertEqual(capture.tracked_fixture_relative(str(linked_root / "new" / "nested")), "new/nested")
            self.assertFalse(capture.tracked_fixture_relative(str(linked_root / "new" / "nested")).startswith("/"))
            nonexistent = root / "unmade" / "test" / "fixtures" / "upstream-frames" / "new" / "scenario"
            self.assertEqual(capture.tracked_fixture_relative(str(nonexistent)), "new/scenario")

            outside = root / "outside"
            outside.mkdir()
            escape = fixture_root / "escape"
            escape.symlink_to(outside, target_is_directory=True)
            self.assertIsNone(capture.tracked_fixture_relative(str(escape / "scenario")))
            self.assertIsNone(capture.tracked_fixture_relative(str(root / "test" / "fixtures" / "upstream-frames-extra" / ".." / "evil")))

            case_alias = fixture_root.parent / "UPSTREAM-FRAMES"
            if case_alias.exists() and os.path.samefile(case_alias, fixture_root):
                self.assertEqual(capture.tracked_fixture_relative(str(case_alias / "scenario")), "scenario")

    def test_capture_treats_canonical_tracked_fixture_aliases_as_redaction_required_before_spawning(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            fixture_root = root / "test" / "fixtures" / "upstream-frames"
            fixture_root.mkdir(parents=True)
            aliases = {
                "direct": fixture_root / "direct",
                "dotdot": fixture_root / "nested" / ".." / "dotdot",
            }
            linked_root = root / "linked-root"
            linked_root.symlink_to(fixture_root, target_is_directory=True)
            aliases["linked-root"] = linked_root / "scenario"
            linked_ancestor = root / "linked-ancestor"
            linked_ancestor.symlink_to(fixture_root.parent, target_is_directory=True)
            aliases["linked-ancestor"] = linked_ancestor / "upstream-frames" / "scenario"
            case_alias = fixture_root.parent / "UPSTREAM-FRAMES"
            if case_alias.exists() and os.path.samefile(case_alias, fixture_root):
                aliases["case-alias"] = case_alias / "scenario"

            for label, out in aliases.items():
                with self.subTest(label=label):
                    marker = f"spawned-{label}"
                    child = self.live_child_command(
                        f"from pathlib import Path; import sys,time; Path({marker!r}).write_text('yes'); "
                        "sys.stdout.write('RAW-IDENTITY'); sys.stdout.flush()"
                    )
                    refused = self.run_capture("frame:boot\n", child, out)
                    self.assertNotEqual(refused.returncode, 0, refused.stderr)
                    self.assertIn("--redact-masks", refused.stderr)
                    self.assertFalse((out.parent / marker).exists())
                    self.assertFalse(list(out.glob("*.ansi")))

            nearby = root / "test" / "fixtures" / "upstream-frames-lookalike" / "scenario"
            captured = self.run_capture(
                "wait:0.05\nframe:boot\n",
                self.live_child_command("import sys,time; sys.stdout.write('RAW-IDENTITY'); sys.stdout.flush()"),
                nearby,
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            self.assertIn("RAW-IDENTITY", (nearby / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_capture_stages_a_redacted_symlinked_fixture_tail_and_allows_an_escape(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            fixture_root = root / "test" / "fixtures" / "upstream-frames"
            fixture_root.mkdir(parents=True)
            linked_root = root / "linked-root"
            linked_root.symlink_to(fixture_root, target_is_directory=True)
            tracked = linked_root / "new" / "scenario"
            self.assertFalse(tracked.parent.exists())
            masks = root / "masks.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "new/scenario/01-boot.ansi": {
                    "patterns": [{"name": "identity", "pattern": "FAKE-IDENTITY", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            captured = self.run_capture(
                "wait:0.05\nframe:boot\n",
                self.live_child_command("import sys,time; sys.stdout.write('FAKE-IDENTITY'); sys.stdout.flush()"),
                tracked,
                masks,
                script_parent=root,
                cwd=root,
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            frame = (tracked / "01-boot.ansi").read_text(encoding="utf-8")
            self.assertNotIn("FAKE-IDENTITY", frame)
            self.assertIn("▒", frame)

            outside = root / "outside"
            outside.mkdir()
            escape = fixture_root / "escape"
            escape.symlink_to(outside, target_is_directory=True)
            escaped = self.run_capture(
                "wait:0.05\nframe:boot\n",
                self.live_child_command("import sys,time; sys.stdout.write('RAW-OUTSIDE'); sys.stdout.flush()"),
                escape / "scenario",
                script_parent=root,
                cwd=root,
            )
            self.assertEqual(escaped.returncode, 0, escaped.stderr)
            self.assertIn("RAW-OUTSIDE", (escape / "scenario" / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_capture_refuses_tracked_scenarios_without_complete_redaction_rules_before_spawning(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            child = self.live_child_command("from pathlib import Path; import sys,time; Path('spawned').write_text('yes'); sys.stdout.write('ready'); sys.stdout.flush()")
            no_match = root / "masks-no-match.json"
            no_match.write_text(json.dumps({"redactions_by_frame": {"other/*.ansi": ["ready"]}}), encoding="utf-8")
            out = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            refused = self.run_capture("frame:boot\n", child, out, no_match)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("renamed/01-boot.ansi", refused.stderr)
            self.assertFalse((out.parent / "spawned").exists())
            self.assertFalse(list(out.glob("*.ansi")))

            partial = root / "masks-partial.json"
            partial.write_text(json.dumps({"redactions_by_frame": {"renamed/01-first.ansi": {
                "patterns": [{"name": "ready", "pattern": "ready", "minimum_matches": 1}],
                "minimum_matches": 1,
            }}}), encoding="utf-8")
            refused_partial = self.run_capture("frame:first\nframe:second\n", child, out, partial)
            self.assertNotEqual(refused_partial.returncode, 0)
            self.assertIn("renamed/02-second.ansi", refused_partial.stderr)
            self.assertFalse((out.parent / "spawned").exists())
            self.assertFalse(list(out.glob("*.ansi")))

    def test_capture_accepts_fully_covered_tracked_frames_and_untracked_output_without_redaction(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            child = self.live_child_command("import sys,time; sys.stdout.write('ready'); sys.stdout.flush()")
            masks = root / "masks-complete.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "renamed/01-first.ansi": {"patterns": [{"name": "ready", "pattern": "ready", "minimum_matches": 1}], "minimum_matches": 1},
                "renamed/02-second.ansi": {"patterns": [{"name": "ready", "pattern": "ready", "minimum_matches": 1}], "minimum_matches": 1},
            }}), encoding="utf-8")
            tracked = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            captured = self.run_capture("frame:first\nframe:second\n", child, tracked, masks)
            self.assertEqual(captured.returncode, 0, captured.stderr)
            for name in ("01-first.ansi", "02-second.ansi"):
                text = (tracked / name).read_text(encoding="utf-8")
                self.assertIn("▒", text)
                self.assertNotIn("ready", text)

            untracked = self.run_capture("frame:boot\n", child, root / "scratch")
            self.assertEqual(untracked.returncode, 0, untracked.stderr)
            self.assertIn("ready", (root / "scratch" / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_capture_publishes_only_validated_ansi_frames_and_preserves_failed_output(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            child = self.live_child_command("import sys,time; sys.stdout.write('fresh'); sys.stdout.flush()")
            untracked = root / "untracked"
            untracked.mkdir()
            (untracked / "01-old.ansi").write_text("old\n", encoding="utf-8")
            (untracked / "99-extra.ansi").write_text("extra\n", encoding="utf-8")
            (untracked / "VERSION").write_bytes(b"metadata\n")
            captured = self.run_capture("wait:0.05\nframe:new\n", child, untracked)
            self.assertEqual(captured.returncode, 0, captured.stderr)
            self.assertEqual({p.name for p in untracked.glob("*.ansi")}, {"01-new.ansi"})
            self.assertIn("fresh", (untracked / "01-new.ansi").read_text(encoding="utf-8"))
            self.assertEqual((untracked / "VERSION").read_bytes(), b"metadata\n")
            self.assertFalse(list(root.glob(".capture-*")))

            failed = root / "failed"
            failed.mkdir()
            (failed / "01-old.ansi").write_bytes(b"old frame\n")
            (failed / "99-extra.ansi").write_bytes(b"extra frame\n")
            (failed / "allowlist.md").write_bytes(b"metadata\n")
            before_failure = {p.name: p.read_bytes() for p in failed.iterdir()}
            partial = self.run_capture(
                "wait:0.05\nframe:new\nwait:0.3\nframe:later\n",
                self.partial_child_command("import sys,time; sys.stdout.write('fresh'); sys.stdout.flush()"),
                failed,
            )
            self.assertNotEqual(partial.returncode, 0)
            self.assertEqual({p.name: p.read_bytes() for p in failed.iterdir()}, before_failure)
            self.assertFalse(list(root.glob(".capture-*")))

            tracked = root / "test" / "fixtures" / "upstream-frames" / "nested" / "recapture"
            tracked.mkdir(parents=True)
            (tracked / "01-old.ansi").write_text("old\n", encoding="utf-8")
            (tracked / "VERSION").write_bytes(b"tracked metadata\n")
            masks = root / "masks.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "nested/recapture/01-new.ansi": {
                    "patterns": [{"name": "fresh", "pattern": "fresh", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            captured_tracked = self.run_capture("wait:0.05\nframe:new\n", child, tracked, masks)
            self.assertEqual(captured_tracked.returncode, 0, captured_tracked.stderr)
            self.assertEqual({p.name for p in tracked.glob("*.ansi")}, {"01-new.ansi"})
            self.assertIn("▒", (tracked / "01-new.ansi").read_text(encoding="utf-8"))
            self.assertEqual((tracked / "VERSION").read_bytes(), b"tracked metadata\n")

    def test_capture_rejects_declared_rules_that_match_no_identity_before_writing(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            masks = root / "masks-zero-match.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "renamed/01-boot.ansi": {
                    "patterns": [{"name": "greeting", "pattern": "FAKE-GREETING", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            child = self.live_child_command("import sys,time; sys.stdout.write('RAW-FAKE-IDENTITY'); sys.stdout.flush()")
            refused = self.run_capture("frame:boot\n", child, out, masks)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("greeting", refused.stderr)
            self.assertFalse(list(out.glob("*.ansi")))
            self.assertNotIn("RAW-FAKE-IDENTITY", refused.stdout + refused.stderr)

    def test_capture_redaction_validation_is_atomic_across_tracked_frames(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            masks = root / "masks-partial-match.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "renamed/01-first.ansi": {
                    "patterns": [{"name": "first", "pattern": "FAKE-FIRST", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
                "renamed/02-second.ansi": {
                    "patterns": [{"name": "second", "pattern": "FAKE-SECOND", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            child = self.live_child_command("import sys,time; sys.stdout.write('FAKE-FIRST'); sys.stdout.flush()")
            refused = self.run_capture("frame:first\nframe:second\n", child, out, masks)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("second", refused.stderr)
            self.assertFalse(list(out.glob("*.ansi")))

    def test_capture_accepts_exact_identity_coverage_and_explicit_safe_frame(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            covered = root / "test" / "fixtures" / "upstream-frames" / "covered"
            masks = root / "masks-coverage.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "covered/01-identities.ansi": {
                    "patterns": [
                        {"name": "greeting", "pattern": "FAKE-GREETING", "minimum_matches": 1},
                        {"name": "status", "pattern": "fake@host", "minimum_matches": 1},
                    ],
                    "minimum_matches": 2,
                },
                "safe/01-safe.ansi": {"patterns": [], "minimum_matches": 0},
            }}), encoding="utf-8")
            identity_child = self.live_child_command("import sys,time; sys.stdout.write('FAKE-GREETING fake@host'); sys.stdout.flush()")
            captured = self.run_capture("wait:0.05\nframe:identities\n", identity_child, covered, masks)
            self.assertEqual(captured.returncode, 0, captured.stderr)
            frame = (covered / "01-identities.ansi").read_text(encoding="utf-8")
            self.assertNotIn("FAKE-GREETING", frame)
            self.assertNotIn("fake@host", frame)
            self.assertGreaterEqual(frame.count("▒"), 2)

            safe = root / "test" / "fixtures" / "upstream-frames" / "safe"
            safe_child = self.live_child_command("import sys,time; sys.stdout.write('safe frame'); sys.stdout.flush()")
            captured_safe = self.run_capture("wait:0.05\nframe:safe\n", safe_child, safe, masks)
            self.assertEqual(captured_safe.returncode, 0, captured_safe.stderr)
            self.assertIn("safe frame", (safe / "01-safe.ansi").read_text(encoding="utf-8"))

    def test_capture_fails_closed_when_an_ansi_boundary_change_breaks_a_required_rule(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "boundary"
            masks = root / "masks-boundary.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "boundary/01-boot.ansi": {
                    "patterns": [{"name": "greeting", "pattern": "FAKE-GREETING(?=\\x1b\\[0m BOUNDARY)", "minimum_matches": 1}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            child = self.live_child_command("import sys,time; sys.stdout.write('FAKE-GREETING changed-layout'); sys.stdout.flush()")
            refused = self.run_capture("wait:0.05\nframe:boot\n", child, out, masks)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("greeting", refused.stderr)
            self.assertFalse(list(out.glob("*.ansi")))

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

    def test_dim_wide_overwrite_clears_the_full_incoming_span(self):
        for old_dim, incoming_dim in ((False, True), (True, False)):
            screen = capture.DimScreen(4, 1)
            old_style = "\x1b[2m" if old_dim else "\x1b[0m"
            incoming_style = "\x1b[2m" if incoming_dim else "\x1b[0m"
            capture.pyte.ByteStream(screen).feed((old_style + "a界b\x1b[1G" + incoming_style + "語").encode())
            self.assertEqual([screen.buffer[0][column].data for column in range(4)], ["語", "", " ", "b"])
            self.assertEqual(screen.dim_at(0, 0), incoming_dim)
            self.assertEqual(screen.dim_at(0, 1), incoming_dim)
            self.assertFalse(screen.dim_at(0, 2), "clearing the old continuation must remove its dim style")
            self.assertEqual(re.sub(r"\x1b\[[0-9;]*m", "", capture.render_screen(screen)), "語 b\n")

    def test_dim_wide_overwrite_clears_each_old_pair_intersecting_its_span(self):
        for first_dim, second_dim in ((False, True), (True, False)):
            screen = capture.DimScreen(4, 1)
            first_style = "\x1b[2m" if first_dim else "\x1b[0m"
            second_style = "\x1b[2m" if second_dim else "\x1b[0m"
            capture.pyte.ByteStream(screen).feed((first_style + "界" + second_style + "界\x1b[2G\x1b[0m語").encode())
            self.assertEqual([screen.buffer[0][column].data for column in range(4)], [" ", "語", "", " "])
            self.assertFalse(screen.dim_at(0, 0))
            self.assertFalse(screen.dim_at(0, 3), "the second old pair's continuation must not survive")

    def test_dim_wide_overwrite_clears_lead_and_continuation_intersections(self):
        for payload, expected in (
            ("\x1b[2ma界b\x1b[1G\x1b[0m語", ["語", "", " ", "b"]),
            ("\x1b[2m界ab\x1b[2G\x1b[0m語", [" ", "語", "", "b"]),
        ):
            screen = capture.DimScreen(4, 1)
            capture.pyte.ByteStream(screen).feed(payload.encode())
            self.assertEqual([screen.buffer[0][column].data for column in range(4)], expected)
            for column, cell in enumerate(expected):
                if cell == " ":
                    self.assertFalse(screen.dim_at(0, column), column)

    def test_dim_wide_nonbottom_autowrap_repairs_its_full_wrapped_span(self):
        screen = capture.DimScreen(4, 3)
        capture.pyte.ByteStream(screen).feed("\x1b[2;1H\x1b[2ma界b\x1b[1;1H\x1b[0m1234語".encode())
        self.assertEqual([screen.buffer[1][column].data for column in range(4)], ["語", "", " ", "b"])
        self.assertFalse(screen.dim_at(1, 2), "the wrapped write must clear its second old destination cell")

    def test_dim_wide_no_autowrap_repairs_its_actual_right_edge_span(self):
        screen = capture.DimScreen(4, 1)
        capture.pyte.ByteStream(screen).feed("\x1b[2ma界b\x1b[0m\x1b[?7l語".encode())
        self.assertEqual([screen.buffer[0][column].data for column in range(4)], ["a", " ", "語", ""])
        self.assertFalse(screen.dim_at(0, 1))
        self.assertFalse(screen.dim_at(0, 2))
        self.assertFalse(screen.dim_at(0, 3))

    def test_dim_insert_mode_shifts_wide_glyphs_without_preclearing_them(self):
        for columns, glyph_dim in ((4, False), (3, True)):
            screen = capture.DimScreen(columns, 1)
            style = "\x1b[2m" if glyph_dim else "\x1b[0m"
            capture.pyte.ByteStream(screen).feed((style + "界\x1b[1G\x1b[0m\x1b[4hZ").encode())
            self.assertEqual(screen.buffer[0][0].data, "Z")
            self.assertEqual(screen.buffer[0][1].data, "界")
            self.assertEqual(screen.buffer[0][2].data, "")
            self.assertFalse(screen.dim_at(0, 0))
            self.assertEqual(screen.dim_at(0, 1), glyph_dim)
            self.assertIn("Z界", re.sub(r"\x1b\[[0-9;]*m", "", capture.render_screen(screen)))

    def test_dim_insert_mode_preserves_wide_glyphs_at_lead_and_continuation_destinations(self):
        for payload, expected, glyph_column, glyph_dim in (
            ("\x1b[2m界A\x1b[2G\x1b[0m\x1b[4hZ", "界ZA", 0, True),
            ("\x1b[0mA界B\x1b[3G\x1b[4hZ", "A界ZB", 1, False),
        ):
            screen = capture.DimScreen(7, 1)
            capture.pyte.ByteStream(screen).feed(payload.encode())
            self.assertEqual(screen.buffer[0][glyph_column].data, "界")
            self.assertEqual(screen.dim_at(0, glyph_column), glyph_dim)
            self.assertIn(expected, re.sub(r"\x1b\[[0-9;]*m", "", capture.render_screen(screen)))

    def test_dim_bottom_autowrap_wide_repair_is_invariant_to_stream_chunks(self):
        for prefix, dim in ((b"1234", False), (b"1234\x1b[2m", True)):
            payload = prefix + "界".encode() + (b"\x1b[0m" if dim else b"") + b"abZ"
            whole = capture.DimScreen(4, 2)
            capture.pyte.ByteStream(whole).feed(payload)
            self.assertEqual(whole.buffer[0][0].data, "界")
            self.assertEqual(whole.buffer[0][2].data, "a")
            self.assertEqual(whole.buffer[0][3].data, "b")
            self.assertEqual(whole.dim_at(0, 0), dim)

            for split_at in range(1, len(payload)):
                split = capture.DimScreen(4, 2)
                stream = capture.pyte.ByteStream(split)
                stream.feed(payload[:split_at])
                stream.feed(payload[split_at:])
                self.assertEqual(capture.render_screen(split), capture.render_screen(whole), split_at)

    def test_dim_nonbottom_autowrap_still_repairs_an_existing_wide_destination(self):
        screen = capture.DimScreen(4, 3)
        stream = capture.pyte.ByteStream(screen)
        stream.feed("\x1b[2;1H\x1b[2m界\x1b[1;1H\x1b[0m1234".encode())
        stream.feed(b"Z")
        self.assertEqual(screen.buffer[1][0].data, "Z")
        self.assertEqual(screen.buffer[1][1].data, " ")
        self.assertFalse(screen.dim_at(1, 0))
        self.assertFalse(screen.dim_at(1, 1))

    def test_dim_no_autowrap_repairs_the_actual_right_edge_overwrite_destination(self):
        screen = capture.DimScreen(4, 2)
        capture.pyte.ByteStream(screen).feed("ab\x1b[2m界\x1b[0m\x1b[?7lZ".encode())
        self.assertEqual(screen.buffer[0][2].data, " ")
        self.assertEqual(screen.buffer[0][3].data, "Z")
        self.assertFalse(screen.dim_at(0, 2))
        self.assertFalse(screen.dim_at(0, 3))

    def test_dim_wide_continuation_overwrite_clears_the_entire_glyph_and_style_at_row_edges(self):
        for payload, leading, trailing in (
            ("\x1b[2m界\x1b[2G\x1b[0mZ", 0, 1),
            ("\x1b[2mab界\x1b[4G\x1b[0mZ", 2, 3),
        ):
            screen = capture.DimScreen(4, 1)
            capture.pyte.ByteStream(screen).feed(payload.encode())
            self.assertEqual(screen.buffer[0][leading].data, " ")
            self.assertFalse(screen.dim_at(0, leading))
            self.assertEqual(screen.buffer[0][trailing].data, "Z")
            self.assertFalse(screen.dim_at(0, trailing))
            self.assertNotIn("界", capture.render_screen(screen))

    def test_capture_writes_expected_frames_for_live_child(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = self.run_capture(
                "wait:0.05\nframe:dim\n",
                self.live_child_command("import sys,time; sys.stdout.write('\x1b[2mdim\x1b[0m'); sys.stdout.flush()"),
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
                self.partial_child_command("print('ready', flush=True)"),
                root / "partial",
            )
            self.assertNotEqual(partial.returncode, 0)
            self.assertIn("pty closed", partial.stderr)

    def test_diff_rejects_missing_empty_and_allowlisted_missing_counterparts(self):
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
            allow.write_text("golden/01-x.ansi sha256:" + "0" * 64 + " F0-1 — temporary\n", encoding="utf-8")
            missing_counterpart = self.run_diff(golden, ours, allow)
            self.assertNotEqual(missing_counterpart.returncode, 0)
            self.assertIn("DIVERGENT", missing_counterpart.stdout)
            self.assertIn("not a divergent masked comparison", missing_counterpart.stdout)

    def test_tracked_allowlist_template_has_no_active_entry(self):
        self.assertEqual(diff.load_allowlist(str(ROOT / "test" / "fixtures" / "upstream-frames" / "allowlist.md")), {})

    def test_diff_allowlists_only_the_exact_reviewed_masked_fingerprint(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden, ours = root / "golden", root / "ours"
            golden.mkdir(); ours.mkdir()
            (golden / "01-x.ansi").write_text("golden text\n", encoding="utf-8")
            (ours / "01-x.ansi").write_text("reviewed difference\n", encoding="utf-8")
            divergent = self.run_diff(golden, ours)
            self.assertNotEqual(divergent.returncode, 0)
            match = re.search(r"fingerprint: sha256:([0-9a-f]{64})", divergent.stdout)
            self.assertIsNotNone(match, divergent.stdout)
            allow = root / "allowlist.md"
            allow.write_text(f"golden/01-x.ansi sha256:{match.group(1)} F0-1 — accepted content difference\n", encoding="utf-8")
            allowed = self.run_diff(golden, ours, allow)
            self.assertEqual(allowed.returncode, 0, allowed.stdout + allowed.stderr)
            self.assertIn("0 clean, 1 allowlisted, 0 DIVERGENT", allowed.stdout)

            (ours / "01-x.ansi").write_text("unrelated visible regression\n", encoding="utf-8")
            stale = self.run_diff(golden, ours, allow)
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn("DIVERGENT", stale.stdout)
            self.assertIn("fingerprint is stale", stale.stdout)
            self.assertIn("fingerprint: sha256:", stale.stdout)

    def test_diff_fingerprint_is_stable_after_frame_scoped_masks(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden, ours = root / "golden", root / "ours"
            golden.mkdir(); ours.mkdir()
            masks = root / "masks.json"
            masks.write_text(json.dumps({"by_frame": {
                "golden/01-x.ansi": [{"pattern": "nonce=[0-9]+", "replacement": "▒"}],
            }}), encoding="utf-8")
            (golden / "01-x.ansi").write_text("golden nonce=1\n", encoding="utf-8")
            (ours / "01-x.ansi").write_text("ours nonce=2\n", encoding="utf-8")
            first = self.run_diff(golden, ours, masks=masks)
            first_match = re.search(r"fingerprint: sha256:([0-9a-f]{64})", first.stdout)
            self.assertIsNotNone(first_match, first.stdout)
            (golden / "01-x.ansi").write_text("golden nonce=3\n", encoding="utf-8")
            (ours / "01-x.ansi").write_text("ours nonce=4\n", encoding="utf-8")
            second = self.run_diff(golden, ours, masks=masks)
            second_match = re.search(r"fingerprint: sha256:([0-9a-f]{64})", second.stdout)
            self.assertIsNotNone(second_match, second.stdout)
            self.assertEqual(first_match.group(1), second_match.group(1))

    def test_diff_rejects_malformed_or_missing_allowlist_digests(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden, ours = root / "golden", root / "ours"
            golden.mkdir(); ours.mkdir()
            (golden / "01-x.ansi").write_text("golden\n", encoding="utf-8")
            (ours / "01-x.ansi").write_text("golden\n", encoding="utf-8")
            for entry in (
                "golden/01-x.ansi F0-1 — missing digest\n",
                "golden/01-x.ansi sha256:not-a-digest F0-1 — malformed digest\n",
                "golden/01-x.ans sha256:0000000000000000000000000000000000000000000000000000000000000000 F0-1 — malformed extension\n",
            ):
                with self.subTest(entry=entry):
                    allow = root / "allowlist.md"
                    allow.write_text(entry, encoding="utf-8")
                    result = self.run_diff(golden, ours, allow)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ERROR: invalid allowlist entry", result.stdout)
                    self.assertIn("sha256:<64 lowercase hex>", result.stdout)

    def test_frame_emulator_dependencies_are_exactly_pinned_and_documented(self):
        self.assertEqual(
            FRAME_REQUIREMENTS_PATH.read_text(encoding="utf-8"),
            "pyte==0.8.2\nwcwidth==0.8.2\n",
        )
        install = "pip install -r scripts/frames/requirements.txt"
        self.assertIn(install, CAPTURE_PATH.read_text(encoding="utf-8"))
        version = (ROOT / "test" / "fixtures" / "upstream-frames" / "VERSION").read_text(encoding="utf-8")
        self.assertIn(install, version)
        plan = F0_PLAN_PATH.read_text(encoding="utf-8")
        self.assertIn(install, plan)
        self.assertNotIn("pip install pyte", plan)

    def test_successful_synthetic_children_use_one_scheduler_robust_keepalive(self):
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertIn("LIVE_CHILD_KEEPALIVE_SECONDS = 5", source)
        self.assertIn("PARTIAL_CHILD_KEEPALIVE_SECONDS = 0.15", source)
        self.assertEqual(len(re.findall(r"self\.live_child_command\(", source)), 16)
        self.assertEqual(len(re.findall(r"self\.partial_child_command\(", source)), 2)
        self.assertIn("self.dead_child_command()", source)
        self.assertNotIn("self." + "child_command(", source)


if __name__ == "__main__":
    unittest.main()
