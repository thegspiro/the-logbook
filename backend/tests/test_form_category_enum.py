"""FormCategory is lowercase and the API tolerates legacy Title-case input.

FormCategory was the lone (str, Enum) using Title-case values, out of step
with every other enum in the codebase. After normalizing it to lowercase,
two things must hold:

1. The enum values themselves are lowercase (so stored data / API contract
   match the rest of the system).
2. Schemas still accept legacy Title-case input ("Operations") and normalize
   it, so old clients and already-issued requests don't break.
"""

from app.models.forms import FormCategory
from app.schemas.forms import FormBase, FormUpdate


def test_form_category_values_are_lowercase():
    for member in FormCategory:
        assert member.value == member.value.lower()
    assert FormCategory.OPERATIONS.value == "operations"
    assert FormCategory.SAFETY.value == "safety"


def test_form_base_normalizes_legacy_titlecase_category():
    form = FormBase(name="Pre-trip", category="Operations")
    assert form.category == "operations"
    # A valid enum value round-trips unchanged.
    assert FormCategory(form.category) is FormCategory.OPERATIONS


def test_form_base_default_category_is_lowercase():
    form = FormBase(name="Default")
    assert form.category == "operations"


def test_form_update_normalizes_legacy_titlecase_category():
    update = FormUpdate(category="Safety")
    assert update.category == "safety"


def test_form_update_category_none_is_preserved():
    update = FormUpdate(name="Renamed")
    assert update.category is None
