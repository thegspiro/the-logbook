"""The Member ID Cards admin page's backend.

Four things, each of which fails quietly when it breaks:

* **every tap is logged**, refusals included — the refusal is the event an
  officer is asked about, and an unknown card is kept only as its hash;
* **a leaver's cards are suspended, and only those come back** — an officer's
  own suspension, and a lost card, must survive the member returning;
* **coverage, the tap log and bulk changes stay inside the organization**;
* **the retention setting degrades rather than raises**, because it is read
  inside a nightly purge.
"""

import ast
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.api.v1.endpoints.nfc_tags import router
from app.models.nfc_tag import (
    NfcCardTap,
    NfcCheckInStatus,
    NfcCheckInTarget,
    NfcTag,
    NfcTagStatus,
    NfcTapSource,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.nfc_tag import NfcIdCardSettingsUpdate, NfcTagBulkStatusRequest
from app.services.nfc_card_admin_service import (
    DEFAULT_TAP_RETENTION_MONTHS,
    NfcCardAdminService,
    tap_retention_months_in,
)
from app.services.nfc_card_status_sync import (
    AUTO_SUSPEND_REASON,
    BLOCKED_MEMBER_STATUSES,
    sync_cards_with_member_status,
)
from app.services.nfc_tag_service import NfcTagService, hash_tag_uid

ORG = "org-1"
BACKEND = Path(__file__).resolve().parent.parent


def _db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _added_tap(db) -> NfcCardTap:
    taps = [
        c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], NfcCardTap)
    ]
    assert len(taps) == 1, f"expected one tap row, got {len(taps)}"
    return taps[0]


def _tag(status=NfcTagStatus.ACTIVE, auto_suspended=False):
    return SimpleNamespace(
        id="tag-1",
        organization_id=ORG,
        user_id="u-1",
        status=status,
        auto_suspended=auto_suspended,
        last_used_at=None,
        revoked_at=None,
        revoked_reason=None,
        issued_by=None,
    )


def _member():
    return SimpleNamespace(
        id="u-1",
        display_name="Dana Ruiz",
        membership_number="1042",
        status=UserStatus.ACTIVE,
        deleted_at=None,
    )


# =============================================================================
# Tap recording
# =============================================================================


@pytest.mark.unit
class TestEveryTapIsRecorded:
    async def _check_in(self, service, **kwargs):
        return await service.check_in(
            organization_id=ORG,
            tag_uid="04A2245B",
            target_type=NfcCheckInTarget.SHIFT,
            target_id="shift-1",
            **kwargs,
        )

    async def test_an_unknown_card_is_kept_only_as_its_hash(self):
        db = _db()
        service = NfcTagService(db)
        service.resolve_tag = AsyncMock(
            return_value=(None, None, NfcCheckInStatus.UNKNOWN_CARD)
        )

        result = await self._check_in(service, operator_id="op-1")

        assert result["status"] == NfcCheckInStatus.UNKNOWN_CARD
        tap = _added_tap(db)
        assert tap.outcome == NfcCheckInStatus.UNKNOWN_CARD
        assert tap.tag_id is None
        assert tap.user_id is None
        assert tap.unknown_uid_hash == hash_tag_uid("04:a2:24:5b")
        assert "04A2245B" not in repr(vars(tap))
        assert tap.source == NfcTapSource.STATION
        assert tap.operator_id == "op-1"
        assert tap.target_type == NfcCheckInTarget.SHIFT
        assert tap.target_id == "shift-1"

    async def test_a_refused_card_is_logged_against_its_holder(self):
        """resolve_tag returns no member for an inactive card; the log still
        names whose card it was, which is the question an officer is asked."""
        db = _db()
        service = NfcTagService(db)
        service.resolve_tag = AsyncMock(
            return_value=(
                _tag(NfcTagStatus.SUSPENDED),
                None,
                NfcCheckInStatus.CARD_INACTIVE,
            )
        )

        await self._check_in(service)

        tap = _added_tap(db)
        assert tap.outcome == NfcCheckInStatus.CARD_INACTIVE
        assert tap.tag_id == "tag-1"
        assert tap.user_id == "u-1"
        assert tap.unknown_uid_hash is None

    async def test_a_check_in_is_logged_with_what_it_checked_into(self):
        db = _db()
        service = NfcTagService(db)
        tag = _tag()
        service.resolve_tag = AsyncMock(return_value=(tag, _member(), None))
        service._check_in_shift = AsyncMock(
            return_value={
                "status": NfcCheckInStatus.CHECKED_IN,
                "message": "ok",
                "target_name": "A Shift",
            }
        )

        await self._check_in(service, source=NfcTapSource.KIOSK, location_id="room-1")

        tap = _added_tap(db)
        assert tap.outcome == NfcCheckInStatus.CHECKED_IN
        assert tap.target_name == "A Shift"
        assert tap.source == NfcTapSource.KIOSK
        assert tap.location_id == "room-1"
        assert tag.last_used_at is not None

    async def test_a_missing_target_raises_and_logs_nothing(self):
        db = _db()
        service = NfcTagService(db)
        service.resolve_tag = AsyncMock(return_value=(_tag(), _member(), None))
        service._check_in_shift = AsyncMock(side_effect=ValueError("Shift not found"))

        with pytest.raises(ValueError, match="Shift not found"):
            await self._check_in(service)
        db.add.assert_not_called()


