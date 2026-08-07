"""
Safe LIKE/ILIKE search terms.

A user's search string reaches SQL as a *pattern*, not a literal. SQLAlchemy
parameterizes the value — so this is not an injection risk — but ``%`` and ``_``
inside that parameter are still wildcards to the database:

    search="%"    → "%%%"   → matches every row
    search="a_c"  → "%a_c%" → also matches "abc"

The first is the one that bites: a member typing ``%`` into a product search
gets the entire catalog back, and a paginated export built on the same filter
scans far more than intended. The fix is to escape the two wildcard characters
(and the escape character itself) and to tell the database which character does
the escaping — ``LIKE ... ESCAPE '\\'`` — because MySQL's default varies by
mode and cannot be relied on implicitly.

This transform was independently copy-pasted into apparatus, documents,
equipment-check, facilities, forms, fundraising and storefront. It lives here
so a fix or a subtlety lands in one place rather than seven.

Usage:

    from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

    pattern = like_pattern(search)
    query.where(Model.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR))
"""

from __future__ import annotations

#: The character passed to SQL's ``ESCAPE`` clause. A single backslash.
LIKE_ESCAPE_CHAR = "\\"


def escape_like(term: str) -> str:
    """Neutralize LIKE wildcards in *term*, returning a literal-match string.

    The backslash is escaped first — doing it after would double-escape the
    backslashes this function itself introduces.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def like_pattern(term: str, *, prefix: bool = False) -> str:
    """Build a ``%term%`` (or ``term%``) pattern with wildcards escaped.

    Args:
        term: the raw user-supplied search string.
        prefix: when True, anchor at the start (``term%``) instead of matching
            anywhere. Used for things like order-number prefix lookups, where a
            leading ``%`` would defeat the index.

    The result must be passed with ``escape=LIKE_ESCAPE_CHAR``; without it the
    escaping is inert and the wildcards come back.
    """
    escaped = escape_like(term)
    return f"{escaped}%" if prefix else f"%{escaped}%"
