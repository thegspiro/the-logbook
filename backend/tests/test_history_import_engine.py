"""History import rules, without a database.

How a roster file is read, how a historian's partial dates are read, what makes
a row unimportable, and what each row is suggested to be.
"""

from datetime import date

import pytest

from app.models.history import DatePrecision
from app.services import history_import_engine as engine

pytestmark = pytest.mark.unit


class TestReadingTheFile:
    def test_the_template_headers_are_all_recognized(self):
        mapping = engine.detect_column_mapping(engine.TEMPLATE_HEADERS)
        assert set(mapping) == set(engine.FIELDS)

    def test_other_spellings_of_a_header_are_recognized(self):
        mapping = engine.detect_column_mapping(
            ["Surname", "Given Name", "DOB", "Date Joined", "LODD", "Rank"]
        )
        assert mapping == {
            "last_name": "Surname",
            "first_name": "Given Name",
            "birth_date": "DOB",
            "joined": "Date Joined",
            "line_of_duty_death": "LODD",
            "titles": "Rank",
        }

    def test_a_name_column_is_read_only_without_a_last_name_column(self):
        assert engine.FULL_NAME in engine.detect_column_mapping(["Name", "Badge"])
        assert engine.FULL_NAME not in engine.detect_column_mapping(
            ["Name", "Last Name"]
        )

    def test_rows_keep_their_line_numbers_and_blank_lines_are_skipped(self):
        headers, rows = engine.read_csv("Last Name,First Name\nSmith,John\n,\nJones,\n")
        assert headers == ["Last Name", "First Name"]
        assert [line for line, _ in rows] == [2, 4]
        assert rows[1][1] == {"Last Name": "Jones", "First Name": ""}

    @pytest.mark.parametrize(
        ("text", "message"),
        [
            ("", "empty"),
            ("Badge,Rank\n1,Chief\n", "No column names the person"),
            ("Last Name,last name\nA,B\n", "repeats a column name"),
            ("Last Name\n", "no people"),
        ],
    )
    def test_a_file_that_cannot_be_imported_faithfully_is_refused(self, text, message):
        with pytest.raises(ValueError, match=message):
            engine.read_csv(text)

    def test_more_than_the_row_cap_is_refused(self):
        body = "".join(f"Name{i}\n" for i in range(engine.MAX_IMPORT_ROWS + 1))
        with pytest.raises(ValueError, match="more than 5,000 people"):
            engine.read_csv("Last Name\n" + body)

    def test_a_windows_export_still_decodes(self):
        assert engine.decode_upload("Müller".encode("cp1252")) == "Müller"
        assert engine.decode_upload("﻿Last Name".encode("utf-8")) == "Last Name"


class TestNames:
    @pytest.mark.parametrize(
        ("full", "parts"),
        [
            (
                "Smith, John R.",
                {"last_name": "Smith", "first_name": "John", "middle_name": "R."},
            ),
            (
                "John Smith Jr.",
                {"last_name": "Smith", "first_name": "John", "suffix": "Jr."},
            ),
            (
                "Smith, John Jr.",
                {"last_name": "Smith", "first_name": "John", "suffix": "Jr."},
            ),
            ("Smith", {"last_name": "Smith"}),
        ],
    )
    def test_a_full_name_is_split(self, full, parts):
        assert engine.split_full_name(full) == parts

    def test_an_edit_overrides_the_file_and_an_empty_edit_clears_it(self):
        values = engine.effective_values(
            {"last_name": "Smiht", "nickname": "Jack"},
            {"last_name": "Smith", "nickname": ""},
        )
        assert values == {"last_name": "Smith"}

    def test_first_names_are_compatible_on_an_initial_or_a_blank(self):
        assert engine.first_names_compatible("J.", "John")
        assert engine.first_names_compatible(None, "John")
        assert not engine.first_names_compatible("James", "Robert")


class TestPartialDates:
    @pytest.mark.parametrize(
        ("text", "value", "precision"),
        [
            ("1952", date(1952, 1, 1), DatePrecision.YEAR),
            ("1952-06", date(1952, 6, 1), DatePrecision.MONTH),
            ("June 1952", date(1952, 6, 1), DatePrecision.MONTH),
            ("6/1952", date(1952, 6, 1), DatePrecision.MONTH),
            ("1952-06-14", date(1952, 6, 14), DatePrecision.DAY),
            ("6/14/1952", date(1952, 6, 14), DatePrecision.DAY),
            ("June 14, 1952", date(1952, 6, 14), DatePrecision.DAY),
            ("14 June 1952", date(1952, 6, 14), DatePrecision.DAY),
        ],
    )
    def test_the_ways_a_historian_writes_a_date(self, text, value, precision):
        parsed = engine.parse_partial_date(text, allow_present=False)
        assert (parsed.value, parsed.precision, parsed.circa) == (
            value,
            precision,
            False,
        )

    @pytest.mark.parametrize("text", ["c. 1950", "ca. 1950", "circa 1950", "~1950"])
    def test_an_approximate_date_says_so(self, text):
        parsed = engine.parse_partial_date(text, allow_present=False)
        assert parsed.value == date(1950, 1, 1)
        assert parsed.circa

    def test_present_is_ongoing_only_where_allowed(self):
        assert engine.parse_partial_date("present", allow_present=True).ongoing
        refused = engine.parse_partial_date("present", allow_present=False)
        assert refused.error is not None

    @pytest.mark.parametrize("text", ["14/6/1952", "1950s", "2/30/1952", "1650"])
    def test_a_date_that_would_be_a_guess_is_reported(self, text):
        assert engine.parse_partial_date(text, allow_present=False).error

    def test_a_blank_date_is_empty_rather_than_wrong(self):
        assert engine.parse_partial_date("  ", allow_present=True).empty


