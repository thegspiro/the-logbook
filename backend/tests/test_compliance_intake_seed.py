"""The Compliance box's default intake question.

* the service constant onboarding seeds is already in the canonical stored
  shape, and the migration's frozen copy matches it;
* migration ``4b7e1f0c9a2d`` gives it to existing departments' Compliance
  boxes — run against a real (SQLite) connection, because the cases that
  matter are the boxes it must leave alone;
* ``SuggestionService.seed_compliance_box`` gives it to new departments.
"""

import copy
import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.schemas.suggestion import IntakeQuestion
from app.services import suggestion_intake as intake
from app.services.suggestion_service import (
    COMPLIANCE_BOX_DESCRIPTION,
    COMPLIANCE_BOX_NAME,
    COMPLIANCE_INTAKE_QUESTIONS,
    SuggestionService,
)
from tests.test_compliance_officer_seeding import _db_position, _org

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_4b7e1f0c9a2d_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

SEEDED_AT = "2026-09-24 19:30:00"
EDITED_AT = "2026-09-24 19:45:00"


def _migration():
    spec = importlib.util.spec_from_file_location("seed_intake", MATCHES[0])
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# The question itself
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestTheSeededQuestion:
    def test_is_already_canonical(self):
        parsed = [IntakeQuestion.model_validate(q) for q in COMPLIANCE_INTAKE_QUESTIONS]
        assert intake.normalize_questions(parsed) == COMPLIANCE_INTAKE_QUESTIONS

    def test_routes_nowhere(self):
        assert intake.route_ids(COMPLIANCE_INTAKE_QUESTIONS) == []

    def test_asks_about_risk_only_for_a_safety_concern(self):
        snapshot, _ = intake.resolve_answers(
            COMPLIANCE_INTAKE_QUESTIONS, {"compliance_concern_type": "policy"}
        )
        assert [a["question_id"] for a in snapshot or []] == ["compliance_concern_type"]
        with pytest.raises(ValueError, match="immediate risk"):
            intake.resolve_answers(
                COMPLIANCE_INTAKE_QUESTIONS, {"compliance_concern_type": "safety"}
            )

    def test_migration_copy_matches_the_service(self):
        migration = _migration()
        assert migration._QUESTIONS == COMPLIANCE_INTAKE_QUESTIONS
        assert migration._BOX_NAME == COMPLIANCE_BOX_NAME
        assert migration._BOX_DESCRIPTION == COMPLIANCE_BOX_DESCRIPTION
        assert migration.down_revision == "778c3de73086"


# ---------------------------------------------------------------------------
# The migration, against SQLite
# ---------------------------------------------------------------------------


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "suggestion_boxes",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("name", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("created_by", sa.String),
        sa.Column("created_at", sa.String),
        sa.Column("updated_at", sa.String),
        sa.Column("intake_questions", sa.JSON),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


def _box(
    engine,
    box_id,
    *,
    description=COMPLIANCE_BOX_DESCRIPTION,
    created_by=None,
    updated_at=SEEDED_AT,
    questions=None,
):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO suggestion_boxes (id, name, description, created_by, "
                "created_at, updated_at, intake_questions) VALUES "
                "(:i, 'Compliance', :d, :c, :created, :updated, :q)"
            ),
            {
                "i": box_id,
                "d": description,
                "c": created_by,
                "created": SEEDED_AT,
                "updated": updated_at,
                "q": json.dumps(questions) if questions is not None else None,
            },
        )


def _questions(engine, box_id):
    with engine.begin() as connection:
        stored = connection.execute(
            sa.text("SELECT intake_questions FROM suggestion_boxes WHERE id = :i"),
            {"i": box_id},
        ).scalar()
    return json.loads(stored) if isinstance(stored, str) else stored


@pytest.mark.unit
class TestMigration:
    def test_seeds_an_unedited_box_idempotently(self, engine):
        _box(engine, "seeded")
        _run(engine)
        _run(engine)
        assert _questions(engine, "seeded") == COMPLIANCE_INTAKE_QUESTIONS

    def test_leaves_boxes_someone_has_shaped(self, engine):
        own = [{"id": "mine", "label": "Ours", "type": "text"}]
        _box(engine, "saved", updated_at=EDITED_AT)
        _box(engine, "theirs", created_by="admin")
        _box(engine, "reworded", description="Our own wording")
        _box(engine, "asked", questions=own)
        _run(engine)
        assert _questions(engine, "saved") is None
        assert _questions(engine, "theirs") is None
        assert _questions(engine, "reworded") is None
        assert _questions(engine, "asked") == own

    def test_downgrade_removes_only_the_untouched_seeded_copy(self, engine):
        changed = copy.deepcopy(COMPLIANCE_INTAKE_QUESTIONS)
        changed[0]["label"] = "Reworded by an admin"
        _box(engine, "seeded")
        _box(engine, "changed", questions=changed)
        _run(engine)
        _run(engine, "downgrade")
        assert _questions(engine, "seeded") is None
        assert _questions(engine, "changed") == changed


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestOnboardingSeed:
    async def test_new_compliance_box_asks_the_question(self, db_session):
        org_id = await _org(db_session)
        await _db_position(db_session, org_id, "compliance_officer")

        box = await SuggestionService(db_session).seed_compliance_box(org_id)

        assert box is not None
        assert box.intake_questions == COMPLIANCE_INTAKE_QUESTIONS
        # A copy, so editing one department's box cannot reach the constant.
        assert box.intake_questions is not COMPLIANCE_INTAKE_QUESTIONS