@pytest.mark.unit
class TestOfficerTakesBackAnAutoSuspendedCard:
    def _service(self, tag):
        db = _db()
        service = NfcTagService(db)
        service.get_tag = AsyncMock(return_value=tag)
        service._name_map = AsyncMock(return_value={})
        service._to_dict = MagicMock(return_value={})
        return service

    async def test_an_officer_status_change_clears_the_flag(self):
        tag = _tag(NfcTagStatus.SUSPENDED, auto_suspended=True)
        await self._service(tag).update_tag(
            "tag-1", ORG, {"status": NfcTagStatus.ACTIVE}
        )
        assert tag.auto_suspended is False

    async def test_a_relabel_leaves_the_flag_alone(self):
        tag = _tag(NfcTagStatus.SUSPENDED, auto_suspended=True)
        tag.label = None
        await self._service(tag).update_tag("tag-1", ORG, {"label": "Blue card"})
        assert tag.auto_suspended is True

    async def test_the_flag_cannot_be_set_through_an_update(self):
        tag = _tag(NfcTagStatus.SUSPENDED, auto_suspended=False)
        await self._service(tag).update_tag("tag-1", ORG, {"auto_suspended": True})
        assert tag.auto_suspended is False


@pytest.mark.unit
class TestEveryStatusChangeSyncsCards:
    """Each place a member's status is written must also move their cards.

    A new status path that forgets the sync leaves cards reading Active for a
    member who has left — this walks the source so that cannot ship unseen.
    """

    FILES = (
        "app/api/v1/endpoints/member_status.py",
        "app/services/member_archive_service.py",
    )

    @staticmethod
    def _assigns_member_status(node: ast.AST) -> bool:
        for child in ast.walk(node):
            if isinstance(child, ast.Assign):
                for target in child.targets:
                    if (
                        isinstance(target, ast.Attribute)
                        and target.attr == "status"
                        and isinstance(target.value, ast.Name)
                        and target.value.id == "member"
                    ):
                        return True
        return False

    @staticmethod
    def _calls_sync(node: ast.AST) -> bool:
        return any(
            isinstance(child, ast.Call)
            and getattr(child.func, "id", None) == "sync_cards_with_member_status"
            for child in ast.walk(node)
        )

    def test_every_function_that_sets_a_status_syncs_cards(self):
        missing = []
        found = 0
        for rel in self.FILES:
            tree = ast.parse((BACKEND / rel).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef):
                    if self._assigns_member_status(node):
                        found += 1
                        if not self._calls_sync(node):
                            missing.append(f"{rel}:{node.name}")
        assert found >= 5, "status-setting functions were not found; update the sweep"
        assert not missing, "status set without syncing cards: " + ", ".join(missing)


