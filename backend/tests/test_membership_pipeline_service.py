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
    """The create/update paths validate a client-supplied referred_by (a User
    FK) is in-org via the shared assert_in_org helper."""

    async def test_update_rejects_foreign_referrer(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=SimpleNamespace()
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid referring member"),
        ):
            with pytest.raises(ValueError, match="referring member"):
                await svc.update_prospect("p1", "org1", {"referred_by": "foreign-user"})

    async def test_create_rejects_foreign_referrer(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc,
            "_find_active_prospect_by_email",
            new_callable=AsyncMock,
            return_value=None,
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid referring member"),
        ):
            with pytest.raises(ValueError, match="referring member"):
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
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
        ) as mock_assert, patch.object(
            svc, "_log_activity", new_callable=AsyncMock
        ):
            # main's update guard is `if "referred_by" in data:` — absent key skips.
            await svc.update_prospect("p1", "org1", {})
        mock_assert.assert_not_awaited()


class TestStepEmailTemplateValidation:
    """MP2-5 (pass 4): a step's client-supplied email_template_id (a FK to the
    org-scoped EmailTemplate) is validated in-org on every step writer."""

    async def test_add_step_rejects_foreign_template(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc,
            "get_pipeline",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(steps=[]),
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid email template"),
        ):
            with pytest.raises(ValueError, match="email template"):
                await svc.add_step(
                    "pipe1",
                    "org1",
                    {"name": "Welcome", "email_template_id": "foreign-template"},
                )

    async def test_create_pipeline_rejects_foreign_step_template(self):
        db = AsyncMock()
        db.add = MagicMock()  # add() is sync; AsyncMock would leave a coroutine
        svc = MembershipPipelineService(db)
        with patch.object(
            svc, "_unset_default_pipeline", new_callable=AsyncMock
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid email template"),
        ):
            with pytest.raises(ValueError, match="email template"):
                await svc.create_pipeline(
                    "org1",
                    name="Recruits",
                    steps=[
                        {"name": "Welcome", "email_template_id": "foreign-template"}
                    ],
                )

    async def test_update_step_without_template_skips_validation(self):
        svc = MembershipPipelineService(AsyncMock())
        # config={} on both old and new so the form-integration reconciliation
        # at the tail of update_step is a no-op (no form method to patch).
        step = SimpleNamespace(id="s1", name="Old", config={})
        with patch.object(
            svc,
            "get_pipeline",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(steps=[step]),
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
        ) as mock_assert:
            # The update guard is `if "email_template_id" in data:` — absent skips.
            await svc.update_step("s1", "pipe1", "org1", {"name": "Renamed"})
        mock_assert.assert_not_awaited()


class TestProspectDocumentStepValidation:
    """MP2-5 (pass 4): add_prospect_document rejects a client-supplied step_id
    that isn't in the prospect's own pipeline (the MP-5 sibling that was missed)."""

    async def test_foreign_step_rejected(self):
        svc = MembershipPipelineService(AsyncMock())
        prospect = SimpleNamespace(
            pipeline=SimpleNamespace(steps=[SimpleNamespace(id="real-step")])
        )
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=prospect
        ):
            with pytest.raises(ValueError, match="Step does not belong"):
                await svc.add_prospect_document(
                    prospect_id="p1",
                    organization_id="org1",
                    document_type="waiver",
                    file_name="w.pdf",
                    file_path="/app/uploads/w.pdf",
                    step_id="foreign-step",
                )
