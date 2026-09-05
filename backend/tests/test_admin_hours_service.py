"""
Tests for the admin hours service (app/services/admin_hours_service.py).

This is a timeclock: QR clock-in/clock-out with duration math and an
approval policy. Covers _determine_post_clockout_status (the approve/pend
decision), clock_in guards (category missing/inactive, already-clocked-in,
busy-elsewhere), clock_out duration + status stamping, and create_manual_entry
validation (ordering, no future, minimum duration, overlap). DB mocked.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.admin_hours import AdminHoursEntryStatus
from app.services.admin_hours_service import AdminHoursService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _owner_lookup(user_ids):
    """Mocks bulk_approve's unlocked `AdminHoursEntry.user_id` owner-lookup
    query, whose result is consumed via `.all()`, not `scalar_one_or_none()`."""
    return MagicMock(all=MagicMock(return_value=[(uid,) for uid in user_ids]))


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
        # category fetch, then the User-row lock (Pitfall #27; result
        # discarded) — `_check_overlap` itself is mocked below, so it issues
        # no `db.execute` of its own.
        svc = AdminHoursService(_db([_one(category), MagicMock()]))
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

    @staticmethod
    def _lock_prelude(entry):
        """The owner lookup + User-row lock (Pitfall #27) every
        `edit_pending_entry` call now issues before the (locked) entry
        fetch — see `TestEditPendingEntryLocking` for the dedicated
        assertions on this sequence itself."""
        return [_one(entry.user_id), MagicMock()]

    async def test_naive_edit_time_rejected_with_clear_error(self):
        # An admin edit sends only the changed field; a naive edited value is
        # ambiguous and would be compared against the aware stored counterpart
        # (TypeError -> 500 before, silently shifted hours if assumed UTC).
        entry = self._pending_entry()
        db = _db([*self._lock_prelude(entry), _one(entry)])
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
        # lock prelude, entry fetch, then the overlap check (no overlap).
        db = _db(
            [
                *self._lock_prelude(entry),
                _one(entry),
                MagicMock(scalar=MagicMock(return_value=0)),
            ]
        )
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
        db = _db([*self._lock_prelude(entry), _one(entry)])
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
        # bulk_approve first locks the batch's distinct member User rows
        # (Pitfall #27, see TestBulkApproveLocking), then processes entry
        # ids in sorted order, not the client-supplied order — "e-other"
        # sorts before "e-own" — so the mocked results are supplied in that
        # same sequence: owner lookup, one member-row lock per distinct
        # member, then the entry fetches themselves.
        db = _db(
            [
                _owner_lookup([approver, "member-2"]),
                MagicMock(),  # member-2's User-row lock
                MagicMock(),  # officer-1's User-row lock
                _one(other),
                _one(own),
            ]
        )

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
        # Both entries share one owner, so only one member-row lock is
        # taken despite there being two entries.
        db = _db(
            [
                _owner_lookup([approver]),
                MagicMock(),  # officer-1's User-row lock
                _one(own_a),
                _one(own_b),
            ]
        )

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
        db = _db([_one(entry.user_id), MagicMock(), _one(entry)])
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
        db = _db(
            [
                _one(entry.user_id),
                MagicMock(),
                _one(entry),
                MagicMock(scalar=MagicMock(return_value=1)),
            ]
        )
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
        db = _db([_one(entry.user_id), MagicMock(), _one(entry)])
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
                return _one(entry.user_id)  # owner lookup
            if len(captured) == 2:
                return MagicMock()  # User-row lock; result discarded
            if len(captured) == 3:
                return _one(entry)  # locked entry re-fetch
            return MagicMock(scalar=MagicMock(return_value=0))  # overlap check

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


class TestCreateManualEntryLocking:
    """Codex finding (pass-3 review): the overlap check in create_manual_entry
    was a read-then-write race with no lock (Pitfall #27) — two simultaneous
    manual-entry submissions for the same member could each see zero overlap
    from `_check_overlap` and both insert an overlapping PENDING entry."""

    async def test_locks_the_user_row_before_the_locking_overlap_check(self):
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(_category(require_approval=False))
            if len(captured) == 2:
                return MagicMock()  # the User row lock; result discarded
            return MagicMock(scalar=MagicMock(return_value=0))  # overlap check

        db = MagicMock()
        db.execute = execute
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        now = datetime.now(timezone.utc)
        await AdminHoursService(db).create_manual_entry(
            "org-1",
            "u1",
            "cat-1",
            now - timedelta(hours=2),
            now - timedelta(hours=1),
        )

        assert len(captured) == 3
        assert "FOR UPDATE" in str(captured[1])
        assert "users" in str(captured[1]).lower()
        assert "FOR UPDATE" in str(captured[2])
        assert "admin_hours_entries" in str(captured[2]).lower()


class TestEditPendingEntryLocking:
    """Codex finding (pass-3 review): edit_pending_entry read a PENDING entry
    with no lock before mutating it. If one officer edits an entry's duration
    while another approves it, both could pass the pending-state check and
    their updates could combine into an approved entry containing hours the
    approver never reviewed. This locks the member's User row (Pitfall #27,
    same order as create_manual_entry to avoid a lock-order-inversion
    deadlock) ahead of a locked re-fetch of the entry itself."""

    async def test_locks_the_user_row_then_the_entry_before_mutating(self):
        entry = TestEditPendingEntry._pending_entry()
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(entry.user_id)  # owner lookup (unlocked)
            if len(captured) == 2:
                return MagicMock()  # User-row lock; result discarded
            if len(captured) == 3:
                return _one(entry)  # locked entry re-fetch
            return MagicMock(scalar=MagicMock(return_value=0))  # overlap check

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

        assert len(captured) == 4
        assert "FOR UPDATE" not in str(captured[0])
        assert "FOR UPDATE" in str(captured[1])
        assert "users" in str(captured[1]).lower()
        assert "FOR UPDATE" in str(captured[2])
        assert "admin_hours_entries" in str(captured[2]).lower()
        assert "FOR UPDATE" in str(captured[3])

    async def test_missing_entry_raises_before_taking_any_lock(self):
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            return _one(None)

        db = MagicMock()
        db.execute = execute

        with pytest.raises(ValueError, match="not found"):
            await AdminHoursService(db).edit_pending_entry(
                entry_id="missing",
                organization_id="org-1",
                admin_id="admin-1",
                clock_out_at=datetime.now(timezone.utc),
            )
        assert len(captured) == 1


class TestApproveOrRejectLocking:
    """Codex finding (pass-3 review): approve_or_reject read a PENDING entry
    with no lock. Locking it here forces a concurrent edit or a second
    approval on the same row to re-evaluate the committed status instead of
    combining updates with this one."""

    async def test_entry_fetch_is_a_locking_read(self):
        entry = SimpleNamespace(
            id="entry-1",
            organization_id="org-1",
            user_id="u1",
            status=AdminHoursEntryStatus.PENDING,
            approved_by=None,
            approved_at=None,
        )
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            return _one(entry)

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        await AdminHoursService(db).approve_or_reject(
            entry_id="entry-1",
            organization_id="org-1",
            approver_id="officer-1",
            action="approve",
        )

        assert "FOR UPDATE" in str(captured[0])


class TestBulkApproveLocking:
    """Codex finding (pass-3 review): bulk_approve's per-entry fetch needs
    the same lock as approve_or_reject's. Separately, ids must be processed
    in a fixed order — two concurrent bulk-approve calls over overlapping id
    sets that each locked rows in client-supplied order could lock in
    opposite sequences and deadlock, the same lock-order-inversion shape
    AH-11 hit on event-hour-mapping percentage locking.

    Follow-up Codex finding on that fix: sorting only this method's own
    batch of entry ids isn't a *shared* lock order with `edit_pending_entry`,
    which locks the owning member's User row before the entry row. A batch
    containing two entries for the same member, racing a concurrent edit
    whose locking overlap check reaches into the other entry in the batch,
    could still deadlock. `TestLocksMemberRowsBeforeEntryRows` below covers
    the fix: every affected member row is now locked, in sorted order,
    before any entry row lock is taken."""

    async def test_entry_fetches_are_locking_reads(self):
        entry = TestBulkApproveSeparationOfDuties._pending("e-1", "member-2")
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _owner_lookup(["member-2"])  # unlocked owner lookup
            if len(captured) == 2:
                return MagicMock()  # member-2's User-row lock; discarded
            return _one(entry)

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()

        await AdminHoursService(db).bulk_approve(
            entry_ids=["e-1"], organization_id="org-1", approver_id="officer-1"
        )

        assert len(captured) == 3
        assert "FOR UPDATE" not in str(captured[0])
        assert "FOR UPDATE" in str(captured[1])
        assert "users" in str(captured[1]).lower()
        assert "FOR UPDATE" in str(captured[-1])
        assert "admin_hours_entries" in str(captured[-1]).lower()

    async def test_processes_ids_in_sorted_order_not_client_order(self):
        entries = {
            "e-b": TestBulkApproveSeparationOfDuties._pending("e-b", "member-2"),
            "e-a": TestBulkApproveSeparationOfDuties._pending("e-a", "member-3"),
        }
        seen_ids = []

        async def execute(stmt, *_a, **_kw):
            compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            if "FOR UPDATE" not in compiled:
                return _owner_lookup(["member-2", "member-3"])  # owner lookup
            if "users" in compiled.lower():
                return MagicMock()  # a member's User-row lock; discarded
            for entry_id, entry in entries.items():
                if entry_id in compiled:
                    seen_ids.append(entry_id)
                    return _one(entry)
            raise AssertionError("unexpected query")

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()

        await AdminHoursService(db).bulk_approve(
            entry_ids=["e-b", "e-a"], organization_id="org-1", approver_id="officer-1"
        )

        assert seen_ids == ["e-a", "e-b"]


class TestBulkApproveMemberRowLocking:
    """Follow-up Codex finding: bulk_approve locked only entry rows, sorted
    among themselves — not a shared global lock order with
    `edit_pending_entry`, which locks the owning member's User row before
    the entry row. Two entries in one batch for the same member, racing an
    `edit_pending_entry` whose locking overlap check reaches into the
    other entry in that batch, could deadlock: bulk_approve holding entry A
    and waiting on entry B, while the edit holds the member's User row and
    entry B and waits on entry A. Locking every affected member row first,
    in sorted order, closes this — both methods now agree on "member rows
    first, then entry rows, both in a stable order.\" """

    async def test_member_rows_are_locked_before_any_entry_row(self):
        entry_a = TestBulkApproveSeparationOfDuties._pending("e-a", "member-a")
        entry_b = TestBulkApproveSeparationOfDuties._pending("e-b", "member-b")
        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                # The unlocked owner lookup — reports both members, out of
                # sorted order, to prove the code (not the mock) sorts them.
                return _owner_lookup(["member-b", "member-a"])
            if len(captured) == 2:
                return MagicMock()  # member-a's User-row lock; discarded
            if len(captured) == 3:
                return MagicMock()  # member-b's User-row lock; discarded
            if len(captured) == 4:
                return _one(entry_a)
            return _one(entry_b)

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()

        await AdminHoursService(db).bulk_approve(
            entry_ids=["e-b", "e-a"], organization_id="org-1", approver_id="officer-1"
        )

        assert len(captured) == 5
        assert "FOR UPDATE" not in str(captured[0])
        # Both member locks precede both entry locks.
        assert "FOR UPDATE" in str(captured[1])
        assert "users" in str(captured[1]).lower()
        assert "FOR UPDATE" in str(captured[2])
        assert "users" in str(captured[2]).lower()
        assert "FOR UPDATE" in str(captured[3])
        assert "admin_hours_entries" in str(captured[3]).lower()
        assert "FOR UPDATE" in str(captured[4])
        assert "admin_hours_entries" in str(captured[4]).lower()

    async def test_member_locks_use_sorted_member_id_order_not_lookup_order(self):
        entry = TestBulkApproveSeparationOfDuties._pending("e-1", "member-z")
        seen_member_order = []

        async def execute(stmt, *_a, **_kw):
            compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            if "FOR UPDATE" not in compiled:
                # Reported in reverse of sorted order, on purpose.
                return _owner_lookup(["member-z", "member-a"])
            if "users" in compiled.lower():
                for candidate in ("member-a", "member-z"):
                    if candidate in compiled:
                        seen_member_order.append(candidate)
                        return MagicMock()
                raise AssertionError(f"unexpected User lock query: {compiled}")
            return _one(entry)

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()

        await AdminHoursService(db).bulk_approve(
            entry_ids=["e-1"], organization_id="org-1", approver_id="officer-1"
        )

        assert seen_member_order == ["member-a", "member-z"]

    async def test_duplicate_owners_lock_only_one_member_row(self):
        entry_a = TestBulkApproveSeparationOfDuties._pending("e-a", "member-a")
        entry_b = TestBulkApproveSeparationOfDuties._pending("e-b", "member-a")
        member_lock_count = 0

        async def execute(stmt, *_a, **_kw):
            compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            nonlocal member_lock_count
            if "FOR UPDATE" not in compiled:
                return _owner_lookup(["member-a", "member-a"])
            if "users" in compiled.lower():
                member_lock_count += 1
                return MagicMock()
            for entry_id, entry in (("e-a", entry_a), ("e-b", entry_b)):
                if entry_id in compiled:
                    return _one(entry)
            raise AssertionError("unexpected query")

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()

        await AdminHoursService(db).bulk_approve(
            entry_ids=["e-a", "e-b"], organization_id="org-1", approver_id="officer-1"
        )

        assert member_lock_count == 1


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

        def _scalars(items):
            r = MagicMock()
            r.scalars.return_value.all.return_value = items
            return r

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(mapping)  # mapping fetch
            return _scalars([mapping])  # locked source set

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        await AdminHoursService(db).update_event_hour_mapping(
            mapping_id="map-1", organization_id="org-1", percentage=60
        )

        assert "FOR UPDATE" in str(captured[-1])

    async def test_locked_set_includes_the_target_row_itself(self):
        """Codex review (PR #1903): locking only the *other* mappings
        (excluding the target) let two concurrent updates for two different
        mappings under the same source each lock the row the other was
        about to write to, then deadlock at flush. The target must be part
        of the same locked set, not excluded from it."""
        mapping = SimpleNamespace(
            id="map-1",
            organization_id="org-1",
            event_type="drill",
            custom_category=None,
            percentage=50,
            is_active=True,
        )
        captured = []

        def _scalars(items):
            r = MagicMock()
            r.scalars.return_value.all.return_value = items
            return r

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            if len(captured) == 1:
                return _one(mapping)
            return _scalars([mapping])

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        await AdminHoursService(db).update_event_hour_mapping(
            mapping_id="map-1", organization_id="org-1", percentage=60
        )

        locking_query = captured[-1]
        assert "map-1" not in str(
            locking_query.compile(compile_kwargs={"literal_binds": True})
        ), "the target's own id must not be excluded from the locked set"
        assert "ORDER BY" in str(locking_query).upper()


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


def _compliance_category():
    return SimpleNamespace(
        id="cat-1", organization_id="org-1", name="Drill", color="#000"
    )


def _compliance_user():
    return SimpleNamespace(
        id="user-1", organization_id="org-1", membership_type="active", positions=[]
    )


def _compliance_profile(frequency, override):
    return SimpleNamespace(
        is_active=True,
        admin_hours_requirements=[
            {"category_id": "cat-1", "required_hours": 10, "frequency": frequency}
        ],
        membership_types=[],
        role_ids=[],
        priority=1,
        at_risk_threshold_override=override,
    )


def _config_result(config):
    r = MagicMock()
    r.scalars.return_value.first.return_value = config
    return r


async def _run_compliance(year, frequency="annual", override=None, logged_minutes=0):
    config = SimpleNamespace(
        organization_id="org-1",
        at_risk_threshold=75,
        profiles=[_compliance_profile(frequency, override)],
    )
    category = _compliance_category()
    user = _compliance_user()
    calls = []

    async def execute(stmt, *_a, **_kw):
        calls.append(stmt)
        if len(calls) == 1:
            return _one(user)
        if len(calls) == 2:
            return _config_result(config)
        if len(calls) == 3:
            return _one(category)
        return MagicMock(scalar=MagicMock(return_value=logged_minutes))

    db = MagicMock()
    db.execute = execute

    return await AdminHoursService(db).get_user_hours_compliance(
        organization_id="org-1", user_id="user-1", year=year
    )


class TestAtRiskThresholdOverrideZero:
    """Codex finding (pass-3 review): `best_profile.at_risk_threshold_override
    or config.at_risk_threshold` treats a deliberate override of 0 — a value
    the schema explicitly permits — the same as "no override" and silently
    falls back to the org default, because `0` is falsy. A profile that wants
    every shortfall graded non_compliant with no at-risk buffer had that
    choice discarded."""

    async def test_zero_override_is_honored_not_discarded(self):
        # 50% progress (5 of 10 hours). An override of 0 means "no at-risk
        # buffer" — pct(50) is not below a threshold of 0, so the correct
        # reading is at_risk, not non_compliant.
        results = await _run_compliance(year=2026, override=0, logged_minutes=5 * 60)
        assert len(results) == 1
        assert results[0]["status"] == "at_risk"

    async def test_none_override_still_falls_back_to_the_org_default(self):
        # No override at all: the org default of 75 must still apply.
        results = await _run_compliance(year=2026, override=None, logged_minutes=5 * 60)
        assert len(results) == 1
        assert results[0]["status"] == "non_compliant"


class TestQuarterlyComplianceRequestedYear:
    """Codex finding (pass-3 review): a quarterly requirement discarded the
    endpoint's `year` argument and built its bounds from
    `date.today().year`, so `?year=2024` silently graded the live quarter of
    today's real year while annual requirements in the same response were
    correctly graded against 2024.

    Follow-up Codex finding on that fix: the first fix replaced the
    mis-dated grading with a silent `continue`, which traded a wrong answer
    for a missing one. Omitting the quarterly item left a response that
    *looks* complete (annual items present) with no way for the caller to
    tell "this profile has no quarterly requirement" from "it has one, and
    it was silently not graded for the year you asked about." Requesting a
    quarterly-graded profile for any year but the current one is now
    rejected outright with a `ValueError` (-> `HTTPException(400, ...)` at
    the endpoint), before any per-requirement query runs, rather than
    answering with an incomplete list."""

    async def test_quarterly_requirement_for_a_past_year_is_rejected(self):
        past_year = date.today().year - 1
        with pytest.raises(ValueError, match="[Qq]uarterly"):
            await _run_compliance(year=past_year, frequency="quarterly")

    async def test_quarterly_requirement_for_a_future_year_is_rejected(self):
        future_year = date.today().year + 1
        with pytest.raises(ValueError, match="[Qq]uarterly"):
            await _run_compliance(year=future_year, frequency="quarterly")

    async def test_quarterly_requirement_for_the_current_year_is_graded_as_before(self):
        current_year = date.today().year
        results = await _run_compliance(year=current_year, frequency="quarterly")
        assert len(results) == 1
        assert results[0]["period_start"].startswith(str(current_year))

    async def test_annual_requirement_still_honors_the_requested_year(self):
        past_year = date.today().year - 1
        results = await _run_compliance(year=past_year, frequency="annual")
        assert len(results) == 1
        assert results[0]["period_start"].startswith(str(past_year))

    async def test_mixed_profile_past_year_rejects_rather_than_dropping_quarterly(self):
        """The exact scenario the follow-up finding names: a profile with
        BOTH an annual and a quarterly requirement, requested for a past
        year. Silently omitting only the quarterly item would return a
        response containing just the annual item — indistinguishable from a
        profile that never had a quarterly requirement in the first place.
        The whole request is rejected instead of a partial response."""
        past_year = date.today().year - 1
        config = SimpleNamespace(
            organization_id="org-1",
            at_risk_threshold=75,
            profiles=[
                SimpleNamespace(
                    is_active=True,
                    admin_hours_requirements=[
                        {
                            "category_id": "cat-1",
                            "required_hours": 10,
                            "frequency": "annual",
                        },
                        {
                            "category_id": "cat-2",
                            "required_hours": 5,
                            "frequency": "quarterly",
                        },
                    ],
                    membership_types=[],
                    role_ids=[],
                    priority=1,
                    at_risk_threshold_override=None,
                )
            ],
        )
        user = _compliance_user()
        calls = []

        async def execute(stmt, *_a, **_kw):
            calls.append(stmt)
            if len(calls) == 1:
                return _one(user)
            return _config_result(config)

        db = MagicMock()
        db.execute = execute

        with pytest.raises(ValueError, match="[Qq]uarterly"):
            await AdminHoursService(db).get_user_hours_compliance(
                organization_id="org-1", user_id="user-1", year=past_year
            )
        # The rejection happens up front: only the user fetch and the
        # compliance-config fetch ran, before either requirement's
        # category/hours-sum queries -- proving no partial data was ever
        # assembled, not merely that the final response was empty.
        assert len(calls) == 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
