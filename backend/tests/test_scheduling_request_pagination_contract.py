"""Contract coverage for paginated scheduling request collections."""

from types import SimpleNamespace

import pytest

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import scheduling
from app.api.v1.endpoints.scheduling import router
from app.schemas.scheduling import ShiftSwapRequestsPage, ShiftTimeOffRequestsPage


def _route(path: str):
    return next(
        route
        for route in router.routes
        if route.path == path and "GET" in route.methods
    )


def test_swap_request_list_uses_paginated_response_schema():
    assert _route("/swap-requests").response_model is ShiftSwapRequestsPage
    assert set(ShiftSwapRequestsPage.model_fields) == {
        "items",
        "total",
        "skip",
        "limit",
    }


def test_time_off_list_uses_paginated_response_schema():
    assert _route("/time-off").response_model is ShiftTimeOffRequestsPage
    assert set(ShiftTimeOffRequestsPage.model_fields) == {
        "items",
        "total",
        "skip",
        "limit",
    }


@pytest.mark.parametrize(
    ("endpoint", "service_method", "enrichment_method"),
    [
        (scheduling.list_swap_requests, "get_swap_requests", "enrich_swap_requests"),
        (
            scheduling.list_time_off_requests,
            "get_time_off_requests",
            "enrich_time_off_requests",
        ),
    ],
)
@pytest.mark.asyncio
async def test_list_endpoint_returns_service_total_and_requested_window(
    monkeypatch, endpoint, service_method, enrichment_method
):
    """The HTTP contract must expose the unpaginated service count."""

    class FakeService:
        def __init__(self, db):
            self.db = db

    async def list_requests(*args, **kwargs):
        assert kwargs["skip"] == 20
        assert kwargs["limit"] == 10
        return [SimpleNamespace(id="request-21")], 37

    async def enrich(requests):
        assert len(requests) == 1
        return [{"id": "request-21"}]

    setattr(FakeService, service_method, list_requests)
    setattr(FakeService, enrichment_method, staticmethod(enrich))
    monkeypatch.setattr(scheduling, "SchedulingService", FakeService)
    monkeypatch.setattr(scheduling, "user_has_permission", lambda *args: True)

    kwargs = {
        "status_filter": None,
        "pagination": PaginationParams(skip=20, limit=10),
        "db": object(),
        "current_user": SimpleNamespace(organization_id="org-1"),
    }
    if endpoint is scheduling.list_time_off_requests:
        kwargs["user_id"] = None

    response = await endpoint(**kwargs)

    assert response == {
        "items": [{"id": "request-21"}],
        "total": 37,
        "skip": 20,
        "limit": 10,
    }
