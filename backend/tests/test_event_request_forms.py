"""Tests for the event-scoped public outreach forms endpoint."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints.event_requests import list_event_request_forms
from app.models.forms import IntegrationType


@pytest.mark.asyncio
async def test_list_event_request_forms_uses_event_request_filter():
    service = AsyncMock()
    service.get_forms.return_value = ([], 0)
    service.get_submission_counts.return_value = {}
    user = SimpleNamespace(organization_id="00000000-0000-0000-0000-000000000001")
    pagination = SimpleNamespace(skip=0, limit=50)

    with patch(
        "app.api.v1.endpoints.event_requests.FormsService", return_value=service
    ):
        response = await list_event_request_forms(
            pagination=pagination,
            db=AsyncMock(),
            current_user=user,
        )

    service.get_forms.assert_awaited_once_with(
        organization_id=user.organization_id,
        integration_type=IntegrationType.EVENT_REQUEST,
        skip=0,
        limit=50,
    )
    assert response.total == 0
    assert response.forms == []
