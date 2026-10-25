"""The migration that encrypts date of birth and emergency contacts, run against
a real database with rows already in it.

CI migrates an empty database, so this is the only place the backfill meets
data. It runs the migration's own ``upgrade``/``downgrade`` through a real
Alembic context against scratch tables that mimic the old column types
(``DATE`` and ``JSON``) rather than against ``users``, so it cannot disturb the
tables other tests share.
"""

import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.config import settings
from app.core.encrypted_types import EncryptedDate, EncryptedJSON
from app.core.security import decrypt_data, encrypt_data

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_encrypt_date_of_birth_and_emergency_.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"

USERS = "zz_enc_users"
PROSPECTS = "zz_enc_prospects"
CONTACTS = [
    {"name": "José Ñandú", "relationship": "spouse", "phone": "555-0100"},
    {"name": "Pat O'Neil", "relationship": "parent", "is_primary": True},
]


def _module():
    spec = importlib.util.spec_from_file_location("encrypt_dob_contacts", _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._COLUMNS = [
        (USERS, "date_of_birth", sa.Date(), sa.Text()),
        (USERS, "emergency_contacts", sa.JSON(), sa.Text()),
        (PROSPECTS, "date_of_birth", sa.Date(), sa.Text()),
    ]
    return module


def _run(engine, direction: str) -> None:
    module = _module()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


@pytest.fixture
def engine():
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    metadata = sa.MetaData()
    sa.Table(
        USERS,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("date_of_birth", sa.Date()),
        sa.Column("emergency_contacts", sa.JSON()),
    )
    sa.Table(
        PROSPECTS,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("date_of_birth", sa.Date()),
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
                f"INSERT INTO {USERS} (id, date_of_birth, emergency_contacts) "
                "VALUES (:id, :dob, :ec)"
            ),
            [
                {"id": "u1", "dob": date(1990, 5, 1), "ec": json.dumps(CONTACTS)},
                {"id": "u2", "dob": None, "ec": None},
                {"id": "u3", "dob": date(1985, 12, 31), "ec": "[]"},
            ],
        )
        conn.execute(
            sa.text(f"INSERT INTO {PROSPECTS} (id, date_of_birth) VALUES (:id, :dob)"),
            [{"id": "p1", "dob": date(2001, 2, 3)}, {"id": "p2", "dob": None}],
        )


def _raw(engine, table: str, column: str, row_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text(f"SELECT {column} FROM {table} WHERE id = :id"), {"id": row_id}
        ).scalar_one()


class TestUpgradeWithRows:
    def test_every_value_becomes_ciphertext_and_reads_back_unchanged(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        for table, column, row_id in [
            (USERS, "date_of_birth", "u1"),
            (USERS, "date_of_birth", "u3"),
            (USERS, "emergency_contacts", "u1"),
            (USERS, "emergency_contacts", "u3"),
            (PROSPECTS, "date_of_birth", "p1"),
        ]:
            raw = _raw(engine, table, column, row_id)
            assert raw.startswith("$gcm2$"), (table, column, row_id)
            assert "1990" not in raw
            assert "Ñandú" not in raw
        assert EncryptedDate().process_result_value(
            _raw(engine, USERS, "date_of_birth", "u1"), None
        ) == date(1990, 5, 1)
        assert (
            EncryptedJSON().process_result_value(
                _raw(engine, USERS, "emergency_contacts", "u1"), None
            )
            == CONTACTS
        )
        assert (
            EncryptedJSON().process_result_value(
                _raw(engine, USERS, "emergency_contacts", "u3"), None
            )
            == []
        )
        assert EncryptedDate().process_result_value(
            _raw(engine, PROSPECTS, "date_of_birth", "p1"), None
        ) == date(2001, 2, 3)

    def test_null_values_stay_null(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw(engine, USERS, "date_of_birth", "u2") is None
        assert _raw(engine, USERS, "emergency_contacts", "u2") is None
        assert _raw(engine, PROSPECTS, "date_of_birth", "p2") is None

    def test_ciphertext_is_accepted_by_the_altered_json_column(self, engine):
        """MariaDB keeps json_valid() on a JSON column unless it is converted."""
        _seed(engine)

        _run(engine, "upgrade")

        with engine.begin() as conn:
            conn.execute(
                sa.text(f"UPDATE {USERS} SET emergency_contacts = :v WHERE id = 'u2'"),
                {"v": encrypt_data(json.dumps(CONTACTS))},
            )

    def test_running_it_twice_does_not_encrypt_twice(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        first = [
            _raw(engine, USERS, "date_of_birth", "u1"),
            _raw(engine, USERS, "emergency_contacts", "u1"),
            _raw(engine, PROSPECTS, "date_of_birth", "p1"),
        ]

        _run(engine, "upgrade")

        assert first == [
            _raw(engine, USERS, "date_of_birth", "u1"),
            _raw(engine, USERS, "emergency_contacts", "u1"),
            _raw(engine, PROSPECTS, "date_of_birth", "p1"),
        ]

    def test_a_row_encrypted_by_the_application_is_left_alone(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        written = EncryptedDate().process_bind_param(date(1970, 7, 7), None)
        with engine.begin() as conn:
            conn.execute(
                sa.text(f"UPDATE {USERS} SET date_of_birth = :v WHERE id = 'u2'"),
                {"v": written},
            )

        _run(engine, "upgrade")

        assert _raw(engine, USERS, "date_of_birth", "u2") == written

    def test_an_empty_database_needs_no_key(self, engine, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        _run(engine, "upgrade")

        assert _raw_type(engine, USERS, "emergency_contacts") != "json"

    def test_rows_without_a_key_stop_the_upgrade_and_change_nothing(
        self, engine, monkeypatch
    ):
        _seed(engine)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            _run(engine, "upgrade")

        assert _raw(engine, PROSPECTS, "date_of_birth", "p1") in (
            "2001-02-03",
            date(2001, 2, 3),
        )


def _raw_type(engine, table: str, column: str) -> str:
    with engine.connect() as conn:
        return conn.execute(
            sa.text(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                "AND COLUMN_NAME = :c"
            ),
            {"t": table, "c": column},
        ).scalar_one()


class TestDowngrade:
    def test_values_round_trip_and_the_original_types_return(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _raw_type(engine, USERS, "date_of_birth") == "date"
        assert _raw_type(engine, PROSPECTS, "date_of_birth") == "date"
        assert _raw(engine, USERS, "date_of_birth", "u1") == date(1990, 5, 1)
        assert _raw(engine, PROSPECTS, "date_of_birth", "p1") == date(2001, 2, 3)
        assert json.loads(_raw(engine, USERS, "emergency_contacts", "u1")) == CONTACTS
        assert _raw(engine, USERS, "date_of_birth", "u2") is None

    def test_decrypting_needs_the_same_key(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        assert decrypt_data(_raw(engine, USERS, "date_of_birth", "u1")) == "1990-05-01"
