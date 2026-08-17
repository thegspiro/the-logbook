"""
Tests for the EVOC level service (app/services/evoc_level_service.py).

The focus is the safety-critical driver eligibility check
(check_driver_evoc_eligibility) which gates who may operate emergency
apparatus, plus CRUD guards (duplicate level/code, system-level and
in-use delete protection) and the cumulative auto-add of operators on
EVOC completion. DB mocked; no MySQL.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.apparatus import EvocLevelCreate, EvocLevelUpdate
from app.services.evoc_level_service import EvocLevelService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _count(n):
    return MagicMock(scalar=MagicMock(return_value=n))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _level(level_number, name="L", is_cumulative=True, id=None, is_system=False):
    return SimpleNamespace(
        id=id or f"lvl-{level_number}",
        level_number=level_number,
        name=name,
        is_cumulative=is_cumulative,
        is_system=is_system,
    )


def _apparatus(required_level):
    return SimpleNamespace(
        id="ap1",
        required_evoc_level_id=(required_level.id if required_level else None),
        required_evoc_level=required_level,
    )


def _operator(level):
    return SimpleNamespace(evoc_level=level)


class TestCreateLevel:
    def _data(self):
        return EvocLevelCreate(level_number=2, name="EVOC II", code="E2")

    async def test_duplicate_level_number_rejected(self):
        db = _db([_one(SimpleNamespace(id="x"))])
        with pytest.raises(ValueError, match="already exists"):
            await EvocLevelService(db).create_level(self._data(), "org-1")

    async def test_duplicate_code_rejected(self):
        db = _db([_one(None), _one(SimpleNamespace(id="x"))])
        with pytest.raises(ValueError, match="code"):
            await EvocLevelService(db).create_level(self._data(), "org-1")

    async def test_create_succeeds(self):
        db = _db([_one(None), _one(None)])
        level = await EvocLevelService(db).create_level(self._data(), "org-1")
        assert level.organization_id == "org-1"
        assert level.level_number == 2
        db.commit.assert_awaited()


class TestDeleteLevel:
    async def test_missing_returns_false(self):
        assert (
            await EvocLevelService(_db([_one(None)])).delete_level("l1", "o") is False
        )

    async def test_system_level_protected(self):
        db = _db([_one(_level(1, is_system=True))])
        with pytest.raises(ValueError, match="system"):
            await EvocLevelService(db).delete_level("l1", "o")

    async def test_in_use_by_apparatus_protected(self):
        db = _db([_one(_level(1)), _one("ap1")])  # get_level, apparatus_using
        with pytest.raises(ValueError, match="assigned to apparatus"):
            await EvocLevelService(db).delete_level("l1", "o")

    async def test_delete_succeeds(self):
        db = _db([_one(_level(1)), _one(None)])
        assert await EvocLevelService(db).delete_level("l1", "o") is True
        db.delete.assert_awaited()


class TestDriverEligibility:
    async def test_no_required_level_is_eligible(self):
        db = _db([_one(_apparatus(None))])
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is True
        assert out["required_level"] is None

    async def test_no_certification_not_eligible(self):
        required = _level(2, name="EVOC II")
        db = _db([_one(_apparatus(required)), _scalars([])])
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is False
        assert "no EVOC certification" in out["warning"]

    async def test_cumulative_higher_level_is_eligible(self):
        required = _level(2)
        user_level = _level(3, is_cumulative=True)
        db = _db([_one(_apparatus(required)), _scalars([_operator(user_level)])])
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is True

    async def test_exact_match_noncumulative_is_eligible(self):
        required = _level(2)
        user_level = _level(2, is_cumulative=False)
        db = _db([_one(_apparatus(required)), _scalars([_operator(user_level)])])
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is True

    async def test_higher_noncumulative_without_exact_not_eligible(self):
        # Holds only a higher, non-cumulative level and no record at the exact
        # required level -> not eligible (distinct vehicle categories).
        required = _level(2, name="EVOC II")
        user_level = _level(4, name="EVOC IV", is_cumulative=False)
        db = _db([_one(_apparatus(required)), _scalars([_operator(user_level)])])
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is False
        assert "EVOC Level 4" in out["warning"]

    async def test_higher_noncumulative_plus_exact_level_is_eligible(self):
        # Holding non-cumulative Level 4 *and* the required Level 2. The
        # operator query already returns both, so the exact match is found
        # without a second lookup.
        required = _level(2)
        db = _db(
            [
                _one(_apparatus(required)),
                _scalars(
                    [
                        _operator(_level(4, is_cumulative=False)),
                        _operator(_level(2)),
                    ]
                ),
            ]
        )
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is True

    async def test_cumulative_level_below_the_highest_still_qualifies(self):
        # Cumulative Level 3 plus non-cumulative Level 4, against a Level 2
        # apparatus. Judging on the highest level alone rejected this member:
        # the max (4) is neither cumulative nor an exact match, so the
        # cumulative 3 that plainly covers Level 2 never got a look.
        required = _level(2)
        db = _db(
            [
                _one(_apparatus(required)),
                _scalars(
                    [
                        _operator(_level(4, is_cumulative=False)),
                        _operator(_level(3, is_cumulative=True)),
                    ]
                ),
            ]
        )
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is True

    async def test_only_higher_noncumulative_is_not_eligible(self):
        # Non-cumulative Level 4 alone does not confer Level 2.
        required = _level(2)
        db = _db(
            [
                _one(_apparatus(required)),
                _scalars([_operator(_level(4, is_cumulative=False))]),
            ]
        )
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is False

    async def test_expiry_is_judged_on_the_shift_date(self):
        # Scheduling is forward-looking: a card current today but lapsed by the
        # shift does not qualify anyone to drive it. Asserted on the compiled
        # SQL because the date bound is the whole safety property here.
        required = _level(2)
        db = _db([_one(_apparatus(required)), _scalars([])])
        shift_day = date(2026, 12, 25)
        await EvocLevelService(db).check_driver_evoc_eligibility(
            "u", "ap1", "o", on_date=shift_day
        )
        params = db.execute.await_args[0][0].compile().params
        assert shift_day in params.values()

    async def test_lower_level_not_eligible(self):
        required = _level(3)
        user_level = _level(1, is_cumulative=True)
        db = _db(
            [
                _one(_apparatus(required)),
                _scalars([_operator(user_level)]),
                _one(None),
            ]
        )
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is False

    async def test_operator_query_gates_on_current_certification(self):
        # Regression: an expired or non-certified ApparatusOperator must not
        # qualify a driver. The operator lookup has to filter on is_certified
        # and certification_expiration (nothing flips is_active off on expiry).
        from sqlalchemy.dialects import mysql

        required = _level(2)
        captured = []

        async def cap(statement, *a, **k):
            captured.append(statement)
            if len(captured) == 1:
                return _one(_apparatus(required))
            return _scalars([])

        db = MagicMock()
        db.execute = AsyncMock(side_effect=cap)
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is False

        op_sql = str(captured[1].compile(dialect=mysql.dialect())).lower()
        assert "is_certified" in op_sql
        assert "certification_expiration" in op_sql


class TestAutoAddOperators:
    async def test_missing_level_returns_empty(self):
        assert (
            await EvocLevelService(
                _db([_one(None)])
            ).auto_add_operators_for_evoc_completion("u", "lvl-2", "o")
            == []
        )

    async def test_cumulative_adds_to_lower_apparatus_and_skips_existing(self):
        completed = _level(3, is_cumulative=True)
        all_levels = [_level(1), _level(2), _level(3, is_cumulative=True)]
        apps = [SimpleNamespace(id="ap1"), SimpleNamespace(id="ap2")]
        db = _db(
            [
                _one(completed),  # get_level
                _scalars(all_levels),  # list_levels
                _scalars(apps),  # target apparatus
                _one(None),  # ap1 no existing operator
                _one(SimpleNamespace(id="existing")),  # ap2 already an operator
            ]
        )
        out = await EvocLevelService(db).auto_add_operators_for_evoc_completion(
            "u", "lvl-3", "o", created_by="admin"
        )
        assert len(out) == 1
        assert out[0].apparatus_id == "ap1"
        db.commit.assert_awaited()


class TestSeedDefaults:
    """The lazy seed behind the EVOC admin screen.

    Without levels on file no apparatus can carry an EVOC requirement, so
    check_driver_evoc_eligibility passes every member unconditionally — the
    reason the ladder is seeded rather than left to manual setup.
    """

    async def test_seeds_full_ladder_when_org_has_none(self):
        db = _db([_count(0)])
        levels = await EvocLevelService(db).seed_defaults("org-1")

        assert [level.level_number for level in levels] == [1, 2, 3, 4]
        assert all(level.organization_id == "org-1" for level in levels)
        assert all(level.is_cumulative for level in levels)
        # Not is_system: a two-tier department must be able to delete the
        # levels it does not use.
        assert not any(level.is_system for level in levels)
        assert db.add.call_count == 4

    async def test_no_reseed_when_levels_exist(self):
        db = _db([_count(1)])
        assert await EvocLevelService(db).seed_defaults("org-1") == []
        db.add.assert_not_called()

    async def test_deactivated_levels_still_block_reseed(self):
        # The guard counts all rows, not just active ones, so hiding a level
        # the department does not use must not resurrect the whole ladder.
        db = _db([_count(4)])
        assert await EvocLevelService(db).seed_defaults("org-1") == []


class TestTrainingProgramLinkScoping:
    """XC-1: the certifying-program link is what _handle_evoc_completion
    matches enrollments against, so a foreign id would let one org's program
    completion mint operator records under another org's apparatus."""

    def _data(self, program_id):
        return EvocLevelCreate(
            level_number=2, name="EVOC II", code="E2", training_program_id=program_id
        )

    async def test_create_rejects_out_of_org_program(self):
        db = _db([_one(None)])  # is_in_org lookup misses
        with pytest.raises(ValueError, match="Invalid training program"):
            await EvocLevelService(db).create_level(self._data("prog-other"), "org-1")

    async def test_create_accepts_in_org_program(self):
        db = _db([_one("prog-1"), _one(None), _one(None)])
        level = await EvocLevelService(db).create_level(self._data("prog-1"), "org-1")
        assert level.training_program_id == "prog-1"

    async def test_update_rejects_out_of_org_program(self):
        db = _db([_one(_level(2)), _one(None)])
        with pytest.raises(ValueError, match="Invalid training program"):
            await EvocLevelService(db).update_level(
                "lvl-2", EvocLevelUpdate(training_program_id="prog-other"), "org-1"
            )


