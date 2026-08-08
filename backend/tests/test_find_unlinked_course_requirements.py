"""
Tests for scripts/find_unlinked_course_requirements.py.

The script exists to find requirements whose ``required_courses`` hold typed-in
course *names* rather than course ids — those can never match a training record,
so the requirement can never be completed. What matters is that it classifies
each entry correctly and suggests a sane relink target, so those are what is
pinned here.

The pure helpers are called directly; _collect runs against a fake session
that answers its three selects, so the org-scoping is exercised too. No MySQL.
"""

import importlib.util
import pathlib
from types import SimpleNamespace

import pytest

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "find_unlinked_course_requirements.py"
)
_spec = importlib.util.spec_from_file_location("_find_unlinked", _SCRIPT)
finder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(finder)


def _course(id_, name, code=None, active=True):
    return SimpleNamespace(id=id_, name=name, code=code, active=active)


LIBRARY = [
    _course("11111111-1111-1111-1111-111111111111", "CPR / BLS", "CPR"),
    _course("22222222-2222-2222-2222-222222222222", "ICS-100", "ICS100"),
    _course("33333333-3333-3333-3333-333333333333", "Ladders 1", "LAD1"),
    _course("44444444-4444-4444-4444-444444444444", "Pump Ops", active=False),
]


class TestIsUuid:
    def test_recognizes_a_uuid(self):
        assert finder._is_uuid("11111111-1111-1111-1111-111111111111")

    def test_rejects_a_typed_in_name(self):
        assert not finder._is_uuid("ICS-100: Introduction to ICS")
        assert not finder._is_uuid("CPR")

    def test_handles_non_strings_without_raising(self):
        """required_courses is JSON — it can hold anything."""
        assert not finder._is_uuid(None)
        assert not finder._is_uuid(42)
        assert not finder._is_uuid({"a": 1})


class TestBestMatch:
    def test_exact_name_match(self):
        course, confidence = finder._best_match("Ladders 1", LIBRARY)
        assert course.id == "33333333-3333-3333-3333-333333333333"
        assert confidence == "exact"

    def test_exact_code_match_is_case_insensitive(self):
        course, confidence = finder._best_match("cpr", LIBRARY)
        assert course.name == "CPR / BLS"
        assert confidence == "exact"

    def test_stored_name_longer_than_library_name(self):
        """The real NIMS case: 'ICS-100: Introduction to the Incident Command
        System' was stored where the library simply has 'ICS-100'."""
        course, confidence = finder._best_match(
            "ICS-100: Introduction to the Incident Command System", LIBRARY
        )
        assert course.name == "ICS-100"
        assert confidence == "partial"

    def test_close_typo_matches_fuzzily(self):
        course, confidence = finder._best_match("Ladder 1", LIBRARY)
        assert course.name == "Ladders 1"
        assert confidence.startswith("fuzzy")

    def test_unrelated_text_gets_no_suggestion(self):
        assert finder._best_match("Hazmat Awareness Refresher", LIBRARY) is None

    def test_empty_text_gets_no_suggestion(self):
        assert finder._best_match("   ", LIBRARY) is None

    def test_archived_courses_are_still_suggestable(self):
        """An archived course is very likely what the name meant; the report
        labels it rather than hiding it."""
        course, _ = finder._best_match("Pump Ops", LIBRARY)
        assert course.active is False


def _finding(rtype="courses", unresolved=None, active=True, entries=None):
    org = SimpleNamespace(id="org-1", name="Falls Church")
    req = SimpleNamespace(
        id="req-1",
        name="CPR Certification",
        requirement_type=rtype,
        required_courses=entries if entries is not None else ["CPR"],
        active=active,
    )
    return {
        "org": org,
        "requirement": req,
        "resolved": [],
        "archived": [],
        "unresolved": (
            unresolved
            if unresolved is not None
            else [{"value": "CPR", "kind": "name", "suggestion": (LIBRARY[0], "exact")}]
        ),
    }


