"""The seeded Compliance Officer position and its default suggestion box.

Three things are pinned here:

* the registry grants, including the deliberate inclusion of
  ``training.manage`` (the Compliance Officer dashboard is gated on it) and the
  deliberate omission of ``suggestions.manage``;
* migration ``3c918c06466d``, which brings both to departments onboarded before
  the position existed — run against a real (SQLite) connection rather than
  read, because the cases that matter are the rows it must leave alone;
* ``SuggestionService.seed_compliance_box``, the onboarding path, against the
  real schema.
"""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import select, text

from app.core.permissions import DEFAULT_POSITIONS, default_positions_for
from app.models.suggestion import SuggestionBox, SuggestionBoxReviewer
from app.services import suggestion_service
from app.services.suggestion_service import SuggestionService

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_3c918c06466d_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"
MIGRATION = MATCHES[0]


def _migration_module():
    spec = importlib.util.spec_from_file_location("seed_compliance", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestTheRegistryEntry:
    def test_grants_are_exactly_the_agreed_set(self):
        assert set(DEFAULT_POSITIONS["compliance_officer"]["permissions"]) == {
            "users.view",
            "members.view",
            "positions.view",
            "organization.view",
            "storefront.view",
            "storefront.order",
            "training.view",
            "training.view_all",
            "training.manage",
            "training.configure",
            "compliance.view",
            "compliance.manage",
            "reports.view",
            "reports.manage",
            "documents.view",
            "documents.manage",
            "forms.view",
            "events.view",
            "notifications.view",
        }

    def test_reviewing_a_box_needs_no_box_administration(self):
        # Reviewer access comes from the box's reviewer row; suggestions.manage
        # would let the officer reconfigure every box, including ones whose
        # submissions may concern them.
        assert (
            "suggestions.manage"
            not in DEFAULT_POSITIONS["compliance_officer"]["permissions"]
        )

    @pytest.mark.parametrize(
        "org_type", ["fire_department", "fire_ems_combined", "ems_only"]
    )
    def test_seeded_to_every_agency_type(self, org_type):
        assert "compliance_officer" in default_positions_for(org_type)


@pytest.mark.unit
class TestTheFrozenCopies:
    """Equal on the day the revision was written. When the registry later
    moves, this test is where that is noticed and a new revision written —
    the frozen copy itself never changes."""

    def test_position_matches_the_registry(self):
        frozen = _migration_module()._POSITION
        live = DEFAULT_POSITIONS["compliance_officer"]
        for key in ("name", "slug", "description", "priority"):
            assert frozen[key] == live[key]
        assert frozen["permissions"] == live["permissions"]

    def test_box_matches_the_service(self):
        frozen = _migration_module()._BOX
        assert frozen["name"] == suggestion_service.COMPLIANCE_BOX_NAME
        assert frozen["description"] == suggestion_service.COMPLIANCE_BOX_DESCRIPTION


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration_module(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "positions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
        sa.Column("priority", sa.Integer),
    )
    sa.Table(
        "user_positions",
        metadata,
        sa.Column("user_id", sa.String),
        sa.Column("position_id", sa.String),
    )
    sa.Table(
        "suggestion_boxes",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("anonymity_mode", sa.String),
        sa.Column("follow_up_enabled", sa.Boolean),
        sa.Column("is_active", sa.Boolean),
        sa.Column("created_by", sa.String),
    )
    sa.Table(
        "suggestion_box_reviewers",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("box_id", sa.String),
        sa.Column("position_id", sa.String),
        sa.Column("user_id", sa.String),
    )
    sa.Table(
        "suggestions",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("box_id", sa.String),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _exec(engine, sql, **params):
    with engine.begin() as connection:
        result = connection.execute(sa.text(sql), params)
        return result.fetchall() if result.returns_rows else []


def _position(engine, org, slug, is_system=True, name=None):
    position_id = str(uuid.uuid4())
    _exec(
        engine,
        "INSERT INTO positions (id, organization_id, name, slug, permissions, "
        "is_system, priority) VALUES (:i, :o, :n, :s, '[]', :sys, 10)",
        i=position_id,
        o=org,
        n=name or slug,
        s=slug,
        sys=is_system,
    )
    return position_id


def _officers(engine, org):
    return _exec(
        engine,
        "SELECT id, is_system, permissions FROM positions "
        "WHERE organization_id = :o AND slug = 'compliance_officer'",
        o=org,
    )


def _boxes(engine, org):
    return _exec(
        engine,
        "SELECT id, is_active, follow_up_enabled, anonymity_mode, description "
        "FROM suggestion_boxes WHERE organization_id = :o AND name = 'Compliance'",
        o=org,
    )


def _reviewers(engine, box_id):
    return [
        row.position_id
        for row in _exec(
            engine,
            "SELECT position_id FROM suggestion_box_reviewers WHERE box_id = :b",
            b=box_id,
        )
    ]


@pytest.mark.unit
class TestTheMigration:
    def test_creates_the_position_and_an_inactive_box_it_reviews(self, engine):
        _position(engine, "org-a", "member")
        _run(engine)

        [officer] = _officers(engine, "org-a")
        assert officer.is_system
        assert json.loads(officer.permissions) == (
            _migration_module()._POSITION["permissions"]
        )
        [box] = _boxes(engine, "org-a")
        assert not box.is_active
        assert box.follow_up_enabled
        assert box.anonymity_mode == "allowed"
        assert _reviewers(engine, box.id) == [officer.id]

    def test_is_idempotent(self, engine):
        _position(engine, "org-a", "member")
        _run(engine)
        _run(engine)
        assert len(_officers(engine, "org-a")) == 1
        assert len(_boxes(engine, "org-a")) == 1

    def test_skips_an_organization_never_onboarded(self, engine):
        _position(engine, "org-b", "custom", is_system=False)
        _run(engine)
        assert _officers(engine, "org-b") == []
        assert _boxes(engine, "org-b") == []

    def test_a_departments_own_position_is_kept_and_reviews_the_box(self, engine):
        _position(engine, "org-a", "member")
        own = _position(engine, "org-a", "compliance_officer", is_system=False)
        _run(engine)

        [officer] = _officers(engine, "org-a")
        assert officer.id == own
        assert not officer.is_system
        [box] = _boxes(engine, "org-a")
        assert _reviewers(engine, box.id) == [own]

    def test_a_departments_own_compliance_box_is_left_alone(self, engine):
        _position(engine, "org-a", "member")
        _exec(
            engine,
            "INSERT INTO suggestion_boxes (id, organization_id, name, description, "
            "anonymity_mode, follow_up_enabled, is_active, created_by) "
            "VALUES ('theirs', 'org-a', 'Compliance', 'Ours', 'required', 0, 1, 'u1')",
        )
        _run(engine)

        [box] = _boxes(engine, "org-a")
        assert box.id == "theirs"
        assert box.is_active
        assert box.description == "Ours"
        assert _reviewers(engine, "theirs") == []

    def test_downgrade_removes_only_what_it_wrote_and_nothing_in_use(self, engine):
        for org in ("org-a", "org-b", "org-c"):
            _position(engine, org, "member")
        _run(engine)

        # org-b appointed an officer; org-c's box received a report.
        [b_officer] = _officers(engine, "org-b")
        _exec(
            engine,
            "INSERT INTO user_positions (user_id, position_id) VALUES ('u', :p)",
            p=b_officer.id,
        )
        [c_box] = _boxes(engine, "org-c")
        _exec(
            engine,
            "INSERT INTO suggestions (id, box_id) VALUES ('s1', :b)",
            b=c_box.id,
        )
        _run(engine, "downgrade")

        assert _officers(engine, "org-a") == []
        assert _boxes(engine, "org-a") == []
        assert len(_officers(engine, "org-b")) == 1
        assert len(_boxes(engine, "org-c")) == 1

    def test_downgrade_never_touches_a_departments_own_rows(self, engine):
        _position(engine, "org-a", "member")
        own = _position(engine, "org-a", "compliance_officer", is_system=False)
        _exec(
            engine,
            "INSERT INTO suggestion_boxes (id, organization_id, name, description, "
            "anonymity_mode, follow_up_enabled, is_active, created_by) "
            "VALUES ('theirs', 'org-a', 'Compliance', 'Ours', 'allowed', 0, 1, NULL)",
        )
        _run(engine, "downgrade")
        assert [row.id for row in _officers(engine, "org-a")] == [own]
        assert [row.id for row in _boxes(engine, "org-a")] == ["theirs"]


# ---------------------------------------------------------------------------
# Onboarding path
# ---------------------------------------------------------------------------


async def _org(db) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"s-{org_id[:8]}"},
    )
    return org_id


