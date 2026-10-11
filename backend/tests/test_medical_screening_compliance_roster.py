"""The compliance roster and its standing filter.

``GET /medical-screening/compliance`` lists every screenable member and open
prospect with counts, graded by ``_grade`` — the function behind the
per-subject summary — so a row and the detail it opens cannot disagree. The
``standing`` filter backs the Compliance tab's "Not compliant" (overdue or
missing) view.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.medical_screening import get_compliance_roster
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import ScreeningSubject, ScreeningSubjects
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = pytest.mark.unit

TODAY = date(2026, 10, 11)


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.medical_screening_service.resolve_org_today",
        AsyncMock(return_value=TODAY),
    )


def _requirement(screening_type=ScreeningType.PHYSICAL_EXAM):
    req = MagicMock(spec=ScreeningRequirement)
    req.id = str(uuid4())
    req.name = f"{screening_type} requirement"
    req.screening_type = screening_type
    return req


def _record(*, user_id=None, prospect_id=None, expires_in=None, kind=None):
    rec = MagicMock(spec=ScreeningRecord)
    rec.screening_type = kind or ScreeningType.PHYSICAL_EXAM
    rec.status = ScreeningStatus.PASSED.value
    rec.completed_date = TODAY - timedelta(days=100)
    rec.expiration_date = None if expires_in is None else TODAY + timedelta(expires_in)
    rec.user_id = user_id
    rec.prospect_id = prospect_id
    rec.self_recorded = False
    return rec


SUBJECTS = ScreeningSubjects(
    members=[
        ScreeningSubject(id="u-ok", name="Ann Able"),
        ScreeningSubject(id="u-soon", name="Ben Brook"),
        ScreeningSubject(id="u-lapsed", name="Cal Cole"),
        ScreeningSubject(id="u-none", name="Dee Dunn"),
    ],
    prospects=[ScreeningSubject(id="p-1", name="Eve Ewing")],
)

RECORDS = [
    _record(user_id="u-ok", expires_in=200),
    _record(user_id="u-soon", expires_in=10),
    _record(user_id="u-lapsed", expires_in=-5),
    # A converted prospect's record carries both ids; it counts for each.
    _record(user_id="u-none-other", prospect_id="p-1", expires_in=90),
]


async def _roster(standing=None, requirements=None):
    service = MedicalScreeningService(AsyncMock())
    with (
        patch.object(
            service,
            "list_requirements",
            return_value=[_requirement()] if requirements is None else requirements,
        ),
        patch.object(service, "list_subjects", return_value=SUBJECTS),
        patch.object(service, "list_records", return_value=RECORDS),
    ):
        return await service.get_compliance_roster("org-1", standing=standing)


async def test_every_subject_is_graded_with_the_shared_rule():
    roster = await _roster()

    standings = {row.subject_name: row.standing for row in roster.rows}
    assert standings == {
        "Ann Able": "compliant",
        "Ben Brook": "expiring_soon",
        "Cal Cole": "not_compliant",
        "Dee Dunn": "not_compliant",
        "Eve Ewing": "compliant",
    }
    assert (roster.not_compliant, roster.expiring_soon, roster.compliant) == (2, 1, 2)
    assert roster.total_subjects == 5
    assert roster.total_requirements == 1


async def test_the_filter_narrows_rows_but_not_totals():
    roster = await _roster(standing="not_compliant")

    assert [row.subject_name for row in roster.rows] == ["Cal Cole", "Dee Dunn"]
    assert roster.total_subjects == 5
    assert roster.compliant == 2


async def test_no_active_requirement_grades_nobody():
    """An empty requirement set is not a passing one: no row reads compliant,
    every total is zero, and the compliant filter matches nobody."""
    roster = await _roster(requirements=[])

    assert {row.standing for row in roster.rows} == {"not_applicable"}
    assert (roster.not_compliant, roster.expiring_soon, roster.compliant) == (
        0,
        0,
        0,
    )
    assert roster.total_subjects == 5
    assert (await _roster(standing="compliant", requirements=[])).rows == []


async def test_a_row_matches_the_per_subject_summary():
    """The roster's counts for a subject equal get_compliance_status's."""
    service = MedicalScreeningService(AsyncMock())
    requirements = [_requirement(), _requirement(ScreeningType.DRUG_SCREENING)]
    with (
        patch.object(service, "list_requirements", return_value=requirements),
        patch.object(service, "list_subjects", return_value=SUBJECTS),
        patch.object(service, "list_records", return_value=RECORDS),
    ):
        roster = await service.get_compliance_roster("org-1")
    with (
        patch.object(service, "list_requirements", return_value=requirements),
        patch.object(
            service,
            "list_records",
            return_value=[r for r in RECORDS if r.user_id == "u-soon"],
        ),
        patch.object(
            service,
            "_resolve_names",
            return_value={"users": {}, "prospects": {}, "requirements": {}},
        ),
    ):
        detail = await service.get_compliance_status("org-1", user_id="u-soon")

    row = next(r for r in roster.rows if r.subject_id == "u-soon")
    assert (
        row.compliant_count,
        row.non_compliant_count,
        row.expiring_soon_count,
    ) == (
        detail.compliant_count,
        detail.non_compliant_count,
        detail.expiring_soon_count,
    )
    assert row.standing == "not_compliant"


async def test_the_endpoint_audits_the_rows_it_discloses():
    roster = await _roster(standing="not_compliant")
    service = MagicMock()
    service.get_compliance_roster = AsyncMock(return_value=roster)
    audit = AsyncMock()
    with (
        patch(
            "app.api.v1.endpoints.medical_screening.MedicalScreeningService",
            return_value=service,
        ),
        patch("app.api.v1.endpoints.medical_screening._audit_phi_read", audit),
    ):
        result = await get_compliance_roster(
            standing="not_compliant",
            db=MagicMock(),
            current_user=SimpleNamespace(id="officer", organization_id="org-1"),
        )

    assert result is roster
    service.get_compliance_roster.assert_awaited_once_with(
        organization_id="org-1", standing="not_compliant"
    )
    event = audit.await_args.args[3]
    assert audit.await_args.args[2] == "medical_screening.compliance_roster_viewed"
    assert event["filters"] == {"standing": "not_compliant"}
    assert event["subject_user_ids"] == ["u-lapsed", "u-none"]
