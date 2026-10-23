"""
``GET /training/sessions/by-event/{event_id}`` answers ``200`` with ``null`` for
an event that has no training session.

The event detail and edit pages ask this for every event they open, and most
events have no session. It used to answer ``404`` and the browser logged a red
console error for an ordinary answer. Only the not-found-is-normal read changed:
a session that exists is returned exactly as before.
"""

from types import SimpleNamespace
from typing import Optional, get_args
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints import training_sessions as endpoint
from app.schemas.training_session import TrainingSessionResponse

pytestmark = pytest.mark.unit


def _caller():
    return SimpleNamespace(organization_id=uuid4())


def _route():
    for route in endpoint.router.routes:
        if getattr(route, "path", None) == "/by-event/{event_id}" and (
            "GET" in getattr(route, "methods", set())
        ):
            return route
    raise AssertionError("GET /by-event/{event_id} is not registered")


class TestGetTrainingSessionByEvent:
    async def test_event_without_a_session_answers_null_not_404(self):
        service = SimpleNamespace(get_session_by_event=AsyncMock(return_value=None))
        with patch.object(endpoint, "TrainingSessionService", return_value=service):
            result = await endpoint.get_training_session_by_event(
                event_id=uuid4(), db=AsyncMock(), current_user=_caller()
            )

        assert result is None

    async def test_lookup_is_scoped_to_the_callers_organization(self):
        service = SimpleNamespace(get_session_by_event=AsyncMock(return_value=None))
        caller = _caller()
        event_id = uuid4()
        with patch.object(endpoint, "TrainingSessionService", return_value=service):
            await endpoint.get_training_session_by_event(
                event_id=event_id, db=AsyncMock(), current_user=caller
            )

        service.get_session_by_event.assert_awaited_once_with(
            event_id=event_id, organization_id=caller.organization_id
        )

    async def test_an_attached_session_is_returned_unchanged(self):
        attached = object()
        shaped = object()
        service = SimpleNamespace(get_session_by_event=AsyncMock(return_value=attached))
        with (
            patch.object(endpoint, "TrainingSessionService", return_value=service),
            patch.object(endpoint, "_session_response", return_value=shaped) as shape,
        ):
            result = await endpoint.get_training_session_by_event(
                event_id=uuid4(), db=AsyncMock(), current_user=_caller()
            )

        assert result is shaped
        shape.assert_called_once_with(attached)

    def test_declared_response_admits_null_so_the_contract_matches(self):
        # A handler that returns None under a non-optional response_model is a
        # 500 at serialization, and the OpenAPI document would still promise a
        # session body. The declared type has to say null is allowed.
        declared = _route().response_model
        assert declared == Optional[TrainingSessionResponse]
        assert type(None) in get_args(declared)


class TestOverHttp:
    def test_the_wire_answer_is_200_with_a_null_body(self):
        from app.api.dependencies import get_current_user
        from app.core.database import get_db
        from main import app

        # The lifespan is not entered, so no database or signal handlers are
        # needed; the overrides stand in for the session and the signed-in user.
        app.dependency_overrides[get_current_user] = _caller
        app.dependency_overrides[get_db] = lambda: None
        service = SimpleNamespace(get_session_by_event=AsyncMock(return_value=None))
        try:
            with patch.object(endpoint, "TrainingSessionService", return_value=service):
                response = TestClient(app).get(
                    f"/api/v1/training/sessions/by-event/{uuid4()}"
                )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
            app.dependency_overrides.pop(get_db, None)

        assert response.status_code == 200
        assert response.json() is None
