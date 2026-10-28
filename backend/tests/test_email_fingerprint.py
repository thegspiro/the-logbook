"""The keyed email fingerprint that lets an encrypted email column be matched."""

import hashlib

import pytest

from app.core import security
from app.core.config import settings

pytestmark = pytest.mark.unit

_KEY_A = "a" * 64
_KEY_B = "b" * 64


@pytest.fixture
def keyring(monkeypatch):
    def set_keys(current: str, legacy: str = ""):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", current)
        monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", legacy)
        security.reset_encryption_ciphers()

    yield set_keys
    security.reset_encryption_ciphers()


class TestEmailFingerprint:
    def test_case_and_surrounding_space_do_not_change_it(self, keyring):
        keyring(_KEY_A)

        assert security.email_fingerprint("Chief.Smith@Example.org ") == (
            security.email_fingerprint("chief.smith@example.org")
        )

    def test_different_addresses_differ(self, keyring):
        keyring(_KEY_A)

        assert security.email_fingerprint("a@example.org") != (
            security.email_fingerprint("b@example.org")
        )

    def test_it_is_keyed_not_a_plain_hash(self, keyring):
        """A plain hash of a guessable address could be reversed from a dump."""
        keyring(_KEY_A)
        address = "chief@example.org"

        fingerprint = security.email_fingerprint(address)

        assert fingerprint != hashlib.sha256(address.encode()).hexdigest()
        keyring(_KEY_B)
        assert security.email_fingerprint(address) != fingerprint

    def test_it_fits_a_64_character_column(self, keyring):
        keyring(_KEY_A)

        assert len(security.email_fingerprint("x@example.org")) == 64

    @pytest.mark.parametrize("blank", [None, "", "   "])
    def test_no_address_has_no_fingerprint(self, keyring, blank):
        keyring(_KEY_A)

        assert security.email_fingerprint(blank) is None
        assert security.email_fingerprints(blank) == []


class TestLookupAcrossARotation:
    def test_a_row_written_under_the_old_key_is_still_found(self, keyring):
        keyring(_KEY_A)
        stored = security.email_fingerprint("chief@example.org")

        keyring(_KEY_B, legacy=_KEY_A)

        candidates = security.email_fingerprints("chief@example.org")
        assert stored in candidates
        assert candidates[0] == security.email_fingerprint("chief@example.org")
        assert len(candidates) == 2

    def test_without_a_legacy_key_there_is_one_candidate(self, keyring):
        keyring(_KEY_A)

        assert security.email_fingerprints("chief@example.org") == [
            security.email_fingerprint("chief@example.org")
        ]
