"""
Membership pipeline service unit tests (MP2 / BXC).

Covers the pass-2 fixes:
- get_prospect populates the flat ProspectResponse.pipeline_name (BXC-2 — the
  applicant detail view renders it; it was always null off the list path).
- create_prospect / update_prospect validate a client-supplied referred_by
  (a User FK) is an in-org member (XC-1 — it wasn't in the protected set).

Mocked session — no DB.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.membership_pipeline_service import MembershipPipelineService


def _get_prospect_db(prospect):
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = prospect
    db.execute = AsyncMock(return_value=result)
    return db


class TestGetProspectPipelineName:
    async def test_populates_pipeline_name(self):
        prospect = SimpleNamespace(pipeline=SimpleNamespace(name="Recruit Class 2026"))
        db = _get_prospect_db(prospect)
        out = await MembershipPipelineService(db).get_prospect("p1", "org1")
        assert out.pipeline_name == "Recruit Class 2026"

    async def test_no_pipeline_yields_none_name(self):
        prospect = SimpleNamespace(pipeline=None)
        db = _get_prospect_db(prospect)
        out = await MembershipPipelineService(db).get_prospect("p1", "org1")
        assert out.pipeline_name is None

    async def test_missing_prospect_returns_none(self):
        db = _get_prospect_db(None)
        out = await MembershipPipelineService(db).get_prospect("p1", "org1")
        assert out is None


class TestReferredByValidation:
    async def test_update_rejects_foreign_referrer(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=SimpleNamespace()
        ), patch(
            "app.services.membership_pipeline_service.is_in_org",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(ValueError, match="Invalid referrer"):
                await svc.update_prospect("p1", "org1", {"referred_by": "foreign-user"})

    async def test_create_rejects_foreign_referrer(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc,
            "_find_active_prospect_by_email",
            new_callable=AsyncMock,
            return_value=None,
        ), patch(
            "app.services.membership_pipeline_service.is_in_org",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(ValueError, match="Invalid referrer"):
                await svc.create_prospect(
                    "org1",
                    {
                        "email": "a@b.com",
                        "first_name": "A",
                        "last_name": "B",
                        "referred_by": "foreign-user",
                    },
                    "u1",
                )

    async def test_update_without_referrer_skips_validation(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=SimpleNamespace()
        ), patch(
            "app.services.membership_pipeline_service.is_in_org",
            new_callable=AsyncMock,
        ) as mock_in_org, patch.object(
            svc, "_log_activity", new_callable=AsyncMock
        ):
            await svc.update_prospect("p1", "org1", {})
        mock_in_org.assert_not_awaited()
