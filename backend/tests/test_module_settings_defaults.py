"""Adding a module to ModuleSettings must not switch it off for anybody.

Every installation past onboarding has a stored ``settings.modules`` dict
listing the fields that existed the day it was written. Adding a field to
``ModuleSettings`` therefore always produces dicts with a key missing, and
what that absence is read as decides whether the next module ships silently
disabled across every department that upgrades.

It has to mean "current behaviour" — the field's declared default — for the
reason CLAUDE.md pitfall 19 gives: a resolver that reads absence as False
turns a live module off on upgrade, and nobody connects the vanished screen to
the deploy. This is not hypothetical. Finance and Medical Screening shipped
with no ``ModuleSettings`` field at all, so they were unconditionally on;
adding their fields under the old ``modules.get(f, False)`` resolver would
have taken Finance away from every existing department at once.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.organization import ModuleSettings
from app.services.onboarding import (
    ONBOARDING_CORE_MODULES,
    ONBOARDING_OFFERED_MODULES,
    OnboardingService,
)
from app.services.organization_service import OrganizationService

pytestmark = pytest.mark.asyncio


def _service() -> OrganizationService:
    db = MagicMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    return OrganizationService(db)


async def test_a_field_missing_from_a_stored_dict_falls_back_to_its_default():
    """The upgrade case: a dict written before the field existed."""
    defaults = ModuleSettings()
    # A realistic legacy dict: everything that existed then, explicitly saved.
    stored = {
        field: getattr(defaults, field)
        for field in ModuleSettings.model_fields
        if field not in ("finance", "medical_screening")
    }
    stored["_user_configured"] = True

    resolved = await _service()._resolve_module_settings({"modules": stored})

    assert resolved.finance is defaults.finance
    assert resolved.medical_screening is defaults.medical_screening


async def test_an_explicit_false_is_still_honoured():
    """The fallback must not override a department's actual choice."""
    stored = {field: True for field in ModuleSettings.model_fields}
    stored["finance"] = False
    stored["_user_configured"] = True

    resolved = await _service()._resolve_module_settings({"modules": stored})

    assert resolved.finance is False
    assert resolved.medical_screening is True


async def test_an_all_off_dict_is_not_rescued_by_a_defaulting_field():
    """The all-off recovery path must judge what was stored, not the model.

    A dict of every-known-field-False is the failed-dual-write signature the
    resolver falls through on. Once some newer field defaults to True, asking
    the resolved model "is anything enabled?" answers yes and the recovery
    never runs — so the question is asked of the stored keys instead.
    """
    stored = {
        field: False
        for field in ModuleSettings.model_fields
        if field not in ("finance", "medical_screening")
    }

    service = _service()
    # No organization passed, so the onboarding migration path finds nothing
    # and the resolver returns declared defaults rather than the all-off dict.
    resolved = await service._resolve_module_settings({"modules": stored})

    assert resolved.training is True, "fell through to defaults, not the all-off dict"


async def test_setup_stores_defaults_for_the_modules_it_never_offers():
    """Setup decides only what it actually put in front of somebody.

    Writing False for the rest records "the department declined" against a
    question nobody was asked. That is how ``public_info`` came to be stored
    off on every fresh install despite defaulting on, and it would have done
    the same to Finance and Medical Screening.

    Driven through ``configure_modules`` itself rather than a re-implementation
    of it — the defect lives in what that method writes.
    """
    org = SimpleNamespace(settings={}, name="Test FD")
    status = SimpleNamespace(enabled_modules=[], organization_name="Test FD")

    service = OnboardingService(MagicMock())
    service.db.flush = AsyncMock()
    service.db.execute = AsyncMock(
        return_value=SimpleNamespace(scalar_one_or_none=lambda: org)
    )
    service.get_onboarding_status = AsyncMock(return_value=status)
    service._mark_step_completed = AsyncMock()

    # A department that accepted nothing beyond the core modules: the harshest
    # case for a settings-only module, because nothing was opted into.
    await service.configure_modules(list(ONBOARDING_CORE_MODULES))

    written = org.settings["modules"]
    defaults = ModuleSettings()
    asked_about = set(ONBOARDING_CORE_MODULES) | set(ONBOARDING_OFFERED_MODULES)
    settings_only = [
        field for field in ModuleSettings.model_fields if field not in asked_about
    ]
    assert settings_only, "no settings-only modules left to check"

    for field in settings_only:
        assert written[field] is getattr(defaults, field), field
    # And what setup did ask about is still recorded as declined.
    for field in ONBOARDING_OFFERED_MODULES:
        assert written[field] is False, field


async def test_the_new_modules_default_on_because_they_had_no_switch_before():
    """Finance and Medical Screening were unconditionally available."""
    defaults = ModuleSettings()
    assert defaults.finance is True
    assert defaults.medical_screening is True

    enabled = defaults.get_enabled_modules()
    assert "finance" in enabled
    assert "medical_screening" in enabled


async def test_resolving_an_empty_settings_dict_yields_the_declared_defaults():
    resolved = await _service()._resolve_module_settings({})

    assert resolved.model_dump() == ModuleSettings().model_dump()