class TestOneRow:
    def test_a_clean_row(self):
        row = engine.parse_row(
            {
                "last_name": "Smith",
                "joined": "1951",
                "left": "present",
                "titles": "Firefighter; Captain; firefighter",
                "line_of_duty_death": "yes",
            }
        )
        assert row.issues == []
        assert row.left.ongoing
        assert row.titles == ["Firefighter", "Captain"]
        assert row.line_of_duty_death
        assert row.has_period

    def test_the_problems_are_named(self):
        row = engine.parse_row(
            {
                "joined": "1960",
                "left": "1950",
                "birth_date": "someday",
                "line_of_duty_death": "maybe",
            }
        )
        assert "No last name" in row.issues
        assert "Left is before Joined" in row.issues
        assert any(i.startswith('Birth date "someday"') for i in row.issues)
        assert any("should be yes or no" in i for i in row.issues)

    def test_a_row_with_no_dates_or_titles_adds_no_period(self):
        assert not engine.parse_row({"last_name": "Smith"}).has_period


def _person(pid, last, first=None, badge=None, spans=(), user_id=None):
    return engine.ExistingPerson(
        id=pid,
        last_name=last,
        first_name=first,
        badge_number=badge,
        spans=tuple(spans),
        user_id=user_id,
    )


class TestSuggestions:
    def test_the_same_badge_is_a_strong_match(self):
        row = engine.parse_row(
            {"last_name": "Smith", "first_name": "John", "badge_number": "14"}
        )
        out = engine.suggest(row, [_person("p1", "Smith", "J.", "14")], [], {})
        assert out == [{"kind": "match", "id": "p1", "strength": "strong"}]

    def test_overlapping_years_are_a_weak_match_and_far_apart_none(self):
        row = engine.parse_row(
            {
                "last_name": "Smith",
                "first_name": "John",
                "joined": "1950",
                "left": "1960",
            }
        )
        near = _person("near", "Smith", "John", spans=[(1955, 1970)])
        far = _person("far", "Smith", "John", spans=[(1990, 2000)])
        out = engine.suggest(row, [near, far], [], {})
        assert out == [{"kind": "match", "id": "near", "strength": "weak"}]

    def test_a_reused_badge_on_a_different_person_is_not_a_match(self):
        row = engine.parse_row({"last_name": "Jones", "badge_number": "14"})
        assert engine.suggest(row, [_person("p1", "Smith", badge="14")], [], {}) == []

    def test_an_account_is_suggested_to_map(self):
        row = engine.parse_row({"last_name": "Smith", "first_name": "Jack"})
        account = engine.Account("u1", "Smith", "John", "Jack")
        assert engine.suggest(row, [], [account], {}) == [
            {"kind": "map", "id": "u1", "strength": "strong"}
        ]

    def test_an_account_with_a_record_suggests_that_record_instead(self):
        row = engine.parse_row({"last_name": "Smith", "first_name": "John"})
        account = engine.Account("u1", "Smith", "John", None)
        out = engine.suggest(row, [], [account], {"u1": "p9"})
        assert out == [{"kind": "match", "id": "p9", "strength": "strong"}]

    def test_two_good_candidates_are_both_offered(self):
        row = engine.parse_row({"last_name": "Smith", "first_name": "John"})
        out = engine.suggest(
            row, [_person("a", "Smith", "John"), _person("b", "Smith", "J.")], [], {}
        )
        assert {s["id"] for s in out} == {"a", "b"}

    def test_a_repeat_in_the_file_points_at_its_first_line(self):
        rows = [
            engine.FileRow("r1", 2, "Smith", "John", "14"),
            engine.FileRow("r2", 3, "Smith", "John", None),
            engine.FileRow("r3", 4, "Smith", "John", "15"),
            engine.FileRow("r4", 5, "Smith", "Jane", None),
        ]
        assert engine.same_person_in_file(rows) == {"r2": "r1"}
