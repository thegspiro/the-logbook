"""Migration 1a5c18b46791: the outreach vocabulary carried to stored rows.

Run against a real (SQLite) connection. What matters is which rows it leaves
alone: a title a department chose, a position a department created, and the
rest of a template body a department edited.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.services.email_templates_outreach import (
    HEADCOUNT_REMINDER_HTML,
    HEADCOUNT_REMINDER_TEXT,
)

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_1a5c18b46791_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

ORG = "org-1"
OLD_MANAGER = "Public Outreach"
OLD_MANAGER_DESC = "Manages public education and outreach events"
OLD_TEAM = "Community Education / Outreach Team"
OLD_TEAM_DESC = "Members who deliver community education and public outreach events"

# The template bodies as seeded before this revision: the current defaults
# with the report's old name put back.
OLD_HTML = HEADCOUNT_REMINDER_HTML.replace(
    "The Outreach\n        Impact report", "The Community\n        Engagement report"
)
OLD_TEXT = HEADCOUNT_REMINDER_TEXT.replace(
    "The Outreach Impact\nreport", "The Community Engagement\nreport"
)
# Guards the fixture itself: a default reworded so neither phrase matches
# would make every template test below pass without exercising anything.
assert OLD_HTML != HEADCOUNT_REMINDER_HTML
assert OLD_TEXT != HEADCOUNT_REMINDER_TEXT


def _migration():
    spec = importlib.util.spec_from_file_location("rename_outreach", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


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
        sa.Column("description", sa.String),
        sa.Column("is_system", sa.Boolean),
    )
    sa.Table(
        "email_templates",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("template_type", sa.String),
        sa.Column("html_body", sa.String),
        sa.Column("text_body", sa.String),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _position(engine, pid, slug, name, description, is_system=True):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO positions VALUES (:id, :org, :name, :slug, :desc, :sys)"
            ),
            {
                "id": pid,
                "org": ORG,
                "name": name,
                "slug": slug,
                "desc": description,
                "sys": is_system,
            },
        )


def _template(engine, tid, html, text, template_type="guest_headcount_reminder"):
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO email_templates VALUES (:id, :type, :html, :text)"),
            {"id": tid, "type": template_type, "html": html, "text": text},
        )


def _row(engine, table, rid, *columns):
    with engine.connect() as connection:
        return tuple(
            connection.execute(
                sa.text(f"SELECT {', '.join(columns)} FROM {table} WHERE id = :id"),
                {"id": rid},
            ).one()
        )


def _seed_defaults(engine):
    _position(engine, "mgr", "public_outreach", OLD_MANAGER, OLD_MANAGER_DESC)
    _position(engine, "team", "community_outreach_team", OLD_TEAM, OLD_TEAM_DESC)


class TestPositions:
    def test_the_seeded_positions_are_renamed(self, engine):
        _seed_defaults(engine)
        _run(engine)
        assert _row(engine, "positions", "mgr", "name", "description") == (
            "Community Outreach Manager",
            "Leads the department's community outreach and risk reduction work",
        )
        assert _row(engine, "positions", "team", "name", "description") == (
            "Community Outreach Team",
            "Members who deliver community outreach, education and risk "
            "reduction events",
        )

    def test_a_title_the_department_chose_is_kept(self, engine):
        _position(engine, "mgr", "public_outreach", "CRR Officer", "Our own words")
        _run(engine)
        assert _row(engine, "positions", "mgr", "name", "description") == (
            "CRR Officer",
            "Our own words",
        )

    def test_a_renamed_title_keeps_its_name_but_takes_the_new_description(self, engine):
        _position(engine, "mgr", "public_outreach", "CRR Officer", OLD_MANAGER_DESC)
        _run(engine)
        name, description = _row(engine, "positions", "mgr", "name", "description")
        assert name == "CRR Officer"
        assert description.startswith("Leads the department's")

    def test_a_department_created_position_is_not_touched(self, engine):
        _position(
            engine, "mgr", "public_outreach", OLD_MANAGER, OLD_MANAGER_DESC, False
        )
        _run(engine)
        assert _row(engine, "positions", "mgr", "name") == (OLD_MANAGER,)

    def test_another_slug_is_not_touched(self, engine):
        _position(engine, "other", "historian", OLD_MANAGER, OLD_MANAGER_DESC)
        _run(engine)
        assert _row(engine, "positions", "other", "name") == (OLD_MANAGER,)

    def test_a_second_run_changes_nothing(self, engine):
        _seed_defaults(engine)
        _run(engine)
        _run(engine)
        assert _row(engine, "positions", "mgr", "name") == (
            "Community Outreach Manager",
        )

    def test_downgrade_restores_the_old_wording(self, engine):
        _seed_defaults(engine)
        _run(engine)
        _run(engine, "downgrade")
        assert _row(engine, "positions", "mgr", "name", "description") == (
            OLD_MANAGER,
            OLD_MANAGER_DESC,
        )
        assert _row(engine, "positions", "team", "name", "description") == (
            OLD_TEAM,
            OLD_TEAM_DESC,
        )


class TestHeadcountReminderTemplate:
    def test_the_old_default_becomes_the_new_default(self, engine):
        _template(engine, "t1", OLD_HTML, OLD_TEXT)
        _run(engine)
        assert _row(engine, "email_templates", "t1", "html_body", "text_body") == (
            HEADCOUNT_REMINDER_HTML,
            HEADCOUNT_REMINDER_TEXT,
        )

    def test_a_department_edit_elsewhere_in_the_body_survives(self, engine):
        _template(engine, "t1", OLD_HTML + "<p>Thanks, Chief</p>", OLD_TEXT + "\nPS")
        _run(engine)
        html, text = _row(engine, "email_templates", "t1", "html_body", "text_body")
        assert html == HEADCOUNT_REMINDER_HTML + "<p>Thanks, Chief</p>"
        assert text == HEADCOUNT_REMINDER_TEXT + "\nPS"

    def test_another_template_type_is_not_touched(self, engine):
        _template(engine, "t1", OLD_HTML, OLD_TEXT, template_type="event_reminder")
        _run(engine)
        assert _row(engine, "email_templates", "t1", "html_body") == (OLD_HTML,)

    def test_a_null_text_body_is_left_null(self, engine):
        _template(engine, "t1", OLD_HTML, None)
        _run(engine)
        assert _row(engine, "email_templates", "t1", "text_body") == (None,)

    def test_downgrade_restores_the_old_body(self, engine):
        _template(engine, "t1", OLD_HTML, OLD_TEXT)
        _run(engine)
        _run(engine, "downgrade")
        assert _row(engine, "email_templates", "t1", "html_body", "text_body") == (
            OLD_HTML,
            OLD_TEXT,
        )


def test_missing_tables_are_skipped():
    # Either table may be one only create_all builds (pitfall #26).
    database = sa.create_engine("sqlite://")
    try:
        _run(database)
        _run(database, "downgrade")
    finally:
        database.dispose()
