"""The normalized key a training record is matched by.

Certification grading used to compare free text: the requirement's name as a
case-insensitive substring of a record's course name, and its registry code as
a substring of the certification number. Neither could be pushed into SQL
without changing the answer, because ``LIKE`` folds case by the column's
collation and Python's ``str.lower`` folds it differently (``İ``, the Greek
final sigma), so every certification requirement made the grader read each
member's whole completed history (owner decision 2026-11-01, "stored match
key").

A record now carries ``match_key`` (from its course name) and
``certification_key`` (from its certification number), and a requirement is
compared through the same function on its side. The key is the text with
compatibility forms unified (NFKC), case folded, and everything but letters and
digits removed, so ``"CPR"``, ``"cpr"``, ``" C.P.R. "`` and ``"C-P-R"`` share a
key while ``"CPR Refresher"`` does not. Equal keys are equal strings, which
compare equal under every collation, so a SQL filter on the key can only ever
over-select; the grader re-checks the stored key in Python, which decides.

This is the one definition (CLAUDE.md pitfall #29). The model sets both columns
from it whenever the source text is assigned, so every ORM write path keys the
record. A migration that backfills keys must inline a frozen copy instead of
importing this (pitfall #20): ``bd8fc0c4a941`` holds the copy the existing rows
were keyed with.
"""

from __future__ import annotations

import unicodedata
from typing import Optional

#: Width of the stored key columns. A key longer than this is cut to it, on the
#: record and on the requirement alike, so both sides agree.
MATCH_KEY_LENGTH = 255


def training_match_key(text: Optional[str]) -> Optional[str]:
    """The match key for ``text``, or ``None`` when it has no letters or digits.

    NFKC is applied again after case folding because folding can produce a
    sequence that is no longer in normal form (Unicode's caseless-matching
    recipe, section 3.13).
    """
    if not text:
        return None
    folded = unicodedata.normalize(
        "NFKC", unicodedata.normalize("NFKC", text).casefold()
    )
    key = "".join(ch for ch in folded if ch.isalnum())[:MATCH_KEY_LENGTH]
    return key or None
