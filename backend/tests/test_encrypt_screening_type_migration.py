"""Migration ac1687769b62, which encrypts a screening record's type and its
requirement link, run against a real database with rows in it (pitfall #35).

CI migrates an empty database, so this is the only place the backfill meets
data. The migration's own ``upgrade``/``downgrade`` run through a real Alembic
context against scratch tables shaped like ``screening_records`` and
``screening_requirements`` (the ENUM, the foreign key with its index), so it
cannot disturb the tables other tests share.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

from app.core.config import settings
from app.core.encrypted_types import EncryptedEnum, EncryptedReference
from app.models.medical_screening import ScreeningType

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_ac1687769b62_*.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"

RECORDS = "zz_enc_scr_type_records"
REQUIREMENTS = "zz_enc_scr_type_reqs"
FK = "zz_fk_enc_scr_type_link"
TYPES = [t.value for t in ScreeningType]
READ_TYPE = EncryptedEnum(ScreeningType)
READ_LINK = EncryptedReference()


def _run(engine, direction: str) -> None:
    spec = importlib.util.spec_from_file_location("encrypt_type", _MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._TABLE = RECORDS
    module._REQUIREMENTS = REQUIREMENTS
    module._FK_NAME = FK
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, direction)()
        conn.commit()


@pytest.fixture
def engine():
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    metadata = sa.MetaData()
    sa.Table(
        REQUIREMENTS,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
    )
    sa.Table(
        RECORDS,
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey(f"{REQUIREMENTS}.id", ondelete="SET NULL", name=FK),
            nullable=True,
        ),
        sa.Column(
            "screening_type",
            sa.Enum(*TYPES, name="screening_type_enum"),
            nullable=False,
        ),
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
            sa.text(f"INSERT INTO {REQUIREMENTS} (id) VALUES ('req-1'), ('req-2')")
        )
        conn.execute(
            sa.text(
                f"INSERT INTO {RECORDS} (id, requirement_id, screening_type) "
                "VALUES (:id, :req, :type)"
            ),
            [{"id": f"r-{value}", "req": "req-1", "type": value} for value in TYPES]
            + [{"id": "r-unlinked", "req": None, "type": "psychological"}],
        )


def _raw(engine) -> dict:
    with engine.connect() as conn:
        return {
            row_id: (link, kind)
            for row_id, link, kind in conn.execute(
                sa.text(f"SELECT id, requirement_id, screening_type FROM {RECORDS}")
            ).all()
        }


def _columns(engine) -> dict:
    return {c["name"]: c for c in sa.inspect(engine).get_columns(RECORDS)}


def _foreign_keys(engine) -> list:
    return sa.inspect(engine).get_foreign_keys(RECORDS)


class TestUpgradeWithRows:
    def test_types_and_links_become_ciphertext_and_read_back(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        raw = _raw(engine)
        for value in TYPES:
            link, kind = raw[f"r-{value}"]
            assert kind.startswith("$gcm2$")
            assert value not in kind
            assert link.startswith("$gcm2$")
            assert "req-1" not in link
            assert READ_TYPE.process_result_value(kind, None) is ScreeningType(value)
            assert READ_LINK.process_result_value(link, None) == "req-1"
        link, kind = raw["r-unlinked"]
        assert link is None
        assert READ_TYPE.process_result_value(kind, None) is (
            ScreeningType.PSYCHOLOGICAL
        )

    def test_the_foreign_key_and_its_index_are_gone(self, engine):
        _seed(engine)

        _run(engine, "upgrade")

        columns = _columns(engine)
        assert isinstance(columns["screening_type"]["type"], sa.Text)
        assert columns["screening_type"]["nullable"] is False
        assert isinstance(columns["requirement_id"]["type"], sa.Text)
        assert _foreign_keys(engine) == []
        assert not [
            i
            for i in sa.inspect(engine).get_indexes(RECORDS)
            if i["column_names"] == ["requirement_id"]
        ]

    def test_running_it_twice_does_not_encrypt_twice(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        first = _raw(engine)

        _run(engine, "upgrade")

        assert _raw(engine) == first

    def test_a_legacy_upper_case_type_reads_back_as_its_value(self, engine):
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    f"ALTER TABLE {RECORDS} MODIFY screening_type VARCHAR(64) NOT NULL"
                )
            )
            conn.execute(
                sa.text(
                    f"INSERT INTO {RECORDS} (id, screening_type) "
                    "VALUES ('r-legacy', 'DRUG_SCREENING')"
                )
            )

        _run(engine, "upgrade")

        _, kind = _raw(engine)["r-legacy"]
        assert READ_TYPE.process_result_value(kind, None) is (
            ScreeningType.DRUG_SCREENING
        )

    def test_an_empty_table_needs_no_key(self, engine, monkeypatch):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        _run(engine, "upgrade")

        assert isinstance(_columns(engine)["screening_type"]["type"], sa.Text)

    def test_rows_without_a_key_are_refused_not_scrambled(self, engine, monkeypatch):
        _seed(engine)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", "")

        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            _run(engine, "upgrade")


class TestDowngradeWithRows:
    def test_round_trip_restores_plaintext_enum_and_foreign_key(self, engine):
        _seed(engine)
        before = _raw(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _raw(engine) == before
        assert isinstance(_columns(engine)["screening_type"]["type"], sa.Enum)
        fks = _foreign_keys(engine)
        assert [fk["constrained_columns"] for fk in fks] == [["requirement_id"]]
        assert fks[0]["options"].get("ondelete") == "SET NULL"

    def test_a_link_to_a_deleted_requirement_is_cleared_first(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        # With no foreign key, a requirement removed outside the application
        # leaves its records pointing at nothing; the restored key refuses that.
        with engine.begin() as conn:
            conn.execute(sa.text(f"DELETE FROM {REQUIREMENTS} WHERE id = 'req-1'"))

        _run(engine, "downgrade")

        assert {link for link, _ in _raw(engine).values()} == {None}
