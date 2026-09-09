#!/usr/bin/env python3
"""
Build a normalized surface index for the TUI-to-GUI study.

Parses the seven lane card files (A-G), extracts one row per card by
joining the card body (Terminal/Job/Wire/afleet today/GUI form/Drops-keeps-
gains/Open) with the lane's "## Ranking input" table, and writes:

  - surface-index.md  (one table per lane, plus summary counts)
  - surface-index.csv (flat CSV, same columns)
"""
import re
import csv
import sys
from pathlib import Path

SURF_DIR = Path("/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces")
LANES = ["A", "B", "C", "D", "E", "F", "G"]
LANE_FILES = {
    "A": "A-chrome-and-status.md",
    "B": "B-transcript-rendering.md",
    "C": "C-composer-and-input.md",
    "D": "D-decision-dialogs.md",
    "E": "E-panel-commands-settings.md",
    "F": "F-panel-commands-session.md",
    "G": "G-fleet-and-agents.md",
}

STATUS_VOCAB = ["built", "designed", "routed-only", "undesigned", "superseded", "out-of-scope"]
STATUS_RE = re.compile(r"`?\b(" + "|".join(STATUS_VOCAB) + r")\b`?", re.IGNORECASE)

# Wire-class letters appear plain, backticked, or bold ("D for most of it.", "`P`",
# "**X.**") — a bare word-boundary match catches all three forms and, per spot-check
# against the source cards, produces no false positives (P/R/D/X/T never occur as
# standalone words for any other reason in this corpus).
WIRE_LETTER_RE = re.compile(r"\b([PRDXT])\b")

CARD_HEAD_RE = re.compile(r"^### ([A-G]-\d+) \u00b7 (.+?)\s*$", re.MULTILINE)
RANKING_HEAD_RE = re.compile(r"^## Ranking input\s*$", re.MULTILINE)
SECTION_LABEL_RE = re.compile(r"^\*\*([^*\n]+?)\.\*\*", re.MULTILINE)

TAB_NAMES = [
    "Raw transcript", "Source Control", "Source Ctl", "Agents", "Files",
    "Terminal", "Browser", "GitHub", "Thread", "Stats", "Usage", "Diff",
]
TAB_RE = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in TAB_NAMES) + r")\s+(?:panel\s+)?tab\b",
    re.IGNORECASE,
)
TAB_RE2 = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in TAB_NAMES) + r")\s+panel\b",
    re.IGNORECASE,
)

REGION_VOCAB = [
    # Two-word region names also occur as hyphenated compound adjectives
    # ("channel-banner strips", "decision-card family") — accept either.
    ("channel banner", r"channel[- ]banner"),
    ("channel header", r"channel[- ]header"),
    ("quick switcher", r"quick[- ]switcher"),
    ("consent sheet", r"consent[- ]sheet"),
    ("decision card", r"decision[- ]card"),
    ("menu bar", r"menu[- ]bar"),
    ("composer", r"\bcomposer\b|\bshortcut bar\b"),
    ("timeline", r"\btimeline\b"),
    ("sidebar", r"\bsidebar\b"),
    ("consent sheet", r"consent[- ]dialog"),
    ("notification", r"\bnotification\b"),
    ("toast", r"\btoast\b"),
    ("popover", r"\bpopover\b"),
    # Named sub-panes of the Settings window (lane E) that don't spell "Settings" out.
    ("Settings", r"\b(Defaults pane|Overrides sheet|Account pane|Extensions pane|Rule details pane)\b"),
    # Header pickers/controls beside model/mode/effort (lane E, G) that don't spell
    # out "channel header".
    ("channel header", r"\bheader (?:picker|control)\b"),
]
# Case-insensitive phrase matches (safe: these phrases are rare as generic prose).
REGION_COMPILED = [(name, re.compile(pat, re.IGNORECASE)) for name, pat in REGION_VOCAB]
# Case-sensitive: "Activity" and "Settings" are common English words too, so only the
# capitalised, proper-noun form (afleet's Activity panel / Settings window) counts.
REGION_COMPILED_CASE_SENSITIVE = [
    ("Activity", re.compile(r"\bActivity\b")),
    ("Settings", re.compile(r"\bSettings\b")),
]
# Lane D ("decision dialogs") uses "dialog" as a loose synonym for its one region,
# "decision card", far more often than it spells the region out. Scope this synonym
# to lane D only so it doesn't swallow "Settings dialog" / "file dialog" mentions
# in other lanes that mean something else.
LANE_D_DIALOG_RE = re.compile(r"\b(dialog|confirmation sheet)\b", re.IGNORECASE)
# Lane C ("composer and input") is, almost without exception, about the composer
# field itself; most of its cards never repeat the word "composer" in the GUI form
# paragraph because it is the lane's implicit subject. Cards that are genuinely
# regionless (out-of-scope config-file mechanics) are excluded by status below.
LANE_C_FALLBACK_STATUSES = {"built", "designed", "undesigned", "superseded", "routed-only"}

