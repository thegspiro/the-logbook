"""
Training summary's per-requirement section is program progress, graded by the
shared applicability rules (RPT5-29-1).

Owner decision: relabel ``training_summary`` and ``compliance_status`` as
training-program progress -- not switch them to the shared compliance
evaluator -- and fix ``requirement_breakdown`` so a grandfathered member is
treated the way ``compliance_status`` already treats them. It used to divide
by every enrolled member, so a member a requirement exempts (joined before
its cutoff) or is still giving time to catch up counted as unmet.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import RequirementProgressStatus
from app.services import reports_service
from app.services.reports_service import ReportsService

pytestmark = pytest.mark.unit

CUTOFF = date(2026, 7, 1)
VETERAN = date(2015, 3, 1)
RECRUIT = date(2026, 8, 15)


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    result.scalars.return_value.unique.return_value.all.return_value = items
    return result


def _scalar(value):
    result = MagicMock()
    result.scalar.return_value = value
    return result


def _member(uid, joined):
    return SimpleNamespace(
        id=uid,
        first_name="M",
        last_name=uid,
        status=None,
        membership_type="active",
        rank=None,
        hire_date=joined,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        positions=[],
    )


def _requirement(**overrides):
    values = dict(
        id="req-1",
        name="Live Fire",
        applies_to_all=True,
        required_membership_types=None,
        required_roles=None,
        required_positions=None,
        new_member_cutoff_date=None,
        existing_member_deadline=None,
        applies_to_joined_before=None,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def _enrollment(uid, completed: bool):
    progress = (
        [
            SimpleNamespace(
                requirement_id="req-1", status=RequirementProgressStatus.COMPLETED
            )
        ]
        if completed
        else []
    )
    return SimpleNamespace(user_id=uid, requirement_progress=progress)


async def _breakdown(requirement, members, enrollments, monkeypatch, today=None):
    if today is not None:
        monkeypatch.setattr(
            reports_service, "resolve_org_today", AsyncMock(return_value=today)
        )
    db = MagicMock()
    # records, users, course count, requirements, enrollments, population
    db.execute = AsyncMock(
        side_effect=[
            _all([]),
            _all(members),
            _scalar(0),
            _all([requirement]),
            _all(enrollments),
            _all(members),
        ]
    )
    out = await ReportsService(db)._generate_training_summary(uuid4())
    return out["requirement_breakdown"][0]


async def test_a_member_the_cutoff_exempts_is_not_counted(monkeypatch):
    row = await _breakdown(
        _requirement(new_member_cutoff_date=CUTOFF),
        [_member("veteran", VETERAN), _member("recruit", RECRUIT)],
        [_enrollment("veteran", False), _enrollment("recruit", True)],
        monkeypatch,
    )

    # Was 1 of 2 enrolled (50%); the veteran is exempt from this requirement.
    assert (row["total_members"], row["completed"], row["completion_pct"]) == (
        1,
        1,
        100.0,
    )


async def test_a_member_inside_the_catch_up_period_counts_neither_way(monkeypatch):
    row = await _breakdown(
        _requirement(
            new_member_cutoff_date=CUTOFF, existing_member_deadline=date(2026, 12, 31)
        ),
        [_member("veteran", VETERAN), _member("recruit", RECRUIT)],
        [_enrollment("veteran", False), _enrollment("recruit", False)],
        monkeypatch,
        today=date(2026, 10, 11),
    )

    assert (row["total_members"], row["completed"]) == (1, 0)


async def test_after_the_catch_up_deadline_the_member_is_graded(monkeypatch):
    row = await _breakdown(
        _requirement(
            new_member_cutoff_date=CUTOFF, existing_member_deadline=date(2026, 9, 30)
        ),
        [_member("veteran", VETERAN), _member("recruit", RECRUIT)],
        [_enrollment("veteran", False), _enrollment("recruit", True)],
        monkeypatch,
        today=date(2026, 10, 11),
    )

    assert (row["total_members"], row["completed"], row["completion_pct"]) == (
        2,
        1,
        50.0,
    )


async def test_the_reports_are_titled_as_program_progress():
    reports = {
        r["id"]: r
        for r in (await ReportsService(MagicMock()).get_available_reports())[
            "available_reports"
        ]
    }

    assert reports["compliance_status"]["title"] == "Program Requirement Progress"
    assert reports["training_summary"]["title"] == "Training & Program Progress Summary"
    for report_id in ("compliance_status", "training_summary"):
        assert "Not requirement compliance" in reports[report_id]["description"]
