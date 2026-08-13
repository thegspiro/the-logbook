"""Backfill and default the training-config skills-result visibility columns

``skills_result_disclosure`` and ``skills_result_release`` arrived in
20260807_0009, which adds each column only when it is absent. A deployment
whose ``training_module_configs`` table had already been materialized from the
model got the columns from that route instead — without a DB-level DEFAULT —
so its existing row holds NULL for both.

``TrainingModuleConfigResponse`` declares them as ``Literal`` with no ``None``
member, so a NULL is a ResponseValidationError: a plain
``GET /api/v1/training/module-config/config`` answers **500**, and every write
to that config fails with it.

This is the same repair 20260502_0001 and 20260502_0003 applied to the boolean
flags: backfill the NULLs, then set the column default so a row inserted
outside the ORM cannot reintroduce one. The matching Pydantic coercion stays as
a defensive fallback rather than load-bearing logic.

Revision ID: 20260813_0006
Revises: 20260813_0002
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op

revision = "20260813_0006"
down_revision = "20260813_0002"
branch_labels = None
depends_on = None


# Mirrors app.models.training.TrainingModuleConfig and the Literal members in
# app.schemas.training_module_config. Order: (column_name, default_value).
_COLUMNS = [
    ("skills_result_disclosure", "full"),
    ("skills_result_release", "on_completion"),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("training_module_configs"):
        return

    existing = {col["name"] for col in inspector.get_columns("training_module_configs")}
    for column, default in _COLUMNS:
        if column not in existing:
            continue
        op.execute(
            sa.text(
                f"UPDATE training_module_configs SET {column} = :default "
                f"WHERE {column} IS NULL"
            ).bindparams(default=default)
        )
        op.alter_column(
            "training_module_configs",
            column,
            existing_type=sa.String(20),
            existing_nullable=True,
            server_default=default,
        )


def downgrade() -> None:
    # Deliberately a no-op: the state to restore is "default present".
    #
    # 20260807_0009 already establishes these exact defaults when it adds the
    # columns, so on a database migrated through the chain the pre-upgrade
    # schema has them — clearing the default here would leave a shape this
    # revision never created, and a non-ORM insert that omits the columns would
    # recreate precisely the NULLs (and the response-validation 500s) the
    # upgrade repaired.
    #
    # The deployments this migration exists for — columns materialized from the
    # model before it carried a server_default — are indistinguishable from the
    # inside once the default is set, so there is no per-database original to
    # restore either. The backfill is equally irreversible: which rows held
    # NULL is not recorded, and the values written are the documented defaults
    # rather than data anyone entered.
    pass