TRIVIAL_GAIN_RE = re.compile(r"^\s*(nothing user-visible|nothing|n/a|none)\b", re.IGNORECASE)


def split_sections(block_text):
    """Split a card body into {label: content} using bold '**Label.**' markers."""
    matches = list(SECTION_LABEL_RE.finditer(block_text))
    sections = {}
    for i, m in enumerate(matches):
        label = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(block_text)
        content = block_text[start:end].strip()
        # First occurrence wins if a label repeats (shouldn't happen for our 7 labels)
        sections.setdefault(label, content)
    return sections


def extract_status(text):
    if not text:
        return None
    m = STATUS_RE.search(text)
    if m:
        return m.group(1).lower()
    return None


def extract_wire_class(text):
    if not text:
        return "n/a"
    letters = []
    for m in WIRE_LETTER_RE.finditer(text):
        L = m.group(1)
        if L not in letters:
            letters.append(L)
    if not letters:
        return "n/a"
    return "/".join(letters)


SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _strip_exceeds_clauses(text):
    """Drop whole sentences carrying an `[exceeds]` tag (wherever the tag sits
    in the sentence): they describe a bonus/aside capability, not the card's
    primary GUI placement, and can otherwise win a first-mention-wins region
    search by sitting earlier in the paragraph than the real answer."""
    if not text or "[exceeds]" not in text:
        return text
    sentences = SENTENCE_SPLIT_RE.split(text)
    return " ".join(s for s in sentences if "[exceeds]" not in s)


def _region_candidates(source, lane):
    local = []
    for rx in (TAB_RE, TAB_RE2):
        m = rx.search(source)
        if m:
            name = m.group(1)
            if name.lower() == "source ctl":
                name = "Source Control"
            local.append((m.start(), f"panel:{name}"))
            break
    for name, rx in REGION_COMPILED:
        m = rx.search(source)
        if m:
            local.append((m.start(), name))
    for name, rx in REGION_COMPILED_CASE_SENSITIVE:
        m = rx.search(source)
        if m:
            local.append((m.start(), name))
    if lane == "D":
        m = LANE_D_DIALOG_RE.search(source)
        if m:
            local.append((m.start(), "decision card"))
    return local


def extract_region(gui_form_text, dkg_text, open_text, lane=None, status=None):
    raw_sources = (gui_form_text, dkg_text, open_text)
    stripped_sources = tuple(_strip_exceeds_clauses(s) for s in raw_sources)

    for sources in (stripped_sources, raw_sources):
        candidates = []
        for source in sources:
            if not source:
                continue
            candidates = _region_candidates(source, lane)
            if candidates:
                break  # only fall through to dkg/open if this source had nothing
        if candidates:
            candidates.sort(key=lambda x: x[0])
            return candidates[0][1]

    if lane == "C" and status in LANE_C_FALLBACK_STATUSES:
        return "composer"
    return "none"


def normalize_value(raw):
    if raw is None:
        return ""
    s = raw.replace("*", "").replace("`", "")
    # The convention is "VALUE — explanation" (em dash specifically; a bare
    # hyphen can be part of the value word itself, e.g. "med-high"). Restrict
    # the search to the part before the first em dash so prose like "...told
    # there is none" doesn't get mistaken for a "none" rating. Fall back to
    # the full string if there is no em-dash-delimited explanation at all.
    head = s.split("—", 1)[0]
    hits = re.findall(r"\b(high|med|medium|low|none)\b", head, re.IGNORECASE)
    if not hits:
        hits = re.findall(r"\b(high|med|medium|low|none)\b", s, re.IGNORECASE)
    if not hits:
        return raw.strip()
    seen = []
    for h in hits:
        v = h.lower()
        if v == "medium":
            v = "med"
        if v not in seen:
            seen.append(v)
    return "/".join(seen)


