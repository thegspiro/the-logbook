"""A migration must tolerate a table that only ``create_all`` builds.

39 of this schema's 254 tables are never created by any migration —
``event_requests``, ``prospects``, ``positions``, the whole finance-approval
set and more. They come into being when ``main.py``'s ``_fast_path_init()``
calls ``create_all()`` and stamps Alembic at head, which is the deployment
model ``app/utils/enum_normalization`` documents.

That is a deliberate design, and it is also a trap, because CI's integration
and contract jobs run ``alembic upgrade head`` against an **empty** database
before anything calls ``create_all``. A migration that reflects a column on
one of those tables raises ``NoSuchTableError`` and takes the entire upgrade
down — not just its own step. That is what happened on 2026-08-24: two
migrations adding columns to ``event_requests`` failed on every fresh
database, which would have been four red matrix jobs (MySQL 8.0 and MariaDB
10.11, integration and contract) had it reached CI.

The fix is not to stop writing such migrations. It is to guard them, which
fifteen of the sixteen existing ones already do:

    def _has_table(table: str) -> bool:
        return table in sa.inspect(op.get_bind()).get_table_names()

    if _has_table("event_requests") and not _has_column(...):
        op.add_column(...)

Skipping is correct rather than merely safe: a table ``create_all`` builds
later is built from the models, which already declare the new column.

This test is a ratchet — it passed with zero offenders when it was written.
"""

import re
from pathlib import Path

import app.models  # noqa: F401 - importing registers every model on the metadata
from app.core.database import Base

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# The table is the FIRST argument to these operations...
_TABLE_FIRST = re.compile(
    r"op\.(?:add_column|drop_column|alter_column)\(\s*[\"']([a-z0-9_]+)[\"']"
)
# ...and the SECOND to these, where a constraint or index name comes first.
# Reading the first argument for these is what made an early version of this
# check flag `op.add_column("shifts", sa.Column("positions", ...))` as
# touching a table called "positions".
_TABLE_SECOND = re.compile(
    r"op\.(?:create_index|drop_index|create_foreign_key|create_unique_constraint"
    r"|drop_constraint|create_check_constraint)\(\s*[^,]+,\s*[\"']([a-z0-9_]+)[\"']"
)
_GUARDS = ("get_table_names", "has_table")


def _migration_sources() -> dict[str, str]:
    return {
        path.name: path.read_text()
        for path in sorted(VERSIONS_DIR.glob("*.py"))
        if path.name != "__init__.py"
    }


def _tables_created_by_migrations(sources: dict[str, str]) -> set[str]:
    created: set[str] = set()
    for text in sources.values():
        created.update(re.findall(r"op\.create_table\(\s*[\"']([a-z0-9_]+)[\"']", text))
    return created


def _find_offenders(sources: dict[str, str], create_all_only: set[str]) -> list[str]:
    """Migrations that alter a create_all-only table without checking for it.

    Deliberately a text-level check: it looks for any table-existence guard in
    the file rather than proving that guard wraps the risky call. Matching a
    guard to its statement needs the AST and buys little — the failure this
    exists to stop is a migration written with no such handling at all, which
    contains none of these tokens anywhere.
    """
    offenders = []
    for name, text in sorted(sources.items()):
        touched = (
            set(_TABLE_FIRST.findall(text)) | set(_TABLE_SECOND.findall(text))
        ) & create_all_only
        if touched and not any(guard in text for guard in _GUARDS):
            offenders.append(f"  {name} -> {', '.join(sorted(touched))}")
    return offenders


def test_migrations_touching_a_create_all_table_guard_on_its_existence():
    sources = _migration_sources()
    create_all_only = set(Base.metadata.tables) - _tables_created_by_migrations(sources)

    offenders = _find_offenders(sources, create_all_only)

    assert offenders == [], (
        "Migration(s) altering a table that no migration creates, without "
        "checking the table exists first. `alembic upgrade head` on a fresh "
        "database raises NoSuchTableError here and the whole upgrade fails:\n"
        + "\n".join(offenders)
        + "\n\nGuard the step:\n"
        "    def _has_table(table):\n"
        "        return table in sa.inspect(op.get_bind()).get_table_names()\n"
    )


def test_the_create_all_only_set_is_real():
    """Guard the guard.

    If the detection of "created by a migration" ever breaks — a regex that
    stops matching op.create_table, say — every table looks create_all-only,
    the test above starts flagging migrations at random, and somebody deletes
    it. If instead nothing looks create_all-only, the check silently stops
    checking. Both failure modes are caught by asserting the shape of the
    split rather than an exact count, which would just churn.
    """
    sources = _migration_sources()
    created = _tables_created_by_migrations(sources)
    model_tables = set(Base.metadata.tables)

    assert len(created & model_tables) > 100, (
        "Almost no model table looks created-by-migration; the create_table "
        "detection is probably broken."
    )
    assert model_tables - created, (
        "No table looks create_all-only any more. If migrations genuinely "
        "create every table now, delete this module and the guard it "
        "documents — do not leave a check that cannot fail."
    )
    # event_requests is the one that actually broke; keep it named so the
    # example in the docstring stays true.
    assert "event_requests" in model_tables - created


class TestTheDetectionItself:
    """Pin the mechanism, not just today's clean result.

    A ratchet that passes because its detection quietly stopped working is
    worse than no ratchet: it reports "no offenders" forever. These drive the
    finder with synthetic migrations so both answers are proven.
    """

    CREATE_ALL_ONLY = {"event_requests"}

    def test_an_unguarded_add_column_is_flagged(self):
        sources = {
            "0001_add_thing.py": (
                "def upgrade():\n"
                '    op.add_column("event_requests", sa.Column("x", sa.String(1)))\n'
            )
        }

        offenders = _find_offenders(sources, self.CREATE_ALL_ONLY)

        assert len(offenders) == 1
        assert "event_requests" in offenders[0]

    def test_a_guarded_add_column_is_not_flagged(self):
        sources = {
            "0001_add_thing.py": (
                "def _has_table(t):\n"
                "    return t in sa.inspect(op.get_bind()).get_table_names()\n\n"
                "def upgrade():\n"
                '    if _has_table("event_requests"):\n'
                '        op.add_column("event_requests", sa.Column("x", sa.String(1)))\n'
            )
        }

        assert _find_offenders(sources, self.CREATE_ALL_ONLY) == []

    def test_a_table_migrations_do_create_is_ignored(self):
        sources = {
            "0001_add_thing.py": (
                "def upgrade():\n"
                '    op.add_column("shifts", sa.Column("x", sa.String(1)))\n'
            )
        }

        assert _find_offenders(sources, self.CREATE_ALL_ONLY) == []

    def test_a_column_named_like_a_table_is_not_mistaken_for_one(self):
        """`op.add_column("shifts", sa.Column("positions", ...))` touches
        `shifts`. An early version of this check read the second string and
        flagged the real migration that does exactly this."""
        sources = {
            "0001_add_positions.py": (
                "def upgrade():\n"
                '    op.add_column("shifts", sa.Column("positions", sa.JSON()))\n'
            )
        }

        assert _find_offenders(sources, {"positions"}) == []

    def test_a_constraint_name_is_not_mistaken_for_the_table(self):
        """create_foreign_key takes the constraint name first, the table second."""
        sources = {
            "0001_fk.py": (
                "def upgrade():\n"
                '    op.create_foreign_key("fk_event_requests_shift", '
                '"event_requests", "shifts", ["a"], ["id"])\n'
            )
        }

        offenders = _find_offenders(sources, self.CREATE_ALL_ONLY)

        assert len(offenders) == 1, "the second argument is the table"
