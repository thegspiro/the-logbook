"""
An update cannot blank a member's first or last name (forms review F-1).

``/account`` sent an emptied First Name as ``""``, ``UserUpdate`` accepted it,
and the member was left with no name on the roster, in reports and on legal
records, behind a "Profile saved" toast. ``AdminUserCreate`` already requires
both names; the update path now holds them to the same rule. Leaving the key
out still means "keep the current name".
"""

import pytest
from pydantic import ValidationError

from app.schemas.user import UserUpdate

pytestmark = [pytest.mark.unit]


@pytest.mark.parametrize("field", ["first_name", "last_name"])
@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_a_blank_name_is_refused(field, value):
    with pytest.raises(ValidationError) as exc:
        UserUpdate(**{field: value})
    assert exc.value.errors()[0]["loc"] == (field,)


@pytest.mark.parametrize("field", ["first_name", "last_name"])
def test_an_explicit_null_is_refused(field):
    with pytest.raises(ValidationError) as exc:
        UserUpdate(**{field: None})
    assert exc.value.errors()[0]["loc"] == (field,)


@pytest.mark.parametrize("field", ["first_name", "last_name"])
def test_surrounding_whitespace_is_trimmed(field):
    update = UserUpdate(**{field: "  Jordan  "})
    assert getattr(update, field) == "Jordan"


def test_omitting_the_names_leaves_them_alone():
    update = UserUpdate(middle_name="Quinn")
    dumped = update.model_dump(exclude_unset=True)
    assert "first_name" not in dumped
    assert "last_name" not in dumped
