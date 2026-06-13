"""
Tests for error-message sanitization (app/core/utils.py).

safe_error_detail / sanitize_error_message keep internal implementation
detail (SQL, file paths, tracebacks, driver names, memory addresses) from
leaking to API clients while passing through safe validation messages.
Pure logic; no DB.
"""

from app.core.utils import _GENERIC_ERROR, safe_error_detail, sanitize_error_message


class TestSafeErrorDetail:
    def test_safe_value_error_passes_through(self):
        assert safe_error_detail(ValueError("Email already in use")) == (
            "Email already in use"
        )

    def test_permission_error_passes_through(self):
        assert safe_error_detail(PermissionError("Not allowed to edit")) == (
            "Not allowed to edit"
        )

    def test_non_validation_exception_is_generic(self):
        assert safe_error_detail(RuntimeError("kaboom")) == _GENERIC_ERROR
        assert safe_error_detail(KeyError("secret_field")) == _GENERIC_ERROR

    def test_sql_in_message_is_suppressed(self):
        assert (
            safe_error_detail(ValueError("SELECT id FROM users WHERE x=1"))
            == _GENERIC_ERROR
        )

    def test_file_path_is_suppressed(self):
        assert (
            safe_error_detail(ValueError("error at /app/services/foo.py near here"))
            == _GENERIC_ERROR
        )

    def test_traceback_is_suppressed(self):
        msg = 'Traceback (most recent call last): File "x.py", line 3'
        assert safe_error_detail(ValueError(msg)) == _GENERIC_ERROR

    def test_driver_name_is_suppressed(self):
        assert (
            safe_error_detail(ValueError("aiomysql.OperationalError: gone"))
            == _GENERIC_ERROR
        )

    def test_sqlalchemy_is_suppressed(self):
        assert (
            safe_error_detail(ValueError("sqlalchemy.exc.IntegrityError"))
            == _GENERIC_ERROR
        )

    def test_memory_address_is_suppressed(self):
        assert (
            safe_error_detail(ValueError("object at 0x7f3a1b2c3d4e")) == _GENERIC_ERROR
        )

    def test_overlong_message_is_suppressed(self):
        assert safe_error_detail(ValueError("x" * 301)) == _GENERIC_ERROR

    def test_custom_fallback_used(self):
        assert safe_error_detail(RuntimeError("x"), fallback="Nope") == "Nope"


class TestSanitizeErrorMessage:
    def test_empty_returns_fallback(self):
        assert sanitize_error_message("") == _GENERIC_ERROR

    def test_safe_message_passes_through(self):
        assert sanitize_error_message("Could not find that record") == (
            "Could not find that record"
        )

    def test_unsafe_message_suppressed(self):
        assert sanitize_error_message("sqlalchemy.exc.DataError: bad") == _GENERIC_ERROR

    def test_overlong_message_suppressed(self):
        assert sanitize_error_message("y" * 400) == _GENERIC_ERROR


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
