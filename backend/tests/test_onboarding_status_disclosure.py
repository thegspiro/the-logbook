"""
ONB-8: the unauthenticated GET /onboarding/status must not leak the org name or
setup progress to anonymous callers once onboarding is complete — its only
post-completion job is to tell the login guard there is nothing to set up. While
onboarding is in progress the wizard legitimately reads these back to resume, so
that branch keeps them. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.v1.onboarding import get_onboarding_status


def _service(*, needs, status_obj):
    svc = MagicMock()
    svc.STEPS = [1, 2, 3, 4, 5]  # only len() is used
    svc.needs_onboarding = AsyncMock(return_value=needs)
    svc.get_onboarding_status = AsyncMock(return_value=status_obj)
    return svc


class TestOnboardingStatusDisclosure:
    async def test_completed_hides_org_name_and_progress(self):
        svc = _service(
            needs=False,
            status_obj=SimpleNamespace(
                is_completed=True,
                current_step=5,
                steps_completed={"owner": True},
                organization_name="Acme Fire Dept",
            ),
        )
        with patch("app.api.v1.onboarding.OnboardingService", return_value=svc):
            resp = await get_onboarding_status(db=MagicMock())

        assert resp.needs_onboarding is False
        assert resp.is_completed is True
        # The disclosure fix: nothing identifying leaks post-completion.
        assert resp.organization_name is None
        assert resp.steps_completed == {}
        assert resp.current_step == 0

    async def test_in_progress_keeps_org_name_for_the_wizard(self):
        svc = _service(
            needs=True,
            status_obj=SimpleNamespace(
                is_completed=False,
                current_step=2,
                steps_completed={"org": True},
                organization_name="Acme Fire Dept",
            ),
        )
        with patch("app.api.v1.onboarding.OnboardingService", return_value=svc):
            resp = await get_onboarding_status(db=MagicMock())

        assert resp.needs_onboarding is True
        assert resp.organization_name == "Acme Fire Dept"
        assert resp.current_step == 2
