"""
Unit tests for authentication and security functions.

Covers:
  - Password hashing and verification (Argon2)
  - Password strength validation
  - Temporary password generation
  - JWT access token creation and decoding
  - JWT refresh token creation and decoding
  - Token expiration validation
  - Invalid / tampered token handling
  - Data encryption and decryption (AES-256)
  - Secure token and verification code generation
  - SHA-256 hashing and hash chain verification
  - Input sanitization and data masking
  - Rehash detection
  - Unicode and special-character handling
"""

import pytest
import time
import jwt as pyjwt
from datetime import timedelta, datetime, timezone
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Password Hashing & Verification
# ---------------------------------------------------------------------------

class TestPasswordHashing:

    @pytest.mark.unit
    def test_hash_password_returns_argon2_hash(self):
        """hash_password should return a string starting with the Argon2 prefix."""
        from app.core.security import hash_password

        hashed = hash_password("V@lid_Passw0rd!X")
        assert isinstance(hashed, str)
        assert hashed.startswith("$argon2")

    @pytest.mark.unit
    def test_hash_password_different_for_same_input(self):
        """Two calls with the same password must produce different hashes (random salt)."""
        from app.core.security import hash_password

        h1 = hash_password("V@lid_Passw0rd!X")
        h2 = hash_password("V@lid_Passw0rd!X")
        assert h1 != h2

    @pytest.mark.unit
    def test_verify_password_correct(self):
        """verify_password returns (True, ...) for a correct password."""
        from app.core.security import hash_password, verify_password

        hashed = hash_password("V@lid_Passw0rd!X")
        matches, new_hash = verify_password("V@lid_Passw0rd!X", hashed)
        assert matches is True

    @pytest.mark.unit
    def test_verify_password_incorrect(self):
        """verify_password returns (False, None) for an incorrect password."""
        from app.core.security import hash_password, verify_password

        hashed = hash_password("V@lid_Passw0rd!X")
        matches, new_hash = verify_password("WrongPassword!9Z", hashed)
        assert matches is False
        assert new_hash is None

    @pytest.mark.unit
    def test_verify_password_invalid_hash(self):
        """verify_password returns (False, None) for a garbage hash string."""
        from app.core.security import verify_password

        matches, new_hash = verify_password("anything", "not-a-valid-hash")
        assert matches is False
        assert new_hash is None

    @pytest.mark.unit
    def test_hash_password_rejects_weak_password(self):
        """hash_password should raise ValueError for a password that fails validation."""
        from app.core.security import hash_password

        with pytest.raises(ValueError):
            hash_password("short")

    @pytest.mark.unit
    def test_hash_password_skip_validation(self):
        """hash_password with skip_validation=True should hash even weak passwords."""
        from app.core.security import hash_password

        hashed = hash_password("weak", skip_validation=True)
        assert hashed.startswith("$argon2")


# ---------------------------------------------------------------------------
# Password Strength Validation
# ---------------------------------------------------------------------------

class TestPasswordStrengthValidation:

    @pytest.mark.unit
    def test_valid_strong_password(self):
        """A password meeting all requirements should pass."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("V@lid_Passw0rd!X")
        assert is_valid is True
        assert err is None

    @pytest.mark.unit
    def test_too_short(self):
        """Password shorter than the minimum length should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("Aa1!Bb2@C")
        assert is_valid is False
        assert "at least" in err.lower() or "characters" in err.lower()

    @pytest.mark.unit
    def test_missing_uppercase(self):
        """Password without an uppercase letter should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("v@lid_passw0rd!x")
        assert is_valid is False
        assert "uppercase" in err.lower()

    @pytest.mark.unit
    def test_missing_lowercase(self):
        """Password without a lowercase letter should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("V@LID_PASSW0RD!X")
        assert is_valid is False
        assert "lowercase" in err.lower()

    @pytest.mark.unit
    def test_missing_digit(self):
        """Password without a digit should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("V@lid_Password!X")
        assert is_valid is False
        assert "number" in err.lower()

    @pytest.mark.unit
    def test_missing_special_character(self):
        """Password without a special character should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("ValidPassw0rdXYZ")
        assert is_valid is False
        assert "special" in err.lower()

    @pytest.mark.unit
    def test_sequential_characters_rejected(self):
        """Password containing sequential characters (e.g. '123', 'abc') should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("My!Passw123ord!X")
        assert is_valid is False
        assert "sequential" in err.lower()

    @pytest.mark.unit
    def test_repeated_characters_rejected(self):
        """Password containing 3+ repeated characters should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("Vaaallid_P0rd!X!")
        assert is_valid is False
        assert "repeated" in err.lower()

    @pytest.mark.unit
    def test_common_password_rejected(self):
        """A well-known common password should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("password")
        assert is_valid is False
        # Might fail for multiple reasons; common-password check should be one

    @pytest.mark.unit
    def test_keyboard_pattern_rejected(self):
        """Password containing a keyboard pattern should fail."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("Myqwerty!99XZW!")
        assert is_valid is False
        assert "keyboard" in err.lower() or "pattern" in err.lower()


