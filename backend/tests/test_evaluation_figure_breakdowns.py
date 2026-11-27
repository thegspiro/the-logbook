"""What a scored figure is made of: the ``breakdown`` stored beside a total,
which the evaluation screens and the PDF print next to it. A bare total gives
an evaluator nothing to weigh a suggested rating against."""

from datetime import date

import pytest

from app.models.event import EventType
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.services.evaluation_data_service import EvaluationDataService
from tests.test_evaluation_activity_sources import _figure
from tests.test_evaluation_events_by_type_source import _check_in, _event
from tests.test_shift_evaluations import _member, _org


@pytest.mark.integration
class TestTrainingHours:
    KEY = "training.hours"

    async def _record(self, db, org_id, member, kind, hours, on, **kw):
        db.add(
            TrainingRecord(
                organization_id=org_id,
                user_id=member.id,
                course_name=f"{kind.value} {on}",
                training_type=kind,
                hours_completed=hours,
                status=kw.get("status", TrainingStatus.COMPLETED),
                completion_date=on,
            )
        )
        await db.flush()

    async def test_names_the_records_and_hours_by_type(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Robin")
        for kind, hours, on in (
            (TrainingType.SKILLS_PRACTICE, 8, date(2026, 2, 3)),
            (TrainingType.CONTINUING_EDUCATION, 20, date(2026, 3, 3)),
            (TrainingType.CONTINUING_EDUCATION, 20.75, date(2026, 6, 9)),
            # Adds no hours, so it is not named as part of the total.
            (TrainingType.POLICY_ACKNOWLEDGMENT, 0, date(2026, 4, 1)),
            # Outside the period.
            (TrainingType.REFRESHER, 4, date(2025, 12, 30)),
        ):
            await self._record(db_session, org_id, member, kind, hours, on)
        await self._record(
            db_session,
            org_id,
            member,
            TrainingType.SPECIALTY,
            6,
            date(2026, 5, 5),
            status=TrainingStatus.IN_PROGRESS,
        )

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 48.75
        assert figure["breakdown"] == (
            "3 training records: Continuing Education 40.75 h; Skills Practice 8 h"
        )

    async def test_no_records_has_nothing_to_break_down(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Sam")

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure == {"available": True, "value": 0}


@pytest.mark.integration
class TestEventsAttended:
    KEY = "events.attended_count"

    async def test_counts_each_type_attended(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Lee")
        for kind, on in (
            (EventType.TRAINING, date(2026, 2, 3)),
            (EventType.TRAINING, date(2026, 3, 3)),
            (EventType.BUSINESS_MEETING, date(2026, 2, 10)),
        ):
            await _check_in(
                db_session, org_id, await _event(db_session, org_id, kind, on), member
            )

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 3
        assert figure["breakdown"] == "Business Meeting: 1; Training: 2"


@pytest.mark.unit
class TestShiftTotals:
    TOTALS = {
        "hours": 96.0,
        "shifts": 8.0,
        "calls": 14.0,
        "external_hours": 0.0,
        "external_shifts": 0.0,
    }

    def test_each_shift_figure_names_the_other_half(self):
        from_shifts = EvaluationDataService._from_shifts

        assert from_shifts("shifts.hours", self.TOTALS)["breakdown"] == "8 shifts"
        assert from_shifts("shifts.count", self.TOTALS)["breakdown"] == "96 h"
        assert (
            from_shifts("calls.responses", self.TOTALS)["breakdown"]
            == "Across 8 shifts"
        )

    def test_nothing_worked_has_no_breakdown(self):
        totals = dict.fromkeys(self.TOTALS, 0.0)
        for key in ("shifts.hours", "shifts.count", "calls.responses"):
            assert "breakdown" not in EvaluationDataService._from_shifts(key, totals)
