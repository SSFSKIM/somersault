import importlib.util
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
CAPTURE_PATH = ROOT / "scripts" / "capture-frames.py"
DIFF_PATH = ROOT / "scripts" / "frame-diff.py"
MASKS_PATH = ROOT / "scripts" / "frames" / "masks.json"
FRAME_REQUIREMENTS_PATH = ROOT / "scripts" / "frames" / "requirements.txt"
F1_UPSTREAM_READ_KEYS = ROOT / "scripts" / "frames" / "f1-upstream-read.keys"
F1_KEY = "f1-tool-rendering/01-read-complete.ansi"
F1_GOLDEN_PATH = ROOT / "test" / "fixtures" / "upstream-frames" / F1_KEY
F0_PLAN_PATH = ROOT.parent / "docs" / "superpowers" / "plans" / "2026-07-31-tui-clone-f0.md"
LIVE_CHILD_KEEPALIVE_SECONDS = 5
PARTIAL_CHILD_KEEPALIVE_SECONDS = 0.15


def visible_text(text: str) -> str:
    return re.sub(r"\x1b\[[0-?]*[ -/]*m", "", text)


def f1_spinner_row(glyph: str, verb: str, seconds: str, tokens: str, pad: int, glyph_color: str, verb_color: str) -> str:
    """The live spinner row as 2.1.220 paints it. Every span varies between runs of the identical capture:
    the glyph cycles, its gradient animates, the verb is randomized, and the counters keep counting — which
    also moves the right padding, since the verb's width changes."""
    return (
        f"\x1b[0;2;38;2;{glyph_color}m{glyph}\x1b[0;2m \x1b[0;2;38;2;{verb_color}m{verb}…"
        f"\x1b[0;2;38;2;{glyph_color}m \x1b[0;2;38;2;153;153;153m({seconds}s · ↓\x1b[0;2m "
        f"\x1b[0;2;38;2;153;153;153m{tokens} tokens)\x1b[0;2m{' ' * pad}\x1b[0m"
    )


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


capture = load_module(CAPTURE_PATH, "capture_frames")
diff = load_module(DIFF_PATH, "frame_diff")


