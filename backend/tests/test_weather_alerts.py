"""NWS weather alerts: polled, recorded once, and shown as the department chose.

Owner decisions 2026-10-29 (KNOWN_LIMITATIONS, "Integrations — Weather Alerts
and Generic Webhooks Do Nothing After Their Test"): poll every 15 minutes;
Severe and Extreme only; the department picks the banner, the bell and email.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from app.models.integration import Integration, WeatherAlert
from app.models.notification import NotificationLog
from app.models.user import Organization
from app.services import weather_alert_service as weather

pytestmark = [pytest.mark.integration]

SOON = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()


def _alert(
    nws_id, severity="Severe", status="Actual", expires=SOON, event="Tornado Warning"
):
    return {
        "id": nws_id,
        "event": event,
        "status": status,
        "severity": severity,
        "urgency": "Immediate",
        "headline": f"{event} issued for Falls Church",
        "description": "A tornado was observed.",
        "instruction": "Take shelter now.",
        "area_desc": "Falls Church, VA",
        "onset": None,
        "expires": expires,
    }


async def _scene(db, notify=None, enabled=True):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'FD', 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "slug": f"fd-{org_id[:8]}"},
    )
    members = []
    for first, prefs in (
        ("Avery", None),
        ("Blake", {"email_kinds": {"weather_alerts": False}}),
    ):
        uid = str(uuid.uuid4())
        await db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status, notification_preferences) "
                "VALUES (:id, :org, :un, :fn, 'Member', :em, 'x', 'active', :prefs)"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"{first.lower()}-{uid[:8]}",
                "fn": first,
                "em": f"{first.lower()}-{uid[:8]}@fd.test",
                "prefs": json.dumps(prefs) if prefs else None,
            },
        )
        members.append(uid)
    db.add(
        Integration(
            organization_id=org_id,
            integration_type="nws-weather",
            name="NWS Weather Alerts",
            category="Safety",
            status="connected",
            enabled=enabled,
            config={"zone_id": "VAZ054", **(notify or {})},
        )
    )
    await db.flush()
    org = await db.get(Organization, org_id)
    return org, members


async def _rows(db, org_id):
    return list(
        (
            await db.scalars(
                select(WeatherAlert).where(WeatherAlert.organization_id == org_id)
            )
        ).all()
    )


async def _bells(db, org_id):
    return list(
        (
            await db.scalars(
                select(NotificationLog).where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.category == "weather_alert",
                )
            )
        ).all()
    )


async def _poll(db, org, alerts):
    with patch(
        "app.services.integration_services.weather_service.fetch_active_alerts",
        AsyncMock(return_value=alerts),
    ):
        return await weather.poll_department(db, org)


class TestPolling:
    async def test_only_real_severe_and_extreme_alerts_are_kept(self, db_session):
        org, _ = await _scene(db_session)

        new = await _poll(
            db_session,
            org,
            [
                _alert("a-severe"),
                _alert("a-extreme", severity="Extreme"),
                _alert("a-moderate", severity="Moderate"),
                _alert("a-test", status="Test"),
                _alert("", severity="Extreme"),
            ],
        )

        assert new == 2
        assert sorted(r.nws_id for r in await _rows(db_session, org.id)) == [
            "a-extreme",
            "a-severe",
        ]

    async def test_a_second_poll_announces_nothing_again(self, db_session):
        org, members = await _scene(db_session)

        assert await _poll(db_session, org, [_alert("a-1")]) == 1
        assert await _poll(db_session, org, [_alert("a-1")]) == 0

        assert len(await _bells(db_session, org.id)) == len(members)

    async def test_a_cancelled_alert_ends_and_a_returning_one_reopens_quietly(
        self, db_session
    ):
        org, members = await _scene(db_session)
        await _poll(db_session, org, [_alert("a-1")])

        await _poll(db_session, org, [])
        (row,) = await _rows(db_session, org.id)
        assert row.ended_at is not None
        assert await weather.active_alerts(db_session, org.id) == []

        assert await _poll(db_session, org, [_alert("a-1")]) == 0
        await db_session.refresh(row)
        assert row.ended_at is None
        assert len(await _bells(db_session, org.id)) == len(members)

    async def test_an_expired_alert_is_not_active(self, db_session):
        org, _ = await _scene(db_session)
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        await _poll(db_session, org, [_alert("a-old", expires=past)])

        assert await weather.active_alerts(db_session, org.id) == []

    async def test_a_disabled_integration_is_not_polled(self, db_session):
        org, _ = await _scene(db_session, enabled=False)
        fetch = AsyncMock(return_value=[_alert("a-1")])

        with patch(
            "app.services.integration_services.weather_service.fetch_active_alerts",
            fetch,
        ):
            assert await weather.poll_department(db_session, org) == 0
        fetch.assert_not_awaited()

    async def test_a_failed_fetch_records_nothing(self, db_session):
        org, _ = await _scene(db_session)

        with patch(
            "app.services.integration_services.weather_service.fetch_active_alerts",
            AsyncMock(side_effect=RuntimeError("NWS down")),
        ):
            assert await weather.poll_department(db_session, org) == 0
        assert await _rows(db_session, org.id) == []


class TestChannels:
    async def test_bell_by_default_and_no_email(self, db_session):
        org, members = await _scene(db_session)
        send = AsyncMock(return_value=(1, 0))

        with patch("app.services.email_service.EmailService.send_email", send):
            await _poll(db_session, org, [_alert("a-1")])

        bells = await _bells(db_session, org.id)
        assert sorted(b.recipient_id for b in bells) == sorted(members)
        assert bells[0].subject == "Tornado Warning — Severe"
        send.assert_not_awaited()

    async def test_email_when_chosen_respecting_a_member_who_turned_it_off(
        self, db_session
    ):
        org, members = await _scene(
            db_session, {"notify_bell": False, "notify_email": True}
        )
        send = AsyncMock(return_value=(1, 0))

        with patch("app.services.email_service.EmailService.send_email", send):
            await _poll(db_session, org, [_alert("a-1")])

        assert await _bells(db_session, org.id) == []
        (call,) = send.await_args_list
        assert call.kwargs["to_emails"][0].startswith("avery-")
        assert "Take shelter now." in call.kwargs["html_body"]


class TestBannerEndpoint:
    async def _read(self, db, org):
        from app.api.v1.endpoints.integrations import list_active_weather_alerts

        return await list_active_weather_alerts(
            db=db, current_user=SimpleNamespace(organization_id=org.id)
        )

    async def test_lists_active_alerts_with_the_banner_on(self, db_session):
        org, _ = await _scene(db_session)
        await _poll(db_session, org, [_alert("a-1", severity="Extreme")])

        (alert,) = await self._read(db_session, org)
        assert (alert["event"], alert["severity"]) == ("Tornado Warning", "Extreme")

    async def test_empty_with_the_banner_off(self, db_session):
        org, _ = await _scene(db_session, {"notify_banner": False})
        await _poll(db_session, org, [_alert("a-1")])

        assert await self._read(db_session, org) == []
