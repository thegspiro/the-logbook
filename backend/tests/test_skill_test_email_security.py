"""Security controls for emailing skill-test results."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.api.v1.endpoints.skills_testing import (
    _email_result_text,
    _ensure_test_results_emailable,
    router,
)


def test_result_text_is_html_escaped():
    assert _email_result_text("<b>pass</b>") == "&lt;B&gt;PASS&lt;/B&gt;"


def test_draft_results_cannot_be_emailed():
    with pytest.raises(HTTPException) as exc:
        _ensure_test_results_emailable(SimpleNamespace(status="draft"))

    assert exc.value.status_code == 400


def test_completed_results_can_be_emailed():
    _ensure_test_results_emailable(SimpleNamespace(status="completed"))


def test_email_results_requires_training_manage_permission():
    route = next(
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.path.endswith("/email-results")
    )

    permission_dependency = route.dependant.dependencies[1].call
    assert permission_dependency.required_permissions == ["training.manage"]
