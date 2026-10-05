"""Everyday service surfaces name a member by the name they go by.

John Terry Heather has ``preferred_name="Terry"``. Shift boards, the org chart,
the NFC kiosk, the member list and reminder emails say "Terry"; the legal
``full_name`` stays "John Heather" for records of note. DB mocked; no MySQL.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.user import User, UserStatus
from app.schemas.nfc_tag import NfcCheckInStatus, NfcCheckInTarget
from app.services.nfc_tag_service import NfcTagService
from app.services.org_chart_service import _member_name
from app.services.scheduled_tasks import run_inventory_overdue_alerts
from app.services.scheduling_service import SchedulingService
from app.services.user_service import UserService

pytestmark = [pytest.mark.unit]


def _terry(**extra) -> User:
    return User(
        id=str(uuid.uuid4()),
        organization_id=str(uuid.uuid4()),
        username="theather",
        first_name="John",
        last_name="Heather",
        preferred_name="Terry",
        email="terry@example.com",
        **extra,
    )


def _rows(rows):
    result = MagicMock()
    result.all.return_value = rows
    return result


class TestSchedulingUserNameMap:
    async def test_uses_the_preferred_name_and_selects_the_column(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=_rows(
                [
                    SimpleNamespace(
                        id="u1",
                        first_name="John",
                        last_name="Heather",
                        preferred_name="Terry",
                    ),
                    SimpleNamespace(
                        id="u2",
                        first_name="Sam",
                        last_name="Adams",
                        preferred_name=None,
                    ),
                    SimpleNamespace(
                        id="u3", first_name=None, last_name=None, preferred_name=None
                    ),
                ]
            )
        )

        names = await SchedulingService(db)._get_user_name_map(["u1", "u2", "u3"])

        assert names == {"u1": "Terry Heather", "u2": "Sam Adams", "u3": "Unknown"}
        statement = db.execute.await_args.args[0]
        assert "preferred_name" in {c.name for c in statement.selected_columns}


class TestOrgChartMemberName:
    def test_preferred_name_replaces_first_name(self):
        assert _member_name(_terry()) == "Terry Heather"

    def test_falls_back_to_first_then_username(self):
        assert _member_name(User(first_name="John", last_name="Heather")) == (
            "John Heather"
        )
        assert _member_name(User(username="jh")) == "jh"


class TestNfcKioskShortName:
    async def test_check_in_names_the_member_by_preferred_name(self):
        user = _terry(membership_number="042")
        service = NfcTagService(MagicMock())
        service.resolve_tag = AsyncMock(return_value=(None, user, None))
        service._check_in_shift = AsyncMock(
            return_value={"status": NfcCheckInStatus.CHECKED_IN, "message": "ok"}
        )

        result = await service.check_in(
            organization_id=user.organization_id,
            tag_uid="04A2",
            target_type=NfcCheckInTarget.SHIFT,
            target_id="shift-1",
        )

        assert result["member_name"] == "Terry Heather"
        kiosk = NfcTagService._kiosk_result(result)
        assert kiosk["member_display_name"] == "Terry H."


class TestUserListKeys:
    async def test_list_carries_legal_and_display_names(self):
        user = _terry(status=UserStatus.ACTIVE)
        result = MagicMock()
        result.scalars.return_value.all.return_value = [user]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)

        (row,) = await UserService(db).get_users_for_organization(
            uuid.UUID(user.organization_id)
        )

        assert row.full_name == "John Heather"
        assert row.display_name == "Terry Heather"
        assert row.preferred_name == "Terry"


class TestScheduledTaskSalutation:
    async def test_overdue_equipment_email_greets_by_preferred_name(self):
        org = SimpleNamespace(id="org-1", timezone="America/New_York", name="Dept")
        org_result = MagicMock()
        org_result.scalars.return_value.all.return_value = [org]
        db = MagicMock()
        db.execute = AsyncMock(return_value=org_result)
        checkout = SimpleNamespace(
            user_id="u1",
            user=_terry(),
            item=SimpleNamespace(name="Radio"),
            expected_return_at=None,
        )
        bodies = []

        def _wrap(_org, _title, body, **_kwargs):
            bodies.append(body)
            return body

        with (
            patch("app.services.inventory_service.InventoryService") as MockSvc,
            patch("app.services.email_service.EmailService") as MockEmail,
            patch("app.services.email_service.wrap_email_body", _wrap),
        ):
            instance = MockSvc.return_value
            instance.mark_overdue_checkouts = AsyncMock(return_value=0)
            instance.get_overdue_checkouts_for_alerts = AsyncMock(
                return_value=[checkout]
            )
            MockEmail.return_value.send_email = AsyncMock(return_value=(1, 0))

            await run_inventory_overdue_alerts(db)

        assert len(bodies) == 1
        assert "<p>Hello Terry,</p>" in bodies[0]
        assert "John" not in bodies[0]
