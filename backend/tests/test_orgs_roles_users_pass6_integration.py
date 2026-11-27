"""Orgs, roles and users (app-review B21 pass 6).

- Clearing the rank the sole administrator's access rests on, directly or by a
  move to the administrative class, is refused.
- A sole administrator can be set to probationary, a current status.
- A blank member number is stored as no number, so two members can be blank.
- A settings save re-reads the organization under a lock and does not revert
  a change written since the request began.
- The general settings route no longer rewrites the membership-tier ladder.
- A blocked privilege-escalation attempt reaches the audit trail.
- Extending a leave by edit releases the member's shifts in the new days.
"""

import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.models.audit import AuditLog
from app.models.user import Organization, Position, User, UserStatus
from app.schemas.organization import MembershipTierSettings, OrganizationSettingsUpdate
from app.services.admin_continuity_service import _active_administrators

pytestmark = [pytest.mark.integration]


def _request():
    return Request(
        {
            "type": "http",
            "headers": [],
            "client": ("127.0.0.1", 1),
            "method": "PATCH",
            "path": "/",
            "query_string": b"",
        }
    )


async def _org(db, settings=None):
    org = Organization(
        id=str(uuid.uuid4()),
        name="ORU Pass 6",
        slug=f"oru6-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings=settings or {},
    )
    db.add(org)
    await db.flush()
    return org


async def _position(db, org, permissions):
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"P {uuid.uuid4().hex[:6]}",
        slug=f"p_{uuid.uuid4().hex[:6]}",
        permissions=permissions,
    )
    db.add(position)
    await db.flush()
    return position


async def _member(db, org, positions=(), **fields):
    tag = uuid.uuid4().hex[:10]
    values = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u-{tag}",
        email=f"{tag}@oru6.test",
        first_name="Pat",
        last_name="Lee",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    values.update(fields)
    user = User(**values)
    user.positions = list(positions)
    db.add(user)
    await db.flush()
    return user


class TestTheSoleAdministratorsRank:
    async def test_clearing_it_is_refused(self, db_session):
        from app.api.v1.endpoints.users import update_user_profile
        from app.schemas.user import UserUpdate

        org = await _org(db_session)
        base = await _position(db_session, org, ["members.view"])
        chief = await _member(db_session, org, [base], rank="fire_chief")

        with pytest.raises(HTTPException) as refused:
            await update_user_profile(
                user_id=uuid.UUID(chief.id),
                profile_update=UserUpdate(rank=None),
                db=db_session,
                current_user=chief,
                authorization=None,
                access_token=None,
                request=_request(),
            )

        assert refused.value.status_code == 400
        assert len(await _active_administrators(db_session, org.id)) == 1

    async def test_a_move_to_administrative_is_refused(self, db_session):
        from app.api.v1.endpoints.member_status import (
            MembershipTypeChangeRequest,
            change_membership_type,
        )

        org = await _org(db_session)
        chief = await _member(db_session, org, [], rank="fire_chief")

        with pytest.raises(HTTPException) as refused:
            await change_membership_type(
                user_id=uuid.UUID(chief.id),
                request=MembershipTypeChangeRequest(membership_type="administrative"),
                db=db_session,
                current_user=chief,
            )

        assert refused.value.status_code == 400
        assert len(await _active_administrators(db_session, org.id)) == 1


async def test_the_sole_administrator_can_be_made_probationary(db_session):
    from app.api.v1.endpoints.member_status import (
        MemberStatusChangeRequest,
        change_member_status,
    )

    org = await _org(db_session)
    owner = await _position(db_session, org, ["*"])
    admin = await _member(db_session, org, [owner], hire_date=date(2018, 3, 1))

    await change_member_status(
        user_id=uuid.UUID(admin.id),
        request=MemberStatusChangeRequest(new_status="probationary"),
        background_tasks=BackgroundTasks(),
        db=db_session,
        current_user=admin,
        _stepup=admin,
    )

    assert admin.status == UserStatus.PROBATIONARY


async def test_two_members_can_have_no_member_number(db_session):
    from app.api.v1.endpoints.users import update_user_profile
    from app.schemas.user import UserUpdate

    org = await _org(db_session)
    officer = await _member(db_session, org, [await _position(db_session, org, ["*"])])
    first = await _member(db_session, org)
    second = await _member(db_session, org)

    for member in (first, second):
        saved = await update_user_profile(
            user_id=uuid.UUID(member.id),
            profile_update=UserUpdate(membership_number=""),
            db=db_session,
            current_user=officer,
            authorization=None,
            access_token=None,
            request=_request(),
        )
        assert saved.membership_number is None


