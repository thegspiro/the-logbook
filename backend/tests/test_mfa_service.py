"""Unit tests for the TOTP MFA service (pure functions, no DB)."""

import time

import pyotp

from app.services import mfa_service


def test_totp_roundtrip():
    secret = mfa_service.generate_secret()
    valid_code = pyotp.TOTP(secret).now()
    assert mfa_service.verify_totp(secret, valid_code) is True
    assert mfa_service.verify_totp(secret, "000000") is False
    assert mfa_service.verify_totp(secret, "") is False
    assert mfa_service.verify_totp("", valid_code) is False
    assert mfa_service.verify_totp(secret, "abcdef") is False


def test_provisioning_uri():
    secret = mfa_service.generate_secret()
    uri = mfa_service.provisioning_uri(secret, "user@example.com", "The Logbook")
    assert uri.startswith("otpauth://totp/")
    assert "issuer=The%20Logbook" in uri
    assert secret in uri


def test_recovery_codes_are_unique_and_formatted():
    codes = mfa_service.generate_recovery_codes()
    assert len(codes) == mfa_service.RECOVERY_CODE_COUNT
    assert len(set(codes)) == len(codes)
    for code in codes:
        assert "-" in code


def test_normalize_recovery_code():
    assert mfa_service.normalize_recovery_code(" AB12C-DE34F ") == "ab12c-de34f"
    assert mfa_service.normalize_recovery_code("a b c") == "abc"


def test_verify_totp_get_timestep_returns_current_step():
    secret = mfa_service.generate_secret()
    code = pyotp.TOTP(secret).now()
    expected_step = int(time.time()) // 30
    assert (
        mfa_service.verify_totp_get_timestep(secret, code, last_timestep=None)
        == expected_step
    )


def test_verify_totp_get_timestep_rejects_replay():
    """A code whose step was already consumed must be rejected (replay guard)."""
    secret = mfa_service.generate_secret()
    code = pyotp.TOTP(secret).now()
    step = mfa_service.verify_totp_get_timestep(secret, code, last_timestep=None)
    assert step is not None
    # Same code, now that its step is recorded as last-used -> replay -> None.
    assert mfa_service.verify_totp_get_timestep(secret, code, last_timestep=step) is None
    # An older last_timestep does not block the current, un-consumed step.
    assert (
        mfa_service.verify_totp_get_timestep(secret, code, last_timestep=step - 1)
        == step
    )


def test_verify_totp_get_timestep_rejects_invalid_input():
    secret = mfa_service.generate_secret()
    assert mfa_service.verify_totp_get_timestep(secret, "000000") is None
    assert mfa_service.verify_totp_get_timestep(secret, "abcdef") is None
    assert mfa_service.verify_totp_get_timestep(secret, "") is None
    assert mfa_service.verify_totp_get_timestep("", pyotp.TOTP(secret).now()) is None


def test_hash_recovery_code_is_stable_and_normalized():
    h1 = mfa_service.hash_recovery_code("AB12C-DE34F")
    h2 = mfa_service.hash_recovery_code(" ab12c-de34f ")
    assert h1 == h2  # case/whitespace-insensitive
    assert len(h1) == 64  # SHA-256 hex
    assert h1 != "ab12c-de34f"  # not reversible plaintext


def test_find_matching_recovery_code_hashed_store():
    codes = mfa_service.generate_recovery_codes(3)
    stored = [mfa_service.hash_recovery_code(c) for c in codes]
    # Correct code (any case/spacing) matches its stored hash.
    assert mfa_service.find_matching_recovery_code(codes[0].upper(), stored) == stored[0]
    # Wrong code matches nothing.
    assert mfa_service.find_matching_recovery_code("zzzzz-zzzzz", stored) is None


def test_find_matching_recovery_code_legacy_plaintext():
    """Recovery codes stored as plaintext (pre-hashing) must still verify."""
    codes = mfa_service.generate_recovery_codes(2)
    legacy = [mfa_service.normalize_recovery_code(c) for c in codes]
    assert mfa_service.find_matching_recovery_code(codes[0], legacy) == legacy[0]
    assert mfa_service.find_matching_recovery_code("nope-nope", legacy) is None
