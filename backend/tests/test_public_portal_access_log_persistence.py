"""PUB-8: the public portal access log must survive the request that failed.

``log_access`` only ``flush()``es, and ``get_db`` rolls the session back
whenever a handler raises. Every non-200 answer on ``app/api/public/portal.py``
is an ``HTTPException`` raised from inside the handler's ``try`` — the 503 an
off portal answers, the 404 a missing config answers, the 500 an unexpected
fault answers — so before this fix the row those paths deliberately wrote was
discarded on its way out and ``public_portal_access_log`` recorded successes
only. ``detect_anomalies`` reads that table to spot abuse, so the half of the
picture that matters most never reached it.

The FastAPI semantics this rests on are asserted here rather than assumed:
``test_dependency_teardown_rolls_back_on_httpexception`` drives a real
``TestClient`` request through a ``get_db``-shaped dependency.
"""

from unittest.mock import MagicMock

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.public.portal import log_public_api_request


class _RecordingSession:
    """Session stub recording flush/commit/rollback and answering COUNTs."""

    def __init__(self, commit_error: Exception | None = None):
        self.added = []
        self.flushes = 0
        self.commits = 0
        self.rollbacks = 0
        self._commit_error = commit_error

    async def execute(self, *args, **kwargs):
        result = MagicMock()
        result.scalar.return_value = 0
        result.one.return_value = (0, 0)
        return result

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.commits += 1
        if self._commit_error:
            raise self._commit_error

    async def rollback(self):
        self.rollbacks += 1


def _fake_request():
    request = MagicMock()
    request.client.host = "203.0.113.7"
    request.url.path = "/api/public/v1/organization/info"
    request.method = "GET"
    request.headers = {"user-agent": "curl/8", "referer": ""}
    return request


def _fake_api_key():
    api_key = MagicMock()
    api_key.id = "key-1"
    api_key.organization_id = "org-1"
    api_key.config_id = "cfg-1"
    return api_key


@pytest.mark.unit
@pytest.mark.parametrize(
    "status_code",
    [200, 404, 503, 500],
    ids=["success", "not-found", "portal-disabled", "server-error"],
)
async def test_access_log_is_committed_for_every_status(status_code):
    """The row is committed whatever the outcome, not just on the 200 path."""
    session = _RecordingSession()

    await log_public_api_request(
        request=_fake_request(),
        api_key=_fake_api_key(),
        status_code=status_code,
        start_time=0.0,
        db=session,
    )

    assert len(session.added) == 1
    assert session.commits == 1, (
        "the access-log row was left to the request transaction, which get_db "
        "rolls back on every HTTPException"
    )
    assert session.rollbacks == 0


@pytest.mark.unit
async def test_commit_failure_does_not_replace_the_callers_answer():
    """A failed audit write must not become the response the caller sees."""
    session = _RecordingSession(commit_error=RuntimeError("connection lost"))

    # No exception escapes: the handler is mid-``except`` and about to re-raise
    # the HTTPException the caller is owed.
    await log_public_api_request(
        request=_fake_request(),
        api_key=_fake_api_key(),
        status_code=503,
        start_time=0.0,
        db=session,
    )

    assert session.commits == 1
    assert session.rollbacks == 1


@pytest.mark.unit
def test_dependency_teardown_rolls_back_on_httpexception():
    """Pins the FastAPI behaviour the fix exists for.

    If a future FastAPI stopped throwing into ``get_db``'s generator on an
    ``HTTPException``, the commit above would be redundant rather than
    load-bearing — and this test would say so.
    """
    events: list[str] = []

    async def fake_get_db():
        try:
            yield "session"
            events.append("commit")
        except Exception:
            events.append("rollback")
            raise

    app = FastAPI()

    @app.get("/boom")
    async def boom(_db=Depends(fake_get_db)):
        raise HTTPException(status_code=503, detail="portal disabled")

    with TestClient(app) as client:
        assert client.get("/boom").status_code == 503

    assert events == ["rollback"]
