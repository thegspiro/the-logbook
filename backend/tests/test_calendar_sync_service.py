"""The calendar reconciler (app.services.calendar_sync_service).

Every provider call goes to an in-memory fake implementing
CalendarSyncInterface, so no test touches the network. The rows are real:
events, mappings and integrations live in the test database.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import select, text

from app.models.event import Event, EventType
from app.models.integration import (
    CALENDAR_SYNC_FAILED,
    CALENDAR_SYNC_PENDING_DELETE,
    CALENDAR_SYNC_SYNCED,
    CalendarSyncMapping,
    Integration,
    IntegrationSyncLog,
)
from app.services import calendar_sync_service as svc
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarError,
    CalendarNotFound,
    CalendarRateLimited,
    CalendarTokens,
    CalendarTransient,
    google_event_id,
)
from app.services.integration_services.calendar_interface import CalendarSyncInterface

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
CALENDAR = "cal-1"


class FakeCalendar(CalendarSyncInterface):
    """Records calls; ``errors`` maps an event id (push) or an external id
    (delete) to exceptions raised on successive calls, one per call."""

    def __init__(self) -> None:
        self.events: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str]] = []
        self.errors: dict[str, list[Exception]] = {}
        self.tokens: CalendarTokens | None = None
        self.rotate_on_first_call: CalendarTokens | None = None

    def _maybe_fail(self, key: str) -> None:
        if self.rotate_on_first_call is not None:
            self.tokens, self.rotate_on_first_call = self.rotate_on_first_call, None
        queue = self.errors.get(key)
        if queue:
            raise queue.pop(0)

    async def refresh_tokens(self) -> CalendarTokens:  # pragma: no cover
        raise NotImplementedError

    async def create_calendar(self, name: str) -> str:  # pragma: no cover
        raise NotImplementedError

    async def upsert_event(
        self, calendar_id: str, external_id: str | None, payload: dict[str, Any]
    ) -> str:
        self.calls.append(("upsert", payload["event_id"]))
        self._maybe_fail(payload["event_id"])
        ext = external_id or f"ext-{payload['event_id']}"
        self.events[ext] = payload
        return ext

    async def update_event(
        self, calendar_id: str, external_id: str, payload: dict[str, Any]
    ) -> None:  # pragma: no cover
        raise NotImplementedError

    async def delete_event(self, calendar_id: str, external_id: str) -> None:
        self.calls.append(("delete", external_id))
        self._maybe_fail(external_id)
        self.events.pop(external_id, None)

    async def test_connection(self) -> str:  # pragma: no cover
        return "ok"


async def _org(db, tz: str = "America/Chicago") -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Cal Dept', 'fire_department', :slug, :tz)"
        ),
        {"id": org_id, "slug": f"cal-{org_id[:8]}", "tz": tz},
    )
    return org_id


async def _integration(
    db, org_id: str, itype: str = "outlook", **config: Any
) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type=itype,
        name=itype,
        category="Calendar",
        status="connected",
        enabled=True,
        config={"calendar_id": CALENDAR, **config},
    )
    row.set_secret("refresh_token", "refresh-1")
    db.add(row)
    await db.flush()
    return row


async def _event(
    db,
    org_id: str,
    *,
    start: datetime | None = None,
    hours: int = 2,
    title: str = "Drill",
    event_type: EventType = EventType.TRAINING,
    **kw: Any,
) -> Event:
    start = start or NOW + timedelta(days=3)
    row = Event(
        organization_id=org_id,
        title=title,
        event_type=event_type,
        start_datetime=start.replace(tzinfo=None),
        end_datetime=(start + timedelta(hours=hours)).replace(tzinfo=None),
        is_draft=kw.pop("is_draft", False),
        is_cancelled=kw.pop("is_cancelled", False),
        **kw,
    )
    db.add(row)
    await db.flush()
    return row


async def _mappings(db, integration: Integration) -> dict[str, CalendarSyncMapping]:
    rows = (
        (
            await db.execute(
                select(CalendarSyncMapping).where(
                    CalendarSyncMapping.integration_id == integration.id
                )
            )
        )
        .scalars()
        .all()
    )
    return {r.event_id: r for r in rows}


async def _sync(db, integration: Integration, fake: FakeCalendar, now=NOW):
    with patch.object(svc, "_utcnow", return_value=now):
        return await svc.reconcile_integration(
            db, integration, service_factory=lambda _i: fake
        )


@pytest.mark.integration
class TestReconcile:
    async def test_creates_then_leaves_unchanged_events_alone(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        a = await _event(db_session, org, title="Drill")
        b = await _event(db_session, org, title="Meeting", start=NOW + timedelta(1))
        fake = FakeCalendar()

        counts = await _sync(db_session, integ, fake)
        assert counts["created"] == 2
        maps = await _mappings(db_session, integ)
        assert set(maps) == {a.id, b.id}
        assert all(m.status == CALENDAR_SYNC_SYNCED for m in maps.values())
        assert maps[a.id].external_event_id == f"ext-{a.id}"
        assert maps[a.id].external_calendar_id == CALENDAR
        # Soonest first.
        assert [c[1] for c in fake.calls] == [b.id, a.id]
        sent = fake.events[f"ext-{a.id}"]
        assert sent["title"] == "Drill"
        assert sent["time_zone"] == "America/Chicago"
        assert sent["description"] is None
        assert sent["url"].endswith(f"/events/{a.id}")

        fake.calls.clear()
        counts = await _sync(db_session, integ, fake)
        assert counts["unchanged"] == 2
        assert counts["created"] == 0
        assert fake.calls == []

    async def test_a_changed_event_is_updated(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)
        first_hash = (await _mappings(db_session, integ))[ev.id].content_hash

        ev.title = "Drill (moved)"
        await db_session.flush()
        fake.calls.clear()
        counts = await _sync(db_session, integ, fake)

        assert counts["updated"] == 1
        assert fake.calls == [("upsert", ev.id)]
        mapping = (await _mappings(db_session, integ))[ev.id]
        assert mapping.content_hash != first_hash
        assert fake.events[f"ext-{ev.id}"]["title"] == "Drill (moved)"

    async def test_descriptions_only_when_the_integration_opts_in(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org, sync_descriptions=True)
        ev = await _event(db_session, org, description="Bring SCBA")
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)
        assert fake.events[f"ext-{ev.id}"]["description"] == "Bring SCBA"

    async def test_a_deleted_event_is_removed_from_the_calendar(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)

        await db_session.delete(ev)
        await db_session.flush()
        counts = await _sync(db_session, integ, fake)

        assert counts["deleted"] == 1
        assert ("delete", f"ext-{ev.id}") in fake.calls
        assert await _mappings(db_session, integ) == {}

    async def test_a_404_on_delete_counts_as_deleted(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)
        fake.errors[f"ext-{ev.id}"] = [CalendarNotFound("gone")]

        ev.is_cancelled = True
        await db_session.flush()
        counts = await _sync(db_session, integ, fake)

        assert counts["deleted"] == 1
        assert counts["failed"] == 0
        assert await _mappings(db_session, integ) == {}

    async def test_cancelled_events_are_deleted_and_drafts_never_sent(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        live = await _event(db_session, org, title="Live")
        draft = await _event(db_session, org, title="Draft", is_draft=True)
        never = await _event(db_session, org, title="Off", is_cancelled=True)
        fake = FakeCalendar()

        await _sync(db_session, integ, fake)
        assert set(await _mappings(db_session, integ)) == {live.id}
        assert {c[1] for c in fake.calls} == {live.id}

        live.is_cancelled = True
        await db_session.flush()
        await _sync(db_session, integ, fake)
        assert await _mappings(db_session, integ) == {}
        assert fake.events == {}
        assert draft.id not in fake.events
        assert never.id not in fake.events

    async def test_an_event_returned_to_draft_is_deleted(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)

        ev.is_draft = True
        await db_session.flush()
        counts = await _sync(db_session, integ, fake)
        assert counts["deleted"] == 1
        assert fake.events == {}

    async def test_event_type_filter(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        training = await _event(db_session, org, event_type=EventType.TRAINING)
        social = await _event(db_session, org, event_type=EventType.SOCIAL)
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)
        assert set(await _mappings(db_session, integ)) == {training.id, social.id}

        integ.config = {**integ.config, "event_types_to_sync": ["training"]}
        await db_session.flush()
        counts = await _sync(db_session, integ, fake)

        assert counts["deleted"] == 1
        assert set(await _mappings(db_session, integ)) == {training.id}
        assert ("delete", f"ext-{social.id}") in fake.calls

    async def test_window_and_days_ahead(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        old = await _event(db_session, org, start=NOW - timedelta(days=40))
        recent = await _event(db_session, org, start=NOW - timedelta(days=10))
        far = await _event(db_session, org, start=NOW + timedelta(days=200))
        fake = FakeCalendar()

        await _sync(db_session, integ, fake)
        assert set(await _mappings(db_session, integ)) == {recent.id}

        integ.config = {**integ.config, "days_ahead": 365}
        await db_session.flush()
        await _sync(db_session, integ, fake)
        assert set(await _mappings(db_session, integ)) == {recent.id, far.id}
        assert old.id not in {c[1] for c in fake.calls}

    async def test_an_event_ageing_out_is_forgotten_not_deleted(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org, start=NOW - timedelta(days=20))
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)
        fake.calls.clear()

        counts = await _sync(db_session, integ, fake, now=NOW + timedelta(days=15))

        assert counts["forgotten"] == 1
        assert fake.calls == []
        assert f"ext-{ev.id}" in fake.events
        assert await _mappings(db_session, integ) == {}

    async def test_location_name_and_custom_category_label(self, db_session):
        org = await _org(db_session)
        await db_session.execute(
            text(
                "UPDATE organizations SET settings = :s WHERE id = :id",
            ),
            {
                "id": org,
                "s": '{"events": {"custom_event_categories": '
                '[{"value": "pr", "label": "Public Relations", "color": "x"}]}}',
            },
        )
        loc_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO locations (id, organization_id, name) "
                "VALUES (:id, :org, 'Station 1')"
            ),
            {"id": loc_id, "org": org},
        )
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org, location_id=loc_id, custom_category="pr")
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)

        sent = fake.events[f"ext-{ev.id}"]
        assert sent["location"] == "Station 1"
        assert sent["event_type"] == "Public Relations"


@pytest.mark.integration
class TestFailures:
    async def test_backoff_progression_then_failed(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        fake.errors[ev.id] = [CalendarError("Outlook refused the request (400)")] * 7

        now = NOW
        waits = []
        for _ in range(6):
            counts = await _sync(db_session, integ, fake, now=now)
            assert counts["failed"] == 1
            mapping = (await _mappings(db_session, integ))[ev.id]
            if mapping.next_attempt_at is None:
                break
            due = svc._aware(mapping.next_attempt_at)
            waits.append(round((due - now).total_seconds() / 60))
            # Not due yet: a pass in between does nothing.
            fake.calls.clear()
            counts = await _sync(db_session, integ, fake, now=due - timedelta(1 / 1440))
            assert fake.calls == []
            assert counts["waiting"] == 1
            now = due

        assert waits == [5, 10, 20, 40, 80]
        assert mapping.status == CALENDAR_SYNC_FAILED
        assert mapping.attempt_count == 6
        assert mapping.last_error == "Outlook refused the request (400)"

        # Spent: left alone until the event changes.
        fake.calls.clear()
        await _sync(db_session, integ, fake, now=now + timedelta(days=1))
        assert fake.calls == []

        ev.title = "Drill (fixed)"
        await db_session.flush()
        fake.errors.clear()
        counts = await _sync(db_session, integ, fake, now=now + timedelta(days=1))
        assert counts["created"] == 1
        mapping = (await _mappings(db_session, integ))[ev.id]
        assert mapping.status == CALENDAR_SYNC_SYNCED
        assert mapping.attempt_count == 0
        assert mapping.last_error is None

    async def test_a_failed_delete_backs_off_as_pending_delete(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        await _sync(db_session, integ, fake)
        fake.errors[f"ext-{ev.id}"] = [CalendarError("Outlook refused (400)")]

        await db_session.delete(ev)
        await db_session.flush()
        await _sync(db_session, integ, fake)
        mapping = (await _mappings(db_session, integ))[ev.id]
        assert mapping.status == CALENDAR_SYNC_PENDING_DELETE
        assert mapping.attempt_count == 1

        await _sync(db_session, integ, fake, now=NOW + timedelta(minutes=6))
        assert await _mappings(db_session, integ) == {}

    async def test_rate_limit_stops_the_pass_and_pauses(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        first = await _event(db_session, org, start=NOW + timedelta(days=1))
        await _event(db_session, org, start=NOW + timedelta(days=2))
        fake = FakeCalendar()
        fake.errors[first.id] = [
            CalendarRateLimited("Outlook is rate limiting requests", retry_after=600)
        ]

        counts = await _sync(db_session, integ, fake)

        assert len(fake.calls) == 1
        assert counts["created"] == 0
        paused = svc._parse_iso(integ.config[svc.PAUSED_UNTIL_KEY])
        assert paused == NOW + timedelta(seconds=600)
        log = (
            await db_session.execute(
                select(IntegrationSyncLog).where(
                    IntegrationSyncLog.integration_id == integ.id
                )
            )
        ).scalar_one()
        assert log.status == "failure"
        assert "rate limit" in (log.error_message or "")

        fake.calls.clear()
        assert await _sync(db_session, integ, fake, NOW + timedelta(minutes=5)) == {
            "paused": 1
        }
        assert fake.calls == []

        counts = await _sync(db_session, integ, fake, NOW + timedelta(minutes=11))
        assert counts["created"] == 2
        assert svc.PAUSED_UNTIL_KEY not in integ.config
        # The rate limit did not spend a retry.
        assert (await _mappings(db_session, integ))[first.id].attempt_count == 0

    async def test_transient_error_stops_the_pass_with_backoff(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        first = await _event(db_session, org, start=NOW + timedelta(days=1))
        await _event(db_session, org, start=NOW + timedelta(days=2))
        fake = FakeCalendar()
        fake.errors[first.id] = [CalendarTransient("Outlook returned a server error")]

        await _sync(db_session, integ, fake)

        assert len(fake.calls) == 1
        mapping = (await _mappings(db_session, integ))[first.id]
        assert mapping.attempt_count == 1
        assert svc._aware(mapping.next_attempt_at) == NOW + timedelta(minutes=5)

    async def test_auth_revoked_marks_reconnect_required(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        first = await _event(db_session, org, start=NOW + timedelta(days=1))
        await _event(db_session, org, start=NOW + timedelta(days=2))
        fake = FakeCalendar()
        fake.errors[first.id] = [CalendarAuthRevoked("revoked")]

        await _sync(db_session, integ, fake)

        assert len(fake.calls) == 1
        assert integ.status == "error"
        assert integ.last_error.startswith("Reconnect required")
        assert integ.consecutive_error_count == 1
        # No longer connected: a later pass does not call the provider.
        fake.calls.clear()
        assert await _sync(db_session, integ, fake) == {"skipped": 1}
        assert fake.calls == []

    async def test_rotated_tokens_are_persisted(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        integ.set_secret("token", "stale-access")
        await _event(db_session, org)
        expires = NOW + timedelta(hours=1)
        fake = FakeCalendar()
        fake.rotate_on_first_call = CalendarTokens(
            access_token="access-2",
            refresh_token="refresh-2",
            expires_at=expires,
            rotated=True,
        )

        await _sync(db_session, integ, fake)

        assert integ.get_secret("access_token") == "access-2"
        assert integ.get_secret("refresh_token") == "refresh-2"
        assert integ.get_secret("token") is None
        assert integ.config["token_expires_at"] == expires.isoformat()

    async def test_tokens_are_persisted_even_when_the_pass_stops(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        fake.rotate_on_first_call = CalendarTokens(
            access_token="access-3",
            refresh_token="refresh-3",
            expires_at=None,
            rotated=True,
        )
        fake.errors[ev.id] = [CalendarRateLimited("slow down")]

        await _sync(db_session, integ, fake)
        assert integ.get_secret("refresh_token") == "refresh-3"

    async def test_op_cap_defers_the_rest_to_the_next_pass(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        for day in range(1, 6):
            await _event(db_session, org, start=NOW + timedelta(days=day))
        fake = FakeCalendar()

        with patch.object(svc, "MAX_OPS_PER_PASS", 3):
            counts = await _sync(db_session, integ, fake)
            assert counts["created"] == 3
            assert counts["deferred"] == 2
            counts = await _sync(db_session, integ, fake)
            assert counts["created"] == 2
            assert counts["unchanged"] == 3
        assert len(await _mappings(db_session, integ)) == 5

    async def test_other_organizations_are_untouched(self, db_session):
        org_a = await _org(db_session)
        org_b = await _org(db_session)
        integ_a = await _integration(db_session, org_a)
        integ_b = await _integration(db_session, org_b)
        mine = await _event(db_session, org_a)
        theirs = await _event(db_session, org_b)
        fake_b = FakeCalendar()
        await _sync(db_session, integ_b, fake_b)
        before = {
            k: (m.status, m.content_hash)
            for k, m in (await _mappings(db_session, integ_b)).items()
        }

        fake_a = FakeCalendar()
        await _sync(db_session, integ_a, fake_a)

        assert {c[1] for c in fake_a.calls} == {mine.id}
        assert set(await _mappings(db_session, integ_a)) == {mine.id}
        after = {
            k: (m.status, m.content_hash)
            for k, m in (await _mappings(db_session, integ_b)).items()
        }
        assert after == before
        assert set(after) == {theirs.id}

    async def test_google_records_its_deterministic_id_before_the_insert(
        self, db_session
    ):
        org = await _org(db_session)
        integ = await _integration(db_session, org, itype="google-calendar")
        ev = await _event(db_session, org)
        fake = FakeCalendar()
        fake.errors[ev.id] = [CalendarError("Google Calendar refused (400)")]

        await _sync(db_session, integ, fake)

        mapping = (await _mappings(db_session, integ))[ev.id]
        assert mapping.external_event_id == google_event_id(ev.id)
        assert mapping.status == CALENDAR_SYNC_FAILED

    async def test_without_calendar_or_tokens_nothing_happens(self, db_session):
        org = await _org(db_session)
        integ = await _integration(db_session, org)
        await _event(db_session, org)
        integ.config = {}
        fake = FakeCalendar()
        assert await _sync(db_session, integ, fake) == {"skipped": 1}

        integ.config = {"calendar_id": CALENDAR}
        integ.clear_secret("refresh_token")
        assert await _sync(db_session, integ, fake) == {"skipped": 1}
        assert fake.calls == []


@pytest.mark.integration
class TestScheduledTask:
    async def test_flag_off_is_a_no_op(self, db_session):
        from app.services.scheduled_tasks import run_calendar_sync

        org = await _org(db_session)
        await _integration(db_session, org)
        await _event(db_session, org)
        called = []
        with (
            patch("app.core.config.settings.CALENDAR_SYNC_ENABLED", False),
            patch.object(svc, "default_service_factory", lambda i: called.append(i)),
        ):
            result = await run_calendar_sync(db_session)

        assert result["task"] == "calendar_sync"
        assert "skipped" in result
        assert called == []

    async def test_flag_on_isolates_each_integration(self, db_session):
        from app.services.scheduled_tasks import run_calendar_sync

        org = await _org(db_session)
        google = await _integration(db_session, org, itype="google-calendar")
        outlook = await _integration(db_session, org, itype="outlook")
        ev = await _event(db_session, org)
        # The task rolls back a failed integration; commit (a savepoint
        # release here) so that does not take the fixtures with it.
        await db_session.commit()
        google_id, outlook_id, event_id = google.id, outlook.id, ev.id
        fake = FakeCalendar()

        def factory(integration):
            if integration.id == google_id:
                raise RuntimeError("boom")
            return fake

        with (
            patch("app.core.config.settings.CALENDAR_SYNC_ENABLED", True),
            patch.object(svc, "default_service_factory", factory),
            patch.object(svc, "_utcnow", return_value=NOW),
        ):
            result = await run_calendar_sync(db_session)

        assert result["failed"] >= 1
        assert result["reconciled"] >= 1
        mapped = (
            await db_session.execute(
                select(CalendarSyncMapping.event_id).where(
                    CalendarSyncMapping.integration_id == outlook_id
                )
            )
        ).scalars()
        assert set(mapped) == {event_id}
        errors = await db_session.scalar(
            select(Integration.consecutive_error_count).where(
                Integration.id == google_id
            )
        )
        assert errors == 1