async def test_a_settings_save_keeps_a_change_written_since_it_began(db_session):
    from app.services.organization_service import OrganizationService

    org = await _org(db_session, {"membership_tiers": {"tiers": [{"id": "old"}]}})
    service = OrganizationService(db_session)
    await service.get_organization(org.id)
    # Another writer's committed change, seen by the transaction here.
    await db_session.execute(
        text(
            "UPDATE organizations SET settings = JSON_SET(settings, "
            "'$.membership_tiers.tiers[0].id', 'new') WHERE id = :id"
        ),
        {"id": org.id},
    )

    await service.update_organization_settings(org.id, {"other_section": {"x": 1}})

    stored = (
        await db_session.execute(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(settings, "
                "'$.membership_tiers.tiers[0].id')) FROM organizations WHERE id = :id"
            ),
            {"id": org.id},
        )
    ).scalar()
    assert stored == "new"


async def test_general_settings_do_not_rewrite_the_tier_ladder(db_session):
    from app.api.v1.endpoints.organizations import update_organization_settings

    org = await _org(
        db_session, {"membership_tiers": MembershipTierSettings().model_dump()}
    )
    officer = await _member(
        db_session, org, [await _position(db_session, org, ["settings.manage"])]
    )
    await _member(db_session, org, membership_type="senior")
    ladder = MembershipTierSettings().model_dump()
    ladder["tiers"] = [t for t in ladder["tiers"] if t["id"] != "senior"]

    await update_organization_settings(
        settings_update=OrganizationSettingsUpdate.model_validate(
            {"membership_tiers": ladder}
        ),
        request=_request(),
        db=db_session,
        current_user=officer,
        access_token=None,
    )

    await db_session.refresh(org)
    stored_ids = [t["id"] for t in org.settings["membership_tiers"]["tiers"]]
    assert "senior" in stored_ids


async def test_a_blocked_escalation_attempt_is_audited(db_session):
    from app.services.security_monitoring import report_privilege_escalation_attempt

    org = await _org(db_session)
    member = await _member(db_session, org)

    def count():
        return (
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.event_type == "privilege_escalation_attempt",
                AuditLog.user_id == member.id,
            )
        )

    before = (await db_session.execute(count())).scalar()
    await report_privilege_escalation_attempt(db_session, member.id, "oru6:test", None)

    assert (await db_session.execute(count())).scalar() == before + 1


async def test_extending_a_leave_releases_shifts_in_the_new_days(db_session):
    from app.api.v1.endpoints.member_leaves import (
        LeaveOfAbsenceCreate,
        LeaveOfAbsenceUpdate,
        create_leave_of_absence,
        update_leave_of_absence,
    )
    from app.services.scheduling_service import SchedulingService

    org = await _org(db_session, {"scheduling": {"open_positions": ["firefighter"]}})
    officer = await _member(db_session, org, [await _position(db_session, org, ["*"])])
    member = await _member(db_session, org)
    org_id, member_id, manager_id = org.id, member.id, officer.id
    scheduling = SchedulingService(db_session)
    day = date.today() + timedelta(days=10)
    shift, err = await scheduling.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": day,
            "start_time": datetime(day.year, day.month, day.day, 7, 0),
        },
        uuid.UUID(manager_id),
    )
    assert err is None, err
    seat, err = await scheduling.create_assignment(
        uuid.UUID(org_id),
        uuid.UUID(shift.id),
        {"user_id": member_id, "position": "firefighter"},
        uuid.UUID(manager_id),
    )
    assert err is None, err
    start = date.today() + timedelta(days=1)
    leave = await create_leave_of_absence(
        data=LeaveOfAbsenceCreate(
            user_id=member_id, start_date=start, end_date=start + timedelta(days=2)
        ),
        background_tasks=BackgroundTasks(),
        db=db_session,
        current_user=officer,
    )

    await update_leave_of_absence(
        leave_id=leave.id,
        data=LeaveOfAbsenceUpdate(end_date=start + timedelta(days=20)),
        background_tasks=BackgroundTasks(),
        db=db_session,
        current_user=officer,
    )

    await db_session.refresh(seat)
    assert seat.assignment_status == "cancelled"
