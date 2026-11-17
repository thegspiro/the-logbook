"""Table cells read cleanly when printed.

Three things a reader noticed on paper:

* an email address cut mid-word where the column ended
  ("example-departme / nt.org") — it now breaks at its ``@`` or a dot;
* a short column header such as "Member #" wrapped onto two lines;
* a band of a wide matrix (call types, training requirements) that ran onto
  the next page lost the label saying which band it was.
"""

from io import BytesIO
from typing import List

import pytest
from pypdf import PdfReader

from app.services.report_export import render_report_pdf
from app.services.report_tables import build_export_table
from app.utils.pdf_fonts import BODY_FONT
from app.utils.pdf_report_kit import fit_token
from tests import test_pdf_print_safety as safety

pytestmark = pytest.mark.unit

EMAIL = "alexandria10@example-department.org"


def _render(report_type: str, data) -> bytes:
    return render_report_pdf(
        build_export_table(report_type, data),
        org_name="Falls Church Volunteer Fire Department",
        logo=None,
        generated_at="2026-11-16 10:00 EST",
        generated_by="Chief Ames",
        parameters=[("Period", "2026-01-01 to 2026-06-30")],
    )


def _lines(pdf: bytes) -> List[str]:
    lines: List[str] = []
    for page in PdfReader(BytesIO(pdf)).pages:
        lines += page.extract_text().splitlines()
    return lines


def test_a_long_address_breaks_after_its_punctuation():
    markup = fit_token(EMAIL, 70, BODY_FONT, 8.5)
    pieces = markup.split("<br/>")
    assert len(pieces) > 1
    assert "".join(pieces) == EMAIL
    for piece in pieces[:-1]:
        assert piece[-1] in "@.-", pieces


def test_a_value_that_fits_is_left_alone_and_escaped():
    assert fit_token("A & B", 500, BODY_FONT, 8.5) == "A &amp; B"


def test_roster_emails_are_never_cut_mid_word():
    pdf = _render("member_roster", safety._ROSTER)
    cut = [
        line
        for line in _lines(pdf)
        if "example" in line or "@" in line
        if not line.rstrip().endswith(("@", ".", "-", ".org"))
        and not line.rstrip().endswith("org")
    ]
    assert cut == []


def test_a_short_header_stays_on_one_line():
    pdf = _render("member_roster", safety._ROSTER)
    assert any(text.strip() == "Member #" for *_rest, text in safety._runs(pdf))


def test_a_band_continued_on_the_next_page_keeps_its_label():
    pdf = _render("call_volume", safety._CALLS)
    pages = PdfReader(BytesIO(pdf)).pages
    assert len(pages) > 2
    labels = [
        [line for line in page.extract_text().splitlines() if "Call types" in line]
        for page in pages
    ]
    # The first band starts on page 1 and runs onto page 2, where its label
    # is printed again above the repeated header.
    assert any("Call types 1–9 of 14" in line for line in labels[0])
    assert any("Call types 1–9 of 14" in line for line in labels[1])
