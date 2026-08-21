"""Allow generated documents to omit uploaded-file metadata.

Revision ``20260213_0800`` now creates/updates ``documents.file_name`` and
``documents.file_path`` as nullable for fresh migration chains.  Databases
that had already applied that revision will never execute the amended upgrade,
however, so repeat the schema correction at the current head.

The table guard preserves the application's stamped-create_all bootstrap path,
where Alembic runs before the ORM materializes tables.

Revision ID: 9f6d1c2a4b70
Revises: 7ed8593bc904
Create Date: 2026-08-20 22:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "9f6d1c2a4b70"
down_revision = "7ed8593bc904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "documents" not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns("documents")}
    for name in ("file_name", "file_path"):
        column = columns.get(name)
        if column is not None and not column["nullable"]:
            op.alter_column(
                "documents",
                name,
                existing_type=column["type"],
                nullable=True,
            )


def downgrade() -> None:
    # Generated documents can legitimately contain NULL in these columns, so
    # restoring NOT NULL would make downgrade fail or destroy valid data.
    pass
