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

Words are still compared by token, but a token is allowed to be *alike* rather
than identical: plurals fold together ("Pads"/"Pad"), a dimension written
"4 x 4" equals "4x4", and two words that differ by a few letters ("Defibrillator"
/"Defibrilator") pair up for partial credit. That is the "called one thing on
the ambulance and something slightly different by the manufacturer" case.
Anything with a digit in it must match exactly: "4x4" and "4x8", or "Size 3"
and "Size 4", are different products however similar they look.

An item can also carry **aliases** ("BVM" for "Bag Valve Mask"), which are
scored the same way but capped below ``EXACT`` — a person typed them, so a
match through one is a strong lead and never something to apply unreviewed.
"""

import re
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

__all__ = [
    "normalize_name",
    "match_score",
    "match_candidate",
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

# Credit for a pair of words that are alike but not identical, relative to 1.0
# for an identical word. Below 1 so the name that spells the word the same way
# always outranks the one that merely resembles it.
_FUZZY_TOKEN_CREDIT = 0.8

# A subset match that leans on a fuzzy pair is weaker evidence than one built
# from identical words, so it does not reach the STRONG band on its own.
_FUZZY_SUBSET_SCORE = 0.6

# Two words are alike when one is a prefix of the other (at most this many
# letters longer), or when they are this close by edit similarity. High enough
# that "small"/"smell" and "medium"/"median" stay apart.
_PREFIX_MAX_EXTRA = 3
_ALIKE_RATIO = 0.86
_MIN_FUZZY_LENGTH = 4

# The most a match through an alias, or through anything but identical
# normalized names, can score. EXACT means "safe to apply unreviewed".
_NOT_EXACT_CEILING = 0.95

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_DIMENSION_SPACING = re.compile(r"(?<=\d) ?x ?(?=\d)")


def normalize_name(name: str) -> str:
    """Casefold, drop punctuation, collapse whitespace.

    Punctuation carries no meaning in a supply name but plenty of variation:
    "Gauze Pads, 4x4" and "gauze pads 4x4" are the same box.
    """
    if not name:
        return ""
    return _NON_ALNUM.sub(" ", name.strip().lower()).strip()


def _stem(token: str) -> str:
    """Fold a plural onto its singular. Tokens with a digit are left alone."""
    if len(token) <= 3 or any(ch.isdigit() for ch in token):
        return token
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith(("sses", "xes", "zes", "ches", "shes")):
        return token[:-2]
    if token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _tokens(normalized: str) -> frozenset:
    """The comparable words of a normalized name.

    "4 x 4" is joined to "4x4" first, so a dimension is one word however it was
    typed, then plurals are folded. Only used for scoring: ``normalize_name``
    stays the definition of "the same name", so what counts as an exact match
    does not move.
    """
    joined = _DIMENSION_SPACING.sub("x", normalized)
    return frozenset(_stem(token) for token in joined.split())


def _ratio(a: str, b: str) -> float:
    """Edit similarity of two words, the same whichever is passed first.

    ``SequenceMatcher`` is not symmetric, and a score that depended on argument
    order would reshuffle a review screen.
    """
    first, second = sorted((a, b))
    return SequenceMatcher(None, first, second).ratio()


def _alike(a: str, b: str) -> bool:
    """Do two different words plausibly name the same thing?"""
    if len(a) < _MIN_FUZZY_LENGTH or len(b) < _MIN_FUZZY_LENGTH:
        return False
    if any(ch.isdigit() for ch in a + b):
        return False
    short, long_ = sorted((a, b), key=len)
    if long_.startswith(short) and len(long_) - len(short) <= _PREFIX_MAX_EXTRA:
        return True
    return bool(_ratio(a, b) >= _ALIKE_RATIO)


def _fuzzy_pairs(left: Iterable[str], right: Iterable[str]) -> List[Tuple[str, str]]:
    """Pair up unmatched words that are alike, each word used at most once.

    Closest pairs claim their words first; ties break on the words themselves,
    so the pairing is the same whichever name is on which side.
    """
    candidates = []
    for a in left:
        for b in right:
            if _alike(a, b):
                candidates.append((-_ratio(a, b), min(a, b), max(a, b), a, b))
    candidates.sort()

    pairs: List[Tuple[str, str]] = []
    used_a, used_b = set(), set()
    for _closeness, _lo, _hi, a, b in candidates:
        if a in used_a or b in used_b:
            continue
        used_a.add(a)
        used_b.add(b)
        pairs.append((a, b))
    return pairs


def match_score(a: str, b: str) -> float:
    """How strongly two names refer to the same thing, in ``0.0..1.0``.

    ``1.0`` is reserved for names made of the same words — callers treat it as
    safe to apply without review, so a match that only resembles (a plural, a
    near-spelling) tops out below it.
    """
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb or frozenset(na.split()) == frozenset(nb.split()):
        return 1.0

    ta, tb = _tokens(na), _tokens(nb)
    shared = ta & tb
    pairs = _fuzzy_pairs(ta - shared, tb - shared)
    if not shared and not pairs:
        return 0.0

    matched = len(shared) + len(pairs)
    union = len(ta) + len(tb) - matched
    score = (len(shared) + _FUZZY_TOKEN_CREDIT * len(pairs)) / union

    # Every word of one name is accounted for in the other: strong evidence,
    # but not proof ("Oxygen Mask" is inside both the adult and the pediatric).
    if matched == len(ta) or matched == len(tb):
        score = max(score, _FUZZY_SUBSET_SCORE if pairs else _SUBSET_SCORE)
    return min(score, _NOT_EXACT_CEILING)


def _alias_list(value: Any) -> List[str]:
    """The aliases of an item, read defensively.

    The column is untyped JSON, so a stored value is not guaranteed to be the
    list the write path produces; anything else is treated as no aliases
    rather than raising inside a search.
    """
    if not isinstance(value, (list, tuple)):
        return []
    return [alias for alias in value if isinstance(alias, str) and alias.strip()]


def match_candidate(
    query: str, name: str, aliases: Any = None
) -> Tuple[float, Optional[str]]:
    """Score ``query`` against an item's name and its aliases.

    Returns ``(score, alias)``, where ``alias`` is the alias that beat the name
    or ``None``. A match through an alias is capped below ``EXACT``: the alias
    is something a person typed, two items can carry the same one, and an
    unreviewed link on the strength of it would be a guess.
    """
    best, via = match_score(query, name), None
    for alias in _alias_list(aliases):
        score = min(match_score(query, alias), _NOT_EXACT_CEILING)
        if score > best:
            best, via = score, alias
    return best, via


def confidence_for(score: float) -> str:
    """Band a score into the label the review UI groups by."""
    if score >= 1.0:
        return EXACT
    if score >= _SUBSET_SCORE:
        return STRONG
    return WEAK


Candidate = Union[Tuple[str, str], Tuple[str, str, Any]]


def best_matches(
    query: str,
    candidates: Sequence[Candidate],
    limit: int = 3,
    minimum: float = MIN_SUGGESTION_SCORE,
) -> List[Dict[str, object]]:
    """Rank ``candidates`` against ``query``.

    ``candidates`` are ``(id, name)`` pairs, or ``(id, name, aliases)`` for
    items that carry "also called" names. Returns at most ``limit`` entries,
    best first, each ``{"id", "name", "score", "confidence"}``, plus
    ``"matched_alias"`` when an alias rather than the name produced the match.
    Ties break on name so a given catalog produces a stable list run to run — a
    review screen that reshuffles between loads is one nobody trusts.
    """
    scored: List[Tuple[float, str, str, Optional[str]]] = []
    for candidate in candidates:
        cid, cname = candidate[0], candidate[1]
        aliases = candidate[2] if len(candidate) > 2 else None  # type: ignore[misc]
        score, alias = match_candidate(query, cname, aliases)
        if score >= minimum:
            scored.append((score, cname, cid, alias))

    scored.sort(key=lambda row: (-row[0], row[1]))
    results: List[Dict[str, object]] = []
    for score, cname, cid, alias in scored[:limit]:
        entry: Dict[str, object] = {
            "id": cid,
            "name": cname,
            "score": round(score, 4),
            "confidence": confidence_for(score),
        }
        if alias is not None:
            entry["matched_alias"] = alias
        results.append(entry)
    return results


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
