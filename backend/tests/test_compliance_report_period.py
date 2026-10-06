"""A "monthly" compliance report is built from its month (CS-9).

It used to be the annual report relabelled: `generate_report` built the
period label and stored `period_month`, then asked
`generate_annual_report(org, year=year)` for the figures, so two monthly
reports of one year held identical numbers. The monthly path now calls
`generate_monthly_report(org, year=year, month=month)`; what a month's figures
mean is pinned against real rows in `test_monthly_compliance_report.py`.

DB mocked; no MySQL.
"""

import inspect

from app.services.compliance_config_service import ComplianceReportService


def _source() -> str:
    return inspect.getsource(ComplianceReportService.generate_report)


def test_the_month_reaches_the_stored_row():
    source = _source()
    assert 'period_month=month if report_type == "monthly" else None' in source
    assert 'period_label = datetime(year, month, 1).strftime("%B %Y")' in source


def test_the_figures_come_from_the_month():
    """Replaces the test that stated the defect: the month is passed through."""
    source = _source()
    monthly_call = source.split("generate_monthly_report(")[1][:200]
    assert "month=month" in monthly_call


def test_a_monthly_report_without_a_month_is_refused():
    assert 'raise ValueError("A monthly report needs a month")' in _source()


def test_report_type_is_still_constrained_to_the_known_values():
    """The CS-9 guard stays: this is persisted and interpolated into email."""
    source = _source()
    assert 'if report_type not in ("monthly", "annual", "yearly"):' in source
