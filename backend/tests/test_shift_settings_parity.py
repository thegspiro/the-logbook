"""The backend's shift defaults and the frontend's copy are one set of numbers.

``scheduling_module_config_service.DEFAULT_SHIFT_SETTINGS`` carries a comment
saying it is "kept in lockstep with the frontend's DEFAULT_SETTINGS in
frontend/src/modules/scheduling/types/shiftSettings.ts". Nothing enforced it,
and the frontend copy is not decoration: ``mergeWithDefaults`` spreads it under
every server response, the offline path returns it verbatim, and
``getCachedShiftSettings()`` — the synchronous accessor the template form reads
apparatus seats from — returns it when there is no cache.

So a drift is not cosmetic. A department creating a shift template offline gets
whatever the frontend says, and those seats are copied permanently into
``shift_templates.positions``.

Reads the TypeScript as text, like ``test_position_slots.py`` and
``test_onboarding_position_template_parity.py``.
"""

import json
import re
from pathlib import Path

import pytest

from app.services.scheduling_module_config_service import (
    DEFAULT_APPARATUS_TYPE_DEFAULTS,
    DEFAULT_RESOURCE_TYPE_DEFAULTS,
)

pytestmark = pytest.mark.unit

_SHIFT_SETTINGS_TS = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "modules"
    / "scheduling"
    / "types"
    / "shiftSettings.ts"
)


def _object_literal(name: str) -> dict:
    """Parse `export const <name> ... = { ... };` into a dict.

    The literals are plain data — string keys, string/number values, string
    arrays — so quoting the keys and swapping the quote style is enough to make
    them JSON. Deliberately strict: anything richer should fail loudly here
    rather than be silently half-compared.
    """
    source = _SHIFT_SETTINGS_TS.read_text()
    match = re.search(rf"export const {name}[^=]*=\s*(\{{.*?\n\}});", source, re.S)
    assert match, f"{name} not found in {_SHIFT_SETTINGS_TS.name}"

    body = match.group(1)
    body = re.sub(r"//[^\n]*", "", body)  # strip line comments
    body = re.sub(r",(\s*[}\]])", r"\1", body)  # strip trailing commas
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', body)  # quote keys
    body = body.replace("'", '"')
    return json.loads(body)


def test_apparatus_type_defaults_match():
    frontend = _object_literal("DEFAULT_APPARATUS_TYPE_POSITIONS")
    assert frontend == DEFAULT_APPARATUS_TYPE_DEFAULTS, (
        "shiftSettings.ts and scheduling_module_config_service.py disagree about "
        "apparatus staffing. The frontend copy is what a department gets offline "
        "and on a cold cache, and those seats are copied permanently into any "
        "template built from them."
    )


def test_resource_type_defaults_match():
    frontend = _object_literal("DEFAULT_RESOURCE_TYPE_POSITIONS")
    assert frontend == DEFAULT_RESOURCE_TYPE_DEFAULTS


def test_the_frontend_copy_is_the_full_fire_set():
    """It is the agency-blind fallback, and that is correct.

    The frontend has no notion of the organization's agency type, so its copy
    stays the full set — the narrowing happens server-side, where the type is
    known. Asserted so that a future frontend edit that "helpfully" drops the
    fire rigs is recognised as breaking the offline path for fire departments
    rather than as finishing this change.
    """
    frontend = _object_literal("DEFAULT_APPARATUS_TYPE_POSITIONS")
    for code in ("engine", "ladder", "tanker", "brush", "tower", "hazmat"):
        assert code in frontend
