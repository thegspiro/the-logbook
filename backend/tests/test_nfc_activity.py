"""Card taps by room and by event (the Card Readers page and the Events views).

What would fail quietly if it broke:

* **each view is behind its own area's grant** — room managers and tag writers
  for readers, event managers for events — not the card administrator's;
* **a room manager sees taps, not people** — names and card details are
  cleared unless the viewer also holds ``members.manage_id_cards``;
* **the counts are the room's reader's** — kiosk taps only, in the window,
  with refusals counted apart;
* **another department's rooms, events and taps are invisible**.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.nfc_activity import router
from app.core.database import get_db
from app.models.event import Event
from app.models.location import Location
from app.models.nfc_tag import (
    NfcCardTap,
    NfcCheckInStatus,
    NfcCheckInTarget,
    NfcTapSource,
)
from app.models.user import Organization, User
from app.services.nfc_card_admin_service import NfcCardAdminService

ORG = "org-1"


def _viewer(permissions):
    return SimpleNamespace(
        id="viewer-1",
        organization_id=ORG,
        username="viewer",
        full_name="Viewer",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _client(user):
    app = FastAPI()
    app.include_router(router, prefix="/nfc-activity")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _service(**methods):
    fake = SimpleNamespace(**{k: AsyncMock(return_value=v) for k, v in methods.items()})
    return fake, patch(
        "app.api.v1.endpoints.nfc_activity.NfcCardAdminService",
        MagicMock(return_value=fake),
    )


@pytest.mark.unit
class TestGates:
    @staticmethod
    def _permissions(path, method):
        for route in router.routes:
            if route.path == path and method in route.methods:
                return {
                    p
                    for d in route.dependant.dependencies
                    for p in (getattr(d.call, "required_permissions", None) or ())
                }
        pytest.fail(f"no route {method} {path}")

    def test_readers_are_for_room_managers_and_tag_writers(self):
        expected = {
            "locations.manage",
            "facilities.manage",
            "locations.manage_nfc_tags",
        }
        assert self._permissions("/readers", "GET") == expected
        assert self._permissions("/readers/{location_id}/taps", "GET") == expected

    def test_event_taps_are_for_event_managers(self):
        assert self._permissions("/event-taps", "GET") == {"events.manage"}

    async def test_a_card_admin_grant_alone_does_not_open_the_readers(self):
        async with _client(_viewer(["members.manage_id_cards"])) as client:
            response = await client.get("/nfc-activity/readers")
        assert response.status_code == 403


@pytest.mark.unit
class TestWhoIsShown:
    async def _room_taps(self, permissions):
        fake, patched = _service(
            get_location=SimpleNamespace(id="room-1"), list_taps=([], 0)
        )
        with patched:
            async with _client(_viewer(permissions)) as client:
                response = await client.get(
                    f"/nfc-activity/readers/{uuid.uuid4()}/taps"
                )
        assert response.status_code == 200, response.text
        return fake.list_taps.await_args.kwargs

    async def test_a_room_manager_gets_taps_without_identities(self):
        kwargs = await self._room_taps(["locations.manage"])
        assert kwargs["include_identity"] is False
        assert kwargs["source"] == NfcTapSource.KIOSK

    async def test_a_card_admin_who_manages_rooms_sees_names(self):
        kwargs = await self._room_taps(["locations.manage", "members.manage_id_cards"])
        assert kwargs["include_identity"] is True

    async def test_a_room_outside_the_organization_is_a_404(self):
        _fake, patched = _service(get_location=None, list_taps=([], 0))
        with patched:
            async with _client(_viewer(["locations.manage"])) as client:
                response = await client.get(
                    f"/nfc-activity/readers/{uuid.uuid4()}/taps"
                )
        assert response.status_code == 404

    async def test_the_reader_list_says_what_this_viewer_may_do(self):
        _fake, patched = _service(reader_summary=[])
        with patched, patch(
            "app.api.v1.endpoints.nfc_activity.nfc_id_cards_enabled",
            AsyncMock(return_value=True),
        ):
            async with _client(_viewer(["locations.manage"])) as client:
                body = (await client.get("/nfc-activity/readers")).json()
        assert body["canSwitch"] is False
        assert body["canSeeMembers"] is False
        assert body["cardsEnabled"] is True

    async def test_an_event_outside_the_organization_is_a_404(self):
        with patch(
            "app.api.v1.endpoints.nfc_activity.assert_in_org",
            AsyncMock(side_effect=ValueError("Event not found")),
        ):
            async with _client(_viewer(["events.manage"])) as client:
                response = await client.get(
                    "/nfc-activity/event-taps", params={"event_id": str(uuid.uuid4())}
                )
        assert response.status_code == 404


# =============================================================================
# Against the database
# =============================================================================


async def _org(db):
    org = Organization(
        id=str(uuid.uuid4()), name="Readers VFD", slug=f"rd-{uuid.uuid4().hex[:8]}"
    )
    db.add(org)
    await db.flush()
    return org


async def _room(db, org, name, enabled=True):
    room = Location(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        is_active=True,
        nfc_badge_check_in_enabled=enabled,
    )
    db.add(room)
    await db.flush()
    return room


async def _member(db, org):
    username = f"m{uuid.uuid4().hex[:8]}"
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=username,
        email=f"{username}@rd.test",
        first_name="Pat",
        last_name="Lee",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


def _tap(org, *, outcome, source=NfcTapSource.KIOSK, when, **extra):
    return NfcCardTap(
        organization_id=org.id, source=source, outcome=outcome, tapped_at=when, **extra
    )


@pytest.mark.integration
class TestReaderSummary:
    async def test_counts_are_this_rooms_kiosk_taps_in_the_window(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        hall = await _room(db_session, org, "Hall")
        quiet = await _room(db_session, org, "Quiet room", enabled=False)
        foreign = await _room(db_session, other, "Elsewhere")
        now = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)

        db_session.add_all(
            [
                _tap(
                    org,
                    outcome=NfcCheckInStatus.CHECKED_IN,
                    when=now - timedelta(hours=1),
                    location_id=hall.id,
                ),
                _tap(
                    org,
                    outcome=NfcCheckInStatus.ALREADY_CHECKED_IN,
                    when=now - timedelta(days=1),
                    location_id=hall.id,
                ),
                _tap(
                    org,
                    outcome=NfcCheckInStatus.UNKNOWN_CARD,
                    when=now - timedelta(days=2),
                    location_id=hall.id,
                ),
                # Outside the window: shows as the last tap only if nothing newer.
                _tap(
                    org,
                    outcome=NfcCheckInStatus.CHECKED_IN,
                    when=now - timedelta(days=30),
                    location_id=hall.id,
                ),
                # A station tap carries no room, so it never counts for a reader.
                _tap(
                    org,
                    outcome=NfcCheckInStatus.CHECKED_IN,
                    source=NfcTapSource.STATION,
                    when=now,
                    location_id=None,
                ),
                _tap(
                    other,
                    outcome=NfcCheckInStatus.CHECKED_IN,
                    when=now,
                    location_id=foreign.id,
                ),
            ]
        )
        await db_session.flush()

        rows = {
            r["location_id"]: r
            for r in await NfcCardAdminService(db_session).reader_summary(
                org.id, now=now
            )
        }

        assert set(rows) == {hall.id, quiet.id}
        assert rows[hall.id]["taps"] == 3
        assert rows[hall.id]["refusals"] == 1
        assert rows[hall.id]["reader_enabled"] is True
        assert rows[quiet.id]["taps"] == 0
        assert rows[quiet.id]["refusals"] == 0
        assert rows[quiet.id]["last_tap_at"] is None
        assert rows[quiet.id]["reader_enabled"] is False

    async def test_a_room_lookup_is_organization_scoped(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        foreign = await _room(db_session, other, "Elsewhere")
        service = NfcCardAdminService(db_session)
        assert await service.get_location(foreign.id, org.id) is None
        assert (await service.get_location(foreign.id, other.id)).id == foreign.id


@pytest.mark.integration
class TestScopedTapLists:
    async def test_room_and_event_filters_and_identity_stripping(self, db_session):
        org = await _org(db_session)
        hall = await _room(db_session, org, "Hall")
        member = await _member(db_session, org)
        event_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        db_session.add_all(
            [
                _tap(
                    org,
                    outcome=NfcCheckInStatus.CHECKED_IN,
                    when=now - timedelta(minutes=5),
                    location_id=hall.id,
                    user_id=member.id,
                    target_type=NfcCheckInTarget.EVENT,
                    target_id=event_id,
                    target_name="Drill",
                ),
                _tap(
                    org,
                    outcome=NfcCheckInStatus.CHECKED_IN,
                    source=NfcTapSource.STATION,
                    when=now - timedelta(minutes=3),
                    user_id=member.id,
                    target_type=NfcCheckInTarget.SHIFT,
                    target_id=str(uuid.uuid4()),
                ),
            ]
        )
        await db_session.flush()
        service = NfcCardAdminService(db_session)

        items, total = await service.list_taps(
            org.id, location_id=hall.id, include_identity=False
        )
        assert total == 1
        assert items[0]["member_name"] is None
        assert items[0]["user_id"] is None
        assert items[0]["target_name"] == "Drill"

        items, total = await service.list_taps(
            org.id, target_type=NfcCheckInTarget.EVENT, target_id=event_id
        )
        assert total == 1
        assert items[0]["member_name"]

        _items, total = await service.list_taps(
            org.id, target_type=NfcCheckInTarget.EVENT
        )
        assert total == 1

    async def test_assert_in_org_refuses_another_departments_event(self, db_session):
        from app.utils.org_scoping import assert_in_org

        org, other = await _org(db_session), await _org(db_session)
        event = Event(
            id=str(uuid.uuid4()),
            organization_id=other.id,
            title="Their drill",
            event_type="training",
            start_datetime=datetime.now(timezone.utc),
            end_datetime=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db_session.add(event)
        await db_session.flush()
        with pytest.raises(ValueError, match="Event"):
            await assert_in_org(db_session, Event, event.id, org.id, label="Event")
