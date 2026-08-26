"""
Security-review finding (training extended, 2026-08-26): TRX-4.

``reschedule_cohort_class``/``cancel_cohort_class`` resolved the target class
purely by ``cohort_class_id`` (filtered only on id + organization_id, not the
URL's ``cohort_id``), mutated and committed it, and only *afterward* checked
whether ``cohort_class.cohort_id == cohort_id`` — returning 404 on a mismatch
but leaving the real mutation in place. For cancel, the audit-log call sat
after that check too, so a mismatched request cancelled a class with zero
audit trail while telling the caller "nothing happened" (404).

Fixed by threading ``cohort_id`` into ``_get_cohort_class`` so a
cross-cohort ``cohort_class_id`` fails closed *before* any write. DB mocked;
no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.course_cohorts import (
    cancel_cohort_class,
    reschedule_cohort_class,
)
from app.schemas.course_cohort import CohortClassCancel, CohortClassReschedule


def _user():
    return SimpleNamespace(id="u1", organization_id="org-1", username="officer")


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class TestRescheduleCrossCohortRejected:
    async def test_class_in_a_different_cohort_is_not_mutated(self):
        """cohort_class_id belongs to cohort B; the URL names cohort A."""
        db = MagicMock()
        # _get_cohort_class now filters on cohort_id too, so a class that
        # exists but belongs to a different cohort resolves to None.
        db.execute = AsyncMock(side_effect=[_one(None)])
        db.commit = AsyncMock()

        start = datetime.now(timezone.utc)
        with pytest.raises(HTTPException) as exc:
            await reschedule_cohort_class(
                cohort_id=uuid4(),
                cohort_class_id=uuid4(),
                data=CohortClassReschedule(
                    scheduled_start=start, scheduled_end=start + timedelta(hours=2)
                ),
                db=db,
                current_user=_user(),
            )
        assert exc.value.status_code == 400
        db.commit.assert_not_awaited()


class TestCancelCrossCohortRejected:
    async def test_class_in_a_different_cohort_is_not_cancelled_or_audited(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(None)])
        db.commit = AsyncMock()

        with patch(
            "app.api.v1.endpoints.course_cohorts.log_audit_event", AsyncMock()
        ) as audit:
            with pytest.raises(HTTPException) as exc:
                await cancel_cohort_class(
                    cohort_id=uuid4(),
                    cohort_class_id=uuid4(),
                    data=CohortClassCancel(reason="Instructor unavailable"),
                    db=db,
                    current_user=_user(),
                )
            assert exc.value.status_code == 404
            # The class must not have been cancelled, and — the actual bug —
            # no audit event may fire for a mutation that never happened.
            db.commit.assert_not_awaited()
            audit.assert_not_awaited()


class TestSameCohortStillWorks:
    async def test_reschedule_succeeds_when_cohort_matches(self):
        cohort_id = uuid4()
        now = datetime.now(timezone.utc)
        cohort_class = SimpleNamespace(
            id=str(uuid4()),
            cohort_id=str(cohort_id),
            organization_id=str(uuid4()),
            status="scheduled",
            scheduled_start=None,
            scheduled_end=None,
            instructor_id=None,
            location_id=None,
            event_id=None,
            course_class_id=None,
            sequence=1,
            title="SCBA Operations",
            description=None,
            training_session_id=None,
            class_course_id=None,
            credit_hours=None,
            instructor=None,
            location=None,
            category_id=None,
            requirement_id=None,
            phase_id=None,
            counts_toward_certification=False,
            cancellation_reason=None,
            created_at=now,
            updated_at=now,
        )
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(cohort_class)])
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        start = datetime.now(timezone.utc)
        result = await reschedule_cohort_class(
            cohort_id=cohort_id,
            cohort_class_id=uuid4(),
            data=CohortClassReschedule(
                scheduled_start=start, scheduled_end=start + timedelta(hours=2)
            ),
            db=db,
            current_user=_user(),
        )
        assert result is not None
        db.commit.assert_awaited_once()
