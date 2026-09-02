"""Regression tests for system-position display-name updates."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints.roles import update_role
from app.schemas.role import RoleUpdate


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "PATCH",
            "path": "/roles/test",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        }
    )


def _user(organization_id: str):
    return SimpleNamespace(
        id=uuid4(),
        organization_id=organization_id,
        username="admin",
        positions=[],
    )


async def test_member_name_update_is_organization_scoped_and_preserves_slug():
    organization_id = str(uuid4())
    role_id = uuid4()
    member = SimpleNamespace(
        id=role_id,
        organization_id=organization_id,
        name="Member",
        slug="member",
        is_system=True,
        permissions=[],
    )
    renamed = SimpleNamespace(**{**member.__dict__, "name": "Volunteer"})

    with (
        patch(
            "app.api.v1.endpoints.roles.role_service.get_role",
            new=AsyncMock(return_value=member),
        ) as get_role,
        patch(
            "app.api.v1.endpoints.roles.role_service.update_role",
            new=AsyncMock(return_value=renamed),
        ) as service_update,
    ):
        result = await update_role(
            role_id,
            RoleUpdate(name="Volunteer"),
            _request(),
            MagicMock(),
            _user(organization_id),
        )

    assert result.name == "Volunteer"
    assert result.slug == "member"
    get_role.assert_awaited_once()
    assert get_role.await_args.args[1:] == (str(role_id), organization_id)
    assert service_update.await_args.kwargs["organization_id"] == organization_id
    assert service_update.await_args.kwargs["name"] == "Volunteer"


async def test_other_system_position_name_update_returns_error():
    organization_id = str(uuid4())
    role_id = uuid4()
    fixed = SimpleNamespace(
        id=role_id,
        organization_id=organization_id,
        name="Chief",
        slug="chief",
        is_system=True,
        permissions=[],
    )

    with (
        patch(
            "app.api.v1.endpoints.roles.role_service.get_role",
            new=AsyncMock(return_value=fixed),
        ),
        patch(
            "app.api.v1.endpoints.roles.role_service.update_role",
            new=AsyncMock(),
        ) as service_update,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await update_role(
                role_id,
                RoleUpdate(name="Commander"),
                _request(),
                MagicMock(),
                _user(organization_id),
            )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Cannot rename this system position"
    service_update.assert_not_awaited()
