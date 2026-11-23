"""``is_own_grant``: the one self-grant check behind leave, overrides and waivers."""

import uuid

import pytest

from app.utils.separation_of_duties import is_own_grant

pytestmark = [pytest.mark.unit]


def test_the_same_member_is_their_own_grant_across_id_types():
    member = uuid.uuid4()
    assert is_own_grant(member, str(member)) is True
    assert is_own_grant(str(member), member) is True


def test_another_member_is_not():
    assert is_own_grant("officer-1", "member-2") is False


@pytest.mark.parametrize(("granted_by", "member_id"), [(None, "m-1"), ("o-1", None)])
def test_a_missing_id_is_never_ones_own(granted_by, member_id):
    assert is_own_grant(granted_by, member_id) is False
