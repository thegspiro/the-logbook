"""A formal document says whose it is, which copy it is, and how to handle it.

Owner decisions of 2026-11-21:

* **Identity line.** Under the department's name on page 1: its address, phone
  and FDID. Formal letterhead carries them, and the organization record
  already holds them.
* **Report number.** ``RPT-YYYYMMDD-XXXX`` on page 1 and at the top of every
  later page, and recorded in the export's audit row, so a printed page can be
  traced to the export that made it. Not on the printable ballot (a serial on a
  voting instrument, tied to an audit row, is not wanted) nor the evaluation
  (a frozen record that already carries its own fingerprint).
* **Handling banner.** A document that carries a confidentiality notice shows
  it at the top of every page as well as in the footer, as handling markings
  are placed in federal marking guidance.
"""

import re
from io import BytesIO
from types import SimpleNamespace
from typing import Dict, List

import pytest
from pypdf import PdfReader

from app.services.report_export import render_report_pdf
from app.services.report_tables import build_export_table
from app.utils.election_pdf_style import department_identity
from app.utils.pdf_report_kit import CONFIDENTIAL_MEMBER_RECORDS
from app.utils.report_number import REPORT_NUMBER_PATTERN, new_report_number
from tests import test_pdf_print_safety as safety
from tests import test_pdf_running_header as headed

pytestmark = pytest.mark.unit

IDENTITY = "100 Main St, Falls Church, VA 22046 · (703) 555-0100 · FDID 12345"
NUMBER = "RPT-20261121-7K3Q"
_TOP = 80


def _org(**extra):
    base = dict(
        id="org-1",
        name=headed.ORG,
        timezone="UTC",
        logo=headed.LOGO,
        mailing_address_line1="100 Main St",
        mailing_address_line2=None,
        mailing_city="Falls Church",
        mailing_state="VA",
        mailing_zip="22046",
        phone="(703) 555-0100",
        fdid="12345",
    )
    base.update(extra)
    return SimpleNamespace(**base)


# ── the helpers ──────────────────────────────────────────────────────────────


def test_the_identity_line_joins_what_the_record_holds():
    assert department_identity(_org()) == IDENTITY


def test_blank_fields_leave_no_stray_separators():
    org = _org(mailing_address_line1="", mailing_city=None, phone=None)
    assert department_identity(org) == "VA 22046 · FDID 12345"
    assert (
        department_identity(
            _org(
                **dict.fromkeys(
                    [
                        "mailing_address_line1",
                        "mailing_city",
                        "mailing_state",
                        "mailing_zip",
                        "phone",
                        "fdid",
                    ]
                )
            )
        )
        == ""
    )
    assert department_identity(None) == ""


def test_a_report_number_names_its_day_and_is_not_guessable():
    from datetime import date

    numbers = {new_report_number(date(2026, 11, 21)) for _ in range(200)}
    assert all(re.fullmatch(REPORT_NUMBER_PATTERN, n) for n in numbers)
    assert all(n.startswith("RPT-20261121-") for n in numbers)
    assert len(numbers) > 190


# ── the documents ────────────────────────────────────────────────────────────


def _reports(report_type="member_roster", data=None) -> bytes:
    return render_report_pdf(
        build_export_table(report_type, data or safety._ROSTER),
        org_name=headed.ORG,
        logo=headed.LOGO,
        generated_at="2026-11-21 10:00 EST",
        generated_by="Jordan Ames, Fire Chief",
        parameters=[("Period", "2026-01-01 to 2026-06-30")],
        identity=IDENTITY,
        report_number=NUMBER,
    )


def _equipment() -> bytes:
    from app.services import equipment_check_pdf

    items = [
        {
            "checked_at": "2026-10-06T12:00:00+00:00",
            "apparatus_name": "Engine 1",
            "compartment_name": "Driver side",
            "item_name": f"Item {i}",
            "checked_by_name": "Sam Lee",
            "notes": "Gauge reads high.",
        }
        for i in range(70)
    ]
    return equipment_check_pdf.generate_failure_log_pdf(
        {"total": len(items), "items": items},
        organization=_org(),
        generated_by="Jo",
        report_number=NUMBER,
    )


def _certified() -> bytes:
    from app.utils.certified_results_pdf import render_certified_results_pdf

    return render_certified_results_pdf(
        headed.certified_data(),
        {
            "org_name": headed.ORG,
            "generated_at": "today",
            "logo": headed.LOGO,
            "identity": IDENTITY,
            "report_number": NUMBER,
        },
    ).getvalue()


def _package() -> bytes:
    from datetime import datetime

    from app.utils.pre_meeting_package_pdf import render_pre_meeting_package_pdf

    return render_pre_meeting_package_pdf(
        headed.package_data(),
        {
            "org_name": headed.ORG,
            "generated_at": datetime(2026, 11, 21, 10, 0),
            "logo": headed.LOGO,
            "identity": IDENTITY,
            "report_number": NUMBER,
        },
    ).getvalue()


