"""Optional officer approval for outside-department shifts.

Owner decision 2026-11-01 ("Let a department require approval before
credit"). Pinned here:

* **Off by default, and absence means off** (pitfall #19): an entry counts the
  moment it is logged, exactly as before the setting existed.
* **On, an entry is ``pending`` and counts toward nothing** until an officer
  approves it — the same ``status == counted`` rule every reader already
  applies, so the hours report, the member's history and compliance cannot
  disagree (pitfall #29).
* **Officers are told, by email and bell** (pitfall #18); the member who
  logged it is not.
* **Approval is org-scoped behind ``scheduling.manage``** (pitfall #14b).
* **Changing what an approval vouched for sends the entry back.**
"""

import json
import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import external_shift_hours as endpoint
from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.models.external_shift_hours import ExternalShiftHours
from app.models.notification import NotificationLog
from app.models.user import Position, User, UserStatus
from app.schemas.external_shift_hours import (
    ExternalShiftHoursCreate,
    ExternalShiftHoursReject,
    ExternalShiftHoursUpdate,
)
from app.services.external_shift_hours_service import (
    NOTICE_CATEGORY,
    ExternalShiftHoursService,
    external_shifts_require_approval,
)
from app.services.scheduling_service import SchedulingService
from app.services.shift_eligibility_service import ShiftEligibilityService
from app.services.shift_history_import_service import ShiftHistoryImportService
from tests.test_external_shift_hours import _external, _unit

pytestmark = pytest.mark.integration

_SEND = "app.services.email_service.EmailService.send_email"


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db_session, *, require_approval=None) -> str:
    org_id = _uid()
    scheduling = {}
    if require_approval is not None:
        scheduling["external_shifts_require_approval"] = require_approval
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Approval FD', 'fire_department', :slug, "
            "'America/New_York', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"appr-{org_id[:8]}",
            "settings": json.dumps({"scheduling": scheduling} if scheduling else {}),
        },
    )
    await db_session.flush()
    return org_id


async def _person(db_session, org_id: str, first: str, *, officer=False) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org_id,
        username=f"appr-{handle}",
        email=f"{handle}@approval.test",
        first_name=first,
        last_name="Reed",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    positions = []
    if officer:
        position = Position(
            id=_uid(),
            organization_id=org_id,
            name=f"Scheduling Officer {handle}",
            slug=f"sched-officer-{handle}",
            permissions=["scheduling.manage"],
        )
        db_session.add(position)
        await db_session.flush()
        positions = [position]
    user.positions = positions
    db_session.add(user)
    await db_session.flush()
    return user


async def _log(db_session, member: User, unit_id: str, hours: float = 12) -> dict:
    return await endpoint.log_external_shift(
        ExternalShiftHoursCreate(
            shift_date=date(2025, 6, 3), hours=hours, external_apparatus_id=unit_id
        ),
        db_session,
        member,
    )


async def _bells(db_session, org_id: str) -> dict:
    rows = (
        await db_session.execute(
            select(NotificationLog).where(
                NotificationLog.organization_id == org_id,
                NotificationLog.category == NOTICE_CATEGORY,
            )
        )
    ).scalars()
    found: dict = {}
    for row in rows:
        found.setdefault(row.recipient_id, []).append(row)
    return found


async def _report_hours(db_session, org_id: str) -> dict:
    report = await SchedulingService(db_session).get_member_hours_report(
        org_id, date(2025, 6, 1), date(2025, 6, 30)
    )
    return {m["user_id"]: m["external_hours"] for m in report}


class TestTheSettingReader:
    @pytest.mark.parametrize(
        ("settings", "expected"),
        [
            (None, False),
            ({}, False),
            ({"scheduling": {}}, False),
            ({"scheduling": "garbage"}, False),
            ({"scheduling": {"external_shifts_require_approval": "yes"}}, False),
            ({"scheduling": {"external_shifts_require_approval": 1}}, False),
            ({"scheduling": {"external_shifts_require_approval": False}}, False),
            ({"scheduling": {"external_shifts_require_approval": True}}, True),
        ],
    )
    def test_only_an_explicit_true_turns_it_on(self, settings, expected):
        assert external_shifts_require_approval(settings) is expected


