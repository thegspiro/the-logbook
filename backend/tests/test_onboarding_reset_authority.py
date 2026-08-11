"""Security tests for destructive onboarding-reset authority selection."""

from types import SimpleNamespace

from app.utils.onboarding_security import find_system_owner


def _user(user_id: str, *permission_sets: list[str]):
    return SimpleNamespace(
        id=user_id,
        positions=[
            SimpleNamespace(permissions=permissions) for permissions in permission_sets
        ],
    )


def test_finds_wildcard_owner_instead_of_first_user():
    ordinary = _user("ordinary", ["users.read"])
    owner = _user("owner", ["members.read"], ["*"])

    assert find_system_owner([ordinary, owner]) is owner


def test_returns_none_when_owner_grant_is_missing():
    users = [_user("first", ["users.read"]), _user("second", [])]

    assert find_system_owner(users) is None
