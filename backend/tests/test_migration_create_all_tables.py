"""A migration must tolerate a table that only ``create_all`` builds.

40 of this schema's 254 tables are never created by any migration —
``event_requests``, ``prospects``, the whole finance-approval set and more.
They come into being when ``main.py``'s ``_fast_path_init()`` calls
``create_all()`` and stamps Alembic at head, which is the deployment model
``app/utils/enum_normalization`` documents.

A table a migration *renames* into existence (``op.rename_table``) does not
belong on that list even if nothing ``create_table``s it under its current
name — ``positions``/``user_positions`` looked like textbook examples until
CLAUDE.md Pitfall #26 was corrected on 2026-08-31 after a false positive
(``docs/security-review/MSG-25-messaging-notifications.md``, MSG-11).
``_tables_created_by_migrations`` below credits ``op.rename_table``
destinations for exactly this reason.

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
    """Tables a migration brings into existence, by their current name.

    ``op.create_table`` is the obvious case. ``op.rename_table(old, new)`` also
    counts, and for the *destination* name: ``20260805_0008`` renames
    ``roles``/``user_roles`` to ``positions``/``user_positions`` on the
    fresh-chain path (an earlier migration created ``roles`` outright), so a
    later migration reflecting ``positions`` is safe without its own guard —
    a fresh database always has it by then, since ``20260805_0008`` is a
    required upgrade-path ancestor of anything that reflects it. Missing this
    made ``positions``/``user_positions`` look create_all-only when they are
    not, which is what led a review to add an unnecessary (and, worse, a
    silently-data-lossy) existence guard to
    ``20260826_1700_d4e5f6a7b8c9_message_recipients.py`` — see that
    migration's own comment and MSG-11 in
    ``docs/security-review/MSG-25-messaging-notifications.md`` for the full
    account.
    """
    created: set[str] = set()
    for text in sources.values():
        created.update(re.findall(r"op\.create_table\(\s*[\"']([a-z0-9_]+)[\"']", text))
        created.update(
            re.findall(
                r"op\.rename_table\(\s*[\"'][a-z0-9_]+[\"']\s*,\s*[\"']([a-z0-9_]+)[\"']",
                text,
            )
        )
    return created


def _string_constants(text: str) -> dict[str, str]:
    """Module-level ``_TABLE = "positions"`` bindings, which several guards use."""
    return dict(re.findall(r"^(\w+)\s*=\s*[\"']([a-z0-9_]+)[\"']", text, re.MULTILINE))


def _table_list_variables(text: str) -> set[str]:
    """Names bound to a ``get_table_names()`` result, e.g. ``existing_tables``."""
    return set(
        re.findall(r"^\s*(\w+)\s*=\s*[^\n]*get_table_names\(\)", text, re.MULTILINE)
    )


def _guards_its_own_table(text: str) -> bool:
    """True when a ``_has_column``-style helper checks the table it is given.

    A migration whose helper returns False for a missing table is safe calling
    ``_has_column("event_requests", ...)`` with no separate ``_has_table``, so
    that shape has to count as guarding whatever table it is handed.
    """
    helper = re.search(r"def _has_column\(.*?\n(?=\S|\Z)", text, re.DOTALL)
    return bool(helper and "_has_table(" in helper.group(0))


def _guarded_tables(text: str) -> set[str]:
    """Tables this migration actually checks for, by name.

    A file-wide "is there a guard anywhere" test exempts every risky table in a
    file that guards only one of them — a migration that correctly guards
    ``skill_tests`` and then unconditionally alters ``event_requests`` reported
    clean while a fresh upgrade still died on it.
    """
    constants = _string_constants(text)
    guarded: set[str] = set()

    def add(name: str) -> None:
        if name in constants:
            guarded.add(constants[name])

    # _has_table("t") / inspector.has_table(bind, "t")
    guarded.update(
        re.findall(r"has_table\(\s*(?:[\w.]+\s*,\s*)?[\"']([a-z0-9_]+)[\"']", text)
    )
    for name in re.findall(r"has_table\(\s*(?:[\w.]+\s*,\s*)?(\w+)\s*\)", text):
        add(name)

    # "t" [not] in ...get_table_names()
    guarded.update(
        re.findall(
            r"[\"']([a-z0-9_]+)[\"']\s+(?:not\s+)?in\s+[^\n]*get_table_names\(\)", text
        )
    )
    for name in re.findall(
        r"\b(\w+)\s+(?:not\s+)?in\s+[^\n]*get_table_names\(\)", text
    ):
        add(name)

    # "t" [not] in existing_tables, where existing_tables holds the list
    for variable in _table_list_variables(text):
        guarded.update(
            re.findall(
                rf"[\"']([a-z0-9_]+)[\"']\s+(?:not\s+)?in\s+{re.escape(variable)}\b",
                text,
            )
        )
        for name in re.findall(
            rf"\b(\w+)\s+(?:not\s+)?in\s+{re.escape(variable)}\b", text
        ):
            add(name)

    # _has_column("t", "c") where the helper itself checks the table
    if _guards_its_own_table(text):
        guarded.update(re.findall(r"_has_column\(\s*[\"']([a-z0-9_]+)[\"']", text))
        for name in re.findall(r"_has_column\(\s*(\w+)\s*,", text):
            add(name)

    return guarded


def _returns_early_when_a_model_only_table_is_absent(
    text: str, create_all_only: set[str]
) -> bool:
    """True for ``if "t" not in ...get_table_names(): return`` on a model table.

    This exempts the whole file, and soundly: ``create_all()`` builds every
    model-declared table in a single call, so if one create_all-only table is
    present they all are. Two skills-testing migrations rely on exactly this —
    they test ``skill_templates`` and then alter ``skill_tests`` — and both are
    correct. The property does not hold for a migration-created table, which is
    why the table named in the guard must itself be create_all-only.
    """
    pattern = re.compile(
        r"if\s+[\"']([a-z0-9_]+)[\"']\s+not\s+in\s+[^\n]*get_table_names\(\)\s*:\s*\n"
        r"\s*return\b"
    )
    return any(table in create_all_only for table in pattern.findall(text))


def _find_offenders(sources: dict[str, str], create_all_only: set[str]) -> list[str]:
    """Migrations that alter a create_all-only table without checking for it.

    The check is per table, not per file: each risky table must be named by a
    guard of its own.
    """
    offenders = []
    for name, text in sorted(sources.items()):
        touched = (
            set(_TABLE_FIRST.findall(text)) | set(_TABLE_SECOND.findall(text))
        ) & create_all_only
        if _returns_early_when_a_model_only_table_is_absent(text, create_all_only):
            continue
        unguarded = touched - _guarded_tables(text)
        if unguarded:
            offenders.append(f"  {name} -> {', '.join(sorted(unguarded))}")
    return offenders


# A data-backfill migration can reflect a table with raw SQLAlchemy Core
# instead of an `op.*` operation — `sa.Table("t", meta, autoload_with=bind)` —
# which _TABLE_FIRST/_TABLE_SECOND never match (those only recognize `op.*`
# calls). An unguarded reflection of a genuinely create_all-only table raises
# the same NoSuchTableError on a fresh database as an unguarded
# `op.add_column` would, so this is a second, narrower detector for that
# specific shape rather than an extension of the `op.*` one.
#
# (`20260826_1700_d4e5f6a7b8c9_message_recipients.py`'s reflection of
# `positions`/`user_positions` was the motivating example for adding this
# detector, but turned out to be a false positive once
# `_tables_created_by_migrations` above was taught to recognize
# `op.rename_table` destinations — see that function's docstring. The
# detector itself is still worth keeping as a ratchet against a real future
# instance of this shape.)
_AUTOLOAD_TABLE = re.compile(
    r"sa\.Table\(\s*[\"']([a-z0-9_]+)[\"']\s*,\s*\w+\s*,\s*autoload_with="
)


def _find_autoload_offenders(
    sources: dict[str, str], create_all_only: set[str]
) -> list[str]:
    offenders = []
    for name, text in sorted(sources.items()):
        touched = set(_AUTOLOAD_TABLE.findall(text)) & create_all_only
        if _returns_early_when_a_model_only_table_is_absent(text, create_all_only):
            continue
        unguarded = touched - _guarded_tables(text)
        if unguarded:
            offenders.append(f"  {name} -> {', '.join(sorted(unguarded))}")
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


def test_migrations_reflecting_a_create_all_table_guard_on_its_existence():
    sources = _migration_sources()
    create_all_only = set(Base.metadata.tables) - _tables_created_by_migrations(sources)

    offenders = _find_autoload_offenders(sources, create_all_only)

    assert offenders == [], (
        "Migration(s) reflecting (`sa.Table(..., autoload_with=...)`) a table "
        "that no migration creates, without checking the table exists first. "
        "`alembic upgrade head` on a fresh database raises NoSuchTableError "
        "here and the whole upgrade fails:\n"
        + "\n".join(offenders)
        + "\n\nGuard the reflection:\n"
        "    existing_tables = set(sa.inspect(bind).get_table_names())\n"
        '    if "positions" not in existing_tables:\n'
        "        return\n"
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

    def test_a_guard_for_one_table_does_not_exempt_another(self):
        """The load-bearing case for a per-table check.

        A file-wide "is there a guard anywhere" test reported this clean while
        a fresh `alembic upgrade head` still died on the second add_column.
        """
        sources = {
            "0001_two_tables.py": (
                "def _has_table(t):\n"
                "    return t in sa.inspect(op.get_bind()).get_table_names()\n\n"
                "def upgrade():\n"
                '    if _has_table("skill_tests"):\n'
                '        op.add_column("skill_tests", sa.Column("a", sa.String(1)))\n'
                '    op.add_column("event_requests", sa.Column("b", sa.String(1)))\n'
            )
        }

        offenders = _find_offenders(sources, {"event_requests", "skill_tests"})

        assert len(offenders) == 1
        assert "event_requests" in offenders[0]
        assert "skill_tests" not in offenders[0]

    def test_an_early_return_on_a_sibling_model_table_guards_the_file(self):
        """`create_all()` builds every model table at once, so confirming one
        confirms all. Two skills-testing migrations depend on this."""
        sources = {
            "0001_early_return.py": (
                "def upgrade():\n"
                '    if "skill_templates" not in inspect(op.get_bind()).get_table_names():\n'
                "        return\n"
                '    op.add_column("skill_tests", sa.Column("a", sa.String(1)))\n'
            )
        }

        assert _find_offenders(sources, {"skill_templates", "skill_tests"}) == []

    def test_an_early_return_on_a_migration_built_table_does_not(self):
        """The exemption rests on the guard naming a create_all-only table.
        `shifts` is built by a migration, so its presence proves nothing about
        whether create_all has ever run."""
        sources = {
            "0001_early_return.py": (
                "def upgrade():\n"
                '    if "shifts" not in inspect(op.get_bind()).get_table_names():\n'
                "        return\n"
                '    op.add_column("event_requests", sa.Column("a", sa.String(1)))\n'
            )
        }

        offenders = _find_offenders(sources, {"event_requests"})

        assert len(offenders) == 1
        assert "event_requests" in offenders[0]

    def test_a_table_migrations_do_create_is_ignored(self):
        sources = {
            "0001_add_thing.py": (
                "def upgrade():\n"
                '    op.add_column("shifts", sa.Column("x", sa.String(1)))\n'
            )
        }

        assert _find_offenders(sources, self.CREATE_ALL_ONLY) == []

    def test_an_unguarded_reflection_is_flagged(self):
        """A raw `sa.Table(..., autoload_with=bind)` on a genuinely
        create_all-only table, which `_TABLE_FIRST`/`_TABLE_SECOND` (built
        for `op.*` calls) never see."""
        sources = {
            "0001_backfill.py": (
                "def upgrade():\n"
                "    bind = op.get_bind()\n"
                "    meta = sa.MetaData()\n"
                '    positions = sa.Table("positions", meta, autoload_with=bind)\n'
            )
        }

        offenders = _find_autoload_offenders(sources, {"positions"})

        assert len(offenders) == 1
        assert "positions" in offenders[0]

    def test_a_guarded_reflection_is_not_flagged(self):
        sources = {
            "0001_backfill.py": (
                "def upgrade():\n"
                "    bind = op.get_bind()\n"
                '    if "positions" not in sa.inspect(bind).get_table_names():\n'
                "        return\n"
                "    meta = sa.MetaData()\n"
                '    positions = sa.Table("positions", meta, autoload_with=bind)\n'
            )
        }

        assert _find_autoload_offenders(sources, {"positions"}) == []

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
