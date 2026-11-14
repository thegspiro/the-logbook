"""The four community-engagement figures must describe one event population.

``total_public_events`` has always excluded cancelled events. The two attendee
tallies beside it did not, so a department that cancelled a fundraiser after
check-in read attendees it had no event to attribute them to — two numbers
presented as a ratio, measured over different sets.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.dashboard import get_community_engagement

_TOTALS = {
    "events_held": 0,
    "people_reached": 0,
    "signed_in": 0,
    "estimated": 0,
    "member_hours": 0.0,
    "members_involved": 0,
    "requests_received": 0,
    "requests_completed": 0,
}
_EMPTY_REPORT = {
    "period": "all",
    "period_start": None,
    "period_end": datetime(2026, 11, 10, tzinfo=timezone.utc),
    "current": _TOTALS,
    "previous": None,
    "upcoming_events": 0,
    "turnout": {"events": 0, "signed_in": 0, "expected": 0},
    "granularity": "month",
    "by_period": [],
    "by_type": [],
    "recent_events": [],
}


def _scalar(value):
    result = MagicMock()
    result.scalar.return_value = value
    return result


async def _call():
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[_scalar(4), _scalar(11), _scalar(60), _scalar(2)]
    )
    user = SimpleNamespace(id="coordinator", organization_id="org-a")
    # The period report has its own database-backed tests
    # (test_community_engagement_report.py); stubbing it here keeps this test
    # about the four all-time queries it was written for.
    report = AsyncMock(return_value=_EMPTY_REPORT)
    with patch(
        "app.api.v1.endpoints.dashboard.CommunityEngagementService.report", report
    ):
        response = await get_community_engagement(
            period="all", db=db, current_user=user
        )
    report.assert_awaited_once_with("org-a", "all")
    return response, db


@pytest.mark.asyncio
async def test_every_figure_excludes_cancelled_events():
    response, db = await _call()

    assert response.total_public_events == 4
    assert response.total_member_attendees == 11
    assert response.total_external_attendees == 60
    assert response.upcoming_public_events == 2

    statements = [call.args[0] for call in db.execute.await_args_list]
    assert len(statements) == 4
    for index, statement in enumerate(statements):
        rendered = str(statement)
        assert "events.is_cancelled" in rendered, (
            f"community-engagement query {index} counts cancelled events, "
            "so its figure describes a different population than the "
            "others in the same response"
        )
        # Tenancy, asserted here too because this endpoint reads three tables
        # and the org filter has to reach the subquery as well as the outer one.
        assert "org-a" in statement.compile().params.values()
