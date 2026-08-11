"""Authorization helpers for destructive onboarding operations."""

from collections.abc import Iterable
from typing import TypeVar

T = TypeVar("T")


def find_system_owner(users: Iterable[T]) -> T | None:
    """Return the account holding the setup-created wildcard position."""
    return next(
        (
            user
            for user in users
            if any(
                "*" in (position.permissions or [])
                for position in getattr(user, "positions", [])
            )
        ),
        None,
    )
