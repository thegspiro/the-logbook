"""`compliance_configs.grace_period_days` is stored and read by nothing.

Pitfall #19: a setting whose only effect is being stored invites somebody to
believe a deadline is being extended when it is not. Its siblings on the same
screen are wired — `at_risk_threshold` is read by
`admin_hours_service`, `include_current_month` by `competency_matrix_service`
— and this one is not, so an officer setting it gets a success toast and no
change in who counts as non-compliant.

Removing it would discard values departments have already saved, and wiring it
means deciding what a grace period *means* for compliance — which changes who
is non-compliant on every installation holding a nonzero value. So the screen
says so instead, and this test keeps the two halves honest: it fails when a
reader appears (delete the notice and this file), and it fails if the notice
is removed while the gap remains.
"""

import ast
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

_ROOT = Path(__file__).resolve().parents[2]
_APP = _ROOT / "backend" / "app"
_CONFIG_PAGE = (
    _ROOT / "frontend" / "src" / "pages" / "ComplianceRequirementsConfigPage.tsx"
)
_FIELD = "grace_period_days"

#: Files that reference a *different* table's own `grace_period_days` column
#: of the same name, so this sweep (scoped to `compliance_configs`) doesn't
#: mistake that unrelated field for a reader of this one.
_OTHER_OWNERS = {
    # TrainingPathway.grace_period_days — read by training_enhancement_service.py.
    "app/services/training_enhancement_service.py",
    # ScreeningRequirement.grace_period_days — a distinct, *separately* unwired
    # column (this file's own write-only site, not a reader of either table).
    # See test_medical_screening_requirement_fields_are_unwired.py.
    "app/services/medical_screening_service.py",
}


def _reader_sites() -> list:
    """Every attribute read of `.grace_period_days` outside schemas/models."""
    sites = []
    for path in sorted(_APP.rglob("*.py")):
        rel = str(path.relative_to(_ROOT / "backend"))
        if rel.startswith(("app/schemas/", "app/models/")) or rel in _OTHER_OWNERS:
            continue
        source = path.read_text(encoding="utf-8")
        if _FIELD not in source:
            continue
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Attribute) and node.attr == _FIELD:
                sites.append(f"{rel}:{node.lineno}")
    return sites


def test_no_compliance_calculation_reads_the_grace_period():
    sites = _reader_sites()

    assert not sites, (
        "A reader for compliance_configs.grace_period_days now exists: "
        f"{sites}. Remove the 'Not in effect yet' notice from "
        "ComplianceRequirementsConfigPage.tsx and delete this test."
    )


def test_the_screen_says_the_setting_is_not_in_effect():
    source = _CONFIG_PAGE.read_text(encoding="utf-8")
    grace_block = re.search(r"Grace Period \(days\)(.*?)</div>", source, re.S)
    assert grace_block, "Grace Period field not found on the config screen"

    assert "Not in effect yet" in grace_block.group(1), (
        "The Grace Period field no longer tells the officer it does nothing, "
        "and no backend reader has appeared. One of the two has to be true."
    )
