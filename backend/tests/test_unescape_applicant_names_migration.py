"""Migration 67fac0bf1c09: applicant names stored HTML-escaped are made plain.

Run with rows already in the table, because a backfill proves nothing on the
empty database CI migrates (CLAUDE.md Pitfall #35): escaped names, plain
names, a plain name with a bare ampersand, and the double-escaped
``&amp;amp;`` that must not be unescaped twice.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_67fac0bf1c09_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("unescape_names", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# (stored, expected after the backfill)
CASES = {
    "apostrophe": ("O&#x27;Brien", "O'Brien"),
    "ampersand": ("Smith &amp; Sons", "Smith & Sons"),
    "quote_and_angle": ("&quot;Doc&quot; &lt;Jr&gt;", '"Doc" <Jr>'),
    "plain": ("Jordan", "Jordan"),
    "bare_ampersand": ("Smith & Jones", "Smith & Jones"),
    # Raw quote beside an entity: edited by hand, not html.escape output.
    "mixed": ("O'Brien &amp; Co", "O'Brien &amp; Co"),
    # Unescaping once would leave "&amp;", which a second run would change
    # again; left as it is so the revision is idempotent.
    "double_escaped": ("A&amp;amp;B", "A&amp;amp;B"),
    # A named entity html.escape never writes: not this defect's output.
    "foreign_entity": ("Caf&eacute;", "Caf&eacute;"),
}


@pytest.mark.unit
class TestTheRule:
    @pytest.mark.parametrize("name", sorted(CASES))
    def test_each_value(self, name):
        stored, expected = CASES[name]
        plain = _migration()._plain_text(stored)
        assert (plain if plain is not None else stored) == expected

    def test_none_and_non_strings_are_left_alone(self):
        module = _migration()
        assert module._plain_text(None) is None
        assert module._plain_text(5) is None


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    yield database
    database.dispose()


def _create(engine):
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE prospective_members (id TEXT PRIMARY KEY, "
                "first_name TEXT NOT NULL, last_name TEXT NOT NULL, "
                "interest_reason TEXT, referral_source TEXT, email TEXT)"
            )
        )
        for key, (stored, _expected) in CASES.items():
            connection.execute(
                sa.text(
                    "INSERT INTO prospective_members VALUES "
                    "(:id, :first, :last, :reason, :ref, :email)"
                ),
                {
                    "id": key,
                    "first": stored,
                    "last": stored,
                    "reason": stored,
                    "ref": None,
                    # Encrypted at rest in the real table; never touched.
                    "email": "o&#x27;brien@example.com",
                },
            )


def _run(engine, step):
    module = _migration()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, step)()


def _rows(engine):
    with engine.begin() as connection:
        return {
            row.id: row
            for row in connection.execute(
                sa.text("SELECT * FROM prospective_members")
            ).fetchall()
        }


@pytest.mark.unit
class TestAgainstRows:
    def test_escaped_values_become_plain_and_the_rest_are_untouched(self, engine):
        _create(engine)
        _run(engine, "upgrade")
        rows = _rows(engine)
        for key, (_stored, expected) in CASES.items():
            assert rows[key].first_name == expected, key
            assert rows[key].last_name == expected, key
            assert rows[key].interest_reason == expected, key
            assert rows[key].referral_source is None
            assert rows[key].email == "o&#x27;brien@example.com"

    def test_running_twice_changes_nothing_more(self, engine):
        _create(engine)
        _run(engine, "upgrade")
        once = _rows(engine)
        _run(engine, "upgrade")
        assert _rows(engine) == once

    def test_downgrade_leaves_the_plain_text(self, engine):
        _create(engine)
        _run(engine, "upgrade")
        _run(engine, "downgrade")
        assert _rows(engine)["apostrophe"].first_name == "O'Brien"

    def test_a_table_create_all_has_not_built_is_skipped(self, engine):
        _run(engine, "upgrade")
        assert "prospective_members" not in sa.inspect(engine).get_table_names()


@pytest.mark.integration
class TestAgainstTheRealTable:
    """The same backfill on MySQL/MariaDB's prospective_members, with rows."""

    async def test_rows_present(self, db_session):
        org_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "slug": f"un-{org_id[:8]}"},
        )
        ids = {}
        for key, (stored, _expected) in CASES.items():
            ids[key] = str(uuid.uuid4())
            await db_session.execute(
                text(
                    "INSERT INTO prospective_members (id, organization_id, "
                    "first_name, last_name, email, interest_reason, "
                    "referral_source, status) VALUES (:id, :org, :first, :last, "
                    "'x', :reason, :ref, 'active')"
                ),
                {
                    "id": ids[key],
                    "org": org_id,
                    "first": stored,
                    "last": "Applicant",
                    "reason": stored,
                    "ref": stored,
                },
            )
        await db_session.flush()
        module = _migration()

        for _ in range(2):  # idempotent
            await db_session.run_sync(lambda s: module._backfill(s.connection()))

        result = await db_session.execute(
            text(
                "SELECT id, first_name, last_name, interest_reason, "
                "referral_source FROM prospective_members WHERE organization_id = :o"
            ),
            {"o": org_id},
        )
        rows = {row.id: row for row in result.fetchall()}
        for key, (_stored, expected) in CASES.items():
            row = rows[ids[key]]
            assert row.first_name == expected, key
            assert row.interest_reason == expected, key
            assert row.referral_source == expected, key
            assert row.last_name == "Applicant"
