"""
Tests for the database retry utility (app.utils.db_retry).

These are pure unit tests — they do not need a real database connection.
"""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.exc import OperationalError

from app.utils.db_retry import (
    is_transient_db_error,
    retry_on_db_error,
    with_db_retry,
)


# ---------------------------------------------------------------------------
# is_transient_db_error
# ---------------------------------------------------------------------------


class _FakePyMySQLError:
    """Mimics a pymysql OperationalError with a numeric code."""

    def __init__(self, code: int, msg: str = ""):
        self.args = (code, msg)


def _make_operational_error(code: int, msg: str = "error") -> OperationalError:
    orig = _FakePyMySQLError(code, msg)
    exc = OperationalError("stmt", {}, orig)
    return exc


class TestIsTransientDbError:
    def test_connection_refused(self):
        exc = _make_operational_error(2003, "Can't connect to MySQL server on 'mysql'")
        assert is_transient_db_error(exc) is True

    def test_server_gone_away(self):
        exc = _make_operational_error(2006, "MySQL server has gone away")
        assert is_transient_db_error(exc) is True

    def test_lost_connection(self):
        exc = _make_operational_error(2013, "Lost connection to MySQL server during query")
        assert is_transient_db_error(exc) is True

    def test_non_transient_operational_error(self):
        exc = _make_operational_error(1045, "Access denied for user")
        assert is_transient_db_error(exc) is False

    def test_connection_error(self):
        assert is_transient_db_error(ConnectionError("refused")) is True

    def test_timeout_error(self):
        assert is_transient_db_error(TimeoutError("timed out")) is True

    def test_os_error(self):
        assert is_transient_db_error(OSError("network unreachable")) is True

    def test_generic_value_error(self):
        assert is_transient_db_error(ValueError("bad value")) is False

    def test_generic_runtime_error(self):
        assert is_transient_db_error(RuntimeError("something")) is False


# ---------------------------------------------------------------------------
# with_db_retry
# ---------------------------------------------------------------------------


class TestWithDbRetry:
    async def test_success_on_first_attempt(self):
        fn = AsyncMock(return_value="ok")
        result = await with_db_retry(fn, max_retries=2, base_delay=0.01)
        assert result == "ok"
        assert fn.call_count == 1

    async def test_retries_on_transient_error(self):
        exc = _make_operational_error(2003, "Can't connect")
        fn = AsyncMock(side_effect=[exc, "recovered"])

        with patch("app.utils.db_retry.asyncio.sleep", new_callable=AsyncMock):
            result = await with_db_retry(fn, max_retries=2, base_delay=0.01)

        assert result == "recovered"
        assert fn.call_count == 2

    async def test_raises_after_all_retries_exhausted(self):
        exc = _make_operational_error(2003, "Can't connect")
        fn = AsyncMock(side_effect=exc)

        with pytest.raises(OperationalError):
            with patch("app.utils.db_retry.asyncio.sleep", new_callable=AsyncMock):
                await with_db_retry(fn, max_retries=2, base_delay=0.01)

        # 1 initial + 2 retries = 3 total attempts
        assert fn.call_count == 3

    async def test_non_transient_error_raises_immediately(self):
        fn = AsyncMock(side_effect=ValueError("bad input"))

        with pytest.raises(ValueError, match="bad input"):
            await with_db_retry(fn, max_retries=2, base_delay=0.01)

        assert fn.call_count == 1

    async def test_passes_args_and_kwargs(self):
        fn = AsyncMock(return_value="ok")
        await with_db_retry(fn, "a", "b", max_retries=0, base_delay=0.01, key="val")
        fn.assert_called_once_with("a", "b", key="val")


# ---------------------------------------------------------------------------
# retry_on_db_error decorator
# ---------------------------------------------------------------------------


class TestRetryOnDbErrorDecorator:
    async def test_decorator_retries_transient_errors(self):
        call_count = 0
        exc = _make_operational_error(2006, "MySQL server has gone away")

        @retry_on_db_error(max_retries=1, base_delay=0.01)
        async def flaky_operation():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise exc
            return "success"

        with patch("app.utils.db_retry.asyncio.sleep", new_callable=AsyncMock):
            result = await flaky_operation()

        assert result == "success"
        assert call_count == 2

    async def test_decorator_preserves_function_name(self):
        @retry_on_db_error()
        async def my_special_function():
            pass

        assert my_special_function.__name__ == "my_special_function"
