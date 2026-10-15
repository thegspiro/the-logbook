"""Columns added by the startup schema repair must carry the model's default.

``_add_missing_model_columns`` used to add every missing column as a bare
``NULL``. For a column the model declares ``NOT NULL DEFAULT false`` that left
each pre-existing row ``NULL``, and the later Alembic migration skips a column
that already exists, so nothing ever corrected it. On a department's upgraded
install, ``inventory_categories.allow_self_checkout`` was ``NULL`` on two rows;
the response schema requires a boolean, so listing medical-supply categories
returned a 500 (``LB-SYS-001``) while creating one still worked.
"""

import pytest
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import mysql

from main import _add_missing_model_columns, _missing_column_ddl

_DIALECT = mysql.dialect()
_SCRATCH = "zz_repair_schema_scratch"


def _ddl(**kwargs):
    column_type = kwargs.pop("type_", sa.Boolean())
    return _missing_column_ddl(
        "things", sa.Column("flag", column_type, **kwargs), _DIALECT
    )


@pytest.mark.unit
class TestMissingColumnDdl:
    def test_not_null_with_default_is_added_not_null_with_that_default(self):
        ddl = _ddl(nullable=False, server_default="0")
        assert ddl == "ALTER TABLE `things` ADD COLUMN `flag` BOOL DEFAULT '0' NOT NULL"

    def test_boolean_false_default_is_carried(self):
        ddl = _ddl(nullable=False, server_default=sa.false())
        assert "DEFAULT false NOT NULL" in ddl

    def test_not_null_without_default_stays_nullable(self):
        # NOT NULL here would make MySQL fill existing rows with 0 or '',
        # which for a foreign key points at a row that does not exist.
        ddl = _ddl(nullable=False)
        assert ddl.endswith("BOOL NULL")
        assert "DEFAULT" not in ddl

    def test_nullable_without_default_is_unchanged(self):
        ddl = _ddl(nullable=True)
        assert ddl == "ALTER TABLE `things` ADD COLUMN `flag` BOOL NULL"

    def test_nullable_with_default_keeps_the_default(self):
        ddl = _ddl(nullable=True, server_default="1")
        assert ddl.endswith("DEFAULT '1' NULL")

    def test_now_default_on_a_datetime(self):
        ddl = _ddl(type_=sa.DateTime(), nullable=False, server_default=sa.func.now())
        assert ddl.endswith("DATETIME DEFAULT now() NOT NULL")

    def test_identifiers_are_backtick_escaped(self):
        column = sa.Column("we`ird", sa.Integer(), nullable=True)
        ddl = _missing_column_ddl("ta`ble", column, _DIALECT)
        assert ddl.startswith("ALTER TABLE `ta``ble` ADD COLUMN `we``ird` ")


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_SCRATCH}"))
        conn.execute(text(f"CREATE TABLE {_SCRATCH} (id INT PRIMARY KEY)"))
        conn.execute(text(f"INSERT INTO {_SCRATCH} (id) VALUES (1), (2)"))
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_SCRATCH}"))
    engine.dispose()


@pytest.mark.integration
class TestRepairAgainstARealTable:
    def test_existing_rows_receive_the_model_default(self, scratch_engine):
        from app.core.database import Base

        table = sa.Table(
            _SCRATCH,
            Base.metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column(
                "allow_flag",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("label", sa.String(20), nullable=False, server_default="50%"),
            sa.Column("owner_id", sa.Integer, nullable=False),
        )
        try:
            added = _add_missing_model_columns(scratch_engine)
        finally:
            Base.metadata.remove(table)

        assert {f"{_SCRATCH}.allow_flag", f"{_SCRATCH}.label"} <= set(added)
        with scratch_engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT allow_flag, label, owner_id FROM {_SCRATCH} ORDER BY id")
            ).all()
            columns = {c["name"]: c for c in sa.inspect(conn).get_columns(_SCRATCH)}

        assert [tuple(r) for r in rows] == [(0, "50%", None), (0, "50%", None)]
        assert columns["allow_flag"]["nullable"] is False
        assert columns["label"]["nullable"] is False
        # No default, so it keeps the previous behaviour rather than being
        # filled with a value that means nothing.
        assert columns["owner_id"]["nullable"] is True
