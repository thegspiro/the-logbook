"""A rejected logo on the organization step answers its own 400, not a 500.

``scan_and_validate_logo`` runs inside the ``try`` of both organization-step
routes and refuses a bad or malicious image with an ``HTTPException`` (a 400
that says why). The blanket ``except Exception`` the routes end with caught that
too and replaced it with "Failed to create organization", a 500 with nothing the
administrator could act on. ``POST /organization`` also had no blanket handler
at all, unlike its ``/session/organization`` twin.

No database: the service and the session lookup are stubbed, and the logo is
refused before anything would be written.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1 import onboarding
from app.schemas.organization import OrganizationSetupCreate

pytestmark = pytest.mark.unit


def _payload(**overrides) -> OrganizationSetupCreate:
    return OrganizationSetupCreate(
        name="Station Test",
        organization_type="fire_department",
        mailing_address={
            "line1": "1 Main St",
            "city": "Town",
            "state": "VA",
            "zip_code": "22046",
        },
        **overrides,
    )


def _service() -> SimpleNamespace:
    return SimpleNamespace(
        needs_onboarding=AsyncMock(return_value=True),
        create_organization=AsyncMock(),
    )


async def _create(route: str, data: OrganizationSetupCreate, service):
    db = AsyncMock()
    with (
        patch.object(onboarding, "OnboardingService", return_value=service),
        patch.object(
            onboarding,
            "validate_session",
            AsyncMock(return_value=SimpleNamespace(data={})),
        ),
    ):
        if route == "organization":
            return await onboarding.create_organization(AsyncMock(), data, db)
        return await onboarding.save_session_organization(AsyncMock(), data, db)


@pytest.mark.parametrize("route", ["organization", "session"])
class TestOrganizationStepErrors:
    async def test_a_rejected_logo_keeps_its_own_400(self, route):
        service = _service()

        with pytest.raises(HTTPException) as caught:
            await _create(route, _payload(logo="not-an-image"), service)

        assert caught.value.status_code == 400
        assert "Invalid image" in str(caught.value.detail)
        service.create_organization.assert_not_awaited()

    async def test_an_unexpected_failure_is_a_generic_500(self, route):
        service = _service()
        service.create_organization.side_effect = RuntimeError("boom with a path")

        with pytest.raises(HTTPException) as caught:
            await _create(route, _payload(), service)

        assert caught.value.status_code == 500
        assert "boom" not in str(caught.value.detail)

    async def test_a_value_error_is_a_400(self, route):
        service = _service()
        service.create_organization.side_effect = ValueError("slug is taken")

        with pytest.raises(HTTPException) as caught:
            await _create(route, _payload(), service)

        assert caught.value.status_code == 400
