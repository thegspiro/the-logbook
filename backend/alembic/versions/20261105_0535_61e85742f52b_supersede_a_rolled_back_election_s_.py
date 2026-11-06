"""Supersede a rolled-back election's filed result with a dated correction

Owner decision 2026-11-01 (ELEC-49): when an election whose result is filed
with circulated or adopted minutes is rolled back, a dated correction is filed
against that result rather than editing or deleting it, and a re-run election
files its new result beside it.

``minutes_election_results`` gains ``superseded_at``, ``superseded_reason`` and
``superseded_by`` (the correction), and ``current_election_id``: the election's
id while the row is its standing result, NULL once superseded. The unique pair
(minutes_id, election_id) becomes (minutes_id, current_election_id), so a
superseded result no longer blocks the re-run's result from being filed, while
two standing results for one election still cannot.

Existing rows:

* ``current_election_id`` is set to ``election_id`` on every row, so each
  standing result keeps its slot. The old pair was unique, so the new key is
  too.
* A result filed before its election was rolled back from closed is stale
  today: the rollback left it as it was. Each such row is superseded now, dated
  by and carrying the reason of the first rollback from closed recorded on the
  election after the row was filed (``elections.rollback_history``). A draft's
  stale row is superseded too, not deleted as a rollback now does with a draft
  result: the migration does not remove what a secretary filed. They can remove
  it from the draft by hand. A re-run that has already re-closed has no result
  filed yet (the old pair blocked it); a manager can now import it by hand.

Downgrade: drops the correction columns and restores the old pair. A pair can
then hold one row, so for each (minutes, election) it keeps the standing
result, or the latest superseded one when none stands, and deletes the other
superseded rows. Those corrections, and the results they superseded, are lost.

Values are inlined rather than imported: a migration must keep doing what it
did on the day it ran. Every step is skipped when the table is absent.

Revision ID: 61e85742f52b
Revises: a42466630e74
Create Date: 2026-11-05 05:35:38.847326

"""

