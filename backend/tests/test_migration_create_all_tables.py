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

import io
import re
import tokenize
from pathlib import Path

import pytest

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


def _function_body(text: str, name: str) -> str:
    """The text of one module-level ``def name(...):``, up to the next
    module-level ``def``."""
    match = re.search(
        rf"^def {re.escape(name)}\([^)]*\)[^:]*:\n(.*?)(?=\ndef \w|\Z)",
        text,
        re.DOTALL | re.MULTILINE,
    )
    return match.group(1) if match else ""


def _helper_functions(text: str) -> dict[str, str]:
    """Every module-level function in a migration file except
    ``upgrade``/``downgrade``, name -> body text."""
    return {
        m.group(1): _function_body(text, m.group(1))
        for m in re.finditer(r"^def (\w+)\([^)]*\)[^:]*:\n", text, re.MULTILINE)
        if m.group(1) not in ("upgrade", "downgrade")
    }


def _strip_comments_and_strings(text: str) -> str:
    """``text`` with every comment and string-literal token dropped.

    Used only to decide whether a helper's name is a real reference, not to
    produce text fed to the ``op.*``/``sa.Table`` regexes elsewhere in this
    file — those need the original formatting. Uses the stdlib tokenizer
    rather than a regex: a regex cannot reliably tell a triple-quoted
    docstring, an escaped quote, or an f-string from real code. Falls back
    to the unstripped text if tokenization fails (e.g. a synthetic snippet
    in a test that isn't valid standalone Python) — the same, already-
    accepted behavior as before this existed, not a new risk.
    """
    try:
        kept = [
            tok.string
            for tok in tokenize.generate_tokens(io.StringIO(text).readline)
            if tok.type not in (tokenize.COMMENT, tokenize.STRING)
        ]
    except Exception:
        return text
    return " ".join(kept)


def _upgrade_body(text: str) -> str:
    """The *reachable* text of a migration's ``upgrade()``: its own body,
    plus the body of any locally-defined helper function upgrade() invokes
    by name — directly, or indirectly (a lambda, a dispatch dict) — since
    this is a text scan, not an evaluator, and a helper's name appearing
    literally in upgrade()'s text is what "invokes" means here. Excludes a
    helper reachable only from ``downgrade()``.

    Two real shapes in this codebase need this: ``upgrade()`` calling a
    later-defined ``_create_organization_officers()`` directly
    (``20260807_0002_add_push_subscriptions.py``), and ``upgrade()``
    dispatching through a ``{name: lambda: helper()}`` table
    (``20260206_0301_add_missing_training_tables.py``). Scanning
    ``upgrade()``'s own text only would miss the ``op.create_table`` calls
    both delegate to, misclassifying their tables as create_all-only and
    making the ratchet reject the migration's own valid, already-guarded
    touches of them elsewhere.

    A ``rename_table`` destination that appears only in ``downgrade()`` —
    e.g. renaming back to a table dropped in ``upgrade()`` — does not exist
    on the fresh-upgrade path, so treating it as migration-created the same
    as an ``upgrade()``-side rename would be wrong in the dangerous
    direction: it would remove a genuinely create_all-only table from that
    set, letting an unguarded reflection of it slip past the ratchet.
    ``20260312_0200_rename_meeting_action_items_table.py``'s ``downgrade()``
    renames ``minutes_action_items`` back to ``meeting_action_items`` for
    exactly this shape (harmless today only because that table is also
    genuinely migration-created elsewhere). A helper reachable only from
    ``downgrade()`` is excluded the same way: it is never in ``included``
    unless its name is found inside something already in ``included``,
    and ``downgrade()`` itself never seeds that set.

    The signature match tolerates a return-type annotation
    (``def upgrade() -> None:``, used throughout this codebase) — an earlier,
    unannotated-only version of this pattern matched nothing at all and was
    caught before it shipped by comparing its output against the unscoped
    scan on the real migration chain.

    The reachability decision (does a helper's name appear in text already
    known reachable?) runs against ``_strip_comments_and_strings``'s output,
    not the raw text: a helper named only in a comment or docstring — dead,
    never actually called — would otherwise count as reachable and hide a
    real create_all-only table behind it, in the same dangerous direction
    every other guard in this function exists to prevent. This still is not
    full soundness (a name could in principle appear as an f-string
    expression segment, which the tokenizer treats as executable and does
    not strip) — closing that gap needs AST-level call-graph analysis, out
    of scope for what remains a text-based ratchet.
    """
    body = _function_body(text, "upgrade")
    helpers = _helper_functions(text)
    included = [body]
    pending = set(helpers)
    changed = True
    while changed:
        changed = False
        haystack = _strip_comments_and_strings("\n".join(included))
        for name in list(pending):
            if re.search(rf"\b{re.escape(name)}\b", haystack):
                included.append(helpers[name])
                pending.discard(name)
                changed = True
    return "\n".join(included)


