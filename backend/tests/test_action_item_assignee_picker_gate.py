"""The member picker the Action Items screen assigns meeting items from.

Owner decision 2026-11-01 ("build a screen" for meeting action items): a
``meetings.manage`` holder edits meeting items there, and assigns them from
``GET /minutes-records/action-item-assignees`` — the same active-member list
the minutes page uses (W52-6). The route therefore admits either manage
permission; a plain member still cannot list the department.
"""

import pytest

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints.minutes import router

pytestmark = pytest.mark.unit


def _picker_permissions() -> set[str]:
    route = next(
        r for r in router.routes if getattr(r, "path", None) == "/action-item-assignees"
    )
    checkers = [
        d.call
        for d in route.dependant.dependencies
        if isinstance(d.call, PermissionChecker)
    ]
    assert len(checkers) == 1
    return set(checkers[0].required_permissions)


def test_either_manage_permission_reads_the_picker():
    assert _picker_permissions() == {"minutes.manage", "meetings.manage"}
