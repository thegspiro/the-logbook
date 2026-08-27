"""
ONB2-30-3: six of the twelve /session/* onboarding mutation endpoints never
got the post-completion needs_onboarding() replay guard that ONB-3/ONB-9
added to their siblings (/modules, /notifications, /complete,
/session/roles+/positions, /session/stations, /session/apparatus,
/session/organization). A still-valid (or stolen) session could otherwise
keep rewriting a completed org's onboarding-session data indefinitely.
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.onboarding import (
    AuthConfigRequest,
    DepartmentInfoRequest,
    EmailConfigRequest,
    FileStorageConfigRequest,
    ITTeamRequest,
    SessionModulesRequest,
    save_auth_config,
    save_department_info,
    save_email_config,
    save_file_storage_config,
    save_it_team,
    save_session_modules,
)


def _completed_service():
    svc = MagicMock()
    svc.needs_onboarding = AsyncMock(return_value=False)  # onboarding is done
    return svc


def _session():
    return SimpleNamespace(data={"department": {"organization_id": "org-1"}})


class TestSessionMutationsRejectedAfterCompletion:
    async def _assert_rejected(self, coro):
        svc = _completed_service()
        with patch(
            "app.api.v1.onboarding.validate_session",
            new=AsyncMock(return_value=_session()),
        ), patch("app.api.v1.onboarding.OnboardingService", return_value=svc):
            with pytest.raises(HTTPException) as exc:
                await coro(svc)
        assert exc.value.status_code == 400
        assert "already been completed" in exc.value.detail

    async def test_department_rejected_after_completion(self):
        await self._assert_rejected(
            lambda svc: save_department_info(
                MagicMock(),
                DepartmentInfoRequest(name="Engine Co.", navigation_layout="top"),
                MagicMock(),
            )
        )

    async def test_email_rejected_after_completion(self):
        await self._assert_rejected(
            lambda svc: save_email_config(
                MagicMock(),
                EmailConfigRequest(platform="gmail", config={}),
                MagicMock(),
            )
        )

    async def test_file_storage_rejected_after_completion(self):
        await self._assert_rejected(
            lambda svc: save_file_storage_config(
                MagicMock(),
                FileStorageConfigRequest(platform="local", config={}),
                MagicMock(),
            )
        )

    async def test_auth_rejected_after_completion(self):
        await self._assert_rejected(
            lambda svc: save_auth_config(
                MagicMock(),
                AuthConfigRequest(platform="local"),
                MagicMock(),
            )
        )

    async def test_it_team_rejected_after_completion(self):
        await self._assert_rejected(
            lambda svc: save_it_team(
                MagicMock(),
                ITTeamRequest(it_team=[], backup_access={}),
                MagicMock(),
            )
        )

    async def test_modules_rejected_after_completion(self):
        await self._assert_rejected(
            lambda svc: save_session_modules(
                MagicMock(),
                SessionModulesRequest(modules=[]),
                MagicMock(),
            )
        )


class TestSaveItTeamStoresPlainDicts:
    """session.data is a JSON column — storing the ITTeamMemberRequest
    pydantic models themselves (rather than dicts) would fail to serialize
    at commit time. save_it_team must model_dump() each entry first."""

    async def test_members_are_plain_dicts_not_pydantic_models(self):
        svc = MagicMock()
        svc.needs_onboarding = AsyncMock(return_value=True)  # in progress
        session = SimpleNamespace(data={})
        db = MagicMock()
        db.commit = AsyncMock()

        with patch(
            "app.api.v1.onboarding.validate_session",
            new=AsyncMock(return_value=session),
        ), patch("app.api.v1.onboarding.OnboardingService", return_value=svc):
            await save_it_team(
                MagicMock(),
                ITTeamRequest(
                    it_team=[
                        {
                            "name": "Jane",
                            "email": "jane@x.com",
                            "phone": "555-1234",
                            "role": "Primary",
                        }
                    ],
                    backup_access={"email": "backup@x.com"},
                ),
                db,
            )

        members = session.data["it_team"]["members"]
        assert members == [
            {
                "name": "Jane",
                "email": "jane@x.com",
                "phone": "555-1234",
                "role": "Primary",
            }
        ]
        assert all(isinstance(m, dict) for m in members)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
