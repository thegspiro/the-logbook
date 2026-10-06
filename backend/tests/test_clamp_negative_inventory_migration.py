"""Migration 7d2e4f6a8b13: clamp negative inventory item values to zero (W43-1).

Run against a real (SQLite) connection: a negative value in any bounded column
500'd the item list, so each is set to 0 and its id logged; valid rows, NULLs
and a missing column are left alone.
"""

import importlib.util
import logging
from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_7d2e4f6a8b13_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("clamp_inventory", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            _migration().upgrade()


def _engine(with_weight=True):
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    columns = [
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("quantity", sa.Integer),
        sa.Column("purchase_price", sa.Numeric(10, 2)),
        sa.Column("current_value", sa.Numeric(10, 2)),
        sa.Column("replacement_cost", sa.Numeric(10, 2)),
        sa.Column("expected_lifetime_years", sa.Integer),
        sa.Column("reorder_point", sa.Integer),
        sa.Column("inspection_interval_days", sa.Integer),
    ]
    if with_weight:
        columns.append(sa.Column("weight", sa.Float))
    sa.Table("inventory_items", metadata, *columns)
    metadata.create_all(database)
    return database


def _rows(engine):
    with engine.connect() as connection:
        return {
            row.id: row
            for row in connection.execute(sa.text("SELECT * FROM inventory_items"))
        }


def test_negative_values_are_clamped_and_logged(caplog):
    engine = _engine()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO inventory_items (id, quantity, purchase_price, weight,"
                " reorder_point) VALUES"
                " ('bad', -3, -12.50, -1.5, -2),"
                " ('good', 4, 19.99, 2.0, NULL),"
                " ('blank', NULL, NULL, NULL, NULL)"
            )
        )

    with caplog.at_level(logging.WARNING, logger="alembic.runtime.migration"):
        _run(engine)

    rows = _rows(engine)
    assert rows["bad"].quantity == 0
    assert Decimal(str(rows["bad"].purchase_price)) == 0
    assert rows["bad"].weight == 0
    assert rows["bad"].reorder_point == 0
    assert rows["good"].quantity == 4
    assert Decimal(str(rows["good"].purchase_price)) == Decimal("19.99")
    assert rows["blank"].quantity is None
    assert "bad" in caplog.text
    assert "good" not in caplog.text


def test_a_second_run_changes_nothing():
    engine = _engine()
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO inventory_items (id, quantity) VALUES ('bad', -1)")
        )
    _run(engine)
    _run(engine)
    assert _rows(engine)["bad"].quantity == 0


def test_tolerates_a_missing_column_and_a_missing_table():
    engine = _engine(with_weight=False)
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO inventory_items (id, quantity) VALUES ('bad', -1)")
        )
    _run(engine)
    assert _rows(engine)["bad"].quantity == 0

    _run(sa.create_engine("sqlite://"))
