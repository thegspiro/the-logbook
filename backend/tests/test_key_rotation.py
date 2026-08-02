"""Tests for the encryption key-rotation decrypt ring (no DB required)."""

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.fernet import Fernet

from app.core import security
from app.core.config import settings

_KEY_A = "a" * 64
_KEY_B = "b" * 64


@pytest.fixture
def keyring(monkeypatch):
    """Set keys, resetting cipher caches around every change and at exit."""

    def set_keys(current: str, legacy: str = ""):
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", current)
        monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", legacy)
        security.reset_encryption_ciphers()

    yield set_keys
    security.reset_encryption_ciphers()


class TestKeyRotationRing:
    def test_rotated_key_still_decrypts_old_gcm_values(self, keyring):
        keyring(_KEY_A)
        old_value = security.encrypt_data("chief's TOTP secret")

        keyring(_KEY_B, legacy=_KEY_A)
        assert security.decrypt_data(old_value) == "chief's TOTP secret"

    def test_new_writes_use_the_current_key(self, keyring):
        keyring(_KEY_A)
        old_value = security.encrypt_data("old")

        keyring(_KEY_B, legacy=_KEY_A)
        new_value = security.encrypt_data("new")

        assert security.decrypts_with_current_key(new_value) is True
        assert security.decrypts_with_current_key(old_value) is False
        # Re-encrypting (what the rotation script does) moves it to B.
        rotated = security.encrypt_data(security.decrypt_data(old_value))
        assert security.decrypts_with_current_key(rotated) is True
        assert security.decrypt_data(rotated) == "old"

    def test_without_legacy_key_old_values_fail_closed(self, keyring):
        keyring(_KEY_A)
        old_value = security.encrypt_data("secret")

        keyring(_KEY_B)  # no legacy ring
        with pytest.raises(InvalidTag):
            security.decrypt_data(old_value)

    def test_legacy_fernet_values_decrypt_through_the_ring(self, keyring):
        keyring(_KEY_A)
        fernet_token = (
            Fernet(security.get_encryption_key()).encrypt(b"pre-gcm value").decode()
        )
        assert security.decrypt_data(fernet_token) == "pre-gcm value"

        keyring(_KEY_B, legacy=_KEY_A)
        assert security.decrypt_data(fernet_token) == "pre-gcm value"

    def test_multiple_legacy_keys_are_all_tried(self, keyring):
        keyring(_KEY_A)
        value_a = security.encrypt_data("era A")
        keyring(_KEY_B)
        value_b = security.encrypt_data("era B")

        keyring("c" * 64, legacy=f"{_KEY_A}, {_KEY_B}")
        assert security.decrypt_data(value_a) == "era A"
        assert security.decrypt_data(value_b) == "era B"


class TestKdfWorkFactorMigration:
    """The 100k → 600k PBKDF2 bump ($gcm1$ → $gcm2$).

    The iteration count is part of the ciphertext's identity: it changes the
    derived key, so raising it without keeping the old count would make every
    previously encrypted field permanently unreadable. These tests pin that
    both counts stay reachable.
    """

    def _encrypt_v1(self, plaintext: str) -> str:
        """Produce a value exactly as the pre-bump code would have."""
        import base64
        import secrets

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aesgcm = AESGCM(
            security._derive_key_bytes(iterations=security._KDF_ITERATIONS_V1)
        )
        nonce = secrets.token_bytes(security._GCM_NONCE_BYTES)
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
        return (
            security._GCM_PREFIX_V1
            + base64.urlsafe_b64encode(nonce + ciphertext).decode()
        )

    def test_new_writes_use_the_higher_work_factor(self, keyring):
        keyring(_KEY_A)

        assert security.encrypt_data("phi").startswith(security._GCM_PREFIX_V2)
        assert security._KDF_ITERATIONS_V2 == 600_000

    def test_values_written_at_the_old_work_factor_still_decrypt(self, keyring):
        keyring(_KEY_A)
        legacy_value = self._encrypt_v1("emergency contact")

        assert security.decrypt_data(legacy_value) == "emergency contact"

    def test_old_work_factor_survives_a_key_rotation(self, keyring):
        # A pre-bump value encrypted under a since-rotated key must resolve
        # through both the ring *and* the old iteration count.
        keyring(_KEY_A)
        legacy_value = self._encrypt_v1("medical note")

        keyring(_KEY_B, legacy=_KEY_A)
        assert security.decrypt_data(legacy_value) == "medical note"

    def test_old_work_factor_values_are_flagged_for_rewrite(self, keyring):
        keyring(_KEY_A)
        legacy_value = self._encrypt_v1("dob")

        # Reported as stale so the rotation script rewrites it at V2 — that is
        # the migration path for the iteration bump.
        assert security.decrypts_with_current_key(legacy_value) is False

        rewritten = security.encrypt_data(security.decrypt_data(legacy_value))
        assert rewritten.startswith(security._GCM_PREFIX_V2)
        assert security.decrypts_with_current_key(rewritten) is True

    def test_the_two_work_factors_derive_different_keys(self, keyring):
        keyring(_KEY_A)

        v1 = security._derive_key_bytes(iterations=security._KDF_ITERATIONS_V1)
        v2 = security._derive_key_bytes(iterations=security._KDF_ITERATIONS_V2)

        # If these ever matched, the version marker would be meaningless.
        assert v1 != v2

    def test_legacy_fernet_values_still_decrypt(self, keyring):
        # Fernet ciphertext all predates the bump; its key stays pinned to V1.
        keyring(_KEY_A)
        token = Fernet(security.get_encryption_key()).encrypt(b"pre-migration")

        assert security.decrypt_data(token.decode()) == "pre-migration"
