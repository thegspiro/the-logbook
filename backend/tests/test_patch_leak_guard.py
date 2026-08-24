"""The leak guard's own coverage.

A guard nobody exercises is a guard that quietly stops working, and this one
only ever fires on a bug — so without these tests its first real report would
also be the first time the code ran.

The interleaving is reproduced against a throwaway module rather than by
leaking a patch for real: an actual leak inside this file would be caught by
the autouse fixture and fail the test that demonstrates it.
"""

import asyncio
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests import patch_leak_guard


def _victim_module() -> ModuleType:
    """A module-like target with one real attribute to patch."""
    module = ModuleType("tests._patch_leak_guard_victim")
    module.resolve = lambda: "real"
    sys.modules[module.__name__] = module
    return module


@pytest.fixture(autouse=True)
def _isolate_guard_state():
    """Keep these tests off the shared registry the real fixture reads."""
    saved = dict(patch_leak_guard._originals)
    patch_leak_guard.reset_for_testing()
    yield
    patch_leak_guard._originals.clear()
    patch_leak_guard._originals.update(saved)


class TestLeakDetection:
    def test_a_balanced_patch_is_not_reported(self):
        module = _victim_module()

        with patch.object(module, "resolve", MagicMock()):
            pass

        assert patch_leak_guard.find_leaks() == []
        assert module.resolve() == "real"

    def test_a_mock_left_installed_is_reported_and_reverted(self):
        module = _victim_module()
        original = module.resolve

        patch_leak_guard.record_patch(module, "resolve", original)
        module.resolve = MagicMock()

        assert patch_leak_guard.find_leaks() == [
            "tests._patch_leak_guard_victim.resolve"
        ]
        assert module.resolve is original, "the guard must restore what it reports"

    def test_reporting_is_not_repeated_once_the_value_is_restored(self):
        module = _victim_module()

        patch_leak_guard.record_patch(module, "resolve", module.resolve)
        module.resolve = AsyncMock()

        assert patch_leak_guard.find_leaks() != []
        assert patch_leak_guard.find_leaks() == []

    async def test_interleaved_patches_of_one_target_are_caught(self):
        """The exact shape that made the suite look flaky.

        Two coroutines hold the same patch at once. The second records the
        first's mock as its original, so when the first exits and puts the real
        value back, the second exit overwrites it with that mock again.

        The order matters: both must be open together *and* the first must exit
        first. Interleave them the other way and the restores happen to unwind
        cleanly, which is why this only ever bit under concurrency.
        """
        module = _victim_module()
        original = module.resolve
        both_open = asyncio.Event()
        first_exited = asyncio.Event()

        async def first():
            with patch.object(
                module, "resolve", AsyncMock(return_value=SimpleNamespace())
            ):
                await both_open.wait()
            first_exited.set()

        async def second():
            with patch.object(
                module, "resolve", AsyncMock(return_value=SimpleNamespace())
            ):
                both_open.set()
                await first_exited.wait()

        await asyncio.gather(first(), second())

        # Sanity: this is a real leak, not a contrived assertion.
        assert patch_leak_guard._is_mock(module.resolve)

        assert patch_leak_guard.find_leaks() == [
            "tests._patch_leak_guard_victim.resolve"
        ]
        assert module.resolve is original


class TestWhatIsTracked:
    def test_instance_targets_are_ignored(self):
        """An instance built in a test dies with it and cannot pollute."""
        instance = SimpleNamespace(resolve=lambda: "real")

        patch_leak_guard.record_patch(instance, "resolve", instance.resolve)
        instance.resolve = MagicMock()

        assert patch_leak_guard.find_leaks() == []

    def test_class_targets_are_tracked(self):
        """Classes outlive the test that patches them, so they do count."""

        class Service:
            def resolve(self):
                return "real"

        original = Service.resolve
        patch_leak_guard.record_patch(Service, "resolve", original)
        Service.resolve = MagicMock()

        assert patch_leak_guard.find_leaks() == ["Service.resolve"]
        assert Service.resolve is original

    def test_a_mock_is_never_recorded_as_the_original(self):
        """Otherwise the second interleaved enter would poison the recovery."""
        module = _victim_module()
        original = module.resolve
        first_mock = MagicMock()

        patch_leak_guard.record_patch(module, "resolve", original)
        patch_leak_guard.record_patch(module, "resolve", first_mock)

        module.resolve = MagicMock()
        patch_leak_guard.find_leaks()

        assert module.resolve is original


class TestGuardIsInstalled:
    def test_patch_enter_registers_its_target(self):
        """The wrapper is what connects real patches to the registry."""
        module = _victim_module()

        with patch.object(module, "resolve", MagicMock()):
            pass

        assert (id(module), "resolve") in patch_leak_guard._originals
