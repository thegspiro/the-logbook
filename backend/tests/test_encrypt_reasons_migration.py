"""The migration that encrypts leave and training-waiver reasons, run against a
real database with rows already in it.

CI migrates an empty database, so this is the only place the backfill meets
data. It runs the migration's own ``upgrade``/``downgrade`` through a real
Alembic context against scratch tables, so it cannot disturb the tables other
tests share.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.config import settings
from app.core.encrypted_types import EncryptedText
from app.core.security import encrypt_data

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_encrypt_leave_and_training_waiver_.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"

LEAVES = "zz_enc_leaves"
WAIVERS = "zz_enc_waivers"
REASON = "Chemo, three rounds — back in the spring"


def _run(engine, direction: str) -> None:
    spec = importlib.util.spec_from_file_location("encrypt_reasons", _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._COLUMNS = [(LEAVES, "reason"), (WAIVERS, "reason")]
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, direction)()
        conn.commit()


@pytest.fixture
def engine():
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    metadata = sa.MetaData()
    for name in (LEAVES, WAIVERS):
        sa.Table(
            name,
            metadata,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("reason", sa.Text()),
        )
    metadata.drop_all(engine)
    metadata.create_all(engine)
    try:
        yield engine
    finally:
        metadata.drop_all(engine)
        engine.dispose()


def _seed(engine) -> None:
    rows = [
        {"id": "r1", "reason": REASON},
        {"id": "r2", "reason": None},
        {"id": "r3", "reason": ""},
        {"id": "r4", "reason": "   "},
        {"id": "r5", "reason": "Deployed — Ñ, ü, 日本"},
    ]
    with engine.begin() as conn:
        for table in (LEAVES, WAIVERS):
            conn.execute(
                sa.text(f"INSERT INTO {table} (id, reason) VALUES (:id, :reason)"),
                rows,
            )


def _raw(engine, table: str, row_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text(f"SELECT reason FROM {table} WHERE id = :id"), {"id": row_id}
        ).scalar_one()


class TestUpgradeWithRows:
    @pytest.mark.parametrize("table", [LEAVES, WAIVERS])
    def test_text_becomes_ciphertext_and_reads_back_unchanged(self, engine, table):
        _seed(engine)

        _run(engine, "upgrade")

        for row_id, original in (("r1", REASON), ("r5", "Deployed — Ñ, ü, 日本")):
            raw = _raw(engine, table, row_id)
            assert raw.startswith("$gcm2$")
            assert "Chemo" not in raw
            assert EncryptedText().process_result_value(raw, None) == original

    @pytest.mark.parametrize("table", [LEAVES, WAIVERS])
    def test_null_empty_and_blank_values_are_left_exactly_as_they_were(
        self, engine, table
    ):
        """The attendance and tier queries read NULL as 'no waiver', so a blank
        must not turn into ciphertext and a NULL must stay NULL."""
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw(engine, table, "r2") is None
        assert _raw(engine, table, "r3") == ""
        assert _raw(engine, table, "r4") == "   "

    def test_running_it_twice_does_not_encrypt_twice(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        first = [_raw(engine, t, "r1") for t in (LEAVES, WAIVERS)]

        _run(engine, "upgrade")

        assert first == [_raw(engine, t, "r1") for t in (LEAVES, WAIVERS)]

    def test_a_reason_the_application_already_encrypted_is_left_alone(self, engine):
        _seed(engine)
        written = encrypt_data("Written by the application")
        with engine.begin() as conn:
            conn.execute(
                sa.text(f"UPDATE {LEAVES} SET reason = :v WHERE id = 'r2'"),
                {"v": written},
            )

        _run(engine, "upgrade")

        assert _raw(engine, LEAVES, "r2") == written

    def test_an_empty_database_needs_no_key(self, engine, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        _run(engine, "upgrade")

    def test_rows_without_a_key_stop_the_upgrade_and_change_nothing(
        self, engine, monkeypatch
    ):
        _seed(engine)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            _run(engine, "upgrade")

        assert _raw(engine, LEAVES, "r1") == REASON
        assert _raw(engine, WAIVERS, "r1") == REASON

    def test_a_table_the_database_does_not_have_is_skipped(self, engine):
        with engine.begin() as conn:
            conn.execute(sa.text(f"DROP TABLE {WAIVERS}"))
        _seed_one = [{"id": "r1", "reason": REASON}]
        with engine.begin() as conn:
            conn.execute(
                sa.text(f"INSERT INTO {LEAVES} (id, reason) VALUES (:id, :reason)"),
                _seed_one,
            )

        _run(engine, "upgrade")

        assert _raw(engine, LEAVES, "r1").startswith("$gcm2$")
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    f"CREATE TABLE {WAIVERS} (id VARCHAR(36) PRIMARY KEY, reason TEXT)"
                )
            )


class TestDowngrade:
    @pytest.mark.parametrize("table", [LEAVES, WAIVERS])
    def test_values_round_trip_back_to_plaintext(self, engine, table):
        _seed(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _raw(engine, table, "r1") == REASON
        assert _raw(engine, table, "r5") == "Deployed — Ñ, ü, 日本"
        assert _raw(engine, table, "r2") is None
        assert _raw(engine, table, "r3") == ""

    def test_downgrading_plaintext_leaves_it_alone(self, engine):
        _seed(engine)

        _run(engine, "downgrade")

        assert _raw(engine, LEAVES, "r1") == REASON
