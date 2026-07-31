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
