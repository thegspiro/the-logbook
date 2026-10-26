"""The migration that encrypts personal phone numbers and addresses, run against
a real database with rows already in it.

CI migrates an empty database, so this is the only place the backfill meets
data. It runs the migration's own ``upgrade``/``downgrade`` through a real
Alembic context against scratch tables shaped like the old columns
(``VARCHAR`` and ``TEXT``) rather than against ``users``, so it cannot disturb
the tables other tests share.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

import app.models  # noqa: F401 - importing registers every model on the metadata
from app.core.config import settings
from app.core.database import Base
from app.core.encrypted_types import EncryptedText
from app.core.security import decrypt_data

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_encrypt_contact_phone_numbers_and_.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"

PEOPLE = "zz_enc_contact_people"
ORDERS = "zz_enc_contact_orders"
ABSENT = "zz_enc_contact_absent"

MEMBER = {
    "phone": "555-0100",
    "mobile": "+1 555 0199",
    "address_street": "12 Rue de l'Église, Apt 3",
    "address_city": "Saint-Jérôme",
    "address_state": "QC",
    "address_zip": " 22046 ",
}


def _module():
    spec = importlib.util.spec_from_file_location("encrypt_contacts", _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._COLUMNS = {
        PEOPLE: module._PERSON,
        ORDERS: [
            ("customer_phone", sa.String(50)),
            ("shipping_address", sa.Text()),
        ],
        ABSENT: [("phone", sa.String(20))],
    }
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
        PEOPLE,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("phone", sa.String(20)),
        sa.Column("mobile", sa.String(20)),
        sa.Column("address_street", sa.String(255)),
        sa.Column("address_city", sa.String(100)),
        sa.Column("address_state", sa.String(50)),
        sa.Column("address_zip", sa.String(20)),
    )
    sa.Table(
        ORDERS,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("customer_phone", sa.String(50)),
        sa.Column("shipping_address", sa.Text()),
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
                f"INSERT INTO {PEOPLE} (id, phone, mobile, address_street, "
                "address_city, address_state, address_zip) VALUES "
                "(:id, :phone, :mobile, :address_street, :address_city, "
                ":address_state, :address_zip)"
            ),
            [
                {"id": "m1", **MEMBER},
                {
                    "id": "m2",
                    "phone": None,
                    "mobile": "",
                    "address_street": None,
                    "address_city": None,
                    "address_state": None,
                    "address_zip": None,
                },
            ],
        )
        conn.execute(
            sa.text(
                f"INSERT INTO {ORDERS} (id, customer_phone, shipping_address) "
                "VALUES (:id, :phone, :address)"
            ),
            [{"id": "o1", "phone": "555-0142", "address": "1 Main St\nFalls Church"}],
        )


def _raw(engine, table: str, column: str, row_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text(f"SELECT {column} FROM {table} WHERE id = :id"), {"id": row_id}
        ).scalar_one()


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


def _read(engine, table: str, column: str, row_id: str):
    return EncryptedText().process_result_value(
        _raw(engine, table, column, row_id), None
    )


class TestUpgradeWithRows:
    def test_every_value_becomes_ciphertext_and_reads_back_unchanged(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        for column, value in MEMBER.items():
            raw = _raw(engine, PEOPLE, column, "m1")
            assert raw.startswith("$gcm2$"), column
            assert decrypt_data(raw) == value, column
            assert _read(engine, PEOPLE, column, "m1") == value, column
        for column, value in [
            ("customer_phone", "555-0142"),
            ("shipping_address", "1 Main St\nFalls Church"),
        ]:
            assert _raw(engine, ORDERS, column, "o1").startswith("$gcm2$"), column
            assert _read(engine, ORDERS, column, "o1") == value, column

    def test_short_varchar_columns_become_text(self, engine):
        """Ciphertext of even a short phone number overflows VARCHAR(20)."""
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw_type(engine, PEOPLE, "phone") == "text"
        assert _raw_type(engine, PEOPLE, "address_street") == "text"
        assert _raw_type(engine, ORDERS, "customer_phone") == "text"
        assert len(_raw(engine, PEOPLE, "phone", "m1")) > 20

    def test_null_and_empty_values_are_left_as_they_were(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw(engine, PEOPLE, "phone", "m2") is None
        assert _raw(engine, PEOPLE, "mobile", "m2") == ""
        assert _raw(engine, PEOPLE, "address_street", "m2") is None

    def test_running_it_twice_does_not_encrypt_twice(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        first = [_raw(engine, PEOPLE, column, "m1") for column in MEMBER]

        _run(engine, "upgrade")

        assert first == [_raw(engine, PEOPLE, column, "m1") for column in MEMBER]

    def test_a_value_encrypted_by_the_application_is_left_alone(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        written = EncryptedText().process_bind_param("555-0177", None)
        with engine.begin() as conn:
            conn.execute(
                sa.text(f"UPDATE {PEOPLE} SET phone = :v WHERE id = 'm2'"),
                {"v": written},
            )

        _run(engine, "upgrade")

        assert _raw(engine, PEOPLE, "phone", "m2") == written

    def test_a_table_only_create_all_builds_is_skipped(self, engine):
        """``prospects``, ``event_requests`` and two others are absent in CI."""
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw(engine, PEOPLE, "phone", "m1").startswith("$gcm2$")

    def test_an_empty_database_needs_no_key(self, engine, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        _run(engine, "upgrade")

        assert _raw_type(engine, PEOPLE, "phone") == "text"

    def test_rows_without_a_key_stop_the_upgrade_and_change_nothing(
        self, engine, monkeypatch
    ):
        _seed(engine)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            _run(engine, "upgrade")

        assert _raw(engine, PEOPLE, "phone", "m1") == "555-0100"
        assert _raw(engine, ORDERS, "customer_phone", "o1") == "555-0142"


class TestDowngrade:
    def test_values_round_trip_and_the_original_types_return(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _raw_type(engine, PEOPLE, "phone") == "varchar"
        assert _raw_type(engine, ORDERS, "customer_phone") == "varchar"
        assert _raw_type(engine, ORDERS, "shipping_address") == "text"
        for column, value in MEMBER.items():
            assert _raw(engine, PEOPLE, column, "m1") == value, column
        assert _raw(engine, ORDERS, "shipping_address", "o1") == (
            "1 Main St\nFalls Church"
        )
        assert _raw(engine, PEOPLE, "phone", "m2") is None

    def test_decrypting_needs_the_same_key(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        assert decrypt_data(_raw(engine, PEOPLE, "phone", "m1")) == "555-0100"


def test_the_migration_and_the_models_agree():
    """A column the migration encrypted must stay encrypted in the models.

    Reverted to ``String``, new writes would land as plain text beside the
    ciphertext the migration left, and nothing would read as wrong.
    """
    spec = importlib.util.spec_from_file_location("encrypt_contacts_real", _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    migrated = {
        (table, column)
        for table, columns in module._COLUMNS.items()
        for column, _before in columns
    }
    encrypted = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, EncryptedText)
    }

    assert migrated <= encrypted, sorted(migrated - encrypted)
