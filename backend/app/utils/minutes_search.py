"""Searching the words of a set of minutes.

The archive search reads text that SQL cannot index: section content lives in a
JSON column, in plain text or a small subset of HTML. So the matching is done
here, on text that has already been turned into words, and the snippets it
returns are structured (``{"text", "hit"}`` parts) rather than markup — the
screen marks a hit by styling a part, never by rendering HTML it was handed.

Matching rules, which the screen explains to the person searching:

* every word typed must appear somewhere in the minutes, not necessarily in the
  same place, so "budget hose" finds minutes that discuss both;
* a word matches where a word *starts* ("hose" finds "hoses", not "purchase");
* a phrase in double quotes must appear as typed, whatever whitespace or line
  breaks separate its words in the minutes.
"""

import re
from dataclasses import dataclass
from typing import Any, Optional

MIN_TERM_LENGTH = 2
MAX_TERMS = 8
MAX_QUERY_LENGTH = 200
SNIPPET_RADIUS = 70
MAX_MATCHES_PER_MINUTES = 5

_TOKEN = re.compile(r'"([^"]*)"|(\S+)')
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class Source:
    """One place in a set of minutes that holds words."""

    kind: str
    label: str
    text: str


def normalize_whitespace(text: str) -> str:
    """Runs of whitespace (including line breaks) as single spaces."""
    return _WHITESPACE.sub(" ", text).strip()


def parse_query(raw: str) -> list[str]:
    """The words and quoted phrases typed, lower-cased and without repeats.

    A word shorter than two characters or with no letter or digit in it would
    match nearly everything, so it is left out; the number of terms is capped so
    a pasted paragraph cannot become a very large pattern set.
    """
    terms: list[str] = []
    for phrase, word in _TOKEN.findall(raw[:MAX_QUERY_LENGTH]):
        term = normalize_whitespace(phrase or word.replace('"', "")).lower()
        if len(term) < MIN_TERM_LENGTH or not any(ch.isalnum() for ch in term):
            continue
        if term not in terms:
            terms.append(term)
        if len(terms) == MAX_TERMS:
            break
    return terms


def compile_terms(terms: list[str]) -> list[re.Pattern[str]]:
    """A pattern per term that matches where a word starts."""
    return [
        re.compile(
            r"(?<!\w)" + r" ".join(re.escape(part) for part in term.split(" ")),
            re.IGNORECASE,
        )
        for term in terms
    ]


def _merged_spans(patterns: list[re.Pattern[str]], text: str) -> list[tuple[int, int]]:
    spans = sorted(
        (m.start(), m.end()) for pattern in patterns for m in pattern.finditer(text)
    )
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _snap_to_word(text: str, index: int, direction: int) -> int:
    """Move *index* to a space within a few characters so a snippet does not
    begin or end in the middle of a word."""
    for step in range(0, 15):
        probe = index + direction * step
        if probe <= 0:
            return 0
        if probe >= len(text):
            return len(text)
        if text[probe] == " ":
            return probe
    return index


def snippet_parts(
    text: str, spans: list[tuple[int, int]], radius: int = SNIPPET_RADIUS
) -> list[dict[str, Any]]:
    """The text around the first hit, split into plain and highlighted parts."""
    if not spans:
        return []
    first_start, first_end = spans[0]
    start = _snap_to_word(text, max(0, first_start - radius), -1)
    end = _snap_to_word(text, min(len(text), first_end + radius), 1)
    parts: list[dict[str, Any]] = []
    cursor = start
    for span_start, span_end in spans:
        if span_end <= start or span_start >= end:
            continue
        hit_start, hit_end = max(span_start, start), min(span_end, end)
        if hit_start > cursor:
            parts.append({"text": text[cursor:hit_start], "hit": False})
        parts.append({"text": text[hit_start:hit_end], "hit": True})
        cursor = hit_end
    if cursor < end:
        parts.append({"text": text[cursor:end], "hit": False})
    if start > 0:
        parts[0]["text"] = "…" + parts[0]["text"].lstrip()
    if end < len(text):
        parts[-1]["text"] = parts[-1]["text"].rstrip() + "…"
    return parts


def search_sources(
    patterns: list[re.Pattern[str]], sources: list[Source]
) -> Optional[dict[str, Any]]:
    """The matches in one set of minutes, or None unless every term is found.

    ``matches`` holds at most ``MAX_MATCHES_PER_MINUTES`` places, in the order
    the minutes read; ``match_count`` is how many places matched in all, so the
    screen can say how many it left out.
    """
    if not patterns:
        return None
    prepared = [
        (source, normalize_whitespace(source.text)) for source in sources if source.text
    ]
    for pattern in patterns:
        if not any(pattern.search(text) for _, text in prepared):
            return None

    matches: list[dict[str, Any]] = []
    for source, text in prepared:
        spans = _merged_spans(patterns, text)
        if spans:
            matches.append(
                {
                    "kind": source.kind,
                    "label": source.label,
                    "parts": snippet_parts(text, spans),
                }
            )
    return {
        "match_count": len(matches),
        "matches": matches[:MAX_MATCHES_PER_MINUTES],
    }
