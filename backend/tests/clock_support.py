"""Read a test module's clock constants as each test starts, not at import.

A module-level ``TODAY = date.today()`` or ``NOW = datetime.now(timezone.utc)``
is evaluated once, when pytest imports the file during collection. The tests
that use it run minutes later: the integration job takes more than twenty, so
by then ``NOW`` is that much in the past, and a run that crosses midnight hands
every later test a ``TODAY`` that is yesterday's date while the code under test
reads today's. Both fail only at some times of day, which is the hardest kind
of failure to recognise.

So a module defines its clock values in one function, takes its module-level
names from it, and registers it here::

    def _clock() -> dict[str, datetime]:
        now = datetime.now(timezone.utc)
        return {"NOW": now, "RECENTLY": now - timedelta(minutes=30)}


    NOW, RECENTLY = _clock().values()
    _reread_clock = reread_each_test(__name__, _clock)

The returned fixture is autouse and applies to the module that assigns it, so
every test in the module starts with values read at that moment. Within one
test they stay fixed, so comparisons against ``NOW`` still mean what they did.
"""

from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from typing import Any

import pytest


def reread_each_test(module_name: str, clock: Callable[[], Mapping[str, Any]]) -> Any:
    """An autouse fixture that rebinds ``clock()``'s names on the module."""

    @pytest.fixture(autouse=True)
    def _reread_clock() -> None:
        module = sys.modules[module_name]
        for name, value in clock().items():
            # A name the module never defined is a typo in its clock, which
            # would otherwise leave the import-time value silently in place.
            if not hasattr(module, name):
                raise AttributeError(
                    f"{module_name} has no {name} for its clock to refresh"
                )
            setattr(module, name, value)

    return _reread_clock
