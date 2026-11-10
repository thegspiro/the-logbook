"""Generated PDFs keep their ink where an office printer can put it.

Every text run on a document page sits at least SAFE_EDGE (0.5") from the
top, right and bottom edges, which clears every laser's and inkjet's
unprintable border, and BINDING_EDGE (0.75") from the binding edge so a
three-hole punch does not take words out of a filed record. A landscape page
binds along its top. Label sheets and ID cards print at actual size, and each
label's text lands inside that label on an Avery 5160 sheet.

Positions come from pypdf's text visitor; a run's width is measured with the
run's own base-14 font, so a line that ends inside the margin is caught even
though only its start is reported.
"""

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Tuple

import pytest
from pypdf import PdfReader
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth

from app.services import equipment_check_pdf
from app.utils.certified_results_pdf import render_certified_results_pdf
from app.utils.election_ballot_pdf import render_printable_ballot_pdf
from app.utils.evaluation_pdf import render_evaluation_pdf
from app.utils.id_card_renderer import IdCardDepartment, IdCardSpec, render_id_cards
from app.utils.impact_plan_pdf import render_impact_plan_pdf
from app.utils.label_renderer import (
    SHEET_COLUMN_PITCH_IN,
    SHEET_LABEL_HEIGHT_IN,
    SHEET_LABEL_WIDTH_IN,
    SHEET_SIDE_MARGIN_IN,
    SHEET_TOP_MARGIN_IN,
    LabelSpec,
    render_labels,
)
from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.pdf_report_kit import ReportMeta, cell, data_table, render_report
from app.utils.pre_meeting_package_pdf import render_pre_meeting_package_pdf
from app.utils.print_geometry import BINDING_EDGE, SAFE_EDGE
from tests.test_certified_results_pdf_layout import _data as certified_data
from tests.test_election_ballot_pdf_layout import DATA as BALLOT_DATA
from tests.test_evaluation_pdf import RECORD as EVALUATION
from tests.test_pre_meeting_package_pdf_layout import _data as package_data
from tests.test_pre_meeting_package_pdf_layout import _meta as package_meta

pytestmark = pytest.mark.unit

# A descender reaches about a fifth of the font size below the baseline and a
# capital about three quarters above it.
_DESCENT = 0.22
_ASCENT = 0.75
# Rounding slack in points: a line placed exactly on the edge passes.
_SLACK = 0.5

ORG = SimpleNamespace(id="org-1", name="Oakville FD", timezone="UTC", logo=None)
LONG = "Wellington-Fairbanks Volunteer Fire & Rescue Department, Station 12 West"


def _runs(
    pdf: bytes,
) -> List[Tuple[int, float, float, float, float, float, float, str]]:
    """``(page, page_w, page_h, x0, y0, x1, y1, text)`` for every text run."""
    found = []
    for number, page in enumerate(PdfReader(BytesIO(pdf)).pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)

        def visit(text, cm, tm, font, size, number=number, w=width, h=height):
            text = text.rstrip("\n")
            if not text.strip() or not font:
                return
            name = str(font.get("/BaseFont", "/Helvetica")).lstrip("/")
            size = size * tm[0] if tm[0] else size
            x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
            y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
            lead = len(text) - len(text.lstrip())
            x0 = x + stringWidth(text[:lead], name, size)
            x1 = x + stringWidth(text.rstrip(), name, size)
            found.append(
                (number, w, h, x0, y - _DESCENT * size, x1, y + _ASCENT * size, text)
            )

        page.extract_text(visitor_text=visit)
    return found


def _offences(pdf: bytes) -> List[str]:
    bad = []
    for page, w, h, x0, y0, x1, y1, text in _runs(pdf):
        landscape = w > h
        left = SAFE_EDGE if landscape else BINDING_EDGE
        top = BINDING_EDGE if landscape else SAFE_EDGE
        edges = {
            "left": x0 - left,
            "right": (w - SAFE_EDGE) - x1,
            "bottom": y0 - SAFE_EDGE,
            "top": (h - top) - y1,
        }
        for edge, room in edges.items():
            if room < -_SLACK:
                bad.append(
                    f'page {page}: {text.strip()[:40]!r} is {-room / inch:.2f}" '
                    f"inside the {edge} margin"
                )
    return bad


def _equipment_failures() -> bytes:
    items = [
        {
            "checked_at": "2026-10-06T12:00:00+00:00",
            "apparatus_name": "Engine 1",
            "compartment_name": "Driver side compartment 3",
            "item_name": f"Item {i}",
            "checked_by_name": "Sam Lee-Fairbanks",
            "notes": "Gauge reads high at idle; replaced gasket and re-tested twice.",
        }
        for i in range(70)
    ]
    return equipment_check_pdf.generate_failure_log_pdf(
        {"total": len(items), "items": items},
        organization=SimpleNamespace(**{**vars(ORG), "name": LONG}),
        generated_by="Jordan Captain",
    )


def _wide_report() -> bytes:
    meta = ReportMeta(
        "Training Compliance Report",
        LONG,
        "2026-11-09 10:00 EST",
        wide=True,
        generated_by="Chief Ames",
    )

    def body(styles):
        return [
            data_table(
                [f"Column {i}" for i in range(8)],
                [[cell(f"Value {r}-{c}") for c in range(8)] for r in range(60)],
                [meta.width / 8] * 8,
            )
        ]

    return render_report(meta, body)


def _minutes() -> bytes:
    data = {
        "title": "Monthly Business Meeting",
        "attendees": [
            {"name": f"Member {i}", "role": "Firefighter", "status": "present"}
            for i in range(40)
        ],
        "action_items": [
            {"description": "Order hose", "priority": "high", "status": "open"}
        ],
        "footer": {
            # Longer than the line: it must be shortened to fit, not run off
            # the right edge.
            "confidentiality_notice": "Confidential — internal use only. "
            * 8
        },
    }
    return render_minutes_pdf(data, {"generated_at": "2026-11-09 10:00 EST"}).read()


