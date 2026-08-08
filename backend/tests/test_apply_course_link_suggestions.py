"""
Tests for scripts/apply_course_link_suggestions.py.

This script *writes* to compliance data, so the tests concentrate on the thing
that decides whether a write is safe: whether the intended course is
unambiguous. Attaching the wrong course to a requirement silently changes who
counts as compliant, so every tier that could plausibly be wrong must be
refused rather than guessed.

Pure decision logic plus a fake-session end-to-end; no MySQL.
"""

import importlib.util
import json
import pathlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "apply_course_link_suggestions.py"
)
_spec = importlib.util.spec_from_file_location("_apply_links", _SCRIPT)
applier = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(applier)


def _course(id_, name, code=None, active=True):
    return SimpleNamespace(id=id_, name=name, code=code, active=active)


CPR = _course("c-cpr", "CPR / BLS", "CPR")
ICS100 = _course("c-ics100", "ICS-100", "ICS100")
LADDERS = _course("c-lad", "Ladders 1", "LAD1")
LIBRARY = [CPR, ICS100, LADDERS]


class TestCandidates:
    def test_exact_name(self):
        assert applier._candidates("Ladders 1", LIBRARY) == [(LADDERS, "exact")]

    def test_exact_code_is_case_insensitive(self):
        assert applier._candidates("lad1", LIBRARY) == [(LADDERS, "exact")]

    def test_verbose_stored_text_contains_the_course_name(self):
        """The NIMS case — stored text spells out the library's short name."""
        result = applier._candidates(
            "ICS-100: Introduction to the Incident Command System", LIBRARY
        )
        assert result == [(ICS100, "contains-name")]

    def test_fragment_is_tiered_separately(self):
        """'Ladders' sits inside 'Ladders 1' — a piece, not a spelling-out."""
        assert applier._candidates("Ladders", LIBRARY) == [(LADDERS, "fragment")]

    def test_strongest_tier_wins_over_weaker_noise(self):
        library = [CPR, _course("c-x", "CPR / BLS Renewal Companion")]
        # "CPR / BLS" is exact for one and a fragment of the other; the exact
        # match must not be blocked by the fragment.
        assert applier._candidates("CPR / BLS", library) == [(CPR, "exact")]

    def test_all_candidates_at_the_same_tier_are_kept(self):
        library = [
            _course("c-1", "CPR Instructor"),
            _course("c-2", "CPR Renewal"),
        ]
        result = applier._candidates("CPR", library)
        assert len(result) == 2
        assert {tier for _, tier in result} == {"fragment"}

    def test_no_match(self):
        assert applier._candidates("Hazmat Awareness", LIBRARY) == []

    def test_empty_text(self):
        assert applier._candidates("   ", LIBRARY) == []


class TestClassify:
    def test_unique_exact_is_relinked(self):
        decision = applier._classify("Ladders 1", LIBRARY)
        assert decision["action"] == "relink"
        assert decision["course"] is LADDERS
        assert decision["tier"] == "exact"

    def test_unique_contains_name_is_relinked(self):
        decision = applier._classify("ICS-100: Introduction to ICS", LIBRARY)
        assert decision["action"] == "relink"
        assert decision["course"] is ICS100

    def test_fragment_is_never_auto_applied(self):
        """'CPR' inside 'CPR Instructor' is a coincidence, not evidence."""
        decision = applier._classify("Ladders", LIBRARY)
        assert decision["action"] == "skip"
        assert "fragment" in decision["reason"]

    def test_ambiguous_match_is_refused_even_at_a_strong_tier(self):
        library = [_course("c-1", "CPR"), _course("c-2", "cpr")]
        decision = applier._classify("CPR", library)
        assert decision["action"] == "skip"
        assert "ambiguous" in decision["reason"]
        assert "2 candidates" in decision["reason"]

    def test_dangling_uuid_is_left_alone(self):
        decision = applier._classify("99999999-9999-9999-9999-999999999999", LIBRARY)
        assert decision["action"] == "skip"
        assert decision["reason"] == "dangling id"

    def test_unmatched_name_is_left_alone(self):
        decision = applier._classify("Hazmat Awareness", LIBRARY)
        assert decision["action"] == "skip"
        assert "no match" in decision["reason"]