class TestOffMeansTodaysBehaviour:
    async def test_an_org_that_never_saw_the_setting_counts_at_once(self, db_session):
        org_id = await _org(db_session)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        unit_id = await _unit(db_session, org_id)

        with patch(_SEND, new=AsyncMock()) as send:
            result = await _log(db_session, member, unit_id)

        assert result["status"] == "counted"
        assert (await _report_hours(db_session, org_id)) == {member.id: 12.0}
        assert officer.id not in await _bells(db_session, org_id)
        send.assert_not_called()


class TestApprovalRequired:
    async def test_a_new_entry_waits_and_counts_toward_nothing(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        await _person(db_session, org_id, "Olive", officer=True)
        unit_id = await _unit(db_session, org_id)

        with patch(_SEND, new=AsyncMock()):
            result = await _log(db_session, member, unit_id)

        assert result["status"] == "pending"
        assert (await _report_hours(db_session, org_id)) == {}
        history = await SchedulingService(db_session).get_my_hours_history(
            member.id, org_id, 2025
        )
        assert history["totals"]["external_hours"] == 0.0
        months = await ExternalShiftHoursService(db_session).counted_totals_by_month(
            org_id, member.id
        )
        assert months == {}

    async def test_officers_get_an_email_and_a_bell_and_the_member_neither(
        self, db_session
    ):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        bystander = await _person(db_session, org_id, "Pat")
        # Another department's officer hears nothing about this one.
        other_org = await _org(db_session, require_approval=True)
        outsider = await _person(db_session, other_org, "Quinn", officer=True)
        unit_id = await _unit(db_session, org_id)

        with patch(_SEND, new=AsyncMock()) as send:
            result = await _log(db_session, member, unit_id)

        bells = await _bells(db_session, org_id)
        assert set(bells) == {officer.id}
        assert bells[officer.id][0].action_url == "/scheduling/admin/reports"
        assert (bells[officer.id][0].notification_metadata or {}).get(
            "external_shift_id"
        ) == result["id"]
        assert outsider.id not in await _bells(db_session, other_org)
        sent_to = [call.kwargs["to_emails"] for call in send.await_args_list]
        assert sent_to == [[officer.email]]
        assert bystander.email not in str(sent_to)

    async def test_an_officer_logging_their_own_is_not_told_about_it(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        officer = await _person(db_session, org_id, "Olive", officer=True)
        other_officer = await _person(db_session, org_id, "Owen", officer=True)
        unit_id = await _unit(db_session, org_id)

        with patch(_SEND, new=AsyncMock()):
            await _log(db_session, officer, unit_id)

        assert set(await _bells(db_session, org_id)) == {other_officer.id}

    async def test_approval_makes_it_count(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        unit_id = await _unit(db_session, org_id)
        with patch(_SEND, new=AsyncMock()):
            logged = await _log(db_session, member, unit_id)

        approved = await endpoint.approve_external_shift(
            uuid.UUID(logged["id"]), db_session, officer
        )

        assert approved["status"] == "counted"
        assert approved["reviewed_by"] == officer.id
        assert approved["reviewer_name"]
        assert (await _report_hours(db_session, org_id)) == {member.id: 12.0}

    async def test_approving_twice_is_refused_not_restamped(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        entry_id = await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="counted"
        )

        with pytest.raises(HTTPException) as exc:
            await endpoint.approve_external_shift(
                uuid.UUID(entry_id), db_session, officer
            )
        assert exc.value.status_code == 400
        assert "not waiting for approval" in exc.value.detail

    async def test_another_orgs_entry_cannot_be_approved(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        officer = await _person(db_session, org_id, "Olive", officer=True)
        other_org = await _org(db_session, require_approval=True)
        other_member = await _person(db_session, other_org, "Quinn")
        entry_id = await _external(
            db_session,
            other_org,
            other_member.id,
            date(2025, 6, 3),
            480,
            status="pending",
        )

        with pytest.raises(HTTPException) as exc:
            await endpoint.approve_external_shift(
                uuid.UUID(entry_id), db_session, officer
            )
        assert exc.value.status_code == 404
        row = await db_session.get(ExternalShiftHours, entry_id)
        await db_session.refresh(row)
        assert row.status == "pending"

    async def test_a_pending_entry_can_be_rejected(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        entry_id = await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="pending"
        )

        rejected = await endpoint.reject_external_shift(
            uuid.UUID(entry_id),
            ExternalShiftHoursReject(reason="Not on the roster"),
            db_session,
            officer,
        )
        assert rejected["status"] == "rejected"

    async def test_the_officer_list_filters_to_pending(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        pending = await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="pending"
        )
        await _external(db_session, org_id, member.id, date(2025, 6, 4), 480)

        listing = await endpoint.list_external_shifts(
            None,
            None,
            None,
            endpoint.ExternalShiftHoursStatus.PENDING,
            100,
            0,
            db_session,
            officer,
        )
        assert [i["id"] for i in listing["items"]] == [pending]


class TestEditsAfterApproval:
    async def test_changing_the_hours_sends_it_back_for_review(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        entry_id = await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="counted"
        )

        with patch(_SEND, new=AsyncMock()) as send:
            result = await endpoint.update_my_external_shift(
                uuid.UUID(entry_id),
                ExternalShiftHoursUpdate(hours=24),
                db_session,
                member,
            )

        assert result["status"] == "pending"
        assert result["reviewed_by"] is None
        assert (await _report_hours(db_session, org_id)) == {}
        assert officer.id in await _bells(db_session, org_id)
        assert send.await_count == 1

    async def test_correcting_a_note_leaves_it_counted(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        officer = await _person(db_session, org_id, "Olive", officer=True)
        entry_id = await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="counted"
        )

        with patch(_SEND, new=AsyncMock()):
            result = await endpoint.update_my_external_shift(
                uuid.UUID(entry_id),
                ExternalShiftHoursUpdate(notes="Covered for Engine 3"),
                db_session,
                member,
            )

        assert result["status"] == "counted"
        assert officer.id not in await _bells(db_session, org_id)

    async def test_with_approval_off_an_edit_keeps_counting(self, db_session):
        org_id = await _org(db_session)
        member = await _person(db_session, org_id, "Casey")
        entry_id = await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="counted"
        )

        result = await endpoint.update_my_external_shift(
            uuid.UUID(entry_id), ExternalShiftHoursUpdate(hours=24), db_session, member
        )
        assert result["status"] == "counted"


class TestTheSettingRoundTrip:
    async def test_get_reports_off_until_saved_on(self, db_session):
        org_id = await _org(db_session)
        officer = await _person(db_session, org_id, "Olive", officer=True)

        before = await scheduling_endpoint.get_scheduling_feature_settings(
            db_session, officer
        )
        assert before.external_shifts_require_approval is False

        await ShiftEligibilityService(db_session).update_scheduling_settings(
            organization_id=org_id, external_shifts_require_approval=True
        )
        after = await scheduling_endpoint.get_scheduling_feature_settings(
            db_session, officer
        )
        assert after.external_shifts_require_approval is True

    async def test_a_save_of_another_toggle_does_not_touch_it(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        officer = await _person(db_session, org_id, "Olive", officer=True)

        saved = await scheduling_endpoint.update_scheduling_feature_settings(
            scheduling_endpoint.SchedulingFeatureSettings.model_validate(
                {"platoons_enabled": True}
            ),
            db_session,
            officer,
        )
        assert saved.external_shifts_require_approval is True


class TestImportTreatsPendingAsExisting:
    async def test_a_pending_entry_is_matched_by_a_later_import(self, db_session):
        org_id = await _org(db_session, require_approval=True)
        member = await _person(db_session, org_id, "Casey")
        await _external(
            db_session, org_id, member.id, date(2025, 6, 3), 480, status="pending"
        )

        existing = await ShiftHistoryImportService(db_session)._existing_external(
            org_id, (date(2025, 6, 1), date(2025, 6, 30))
        )
        assert [e.user_id for e in existing] == [member.id]


class TestPermissionGate:
    def test_approve_needs_scheduling_manage(self):
        for route in endpoint.router.routes:
            if route.path == "/{entry_id}/approve" and "POST" in route.methods:
                perms = set()
                for dep in route.dependant.dependencies:
                    for sub in [dep, *dep.dependencies]:
                        perms |= set(getattr(sub.call, "required_permissions", ()))
                assert perms == {"scheduling.manage"}
                return
        pytest.fail("POST /{entry_id}/approve not found")
