"""Tracked changes between two versions of a rich-text section.

A reviewer edits a copy of a section; this module turns the difference into a
list of discrete changes the secretary can accept or reject one by one, and
applies the accepted ones back onto the section.

The diff is done by Python's ``difflib`` over tokens — a tag, a run of
whitespace, or a word — so a change is a few words rather than a whole
paragraph, and the same algorithm produces the changes that were shown and the
ones that are applied. Nothing here parses HTML into a tree: it works on the
sanitized strings ``app/utils/rich_text.py`` produces, and the caller sanitizes
whatever comes out.

A change keeps the base tokens before and after it. When the section has been
edited since the reviewer saw it, a change is applied only where that context
still matches exactly once, so a stale suggestion either lands where the
reviewer meant it or is reported as one that could not be applied; it is never
placed by guesswork.
"""

import html
import re
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from app.utils.rich_text import sanitize_html

_TOKEN = re.compile(r"<[^>]+>|\s+|[^\s<]+")
_BLOCK_TAG = re.compile(r"</?(?:p|h2|h3|ul|ol|li|blockquote|br)\b[^>]*>", re.IGNORECASE)
_ANY_TAG = re.compile(r"<[^>]+>")

# How many tokens either side of a change are kept to find it again.
CONTEXT_TOKENS = 6
# Words of context shown beside a change on screen.
DISPLAY_WORDS = 6

Change = Dict[str, Any]

# The editor writes ``<li><p>text</p></li>`` and ``<blockquote><p>text</p>
# </blockquote>``; text that was never opened in it has no inner paragraph. The
# two read the same, so both are brought to the bare form before they are
# compared, or every untouched list item would show up as a formatting change.
_WRAPPED_PARAGRAPH = re.compile(
    r"<(li|blockquote)><p>((?:(?!</?p[ >]).)*)</p></\1>", re.IGNORECASE | re.DOTALL
)


def canonical(value: Optional[str]) -> str:
    """*value* in the one form both sides of a diff are compared in."""
    return _WRAPPED_PARAGRAPH.sub(r"<\1>\2</\1>", sanitize_html(value))


def plain_to_html(text: Optional[str]) -> str:
    """Plain text as paragraphs: blank lines separate them, single breaks stay.

    The same shape the editor opens an old plain-text section in, so a
    suggestion against one is a suggestion against the paragraphs the reviewer
    actually edited. Text is escaped, so ``a < b`` stays text.
    """
    if not text:
        return ""
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text.replace("\r\n", "\n"))]
    return "".join(
        "<p>" + html.escape(p, quote=False).replace("\n", "<br>") + "</p>"
        for p in paragraphs
        if p
    )


def tokenize(value: Optional[str]) -> List[str]:
    """Tags, whitespace runs and words, in order; joining them restores *value*."""
    return _TOKEN.findall(value or "")


def _is_blank(tokens: Iterable[str]) -> bool:
    return all(t.isspace() for t in tokens)


def _plain(tokens: Sequence[str]) -> str:
    """The words in some tokens, block tags standing in for a space."""
    joined = "".join(tokens)
    joined = _BLOCK_TAG.sub(" ", joined)
    return " ".join(html.unescape(_ANY_TAG.sub("", joined)).split())


