"""A "monthly" compliance report is currently the annual one, relabelled.

`generate_report` takes `report_type="monthly"` and a month, builds the period
label, stores `period_month` — and then asks
`AnnualComplianceReportService.generate_annual_report(org, year=year)` for the
figures. Its own comment says "If monthly, filter/annotate the data"; only the
annotation happens. Two monthly reports for different months of the same year
therefore hold identical numbers, and the stored payload still calls itself
`annual_compliance`.

These tests pin that, so the fix — which needs a decision about what "compliant
in July" means for an annually-recurring requirement, not just a refactor —
changes something deliberate rather than sliding past review. See
`docs/KNOWN_LIMITATIONS.md`.

DB mocked; no MySQL.
"""

import inspect

from app.services.compliance_config_service import ComplianceReportService


def _source() -> str:
    return inspect.getsource(ComplianceReportService.generate_report)


def test_the_month_reaches_the_stored_row():
    """The label and the column are right; it is the figures that are not."""
    source = _source()
    assert 'period_month=month if report_type == "monthly" else None' in source
    assert 'period_label = datetime(year, month, 1).strftime("%B %Y")' in source


def test_the_figures_come_from_the_whole_year():
    """The defect, stated as an assertion.

    When the builder learns to take a range, this is the test that should fail.
    Replace it with one that asserts the month is passed through — do not
    delete it.
    """
    source = _source()
    assert "generate_annual_report(" in source
    assert "year=year" in source
    # No date range is threaded through today.
    assert "start_date=" not in source
    assert "month=month" not in source.split("generate_annual_report(")[1][:200]


def test_monthly_only_annotates():
    """`report_period` is added; nothing is filtered."""
    source = _source()
    monthly_branch = source.split('if report_type == "monthly" and month:')[-1]
    assert '"type": "monthly"' in monthly_branch
    assert "filter" not in monthly_branch.split("elapsed_ms")[0].lower()


def test_report_type_is_still_constrained_to_the_known_pair():
    """The CS-9 guard stays: this is persisted and interpolated into email."""
    source = _source()
    assert 'if report_type not in ("monthly", "annual"):' in source