# ---------------------------------------------------------------------------
# Temporary Password Generation
# ---------------------------------------------------------------------------

class TestTemporaryPasswordGeneration:

    @pytest.mark.unit
    def test_generated_password_passes_strength_check(self):
        """generate_temporary_password must produce a password that passes validation."""
        from app.core.security import generate_temporary_password, validate_password_strength

        password = generate_temporary_password()
        is_valid, err = validate_password_strength(password)
        assert is_valid is True, f"Generated password failed validation: {err}"

    @pytest.mark.unit
    def test_generated_password_respects_length(self):
        """generate_temporary_password(length=20) must return at least 20 characters."""
        from app.core.security import generate_temporary_password

        password = generate_temporary_password(length=20)
        assert len(password) >= 20

    @pytest.mark.unit
    def test_generated_password_minimum_length_clamp(self):
        """Requesting a length shorter than PASSWORD_MIN_LENGTH is clamped upward."""
        from app.core.security import generate_temporary_password
        from app.core.config import settings

        password = generate_temporary_password(length=4)
        assert len(password) >= settings.PASSWORD_MIN_LENGTH

    @pytest.mark.unit
    def test_generated_passwords_are_unique(self):
        """Successive calls should yield different passwords (randomness)."""
        from app.core.security import generate_temporary_password

        passwords = {generate_temporary_password() for _ in range(10)}
        assert len(passwords) == 10


# ---------------------------------------------------------------------------
# JWT Token Creation & Decoding
# ---------------------------------------------------------------------------