def compute_changes(base_html: str, proposed_html: str) -> List[Change]:
    """The changes that turn *base_html* into *proposed_html*, in order.

    Each carries the token range it replaces in the base (``start``/``end``),
    the tokens it replaces them with, and the base tokens around it. Two changes
    separated only by whitespace are one change: "two bids" becoming "three
    quotes" is a single edit to a reader, not two.
    """
    old = tokenize(base_html)
    new = tokenize(proposed_html)
    matcher = SequenceMatcher(None, old, new, autojunk=False)

    spans: List[List[int]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if spans:
            prev_old_end, prev_new_end = spans[-1][1], spans[-1][3]
            if _is_blank(old[prev_old_end:i1]) and _is_blank(new[prev_new_end:j1]):
                spans[-1][1], spans[-1][3] = i2, j2
                continue
        spans.append([i1, i2, j1, j2])

    changes: List[Change] = []
    for index, (i1, i2, j1, j2) in enumerate(spans, start=1):
        changes.append(
            {
                "id": f"c{index}",
                "start": i1,
                "end": i2,
                "old": "".join(old[i1:i2]),
                "new": "".join(new[j1:j2]),
                "before": "".join(old[max(0, i1 - CONTEXT_TOKENS) : i1]),
                "after": "".join(old[i2 : i2 + CONTEXT_TOKENS]),
            }
        )
    return changes


def describe_change(change: Change) -> Dict[str, Any]:
    """What a reader sees of one change: the words removed and added, and context."""
    old_text = _plain(tokenize(change["old"]))
    new_text = _plain(tokenize(change["new"]))
    if old_text == new_text:
        kind = "format"
    elif not old_text:
        kind = "insert"
    elif not new_text:
        kind = "delete"
    else:
        kind = "replace"

    def words(tokens: str, last: bool) -> str:
        parts = _plain(tokenize(tokens)).split()
        picked = parts[-DISPLAY_WORDS:] if last else parts[:DISPLAY_WORDS]
        return " ".join(picked)

    return {
        "id": change["id"],
        "kind": kind,
        "deleted": old_text,
        "inserted": new_text,
        "before": words(change["before"], last=True),
        "after": words(change["after"], last=False),
        "decision": change.get("decision", "open"),
    }


def _find_all(haystack: Sequence[str], needle: Sequence[str]) -> List[int]:
    if not needle:
        return []
    width = len(needle)
    first = needle[0]
    return [
        i
        for i in range(len(haystack) - width + 1)
        if haystack[i] == first and list(haystack[i : i + width]) == list(needle)
    ]


def _locate(
    current: Sequence[str], base: Sequence[str], change: Change
) -> Optional[Tuple[int, int]]:
    """Where *change* belongs in *current*, as a token range, or None.

    Looks for the change's own text with as much of its surrounding text as
    still matches, starting with all of it and giving up context a token at a
    time, because the words next to a change are often the very ones someone
    else edited. The first amount of context that matches decides: exactly one
    match places the change, more than one is ambiguous and is refused rather
    than guessed at, and none means the text it was written against is gone.
    A pure insertion has nothing of its own to find, so it needs some context,
    and with no context at all a change is placed only if its text was already
    unique in the section the reviewer saw, so it cannot drift to a look-alike.
    """
    before = tokenize(change["before"])
    old = tokenize(change["old"])
    after = tokenize(change["after"])
    for k in range(max(len(before), len(after)), -1, -1):
        if k == 0 and (not old or len(_find_all(base, old)) != 1):
            return None
        lead = before[-k:] if k else []
        tail = after[:k]
        hits = _find_all(current, lead + old + tail)
        if len(hits) == 1:
            start = hits[0] + len(lead)
            return start, start + len(old)
        if len(hits) > 1:
            return None
    return None


def apply_changes(
    base_html: str,
    current_html: str,
    changes: Sequence[Change],
    accepted: Set[str],
) -> Tuple[str, List[str]]:
    """Apply the accepted changes to *current_html*.

    Returns the new text and the ids that could not be applied. When the section
    is still exactly what the reviewer edited, every change lands where the diff
    put it. When it has changed since, each accepted change is located by its
    surrounding text and applied only if that text appears exactly once; the
    result then is all-or-nothing for the caller, who gets the failures and
    leaves the section alone.
    """
    chosen = [c for c in changes if c["id"] in accepted]
    current = tokenize(current_html)
    base = tokenize(base_html)

    if current == base:
        out: List[str] = []
        position = 0
        for change in sorted(chosen, key=lambda c: c["start"]):
            out.extend(current[position : change["start"]])
            out.extend(tokenize(change["new"]))
            position = change["end"]
        out.extend(current[position:])
        return "".join(out), []

    placements: List[Tuple[int, int, Change]] = []
    failed: List[str] = []
    for change in chosen:
        located = _locate(current, base, change)
        if located is None:
            failed.append(change["id"])
        else:
            placements.append((located[0], located[1], change))

    placements.sort(key=lambda p: p[0])
    for (_, end_a, _), (start_b, _, change_b) in zip(placements, placements[1:]):
        if start_b < end_a:
            failed.append(change_b["id"])
    if failed:
        return current_html, sorted(set(failed))

    out = []
    position = 0
    for start, end, change in placements:
        out.extend(current[position:start])
        out.extend(tokenize(change["new"]))
        position = end
    out.extend(current[position:])
    return "".join(out), []
