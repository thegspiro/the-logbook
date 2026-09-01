"""Give testing checklist marks a run to belong to.

Revision ID: c4d8e2f7a913
Revises: b7c3e91d84af

Marks used to accumulate forever in one undifferentiated pile: there was no
way to say "this is what we tested before the 1.4 release", and clearing to
start a fresh pass destroyed the evidence of the last one. A run is one named
pass over the checklist. The newest run for an organization is the current
one — no active flag, so starting a run and archiving the previous one are the
same act and there is no state that can disagree with itself.

Also stamps each mark with the build it was made against, and with what the
screen predicted that account would meet, which is what makes "this page
opened for somebody it should have refused" visible instead of reading as an
ordinary pass.

**The backfill is one-way.** Existing marks are gathered into a single run per
department, labelled from the date of the earliest mark; the downgrade drops
the run rows along with the columns, and the label cannot be recovered.

Every step is guarded, per CLAUDE.md pitfall #26: `create_all()` builds these
tables from the models for any installation that starts the app before running
the upgrade, in which case the table already carries the new columns and the
new index, and an unguarded step would fail the whole migration run rather
than this one revision.
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "c4d8e2f7a913"
down_revision = "b7c3e91d84af"
branch_labels = None
depends_on = None


_ENTRIES = "testing_checklist_entries"
_RUNS = "testing_runs"
_OLD_UNIQUE = "idx_testing_check_unique"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _foreign_keys_on(table: str, column: str) -> list[str]:
    """Names of the foreign keys constraining ``column``, whatever they are called.

    The name cannot be assumed. This migration's own upgrade creates
    ``fk_testing_entry_run``, but these tables are create_all-only (CLAUDE.md
    pitfall #26), and an installation that started the app first has the
    constraint under SQLAlchemy's naming convention instead —
    ``fk_testing_checklist_entries_run_id_testing_runs``. Dropping by the
    hardcoded name leaves that installation's constraint in place, and the
    column drop behind it then fails with 1828.
    """
    return [
        fk["name"]
        for fk in _inspector().get_foreign_keys(table)
        if fk.get("name") and column in (fk.get("constrained_columns") or [])
    ]


def _index_columns(table: str, name: str) -> list[str] | None:
    for index in _inspector().get_indexes(table):
        if index["name"] == name:
            return list(index["column_names"])
    return None


def upgrade() -> None:
    if not _has_table(_RUNS):
        op.create_table(
            _RUNS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("build_id", sa.String(64), nullable=True),
            sa.Column(
                "started_by_id",
                sa.String(36),
                # SET NULL, so nullable — MySQL 1830 (pitfall #2).
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "started_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index("ix_testing_runs_organization_id", _RUNS, ["organization_id"])
        op.create_index(
            "idx_testing_run_org_sequence",
            _RUNS,
            ["organization_id", "sequence"],
            unique=True,
        )

    if not _has_table(_ENTRIES):
        # Nothing to alter: create_all will build it from the models, which
        # already declare every column and the new index.
        return

    if not _has_column(_ENTRIES, "build_id"):
        op.add_column(_ENTRIES, sa.Column("build_id", sa.String(64), nullable=True))
    if not _has_column(_ENTRIES, "expected_access"):
        op.add_column(
            _ENTRIES,
            sa.Column(
                "expected_access",
                sa.Enum(
                    "open",
                    "allowed",
                    "denied",
                    "module-off",
                    name="testingaccessexpectation",
                ),
                nullable=True,
            ),
        )

    if not _has_column(_ENTRIES, "run_id"):
        op.add_column(_ENTRIES, sa.Column("run_id", sa.String(36), nullable=True))

        # One run per department that has marks, labelled from the day testing
        # started. Written with the connection rather than the ORM so the
        # migration keeps behaving the way it did the day it ran, whatever the
        # models become (pitfall #20).
        bind = op.get_bind()
        organizations = bind.execute(
            sa.text(
                f"SELECT organization_id, MIN(created_at) AS started "
                f"FROM {_ENTRIES} GROUP BY organization_id"
            )
        ).fetchall()
        for organization_id, started in organizations:
            run_id = str(uuid.uuid4())
            label = f"Run of {started.date().isoformat()}" if started else "Earlier run"
            bind.execute(
                sa.text(
                    f"INSERT INTO {_RUNS} "
                    "(id, organization_id, sequence, label, started_at, "
                    "created_at, updated_at) "
                    "VALUES (:id, :org, 1, :label, :started, :started, :started)"
                ),
                {
                    "id": run_id,
                    "org": organization_id,
                    "label": label,
                    "started": started,
                },
            )
            bind.execute(
                sa.text(
                    f"UPDATE {_ENTRIES} SET run_id = :run "
                    "WHERE organization_id = :org AND run_id IS NULL"
                ),
                {"run": run_id, "org": organization_id},
            )

        op.alter_column(
            _ENTRIES,
            "run_id",
            existing_type=sa.String(36),
            nullable=False,
        )
        op.create_foreign_key(
            "fk_testing_entry_run",
            _ENTRIES,
            _RUNS,
            ["run_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # The uniqueness rule moves from (org, user, page) to (run, user, page), so
    # the next pass records fresh marks instead of overwriting the last one's.
    existing = _index_columns(_ENTRIES, _OLD_UNIQUE)
    if existing is not None and "run_id" not in existing:
        op.drop_index(_OLD_UNIQUE, table_name=_ENTRIES)
        existing = None
    if existing is None:
        op.create_index(
            _OLD_UNIQUE, _ENTRIES, ["run_id", "user_id", "route_path"], unique=True
        )


def _collapse_to_one_mark_per_page() -> None:
    """Keep the newest mark per (org, member, page); delete the rest.

    The old unique index is ``(organization_id, user_id, route_path)``, and a
    second run makes that key non-unique by design — one row per run. So the
    downgrade cannot simply recreate it: CREATE UNIQUE INDEX fails with 1062
    the moment a department has run the checklist twice, and MySQL DDL is not
    transactional, so the column and index drops above it have already
    committed. What is left is a table with no ``run_id`` and no unique index,
    still stamped as this revision, which Alembic will therefore never re-run:
    the /testing screen 1054s on every query and nothing self-heals.

    Collapsing first is lossy — the older passes' marks go — but the docstring
    already says the downgrade destroys run grouping, and losing the history
    the old schema could not represent is the intended shape of that. Losing
    the *schema* is not.
    """
    bind = op.get_bind()
    order = "e.checked_at DESC, e.id DESC"
    join = ""
    if _has_column(_ENTRIES, "run_id") and _has_table(_RUNS):
        # Newest run first; a mark whose run row is missing sorts last rather
        # than winning on a NULL.
        join = f" LEFT JOIN {_RUNS} r ON r.id = e.run_id"
        order = f"r.sequence DESC, {order}"
    rows = bind.execute(
        sa.text(
            f"SELECT e.id, e.organization_id, e.user_id, e.route_path "  # noqa: S608
            f"FROM {_ENTRIES} e{join} ORDER BY {order}"
        )
    ).fetchall()

    seen: set = set()
    doomed: list = []
    for row_id, organization_id, user_id, route_path in rows:
        key = (organization_id, user_id, route_path)
        if key in seen:
            doomed.append(row_id)
        else:
            seen.add(key)

    for start in range(0, len(doomed), 500):
        batch = doomed[start : start + 500]
        bind.execute(
            sa.text(
                f"DELETE FROM {_ENTRIES} WHERE id IN :ids"  # noqa: S608
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": batch},
        )


def downgrade() -> None:
    """Irreversible in substance: run labels and grouping are lost."""
    if _has_table(_ENTRIES):
        _collapse_to_one_mark_per_page()
        if _index_columns(_ENTRIES, _OLD_UNIQUE) is not None:
            op.drop_index(_OLD_UNIQUE, table_name=_ENTRIES)
        if _has_column(_ENTRIES, "run_id"):
            # Discovered rather than named, and dropped before the column: an
            # installation whose table came from create_all carries this
            # constraint under a different name, so a hardcoded drop either
            # aborts the downgrade (1091, the name is absent) or silently
            # skips and lets the column drop abort instead (1828, the
            # constraint still references it). Either way the run of DDL
            # above has already committed and the schema is left wedged.
            for fk_name in _foreign_keys_on(_ENTRIES, "run_id"):
                op.drop_constraint(fk_name, _ENTRIES, type_="foreignkey")
            op.drop_column(_ENTRIES, "run_id")
        for column in ("expected_access", "build_id"):
            if _has_column(_ENTRIES, column):
                op.drop_column(_ENTRIES, column)
        op.create_index(
            _OLD_UNIQUE,
            _ENTRIES,
            ["organization_id", "user_id", "route_path"],
            unique=True,
        )
    if _has_table(_RUNS):
        op.drop_table(_RUNS)
