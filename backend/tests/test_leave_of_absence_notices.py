"""A member is emailed when an officer records, changes or removes their leave.

The email carries the dates and what the leave does to the member's training
requirements, never the leave's reason or type. It is decided from the leave
before and after each request, so a request that changes nothing the member
is told about sends nothing (pitfall #36).
"""

import uuid
from contextlib import asynccontextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user, get_current_user
from app.api.v1.endpoints import member_leaves
from app.core.database import get_db
from app.models.compliance_config import ComplianceConfig
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Position,
    User,
    user_positions,
)
from app.services import email_templates_leave
from app.services.leave_of_absence_notices import (
    RECORDED,
    REMOVED,
    UPDATED,
    build_context,
    deliver_leave_notice,
    notice_kind,
    training_effect,
)

PRIVATE_REASON = "Chemotherapy at the county hospital"


def _state(**overrides):
    state = {
        "leave_type": "medical",
        "start_date": date(2026, 7, 1),
        "end_date": date(2026, 9, 1),
        "exempt_from_training_waiver": False,
        "active": True,
    }
    state.update(overrides)
    return state


@pytest.mark.unit
class TestWhichNotice:
    def test_a_new_leave_is_recorded(self):
        assert notice_kind(None, _state()) == RECORDED

    def test_a_new_leave_created_inactive_says_nothing(self):
        assert notice_kind(None, _state(active=False)) is None

    def test_a_date_change_is_an_update(self):
        assert notice_kind(_state(), _state(end_date=date(2026, 8, 15))) == UPDATED

    def test_making_it_exempt_is_an_update(self):
        before, after = _state(), _state(exempt_from_training_waiver=True)
        assert notice_kind(before, after) == UPDATED

    def test_ending_it_is_a_removal(self):
        assert notice_kind(_state(), _state(active=False)) == REMOVED

    def test_restoring_it_is_recorded_again(self):
        assert notice_kind(_state(active=False), _state()) == RECORDED

    def test_a_repeat_that_changes_nothing_sends_nothing(self):
        assert notice_kind(_state(), _state()) is None

    def test_editing_a_removed_leave_sends_nothing(self):
        before = _state(active=False)
        after = _state(active=False, end_date=date(2026, 8, 1))
        assert notice_kind(before, after) is None


