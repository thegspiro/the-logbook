"""The prospect pipeline widget counts in SQL and caps its details (MP-08).

It used to load every prospect row in the organization, PII columns and all,
to count statuses and aging buckets in Python, and returned every applicant's
name to a manager. Counts now come from GROUP BY / CASE queries with the same
numbers, and the details list is the 10 most recent applicants with a flag
saying the rest are behind the "View all" queue link (owner decision).
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.api.v1.endpoints.membership_pipeline import (
    PIPELINE_WIDGET_DETAIL_LIMIT,
    pipeline_widget_summary,
)
from app.models.membership_pipeline import ProspectiveMember, ProspectStatus
from app.models.user import Organization

pytestmark = [pytest.mark.integration]

NOW = datetime.now(timezone.utc)


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Pipeline Widget Department",
        slug=f"pwidget-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


def _prospect(org, *, days_old, status=ProspectStatus.ACTIVE, name="Applicant"):
    return ProspectiveMember(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        first_name=name,
        last_name="Doe",
        email=f"{uuid.uuid4().hex[:8]}@widget.test",
        status=status,
        created_at=NOW - timedelta(days=days_old, hours=1),
    )


async def _summary(db_session, org, *, manager, hidden=frozenset()):
    caller = SimpleNamespace(organization_id=org.id)
    with patch(
        "app.api.v1.endpoints.membership_pipeline.user_has_permission",
        return_value=manager,
    ):
        return await pipeline_widget_summary(
            db=db_session, current_user=caller, hidden_prospect_ids=set(hidden)
        )


async def test_counts_and_buckets_match_the_python_definitions(db_session):
    org = await _org(db_session)
    db_session.add_all(
        [
            _prospect(org, days_old=0),
            _prospect(org, days_old=7),  # age 7: still the first bucket
            _prospect(org, days_old=8),  # age 8: second bucket
            _prospect(org, days_old=30, status=ProspectStatus.ON_HOLD),
            _prospect(org, days_old=31, status=ProspectStatus.WITHDRAWN),
            _prospect(org, days_old=400, status=ProspectStatus.WITHDRAWN),
        ]
    )
    other = await _org(db_session)
    db_session.add(_prospect(other, days_old=1))
    await db_session.flush()

    summary = await _summary(db_session, org, manager=False)

    assert summary.total == 6
    assert summary.by_status == {"active": 3, "on_hold": 1, "withdrawn": 2}
    assert summary.aging == {"0_7_days": 2, "8_30_days": 2, "31_plus_days": 2}
    assert summary.details is None
    assert summary.details_truncated is False


async def test_details_are_the_ten_most_recent_with_a_view_all_flag(db_session):
    org = await _org(db_session)
    for age in range(PIPELINE_WIDGET_DETAIL_LIMIT + 3):
        db_session.add(_prospect(org, days_old=age, name=f"P{age:02d}"))
    await db_session.flush()

    summary = await _summary(db_session, org, manager=True)

    assert summary.total == PIPELINE_WIDGET_DETAIL_LIMIT + 3
    assert [d["name"] for d in summary.details] == [
        f"P{age:02d} Doe" for age in range(PIPELINE_WIDGET_DETAIL_LIMIT)
    ]
    assert summary.details_truncated is True
    assert summary.queue_url == "/prospective-members?status=active"


async def test_a_short_list_is_not_truncated(db_session):
    org = await _org(db_session)
    db_session.add_all([_prospect(org, days_old=1), _prospect(org, days_old=2)])
    await db_session.flush()

    summary = await _summary(db_session, org, manager=True)

    assert len(summary.details) == 2
    assert summary.details_truncated is False


async def test_the_caller_s_own_application_is_left_out_everywhere(db_session):
    org = await _org(db_session)
    own = _prospect(org, days_old=1, name="Self")
    db_session.add_all([own, _prospect(org, days_old=2)])
    await db_session.flush()

    summary = await _summary(db_session, org, manager=True, hidden={own.id})

    assert summary.total == 1
    assert sum(summary.aging.values()) == 1
    assert all(d["id"] != own.id for d in summary.details)
