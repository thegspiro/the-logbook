"""The status read says which changes the server will take next (W11-14).

The profile's Change Status dialog offered every status. For a member on leave
it offered Probationary, which ``ALLOWED_STATUS_TRANSITIONS`` refuses, so the
officer learned only from a 400 after choosing. The record the dialog can read
now carries the allowed next statuses, from the same table the PATCH enforces.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.member_status import (
    ALLOWED_STATUS_TRANSITIONS,
    _status_change_record,
)
from app.models.user import UserStatus

pytestmark = pytest.mark.unit


def _member(status):
    return SimpleNamespace(
        id="user-1",
        status=status,
        status_changed_at=datetime(2026, 11, 16, tzinfo=timezone.utc),
        status_change_reason=None,
    )


def test_a_member_on_leave_is_not_offered_probationary():
    record = _status_change_record(_member(UserStatus.LEAVE))

    assert "probationary" not in record.allowed_next_statuses
    assert "active" in record.allowed_next_statuses


@pytest.mark.parametrize("status", list(UserStatus))
def test_it_is_exactly_the_table_the_change_enforces(status):
    record = _status_change_record(_member(status))

    assert set(record.allowed_next_statuses) == {
        s.value for s in ALLOWED_STATUS_TRANSITIONS.get(status, frozenset())
    }
