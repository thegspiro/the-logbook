"""
Tests for the EVOC level service (app/services/evoc_level_service.py).

The focus is the safety-critical driver eligibility check
(check_driver_evoc_eligibility) which gates who may operate emergency
apparatus, plus CRUD guards (duplicate level/code, system-level and
in-use delete protection) and the cumulative auto-add of operators on
EVOC completion. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.apparatus import EvocLevelCreate
from app.services.evoc_level_service import EvocLevelService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
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
        db = _db(
            [
                _one(_apparatus(required)),
                _scalars([_operator(user_level)]),
                _one(None),  # specific_match fallback: none
            ]
        )
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is False
        assert "EVOC Level 4" in out["warning"]

    async def test_higher_noncumulative_with_exact_fallback_is_eligible(self):
        required = _level(2)
        user_level = _level(4, is_cumulative=False)
        db = _db(
            [
                _one(_apparatus(required)),
                _scalars([_operator(user_level)]),
                _one(SimpleNamespace(id="op-exact")),  # has exact required level
            ]
        )
        out = await EvocLevelService(db).check_driver_evoc_eligibility("u", "ap1", "o")
        assert out["eligible"] is True

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


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