def test_a_long_minutes_notice_is_shortened_to_the_line():
    text = " ".join(r[-1] for r in _runs(_minutes()))
    assert "Confidential — internal use only." in text
    assert "…" in text


def _impact_plan() -> bytes:
    members = [
        {
            "full_name": f"Alexandria Wellington-Fairbanks {i}",
            "membership_number": f"M-{i:04d}",
            "rank": "lieutenant",
            "station": "Station 12",
            "needed_size": "XL",
            "has_related_item": True,
            "needs_replacement": False,
            "email": f"alexandria.wellington-fairbanks{i}@example-department.org",
            "phone": None,
        }
        for i in range(30)
    ]
    data = {
        "total_members": 30,
        "members_needing_item": 30,
        "members_with_related_item": 30,
        "members_needing_replacement": 0,
        "members_missing_sizes": 0,
        "replacement_aware": False,
        "size_field": "shirt",
        "stock_checked": False,
        "total_to_purchase": None,
        "cost_estimated": False,
        "estimated_total_cost": None,
        "size_breakdown": [],
        "members": members,
    }
    return render_impact_plan_pdf(
        data,
        {
            "org_name": LONG,
            "generated_at": datetime(2026, 11, 9, 10, 0),
            "parameters": ["Active members"],
            "show_size": True,
            "show_existing": True,
            "show_contact": True,
        },
    ).getvalue()


DOCUMENTS: Dict[str, Callable[[], bytes]] = {
    "report kit, portrait (equipment failure log)": _equipment_failures,
    "report kit, landscape": _wide_report,
    "evaluation": lambda: render_evaluation_pdf(EVALUATION),
    "printable ballot": lambda: render_printable_ballot_pdf(
        BALLOT_DATA, {"org_name": LONG, "generated_at": "today"}
    ).getvalue(),
    "certified results": lambda: render_certified_results_pdf(
        certified_data(), {"org_name": LONG, "generated_at": "today"}
    ).getvalue(),
    "pre-meeting package": lambda: render_pre_meeting_package_pdf(
        package_data(), package_meta(org_name=LONG)
    ).getvalue(),
    "minutes": _minutes,
    "inventory impact plan": _impact_plan,
}


@pytest.mark.parametrize("name", list(DOCUMENTS))
def test_document_ink_stays_inside_the_print_safe_area(name: str):
    pdf = DOCUMENTS[name]()
    assert _runs(pdf), "no text was found; the check would pass vacuously"
    assert _offences(pdf) == []


def _print_scaling(pdf: bytes) -> Any:
    root = PdfReader(BytesIO(pdf)).trailer["/Root"]
    prefs = root.get("/ViewerPreferences")
    return prefs.get("/PrintScaling") if prefs else None


@pytest.mark.parametrize("label_format", ["letter", "rollo_2x1"])
def test_labels_ask_to_print_at_actual_size(label_format: str):
    pdf = render_labels(
        [LabelSpec(name="Hose 1", barcode_value="INV-0001")], label_format
    ).getvalue()
    assert _print_scaling(pdf) == "/None"


def test_id_cards_ask_to_print_at_actual_size():
    pdf = render_id_cards(
        [IdCardSpec(name="Jordan Reyes", barcode_value="M-042")],
        IdCardDepartment(name="Oakville FD"),
    ).getvalue()
    assert _print_scaling(pdf) == "/None"


def test_documents_leave_scaling_to_the_viewer():
    assert _print_scaling(_equipment_failures()) is None


def test_every_avery_5160_label_prints_inside_its_own_label():
    specs = [
        LabelSpec(name=f"Item {i}", barcode_value=f"INV-{i:04d}") for i in range(30)
    ]
    pdf = render_labels(specs, "letter").getvalue()
    runs = _runs(pdf)
    assert runs
    page_h = 11 * inch
    columns = [
        (
            (SHEET_SIDE_MARGIN_IN + c * SHEET_COLUMN_PITCH_IN) * inch,
            (SHEET_SIDE_MARGIN_IN + c * SHEET_COLUMN_PITCH_IN + SHEET_LABEL_WIDTH_IN)
            * inch,
        )
        for c in range(3)
    ]
    for _, _, _, x0, y0, x1, y1, text in runs:
        assert any(
            left - _SLACK <= x0 and x1 <= right + _SLACK for left, right in columns
        ), f'{text!r} spans {x0 / inch:.3f}"–{x1 / inch:.3f}", outside every label'
        row = int(
            (page_h - SHEET_TOP_MARGIN_IN * inch - y1) // (SHEET_LABEL_HEIGHT_IN * inch)
        )
        top = page_h - (SHEET_TOP_MARGIN_IN + row * SHEET_LABEL_HEIGHT_IN) * inch
        assert top - SHEET_LABEL_HEIGHT_IN * inch - _SLACK <= y0, text


def test_avery_5160_geometry_matches_the_published_template():
    """Avery 5160: 2.625" x 1" labels, 2.75" column pitch, 0.1875" sides."""
    assert SHEET_LABEL_WIDTH_IN == 2.625
    assert SHEET_LABEL_HEIGHT_IN == 1.0
    assert SHEET_COLUMN_PITCH_IN == 2.75
    assert SHEET_SIDE_MARGIN_IN == 0.1875
    assert SHEET_TOP_MARGIN_IN == 0.5
    # Three columns and their two gutters fill the sheet between its margins.
    assert 2 * SHEET_SIDE_MARGIN_IN + 2 * SHEET_COLUMN_PITCH_IN + 2.625 == 8.5
