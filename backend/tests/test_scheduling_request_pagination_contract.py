"""Contract coverage for paginated scheduling request collections."""

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
