"""Contract test: the modules setup offers vs the modules the app can enable.

The setup wizard's module step renders the frontend registry, and the Settings
→ Modules screen renders its own list. Both feed the same
``Organization.settings.modules`` dict, and nothing at build time makes them
agree — a module missing from the registry simply never appears, is written as
``False`` alongside an explicit "the user configured this" marker, and stays
invisible to every member until an admin happens to find the Settings toggle.

That is not hypothetical: the Department Store shipped with an endpoint, a
console, seeded permissions and a Settings toggle, but no registry entry, so
no department could turn it on during setup and members never saw the store in
their navigation.

Like test_storefront_api_contract.py, this reads the .ts files as text. It
only needs to compare ids, and a node round-trip from pytest would buy accuracy
this does not need.

If this fails, add the module to whichever side is missing it — do not loosen
the comparison.
"""

import re
from pathlib import Path

import pytest

from app.schemas.organization import ModuleSettings
from app.services.onboarding import (
    ONBOARDING_ACCEPTED_MODULE_IDS,
    ONBOARDING_CORE_MODULES,
    ONBOARDING_LEGACY_MODULES,
    ONBOARDING_OFFERED_MODULES,
    ONBOARDING_SETTINGS_ONLY_MODULES,
)

pytestmark = pytest.mark.unit

_FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
_REGISTRY_FILE = _FRONTEND / "modules" / "onboarding" / "config" / "moduleRegistry.ts"
_SETTINGS_FILE = _FRONTEND / "pages" / "SettingsPage.tsx"


def _registry_user_facing_ids() -> set:
    """Ids from MODULE_REGISTRY, minus the System-category entries.

    ``getUserFacingModules()`` filters on ``category !== 'System'``, so the
    same filter is applied here rather than to the raw list.
    """
    source = _REGISTRY_FILE.read_text()
    entries = re.findall(r"\{\s*id:\s*'([\w-]+)'(.*?)\n  \},", source, re.S)
    assert entries, f"No module entries found in {_REGISTRY_FILE.name}"
    return {
        module_id for module_id, body in entries if "category: 'System'" not in body
    }


def _settings_page_module_keys() -> set:
    """Keys from the STANDARD_MODULES / ADDITIONAL_MODULES toggle lists.

    Each array is matched on its own declaration rather than as one span
    running to whatever happens to be declared next. The previous form ended
    at ``const CONFIGURABLE_MODULES``, a derived constant that existed only to
    total the two lists; when the Settings screen started counting each list
    separately that constant went away, and this read as "no module toggle
    lists found" rather than as the anchor having moved. Matching each array
    also narrows what is scanned, so a `key:` belonging to anything declared
    between them can no longer be mistaken for a module.
    """
    source = _SETTINGS_FILE.read_text()
    keys: set = set()
    for name in ("STANDARD_MODULES", "ADDITIONAL_MODULES"):
        match = re.search(
            rf"const {name}: ConfigurableModule\[\] = \[(.*?)\n\];", source, re.S
        )
        assert match, f"No {name} list found in {_SETTINGS_FILE.name}"
        keys |= set(re.findall(r"key:\s*'(\w+)'", match.group(1)))
    return keys


def test_every_module_setting_is_either_core_offered_or_settings_only():
    """Each module has to be placed deliberately, in exactly one bucket.

    A field in none of the three is the Department Store's defect: it can be
    stored, so a Settings toggle can write it, but nothing in setup offers it
    and a new department gets it off with no indication it exists.
    """
    core = set(ONBOARDING_CORE_MODULES)
    offered = set(ONBOARDING_OFFERED_MODULES)
    settings_only = set(ONBOARDING_SETTINGS_ONLY_MODULES)

    assert not offered & settings_only
    unplaced = set(ModuleSettings.model_fields) - core - offered - settings_only
    assert not unplaced, (
        "These are storable modules that setup never offers and that nothing "
        "marks as Settings-only, so they start off and stay hidden: "
        f"{sorted(unplaced)}"
    )


def test_the_settings_screen_toggles_only_placed_modules():
    """The Settings list cannot offer something the backend has not placed."""
    placed = (
        set(ONBOARDING_CORE_MODULES)
        | set(ONBOARDING_OFFERED_MODULES)
        | set(ONBOARDING_SETTINGS_ONLY_MODULES)
    )
    assert not _settings_page_module_keys() - placed


def test_the_registry_offers_exactly_what_the_backend_accepts():
    expected = set(ONBOARDING_CORE_MODULES) | set(ONBOARDING_OFFERED_MODULES)
    assert _registry_user_facing_ids() == expected


def test_every_offered_module_is_a_real_module_setting():
    """An offered id that is not a ModuleSettings field is written nowhere."""
    unknown = set(ONBOARDING_OFFERED_MODULES) - set(ModuleSettings.model_fields)
    assert (
        not unknown
    ), f"Setup offers modules that ModuleSettings cannot store: {sorted(unknown)}"


def test_the_legacy_ids_stay_out_of_the_offered_list():
    assert not set(ONBOARDING_LEGACY_MODULES) & set(ONBOARDING_OFFERED_MODULES)


def test_every_offered_module_survives_the_whole_wizard():
    """Offering a module is worthless if a later step rejects it.

    The module step and the session-save endpoint validated against separate
    hardcoded lists. Storefront was added to the registry and to the wizard's
    list but not to the session endpoint's, so enabling the Department Store
    got as far as the final Continue and failed with "Invalid modules" —
    setup could not be completed at all.
    """
    unaccepted = set(ONBOARDING_OFFERED_MODULES) - ONBOARDING_ACCEPTED_MODULE_IDS
    assert not unaccepted, (
        "Setup offers these modules but the onboarding endpoints reject them, "
        f"so a department that enables one cannot finish setup: {sorted(unaccepted)}"
    )


def test_the_endpoints_validate_against_the_shared_set():
    """No endpoint may reintroduce a list of its own.

    Asserted by source, because the failure mode is a second list that agrees
    today and drifts on the next module — which is exactly what happened.
    """
    api_source = (
        Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "onboarding.py"
    ).read_text()
    handler = api_source[api_source.index("async def save_session_modules") :][:3000]
    assert "ONBOARDING_ACCEPTED_MODULE_IDS" in handler
    assert '"training",' not in handler, (
        "save_session_modules is validating against its own module list again; "
        "use ONBOARDING_ACCEPTED_MODULE_IDS"
    )


def test_the_accepted_set_takes_both_spellings():
    """Saved sessions carry hyphenated ids alongside snake_case ones."""
    assert "prospective-members" in ONBOARDING_ACCEPTED_MODULE_IDS
    assert "prospective_members" in ONBOARDING_ACCEPTED_MODULE_IDS
    assert "hr-payroll" in ONBOARDING_ACCEPTED_MODULE_IDS