@pytest.mark.unit
class TestRetentionSetting:
    @pytest.mark.parametrize(
        "settings",
        [
            None,
            {},
            {"nfc_id_cards": "24"},
            {"nfc_id_cards": {"tap_retention_months": "24"}},
            {"nfc_id_cards": {"tap_retention_months": True}},
            {"nfc_id_cards": {"tap_retention_months": 2}},
            {"nfc_id_cards": {"tap_retention_months": 85}},
        ],
    )
    def test_an_unusable_value_reads_as_the_default(self, settings):
        assert tap_retention_months_in(settings) == DEFAULT_TAP_RETENTION_MONTHS

    def test_a_stored_value_is_used(self):
        assert (
            tap_retention_months_in({"nfc_id_cards": {"tap_retention_months": 6}}) == 6
        )

    def test_the_api_refuses_out_of_range_values(self):
        with pytest.raises(ValidationError, match="greater than or equal to 3"):
            NfcIdCardSettingsUpdate(tap_retention_months=2)
        with pytest.raises(ValidationError, match="less than or equal to 84"):
            NfcIdCardSettingsUpdate(tap_retention_months=85)

    def test_bulk_requests_are_capped(self):
        with pytest.raises(ValidationError, match="at least 1 item"):
            NfcTagBulkStatusRequest(tag_ids=[], status="suspended")
        with pytest.raises(ValidationError, match="at most 200 items"):
            NfcTagBulkStatusRequest(
                tag_ids=[str(i) for i in range(201)], status="suspended"
            )


@pytest.mark.unit
class TestAdminRoutesAreGated:
    ROUTES = {
        ("/coverage", "GET"),
        ("/taps", "GET"),
        ("/taps/export", "GET"),
        ("/bulk-status", "POST"),
        ("/settings", "GET"),
        ("/settings", "PUT"),
    }

    def test_every_admin_route_needs_the_card_grant(self):
        seen = set()
        for route in router.routes:
            for path, method in self.ROUTES:
                if route.path == path and method in route.methods:
                    perms = {
                        p
                        for d in route.dependant.dependencies
                        for p in (getattr(d.call, "required_permissions", None) or ())
                    }
                    assert perms == {"members.manage_id_cards"}, (path, method)
                    seen.add((path, method))
        assert seen == self.ROUTES

    def test_the_blocked_set_matches_what_a_tap_refuses(self):
        """Retired and on-leave members keep working cards."""
        assert UserStatus.RETIRED not in BLOCKED_MEMBER_STATUSES
        assert UserStatus.LEAVE not in BLOCKED_MEMBER_STATUSES
        assert UserStatus.PROBATIONARY not in BLOCKED_MEMBER_STATUSES


# =============================================================================
# Against the database
# =============================================================================


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="NFC Admin VFD",
        slug=f"nfc-admin-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, last_name, status=UserStatus.ACTIVE) -> User:
    username = f"{last_name.lower()}{uuid.uuid4().hex[:8]}"
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=username,
        email=f"{username}@nfc.test",
        first_name="Test",
        last_name=last_name,
        password_hash="x",
        status=status,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _card(db_session, org, user, serial, status=NfcTagStatus.ACTIVE, **extra):
    card = await NfcTagService(db_session).register_tag(
        organization_id=org.id,
        user_id=user.id,
        tag_uid=serial,
        label=None,
        issued_by=None,
    )
    row = (
        await db_session.execute(select(NfcTag).where(NfcTag.id == card["id"]))
    ).scalar_one()
    row.status = status
    for key, value in extra.items():
        setattr(row, key, value)
    await db_session.flush()
    return row


