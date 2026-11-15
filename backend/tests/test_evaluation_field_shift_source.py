"""The ``shifts.field_evaluation_averages`` data source: one line per field
shift evaluation form, over the review period, counting only evaluations the
member can see, through the shift-evaluation screens' own averaging."""

import uuid
from datetime import date
from zoneinfo import ZoneInfo

import pytest

from app.models.shift_evaluation import ShiftEvaluation
from app.models.training import TrainingModuleConfig
from app.services.evaluation_data_service import (
    EvaluationDataService,
    compute_coverage,
)
from tests.test_shift_evaluations import _member, _org

pytestmark = [pytest.mark.integration]

KEY = "shifts.field_evaluation_averages"
UTC = ZoneInfo("UTC")


def _scale(top: int) -> list:
    return [{"value": v, "label": str(v)} for v in range(1, top + 1)]


def _evaluation(org_id, member, *, form, top, average, on, status="submitted"):
    return ShiftEvaluation(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        shift_id=None,
        external_shift_id=None,
        shift_date=on,
        member_id=member.id,
        scope_key=str(uuid.uuid4()),
        enrollment_ids=[],
        program_names=[],
        template_id=None,
        template_version=1,
        template_snapshot={"name": form, "scale": _scale(top)},
        status=status,
        header_values={},
        statistics={},
        average_rating=average,
        rated_count=5,
    )


async def _figure(db, org_id, member):
    coverage = compute_coverage(
        date(2026, 1, 1), date(2026, 12, 31), [(date(2020, 1, 1), None)], []
    )
    assert coverage is not None
    values = await EvaluationDataService(db).compute(
        org_id, member, coverage, [KEY], UTC
    )
    return values[KEY]


async def test_one_line_per_form_never_pooled_across_scales(db_session):
    org_id = await _org(db_session)
    member = await _member(db_session, org_id, "Terry")
    db_session.add_all(
        [
            _evaluation(
                org_id, member, form="EMT", top=4, average=3.0, on=date(2026, 3, 1)
            ),
            _evaluation(
                org_id, member, form="EMT", top=4, average=4.0, on=date(2026, 6, 1)
            ),
            _evaluation(
                org_id,
                member,
                form="Driver",
                top=5,
                average=2.5,
                on=date(2026, 7, 1),
            ),
            # A draft, and a shift before the period, are not counted.
            _evaluation(
                org_id,
                member,
                form="EMT",
                top=4,
                average=1.0,
                on=date(2026, 8, 1),
                status="draft",
            ),
            _evaluation(
                org_id, member, form="EMT", top=4, average=1.0, on=date(2025, 12, 31)
            ),
        ]
    )
    await db_session.flush()

    entry = await _figure(db_session, org_id, member)

    assert entry["available"] is True
    assert [line["label"] for line in entry["value"]] == [
        "Driver: 2.5 / 5 (1 evaluation)",
        "EMT: 3.5 / 4 (2 evaluations)",
    ]


async def test_nothing_in_the_period_is_unavailable_not_none(db_session):
    org_id = await _org(db_session)
    member = await _member(db_session, org_id, "Casey")

    entry = await _figure(db_session, org_id, member)

    assert entry == {
        "available": False,
        "value": None,
        "note": "No field shift evaluations in the period.",
    }


async def test_an_evaluation_the_member_cannot_see_yet_is_not_counted(db_session):
    """Under report review, an evaluation waits on the member's approved shift
    report before the member sees it; the annual evaluation waits too, since
    the member reads it."""
    org_id = await _org(db_session)
    member = await _member(db_session, org_id, "Robin")
    db_session.add(
        TrainingModuleConfig(organization_id=org_id, report_review_required=True)
    )
    db_session.add(
        _evaluation(org_id, member, form="EMT", top=4, average=3.0, on=date(2026, 3, 1))
    )
    await db_session.flush()

    entry = await _figure(db_session, org_id, member)

    assert entry["available"] is False
