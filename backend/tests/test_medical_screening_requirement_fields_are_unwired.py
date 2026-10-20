"""`screening_requirements.grace_period_days` is stored and read by nothing in
the compliance calculation.

(`applies_to_roles` was the other half of this file until it was wired: a
requirement listing positions now applies only to members holding one of them.
That reader is covered by `test_medical_screening_requirement_positions.py`,
and the field's "Not enforced yet" notice is gone from the form.)

Pitfall #19: a setting whose only effect is being stored invites somebody to
believe it changes an outcome when it does not. The field has a labelled,
editable control on `ScreeningRequirementForm.tsx` — an officer configuring
"Grace Period (days past expiration)" gets a success toast and no change to
who `get_compliance_status` (`medical_screening_service.py`) marks
non-compliant: it applies a hard `expiration_date >= today` cutoff, never
consulting the field.

This is the same shape MS-09 pass 3 found already
fixed once, for a *different* table with the same field name
(`compliance_configs.grace_period_days`,
`tests/test_compliance_grace_period_is_unwired.py`) — same remedy applied
here: a UI notice rather than a silently-different compliance outcome on
every installation holding a non-default value (this column defaults to 30,
so that is not a rare opt-in).

Wiring it is a product decision (it changes who counts as non-compliant), so
this pass labels rather than wires. This test keeps the two halves honest: it
fails when a genuine reader appears in the compliance calculation without the
notice being removed, and it fails if the notice is removed while the gap
remains.
"""

import ast
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

_ROOT = Path(__file__).resolve().parents[2]
_SERVICE = _ROOT / "backend" / "app" / "services" / "medical_screening_service.py"
_FORM = (
    _ROOT
    / "frontend"
    / "src"
    / "modules"
    / "medical-screening"
    / "components"
    / "ScreeningRequirementForm.tsx"
)

#: The one legitimate site for each field: `create_requirement` reading the
#: incoming `ScreeningRequirementCreate` schema (bound to the name `data`) to
#: populate the new row. Any *other* attribute access of these names in this
#: file — in particular one reading from the ORM instance
#: (`requirement.grace_period_days`) inside `get_compliance_status` or
#: `get_expiring_soon` — is a reader and means the gap has been closed.
_FIELDS = {"grace_period_days"}
_KNOWN_WRITE_SITE_OBJECT_NAME = "data"


def _reader_sites() -> list:
    """Every `.<field>` access in the service file outside the known write."""
    source = _SERVICE.read_text(encoding="utf-8")
    tree = ast.parse(source)
    sites = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Attribute) and node.attr in _FIELDS):
            continue
        is_known_write = (
            isinstance(node.value, ast.Name)
            and node.value.id == _KNOWN_WRITE_SITE_OBJECT_NAME
        )
        if not is_known_write:
            sites.append(f"{node.attr}:{node.lineno}")
    return sites


def test_no_compliance_calculation_reads_grace_period():
    sites = _reader_sites()

    assert not sites, (
        "A reader for ScreeningRequirement.grace_period_days now exists in "
        f"medical_screening_service.py: {sites}. Remove the 'not enforced' "
        "notice from ScreeningRequirementForm.tsx and delete this test."
    )


@pytest.mark.parametrize(
    ("field_label", "notice_fragment"),
    [("Grace Period", "Not enforced")],
)
def test_the_form_says_the_field_is_not_enforced(field_label, notice_fragment):
    source = _FORM.read_text(encoding="utf-8")
    # Each field's block runs from its label text to the `</div>` closing the
    # wrapping field container (input + helper/notice paragraphs), the same
    # single-`</div>` scoping test_compliance_grace_period_is_unwired.py uses.
    block = re.search(rf"{re.escape(field_label)}(.*?)</div>", source, re.S)
    assert block, f"{field_label!r} field not found on ScreeningRequirementForm.tsx"

    assert notice_fragment in block.group(1), (
        f"The {field_label!r} field no longer tells the officer it has no "
        "effect on compliance, and no backend reader has appeared in "
        "medical_screening_service.py. One of the two has to be true."
    )
