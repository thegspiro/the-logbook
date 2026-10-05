"""
Grandfathering for training requirements.

A department that changes its standard must not turn its existing roster
non-compliant overnight. A requirement can separate the members who joined
before ``new_member_cutoff_date`` from those after it, and either exempt the
existing members or give them until ``existing_member_deadline``. An edit saved
for "new members only" splits the requirement in two, the original narrowed by
``applies_to_joined_before``.

These are the pure rules plus a sweep proving every caller hands them a join
date. The database-backed behaviour is in
``test_requirement_grandfathering_integration.py``.
"""

import ast
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRequirement,
    TrainingStatus,
)
from app.services.training_compliance import (
    CATCH_UP_STATUS,
    catch_up_deadline,
    evaluate_member_requirement_detail,
    join_date_from,
    member_join_date,
    requirement_applies_by_join_date,
    requirement_applies_to_member,
    requirement_applies_to_user,
    tally_standing,
)
from app.services.training_service import TrainingService

pytestmark = pytest.mark.unit

CUTOFF = date(2026, 7, 1)
DEADLINE = date(2026, 12, 31)
VETERAN = date(2015, 3, 1)
RECRUIT = date(2026, 8, 15)


def _req(**overrides):
    base = dict(
        id="req-1",
        name="Live Fire",
        description=None,
        requirement_type=RequirementType.CERTIFICATION,
        frequency=RequirementFrequency.ONE_TIME,
        training_type=None,
        required_hours=None,
        required_courses=None,
        required_shifts=None,
        required_calls=None,
        registry_code=None,
        category_ids=None,
        due_date=None,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        rolling_period_months=None,
        period_start_month=1,
        period_start_day=1,
        period_end_month=None,
        period_end_day=None,
        year=None,
        include_current_month=None,
        recency_days=None,
        applies_to_all=True,
        required_membership_types=None,
        required_roles=None,
        required_positions=None,
        new_member_cutoff_date=None,
        existing_member_deadline=None,
        applies_to_joined_before=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _record(name="Live Fire", completed=date(2026, 9, 1)):
    return SimpleNamespace(
        status=TrainingStatus.COMPLETED,
        course_name=name,
        course_id=None,
        training_type=None,
        certification_number=None,
        completion_date=completed,
        expiration_date=None,
        hours_completed=8,
        category_id=None,
    )


class TestMemberJoinDate:
    def test_hire_date_wins_over_account_creation(self):
        member = SimpleNamespace(
            hire_date=VETERAN,
            created_at=datetime(2026, 1, 5, tzinfo=timezone.utc),
        )
        assert member_join_date(member) == VETERAN

    def test_falls_back_to_the_account_creation_day(self):
        member = SimpleNamespace(
            hire_date=None,
            created_at=datetime(2026, 1, 5, 23, 0, tzinfo=timezone.utc),
        )
        assert member_join_date(member) == date(2026, 1, 5)

    def test_neither_date_is_unknown(self):
        assert member_join_date(SimpleNamespace()) is None
        assert join_date_from(None, None) is None


class TestAppliesByJoinDate:
    def test_no_dates_applies_to_everyone(self):
        assert requirement_applies_by_join_date(_req(), VETERAN)
        assert requirement_applies_by_join_date(_req(), RECRUIT)

    def test_exempt_policy_skips_members_who_joined_before_the_cutoff(self):
        req = _req(new_member_cutoff_date=CUTOFF)
        assert not requirement_applies_by_join_date(req, VETERAN)
        assert requirement_applies_by_join_date(req, RECRUIT)

    def test_the_cutoff_day_itself_is_a_new_member(self):
        req = _req(new_member_cutoff_date=CUTOFF)
        assert requirement_applies_by_join_date(req, CUTOFF)

    def test_catch_up_policy_still_includes_existing_members(self):
        req = _req(new_member_cutoff_date=CUTOFF, existing_member_deadline=DEADLINE)
        assert requirement_applies_by_join_date(req, VETERAN)

    def test_earlier_standard_stops_at_its_upper_bound(self):
        req = _req(applies_to_joined_before=CUTOFF)
        assert requirement_applies_by_join_date(req, VETERAN)
        assert not requirement_applies_by_join_date(req, CUTOFF)
        assert not requirement_applies_by_join_date(req, RECRUIT)

    def test_unknown_join_date_is_held_to_the_requirement(self):
        req = _req(new_member_cutoff_date=CUTOFF)
        assert requirement_applies_by_join_date(req, None)

    def test_dates_apply_before_membership_scope(self):
        req = _req(new_member_cutoff_date=CUTOFF)
        assert not requirement_applies_to_member(req, "active", join_date=VETERAN)
        assert requirement_applies_to_member(req, "active", join_date=RECRUIT)

    def test_user_form_reads_the_rank_for_required_roles(self):
        # required_roles holds rank slugs (CMP4-5); a position id there is
        # not how any writer fills it, and holding that position is no match.
        req = _req(applies_to_all=False, required_roles=["captain"])
        captain = SimpleNamespace(
            membership_type="active",
            rank="captain",
            positions=[],
            hire_date=VETERAN,
            created_at=None,
        )
        member = SimpleNamespace(
            membership_type="active",
            rank="firefighter",
            positions=[SimpleNamespace(id="captain", slug="officer")],
            hire_date=VETERAN,
            created_at=None,
        )
        assert requirement_applies_to_user(req, captain)
        assert not requirement_applies_to_user(req, member)


class TestCatchUpDeadline:
    req = _req(new_member_cutoff_date=CUTOFF, existing_member_deadline=DEADLINE)

    def test_protects_an_existing_member_until_the_deadline(self):
        assert catch_up_deadline(self.req, VETERAN, date(2026, 10, 1)) == DEADLINE
        assert catch_up_deadline(self.req, VETERAN, DEADLINE) == DEADLINE

    def test_lapses_the_day_after_the_deadline(self):
        assert catch_up_deadline(self.req, VETERAN, date(2027, 1, 1)) is None

    def test_never_protects_a_new_member(self):
        assert catch_up_deadline(self.req, RECRUIT, date(2026, 10, 1)) is None

    def test_needs_both_dates(self):
        assert (
            catch_up_deadline(_req(new_member_cutoff_date=CUTOFF), VETERAN, CUTOFF)
            is None
        )
        assert catch_up_deadline(_req(), VETERAN, CUTOFF) is None


class TestTallyStanding:
    def test_catch_up_counts_neither_way(self):
        assert tally_standing(
            ["completed", CATCH_UP_STATUS, "not_started", CATCH_UP_STATUS]
        ) == (1, 2)

    def test_only_catch_up_is_an_empty_tally(self):
        assert tally_standing([CATCH_UP_STATUS]) == (0, 0)


class TestEvaluationDuringCatchUp:
    req = _req(new_member_cutoff_date=CUTOFF, existing_member_deadline=DEADLINE)
    today = date(2026, 10, 1)

    def test_unmet_existing_member_reads_catch_up_with_the_deadline(self):
        ev = evaluate_member_requirement_detail(
            self.req, [], self.today, join_date=VETERAN
        )
        assert ev.status == CATCH_UP_STATUS
        assert ev.catch_up_deadline == DEADLINE.isoformat()

    def test_a_met_requirement_stays_met(self):
        ev = evaluate_member_requirement_detail(
            self.req, [_record()], self.today, join_date=VETERAN
        )
        assert ev.status == TrainingStatus.COMPLETED.value
        assert ev.catch_up_deadline is None

    def test_a_new_member_is_graded_normally(self):
        ev = evaluate_member_requirement_detail(
            self.req, [], self.today, join_date=RECRUIT
        )
        assert ev.status == "not_started"

    def test_after_the_deadline_it_counts(self):
        ev = evaluate_member_requirement_detail(
            self.req, [], date(2027, 1, 2), join_date=VETERAN
        )
        assert ev.status == "not_started"

    def test_without_a_join_date_the_rule_is_skipped(self):
        ev = evaluate_member_requirement_detail(self.req, [], self.today)
        assert ev.status == "not_started"

    def test_my_training_detail_reports_the_deadline_as_due(self):
        detail = TrainingService.evaluate_requirement_detail(
            self.req, [], self.today, join_date=VETERAN
        )
        assert detail["is_met"] is False
        assert detail["catch_up_deadline"] == DEADLINE.isoformat()
        assert detail["due_date"] == DEADLINE.isoformat()
        assert detail["days_until_due"] == (DEADLINE - self.today).days
        assert detail["blocks_activity"] is False

    def test_my_training_detail_without_catch_up_has_none(self):
        detail = TrainingService.evaluate_requirement_detail(
            self.req, [], self.today, join_date=RECRUIT
        )
        assert detail["catch_up_deadline"] is None


def _model_requirement(**overrides) -> TrainingRequirement:
    values = dict(
        id="orig-1",
        organization_id="org-1",
        name="Annual Hours",
        requirement_type=RequirementType.HOURS,
        source=RequirementSource.DEPARTMENT,
        required_hours=24.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        applies_to_all=False,
        required_membership_types=["active"],
        category_ids=["cat-1"],
        active=True,
        created_by="someone-else",
    )
    values.update(overrides)
    return TrainingRequirement(**values)


class TestSplitForNewMembers:
    def _service(self):
        db = MagicMock()
        return TrainingService(db), db

    def test_copy_carries_the_edit_and_original_keeps_the_old_standard(self):
        svc, db = self._service()
        original = _model_requirement()

        copy_ = svc.split_requirement_for_new_members(
            original, {"required_hours": 36.0}, CUTOFF, created_by="chief"
        )

        assert original.required_hours == 24.0
        assert original.applies_to_joined_before == CUTOFF
        assert copy_.required_hours == 36.0
        assert copy_.new_member_cutoff_date == CUTOFF
        assert copy_.existing_member_deadline is None
        assert copy_.applies_to_joined_before is None
        assert copy_.organization_id == "org-1"
        assert copy_.created_by == "chief"
        assert copy_ is not original
        assert copy_.required_membership_types == ["active"]
        db.add.assert_called_once_with(copy_)

    def test_copy_does_not_share_json_values_with_the_original(self):
        svc, _ = self._service()
        original = _model_requirement()
        copy_ = svc.split_requirement_for_new_members(
            original, {"required_hours": 36.0}, CUTOFF, created_by="chief"
        )
        copy_.category_ids.append("cat-2")
        assert original.category_ids == ["cat-1"]

    def test_together_they_grade_every_member_exactly_once(self):
        svc, _ = self._service()
        original = _model_requirement()
        copy_ = svc.split_requirement_for_new_members(
            original, {"required_hours": 36.0}, CUTOFF, created_by="chief"
        )
        for joined in (VETERAN, CUTOFF, RECRUIT):
            graded = [
                r
                for r in (original, copy_)
                if requirement_applies_by_join_date(r, joined)
            ]
            assert len(graded) == 1, joined

    def test_refuses_a_second_split_of_the_earlier_standard(self):
        svc, _ = self._service()
        original = _model_requirement(applies_to_joined_before=CUTOFF)
        with pytest.raises(ValueError, match="earlier standard"):
            svc.split_requirement_for_new_members(
                original, {"required_hours": 36.0}, RECRUIT, created_by="chief"
            )

    def test_refuses_an_effective_date_at_or_before_the_existing_cutoff(self):
        svc, _ = self._service()
        original = _model_requirement(new_member_cutoff_date=CUTOFF)
        with pytest.raises(
            ValueError, match="after this requirement's existing cutoff"
        ):
            svc.split_requirement_for_new_members(
                original, {"required_hours": 36.0}, CUTOFF, created_by="chief"
            )

    def test_refuses_a_change_to_grandfathering_or_active(self):
        svc, _ = self._service()
        original = _model_requirement()
        with pytest.raises(ValueError, match="active"):
            svc.split_requirement_for_new_members(
                original,
                {"required_hours": 36.0, "active": False},
                CUTOFF,
                created_by="chief",
            )

    def test_unchanged_grandfathering_fields_in_the_payload_are_fine(self):
        """The edit form sends every field it owns on every save."""
        svc, _ = self._service()
        original = _model_requirement()
        copy_ = svc.split_requirement_for_new_members(
            original,
            {
                "required_hours": 36.0,
                "new_member_cutoff_date": None,
                "existing_member_deadline": None,
                "active": True,
            },
            CUTOFF,
            created_by="chief",
        )
        assert copy_.new_member_cutoff_date == CUTOFF

    def test_refuses_a_split_that_changes_nothing(self):
        svc, _ = self._service()
        original = _model_requirement()
        with pytest.raises(ValueError, match="Nothing would change"):
            svc.split_requirement_for_new_members(
                original, {"required_hours": 24.0}, CUTOFF, created_by="chief"
            )


# Every function that decides who a requirement grades, or grades one member.
# A call that omits ``join_date`` silently ignores grandfathering — the exact
# drift that left the dashboard, the matrix and the profile card disagreeing
# about role-scoped requirements before ``requirement_applies_to_member``
# existed. ``requirement_applies_to_user`` reads the date off the member itself.
_NEEDS_JOIN_DATE = {
    "requirement_applies_to_member",
    "evaluate_member_requirement",
    "evaluate_member_requirement_detail",
    "_evaluate_member_requirement",
    "evaluate_requirement_detail",
    "_evaluate_member_compliance",
}


def test_every_caller_in_app_passes_a_join_date():
    app_dir = Path(__file__).resolve().parent.parent / "app"
    offenders = []
    for path in app_dir.rglob("*.py"):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.attr
                if isinstance(func, ast.Attribute)
                else func.id if isinstance(func, ast.Name) else None
            )
            if name not in _NEEDS_JOIN_DATE:
                continue
            if any(kw.arg == "join_date" for kw in node.keywords):
                continue
            offenders.append(f"{path.relative_to(app_dir.parent)}:{node.lineno} {name}")
    assert not offenders, (
        "These calls ignore requirement grandfathering; pass join_date="
        "member_join_date(member):\n" + "\n".join(offenders)
    )
