"""The publishing switches: every one reads as off unless it is literally True."""

import itertools

import pytest

from app.utils.minutes_settings import (
    EXECUTIVE_LIBRARY_FLAG,
    EXECUTIVE_PUBLIC_FLAG,
    PUBLIC_POSTING_FLAG,
    minutes_publishing_settings_in,
)

pytestmark = pytest.mark.unit


def _read(**flags):
    return minutes_publishing_settings_in({"minutes": flags})


class TestFailClosed:
    @pytest.mark.parametrize(
        "settings",
        [None, {}, [], "x", {"minutes": None}, {"minutes": []}, {"minutes": {}}],
    )
    def test_missing_or_malformed_reads_as_everything_off(self, settings):
        read = minutes_publishing_settings_in(settings)
        assert not read.public_posting
        assert not read.library_allowed(True)
        assert not read.public_allowed(False)

    @pytest.mark.parametrize("value", ["true", "True", 1, "yes", [True], {"a": 1}])
    def test_only_a_literal_true_turns_a_switch_on(self, value):
        read = _read(
            **{
                PUBLIC_POSTING_FLAG: value,
                EXECUTIVE_LIBRARY_FLAG: value,
                EXECUTIVE_PUBLIC_FLAG: value,
            }
        )
        assert not read.public_posting
        assert not read.executive_library
        assert not read.executive_public


class TestMatrix:
    @pytest.mark.parametrize(
        ("public", "exec_library", "exec_public"),
        list(itertools.product([False, True], repeat=3)),
    )
    def test_every_combination(self, public, exec_library, exec_public):
        read = _read(
            **{
                PUBLIC_POSTING_FLAG: public,
                EXECUTIVE_LIBRARY_FLAG: exec_library,
                EXECUTIVE_PUBLIC_FLAG: exec_public,
            }
        )
        assert read.library_allowed(False) is True
        assert read.library_allowed(True) is exec_library
        assert read.public_allowed(False) is public
        assert read.public_allowed(True) is (public and exec_library and exec_public)
