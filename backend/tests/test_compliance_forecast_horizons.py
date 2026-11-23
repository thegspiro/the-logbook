"""
The compliance forecast's 30/60/90-day projections are the Compliance
Matrix's own grading as of that future day, from the records already logged
(owner decision 2026-11-21).

The projection used to subtract one met requirement for every completed record
expiring in the window. That charged a certificate no requirement grades and a
superseded record whose renewal already exists, and since the projections
carry a standing colour it turned a fully compliant member red. It also
missed lapses that are not certificate expiries, such as a rolling window
letting old hours fall out.

Every requirement here is one-time, rolling or a certification, never a
calendar period, so a projection 90 days out cannot cross into a new period
and change the answer depending on the day the suite runs (CLAUDE.md
pitfall 40).
"""

import uuid
from datetime import date, timedelta

import pytest

from app.api.v1.endpoints import training as training_endpoints
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.services.training_enhancement_service import ReportExportService
from tests.test_officer_compliance_views_profiles import _matrix, _member, _org

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


def _requirement(db, org_id: str, name: str, **fields) -> TrainingRequirement:
    values = {
        "id": _uid(),
        "organization_id": org_id,
        "name": name,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "applies_to_all": True,
        "shift_credited": False,
        "active": True,
    }
    values.update(fields)
    req = TrainingRequirement(**values)
    db.add(req)
    return req


def _one_time_hours(db, org_id: str, name: str, training_type: TrainingType):
    return _requirement(
        db,
        org_id,
        name,
        requirement_type=RequirementType.HOURS,
        training_type=training_type,
        required_hours=1,
        frequency=RequirementFrequency.ONE_TIME,
    )


def _certification(db, org_id: str, name: str = "EMT"):
    return _requirement(
        db,
        org_id,
        name,
        requirement_type=RequirementType.CERTIFICATION,
        training_type=TrainingType.CERTIFICATION,
        frequency=RequirementFrequency.ONE_TIME,
    )


def _record(
    db,
    org_id: str,
    user_id: str,
    on: date,
    training_type: TrainingType,
    *,
    hours: float = 1.0,
    expires: date | None = None,
    course_name: str = "Company Drill",
) -> None:
    db.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            course_name=course_name,
            training_type=training_type,
            status=TrainingStatus.COMPLETED,
            completion_date=on,
            expiration_date=expires,
            certification_number=(
                f"C-{uuid.uuid4().hex[:6]}"
                if training_type == TrainingType.CERTIFICATION
                else None
            ),
            hours_completed=hours,
        )
    )


async def _forecast(db, org_id: str) -> dict[str, dict]:
    rows = await ReportExportService(db).generate_compliance_forecast(org_id)
    return {r["user_id"]: r for r in rows}


def _horizons(row: dict) -> list[tuple[float | None, str]]:
    return [
        (row[f"forecast_{n}_days"], row[f"forecast_{n}_standing"]) for n in (30, 60, 90)
    ]


