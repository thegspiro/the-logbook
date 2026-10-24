"""The navigation step must not undo what the organization step stored.

Two defects in ``/session/department``, the call the Navigation step makes:

* ``DepartmentInfoRequest.name`` allowed 3-100 characters while step 1
  (``OrganizationSetupCreate.name``) allowed 2-255 and the column holds 255, so
  a department whose name step 1 accepted could not finish setup.
* It replaced ``session.data["department"]`` wholesale, dropping the
  ``organization_id`` the organization step had written. Stations, apparatus
  and key custody resolve their organization from that key, so going back to
  any of them after choosing a layout failed with "Organization must be
  created".
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.onboarding import (
    DepartmentInfoRequest,
    StationsRequest,
    save_department_info,
    save_session_stations,
)
from app.models.onboarding import OnboardingSessionModel
from app.services.onboarding import OnboardingService


@pytest.mark.unit
class TestDepartmentInfoRequestName:
    def test_accepts_the_two_character_minimum_step_one_accepts(self):
        assert DepartmentInfoRequest(name="FD", navigation_layout="top").name == "FD"

    def test_accepts_the_255_character_maximum_step_one_accepts(self):
        name = "F" * 255
        assert DepartmentInfoRequest(name=name, navigation_layout="top").name == name

    def test_refuses_a_name_longer_than_the_column(self):
        with pytest.raises(ValidationError):
            DepartmentInfoRequest(name="F" * 256, navigation_layout="top")

    def test_strips_surrounding_whitespace(self):
        request = DepartmentInfoRequest(
            name="  Engine Co. 7  ", navigation_layout="left"
        )
        assert request.name == "Engine Co. 7"

    def test_measures_the_name_after_stripping(self):
        with pytest.raises(ValidationError):
            DepartmentInfoRequest(name="   A   ", navigation_layout="top")


@pytest.mark.integration
@pytest.mark.onboarding
class TestNavigationStepKeepsTheOrganization:
    async def test_stations_still_resolve_the_org_after_the_navigation_step(
        self, db_session: AsyncSession
    ):
        unique = uuid.uuid4().hex[:8]
        org = await OnboardingService(db_session).create_organization(
            name=f"Navigation Merge Department {unique}",
            slug=f"navigation-merge-{unique}",
            organization_type="fire_department",
            timezone="America/New_York",
        )
        await db_session.flush()
        org_id = str(org.id)

        session = OnboardingSessionModel(
            session_id=f"nav-merge-{unique}",
            data={
                "csrf_token": "token",
                "department": {
                    "name": "Old Name",
                    "organization_id": org_id,
                    "logo": None,
                    "saved_at": "2026-10-01T00:00:00+00:00",
                },
            },
            ip_address="127.0.0.1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        db_session.add(session)
        await db_session.flush()
        session_pk = session.id

        async def current_session(*_args, **_kwargs):
            result = await db_session.execute(
                select(OnboardingSessionModel).where(
                    OnboardingSessionModel.id == session_pk
                )
            )
            return result.scalar_one()

        with patch(
            "app.api.v1.onboarding.validate_session",
            new=AsyncMock(side_effect=current_session),
        ), patch(
            "app.services.onboarding.OnboardingService.needs_onboarding",
            new=AsyncMock(return_value=True),
        ):
            await save_department_info(
                SimpleNamespace(),
                DepartmentInfoRequest(name="  New Name  ", navigation_layout="left"),
                db_session,
            )

            # Read back what was actually written, not the in-memory object.
            db_session.expire_all()
            stored = await current_session()
            department = stored.data["department"]
            assert department["organization_id"] == org_id
            assert department["name"] == "New Name"
            assert department["navigation_layout"] == "left"
            assert department["saved_at"] != "2026-10-01T00:00:00+00:00"
            assert stored.data["csrf_token"] == "token"

            response = await save_session_stations(
                SimpleNamespace(), StationsRequest(stations=[]), db_session
            )

        assert response.success is True