def _req(id_, name, entries, org="org-a", active=True):
    return SimpleNamespace(
        id=id_,
        organization_id=org,
        name=name,
        requirement_type="courses",
        required_courses=entries,
        active=active,
    )


ORG_A = SimpleNamespace(id="org-a", name="Falls Church")


def _fake_db(orgs, courses, requirements):
    from app.models.training import TrainingCourse, TrainingRequirement
    from app.models.user import Organization

    async def execute(stmt):
        entity = stmt.column_descriptions[0]["entity"]
        rows = {
            Organization: orgs,
            TrainingCourse: courses,
            TrainingRequirement: requirements,
        }[entity]
        return MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=lambda: rows)),
            scalar_one_or_none=MagicMock(return_value=rows[0] if rows else None),
        )

    db = MagicMock()
    db.execute = AsyncMock(side_effect=execute)
    db.commit = AsyncMock()
    return db


class TestPlan:
    async def test_resolvable_ids_produce_no_plan_entry(self):
        db = _fake_db([ORG_A], LIBRARY, [_req("r1", "CPR", ["c-cpr"])])
        assert await applier._plan(db, None, False) == []

    async def test_typed_in_name_is_planned_for_relink(self):
        db = _fake_db([ORG_A], LIBRARY, [_req("r1", "CPR", ["CPR / BLS"])])
        plan = await applier._plan(db, None, False)
        assert len(plan) == 1
        assert plan[0]["changed"] is True
        assert applier._new_value(plan[0]) == ["c-cpr"]

    async def test_mixed_requirement_keeps_resolvable_and_ambiguous_entries(self):
        """A partial fix is still a fix; the unresolved entry stays put."""
        db = _fake_db(
            [ORG_A],
            LIBRARY,
            [_req("r1", "Mixed", ["c-lad", "ICS-100: Intro", "Hazmat Awareness"])],
        )
        plan = await applier._plan(db, None, False)
        assert applier._new_value(plan[0]) == [
            "c-lad",
            "c-ics100",
            "Hazmat Awareness",
        ]

    async def test_ambiguous_only_requirement_is_reported_not_changed(self):
        library = [_course("c-1", "CPR Instructor"), _course("c-2", "CPR Renewal")]
        db = _fake_db([ORG_A], library, [_req("r1", "CPR", ["CPR"])])
        plan = await applier._plan(db, None, False)
        assert len(plan) == 1
        assert plan[0]["changed"] is False
        assert applier._new_value(plan[0]) == ["CPR"]

    async def test_requirements_without_entries_are_ignored(self):
        db = _fake_db(
            [ORG_A], LIBRARY, [_req("r1", "Hours", None), _req("r2", "Empty", [])]
        )
        assert await applier._plan(db, None, False) == []

    async def test_unknown_org_filter_exits(self):
        db = _fake_db([ORG_A], LIBRARY, [])
        with pytest.raises(SystemExit):
            await applier._plan(db, "nonexistent", False)


