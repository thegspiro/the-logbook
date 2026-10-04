"""Coercion for id lists bound for a ``Column(JSON)``.

Pydantic parses id fields into ``UUID`` objects, but a JSON column is written
with ``json.dumps``, which raises ``TypeError`` on a ``UUID``. Any list of ids
headed for a JSON column has to be flattened to strings first — and because the
failure is a 500 at commit rather than a validation error, it only shows up when
somebody actually uses the field.
"""

import json
from typing import Any, Iterable, List, Optional

from sqlalchemy import func, literal
from sqlalchemy.sql.elements import ColumnElement


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


def json_array_contains(column: Any, value: Any) -> ColumnElement[bool]:
    """``column`` (a JSON array) has ``value`` as one of its elements.

    Not ``column.contains([value])``: on a plain ``JSON`` column SQLAlchemy
    compiles that to ``LIKE '%["value"]%'``, which matches only when the
    value is the array's *sole* element, so a requirement filed under two
    categories was never found by either. SQLAlchemy also deprecates the
    operator on ``JSON``. ``JSON_CONTAINS`` exists on both engines CI runs
    (MySQL 8.0 and MariaDB 10.2.3+) and answers NULL for a NULL document,
    which a WHERE treats as no match.
    """
    return func.json_contains(column, literal(json.dumps(str(value)))) == 1
