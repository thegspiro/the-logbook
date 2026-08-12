"""Convert public_portal timestamp columns from VARCHAR(26) to DATETIME

``20260207_0501_create_public_portal_tables`` created eight timestamp columns
as ``sa.String(length=26)`` — 26 being the width of an ISO-8601 string with
microseconds. The models declare all eight as ``DateTime(timezone=True)``.

A string column compares and sorts lexicographically, which quietly gives wrong
answers rather than errors:

- ``public_portal_api_keys.expires_at`` gates API-key validity, so expiry is
  decided by string ordering.
- ``public_portal_access_log.timestamp`` backs ``idx_access_log_timestamp`` and
  ``idx_access_log_org_timestamp``; every rate-limit and audit range query over
  the access log scans a string index.

Fresh installs built by ``create_all()`` already have real ``DATETIME`` columns,
so this revision detects the current type and skips them.

The values are normalised before the type change. Depending on when a row was
written it may hold either the ISO form this column was sized for
(``2026-01-01T00:00:00.000000``) or MySQL's own rendering of a bound Python
datetime (``2026-01-01 00:00:00.000000``), because the model has said
``DateTime`` while the column stayed ``VARCHAR``. Both are handled, along with
trailing ISO-8601 offsets. Offset-aware values are converted to UTC before
their marker is removed.

Revision ID: 20260805_0004
Revises: 20260805_0003
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0004"
down_revision = "20260805_0003"
branch_labels = None
depends_on = None


# (table, column, nullable) — nullable columns get NULL when unparseable,
# NOT NULL columns fall back to the current time so the ALTER cannot fail.
#: A value MySQL will accept as a DATETIME once normalised. Tested with a
#: pattern rather than ``CAST(... AS DATETIME) IS NULL``, because under strict
#: ``sql_mode`` casting unparseable text raises error 1292 instead of yielding
#: NULL — the check itself would abort the migration. ``0000-`` dates match the
#: shape but are rejected by ``NO_ZERO_DATE``, so they are excluded too.
_VALID = (
    "`{col}` REGEXP "
    "'^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}"
    "( [0-9]{{2}}:[0-9]{{2}}:[0-9]{{2}}([.][0-9]+)?)?$' "
    "AND `{col}` NOT LIKE '0000-%'"
)

_COLUMNS = [
    ("public_portal_access_log", "timestamp", False),
    ("public_portal_api_keys", "created_at", False),
    ("public_portal_api_keys", "expires_at", True),
    ("public_portal_api_keys", "last_used_at", True),
    ("public_portal_config", "created_at", False),
    ("public_portal_config", "updated_at", False),
    ("public_portal_data_whitelist", "created_at", False),
    ("public_portal_data_whitelist", "updated_at", False),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, nullable in _COLUMNS:
        if not inspector.has_table(table):
            continue

        columns = {c["name"]: c for c in inspector.get_columns(table)}
        if column not in columns:
            continue
        # Already DATETIME (create_all-built database) — nothing to convert.
        if not isinstance(columns[column]["type"], sa.String):
            continue

        # 1. Convert offset-aware ISO-8601 values to UTC. Simply removing the
        # offset would change the instant, while leaving it in place would make
        # the validation below discard a valid expiration. CONVERT_TZ accepts
        # fixed offsets without relying on MySQL's named-time-zone tables.
        op.execute(
            sa.text(
                f"UPDATE `{table}` "
                f"SET `{column}` = DATE_FORMAT(CONVERT_TZ("
                f"  REPLACE(LEFT(`{column}`, CHAR_LENGTH(`{column}`) - 6), 'T', ' '), "
                f"  RIGHT(`{column}`, 6), '+00:00'), '%Y-%m-%d %H:%i:%s.%f') "
                f"WHERE `{column}` REGEXP "
                f"'[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$'"
            )
        )

        # Normalise the remaining offset-free text into a form MySQL accepts.
        op.execute(
            sa.text(
                f"UPDATE `{table}` "
                f"SET `{column}` = REPLACE("
                f"  REPLACE(REPLACE(`{column}`, 'T', ' '), 'Z', ''), '+00:00', '') "
                f"WHERE `{column}` IS NOT NULL"
            )
        )

        # 2. Neutralise anything still unparseable, so the ALTER cannot fail
        #    or silently produce a zero date under strict sql_mode.
        valid = _VALID.format(col=column)
        if table == "public_portal_api_keys" and column == "expires_at":
            # Fail closed: malformed legacy expiration data must not turn an
            # expiring API key into a key that is valid indefinitely.
            op.execute(
                sa.text(
                    f"UPDATE `{table}` SET `{column}` = UTC_TIMESTAMP(6) "
                    f"WHERE `{column}` IS NOT NULL AND NOT ({valid})"
                )
            )
        elif nullable:
            op.execute(
                sa.text(
                    f"UPDATE `{table}` SET `{column}` = NULL "
                    f"WHERE `{column}` IS NOT NULL AND NOT ({valid})"
                )
            )
        else:
            op.execute(
                sa.text(
                    f"UPDATE `{table}` SET `{column}` = UTC_TIMESTAMP(6) "
                    f"WHERE `{column}` IS NULL OR NOT ({valid})"
                )
            )

        # 3. Change the type. NOT NULL columns carry the same
        #    server_default=func.now() the models declare.
        op.alter_column(
            table,
            column,
            existing_type=sa.String(26),
            type_=sa.DateTime(),
            existing_nullable=nullable,
            nullable=nullable,
            server_default=None if nullable else sa.text("CURRENT_TIMESTAMP"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, nullable in _COLUMNS:
        if not inspector.has_table(table):
            continue
        columns = {c["name"]: c for c in inspector.get_columns(table)}
        if column not in columns:
            continue
        if isinstance(columns[column]["type"], sa.String):
            continue

        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(),
            type_=sa.String(26),
            existing_nullable=nullable,
            nullable=nullable,
            server_default=None,
        )
