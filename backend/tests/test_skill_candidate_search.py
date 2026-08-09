"""
Tests for the skills-testing candidate lookup.

Examining is open to every member, so every member can reach this endpoint —
which makes it the one place the feature could leak the department roster. It is
therefore a lookup, not a listing: a search fragment is required, wildcards in
it are neutralized, and the result count is capped. A caller can confirm a name
they already know; they cannot enumerate the department.

The query is asserted by compiling it, so no MySQL is needed.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.skills_testing import (
    CANDIDATE_SEARCH_MAX_RESULTS,
    CANDIDATE_SEARCH_MIN_CHARS,
    search_candidates,
)

ORG = "org-1"


def _user(first, last):
    return SimpleNamespace(
        id=str(uuid4()), first_name=first, last_name=last, username=None
    )


class RecordingSession:
    """Captures the statement so the filters can be asserted."""

    def __init__(self, users=()):
        self.statements = []
        self._users = list(users)

    async def execute(self, statement, *_args, **_kwargs):
        self.statements.append(statement)
        result = MagicMock()
        result.scalars.return_value.all.return_value = self._users
        return result

    @property
    def sql(self):
        return str(
            self.statements[-1].compile(compile_kwargs={"render_postcompile": True})
        )

    @property
    def params(self):
        return (
            self.statements[-1]
            .compile(compile_kwargs={"render_postcompile": True})
            .params
        )


async def _search(db, q, org=ORG):
    return await search_candidates(
        q=q, db=db, current_user=SimpleNamespace(id="caller", organization_id=org)
    )


class TestItIsALookupNotAListing:
    def test_the_search_term_is_required_by_the_route(self):
        """The load-bearing rule: with no optional-``q`` path there is no
        request that returns the roster. Asserted off the signature because
        FastAPI enforces it before the handler body runs, so calling the
        function directly cannot exercise it.
        """
        import inspect

        from pydantic_core import PydanticUndefined

        q = inspect.signature(search_candidates).parameters["q"].default

        assert q.default is PydanticUndefined, "q must have no default"
        assert any(
            getattr(m, "min_length", None) == CANDIDATE_SEARCH_MIN_CHARS
            for m in q.metadata
        )

    async def test_a_matching_name_comes_back(self):
        db = RecordingSession([_user("John", "Smith")])

        results = await _search(db, "smith")

        assert [r.name for r in results] == ["John Smith"]

    async def test_whitespace_only_query_is_refused(self):
        """It clears min_length but would otherwise LIKE-match every row."""
        db = RecordingSession()

        with pytest.raises(HTTPException) as exc:
            await _search(db, "   ")

        assert exc.value.status_code == 422
        assert not db.statements, "refused before touching the database"

    async def test_a_single_character_is_refused(self):
        """The floor is what stops "a" from matching most of the department."""
        db = RecordingSession()

        with pytest.raises(HTTPException) as exc:
            await _search(db, "a")

        assert exc.value.status_code == 422

    async def test_results_are_capped(self):
        """The floor alone is not enough — "an" still matches broadly, so the
        cap is what bounds any single search."""
        db = RecordingSession()

        await _search(db, "an")

        assert "LIMIT" in db.sql.upper()
        assert CANDIDATE_SEARCH_MAX_RESULTS in db.params.values()

    async def test_the_search_is_org_scoped(self):
        """Multi-tenant isolation: another department's roster is not reachable
        by searching for a name in it."""
        db = RecordingSession()

        await _search(db, "smith", org="org-A")

        assert "org-A" in db.params.values() or "org-A" in str(db.params)


class TestWildcardsAreNeutralized:
    """A member typing LIKE syntax must not widen their own search."""

    @pytest.mark.parametrize(
        ("typed", "expected"),
        [
            ("%", "%\\%%"),
            ("_", "%\\_%"),
            ("a%b", "%a\\%b%"),
            ("100%", "%100\\%%"),
            ("\\", "%\\\\%"),
        ],
    )
    async def test_wildcard_is_escaped(self, typed, expected):
        db = RecordingSession()

        # "%" alone is one char; pad so it clears the length floor and the
        # escaping is what is under test rather than the floor.
        padded = typed.ljust(CANDIDATE_SEARCH_MIN_CHARS, "x")
        await _search(db, padded)

        patterns = [v for v in db.params.values() if isinstance(v, str) and "%" in v]
        assert patterns, "expected a LIKE pattern among the bound parameters"
        assert expected.rstrip("%") in patterns[0]

    async def test_a_bare_wildcard_cannot_return_the_roster(self):
        """The whole point: "%%" must not become "match everything"."""
        db = RecordingSession()

        await _search(db, "%%")

        patterns = [v for v in db.params.values() if isinstance(v, str)]
        assert "%%%%" not in patterns
        assert any("\\%" in p for p in patterns)


class TestMatchingBehavior:
    async def test_a_full_name_fragment_matches(self):
        """ "john s" has to find John Smith — the reason matching is on the
        concatenated name rather than each column separately."""
        db = RecordingSession([_user("John", "Smith")])

        await _search(db, "john s")

        assert "concat" in db.sql.lower()
        assert any(
            isinstance(v, str) and "john s" in v.lower() for v in db.params.values()
        )

    async def test_only_active_members_are_searchable(self):
        db = RecordingSession()

        await _search(db, "smith")

        assert "status" in db.sql.lower()
        assert "deleted_at IS NULL" in db.sql
