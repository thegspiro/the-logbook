"""NFC phase 4a, against the real database: audit schedules and the weekly
"shelf audits overdue" digest.

What matters is computed from stored rows — which area is due, from which
saved audit, and whether a digest already went out this week — so a mocked
session would only assert the queries as written.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from app.models.inventory import (
    InventoryAuditFrequency,
    InventoryNfcAudit,
    InventoryNfcAuditDigest,
)
from app.services.inventory_audit_schedule_service import (
    InventoryAuditScheduleService,
)
from app.services.scheduled_tasks import run_inventory_audit_digest

pytestmark = pytest.mark.integration

NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)
WEEKLY = InventoryAuditFrequency.WEEKLY
MONTHLY = InventoryAuditFrequency.MONTHLY


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _make_user(db, org_id: str, first: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first}-{user_id[:8]}",
            "fn": first,
            "em": f"{first}-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _make_location(db, org_id: str, name: str) -> str:
    loc_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO locations (id, organization_id, name) "
            "VALUES (:id, :org, :name)"
        ),
        {"id": loc_id, "org": org_id, "name": name},
    )
    await db.flush()
    return loc_id


async def _make_area(
    db, org_id: str, name: str, *, location_id=None, active: bool = True
) -> str:
    area_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO storage_areas "
            "(id, organization_id, name, storage_type, location_id, is_active) "
            "VALUES (:id, :org, :name, 'shelf', :loc, :active)"
        ),
        {
            "id": area_id,
            "org": org_id,
            "name": name,
            "loc": location_id,
            "active": active,
        },
    )
    await db.flush()
    return area_id


async def _audit(db, org_id: str, area_id: str, when: datetime) -> None:
    db.add(
        InventoryNfcAudit(
            organization_id=org_id,
            storage_area_id=area_id,
            storage_area_name="snapshot",
            audited_at=when,
        )
    )
    await db.flush()


async def _enable_nfc(db, org_id: str, on: bool = True) -> None:
    await db.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {"s": json.dumps({"inventory": {"nfc_tracking_enabled": on}}), "id": org_id},
    )
    await db.flush()
    db.expire_all()


async def _grant(db, org_id: str, user_id: str, permissions: list) -> None:
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"P {position_id[:6]}",
            "slug": f"p-{position_id[:8]}",
            "perms": json.dumps(permissions),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()


class TestSchedule:
    async def test_due_dates_follow_the_latest_audit(self, db_session):
        org = await _make_org(db_session, "sched-org")
        service = InventoryAuditScheduleService(db_session)
        fresh = await _make_area(db_session, org, "Fresh")
        stale = await _make_area(db_session, org, "Stale")
        never = await _make_area(db_session, org, "Never")
        await _make_area(db_session, org, "Unscheduled")
        for area in (fresh, stale, never):
            await service.set_frequency(area, org, WEEKLY)
        await _audit(db_session, org, fresh, NOW - timedelta(days=2))
        await _audit(db_session, org, stale, NOW - timedelta(days=30))
        await _audit(db_session, org, stale, NOW - timedelta(days=10))

        rows = await service.list_schedule(org, now=NOW)
        by_name = {r["storage_area_name"]: r for r in rows}
        assert set(by_name) == {"Fresh", "Stale", "Never"}
        assert by_name["Fresh"]["overdue"] is False
        assert by_name["Fresh"]["next_due_at"] == NOW + timedelta(days=5)
        # The latest audit counts, not the first.
        assert by_name["Stale"]["days_overdue"] == 3
        assert by_name["Never"]["overdue"] is True
        assert by_name["Never"]["next_due_at"] is None
        # Never audited first, then the longest overdue, then the soonest due.
        assert [r["storage_area_name"] for r in rows] == ["Never", "Stale", "Fresh"]

        due = await service.list_schedule(org, due_only=True, now=NOW)
        assert [r["storage_area_name"] for r in due] == ["Never", "Stale"]

    async def test_monthly_is_a_calendar_month(self, db_session):
        org = await _make_org(db_session, "sched-org")
        service = InventoryAuditScheduleService(db_session)
        area = await _make_area(db_session, org, "Bin")
        await service.set_frequency(area, org, MONTHLY)
        await _audit(
            db_session, org, area, datetime(2026, 1, 31, 9, 0, tzinfo=timezone.utc)
        )
        rows = await service.list_schedule(org, now=NOW)
        assert rows[0]["next_due_at"] == datetime(
            2026, 2, 28, 9, 0, tzinfo=timezone.utc
        )

    async def test_clearing_takes_an_area_off_the_schedule(self, db_session):
        org = await _make_org(db_session, "sched-org")
        service = InventoryAuditScheduleService(db_session)
        area = await _make_area(db_session, org, "Bin")
        await service.set_frequency(area, org, WEEKLY)
        row = await service.set_frequency(area, org, None)
        assert row["audit_frequency"] is None
        assert row["overdue"] is False
        assert await service.list_schedule(org, now=NOW) == []

    async def test_inactive_areas_are_refused_and_never_listed(self, db_session):
        org = await _make_org(db_session, "sched-org")
        service = InventoryAuditScheduleService(db_session)
        closed = await _make_area(db_session, org, "Closed", active=False)
        with pytest.raises(ValueError, match="no longer active"):
            await service.set_frequency(closed, org, WEEKLY)

    async def test_another_organizations_area_is_not_found(self, db_session):
        org = await _make_org(db_session, "sched-org")
        other = await _make_org(db_session, "other-org")
        theirs = await _make_area(db_session, other, "Theirs")
        with pytest.raises(LookupError):
            await InventoryAuditScheduleService(db_session).set_frequency(
                theirs, org, WEEKLY
            )

    async def test_another_organizations_audit_does_not_count(self, db_session):
        org = await _make_org(db_session, "sched-org")
        other = await _make_org(db_session, "other-org")
        service = InventoryAuditScheduleService(db_session)
        area = await _make_area(db_session, org, "Bin")
        await service.set_frequency(area, org, WEEKLY)
        # A row claiming this area under another org's id.
        await _audit(db_session, other, area, NOW)
        rows = await service.list_schedule(org, now=NOW)
        assert rows[0]["last_audited_at"] is None


@pytest.fixture
async def overdue_org(db_session):
    org = await _make_org(db_session, "digest-org")
    await _enable_nfc(db_session, org)
    area = await _make_area(db_session, org, "<Shelf & Co>")
    await InventoryAuditScheduleService(db_session).set_frequency(area, org, WEEKLY)
    qm = await _make_user(db_session, org, "Quinn")
    await _grant(db_session, org, qm, ["inventory.manage"])
    member = await _make_user(db_session, org, "Morgan")
    await _grant(db_session, org, member, ["inventory.view"])
    return org


def _send_mock():
    return patch(
        "app.services.email_service.EmailService.send_email",
        new=AsyncMock(return_value=(1, [])),
    )


async def _digests(db, org_id):
    return list(
        (
            await db.execute(
                select(InventoryNfcAuditDigest).where(
                    InventoryNfcAuditDigest.organization_id == org_id
                )
            )
        )
        .scalars()
        .all()
    )


class TestDigest:
    async def test_sends_to_inventory_managers_only_with_names_escaped(
        self, db_session, overdue_org
    ):
        with _send_mock() as send:
            await run_inventory_audit_digest(db_session)
        rows = await db_session.execute(
            text("SELECT email FROM users WHERE organization_id = :o"),
            {"o": overdue_org},
        )
        emails = {r.email for r in rows}
        calls = [c for c in send.await_args_list if set(c.kwargs["to_emails"]) & emails]
        assert len(calls) == 1
        to = calls[0].kwargs["to_emails"]
        assert len(to) == 1
        assert to[0].startswith("Quinn")
        html = calls[0].kwargs["html_body"]
        assert "&lt;Shelf &amp; Co&gt;" in html
        assert "<Shelf & Co>" not in html
        assert "Never" in html
        digests = await _digests(db_session, overdue_org)
        assert [(d.overdue_count, d.recipient_count) for d in digests] == [(1, 1)]

    async def test_sends_at_most_once_a_week(self, db_session, overdue_org):
        with _send_mock():
            await run_inventory_audit_digest(db_session)
        with _send_mock() as send:
            await run_inventory_audit_digest(db_session)
        assert len(await _digests(db_session, overdue_org)) == 1
        rows = await db_session.execute(
            text("SELECT email FROM users WHERE organization_id = :o"),
            {"o": overdue_org},
        )
        emails = {r.email for r in rows}
        assert not [
            c for c in send.await_args_list if set(c.kwargs["to_emails"]) & emails
        ]

    async def test_sends_again_after_a_week(self, db_session, overdue_org):
        db_session.add(
            InventoryNfcAuditDigest(
                organization_id=overdue_org,
                sent_at=datetime.now(timezone.utc) - timedelta(days=8),
                overdue_count=1,
                recipient_count=1,
            )
        )
        await db_session.flush()
        with _send_mock():
            await run_inventory_audit_digest(db_session)
        assert len(await _digests(db_session, overdue_org)) == 2

    async def test_nothing_is_sent_with_nfc_off(self, db_session, overdue_org):
        await _enable_nfc(db_session, overdue_org, on=False)
        with _send_mock():
            await run_inventory_audit_digest(db_session)
        assert await _digests(db_session, overdue_org) == []

    async def test_nothing_is_sent_when_nothing_is_overdue(
        self, db_session, overdue_org
    ):
        area_id = (
            await db_session.execute(
                text("SELECT id FROM storage_areas WHERE organization_id = :o"),
                {"o": overdue_org},
            )
        ).scalar_one()
        await _audit(db_session, overdue_org, area_id, datetime.now(timezone.utc))
        with _send_mock():
            await run_inventory_audit_digest(db_session)
        assert await _digests(db_session, overdue_org) == []

    async def test_a_failed_send_is_retried_tomorrow(self, db_session, overdue_org):
        with patch(
            "app.services.email_service.EmailService.send_email",
            new=AsyncMock(return_value=(0, ["x"])),
        ):
            await run_inventory_audit_digest(db_session)
        assert await _digests(db_session, overdue_org) == []