class TestApply:
    async def test_writes_new_value_and_commits(self, monkeypatch):
        monkeypatch.setattr(applier, "log_audit_event", AsyncMock())
        req = _req("r1", "CPR", ["CPR / BLS"])
        db = _fake_db([ORG_A], LIBRARY, [req])
        plan = await applier._plan(db, None, False)

        count = await applier._apply(db, plan, None)

        assert count == 1
        assert req.required_courses == ["c-cpr"]
        db.commit.assert_awaited()

    async def test_records_an_audit_event_per_change(self, monkeypatch):
        audit = AsyncMock()
        monkeypatch.setattr(applier, "log_audit_event", audit)
        db = _fake_db([ORG_A], LIBRARY, [_req("r1", "CPR", ["CPR / BLS"])])
        plan = await applier._plan(db, None, False)

        await applier._apply(db, plan, None)

        assert audit.await_count == 1
        payload = audit.await_args.kwargs
        assert payload["event_type"] == "training_requirement_courses_relinked"
        assert payload["event_data"]["before"] == ["CPR / BLS"]
        assert payload["event_data"]["after"] == ["c-cpr"]
        assert payload["organization_id"] == "org-a"

    async def test_nothing_to_change_does_not_commit(self, monkeypatch):
        monkeypatch.setattr(applier, "log_audit_event", AsyncMock())
        library = [_course("c-1", "CPR Instructor"), _course("c-2", "CPR Renewal")]
        db = _fake_db([ORG_A], library, [_req("r1", "CPR", ["CPR"])])
        plan = await applier._plan(db, None, False)

        assert await applier._apply(db, plan, None) == 0
        db.commit.assert_not_awaited()

    async def test_rollback_file_captures_before_and_after(self, monkeypatch, tmp_path):
        monkeypatch.setattr(applier, "log_audit_event", AsyncMock())
        db = _fake_db([ORG_A], LIBRARY, [_req("r1", "CPR", ["CPR / BLS"])])
        plan = await applier._plan(db, None, False)
        path = tmp_path / "rollback.json"

        await applier._apply(db, plan, str(path))

        payload = json.loads(path.read_text())
        change = payload["changes"][0]
        assert change["before"] == ["CPR / BLS"]
        assert change["after"] == ["c-cpr"]
        assert change["organization_id"] == "org-a"


class TestRestore:
    async def test_puts_the_previous_value_back(self, tmp_path):
        req = _req("r1", "CPR", ["c-cpr"])
        db = _fake_db([], [], [req])
        path = tmp_path / "rollback.json"
        path.write_text(
            json.dumps(
                {
                    "changes": [
                        {
                            "requirement_id": "r1",
                            "organization_id": "org-a",
                            "requirement_name": "CPR",
                            "before": ["CPR / BLS"],
                            "after": ["c-cpr"],
                        }
                    ]
                }
            )
        )

        assert await applier._restore(db, str(path)) == 0
        assert req.required_courses == ["CPR / BLS"]
        db.commit.assert_awaited()

    async def test_leaves_a_requirement_edited_since_the_relink(self, tmp_path):
        """Restoring would throw away whatever the officer did after."""
        req = _req("r1", "CPR", ["c-something-else"])
        db = _fake_db([], [], [req])
        path = tmp_path / "rollback.json"
        path.write_text(
            json.dumps(
                {
                    "changes": [
                        {
                            "requirement_id": "r1",
                            "organization_id": "org-a",
                            "requirement_name": "CPR",
                            "before": ["CPR / BLS"],
                            "after": ["c-cpr"],
                        }
                    ]
                }
            )
        )

        assert await applier._restore(db, str(path)) == 1
        assert req.required_courses == ["c-something-else"]
        db.commit.assert_not_awaited()

    async def test_empty_rollback_file_is_a_no_op(self, tmp_path):
        db = _fake_db([], [], [])
        path = tmp_path / "rollback.json"
        path.write_text(json.dumps({"changes": []}))
        assert await applier._restore(db, str(path)) == 0


class TestPlanReport:
    def test_dry_run_prompts_for_apply(self, capsys):
        plan = [
            {
                "org": ORG_A,
                "requirement": _req("r1", "CPR", ["CPR / BLS"]),
                "before": ["CPR / BLS"],
                "decisions": [
                    {
                        "value": "CPR / BLS",
                        "action": "relink",
                        "course": CPR,
                        "tier": "exact",
                    }
                ],
                "changed": True,
            }
        ]
        assert applier._print_plan(plan, applying=False) == 0
        out = capsys.readouterr().out
        assert "DRY RUN" in out
        assert "Re-run with --apply" in out

    def test_skipped_entries_make_it_exit_nonzero(self, capsys):
        plan = [
            {
                "org": ORG_A,
                "requirement": _req("r1", "CPR", ["CPR"]),
                "before": ["CPR"],
                "decisions": [
                    {"value": "CPR", "action": "skip", "reason": "ambiguous — 2"}
                ],
                "changed": False,
            }
        ]
        assert applier._print_plan(plan, applying=False) == 1
        assert "left for a human" in capsys.readouterr().out

    def test_empty_plan_is_clean(self, capsys):
        assert applier._print_plan([], applying=False) == 0
        assert "Nothing to do" in capsys.readouterr().out


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
