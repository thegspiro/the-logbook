"""
ELEC-41: the public ballot rate-limit wrappers (`_ballot_read_rate_limit`,
`_ballot_vote_rate_limit`) were declared as plain `def` and returned
`check_rate_limit(...)` without `await`. `check_rate_limit` is itself
`async def`, so calling it without `await` only constructs a coroutine and
never runs the limiter's body — no exception is ever raised, no matter how
many requests arrive.

FastAPI decides whether to `await` a dependency by inspecting the dependency
**callable's own** coroutine-function-ness (`inspect.iscoroutinefunction`),
not by inspecting what it returns when called. A sync `def` that returns an
unawaited coroutine is therefore not a type error FastAPI ever notices: it
runs the sync wrapper (in a threadpool), gets back a coroutine object as the
"result", discards it, and moves on — leaving only a "coroutine was never
awaited" `RuntimeWarning` as any sign anything went wrong.

This left every one of this module's 4 public token routes
(`POST /ballot/lookup`, `POST /ballot/vote`, `POST /ballot/vote/bulk`,
`GET /{election_id}/verify-receipt`) with no working rate limit at all,
despite each one declaring `Depends(_ballot_read_rate_limit)` /
`Depends(_ballot_vote_rate_limit)` and the module's own documentation
describing them as rate-limited (10/min reads, 5/min votes).

IMPORTANT: a test that only does `await elec._ballot_read_rate_limit(...)`
directly would pass on the broken code too — manually awaiting the wrapper's
return value drives the coroutine `check_rate_limit(...)` produced regardless
of whether the *wrapper* was ever awaited by anything, which is exactly what
FastAPI does NOT do for a `def` dependency (verified by hand against the
pre-fix code before writing this file). The
`test_*_is_a_coroutine_function` tests below are the actual guard — they
assert the one property FastAPI's own dependency resolution inspects. The
`test_*_actually_invokes_the_limiter` tests are a secondary check that the
right arguments reach `check_rate_limit` once something (FastAPI, or `await`
in a test) does drive the coroutine.
"""

import inspect
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import elections as elec


def test_ballot_read_rate_limit_is_a_coroutine_function():
    """FastAPI only awaits a dependency it recognizes as async itself —
    inspecting the callable, never its return value (see module docstring).
    A plain `def` wrapper around an `async def` call is invisible to that
    check and never gets awaited, silently disabling the limiter.
    """
    assert inspect.iscoroutinefunction(elec._ballot_read_rate_limit), (
        "_ballot_read_rate_limit must be `async def` or FastAPI will never "
        "await its call to check_rate_limit"
    )


def test_ballot_vote_rate_limit_is_a_coroutine_function():
    assert inspect.iscoroutinefunction(elec._ballot_vote_rate_limit), (
        "_ballot_vote_rate_limit must be `async def` or FastAPI will never "
        "await its call to check_rate_limit"
    )


async def test_ballot_read_rate_limit_actually_invokes_the_limiter():
    with patch.object(elec, "check_rate_limit", new=AsyncMock()) as mock_check:
        await elec._ballot_read_rate_limit(MagicMock())
    mock_check.assert_awaited_once()
    _, kwargs = mock_check.await_args
    assert kwargs["max_requests"] == 10
    assert kwargs["window_seconds"] == 60
    assert kwargs["lockout_seconds"] == 300
    assert kwargs["scope"] == "ballot_read"


async def test_ballot_vote_rate_limit_actually_invokes_the_limiter():
    with patch.object(elec, "check_rate_limit", new=AsyncMock()) as mock_check:
        await elec._ballot_vote_rate_limit(MagicMock())
    mock_check.assert_awaited_once()
    _, kwargs = mock_check.await_args
    assert kwargs["max_requests"] == 5
    assert kwargs["window_seconds"] == 60
    assert kwargs["lockout_seconds"] == 600
    assert kwargs["scope"] == "ballot_vote"


async def test_ballot_read_and_vote_limiters_do_not_share_a_bucket():
    """Codex review, PR #2400: both wrappers omitted `scope`, so both fell
    back to `check_rate_limit`'s default `"auth"` bucket. Read traffic
    (lookup, receipt-verify) would then count against the vote limiter's
    stricter 5/minute cap and vice versa — a handful of legitimate reads
    could 429 a voter's actual submission, and with Redis unavailable the
    shared bucket's lockout would block both request kinds together. Each
    wrapper must pass its own stable `scope` so `check_rate_limit` tracks
    them independently (see its docstring in `security_middleware.py`).
    """
    with patch.object(elec, "check_rate_limit", new=AsyncMock()) as mock_check:
        await elec._ballot_read_rate_limit(MagicMock())
        await elec._ballot_vote_rate_limit(MagicMock())
    read_scope = mock_check.await_args_list[0].kwargs["scope"]
    vote_scope = mock_check.await_args_list[1].kwargs["scope"]
    assert read_scope, "the read wrapper must pass an explicit scope"
    assert vote_scope, "the vote wrapper must pass an explicit scope"
    assert (
        read_scope != vote_scope
    ), "ballot reads and vote submissions must not share a rate-limit bucket"


async def test_ballot_read_rate_limit_propagates_limit_exceeded():
    """A real limiter raises HTTPException(429) from inside check_rate_limit.
    Confirms the exception surfaces through the wrapper once it is properly
    awaited (by FastAPI, in production) rather than being raised inside a
    coroutine nobody ever drives.
    """
    with patch.object(
        elec,
        "check_rate_limit",
        new=AsyncMock(side_effect=HTTPException(status_code=429, detail="slow down")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await elec._ballot_read_rate_limit(MagicMock())
    assert exc_info.value.status_code == 429


async def test_ballot_vote_rate_limit_propagates_limit_exceeded():
    with patch.object(
        elec,
        "check_rate_limit",
        new=AsyncMock(side_effect=HTTPException(status_code=429, detail="slow down")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await elec._ballot_vote_rate_limit(MagicMock())
    assert exc_info.value.status_code == 429
