"""
Focused org-scoping tests for the scheduling service (SCH-6).

A client-supplied apparatus_id on a shift, and a manual-hours user_id at
finalization, must belong to the caller's org — otherwise a shift carries a
foreign apparatus reference or a foreign member is credited hours on this org's
shift. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.scheduling_service import SchedulingService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _all(items):
    r = MagicMock()
    r.all.return_value = items
    return r


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _scalars_first(obj):
    """Mock a result whose ``.scalars().first()`` yields ``obj``.

    ``apparatus_ref_exists`` queries both apparatus tables in turn, so a
    rejection needs two misses and an acceptance needs a hit in one of them.
    """
    r = MagicMock()
    r.scalars.return_value.first.return_value = obj
    return r


class TestCreateShiftApparatusScoping:
    async def test_rejects_foreign_apparatus(self):
        """Neither apparatus table has it, so it is rejected before any write."""
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),  # not a full Apparatus in this org
                _scalars_first(None),  # not a BasicApparatus in this org either
            ]
        )
        db.add = MagicMock()
        svc = SchedulingService(db)
        shift, err = await svc.create_shift("org-1", {"apparatus_id": "aFOREIGN"}, "u1")
        assert shift is None
        assert err == "Apparatus not found"
        db.add.assert_not_called()

    async def test_accepts_a_basic_apparatus_id(self):
        """The onboarding-only case: a shift's apparatus is a BasicApparatus."""
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),  # not a full Apparatus
                _scalars_first(SimpleNamespace(id="basic-1")),  # but a BasicApparatus
            ]
        )
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)

        shift, err = await svc.create_shift("org-1", {"apparatus_id": "basic-1"}, "u1")

        assert err is None
        assert shift is not None
        db.add.assert_called_once()

    async def test_accepts_a_full_apparatus_id(self):
        """Regression: this used to fail with "Apparatus not found".

        ``GET /scheduling/apparatus-options`` serves full ``Apparatus`` ids
        whenever that module has records, but the validator checked
        ``BasicApparatus`` only — so a department on the Apparatus module could
        not assign an apparatus to a shift at all. It rejected the very ids it
        had just offered.
        """
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars_first(SimpleNamespace(id="app-1"))]
        )
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)

        shift, err = await svc.create_shift("org-1", {"apparatus_id": "app-1"}, "u1")

        assert err is None
        assert shift is not None
        db.add.assert_called_once()

    async def test_imports_full_apparatus_crew_positions_and_staffing(self):
        apparatus = SimpleNamespace(
            id="app-1",
            crew_positions=["officer", "driver", "firefighter", "firefighter"],
            min_staffing=3,
        )
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars_first(apparatus)])
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)

        shift, err = await svc.create_shift("org-1", {"apparatus_id": "app-1"}, "u1")

        assert err is None
        assert shift.positions == [
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "firefighter",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "firefighter",
                "required": True,
                "allow_administrative_members": False,
            },
        ]
        assert shift.min_staffing == 3


class TestUpdateShiftApparatusScoping:
    async def test_rejects_foreign_apparatus_on_update(self):
        """The update path carries the same guard as create."""
        existing = SimpleNamespace(
            id="s1",
            organization_id="org-1",
            shift_officer_id=None,
            is_finalized=False,
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(existing),  # get_shift_by_id
                _scalars_first(None),  # not a full Apparatus
                _scalars_first(None),  # not a BasicApparatus
            ]
        )
        svc = SchedulingService(db)

        shift, err = await svc.update_shift("s1", "org-1", {"apparatus_id": "aFOREIGN"})

        assert shift is None
        assert err == "Apparatus not found"

    async def test_imports_staffing_when_apparatus_changes(self):
        existing = SimpleNamespace(
            id="s1",
            organization_id="org-1",
            shift_officer_id=None,
            is_finalized=False,
            positions=[{"position": "old-seat", "required": True}],
            min_staffing=1,
        )
        apparatus = SimpleNamespace(
            id="app-2",
            crew_positions=["officer", "driver"],
            min_staffing=2,
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(existing),
                _scalars_first(apparatus),
                # Moving the apparatus re-checks the shift's drivers against
                # the new unit; this shift has no assignments.
                _scalars([]),
            ]
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.flush = AsyncMock()
        db.add = MagicMock()
        svc = SchedulingService(db)

        shift, err = await svc.update_shift("s1", "org-1", {"apparatus_id": "app-2"})

        assert err is None
        assert shift.positions == [
            {
                "position": "officer",
                "required": True,
                "allow_administrative_members": False,
            },
            {
                "position": "driver",
                "required": True,
                "allow_administrative_members": False,
            },
        ]
        assert shift.min_staffing == 2


