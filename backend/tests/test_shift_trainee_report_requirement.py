"""A required trainee report blocks close-out until it is filed.

Owner decisions 2026-10-29 (KNOWN_LIMITATIONS, Scheduling — Settings That Do
Nothing, item 1): when "Require officer shift completion report" is on, every
member in a training seat needs a shift completion report for the shift before
it can be finalized; a shift with no training seats closes as before; a
scheduling admin may close out anyway with a reason, which is audit-logged.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftCompletionReport,
)
from app.schemas.scheduling import ShiftFinalizeRequest
from app.services.scheduling_service import SchedulingService

REQUIRED = {
    "shift_reports": {"post_shift_validation": {"require_officer_report": True}}
}


async def _member(db, org_id, first):
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            ":fn, 'Member', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@fd.test",
        },
    )
    return user_id


async def _scene(db, settings, *, trainee_seat=True):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) VALUES (:id, 'FD', 'fire_department', :slug, "
            "'UTC', :settings)"
        ),
        {"id": org_id, "slug": f"fd-{org_id[:8]}", "settings": json.dumps(settings)},
    )
    officer = await _member(db, org_id, "Olive")
    trainee = await _member(db, org_id, "Terry")
    start = datetime.now(timezone.utc) - timedelta(hours=14)
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=12),
        shift_officer_id=officer,
        created_by=officer,
    )
    db.add(shift)
    db.add(
        ShiftAssignment(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            shift_id=shift.id,
            user_id=trainee,
            position="firefighter",
            assignment_status=AssignmentStatus.CONFIRMED,
            is_training=trainee_seat,
        )
    )
    await db.flush()
    return org_id, officer, trainee, shift


def _report(org_id, officer, trainee, shift):
    return ShiftCompletionReport(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        shift_id=shift.id,
        trainee_id=trainee,
        officer_id=officer,
        shift_date=shift.shift_date,
        hours_on_shift=12.0,
    )


@pytest.mark.integration
class TestFinalizeEnforcesTraineeReports:
    async def test_a_missing_report_blocks_close_out(self, db_session):
        org_id, officer, _trainee, shift = await _scene(db_session, REQUIRED)

        result, error = await SchedulingService(db_session).finalize_shift(
            shift.id, org_id, finalized_by_user_id=officer
        )

        assert result is None
        assert error.startswith(
            "A shift completion report is still needed for: Terry Member."
        )

    async def test_a_filed_report_lets_it_close(self, db_session):
        org_id, officer, trainee, shift = await _scene(db_session, REQUIRED)
        db_session.add(_report(org_id, officer, trainee, shift))
        await db_session.flush()

        result, error = await SchedulingService(db_session).finalize_shift(
            shift.id, org_id, finalized_by_user_id=officer
        )

        assert error is None
        assert result.is_finalized

    async def test_a_shift_with_no_training_seat_closes(self, db_session):
        org_id, officer, _trainee, shift = await _scene(
            db_session, REQUIRED, trainee_seat=False
        )

        _, error = await SchedulingService(db_session).finalize_shift(
            shift.id, org_id, finalized_by_user_id=officer
        )

        assert error is None

    async def test_nothing_is_required_with_the_setting_off(self, db_session):
        org_id, officer, _trainee, shift = await _scene(db_session, {})

        _, error = await SchedulingService(db_session).finalize_shift(
            shift.id, org_id, finalized_by_user_id=officer
        )

        assert error is None

    async def test_nothing_is_required_while_validation_is_off(self, db_session):
        """The setting's box is hidden then, so it must not enforce unseen."""
        org_id, officer, _trainee, shift = await _scene(
            db_session,
            {
                "shift_reports": {
                    "post_shift_validation": {
                        "enabled": False,
                        "require_officer_report": True,
                    }
                }
            },
        )

        _, error = await SchedulingService(db_session).finalize_shift(
            shift.id, org_id, finalized_by_user_id=officer
        )

        assert error is None

    async def test_the_override_closes_it(self, db_session):
        org_id, officer, _trainee, shift = await _scene(db_session, REQUIRED)

        result, error = await SchedulingService(db_session).finalize_shift(
            shift.id,
            org_id,
            finalized_by_user_id=officer,
            override_missing_reports=True,
        )

        assert error is None
        assert result.is_finalized


@pytest.mark.unit
class TestTheOverrideRequest:
    def test_an_override_needs_a_reason(self):
        with pytest.raises(ValueError, match="Give a reason"):
            ShiftFinalizeRequest(override_missing_reports=True)
        with pytest.raises(ValueError, match="Give a reason"):
            ShiftFinalizeRequest(
                override_missing_reports=True, report_override_reason="  "
            )

    async def test_only_a_scheduling_admin_may_override(self):
        from app.api.v1.endpoints import scheduling as endpoints

        officer = SimpleNamespace(
            id="officer-1", organization_id="org-1", username="olive", roles=[]
        )
        body = ShiftFinalizeRequest(
            override_missing_reports=True, report_override_reason="Trainee left early"
        )
        with patch.object(
            endpoints, "_authorize_shift_management", AsyncMock()
        ), patch.object(endpoints, "user_has_permission", return_value=False):
            with pytest.raises(HTTPException) as refused:
                await endpoints.finalize_shift(
                    uuid.uuid4(), body=body, db=AsyncMock(), current_user=officer
                )

        assert refused.value.status_code == 403
