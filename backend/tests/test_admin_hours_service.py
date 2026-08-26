"""
Tests for the admin hours service (app/services/admin_hours_service.py).

This is a timeclock: QR clock-in/clock-out with duration math and an
approval policy. Covers _determine_post_clockout_status (the approve/pend
decision), clock_in guards (category missing/inactive, already-clocked-in,
busy-elsewhere), clock_out duration + status stamping, and create_manual_entry
validation (ordering, no future, minimum duration, overlap). DB mocked.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.admin_hours import AdminHoursEntryStatus
from app.services.admin_hours_service import AdminHoursService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _category(
    is_active=True, require_approval=False, auto_approve_under_hours=None, **kw
):
    return SimpleNamespace(
        id=kw.get("id", "cat-1"),
        organization_id="org-1",
        name="Station Duty",
        is_active=is_active,
        require_approval=require_approval,
        auto_approve_under_hours=auto_approve_under_hours,
        max_hours_per_session=kw.get("max_hours_per_session"),
    )


def _active_entry(category_id="cat-1", minutes_ago=90):
    return SimpleNamespace(
        id="entry-1",
        organization_id="org-1",
        user_id="u1",
        category_id=category_id,
        clock_in_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        clock_out_at=None,
        duration_minutes=None,
        status=AdminHoursEntryStatus.ACTIVE,
    )


class TestPostClockoutStatus:
    def test_no_category_is_approved(self):
        s = AdminHoursService._determine_post_clockout_status(None, 120)
        assert s == AdminHoursEntryStatus.APPROVED

    def test_no_approval_required_is_approved(self):
        cat = _category(require_approval=False)
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 600)
            == AdminHoursEntryStatus.APPROVED
        )

    def test_auto_approves_under_threshold(self):
        cat = _category(require_approval=True, auto_approve_under_hours=2)
        # 90 min = 1.5h < 2h -> approved
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 90)
            == AdminHoursEntryStatus.APPROVED
        )

    def test_pends_at_or_over_threshold(self):
        cat = _category(require_approval=True, auto_approve_under_hours=2)
        # 150 min = 2.5h >= 2h -> pending
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 150)
            == AdminHoursEntryStatus.PENDING
        )

    def test_pends_when_no_auto_threshold(self):
        cat = _category(require_approval=True, auto_approve_under_hours=None)
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 30)
            == AdminHoursEntryStatus.PENDING
        )


class TestClockIn:
    async def test_category_not_found(self):
        with pytest.raises(ValueError, match="Category not found"):
            await AdminHoursService(_db([_one(None)])).clock_in("cat-1", "u1", "org-1")

    async def test_inactive_category(self):
        with pytest.raises(ValueError, match="no longer active"):
            await AdminHoursService(_db([_one(_category(is_active=False))])).clock_in(
                "cat-1", "u1", "org-1"
            )

    async def test_already_clocked_in_same_category(self):
        # category, User row lock (result unused), active-session check.
        db = _db(
            [
                _one(_category()),
                MagicMock(),
                _one(_active_entry(category_id="cat-1")),
            ]
        )
        with pytest.raises(ValueError, match="ALREADY_CLOCKED_IN"):
            await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")

    async def test_busy_in_other_category(self):
        db = _db(
            [
                _one(_category()),
                MagicMock(),
                _one(_active_entry(category_id="other")),
            ]
        )
        with pytest.raises(ValueError, match="already have an active session"):
            await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")

    async def test_clock_in_success(self):
        # category, User row lock (result unused), no active session.
        db = _db([_one(_category()), MagicMock(), _one(None)])
        entry = await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")
        assert entry.category_id == "cat-1"
        assert entry.status == AdminHoursEntryStatus.ACTIVE
        db.add.assert_called_once()


class TestClockOut:
    async def test_no_active_session(self):
        with pytest.raises(ValueError, match="No active session"):
            await AdminHoursService(_db([_one(None)])).clock_out(
                "entry-1", "u1", "org-1"
            )

    async def test_stamps_duration_and_status(self):
        entry = _active_entry(minutes_ago=90)
        # clock_out lookup -> entry, then get_category -> category
        db = _db([_one(entry), _one(_category(require_approval=False))])
        out = await AdminHoursService(db).clock_out("entry-1", "u1", "org-1")
        assert out.clock_out_at is not None
        assert out.duration_minutes == 90
        assert out.status == AdminHoursEntryStatus.APPROVED


class TestCreateManualEntry:
    def _svc(self, category, overlap=None):
        svc = AdminHoursService(_db([_one(category)]))
        svc._check_overlap = AsyncMock(return_value=overlap)
        return svc

    async def test_clock_out_not_after_clock_in(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category())
        with pytest.raises(ValueError, match="must be after"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now - timedelta(hours=1),
                now - timedelta(hours=2),
            )

    async def test_future_clock_in_rejected(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category())
        with pytest.raises(ValueError, match="future"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now + timedelta(hours=1),
                now + timedelta(hours=2),
            )

    async def test_minimum_duration(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category())
        with pytest.raises(ValueError, match="at least 1 minute"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now - timedelta(minutes=10),
                now - timedelta(minutes=10, seconds=-30),  # 30s span
            )

    async def test_overlap_rejected(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category(), overlap=SimpleNamespace(id="existing"))
        with pytest.raises(ValueError, match="overlaps"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now - timedelta(hours=2),
                now - timedelta(hours=1),
            )

    async def test_success_computes_duration(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category(require_approval=False), overlap=None)
        entry = await svc.create_manual_entry(
            "org-1", "u1", "cat-1", now - timedelta(hours=2), now - timedelta(hours=1)
        )
        assert entry.duration_minutes == 60
        # Manual entries carry client-supplied times, so they always require
        # officer review — never auto-approve, even for a require_approval=False
        # category (which only auto-approves server-timed clock-outs).
        assert entry.status == AdminHoursEntryStatus.PENDING

    async def test_naive_datetimes_rejected_with_clear_error(self):
        # A datetime-local string parses to a naive datetime. It is ambiguous
        # (the pre-2026-08 frontend sent local wall-clock strings), so the
        # service rejects it with a ValueError (-> 400) instead of either
        # assuming UTC (silently shifted hours) or crashing on the
        # aware-vs-naive comparison against `now` (TypeError -> opaque 500).
        naive_now = datetime.now(timezone.utc).replace(tzinfo=None)
        svc = self._svc(_category(), overlap=None)
        with pytest.raises(ValueError, match="timezone offset"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                naive_now - timedelta(hours=2),
                naive_now - timedelta(hours=1),
            )

    async def test_aware_non_utc_offsets_normalized_to_utc(self):
        # An explicit offset is unambiguous — accept it and store as UTC.
        eastern = timezone(timedelta(hours=-4))
        now_local = datetime.now(timezone.utc).astimezone(eastern)
        svc = self._svc(_category(), overlap=None)
        entry = await svc.create_manual_entry(
            "org-1",
            "u1",
            "cat-1",
            now_local - timedelta(hours=2),
            now_local - timedelta(hours=1),
        )
        assert entry.duration_minutes == 60
        assert entry.clock_in_at.tzinfo == timezone.utc
        assert entry.clock_out_at.tzinfo == timezone.utc


class TestEditPendingEntry:
    @staticmethod
    def _pending_entry():
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id="entry-1",
            organization_id="org-1",
            user_id="u1",
            category_id="cat-1",
            clock_in_at=now - timedelta(hours=3),
            clock_out_at=now - timedelta(hours=1),
            duration_minutes=120,
            description=None,
            status=AdminHoursEntryStatus.PENDING,
        )

    async def test_naive_edit_time_rejected_with_clear_error(self):
        # An admin edit sends only the changed field; a naive edited value is
        # ambiguous and would be compared against the aware stored counterpart
        # (TypeError -> 500 before, silently shifted hours if assumed UTC).
        entry = self._pending_entry()
        db = _db([_one(entry)])
        naive_out = entry.clock_in_at.replace(tzinfo=None) + timedelta(hours=1)
        with pytest.raises(ValueError, match="timezone offset"):
            await AdminHoursService(db).edit_pending_entry(
                entry_id="entry-1",
                organization_id="org-1",
                admin_id="admin-1",
                clock_out_at=naive_out,
            )

    async def test_aware_edit_time_recomputes_duration(self):
        entry = self._pending_entry()
        # entry fetch, then the overlap check (no overlap).
        db = _db([_one(entry), MagicMock(scalar=MagicMock(return_value=0))])
        new_out = entry.clock_in_at + timedelta(hours=1)
        out = await AdminHoursService(db).edit_pending_entry(
            entry_id="entry-1",
            organization_id="org-1",
            admin_id="admin-1",
            clock_out_at=new_out,
        )
        assert out.duration_minutes == 60
        assert out.clock_out_at.tzinfo is not None

    async def test_out_of_order_edit_rejected(self):
        entry = self._pending_entry()
        db = _db([_one(entry)])
        with pytest.raises(ValueError, match="must be after"):
            await AdminHoursService(db).edit_pending_entry(
                entry_id="entry-1",
                organization_id="org-1",
                admin_id="admin-1",
                clock_out_at=entry.clock_in_at - timedelta(hours=1),
            )


class TestOrgScopedQueries:
    """AH-5: the active-session and overlap queries filter organization_id."""

    def _capturing_db(self, result):
        captured = {}

        async def _exec(stmt, *a, **k):
            captured["stmt"] = stmt
            return result

        db = MagicMock()
        db.execute = AsyncMock(side_effect=_exec)
        db.flush = AsyncMock()
        return db, captured

    async def test_get_active_session_query_is_org_scoped(self):
        """Asserts against the compiled WHERE clause, not the whole
        statement: `select(AdminHoursEntry)` always lists `organization_id`
        in its SELECT columns as a plain model field, so a substring check
        against the full statement would pass even with the filter removed
        (same flaw a Codex review caught in this class's newest test,
        PR #1838 — fixed here too since it's the identical mechanism in the
        same file)."""
        db, captured = self._capturing_db(_one(None))
        await AdminHoursService(db)._get_active_session("u1", "org-1")
        assert "organization_id" in str(captured["stmt"].whereclause)

    async def test_check_overlap_query_is_org_scoped(self):
        db, captured = self._capturing_db(MagicMock(scalar=MagicMock(return_value=0)))
        await AdminHoursService(db)._check_overlap(
            "u1",
            "org-1",
            datetime.now(timezone.utc) - timedelta(hours=1),
            datetime.now(timezone.utc),
        )
        assert "organization_id" in str(captured["stmt"])

    async def test_clock_out_by_category_query_is_org_scoped(self):
        """`user_id`-scoping alone happens to make this safe against the two
        current callers (the NFC station and the member's own QR re-scan both
        pass `current_user.id`), but the query itself carried no org anchor —
        the letter of CLAUDE.md Pitfall #14a regardless of exploitability.
        Locks the org filter in so a future caller can't reopen the gap by
        construction.

        Asserts against the compiled WHERE clause specifically, not the whole
        statement: ``select(AdminHoursEntry)`` always lists
        ``organization_id`` in its SELECT columns (it's a model field), so a
        substring check against the full statement would pass even with the
        filter removed (Codex review, PR #1838)."""
        db, captured = self._capturing_db(_one(None))
        with pytest.raises(ValueError, match="No active session found"):
            await AdminHoursService(db).clock_out_by_category(
                category_id="cat-1", user_id="u1", organization_id="org-1"
            )
        assert "organization_id" in str(captured["stmt"].whereclause)


class TestBulkApproveSeparationOfDuties:
    """AH-4: the bulk-approve path must honor the same no-self-approval control
    the single-entry path enforces, or an officer with admin_hours.manage could
    self-credit at scale by bulk-approving their own PENDING entries."""

    @staticmethod
    def _pending(entry_id, user_id):
        return SimpleNamespace(
            id=entry_id,
            organization_id="org-1",
            user_id=user_id,
            status=AdminHoursEntryStatus.PENDING,
            approved_by=None,
            approved_at=None,
        )

    async def test_self_owned_entries_are_skipped(self):
        approver = "officer-1"
        own = self._pending("e-own", approver)
        other = self._pending("e-other", "member-2")
        db = _db([_one(own), _one(other)])

        count = await AdminHoursService(db).bulk_approve(
            entry_ids=["e-own", "e-other"],
            organization_id="org-1",
            approver_id=approver,
        )

        assert count == 1
        # Self-owned entry left untouched for another approver.
        assert own.status == AdminHoursEntryStatus.PENDING
        assert own.approved_by is None
        # Another member's entry is approved as before.
        assert other.status == AdminHoursEntryStatus.APPROVED
        assert other.approved_by == approver

    async def test_batch_of_only_self_entries_approves_nothing(self):
        approver = "officer-1"
        own_a = self._pending("e-a", approver)
        own_b = self._pending("e-b", approver)
        db = _db([_one(own_a), _one(own_b)])

        count = await AdminHoursService(db).bulk_approve(
            entry_ids=["e-a", "e-b"],
            organization_id="org-1",
            approver_id=approver,
        )

        assert count == 0
        assert own_a.status == AdminHoursEntryStatus.PENDING
        assert own_b.status == AdminHoursEntryStatus.PENDING


class TestClockOutOrgScoped:
    """`clock_out` used to filter only id + user_id; `clock_out_by_category`
    already had the org filter for the same class of query (CLAUDE.md
    Pitfall #14a) — this closes the sibling gap on `clock_out` itself."""

    async def _capturing_db(self, result):
        captured = {}

        async def _exec(stmt, *a, **k):
            captured["stmt"] = stmt
            return result

        db = MagicMock()
        db.execute = AsyncMock(side_effect=_exec)
        db.flush = AsyncMock()
        return db, captured

    async def test_query_is_org_scoped(self):
        db, captured = await self._capturing_db(_one(None))
        with pytest.raises(ValueError, match="No active session"):
            await AdminHoursService(db).clock_out("entry-1", "u1", "org-1")
        assert "organization_id" in str(captured["stmt"].whereclause)


class TestClockInLocking:
    """Pitfall #27: two concurrent clock-ins for the same user (a double-tap,
    or two open tabs) must not both pass the "no active session" check and
    both insert an ACTIVE row."""

    async def test_locks_the_user_row_before_checking_for_an_active_session(self):
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(_category())
            if len(captured) == 2:
                return MagicMock()  # the User row lock; result discarded
            return _one(None)  # locking active-session check: none found

        db = MagicMock()
        db.execute = execute
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")

        assert len(captured) == 3
        assert "FOR UPDATE" in str(captured[1])
        assert "users" in str(captured[1]).lower()
        assert "FOR UPDATE" in str(captured[2])
        assert "admin_hours_entries" in str(captured[2]).lower()


class TestUpdateCategoryNullabilityGuard:
    """update_category now routes through apply_updates instead of a blind
    setattr loop: an explicit null against a nullable column still clears
    it (the documented behavior), but a null against a NOT NULL column
    (name) raises a clean ValueError instead of a flush-time
    IntegrityError."""

    async def test_name_cannot_be_nulled(self):
        from app.models.admin_hours import AdminHoursCategory

        category = AdminHoursCategory(
            id="cat-1", organization_id="org-1", name="Station Duty"
        )
        db = _db([_one(category)])
        with pytest.raises(ValueError, match="cannot be cleared"):
            await AdminHoursService(db).update_category(
                "cat-1", "org-1", "admin-1", name=None
            )

    async def test_description_can_be_cleared(self):
        from app.models.admin_hours import AdminHoursCategory

        category = AdminHoursCategory(
            id="cat-1",
            organization_id="org-1",
            name="Station Duty",
            description="old copy",
        )
        db = _db([_one(category)])
        out = await AdminHoursService(db).update_category(
            "cat-1", "org-1", "admin-1", description=None
        )
        assert out.description is None


class TestEditPendingEntryParityGuards:
    """edit_pending_entry now applies the same future/24h-cap/overlap guards
    create_manual_entry does — an edit can move times just as freely as the
    original manual entry could."""

    @staticmethod
    def _pending_entry():
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id="entry-1",
            organization_id="org-1",
            user_id="u1",
            category_id="cat-1",
            clock_in_at=now - timedelta(hours=3),
            clock_out_at=now - timedelta(hours=1),
            duration_minutes=120,
            description=None,
            status=AdminHoursEntryStatus.PENDING,
        )

    async def test_edit_exceeding_24h_cap_is_rejected(self):
        entry = self._pending_entry()
        # clock_in_at far enough in the past that a >24h span still lands
        # before "now" — otherwise the future-check fires first.
        entry.clock_in_at = datetime.now(timezone.utc) - timedelta(hours=30)
        db = _db([_one(entry)])
        new_out = entry.clock_in_at + timedelta(hours=25)
        with pytest.raises(ValueError, match="cannot exceed 24 hours"):
            await AdminHoursService(db).edit_pending_entry(
                entry_id="entry-1",
                organization_id="org-1",
                admin_id="admin-1",
                clock_out_at=new_out,
            )

    async def test_edit_creating_an_overlap_is_rejected(self):
        entry = self._pending_entry()
        db = _db([_one(entry), MagicMock(scalar=MagicMock(return_value=1))])
        new_out = entry.clock_in_at + timedelta(hours=1)
        with pytest.raises(ValueError, match="overlaps"):
            await AdminHoursService(db).edit_pending_entry(
                entry_id="entry-1",
                organization_id="org-1",
                admin_id="admin-1",
                clock_out_at=new_out,
            )

    async def test_edit_into_the_future_is_rejected(self):
        entry = self._pending_entry()
        db = _db([_one(entry)])
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        with pytest.raises(ValueError, match="future"):
            await AdminHoursService(db).edit_pending_entry(
                entry_id="entry-1",
                organization_id="org-1",
                admin_id="admin-1",
                clock_out_at=future,
            )

    async def test_overlap_check_excludes_the_entry_being_edited(self):
        """Otherwise every edit would "overlap" its own unchanged span."""
        entry = self._pending_entry()
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(entry)
            return MagicMock(scalar=MagicMock(return_value=0))

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        new_out = entry.clock_in_at + timedelta(hours=1)
        await AdminHoursService(db).edit_pending_entry(
            entry_id="entry-1",
            organization_id="org-1",
            admin_id="admin-1",
            clock_out_at=new_out,
        )

        assert "entry-1" in str(
            captured[-1].compile(compile_kwargs={"literal_binds": True})
        )


class TestEventHourMappingPercentageLocking:
    """Pitfall #27: two concurrent creates/updates for the same event
    source (event_type or custom_category) must not both read a percentage
    total under 100 and jointly exceed it."""

    async def test_create_percentage_check_is_a_locking_read(self):
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(_category())  # target category lookup
            return MagicMock(scalar=MagicMock(return_value=0))

        db = MagicMock()
        db.execute = execute
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        await AdminHoursService(db).create_event_hour_mapping(
            organization_id="org-1",
            created_by="admin-1",
            event_type="drill",
            custom_category=None,
            admin_hours_category_id="cat-1",
            percentage=50,
        )

        assert "FOR UPDATE" in str(captured[-1])

    async def test_update_percentage_check_is_a_locking_read(self):
        mapping = SimpleNamespace(
            id="map-1",
            organization_id="org-1",
            event_type="drill",
            custom_category=None,
            percentage=50,
            is_active=True,
        )
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(mapping)  # mapping fetch
            return MagicMock(scalar=MagicMock(return_value=0))

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        await AdminHoursService(db).update_event_hour_mapping(
            mapping_id="map-1", organization_id="org-1", percentage=60
        )

        assert "FOR UPDATE" in str(captured[-1])


class TestUserHoursComplianceOrgScoped:
    """The target user fetch and the hours-sum query previously carried no
    organization_id filter at all: an admin caller could pass any user_id,
    including one from another organization, and the User row (plus
    membership_type/positions used for profile matching) would resolve
    regardless of tenant."""

    async def test_user_fetch_query_is_org_scoped(self):
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            return _one(None)  # user not found in this org -> []

        db = MagicMock()
        db.execute = execute

        out = await AdminHoursService(db).get_user_hours_compliance(
            organization_id="org-1", user_id="user-from-another-org", year=2026
        )

        assert out == []
        assert "organization_id" in str(captured[0].whereclause)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
