"""Shared scoped masking contract for capture-at-rest and frame comparison."""
import fnmatch
import json
import os
import re
from pathlib import Path
from typing import Any

MASK_TOKEN = "▒"
# Capture reconstructs SGR with ESC [ parameter/intermediate bytes and an `m` final byte. Remove only
# those zero-width style transitions for residual identity detection; the stored frame remains untouched.
SGR_TRANSITION = re.compile(r"\x1b\[[0-?]*[ -/]*m")


class Mask:
    def __init__(self, spec: dict[str, Any]):
        self.name = spec.get("name", spec["pattern"])
        self.pattern = re.compile(spec["pattern"])
        self.replacement = spec.get("replacement", MASK_TOKEN)
        self.minimum_matches = spec.get("minimum_matches", 0)


class StateRule:
    def __init__(self, spec: dict[str, Any]):
        self.name = spec["name"]
        self.pattern = re.compile(spec["pattern"])
        self.minimum_matches = spec.get("minimum_matches", 1)


class DashboardStatusMask:
    """Redact only the nearest status identity before a recognized dashboard footer."""
    def __init__(self, spec: dict[str, Any]):
        self.name = spec["name"]
        self.identity_pattern = re.compile(spec["identity_pattern"])
        self.semantic_identity_pattern = re.compile(spec["semantic_identity_pattern"])
        self.mode_pattern = re.compile(spec["mode_pattern"])
        self.marker_pattern = re.compile(spec["marker_pattern"])
        self.replacement = spec.get("replacement", MASK_TOKEN)
        self.semantic_masked_pattern = re.compile(
            rf"(?:^|\n) {{2,}}{re.escape(self.replacement)}(?=(?:\n+)?:(?:\n+)?/)"
        )
        self.minimum_matches = spec.get("minimum_matches", 0)

    def _blocks(self, text: str) -> list[tuple[int, int, int, bool, bool]]:
        raw_lines = text.splitlines(keepends=True)
        semantic_lines = [SGR_TRANSITION.sub("", line).rstrip("\r\n") for line in raw_lines]
        blocks = []
        for marker_index, marker in enumerate(semantic_lines):
            if not self.marker_pattern.fullmatch(marker):
                continue
            start = marker_index
            while start and semantic_lines[start - 1].strip():
                start -= 1
            semantic_block = "\n".join(semantic_lines[start:marker_index])
            candidates = [(match, False) for match in self.semantic_identity_pattern.finditer(semantic_block)]
            candidates.extend((match, True) for match in self.semantic_masked_pattern.finditer(semantic_block))
            if not candidates:
                continue
            candidate, masked = max(candidates, key=lambda item: item[0].start())
            candidate_start = start + semantic_block.count("\n", 0, candidate.start()) + int(candidate.group(0).startswith("\n"))
            candidate_end = start + semantic_block.count("\n", 0, candidate.end())
            blocks.append((candidate_start, candidate_end, marker_index, bool(self.mode_pattern.fullmatch(marker)), masked))
        return blocks

    def redact(self, text: str) -> tuple[str, int]:
        raw_lines = text.splitlines(keepends=True)
        offsets = []
        offset = 0
        for line in raw_lines:
            offsets.append(offset)
            offset += len(line)
        spans = set()
        for candidate_start, candidate_end, _marker_index, recognized, masked in self._blocks(text):
            if not recognized or masked:
                continue
            for line_index in range(candidate_start, candidate_end + 1):
                for match in self.identity_pattern.finditer(raw_lines[line_index]):
                    spans.add((offsets[line_index] + match.start(), offsets[line_index] + match.end()))
        for start, end in sorted(spans, reverse=True):
            text = text[:start] + self.replacement + text[end:]
        return text, len(spans)

    def has_unredacted_identity(self, text: str) -> bool:
        return any(not masked for _start, _end, _marker, _recognized, masked in self._blocks(text))


class RedactionContract:
    def __init__(self, masks: list[Mask], identity_guards: list[Mask], dashboard_statuses: list[DashboardStatusMask], minimum_matches: int, declared: bool):
        self.masks = masks
        self.identity_guards = identity_guards
        self.dashboard_statuses = dashboard_statuses
        self.minimum_matches = minimum_matches
        self.declared = declared


