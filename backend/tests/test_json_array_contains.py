"""JSON array membership is asked of the database, not matched as a substring.

Three queries filtered a ``Column(JSON)`` with ``.contains([value])``, which
reads as an array-membership test and is not one: ``contains_op`` is not in the
``JSON`` type's operator classes, so SQLAlchemy falls back to the *string*
operator and emits ``column LIKE concat('%', ?, '%')`` against the serialized
document. SQLAlchemy 2.1 deprecates that fallback and a future release raises
``InvalidRequestError`` for it -- but the deprecation was the smaller half of
the problem. Measured against the MariaDB these tests run on:

* A requirement tagged with two categories never matched. MySQL renders a
  stored array as ``["abc", "def"]``, so the pattern ``%["abc"]%`` matches only
  an array whose sole element is ``abc``. Session hours fed to a
  category-linked requirement silently skipped every multi-category one.
* ``position=%`` returned every requirement in the org, because the ``%`` the
  caller supplied landed inside a LIKE pattern. ``tests/test_like_escaping.py``
  exists to catch exactly that, and exempted these three sites by hand on the
  mistaken grounds that a list argument meant "a different operator".

``app.utils.json_ids.json_array_contains`` replaces the form at all three.
"""

import ast
import pathlib
import uuid
import warnings

import pytest
from sqlalchemy import JSON, Column, String, select
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import SADeprecationWarning
from sqlalchemy.orm import declarative_base

