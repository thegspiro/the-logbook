"""Tests for org-configurable records retention (ISO 15489 / 27701)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models.email_template import MessageHistory
from app.models.user import Organization
from app.services.retention_service import RECORD_CLASSES, RetentionService

pytestmark = pytest.mark.integration


async def _make_org(db, retention: dict | None = None):
    org = Organization(name="Retention FD", slug=f"ret-{uuid.uuid4().hex[:8]}")
    if retention is not None:
        org.settings = {"retention": retention}
    db.add(org)
    await db.flush()
    return org


async def _make_message(db, org, age_days: int):
    row = MessageHistory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        to_email="member@example.org",
        subject="Test message",
        sent_at=datetime.now(UTC) - timedelta(days=age_days),
    )
    db.add(row)
    await db.flush()
    return row


async def _count_messages(db, org) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(MessageHistory)
            .where(MessageHistory.organization_id == org.id)
        )
    ).scalar()


class TestRetentionPolicy:
    async def test_defaults_reported_when_unconfigured(self, db_session):
        org = await _make_org(db_session)
        policy = RetentionService(db_session).get_policy(org)

        assert {p["record_class"] for p in policy} == {rc.key for rc in RECORD_CLASSES}
        message = next(p for p in policy if p["record_class"] == "message_history")
        assert message["effective_days"] == 90  # original hardcoded behavior
        assert message["is_configured"] is False
        forms = next(p for p in policy if p["record_class"] == "form_submissions")
        assert forms["effective_days"] is None  # keep forever until opt-in

    async def test_set_policy_respects_floor(self, db_session):
        org = await _make_org(db_session)
        service = RetentionService(db_session)

        with pytest.raises(ValueError, match="cannot be below"):
            await service.set_policy(org, "form_submissions", 7)
        with pytest.raises(ValueError, match="Unknown record class"):
            await service.set_policy(org, "meeting_minutes", 365)

        await service.set_policy(org, "message_history", 180)
        policy = service.get_policy(org)
        message = next(p for p in policy if p["record_class"] == "message_history")
        assert message["configured_days"] == 180
        assert message["is_configured"] is True

    async def test_set_policy_survives_json_column_write(self, db_session):
        # Pitfall #12 regression guard: the nested settings write must be
        # visible after expiring the ORM state (i.e. actually persisted).
        org = await _make_org(db_session)
        await RetentionService(db_session).set_policy(org, "message_history", 365)
        await db_session.flush()
        await db_session.refresh(org)
        assert org.settings["retention"]["message_history"] == 365


class TestRetentionEnforcement:
    async def test_default_deletes_only_expired_rows(self, db_session):
        org = await _make_org(db_session)
        await _make_message(db_session, org, age_days=120)  # past default 90
        await _make_message(db_session, org, age_days=10)

        result = await RetentionService(db_session).enforce()

        assert await _count_messages(db_session, org) == 1
        assert result["deleted"][f"{org.id}:message_history"] == 1

    async def test_org_config_overrides_default(self, db_session):
        org = await _make_org(db_session, retention={"message_history": 365})
        await _make_message(db_session, org, age_days=120)  # inside 365

        await RetentionService(db_session).enforce()

        assert await _count_messages(db_session, org) == 1

    async def test_null_config_keeps_forever(self, db_session):
        org = await _make_org(db_session, retention={"message_history": None})
        await _make_message(db_session, org, age_days=5000)

        await RetentionService(db_session).enforce()

        assert await _count_messages(db_session, org) == 1

    async def test_enforcement_is_org_scoped(self, db_session):
        org_short = await _make_org(db_session, retention={"message_history": 30})
        org_long = await _make_org(db_session, retention={"message_history": 365})
        await _make_message(db_session, org_short, age_days=60)
        await _make_message(db_session, org_long, age_days=60)

        await RetentionService(db_session).enforce()

        assert await _count_messages(db_session, org_short) == 0
        assert await _count_messages(db_session, org_long) == 1

    async def test_floor_applies_at_enforcement_time(self, db_session):
        # Settings edited outside the API (raw SQL, old data) cannot bypass
        # the class floor.
        org = await _make_org(db_session, retention={"message_history": 1})
        await _make_message(db_session, org, age_days=10)  # under the 30 floor

        await RetentionService(db_session).enforce()

        assert await _count_messages(db_session, org) == 1

    async def test_only_class_restricts_scope(self, db_session):
        org = await _make_org(db_session)
        await _make_message(db_session, org, age_days=120)

        result = await RetentionService(db_session).enforce(
            only_class="notification_logs"
        )

        assert await _count_messages(db_session, org) == 1
        assert result["deleted"] == {}