def normalize_cost(raw):
    if raw is None:
        return ""
    s = raw.replace("*", "").replace("`", "")
    if re.search(r"\bnone\b", s, re.IGNORECASE) or re.fullmatch(r"\s*[\u2014\-]+\s*", s):
        return "none"
    s = s.replace("\u2013", "/").replace("\u2014", "/")  # en/em dash -> slash for ranges like S-M
    codes = re.findall(r"\b([SML])\b", s)
    seen = []
    for c in codes:
        if c not in seen:
            seen.append(c)
    if not seen:
        return raw.strip()
    return "/".join(seen)


def clean_depends(raw):
    if raw is None:
        return ""
    s = raw.strip()
    if s in ("\u2014", "-", ""):
        return "\u2014"
    return s


# Hand-verified corrections found during the 20-row spot-check (see report):
# the mechanical region search has no better signal than a `[exceeds]`-tagged
# aside for these two cards, and that aside names a bonus capability, not the
# card's actual primary placement. Fixed by inspection of the source card.
REGION_OVERRIDES = {
    # "The fullscreen boot canary" is fully superseded ("Gains: n/a", "nothing
    # in chrome needs it"); "Browser tab" is just one example in a backlog
    # note about a *different*, hypothetical future subsystem, not this
    # card's own placement.
    "A-04": "none",
    # "The bullet state machine" is the tool-call row's own status glyph; the
    # channel-header mention is a `[exceeds]` aside about a *summary count*,
    # not where the bullet itself lives.
    "B-02": "timeline",
    # "The per-row dry-run summaries" render inside the /rewind picker sheet;
    # the Source Control mention is a `[exceeds]` aside about a bonus
    # hover/click affordance. The picker sheet has no clean match in the
    # controlled vocabulary, so "none" is more honest than a wrong panel.
    "F-28": "none",
}


def parse_ranking_table(text):
    """Return {card_id: {'status':.., 'value':.., 'cost':.., 'depends':..}}"""
    m = RANKING_HEAD_RE.search(text)
    rows = {}
    if not m:
        return rows
    tail = text[m.end():]
    for line in tail.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            # stop once we leave the table block after having seen rows,
            # but tables may be followed by prose; just keep scanning until
            # a non-table, non-blank line after the header separator seen.
            if rows and not line.startswith("|"):
                break
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 7:
            continue
        card_id = parts[1]
        if not re.match(r"^[A-G]-\d+$", card_id):
            continue  # header or separator row
        rows[card_id] = {
            "status_raw": parts[3],
            "value_raw": parts[4],
            "cost_raw": parts[5],
            "depends_raw": parts[6],
        }
    return rows


def parse_lane(lane):
    path = SURF_DIR / LANE_FILES[lane]
    text = path.read_text()
    ranking = parse_ranking_table(text)

    head_matches = list(CARD_HEAD_RE.finditer(text))
    ranking_head_m = RANKING_HEAD_RE.search(text)
    ranking_start = ranking_head_m.start() if ranking_head_m else len(text)

    cards = []
    parse_errors = []

    for i, hm in enumerate(head_matches):
        card_id = hm.group(1)
        surface = hm.group(2).strip()
        body_start = hm.end()
        body_end = head_matches[i + 1].start() if i + 1 < len(head_matches) else ranking_start
        body = text[body_start:body_end]

        sections = split_sections(body)
        afleet_today = sections.get("afleet today", "")
        gui_form = sections.get("GUI form", "")
        dkg = sections.get("Drops / keeps / gains", "")
        wire = sections.get("Wire", "")
        openp = sections.get("Open", "")

        status = extract_status(afleet_today)
        rank = ranking.get(card_id)

        fallback_used = None
        if status is None:
            if rank is not None:
                status = extract_status(rank["status_raw"])
                fallback_used = "ranking-table"
        if status is None:
            parse_errors.append((card_id, "no afleet-today status found in card body or ranking row"))
            status = ""

        wire_class = extract_wire_class(wire)
        region = extract_region(gui_form, dkg, openp, lane=lane, status=status)
        if card_id in REGION_OVERRIDES:
            region = REGION_OVERRIDES[card_id]

        # Exceeds?
        exceeds = ""
        tag_present = ("[exceeds]" in gui_form) or ("[exceeds]" in dkg)
        if tag_present:
            exceeds = "yes"
        elif status == "built":
            gm = re.search(r"Gains:\s*(.+?)(?:$)", dkg, re.DOTALL)
            gain_text = gm.group(1).strip() if gm else ""
            gain_text = gain_text.split("\n\n")[0].strip()
            if gain_text and not TRIVIAL_GAIN_RE.match(gain_text):
                exceeds = "yes"

        if rank is None:
            parse_errors.append((card_id, "no matching ranking-table row"))
            value = ""
            cost = ""
            depends = ""
        else:
            value = normalize_value(rank["value_raw"])
            cost = normalize_cost(rank["cost_raw"])
            depends = clean_depends(rank["depends_raw"])

        cards.append({
            "lane": lane,
            "card": card_id,
            "surface": surface,
            "status": status,
            "region": region,
            "wire": wire_class,
            "value": value,
            "cost": cost,
            "exceeds": exceeds,
            "depends": depends,
        })

    # ids present in ranking table but missing a card heading (shouldn't happen)
    card_ids = {c["card"] for c in cards}
    for rid in ranking:
        if rid not in card_ids:
            parse_errors.append((rid, "ranking row with no matching card heading"))

    return cards, parse_errors