class RequiredStateContract:
    def __init__(self, required: list[StateRule], forbidden: list[StateRule], declared: bool):
        self.required = required
        self.forbidden = forbidden
        self.declared = declared


def read_config(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


FIXTURE_MARKER = ("test", "fixtures", "upstream-frames")


def canonical_path(path: str) -> Path:
    try:
        return Path(path).resolve(strict=False)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError(f"cannot resolve frame path {path!r}: {error}") from error


def tracked_fixture_relative(path: str) -> str | None:
    """Return a scenario path only when the canonical target is inside an upstream-fixtures root."""
    target = canonical_path(path)
    parts = target.parts
    marker_norm = tuple(os.path.normcase(part) for part in FIXTURE_MARKER)
    for index in range(len(parts) - len(FIXTURE_MARKER), -1, -1):
        candidate = Path(*parts[:index + len(FIXTURE_MARKER)])
        component_match = tuple(os.path.normcase(part) for part in parts[index:index + len(FIXTURE_MARKER)]) == marker_norm
        expected = Path(*parts[:index]).joinpath(*FIXTURE_MARKER)
        try:
            case_alias = candidate.exists() and expected.exists() and candidate.samefile(expected)
        except OSError:
            case_alias = False
        if not (component_match or case_alias):
            continue
        try:
            relative = target.relative_to(candidate)
        except ValueError:
            continue
        return "" if relative == Path(".") else relative.as_posix()
    return None


def frame_key(directory: str, name: str) -> str:
    """Use tracked canonical scenario paths, or the canonical basename for deterministic scratch keys."""
    tracked_relative = tracked_fixture_relative(directory)
    scenario = tracked_relative if tracked_relative is not None else canonical_path(directory).name
    return f"{scenario}/{name}" if scenario else name


def _require_count(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _require_positive_count(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def load_redaction_contract(path: str, frame_key: str | None) -> RedactionContract:
    data = read_config(path)
    if frame_key is None:
        return RedactionContract([], [], [], 0, False)
    masks: list[Mask] = []
    identity_guards: list[Mask] = []
    dashboard_statuses: list[DashboardStatusMask] = []
    minimum_matches = 0
    declared = False
    for glob, scoped in data.get("redactions_by_frame", {}).items():
        if not fnmatch.fnmatch(frame_key, glob):
            continue
        declared = True
        if not isinstance(scoped, dict):
            raise ValueError(f"redactions_by_frame[{glob!r}] must declare patterns and minimum_matches")
        specs = scoped.get("patterns")
        if not isinstance(specs, list):
            raise ValueError(f"redactions_by_frame[{glob!r}].patterns must be a list")
        guard_specs = scoped.get("identity_guards", [])
        if not isinstance(guard_specs, list):
            raise ValueError(f"redactions_by_frame[{glob!r}].identity_guards must be a list")
        dashboard_status = scoped.get("dashboard_status")
        if dashboard_status is not None:
            required = ("name", "identity_pattern", "semantic_identity_pattern", "mode_pattern", "marker_pattern")
            if not isinstance(dashboard_status, dict) or any(not isinstance(dashboard_status.get(key), str) for key in required):
                raise ValueError(f"redactions_by_frame[{glob!r}].dashboard_status must declare {', '.join(required)}")
            dashboard_status = dict(dashboard_status)
            dashboard_status["minimum_matches"] = _require_count(
                dashboard_status.get("minimum_matches"), f"redactions_by_frame[{glob!r}].dashboard_status.minimum_matches",
            )
            dashboard_statuses.append(DashboardStatusMask(dashboard_status))
        minimum_matches += _require_count(scoped.get("minimum_matches"), f"redactions_by_frame[{glob!r}].minimum_matches")
        for index, spec in enumerate(specs):
            if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or not isinstance(spec.get("pattern"), str):
                raise ValueError(f"redactions_by_frame[{glob!r}].patterns[{index}] must declare name and pattern")
            spec = dict(spec)
            spec["minimum_matches"] = _require_count(spec.get("minimum_matches"), f"redactions_by_frame[{glob!r}].patterns[{index}].minimum_matches")
            masks.append(Mask(spec))
        for index, spec in enumerate(guard_specs):
            if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or not isinstance(spec.get("pattern"), str):
                raise ValueError(f"redactions_by_frame[{glob!r}].identity_guards[{index}] must declare name and pattern")
            identity_guards.append(Mask(spec))
    return RedactionContract(masks, identity_guards, dashboard_statuses, minimum_matches, declared)


def load_required_state_contract(path: str, frame_key: str | None) -> RequiredStateContract:
    data = read_config(path)
    if frame_key is None:
        return RequiredStateContract([], [], False)
    required: list[StateRule] = []
    forbidden: list[StateRule] = []
    declared = False
    for glob, scoped in data.get("required_state_by_frame", {}).items():
        if not fnmatch.fnmatch(frame_key, glob):
            continue
        declared = True
        if not isinstance(scoped, dict):
            raise ValueError(f"required_state_by_frame[{glob!r}] must declare required and forbidden rules")
        for field, target, needs_count in (("required", required, True), ("forbidden", forbidden, False)):
            specs = scoped.get(field, [])
            if not isinstance(specs, list):
                raise ValueError(f"required_state_by_frame[{glob!r}].{field} must be a list")
            for index, spec in enumerate(specs):
                if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or not isinstance(spec.get("pattern"), str):
                    raise ValueError(f"required_state_by_frame[{glob!r}].{field}[{index}] must declare name and pattern")
                spec = dict(spec)
                if needs_count:
                    spec["minimum_matches"] = _require_positive_count(
                        spec.get("minimum_matches"), f"required_state_by_frame[{glob!r}].{field}[{index}].minimum_matches",
                    )
                target.append(StateRule(spec))
    return RequiredStateContract(required, forbidden, declared)


def validate_required_state(text: str, contract: RequiredStateContract) -> list[str]:
    semantic_text = SGR_TRANSITION.sub("", text)
    failures = []
    for rule in contract.required:
        matches = len(rule.pattern.findall(semantic_text))
        if matches < rule.minimum_matches:
            failures.append(f"required state {rule.name} matched {matches}/{rule.minimum_matches}")
    for rule in contract.forbidden:
        if rule.pattern.search(semantic_text):
            failures.append(f"forbidden state {rule.name}")
    return failures


def load_redactions(path: str, frame_key: str | None = None) -> list[Mask]:
    return load_redaction_contract(path, frame_key).masks


def redact_text(text: str, contract: RedactionContract) -> tuple[str, list[str]]:
    total_matches = 0
    failures: list[str] = []
    for mask in contract.masks:
        text, matches = mask.pattern.subn(mask.replacement, text)
        total_matches += matches
        if matches < mask.minimum_matches:
            failures.append(f"{mask.name} matched {matches}/{mask.minimum_matches}")
    for status in contract.dashboard_statuses:
        text, matches = status.redact(text)
        total_matches += matches
        if matches < status.minimum_matches:
            failures.append(f"{status.name} matched {matches}/{status.minimum_matches}")
    if total_matches < contract.minimum_matches:
        failures.append(f"total matched {total_matches}/{contract.minimum_matches}")
    semantic_text = SGR_TRANSITION.sub("", text)
    for guard in contract.identity_guards:
        if guard.pattern.search(semantic_text):
            failures.append(f"unredacted identity {guard.name}")
    for status in contract.dashboard_statuses:
        if status.has_unredacted_identity(text):
            failures.append(f"unredacted identity {status.name}")
    return text, failures


def preprocess_frame_for_publication(text: str, contract: RedactionContract) -> tuple[str, list[str]]:
    """Apply the tracked-frame privacy contract to a complete rendered frame."""
    return redact_text(text, contract)


def load_comparison_masks(path: str, frame_key: str | None = None) -> list[Mask]:
    """Load only line-compatible, comparison-only nondeterminism masks."""
    data = read_config(path)
    specs: list[dict[str, Any]] = list(data.get("patterns", []))
    if frame_key is not None:
        for glob, scoped in data.get("by_frame", {}).items():
            if fnmatch.fnmatch(frame_key, glob):
                specs.extend(scoped)
    return [Mask(spec) for spec in specs]


def load_masks(path: str, frame_key: str | None = None) -> list[Mask]:
    """Legacy combined view for direct callers; frame comparison uses the split APIs below."""
    return [*load_redactions(path, frame_key), *load_comparison_masks(path, frame_key)]


def mask_text(text: str, masks: list[Mask]) -> str:
    for mask in masks:
        text = mask.pattern.sub(mask.replacement, text)
    return text


DIAGNOSTIC_SGR_PATTERN = re.compile(r"\x1b\[[0-?]*[ -/]*m")
DIAGNOSTIC_IDENTITY = re.compile(r"[^\s@:/]+@[^\s@:/]+(?=:/)")
DIAGNOSTIC_COMPONENT_CHAR = re.compile(r"[^\s@:/]")


def diagnostic_projection(text: str) -> tuple[str, list[int]]:
    """Flatten ANSI and physical diff rows into visible characters with source offsets."""
    visible, offsets = [], []
    cursor = 0
    line_start = True
    while cursor < len(text):
        if line_start:
            if text[cursor:cursor + 1] in ("+", "-", " "):
                cursor += 1
            while cursor < len(text):
                sgr = DIAGNOSTIC_SGR_PATTERN.match(text, cursor)
                if sgr:
                    cursor = sgr.end()
                elif text[cursor] in " \t":
                    cursor += 1
                else:
                    break
            line_start = False
            continue
        sgr = DIAGNOSTIC_SGR_PATTERN.match(text, cursor)
        if sgr:
            cursor = sgr.end()
        elif text[cursor] == "\n":
            cursor += 1
            line_start = True
        else:
            visible.append(text[cursor])
            offsets.append(cursor)
            cursor += 1
    return "".join(visible), offsets


def redact_diagnostic_text(text: str) -> str:
    """Protect ANSI- and row-wrapped identities in printed diffs without changing comparison semantics."""
    projection, offsets = diagnostic_projection(text)
    masked = set()
    for identity in DIAGNOSTIC_IDENTITY.finditer(projection):
        start = identity.start()
        previous_at = projection.rfind("@", 0, start)
        if previous_at >= 0:
            alternate_start = previous_at
            while alternate_start and DIAGNOSTIC_COMPONENT_CHAR.fullmatch(projection[alternate_start - 1]):
                alternate_start -= 1
            if re.search(r"\n[+\-]", text[offsets[previous_at]:offsets[identity.end() - 1]]):
                start = alternate_start
        for index in range(start, identity.end()):
            if DIAGNOSTIC_COMPONENT_CHAR.fullmatch(projection[index]):
                masked.add(offsets[index])
    redacted = []
    cursor = 0
    while cursor < len(text):
        if cursor in masked:
            while cursor < len(text) and cursor in masked:
                cursor += 1
            redacted.append(MASK_TOKEN)
        else:
            redacted.append(text[cursor])
            cursor += 1
    return "".join(redacted)


def sanitize_frame_for_comparison(
    text: str, contract: RedactionContract, comparison_masks: list[Mask],
) -> tuple[list[str], list[str]]:
    """Sanitize a complete frame for comparison without imposing publication coverage counts.

    Stored goldens are already redacted, so their former raw substitutions cannot be required again.
    Residual identity guards still fail closed before an input can reach a fingerprint or rendered diff.
    """
    for mask in contract.masks:
        text = mask.pattern.sub(mask.replacement, text)
    for status in contract.dashboard_statuses:
        text, _ = status.redact(text)
    semantic_text = SGR_TRANSITION.sub("", text)
    failures = [f"unredacted identity {guard.name}" for guard in contract.identity_guards if guard.pattern.search(semantic_text)]
    failures.extend(f"unredacted identity {status.name}" for status in contract.dashboard_statuses if status.has_unredacted_identity(text))
    if failures:
        return [], failures
    return [mask_text(line, comparison_masks) for line in text.splitlines()], []
