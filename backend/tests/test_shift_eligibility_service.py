"""
Tests for the shift position eligibility service
(app/services/shift_eligibility_service.py).

Covers the self-service signup gate: open-to-all bypass, the membership-type
exclusion, the rank/position/training/open-position union, intersection with a
shift's defined positions, the training target_position mapping, settings
updates (deepcopy-safe), and the EVOC soft-warning path. DB mocked; no MySQL.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.shift_eligibility_service import (
    DEFAULT_EXCLUDED_MEMBERSHIP_TYPES,
    ShiftEligibilityService,
)
from app.utils.positions import TRAINING_POSITION_MAP


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _rows(rows):
    return MagicMock(all=MagicMock(return_value=rows))


def _empty_result():
    """A result that reads as empty however the caller unwraps it."""
    r = MagicMock()
    r.all.return_value = []
    r.scalar_one_or_none.return_value = None
    r.scalars.return_value.all.return_value = []
    return r


def _db(side_effect):
    """Fake session answering a declared sequence of results, then empties.

    Padding the tail keeps a test to the queries it actually cares about, so
    adding a term to the eligibility union does not mean editing every test in
    the file. Ordering is still pinned for everything a test *does* declare: a
    new query inserted ahead of a declared one consumes its result and the
    assertion fails, which is the regression worth catching.
    """
    queue = list(side_effect)

    async def _execute(*_args, **_kwargs):
        return queue.pop(0) if queue else _empty_result()

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
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


def _rank_rows(entries):
    """operational_ranks rows as _get_slug_eligibility_map selects them."""
    return _rows(
        [
            (code, positions, active)
            for code, positions, active in (
                (e[0], e[1], e[2] if len(e) > 2 else True) for e in entries
            )
        ]
    )


def _held_rows(slugs):
    """The member's own position slugs, as _get_held_position_slugs sees them."""
    return _rows([(slug,) for slug in slugs])


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
        # org, rank map, held position slugs, training rows
        db = _db(
            [
                _one(org),
                _rank_rows([("ff", ["driver"])]),
                _held_rows([]),
                _rows([("officer",)]),
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(_user(), "org-1")
        assert out == ["driver", "ems", "officer"]

    async def test_current_certification_unlocks_signup(self):
        """The gate must agree with the roster, or the two contradict.

        get_position_roster documents that it mirrors this method exactly, so a
        source added to one and not the other means the screen lists a member
        the signup gate then refuses -- or worse, the reverse.
        """
        org = _org()
        db = _db(
            [
                _one(org),
                _rank_rows([("ff", ["firefighter"])]),
                _held_rows([]),
                _rows([]),  # no completed programs
                _rows([("paramedic",)]),  # a current paramedic card
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(_user(), "org-1")
        assert out == ["firefighter", "paramedic"]

    async def test_expired_certification_does_not_unlock_signup(self):
        # The lapsed card is filtered out in SQL, so the gate sees no
        # certification row at all and the seat is simply not offered.
        org = _org()
        db = _db(
            [
                _one(org),
                _rank_rows([("ff", ["firefighter"])]),
                _held_rows([]),
                _rows([]),
                _rows([]),
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(_user(), "org-1")
        assert out == ["firefighter"]

    async def test_held_position_confers_eligibility_without_a_rank(self):
        # The reported defect: a department that models EMT as a *position*
        # (onboarding's role setup creates one with slug "emt") and leaves
        # User.rank unset had every one of its EMTs refused self-signup.
        org = _org()
        db = _db(
            [
                _one(org),
                _rank_rows([("emt", ["ems", "firefighter"])]),
                _held_rows(["emt", "member"]),
                _rows([]),
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(rank=None), "org-1"
        )
        assert out == ["ems", "firefighter"]

    async def test_held_position_falls_back_to_seed_defaults(self):
        # An org onboarded before "emt" joined DEFAULT_RANKS has no row for it
        # — seed_defaults only fires on an empty table — so the built-in
        # default answers rather than leaving the member with nothing.
        db = _db([_one(_org()), _rank_rows([]), _held_rows(["emt"]), _rows([])])
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(rank=None), "org-1"
        )
        assert out == ["ems", "firefighter"]

    async def test_configured_rank_row_overrides_the_default(self):
        # An admin who narrows a rank gets what they configured, not the seed.
        db = _db(
            [
                _one(_org()),
                _rank_rows([("emt", ["ems"])]),
                _held_rows(["emt"]),
                _rows([]),
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(rank=None), "org-1"
        )
        assert out == ["ems"]

    async def test_deactivated_rank_confers_nothing_despite_the_default(self):
        # Deactivating a rank is an explicit act; the fallback must not undo it.
        db = _db(
            [
                _one(_org()),
                _rank_rows([("emt", ["ems", "firefighter"], False)]),
                _held_rows(["emt"]),
                _rows([]),
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(rank="emt"), "org-1"
        )
        assert out == []

    async def test_position_slug_that_is_not_operational_confers_nothing(self):
        # Treasurer is a corporate position; it says nothing about riding.
        db = _db(
            [
                _one(_org()),
                _rank_rows([]),
                _held_rows(["treasurer", "member"]),
                _rows([]),
            ]
        )
        out = await ShiftEligibilityService(db).get_eligible_positions(
            _user(rank=None), "org-1"
        )
        assert out == []

    async def test_intersection_with_shift_positions(self):
        org = _org(scheduling={"open_positions": ["ems"]})
        shift = _shift(["driver", "officer"])
        db = _db(
            [
                _one(org),
                _one(shift),
                _rank_rows([("ff", ["driver"])]),
                _held_rows([]),
                _rows([("officer",)]),
            ]
        )
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
        db = _db(
            [
                _one(org),
                _one(shift),
                _rank_rows([("ff", ["driver"])]),
                _held_rows([]),
                _rows([]),
            ]
        )
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
        # Advisory mode. With enforcement on (the default) this assignment
        # would be blocked outright rather than warned about, and the caller
        # would never reach the warnings — see TestEvaluateDriverAssignment.
        shift = _shift(["driver"], apparatus_id="ap1")
        svc = ShiftEligibilityService(
            _db([_one(shift), _one(_org({"enforce_evoc": False}))])
        )

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

    def _db_for(
        self, users, ranks, training, operators, org=None, held=None, certs=None
    ):
        # ranks feeds two queries: the display-name map (active rows only) and
        # the slug->positions map the eligibility decision reads.
        #
        # certs rows are (user_id, course_name, expiration_date) and sit between
        # the training and operator queries. There is no target_position column
        # here because the roster filters on it in SQL -- see
        # test_a_certification_for_another_position_is_excluded_in_sql.
        return _db(
            [
                _one(org if org is not None else _org()),
                _scalars(users),
                _rows([r[:3] for r in ranks if len(r) < 4 or r[3]]),
                _rank_rows([(r[0], r[2], r[3] if len(r) > 3 else True) for r in ranks]),
                _rows(held or []),
                _rows(training),
                _rows(certs or []),
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
        # A deactivated rank resolves to no positions, so it can neither list
        # the member here nor let them sign up.
        db = self._db_for(
            users=[_member("u1", rank="engineer")],
            ranks=[("engineer", "Engineer", ["driver"], False)],
            training=[],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")
        assert out["members"] == []

    async def test_held_position_source_listed(self):
        # Mirrors the signup gate: the roster must show the EMT-by-position
        # member it now lets sign up, or the two disagree.
        db = self._db_for(
            users=[_member("u1", rank="")],
            ranks=[("emt", "EMT", ["ems", "firefighter"])],
            training=[],
            operators=[],
            held=[("u1", "emt", "EMT"), ("u1", "member", "Member")],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "ems")
        assert out["members"][0]["sources"] == [{"type": "position", "label": "EMT"}]

    async def test_rank_mirroring_position_is_not_reported_twice(self):
        # Onboarding gives every member the system position mirroring their
        # rank, and rank codes share a vocabulary with position slugs, so a
        # Lieutenant resolves "lieutenant" through slug_map on both branches.
        # That is one grant, and the roster listed it as two identical badges.
        db = self._db_for(
            users=[_member("u1", rank="lieutenant")],
            ranks=[("lieutenant", "Lieutenant", ["driver", "officer"])],
            training=[],
            operators=[],
            held=[("u1", "lieutenant", "Lieutenant"), ("u1", "member", "Member")],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert out["members"][0]["sources"] == [{"type": "rank", "label": "Lieutenant"}]

    async def test_position_distinct_from_rank_still_reported(self):
        # The dedupe keys on the slug, not on "a rank source exists" -- a
        # position that grants the seat for its own reason is a real second
        # source and must survive.
        db = self._db_for(
            users=[_member("u1", rank="lieutenant")],
            ranks=[
                ("lieutenant", "Lieutenant", ["driver"]),
                ("engineer", "Engineer", ["driver"]),
            ],
            training=[],
            operators=[],
            held=[("u1", "lieutenant", "Lieutenant"), ("u1", "engineer", "Engineer")],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert out["members"][0]["sources"] == [
            {"type": "rank", "label": "Lieutenant"},
            {"type": "position", "label": "Engineer"},
        ]

    async def test_rank_and_personal_qualifications_both_report(self):
        """A Lieutenant who is also an EMT and a firefighter in his own right.

        The department's case: a member's qualifications can come *with* the
        rank and *also* stand on their own, and an officer reading this screen
        needs to see which. Only the rank-mirroring position is redundant --
        every slug that is genuinely a separate credential still reports, so
        losing the rank would not silently drop the EMS clearance he holds
        independently of it.
        """
        ranks = [
            ("lieutenant", "Lieutenant", ["officer", "firefighter", "ems", "driver"]),
            ("emt", "EMT", ["ems"]),
            ("firefighter", "Firefighter", ["firefighter"]),
        ]
        held = [
            ("u1", "lieutenant", "Lieutenant"),
            ("u1", "emt", "EMT"),
            ("u1", "firefighter", "Firefighter"),
        ]
        training = [("u1", "Driver Operator Pipeline", "driver_candidate")]

        def roster_for(position):
            return ShiftEligibilityService(
                self._db_for(
                    users=[_member("u1", rank="lieutenant")],
                    ranks=ranks,
                    training=training,
                    operators=[],
                    held=held,
                )
            ).get_position_roster("org-1", position)

        ems = await roster_for("ems")
        assert ems["members"][0]["sources"] == [
            {"type": "rank", "label": "Lieutenant"},
            {"type": "position", "label": "EMT"},
        ]

        # Same shape for the firefighter seat: rank grants it, and so does the
        # position he holds on his own.
        fire = await roster_for("firefighter")
        assert fire["members"][0]["sources"] == [
            {"type": "rank", "label": "Lieutenant"},
            {"type": "position", "label": "Firefighter"},
        ]

        # Driver comes from rank plus the completed pipeline, not a position.
        driver = await roster_for("driver")
        assert driver["members"][0]["sources"] == [
            {"type": "rank", "label": "Lieutenant"},
            {"type": "training", "label": "Driver Operator Pipeline"},
        ]

    async def test_duplicate_held_position_rows_report_once(self):
        db = self._db_for(
            users=[_member("u1", rank="")],
            ranks=[("emt", "EMT", ["ems"])],
            training=[],
            operators=[],
            held=[("u1", "emt", "EMT"), ("u1", "emt", "EMT")],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "ems")

        assert out["members"][0]["sources"] == [{"type": "position", "label": "EMT"}]

    async def test_duplicate_completed_enrollments_report_the_program_once(self):
        db = self._db_for(
            users=[_member("u1", rank="firefighter")],
            ranks=[("firefighter", "Firefighter", ["firefighter"])],
            training=[
                ("u1", "Driver Operator Pipeline", "driver_candidate"),
                ("u1", "Driver Operator Pipeline", "driver_candidate"),
            ],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "driver")

        assert out["members"][0]["sources"] == [
            {"type": "training", "label": "Driver Operator Pipeline"}
        ]

    async def test_current_certification_confers_the_position(self):
        # The credential path: nothing about this member's rank or positions
        # grants a medic seat -- the card does.
        db = self._db_for(
            users=[_member("u1", rank="firefighter")],
            ranks=[("firefighter", "Firefighter", ["firefighter", "ems"])],
            training=[],
            operators=[],
            certs=[("u1", "Paramedic", date(2027, 3, 1))],
        )
        out = await ShiftEligibilityService(db).get_position_roster(
            "org-1", "paramedic"
        )

        assert out["members"][0]["sources"] == [
            {
                "type": "certification",
                "label": "Paramedic",
                "expires_on": date(2027, 3, 1),
            }
        ]

    async def test_expired_certification_confers_nothing(self):
        # The department's case: a Captain who was a paramedic and did not keep
        # it. The SQL filters the lapsed record out, so he never reaches the
        # paramedic roster -- and because no rank seeds `paramedic`, there is
        # no other source left to carry him.
        db = self._db_for(
            users=[_member("u1", rank="captain")],
            ranks=[
                ("captain", "Captain", ["captain", "officer", "firefighter", "ems"])
            ],
            training=[],
            operators=[],
            certs=[],  # the expired row is excluded by the query itself
        )
        out = await ShiftEligibilityService(db).get_position_roster(
            "org-1", "paramedic"
        )
        assert out["members"] == []

    async def test_lapsed_medic_keeps_the_ems_seat_his_emt_card_still_covers(self):
        # ...and the other half of it: losing the medic card does not cost him
        # the EMT one. Same member, same day, different roster.
        db = self._db_for(
            users=[_member("u1", rank="captain")],
            ranks=[
                ("captain", "Captain", ["captain", "officer", "firefighter", "ems"])
            ],
            training=[],
            operators=[],
            certs=[("u1", "EMT-B", date(2028, 6, 30))],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "ems")

        assert out["members"][0]["sources"] == [
            {"type": "rank", "label": "Captain"},
            {
                "type": "certification",
                "label": "EMT-B",
                "expires_on": date(2028, 6, 30),
            },
        ]

    async def test_non_expiring_certification_is_kept(self):
        # A null expiration means "does not expire", not "expired". Firefighter
        # I does not lapse, and treating null as lapsed would strip exactly the
        # members whose credential is permanent.
        db = self._db_for(
            users=[_member("u1", rank="")],
            ranks=[],
            training=[],
            operators=[],
            certs=[("u1", "Firefighter I", None)],
        )
        out = await ShiftEligibilityService(db).get_position_roster(
            "org-1", "firefighter"
        )

        assert out["members"][0]["sources"] == [
            {"type": "certification", "label": "Firefighter I", "expires_on": None}
        ]

    async def test_renewed_certification_reports_the_later_expiry(self):
        # A renewal is a new record beside the old one. Reporting the
        # superseded date would show a current medic as expiring last year.
        db = self._db_for(
            users=[_member("u1", rank="")],
            ranks=[],
            training=[],
            operators=[],
            certs=[
                ("u1", "Paramedic", date(2026, 12, 31)),
                ("u1", "Paramedic", date(2029, 12, 31)),
            ],
        )
        out = await ShiftEligibilityService(db).get_position_roster(
            "org-1", "paramedic"
        )

        assert out["members"][0]["sources"] == [
            {
                "type": "certification",
                "label": "Paramedic",
                "expires_on": date(2029, 12, 31),
            }
        ]

    def test_a_certification_for_another_position_is_excluded_in_sql(self):
        """The roster filters by target_position in the query, not after it.

        Asserted on the reverse map rather than through the mocked session,
        because the fake returns whatever rows a test hands it regardless of
        the WHERE clause -- so a roster-level assertion here would pass even if
        the filter were deleted. The behaviour against a real database is
        covered by the paramedic/EMT split below.
        """
        svc = ShiftEligibilityService(_db([]))

        # An EMT card must not reach the medic roster, and vice versa.
        assert "emt" not in svc._target_values_for("paramedic")
        assert svc._target_values_for("paramedic") == ["paramedic"]

        # Both spellings of the EMS seat resolve to it, and only those.
        assert svc._target_values_for("ems") == ["ems", "emt"]

        # driver_candidate is the pipeline name departments actually type.
        assert svc._target_values_for("driver") == ["driver", "driver_candidate"]

        # A seat with no alias still matches itself -- the identity case the
        # forward lookup gets from its .get(v, v) default.
        assert svc._target_values_for("captain") == ["captain"]

    def test_every_mapped_value_round_trips(self):
        # Whatever the forward map resolves a value to, the reverse lookup for
        # that seat must offer the value back, or a course configured through
        # the API would be filtered out of the roster it was meant to feed.
        svc = ShiftEligibilityService(_db([]))
        for value, seat in TRAINING_POSITION_MAP.items():
            assert value in svc._target_values_for(seat)

    async def test_rank_without_a_stored_row_uses_the_seed_label(self):
        db = self._db_for(
            users=[_member("u1", rank="emt")],
            ranks=[],
            training=[],
            operators=[],
        )
        out = await ShiftEligibilityService(db).get_position_roster("org-1", "ems")
        assert out["members"][0]["sources"] == [{"type": "rank", "label": "EMT"}]


class TestEvaluateDriverAssignment:
    """The single decision point for driver enforcement.

    A member without the EVOC level the apparatus requires does not take the
    wheel — unless a chief has approved a time-boxed exception. Both the
    self-signup and officer-assignment paths route through this method, so
    these tests pin the behavior both inherit.
    """

    def _svc(self, monkeypatch, db, *, eligible, warning=None, exception=None):
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.EvocLevelService",
            lambda _db: SimpleNamespace(
                check_driver_evoc_eligibility=AsyncMock(
                    return_value={
                        "eligible": eligible,
                        "warning": warning,
                        "required_level": None,
                        "user_level": None,
                    }
                )
            ),
        )
        monkeypatch.setattr(
            "app.services.shift_eligibility_service.DriverExceptionService",
            lambda _db: SimpleNamespace(
                find_active_exception=AsyncMock(return_value=exception)
            ),
        )
        return ShiftEligibilityService(db)

    async def test_shift_without_apparatus_is_never_blocked(self):
        # No apparatus means no EVOC requirement to check — the position is a
        # label, not a seat behind a wheel.
        db = _db([_one(_shift(["driver"]))])
        out = await ShiftEligibilityService(db).evaluate_driver_assignment(
            "u1", "sh1", "org-1"
        )
        assert out["allowed"] is True
        assert out["warnings"] == []

    async def test_certified_driver_is_allowed_with_no_warnings(self, monkeypatch):
        db = _db([_one(_shift(["driver"], apparatus_id="ap1"))])
        svc = self._svc(monkeypatch, db, eligible=True)
        out = await svc.evaluate_driver_assignment("u1", "sh1", "org-1")
        assert out["allowed"] is True
        assert out["warnings"] == []

    async def test_uncertified_driver_is_blocked_by_default(self, monkeypatch):
        # Enforcement defaults on; no org setting present.
        db = _db([_one(_shift(["driver"], apparatus_id="ap1")), _one(_org())])
        svc = self._svc(
            monkeypatch, db, eligible=False, warning="Requires EVOC Level 3."
        )
        out = await svc.evaluate_driver_assignment("u1", "sh1", "org-1")

        assert out["allowed"] is False
        assert "Requires EVOC Level 3." in out["blocked_reason"]
        # The message must say what to do about it.
        assert "exception" in out["blocked_reason"]

    async def test_enforcement_can_be_turned_off_leaving_a_warning(self, monkeypatch):
        db = _db(
            [
                _one(_shift(["driver"], apparatus_id="ap1")),
                _one(_org({"enforce_evoc": False})),
            ]
        )
        svc = self._svc(
            monkeypatch, db, eligible=False, warning="Requires EVOC Level 3."
        )
        out = await svc.evaluate_driver_assignment("u1", "sh1", "org-1")

        assert out["allowed"] is True
        assert out["warnings"][0]["type"] == "evoc_mismatch"

    async def test_approved_exception_permits_the_assignment(self, monkeypatch):
        exception = SimpleNamespace(
            id="exc-1",
            valid_until=date(2026, 9, 5),
            restrictions="Parade route only, no emergency response.",
        )
        db = _db([_one(_shift(["driver"], apparatus_id="ap1")), _one(_org())])
        svc = self._svc(
            monkeypatch,
            db,
            eligible=False,
            warning="Requires EVOC Level 3.",
            exception=exception,
        )
        out = await svc.evaluate_driver_assignment("u1", "sh1", "org-1")

        assert out["allowed"] is True
        assert out["exception"] is exception
        # The officer must see the limits the exception was granted under.
        assert out["warnings"][0]["type"] == "evoc_exception"
        assert "Parade route only" in out["warnings"][0]["message"]
        assert "2026-09-05" in out["warnings"][0]["message"]

    async def test_missing_shift_does_not_block(self):
        db = _db([_one(None)])
        out = await ShiftEligibilityService(db).evaluate_driver_assignment(
            "u1", "nope", "org-1"
        )
        assert out["allowed"] is True

    async def test_warnings_wrapper_reports_the_same_decision(self, monkeypatch):
        # get_driver_assignment_warnings delegates, so enforcement and display
        # cannot describe the same assignment differently.
        db = _db(
            [
                _one(_shift(["driver"], apparatus_id="ap1")),
                _one(_org({"enforce_evoc": False})),
            ]
        )
        svc = self._svc(monkeypatch, db, eligible=False, warning="Requires EVOC 3.")
        warnings = await svc.get_driver_assignment_warnings("u1", "sh1", "org-1")
        assert warnings[0]["message"] == "Requires EVOC 3."


class TestEvocEnforcementSetting:
    def test_defaults_to_enforcing(self):
        # Safe to default on: the check is inert until an admin sets
        # required_evoc_level_id on an apparatus.
        svc = ShiftEligibilityService(_db([]))
        assert svc.get_evoc_enforcement(_org()) is True
        assert svc.get_evoc_enforcement(_org({})) is True

    def test_can_be_disabled_explicitly(self):
        svc = ShiftEligibilityService(_db([]))
        assert svc.get_evoc_enforcement(_org({"enforce_evoc": False})) is False


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
