"""
``b8f2c05d7a91``'s downgrade drops the staffing foreign key by its real name.

``event_requests`` is usually built by ``create_all``, whose naming convention
names the key ``fk_event_requests_staffing_shift_id_shifts``; the migration
names it ``fk_event_requests_staffing_shift`` when it adds the column itself.
The downgrade used to drop the second name unconditionally and failed with
MySQL 1091 on every database built the first way.

SQLite cannot drop a constraint, so this pins the lookup the downgrade relies
on rather than the ``ALTER`` itself, which is exercised against MariaDB when
the migration is changed.
"""

import importlib.util
import pathlib

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.unit

_VERSIONS = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _load():
    matches = list(_VERSIONS.glob("*_b8f2c05d7a91_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location(matches[0].stem, matches[0])
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load()


def _names(fk_name: str) -> list:
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("shifts", metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table("users", metadata, sa.Column("id", sa.String(36), primary_key=True))
    sa.Table(
        "event_requests",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "staffing_shift_id",
            sa.String(36),
            sa.ForeignKey("shifts.id", name=fk_name, ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "assignee_id",
            sa.String(36),
            sa.ForeignKey("users.id", name="fk_event_requests_assignee_id_users"),
        ),
    )
    metadata.create_all(engine)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            return MIGRATION._foreign_keys_on("event_requests", "staffing_shift_id")


@pytest.mark.parametrize(
    "fk_name",
    [
        # create_all, through the models' naming convention
        "fk_event_requests_staffing_shift_id_shifts",
        # this migration's own op.create_foreign_key
        "fk_event_requests_staffing_shift",
    ],
)
def test_the_key_is_found_whichever_way_the_table_was_built(fk_name):
    assert _names(fk_name) == [fk_name]


def test_a_missing_table_yields_nothing_to_drop():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            assert (
                MIGRATION._foreign_keys_on("event_requests", "staffing_shift_id") == []
            )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