class TestJWTTokens:

    @pytest.mark.unit
    def test_create_access_token_contains_claims(self):
        """create_access_token should encode the provided claims."""
        from app.core.security import create_access_token, decode_token

        token = create_access_token({"sub": "user-123", "org": "org-456"})
        payload = decode_token(token)
        assert payload["sub"] == "user-123"
        assert payload["org"] == "org-456"
        assert payload["type"] == "access"

    @pytest.mark.unit
    def test_access_token_has_expiration(self):
        """Access tokens must include an 'exp' claim."""
        from app.core.security import create_access_token, decode_token

        token = create_access_token({"sub": "user-123"})
        payload = decode_token(token)
        assert "exp" in payload
        assert "iat" in payload

    @pytest.mark.unit
    def test_access_token_custom_expiration(self):
        """Custom expires_delta should be honoured."""
        from app.core.security import create_access_token, decode_token

        delta = timedelta(minutes=5)
        token = create_access_token({"sub": "user-123"}, expires_delta=delta)
        payload = decode_token(token)
        # exp should be roughly 5 minutes from now
        exp_dt = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        iat_dt = datetime.fromtimestamp(payload["iat"], tz=timezone.utc)
        diff = (exp_dt - iat_dt).total_seconds()
        assert 280 < diff < 320  # ~5 minutes with tolerance

    @pytest.mark.unit
    def test_create_refresh_token_contains_claims(self):
        """create_refresh_token should encode claims and mark type='refresh'."""
        from app.core.security import create_refresh_token, decode_token

        token = create_refresh_token({"sub": "user-123"})
        payload = decode_token(token)
        assert payload["sub"] == "user-123"
        assert payload["type"] == "refresh"

    @pytest.mark.unit
    def test_refresh_token_longer_expiry(self):
        """Refresh token should expire further in the future than a default access token."""
        from app.core.security import create_access_token, create_refresh_token, decode_token

        access = decode_token(create_access_token({"sub": "u"}))
        refresh = decode_token(create_refresh_token({"sub": "u"}))
        assert refresh["exp"] > access["exp"]

    @pytest.mark.unit
    def test_decode_token_expired(self):
        """decode_token should raise when the token is expired."""
        from app.core.security import create_access_token, decode_token
        from jwt.exceptions import ExpiredSignatureError

        token = create_access_token(
            {"sub": "user-123"},
            expires_delta=timedelta(seconds=-1),
        )
        with pytest.raises(ExpiredSignatureError):
            decode_token(token)

    @pytest.mark.unit
    def test_decode_token_invalid_signature(self):
        """decode_token should raise when the signature is invalid."""
        from app.core.security import decode_token
        from app.core.config import settings

        bad_token = pyjwt.encode(
            {"sub": "user-123", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            "wrong-secret",
            algorithm=settings.ALGORITHM,
        )
        with pytest.raises(Exception):
            decode_token(bad_token)

    @pytest.mark.unit
    def test_decode_token_tampered_payload(self):
        """Tampering with the token payload should cause decoding to fail."""
        from app.core.security import create_access_token, decode_token

        token = create_access_token({"sub": "user-123"})
        parts = token.split(".")
        # Tamper with the payload section
        parts[1] = parts[1][::-1]
        tampered = ".".join(parts)
        with pytest.raises(Exception):
            decode_token(tampered)

    @pytest.mark.unit
    def test_decode_token_garbage_string(self):
        """decode_token should raise for total garbage input."""
        from app.core.security import decode_token

        with pytest.raises(Exception):
            decode_token("not.a.jwt.at.all")

    @pytest.mark.unit
    def test_create_access_token_does_not_mutate_input(self):
        """The original data dict should not be modified by create_access_token."""
        from app.core.security import create_access_token

        data = {"sub": "user-123"}
        create_access_token(data)
        assert "exp" not in data
        assert "iat" not in data
        assert "type" not in data


# ---------------------------------------------------------------------------
# Data Encryption / Decryption
# ---------------------------------------------------------------------------

class TestEncryption:

    @pytest.mark.unit
    def test_encrypt_decrypt_roundtrip(self):
        """Encrypting then decrypting should return the original string."""
        from app.core.security import encrypt_data, decrypt_data

        plaintext = "Sensitive patient data 12345"
        encrypted = encrypt_data(plaintext)
        assert encrypted != plaintext
        decrypted = decrypt_data(encrypted)
        assert decrypted == plaintext

    @pytest.mark.unit
    def test_encrypt_empty_string(self):
        """Encrypting an empty string should return empty string."""
        from app.core.security import encrypt_data

        assert encrypt_data("") == ""

    @pytest.mark.unit
    def test_decrypt_empty_string(self):
        """Decrypting an empty string should return empty string."""
        from app.core.security import decrypt_data

        assert decrypt_data("") == ""

    @pytest.mark.unit
    def test_different_encryptions_for_same_plaintext(self):
        """Fernet uses random IV, so encrypting the same text twice gives different ciphertexts."""
        from app.core.security import encrypt_data

        c1 = encrypt_data("hello")
        c2 = encrypt_data("hello")
        assert c1 != c2


# ---------------------------------------------------------------------------
# Secure Token & Verification Code Generation
# ---------------------------------------------------------------------------

class TestTokenGeneration:

    @pytest.mark.unit
    def test_generate_secure_token_length(self):
        """generate_secure_token should return a non-empty URL-safe string."""
        from app.core.security import generate_secure_token

        token = generate_secure_token(32)
        assert isinstance(token, str)
        assert len(token) > 0

    @pytest.mark.unit
    def test_generate_secure_token_uniqueness(self):
        """Two generated tokens should be different."""
        from app.core.security import generate_secure_token

        t1 = generate_secure_token()
        t2 = generate_secure_token()
        assert t1 != t2

    @pytest.mark.unit
    def test_generate_verification_code_digits_only(self):
        """Verification code should contain only digits of the requested length."""
        from app.core.security import generate_verification_code

        code = generate_verification_code(6)
        assert len(code) == 6
        assert code.isdigit()

    @pytest.mark.unit
    def test_generate_verification_code_custom_length(self):
        from app.core.security import generate_verification_code

        code = generate_verification_code(8)
        assert len(code) == 8
        assert code.isdigit()


# ---------------------------------------------------------------------------
# SHA-256 Hashing & Hash Chain Verification
# ---------------------------------------------------------------------------

class TestHashUtilities:

    @pytest.mark.unit
    def test_hash_data_sha256_deterministic(self):
        """SHA-256 hashing should be deterministic."""
        from app.core.security import hash_data_sha256

        h1 = hash_data_sha256("hello world")
        h2 = hash_data_sha256("hello world")
        assert h1 == h2
        assert len(h1) == 64  # hex digest

    @pytest.mark.unit
    def test_hash_data_sha256_different_inputs(self):
        """Different inputs should produce different hashes."""
        from app.core.security import hash_data_sha256

        assert hash_data_sha256("a") != hash_data_sha256("b")

    @pytest.mark.unit
    def test_verify_hash_chain_valid(self):
        """verify_hash_chain should return True for a valid chain."""
        import hashlib
        from app.core.security import verify_hash_chain

        prev_hash = "abc123"
        data = "some log entry"
        expected = hashlib.sha256(f"{prev_hash}{data}".encode()).hexdigest()
        assert verify_hash_chain(prev_hash, data, expected) is True

    @pytest.mark.unit
    def test_verify_hash_chain_invalid(self):
        """verify_hash_chain should return False for a tampered chain."""
        from app.core.security import verify_hash_chain

        assert verify_hash_chain("abc", "data", "wrong_hash") is False


# ---------------------------------------------------------------------------
# Input Sanitization & Data Masking
# ---------------------------------------------------------------------------

class TestSanitizationAndMasking:

    @pytest.mark.unit
    def test_sanitize_input_strips_null_bytes(self):
        """sanitize_input should remove null bytes."""
        from app.core.security import sanitize_input

        assert "\x00" not in sanitize_input("hello\x00world")

    @pytest.mark.unit
    def test_sanitize_input_enforces_max_length(self):
        """sanitize_input should truncate to max_length."""
        from app.core.security import sanitize_input

        result = sanitize_input("a" * 2000, max_length=100)
        assert len(result) <= 100

    @pytest.mark.unit
    def test_sanitize_input_preserves_common_whitespace(self):
        """Newlines and tabs should survive sanitization."""
        from app.core.security import sanitize_input

        result = sanitize_input("line1\nline2\ttab")
        assert "\n" in result
        assert "\t" in result

    @pytest.mark.unit
    def test_sanitize_input_empty(self):
        """sanitize_input on empty string should return empty string."""
        from app.core.security import sanitize_input

        assert sanitize_input("") == ""

    @pytest.mark.unit
    def test_mask_sensitive_data(self):
        """mask_sensitive_data should hide all but the last N characters."""
        from app.core.security import mask_sensitive_data

        masked = mask_sensitive_data("1234567890", visible_chars=4)
        assert masked == "******7890"

    @pytest.mark.unit
    def test_mask_sensitive_data_short_input(self):
        """When input is shorter than visible_chars, return '***'."""
        from app.core.security import mask_sensitive_data

        assert mask_sensitive_data("ab", visible_chars=4) == "***"

    @pytest.mark.unit
    def test_mask_sensitive_data_empty(self):
        """Empty input should return '***'."""
        from app.core.security import mask_sensitive_data

        assert mask_sensitive_data("") == "***"

    @pytest.mark.unit
    def test_mask_sensitive_data_custom_visible_chars(self):
        """Custom visible_chars parameter should be respected."""
        from app.core.security import mask_sensitive_data

        result = mask_sensitive_data("1234567890", visible_chars=2)
        assert result.endswith("90")
        assert result.count("*") == 8


# ---------------------------------------------------------------------------
# Additional Edge Cases
# ---------------------------------------------------------------------------

class TestPasswordEdgeCases:
    """Edge-case coverage for password-related functions."""

    @pytest.mark.unit
    def test_hash_and_verify_unicode_password(self):
        """Passwords with Unicode characters should hash and verify correctly."""
        from app.core.security import hash_password, verify_password

        password = "M\u00fcnchenP@ss9!xZ"  # Munchen with umlaut
        hashed = hash_password(password, skip_validation=True)
        matches, _ = verify_password(password, hashed)
        assert matches is True

    @pytest.mark.unit
    def test_verify_password_empty_password(self):
        """verify_password with an empty password should return False."""
        from app.core.security import hash_password, verify_password

        hashed = hash_password("V@lid_Passw0rd!X")
        matches, _ = verify_password("", hashed)
        assert matches is False

    @pytest.mark.unit
    def test_validate_password_strength_firefighter_common(self):
        """Fire-department-specific common passwords should be rejected."""
        from app.core.security import validate_password_strength

        is_valid, err = validate_password_strength("firefighter")
        assert is_valid is False


class TestJWTEdgeCases:
    """Edge-case coverage for JWT token functions."""

    @pytest.mark.unit
    def test_create_access_token_preserves_custom_claims(self):
        """Custom claims beyond 'sub' should survive encode/decode."""
        from app.core.security import create_access_token, decode_token

        data = {"sub": "user-1", "role": "admin", "org_id": "org-99"}
        token = create_access_token(data)
        payload = decode_token(token)
        assert payload["role"] == "admin"
        assert payload["org_id"] == "org-99"

    @pytest.mark.unit
    def test_access_token_default_expiry_within_expected_range(self):
        """Default access token expiry should match ACCESS_TOKEN_EXPIRE_MINUTES."""
        from app.core.security import create_access_token, decode_token
        from app.core.config import settings

        token = create_access_token({"sub": "user-1"})
        payload = decode_token(token)
        exp_dt = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        iat_dt = datetime.fromtimestamp(payload["iat"], tz=timezone.utc)
        diff_minutes = (exp_dt - iat_dt).total_seconds() / 60
        # Should be close to the configured value
        assert abs(diff_minutes - settings.ACCESS_TOKEN_EXPIRE_MINUTES) < 1

    @pytest.mark.unit
    def test_refresh_token_expiry_matches_config(self):
        """Refresh token expiry should match REFRESH_TOKEN_EXPIRE_DAYS."""
        from app.core.security import create_refresh_token, decode_token
        from app.core.config import settings

        token = create_refresh_token({"sub": "user-1"})
        payload = decode_token(token)
        exp_dt = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        iat_dt = datetime.fromtimestamp(payload["iat"], tz=timezone.utc)
        diff_days = (exp_dt - iat_dt).total_seconds() / 86400
        assert abs(diff_days - settings.REFRESH_TOKEN_EXPIRE_DAYS) < 0.1

    @pytest.mark.unit
    def test_decode_token_empty_string(self):
        """decode_token with an empty string should raise."""
        from app.core.security import decode_token

        with pytest.raises(Exception):
            decode_token("")


class TestEncryptionEdgeCases:
    """Edge-case coverage for encryption functions."""

    @pytest.mark.unit
    def test_encrypt_decrypt_unicode(self):
        """Unicode data should round-trip through encryption."""
        from app.core.security import encrypt_data, decrypt_data

        text = "Patientendaten: \u00e4\u00f6\u00fc\u00df \u2603"
        assert decrypt_data(encrypt_data(text)) == text

    @pytest.mark.unit
    def test_encrypt_decrypt_long_string(self):
        """Large payloads should encrypt and decrypt correctly."""
        from app.core.security import encrypt_data, decrypt_data

        text = "A" * 100_000
        assert decrypt_data(encrypt_data(text)) == text

    @pytest.mark.unit
    def test_decrypt_invalid_ciphertext_raises(self):
        """Decrypting garbage data should raise an exception."""
        from app.core.security import decrypt_data
        from cryptography.fernet import InvalidToken

        with pytest.raises(Exception):
            decrypt_data("this-is-not-valid-ciphertext")


class TestSanitizeInputEdgeCases:
    """Additional edge cases for sanitize_input."""

    @pytest.mark.unit
    def test_sanitize_input_removes_control_characters(self):
        """Control characters (except common whitespace) should be stripped."""
        from app.core.security import sanitize_input

        result = sanitize_input("hello\x01\x02\x03world")
        assert "\x01" not in result
        assert "\x02" not in result
        assert "helloworld" == result

    @pytest.mark.unit
    def test_sanitize_input_strips_leading_trailing_whitespace(self):
        """Leading and trailing whitespace should be stripped."""
        from app.core.security import sanitize_input

        result = sanitize_input("  hello world  ")
        assert result == "hello world"
