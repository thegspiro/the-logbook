"""
Tests for the formula-injection-safe CSV writers (``app.utils.csv_export``).

Verifies that cells beginning with a spreadsheet formula-trigger character are
neutralized with a leading apostrophe for both the list-based SafeCsvWriter and
the dict-based SafeDictCsvWriter (used by the NFIRS state export).
"""

import csv
import io

from app.utils.csv_export import SafeCsvWriter, SafeDictCsvWriter, csv_safe_cell


def test_csv_safe_cell_neutralizes_formula_prefixes():
    for payload in ("=1+1", "+1", "-1", "@SUM(A1)", "\ttab", "\rcr"):
        assert csv_safe_cell(payload) == "'" + payload
    # Ordinary values pass through untouched.
    assert csv_safe_cell("John Doe") == "John Doe"
    assert csv_safe_cell(42) == 42
    assert csv_safe_cell(None) is None


def test_safe_csv_writer_sanitizes_rows():
    out = io.StringIO()
    writer = SafeCsvWriter(out)
    writer.writerow(["=cmd|' /C calc'!A1", "safe", 3])
    parsed = next(csv.reader(io.StringIO(out.getvalue())))
    assert parsed[0].startswith("'=")
    assert parsed[1] == "safe"


def test_safe_dict_csv_writer_sanitizes_values():
    out = io.StringIO()
    writer = SafeDictCsvWriter(out, fieldnames=["Incident_Number", "Station"])
    writer.writeheader()
    writer.writerow({"Incident_Number": '=HYPERLINK("http://evil")', "Station": "1"})

    rows = list(csv.DictReader(io.StringIO(out.getvalue())))
    assert rows[0]["Incident_Number"].startswith("'=HYPERLINK")
    # Non-formula value is unchanged.
    assert rows[0]["Station"] == "1"


def test_safe_dict_csv_writer_header_is_trusted():
    out = io.StringIO()
    writer = SafeDictCsvWriter(out, fieldnames=["Name", "Status"])
    writer.writeheader()
    header = next(csv.reader(io.StringIO(out.getvalue())))
    assert header == ["Name", "Status"]
