"""Unit tests for the TOTP MFA service (pure functions, no DB)."""

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