def _minutes(notice=None) -> bytes:
    from app.utils.minutes_pdf import render_minutes_pdf

    data = {
        "title": "Monthly Business Meeting",
        "attendees": [
            {"name": f"Member {i}", "role": "Firefighter", "status": "present"}
            for i in range(60)
        ],
    }
    if notice:
        data["footer"] = {"confidentiality_notice": notice}
    meta = {
        "org_name": headed.ORG,
        "generated_at": "2026-11-21 10:00 EST",
        "logo": headed.LOGO,
        "identity": IDENTITY,
        "report_number": NUMBER,
    }
    return render_minutes_pdf(data, meta).read()


def _impact_plan() -> bytes:
    from datetime import datetime

    from app.utils.impact_plan_pdf import render_impact_plan_pdf

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
        "org_name": headed.ORG,
        "logo": headed.LOGO,
        "generated_at": datetime(2026, 11, 21, 10, 0),
        "parameters": ["Active members"],
        "show_size": True,
        "show_existing": True,
        "show_contact": True,
        "identity": IDENTITY,
        "report_number": NUMBER,
    }
    return render_impact_plan_pdf(data, meta).getvalue()


def _ballot() -> bytes:
    from copy import deepcopy

    from app.utils.election_ballot_pdf import render_printable_ballot_pdf

    data = deepcopy(headed.BALLOT_DATA)
    data["positions"] = [
        {"name": f"Position {i}", "candidates": [f"A{i}", f"B{i}"]} for i in range(14)
    ]
    return render_printable_ballot_pdf(
        data,
        {
            "org_name": headed.ORG,
            "generated_at": "today",
            "logo": headed.LOGO,
            "identity": IDENTITY,
        },
    ).getvalue()


def _evaluation() -> bytes:
    from app.utils.evaluation_pdf import render_evaluation_pdf

    return render_evaluation_pdf(
        {
            **headed.EVALUATION,
            "org_name": headed.ORG,
            "logo": headed.LOGO,
            "identity": IDENTITY,
        }
    )


NUMBERED = {
    "reports page": _reports,
    "equipment log": _equipment,
    "certified results": _certified,
    "pre-meeting package": _package,
    "minutes": _minutes,
    "impact plan": _impact_plan,
}
UNNUMBERED = {"printable ballot": _ballot, "evaluation": _evaluation}


def _pages(pdf: bytes) -> List[str]:
    return [p.extract_text() for p in PdfReader(BytesIO(pdf)).pages]


def _tops(pdf: bytes) -> Dict[int, str]:
    lines: Dict[int, List[str]] = {}
    for page, _w, h, _x0, _y0, _x1, y1, text in safety._runs(pdf):
        if y1 >= h - _TOP:
            lines.setdefault(page, []).append(text)
    return {page: " ".join(parts) for page, parts in lines.items()}


@pytest.mark.parametrize("name", list(NUMBERED) + list(UNNUMBERED))
def test_page_one_carries_the_department_identity(name):
    render = {**NUMBERED, **UNNUMBERED}[name]
    first = _pages(render())[0]
    assert "100 Main St, Falls Church, VA 22046" in first
    assert "FDID 12345" in first


@pytest.mark.parametrize("name", list(NUMBERED))
def test_the_report_number_is_on_page_one_and_atop_every_later_page(name):
    pdf = NUMBERED[name]()
    pages = _pages(pdf)
    assert len(pages) > 1
    assert NUMBER in pages[0]
    tops = _tops(pdf)
    for page in range(2, len(pages) + 1):
        assert NUMBER in tops.get(page, ""), tops.get(page)


@pytest.mark.parametrize("name", list(UNNUMBERED))
def test_ballots_and_evaluations_carry_no_report_number(name):
    assert not any("RPT-" in text for text in _pages(UNNUMBERED[name]()))


def test_the_kit_states_who_prepared_it_and_as_of_when():
    first = _pages(_reports())[0]
    assert "Report No.: " + NUMBER in first
    assert "Prepared by: Jordan Ames, Fire Chief" in first
    assert "Data as of: 2026-11-21 10:00 EST" in first


def test_a_member_data_report_is_marked_atop_every_page():
    pdf = _reports()
    tops = _tops(pdf)
    for page in range(1, len(_pages(pdf)) + 1):
        assert CONFIDENTIAL_MEMBER_RECORDS in tops.get(page, ""), tops.get(page)


def test_a_report_without_member_data_has_no_banner():
    pdf = _reports("call_volume", safety._CALLS)
    assert not any(CONFIDENTIAL_MEMBER_RECORDS in t for t in _tops(pdf).values())


def test_minutes_with_a_notice_are_marked_atop_every_page():
    notice = "Confidential: personnel matters discussed."
    pdf = _minutes(notice)
    tops = _tops(pdf)
    for page in range(1, len(_pages(pdf)) + 1):
        assert notice in tops.get(page, ""), tops.get(page)
