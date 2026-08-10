"""
TR-6 (app-review B18 pass 4): _decrypt_field must fail closed.

External-provider API credentials are stored encrypted and decrypted just before
they are sent to the provider. The decrypt helper previously caught `except
Exception` and returned the raw stored value — so a genuine GCM authentication
failure (tampered ciphertext or the wrong key) would be handed to the provider as
a live credential. It now swallows only `InvalidToken` (legacy pre-encryption
plaintext) and lets `InvalidTag` propagate, matching the EncryptedText contract.

DB-free.
"""

from unittest.mock import MagicMock

import pytest
from cryptography.exceptions import InvalidTag

import app.services.external_training_service as ets_module
from app.core.security import encrypt_data
from app.services.external_training_service import ExternalTrainingSyncService


@pytest.fixture
def service():
    return ExternalTrainingSyncService(MagicMock())


class TestDecryptFieldFailClosed:
    def test_valid_ciphertext_round_trips(self, service):
        ct = encrypt_data("super-secret-api-key")
        assert service._decrypt_field(ct) == "super-secret-api-key"

    def test_legacy_plaintext_returned_as_is(self, service):
        # A non-token string makes decrypt_data raise InvalidToken (legacy
        # pre-encryption value) — returned unchanged for backward compatibility.
        assert service._decrypt_field("legacy-plaintext-key") == "legacy-plaintext-key"

    @pytest.mark.parametrize("value", [None, ""])
    def test_empty_is_none(self, service, value):
        assert service._decrypt_field(value) is None

    def test_tampered_ciphertext_fails_closed(self, service, monkeypatch):
        # A GCM auth failure (InvalidTag) must NOT be swallowed — it propagates
        # rather than returning an unverified value as a credential.
        monkeypatch.setattr(
            ets_module, "decrypt_data", MagicMock(side_effect=InvalidTag())
        )
        with pytest.raises(InvalidTag):
            service._decrypt_field("$gcm1$dGFtcGVyZWQ=")
