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


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _user(rank="ff", membership_type="active"):
    return SimpleNamespace(id="u1", rank=rank, membership_type=membership_type)


def _member(user_id, rank="ff", membership_type="active", platoon=None):
    """A roster-shaped user (needs full_name, which _user does not carry)."""
    return SimpleNamespace(
        id=user_id,
        rank=rank,
        membership_type=membership_type,
        platoon=platoon,
        full_name=f"Pat {rank.replace('_', ' ').title()}",
    )


def _evoc(level_number, name):
    return SimpleNamespace(level_number=level_number, name=name)


def _operator(user_id, apparatus_id, evoc_level, expiration=None):
    return SimpleNamespace(
        user_id=user_id,
        apparatus_id=apparatus_id,
        certification_expiration=expiration,
        evoc_level=evoc_level,
    )


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

    async def test_shift_with_no_positions_means_any_position(self):
        # Intended behavior (product decision): a non-open shift that defines
        # no positions does not further restrict eligibility, so the member's
        # full eligible set is returned rather than [].
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


class TestPositionRoster:
    """The department-wide "who is cleared to drive?" roster.

    Its eligibility rule must stay identical to get_eligible_positions — a
    roster that disagrees with what signup enforces is worse than none.
    """

    def _db_for(self, users, ranks, training, operators, org=None):
        return _db(
            [
                _one(org if org is not None else _org()),
                _scalars(users),
                _rows(ranks),
                _rows(training),
                _rows(operators),
            ]
        )

    async def test_org_not_found_returns_empty(self):
        out = await ShiftEligibilityService(_db([_one(None)])).get_position_roster(
            "org-1", "driver"
        )
        assert out["members"] == []

    async def test_rank_source_listed_with_display_name(self):
        db = self._db_for(
            users=[_member("u1", rank="engineer")],
            ranks=[("engineer", "Engineer", ["driver", "firefighter"])],
            training=[],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert len(out["members"]) == 1
        member = out["members"][0]
        assert member["user_name"] == "Pat Engineer"
        assert member["rank_display_name"] == "Engineer"
        assert member["sources"] == [{"type": "rank", "label": "Engineer"}]

    async def test_driver_candidate_program_maps_to_driver(self):
        # The same TRAINING_POSITION_MAP translation the signup gate uses.
        db = self._db_for(
            users=[_member("u1", rank="firefighter")],
            ranks=[("firefighter", "Firefighter", ["firefighter"])],
            training=[("u1", "Driver Operator Pipeline", "driver_candidate")],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert out["members"][0]["sources"] == [
            {"type": "training", "label": "Driver Operator Pipeline"}
        ]

    async def test_program_for_another_position_does_not_qualify(self):
        db = self._db_for(
            users=[_member("u1", rank="firefighter")],
            ranks=[("firefighter", "Firefighter", ["firefighter"])],
            training=[("u1", "Officer Academy", "officer")],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        assert out["members"] == []

    async def test_open_position_qualifies_everyone_not_excluded(self):
        db = self._db_for(
            users=[_member("u1", rank="firefighter")],
            ranks=[("firefighter", "Firefighter", ["firefighter"])],
            training=[],
            operators=[],
            org=_org({"open_positions": ["driver"]}),
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert out["is_open_position"] is True
        assert out["members"][0]["sources"] == [
            {"type": "open", "label": "Open to all members"}
        ]

    async def test_excluded_membership_type_omitted(self):
        db = self._db_for(
            users=[_member("u1", rank="engineer", membership_type="retired")],
            ranks=[("engineer", "Engineer", ["driver"])],
            training=[],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        assert out["members"] == []
        assert "retired" in out["excluded_membership_types"]

    async def test_member_with_no_source_omitted(self):
        db = self._db_for(
            users=[_member("u1", rank="firefighter")],
            ranks=[("firefighter", "Firefighter", ["firefighter", "ems"])],
            training=[],
            operators=[],
        )
        assert (
            await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        )["members"] == []

    async def test_multiple_sources_all_reported(self):
        db = self._db_for(
            users=[_member("u1", rank="engineer")],
            ranks=[("engineer", "Engineer", ["driver"])],
            training=[("u1", "Driver Operator Pipeline", "driver_candidate")],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert [s["type"] for s in out["members"][0]["sources"]] == [
            "rank",
            "training",
        ]

    async def test_highest_evoc_level_and_apparatus_reported(self):
        db = self._db_for(
            users=[_member("u1", rank="engineer")],
            ranks=[("engineer", "Engineer", ["driver"])],
            training=[],
            operators=[
                (_operator("u1", "ap1", _evoc(2, "EVOC II")), "E-1"),
                (_operator("u1", "ap2", _evoc(4, "EVOC IV")), "T-1"),
            ],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        member = out["members"][0]

        assert member["evoc_level_number"] == 4
        assert member["evoc_level_name"] == "EVOC IV"
        assert [a["unit_number"] for a in member["apparatus_cleared"]] == ["E-1", "T-1"]

    async def test_rank_eligible_without_evoc_still_listed_unbacked(self):
        # The gap worth seeing: rank alone lets them sign up, with no EVOC
        # certification on file behind it.
        db = self._db_for(
            users=[_member("u1", rank="engineer")],
            ranks=[("engineer", "Engineer", ["driver"])],
            training=[],
            operators=[],
        )
        member = (
            await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        )["members"][0]

        assert member["evoc_level_number"] is None
        assert member["apparatus_cleared"] == []

    async def test_inactive_rank_confers_nothing(self):
        # _get_rank_map only returns active ranks, so a deactivated rank drops
        # out of the map entirely.
        db = self._db_for(
            users=[_member("u1", rank="retired_engineer")],
            ranks=[],
            training=[],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        assert out["members"] == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
