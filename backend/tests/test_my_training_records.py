"""The member's full training history, and the figures the landing page adds.

``/my-training`` caps its record list at the newest 100, which dropped the
oldest records of any member with a longer history. ``/my-training/records`` is
the uncapped, paginated view the History tab reads. The summary also gained a
calendar-year-to-date figure and, per requirement, the date the next
completion window opens.
"""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints.training_module_config import (
    get_my_training_records,
    get_my_training_summary,
)
from app.models.training import (
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import User
from app.services.training_compliance import next_window_opens
from app.services.training_module_config_service import TrainingModuleConfigService


def _req(start_month, end_month, start_day=1):
    return SimpleNamespace(
        period_start_month=start_month,
        period_end_month=end_month,
        period_start_day=start_day,
        period_end_day=None,
    )


@pytest.mark.unit
class TestNextWindowOpens:
    """A November-to-January requirement credits last winter's class all year."""

    def test_reports_the_coming_november_during_the_gap(self):
        assert next_window_opens(_req(11, 1), date(2026, 10, 13)) == date(2026, 11, 1)

    def test_none_while_a_window_is_open(self):
        assert next_window_opens(_req(11, 1), date(2026, 11, 20)) is None
        assert next_window_opens(_req(11, 1), date(2026, 1, 15)) is None

    def test_none_for_a_same_year_window(self):
        assert next_window_opens(_req(3, 6), date(2026, 1, 15)) is None

    def test_none_without_a_custom_window(self):
        assert next_window_opens(_req(None, None), date(2026, 10, 13)) is None

    def test_honours_the_start_day(self):
        assert next_window_opens(_req(11, 1, start_day=15), date(2026, 11, 3)) == date(
            2026, 11, 15
        )


async def _member(db_session, setup_org_and_admin) -> User:
    _org_id, admin_id = setup_org_and_admin
    result = await db_session.execute(select(User).where(User.id == admin_id))
    return result.scalar_one()


def _record(org_id, user_id, name, completed, hours=1, **extra):
    return TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user_id,
        course_name=name,
        training_type=extra.pop("training_type", TrainingType.CONTINUING_EDUCATION),
        completion_date=completed,
        hours_completed=hours,
        status=extra.pop("status", TrainingStatus.COMPLETED),
        **extra,
    )


async def _seed(db_session, org_id, user_id, count=120):
    """``count`` completed classes in 2025, three in 2026, one pending."""
    db_session.add_all(
        _record(org_id, user_id, f"Old drill {i}", date(2025, 1 + i % 12, 1 + i % 28))
        for i in range(count)
    )
    db_session.add_all(
        _record(org_id, user_id, f"New drill {i}", date(2026, 2 + i, 5), hours=2)
        for i in range(3)
    )
    db_session.add(
        _record(
            org_id,
            user_id,
            "Awaiting sign-off",
            None,
            status=TrainingStatus.SCHEDULED,
        )
    )
    await db_session.flush()


