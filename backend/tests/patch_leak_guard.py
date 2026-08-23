"""Attribute a leaked ``unittest.mock`` patch to the test that leaked it.

``unittest.mock.patch`` is not safe against two patches of the *same* target
being open at once. Each ``__enter__`` records whatever it currently finds as
"the original", so interleaved enters record each other::

    A enters -> saves the real function, installs mock A
    B enters -> saves *mock A*, installs mock B
    A exits  -> restores the real function
    B exits  -> restores *mock A*      <- the module keeps a mock forever

That is not hypothetical. ``TestConcurrentShiftTemplateSubmission`` in
test_equipment_check_service.py ran two ``submit_check`` coroutines through
``asyncio.gather``, and each one entered the same
``patch("...equipment_check_service.resolve_apparatus_ref", ...)`` block. The
mock it left behind returned a ``SimpleNamespace`` with no ``full`` attribute,
so every later test reaching ``if ref.full is not None`` died with an
AttributeError — and since ``pytest-randomly`` reshuffles module order every
run, *which* tests those were changed run to run. The same commit passed and
failed on alternate CI runs for a day before the cause was found, because the
failure always surfaced in an innocent file far from the one that caused it.

This guard closes that gap. It records every module- and class-level target a
patch touches, and after each test checks those targets still hold a real
value. A leak fails the test that leaked it, names the attribute, and puts the
original back so the rest of the run stays trustworthy.

Only module and class targets are tracked. ``patch.object`` against an instance
built inside a test cannot outlive it, so it cannot pollute anything.
"""

from __future__ import annotations

import unittest.mock as mock_module
from types import ModuleType
from typing import Any

# (target, attribute) -> the pristine value, captured the first time anything
# patched it. Keyed by id() because modules and classes are unhashable only in
# theory but expensive to hash in practice, and because the target is held
# alongside the key anyway.
_originals: dict[tuple[int, str], tuple[Any, str, Any]] = {}

_installed = False


def _is_mock(value: Any) -> bool:
    """Every Mock/MagicMock/AsyncMock derives from NonCallableMock."""
    return isinstance(value, mock_module.NonCallableMock)


def _trackable(target: Any) -> bool:
    """Only targets that outlive the test can pollute another one."""
    return isinstance(target, (ModuleType, type))


def record_patch(target: Any, attribute: str, pre_patch_value: Any) -> None:
    """Note a patch, keeping the first non-mock value seen for this target.

    The "first non-mock" rule is what makes interleaved patches recoverable: the
    second concurrent enter reports the first one's mock as its original, and
    storing that would defeat the whole point.
    """
    if not _trackable(target):
        return
    key = (id(target), attribute)
    if key in _originals or _is_mock(pre_patch_value):
        return
    _originals[key] = (target, attribute, pre_patch_value)


def find_leaks() -> list[str]:
    """Return a description of every tracked target still holding a mock."""
    leaks = []
    for target, attribute, original in _originals.values():
        current = getattr(target, attribute, None)
        if not _is_mock(current):
            continue
        name = getattr(target, "__name__", repr(target))
        leaks.append(f"{name}.{attribute}")
        setattr(target, attribute, original)
    return sorted(leaks)


def install() -> None:
    """Wrap ``_patch.__enter__`` so every patch registers its target."""
    global _installed
    if _installed:
        return

    original_enter = mock_module._patch.__enter__

    def __enter__(self):  # noqa: N807 - matching the wrapped dunder
        result = original_enter(self)
        # _patch.__enter__ resolves the string target and stashes the value it
        # replaced on self.temp_original; __exit__ deletes the attribute again,
        # so it has to be read here.
        record_patch(self.target, self.attribute, getattr(self, "temp_original", None))
        return result

    mock_module._patch.__enter__ = __enter__
    _installed = True


def reset_for_testing() -> None:
    """Drop recorded state. For this guard's own tests only."""
    _originals.clear()
