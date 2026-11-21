"""The order compliance profiles are resolved in.

This is the one definition (CLAUDE.md pitfall #29). Grading
(``training_compliance._find_matching_profile``), the admin-hours lookup and
the configuration response all order profiles with :func:`ordered_profiles`,
so a member matched by two profiles is graded by the same one on every screen
and the editor lists that one first.

It lives here rather than in ``training_compliance`` because the schema module
needs it, and a schema must not import that service's dependency tree.
"""

from datetime import datetime, timezone
from typing import Any, Iterable, List, Tuple, TypeVar

from app.utils.edit_window import as_utc

_AWARE_MIN = datetime.min.replace(tzinfo=timezone.utc)

P = TypeVar("P")


def profile_resolution_key(profile: Any) -> Tuple[int, bool, datetime, str]:
    """Higher priority first; on a tie the older profile, then the smaller id.

    Owner decision 2026-11-21: the older profile wins a tie, so adding a new
    profile at an existing priority never re-grades the members an existing
    one already covers. ``id`` is the last key because ``created_at`` has
    one-second precision. Before this, a tie went to whichever row MySQL
    returned first.

    Attributes are read with ``getattr`` so a transient object or a test
    double with no ``created_at`` or ``id`` still sorts: a missing
    ``created_at`` sorts after every real one, a missing priority reads 0.
    The load listener in ``app.core.database`` makes a loaded ``created_at``
    aware; ``as_utc`` covers one that is not, so naive and aware never meet.
    """
    created = as_utc(getattr(profile, "created_at", None))
    return (
        -(getattr(profile, "priority", 0) or 0),
        created is None,
        created or _AWARE_MIN,
        str(getattr(profile, "id", "") or ""),
    )


def ordered_profiles(profiles: Iterable[P]) -> List[P]:
    """``profiles`` in resolution order: the first match is the one that applies."""
    return sorted(profiles, key=profile_resolution_key)
