"""
Database operation retry helper for transient connection failures.

Provides a decorator and context manager that transparently retry
database operations when the MySQL server is momentarily unreachable
(e.g. container restart, brief network partition).  Only operational
errors (connection refused, timeout) trigger retries — application-level
exceptions propagate immediately.
"""

import asyncio
import functools
from typing import Callable, TypeVar

from loguru import logger
from sqlalchemy.exc import DBAPIError, OperationalError

T = TypeVar("T")

# pymysql error codes that indicate a transient connection issue
_TRANSIENT_PYMYSQL_CODES = {
    2003,  # Can't connect to MySQL server
    2006,  # MySQL server has gone away
    2013,  # Lost connection during query
}


def is_transient_db_error(exc: BaseException) -> bool:
    """Return True if *exc* looks like a temporary database connectivity failure."""
    if isinstance(exc, OperationalError):
        # SQLAlchemy wraps pymysql errors; inspect the inner args
        if exc.orig and hasattr(exc.orig, "args") and exc.orig.args:
            code = exc.orig.args[0]
            if isinstance(code, int) and code in _TRANSIENT_PYMYSQL_CODES:
                return True
        # Fallback: match on the string representation
        msg = str(exc).lower()
        return "can't connect" in msg or "server has gone away" in msg

    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return True

    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return True

    return False


async def with_db_retry(
    coro_fn: Callable[..., T],
    *args,
    max_retries: int = 2,
    base_delay: float = 0.5,
    operation_name: str = "",
    **kwargs,
) -> T:
    """
    Call *coro_fn(*args, **kwargs)* with automatic retry on transient DB errors.

    Parameters
    ----------
    coro_fn:
        An async callable to invoke.
    max_retries:
        Number of retries after the first failure (total attempts = max_retries + 1).
    base_delay:
        Initial delay in seconds; doubled on each retry.
    operation_name:
        Human-readable label for log messages.
    """
    last_exc: BaseException | None = None
    delay = base_delay
    label = operation_name or getattr(coro_fn, "__qualname__", None) or repr(coro_fn)

    for attempt in range(1, max_retries + 2):  # +2 because range is exclusive
        try:
            return await coro_fn(*args, **kwargs)
        except Exception as exc:
            if not is_transient_db_error(exc) or attempt == max_retries + 1:
                raise
            last_exc = exc
            logger.warning(
                f"{label}: transient DB error on attempt {attempt}/{max_retries + 1}, "
                f"retrying in {delay:.1f}s — {exc}"
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, 5.0)  # cap at 5s

    # Should not reach here, but satisfy the type checker
    raise last_exc or RuntimeError("Retry exhausted")  # pragma: no cover


def retry_on_db_error(
    max_retries: int = 2,
    base_delay: float = 0.5,
    operation_name: str = "",
):
    """
    Decorator version of :func:`with_db_retry` for async methods.

    Usage::

        @retry_on_db_error(max_retries=2, operation_name="get_user_from_token")
        async def get_user_from_token(self, token: str):
            ...
    """

    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            return await with_db_retry(
                fn,
                *args,
                max_retries=max_retries,
                base_delay=base_delay,
                operation_name=operation_name or fn.__qualname__,
                **kwargs,
            )

        return wrapper

    return decorator
