"""Shared scoped masking contract for capture-at-rest and frame comparison."""
import fnmatch
import json
import os
import re
from pathlib import Path
from typing import Any

MASK_TOKEN = "▒"


class Mask:
    def __init__(self, spec: dict[str, Any]):
        self.name = spec.get("name", spec["pattern"])
        self.pattern = re.compile(spec["pattern"])
        self.replacement = spec.get("replacement", MASK_TOKEN)
        self.minimum_matches = spec.get("minimum_matches", 0)


class RedactionContract:
    def __init__(self, masks: list[Mask], minimum_matches: int, declared: bool):
        self.masks = masks
        self.minimum_matches = minimum_matches
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
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def load_redaction_contract(path: str, frame_key: str | None) -> RedactionContract:
    data = read_config(path)
    if frame_key is None:
        return RedactionContract([], 0, False)
    masks: list[Mask] = []
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
        minimum_matches += _require_count(scoped.get("minimum_matches"), f"redactions_by_frame[{glob!r}].minimum_matches")
        for index, spec in enumerate(specs):
            if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or not isinstance(spec.get("pattern"), str):
                raise ValueError(f"redactions_by_frame[{glob!r}].patterns[{index}] must declare name and pattern")
            spec = dict(spec)
            spec["minimum_matches"] = _require_count(spec.get("minimum_matches"), f"redactions_by_frame[{glob!r}].patterns[{index}].minimum_matches")
            masks.append(Mask(spec))
    return RedactionContract(masks, minimum_matches, declared)


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
    if total_matches < contract.minimum_matches:
        failures.append(f"total matched {total_matches}/{contract.minimum_matches}")
    return text, failures


def load_masks(path: str, frame_key: str | None = None) -> list[Mask]:
    data = read_config(path)
    specs: list[dict[str, Any]] = list(data.get("patterns", []))
    if frame_key is not None:
        for glob, scoped in data.get("redactions_by_frame", {}).items():
            if fnmatch.fnmatch(frame_key, glob):
                if not isinstance(scoped, dict):
                    raise ValueError(f"redactions_by_frame[{glob!r}] must declare patterns and minimum_matches")
                specs.extend(scoped.get("patterns", []))
        for glob, scoped in data.get("by_frame", {}).items():
            if fnmatch.fnmatch(frame_key, glob):
                specs.extend(scoped)
    return [Mask(spec) for spec in specs]


def mask_text(text: str, masks: list[Mask]) -> str:
    for mask in masks:
        text = mask.pattern.sub(mask.replacement, text)
    return text
