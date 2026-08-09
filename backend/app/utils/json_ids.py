"""Coercion for id lists bound for a ``Column(JSON)``.

Pydantic parses id fields into ``UUID`` objects, but a JSON column is written
with ``json.dumps``, which raises ``TypeError`` on a ``UUID``. Any list of ids
headed for a JSON column has to be flattened to strings first — and because the
failure is a 500 at commit rather than a validation error, it only shows up when
somebody actually uses the field.
"""

from typing import Any, Iterable, List, Optional


def normalize_id_list(values: Optional[Iterable[Any]]) -> List[str]:
    """De-duplicated string ids, original order preserved, blanks dropped."""
    if not values:
        return []
    seen: set = set()
    out: List[str] = []
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out
