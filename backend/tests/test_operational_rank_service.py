"""
Tests for the operational rank service
(app/services/operational_rank_service.py).

Covers seeding (idempotency + the list-aliasing fix), CRUD with duplicate
rank_code guards, reorder, and the active-member rank validation that skips
inactive/archived members. DB mocked; no MySQL.
"""

import inspect
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import operational_ranks as ranks_ep
from app.core.permissions import get_rank_default_permissions
from app.schemas.operational_rank import RankCreate, RankResponse, RankUpdate
from app.services.operational_rank_service import (
    DEFAULT_RANKS,
    OperationalRankService,
    default_ranks_for,
)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(rows):
    return MagicMock(all=MagicMock(return_value=rows))


def _nested_transaction_cm():
    """A working `async with db.begin_nested():` stand-in (success path)."""
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=cm)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.begin_nested = MagicMock(return_value=_nested_transaction_cm())
    return db


def _seed_db(org_type="fire_department", count=0):
    """A db whose first execute answers the count, the second the agency type.

    ``seed_defaults`` reads ``Organization.organization_type`` to choose which
    ranks to write, so the order of these two matters.
    """
    return _db([_scalar(count), _one(org_type)])


class TestSeedDefaults:
    async def test_skips_when_ranks_exist(self):
        db = _db([_scalar(3)])
        out = await OperationalRankService(db).seed_defaults("org-1")
        assert out == []
        db.add.assert_not_called()

    async def test_seeds_full_default_set(self):
        db = _seed_db()
        out = await OperationalRankService(db).seed_defaults("org-1")
        assert len(out) == len(DEFAULT_RANKS)
        assert db.add.call_count == len(DEFAULT_RANKS)
        codes = {r.rank_code for r in out}
        assert "fire_chief" in codes
        assert "emt" in codes

    async def test_seeded_chief_ranks_do_not_alias_positions(self):
        # Regression: the chief ranks shared the same _ALL_POSITIONS list.
        db = _seed_db()
        out = await OperationalRankService(db).seed_defaults("org-1")
        by_code = {r.rank_code: r for r in out}
        chief = by_code["fire_chief"]
        deputy = by_code["deputy_chief"]
        assert chief.eligible_positions == deputy.eligible_positions
        assert chief.eligible_positions is not deputy.eligible_positions
        chief.eligible_positions.append("mutated")
        assert "mutated" not in deputy.eligible_positions

    async def test_concurrent_first_seed_rolls_back_instead_of_500(self):
        # Regression: two concurrent first-loads for a brand-new org can both
        # pass the count==0 check; the loser's flush hits the unique
        # constraint. Must return [] rather than let an IntegrityError escape
        # as an uncaught 500.
        db = _seed_db()
        db.flush = AsyncMock(side_effect=IntegrityError("stmt", {}, Exception("dup")))

        out = await OperationalRankService(db).seed_defaults("org-1")

        assert out == []
        db.refresh.assert_not_called()

    async def test_concurrent_first_seed_uses_savepoint_not_full_rollback(self):
        # A plain session-wide db.rollback() here would expire every object
        # in the request's identity map, including `current_user` loaded
        # earlier by get_current_user on the same request-scoped session --
        # the endpoint's next access to current_user.organization_id would
        # then need an implicit refresh outside the async greenlet context
        # and raise MissingGreenlet (the same bug class as the
        # reopen-attendance 500). The fix must use a SAVEPOINT
        # (begin_nested), which only expires objects modified within it, and
        # must never call the full session rollback() directly.
        db = _seed_db()
        db.flush = AsyncMock(side_effect=IntegrityError("stmt", {}, Exception("dup")))
        db.rollback = AsyncMock()

        out = await OperationalRankService(db).seed_defaults("org-1")

        assert out == []
        db.begin_nested.assert_called_once()
        db.rollback.assert_not_awaited()