@pytest.mark.integration
class TestStatusSync:
    async def test_a_leaver_loses_active_cards_and_gets_back_only_those(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _user(db_session, org, "Leaver")
        active = await _card(db_session, org, member, "04A1A1A1")
        by_officer = await _card(
            db_session, org, member, "04B2B2B2", status=NfcTagStatus.SUSPENDED
        )
        lost = await _card(
            db_session, org, member, "04C3C3C3", status=NfcTagStatus.LOST
        )

        moved = await sync_cards_with_member_status(
            db_session,
            organization_id=org.id,
            user_id=member.id,
            member_status=UserStatus.DROPPED_VOLUNTARY,
        )
        assert moved == 1
        assert active.status == NfcTagStatus.SUSPENDED
        assert active.auto_suspended is True
        assert active.revoked_reason == AUTO_SUSPEND_REASON

        moved = await sync_cards_with_member_status(
            db_session,
            organization_id=org.id,
            user_id=member.id,
            member_status=UserStatus.ACTIVE,
        )
        assert moved == 1
        assert active.status == NfcTagStatus.ACTIVE
        assert active.auto_suspended is False
        assert active.revoked_reason is None
        assert by_officer.status == NfcTagStatus.SUSPENDED
        assert lost.status == NfcTagStatus.LOST

    async def test_retiring_keeps_the_card_working(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org, "Retiree")
        card = await _card(db_session, org, member, "04D4D4D4")

        moved = await sync_cards_with_member_status(
            db_session,
            organization_id=org.id,
            user_id=member.id,
            member_status=UserStatus.RETIRED,
        )
        assert moved == 0
        assert card.status == NfcTagStatus.ACTIVE

    async def test_another_organizations_cards_are_untouched(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        member = await _user(db_session, other, "Elsewhere")
        card = await _card(db_session, other, member, "04E5E5E5")

        moved = await sync_cards_with_member_status(
            db_session,
            organization_id=org.id,
            user_id=member.id,
            member_status=UserStatus.ARCHIVED,
        )
        assert moved == 0
        assert card.status == NfcTagStatus.ACTIVE


@pytest.mark.integration
class TestCoverage:
    async def test_the_three_lists(self, db_session):
        org = await _org(db_session)
        carded = await _user(db_session, org, "Carded")
        uncarded = await _user(db_session, org, "Uncarded")
        probie = await _user(db_session, org, "Probie", UserStatus.PROBATIONARY)
        leaver = await _user(db_session, org, "Leaver", UserStatus.INACTIVE)

        fresh = await _card(
            db_session, org, carded, "04F1F1F1", last_used_at=datetime.now(timezone.utc)
        )
        stale = await _card(
            db_session,
            org,
            probie,
            "04F2F2F2",
            last_used_at=datetime.now(timezone.utc) - timedelta(days=400),
        )
        held = await _card(db_session, org, leaver, "04F3F3F3")

        report = await NfcCardAdminService(db_session).coverage(org.id, unused_days=180)

        without = {m["user_id"] for m in report["members_without_card"]}
        assert uncarded.id in without
        assert carded.id not in without
        assert probie.id not in without
        # An inactive member is not "a current member without a card".
        assert leaver.id not in without
        assert report["current_member_count"] == 3

        unused = {c["id"] for c in report["unused_cards"]}
        assert stale.id in unused
        assert fresh.id not in unused

        former = report["former_member_cards"]
        assert [c["id"] for c in former] == [held.id]
        assert former[0]["member_status"] == UserStatus.INACTIVE
        assert report["card_counts"]["active"] == 3


@pytest.mark.integration
class TestTapLog:
    async def test_filters_and_organization_scope(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        member = await _user(db_session, org, "Tapper")
        card = await _card(db_session, org, member, "04AB12CD")
        outsider = await _user(db_session, other, "Outsider")
        now = datetime.now(timezone.utc)

        for outcome, minutes_ago in (
            (NfcCheckInStatus.CHECKED_IN, 30),
            (NfcCheckInStatus.CARD_INACTIVE, 20),
        ):
            db_session.add(
                NfcCardTap(
                    organization_id=org.id,
                    tag_id=card.id,
                    user_id=member.id,
                    source=NfcTapSource.STATION,
                    outcome=outcome,
                    tapped_at=now - timedelta(minutes=minutes_ago),
                )
            )
        db_session.add(
            NfcCardTap(
                organization_id=org.id,
                unknown_uid_hash=hash_tag_uid("DEADBEEF"),
                source=NfcTapSource.KIOSK,
                outcome=NfcCheckInStatus.UNKNOWN_CARD,
                tapped_at=now - timedelta(minutes=10),
            )
        )
        db_session.add(
            NfcCardTap(
                organization_id=other.id,
                user_id=outsider.id,
                source=NfcTapSource.STATION,
                outcome=NfcCheckInStatus.CHECKED_IN,
                tapped_at=now,
            )
        )
        await db_session.flush()

        service = NfcCardAdminService(db_session)
        items, total = await service.list_taps(org.id)
        assert total == 3
        assert items[0]["outcome"] == NfcCheckInStatus.UNKNOWN_CARD
        assert items[0]["unknown_card_key"] == hash_tag_uid("DEADBEEF")[:8]
        assert items[1]["card_uid_preview"] == card.uid_preview
        assert items[1]["member_name"]

        items, total = await service.list_taps(org.id, tag_id=card.id)
        assert total == 2
        items, total = await service.list_taps(
            org.id, outcome=NfcCheckInStatus.CARD_INACTIVE
        )
        assert total == 1
        items, total = await service.list_taps(org.id, source=NfcTapSource.KIOSK)
        assert total == 1
        items, total = await service.list_taps(
            org.id, since=now - timedelta(minutes=25)
        )
        assert total == 2
        # Another department's member id matches nothing here.
        items, total = await service.list_taps(org.id, user_id=outsider.id)
        assert total == 0


@pytest.mark.integration
class TestBulkAndRetention:
    async def test_a_refused_card_does_not_block_the_rest(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        member = await _user(db_session, org, "Bulk")
        first = await _card(db_session, org, member, "04010101")
        second = await _card(db_session, org, member, "04020202")
        lost = await _card(
            db_session, org, member, "04030303", status=NfcTagStatus.LOST
        )
        foreign = await _card(
            db_session, other, await _user(db_session, other, "Foreign"), "04040404"
        )

        updated, failed = await NfcCardAdminService(db_session).bulk_update_status(
            org.id,
            [first.id, second.id, lost.id, foreign.id, first.id],
            NfcTagStatus.REVOKED,
            "Batch retired",
        )

        assert {c["id"] for c in updated} == {first.id, second.id}
        assert {f["id"] for f in failed} == {lost.id, foreign.id}
        assert first.status == NfcTagStatus.REVOKED
        assert foreign.status == NfcTagStatus.ACTIVE

    async def test_settings_round_trip_and_purge_keeps_recent_taps(self, db_session):
        org = await _org(db_session)
        service = NfcCardAdminService(db_session)
        assert (await service.get_settings(org.id))["tap_retention_months"] == 24

        await service.update_settings(org.id, tap_retention_months=6)
        await db_session.refresh(org)
        assert org.settings["nfc_id_cards"]["tap_retention_months"] == 6

        now = datetime(2026, 10, 23, tzinfo=timezone.utc)
        for when in (now - timedelta(days=200), now - timedelta(days=100)):
            db_session.add(
                NfcCardTap(
                    organization_id=org.id,
                    source=NfcTapSource.STATION,
                    outcome=NfcCheckInStatus.REFUSED,
                    tapped_at=when,
                )
            )
        await db_session.flush()

        assert await service.purge_expired_taps(org, now=now) == 1
        remaining = (
            (
                await db_session.execute(
                    select(NfcCardTap).where(NfcCardTap.organization_id == org.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(remaining) == 1


# =============================================================================
# Over HTTP
# =============================================================================


def _admin(permissions=("members.manage_id_cards",)):
    return SimpleNamespace(
        id="admin-1",
        organization_id=ORG,
        username="chief",
        full_name="Chief Ellis",
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _client(current_user):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(router, prefix="/nfc-tags")
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: current_user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _patches(**service):
    from unittest.mock import patch
    from zoneinfo import ZoneInfo

    fake = SimpleNamespace(**{k: AsyncMock(return_value=v) for k, v in service.items()})
    return (
        patch("app.api.v1.endpoints.nfc_tags.require_nfc_id_cards", AsyncMock()),
        patch(
            "app.api.v1.endpoints.nfc_tags.NfcCardAdminService",
            MagicMock(return_value=fake),
        ),
        patch(
            "app.api.v1.endpoints.nfc_tags.resolve_scheduling_timezone",
            AsyncMock(return_value=ZoneInfo("America/New_York")),
        ),
        patch("app.api.v1.endpoints.nfc_tags.log_audit_event", AsyncMock()),
    )


@pytest.mark.unit
class TestAdminEndpoints:
    async def test_the_export_neutralises_formulas_and_is_audited(self):
        row = {
            "tapped_at": datetime(2026, 10, 1, 14, 0, tzinfo=timezone.utc),
            "outcome": NfcCheckInStatus.CHECKED_IN,
            "source": NfcTapSource.STATION,
            "member_name": "=HYPERLINK(1)",
            "card_uid_preview": "245B",
            "card_label": None,
            "unknown_card_key": None,
            "location_name": None,
            "target_name": "Drill",
            "operator_name": "Chief Ellis",
        }
        gate, service, tz, audit = _patches(list_taps=([row], 1))
        with gate, service, tz, audit as logged:
            async with _client(_admin()) as client:
                response = await client.get("/nfc-tags/taps/export")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        body = response.text
        assert "'=HYPERLINK(1)" in body
        assert "2026-10-01 10:00 EDT" in body
        assert "ID card …245B" in body
        assert logged.await_args.kwargs["event_type"] == "nfc_card_taps_exported"

    async def test_each_bulk_change_is_audited(self):
        now = datetime.now(timezone.utc)
        card = {
            "id": "tag-1",
            "organization_id": ORG,
            "user_id": "u-1",
            "uid_preview": "245B",
            "credential_type": "serial",
            "status": NfcTagStatus.SUSPENDED,
            "issued_at": now,
            "created_at": now,
            "updated_at": now,
        }
        gate, service, tz, audit = _patches(
            bulk_update_status=([card], [{"id": "tag-2", "detail": "lost"}])
        )
        with gate, service, tz, audit as logged:
            async with _client(_admin()) as client:
                response = await client.post(
                    "/nfc-tags/bulk-status",
                    json={"tag_ids": ["tag-1", "tag-2"], "status": "suspended"},
                )

        assert response.status_code == 200, response.text
        assert response.json()["failed"] == [{"id": "tag-2", "detail": "lost"}]
        assert logged.await_count == 1
        assert logged.await_args.kwargs["event_data"]["bulk"] is True

    async def test_a_station_operator_cannot_read_the_tap_log(self):
        gate, service, tz, audit = _patches(list_taps=([], 0))
        with gate, service, tz, audit:
            async with _client(_admin(("members.check_in",))) as client:
                response = await client.get("/nfc-tags/taps")
        assert response.status_code == 403

    async def test_coverage_is_refused_while_cards_are_turned_off(self):
        from unittest.mock import patch

        from fastapi import HTTPException

        refused = AsyncMock(side_effect=HTTPException(status_code=403, detail="off"))
        with patch("app.api.v1.endpoints.nfc_tags.require_nfc_id_cards", refused):
            async with _client(_admin()) as client:
                response = await client.get("/nfc-tags/coverage")
        assert response.status_code == 403
