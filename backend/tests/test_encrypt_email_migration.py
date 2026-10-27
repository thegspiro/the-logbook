"""The migration that encrypts email addresses, run against a real database with
rows already in it.

CI migrates an empty database, so this is the only place the backfill, the
fingerprints and the uniqueness checks meet data. The migration's own
``upgrade``/``downgrade`` run through a real Alembic context against scratch
tables shaped like the old ones, so the tables other tests share are never
touched.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

import app.models  # noqa: F401 - importing registers every model on the metadata
from app.core.config import settings
from app.core.database import Base
from app.core.encrypted_types import EncryptedJSON, EncryptedText
from app.core.security import email_fingerprint

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_encrypt_email_addresses_at_rest.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"

USERS = "zz_eml_users"
PROSPECTS = "zz_eml_prospects"
HISTORY = "zz_eml_history"
ABSENT = "zz_eml_absent"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _module():
    module = _load("encrypt_emails")
    module._SCALAR = {
        USERS: [
            ("email", sa.String(255), False),
            ("personal_email", sa.String(255), True),
        ],
        PROSPECTS: [("email", sa.String(255), False)],
        HISTORY: [("to_email", sa.String(320), False)],
        ABSENT: [("email", sa.String(255), True)],
    }
    module._JSON = {HISTORY: [("cc_emails", True)]}
    module._FINGERPRINTS = {
        USERS: ("email", "email_hash"),
        PROSPECTS: ("email", "email_hash"),
    }
    module._NEW_INDEXES = {
        USERS: [("zz_eml_users_org_hash", ["organization_id", "email_hash"], True)],
        PROSPECTS: [("zz_eml_pros_org_hash", ["organization_id", "email_hash"], False)],
    }
    module._OLD_INDEXES = {
        USERS: [
            ("zz_eml_users_email", ["email"], False),
            ("zz_eml_users_org_email", ["organization_id", "email"], True),
        ],
        PROSPECTS: [("zz_eml_pros_org_email", ["organization_id", "email"], False)],
    }
    module._MESSAGE_HISTORY = HISTORY
    module._PROSPECTS = PROSPECTS
    module._ACTIVE_OLD = ("active_email", "zz_eml_uq_active_email")
    module._ACTIVE_NEW = ("active_email_hash", "zz_eml_uq_active_email_hash")
    module._UNIQUE_CHECKS = [
        (USERS, ["organization_id"], None),
        (PROSPECTS, ["organization_id"], "status = 'active'"),
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
    with engine.begin() as conn:
        for table in (USERS, PROSPECTS, HISTORY):
            conn.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
        conn.execute(
            sa.text(
                f"CREATE TABLE {USERS} (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, "
                "email VARCHAR(255) NOT NULL, personal_email VARCHAR(255) NULL, "
                "INDEX zz_eml_users_email (email), "
                "UNIQUE INDEX zz_eml_users_org_email (organization_id, email))"
            )
        )
        conn.execute(
            sa.text(
                f"CREATE TABLE {PROSPECTS} (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, "
                "email VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL, "
                "active_email VARCHAR(255) GENERATED ALWAYS AS ("
                "  CASE WHEN status = 'active' THEN email ELSE NULL END) STORED, "
                "INDEX zz_eml_pros_org_email (organization_id, email), "
                "UNIQUE INDEX zz_eml_uq_active_email (organization_id, active_email))"
            )
        )
        conn.execute(
            sa.text(
                f"CREATE TABLE {HISTORY} (id VARCHAR(36) PRIMARY KEY, "
                "to_email VARCHAR(320) NOT NULL, cc_emails JSON NULL)"
            )
        )
    try:
        yield engine
    finally:
        with engine.begin() as conn:
            for table in (USERS, PROSPECTS, HISTORY):
                conn.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
        engine.dispose()


def _seed(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                f"INSERT INTO {USERS} (id, organization_id, email, personal_email) "
                "VALUES (:id, :org, :email, :personal)"
            ),
            [
                {
                    "id": "u1",
                    "org": "o1",
                    "email": "Chief.Smith@Example.org",
                    "personal": "smith@home.example",
                },
                {"id": "u2", "org": "o1", "email": "josé@example.org", "personal": ""},
                # Same address, another department: allowed.
                {
                    "id": "u3",
                    "org": "o2",
                    "email": "chief.smith@example.org",
                    "personal": None,
                },
            ],
        )
        conn.execute(
            sa.text(
                f"INSERT INTO {PROSPECTS} (id, organization_id, email, status) "
                "VALUES (:id, :org, :email, :status)"
            ),
            [
                {
                    "id": "p1",
                    "org": "o1",
                    "email": "apply@example.org",
                    "status": "active",
                },
                {
                    "id": "p2",
                    "org": "o1",
                    "email": "old@example.org",
                    "status": "inactive",
                },
            ],
        )
        conn.execute(
            sa.text(
                f"INSERT INTO {HISTORY} (id, to_email, cc_emails) "
                "VALUES (:id, :to, :cc)"
            ),
            [
                {"id": "h1", "to": "one@example.org", "cc": json.dumps(["c@x.org"])},
                {
                    "id": "h2",
                    "to": "a@example.org, b@example.org… (+40 more)",
                    "cc": None,
                },
            ],
        )


def _raw(engine, table: str, column: str, row_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text(f"SELECT {column} FROM {table} WHERE id = :id"), {"id": row_id}
        ).scalar_one()


def _data_type(engine, table: str, column: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                "AND COLUMN_NAME = :c"
            ),
            {"t": table, "c": column},
        ).scalar()


def _index_names(engine, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(engine).get_indexes(table)}


def _insert(engine, sql: str, params: dict) -> None:
    with engine.begin() as conn:
        conn.execute(sa.text(sql), params)


def _text(engine, table, column, row_id):
    return EncryptedText().process_result_value(
        _raw(engine, table, column, row_id), None
    )


class TestUpgradeWithRows:
    def test_addresses_become_ciphertext_and_read_back_unchanged(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        for table, column, row_id, plain in [
            (USERS, "email", "u1", "Chief.Smith@Example.org"),
            (USERS, "personal_email", "u1", "smith@home.example"),
            (USERS, "email", "u2", "josé@example.org"),
            (PROSPECTS, "email", "p1", "apply@example.org"),
            (HISTORY, "to_email", "h1", "one@example.org"),
        ]:
            raw = _raw(engine, table, column, row_id)
            assert raw.startswith("$gcm2$"), (table, column, row_id)
            assert _text(engine, table, column, row_id) == plain
        assert _raw(engine, USERS, "personal_email", "u2") == ""
        assert _raw(engine, USERS, "personal_email", "u3") is None
        assert EncryptedJSON().process_result_value(
            _raw(engine, HISTORY, "cc_emails", "h1"), None
        ) == ["c@x.org"]
        assert _raw(engine, HISTORY, "cc_emails", "h2") is None

    def test_each_row_gets_the_fingerprint_lookups_use(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw(engine, USERS, "email_hash", "u1") == email_fingerprint(
            "chief.smith@example.org"
        )
        assert _raw(engine, PROSPECTS, "email_hash", "p2") == email_fingerprint(
            "old@example.org"
        )

    def test_message_history_fingerprints_each_summarised_address(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        assert json.loads(_raw(engine, HISTORY, "recipient_fingerprints", "h2")) == [
            email_fingerprint("a@example.org"),
            email_fingerprint("b@example.org"),
        ]
        assert json.loads(_raw(engine, HISTORY, "recipient_fingerprints", "h1")) == [
            email_fingerprint("one@example.org")
        ]

    def test_the_address_indexes_move_to_the_fingerprint(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        users = _index_names(engine, USERS)
        assert "zz_eml_users_org_hash" in users
        assert {"zz_eml_users_email", "zz_eml_users_org_email"}.isdisjoint(users)
        prospects = _index_names(engine, PROSPECTS)
        assert {"zz_eml_pros_org_hash", "zz_eml_uq_active_email_hash"} <= prospects
        assert _data_type(engine, PROSPECTS, "active_email") is None
        assert _data_type(engine, USERS, "email") == "text"

    def test_one_member_per_address_per_department_still_holds(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        with pytest.raises(sa.exc.IntegrityError):
            _insert(
                engine,
                f"INSERT INTO {USERS} (id, organization_id, email, email_hash) "
                "VALUES ('u9', 'o1', 'x', :h)",
                {"h": email_fingerprint("CHIEF.SMITH@example.org")},
            )

    def test_one_active_application_per_address_still_holds(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        duplicate = email_fingerprint("apply@example.org")

        insert = (
            f"INSERT INTO {PROSPECTS} (id, organization_id, email, email_hash, "
            "status) VALUES (:id, 'o1', 'x', :h, :status)"
        )
        _insert(engine, insert, {"id": "p8", "h": duplicate, "status": "inactive"})

        with pytest.raises(sa.exc.IntegrityError):
            _insert(engine, insert, {"id": "p9", "h": duplicate, "status": "active"})

    def test_running_it_twice_changes_nothing(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        first = [
            _raw(engine, USERS, "email", "u1"),
            _raw(engine, USERS, "email_hash", "u1"),
            _raw(engine, HISTORY, "recipient_fingerprints", "h2"),
        ]

        _run(engine, "upgrade")

        assert first == [
            _raw(engine, USERS, "email", "u1"),
            _raw(engine, USERS, "email_hash", "u1"),
            _raw(engine, HISTORY, "recipient_fingerprints", "h2"),
        ]

    def test_a_table_only_create_all_builds_is_skipped(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        assert _raw(engine, USERS, "email", "u1").startswith("$gcm2$")


class TestRefusals:
    def test_addresses_that_collide_once_normalized_stop_it_unchanged(self, engine):
        _seed(engine)
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    f"INSERT INTO {USERS} (id, organization_id, email) "
                    "VALUES ('u4', 'o1', ' chief.smith@example.org')"
                )
            )

        with pytest.raises(RuntimeError, match="u1 and u4|u4 and u1"):
            _run(engine, "upgrade")

        assert _raw(engine, USERS, "email", "u1") == "Chief.Smith@Example.org"
        assert _data_type(engine, USERS, "email") == "varchar"
        assert "zz_eml_users_org_email" in _index_names(engine, USERS)

    def test_only_active_applications_are_checked(self, engine):
        _seed(engine)
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    f"INSERT INTO {PROSPECTS} (id, organization_id, email, status) "
                    "VALUES ('p3', 'o1', ' apply@example.org', 'inactive')"
                )
            )

        _run(engine, "upgrade")

        assert _raw(engine, PROSPECTS, "email_hash", "p3") == email_fingerprint(
            "apply@example.org"
        )

    def test_rows_without_a_key_stop_it_before_any_change(self, engine, monkeypatch):
        _seed(engine)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            _run(engine, "upgrade")

        # Every table, not only the last one processed: without the preflight
        # the first table (alphabetically, the history one) is already altered
        # by the time the first row fails to encrypt.
        assert _data_type(engine, HISTORY, "to_email") == "varchar"
        assert _data_type(engine, USERS, "email") == "varchar"
        assert "zz_eml_users_org_email" in _index_names(engine, USERS)

    def test_an_empty_database_needs_no_key(self, engine, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        _run(engine, "upgrade")

        assert _data_type(engine, USERS, "email") == "text"


class TestDowngrade:
    def test_values_types_and_old_indexes_return(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _raw(engine, USERS, "email", "u1") == "Chief.Smith@Example.org"
        assert _raw(engine, USERS, "personal_email", "u1") == "smith@home.example"
        assert _raw(engine, HISTORY, "to_email", "h1") == "one@example.org"
        assert json.loads(_raw(engine, HISTORY, "cc_emails", "h1")) == ["c@x.org"]
        assert _data_type(engine, USERS, "email") == "varchar"
        assert _data_type(engine, USERS, "email_hash") is None
        assert _data_type(engine, HISTORY, "recipient_fingerprints") is None
        assert {"zz_eml_users_email", "zz_eml_users_org_email"} <= _index_names(
            engine, USERS
        )
        assert "zz_eml_uq_active_email" in _index_names(engine, PROSPECTS)
        assert _raw(engine, PROSPECTS, "active_email", "p1") == "apply@example.org"


def test_the_migration_and_the_models_agree():
    """Every column the migration rewrites is encrypted in the models, and every
    fingerprint and index it creates is one the models declare."""
    module = _load("encrypt_emails_real")
    tables = Base.metadata.tables

    for table, columns in module._SCALAR.items():
        for column, _before, _nullable in columns:
            assert isinstance(tables[table].c[column].type, EncryptedText), (
                table,
                column,
            )
    for table, columns in module._JSON.items():
        for column, _nullable in columns:
            assert isinstance(tables[table].c[column].type, EncryptedJSON), (
                table,
                column,
            )
    for table, (_address, fingerprint) in module._FINGERPRINTS.items():
        assert fingerprint in tables[table].c, (table, fingerprint)
    for table, indexes in module._NEW_INDEXES.items():
        declared = {i.name for i in tables[table].indexes}
        assert {name for name, _c, _u in indexes} <= declared, table
    assert module._ACTIVE_NEW[0] in tables[module._PROSPECTS].c
    assert module._ACTIVE_NEW[1] in {i.name for i in tables[module._PROSPECTS].indexes}