class TestReport:
    def test_clean_run_says_so(self, capsys):
        finder._print_report(
            [], {"requirements_scanned": 3, "entries_scanned": 7, "orgs": 1}
        )
        assert "No unresolved entries" in capsys.readouterr().out

    def test_courses_requirement_is_marked_blocking(self, capsys):
        finder._print_report(
            [_finding(rtype="courses")],
            {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1},
        )
        out = capsys.readouterr().out
        assert "[BLOCKING]" in out
        assert "can never reach 100%" in out

    def test_certification_requirement_is_only_degraded(self, capsys):
        """Certification still matches by name/registry, so it is not fatal."""
        finder._print_report(
            [_finding(rtype="certification")],
            {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1},
        )
        out = capsys.readouterr().out
        assert "[degraded]" in out
        assert "BLOCKING" not in out

    def test_suggestion_is_shown_with_the_course_id(self, capsys):
        finder._print_report(
            [_finding()], {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1}
        )
        out = capsys.readouterr().out
        assert "typed-in name: 'CPR'" in out
        assert "11111111-1111-1111-1111-111111111111" in out

    def test_dangling_id_is_labelled_differently(self, capsys):
        finder._print_report(
            [
                _finding(
                    unresolved=[
                        {
                            "value": "99999999-9999-9999-9999-999999999999",
                            "kind": "dangling",
                            "suggestion": None,
                        }
                    ]
                )
            ],
            {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1},
        )
        out = capsys.readouterr().out
        assert "dangling id" in out
        assert "no confident match" in out

    def test_inactive_requirement_is_flagged(self, capsys):
        finder._print_report(
            [_finding(active=False)],
            {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1},
        )
        assert "[inactive]" in capsys.readouterr().out


class TestJsonOutput:
    def test_shape_is_machine_readable(self):
        import json

        payload = json.loads(
            finder._to_json(
                [_finding()],
                {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1},
            )
        )
        assert payload["stats"]["requirements_scanned"] == 1
        entry = payload["findings"][0]
        assert entry["requirement_id"] == "req-1"
        assert entry["requirement_type"] == "courses"
        unresolved = entry["unresolved"][0]
        assert unresolved["kind"] == "name"
        assert unresolved["suggested_course_id"] == (
            "11111111-1111-1111-1111-111111111111"
        )

    def test_missing_suggestion_serializes_as_null(self):
        import json

        payload = json.loads(
            finder._to_json(
                [
                    _finding(
                        unresolved=[
                            {"value": "Hazmat", "kind": "name", "suggestion": None}
                        ]
                    )
                ],
                {"requirements_scanned": 1, "entries_scanned": 1, "orgs": 1},
            )
        )
        unresolved = payload["findings"][0]["unresolved"][0]
        assert unresolved["suggested_course_id"] is None
        assert unresolved["confidence"] is None


def _fake_session(orgs, courses_by_org, reqs_by_org):
    """Stands in for async_session_factory(): answers the three selects
    _collect issues, keyed by the model being queried."""
    from unittest.mock import AsyncMock, MagicMock

    from app.models.training import TrainingCourse, TrainingRequirement
    from app.models.user import Organization

    async def execute(stmt):
        entity = stmt.column_descriptions[0]["entity"]
        if entity is Organization:
            rows = orgs
        elif entity is TrainingCourse:
            org_id = _bound_org(stmt)
            rows = courses_by_org.get(org_id, [])
        elif entity is TrainingRequirement:
            org_id = _bound_org(stmt)
            rows = reqs_by_org.get(org_id, [])
        else:  # pragma: no cover
            raise AssertionError(f"unexpected query on {entity}")
        return MagicMock(scalars=MagicMock(return_value=MagicMock(all=lambda: rows)))

    def _bound_org(stmt):
        for value in stmt.compile().params.values():
            if isinstance(value, str) and value.startswith("org-"):
                return value
        return None

    session = MagicMock()
    session.execute = AsyncMock(side_effect=execute)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=session)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