class TestFinalizeManualHoursScoping:
    async def test_rejects_foreign_manual_hours_user(self):
        now = datetime.now(timezone.utc)
        shift = SimpleNamespace(
            id="s1",
            organization_id="org-1",
            is_finalized=False,
            end_time=now - timedelta(hours=1),  # ended
            start_time=now - timedelta(hours=9),
            settings=None,
        )
        org = SimpleNamespace(id="org-1", settings={})  # no end-of-shift checks
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(shift),  # get_shift_by_id
                _one(org),  # Organization settings lookup
                _all([]),  # existing attendance user_ids
                _one(None),  # _user_in_org -> foreign
            ]
        )
        db.add = MagicMock()
        db.flush = AsyncMock()
        svc = SchedulingService(db)
        result, err = await svc.finalize_shift(
            "s1",
            "org-1",
            finalized_by_user_id="officer-1",
            manual_hours=[{"user_id": "uFOREIGN", "hours": 8}],
        )
        assert result is None
        assert err == "One or more members are not in your organization"
        db.add.assert_not_called()


class TestTemplateApparatusScoping:
    """SCH-7 (pass 2): a shift template's apparatus_id is stamped onto every
    generated shift, so create/update_template must validate it in-org like
    create_shift — otherwise a foreign apparatus persists on the template and
    silently drops the min-staffing/checklist wiring on generated shifts."""

    async def test_create_rejects_foreign_apparatus(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),  # not a full Apparatus in this org
                _scalars_first(None),  # not a BasicApparatus either
            ]
        )
        db.add = MagicMock()
        svc = SchedulingService(db)
        template, err = await svc.create_template(
            "org-1", {"name": "A shift", "apparatus_id": "aFOREIGN"}, "u1"
        )
        assert template is None
        assert err == "Apparatus not found"
        db.add.assert_not_called()

    async def test_update_rejects_foreign_apparatus(self):
        template = SimpleNamespace(id="t1", organization_id="org-1")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(template),  # get_template_by_id (in-org)
                _scalars_first(None),  # not a full Apparatus
                _scalars_first(None),  # not a BasicApparatus
            ]
        )
        svc = SchedulingService(db)
        result, err = await svc.update_template(
            "t1", "org-1", {"apparatus_id": "aFOREIGN"}
        )
        assert result is None
        assert err == "Apparatus not found"


class TestShiftCallRespondingMembersScoping:
    """responding_members is a client-supplied list of user ids stored
    straight into JSON. Every reader of it (compute_member_call_counts,
    ShiftCompletionService's trainee lookup) is scoped to one already
    org-validated shift/trainee first, so a foreign id here can never
    attribute a count to another org's member — but it's still an
    unvalidated write of this org's own data, and the one exception to
    this file's otherwise-universal discipline of validating every
    client-supplied user id before persisting. Validated in-org via a
    single batched query (up to 100 entries per payload, so a per-id
    loop would cost up to 100 serial round trips)."""

    async def test_create_rejects_foreign_responding_member(self):
        shift = SimpleNamespace(id="s1", organization_id="org-1")
        org = SimpleNamespace(id="org-1", settings={})
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(shift),  # get_shift_by_id
                _one(org),  # CallTrackingService.get_settings -> _get_org
                _scalars([]),  # _all_users_in_org -> none found, foreign
            ]
        )
        db.add = MagicMock()
        svc = SchedulingService(db)
        call, err = await svc.create_shift_call(
            "org-1",
            "s1",
            {"incident_type": "medical", "responding_members": ["uFOREIGN"]},
        )
        assert call is None
        assert err == "One or more members are not in your organization"
        db.add.assert_not_called()

    async def test_create_accepts_in_org_responding_members(self):
        shift = SimpleNamespace(id="s1", organization_id="org-1")
        org = SimpleNamespace(id="org-1", settings={})
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(shift),  # get_shift_by_id
                _one(org),  # CallTrackingService.get_settings -> _get_org
                _scalars(["u1", "u2"]),  # _all_users_in_org -> both found
            ]
        )
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)
        call, err = await svc.create_shift_call(
            "org-1",
            "s1",
            {"incident_type": "medical", "responding_members": ["u1", "u2"]},
        )
        assert err is None
        db.add.assert_called_once()

    async def test_update_rejects_foreign_responding_member(self):
        call = SimpleNamespace(id="c1", organization_id="org-1")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(call),  # get_shift_call_by_id
                _scalars([]),  # _all_users_in_org -> none found, foreign
            ]
        )
        svc = SchedulingService(db)
        result, err = await svc.update_shift_call(
            "c1", "org-1", {"responding_members": ["uFOREIGN"]}
        )
        assert result is None
        assert err == "One or more members are not in your organization"

    async def test_update_ignores_a_partial_match(self):
        """One valid id and one foreign id must still reject the whole call
        — a batched query has to compare the full set, not just non-empty."""
        call = SimpleNamespace(id="c1", organization_id="org-1")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(call),  # get_shift_call_by_id
                _scalars(["u1"]),  # only u1 found; uFOREIGN is not
            ]
        )
        svc = SchedulingService(db)
        result, err = await svc.update_shift_call(
            "c1", "org-1", {"responding_members": ["u1", "uFOREIGN"]}
        )
        assert result is None
        assert err == "One or more members are not in your organization"
