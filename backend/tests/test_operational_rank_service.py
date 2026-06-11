"""
Tests for the operational rank service
(app/services/operational_rank_service.py).

Covers seeding (idempotency + the list-aliasing fix), CRUD with duplicate
rank_code guards, reorder, and the active-member rank validation that skips
inactive/archived members. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.operational_rank import RankCreate, RankUpdate
from app.services.operational_rank_service import DEFAULT_RANKS, OperationalRankService


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


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


class TestSeedDefaults:
    async def test_skips_when_ranks_exist(self):
        db = _db([_scalar(3)])
        out = await OperationalRankService(db).seed_defaults("org-1")
        assert out == []
        db.add.assert_not_called()

    async def test_seeds_full_default_set(self):
        db = _db([_scalar(0)])
        out = await OperationalRankService(db).seed_defaults("org-1")
        assert len(out) == len(DEFAULT_RANKS)
        assert db.add.call_count == len(DEFAULT_RANKS)
        codes = {r.rank_code for r in out}
        assert "fire_chief" in codes
        assert "emt" in codes

    async def test_seeded_chief_ranks_do_not_alias_positions(self):
        # Regression: the chief ranks shared the same _ALL_POSITIONS list.
        db = _db([_scalar(0)])
        out = await OperationalRankService(db).seed_defaults("org-1")
        by_code = {r.rank_code: r for r in out}
        chief = by_code["fire_chief"]
        deputy = by_code["deputy_chief"]
        assert chief.eligible_positions == deputy.eligible_positions
        assert chief.eligible_positions is not deputy.eligible_positions
        chief.eligible_positions.append("mutated")
        assert "mutated" not in deputy.eligible_positions


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
