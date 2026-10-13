"""Seal the audit hash chain in a separate step from the audit write

SEC2-28-10. An audit row used to read the chain's last row and compute its
own hashes inside the caller's transaction; two concurrent writers read the
same last row and forked the chain, which ``verify_integrity`` then reported
as tampering. Owner decision (2026-10-12): the row is still inserted in the
caller's transaction, unhashed, and a sealer running in its own short
transaction assigns its chain position and hashes, serialized on a single
chain-head row.

* ``audit_logs.chain_seq`` (BIGINT, nullable, unique): the row's position on
  the chain. NULL means "not sealed yet". Backfilled to ``id`` for every
  existing row, which is exactly the order the old code chained them in.
* ``audit_logs.previous_hash`` / ``current_hash`` become nullable: a row has
  no hashes until it is sealed.
* ``audit_chain_head``: one row (id=1) holding the last sealed position and
  hash; the sealer locks it FOR UPDATE. Seeded from the current tail so the
  first row sealed after the upgrade links to the last row sealed before it.
  Its position also starts no lower than the off-host shipping watermark,
  which now counts chain positions rather than ids; on an installation whose
  rows were all archived, the watermark can be ahead of every remaining row.

``audit_logs`` is created by the initial migration, so it is always present;
each step is still guarded so a re-run is a no-op.

Downgrade refuses while any row is unsealed: the previous schema has no way
to hold a row without hashes, and hashes cannot be computed here (they need
the signing key). Run the ``audit_chain_seal`` task first. It then drops the
head table and ``chain_seq`` and restores NOT NULL. One thing it cannot undo:
rows sealed out of id order (a transaction that committed late) are chained
in ``chain_seq`` order, and the previous code verifies in id order, so after a
downgrade its integrity check may report those few links as broken. The rows
and their hashes are untouched; re-upgrading restores verification.

Revision ID: bcd688674099
Revises: 65128d5ccd50
Create Date: 2026-10-12 14:12:35.844803

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bcd688674099"
down_revision: Union[str, None] = "65128d5ccd50"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AUDIT_LOGS = "audit_logs"
HEAD = "audit_chain_head"
SHIP_STATE = "audit_ship_state"
SEQ_INDEX = "uq_audit_chain_seq"
HASH_COLUMNS = ("previous_hash", "current_hash")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> dict[str, dict]:
    return {c["name"]: c for c in _inspector().get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in _inspector().get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    if "chain_seq" not in _columns(AUDIT_LOGS):
        op.add_column(
            AUDIT_LOGS, sa.Column("chain_seq", sa.BigInteger(), nullable=True)
        )
    bind.execute(
        sa.text(
            "UPDATE audit_logs SET chain_seq = id "
            "WHERE chain_seq IS NULL AND current_hash IS NOT NULL"
        )
    )
    if SEQ_INDEX not in _indexes(AUDIT_LOGS):
        op.create_index(SEQ_INDEX, AUDIT_LOGS, ["chain_seq"], unique=True)

    columns = _columns(AUDIT_LOGS)
    for name in HASH_COLUMNS:
        if not columns[name]["nullable"]:
            op.alter_column(
                AUDIT_LOGS,
                name,
                existing_type=sa.String(64),
                nullable=True,
            )

    if not _has_table(HEAD):
        op.create_table(
            HEAD,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("last_seq", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("last_hash", sa.String(64), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
        )

    if bind.execute(sa.text("SELECT COUNT(*) FROM audit_chain_head")).scalar():
        return
    last_seq = bind.execute(sa.text("SELECT MAX(chain_seq) FROM audit_logs")).scalar()
    last_hash = None
    if last_seq is not None:
        last_hash = bind.execute(
            sa.text("SELECT current_hash FROM audit_logs WHERE chain_seq = :s"),
            {"s": last_seq},
        ).scalar()
    shipped = None
    if _has_table(SHIP_STATE):
        shipped = bind.execute(
            sa.text("SELECT MAX(last_shipped_id) FROM audit_ship_state")
        ).scalar()
    bind.execute(
        sa.text(
            "INSERT INTO audit_chain_head (id, last_seq, last_hash) "
            "VALUES (1, :seq, :hash)"
        ),
        {"seq": max(last_seq or 0, shipped or 0), "hash": last_hash},
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns(AUDIT_LOGS)

    if "chain_seq" in columns:
        unsealed = bind.execute(
            sa.text("SELECT COUNT(*) FROM audit_logs WHERE chain_seq IS NULL")
        ).scalar()
        if unsealed:
            raise RuntimeError(
                f"{unsealed} audit_logs row(s) are not sealed yet and the "
                "previous schema cannot hold a row without hashes. Run the "
                "audit_chain_seal scheduled task (or let the application "
                "seal them) and retry the downgrade."
            )

    op.execute(f"DROP TABLE IF EXISTS {HEAD}")

    for name in HASH_COLUMNS:
        if columns[name]["nullable"]:
            op.alter_column(
                AUDIT_LOGS,
                name,
                existing_type=sa.String(64),
                nullable=False,
            )

    if SEQ_INDEX in _indexes(AUDIT_LOGS):
        op.drop_index(SEQ_INDEX, table_name=AUDIT_LOGS)
    if "chain_seq" in columns:
        op.drop_column(AUDIT_LOGS, "chain_seq")
