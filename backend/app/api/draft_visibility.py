"""Who may see an unpublished (draft) event.

One rule for every read that shows an event, so a draft is not hidden on one
screen and listed on another (CLAUDE.md pitfall #29). Owner decision
2026-11-23:

* ``events.manage`` sees every draft, as it always has;
* ``training.manage`` sees drafts of Training events, which it administers
  (``training_manager_administers`` in ``endpoints/events.py``);
* nobody else sees a draft.

Seeing a draft is not acting on it: publishing, editing and the rest keep
their own permission checks.
"""

from typing import Any, Optional

from sqlalchemy import ColumnElement, and_, or_

from app.api.dependencies import user_has_permission
from app.models.event import Event, EventType

EVENT_MANAGER_PERMISSION = "events.manage"
TRAINING_MANAGER_PERMISSION = "training.manage"


def visible_draft_types(user: Any) -> Optional[frozenset[EventType]]:
    """The event types whose drafts *user* may see.

    ``None`` means every type; an empty set means none.
    """
    if user_has_permission(user, EVENT_MANAGER_PERMISSION):
        return None
    if user_has_permission(user, TRAINING_MANAGER_PERMISSION):
        return frozenset({EventType.TRAINING})
    return frozenset()


def _in_types(event_type: Any, types: frozenset[EventType]) -> bool:
    return any(event_type == t or event_type == t.value for t in types)


def can_see_draft(event: Any, user: Any) -> bool:
    """Whether *user* may see *event*, a draft.

    The event's type is read only when the answer depends on it, for a caller
    who sees some drafts but not all.
    """
    types = visible_draft_types(user)
    if types is None:
        return True
    return bool(types) and _in_types(event.event_type, types)


def can_see_draft_of_type(event_type: Any, user: Any) -> bool:
    """Whether *user* may see a draft event of *event_type*."""
    types = visible_draft_types(user)
    if types is None:
        return True
    return _in_types(event_type, types)


def event_visible_clause(user: Any) -> Optional[ColumnElement[bool]]:
    """A filter on ``Event`` keeping published events and the drafts *user*
    may see, or ``None`` when *user* may see every draft."""
    types = visible_draft_types(user)
    if types is None:
        return None
    published = or_(Event.is_draft.is_(False), Event.is_draft.is_(None))
    if not types:
        return published
    return or_(published, and_(Event.is_draft.is_(True), Event.event_type.in_(types)))
