"""Writing id lists to a ``Column(JSON)``, and querying them back.

**Writing.** Pydantic parses id fields into ``UUID`` objects, but a JSON column
is written with ``json.dumps``, which raises ``TypeError`` on a ``UUID``. Any
list of ids headed for a JSON column has to be flattened to strings first — and
because the failure is a 500 at commit rather than a validation error, it only
shows up when somebody actually uses the field.

**Querying.** ``Column(JSON).contains([value])`` reads like an array-membership
test and is not one. ``contains_op`` is not in the ``JSON`` type's operator
classes, so SQLAlchemy falls back to the *string* operator and emits
``column LIKE concat('%', ?, '%')`` against the serialized document, binding
``'["value"]'`` as the pattern. Two things follow, both measured against
MariaDB 10.11:

1. **Multi-element arrays never match.** MySQL renders a stored array as
   ``["abc", "def"]``, so the pattern ``%["abc"]%`` matches only an array whose
   sole element is ``abc``. A training requirement tagged with two categories
   was invisible to the query that feeds it hours.
2. **The caller's term is a LIKE pattern.** ``position=%`` returned every
   requirement in the org, because the ``%`` inside the serialized pattern is a
   wildcard. This is the failure ``tests/test_like_escaping.py`` exists to
   prevent; its carve-out for a list argument ("a different operator") rested on
   the same misreading and let all three sites through.

SQLAlchemy 2.1 deprecates the fallback (``SADeprecationWarning``: "does not
include operator 'contains_op' in its operator classes") and will raise
``InvalidRequestError`` for it in a future release, so the deprecation and the
two wrong answers have the same fix: ask the database for JSON containment
explicitly.
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
    """Predicate: the JSON array in *column* holds *value* as an element.

    ``value`` is coerced the same way :func:`normalize_id_list` coerces on the
    way in — ``str()`` then ``strip()`` — because the read has to ask for the
    string the write actually stored; a ``UUID`` here would otherwise serialize
    to something no row contains.

    ``JSON_CONTAINS`` is available on both engines CI runs (MySQL 8.0, and
    MariaDB since 10.2.3). It answers NULL rather than 0 against a NULL
    document, which ``== 1`` resolves to false — the behavior wanted here,
    since a requirement with no categories matches no category.
    """
    candidate = json.dumps(str(value).strip())
    return func.json_contains(column, literal(candidate)) == 1