def _leave(**overrides):
    values = {
        "start_date": date(2026, 7, 1),
        "end_date": date(2026, 9, 1),
        "exempt_from_training_waiver": False,
        "reason": PRIVATE_REASON,
        "leave_type": LeaveType.MEDICAL,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.unit
class TestWhatItSays:
    def test_the_context_carries_dates_and_effect_but_not_reason_or_type(self):
        context = build_context(
            _leave(), RECORDED, "Captain Lopez", "Morgan Tester", "full_month"
        )

        assert context["summary"] == (
            "Captain Lopez recorded a leave of absence for you."
        )
        assert context["start_date"] == "July 01, 2026"
        assert context["end_date"] == "September 01, 2026"
        assert "Any day of leave excuses the whole month." in (
            context["training_effect"]
        )
        flat = " ".join(context.values()).lower()
        assert "chemotherapy" not in flat
        assert "medical" not in flat

    def test_an_open_ended_leave_says_so(self):
        context = build_context(
            _leave(end_date=None), RECORDED, "Captain Lopez", "Morgan", "half"
        )
        assert context["end_date"] == "No end date"
        assert "15 or more days" in context["training_effect"]

    def test_each_rule_is_explained(self):
        assert "share of its days" in training_effect(RECORDED, False, "proportional")

    def test_an_exempt_leave_keeps_the_requirements(self):
        assert "stay in force" in training_effect(RECORDED, True, "full_month")

    def test_removal_says_the_requirements_apply_again(self):
        assert "apply in full" in training_effect(REMOVED, False, "full_month")
        assert "unchanged" in training_effect(REMOVED, True, "full_month")

    def test_the_template_has_no_slot_for_reason_or_type(self):
        for body in (email_templates_leave.HTML, email_templates_leave.TEXT):
            assert "{{reason" not in body
            assert "{{leave_type" not in body


OFFICER_PERMISSIONS = ["members.manage", "scheduling.assign"]


async def _user(db, org_id: str, first: str, permissions: list[str]) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{user_id[:8]}@example.com",
        },
    )
    if permissions:
        position = Position(
            organization_id=org_id,
            name=f"{first} position",
            slug=f"{first.lower()}-{user_id[:8]}",
            permissions=permissions,
        )
        db.add(position)
        await db.flush()
        await db.execute(
            user_positions.insert().values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    return (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@asynccontextmanager
async def _as(db, user: User, sent: list):
    """An API client signed in as ``user``; each queued notice lands in ``sent``."""

    async def _record(org_id, leave_id, officer_id, kind):
        sent.append(kind)

    app = FastAPI()
    app.include_router(member_leaves.router, prefix="/users")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_active_user] = lambda: user
    with patch.object(member_leaves, "send_leave_notice", _record), patch(
        "app.api.v1.endpoints.member_leaves.SchedulingService"
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as client:
            yield client


@pytest.mark.integration
class TestTheEndpointsQueueOneNotice:
    async def test_record_change_repeat_and_remove(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", OFFICER_PERMISSIONS)
        member = await _user(db_session, org_id, "Morgan", [])
        sent: list = []

        async with _as(db_session, officer, sent) as client:
            created = await client.post(
                "/users/leaves-of-absence",
                json={
                    "user_id": member.id,
                    "leave_type": "medical",
                    "reason": PRIVATE_REASON,
                    "start_date": "2026-07-01",
                    "end_date": "2026-09-01",
                },
            )
            assert created.status_code == 201, created.text
            leave_id = created.json()["id"]

            change = {"end_date": "2026-08-15"}
            path = f"/users/leaves-of-absence/{leave_id}"
            assert (await client.patch(path, json=change)).status_code == 200
            # The same edit again: nothing the member is told about changed.
            assert (await client.patch(path, json=change)).status_code == 200
            # A change only to the reason is not news to the member.
            assert (
                await client.patch(path, json={"reason": "Updated wording"})
            ).status_code == 200
            assert (await client.delete(path)).status_code == 204
            # Removing it again finds nothing on the member's record.
            await client.delete(path)

        assert sent == [RECORDED, UPDATED, REMOVED]


@pytest.mark.integration
class TestDelivery:
    async def _seed_leave(self, db_session, org_id, member, **overrides):
        leave = MemberLeaveOfAbsence(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            user_id=member.id,
            leave_type=LeaveType.MEDICAL,
            reason=PRIVATE_REASON,
            start_date=date(2026, 7, 1),
            end_date=date(2026, 9, 1),
            active=True,
            **overrides,
        )
        db_session.add(leave)
        await db_session.flush()
        return leave

    async def test_the_member_is_emailed_without_the_reason_or_type(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", OFFICER_PERMISSIONS)
        member = await _user(db_session, org_id, "Morgan", [])
        db_session.add(
            ComplianceConfig(organization_id=org_id, leave_month_rule="proportional")
        )
        leave = await self._seed_leave(db_session, org_id, member)

        with patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            sent = await deliver_leave_notice(
                db_session, org_id, leave.id, officer.id, RECORDED
            )

        assert sent is True
        kwargs = send.call_args.kwargs
        assert kwargs["to_emails"] == [member.email]
        assert kwargs["subject"] == "Leave of absence recorded"
        assert kwargs["template_type"] == "leave_of_absence_notice"
        for body in (kwargs["html_body"], kwargs["text_body"]):
            assert "July 01, 2026" in body
            assert "share of its days" in body
            assert "Chemotherapy" not in body
            assert "Medical" not in body

    async def test_an_officer_is_not_emailed_about_their_own_leave(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", OFFICER_PERMISSIONS)
        leave = await self._seed_leave(db_session, org_id, officer)

        with patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            sent = await deliver_leave_notice(
                db_session, org_id, leave.id, officer.id, RECORDED
            )

        assert sent is False
        send.assert_not_called()

    async def test_another_departments_leave_is_not_found(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", OFFICER_PERMISSIONS)
        member = await _user(db_session, org_id, "Morgan", [])
        leave = await self._seed_leave(db_session, org_id, member)

        with patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            sent = await deliver_leave_notice(
                db_session, str(uuid.uuid4()), leave.id, officer.id, RECORDED
            )

        assert sent is False
        send.assert_not_called()
