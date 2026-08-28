"""
Tests for the NFC ID card service (app/services/nfc_tag_service.py).

Covers the three things a card credential has to get right: one card reads to
one stored hash however the reader spelled it, a card that should not work does
not, and a tap resolves to the right direction — including the bounce guard
that stops a card held a beat too long from closing the arrival it just made.
DB mocked.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.admin_hours import AdminHoursEntryMethod
from app.models.nfc_tag import NfcCredentialType, NfcTagStatus
from app.models.user import UserStatus
from app.schemas.nfc_tag import (
    NfcCheckInDirection,
    NfcCheckInStatus,
    NfcCheckInTarget,
)
from app.services.nfc_tag_service import (
    MIN_TOGGLE_SECONDS,
    NfcTagService,
    hash_tag_uid,
    normalize_tag_uid,
    uid_preview,
)

ORG = "org-1"


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _tag(status=NfcTagStatus.ACTIVE, user_id="u1"):
    return SimpleNamespace(
        id="tag-1",
        organization_id=ORG,
        user_id=user_id,
        uid_hash=hash_tag_uid("04A2245B"),
        uid_preview="245B",
        label="Blue card",
        status=status,
        credential_type=NfcCredentialType.SERIAL,
        issued_at=datetime.now(timezone.utc),
        last_used_at=None,
        revoked_at=None,
        revoked_reason=None,
        issued_by="admin-1",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _user(status=UserStatus.ACTIVE, deleted_at=None):
    return SimpleNamespace(
        id="u1",
        organization_id=ORG,
        first_name="Dana",
        last_name="Ruiz",
        full_name="Dana Ruiz",
        membership_number="1042",
        status=status,
        deleted_at=deleted_at,
    )


# =============================================================================
# Serial normalization and hashing
# =============================================================================


class TestSerialHandling:
    def test_same_card_read_by_different_readers_hashes_the_same(self):
        """A card registered on a phone must be recognised at the desk reader.

        Web NFC returns a lowercase colon-separated serial; USB readers type it
        bare. Without normalization the two would store different hashes and
        the member would report their card had "stopped working".
        """
        assert hash_tag_uid("04:a2:24:5b") == hash_tag_uid("04A2245B")
        assert hash_tag_uid(" 04-a2-24-5B ") == hash_tag_uid("04A2245B")

    def test_different_cards_hash_differently(self):
        assert hash_tag_uid("04A2245B") != hash_tag_uid("04A2245C")

    def test_normalize_strips_separators_and_uppercases(self):
        assert normalize_tag_uid("04:a2-24 5b") == "04A2245B"

    def test_preview_is_the_last_four_characters(self):
        assert uid_preview("04:a2:24:5b") == "245B"

    def test_hash_is_not_the_bare_sha256_of_the_serial(self):
        """The pepper is what stops a stolen table being matched to real cards.

        Card UIDs are short and structured enough to enumerate, so an
        unpeppered digest would be reversible by anyone who lifted the table.
        """
        import hashlib

        assert hash_tag_uid("04A2245B") != hashlib.sha256(b"04A2245B").hexdigest()


# =============================================================================
# Resolution
# =============================================================================


class TestResolveTag:
    async def test_unregistered_card_is_unknown(self):
        service = NfcTagService(_db([_one(None)]))
        tag, user, refusal = await service.resolve_tag(ORG, [None, "04A2245B"])
        assert tag is None
        assert user is None
        assert refusal == NfcCheckInStatus.UNKNOWN_CARD

    async def test_lost_card_is_refused(self):
        service = NfcTagService(_db([_one(_tag(status=NfcTagStatus.LOST))]))
        tag, user, refusal = await service.resolve_tag(ORG, [None, "04A2245B"])
        assert refusal == NfcCheckInStatus.CARD_INACTIVE
        assert user is None

    async def test_suspended_member_is_refused(self):
        service = NfcTagService(
            _db([_one(_tag()), _one(_user(status=UserStatus.SUSPENDED))])
        )
        _tag_out, _user_out, refusal = await service.resolve_tag(
            ORG, [None, "04A2245B"]
        )
        assert refusal == NfcCheckInStatus.MEMBER_INACTIVE

    async def test_inactive_member_is_refused(self):
        """INACTIVE is the plain "not an active member" state.

        Unlike retired or on-leave it carries no sense in which the member is
        still turning up, so a card must not go on recording attendance.
        """
        service = NfcTagService(
            _db([_one(_tag()), _one(_user(status=UserStatus.INACTIVE))])
        )
        _t, _u, refusal = await service.resolve_tag(ORG, [None, "04A2245B"])
        assert refusal == NfcCheckInStatus.MEMBER_INACTIVE

    async def test_retired_member_may_still_tap_in(self):
        """Retired members attend meetings and banquets — that is the point."""
        service = NfcTagService(
            _db([_one(_tag()), _one(_user(status=UserStatus.RETIRED))])
        )
        tag, user, refusal = await service.resolve_tag(ORG, [None, "04A2245B"])
        assert refusal is None
        assert tag is not None
        assert user is not None

    async def test_deleted_member_is_refused(self):
        service = NfcTagService(
            _db([_one(_tag()), _one(_user(deleted_at=datetime.now(timezone.utc)))])
        )
        _t, _u, refusal = await service.resolve_tag(ORG, [None, "04A2245B"])
        assert refusal == NfcCheckInStatus.MEMBER_INACTIVE

    async def test_active_card_and_member_resolve_cleanly(self):
        service = NfcTagService(_db([_one(_tag()), _one(_user())]))
        tag, user, refusal = await service.resolve_tag(ORG, [None, "04A2245B"])
        assert refusal is None
        assert tag.id == "tag-1"
        assert user.id == "u1"

    async def test_a_written_code_wins_over_the_serial_underneath_it(self):
        """A blank tag can be rewritten and reused.

        Its chip serial may still be registered to whoever held the tag before,
        so resolving the serial first would check in the wrong member.
        """
        written = _tag(user_id="u-current")
        db = _db([_one(written), _one(_user())])
        service = NfcTagService(db)

        tag, _user_out, refusal = await service.resolve_tag(
            ORG, ["LBC1DEADBEEF", "04A2245B"]
        )

        assert refusal is None
        assert tag.user_id == "u-current"
        # Stopped at the first candidate that matched — the serial was never
        # looked up.
        assert db.execute.await_count == 2

    async def test_blank_candidates_are_skipped_rather_than_looked_up(self):
        """An empty payload must not be hashed and matched as if it were one."""
        db = _db([_one(_tag()), _one(_user())])
        service = NfcTagService(db)

        _t, _u, refusal = await service.resolve_tag(ORG, [None, "   ", "04A2245B"])

        assert refusal is None
        assert db.execute.await_count == 2


# =============================================================================
# Registration
# =============================================================================


class TestRegisterTag:
    async def test_card_already_issued_to_someone_else_is_refused(self):
        db = _db([_one(_tag(user_id="u2"))])
        service = NfcTagService(db)
        with patch(
            "app.services.nfc_tag_service.assert_in_org", AsyncMock(return_value=None)
        ):
            with pytest.raises(ValueError, match="another member"):
                await service.register_tag(
                    organization_id=ORG,
                    user_id="u1",
                    tag_uid="04A2245B",
                    label=None,
                    issued_by="admin-1",
                )
        db.add.assert_not_called()

    async def test_refusal_does_not_name_the_current_holder(self):
        """Otherwise card issuing turns a pile of found cards into a directory."""
        db = _db([_one(_tag(user_id="u2"))])
        service = NfcTagService(db)
        with patch(
            "app.services.nfc_tag_service.assert_in_org", AsyncMock(return_value=None)
        ):
            with pytest.raises(ValueError, match="already registered") as excinfo:
                await service.register_tag(
                    organization_id=ORG,
                    user_id="u1",
                    tag_uid="04A2245B",
                    label=None,
                    issued_by="admin-1",
                )
        assert "u2" not in str(excinfo.value)

    async def test_member_outside_the_organization_is_refused(self):
        db = _db([])
        service = NfcTagService(db)
        with patch(
            "app.services.nfc_tag_service.assert_in_org",
            AsyncMock(side_effect=ValueError("Member not found in organization")),
        ):
            with pytest.raises(ValueError, match="organization"):
                await service.register_tag(
                    organization_id=ORG,
                    user_id="outsider",
                    tag_uid="04A2245B",
                    label=None,
                    issued_by="admin-1",
                )
        db.add.assert_not_called()

    async def test_new_card_is_stored_hashed_with_a_preview(self):
        db = _db([_one(None), MagicMock(__iter__=lambda self: iter([]))])
        service = NfcTagService(db)
        with patch(
            "app.services.nfc_tag_service.assert_in_org", AsyncMock(return_value=None)
        ):
            await service.register_tag(
                organization_id=ORG,
                user_id="u1",
                tag_uid="04:a2:24:5b",
                label="Blue card",
                issued_by="admin-1",
            )
        stored = db.add.call_args[0][0]
        assert stored.uid_hash == hash_tag_uid("04A2245B")
        assert stored.uid_preview == "245B"
        # The serial itself must not survive anywhere on the row.
        assert not any(
            getattr(stored, name, None) == "04A2245B"
            for name in ("label", "uid_preview", "uid_hash")
        )


class TestCardLifecycleTransitions:
    async def test_a_lost_card_cannot_be_reactivated(self):
        """The invariant is about the physical world, so the API has to hold it.

        Whoever picked the card up can still tap it. Leaving the rule to the
        screen that hides the button means an API client silently breaks it.
        """
        tag = _tag(status=NfcTagStatus.LOST)
        service = NfcTagService(_db([_one(tag)]))

        with pytest.raises(ValueError, match="cannot be reactivated"):
            await service.update_tag("tag-1", ORG, {"status": NfcTagStatus.ACTIVE})

    async def test_a_revoked_card_cannot_be_reactivated(self):
        tag = _tag(status=NfcTagStatus.REVOKED)
        service = NfcTagService(_db([_one(tag)]))

        with pytest.raises(ValueError, match="cannot be reactivated"):
            await service.update_tag("tag-1", ORG, {"status": NfcTagStatus.ACTIVE})

    async def test_a_suspended_card_can_be_reactivated(self):
        """Suspension is the reversible state — that is what it is for."""
        tag = _tag(status=NfcTagStatus.SUSPENDED)
        tag.revoked_at = datetime.now(timezone.utc)
        tag.revoked_reason = "Suspended by an officer"
        db = _db([_one(tag), MagicMock(__iter__=lambda self: iter([]))])
        service = NfcTagService(db)

        await service.update_tag("tag-1", ORG, {"status": NfcTagStatus.ACTIVE})

        assert tag.status == NfcTagStatus.ACTIVE
        assert tag.revoked_at is None
        assert tag.revoked_reason is None

    async def test_a_lost_card_cannot_be_laundered_through_suspended(self):
        """Rejecting only `terminal -> active` left the invariant one hop wide.

        An API client could patch `lost -> suspended`, then `suspended ->
        active`, and end up with exactly the credential somebody else may be
        holding.
        """
        tag = _tag(status=NfcTagStatus.LOST)
        service = NfcTagService(_db([_one(tag)]))

        with pytest.raises(ValueError, match="cannot be reactivated"):
            await service.update_tag("tag-1", ORG, {"status": NfcTagStatus.SUSPENDED})
        assert tag.status == NfcTagStatus.LOST

    async def test_a_revoked_card_cannot_be_moved_to_lost(self):
        """No transition out of a terminal state, in any direction."""
        tag = _tag(status=NfcTagStatus.REVOKED)
        service = NfcTagService(_db([_one(tag)]))

        with pytest.raises(ValueError, match="cannot be reactivated"):
            await service.update_tag("tag-1", ORG, {"status": NfcTagStatus.LOST})

    async def test_a_lost_card_can_still_be_relabelled(self):
        """The guard is about reactivation, not about freezing the record."""
        tag = _tag(status=NfcTagStatus.LOST)
        db = _db([_one(tag), MagicMock(__iter__=lambda self: iter([]))])
        service = NfcTagService(db)

        await service.update_tag("tag-1", ORG, {"label": "Old blue card"})

        assert tag.label == "Old blue card"
        assert tag.status == NfcTagStatus.LOST


# =============================================================================
# Direction resolution
# =============================================================================


class TestResolveDirection:
    def _service(self):
        return NfcTagService(_db([]))

    def test_auto_checks_in_when_there_is_no_record(self):
        assert (
            self._service()._resolve_direction(NfcCheckInDirection.AUTO, None, None)
            == NfcCheckInDirection.IN
        )

    def test_auto_checks_out_once_the_bounce_window_has_passed(self):
        earlier = datetime.now(timezone.utc) - timedelta(
            seconds=MIN_TOGGLE_SECONDS + 30
        )
        assert (
            self._service()._resolve_direction(NfcCheckInDirection.AUTO, earlier, None)
            == NfcCheckInDirection.OUT
        )

    def test_auto_treats_an_immediate_second_tap_as_a_bounce(self):
        """A card held against the reader fires twice.

        Reading the second read as a check-out would close an arrival seconds
        old and file a zero-minute shift.
        """
        just_now = datetime.now(timezone.utc) - timedelta(seconds=5)
        result = self._service()._resolve_direction(
            NfcCheckInDirection.AUTO, just_now, None
        )
        assert isinstance(result, dict)
        assert result["status"] == NfcCheckInStatus.ALREADY_CHECKED_IN

    def test_auto_does_not_reopen_a_completed_attendance(self):
        result = self._service()._resolve_direction(
            NfcCheckInDirection.AUTO,
            datetime.now(timezone.utc) - timedelta(hours=4),
            datetime.now(timezone.utc) - timedelta(hours=1),
        )
        assert isinstance(result, dict)
        assert result["status"] == NfcCheckInStatus.ALREADY_CHECKED_OUT

    def test_explicit_in_reports_an_existing_check_in(self):
        result = self._service()._resolve_direction(
            NfcCheckInDirection.IN,
            datetime.now(timezone.utc) - timedelta(hours=2),
            None,
        )
        assert isinstance(result, dict)
        assert result["status"] == NfcCheckInStatus.ALREADY_CHECKED_IN

    def test_explicit_in_ignores_the_bounce_window(self):
        """A dedicated check-in station never inverts, so no guard is needed."""
        assert (
            self._service()._resolve_direction(NfcCheckInDirection.IN, None, None)
            == NfcCheckInDirection.IN
        )

    def test_explicit_out_reports_an_existing_check_out(self):
        result = self._service()._resolve_direction(
            NfcCheckInDirection.OUT,
            datetime.now(timezone.utc) - timedelta(hours=3),
            datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        assert isinstance(result, dict)
        assert result["status"] == NfcCheckInStatus.ALREADY_CHECKED_OUT

    def test_naive_timestamps_are_read_as_utc(self):
        """MySQL DATETIME comes back naive; comparing it raises TypeError.

        That would 500 the tap rather than refuse it.
        """
        naive = (
            datetime.now(timezone.utc) - timedelta(seconds=MIN_TOGGLE_SECONDS + 30)
        ).replace(tzinfo=None)
        assert (
            self._service()._resolve_direction(NfcCheckInDirection.AUTO, naive, None)
            == NfcCheckInDirection.OUT
        )


# =============================================================================
# Check-in dispatch
# =============================================================================


class TestCheckIn:
    async def test_unknown_card_reports_rather_than_raises(self):
        """The station is a screen; every domain outcome has to be drawable."""
        service = NfcTagService(_db([_one(None)]))
        result = await service.check_in(
            organization_id=ORG,
            tag_uid="04A2245B",
            target_type=NfcCheckInTarget.SHIFT,
            target_id="shift-1",
        )
        assert result["status"] == NfcCheckInStatus.UNKNOWN_CARD
        assert result["message"]

    async def test_lost_card_names_its_state(self):
        service = NfcTagService(_db([_one(_tag(status=NfcTagStatus.LOST))]))
        result = await service.check_in(
            organization_id=ORG,
            tag_uid="04A2245B",
            target_type=NfcCheckInTarget.SHIFT,
            target_id="shift-1",
        )
        assert result["status"] == NfcCheckInStatus.CARD_INACTIVE
        assert "lost" in result["message"]

    async def test_shift_check_in_returns_the_member(self):
        tag = _tag()
        db = _db([_one(tag), _one(_user())])
        service = NfcTagService(db)

        attendance = SimpleNamespace(
            checked_in_at=datetime.now(timezone.utc),
            checked_out_at=None,
            duration_minutes=None,
        )
        scheduling = MagicMock()
        scheduling.get_shift_by_id = AsyncMock(
            return_value=SimpleNamespace(
                id="shift-1",
                apparatus_id=None,
                platoon="A",
                shift_date=None,
            )
        )
        scheduling.get_my_attendance = AsyncMock(return_value=None)
        scheduling.member_check_in = AsyncMock(return_value=(attendance, None))

        with patch(
            "app.services.nfc_tag_service.SchedulingService", return_value=scheduling
        ):
            result = await service.check_in(
                organization_id=ORG,
                tag_uid="04A2245B",
                target_type=NfcCheckInTarget.SHIFT,
                target_id="shift-1",
            )

        assert result["status"] == NfcCheckInStatus.CHECKED_IN
        assert result["member_name"] == "Dana Ruiz"
        assert result["membership_number"] == "1042"
        assert tag.last_used_at is not None

    async def test_a_refused_shift_check_in_carries_the_reason(self):
        tag = _tag()
        service = NfcTagService(_db([_one(tag), _one(_user())]))

        scheduling = MagicMock()
        scheduling.get_shift_by_id = AsyncMock(
            return_value=SimpleNamespace(
                id="shift-1", apparatus_id=None, platoon=None, shift_date=None
            )
        )
        scheduling.get_my_attendance = AsyncMock(return_value=None)
        scheduling.member_check_in = AsyncMock(
            return_value=(None, "You are not assigned to this shift.")
        )

        with patch(
            "app.services.nfc_tag_service.SchedulingService", return_value=scheduling
        ):
            result = await service.check_in(
                organization_id=ORG,
                tag_uid="04A2245B",
                target_type=NfcCheckInTarget.SHIFT,
                target_id="shift-1",
            )

        assert result["status"] == NfcCheckInStatus.REFUSED
        assert result["message"] == "You are not assigned to this shift."
        # A refusal is not use: stamping it would make "last used" mean
        # "last waved at a reader", which no card audit is asking about.
        assert tag.last_used_at is None

    async def test_a_missing_shift_raises_for_the_endpoint_to_404(self):
        service = NfcTagService(_db([_one(_tag()), _one(_user())]))
        scheduling = MagicMock()
        scheduling.get_shift_by_id = AsyncMock(return_value=None)
        with patch(
            "app.services.nfc_tag_service.SchedulingService", return_value=scheduling
        ):
            with pytest.raises(ValueError, match="Shift not found"):
                await service.check_in(
                    organization_id=ORG,
                    tag_uid="04A2245B",
                    target_type=NfcCheckInTarget.SHIFT,
                    target_id="nope",
                )

    async def test_admin_hours_refuses_a_session_open_elsewhere(self):
        """Clocking out of the wrong category would credit the wrong hours."""
        service = NfcTagService(_db([_one(_tag()), _one(_user())]))

        admin_hours = MagicMock()
        admin_hours.get_category = AsyncMock(
            return_value=SimpleNamespace(id="cat-1", name="Station Duty")
        )
        admin_hours.get_active_session = AsyncMock(
            return_value={
                "category_id": "cat-2",
                "category_name": "Fundraising",
                "clock_in_at": datetime.now(timezone.utc),
            }
        )

        with patch(
            "app.services.nfc_tag_service.AdminHoursService", return_value=admin_hours
        ):
            result = await service.check_in(
                organization_id=ORG,
                tag_uid="04A2245B",
                target_type=NfcCheckInTarget.ADMIN_HOURS,
                target_id="cat-1",
            )

        assert result["status"] == NfcCheckInStatus.REFUSED
        assert "Fundraising" in result["message"]

    async def test_admin_hours_clocks_in_when_nothing_is_open(self):
        service = NfcTagService(_db([_one(_tag()), _one(_user())]))

        admin_hours = MagicMock()
        admin_hours.get_category = AsyncMock(
            return_value=SimpleNamespace(id="cat-1", name="Station Duty")
        )
        admin_hours.get_active_session = AsyncMock(return_value=None)
        admin_hours.clock_in = AsyncMock(
            return_value=SimpleNamespace(clock_in_at=datetime.now(timezone.utc))
        )

        with patch(
            "app.services.nfc_tag_service.AdminHoursService", return_value=admin_hours
        ):
            result = await service.check_in(
                organization_id=ORG,
                tag_uid="04A2245B",
                target_type=NfcCheckInTarget.ADMIN_HOURS,
                target_id="cat-1",
            )

        assert result["status"] == NfcCheckInStatus.CHECKED_IN
        assert result["target_name"] == "Station Duty"
        # Recorded as a station tap, not as the member scanning a QR code with
        # their own phone — an export that cannot tell those apart is claiming
        # something untrue about who was standing there.
        assert (
            admin_hours.clock_in.call_args.kwargs["entry_method"]
            == AdminHoursEntryMethod.NFC_STATION
        )

    async def test_event_phase_gate_is_reported_not_overridden(self):
        """A station has nobody to ask, so it must not answer for the officer."""
        from app.services.event_service import PHASE_GATE_PREFIX

        service = NfcTagService(_db([_one(_tag()), _one(_user()), _one(None)]))
        db_event = SimpleNamespace(id="ev-1", title="Monthly Meeting")
        service.db.execute = AsyncMock(
            side_effect=[_one(_tag()), _one(_user()), _one(db_event), _one(None)]
        )

        events = MagicMock()
        events.self_check_in = AsyncMock(
            return_value=(None, PHASE_GATE_PREFIX + "Not yet in this phase.", None)
        )

        with patch("app.services.nfc_tag_service.EventService", return_value=events):
            result = await service.check_in(
                organization_id=ORG,
                tag_uid="04A2245B",
                target_type=NfcCheckInTarget.EVENT,
                target_id="ev-1",
            )

        assert result["status"] == NfcCheckInStatus.REFUSED
        assert "Not yet in this phase." in result["message"]
        assert PHASE_GATE_PREFIX not in result["message"]


# =============================================================================
# Org scoping — the name-lookup helper
# =============================================================================


class TestNameMapOrgScoping:
    """AP-13 (pass 2): ``_name_map`` looked up display names by a bare
    ``User.id.in_(ids)`` with no ``organization_id`` filter on the query
    itself. Every current caller only ever feeds it ids drawn from an
    already-org-scoped ``NfcTag`` row (``user_id`` / ``issued_by``), so this
    was not reachable with a cross-org id today -- but that safety lived in
    the caller, not the query, which is exactly the shape CLAUDE.md Pitfall
    #14a warns against relying on. Locks the filter onto the query itself.

    Asserts against the compiled WHERE clause specifically: a substring check
    against the whole statement would still pass with the filter removed,
    since ``organization_id`` isn't one of the selected columns here -- but
    matching the established pattern (test_admin_hours_service.py, PR #1838)
    keeps the assertion meaningful even if the selected columns ever change.
    """

    def _capturing_db(self, rows):
        captured = {}

        async def _exec(stmt, *a, **k):
            captured["stmt"] = stmt
            return MagicMock(__iter__=lambda self: iter(rows))

        db = MagicMock()
        db.execute = AsyncMock(side_effect=_exec)
        return db, captured

    async def test_name_map_query_is_org_scoped(self):
        db, captured = self._capturing_db([])
        service = NfcTagService(db)

        await service._name_map(ORG, {"u1", "u2"})

        assert "organization_id" in str(captured["stmt"].whereclause)

    async def test_name_map_returns_names_for_in_org_ids(self):
        row = SimpleNamespace(id="u1", first_name="Dana", last_name="Ruiz")
        db, _captured = self._capturing_db([row])
        service = NfcTagService(db)

        names = await service._name_map(ORG, {"u1"})

        assert names == {"u1": "Dana Ruiz"}

    async def test_name_map_short_circuits_on_no_ids(self):
        """No query at all for an empty id set -- nothing to leak either way."""
        db, _captured = self._capturing_db([])
        service = NfcTagService(db)

        names = await service._name_map(ORG, set())

        assert names == {}
        db.execute.assert_not_called()
