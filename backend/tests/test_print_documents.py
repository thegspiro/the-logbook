"""
Tests for printable station documents — the roster and check-sheet builders
(app/services/print_document_service.py), the neutral document model, and the
ESC/POS document renderer.

The DB session is mocked, so these need no MySQL. What they pin down is what a
crew would notice on paper: that the officer is at the top of a roster, that
somebody who declined is not on it, that a seat nobody confirmed is marked as
such, and that a nested container on a check sheet reads as a place inside the
compartment already open rather than a new trip round the truck.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.print_document_service import (
    MODULE_DOCUMENTS,
    PrintDocumentService,
    build_apparatus_check_sheet,
    build_shift_roster,
    required_permissions_for_document,
)
from app.utils.escpos_renderer import render_escpos_document
from app.utils.print_document import DocumentRow, DocumentSection, PrintDocument

ORG = "org-1"
TZ = "America/New_York"


def _user(first="Ada", last="Rivera", username="arivera"):
    return SimpleNamespace(
        id=f"u-{username}", first_name=first, last_name=last, username=username
    )


def _assignment(position="firefighter", status="confirmed", training=False):
    return SimpleNamespace(
        position=position,
        assignment_status=status,
        is_training=training,
        user_id="u",
    )


def _shift(**kwargs):
    base = {
        "id": "shift-1",
        "organization_id": ORG,
        "shift_date": date(2026, 8, 25),
        "start_time": datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc),
        "end_time": datetime(2026, 8, 26, 0, 0, tzinfo=timezone.utc),
        "apparatus_id": None,
        "platoon": None,
        "shift_officer_id": None,
        "min_staffing": None,
        "notes": None,
        "pass_down_notes": None,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def _db(scalars=(), rows=()):
    """A session whose scalar() answers in order and execute() yields rows."""
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=list(scalars))
    result = MagicMock()
    result.all = MagicMock(return_value=list(rows))
    db.execute = AsyncMock(return_value=result)
    return db


def _rows_of(document, heading=None):
    for section in document.sections:
        if heading is None or (section.heading or "").startswith(heading):
            for row in section.rows:
                yield row


class TestRegistry:
    def test_both_documents_are_registered(self):
        assert set(MODULE_DOCUMENTS) == {"shift_roster", "apparatus_check_sheet"}

    def test_a_roster_needs_a_scheduling_permission(self):
        assert required_permissions_for_document("shift_roster") == (
            "scheduling.view",
            "scheduling.manage",
        )

    def test_a_check_sheet_needs_an_apparatus_permission(self):
        assert required_permissions_for_document("apparatus_check_sheet") == (
            "apparatus.view",
            "apparatus.manage",
        )

    def test_an_unknown_document_has_no_permissions(self):
        assert required_permissions_for_document("payroll_run") is None


class TestShiftRoster:
    async def test_a_missing_shift_yields_nothing(self):
        # The org filter makes another department's shift indistinguishable
        # from one that does not exist, which is the point.
        db = _db(scalars=[None])
        assert await build_shift_roster(db, ORG, "shift-1", TZ) is None

    async def test_the_officer_is_at_the_top(self):
        # A roster is read at shift change to find who is in charge.
        db = _db(
            scalars=[_shift()],
            rows=[
                (_assignment("firefighter"), _user("Mo", "Bell")),
                (_assignment("captain"), _user("Ada", "Rivera")),
                (_assignment("driver"), _user("Jon", "Okafor")),
            ],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        names = [row.left for row in _rows_of(doc, "Crew")]
        assert names[0].startswith("Ada Rivera")
        assert names[1].startswith("Jon Okafor")

    async def test_someone_who_declined_is_not_printed(self):
        db = _db(
            scalars=[_shift()],
            rows=[
                (_assignment(status="confirmed"), _user("Ada", "Rivera")),
                (_assignment(status="declined"), _user("Gone", "Away")),
                (_assignment(status="cancelled"), _user("Also", "Away")),
            ],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        printed = " ".join(row.left for row in _rows_of(doc, "Crew"))
        assert "Ada Rivera" in printed
        assert "Gone Away" not in printed
        assert "Also Away" not in printed

    async def test_an_unconfirmed_seat_is_marked(self):
        # The difference between a crew of four and a crew of three.
        db = _db(
            scalars=[_shift()],
            rows=[(_assignment(status="assigned"), _user("Ada", "Rivera"))],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert "unconfirmed" in next(_rows_of(doc, "Crew")).left

    async def test_a_confirmed_seat_carries_no_marks(self):
        db = _db(
            scalars=[_shift()],
            rows=[(_assignment(status="confirmed"), _user("Ada", "Rivera"))],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert next(_rows_of(doc, "Crew")).left == "Ada Rivera"

    async def test_a_training_seat_is_marked(self):
        db = _db(
            scalars=[_shift()],
            rows=[(_assignment(training=True), _user("Mo", "Bell"))],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert "training" in next(_rows_of(doc, "Crew")).left

    async def test_the_position_is_the_right_hand_column(self):
        db = _db(
            scalars=[_shift()],
            rows=[(_assignment("driver"), _user("Jon", "Okafor"))],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert next(_rows_of(doc, "Crew")).right == "DRIVER"

    async def test_minimum_staffing_appears_in_the_heading(self):
        db = _db(
            scalars=[_shift(min_staffing=4)],
            rows=[(_assignment(), _user())],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        heading = doc.sections[0].heading
        assert "1 of 4 minimum" in heading

    async def test_an_empty_shift_says_so(self):
        db = _db(scalars=[_shift()], rows=[])
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert "No one assigned" in next(_rows_of(doc, "Crew")).left

    async def test_times_are_local_not_utc(self):
        # 12:00 UTC is 08:00 in New York; printing UTC would have every shift
        # starting at the wrong time.
        db = _db(scalars=[_shift()], rows=[(_assignment(), _user())])
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert "08:00" in doc.subtitle

    async def test_the_pass_down_is_carried_to_the_next_crew(self):
        db = _db(
            scalars=[_shift(pass_down_notes="Ladder 2 out of service")],
            rows=[(_assignment(), _user())],
        )
        doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        headings = [s.heading for s in doc.sections]
        assert "Pass-down" in headings

    async def test_the_apparatus_is_named_in_the_subtitle(self):
        db = _db(scalars=[_shift(apparatus_id="ap-1")], rows=[(_assignment(), _user())])
        with patch(
            "app.utils.apparatus_ref.resolve_apparatus_labels",
            AsyncMock(return_value={"ap-1": "Engine 1"}),
        ):
            doc = await build_shift_roster(db, ORG, "shift-1", TZ)
        assert "Engine 1" in doc.subtitle


def _item(name="Hose", sort=0, check_type="pass_fail", required=False, **kwargs):
    base = {
        "name": name,
        "sort_order": sort,
        "check_type": check_type,
        "is_required": required,
        "required_quantity": None,
        "expected_quantity": None,
        "min_level": None,
        "level_unit": None,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def _compartment(cid, name, sort=0, parent=None, items=()):
    return SimpleNamespace(
        id=cid,
        name=name,
        sort_order=sort,
        parent_compartment_id=parent,
        items=list(items),
    )


def _template(compartments=(), **kwargs):
    base = {
        "id": "tpl-1",
        "organization_id": ORG,
        "name": "Start of Shift Check",
        "apparatus_id": None,
        "check_timing": "start_of_shift",
        "compartments": list(compartments),
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


class TestCheckSheet:
    async def test_a_missing_template_yields_nothing(self):
        db = _db(scalars=[None])
        assert await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ) is None

    async def test_items_are_checkboxes(self):
        # The sheet exists to be marked on while walking round the truck.
        db = _db(
            scalars=[_template([_compartment("c1", "Cab", items=[_item("Radio")])])]
        )
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        row = next(r for r in _rows_of(doc, "Cab") if r.left.startswith("Radio"))
        assert row.checkbox is True

    async def test_compartments_are_sections_in_sort_order(self):
        db = _db(
            scalars=[
                _template(
                    [
                        _compartment("c2", "Rear", sort=2, items=[_item("Axe")]),
                        _compartment("c1", "Cab", sort=1, items=[_item("Radio")]),
                    ]
                )
            ]
        )
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        headings = [s.heading for s in doc.sections if s.heading != "Signed"]
        assert headings == ["Cab", "Rear"]

    async def test_a_nested_container_stays_under_its_parent(self):
        # A bag inside a compartment is a place inside the one already open,
        # not a new trip across the truck.
        db = _db(
            scalars=[
                _template(
                    [
                        _compartment("c1", "Cab", items=[_item("Radio")]),
                        _compartment(
                            "c2", "EMS Bag", parent="c1", items=[_item("Gauze")]
                        ),
                    ]
                )
            ]
        )
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        headings = [s.heading for s in doc.sections if s.heading != "Signed"]
        assert headings == ["Cab"]

        rows = list(_rows_of(doc, "Cab"))
        bag = next(r for r in rows if r.left == "EMS Bag")
        gauze = next(r for r in rows if r.left.startswith("Gauze"))
        assert bag.emphasis is True
        assert gauze.indent > 0

    async def test_a_required_item_is_starred(self):
        db = _db(
            scalars=[
                _template(
                    [_compartment("c1", "Cab", items=[_item("Radio", required=True)])]
                )
            ]
        )
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        assert next(_rows_of(doc, "Cab")).left.endswith("*")

    async def test_a_quantity_item_shows_what_correct_looks_like(self):
        db = _db(
            scalars=[
                _template(
                    [
                        _compartment(
                            "c1",
                            "Cab",
                            items=[
                                _item(
                                    "Flares",
                                    check_type="quantity",
                                    required_quantity=6,
                                )
                            ],
                        )
                    ]
                )
            ]
        )
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        assert next(_rows_of(doc, "Cab")).right == "qty 6"

    async def test_a_level_item_shows_its_minimum(self):
        db = _db(
            scalars=[
                _template(
                    [
                        _compartment(
                            "c1",
                            "Cab",
                            items=[
                                _item(
                                    "SCBA",
                                    check_type="level",
                                    min_level=4500,
                                    level_unit="psi",
                                )
                            ],
                        )
                    ]
                )
            ]
        )
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        assert next(_rows_of(doc, "Cab")).right == "min 4500psi"

    async def test_there_is_somewhere_to_sign(self):
        # A sheet handed in unsigned proves nothing.
        db = _db(scalars=[_template([_compartment("c1", "Cab", items=[_item()])])])
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        signed = [s for s in doc.sections if s.heading == "Signed"]
        assert signed
        assert any("Checked by" in row.left for row in signed[0].rows)

    async def test_an_empty_template_says_so(self):
        db = _db(scalars=[_template([])])
        doc = await build_apparatus_check_sheet(db, ORG, "tpl-1", TZ)
        assert any(
            "No items" in row.left for section in doc.sections for row in section.rows
        )


class TestPrinterSelection:
    """Documents go to a receipt printer. A die-cut label printer has nowhere
    to put a column of text, and picking the org default would choose a Zebra
    in most departments."""

    def _printer(self, **kwargs):
        base = {
            "id": "p1",
            "name": "Watch Desk Epson",
            "host": "10.0.0.7",
            "port": 9100,
            "label_format": "escpos_80mm",
            "language": "escpos",
            "is_active": True,
        }
        base.update(kwargs)
        return SimpleNamespace(**base)

    async def test_a_label_printer_is_refused_by_name(self):
        svc = PrintDocumentService(MagicMock())
        zebra = self._printer(language="zpl", name="Quartermaster Zebra")
        with patch(
            "app.services.label_printer_service.LabelPrinterService.get_printer",
            AsyncMock(return_value=zebra),
        ):
            with pytest.raises(ValueError, match="is a label printer"):
                await svc._resolve_receipt_printer(ORG, "p1")

    async def test_no_receipt_printer_gives_an_actionable_message(self):
        svc = PrintDocumentService(MagicMock())
        with patch(
            "app.services.label_printer_service.LabelPrinterService.list_printers",
            AsyncMock(return_value=[self._printer(language="zpl")]),
        ):
            with pytest.raises(ValueError, match="No receipt printer is configured"):
                await svc._resolve_receipt_printer(ORG, None)

    async def test_a_receipt_printer_is_chosen_over_a_label_printer(self):
        svc = PrintDocumentService(MagicMock())
        printers = [self._printer(language="zpl", id="zebra"), self._printer()]
        with patch(
            "app.services.label_printer_service.LabelPrinterService.list_printers",
            AsyncMock(return_value=printers),
        ):
            chosen = await svc._resolve_receipt_printer(ORG, None)
        assert chosen.id == "p1"

    async def test_a_disabled_printer_is_refused(self):
        svc = PrintDocumentService(MagicMock())
        with patch(
            "app.services.label_printer_service.LabelPrinterService.get_printer",
            AsyncMock(return_value=self._printer(is_active=False)),
        ):
            with pytest.raises(ValueError, match="is disabled"):
                await svc._resolve_receipt_printer(ORG, "p1")

    async def test_an_unknown_document_is_rejected(self):
        svc = PrintDocumentService(MagicMock())
        with pytest.raises(ValueError, match="Unknown document"):
            await svc.build(ORG, "payroll_run", "x")


class TestDocumentRenderer:
    def _doc(self):
        return PrintDocument(
            title="Shift Roster",
            subtitle="Mon 25 Aug",
            sections=[
                DocumentSection(
                    heading="Crew",
                    rows=[
                        DocumentRow(left="Ada Rivera", right="CAPTAIN", emphasis=True),
                        DocumentRow(left="Gauze", checkbox=True, indent=1),
                    ],
                )
            ],
            footer="Printed",
        )

    def test_returns_bytes(self):
        assert isinstance(render_escpos_document(self._doc()), bytes)

    def test_starts_by_resetting_the_printer(self):
        assert render_escpos_document(self._doc()).startswith(b"\x1b@")

    def test_ends_with_a_cut(self):
        assert render_escpos_document(self._doc()).endswith(b"\x1dVB\x00")

    def test_the_title_and_rows_are_present(self):
        out = render_escpos_document(self._doc())
        assert b"Shift Roster" in out
        assert b"Ada Rivera" in out
        assert b"CAPTAIN" in out

    def test_a_heading_is_upper_cased(self):
        assert b"CREW" in render_escpos_document(self._doc())

    def test_a_checkbox_row_prints_a_box(self):
        assert b"[ ] Gauze" in render_escpos_document(self._doc())

    def test_the_right_column_is_pushed_to_the_margin(self):
        out = render_escpos_document(self._doc(), "escpos_58mm")
        line = next(line for line in out.split(b"\n") if b"Ada Rivera" in line)
        # 32 characters of paper, less the bold-on prefix bytes.
        assert line.rstrip().endswith(b"CAPTAIN")

    def test_a_long_left_column_is_truncated_not_the_right_one(self):
        # The right column carries the status or the count — the half that
        # would be guessed at wrongly if it were the one cut.
        doc = PrintDocument(
            title="T",
            sections=[
                DocumentSection(rows=[DocumentRow(left="X" * 100, right="OFFICER")])
            ],
        )
        out = render_escpos_document(doc, "escpos_58mm")
        assert b"OFFICER" in out

    def test_an_unknown_paper_size_is_rejected(self):
        with pytest.raises(ValueError, match="Unknown receipt paper size"):
            render_escpos_document(self._doc(), "zebra_2x1")

    def test_narrow_paper_still_renders(self):
        assert render_escpos_document(self._doc(), "escpos_58mm").startswith(b"\x1b@")


class TestDocumentModel:
    def test_an_empty_document_is_reported_empty(self):
        assert PrintDocument(title="T").is_empty()

    def test_the_preview_carries_the_same_structure_as_the_print(self):
        doc = PrintDocument(
            title="T",
            sections=[DocumentSection(heading="H", rows=[DocumentRow(left="L")])],
        )
        data = doc.to_dict()
        assert data["title"] == "T"
        assert data["sections"][0]["heading"] == "H"
        assert data["sections"][0]["rows"][0]["left"] == "L"


class TestServiceBuild:
    async def test_build_reads_the_organizations_timezone(self):
        db = _db(scalars=["America/Chicago", _shift()])
        db.execute = AsyncMock(
            return_value=MagicMock(
                all=MagicMock(return_value=[(_assignment(), _user())])
            )
        )
        doc = await PrintDocumentService(db).build(ORG, "shift_roster", "shift-1")
        # 12:00 UTC is 07:00 in Chicago, 08:00 in New York — so this asserts
        # the org's own zone is used rather than the module default.
        assert "07:00" in doc.subtitle

    async def test_preview_returns_the_same_content_as_the_build(self):
        db = _db(scalars=[TZ, _shift()])
        db.execute = AsyncMock(
            return_value=MagicMock(
                all=MagicMock(return_value=[(_assignment(), _user())])
            )
        )
        data = await PrintDocumentService(db).preview(ORG, "shift_roster", "shift-1")
        assert data["title"] == "Shift Roster"
        assert data["sections"][0]["rows"][0]["left"] == "Ada Rivera"

    async def test_a_record_in_another_org_is_not_found(self):
        db = _db(scalars=[TZ, None])
        svc = PrintDocumentService(db)
        with pytest.raises(ValueError, match="Record not found"):
            await svc.build(ORG, "shift_roster", "shift-1")