@pytest.mark.integration
async def test_records_returns_history_the_summary_cap_drops(
    db_session, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _seed(db_session, org_id, admin_id, count=120)

    summary = await get_my_training_summary(db=db_session, current_user=user)
    assert len(summary["training_records"]) == 100

    everything = await get_my_training_records(
        year=None,
        search=None,
        training_type=None,
        page=1,
        page_size=100,
        db=db_session,
        current_user=user,
    )
    assert everything["total"] == 124
    by_year = {y["year"]: y for y in everything["years"]}
    assert by_year["2025"]["records"] == 120
    assert by_year["2026"] == {"year": "2026", "records": 3, "hours": 6.0}
    assert by_year["undated"]["records"] == 1
    assert [y["year"] for y in everything["years"]] == ["undated", "2026", "2025"]


@pytest.mark.integration
async def test_records_paginates_one_year_newest_first(db_session, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _seed(db_session, org_id, admin_id, count=30)

    page = await get_my_training_records(
        year="2025",
        search=None,
        training_type=None,
        page=2,
        page_size=25,
        db=db_session,
        current_user=user,
    )
    assert page["total"] == 30
    assert len(page["items"]) == 5
    dates = [i["completion_date"] for i in page["items"]]
    assert dates == sorted(dates, reverse=True)
    assert all(d.startswith("2025") for d in dates)


@pytest.mark.integration
async def test_search_treats_percent_as_a_literal(db_session, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _seed(db_session, org_id, admin_id, count=5)

    result = await get_my_training_records(
        year=None,
        search="%",
        training_type=None,
        page=1,
        page_size=25,
        db=db_session,
        current_user=user,
    )
    assert result["total"] == 0

    result = await get_my_training_records(
        year=None,
        search="new drill",
        training_type=None,
        page=1,
        page_size=25,
        db=db_session,
        current_user=user,
    )
    assert result["total"] == 3


@pytest.mark.integration
async def test_records_withhold_hours_when_switched_off(
    db_session, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _seed(db_session, org_id, admin_id, count=2)
    await TrainingModuleConfigService(db_session).update_config(
        organization_id=org_id, updated_by=None, show_training_hours=False
    )

    result = await get_my_training_records(
        year=None,
        search=None,
        training_type=None,
        page=1,
        page_size=25,
        db=db_session,
        current_user=user,
    )
    assert result["items"]
    assert all("hours_completed" not in item for item in result["items"])
    assert all("hours" not in y for y in result["years"])


@pytest.mark.integration
async def test_records_refused_when_history_is_hidden(db_session, setup_org_and_admin):
    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await TrainingModuleConfigService(db_session).update_config(
        organization_id=org_id, updated_by=None, show_training_history=False
    )

    with pytest.raises(HTTPException) as refused:
        await get_my_training_records(
            year=None,
            search=None,
            training_type=None,
            page=1,
            page_size=25,
            db=db_session,
            current_user=user,
        )
    assert refused.value.status_code == 403


@pytest.mark.integration
@pytest.mark.parametrize(
    "kwargs", [{"year": "20x6"}, {"year": "202"}, {"training_type": "not_a_type"}]
)
async def test_records_reject_malformed_filters(
    db_session, setup_org_and_admin, kwargs
):
    user = await _member(db_session, setup_org_and_admin)
    params = {"year": None, "search": None, "training_type": None, **kwargs}

    with pytest.raises(HTTPException) as refused:
        await get_my_training_records(
            page=1, page_size=25, db=db_session, current_user=user, **params
        )
    assert refused.value.status_code == 400


@pytest.mark.integration
async def test_records_never_reach_another_members_history(
    db_session, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    other_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Other', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": other_id,
            "org": org_id,
            "un": f"other-{other_id[:8]}",
            "em": f"other-{other_id[:8]}@example.com",
        },
    )
    db_session.add(_record(org_id, other_id, "Someone else's class", date(2026, 3, 1)))
    await db_session.flush()

    result = await get_my_training_records(
        year=None,
        search=None,
        training_type=None,
        page=1,
        page_size=25,
        db=db_session,
        current_user=user,
    )
    assert result["total"] == 0
    assert admin_id == str(user.id)


@pytest.mark.integration
async def test_summary_reports_the_calendar_year_to_date(
    db_session, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    this_year = date.today().year
    db_session.add_all(
        [
            _record(org_id, admin_id, "Last year", date(this_year - 1, 6, 1), hours=3),
            _record(org_id, admin_id, "This year", date(this_year, 1, 1), hours=2),
        ]
    )
    await db_session.flush()

    summary = (await get_my_training_summary(db=db_session, current_user=user))[
        "hours_summary"
    ]
    assert summary["completed_courses"] == 2
    assert summary["year_to_date_courses"] == 1
    assert summary["year_to_date_hours"] == 2.0
    assert summary["year"] == this_year
