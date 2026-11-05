"""Migration 80fa2c83bf9d, which encrypts screening statuses, run against a real
database with rows already in it (CLAUDE.md pitfall #35).

CI migrates an empty database, so this is the only place the backfill meets
data. It runs the migration's own ``upgrade``/``downgrade`` through a real
Alembic context against a scratch table shaped like ``screening_records``'s
status column and index, so it cannot disturb the tables other tests share.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.config import settings
from app.core.encrypted_types import EncryptedEnum
from app.models.medical_screening import ScreeningStatus

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_80fa2c83bf9d_*.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"

TABLE = "zz_enc_screening_status"
INDEX = "zz_idx_enc_screening_status"
VALUES = [s.value for s in ScreeningStatus]
READ = EncryptedEnum(ScreeningStatus)


def _run(engine, direction: str) -> None:
    spec = importlib.util.spec_from_file_location("encrypt_status", _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._TABLE = TABLE
    module._INDEX = INDEX
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, direction)()
        conn.commit()


@pytest.fixture
def engine():
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    metadata = sa.MetaData()
    sa.Table(
        TABLE,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*VALUES, name="screening_status_enum"),
            nullable=False,
            server_default="scheduled",
        ),
        sa.Index(INDEX, "organization_id", "status"),
    )
    metadata.drop_all(engine)
    metadata.create_all(engine)
    try:
        yield engine
    finally:
        metadata.drop_all(engine)
        engine.dispose()


def _seed(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                f"INSERT INTO {TABLE} (id, organization_id, status) "
                "VALUES (:id, 'org-a', :status)"
            ),
            [{"id": f"r-{value}", "status": value} for value in VALUES],
        )
        # The column's server default, as an older row written without a
        # status would carry it.
        conn.execute(
            sa.text(
                f"INSERT INTO {TABLE} (id, organization_id) VALUES ('r-default', 'org-a')"
            )
        )


def _raw(engine) -> dict:
    with engine.connect() as conn:
        return dict(conn.execute(sa.text(f"SELECT id, status FROM {TABLE}")).all())


def _column(engine) -> dict:
    return next(
        c for c in sa.inspect(engine).get_columns(TABLE) if c["name"] == "status"
    )


def _indexes(engine) -> set:
    return {i["name"] for i in sa.inspect(engine).get_indexes(TABLE)}


class TestUpgradeWithRows:
    def test_every_status_becomes_ciphertext_and_reads_back_unchanged(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        raw = _raw(engine)
        for value in VALUES:
            stored = raw[f"r-{value}"]
            assert stored.startswith("$gcm2$")
            assert value not in stored
            assert READ.process_result_value(stored, None) is ScreeningStatus(value)
        assert READ.process_result_value(raw["r-default"], None) is (
            ScreeningStatus.SCHEDULED
        )

    def test_the_column_is_text_with_no_plaintext_default_or_index(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        column = _column(engine)
        assert isinstance(column["type"], sa.Text)
        assert column["nullable"] is False
        assert column["default"] in (None, "NULL")
        assert INDEX not in _indexes(engine)

    def test_running_it_twice_does_not_encrypt_twice(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        first = _raw(engine)

        _run(engine, "upgrade")

        assert _raw(engine) == first

    def test_an_empty_table_needs_no_key(self, engine, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        _run(engine, "upgrade")

        assert isinstance(_column(engine)["type"], sa.Text)

    def test_rows_without_a_key_are_refused_not_scrambled(self, engine, monkeypatch):
        _seed(engine)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            _run(engine, "upgrade")


class TestDowngrade:
    def test_restores_the_enum_values_default_and_index(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        raw = _raw(engine)
        assert raw == {**{f"r-{v}": v for v in VALUES}, "r-default": "scheduled"}
        column = _column(engine)
        assert set(column["type"].enums) == set(VALUES)
        assert "scheduled" in str(column["default"])
        assert INDEX in _indexes(engine)
