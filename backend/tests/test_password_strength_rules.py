"""
Tests for the password-strength rules not already covered by
test_auth_security.py: the sequential-character and repeated-character
checks in app/core/security.validate_password_strength.

Each input is otherwise strong (upper, lower, digit, special, length) so it
fails on exactly the rule under test. Pure logic; no DB.
"""

from app.core.security import validate_password_strength


class TestSequentialCharacters:
    def test_numeric_sequence_rejected(self):
        # Otherwise strong, but contains "123".
        ok, err = validate_password_strength("Rp!Zq123WmKt8")
        assert ok is False
        assert "sequential" in err.lower()

    def test_alpha_sequence_rejected(self):
        # Otherwise strong, but contains "abc".
        ok, err = validate_password_strength("Rp!Z9abcWmKt8")
        assert ok is False
        assert "sequential" in err.lower()


class TestRepeatedCharacters:
    def test_three_repeats_rejected(self):
        # Otherwise strong, but contains "aaa".
        ok, err = validate_password_strength("Rp!Z9aaaWmKt8")
        assert ok is False
        assert "repeated" in err.lower()

    def test_two_repeats_allowed(self):
        # A double letter is fine; only 3+ in a row is rejected.
        ok, _ = validate_password_strength("Rp!Z9aaWmKt8q")
        assert ok is True


class TestCommonPassword:
    def test_common_password_rejected(self):
        # Common passwords are rejected (also weak on other axes, but the
        # point is they never validate).
        ok, _ = validate_password_strength("firefighter")
        assert ok is False


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