def _req(id_, name, entries, rtype="courses", active=True):
    return SimpleNamespace(
        id=id_,
        name=name,
        requirement_type=rtype,
        required_courses=entries,
        active=active,
    )


ORG_A = SimpleNamespace(id="org-a", name="Falls Church")
ORG_B = SimpleNamespace(id="org-b", name="Neighbor Dept")


class TestCollect:
    async def test_resolvable_ids_are_not_reported(self, monkeypatch):
        monkeypatch.setattr(
            finder,
            "async_session_factory",
            _fake_session(
                [ORG_A],
                {"org-a": LIBRARY},
                {"org-a": [_req("r1", "CPR", [LIBRARY[0].id])]},
            ),
        )
        findings, stats = await finder._collect(None, False)
        assert findings == []
        assert stats["requirements_scanned"] == 1
        assert stats["entries_scanned"] == 1

    async def test_typed_in_name_is_reported_with_a_suggestion(self, monkeypatch):
        monkeypatch.setattr(
            finder,
            "async_session_factory",
            _fake_session(
                [ORG_A],
                {"org-a": LIBRARY},
                {"org-a": [_req("r1", "CPR req", ["CPR / BLS"])]},
            ),
        )
        findings, _ = await finder._collect(None, False)
        assert len(findings) == 1
        item = findings[0]["unresolved"][0]
        assert item["kind"] == "name"
        assert item["suggestion"][0].id == LIBRARY[0].id

    async def test_another_orgs_course_id_counts_as_unresolved(self, monkeypatch):
        """The cross-tenant case: a well-formed id that exists, but not here."""
        monkeypatch.setattr(
            finder,
            "async_session_factory",
            _fake_session(
                [ORG_A, ORG_B],
                {"org-a": [], "org-b": LIBRARY},
                {"org-a": [_req("r1", "Borrowed", [LIBRARY[0].id])], "org-b": []},
            ),
        )
        findings, _ = await finder._collect(None, False)
        assert len(findings) == 1
        assert findings[0]["unresolved"][0]["kind"] == "dangling"

    async def test_requirements_without_entries_are_skipped(self, monkeypatch):
        monkeypatch.setattr(
            finder,
            "async_session_factory",
            _fake_session(
                [ORG_A],
                {"org-a": LIBRARY},
                {"org-a": [_req("r1", "Hours", None), _req("r2", "Empty", [])]},
            ),
        )
        findings, stats = await finder._collect(None, False)
        assert findings == []
        assert stats["requirements_scanned"] == 0

    async def test_archived_but_resolvable_course_is_noted_not_reported(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            finder,
            "async_session_factory",
            _fake_session(
                [ORG_A],
                {"org-a": LIBRARY},
                {"org-a": [_req("r1", "Pumps", [LIBRARY[3].id])]},
            ),
        )
        findings, _ = await finder._collect(None, False)
        assert findings == []  # it resolves, so nothing is broken

    async def test_org_filter_matches_on_name_substring(self, monkeypatch):
        monkeypatch.setattr(
            finder,
            "async_session_factory",
            _fake_session(
                [ORG_A, ORG_B],
                {"org-a": [], "org-b": []},
                {
                    "org-a": [_req("r1", "A", ["typed"])],
                    "org-b": [_req("r2", "B", ["typed"])],
                },
            ),
        )
        findings, stats = await finder._collect("falls church", False)
        assert stats["orgs"] == 1
        assert [f["requirement"].id for f in findings] == ["r1"]

    async def test_unknown_org_filter_exits(self, monkeypatch):
        monkeypatch.setattr(
            finder, "async_session_factory", _fake_session([ORG_A], {}, {})
        )
        with pytest.raises(SystemExit):
            await finder._collect("nonexistent", False)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
