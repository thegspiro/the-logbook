"""Every page after the first says whose document it is.

A printed report is handed round and filed as loose pages. Page 1 carries
the letterhead; without a running header, page 3 found on its own shows a
table and nothing else. So every document page after the first starts with
a compact band: the department's logo, its name, and what the document is,
above the table header that repeats beneath it.

Positions come from the print-safety test's text visitor, so a header that
ran into the margin would fail there, not here.
"""

import base64
from copy import deepcopy
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from typing import Dict, List, Tuple

import pytest
from PIL import Image
from pypdf import PdfReader

from app.services import equipment_check_pdf
from app.services.report_export import render_report_pdf
from app.services.report_tables import build_export_table
from app.utils.certified_results_pdf import render_certified_results_pdf
from app.utils.election_ballot_pdf import render_printable_ballot_pdf
from app.utils.evaluation_pdf import render_evaluation_pdf
from app.utils.impact_plan_pdf import render_impact_plan_pdf
from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.pre_meeting_package_pdf import render_pre_meeting_package_pdf
from tests import test_pdf_print_safety as safety
from tests.test_certified_results_pdf_layout import _data as certified_data
from tests.test_election_ballot_pdf_layout import DATA as BALLOT_DATA
from tests.test_evaluation_pdf import RECORD as EVALUATION
from tests.test_pre_meeting_package_pdf_layout import _data as package_data

pytestmark = pytest.mark.unit

ORG = "Falls Church Volunteer Fire Department"
# The band at the top of a page in which the running header sits: from the
# top edge down to just over an inch, above any body text on a later page.
_BAND = 80


def _logo() -> str:
    image = Image.new("RGBA", (96, 96), (153, 27, 27, 255))
    out = BytesIO()
    image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


LOGO = _logo()


def _reports_roster() -> bytes:
    return render_report_pdf(
        build_export_table("member_roster", safety._ROSTER),
        org_name=ORG,
        logo=LOGO,
        generated_at="2026-11-16 10:00 EST",
        generated_by="Chief Ames",
        parameters=[("Period", "2026-01-01 to 2026-06-30")],
    )


def _equipment() -> bytes:
    items = [
        {
            "checked_at": "2026-10-06T12:00:00+00:00",
            "apparatus_name": "Engine 1",
            "compartment_name": "Driver side compartment 3",
            "item_name": f"Item {i}",
            "checked_by_name": "Sam Lee",
            "notes": "Gauge reads high at idle.",
        }
        for i in range(70)
    ]
    org = SimpleNamespace(id="org-1", name=ORG, timezone="UTC", logo=LOGO)
    return equipment_check_pdf.generate_failure_log_pdf(
        {"total": len(items), "items": items}, organization=org, generated_by="Jo"
    )


def _ballot() -> bytes:
    data = deepcopy(BALLOT_DATA)
    data["positions"] = [
        {"name": f"Position {i}", "candidates": [f"Candidate {i}A", f"Candidate {i}B"]}
        for i in range(14)
    ]
    return render_printable_ballot_pdf(
        data, {"org_name": ORG, "generated_at": "today", "logo": LOGO}
    ).getvalue()


def _certified() -> bytes:
    return render_certified_results_pdf(
        certified_data(), {"org_name": ORG, "generated_at": "today", "logo": LOGO}
    ).getvalue()


def _package() -> bytes:
    return render_pre_meeting_package_pdf(
        package_data(),
        {
            "org_name": ORG,
            "generated_at": datetime(2026, 11, 16, 10, 0),
            "logo": LOGO,
        },
    ).getvalue()


def _evaluation() -> bytes:
    return render_evaluation_pdf({**EVALUATION, "org_name": ORG, "logo": LOGO})


def _minutes() -> bytes:
    data = {
        "title": "Monthly Business Meeting",
        "attendees": [
            {"name": f"Member {i}", "role": "Firefighter", "status": "present"}
            for i in range(60)
        ],
    }
    meta = {"org_name": ORG, "generated_at": "2026-11-16 10:00 EST", "logo": LOGO}
    return render_minutes_pdf(data, meta).read()


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
            "email": f"alexandria{i}@example-department.org",
            "phone": None,
        }
        for i in range(40)
    ]
    data = {
        "total_members": 40,
        "members_needing_item": 40,
        "members_with_related_item": 40,
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
    meta = {
        "org_name": ORG,
        "logo": LOGO,
        "generated_at": datetime(2026, 11, 16, 10, 0),
        "parameters": ["Active members"],
        "show_size": True,
        "show_existing": True,
        "show_contact": True,
    }
    return render_impact_plan_pdf(data, meta).getvalue()


# document -> (renderer, words its running header names it by)
DOCUMENTS: Dict[str, Tuple] = {
    "reports page roster": (_reports_roster, "Member Roster"),
    "equipment failure log": (_equipment, "Equipment Check Failure Log"),
    "printable ballot": (_ballot, "Official Ballot"),
    "certified results": (_certified, "Certified Election Results"),
    "pre-meeting package": (_package, "Pre-Meeting Package"),
    "evaluation": (_evaluation, "Member Performance Evaluation"),
    "minutes": (_minutes, "Monthly Business Meeting"),
    "inventory impact plan": (_impact_plan, "Inventory Impact Plan"),
}


def _top_band_text(pdf: bytes) -> Dict[int, str]:
    lines: Dict[int, List[str]] = {}
    for page, _w, h, _x0, _y0, _x1, y1, text in safety._runs(pdf):
        if y1 >= h - _BAND:
            lines.setdefault(page, []).append(text)
    return {page: " ".join(parts) for page, parts in lines.items()}


def _pages(pdf: bytes) -> int:
    return len(PdfReader(BytesIO(pdf)).pages)


@pytest.mark.parametrize("name", list(DOCUMENTS))
def test_every_later_page_names_the_department_and_the_document(name: str):
    render, title = DOCUMENTS[name]
    pdf = render()
    pages = _pages(pdf)
    assert pages > 1, "the sample must run past one page to exercise page 2"
    top = _top_band_text(pdf)
    for page in range(2, pages + 1):
        band = top.get(page, "")
        assert ORG in band, f"page {page} top: {band!r}"
        assert title.lower() in band.lower(), f"page {page} top: {band!r}"


@pytest.mark.parametrize("name", list(DOCUMENTS))
def test_every_later_page_carries_the_logo(name: str):
    render, _title = DOCUMENTS[name]
    reader = PdfReader(BytesIO(render()))
    for number, page in enumerate(reader.pages[1:], start=2):
        assert page.images, f"page {number} has no logo"


@pytest.mark.parametrize("name", list(DOCUMENTS))
def test_the_first_page_keeps_its_own_letterhead_and_logo(name: str):
    render, _title = DOCUMENTS[name]
    pdf = render()
    first = PdfReader(BytesIO(pdf)).pages[0]
    assert first.images, "page 1 has no logo"
    assert ORG in _top_band_text(pdf).get(1, "") or ORG in first.extract_text()


def test_no_logo_still_leaves_a_text_header():
    pdf = render_report_pdf(
        build_export_table("member_roster", safety._ROSTER),
        org_name=ORG,
        logo=None,
        generated_at="2026-11-16 10:00 EST",
        generated_by=None,
        parameters=[],
    )
    top = _top_band_text(pdf)
    assert all(ORG in top.get(p, "") for p in range(2, _pages(pdf) + 1))