class TestProjectionIsTheMatrixOnThatDay:
    async def test_unrelated_certificate_costs_nothing(self, db_session):
        # Before: 3 of 3 met, one ungraded certificate expiring in 20 days,
        # 66.7% non-compliant at every horizon.
        org_id, today = await _org(db_session)
        types = (
            TrainingType.CONTINUING_EDUCATION,
            TrainingType.SKILLS_PRACTICE,
            TrainingType.ORIENTATION,
        )
        for index, training_type in enumerate(types):
            _one_time_hours(db_session, org_id, f"Req {index}", training_type)
        member = await _member(db_session, org_id, "Mike")
        for training_type in types:
            _record(db_session, org_id, member, today, training_type)
        _record(
            db_session,
            org_id,
            member,
            today - timedelta(days=700),
            TrainingType.CERTIFICATION,
            hours=0,
            expires=today + timedelta(days=20),
            course_name="Hazmat Awareness",
        )
        await db_session.flush()

        row = (await _forecast(db_session, org_id))[member]

        assert row["current_compliance_percentage"] == 100.0
        assert _horizons(row) == [(100.0, "compliant")] * 3
        # Still listed, as information: it is expiring.
        assert len(row["expiring_certifications"]) == 1

    async def test_superseded_renewal_costs_nothing(self, db_session):
        # Before: the old card expiring in 20 days cost the requirement,
        # though its renewal runs for another two years.
        org_id, today = await _org(db_session)
        _certification(db_session, org_id)
        member = await _member(db_session, org_id, "Mike")
        _record(
            db_session,
            org_id,
            member,
            today - timedelta(days=700),
            TrainingType.CERTIFICATION,
            hours=0,
            expires=today + timedelta(days=20),
            course_name="EMT",
        )
        _record(
            db_session,
            org_id,
            member,
            today - timedelta(days=5),
            TrainingType.CERTIFICATION,
            hours=0,
            expires=today + timedelta(days=730),
            course_name="EMT",
        )
        await db_session.flush()

        row = (await _forecast(db_session, org_id))[member]

        assert _horizons(row) == [(100.0, "compliant")] * 3

    async def test_graded_certificate_lapsing_is_charged(self, db_session):
        # Guard: green before and after. The one certificate the requirement
        # reads expires in 45 days.
        org_id, today = await _org(db_session)
        _certification(db_session, org_id)
        member = await _member(db_session, org_id, "Mike")
        _record(
            db_session,
            org_id,
            member,
            today - timedelta(days=700),
            TrainingType.CERTIFICATION,
            hours=0,
            expires=today + timedelta(days=45),
            course_name="EMT",
        )
        await db_session.flush()

        row = (await _forecast(db_session, org_id))[member]

        assert _horizons(row) == [
            (100.0, "compliant"),
            (0.0, "non_compliant"),
            (0.0, "non_compliant"),
        ]

    async def test_rolling_hours_falling_out_of_the_window_are_charged(
        self, db_session
    ):
        # A 12-month rolling requirement met by one record 340 days old: in
        # 30 days that record has left the window. Before: 100% at every
        # horizon, because no certificate expires.
        org_id, today = await _org(db_session)
        _requirement(
            db_session,
            org_id,
            "Rolling",
            requirement_type=RequirementType.HOURS,
            training_type=TrainingType.CONTINUING_EDUCATION,
            required_hours=1,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.ROLLING,
            rolling_period_months=12,
        )
        member = await _member(db_session, org_id, "Mike")
        _record(
            db_session,
            org_id,
            member,
            today - timedelta(days=340),
            TrainingType.CONTINUING_EDUCATION,
        )
        await db_session.flush()

        row = (await _forecast(db_session, org_id))[member]

        assert row["current_standing"] == "compliant"
        assert _horizons(row) == [(0.0, "non_compliant")] * 3

    async def test_every_horizon_equals_the_matrix_on_that_day(
        self, db_session, monkeypatch
    ):
        org_id, today = await _org(db_session)
        _certification(db_session, org_id)
        _one_time_hours(db_session, org_id, "Orientation", TrainingType.ORIENTATION)
        _requirement(
            db_session,
            org_id,
            "Rolling",
            requirement_type=RequirementType.HOURS,
            training_type=TrainingType.CONTINUING_EDUCATION,
            required_hours=1,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.ROLLING,
            rolling_period_months=12,
        )
        members = {}
        for last, cert_days, rolling_age in (
            ("Able", 10, 300),
            ("Baker", 50, 345),
            ("Clark", 400, 20),
        ):
            member = await _member(db_session, org_id, last)
            members[last] = member
            _record(
                db_session,
                org_id,
                member,
                today - timedelta(days=700),
                TrainingType.CERTIFICATION,
                hours=0,
                expires=today + timedelta(days=cert_days),
                course_name="EMT",
            )
            _record(
                db_session,
                org_id,
                member,
                today - timedelta(days=rolling_age),
                TrainingType.CONTINUING_EDUCATION,
            )
        _record(db_session, org_id, members["Clark"], today, TrainingType.ORIENTATION)
        await db_session.flush()

        forecast = await _forecast(db_session, org_id)
        for days in (30, 60, 90):

            async def on_that_day(_db, _org_id, _days=days):
                return today + timedelta(days=_days)

            monkeypatch.setattr(training_endpoints, "resolve_org_today", on_that_day)
            matrix = await _matrix(db_session, org_id)
            for member in members.values():
                assert (
                    forecast[member][f"forecast_{days}_days"],
                    forecast[member][f"forecast_{days}_standing"],
                ) == (matrix[member]["completion_pct"], matrix[member]["standing"])
