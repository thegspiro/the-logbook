"""Reading QuickBooks Online's Account List report out of an upload.

The report is not a bare table — a title block sits above the header and a
footer line below the accounts — and Intuit has labelled its name column both
"Account" and "Full name". These pin what the parser takes from each shape.
"""

import io

import pytest
from openpyxl import Workbook

from app.utils.quickbooks_chart import ChartAccount, parse_chart_of_accounts

pytestmark = [pytest.mark.unit]

REPORT_CSV = (
    "QB Dept\r\n"
    "Account List\r\n"
    "\r\n"
    "Account,Type,Detail Type,Description,Balance\r\n"
    "Operating Checking,Bank,Checking,,1200.00\r\n"
    "Vehicle Expense,Expenses,Auto,,\r\n"
    "Vehicle Expense:Fuel,Expenses,Auto,,\r\n"
    "Training Expense,Expenses,Education,,\r\n"
    "\r\n"
    '"Saturday, Oct 18, 2026 07:06:12 PM GMT-04:00"\r\n'
)


def _xlsx(rows: list[list]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


class TestAccountListCsv:
    def test_reads_the_accounts_under_the_title_block(self):
        accounts = parse_chart_of_accounts(REPORT_CSV.encode(), "Account List.csv")

        assert accounts == [
            ChartAccount("Operating Checking", "Bank"),
            ChartAccount("Vehicle Expense", "Expenses"),
            ChartAccount("Vehicle Expense:Fuel", "Expenses"),
            ChartAccount("Training Expense", "Expenses"),
        ]

    def test_a_line_with_no_type_is_not_an_account(self):
        names = [
            a.name for a in parse_chart_of_accounts(REPORT_CSV.encode(), "report.CSV")
        ]

        assert not any("2026" in name for name in names)

    def test_a_repeated_name_is_listed_once(self):
        raw = "Account,Type\nCash,Bank\nCash,Bank\n".encode()

        assert parse_chart_of_accounts(raw, "a.csv") == [ChartAccount("Cash", "Bank")]

    def test_a_byte_order_mark_does_not_hide_the_header(self):
        raw = "﻿Account,Type\nCash,Bank\n".encode("utf-8")

        assert parse_chart_of_accounts(raw, "a.csv") == [ChartAccount("Cash", "Bank")]

    def test_a_list_without_a_type_column_takes_every_name(self):
        raw = "Name\nCash\nSupplies\n".encode()

        assert [a.name for a in parse_chart_of_accounts(raw, "a.csv")] == [
            "Cash",
            "Supplies",
        ]


class TestAccountListWorkbook:
    def test_the_full_name_wins_over_the_account_column(self):
        raw = _xlsx(
            [
                ["QB Dept"],
                ["Account List"],
                [],
                ["Account #", "Account", "Full name", "Type"],
                ["1000", "Fuel", "Vehicle Expense:Fuel", "Expenses"],
                ["1010", "Operating Checking", "Operating Checking", "Bank"],
            ]
        )

        assert parse_chart_of_accounts(raw, "Account List.xlsx") == [
            ChartAccount("Vehicle Expense:Fuel", "Expenses"),
            ChartAccount("Operating Checking", "Bank"),
        ]

    def test_a_file_that_is_not_a_workbook_is_refused(self):
        with pytest.raises(ValueError, match="Excel workbook"):
            parse_chart_of_accounts(b"not a zip", "chart.xlsx")


class TestRefusals:
    def test_another_file_type_is_refused(self):
        with pytest.raises(ValueError, match=r"\.xlsx or \.csv"):
            parse_chart_of_accounts(b"Account\nCash\n", "chart.pdf")

    def test_a_file_with_no_account_column_is_refused(self):
        with pytest.raises(ValueError, match="No account column"):
            parse_chart_of_accounts(b"Vendor,Balance\nAcme,1\n", "chart.csv")

    def test_a_header_with_no_accounts_under_it_is_refused(self):
        with pytest.raises(ValueError, match="no accounts"):
            parse_chart_of_accounts(b"Account,Type\n", "chart.csv")

    def test_an_overlong_name_is_refused(self):
        raw = ("Account,Type\n" + "x" * 256 + ",Bank\n").encode()

        with pytest.raises(ValueError, match="255"):
            parse_chart_of_accounts(raw, "chart.csv")