def _tables_created_by_migrations(sources: dict[str, str]) -> set[str]:
    """Tables an ``upgrade()`` brings into existence, by their current name.

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
    account. Both are scoped to ``upgrade()`` — see ``_upgrade_body``.
    """
    created: set[str] = set()
    for text in sources.values():
        body = _upgrade_body(text)
        created.update(re.findall(r"op\.create_table\(\s*[\"']([a-z0-9_]+)[\"']", body))
        created.update(
            re.findall(
                r"op\.rename_table\(\s*[\"'][a-z0-9_]+[\"']\s*,\s*[\"']([a-z0-9_]+)[\"']",
                body,
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
# Tolerates the call shapes the exact-spelling version above missed: a bare
# (directly-imported) `Table(`, extra/reordered positional args before
# `autoload_with` (e.g. `extend_existing=True`), and one level of nested
# parens in an argument (`sa.MetaData()`) — but not more than one level,
# which every real usage in this repo stays within.
_AUTOLOAD_TABLE = re.compile(
    r"\b(?:\w+\.)?Table\(\s*[\"']([a-z0-9_]+)[\"']"
    r"(?:[^()]|\([^()]*\))*?"
    r"autoload_with\s*="
)


def _find_autoload_offenders(
    sources: dict[str, str], create_all_only: set[str]
) -> list[str]:
    """Scans ``_upgrade_body(text)``, not the whole file — a reflection that
    exists only in ``downgrade()`` (e.g. to rebuild legacy data on a
    downgrade) never runs on a fresh ``alembic upgrade head`` and must not
    be flagged as an offender. ``_tables_created_by_migrations`` above
    already scopes the same way for the same reason."""
    offenders = []
    for name, text in sorted(sources.items()):
        body = _upgrade_body(text)
        touched = set(_AUTOLOAD_TABLE.findall(body)) & create_all_only
        if _returns_early_when_a_model_only_table_is_absent(body, create_all_only):
            continue
        unguarded = touched - _guarded_tables(body)
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

    def test_a_downgrade_only_rename_does_not_count_as_created(self):
        """A rename destination that exists only in `downgrade()` — undoing
        an `upgrade()`-side rename away from that name — is not present on
        the fresh-upgrade path, so it must not be credited as
        migration-created. Crediting it would remove a genuinely
        create_all-only table from that set and let an unguarded upgrade-
        time reflection of it slip past this ratchet."""
        sources = {
            "0001_rename.py": (
                "def upgrade():\n"
                '    op.rename_table("event_requests", "renamed_requests")\n'
                "\n"
                "def downgrade():\n"
                '    op.rename_table("renamed_requests", "event_requests")\n'
            )
        }

        assert "event_requests" not in _tables_created_by_migrations(sources)
        assert "renamed_requests" in _tables_created_by_migrations(sources)

    def test_a_table_created_by_a_directly_called_helper_counts(self):
        """`upgrade()` calling a helper defined later in the same file —
        `20260807_0002_add_push_subscriptions.py`'s real shape — must not
        hide that helper's `op.create_table` from the created set."""
        sources = {
            "0001_delegates.py": (
                "def upgrade() -> None:\n"
                "    op.create_table('push_subscriptions', ...)\n"
                "    _create_organization_officers()\n"
                "\n"
                "def _create_organization_officers() -> None:\n"
                "    op.create_table('organization_officers', ...)\n"
                "\n"
                "def downgrade() -> None:\n"
                "    pass\n"
            )
        }

        created = _tables_created_by_migrations(sources)

        assert "organization_officers" in created
        assert "push_subscriptions" in created

    def test_a_table_created_by_a_dispatch_table_helper_counts(self):
        """`upgrade()` referencing a helper only inside a lambda stored in a
        dispatch dict — `20260206_0301_add_missing_training_tables.py`'s
        real shape — must still count; the helper's name appears as literal
        text in `upgrade()` even though it is never called directly."""
        sources = {
            "0001_dispatch.py": (
                "def upgrade() -> None:\n"
                "    table_name = 'skill_evaluations'\n"
                "    creators = {table_name: lambda: create_skill_evaluations_table()}\n"
                "    creators[table_name]()\n"
                "\n"
                "def create_skill_evaluations_table() -> None:\n"
                "    op.create_table('skill_evaluations', ...)\n"
                "\n"
                "def downgrade() -> None:\n"
                "    pass\n"
            )
        }

        assert "skill_evaluations" in _tables_created_by_migrations(sources)

    def test_a_helper_reachable_only_from_downgrade_does_not_count(self):
        """The mirror image of the two tests above: a helper `downgrade()`
        calls but `upgrade()` never mentions must not be credited — that
        table does not exist on the fresh-upgrade path."""
        sources = {
            "0001_downgrade_only_helper.py": (
                "def upgrade() -> None:\n"
                "    pass\n"
                "\n"
                "def _recreate_legacy_table() -> None:\n"
                "    op.create_table('legacy_table', ...)\n"
                "\n"
                "def downgrade() -> None:\n"
                "    _recreate_legacy_table()\n"
            )
        }

        assert "legacy_table" not in _tables_created_by_migrations(sources)

    def test_a_helper_named_only_in_a_comment_does_not_count(self):
        """A helper `upgrade()` never actually calls, merely mentioned in a
        comment or docstring, must not be credited — a dead reference is
        not a real one. Reproduces the pre-fix bug directly: without
        comment/string stripping, this table wrongly disappears from the
        created set."""
        sources = {
            "0001_dead_reference.py": (
                "def upgrade() -> None:\n"
                "    # NOTE: unlike _dead_helper(), this migration does its\n"
                "    # own work inline and never calls that helper.\n"
                "    pass\n"
                "\n"
                "def _dead_helper() -> None:\n"
                "    op.create_table('never_actually_created', ...)\n"
                "\n"
                "def downgrade() -> None:\n"
                "    pass\n"
            )
        }

        assert "never_actually_created" not in _tables_created_by_migrations(sources)

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

    def test_a_downgrade_only_reflection_is_not_flagged(self):
        """A reflection that exists only in `downgrade()` — e.g. to rebuild
        legacy data on a downgrade — never runs on a fresh `alembic upgrade
        head` and must not be treated as an offender."""
        sources = {
            "0001_backfill.py": (
                "def upgrade():\n"
                "    pass\n"
                "\n"
                "def downgrade():\n"
                "    bind = op.get_bind()\n"
                "    meta = sa.MetaData()\n"
                '    positions = sa.Table("positions", meta, autoload_with=bind)\n'
            )
        }

        assert _find_autoload_offenders(sources, {"positions"}) == []

    def test_an_unguarded_bare_table_import_is_flagged(self):
        """`from sqlalchemy import Table` then `Table(...)`, no `sa.` prefix —
        the exact-spelling version of this detector missed this."""
        sources = {
            "0001_backfill.py": (
                "def upgrade():\n"
                "    bind = op.get_bind()\n"
                "    meta = MetaData()\n"
                '    positions = Table("positions", meta, autoload_with=bind)\n'
            )
        }

        offenders = _find_autoload_offenders(sources, {"positions"})

        assert len(offenders) == 1
        assert "positions" in offenders[0]

    def test_an_unguarded_reflection_with_reordered_and_nested_args_is_flagged(self):
        """`autoload_with` need not be the third positional argument, and an
        argument can itself contain a call (`sa.MetaData()`)."""
        sources = {
            "0001_backfill.py": (
                "def upgrade():\n"
                "    bind = op.get_bind()\n"
                "    positions = sa.Table(\n"
                '        "positions", sa.MetaData(), extend_existing=True,\n'
                "        autoload_with=bind,\n"
                "    )\n"
            )
        }

        offenders = _find_autoload_offenders(sources, {"positions"})

        assert len(offenders) == 1
        assert "positions" in offenders[0]

    def test_a_table_name_embedded_in_a_longer_identifier_is_not_matched(self):
        """`MyTable(...)` is not `Table(...)` — the word boundary must hold
        even though the wider regex no longer requires an `sa.` prefix."""
        sources = {
            "0001_backfill.py": (
                "def upgrade():\n"
                "    bind = op.get_bind()\n"
                '    x = MyTable("positions", meta, autoload_with=bind)\n'
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


# ---------------------------------------------------------------------------
# The prose has to agree with the chain
# ---------------------------------------------------------------------------
#
# Pitfall #26 is stated in migration comments far more often than it is
# enforced, and the statement is what the next author copies. Eighteen
# revisions ended up asserting that ``positions`` is create_all-only because
# each was written from its predecessor; it is not, and CLAUDE.md records the
# unnecessary -- and data-lossy -- guard that reasoning already produced once.
#
# A claim is only wrong when the table is created by an ANCESTOR of the
# revision making it. Several ``positions`` claims run on branches that never
# descend from 20260805_0008, which renames ``roles`` into ``positions``, so
# for them the table genuinely is absent and the guard is load-bearing.
#
# Ancestry, not chain position, is what decides that. This chain is not linear:
# it has fork points and 23 merge revisions, so two siblings get adjacent
# positions from a linear walk while neither descends from the other. An
# earlier version of this check compared walk positions and would have called
# a sibling's correct claim an offender -- which is how you end up deleting a
# guard that is doing real work.

#: A claim is recognized by its *shape*, not from a list of phrasings.
#:
#: An enumerated allowlist does not converge: two consecutive reviews each found
#: a wording it did not cover ("nothing in the migration chain creates", then
#: "None of the three is created by a migration"), and each time the check
#: passed while the misinformation stood. Every one of these claims is the same
#: sentence though — a negation, near the word "migration", near a creation
#: verb — so anchoring on that catches the variant nobody has written yet.
#:
#: ``_GAP`` crosses a ``#`` continuation and light markup as well as whitespace:
#: the claim wraps mid-sentence in real files, and a pattern that cannot cross
#: the wrap silently matches nothing, which reads exactly like a clean run.
#:
#: The span limits are what keep it from joining two unrelated sentences. They
#: were set by measurement: this pattern reports exactly one offender across the
#: whole corpus, where anchoring on the ``create_all`` token instead — the
#: obvious generalization — flagged 50 files, because the phrasing is what makes
#: attribution to a particular table precise.
_GAP = r"[\s#*_`\-]"
_NEGATION = r"\b(?:no|none|nothing|never|not)\b"
#: Irregular past tenses are spelled out: "built" does not contain "build",
#: nor "made" "make", and a claim is as likely to be written in the past.
_CREATES = r"(?:creat|build|built|mak|made)"
_FILL = rf"(?:{_GAP}|\w|\(|\)|,)"
_CLAIM = re.compile(
    rf"{_NEGATION}{_FILL}{{0,90}}?"
    rf"(?:migration{_FILL}{{0,60}}?{_CREATES}|{_CREATES}{_FILL}{{0,60}}?migration)"
    rf"|model-only{_GAP}table",
    re.I | re.S,
)


def _revision_of(text: str) -> str | None:
    match = re.search(
        r'^revision(?:\s*:\s*str)?\s*=\s*["\']([^"\']+)', text, re.MULTILINE
    )
    return match.group(1) if match else None


def _parents_of(text: str) -> tuple[str, ...]:
    """Every immediate parent, including both sides of a merge revision."""
    match = re.search(r"^down_revision(?:\s*:[^=]*)?\s*=\s*(.+?)$", text, re.MULTILINE)
    if not match:
        return ()
    return tuple(re.findall(r'["\']([^"\']+)["\']', match.group(1)))


def _ancestor_sets(sources: dict[str, str]) -> dict[str, set[str]]:
    """Strict ancestors of every revision, following merges up both sides."""
    parents: dict[str, tuple[str, ...]] = {}
    for text in sources.values():
        revision = _revision_of(text)
        if revision is not None:
            parents[revision] = _parents_of(text)

    resolved: dict[str, set[str]] = {}

    def ancestors(revision: str) -> set[str]:
        if revision in resolved:
            return resolved[revision]
        resolved[revision] = set()  # cycles cannot happen, but do not hang if they do
        found: set[str] = set()
        for parent in parents.get(revision, ()):
            found.add(parent)
            found |= ancestors(parent)
        resolved[revision] = found
        return found

    return {revision: ancestors(revision) for revision in parents}


def _claim_blocks(text: str) -> list[str]:
    """The comment or docstring paragraph around each create_all-only claim."""
    blocks = []
    for match in _CLAIM.finditer(text):
        start = text.rfind("\n\n", 0, match.start())
        end = text.find("\n\n", match.end())
        blocks.append(
            text[0 if start == -1 else start : end if end != -1 else len(text)]
        )
    return blocks


def _false_claims(sources: dict[str, str]) -> list[str]:
    model_tables = set(Base.metadata.tables)
    ancestors = _ancestor_sets(sources)

    creators: dict[str, set[str]] = {}
    revisions: dict[str, str] = {}
    for name, text in sources.items():
        revision = _revision_of(text)
        if revision is None:
            continue
        revisions[name] = revision
        for table in _tables_created_by_migrations({name: text}):
            creators.setdefault(table, set()).add(revision)

    offenders = []
    for name, text in sources.items():
        revision = revisions.get(name)
        if revision is None:
            continue
        forebears = ancestors.get(revision, set())
        for block in _claim_blocks(text):
            named = set(re.findall(r"[a-z_]{4,}", block)) & model_tables
            for table in sorted(named):
                built_by = creators.get(table, set()) & forebears
                # A block that names the creating revision is refuting the
                # claim, not making it -- pitfall #26's own worked example is
                # prose that states the create_all-only reading in order to
                # reject it, and the shape-based pattern cannot tell a
                # refutation from an assertion. Citing the revision is the
                # signal, because it is exactly the fact this check exists to
                # establish: an author who names it has done the lookup, and
                # the only way to silence the check is to be right.
                unacknowledged = {rev for rev in built_by if rev not in block}
                if unacknowledged:
                    offenders.append(
                        f"{name} says `{table}` is create_all-only, but "
                        f"{sorted(unacknowledged)[0]} creates it and is an ancestor"
                    )
    return offenders


def test_no_migration_claims_a_table_is_create_all_only_when_it_is_not():
    """The prose is the thing that propagates, so the prose is what to check.

    Correcting a comment changes no behaviour, which is exactly why nothing
    stopped the claim being copied eighteen times.
    """
    assert _false_claims(_migration_sources()) == []


class TestTheClaimDetection:
    """Guard the guard.

    A ratchet that cannot fail is worse than none: it reads as enforcement
    while enforcing nothing. Every assertion here is a positive one -- a
    planted offender that MUST be reported -- because the real corpus is
    expected to be clean, so asserting cleanliness proves only that
    ``_false_claims`` returns something falsy.
    """

    def _plant(self, claim: str) -> list[str]:
        """Put *claim* on a real in-chain revision that descends from the rename."""
        sources = _migration_sources()
        planted = dict(sources)
        target = "20260905_0130_b4d1c8e37f52_restore_emt_seeded_grants.py"
        planted[target] = sources[target] + f"\n\n# {claim}\n"
        return _false_claims(planted)

    def test_a_planted_claim_on_a_descendant_is_reported(self):
        offenders = self._plant("positions is a model-only table.")

        assert any("b4d1c8e37f52" in o and "positions" in o for o in offenders), (
            "The detector did not report a false claim planted on a revision "
            "that descends from the one creating the table."
        )

    @pytest.mark.parametrize(
        "claim",
        [
            # Every wording found in the repository across three reviews.
            "positions -- no migration creates it.",
            "positions is a model-only table.",
            "nothing in the migration chain creates positions.",
            "no migration in this chain builds positions.",
            "positions is not created by any migration.",
            "positions is never created by a migration.",
            "None of the three is created by a migration; positions included.",
        ],
    )
    def test_every_recognized_form_is_caught(self, claim):
        """Each phrasing the repo uses, pinned by an offender rather than by
        its presence in the pattern -- so widening the alternation cannot
        quietly stop matching one of them."""
        assert self._plant(claim), f"not recognized as a claim: {claim!r}"

    def test_the_claim_survives_wrapping_across_a_newline(self):
        assert self._plant("positions -- no migration\n# creates it.")

    @pytest.mark.parametrize(
        "claim",
        [
            "positions? nothing whatsoever in any migration makes that table.",
            "not one migration in the whole chain has ever built positions.",
            "positions is never something a migration would create.",
            "no such migration creates positions.",
        ],
    )
    def test_a_wording_nobody_has_written_is_still_caught(self, claim):
        """The point of the change, and the assertion that would have failed
        before it.

        None of these appears anywhere in the repository -- they were invented
        here. An allowlist of phrasings passes this file's other tests and fails
        these, which is exactly how the check came to need widening twice in two
        reviews. Recognition is by shape now: a negation, near "migration", near
        a creation verb.
        """
        assert self._plant(claim), f"a novel phrasing evaded the check: {claim!r}"

    @pytest.mark.parametrize(
        "innocuous",
        [
            "This migration creates the positions index in one statement.",
            "positions is created by a migration, so no guard is needed.",
            "Nothing here needs a guard; positions has existed since the rename.",
        ],
    )
    def test_prose_that_is_not_a_claim_is_left_alone(self, innocuous):
        """The other half of a generalization: widening the anchor must not
        start reporting sentences that assert the opposite, or say nothing about
        creation at all. A check that flags correct prose gets deleted."""
        assert not self._plant(innocuous), f"false positive on: {innocuous!r}"

    def test_a_refutation_that_names_the_creating_revision_is_allowed(self):
        """The case that took `main` red on 2026-09-05.

        `d5f2b8c04a19` documents pitfall #26's own trap: it states the
        create_all-only reading of `positions` in order to reject it, and cites
        `20260805_0008`, the rename that builds the table. Shape-based
        recognition cannot tell that from an assertion -- both are a negation
        near "migration" near a creation verb -- so the check reported prose
        that is not merely correct but is the worked example the pitfall exists
        to teach.
        """
        assert not self._plant(
            "positions looks create_all-only -- no migration creates it under "
            "that name -- but 20260805_0008 renames roles into it."
        )

    def test_naming_an_unrelated_revision_does_not_excuse_the_claim(self):
        """The escape hatch is narrow on purpose: it opens only for the
        revision that actually creates the table, so it cannot be worked around
        by citing some other revision, and an author who opens it has by
        definition done the lookup the check asks for."""
        assert self._plant(
            "positions is a model-only table; see 20260809_0001 for context."
        )

    def test_a_sibling_is_not_an_ancestor(self):
        """The bug this replaced: a linear walk gives siblings adjacent
        positions, so comparing positions calls a sibling's correct claim an
        offender and invites deleting a load-bearing guard.

        20260809_0002 and 20260810_0001 both hang off 20260809_0001 and neither
        descends from the other.
        """
        ancestors = _ancestor_sets(_migration_sources())

        assert "20260809_0002" not in ancestors["20260810_0001"]
        assert "20260810_0001" not in ancestors["20260809_0002"]
        assert "20260809_0001" in ancestors["20260810_0001"]

    def test_a_merge_revision_inherits_both_sides(self):
        """Ancestry has to follow both parents of a merge or a claim on the
        far side looks unreachable and goes unchecked."""
        ancestors = _ancestor_sets(_migration_sources())

        assert {"20260814_0003", "20260813_0020"} <= ancestors["20260814_0004"]
