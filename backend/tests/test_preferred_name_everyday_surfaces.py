"""Everyday member lists show the name a member goes by.

John Terry Heather goes by "Terry". The inventory members list, the form
member lookup, the admin hours lists and the equipment-check screens must say
"Terry Heather" and find him by "Terry"; the equipment-check compliance report
is a record of note and keeps "John Heather".
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.admin_hours_service import AdminHoursService
from app.services.equipment_check_service import EquipmentCheckService
from app.services.forms_service import FormsService
from app.services.inventory_service import InventoryService


def _terry(**kw) -> User:
    return User(
        id=kw.pop("id", str(uuid.uuid4())),
        first_name="John",
        middle_name="Terry",
        last_name="Heather",
        preferred_name="Terry",
        **kw,
    )


def _scalars(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


@pytest.mark.unit
class TestEquipmentCheckNameMap:
    async def test_everyday_callers_get_the_preferred_name(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_scalars([_terry(id="u1")]))
        names = await EquipmentCheckService(db)._get_user_name_map(["u1"])
        assert names == {"u1": "Terry Heather"}

    async def test_legal_flag_gives_the_legal_name(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_scalars([_terry(id="u1")]))
        names = await EquipmentCheckService(db)._get_user_name_map(["u1"], legal=True)
        assert names == {"u1": "John Heather"}

    async def test_compliance_report_keeps_the_legal_name(self):
        check = SimpleNamespace(
            apparatus_id="a1",
            checked_by="u1",
            overall_status="pass",
            total_items=3,
            checked_at=datetime.now(timezone.utc),
        )
        apparatus = SimpleNamespace(
            id="a1", unit_number="E1", has_deficiency=False, deficiency_since=None
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars([check]),
                _scalars([apparatus]),
                _scalars([_terry(id="u1")]),
            ]
        )
        service = EquipmentCheckService(db)
        now = datetime.now(timezone.utc)
        service._report_window = AsyncMock(
            return_value=(timezone.utc, now - timedelta(days=30), now)
        )

        report = await service.get_compliance_report("org-1")

        assert report["members"][0]["user_name"] == "John Heather"
        assert report["apparatus"][0]["last_checked_by"] == "John Heather"


async def _org_with_terry(db_session) -> tuple[Organization, User]:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Preferred Name Surfaces Department",
        slug=f"pref-surf-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    terry = _terry(
        organization_id=org.id,
        username=f"theather-{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@pref-surf.test",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(terry)
    await db_session.flush()
    return org, terry


@pytest.mark.unit
class TestEquipmentCheckExportsUseLegalNames:
    """The CSV and PDF exports are records of note; the screens are not."""

    async def _export(self, monkeypatch, report_type):
        from app.api.v1.endpoints import equipment_check as endpoint

        service = MagicMock()
        service.get_failure_log = AsyncMock(return_value={"items": []})
        service.get_item_trends = AsyncMock(return_value={"periods": []})
        monkeypatch.setattr(endpoint, "EquipmentCheckService", lambda _db: service)
        org = MagicMock()
        org.scalar_one_or_none.return_value = SimpleNamespace(
            timezone="America/New_York", name="Dept"
        )
        response = await endpoint.export_csv(
            report_type=report_type,
            date_from=None,
            date_to=None,
            apparatus_id=None,
            template_item_id="item-1",
            db=SimpleNamespace(execute=AsyncMock(return_value=org)),
            current_user=SimpleNamespace(organization_id="org-1"),
        )
        "".join([chunk async for chunk in response.body_iterator])
        return service

    async def test_failure_log_csv_asks_for_legal_names(self, monkeypatch):
        service = await self._export(monkeypatch, "failures")
        assert service.get_failure_log.await_args.kwargs["legal_names"] is True

    async def test_item_trends_csv_asks_for_legal_names(self, monkeypatch):
        service = await self._export(monkeypatch, "item-trends")
        assert service.get_item_trends.await_args.kwargs["legal_names"] is True


@pytest.mark.integration
class TestInventoryMembersSummary:
    async def test_display_name_alongside_the_legal_full_name(self, db_session):
        org, terry = await _org_with_terry(db_session)
        rows = await InventoryService(db_session).get_members_inventory_summary(
            organization_id=org.id
        )
        row = next(r for r in rows if r["user_id"] == terry.id)
        assert row["display_name"] == "Terry Heather"
        assert row["full_name"] == "John Heather"
        assert row["preferred_name"] == "Terry"

    async def test_search_finds_a_member_by_preferred_name(self, db_session):
        org, terry = await _org_with_terry(db_session)
        rows = await InventoryService(db_session).get_members_inventory_summary(
            organization_id=org.id, search="Terry"
        )
        assert [r["user_id"] for r in rows] == [terry.id]


@pytest.mark.integration
class TestFormsMemberLookup:
    async def test_finds_a_member_by_preferred_name(self, db_session):
        org, terry = await _org_with_terry(db_session)
        rows = await FormsService(db_session).search_members(uuid.UUID(org.id), "Terry")
        assert [r["id"] for r in rows] == [terry.id]
        assert rows[0]["display_name"] == "Terry Heather"
        assert rows[0]["full_name"] == "John Heather"
        assert rows[0]["preferred_name"] == "Terry"

    async def test_finds_a_member_by_preferred_and_last_name(self, db_session):
        org, terry = await _org_with_terry(db_session)
        rows = await FormsService(db_session).search_members(
            uuid.UUID(org.id), "Terry Heather"
        )
        assert [r["id"] for r in rows] == [terry.id]


@pytest.mark.integration
class TestAdminHoursLists:
    async def _entry(self, db_session, org, terry) -> AdminHoursEntry:
        category = AdminHoursCategory(
            id=str(uuid.uuid4()), organization_id=org.id, name="Station Duty"
        )
        db_session.add(category)
        await db_session.flush()
        now = datetime.now(timezone.utc)
        entry = AdminHoursEntry(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            user_id=terry.id,
            category_id=category.id,
            clock_in_at=now - timedelta(hours=2),
            clock_out_at=now - timedelta(hours=1),
            duration_minutes=60,
            status=AdminHoursEntryStatus.APPROVED,
            approved_by=terry.id,
            approved_at=now,
        )
        db_session.add(entry)
        await db_session.flush()
        return entry

    async def test_admin_list_names_member_and_approver_by_preferred_name(
        self, db_session
    ):
        org, terry = await _org_with_terry(db_session)
        await self._entry(db_session, org, terry)

        entries, total = await AdminHoursService(db_session).list_all_entries(org.id)

        assert total == 1
        assert entries[0]["user_name"] == "Terry Heather"
        assert entries[0]["approver_name"] == "Terry Heather"

    async def test_member_list_names_the_approver_by_preferred_name(self, db_session):
        org, terry = await _org_with_terry(db_session)
        await self._entry(db_session, org, terry)

        entries, _ = await AdminHoursService(db_session).list_my_entries(
            terry.id, org.id
        )

        assert entries[0]["approver_name"] == "Terry Heather"
