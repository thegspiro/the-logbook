"""
Unit tests for the transparent encrypted SQLAlchemy column types.

These exercise ``EncryptedText`` and ``EncryptedJSON`` directly via their
``process_bind_param`` / ``process_result_value`` hooks (no database needed), so
they run in the no-MySQL sandbox. They pin the three properties the
medical-screening PHI-at-rest change (MS-1) relies on:

1. Round-trip: a value bound (encrypted) then read back (decrypted) is unchanged.
2. Ciphertext at rest: the bound value is not the plaintext.
3. Legacy tolerance: a plaintext value written before the column was encrypted
   still reads back correctly (an ``InvalidToken`` is treated as legacy data),
   including the ``JSON``→``TEXT`` case where the legacy value is a JSON string.
"""

import json
from datetime import date, datetime

import pytest

from app.core.encrypted_types import EncryptedDate, EncryptedJSON, EncryptedText


class TestEncryptedText:

    @pytest.mark.unit
    def test_bind_produces_ciphertext(self):
        col = EncryptedText()
        bound = col.process_bind_param("Dr. Jane Smith", None)
        assert bound is not None
        assert bound != "Dr. Jane Smith"

    @pytest.mark.unit
    def test_roundtrip(self):
        col = EncryptedText()
        bound = col.process_bind_param("Cleared for duty — no restrictions", None)
        assert col.process_result_value(bound, None) == (
            "Cleared for duty — no restrictions"
        )

    @pytest.mark.unit
    @pytest.mark.parametrize("value", [None, ""])
    def test_empty_and_none_pass_through(self, value):
        col = EncryptedText()
        assert col.process_bind_param(value, None) == value
        assert col.process_result_value(value, None) == value

    @pytest.mark.unit
    def test_legacy_plaintext_reads_as_is(self):
        """A pre-encryption plaintext value (not a valid token) is returned
        unchanged rather than raising."""
        col = EncryptedText()
        assert col.process_result_value("legacy plaintext note", None) == (
            "legacy plaintext note"
        )


class TestEncryptedJSON:

    @pytest.mark.unit
    def test_bind_produces_ciphertext(self):
        col = EncryptedJSON()
        payload = {"score": 95, "bp": "120/80"}
        bound = col.process_bind_param(payload, None)
        assert bound is not None
        assert "score" not in bound  # not the plaintext JSON

    @pytest.mark.unit
    def test_roundtrip_dict(self):
        col = EncryptedJSON()
        payload = {"score": 95, "measurements": [1, 2, 3], "notes": "ok"}
        bound = col.process_bind_param(payload, None)
        assert col.process_result_value(bound, None) == payload

    @pytest.mark.unit
    def test_roundtrip_list(self):
        col = EncryptedJSON()
        payload = ["a", "b", "c"]
        bound = col.process_bind_param(payload, None)
        assert col.process_result_value(bound, None) == payload

    @pytest.mark.unit
    @pytest.mark.parametrize("value", [None, ""])
    def test_empty_and_none_pass_through(self, value):
        col = EncryptedJSON()
        assert col.process_result_value(value, None) == value
        # None binds to None (an explicit SQL NULL).
        assert col.process_bind_param(None, None) is None

    @pytest.mark.unit
    def test_legacy_json_text_reads_as_object(self):
        """After a JSON→TEXT column alter, an un-encrypted legacy row is the JSON
        *text*; it must be json.loads'd back into the original object."""
        col = EncryptedJSON()
        legacy = json.dumps({"score": 88, "unit": "mmHg"})
        assert col.process_result_value(legacy, None) == {"score": 88, "unit": "mmHg"}

    @pytest.mark.unit
    def test_legacy_non_json_text_falls_back_to_raw(self):
        """A legacy value that isn't valid JSON is returned as the raw string
        rather than raising during a read."""
        col = EncryptedJSON()
        assert col.process_result_value("not-json", None) == "not-json"


class TestEncryptedDate:

    @pytest.mark.unit
    def test_bind_produces_ciphertext_that_hides_the_date(self):
        bound = EncryptedDate().process_bind_param(date(1990, 5, 1), None)
        assert bound is not None
        assert bound.startswith("$gcm2$")
        assert "1990" not in bound

    @pytest.mark.unit
    def test_roundtrip_returns_a_date(self):
        col = EncryptedDate()
        bound = col.process_bind_param(date(1990, 5, 1), None)
        assert col.process_result_value(bound, None) == date(1990, 5, 1)

    @pytest.mark.unit
    def test_the_same_date_encrypts_differently_each_time(self):
        """Why SQL equality cannot work on the column, and why callers must
        compare the decrypted value."""
        col = EncryptedDate()
        assert col.process_bind_param(date(1990, 5, 1), None) != (
            col.process_bind_param(date(1990, 5, 1), None)
        )

    @pytest.mark.unit
    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("1990-05-01", date(1990, 5, 1)),
            (" 1990-05-01 ", date(1990, 5, 1)),
            (datetime(1990, 5, 1, 13, 30), date(1990, 5, 1)),
        ],
    )
    def test_strings_and_datetimes_are_normalised_to_a_date(self, given, expected):
        col = EncryptedDate()
        assert (
            col.process_result_value(col.process_bind_param(given, None), None)
            == expected
        )

    @pytest.mark.unit
    @pytest.mark.parametrize("value", [None, ""])
    def test_empty_and_none_store_null(self, value):
        col = EncryptedDate()
        assert col.process_bind_param(value, None) is None
        assert col.process_result_value(value, None) is None

    @pytest.mark.unit
    @pytest.mark.parametrize("value", ["not a date", "1990-13-45", 19900501, 3.5])
    def test_a_value_that_is_not_a_date_is_refused_not_stored(self, value):
        with pytest.raises(ValueError, match="EncryptedDate takes"):
            EncryptedDate().process_bind_param(value, None)

    @pytest.mark.unit
    def test_a_legacy_date_column_value_reads_as_a_date(self):
        """A row the DATE column held before the migration's backfill ran."""
        assert EncryptedDate().process_result_value("1990-05-01", None) == date(
            1990, 5, 1
        )

    @pytest.mark.unit
    def test_tampered_ciphertext_fails_closed(self):
        from cryptography.exceptions import InvalidTag

        col = EncryptedDate()
        bound = col.process_bind_param(date(1990, 5, 1), None)
        tampered = bound[:-4] + ("AAAA" if not bound.endswith("AAAA") else "BBBB")
        with pytest.raises((InvalidTag, ValueError)):
            col.process_result_value(tampered, None)