from app.models.training import (
    DueDateType,
    ProgramRequirement,
    RequirementFrequency,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import Organization
from app.services.training_program_service import TrainingProgramService
from app.services.training_session_service import TrainingSessionService
from app.utils.json_ids import json_array_contains

_Base = declarative_base()


class _Doc(_Base):
    """A standalone JSON column, so the compiled-SQL assertions below do not
    depend on any particular application model keeping its column type."""

    __tablename__ = "zz_json_array_contains_probe"
    id = Column(String(36), primary_key=True)
    tags = Column(JSON)


def _compile(expr) -> str:
    return " ".join(
        str(select(_Doc.id).where(expr).compile(dialect=mysql.dialect())).split()
    )


@pytest.mark.unit
class TestTheOperatorItCompilesTo:
    def test_the_old_form_is_a_like_and_is_deprecated(self):
        """Pins the behavior being replaced, so the reason this helper exists
        does not have to be taken on trust."""
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            sql = _compile(_Doc.tags.contains(["abc"]))

        assert "LIKE" in sql
        assert "json_contains" not in sql
        assert any(
            issubclass(w.category, SADeprecationWarning)
            and "contains_op" in str(w.message)
            for w in caught
        ), [str(w.message) for w in caught]

    def test_the_helper_asks_for_json_containment_and_is_not_deprecated(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            sql = _compile(json_array_contains(_Doc.tags, "abc"))

        assert "json_contains" in sql
        assert "LIKE" not in sql
        assert not [
            str(w.message)
            for w in caught
            if issubclass(w.category, SADeprecationWarning)
        ]

    def test_a_uuid_is_coerced_the_way_the_write_side_stores_it(self):
        """``normalize_id_list`` writes ``str(value).strip()``; a read that
        serialized the ``UUID`` object instead would match no row."""
        value = uuid.uuid4()
        bound = (
            select(_Doc.id)
            .where(json_array_contains(_Doc.tags, value))
            .compile(dialect=mysql.dialect())
        )
        assert f'"{value}"' in bound.params.values()


#: Operators the ``JSON`` type does not claim. Using one makes SQLAlchemy fall
#: back to the string implementation, which it deprecates and a future release
#: raises ``InvalidRequestError`` for.
_STRING_OPS = frozenset(
    {"like", "ilike", "contains", "startswith", "endswith", "regexp_match"}
)


def _json_columns_by_model() -> dict:
    """``{model name: {attribute names typed JSON}}``, from live mapper
    metadata rather than a hand-maintained list, so a column added tomorrow is
    covered without touching this file."""
    import app.models  # noqa: F401  -- importing populates the mapper registry
    from app.core.database import Base

    found: dict = {}
    for mapper in Base.registry.mappers:
        for column in mapper.columns:
            if isinstance(column.type, JSON):
                found.setdefault(mapper.class_.__name__, set()).add(column.key)
    return found


@pytest.mark.unit
def test_no_string_operator_targets_a_json_column():
    """A ratchet over ``app/``, resolving each receiver against real column
    types -- which is what a purely syntactic sweep cannot do, and why
    ``test_like_escaping.py`` exempted three of these by hand for months.

    Scoped honestly: it matches ``Model.attr.op(...)`` where ``Model`` is
    spelled as the mapped class's own name. A class imported under an alias, or
    a column reached through a variable, is not resolved -- so a clean run is a
    floor, not proof. The remedy for a JSON array is ``json_array_contains``;
    for a deliberate substring prefilter it is an explicit
    ``cast(Model.col, String)``, as ``call_tracking_service`` and
    ``events`` both do, which this check allows because the receiver is then a
    string expression in fact and not only by fallback.
    """
    json_columns = _json_columns_by_model()
    assert json_columns, "no JSON columns resolved -- the sweep would pass vacuously"

    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for path in sorted(app_dir.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in _STRING_OPS
            ):
                continue
            receiver = node.func.value
            if not (
                isinstance(receiver, ast.Attribute)
                and isinstance(receiver.value, ast.Name)
            ):
                continue
            if receiver.attr in json_columns.get(receiver.value.id, ()):
                rel = path.relative_to(app_dir.parent)
                offenders.append(
                    f"{rel}:{node.lineno} "
                    f"({receiver.value.id}.{receiver.attr}.{node.func.attr}())"
                )

    assert not offenders, (
        "These call a string operator on a JSON column. SQLAlchemy falls back "
        "to the string implementation -- deprecated, and InvalidRequestError in "
        "a future release -- and the fallback matches the serialized document, "
        "so a multi-element array never matches and the caller's term becomes a "
        "LIKE pattern. Use json_array_contains() for array membership, or an "
        "explicit cast(..., String) if a substring prefilter is what you "
        "want:\n  " + "\n  ".join(offenders)
    )


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="JSON Containment Department",
        slug=f"json-contains-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _requirement(db_session, org, name: str, **columns) -> TrainingRequirement:
    req = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        requirement_type=RequirementType.HOURS,
        required_hours=8.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        **columns,
    )
    db_session.add(req)
    await db_session.flush()
    return req


@pytest.mark.integration
class TestGetRequirementsByPosition:
    """``TrainingProgramService.get_requirements(position=...)`` -- the
    user-facing path for the ``required_positions`` filter."""

    async def test_a_requirement_naming_two_positions_is_returned(self, db_session):
        org = await _org(db_session)
        both = await _requirement(
            db_session,
            org,
            "Pump Operations",
            applies_to_all=False,
            required_positions=["officer", "aic"],
        )
        only = await _requirement(
            db_session,
            org,
            "Officer Development",
            applies_to_all=False,
            required_positions=["officer"],
        )

        found = await TrainingProgramService(db_session).get_requirements(
            organization_id=org.id, position="officer"
        )

        assert {r.id for r in found} == {both.id, only.id}

    async def test_a_wildcard_position_matches_nothing(self, db_session):
        """The term is a value now, not a LIKE pattern. Under the old form
        ``%`` came back with every requirement in the org."""
        org = await _org(db_session)
        await _requirement(
            db_session,
            org,
            "Pump Operations",
            applies_to_all=False,
            required_positions=["officer", "aic"],
        )
        await _requirement(
            db_session,
            org,
            "Driver Training",
            applies_to_all=False,
            required_positions=["driver_candidate"],
        )

        for term in ("%", "_", "offic%"):
            found = await TrainingProgramService(db_session).get_requirements(
                organization_id=org.id, position=term
            )
            assert found == [], f"{term!r} matched {[r.name for r in found]}"


@pytest.mark.integration
class TestResolveCategoryRequirementIds:
    """``TrainingSessionService._resolve_category_requirement_ids`` -- the
    call site that decides which requirements a session's hours credit."""

    async def test_a_requirement_tagged_with_two_categories_is_resolved(
        self, db_session
    ):
        org = await _org(db_session)
        category_id = str(uuid.uuid4())
        other_category_id = str(uuid.uuid4())

        multi = await _requirement(
            db_session,
            org,
            "Multi-Category Drill",
            category_ids=[category_id, other_category_id],
        )
        single = await _requirement(
            db_session, org, "Single-Category Drill", category_ids=[category_id]
        )
        unrelated = await _requirement(
            db_session, org, "Unrelated Drill", category_ids=[other_category_id]
        )
        untagged = await _requirement(db_session, org, "Untagged Drill")

        program = TrainingProgram(
            id=str(uuid.uuid4()), organization_id=org.id, name="Recruit School"
        )
        db_session.add(program)
        await db_session.flush()
        for req in (multi, single, unrelated, untagged):
            db_session.add(
                ProgramRequirement(
                    id=str(uuid.uuid4()),
                    program_id=program.id,
                    requirement_id=req.id,
                )
            )
        await db_session.flush()

        resolved = await TrainingSessionService(
            db_session
        )._resolve_category_requirement_ids(program.id, category_id, None)

        assert set(resolved) == {multi.id, single.id}
