"""Shared scoped masking contract for capture-at-rest and frame comparison."""
import fnmatch
import json
import re
from typing import Any

MASK_TOKEN = "▒"


class Mask:
    def __init__(self, spec: str | dict[str, str]):
        if isinstance(spec, str):
            pattern, replacement = spec, MASK_TOKEN
        else:
            pattern, replacement = spec["pattern"], spec.get("replacement", MASK_TOKEN)
        self.pattern = re.compile(pattern)
        self.replacement = replacement


def load_redactions(path: str, frame_key: str | None = None) -> list[Mask]:
    with open(path, encoding="utf-8") as f:
        data: dict[str, Any] = json.load(f)
    specs: list[str | dict[str, str]] = []
    if frame_key is not None:
        for glob, scoped in data.get("redactions_by_frame", {}).items():
            if fnmatch.fnmatch(frame_key, glob):
                specs.extend(scoped)
    return [Mask(spec) for spec in specs]


def load_masks(path: str, frame_key: str | None = None) -> list[Mask]:
    with open(path, encoding="utf-8") as f:
        data: dict[str, Any] = json.load(f)
    specs: list[str | dict[str, str]] = list(data.get("patterns", []))
    if frame_key is not None:
        for section in ("redactions_by_frame", "by_frame"):
            for glob, scoped in data.get(section, {}).items():
                if fnmatch.fnmatch(frame_key, glob):
                    specs.extend(scoped)
    return [Mask(spec) for spec in specs]


def mask_text(text: str, masks: list[Mask]) -> str:
    for mask in masks:
        text = mask.pattern.sub(mask.replacement, text)
    return text