class TestUpdateLevel:
    async def test_explicit_null_clears_the_program_link(self):
        # Unlinking must actually persist: the old `if value is not None`
        # idiom would acknowledge the clear with a 200 and keep the link.
        level = _level(2)
        level.training_program_id = "prog-1"
        db = _db([_one(level)])
        out = await EvocLevelService(db).update_level(
            "lvl-2", EvocLevelUpdate(training_program_id=None), "org-1"
        )
        assert out.training_program_id is None

    async def test_renumber_collision_rejected(self):
        # Surfaces as a 400 rather than a unique-index IntegrityError 500.
        db = _db([_one(_level(2)), _one("lvl-3")])
        with pytest.raises(ValueError, match="already exists"):
            await EvocLevelService(db).update_level(
                "lvl-2", EvocLevelUpdate(level_number=3), "org-1"
            )

    async def test_recode_collision_rejected(self):
        level = _level(2)
        level.code = "E2"
        db = _db([_one(level), _one("lvl-3")])
        with pytest.raises(ValueError, match="code"):
            await EvocLevelService(db).update_level(
                "lvl-2", EvocLevelUpdate(code="E3"), "org-1"
            )

    async def test_unchanged_number_skips_collision_check(self):
        level = _level(2)
        level.code = "E2"
        db = _db([_one(level)])
        out = await EvocLevelService(db).update_level(
            "lvl-2", EvocLevelUpdate(level_number=2, name="Renamed"), "org-1"
        )
        assert out.name == "Renamed"

    async def test_missing_level_returns_none(self):
        db = _db([_one(None)])
        assert (
            await EvocLevelService(db).update_level(
                "nope", EvocLevelUpdate(name="x"), "org-1"
            )
            is None
        )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
