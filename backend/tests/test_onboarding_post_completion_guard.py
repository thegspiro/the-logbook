"""
ONB-9 (pass 2): the /session/stations and /session/apparatus onboarding steps
write real Facility / BasicApparatus rows, so — like their sibling steps — they
must reject once onboarding is complete. Completion does not delete the session,
so a still-valid (or stolen) session must not be replayable to inject rows into
the provisioned org, bypassing the authenticated facilities.manage path. DB
mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.onboarding import (
    ApparatusListRequest,
    StationsRequest,
    save_session_apparatus,
    save_session_stations,
)


def _completed_service():
    svc = MagicMock()
    svc.needs_onboarding = AsyncMock(return_value=False)  # onboarding is done
    svc.replace_onboarding_stations = AsyncMock()
    svc.replace_onboarding_apparatus = AsyncMock()
    return svc


def _session():
    return SimpleNamespace(data={"department": {"organization_id": "org-1"}})


class TestPostCompletionGuard:
    async def test_stations_rejected_after_completion(self):
        svc = _completed_service()
        with patch(
            "app.api.v1.onboarding.validate_session",
            new=AsyncMock(return_value=_session()),
        ), patch("app.api.v1.onboarding.OnboardingService", return_value=svc):
            with pytest.raises(HTTPException) as exc:
                await save_session_stations(
                    MagicMock(), StationsRequest(stations=[]), MagicMock()
                )
        assert exc.value.status_code == 400
        assert "already been completed" in exc.value.detail
        svc.replace_onboarding_stations.assert_not_called()

    async def test_apparatus_rejected_after_completion(self):
        svc = _completed_service()
        with patch(
            "app.api.v1.onboarding.validate_session",
            new=AsyncMock(return_value=_session()),
        ), patch("app.api.v1.onboarding.OnboardingService", return_value=svc):
            with pytest.raises(HTTPException) as exc:
                await save_session_apparatus(
                    MagicMock(), ApparatusListRequest(apparatus=[]), MagicMock()
                )
        assert exc.value.status_code == 400
        assert "already been completed" in exc.value.detail
        svc.replace_onboarding_apparatus.assert_not_called()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
