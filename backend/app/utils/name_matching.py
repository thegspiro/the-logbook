"""Fuzzy name matching for reconciling free-text names against a catalog.

Checklists are typed by hand over years — "4x4 Gauze", "Gauze 4x4", "Gauze
Pads, 4x4 Sterile" — while the inventory catalog holds one canonical row. The
setup flows that link the two need to propose matches without ever silently
committing to one, so this module reports a *score* and leaves the decision to
the caller (and, above it, to a person reviewing a list).

Deliberately dependency-free and token-based rather than edit-distance based:
supply names differ by whole words (size, sterility, packaging), not by typos,
so token overlap separates real matches from near-misses far better than
Levenshtein — which happily rates "Oxygen Mask Adult" and "Oxygen Mask
Pediatric" as nearly identical.
"""

import re
from typing import Dict, Iterable, List, Sequence, Tuple

__all__ = [
    "normalize_name",
    "match_score",
    "confidence_for",
    "best_matches",
    "MIN_SUGGESTION_SCORE",
    "EXACT",
    "STRONG",
    "WEAK",
]

EXACT = "exact"
STRONG = "strong"
WEAK = "weak"

# Below this a shared token is coincidence ("bag" in "Trauma Bag" and "Bag
# Valve Mask"), and offering it as a suggestion costs the reviewer more than
# it saves.
MIN_SUGGESTION_SCORE = 0.34

# A subset match — every token of one name appears in the other — is strong
# evidence but NOT proof: "Oxygen Mask" is a subset of both "Oxygen Mask
# Adult" and "Oxygen Mask Pediatric". Scored high enough to surface first,
# deliberately below EXACT so no caller can auto-apply it.
_SUBSET_SCORE = 0.75

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_name(name: str) -> str:
    """Casefold, drop punctuation, collapse whitespace.

    Punctuation carries no meaning in a supply name but plenty of variation:
    "Gauze Pads, 4x4" and "gauze pads 4x4" are the same box.
    """
    if not name:
        return ""
    return _NON_ALNUM.sub(" ", name.strip().lower()).strip()


def _tokens(normalized: str) -> frozenset:
    return frozenset(normalized.split())


def match_score(a: str, b: str) -> float:
    """How strongly two names refer to the same thing, in ``0.0..1.0``.

    ``1.0`` is reserved for names that normalize identically — callers treat it
    as safe to apply without review, so nothing else may reach it.
    """
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0

    ta, tb = _tokens(na), _tokens(nb)
    shared = ta & tb
    if not shared:
        return 0.0

    jaccard = len(shared) / len(ta | tb)
    if ta <= tb or tb <= ta:
        return max(jaccard, _SUBSET_SCORE)
    return jaccard


def confidence_for(score: float) -> str:
    """Band a score into the label the review UI groups by."""
    if score >= 1.0:
        return EXACT
    if score >= _SUBSET_SCORE:
        return STRONG
    return WEAK


def best_matches(
    query: str,
    candidates: Sequence[Tuple[str, str]],
    limit: int = 3,
    minimum: float = MIN_SUGGESTION_SCORE,
) -> List[Dict[str, object]]:
    """Rank ``candidates`` against ``query``.

    ``candidates`` are ``(id, name)`` pairs. Returns at most ``limit`` entries,
    best first, each ``{"id", "name", "score", "confidence"}``. Ties break on
    name so a given catalog produces a stable list run to run — a review screen
    that reshuffles between loads is one nobody trusts.
    """
    scored: List[Tuple[float, str, str]] = []
    for cid, cname in candidates:
        score = match_score(query, cname)
        if score >= minimum:
            scored.append((score, cname, cid))

    scored.sort(key=lambda row: (-row[0], row[1]))
    return [
        {
            "id": cid,
            "name": cname,
            "score": round(score, 4),
            "confidence": confidence_for(score),
        }
        for score, cname, cid in scored[:limit]
    ]


def index_by_normalized(candidates: Iterable[Tuple[str, str]]) -> Dict[str, str]:
    """Map normalized name -> id, keeping the first id seen for each name.

    For the callers that only care about unambiguous exact hits (bulk create
    dedupe), where scanning every pair is wasted work.
    """
    index: Dict[str, str] = {}
    for cid, cname in candidates:
        key = normalize_name(cname)
        if key and key not in index:
            index[key] = cid
    return index
