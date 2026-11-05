"""``EncryptedEnum``: an enum column stored as AES-256-GCM ciphertext.

Built for ``screening_records.status`` (MS-15): a dump of the table must not say
which member *failed* a fitness-for-duty screening. The Python value stays the
enum, so the code that compares statuses is unchanged; the database can no
longer compare the column at all, because the same status encrypts differently
on every write.
"""

import pytest
from sqlalchemy import Column, MetaData, String, Table, select

from app.core.encrypted_types import EncryptedEnum, EncryptedText
from app.models.medical_screening import ScreeningRecord, ScreeningStatus

pytestmark = pytest.mark.unit

TYPE = EncryptedEnum(ScreeningStatus)


class TestRoundTrip:
    @pytest.mark.parametrize("status", list(ScreeningStatus))
    def test_every_member_reads_back_as_itself(self, status):
        stored = TYPE.process_bind_param(status, None)

        assert stored.startswith("$gcm2$")
        assert status.value not in stored
        assert TYPE.process_result_value(stored, None) is status

    def test_takes_the_value_string_too(self):
        stored = TYPE.process_bind_param("failed", None)

        assert TYPE.process_result_value(stored, None) is ScreeningStatus.FAILED

    def test_the_same_status_encrypts_differently_each_time(self):
        """Why a SQL comparison can never match, and why the type refuses one."""
        first = TYPE.process_bind_param(ScreeningStatus.FAILED, None)
        second = TYPE.process_bind_param(ScreeningStatus.FAILED, None)

        assert first != second

    def test_none_stays_none(self):
        assert TYPE.process_bind_param(None, None) is None
        assert TYPE.process_result_value(None, None) is None


class TestRefusesWhatIsNotAMember:
    @pytest.mark.parametrize("value", ["approved", "", "PASSED ", 7])
    def test_an_unknown_value_is_refused_before_it_is_written(self, value):
        with pytest.raises(ValueError, match="not a ScreeningStatus value"):
            TYPE.process_bind_param(value, None)


class TestLegacyPlaintext:
    """Rows written before the migration read back until it has run."""

    def test_a_plaintext_value(self):
        assert TYPE.process_result_value("waived", None) is ScreeningStatus.WAIVED

    def test_a_plaintext_member_name(self):
        assert (
            TYPE.process_result_value("PENDING_REVIEW", None)
            is ScreeningStatus.PENDING_REVIEW
        )


class TestTheDatabaseCannotCompareIt:
    """A comparison against ciphertext matches nothing and raises nothing, so
    a forgotten ``.where(status == ...)`` would silently empty a list. The
    type refuses to build one instead."""

    @pytest.mark.parametrize(
        "build",
        [
            lambda c: c == ScreeningStatus.FAILED,
            lambda c: c != ScreeningStatus.FAILED,
            lambda c: c.in_([ScreeningStatus.PASSED]),
            lambda c: c.not_in([ScreeningStatus.PASSED]),
            lambda c: c.like("%fail%"),
        ],
    )
    def test_on_the_model_column(self, build):
        with pytest.raises(TypeError, match="encrypted"):
            build(ScreeningRecord.status)

    def test_on_a_core_column(self):
        column = Table("t", MetaData(), Column("s", TYPE), Column("id", String))
        with pytest.raises(TypeError, match="encrypted"):
            select(column).where(column.c.s == "failed")

    def test_null_checks_still_work(self):
        ScreeningRecord.status.is_(None)
        ScreeningRecord.status.is_not(None)


def test_the_status_column_uses_it():
    column_type = ScreeningRecord.__table__.c.status.type

    assert isinstance(column_type, EncryptedEnum)
    # So the key-rotation scripts' registry test counts it as encrypted.
    assert isinstance(column_type, EncryptedText)


def test_the_status_column_has_no_plaintext_index():
    indexed = {
        column.name
        for index in ScreeningRecord.__table__.indexes
        for column in index.columns
    }

    assert "status" not in indexed
