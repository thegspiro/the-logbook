"""Match call types against one another across the ways they are stored.

A department has one call-type list (``settings.scheduling.call_tracking``,
slug + label). The values that get compared against it arrive in three shapes:

* a **slug** — count-only close-out reports, and requirements picked in the
  requirement editor;
* a **label** — the call log and the report forms of departments on detailed
  tracking store the type's display name, because NFIRS/NEMSIS export and the
  ePCR import read and write that column as text;
* **legacy free text** — anything typed before the picker existed.

Until 2026-10-04 a requirement counted a report's call only on an exact,
case-insensitive string match, so a requirement naming "Motor Vehicle
Accident" never matched a report storing ``mva`` and credited nothing, with no
error to say so. Every comparison now goes through :func:`call_type_key`, which
resolves a slug or a label of the department's list to the same key, and falls
back to folded text for a value the list does not know.
"""

import re
from typing import Iterable, List, Mapping, Sequence

_SEPARATORS = re.compile(r"[\s_\-]+")


def _fold(value: str) -> str:
    # Underscores and hyphens fold to spaces so a slug ("mutual_aid") and its
    # label ("Mutual Aid") read alike even before the list is consulted.
    return _SEPARATORS.sub(" ", value.strip().casefold()).strip()


def call_type_key(value: str, types: Sequence[Mapping[str, object]]) -> str:
    """The identity two call-type values share when they mean the same type.

    ``types`` is the department's list — retired entries included, since a
    report filed before a type was retired still names it.
    """
    folded = _fold(value)
    for entry in types:
        slug = str(entry.get("slug") or "")
        label = str(entry.get("label") or "")
        if folded and (folded == _fold(slug) or folded == _fold(label)):
            return f"type:{slug}"
    return f"text:{folded}"


def matching_call_types(
    call_types: Iterable[object],
    required: Iterable[object],
    types: Sequence[Mapping[str, object]],
) -> List[str]:
    """The entries of ``call_types`` that satisfy ``required``.

    One entry per call, so the length is the number of calls credited.
    Non-string entries are ignored on both sides: these lists are untyped JSON.
    """
    wanted = {
        call_type_key(r, types) for r in required if isinstance(r, str) and r.strip()
    }
    return [
        ct
        for ct in call_types
        if isinstance(ct, str) and ct.strip() and call_type_key(ct, types) in wanted
    ]