class TestCrud:
    async def test_create_rejects_duplicate_code(self):
        db = _db([_one(SimpleNamespace(id="r1"))])  # existing found
        data = RankCreate(rank_code="captain", display_name="Captain")
        with pytest.raises(ValueError, match="already exists"):
            await OperationalRankService(db).create_rank(data, "org-1")
        db.commit.assert_not_awaited()

    async def test_create_succeeds(self):
        db = _db([_one(None)])  # no duplicate
        data = RankCreate(
            rank_code="captain", display_name="Captain", eligible_positions=["officer"]
        )
        rank = await OperationalRankService(db).create_rank(data, "org-1")
        assert rank.rank_code == "captain"
        assert rank.organization_id == "org-1"
        db.commit.assert_awaited()

    async def test_update_missing_returns_none(self):
        db = _db([_one(None)])  # get_rank -> None
        out = await OperationalRankService(db).update_rank(
            "r1", RankUpdate(display_name="X"), "org-1"
        )
        assert out is None

    async def test_update_applies_only_set_fields(self):
        rank = SimpleNamespace(
            id="r1", rank_code="captain", display_name="Captain", sort_order=3
        )
        db = _db([_one(rank)])  # get_rank
        out = await OperationalRankService(db).update_rank(
            "r1", RankUpdate(display_name="Senior Captain"), "org-1"
        )
        assert out.display_name == "Senior Captain"
        assert out.rank_code == "captain"  # untouched (exclude_unset)
        assert out.sort_order == 3

    async def test_update_rejects_duplicate_code(self):
        rank = SimpleNamespace(id="r1", rank_code="captain", display_name="Captain")
        # get_rank -> rank, then duplicate lookup -> a different rank
        db = _db([_one(rank), _one(SimpleNamespace(id="r2"))])
        with pytest.raises(ValueError, match="already exists"):
            await OperationalRankService(db).update_rank(
                "r1", RankUpdate(rank_code="lieutenant"), "org-1"
            )

    async def test_delete_missing_returns_false(self):
        db = _db([_one(None)])
        assert await OperationalRankService(db).delete_rank("r1", "org-1") is False

    async def test_delete_succeeds(self):
        rank = SimpleNamespace(id="r1")
        db = _db([_one(rank)])
        assert await OperationalRankService(db).delete_rank("r1", "org-1") is True
        db.delete.assert_awaited()
        db.commit.assert_awaited()


class TestReorder:
    async def test_updates_sort_order_for_found_ranks(self):
        r1 = SimpleNamespace(id="r1", sort_order=0)
        r2 = SimpleNamespace(id="r2", sort_order=0)
        # two get_rank lookups, then list_ranks
        db = _db([_one(r1), _one(r2), _scalars([r1, r2])])
        await OperationalRankService(db).reorder_ranks(
            "org-1", [{"id": "r1", "sort_order": 5}, {"id": "r2", "sort_order": 2}]
        )
        assert r1.sort_order == 5
        assert r2.sort_order == 2
        db.commit.assert_awaited()


class TestValidateRouteGate:
    """GET /validate backs a settings.manage-gated screen (SettingsPage's rank

    section) but had no server-side permission check of its own — any
    authenticated member could call it directly and see which members have a
    misconfigured rank. Must match its CRUD siblings in this router.
    """

    def test_validate_route_requires_settings_manage(self):
        dep = (
            inspect.signature(ranks_ep.validate_ranks)
            .parameters["current_user"]
            .default
        )
        assert "settings.manage" in dep.dependency.required_permissions


class TestValidateRanks:
    async def test_flags_only_unrecognised_active_ranks(self):
        valid_codes = _rows([("captain",), ("firefighter",)])
        members = _rows(
            [
                SimpleNamespace(
                    id="u1", first_name="Jane", last_name="Doe", rank="captain"
                ),
                SimpleNamespace(
                    id="u2", first_name="John", last_name="Roe", rank="ghost_rank"
                ),
            ]
        )
        db = _db([valid_codes, members])
        issues = await OperationalRankService(db).validate_ranks("org-1")
        assert issues == [
            {"member_id": "u2", "member_name": "John Roe", "rank_code": "ghost_rank"}
        ]

    async def test_no_issues_when_all_valid(self):
        db = _db(
            [
                _rows([("captain",)]),
                _rows(
                    [
                        SimpleNamespace(
                            id="u1", first_name="Jane", last_name="Doe", rank="captain"
                        )
                    ]
                ),
            ]
        )
        assert await OperationalRankService(db).validate_ranks("org-1") == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))


