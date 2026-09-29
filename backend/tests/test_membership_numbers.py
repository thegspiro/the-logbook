"""The membership number pattern: validation, formatting, and the period year.

Pure functions, no database. The generator's use of them -- counters, yearly
reset, reservations -- is covered by ``test_membership_id_generation.py``.
"""

from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.organization import MembershipIdSettings
from app.utils.membership_numbers import (
    format_membership_number,
    period_year,
    uses_year,
    validate_pattern,
)

pytestmark = pytest.mark.unit


class TestFormatting:
    @pytest.mark.parametrize(
        ("pattern", "prefix", "padding", "number", "year", "expected"),
        [
            # The default reproduces what was generated before patterns existed.
            ("{PREFIX}{SEQ}", "FD-", 4, 1, 2026, "FD-0001"),
            ("{PREFIX}{SEQ}", "", 4, 150, 2026, "0150"),
            ("{YYYY}-{SEQ}", "", 3, 14, 2026, "2026-014"),
            ("{YY}{SEQ}", "", 3, 7, 2026, "26007"),
            ("{SEQ}", "", 1, 142, 2026, "142"),
            ("Station 4/{SEQ}", "", 2, 9, 2026, "Station 4/09"),
            # Padding is a minimum, never a truncation.
            ("{SEQ}", "", 2, 12345, 2026, "12345"),
            ("{YY}-{SEQ}", "", 2, 3, 2009, "09-03"),
        ],
    )
    def test_renders(self, pattern, prefix, padding, number, year, expected):
        assert (
            format_membership_number(
                pattern, prefix=prefix, padding=padding, number=number, year=year
            )
            == expected
        )


class TestValidation:
    @pytest.mark.parametrize(
        "pattern", ["{PREFIX}{SEQ}", "{YYYY}-{SEQ}", "{SEQ}", "FD #{SEQ}.{YY}"]
    )
    def test_accepts(self, pattern):
        validate_pattern(pattern)

    @pytest.mark.parametrize(
        ("pattern", "message"),
        [
            ("", "cannot be empty"),
            ("{PREFIX}", "{SEQ} exactly once"),
            ("{SEQ}-{SEQ}", "{SEQ} exactly once"),
            ("{SEQ}{MONTH}", "Unknown token {MONTH}"),
            ("{seq}", "Unknown token {seq}"),
            ("{SEQ}{", "letters, digits"),
            ("FD:{SEQ}", "letters, digits"),
            ("X" * 41 + "{SEQ}", "at most 40"),
        ],
    )
    def test_refuses(self, pattern, message):
        with pytest.raises(ValueError, match=message.replace("{", r"\{")):
            validate_pattern(pattern)

    def test_uses_year(self):
        assert uses_year("{YYYY}-{SEQ}")
        assert uses_year("{YY}{SEQ}")
        assert not uses_year("{PREFIX}{SEQ}")


class TestPeriodYear:
    def _year(self, today, basis="fiscal", month=7, label="end"):
        return period_year(
            today,
            year_basis=basis,
            fiscal_year_start_month=month,
            fiscal_year_label=label,
        )

    def test_calendar_year_ignores_the_fiscal_settings(self):
        assert self._year(date(2026, 9, 29), basis="calendar") == 2026

    def test_fiscal_year_named_by_the_year_it_ends(self):
        # July 2026 - June 2027 is FY2027.
        assert self._year(date(2026, 7, 1)) == 2027
        assert self._year(date(2027, 6, 30)) == 2027
        assert self._year(date(2026, 6, 30)) == 2026

    def test_fiscal_year_named_by_the_year_it_starts(self):
        assert self._year(date(2026, 7, 1), label="start") == 2026
        assert self._year(date(2027, 6, 30), label="start") == 2026
        assert self._year(date(2026, 6, 30), label="start") == 2025

    def test_a_january_fiscal_year_is_the_calendar_year(self):
        # Neither label can disagree with the calendar when nothing spans two
        # calendar years.
        assert self._year(date(2026, 3, 1), month=1, label="end") == 2026
        assert self._year(date(2026, 3, 1), month=1, label="start") == 2026


class TestSettingsSchema:
    def test_defaults_reproduce_the_original_format(self):
        s = MembershipIdSettings()
        assert (s.pattern, s.padding, s.reset_yearly) == ("{PREFIX}{SEQ}", 4, False)

    def test_settings_stored_before_patterns_existed_still_load(self):
        s = MembershipIdSettings.model_validate(
            {"enabled": True, "auto_generate": True, "prefix": "FD-", "next_number": 9}
        )
        assert s.pattern == "{PREFIX}{SEQ}"
        assert s.start_number == 1

    def test_yearly_reset_needs_a_year_in_the_pattern(self):
        with pytest.raises(ValidationError, match="needs {YYYY} or {YY}"):
            MembershipIdSettings(pattern="{PREFIX}{SEQ}", reset_yearly=True)
        MembershipIdSettings(pattern="{YYYY}-{SEQ}", reset_yearly=True)

    def test_a_number_that_would_not_fit_the_column_is_refused(self):
        # 24 literal + 10 prefix + a 20-digit counter = 54 characters.
        with pytest.raises(ValidationError, match="the limit is 50"):
            MembershipIdSettings(
                pattern="ABCDEFGHIJKLMNOPQRSTUVWX{PREFIX}{SEQ}",
                prefix="Z" * 10,
                next_number=10**19,
            )

    def test_an_unknown_year_basis_is_refused(self):
        with pytest.raises(ValidationError):
            MembershipIdSettings(year_basis="lunar")