async def _db_position(db, org_id: str, slug: str) -> str:
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, "
            "is_system, priority) VALUES (:id, :org, :name, :slug, '[]', 1, 60)"
        ),
        {"id": position_id, "org": org_id, "name": slug, "slug": slug},
    )
    return position_id


async def _db_boxes(db, org_id: str):
    result = await db.execute(
        select(SuggestionBox).where(
            SuggestionBox.organization_id == org_id,
            SuggestionBox.name == suggestion_service.COMPLIANCE_BOX_NAME,
        )
    )
    return list(result.scalars().all())


@pytest.mark.integration
class TestSeedComplianceBox:
    async def test_creates_an_inactive_box_reviewed_by_the_position(self, db_session):
        org_id = await _org(db_session)
        officer = await _db_position(db_session, org_id, "compliance_officer")

        box = await SuggestionService(db_session).seed_compliance_box(org_id)

        assert box is not None
        assert box.is_active is False
        assert box.follow_up_enabled is True
        reviewers = (
            (
                await db_session.execute(
                    select(SuggestionBoxReviewer.position_id).where(
                        SuggestionBoxReviewer.box_id == box.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert reviewers == [officer]

    async def test_is_idempotent(self, db_session):
        org_id = await _org(db_session)
        await _db_position(db_session, org_id, "compliance_officer")
        service = SuggestionService(db_session)

        assert await service.seed_compliance_box(org_id) is not None
        assert await service.seed_compliance_box(org_id) is None
        assert len(await _db_boxes(db_session, org_id)) == 1

    async def test_without_the_position_the_box_has_no_reviewer(self, db_session):
        # Still created, and inactive, so it cannot take reports into a void;
        # activating it requires a reviewer (_validate_box_write).
        org_id = await _org(db_session)

        box = await SuggestionService(db_session).seed_compliance_box(org_id)

        assert box is not None
        assert box.is_active is False
        count = (
            await db_session.execute(
                select(SuggestionBoxReviewer.id).where(
                    SuggestionBoxReviewer.box_id == box.id
                )
            )
        ).all()
        assert count == []