def synthetic_required_state(frame_keys: tuple[str, ...], marker: str) -> dict[str, object]:
    return {
        key: {"required": [{"name": "synthetic-logged-out", "pattern": marker, "minimum_matches": 1}]}
        for key in frame_keys
    }


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

    def synthetic_version(self) -> str:
        version = subprocess.run([sys.executable, "--version"], text=True, capture_output=True, check=True)
        return (version.stdout or version.stderr).strip()

    def run_capture(self, script: str, binary: str, out: Path, redact_masks: Path | None = None, script_parent: Path | None = None, cwd: Path | None = None, expected_version: str | None = None, env: dict[str, str] | None = None, cols: int = 100, rows: int = 40, tracked_oauth: bool = False):
        script_path = (script_parent or out.parent) / "case.keys"
        script_path.parent.mkdir(parents=True, exist_ok=True)
        script_path.write_text(textwrap.dedent(script), encoding="utf-8")
        args = [sys.executable, str(CAPTURE_PATH), "--script", str(script_path), "--out", str(out), "--bin", binary, "--cwd", str(cwd or out.parent), "--cols", str(cols), "--rows", str(rows)]
        if redact_masks is not None:
            args += ["--redact-masks", str(redact_masks)]
        if expected_version is not None:
            args += ["--expected-version", expected_version]
        if tracked_oauth:
            args += ["--tracked-oauth"]
        return subprocess.run(args, text=True, capture_output=True, env=env)

    def run_diff(self, golden: Path, ours: Path, allowlist: Path | None = None, masks: Path = MASKS_PATH):
        args = [sys.executable, str(DIFF_PATH), str(golden), str(ours), "--masks", str(masks)]
        if allowlist is not None:
            args += ["--allowlist", str(allowlist)]
        return subprocess.run(args, text=True, capture_output=True)

    def wait_for_pid_exit(self, pid: int, timeout: float = 1) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], text=True, capture_output=True, check=False).stdout.strip()
            if not state or state.startswith("Z"):
                return True
            time.sleep(0.01)
        return False

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
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "new/scenario/01-frame.ansi": {"patterns": [], "identity_guards": [], "minimum_matches": 0},
                },
                "by_frame": {
                    "new/scenario/01-frame.ansi": [{"pattern": "SECRET-[A-Z]+", "replacement": "▒"}],
                },
            }), encoding="utf-8")

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

    def test_tracked_diff_requires_a_declared_redaction_contract_before_diagnostics(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "new-scenario"
            ours = root / "ours"
            golden.mkdir(parents=True); ours.mkdir()
            (golden / "01-frame.ansi").write_text("Alice alice@example.test\n", encoding="utf-8")
            (ours / "01-frame.ansi").write_text("Bob bob@example.test\n", encoding="utf-8")
            masks = root / "masks.json"
            masks.write_text(json.dumps({"redactions_by_frame": {}, "by_frame": {}}), encoding="utf-8")

            compared = self.run_diff(golden, ours, masks=masks)
            output = compared.stdout + compared.stderr
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("no redaction contract declared for tracked frame", output)
            for private in ("Alice", "alice@example.test", "Bob", "bob@example.test"):
                self.assertNotIn(private, output)
            self.assertNotIn("fingerprint: sha256:", output)
            self.assertNotIn("@@", output)

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

    def test_dim_dashboard_organization_round_trip_and_unsupported_boundary_fails_closed(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        raw = (
            "\x1b[0;2;38;2;215;119;87m│\x1b[0m  "
            "\x1b[0;2;38;2;153;153;153midentity.fixture@example.test\x1b[0m's Organization\x1b[0m  "
            "\x1b[0;2;38;2;215;119;87m│\x1b[0m  "
            "\x1b[0;2;3;38;2;153;153;153m/release-notes\x1b[0m\n"
            "Not logged in · Run /login\n"
        )
        expected = raw.replace("\x1b[0;2;38;2;153;153;153midentity.fixture@example.test\x1b[0m", "▒")
        redacted, failures = capture.redact_text(raw, contract)
        self.assertEqual(redacted, expected)
        self.assertEqual(failures, [])

        unsupported = raw.replace("\x1b[0;2;3;", "\x1b[0;1;2;3;")
        redacted, failures = capture.redact_text(unsupported, contract)
        self.assertEqual(redacted, unsupported)
        self.assertEqual(failures, ["unredacted identity organization-email"])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command(f"import sys; sys.stdout.write({unsupported!r}); sys.stdout.flush()")
            refused = self.run_capture("frame:boot\n", child, tracked, MASKS_PATH, expected_version=self.synthetic_version())
            self.assertNotEqual(refused.returncode, 0, refused.stderr)
            self.assertIn("unredacted identity organization-email", refused.stderr)
            self.assertFalse(list(tracked.glob("*.ansi")))

    def test_status_identity_scope_requires_dashboard_footer_chrome(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        transcript_rows = (
            "  alice@host:/repo\n",
            "\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo\n",
            "  git@host:/repo\n",
        )
        for transcript in transcript_rows:
            with self.subTest(transcript=transcript.startswith("  git@")):
                redacted, failures = capture.redact_text(transcript, contract)
                self.assertEqual(redacted, transcript)
                self.assertEqual(failures, [])

        dashboard = (
            "\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
            "\x1b[0m  \x1b[0;2;38;2;153;153;153m⏸ manual mode on · ? for shortcuts · ← for agents\x1b[0m\n"
        )
        expected = dashboard.replace("alice@host", "▒")
        redacted, failures = capture.redact_text(dashboard, contract)
        self.assertEqual(redacted, expected)
        self.assertEqual(failures, [])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            status_identity = "status" + "a" * 44 + "@host-name"
            split_status_identity = status_identity.replace("@", "\x1b[31m@")
            payload = (
                f"\x1b[5;1H\x1b[0m  {split_status_identity}\x1b[0m:\x1b[0m/path"
                "\x1b[7;1H\x1b[0m  \x1b[0;2;38;2;153;153;153m⏸ manual mode on · ? for shortcuts · ← for agents"
                "\x1b[9;1HNot logged in · Run /login"
            )
            child = self.live_child_command(f"import sys; sys.stdout.write({payload!r}); sys.stdout.flush()")
            refused = self.run_capture(
                "frame:boot\n", child, tracked, MASKS_PATH,
                expected_version=self.synthetic_version(), cols=60, rows=10,
            )
            self.assertNotEqual(refused.returncode, 0, refused.stderr)
            self.assertIn("unredacted identity status-user-host", refused.stderr)
            self.assertFalse(list(tracked.glob("*.ansi")))

    def test_dashboard_status_block_redacts_arbitrary_wrapped_rows_for_publication_and_diff(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        identity = "wrapped-status@host"
        raw_status = (
            f"\x1b[0m  {identity}\x1b[0m:\x1b[0m/path-one\x1b[0m\n"
            "\x1b[0m  /path-two\x1b[0m\n"
            "\x1b[0m  /path-three\x1b[0m\n"
            "\x1b[0m  /path-four\x1b[0m\n"
            "\x1b[0m  \x1b[0;2m⏵⏵ auto mode on · ? for shortcuts · ← for agents\x1b[0m\n"
        )
        expected = raw_status.replace(identity, "▒")
        redacted, failures = capture.preprocess_frame_for_publication(raw_status, contract)
        self.assertEqual(redacted, expected)
        self.assertEqual(failures, [])

        transcript = "const remote = 'wrapped-status@host:/repo'; // no dashboard chrome\n"
        redacted, failures = capture.redact_text(transcript, contract)
        self.assertEqual(redacted, transcript)
        self.assertEqual(failures, [])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            path = "/" + "a" * 106
            payload = (
                f"\x1b[1;1H\x1b[0m  {identity}\x1b[0m:\x1b[0m{path}"
                "\x1b[5;1H\x1b[0m  \x1b[0;2m⏵⏵ auto mode on · ? for shortcuts · ← for agents"
                "\x1b[8;1HNot logged in · Run /login"
            )
            captured = self.run_capture(
                "frame:boot\n",
                self.live_child_command(f"import sys; sys.stdout.write({payload!r}); sys.stdout.flush()"),
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
                cols=32,
                rows=8,
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            published = (tracked / "01-boot.ansi").read_text(encoding="utf-8")
            self.assertNotIn(identity, re.sub(r"\x1b\[[0-?]*[ -/]*m", "", published))

            ours = root / "scratch"
            ours.mkdir()
            (tracked / "01-boot.ansi").write_text(expected + "semantic=before\n", encoding="utf-8")
            (ours / "01-boot.ansi").write_text(raw_status + "semantic=after\n", encoding="utf-8")
            compared = self.run_diff(tracked, ours)
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("fingerprint: sha256:", compared.stdout)
            self.assertNotIn(identity, compared.stdout + compared.stderr)

    def test_only_nearest_dashboard_status_identity_is_masked_and_transcript_differences_stay_private(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        comparison_masks = diff.load_comparison_masks(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        marker = "\x1b[0m  \x1b[0;2m⏵⏵ auto mode on · ? for shortcuts · ← for agents\x1b[0m\n"
        dashboard = "\x1b[0m  dashboard@host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + marker
        golden_raw = "\x1b[0m  transcript-left@host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + dashboard
        ours_raw = "\x1b[0m  transcript-right@host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + dashboard

        golden_lines, golden_failures = diff.sanitize_frame_for_comparison(golden_raw, contract, comparison_masks)
        ours_lines, ours_failures = diff.sanitize_frame_for_comparison(ours_raw, contract, comparison_masks)
        self.assertEqual(golden_failures, [])
        self.assertEqual(ours_failures, [])
        self.assertIn("transcript-left@host", "\n".join(golden_lines))
        self.assertIn("transcript-right@host", "\n".join(ours_lines))
        self.assertNotEqual(golden_lines, ours_lines)

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "ours"
            golden.mkdir(parents=True); ours.mkdir()
            (golden / "01-boot.ansi").write_text(golden_raw, encoding="utf-8")
            (ours / "01-boot.ansi").write_text(ours_raw, encoding="utf-8")
            compared = self.run_diff(golden, ours)
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("DIVERGENT", compared.stdout)
            for identity in ("transcript-left@host", "transcript-right@host", "dashboard@host"):
                self.assertNotIn(identity, compared.stdout + compared.stderr)

    def test_diff_redacts_wrapped_transcript_identity_fragments_after_status_masking(self):
        marker = "\x1b[0m  \x1b[0;2m⏵⏵ auto mode on · ? for shortcuts · ← for agents\x1b[0m\n"
        dashboard = "\x1b[0m  dashboard@host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + marker
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "ours"
            golden.mkdir(parents=True); ours.mkdir()
            (golden / "01-boot.ansi").write_text(
                "\x1b[0m  transcript-left\n@private-host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + dashboard,
                encoding="utf-8",
            )
            (ours / "01-boot.ansi").write_text(
                "\x1b[0m  transcript-right\n@private-host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + dashboard,
                encoding="utf-8",
            )
            compared = self.run_diff(golden, ours)
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("DIVERGENT", compared.stdout)
            for fragment in ("transcript-left", "transcript-right", "@private-host"):
                self.assertNotIn(fragment, compared.stdout + compared.stderr)

    def test_diff_redacts_ansi_split_transcript_identity_fragments_after_status_masking(self):
        marker = "\x1b[0m  \x1b[0;2m⏵⏵ auto mode on · ? for shortcuts · ← for agents\x1b[0m\n"
        dashboard = "\x1b[0m  dashboard@host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + marker
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "ours"
            golden.mkdir(parents=True); ours.mkdir()
            (golden / "01-boot.ansi").write_text(
                "\x1b[0m  transcript-\x1b[31mleft@private-host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + dashboard,
                encoding="utf-8",
            )
            (ours / "01-boot.ansi").write_text(
                "\x1b[0m  transcript-\x1b[31mright@private-host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + dashboard,
                encoding="utf-8",
            )
            compared = self.run_diff(golden, ours)
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("DIVERGENT", compared.stdout)
            visible_output = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", compared.stdout + compared.stderr)
            for fragment in ("transcript-", "left", "right", "@private-host"):
                self.assertNotIn(fragment, visible_output)

    def test_diff_diagnostic_redaction_covers_component_wrap_matrix_without_changing_divergence(self):
        marker = "\x1b[0m  \x1b[0;2m⏵⏵ auto mode on · ? for shortcuts · ← for agents\x1b[0m\n"
        dashboard = "\x1b[0m  dashboard@host\x1b[0m:\x1b[0m/repo\x1b[0m\n" + marker
        cases = {
            "inside-username": ("transcript-\nleft@private-host:/repo", "transcript-\nright@private-host:/repo"),
            "before-at": ("transcript-left\n@private-host:/repo", "transcript-right\n@private-host:/repo"),
            "after-at": ("transcript-left@\nprivate-host:/repo", "transcript-right@\nprivate-host:/repo"),
            "inside-hostname": ("transcript-left@private_\nhost-name:/repo", "transcript-right@private_\nhost-name:/repo"),
            "before-path": ("transcript-left@private-host\n:/repo", "transcript-right@private-host\n:/repo"),
            "sgr-and-wrap": ("transcript-\x1b[31mleft@private-\n\x1b[2mhost:/repo", "transcript-\x1b[31mright@private-\n\x1b[2mhost:/repo"),
        }
        for name, (left, right) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
                ours = root / "ours"
                golden.mkdir(parents=True); ours.mkdir()
                golden_raw = f"\x1b[0m  {left}\x1b[0m\n" + dashboard
                ours_raw = f"\x1b[0m  {right}\x1b[0m\n" + dashboard
                golden_lines, golden_failures = diff.sanitize_frame_for_comparison(
                    golden_raw, capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi"),
                    diff.load_comparison_masks(str(MASKS_PATH), "help-overlay/01-boot.ansi"),
                )
                ours_lines, ours_failures = diff.sanitize_frame_for_comparison(
                    ours_raw, capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi"),
                    diff.load_comparison_masks(str(MASKS_PATH), "help-overlay/01-boot.ansi"),
                )
                self.assertEqual(golden_failures, [])
                self.assertEqual(ours_failures, [])
                self.assertNotEqual(golden_lines, ours_lines)
                (golden / "01-boot.ansi").write_text(golden_raw, encoding="utf-8")
                (ours / "01-boot.ansi").write_text(ours_raw, encoding="utf-8")
                compared = self.run_diff(golden, ours)
                self.assertNotEqual(compared.returncode, 0)
                self.assertIn("DIVERGENT", compared.stdout)
                self.assertIn("fingerprint: sha256:", compared.stdout)
                visible = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", compared.stdout + compared.stderr)
                for fragment in ("transcript", "left", "right", "private", "host", "name"):
                    self.assertNotIn(fragment, visible)

    def test_dashboard_status_variant_matrix_redacts_authenticated_chrome_without_touching_transcripts(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        fixture_root = ROOT / "test" / "fixtures" / "upstream-frames"
        fixture_footers = {
            "help-overlay/01-boot.ansi": " · ? for shortcuts · ← for agents",
            "help-overlay/02-help.ansi": None,
            "help-overlay/03-closed.ansi": " · ? for shortcuts · ← for agents",
            "composer-basics/01-typed.ansi": "",
            "composer-basics/02-esc-armed.ansi": "",
            "composer-basics/03-cleared.ansi": " · ? for shortcuts · ← for agents",
            "composer-basics/04-killed.ansi": " · ? for shortcuts · ← for agents",
            "composer-basics/05-yanked.ansi": "",
            "f1-tool-rendering/01-read-complete.ansi": "",
        }
        self.assertEqual(set(fixture_footers), {str(path.relative_to(fixture_root)) for path in fixture_root.glob("*/*.ansi")})
        for fixture, footer in fixture_footers.items():
            visible = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", (fixture_root / fixture).read_text(encoding="utf-8"))
            with self.subTest(fixture=fixture):
                self.assertEqual("⏸ manual mode on" in visible, footer is not None)
            if footer is None:
                continue
            for username in ("alice", "git"):
                dashboard = (
                    f"\x1b[0m  {username}@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                    f"\x1b[0m  \x1b[0;2m⏸ manual mode on{footer}\x1b[0m\n"
                )
                with self.subTest(fixture=fixture, username=username):
                    redacted, failures = capture.redact_text(dashboard, contract)
                    self.assertEqual(redacted, dashboard.replace(f"{username}@host", "▒"))
                    self.assertEqual(failures, [])

        for username in ("alice", "git"):
            split = (
                f"\x1b[0m  {username[:1]}\x1b[31m{username[1:]}\x1b[0m@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                "\x1b[0m  \x1b[0;2m⏸ manual mode on\x1b[0m\n"
            )
            redacted, failures = capture.redact_text(split, contract)
            self.assertEqual(redacted, split)
            self.assertEqual(failures, ["unredacted identity status-user-host"])

        wrapped = "  wrappedidentity\n@host:/repo\n  ⏸ manual mode on\n"
        redacted, failures = capture.redact_text(wrapped, contract)
        self.assertEqual(redacted, wrapped)
        self.assertEqual(failures, ["unredacted identity status-user-host"])

        for username in ("alice", "git"):
            for transcript in (
                f"  {username}@host:/repo\n",
                f"\x1b[0m  {username}@host\x1b[0m:\x1b[0m/repo\n",
                f"const remote = '{username}@host:/repo'; // no dashboard chrome\n",
            ):
                with self.subTest(transcript=transcript):
                    redacted, failures = capture.redact_text(transcript, contract)
                    self.assertEqual(redacted, transcript)
                    self.assertEqual(failures, [])

    def test_dashboard_status_modes_redact_exact_2_1_220_markers_and_reject_unknown_markers(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        full_footer = " · ? for shortcuts · ← for agents"
        modes = {
            "default/manual": "⏸ manual mode on",
            "plan": "⏸ plan mode on",
            "acceptEdits": "⏵⏵ accept edits on",
            "bypassPermissions": "⏵⏵ bypass permissions on",
            "dontAsk": "⏵⏵ don't ask on",
            "auto": "⏵⏵ auto mode on",
        }
        exact_cases = [
            ("default/manual reduced", modes["default/manual"], ""),
            ("default/manual full", modes["default/manual"], full_footer),
            ("plan", modes["plan"], ""),
            ("auto cycle suffix", modes["auto"] + " (shift+tab to cycle)", ""),
            ("acceptEdits", modes["acceptEdits"], full_footer),
            ("bypassPermissions", modes["bypassPermissions"], ""),
            ("dontAsk", modes["dontAsk"], ""),
            ("auto reduced", modes["auto"], ""),
            ("auto full", modes["auto"], full_footer),
        ]
        for name, marker, footer in exact_cases:
            for username in ("alice", "git"):
                dashboard = (
                    f"\x1b[0m  {username}@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                    f"\x1b[0m  \x1b[0;2m{marker}{footer}\x1b[0m\n"
                )
                with self.subTest(name=name, username=username):
                    redacted, failures = capture.redact_text(dashboard, contract)
                    self.assertEqual(redacted, dashboard.replace(f"{username}@host", "▒"))
                    self.assertEqual(failures, [])

        for name, marker in modes.items():
            ansi_split = (
                f"\x1b[0m  g\x1b[31mit\x1b[0m@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                f"\x1b[0m  \x1b[0;2m{marker}\x1b[0m\n"
            )
            row_wrapped = f"  git\n@host:/repo\n  {marker}\n"
            for form, dashboard in (("ansi-split", ansi_split), ("row-wrapped", row_wrapped)):
                with self.subTest(name=name, form=form):
                    redacted, failures = capture.redact_text(dashboard, contract)
                    self.assertEqual(redacted, dashboard)
                    self.assertEqual(failures, ["unredacted identity status-user-host"])

        unknown_marker = "⏵⏵ review mode on"
        unknown_dashboard = f"  git@host:/repo\n  {unknown_marker}\n"
        redacted, failures = capture.redact_text(unknown_dashboard, contract)
        self.assertEqual(redacted, unknown_dashboard)
        self.assertEqual(failures, ["unredacted identity status-user-host"])
        transcript = f"const remote = 'git@host:/repo'; // {unknown_marker} without dashboard chrome\n"
        redacted, failures = capture.redact_text(transcript, contract)
        self.assertEqual(redacted, transcript)
        self.assertEqual(failures, [])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "scratch"
            golden.mkdir(parents=True); ours.mkdir()
            for name, marker, footer in (
                ("manual", modes["default/manual"], full_footer),
                ("auto", modes["auto"], ""),
            ):
                raw = (
                    "\x1b[0m  git@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                    f"\x1b[0m  \x1b[0;2m{marker}{footer}\x1b[0m\n"
                )
                (golden / "01-boot.ansi").write_text(raw.replace("git@host", "▒"), encoding="utf-8")
                (ours / "01-boot.ansi").write_text(raw, encoding="utf-8")
                with self.subTest(name=f"diff {name}"):
                    compared = self.run_diff(golden, ours)
                    self.assertEqual(compared.returncode, 0, compared.stdout + compared.stderr)
                    self.assertIn("1 clean, 0 allowlisted, 0 DIVERGENT", compared.stdout)
                    self.assertNotIn("git@host", compared.stdout + compared.stderr)

    def test_padded_or_clipped_footer_status_identity_is_private_for_capture_and_diff(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        mode = "⏸ manual mode on"
        account = "Not logged in · Run /login"
        footer_forms = {
            "reduced": mode,
            "full": mode + " · ? for shortcuts · ← for agents",
            "clipped": mode + " · ? for shortcuts …",
            "wrapped-prefix": mode + " · ? for shortc",
            "padded": mode + " " * 14 + account,
            "full-padded": mode + " · ? for shortcuts · ← for agents" + " " * 4 + account,
        }
        for name, footer in footer_forms.items():
            dashboard = (
                "\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                f"\x1b[0m  \x1b[0;2m{footer}\x1b[0m\n"
            )
            with self.subTest(name=name):
                redacted, failures = capture.preprocess_frame_for_publication(dashboard, contract)
                self.assertEqual(redacted, dashboard.replace("alice@host", "▒"))
                self.assertEqual(failures, [])

        padded = footer_forms["padded"]
        unknown_dashboard = (
            "\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
            f"\x1b[0m  \x1b[0;2m⏵⏵ review mode on{' ' * 14}{account}\x1b[0m\n"
        )
        redacted, failures = capture.preprocess_frame_for_publication(unknown_dashboard, contract)
        self.assertEqual(redacted, unknown_dashboard)
        self.assertEqual(failures, ["unredacted identity status-user-host"])

        transcript = f"const remote = 'alice@host:/repo'; // {padded} without dashboard chrome\n"
        redacted, failures = capture.preprocess_frame_for_publication(transcript, contract)
        self.assertEqual(redacted, transcript)
        self.assertEqual(failures, [])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            payload = (
                "\x1b[5;1H\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo"
                f"\x1b[6;1H\x1b[0m  \x1b[0;2m{padded}\x1b[0m"
            )
            captured = self.run_capture(
                "frame:boot\n",
                self.live_child_command(f"import sys; sys.stdout.write({payload!r}); sys.stdout.flush()"),
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
                cols=100,
                rows=10,
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            published = (tracked / "01-boot.ansi").read_text(encoding="utf-8")
            self.assertNotIn("alice@host", re.sub(r"\x1b\[[0-?]*[ -/]*m", "", published))

            ours = root / "ours"
            ours.mkdir()
            raw = (
                "\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                f"\x1b[0m  \x1b[0;2m{padded}\x1b[0m\n"
            )
            (tracked / "01-boot.ansi").write_text(raw.replace("alice@host", "▒") + "semantic=before\n", encoding="utf-8")
            (ours / "01-boot.ansi").write_text(raw + "semantic=after\n", encoding="utf-8")
            compared = self.run_diff(tracked, ours)
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("fingerprint: sha256:", compared.stdout)
            self.assertNotIn("alice@host", compared.stdout + compared.stderr)

    def test_dashboard_hostname_underscore_is_private_but_transcripts_remain_semantic(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        footer = "⏸ manual mode on · ? for shortcuts · ← for agents"
        dashboard = (
            "\x1b[0m  alice@host_name\x1b[0m:\x1b[0m/repo\x1b[0m\n"
            f"\x1b[0m  \x1b[0;2m{footer}\x1b[0m\n"
        )
        redacted, failures = capture.preprocess_frame_for_publication(dashboard, contract)
        self.assertEqual(redacted, dashboard.replace("alice@host_name", "▒"))
        self.assertEqual(failures, [])

        split = dashboard.replace("host_name", "host\x1b[31m_name")
        wrapped = (
            "  alice@host_\n"
            "name:/repo\n"
            f"  {footer}\n"
        )
        for form in (split, wrapped):
            with self.subTest(form=form):
                redacted, failures = capture.preprocess_frame_for_publication(form, contract)
                self.assertEqual(redacted, form)
                self.assertEqual(failures, ["unredacted identity status-user-host"])

        for transcript in (
            "  alice@host_name:/repo\n",
            "const remote = 'alice@host_name:/repo'; // no dashboard chrome\n",
            "path/alice@host_name:/repo\n",
        ):
            with self.subTest(transcript=transcript):
                redacted, failures = capture.preprocess_frame_for_publication(transcript, contract)
                self.assertEqual(redacted, transcript)
                self.assertEqual(failures, [])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "ours"
            golden.mkdir(parents=True); ours.mkdir()
            (golden / "01-boot.ansi").write_text("safe\n", encoding="utf-8")
            for name, form in (("split", split), ("wrapped", wrapped)):
                with self.subTest(diff=name):
                    (ours / "01-boot.ansi").write_text(form, encoding="utf-8")
                    compared = self.run_diff(golden, ours)
                    self.assertNotEqual(compared.returncode, 0)
                    self.assertIn("privacy redaction failed", compared.stdout)
                    self.assertNotIn("alice@host_name", compared.stdout + compared.stderr)
                    self.assertNotIn("fingerprint: sha256:", compared.stdout)

    def test_unicode_dashboard_identities_are_private_without_hiding_transcript_differences(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), "help-overlay/01-boot.ansi")
        footer = "⏸ manual mode on · ? for shortcuts · ← for agents"
        dashboard = (
            "\x1b[0m  álïce@høst_name\x1b[0m:\x1b[0m/repo\x1b[0m\n"
            f"\x1b[0m  \x1b[0;2m{footer}\x1b[0m\n"
        )
        redacted, failures = capture.preprocess_frame_for_publication(dashboard, contract)
        self.assertEqual(redacted, dashboard.replace("álïce@høst_name", "▒"))
        self.assertEqual(failures, [])

        wrapped = f"  álï\nce@hø\nst:/repo\n  {footer}\n"
        redacted, failures = capture.preprocess_frame_for_publication(wrapped, contract)
        self.assertEqual(redacted, wrapped)
        self.assertEqual(failures, ["unredacted identity status-user-host"])

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "ours"
            golden.mkdir(parents=True); ours.mkdir()
            dashboard_tail = f"  ▒:/cwd\n  {footer}\n"
            (golden / "01-boot.ansi").write_text("remote álïce@høst:/repo-a\n" + dashboard_tail, encoding="utf-8")
            (ours / "01-boot.ansi").write_text("remote bób@høst:/repo-b\n" + dashboard_tail, encoding="utf-8")
            compared = self.run_diff(golden, ours)
            output = compared.stdout + compared.stderr
            self.assertNotEqual(compared.returncode, 0)
            self.assertIn("DIVERGENT", output)
            for private in ("álïce", "bób", "høst"):
                self.assertNotIn(private, output)

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

    def test_capture_first_frame_drains_a_split_visible_paint_before_publication(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = self.run_capture(
                "frame:boot\n",
                self.live_child_command("import sys,time; sys.stdout.write('r'); sys.stdout.flush(); time.sleep(0.002); sys.stdout.write('eady'); sys.stdout.flush()"),
                root / "split",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("ready", (root / "split" / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_capture_later_frame_drains_a_split_repaint_before_publication(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = self.run_capture(
                "frame:first\nenter\nwait-output:partial\nenter\nwait-output:FRAME-READY\nframe:later\n",
                self.live_child_command(
                    "import os,sys,time; sys.stdout.write('baseline'); sys.stdout.flush(); os.read(0, 1); "
                    "sys.stdout.write('\\rpartial'); sys.stdout.flush(); os.read(0, 1); "
                    "sys.stdout.write('\\x1b]0;FRAME-READY\\x07' + '\\x00' * 4096 + '-complete'); sys.stdout.flush()"
                ),
                root / "split-later",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("baseline", (root / "split-later" / "01-first.ansi").read_text(encoding="utf-8"))
            later = (root / "split-later" / "02-later.ansi").read_text(encoding="utf-8")
            self.assertIn("partial", later)
            self.assertIn("-complete", later)

    def test_capture_wait_output_requires_a_fresh_marker_for_each_action(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            marker = "SYNC-MARKER"
            result = self.run_capture(
                f"wait-output:{marker}\nframe:first\nenter\nwait-output:{marker}\nframe:second\n",
                self.live_child_command(
                    "import os,sys,time; "
                    f"sys.stdout.write('FIRST-READY {marker}'); sys.stdout.flush(); os.read(0, 1); "
                    "time.sleep(0.01); sys.stdout.write('\\rSECOND-PENDING'); sys.stdout.flush(); time.sleep(0.04); "
                    f"sys.stdout.write('\\rSECOND-READY {marker[:-2]}'); sys.stdout.flush(); time.sleep(0.005); "
                    f"sys.stdout.write('{marker[-2:]}'); sys.stdout.flush()"
                ),
                root / "fresh-marker",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("FIRST-READY", (root / "fresh-marker" / "01-first.ansi").read_text(encoding="utf-8"))
            second = (root / "fresh-marker" / "02-second.ansi").read_text(encoding="utf-8")
            self.assertIn("SECOND-READY", second)
            self.assertNotIn("SECOND-PENDING", second)

    def test_wait_output_accepts_an_explicit_timeout_and_defaults_to_the_first_frame_bound(self):
        # `wait-output` used to hard-pass FIRST_FRAME_READY_SECONDS (1.0s) into pump(), which no real
        # model turn can meet, so an authenticated capture would always fail "marker not received".
        self.assertEqual(capture.parse_wait_output("⎿"), ("⎿", capture.FIRST_FRAME_READY_SECONDS))
        self.assertEqual(capture.parse_wait_output("⎿:120"), ("⎿", 120.0))
        self.assertEqual(capture.parse_wait_output("a:b"), ("a:b", capture.FIRST_FRAME_READY_SECONDS))
        self.assertEqual(capture.parse_wait_output("a:b:2.5"), ("a:b", 2.5))
        self.assertIsNone(capture.parse_wait_output(""))
        self.assertIsNone(capture.parse_wait_output(":30"))
        # float() accepts these; an infinite bound would hang pump() instead of failing.
        for bad in ("x:inf", "x:nan", "x:-5", "x:0"):
            self.assertIsNone(capture.parse_wait_output(bad))

    def test_capture_waits_past_the_default_bound_for_an_explicit_wait_output_timeout(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            late = "LATE-MARKER"
            slow = f"import sys,time; time.sleep(1.4); sys.stdout.write('{late}'); sys.stdout.flush()"
            missed = self.run_capture(f"wait-output:{late}\nframe:late\n", self.live_child_command(slow), root / "missed")
            self.assertNotEqual(missed.returncode, 0)
            self.assertIn("wait-output marker not received", missed.stderr)
            waited = self.run_capture(f"wait-output:{late}:8\nframe:late\n", self.live_child_command(slow), root / "waited")
            self.assertEqual(waited.returncode, 0, waited.stderr)
            self.assertIn(late, (root / "waited" / "01-late.ansi").read_text(encoding="utf-8"))
            empty = self.run_capture("wait-output::30\nframe:late\n", self.live_child_command(slow), root / "empty")
            self.assertNotEqual(empty.returncode, 0)
            self.assertIn("wait-output requires a nonempty marker", empty.stderr)

    def test_capture_seeds_a_private_claude_config_without_ambient_auth_or_config(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ambient_config = root / "ambient-config"
            ambient_config.mkdir()
            (ambient_config / "plugin-marker").write_text("ambient", encoding="utf-8")
            home = root / "home"
            (home / ".claude").mkdir(parents=True)
            (home / ".claude" / "settings.json").write_text('{"plugin": "ambient"}', encoding="utf-8")
            executed = root / "ambient-plugin-executed"
            job_dir = root / "job"
            job_dir.mkdir()
            expected_seed = {".claude.json": '{"hasCompletedOnboarding":true}\n'}
            ambient_terminal = {
                "FORCE_COLOR": "2", "NO_COLOR": "1", "CI": "1", "TF_BUILD": "1", "AGENT_NAME": "agent",
                "GITHUB_ACTIONS": "1", "GITEA_ACTIONS": "1", "CIRCLECI": "1", "TRAVIS": "1", "APPVEYOR": "1",
                "GITLAB_CI": "1", "BUILDKITE": "1", "DRONE": "1", "CI_NAME": "codeship", "TEAMCITY_VERSION": "2025.1",
                "TMUX": "/tmp/tmux-0/default", "TERM_PROGRAM": "iTerm.app", "TERM_PROGRAM_VERSION": "2.9", "COLORFGBG": "15;0",
            }

            def probe(report: Path) -> str:
                return textwrap.dedent(f"""
                    import json, os, sys
                    from pathlib import Path
                    config = Path(os.environ["CLAUDE_CONFIG_DIR"])
                    ambient = Path(os.environ["AMBIENT_CONFIG"])
                    home_config = Path(os.environ["HOME"]) / ".claude"
                    if config == ambient:
                        Path(os.environ["PLUGIN_EXECUTED"]).write_text("executed", encoding="utf-8")
                    Path(os.environ["CONFIG_REPORT"]).write_text(json.dumps({{
                        "config": str(config), "config_parent": str(config.parent), "exists": config.is_dir(),
                        "seed_files": {{
                            str(path.relative_to(config)): path.read_text(encoding="utf-8")
                            for path in sorted(config.rglob("*")) if path.is_file()
                        }},
                        "anthropic_variables": sorted(name for name in os.environ if name.startswith("ANTHROPIC_")),
                        "ambient_marker_visible": (config / "plugin-marker").exists(),
                        "different_from_ambient": config != ambient,
                        "different_from_home": config != home_config,
                        "oauth_forwarded": bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")),
                        "colorterm": os.environ.get("COLORTERM"),
                        "ambient_terminal": {{name: os.environ.get(name) for name in {tuple(ambient_terminal)!r}}},
                        "nested_markers_scrubbed": "CLAUDE_CODE_CHILD_SESSION" not in os.environ and "AI_AGENT" not in os.environ,
                    }}), encoding="utf-8")
                    sys.stdout.write("ready"); sys.stdout.flush()
                """)

            base_env = {
                "PATH": os.defpath,
                "CLAUDE_JOB_DIR": str(job_dir),
                "CLAUDE_CONFIG_DIR": str(ambient_config),
                "CLAUDE_CODE_OAUTH_TOKEN": "synthetic-test-token",
                "ANTHROPIC_API_KEY": "synthetic-test-key",
                "ANTHROPIC_AUTH_TOKEN": "synthetic-test-auth-token",
                "ANTHROPIC_BASE_URL": "https://synthetic.invalid",
                "ANTHROPIC_PROFILE": "synthetic-profile",
                "ANTHROPIC_FUTURE_CREDENTIAL": "synthetic-future-secret",
                "CLAUDE_CODE_CHILD_SESSION": "nested",
                "AI_AGENT": "operator",
                "COLORTERM": "synthetic-terminal",
                **ambient_terminal,
                "HOME": str(home),
                "AMBIENT_CONFIG": str(ambient_config),
                "PLUGIN_EXECUTED": str(executed),
            }
            reports = []
            for label, script, command in (
                ("success", "frame:boot\n", self.live_child_command),
                ("failure", "frame:first\nwait:0.3\nframe:second\n", self.partial_child_command),
            ):
                report = root / f"{label}-config.json"
                result = self.run_capture(script, command(probe(report)), root / label, env={**base_env, "CONFIG_REPORT": str(report)})
                self.assertEqual(result.returncode, 0 if label == "success" else 1, result.stderr)
                self.assertTrue(report.exists(), result.stderr)
                recorded = json.loads(report.read_text(encoding="utf-8"))
                reports.append(recorded)
                self.assertTrue(recorded["exists"])
                self.assertEqual(recorded["config_parent"], str(job_dir / "tmp"))
                self.assertEqual(recorded["seed_files"], expected_seed)
                self.assertEqual(recorded["anthropic_variables"], [])
                self.assertTrue(recorded["different_from_ambient"])
                self.assertTrue(recorded["different_from_home"])
                self.assertFalse(recorded["ambient_marker_visible"])
                self.assertTrue(recorded["oauth_forwarded"])
                self.assertEqual(recorded["colorterm"], "synthetic-terminal")
                self.assertEqual(recorded["ambient_terminal"], ambient_terminal)
                self.assertTrue(recorded["nested_markers_scrubbed"])
                self.assertFalse(Path(recorded["config"]).exists(), label)
            self.assertNotEqual(reports[0]["config"], reports[1]["config"])
            self.assertFalse(executed.exists())

    def test_tracked_capture_scrubs_fake_credentials_and_hostile_terminal_environment(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            job_dir = root / "job"; job_dir.mkdir()
            unrelated = {"PREFIX_CI_SUFFIX": "retain-prefix", "VICIOUS": "retain-embedded"}
            hostile_cases = (
                ("force-no-color", {"FORCE_COLOR": "0", "NO_COLOR": "1"}),
                ("legacy-ci", {"CI": "1", "TF_BUILD": "1", "AGENT_NAME": "agent", "GITEA_ACTIONS": "1", "CIRCLECI": "1", "TRAVIS": "1", "APPVEYOR": "1", "BUILDKITE": "1", "DRONE": "1", "CI_NAME": "codeship", "TEAMCITY_VERSION": "2025.1"}),
                ("gitlab", {"GITLAB_CI": "1", "CI_JOB_ID": "gitlab-job"}),
                ("github", {"GITHUB_ACTIONS": "1", "CI_RUN_ID": "github-run"}),
                ("continuous-integration", {"CONTINUOUS_INTEGRATION": "1"}),
                ("generic-ci-prefix", {"CI_CAPTURE_SENTINEL": "generic", "CI_BUILD_ID": "build"}),
                ("terminal-wrapper", {"TMUX": "/tmp/tmux-0/default", "TERM_PROGRAM": "iTerm.app", "TERM_PROGRAM_VERSION": "2.9", "COLORFGBG": "15;0"}),
            )
            hostile_cases += (("combined", dict((name, value) for _, case in hostile_cases for name, value in case.items())),)
            self.assertEqual(len(hostile_cases), 8)
            hostile_names = tuple(sorted(hostile_cases[-1][1]))
            node_version = subprocess.run(["node", "--version"], text=True, capture_output=True, check=True).stdout.strip()
            child_code = textwrap.dedent(f"""
                import {{ writeFileSync }} from "node:fs";
                import React from "react";
                import {{ render, Text }} from "ink";
                import isInCi from "is-in-ci";
                const names = {json.dumps(hostile_names)};
                const unrelated = {json.dumps(tuple(unrelated))};
                const credentials = {{
                  oauth_present: "CLAUDE_CODE_OAUTH_TOKEN" in process.env,
                  api_key_present: "ANTHROPIC_API_KEY" in process.env,
                  auth_token_present: "ANTHROPIC_AUTH_TOKEN" in process.env,
                }};
                writeFileSync(process.env.CAPTURE_REPORT, JSON.stringify({{
                  ...credentials,
                  term: process.env.TERM,
                  colorterm: process.env.COLORTERM,
                  hostile: Object.fromEntries(names.filter(name => name in process.env).map(name => [name, process.env[name]])),
                  unrelated: Object.fromEntries(unrelated.map(name => [name, process.env[name]])),
                  is_in_ci: isInCi,
                }}));
                process.stdout.write(Object.values(credentials).some(Boolean) ? "AUTHENTICATED ACCOUNT STATE" : "Not logged in · Run /login");
                render(React.createElement(Text, null, "INK-DYNAMIC"));
                setTimeout(() => {{}}, 5000);
            """)
            child = f"node --input-type=module -e {shlex.quote(child_code)}"
            published = []
            for label, hostile_env in hostile_cases:
                report = root / f"child-{label}.json"
                captured = self.run_capture(
                    "frame:boot\n", child, tracked, MASKS_PATH, cwd=ROOT,
                    expected_version=node_version,
                    env={
                        "PATH": os.environ["PATH"],
                        "CLAUDE_JOB_DIR": str(job_dir),
                        "CAPTURE_REPORT": str(report),
                        "CLAUDE_CODE_OAUTH_TOKEN": "synthetic-oauth",
                        "ANTHROPIC_API_KEY": "synthetic-api-key",
                        "ANTHROPIC_AUTH_TOKEN": "synthetic-auth-token",
                        **unrelated,
                        **hostile_env,
                    },
                )
                self.assertEqual(captured.returncode, 0, captured.stderr)
                self.assertEqual(json.loads(report.read_text(encoding="utf-8")), {
                    "oauth_present": False, "api_key_present": False, "auth_token_present": False,
                    "term": "xterm-256color", "colorterm": "truecolor", "hostile": {},
                    "unrelated": unrelated, "is_in_ci": False,
                })
                frame = (tracked / "01-boot.ansi").read_bytes()
                self.assertIn(b"Not logged in \xc2\xb7 Run /login", frame)
                self.assertIn(b"INK-DYNAMIC", frame)
                self.assertNotIn(b"AUTHENTICATED ACCOUNT STATE", frame)
                published.append(frame)
            self.assertEqual(published, [published[0]] * len(published))

    def test_untracked_capture_preserves_generic_ci_selectors(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            report = root / "child.json"
            ambient = {"CONTINUOUS_INTEGRATION": "1", "CI_CAPTURE_SENTINEL": "generic", "PREFIX_CI_SUFFIX": "retain-prefix"}
            child = self.live_child_command(textwrap.dedent("""
                import json, os, sys
                from pathlib import Path
                names = ("CONTINUOUS_INTEGRATION", "CI_CAPTURE_SENTINEL", "PREFIX_CI_SUFFIX")
                Path(os.environ["CAPTURE_REPORT"]).write_text(json.dumps({name: os.environ.get(name) for name in names}), encoding="utf-8")
                sys.stdout.write("ready"); sys.stdout.flush()
            """))
            captured = self.run_capture(
                "frame:boot\n", child, root / "scratch",
                env={"PATH": os.defpath, "CAPTURE_REPORT": str(report), **ambient},
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            self.assertEqual(json.loads(report.read_text(encoding="utf-8")), ambient)

    def test_tracked_oauth_is_explicit_and_preserves_only_the_oauth_token(self):
        env = {
            "PATH": os.environ["PATH"], "CLAUDE_CODE_OAUTH_TOKEN": "oauth-fixture-secret",
            "ANTHROPIC_API_KEY": "api-fixture-secret", "ANTHROPIC_AUTH_TOKEN": "auth-fixture-secret",
            "ANTHROPIC_BASE_URL": "https://gateway.example.invalid", "CLAUDE_CODE_USE_VERTEX": "1",
            "CLAUDE_CODE_SESSION_ID": "parent", "AI_AGENT": "1",
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(capture.validate_tracked_oauth(True, False, os.environ), None)
            self.assertEqual(capture.validate_tracked_oauth(True, True, os.environ), None)
            child = capture.clean_child_env(True, True)
            logged_out = capture.clean_child_env(True)
        self.assertEqual(child.get("CLAUDE_CODE_OAUTH_TOKEN"), "oauth-fixture-secret")
        self.assertEqual(child.get("COLORTERM"), "truecolor")
        for name in (
            "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_SESSION_ID", "AI_AGENT",
        ):
            self.assertNotIn(name, child)
        # The default tracked contract is unchanged: still logged out, still credential-free.
        self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", logged_out)
        self.assertEqual(child, {**logged_out, "CLAUDE_CODE_OAUTH_TOKEN": "oauth-fixture-secret"})

    def test_tracked_oauth_rejects_untracked_or_missing_credentials(self):
        self.assertIn("tracked", capture.validate_tracked_oauth(False, True, {}))
        self.assertIn("CLAUDE_CODE_OAUTH_TOKEN", capture.validate_tracked_oauth(True, True, {}))
        self.assertIsNone(capture.validate_tracked_oauth(False, False, {}))
        self.assertIsNone(capture.validate_tracked_oauth(True, True, {"CLAUDE_CODE_OAUTH_TOKEN": "oauth-fixture-secret"}))
        self.assertIn("CLAUDE_CODE_OAUTH_TOKEN", capture.validate_tracked_oauth(True, True, {"CLAUDE_CODE_OAUTH_TOKEN": ""}))

    def test_frame_secret_guard_matches_only_nonempty_preserved_literals(self):
        self.assertTrue(capture.frame_contains_secret("prefix oauth-fixture-secret suffix", ["oauth-fixture-secret"]))
        self.assertFalse(capture.frame_contains_secret("safe", ["", "oauth-fixture-secret"]))
        self.assertFalse(capture.frame_contains_secret("oauth-fixture-secret", []))

    def test_frame_secret_guard_defeats_row_wraps_style_runs_and_partial_fragments(self):
        # A rendered screen carries row boundaries and SGR runs, so an exact substring test misses a
        # credential the reader can still reconstruct. Every case below is invisible to that test.
        token = "oauth-fixture-secret-0123456789abcdef"
        half = len(token) // 2

        wrapped = capture.DimScreen(20, 4)
        capture.pyte.ByteStream(wrapped).feed(f"see {token} end".encode())
        rendered = capture.render_screen(wrapped)
        self.assertNotIn(token, rendered)
        self.assertTrue(capture.frame_contains_secret(rendered, [token]))

        styled = capture.DimScreen(120, 2)
        capture.pyte.ByteStream(styled).feed(f"see {token[:half]}\x1b[1m{token[half:]} end".encode())
        rendered = capture.render_screen(styled)
        self.assertNotIn(token, rendered)
        self.assertIn("\x1b[0;1m", rendered)
        self.assertTrue(capture.frame_contains_secret(rendered, [token]))

        fragment = capture.DimScreen(120, 2)
        capture.pyte.ByteStream(fragment).feed(f"see {token[:capture.SECRET_FRAGMENT_LENGTH]} end".encode())
        rendered = capture.render_screen(fragment)
        self.assertNotIn(token, rendered)
        self.assertTrue(capture.frame_contains_secret(rendered, [token]))
        # One character below the threshold is not a reconstructable credential. (Nothing follows the
        # fragment: whitespace-stripped scanning joins neighbours, so a trailing word could complete it.)
        self.assertFalse(capture.frame_contains_secret(f"see {token[:capture.SECRET_FRAGMENT_LENGTH - 1]}", [token]))

        clean = capture.DimScreen(20, 4)
        capture.pyte.ByteStream(clean).feed(b"\x1b[1mno credential here\x1b[0m, only wrapped and styled text")
        self.assertFalse(capture.frame_contains_secret(capture.render_screen(clean), [token]))

    def test_stream_secret_guard_scans_the_retained_pty_tail_after_normalization(self):
        token = "oauth-fixture-secret-0123456789abcdef"
        half = len(token) // 2
        for label, raw in (
            ("intact", token.encode()),
            ("sgr-split", f"{token[:half]}\x1b[1m{token[half:]}".encode()),
            ("row-split", f"{token[:half]}\r\n{token[half:]}".encode()),
            ("padded", f"{token[:half]}   {token[half:]}".encode()),
            ("fragment-only", token[:capture.SECRET_FRAGMENT_LENGTH].encode()),
        ):
            with self.subTest(raw=label):
                self.assertTrue(capture.stream_contains_secret(bytearray(raw), [token]))
        self.assertFalse(capture.stream_contains_secret(bytearray(b"\x1b[2J\x1b[Hclean pty bytes\r\n"), [token]))
        self.assertFalse(capture.stream_contains_secret(bytearray(token.encode()), []))
        self.assertFalse(capture.stream_contains_secret(bytearray(b"\xff\xfe undecodable bytes still scan"), [token]))

    def test_tracked_oauth_capture_refuses_wrapped_and_scrolled_off_credentials(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            # Long enough to wrap at 20 columns, so the literal never appears intact in the rendered frame.
            oauth = "oauth-fixture-secret-0123456789abcdef"
            job_dir = root / "job"; job_dir.mkdir()
            masks = root / "wrap-masks.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "wrapped/01-leak.ansi": {"patterns": [], "minimum_matches": 0},
                    "scrolled/01-leak.ansi": {"patterns": [], "minimum_matches": 0},
                },
                "required_state_by_frame": {
                    **synthetic_required_state(("wrapped/01-leak.ansi",), "leak-probe"),
                    **synthetic_required_state(("scrolled/01-leak.ansi",), "leak-probe"),
                },
            }), encoding="utf-8")
            base_env = {"PATH": os.defpath, "CLAUDE_JOB_DIR": str(job_dir), "CLAUDE_CODE_OAUTH_TOKEN": oauth}
            cases = {
                # Screen layer: the credential is on the grid but broken across rows.
                "wrapped": f"import sys; sys.stdout.write('leak-probe {oauth}'); sys.stdout.flush()",
                # Stream layer: the credential crossed the pty and was then erased off the grid.
                "scrolled": (
                    f"import sys; sys.stdout.write('{oauth}' + chr(27) + '[2J' + chr(27) + '[Hleak-probe'); "
                    "sys.stdout.flush()"
                ),
            }
            for name, code in cases.items():
                with self.subTest(layer=name):
                    tracked = root / "test" / "fixtures" / "upstream-frames" / name
                    tracked.mkdir(parents=True)
                    (tracked / "01-leak.ansi").write_bytes(b"preserved tracked bytes\n")
                    before = {path.name: path.read_bytes() for path in tracked.iterdir()}
                    refused = self.run_capture(
                        "frame:leak\n", self.live_child_command(code), tracked, masks,
                        expected_version=self.synthetic_version(), env=base_env,
                        cols=20, rows=6, tracked_oauth=True,
                    )
                    self.assertEqual(refused.returncode, 1)
                    self.assertIn("credential leak", refused.stderr)
                    self.assertNotIn(oauth, refused.stdout + refused.stderr)
                    self.assertEqual({path.name: path.read_bytes() for path in tracked.iterdir()}, before)
                    self.assertFalse(list(root.glob(".capture-*")))

    def test_tracked_oauth_capture_forwards_only_oauth_and_never_leaks_a_literal(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            oauth, api = "oauth-fixture-secret", "api-fixture-secret"
            job_dir = root / "job"; job_dir.mkdir()
            base_env = {
                "PATH": os.defpath, "CLAUDE_JOB_DIR": str(job_dir),
                "CLAUDE_CODE_OAUTH_TOKEN": oauth, "ANTHROPIC_API_KEY": api,
            }
            masks = root / "oauth-masks.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "oauth/01-authenticated.ansi": {"patterns": [], "minimum_matches": 0},
                    "leak/01-leak.ansi": {"patterns": [], "minimum_matches": 0},
                },
                "required_state_by_frame": {
                    **synthetic_required_state(("oauth/01-authenticated.ansi",), "oauth=yes api=no"),
                    **synthetic_required_state(("leak/01-leak.ansi",), "leak-probe"),
                },
            }), encoding="utf-8")

            tracked = root / "test" / "fixtures" / "upstream-frames" / "oauth"
            authenticated = self.live_child_command(
                "import os,sys; sys.stdout.write('oauth=%s api=%s' % ("
                "'yes' if os.environ.get('CLAUDE_CODE_OAUTH_TOKEN') else 'no', "
                "'yes' if os.environ.get('ANTHROPIC_API_KEY') else 'no')); sys.stdout.flush()"
            )
            captured = self.run_capture(
                "frame:authenticated\n", authenticated, tracked, masks,
                expected_version=self.synthetic_version(), env=base_env, tracked_oauth=True,
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            frame = (tracked / "01-authenticated.ansi").read_text(encoding="utf-8")
            self.assertIn("oauth=yes api=no", frame)
            for secret in (oauth, api):
                self.assertNotIn(secret, frame)
                self.assertNotIn(secret, captured.stdout + captured.stderr)

            leaked = root / "test" / "fixtures" / "upstream-frames" / "leak"
            leaked.mkdir(parents=True)
            (leaked / "01-leak.ansi").write_bytes(b"preserved tracked bytes\n")
            before = {path.name: path.read_bytes() for path in leaked.iterdir()}
            refused = self.run_capture(
                "frame:leak\n", self.live_child_command(f"import sys; sys.stdout.write('leak-probe {oauth}'); sys.stdout.flush()"),
                leaked, masks, expected_version=self.synthetic_version(), env=base_env, tracked_oauth=True,
            )
            self.assertEqual(refused.returncode, 1)
            self.assertIn("credential leak", refused.stderr)
            self.assertNotIn(oauth, refused.stdout + refused.stderr)
            self.assertEqual({path.name: path.read_bytes() for path in leaked.iterdir()}, before)
            self.assertFalse(list(root.glob(".capture-*")))

    def test_tracked_oauth_requires_a_tracked_destination_and_a_present_token(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            job_dir = root / "job"; job_dir.mkdir()
            child = self.live_child_command("import sys; sys.stdout.write('ready'); sys.stdout.flush()")
            masks = root / "masks.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {"needs-token/01-boot.ansi": {"patterns": [], "minimum_matches": 0}},
                "required_state_by_frame": synthetic_required_state(("needs-token/01-boot.ansi",), "ready"),
            }), encoding="utf-8")
            untracked = self.run_capture(
                "frame:boot\n", child, root / "scratch",
                env={"PATH": os.defpath, "CLAUDE_JOB_DIR": str(job_dir), "CLAUDE_CODE_OAUTH_TOKEN": "oauth-fixture-secret"},
                tracked_oauth=True,
            )
            self.assertEqual(untracked.returncode, 2)
            self.assertIn("--tracked-oauth requires tracked golden output", untracked.stderr)
            self.assertFalse((root / "scratch").exists())
            tracked = root / "test" / "fixtures" / "upstream-frames" / "needs-token"
            keyless = self.run_capture(
                "frame:boot\n", child, tracked, masks, expected_version=self.synthetic_version(),
                env={"PATH": os.defpath, "CLAUDE_JOB_DIR": str(job_dir)}, tracked_oauth=True,
            )
            self.assertEqual(keyless.returncode, 2)
            self.assertIn("--tracked-oauth requires CLAUDE_CODE_OAUTH_TOKEN", keyless.stderr)
            self.assertFalse(tracked.exists())
            self.assertFalse(list(root.glob(".capture-*")))

    def test_untracked_capture_arms_the_publication_guard_for_its_forwarded_credential(self):
        oauth = "oauth-fixture-secret-0123456789abcdef"
        # KEEP_CLAUDE_ENV forwards the OAuth token to the child of EVERY untracked capture, so the guard is
        # armed from what the built child environment actually carries, not from --tracked-oauth (which
        # covers only the tracked exception). Arming it from the flag left every scratch capture unguarded.
        with patch.dict(os.environ, {"CLAUDE_CODE_OAUTH_TOKEN": oauth}, clear=False):
            self.assertEqual(capture.clean_child_env(False).get("CLAUDE_CODE_OAUTH_TOKEN"), oauth)
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            job_dir = root / "job"; job_dir.mkdir()
            base_env = {"PATH": os.defpath, "CLAUDE_JOB_DIR": str(job_dir), "CLAUDE_CODE_OAUTH_TOKEN": oauth}
            scratch = root / "scratch"
            leaked = self.run_capture(
                "frame:leak\n",
                self.live_child_command(f"import sys; sys.stdout.write('leak-probe {oauth}'); sys.stdout.flush()"),
                scratch, env=base_env, cols=20, rows=6,
            )
            self.assertEqual(leaked.returncode, 1)
            self.assertIn("credential leak", leaked.stderr)
            self.assertNotIn(oauth, leaked.stdout + leaked.stderr)
            self.assertFalse(scratch.exists())
            self.assertFalse(list(root.glob(".capture-*")))

            clean = root / "clean"
            captured = self.run_capture(
                "frame:boot\n",
                self.live_child_command("import sys; sys.stdout.write('ready'); sys.stdout.flush()"),
                clean, env=base_env,
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            self.assertIn("ready", (clean / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_required_state_rules_require_positive_non_boolean_match_counts(self):
        with tempfile.TemporaryDirectory() as td:
            masks = Path(td) / "state-masks.json"
            for minimum_matches in (0, True):
                with self.subTest(minimum_matches=minimum_matches):
                    masks.write_text(json.dumps({
                        "required_state_by_frame": {
                            "stateful/*.ansi": {
                                "required": [{
                                    "name": "logged-out",
                                    "pattern": "LOGGED-OUT STATE",
                                    "minimum_matches": minimum_matches,
                                }],
                            },
                        },
                    }), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "must be a positive integer"):
                        capture.load_required_state_contract(str(masks), "stateful/01-frame.ansi")

    def test_f1_upstream_read_scenario_declares_its_key_and_binding_frame_contract(self):
        key = F1_KEY
        script = F1_UPSTREAM_READ_KEYS.read_text(encoding="utf-8")
        self.assertEqual(script, (
            "# Authenticated, version-pinned tracked capture. Bash remains available; the prompt selects Read explicitly.\n"
            "wait:4\n"
            "enter\n"
            "wait:2\n"
            "type:Use the Read tool to read src/app.ts, then stop without adding an assistant response.\n"
            "# A beat between type and enter: coalesced into one chunk, the CLI's paste detection would treat the\n"
            "# trailing CR as pasted content rather than a submit keypress, leaving the prompt in the composer.\n"
            "wait:0.5\n"
            "enter\n"
            "# A real model turn plus a Read tool call takes seconds; the default 1s bound would always miss.\n"
            "wait-output:⎿:120\n"
            "wait:0.2\n"
            "frame:read-complete\n"
        ))
        actions = [line for line in script.splitlines() if line.strip() and not line.startswith("#")]
        # The declared mask key is derived from the script's own frame name; a drift between the two would
        # only surface as a pre-spawn refusal during an authenticated capture.
        frames = [line for line in actions if line.startswith("frame:")]
        self.assertEqual([f"f1-tool-rendering/{i:02d}-{line.partition(':')[2]}.ansi" for i, line in enumerate(frames, 1)], [key])
        waits = [line.partition(":")[2] for line in actions if line.startswith("wait-output:")]
        self.assertEqual([capture.parse_wait_output(value) for value in waits], [("⎿", 120.0)])
        self.assertGreater(120.0, capture.FIRST_FRAME_READY_SECONDS)

        self.assertTrue(capture.load_redaction_contract(str(MASKS_PATH), key).declared)
        contract = capture.load_required_state_contract(str(MASKS_PATH), key)
        self.assertTrue(contract.declared)
        self.assertEqual([(rule.name, rule.minimum_matches) for rule in contract.required], [
            ("user-prompt", 1), ("read-progress", 1), ("gutter-path", 1),
        ])
        self.assertEqual([rule.name for rule in contract.forbidden], ["logged-out-footer", "tool-rejected"])

        # The real 2.1.220 render (owner-confirmed): a grouped file-operation summary — the header is a file
        # COUNT ("Reading 1 file…" live, "Read 1 file" once condensed), and the PATH sits in the dim ⎿ gutter,
        # not a `Read(path)` header. The contract therefore binds the gutter-path and the count header, the two
        # elements stable across the model's nondeterministic prose and timing.
        prompt = "Use the Read tool to read src/app.ts, then stop without adding an assistant response."
        header = "\x1b[0;32m⏺\x1b[0m Reading 1 file…\x1b[0m"
        gutter = "\x1b[0m  \x1b[0;2m⎿  src/app.ts\x1b[0m"
        accepted = f"\x1b[0m> {prompt}\x1b[0m\n{header}\n{gutter}\n"
        self.assertEqual(capture.validate_required_state(accepted, contract), [])
        for label, frame, expected in (
            ("changed-path", accepted.replace("⎿  src/app.ts", "⎿  src/other.ts"), "gutter-path"),
            ("changed-header", accepted.replace("Reading 1 file…", "Frobnicating widgets"), "read-progress"),
            ("missing-gutter", f"\x1b[0m> {prompt}\x1b[0m\n{header}\n", "gutter-path"),
            ("missing-prompt", f"{header}\n{gutter}\n", "user-prompt"),
            ("logged-out", accepted + "\x1b[0mNot logged in · Run /login\x1b[0m\n", "logged-out-footer"),
            ("rejected", accepted + "\x1b[0mTool use rejected\x1b[0m\n", "tool-rejected"),
        ):
            with self.subTest(case=label):
                failures = capture.validate_required_state(frame, contract)
                self.assertEqual(len(failures), 1, failures)
                self.assertIn(expected, failures[0])
        # An SGR transition inside the gutter path must not defeat the contract, and this frame's comparison
        # masks must collapse the nondeterminism it actually paints — the live spinner row, not the stock
        # scenarios' weekly-quota and cost/duration rows, neither of which this busy frame ever renders.
        split = accepted.replace("src/app.ts", "src/\x1b[0;1mapp\x1b[0m.ts")
        self.assertEqual(capture.validate_required_state(split, contract), [])
        scoped = diff.load_masks(str(MASKS_PATH), key)
        spinner_a = f1_spinner_row("✶", "Effecting", "2", "4", 70, "215;119;87", "235;159;127")
        spinner_b = f1_spinner_row("✳", "Pondering", "9", "117", 61, "99;99;99", "200;100;100")
        self.assertEqual(diff.mask_text(spinner_a, scoped), diff.mask_text(spinner_b, scoped))
        self.assertNotEqual(diff.mask_text("⎿  src/app.ts", scoped), diff.mask_text("⎿  src/other.ts", scoped))

    def test_f1_busy_footer_dashboard_identity_is_private_for_the_authenticated_golden(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), F1_KEY)
        self.assertEqual([status.name for status in contract.dashboard_statuses], ["status-user-host"])
        status = contract.dashboard_statuses[0]
        footers = [
            line for line in visible_text(F1_GOLDEN_PATH.read_text(encoding="utf-8")).splitlines()
            if line.lstrip().startswith(("⏸", "⏵⏵"))
        ]
        self.assertEqual(footers, [
            "  ⏸ manual mode on · esc to interrupt · ← for agents" + " " * 30 + "● high · /effort",
        ])
        # The one authenticated golden is a busy in-flight frame, so its footer carries the interrupt hint and
        # the right-aligned effort column that the logged-out stock scenarios never paint. Both gate the whole
        # identity machinery: DashboardStatusMask keys redaction AND its fail-closed residual check on
        # marker_pattern.fullmatch, so a grammar that cannot match this footer leaves the frame unguarded.
        self.assertTrue(status.marker_pattern.fullmatch(footers[0]))
        self.assertTrue(status.mode_pattern.fullmatch(footers[0]))

        busy = footers[0].lstrip()
        for effort in ("low", "medium", "high"):
            dashboard = (
                "\x1b[0m  alice@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                f"\x1b[0m  \x1b[0;2m{busy.replace('● high', f'● {effort}')}\x1b[0m\n"
            )
            with self.subTest(effort=effort):
                redacted, failures = capture.preprocess_frame_for_publication(dashboard, contract)
                self.assertEqual(redacted, dashboard.replace("alice@host", "▒"))
                self.assertEqual(failures, [])

        split = (
            "\x1b[0m  ali\x1b[31mce\x1b[0m@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
            f"\x1b[0m  \x1b[0;2m{busy}\x1b[0m\n"
        )
        redacted, failures = capture.preprocess_frame_for_publication(split, contract)
        self.assertEqual(redacted, split)
        self.assertEqual(failures, ["unredacted identity status-user-host"])

        transcript = f"const remote = 'alice@host:/repo'; // {busy} without dashboard chrome\n"
        redacted, failures = capture.preprocess_frame_for_publication(transcript, contract)
        self.assertEqual(redacted, transcript)
        self.assertEqual(failures, [])

    def test_f1_comparison_masks_normalize_the_live_spinner_and_effort_columns(self):
        contract = capture.load_redaction_contract(str(MASKS_PATH), F1_KEY)
        masks = diff.load_comparison_masks(str(MASKS_PATH), F1_KEY)
        raw = F1_GOLDEN_PATH.read_text(encoding="utf-8")
        spinner = next(line for line in raw.splitlines() if "tokens)" in visible_text(line))
        footer = next(line for line in raw.splitlines() if visible_text(line).lstrip().startswith("⏸"))
        # A rerun of the identical capture produced `Pondering… (9s · ↓ 117 tokens)` where this golden has
        # `Effecting… (2s · ↓ 4 tokens)`; the effort word and its right-alignment padding move with it.
        rerun_spinner = f1_spinner_row("✳", "Pondering", "9", "117", 61, "99;99;99", "200;100;100")
        rerun_footer = footer.replace("mhigh\x1b", "mlow\x1b").replace(" " * 30, " " * 31)
        self.assertNotEqual(spinner, rerun_spinner)
        self.assertNotEqual(footer, rerun_footer)
        self.assertEqual(diff.mask_text(spinner, masks), diff.mask_text(rerun_spinner, masks))
        self.assertEqual(diff.mask_text(footer, masks), diff.mask_text(rerun_footer, masks))
        # The rows stay present with their grammar intact; only the variable spans collapse.
        self.assertEqual(diff.mask_text(spinner, masks), "▒ ▒… (▒s · ↓ ▒ tokens)▒")
        self.assertIn("· /effort", visible_text(diff.mask_text(footer, masks)))
        self.assertIn("esc to interrupt", visible_text(diff.mask_text(footer, masks)))

        # The active-row leader blinks on a 600 ms phase, so a recapture can land on the off frame:
        # glyph and space at that cell must sanitize equal, while the row's text stays significant.
        header = next(line for line in raw.splitlines() if "Reading" in visible_text(line))
        self.assertIn("⏺", header)
        blink_off = header.replace("⏺", " ", 1)
        self.assertEqual(diff.mask_text(header, masks), diff.mask_text(blink_off, masks))
        self.assertNotEqual(
            diff.mask_text(header, masks),
            diff.mask_text(header.replace("Reading", "Sensing"), masks),
        )

        rerun = raw.replace(spinner, rerun_spinner).replace(footer, rerun_footer).replace(header, blink_off)
        base_lines, base_failures = diff.sanitize_frame_for_comparison(raw, contract, masks)
        rerun_lines, rerun_failures = diff.sanitize_frame_for_comparison(rerun, contract, masks)
        self.assertEqual(base_failures, [])
        self.assertEqual(rerun_failures, [])
        self.assertEqual(base_lines, rerun_lines)
        # The transient gutter hint is the element this golden exists to pin, so it stays fully significant.
        hint_lines, hint_failures = diff.sanitize_frame_for_comparison(
            rerun.replace("⎿  src/app.ts", "⎿  src/other.ts"), contract, masks,
        )
        self.assertEqual(hint_failures, [])
        self.assertNotEqual(base_lines, hint_lines)

    def test_tracked_capture_rejects_mixed_state_atomically_before_publication(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "stateful"
            tracked.mkdir(parents=True)
            (tracked / "01-old.ansi").write_bytes(b"preserved tracked bytes\n")
            before = {path.name: path.read_bytes() for path in tracked.iterdir()}
            masks = root / "state-masks.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "stateful/01-first.ansi": {"patterns": [], "minimum_matches": 0},
                    "stateful/02-second.ansi": {"patterns": [], "minimum_matches": 0},
                },
                "required_state_by_frame": {
                    "stateful/*.ansi": {
                        "required": [{"name": "logged-out", "pattern": "LOGGED-OUT STATE", "minimum_matches": 1}],
                        "forbidden": [{"name": "authenticated", "pattern": "AUTHENTICATED STATE"}],
                    },
                },
            }), encoding="utf-8")
            child = self.live_child_command(
                "import os,sys; sys.stdout.write('LOGGED-OUT STATE'); sys.stdout.flush(); "
                "os.read(0, 1); sys.stdout.write('\\rAUTHENTICATED STATE'); sys.stdout.flush()"
            )
            job_dir = root / "job"; job_dir.mkdir()
            refused = self.run_capture(
                "frame:first\nenter\nframe:second\n", child, tracked, masks,
                expected_version=self.synthetic_version(),
                env={"PATH": os.defpath, "CLAUDE_JOB_DIR": str(job_dir)},
            )
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("state validation failed", refused.stderr)
            self.assertEqual({path.name: path.read_bytes() for path in tracked.iterdir()}, before)
            self.assertFalse(list(root.glob(".capture-*")))

    def test_capture_removes_private_config_when_seed_write_fails_before_spawning(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            keys = root / "case.keys"
            keys.write_text("frame:boot\n", encoding="utf-8")
            config_parent = root / "job" / "tmp"
            config_parent.mkdir(parents=True)
            argv = [
                str(CAPTURE_PATH), "--script", str(keys), "--out", str(root / "out"),
                "--bin", self.dead_child_command(), "--cwd", str(root),
            ]
            with patch.object(capture, "capture_temp_dir", return_value=str(config_parent)), \
                 patch.object(capture.Path, "write_text", side_effect=OSError("injected seed write failure")), \
                 patch.object(capture.pty, "fork") as fork, \
                 patch.object(sys, "argv", argv):
                self.assertEqual(capture.main(), 2)
            fork.assert_not_called()
            self.assertFalse(list(config_parent.glob(".claude-config-*")))
            self.assertFalse(list(root.glob(".capture-*")))

    def test_capture_terminates_and_reaps_the_entire_child_process_group(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            reports: list[dict[str, int]] = []
            try:
                for label, script, leader_lifetime, expected_exit in (
                    ("success-one", "wait:0.05\nframe:boot\n", 60, 0),
                    ("success-two", "wait:0.05\nframe:boot\n", 60, 0),
                    ("partial", "wait:0.05\nframe:first\nwait:0.3\nframe:second\n", 0.1, 1),
                ):
                    report = root / f"{label}.json"
                    child = self.synthetic_child_command(textwrap.dedent(f"""
                        import json, os, subprocess, sys, time
                        from pathlib import Path
                        descendant = subprocess.Popen([sys.executable, "-c", "import signal, time; signal.signal(signal.SIGHUP, signal.SIG_IGN); time.sleep(60)"])
                        Path({str(report)!r}).write_text(json.dumps({{
                            "leader": os.getpid(), "leader_pgrp": os.getpgrp(), "descendant": descendant.pid,
                        }}), encoding="utf-8")
                        sys.stdout.write("ready"); sys.stdout.flush()
                        time.sleep({leader_lifetime})
                    """))
                    result = self.run_capture(script, child, root / label)
                    self.assertEqual(result.returncode, expected_exit, result.stderr)
                    recorded = json.loads(report.read_text(encoding="utf-8"))
                    reports.append(recorded)
                    self.assertNotEqual(recorded["leader_pgrp"], os.getpgrp())
                    self.assertTrue(self.wait_for_pid_exit(recorded["leader"]), recorded)
                    self.assertTrue(self.wait_for_pid_exit(recorded["descendant"]), recorded)
            finally:
                for recorded in reports:
                    try:
                        os.kill(recorded["descendant"], signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_capture_empty_or_comment_only_scripts_use_bounded_cleanup(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for attempt in range(10):
                script = "\n" if attempt % 2 else "# no capture actions\n"
                started = time.monotonic()
                result = self.run_capture(script, self.live_child_command("import time"), root / f"empty-{attempt}")
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self.assertIn("script produced no frame", result.stderr)
                self.assertLess(time.monotonic() - started, 2, result.stderr)

    def test_capture_terminal_initialization_failure_terminates_and_reaps_group(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            keys = root / "case.keys"
            keys.write_text("frame:boot\n", encoding="utf-8")
            report = root / "terminal-failure.json"
            child = self.synthetic_child_command(textwrap.dedent(f"""
                import json, os, signal, subprocess, sys, time
                from pathlib import Path
                descendant = subprocess.Popen([sys.executable, "-c", "import signal, time; signal.signal(signal.SIGHUP, signal.SIG_IGN); time.sleep(60)"])
                Path(os.environ["CAPTURE_REPORT"]).write_text(json.dumps({{"leader": os.getpid(), "descendant": descendant.pid}}), encoding="utf-8")
                time.sleep(60)
            """))
            config_parent = root / "job" / "tmp"
            config_parent.mkdir(parents=True)
            argv = [
                str(CAPTURE_PATH), "--script", str(keys), "--out", str(root / "out"),
                "--bin", child, "--cwd", str(root),
            ]
            def fail_after_child_reports(*_args):
                deadline = time.monotonic() + 0.5
                while not report.exists() and time.monotonic() < deadline:
                    time.sleep(0.005)
                raise OSError("injected terminal initialization failure")
            with patch.dict(os.environ, {"CAPTURE_REPORT": str(report)}, clear=False), \
                 patch.object(capture, "capture_temp_dir", return_value=str(config_parent)), \
                 patch.object(capture.fcntl, "ioctl", side_effect=fail_after_child_reports), \
                 patch.object(sys, "argv", argv):
                self.assertEqual(capture.main(), 1)
            recorded = json.loads(report.read_text(encoding="utf-8"))
            self.assertTrue(self.wait_for_pid_exit(recorded["leader"]), recorded)
            self.assertTrue(self.wait_for_pid_exit(recorded["descendant"]), recorded)
            self.assertFalse(list(config_parent.glob(".claude-config-*")))
            self.assertFalse(list(root.glob(".capture-*")))

    def test_capture_group_creation_race_falls_back_to_leader_and_reaps_within_bound(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            report = root / "race.json"
            completed = root / "completed"
            probe = textwrap.dedent(f"""
                import importlib.util, json, os, pty, signal, time
                from pathlib import Path
                spec = importlib.util.spec_from_file_location("capture_race", {str(CAPTURE_PATH)!r})
                capture = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(capture)
                pid, fd = pty.fork()
                if pid == 0:
                    signal.signal(signal.SIGHUP, signal.SIG_IGN)
                    time.sleep(60)
                    os._exit(0)
                Path({str(report)!r}).write_text(json.dumps({{"leader": pid, "controller_pgrp": os.getpgrp()}}), encoding="utf-8")
                capture.os.getpgid = lambda _pid: os.getpgrp()
                def group_missing(*_args):
                    raise ProcessLookupError()
                capture.os.killpg = group_missing
                try:
                    capture.terminate_captured_process_group(pid)
                    Path({str(completed)!r}).write_text("reaped", encoding="utf-8")
                finally:
                    os.close(fd)
            """)
            try:
                started = time.monotonic()
                result = subprocess.run([sys.executable, "-c", probe], text=True, capture_output=True, timeout=2)
                elapsed = time.monotonic() - started
            except subprocess.TimeoutExpired as error:
                self.fail(f"group-creation race cleanup hung past two seconds: {error}")
            finally:
                if report.exists():
                    leader = json.loads(report.read_text(encoding="utf-8"))["leader"]
                    try:
                        if os.getpgid(leader) == leader and leader != os.getpgrp():
                            os.killpg(leader, signal.SIGKILL)
                        else:
                            os.kill(leader, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    self.assertTrue(self.wait_for_pid_exit(leader), leader)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertLess(elapsed, 2, result.stderr)
            self.assertEqual(completed.read_text(encoding="utf-8"), "reaped")

    def test_capture_never_signals_the_controller_process_group(self):
        with patch.object(capture.os, "killpg") as killpg, patch.object(capture.os, "waitpid") as waitpid:
            capture.terminate_captured_process_group(os.getpgrp())
        killpg.assert_not_called()
        waitpid.assert_not_called()

    def test_capture_first_frame_waits_for_content_but_not_an_indefinite_blank_child(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            delayed = self.synthetic_child_command("import sys, time; time.sleep(0.08); sys.stdout.write('ready'); sys.stdout.flush(); time.sleep(60)")
            for attempt in range(10):
                result = self.run_capture("frame:boot\n", delayed, root / f"delayed-{attempt}")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("ready", (root / f"delayed-{attempt}" / "01-boot.ansi").read_text(encoding="utf-8"))

            blank_started = time.monotonic()
            blank = self.run_capture("frame:boot\n", self.live_child_command("import time"), root / "blank")
            blank_elapsed = time.monotonic() - blank_started
            self.assertNotEqual(blank.returncode, 0, blank.stderr)
            self.assertIn("no rendered screen state", blank.stderr)
            self.assertGreaterEqual(blank_elapsed, 0.1)
            self.assertLess(blank_elapsed, 2)

            dead_started = time.monotonic()
            dead = self.run_capture("frame:boot\n", self.dead_child_command(), root / "dead")
            self.assertNotEqual(dead.returncode, 0, dead.stderr)
            self.assertIn("pty closed", dead.stderr)
            self.assertLess(time.monotonic() - dead_started, 2)

            emitting_dead = self.run_capture("frame:boot\n", "sh -c 'printf ready'", root / "emitting-dead")
            self.assertNotEqual(emitting_dead.returncode, 0, emitting_dead.stderr)
            self.assertFalse(list((root / "emitting-dead").glob("*.ansi")), emitting_dead.stderr)

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
            one_identity_masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "help-overlay/01-boot.ansi": {
                        "patterns": [{"name": "greeting", "pattern": "Welcome back [^!\\x1b]*!", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                },
                "required_state_by_frame": synthetic_required_state(("help-overlay/01-boot.ansi",), "Welcome back"),
            }), encoding="utf-8")
            captured = self.run_capture("wait:0.05\nframe:boot\n", child, out, one_identity_masks, expected_version=self.synthetic_version())
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
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "new/scenario/01-boot.ansi": {
                        "patterns": [{"name": "identity", "pattern": "FAKE-IDENTITY", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                },
                "required_state_by_frame": synthetic_required_state(("new/scenario/01-boot.ansi",), "FAKE-IDENTITY"),
            }), encoding="utf-8")
            captured = self.run_capture(
                "wait:0.05\nframe:boot\n",
                self.live_child_command("import sys,time; sys.stdout.write('FAKE-IDENTITY'); sys.stdout.flush()"),
                tracked,
                masks,
                script_parent=root,
                cwd=root,
                expected_version=self.synthetic_version(),
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
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "renamed/01-first.ansi": {"patterns": [{"name": "ready", "pattern": "ready", "minimum_matches": 1}], "minimum_matches": 1},
                    "renamed/02-second.ansi": {"patterns": [{"name": "ready", "pattern": "ready", "minimum_matches": 1}], "minimum_matches": 1},
                },
                "required_state_by_frame": synthetic_required_state(("renamed/01-first.ansi", "renamed/02-second.ansi"), "ready"),
            }), encoding="utf-8")
            tracked = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            captured = self.run_capture("frame:first\nframe:second\n", child, tracked, masks, expected_version=self.synthetic_version())
            self.assertEqual(captured.returncode, 0, captured.stderr)
            for name in ("01-first.ansi", "02-second.ansi"):
                text = (tracked / name).read_text(encoding="utf-8")
                self.assertIn("▒", text)
                self.assertNotIn("ready", text)

            untracked = self.run_capture("frame:boot\n", child, root / "scratch")
            self.assertEqual(untracked.returncode, 0, untracked.stderr)
            self.assertIn("ready", (root / "scratch" / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_tracked_capture_requires_an_exact_version_preflight_before_capture_or_staging(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            marker = root / "capture-child-ran"
            child = self.live_child_command(f"from pathlib import Path; import sys,time; Path({str(marker)!r}).write_text('yes'); sys.stdout.write('ready'); sys.stdout.flush()")
            masks = root / "masks.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    key: {"patterns": [], "minimum_matches": 0}
                    for key in (
                        "version/missing/01-boot.ansi",
                        "version/correct/01-boot.ansi",
                        "version/wrong/01-boot.ansi",
                        "version/failed/01-boot.ansi",
                        "version/path-correct/01-boot.ansi",
                        "version/path-changed/01-boot.ansi",
                    )
                },
                "required_state_by_frame": synthetic_required_state((
                    "version/missing/01-boot.ansi", "version/correct/01-boot.ansi", "version/wrong/01-boot.ansi",
                    "version/failed/01-boot.ansi", "version/path-correct/01-boot.ansi", "version/path-changed/01-boot.ansi",
                ), "ready"),
            }), encoding="utf-8")

            missing = self.run_capture("wait:0.05\nframe:boot\n", child, root / "test" / "fixtures" / "upstream-frames" / "version" / "missing", masks)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("--expected-version", missing.stderr)
            self.assertFalse(marker.exists())
            self.assertFalse(list(root.glob(".capture-*")))

            version = self.synthetic_version()
            correct = self.run_capture("wait:0.05\nframe:boot\n", child, root / "test" / "fixtures" / "upstream-frames" / "version" / "correct", masks, expected_version=version)
            self.assertEqual(correct.returncode, 0, correct.stderr)
            self.assertTrue(marker.exists())
            marker.unlink()

            wrong = self.run_capture("wait:0.05\nframe:boot\n", child, root / "test" / "fixtures" / "upstream-frames" / "version" / "wrong", masks, expected_version="not the synthetic interpreter")
            self.assertNotEqual(wrong.returncode, 0)
            self.assertIn("version mismatch", wrong.stderr)
            self.assertFalse(marker.exists())
            self.assertFalse(list(root.glob(".capture-*")))

            failing = root / "failing-version"
            failing.write_text("#!/bin/sh\nexit 7\n", encoding="utf-8")
            failing.chmod(0o755)
            failed = self.run_capture("frame:boot\n", str(failing), root / "test" / "fixtures" / "upstream-frames" / "version" / "failed", masks, expected_version="2.1.220 (Claude Code)")
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("version check failed", failed.stderr)
            self.assertFalse(list(root.glob(".capture-*")))

            def fake_claude(directory: Path, version_output: str, capture_marker: Path | None = None) -> None:
                marker_line = f"touch {shlex.quote(str(capture_marker))}\n" if capture_marker else ""
                executable = directory / "claude"
                executable.parent.mkdir(parents=True)
                executable.write_text(f"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  printf '%s\\n' {shlex.quote(version_output)}\n  exit 0\nfi\n{marker_line}printf ready\nsleep {LIVE_CHILD_KEEPALIVE_SECONDS}\n", encoding="utf-8")
                executable.chmod(0o755)

            first_path, changed_path = root / "first-bin", root / "changed-bin"
            fake_claude(first_path, "2.1.220 (Claude Code)")
            path_env = {"PATH": f"{first_path}{os.pathsep}{os.defpath}"}
            path_correct = self.run_capture("wait:0.05\nframe:boot\n", "claude", root / "test" / "fixtures" / "upstream-frames" / "version" / "path-correct", masks, expected_version="2.1.220 (Claude Code)", env=path_env)
            self.assertEqual(path_correct.returncode, 0, path_correct.stderr)

            path_marker = root / "changed-path-child-ran"
            fake_claude(changed_path, "2.1.221 (Claude Code)", path_marker)
            changed_env = {"PATH": f"{changed_path}{os.pathsep}{os.defpath}"}
            path_changed = self.run_capture("wait:0.05\nframe:boot\n", "claude", root / "test" / "fixtures" / "upstream-frames" / "version" / "path-changed", masks, expected_version="2.1.220 (Claude Code)", env=changed_env)
            self.assertNotEqual(path_changed.returncode, 0)
            self.assertIn("version mismatch", path_changed.stderr)
            self.assertFalse(path_marker.exists())
            self.assertFalse(list(root.glob(".capture-*")))

    def test_version_preflight_probes_credential_free_and_redacts_child_output(self):
        expected = "2.1.220 (Claude Code)"
        oauth = "oauth-fixture-secret-0123456789abcdef"
        api_key = "api-fixture-secret-0123456789abcdef"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            reporter = root / "reporter"
            reporter.write_text(
                "#!/bin/sh\nprintf '%s' \"${CLAUDE_CODE_OAUTH_TOKEN:-credential-absent}${ANTHROPIC_API_KEY:-}\"\n",
                encoding="utf-8",
            )
            reporter.chmod(0o755)
            with patch.dict(os.environ, {"CLAUDE_CODE_OAUTH_TOKEN": oauth, "ANTHROPIC_API_KEY": api_key}, clear=False):
                # A version probe needs no credential, so it runs under the same scrubbed tracked environment
                # the capture child gets rather than the operator's full inherited one.
                diagnostic = capture.validate_tracked_child_version(shlex.quote(str(reporter)), expected, str(root))
                self.assertIn("credential-absent", diagnostic)
                for secret in (oauth, api_key):
                    self.assertNotIn(secret[:capture.SECRET_FRAGMENT_LENGTH], diagnostic)

            forger = root / "forger"
            forger.write_text(f"#!/bin/sh\nprintf '%s' {shlex.quote(oauth)}\n", encoding="utf-8")
            forger.chmod(0o755)
            with patch.dict(os.environ, {"CLAUDE_CODE_OAUTH_TOKEN": oauth}, clear=False):
                # Child output is interpolated into the returned diagnostic, so it clears the publication
                # guard first: a value carrying a reconstructable credential fragment is replaced whole.
                diagnostic = capture.validate_tracked_child_version(shlex.quote(str(forger)), expected, str(root))
                self.assertEqual(diagnostic, f"version mismatch: expected {expected!r}, got '▒'")
                self.assertNotIn(oauth[:capture.SECRET_FRAGMENT_LENGTH], diagnostic)

            matching = root / "matching"
            matching.write_text(f"#!/bin/sh\nprintf '%s\\n' {shlex.quote(expected)}\n", encoding="utf-8")
            matching.chmod(0o755)
            self.assertIsNone(capture.validate_tracked_child_version(shlex.quote(str(matching)), expected, str(root)))

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
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "nested/recapture/01-new.ansi": {
                        "patterns": [{"name": "fresh", "pattern": "fresh", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                },
                "required_state_by_frame": synthetic_required_state(("nested/recapture/01-new.ansi",), "fresh"),
            }), encoding="utf-8")
            captured_tracked = self.run_capture("wait:0.05\nframe:new\n", child, tracked, masks, expected_version=self.synthetic_version())
            self.assertEqual(captured_tracked.returncode, 0, captured_tracked.stderr)
            self.assertEqual({p.name for p in tracked.glob("*.ansi")}, {"01-new.ansi"})
            self.assertIn("▒", (tracked / "01-new.ansi").read_text(encoding="utf-8"))
            self.assertEqual((tracked / "VERSION").read_bytes(), b"tracked metadata\n")

    def test_private_config_masks_accept_an_identity_free_tracked_frame(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command("import sys; sys.stdout.write('Welcome back! Not logged in · Run /login'); sys.stdout.flush()")
            captured = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            self.assertIn("Welcome back! Not logged in", (tracked / "01-boot.ansi").read_text(encoding="utf-8"))

    def test_private_config_masks_reject_sgr_split_identities_before_publication(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command(
                "import sys; sys.stdout.write(\"Welcome back \\x1b[31mAlice\\x1b[0m! alice@\\x1b[32mexample.com\\x1b[0m's Organization alice@\\x1b[34mhost\\x1b[0m:/ Not logged in · Run /login\"); sys.stdout.flush()"
            )
            refused = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
            )
            self.assertNotEqual(refused.returncode, 0, refused.stderr)
            self.assertIn("unredacted identity", refused.stderr)
            self.assertFalse(list(tracked.glob("*.ansi")))
            for identity in ("Alice", "alice@example.com", "alice@host"):
                self.assertNotIn(identity, refused.stdout + refused.stderr)

    def test_private_config_masks_reject_dashboard_identities_wrapped_across_rendered_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            status_identity = "status" + "a" * 44 + "@host-name"
            split_status_identity = status_identity.replace("@", "\x1b[31m@")
            payload = (
                "\x1b[1;1H\x1b[1mWelcome back Alice!\x1b[0m  \x1b[33m│\x1b[0m Ask Claude to create"
                "\x1b[2;31Horganization.identity@example.test's Organization  │  /release-notes"
                f"\x1b[5;1H\x1b[0m  {split_status_identity}\x1b[0m:\x1b[0m/path"
                "\x1b[7;1H\x1b[0m  \x1b[0;2;38;2;153;153;153m⏸ manual mode on · ? for shortcuts · ← for agents"
                "\x1b[9;1HNot logged in · Run /login"
            )
            child = self.live_child_command(f"import sys; sys.stdout.write({payload!r}); sys.stdout.flush()")
            refused = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
                cols=60,
                rows=10,
            )
            self.assertNotEqual(refused.returncode, 0, refused.stderr)
            self.assertIn("unredacted identity organization-email", refused.stderr)
            self.assertIn("unredacted identity status-user-host", refused.stderr)
            self.assertFalse(list(tracked.glob("*.ansi")))
            for identity in ("organization.identity@example.test", status_identity):
                self.assertNotIn(identity, refused.stdout + refused.stderr)

    def test_private_config_masks_reject_greeting_identity_wrapped_across_rendered_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command(
                "import sys; sys.stdout.write('\\x1b[1;45HWelcome back Alice Identity!\\nNot logged in · Run /login'); sys.stdout.flush()"
            )
            refused = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
                cols=60,
                rows=4,
            )
            self.assertNotEqual(refused.returncode, 0, refused.stderr)
            self.assertIn("unredacted identity greeting", refused.stderr)
            self.assertFalse(list(tracked.glob("*.ansi")))
            self.assertNotIn("Alice Identity", refused.stdout + refused.stderr)

    def test_private_config_masks_preserve_transcript_email_without_dashboard_chrome(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command(
                "import sys; sys.stdout.write(\"Transcript mentions organization.identity@example.test's Organization without dashboard chrome\\nNot logged in · Run /login\"); sys.stdout.flush()"
            )
            captured = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            visible = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", (tracked / "01-boot.ansi").read_text(encoding="utf-8"))
            self.assertIn("Transcript mentions organization.identity@example.test's Organization", visible)

    def test_private_config_masks_preserve_git_status_token_without_dashboard_chrome(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command(
                "import sys; sys.stdout.write('\\x1b[0m  git@host\\x1b[0m:\\x1b[0m/path\\nNot logged in · Run /login'); sys.stdout.flush()"
            )
            captured = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
            )
            self.assertEqual(captured.returncode, 0, captured.stderr)
            visible = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", (tracked / "01-boot.ansi").read_text(encoding="utf-8"))
            self.assertIn("git@host:/path", visible)

    def test_private_config_masks_reject_reviewed_greeting_layout_bypass_before_publication(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tracked = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            child = self.live_child_command("import sys; sys.stdout.write('\\x1b[0;1mWelcome back Test Identity!\\x1b[0m changed-layout\\nNot logged in · Run /login'); sys.stdout.flush()")
            refused = self.run_capture(
                "frame:boot\n",
                child,
                tracked,
                MASKS_PATH,
                expected_version=self.synthetic_version(),
            )
            self.assertNotEqual(refused.returncode, 0, refused.stderr)
            self.assertIn("unredacted identity", refused.stderr)
            self.assertFalse(list(tracked.glob("*.ansi")))
            self.assertNotIn("Test Identity", refused.stdout + refused.stderr)

    def test_capture_rejects_declared_rules_that_match_no_identity_before_writing(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            masks = root / "masks-zero-match.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "renamed/01-boot.ansi": {
                        "patterns": [{"name": "greeting", "pattern": "FAKE-GREETING", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                },
                "required_state_by_frame": synthetic_required_state(("renamed/01-boot.ansi",), "RAW-FAKE-IDENTITY"),
            }), encoding="utf-8")
            child = self.live_child_command("import sys,time; sys.stdout.write('RAW-FAKE-IDENTITY'); sys.stdout.flush()")
            refused = self.run_capture("frame:boot\n", child, out, masks, expected_version=self.synthetic_version())
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("greeting", refused.stderr)
            self.assertFalse(list(out.glob("*.ansi")))
            self.assertNotIn("RAW-FAKE-IDENTITY", refused.stdout + refused.stderr)

    def test_capture_redaction_validation_is_atomic_across_tracked_frames(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "renamed"
            masks = root / "masks-partial-match.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "renamed/01-first.ansi": {
                        "patterns": [{"name": "first", "pattern": "FAKE-FIRST", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                    "renamed/02-second.ansi": {
                        "patterns": [{"name": "second", "pattern": "FAKE-SECOND", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                },
                "required_state_by_frame": synthetic_required_state(("renamed/01-first.ansi", "renamed/02-second.ansi"), "FAKE-FIRST"),
            }), encoding="utf-8")
            child = self.live_child_command("import sys,time; sys.stdout.write('FAKE-FIRST'); sys.stdout.flush()")
            refused = self.run_capture("frame:first\nframe:second\n", child, out, masks, expected_version=self.synthetic_version())
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("second", refused.stderr)
            self.assertFalse(list(out.glob("*.ansi")))

    def test_capture_accepts_exact_identity_coverage_and_explicit_safe_frame(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            covered = root / "test" / "fixtures" / "upstream-frames" / "covered"
            masks = root / "masks-coverage.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "covered/01-identities.ansi": {
                        "patterns": [
                            {"name": "greeting", "pattern": "FAKE-GREETING", "minimum_matches": 1},
                            {"name": "status", "pattern": "fake@host", "minimum_matches": 1},
                        ],
                        "minimum_matches": 2,
                    },
                    "safe/01-safe.ansi": {"patterns": [], "minimum_matches": 0},
                },
                "required_state_by_frame": {
                    **synthetic_required_state(("covered/01-identities.ansi",), "FAKE-GREETING"),
                    **synthetic_required_state(("safe/01-safe.ansi",), "safe frame"),
                },
            }), encoding="utf-8")
            identity_child = self.live_child_command("import sys,time; sys.stdout.write('FAKE-GREETING fake@host'); sys.stdout.flush()")
            captured = self.run_capture("wait:0.05\nframe:identities\n", identity_child, covered, masks, expected_version=self.synthetic_version())
            self.assertEqual(captured.returncode, 0, captured.stderr)
            frame = (covered / "01-identities.ansi").read_text(encoding="utf-8")
            self.assertNotIn("FAKE-GREETING", frame)
            self.assertNotIn("fake@host", frame)
            self.assertGreaterEqual(frame.count("▒"), 2)

            safe = root / "test" / "fixtures" / "upstream-frames" / "safe"
            safe_child = self.live_child_command("import sys,time; sys.stdout.write('safe frame'); sys.stdout.flush()")
            captured_safe = self.run_capture("wait:0.05\nframe:safe\n", safe_child, safe, masks, expected_version=self.synthetic_version())
            self.assertEqual(captured_safe.returncode, 0, captured_safe.stderr)
            self.assertIn("safe frame", (safe / "01-safe.ansi").read_text(encoding="utf-8"))

    def test_capture_fails_closed_when_an_ansi_boundary_change_breaks_a_required_rule(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "test" / "fixtures" / "upstream-frames" / "boundary"
            masks = root / "masks-boundary.json"
            masks.write_text(json.dumps({
                "redactions_by_frame": {
                    "boundary/01-boot.ansi": {
                        "patterns": [{"name": "greeting", "pattern": "FAKE-GREETING(?=\\x1b\\[0m BOUNDARY)", "minimum_matches": 1}],
                        "minimum_matches": 1,
                    },
                },
                "required_state_by_frame": synthetic_required_state(("boundary/01-boot.ansi",), "FAKE-GREETING"),
            }), encoding="utf-8")
            child = self.live_child_command("import sys,time; sys.stdout.write('FAKE-GREETING changed-layout'); sys.stdout.flush()")
            refused = self.run_capture("wait:0.05\nframe:boot\n", child, out, masks, expected_version=self.synthetic_version())
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

    def test_dim_pending_wrap_below_partial_decstbm_repairs_pytes_clamped_bottom_destination(self):
        for old_dim, incoming_dim, incoming, expected_cells in (
            (False, False, "Z", ["Z", " ", " ", " "]),
            (False, True, "Z", ["Z", " ", " ", " "]),
            (True, False, "語", ["語", "", " ", " "]),
            (True, True, "語", ["語", "", " ", " "]),
        ):
            with self.subTest(old_dim=old_dim, incoming_dim=incoming_dim, incoming=incoming):
                old_style = b"\x1b[2m" if old_dim else b"\x1b[0m"
                incoming_style = b"\x1b[2m" if incoming_dim else b"\x1b[0m"
                payload = b"\x1b[2;3r\x1b[3;1H" + old_style + "界".encode() + b"\x1b[4;1H\x1b[0m1234" + incoming_style + incoming.encode()
                whole = capture.DimScreen(4, 4)
                capture.pyte.ByteStream(whole).feed(payload)
                self.assertEqual([whole.buffer[2][column].data for column in range(4)], expected_cells)
                self.assertEqual(whole.dim_at(2, 0), incoming_dim)
                self.assertEqual(whole.dim_at(2, 1), incoming_dim if incoming == "語" else False)
                self.assertFalse(whole.dim_at(2, 2), "the stale wide continuation must be cleared at pyte's clamped destination")

                for split_at in range(1, len(payload)):
                    split = capture.DimScreen(4, 4)
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

    def test_diff_redacts_multiline_status_identity_before_output_or_fingerprint(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "scratch"
            golden.mkdir(parents=True); ours.mkdir()
            identity = "comparison-identity@host"
            raw_status = (
                f"\x1b[0m  {identity}\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                "\x1b[0m  \x1b[0;2m⏸ manual mode on\x1b[0m\n"
            )
            redacted_status = (
                "\x1b[0m  ▒\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                "\x1b[0m  \x1b[0;2m⏸ manual mode on\x1b[0m\n"
            )
            (golden / "01-boot.ansi").write_text(redacted_status + "semantic=before\n", encoding="utf-8")
            (ours / "01-boot.ansi").write_text(raw_status + "semantic=before\n", encoding="utf-8")
            equivalent = self.run_diff(golden, ours)
            self.assertFalse(identity in equivalent.stdout + equivalent.stderr)
            self.assertEqual(equivalent.returncode, 0)
            self.assertIn("1 clean, 0 allowlisted, 0 DIVERGENT", equivalent.stdout)

            (ours / "01-boot.ansi").write_text(raw_status + "semantic=after\n", encoding="utf-8")
            changed = self.run_diff(golden, ours)
            self.assertFalse(identity in changed.stdout + changed.stderr)
            self.assertNotEqual(changed.returncode, 0)
            self.assertIn("fingerprint: sha256:", changed.stdout)
            self.assertIn("DIVERGENT", changed.stdout)
            self.assertIn("semantic=before", changed.stdout)
            self.assertIn("semantic=after", changed.stdout)

    def test_diff_comparison_sanitizes_without_requiring_publication_coverage(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "scratch"
            golden.mkdir(parents=True); ours.mkdir()
            masks = root / "masks.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                "help-overlay/01-boot.ansi": {
                    "patterns": [{"name": "raw-identity", "pattern": "RAW-IDENTITY", "minimum_matches": 1}],
                    "identity_guards": [{"name": "missed-identity", "pattern": "MISSED-IDENTITY"}],
                    "minimum_matches": 1,
                },
            }}), encoding="utf-8")
            contract = capture.load_redaction_contract(str(masks), "help-overlay/01-boot.ansi")
            self.assertEqual(
                capture.preprocess_frame_for_publication("▒\nsemantic=before\n", contract)[1],
                ["raw-identity matched 0/1", "total matched 0/1"],
            )
            (golden / "01-boot.ansi").write_text("▒\nsemantic=before\n", encoding="utf-8")
            (ours / "01-boot.ansi").write_text("RAW-IDENTITY\nsemantic=before\n", encoding="utf-8")

            equivalent = self.run_diff(golden, ours, masks=masks)
            self.assertEqual(equivalent.returncode, 0, equivalent.stdout + equivalent.stderr)
            self.assertIn("1 clean, 0 allowlisted, 0 DIVERGENT", equivalent.stdout)
            self.assertNotIn("RAW-IDENTITY", equivalent.stdout + equivalent.stderr)

            (ours / "01-boot.ansi").write_text("RAW-IDENTITY\nsemantic=after\n", encoding="utf-8")
            semantic_difference = self.run_diff(golden, ours, masks=masks)
            self.assertNotEqual(semantic_difference.returncode, 0)
            self.assertIn("fingerprint: sha256:", semantic_difference.stdout)
            self.assertNotIn("RAW-IDENTITY", semantic_difference.stdout + semantic_difference.stderr)

            (ours / "01-boot.ansi").write_text("MISSED-IDENTITY\nsemantic=before\n", encoding="utf-8")
            missed_identity = self.run_diff(golden, ours, masks=masks)
            self.assertNotEqual(missed_identity.returncode, 0)
            self.assertIn("unredacted identity missed-identity", missed_identity.stdout)
            self.assertNotIn("fingerprint: sha256:", missed_identity.stdout)
            self.assertNotIn("MISSED-IDENTITY", missed_identity.stdout + missed_identity.stderr)

    def test_diff_fails_privately_for_ansi_split_or_wrapped_unredacted_status_identity(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            golden = root / "test" / "fixtures" / "upstream-frames" / "help-overlay"
            ours = root / "scratch"
            golden.mkdir(parents=True); ours.mkdir()
            (golden / "01-boot.ansi").write_text("sanitized baseline\n", encoding="utf-8")
            variants = {
                "ansi-split": (
                    "\x1b[0m  split\x1b[31midentity@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                    "\x1b[0m  \x1b[0;2m⏸ manual mode on\x1b[0m\n",
                    "splitidentity@host",
                ),
                "row-wrapped": (
                    "\x1b[0m  wrappedidentity\n@host\x1b[0m:\x1b[0m/repo\x1b[0m\n"
                    "\x1b[0m  \x1b[0;2m⏸ manual mode on\x1b[0m\n",
                    "wrappedidentity@host",
                ),
            }
            for label, (raw, identity) in variants.items():
                with self.subTest(label=label):
                    (ours / "01-boot.ansi").write_text(raw, encoding="utf-8")
                    result = self.run_diff(golden, ours)
                    visible_output = re.sub(r"\x1b\[[0-?]*[ -/]*m", "", result.stdout + result.stderr)
                    self.assertFalse(identity in visible_output)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("privacy redaction failed", result.stdout)
                    self.assertNotIn("fingerprint: sha256:", result.stdout)

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

    def test_diff_scopes_allowlist_staleness_to_the_canonical_scenario_being_compared(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            fixtures = root / "test" / "fixtures" / "upstream-frames"
            scenarios = ("help-overlay", "composer-basics", "nested", "nested/scenario")
            masks = root / "masks.json"
            masks.write_text(json.dumps({"redactions_by_frame": {
                f"{scenario}/*.ansi": {"patterns": [], "identity_guards": [], "minimum_matches": 0}
                for scenario in scenarios
            }}), encoding="utf-8")
            cases = []
            for scenario in scenarios:
                golden = fixtures / scenario
                ours = root / "ours" / scenario.replace("/", "-")
                golden.mkdir(parents=True)
                ours.mkdir(parents=True)
                (golden / "01-frame.ansi").write_text(f"golden {scenario}\n", encoding="utf-8")
                (ours / "01-frame.ansi").write_text(f"ours {scenario}\n", encoding="utf-8")
                initial = self.run_diff(golden, ours, masks=masks)
                fingerprint = re.search(r"fingerprint: sha256:([0-9a-f]{64})", initial.stdout)
                self.assertIsNotNone(fingerprint, initial.stdout)
                cases.append((scenario, golden, ours, fingerprint.group(1)))

            allowlist = root / "allowlist.md"
            allowlist.write_text("".join(
                f"{scenario}/01-frame.ansi sha256:{fingerprint} F0-13 — reviewed {scenario}\n"
                for scenario, _, _, fingerprint in cases
            ), encoding="utf-8")

            for scenario, golden, ours, _ in cases:
                result = self.run_diff(golden, ours, allowlist, masks=masks)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("0 clean, 1 allowlisted, 0 DIVERGENT", result.stdout)

            nested = next(case for case in cases if case[0] == "nested/scenario")
            (nested[1] / "alias").mkdir()
            linked_fixtures = root / "linked-fixtures"
            linked_fixtures.symlink_to(fixtures, target_is_directory=True)
            for canonical_alias in (nested[1] / "alias" / "..", linked_fixtures / "nested" / "scenario"):
                result = self.run_diff(canonical_alias, nested[2], allowlist, masks=masks)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            help_scenario, help_golden, help_ours, _ = cases[0]
            help_ours.joinpath("01-frame.ansi").write_text("unreviewed visible change\n", encoding="utf-8")
            stale = self.run_diff(help_golden, help_ours, allowlist, masks=masks)
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn("allowlist fingerprint is stale", stale.stdout)

            help_ours.joinpath("01-frame.ansi").write_text(help_golden.joinpath("01-frame.ansi").read_text(encoding="utf-8"), encoding="utf-8")
            clean = self.run_diff(help_golden, help_ours, allowlist, masks=masks)
            self.assertNotEqual(clean.returncode, 0)
            self.assertIn("not a divergent masked comparison", clean.stdout)

            help_golden.joinpath("02-keep.ansi").write_text("keep\n", encoding="utf-8")
            help_ours.joinpath("02-keep.ansi").write_text("keep\n", encoding="utf-8")
            help_ours.joinpath("01-frame.ansi").unlink()
            missing = self.run_diff(help_golden, help_ours, allowlist, masks=masks)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("missing in OUR_DIR", missing.stdout)
            self.assertIn(f"{help_scenario}/01-frame.ansi is not a divergent masked comparison", missing.stdout)

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
        install = "install -r scripts/frames/requirements.txt"
        self.assertIn(install, CAPTURE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(capture.SNAPSHOT_DRAIN_SECONDS, 0.02)
        pinned_python = "$CLAUDE_JOB_DIR/tmp/frame-python-venv/bin/python3"
        stale_python = "scripts/frames/.venv/bin/python3"
        frame_diff = DIFF_PATH.read_text(encoding="utf-8")
        self.assertIn(pinned_python, frame_diff)
        self.assertNotIn(stale_python, frame_diff)
        version = (ROOT / "test" / "fixtures" / "upstream-frames" / "VERSION").read_text(encoding="utf-8")
        self.assertIn(install, version)
        self.assertIn('"hasCompletedOnboarding":true', version)
        self.assertIn("`ANTHROPIC_*`", version)
        self.assertIn("SGR-normalized", version)
        self.assertIn("row-wrapped", version)
        self.assertIn("0;2;3", version)
        for marker in (
            "⏸ manual mode on", "⏸ plan mode on", "⏵⏵ accept edits on",
            "⏵⏵ bypass permissions on", "⏵⏵ don't ask on", "⏵⏵ auto mode on",
        ):
            self.assertIn(marker, version)
        self.assertIn("publication coverage", version)
        self.assertIn("comparison sanitization", version)
        for footer_grammar in (
            "nearest structural status candidate",
            "Not logged in · Run /login",
            " · ? for shortcuts …",
            "hostname token accepts `_`",
        ):
            self.assertIn(footer_grammar, version)
        self.assertNotIn("at most two rendered wrap rows", version)
        self.assertIn("`git` is redacted", version)
        self.assertIn("at\nmost 20 ms", version)
        self.assertIn("transcript/code", version)
        self.assertRegex(version, r"immediately if seeding\s+fails before a child starts")
        self.assertIn('"/tmp/frame-scratch"', version)
        expected_version_flag = '--expected-version "2.1.220 (Claude Code)"'
        self.assertEqual(version.count(expected_version_flag), 3)
        plan = F0_PLAN_PATH.read_text(encoding="utf-8")
        for documented in (version, plan):
            self.assertIn(pinned_python, documented)
            self.assertNotIn(stale_python, documented)
        self.assertIn(install, plan)
        self.assertIn('`{"hasCompletedOnboarding":true}`', plan)
        self.assertIn("`ANTHROPIC_*`", plan)
        self.assertIn("SGR-normalized", plan)
        self.assertIn("row-wrapped", plan)
        self.assertIn("0;2;3", plan)
        for marker in (
            "⏸ manual mode on", "⏸ plan mode on", "⏵⏵ accept edits on",
            "⏵⏵ bypass permissions on", "⏵⏵ don't ask on", "⏵⏵ auto mode on",
        ):
            self.assertIn(marker, plan)
        self.assertIn("publication coverage", plan.lower())
        self.assertIn("comparison sanitization", plan.lower())
        for footer_grammar in (
            "nearest structural status candidate",
            "Not logged in · Run /login",
            " · ? for shortcuts …",
            "hostname token accepts `_`",
        ):
            self.assertIn(footer_grammar, plan)
        self.assertIn("username `git`", plan)
        self.assertIn("at most 20 ms", plan)
        self.assertIn("transcript/code", plan)
        self.assertIn("immediately if seeding fails before a child starts", plan)
        self.assertIn('--bin "claude" --expected-version "2.1.220 (Claude Code)" --cwd "/tmp/frame-scratch"', plan)
        self.assertNotIn("pip install pyte", plan)

    def test_successful_synthetic_children_use_one_scheduler_robust_keepalive(self):
        source = Path(__file__).read_text(encoding="utf-8")
        self.assertIn("LIVE_CHILD_KEEPALIVE_SECONDS = 5", source)
        self.assertIn("PARTIAL_CHILD_KEEPALIVE_SECONDS = 0.15", source)
        self.assertEqual(len(re.findall(r"self\.live_child_command\(", source)), 44)
        self.assertEqual(len(re.findall(r"self\.partial_child_command\(", source)), 2)
        self.assertIn("self.dead_child_command()", source)
        self.assertNotIn("self." + "child_command(", source)


if __name__ == "__main__":
    unittest.main()