import json
from datetime import datetime, timezone
from typing import Any, Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "61e85742f52b"
down_revision: Union[str, None] = "a42466630e74"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module constants so a test can point the migration at scratch copies.
TABLE = "minutes_election_results"
OLD_UNIQUE = "uq_minutes_election_results_pair"
NEW_UNIQUE = "uq_minutes_election_results_current"
SUPERSEDED_BY_FK = "fk_minutes_election_results_superseded_by_users"
ELECTIONS = "elections"
USERS = "users"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _unique_names(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    names = {u["name"] for u in inspector.get_unique_constraints(table)}
    names |= {i["name"] for i in inspector.get_indexes(table) if i.get("unique")}
    return names


def _foreign_key_names(table: str) -> set:
    return {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys(table)}


def _utc_naive(value: Any) -> Optional[datetime]:
    """A rollback record's ISO timestamp, or a DATETIME read back, as naive UTC."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _history(value: Any) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def _supersede_stale_results(bind) -> None:
    rows = bind.execute(
        sa.text(
            f"SELECT r.id, r.created_at, e.rollback_history FROM {TABLE} r "
            f"JOIN {ELECTIONS} e ON e.id = r.election_id "
            "WHERE r.current_election_id IS NOT NULL "
            "AND e.rollback_history IS NOT NULL"
        )
    ).fetchall()
    users = set()
    for row_id, created_at, history in rows:
        filed = _utc_naive(created_at)
        if filed is None:
            continue
        later = []
        for entry in _history(history):
            if not isinstance(entry, dict) or entry.get("from_status") != "closed":
                continue
            when = _utc_naive(entry.get("timestamp"))
            if when is not None and when > filed:
                later.append((when, entry))
        if not later:
            continue
        when, entry = min(later, key=lambda pair: pair[0])
        reason = entry.get("reason")
        performer = entry.get("performed_by")
        if isinstance(performer, str) and performer not in users:
            exists = bind.execute(
                sa.text(f"SELECT 1 FROM {USERS} WHERE id = :id"), {"id": performer}
            ).first()
            if exists:
                users.add(performer)
        bind.execute(
            sa.text(
                f"UPDATE {TABLE} SET superseded_at = :at, superseded_reason = "
                ":reason, superseded_by = :by, current_election_id = NULL "
                "WHERE id = :id"
            ),
            {
                "at": when.replace(microsecond=0),
                "reason": reason if isinstance(reason, str) else None,
                "by": performer if performer in users else None,
                "id": row_id,
            },
        )


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    bind = op.get_bind()
    columns = _columns(TABLE)
    if "superseded_at" not in columns:
        op.add_column(
            TABLE, sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True)
        )
    if "superseded_reason" not in columns:
        op.add_column(TABLE, sa.Column("superseded_reason", sa.Text(), nullable=True))
    if "superseded_by" not in columns:
        op.add_column(TABLE, sa.Column("superseded_by", sa.String(36), nullable=True))
    if SUPERSEDED_BY_FK not in _foreign_key_names(TABLE):
        op.create_foreign_key(
            SUPERSEDED_BY_FK,
            TABLE,
            USERS,
            ["superseded_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if "current_election_id" not in columns:
        op.add_column(
            TABLE, sa.Column("current_election_id", sa.String(36), nullable=True)
        )
    # Unconditional rather than only when the column is new: startup's
    # repair_schema.py adds a column the models declare, and could add this one
    # (empty) before the migration runs. Both statements touch only rows that
    # nothing has superseded, so a second run changes nothing.
    bind.execute(
        sa.text(
            f"UPDATE {TABLE} SET current_election_id = election_id "
            "WHERE current_election_id IS NULL AND superseded_at IS NULL"
        )
    )
    if _has_table(ELECTIONS):
        _supersede_stale_results(bind)

    uniques = _unique_names(TABLE)
    if NEW_UNIQUE not in uniques:
        op.create_unique_constraint(
            NEW_UNIQUE, TABLE, ["minutes_id", "current_election_id"]
        )
    if OLD_UNIQUE in uniques:
        op.drop_constraint(OLD_UNIQUE, TABLE, type_="unique")


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    bind = op.get_bind()
    columns = _columns(TABLE)
    if "current_election_id" in columns:
        # One row per (minutes, election) survives: the standing one, else the
        # latest superseded one.
        rows = bind.execute(
            sa.text(
                f"SELECT id, minutes_id, election_id, current_election_id, "
                f"superseded_at FROM {TABLE} WHERE election_id IS NOT NULL"
            )
        ).fetchall()
        keep: dict = {}
        for row_id, minutes_id, election_id, current, superseded_at in rows:
            rank = (current is not None, _utc_naive(superseded_at) or datetime.min)
            key = (minutes_id, election_id)
            if key not in keep or rank > keep[key][0]:
                keep[key] = (rank, row_id)
        kept = {row_id for _, row_id in keep.values()}
        for row_id, *_ in rows:
            if row_id not in kept:
                bind.execute(
                    sa.text(f"DELETE FROM {TABLE} WHERE id = :id"), {"id": row_id}
                )

    uniques = _unique_names(TABLE)
    if OLD_UNIQUE not in uniques:
        op.create_unique_constraint(OLD_UNIQUE, TABLE, ["minutes_id", "election_id"])
    if NEW_UNIQUE in uniques:
        op.drop_constraint(NEW_UNIQUE, TABLE, type_="unique")
    if SUPERSEDED_BY_FK in _foreign_key_names(TABLE):
        op.drop_constraint(SUPERSEDED_BY_FK, TABLE, type_="foreignkey")
    for column in (
        "current_election_id",
        "superseded_by",
        "superseded_reason",
        "superseded_at",
    ):
        if column in _columns(TABLE):
            op.drop_column(TABLE, column)
