"""The shared report layout: every page footed and numbered "X of Y", table
headers repeated across pages, member text printed as typed and in full,
wide matrices banded rather than cut, and the document's own metadata set.

The equipment-check reports are the kit's first users, so the regressions
they carried — notes cut at 40/60 characters, a header row that appeared on
page one only — are asserted here through them.
"""

from io import BytesIO
from types import SimpleNamespace

import pytest
from pypdf import PdfReader
from reportlab.lib.units import inch

from app.services import equipment_check_pdf
from app.utils.pdf_report_kit import (
    CONFIDENTIAL_MEMBER_RECORDS,
    ReportMeta,
    bookmark,
    cell,
    column_bands,
    data_table,
    num,
    render_report,
)

pytestmark = pytest.mark.unit

ORG = SimpleNamespace(id="org-1", name="Oakville FD", timezone="UTC", logo=None)


def _pages(pdf: bytes) -> list[str]:
    return [
        " ".join((page.extract_text() or "").split())
        for page in PdfReader(BytesIO(pdf)).pages
    ]


def _long_table_report(rows: int = 120) -> bytes:
    meta = ReportMeta(
        "Hose Test Report",
        "Oakville FD",
        "2026-11-09 10:00 EST",
        generated_by="Pat O'Brien",
        parameters=[("Period", "2026-01-01 to 2026-06-30")],
    )

    def body(styles):
        return [
            data_table(
                ["Hose", "Length"],
                [[cell(f"Hose {i}"), num(f"{i * 10}")] for i in range(rows)],
                [meta.width - 1.0 * inch, 1.0 * inch],
                numeric_cols=(1,),
            )
        ]

    return render_report(meta, body)


def test_every_page_is_footed_and_numbered_of_the_total():
    pages = _pages(_long_table_report())
    assert len(pages) >= 3
    for number, text in enumerate(pages, start=1):
        assert f"Page {number} of {len(pages)}" in text
        assert "Oakville FD · Hose Test Report" in text
        assert "Generated: 2026-11-09 10:00 EST by Pat O'Brien" in text
        assert CONFIDENTIAL_MEMBER_RECORDS in text


def test_the_table_header_repeats_on_every_page():
    for text in _pages(_long_table_report()):
        assert "Hose Length" in text


def test_the_parameters_print_under_the_letterhead():
    first = _pages(_long_table_report(5))[0]
    assert "OAKVILLE FD" in first.upper()
    assert "HOSE TEST REPORT" in first
    assert "Period: 2026-01-01 to 2026-06-30" in first


def test_document_metadata_is_set():
    reader = PdfReader(BytesIO(_long_table_report(5)))
    info = reader.metadata
    assert info is not None
    assert info.title == "Hose Test Report"
    assert info.author == "Oakville FD"
    assert reader.trailer["/Root"]["/Lang"] == "en-US"
    assert reader.trailer["/Root"]["/ViewerPreferences"]["/DisplayDocTitle"]


def test_bookmarks_become_outline_entries():
    meta = ReportMeta("Bundle", "Oakville FD", "now")

    def body(styles):
        return [bookmark("Alpha", "a"), cell("one"), bookmark("Beta", "b")]

    outline = PdfReader(BytesIO(render_report(meta, body))).outline
    assert [entry.title for entry in outline] == ["Alpha", "Beta"]


def test_cell_text_prints_as_typed_and_cannot_inject_markup():
    meta = ReportMeta("Escaping", "Oakville FD", "now", confidentiality=None)
    typed = "O'Brien & Sons <img src='/etc/passwd'/> \"quoted\""

    def body(styles):
        return [data_table(["Name"], [[cell(typed)]], [meta.width])]

    text = _pages(render_report(meta, body))[0]
    assert typed in text
    assert "&amp;" not in text
    assert "&#x27;" not in text


def test_column_bands_cover_every_column_exactly_once():
    bands = column_bands(14, available=600, fixed=240, column_width=70)
    assert bands == [(0, 5), (5, 10), (10, 14)]
    assert column_bands(0, 600, 240, 70) == [(0, 0)]
    # A fixed block wider than the page still gets one column per band.
    assert column_bands(3, 100, 200, 70) == [(0, 1), (1, 2), (2, 3)]


def test_equipment_failure_notes_print_in_full():
    note = (
        "Pump panel pressure gauge reads 20 psi high at idle; replaced the "
        "gasket and re-tested twice, still drifting — tagged out of service."
    )
    pdf = equipment_check_pdf.generate_failure_log_pdf(
        {
            "total": 1,
            "items": [
                {
                    "checked_at": "2026-10-06T12:00:00+00:00",
                    "apparatus_name": "Engine 1",
                    "compartment_name": "Pump panel",
                    "item_name": "Pressure gauge",
                    "checked_by_name": "Sam Lee",
                    "notes": note,
                }
            ],
        },
        organization=ORG,
        generated_by="Jordan Captain",
    )
    text = " ".join(_pages(pdf))
    assert note in text
    assert "Generated:" in text
    assert "by Jordan Captain" in text


def test_equipment_check_detail_header_repeats_and_notes_are_whole():
    note = "Seal cracked along the lower edge and must be replaced before use"
    items = [
        {
            "item_name": f"Item {i}",
            "compartment_name": "Driver side 1",
            "check_type": "pass_fail",
            "status": "pass",
            "notes": note if i == 0 else "",
        }
        for i in range(90)
    ]
    pdf = equipment_check_pdf.generate_check_detail_pdf(
        {"overall_status": "pass", "items": items, "total_items": 90},
        organization=ORG,
    )
    pages = _pages(pdf)
    assert len(pages) >= 2
    assert note in " ".join(pages)
    for text in pages:
        assert "Item Type Status Count Notes" in text