def main():
    all_cards = []
    all_errors = []
    for lane in LANES:
        cards, errors = parse_lane(lane)
        all_cards.extend(cards)
        all_errors.extend(errors)

    # ---- CSV ----
    csv_path = Path("/Users/new/.claude/jobs/4b30d1a4/tmp/tui-to-gui/surface-index.csv")
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    header = ["Card", "Surface", "afleet status", "GUI region", "Wire class", "Value", "Cost", "Exceeds?", "Depends on"]
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for c in all_cards:
            w.writerow([c["card"], c["surface"], c["status"], c["region"], c["wire"],
                        c["value"], c["cost"], c["exceeds"], c["depends"]])

    # ---- MD ----
    md_path = Path("/Users/new/Developer/GitHub/somersault/tui-to-gui/surface-index.md")
    lines = []
    lines.append("# Surface index\n")
    lines.append(f"Total cards: {len(all_cards)}\n")

    lines.append("\n## Counts per lane\n")
    lines.append("| Lane | Cards |")
    lines.append("|---|---|")
    for lane in LANES:
        n = sum(1 for c in all_cards if c["lane"] == lane)
        lines.append(f"| {lane} | {n} |")

    lines.append("\n## Counts per status\n")
    lines.append("| afleet status | Count |")
    lines.append("|---|---|")
    from collections import Counter
    status_counts = Counter(c["status"] or "(unparsed)" for c in all_cards)
    for s in STATUS_VOCAB + ["(unparsed)"]:
        if status_counts.get(s):
            lines.append(f"| {s} | {status_counts[s]} |")
    for s, n in status_counts.items():
        if s not in STATUS_VOCAB and s != "(unparsed)":
            lines.append(f"| {s} | {n} |")

    lines.append("\n## Counts per GUI region (across all lanes)\n")
    lines.append("| GUI region | Count |")
    lines.append("|---|---|")
    region_counts = Counter(c["region"] for c in all_cards)
    for region, n in sorted(region_counts.items(), key=lambda x: (-x[1], x[0])):
        lines.append(f"| {region} | {n} |")

    col_header = "| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |"
    col_sep = "|---|---|---|---|---|---|---|---|---|"

    lane_names = {
        "A": "chrome and status",
        "B": "transcript rendering",
        "C": "composer and input",
        "D": "decision dialogs",
        "E": "panel commands: settings",
        "F": "panel commands: session",
        "G": "fleet and agents",
    }
    for lane in LANES:
        lane_cards = [c for c in all_cards if c["lane"] == lane]
        lines.append(f"\n## Lane {lane} — {lane_names[lane]} ({len(lane_cards)} cards)\n")
        lines.append(col_header)
        lines.append(col_sep)
        for c in lane_cards:
            def esc(s):
                return (s or "").replace("|", "\\|").replace("\n", " ")
            lines.append(
                f"| {c['card']} | {esc(c['surface'])} | {c['status']} | {esc(c['region'])} | "
                f"{esc(c['wire'])} | {c['value']} | {c['cost']} | {c['exceeds']} | {esc(c['depends'])} |"
            )

    md_path.write_text("\n".join(lines) + "\n")

    # ---- report to stdout ----
    print(f"TOTAL_ROWS={len(all_cards)}")
    for lane in LANES:
        n = sum(1 for c in all_cards if c["lane"] == lane)
        print(f"LANE_{lane}={n}")
    print("STATUS_COUNTS=" + repr(dict(status_counts)))
    print("REGION_COUNTS=" + repr(dict(region_counts)))
    print(f"PARSE_ERRORS={len(all_errors)}")
    for e in all_errors:
        print("ERROR:", e)
    print("MD_PATH=", md_path)
    print("CSV_PATH=", csv_path)


if __name__ == "__main__":
    main()
