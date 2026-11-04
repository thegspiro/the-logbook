"""Setup decides only the modules it asked about.

Completing setup wrote every ModuleSettings field from the session's enabled
list, so a module the wizard never showed was stored as False, which reads as
"the department said no". Public Information, which defaults to on, was the
module that exposed it: every fresh install came up with it off.

Owner decision 2026-11-01 (workflow review W01-24), confirmed 2026-11-04: the
wizard now asks about Public Information, so for it the department's answer
decides. Modules setup still does not ask about keep their declared default.

The service-side module save already kept the declared default for a module
setup does not offer. The completion path, which copies the session into
Organization.settings, did not. Both now take the rule from one helper.
"""

import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import onboarding as onboarding_api
from app.schemas.organization import ModuleSettings
from app.services.onboarding import (
    ONBOARDING_ALWAYS_ON_MODULES,
    ONBOARDING_CORE_MODULES,
    ONBOARDING_OFFERED_MODULES,
    ONBOARDING_SETTINGS_ONLY_MODULES,
    OnboardingService,
    modules_from_setup_answers,
)


@pytest.mark.unit
class TestTheRule:
    def test_a_module_setup_never_offers_keeps_its_default(self):
        stored = modules_from_setup_answers(["members", "events", "training"])

        defaults = ModuleSettings()
        for key in ONBOARDING_SETTINGS_ONLY_MODULES:
            assert stored[key] == getattr(defaults, key), key

    def test_a_module_setup_offers_follows_the_answer(self):
        stored = modules_from_setup_answers(["members", "events", "training"])

        assert stored["training"] is True
        # Offered and left off — a real answer, so it is stored off.
        assert stored["inventory"] is False
        assert stored["scheduling"] is False

    def test_hyphenated_ids_from_older_sessions_are_read(self):
        stored = modules_from_setup_answers(["prospective-members"])

        assert stored["prospective_members"] is True

    def test_every_module_setting_is_written(self):
        stored = modules_from_setup_answers([])

        assert set(stored) == set(ModuleSettings.model_fields)

    def test_public_information_is_asked_so_the_answer_decides(self):
        asked = set(ONBOARDING_CORE_MODULES) | set(ONBOARDING_OFFERED_MODULES)
        assert "public_info" in asked

        assert modules_from_setup_answers(["members"])["public_info"] is False
        assert (
            modules_from_setup_answers(["members", "public_info"])["public_info"]
            is True
        )


async def _create_org(db_session: AsyncSession):
    service = OnboardingService(db_session)
    unique = str(uuid.uuid4())[:8]
    org = await service.create_organization(
        name=f"Module Defaults VFD {unique}",
        slug=f"module-defaults-{unique}",
        organization_type="fire_department",
        timezone="America/New_York",
    )
    await db_session.flush()
    return org


# Real rows, so a real database: the no-DB job selects on this marker.
@pytest.mark.integration
@pytest.mark.onboarding
class TestCompletionStoresTheRule:
    async def test_completing_setup_stores_the_public_information_answer(
        self, db_session: AsyncSession
    ):
        org = await _create_org(db_session)
        session = SimpleNamespace(
            data={
                "modules": {"enabled": ["members", "events", "documents", "training"]}
            }
        )

        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        modules = org.settings["modules"]
        # Not chosen in the Modules step, which now asks about it.
        assert modules["public_info"] is False
        assert modules["training"] is True
        assert modules["inventory"] is False
        assert modules["finance"] is False

    async def test_the_service_save_and_the_completion_agree(
        self, db_session: AsyncSession
    ):
        org = await _create_org(db_session)
        # Custom Forms skipped on purpose: configure_modules used to force it
        # on with the rest of the core list while the completion honoured the
        # skip, so the two paths stored different answers for one decision.
        enabled = ["members", "events", "documents", "scheduling"]
        session = SimpleNamespace(data={"modules": {"enabled": enabled}})

        await onboarding_api._persist_session_data_to_org(session, db_session)
        await db_session.refresh(org)
        from_completion = dict(org.settings["modules"])

        await OnboardingService(db_session).configure_modules(enabled)
        await db_session.refresh(org)

        assert org.settings["modules"] == from_completion
        assert from_completion["forms"] is False

    async def test_skipping_custom_forms_is_kept_by_the_service_save(
        self, db_session: AsyncSession
    ):
        org = await _create_org(db_session)

        result = await OnboardingService(db_session).configure_modules(
            ["members", "events", "documents"]
        )

        await db_session.refresh(org)
        assert org.settings["modules"]["forms"] is False
        assert result["forms"] is False
        # The three the server keeps on whatever is stored are still on.
        for module_id in ONBOARDING_ALWAYS_ON_MODULES:
            assert result[module_id] is True, module_id


@pytest.mark.unit
class TestTheAlwaysOnList:
    def test_matches_what_the_server_always_enables(self):
        # ModuleSettings.get_enabled_modules adds these whatever is stored;
        # setup must force exactly those, and Custom Forms is not among them.
        always = set(ModuleSettings().get_enabled_modules()) - set(
            ModuleSettings.model_fields
        )
        assert set(ONBOARDING_ALWAYS_ON_MODULES) == always & set(
            ONBOARDING_CORE_MODULES
        )
        assert "forms" not in ONBOARDING_ALWAYS_ON_MODULES

    def test_matches_the_setup_screen(self):
        # The Modules step shows these as "Always on", with no Skip.
        registry = (
            Path(__file__).resolve().parents[2]
            / "frontend/src/modules/onboarding/config/moduleRegistry.ts"
        ).read_text()
        match = re.search(r"ALWAYS_ON_MODULE_IDS[^=]*=\s*\[([^\]]*)\]", registry)
        assert match, "ALWAYS_ON_MODULE_IDS not found in moduleRegistry.ts"
        frontend = set(re.findall(r"'([\w-]+)'", match.group(1)))
        assert frontend == set(ONBOARDING_ALWAYS_ON_MODULES)