class TestSeedSetFollowsAgencyType:
    """An EMS-only service has no firefighters, and never will.

    Firefighter and EMT are independent ranks, not two rungs of one ladder:
    a member may hold either without the other. An EMS-only agency has the
    same officer ladder as anyone else and no fire line at all, so seeding it
    "Firefighter" hands it a rank nobody there can ever hold.

    This only gets one chance to be right. ``seed_defaults`` fires solely into
    an empty table, so whatever it writes on day one is what the department
    lives with unless somebody edits the list by hand.
    """

    async def test_ems_only_is_not_seeded_a_firefighter_rank(self):
        db = _seed_db("ems_only")
        out = await OperationalRankService(db).seed_defaults("org-1")
        codes = {r.rank_code for r in out}
        assert "firefighter" not in codes
        assert "emt" in codes, "an EMS agency still needs its line rank"

    async def test_ems_only_keeps_the_whole_officer_ladder(self):
        db = _seed_db("ems_only")
        out = await OperationalRankService(db).seed_defaults("org-1")
        codes = {r.rank_code for r in out}
        for officer in (
            "fire_chief",
            "deputy_chief",
            "assistant_chief",
            "captain",
            "lieutenant",
        ):
            assert officer in codes, f"EMS agencies have {officer} too"

    async def test_ems_only_relabels_the_fire_specific_names(self):
        db = _seed_db("ems_only")
        out = await OperationalRankService(db).seed_defaults("org-1")
        by_code = {r.rank_code: r for r in out}
        # The code is shared so it keys the same permissions everywhere; only
        # what the department reads on screen changes.
        assert by_code["fire_chief"].display_name == "Chief"
        assert by_code["engineer"].display_name == "Driver / Operator"

    async def test_fire_department_still_gets_both_line_ranks(self):
        db = _seed_db("fire_department")
        out = await OperationalRankService(db).seed_defaults("org-1")
        codes = {r.rank_code for r in out}
        # Neither implies the other; a fire department runs EMS too and needs
        # to be able to record a member who is one, the other, or both.
        assert {"firefighter", "emt"} <= codes

    async def test_combined_matches_fire(self):
        assert default_ranks_for("fire_ems_combined") == default_ranks_for(
            "fire_department"
        )

    @pytest.mark.parametrize("org_type", [None, "", "something_new"])
    def test_unknown_agency_type_falls_back_to_the_full_set(self, org_type):
        # Seeding too few is the worse failure: a department that is missing a
        # rank has no indication anything is absent, whereas a spare one is
        # visible in the editor and deletable.
        assert default_ranks_for(org_type) == default_ranks_for("fire_department")

    def test_every_seeded_code_is_a_known_rank_code(self):
        """A per-agency label override must never invent a new code.

        Codes key the permission registry and the shift-eligibility fallback,
        so a code seeded for one agency and unknown elsewhere would confer
        nothing — the EMT bug, re-created per agency type.
        """
        known = {code for code, _l, _o, _p in DEFAULT_RANKS}
        for org_type in ("fire_department", "fire_ems_combined", "ems_only"):
            for code, _label, _order, _positions in default_ranks_for(org_type):
                assert code in known, f"{org_type} seeds unknown rank code {code!r}"


class TestDefaultPermissionCountIsReported:
    """The editor cannot warn about a rank that grants nothing unless it is told.

    ``RankResponse.default_permission_count`` resolves from the code-level
    registry keyed by ``rank_code``, not from the stored row, so it is the only
    thing that distinguishes a seeded rank from one a department invented for
    itself. The two properties that matter are asserted here rather than left
    to the frontend: that a seeded code reports a non-zero count, and that an
    unknown one reports 0 instead of raising.
    """

    @staticmethod
    def _response(rank_code: str) -> RankResponse:
        return RankResponse(
            id=uuid4(),
            organization_id=uuid4(),
            rank_code=rank_code,
            display_name=rank_code.replace("_", " ").title(),
            description=None,
            sort_order=0,
            is_active=True,
            eligible_positions=None,
            created_at=datetime(2026, 1, 1),
            updated_at=datetime(2026, 1, 1),
        )

    @pytest.mark.parametrize("code", [c for c, _l, _o, _p in DEFAULT_RANKS])
    def test_every_seeded_rank_reports_a_count(self, code):
        assert self._response(code).default_permission_count > 0

    def test_a_rank_a_department_invented_reports_zero(self):
        # Not an error: conferring nothing is the documented design for a
        # custom rank. Reporting it is what lets the editor say so.
        assert self._response("battalion_chief").default_permission_count == 0

    def test_the_count_serializes_under_its_snake_case_name(self):
        """The frontend reads ``default_permission_count`` off the JSON.

        ``UTCResponseBase`` sets no ``alias_generator``, so this response is
        snake_case unlike the camelCase ones — a computed field that started
        serializing under a camelCase alias would leave the badge reading
        ``undefined``, which is falsy but never ``=== 0``, so the warning would
        simply stop appearing with nothing to show for it.
        """
        payload = self._response("emt").model_dump()
        assert payload["default_permission_count"] == len(
            get_rank_default_permissions("emt")
        )
