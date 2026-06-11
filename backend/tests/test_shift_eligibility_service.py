"""
Tests for the shift position eligibility service
(app/services/shift_eligibility_service.py).

Covers the self-service signup gate: open-to-all bypass, the membership-type
exclusion, the rank/training/open-position union, intersection with a shift's
defined positions, the training target_position mapping, settings updates
(deepcopy-safe), and the EVOC soft-warning path. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.shift_eligibility_service import (
    DEFAULT_EXCLUDED_MEMBERSHIP_TYPES,
    ShiftEligibilityService,
)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _rows(rows):
    return MagicMock(all=MagicMock(return_value=rows))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _org(scheduling=None):
    settings = {"scheduling": scheduling} if scheduling is not None else {}
    return SimpleNamespace(id="org-1", settings=settings)


def _user(rank="ff", membership_type="active"):
    return SimpleNamespace(id="u1", rank=rank, membership_type=membership_type)


def _shift(positions, open_to_all=False, apparatus_id=None):
    return SimpleNamespace(
        id="sh1",
        organization_id="org-1",
        positions=positions,
        open_to_all_members=open_to_all,
        apparatus_id=apparatus_id,
    )


class TestGetEligiblePositions:
    async def test_org_not_found(self):
        out = await ShiftEligibilityService(_db([_one(None)])).get_eligible_positions(
            _user(), "org-1"
        )
        assert out == []

    async def test_open_to_all_bypasses_membership_and_rank(self):
        # An excluded member still sees all positions on an open-to-all shift.
        org = _org()
        shift = _shift(["driver", "officer"], open_to_all=True)
        db = _db([_one(org), _one(shift)])
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(membership_type="retired"), "org-1", shift_id="sh1"
        )
        assert out == ["driver", "officer"]

    async def test_excluded_membership_returns_empty(self):
        out = await ShiftEligibilityService(_db([_one(_org())])).get_eligible_positions(
            _user(membership_type="prospective"), "org-1"
        )
        assert out == []

    async def test_union_of_rank_training_and_open(self):
        org = _org(scheduling={"open_positions": ["ems"]})
        # org, rank positions, training rows
        db = _db([_one(org), _one(["driver"]), _rows([("officer",)])])
        out = await ShiftEligibilityService(db).get_eligible_positions(_user(), "org-1")
        assert out == ["driver", "ems", "officer"]

    async def test_intersection_with_shift_positions(self):
        org = _org(scheduling={"open_positions": ["ems"]})
        shift = _shift(["driver", "officer"])
        db = _db([_one(org), _one(shift), _one(["driver"]), _rows([("officer",)])])
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(), "org-1", shift_id="sh1"
        )
        # ems is dropped (not on the shift); driver+officer remain.
        assert out == ["driver", "officer"]

    async def test_shift_with_no_positions_is_over_permissive(self):
        # DOCUMENTS CURRENT BEHAVIOR: a non-open shift with no positions skips
        # the intersection and returns the full eligible set rather than [].
        org = _org()
        shift = _shift([])  # no positions defined
        db = _db([_one(org), _one(shift), _one(["driver"]), _rows([])])
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(), "org-1", shift_id="sh1"
        )
        assert out == ["driver"]


class TestSettingsHelpers:
    def test_excluded_membership_defaults(self):
        svc = ShiftEligibilityService(MagicMock())
        assert (
            svc.get_excluded_membership_types(_org())
            == DEFAULT_EXCLUDED_MEMBERSHIP_TYPES
        )

    def test_excluded_membership_explicit_empty_overrides_default(self):
        svc = ShiftEligibilityService(MagicMock())
        org = _org(scheduling={"excluded_membership_types": []})
        assert svc.get_excluded_membership_types(org) == []

    def test_open_positions_default_empty(self):
        svc = ShiftEligibilityService(MagicMock())
        assert svc.get_open_positions(_org()) == []

    def test_shift_position_list_handles_strings_and_dicts(self):
        svc = ShiftEligibilityService(MagicMock())
        shift = _shift(["driver", {"position": "officer"}, {"position": ""}, {}])
        assert svc._shift_position_list(shift) == ["driver", "officer"]


class TestTrainingPositions:
    async def test_maps_target_positions(self):
        # aic -> officer (mapped); unknown target passes through unchanged.
        db = _db([_rows([("aic",), ("driver_candidate",), ("custom",)])])
        out = await ShiftEligibilityService(db)._get_training_positions("u1", "org-1")
        assert out == ["officer", "driver", "custom"]


class TestUpdateSchedulingSettings:
    async def test_raises_when_org_missing(self):
        with pytest.raises(ValueError, match="Organization not found"):
            await ShiftEligibilityService(_db([_one(None)])).update_scheduling_settings(
                "org-1", open_positions=["ems"]
            )

    async def test_updates_without_mutating_original_settings(self):
        original = {"scheduling": {"open_positions": ["old"]}, "other": 1}
        org = SimpleNamespace(id="org-1", settings=original)
        db = _db([_one(org)])
        out = await ShiftEligibilityService(db).update_scheduling_settings(
            "org-1", open_positions=["ems"], excluded_membership_types=["retired"]
        )
        assert out == {
            "open_positions": ["ems"],
            "excluded_membership_types": ["retired"],
        }
        # Deep-copied: the pre-update dict object is untouched.
        assert original["scheduling"]["open_positions"] == ["old"]
        db.commit.assert_awaited()


class TestDriverWarnings:
    async def test_no_shift_returns_empty(self):
        out = await ShiftEligibilityService(
            _db([_one(None)])
        ).get_driver_assignment_warnings("u1", "sh1", "org-1")
        assert out == []

    async def test_no_apparatus_returns_empty(self):
        shift = _shift(["driver"], apparatus_id=None)
        out = await ShiftEligibilityService(
            _db([_one(shift)])
        ).get_driver_assignment_warnings("u1", "sh1", "org-1")
        assert out == []

    async def test_evoc_mismatch_produces_warning(self, monkeypatch):
        shift = _shift(["driver"], apparatus_id="ap1")
        svc = ShiftEligibilityService(_db([_one(shift)]))

        async def _check(**kwargs):
            return {"eligible": False, "warning": "Needs EVOC II"}

        monkeypatch.setattr(
            "app.services.shift_eligibility_service.EvocLevelService",
            lambda db: SimpleNamespace(check_driver_evoc_eligibility=_check),
        )
        out = await svc.get_driver_assignment_warnings("u1", "sh1", "org-1")
        assert out == [
            {"type": "evoc_mismatch", "message": "Needs EVOC II", "severity": "warning"}
        ]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
