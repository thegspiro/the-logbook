"""Absence in a stored modules dict means the field's default, not False.

Every installation past onboarding has a stored ``settings.modules`` dict
listing the fields that existed the day it was written. Adding a field to
``ModuleSettings`` therefore always produces dicts with a key missing, and
what that absence is read as decides what the next module does on upgrade.

It has to mean the field's *declared default*, per CLAUDE.md pitfall 19 — a
resolver that hardcodes False turns a live module off on upgrade and nobody
connects the vanished screen to the deploy. That puts the decision where it
can be read and argued with: on the field, one line above the module's name,
rather than buried in a resolver that treats every module alike.

Finance and Medical Screening are declared **off**, and the reasoning is on
the fields in ``schemas/organization.py``. In short: neither was reachable
from the navigation, so "on" was not a behaviour any department would notice
losing — while Finance's dashboard cards were showing dues and cash-flow to
departments that keep their books elsewhere, which is the complaint that
started this. Pitfall 19 protects a module somebody is *using*; it does not
require shipping one nobody asked for.
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


async def test_finance_and_medical_screening_are_opt_in():
    """ "Never enabled" has to mean off, or the switch answers nothing.

    Both are settings-only modules — the setup wizard never asks about them —
    so a True default would mean every department that has never heard of the
    Finance module still gets its dues, cash-flow and budget cards on the
    dashboard, which are the only link into ``/finance`` in the whole UI.
    Pinned by name rather than by "is it in the opt-in block", because the
    block a field sits in is a comment and this is the behaviour.
    """
    defaults = ModuleSettings()
    assert defaults.finance is False
    assert defaults.medical_screening is False

    enabled = defaults.get_enabled_modules()
    assert "finance" not in enabled
    assert "medical_screening" not in enabled


async def test_an_organization_that_never_configured_modules_has_finance_off():
    """The end-to-end shape of the complaint, through the real resolver.

    A dict written before either field existed is exactly what every upgraded
    installation has, and the resolver must not read that silence as consent.
    """
    stored = {
        field: getattr(ModuleSettings(), field)
        for field in ModuleSettings.model_fields
        if field not in ("finance", "medical_screening")
    }
    stored["training"] = True
    stored["_user_configured"] = True

    resolved = await _service()._resolve_module_settings({"modules": stored})

    assert "finance" not in resolved.get_enabled_modules()
    assert "medical_screening" not in resolved.get_enabled_modules()


async def test_switching_finance_on_actually_enables_it():
    """The gate has to be liftable, or it is a removal with extra steps."""
    stored = {"finance": True, "_user_configured": True}

    resolved = await _service()._resolve_module_settings({"modules": stored})

    assert resolved.finance is True
    assert "finance" in resolved.get_enabled_modules()


async def test_resolving_an_empty_settings_dict_yields_the_declared_defaults():
    resolved = await _service()._resolve_module_settings({})

    assert resolved.model_dump() == ModuleSettings().model_dump()
