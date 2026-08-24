"""
Printable station documents — the things a crew carries, rather than sticks on
something.

Two to begin with, both asked for by the same person at the same moment in the
day: the shift roster the oncoming crew reads at shift change, and the
apparatus check sheet somebody walks round the truck with. Both are printed on
a receipt printer at the watch desk, which is why they live beside the label
printer code — they share the transport, the status query and the printer
registration, and differ only in what gets rendered.

Structured exactly like :data:`app.services.label_service.MODULE_LABELS`: each
document is registered with the permissions accepted to print it and a builder
that turns ids into a neutral :class:`~app.utils.print_document.PrintDocument`.
A third document is a builder and a registry entry, with no renderer change.

Dates are formatted here rather than in the browser, which is a departure from
the app's usual rule — the server is what renders a printed document, so it is
the only place that can. It reads the organization's configured timezone for
the purpose; a roster printed in UTC at a station in Virginia would have every
shift starting at the wrong time.
"""

from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.print_document import DocumentRow, DocumentSection, PrintDocument
from app.utils.scheduling_dates import DEFAULT_TIMEZONE

# A builder resolves one record, org-scoped, into a finished document. The
# calling user is passed because a module permission is not always the whole
# access rule: a record can carry a section with its own, narrower one.
DocumentBuilder = Callable[
    [AsyncSession, str, str, str, Any], Awaitable[Optional[PrintDocument]]
]

# Officers first, then the driver, then everyone else. A roster is read at
# shift change to find out who is in charge, so that name belongs at the top
# rather than wherever the alphabet happens to put it.
_POSITION_RANK = {
    "captain": 0,
    "lieutenant": 1,
    "officer": 2,
    "driver": 3,
    "ems": 4,
    "firefighter": 5,
    "probationary": 6,
    "volunteer": 7,
    "other": 8,
}

# Someone who declined or was cancelled is not on the shift; printing them
# would have the oncoming crew looking for a person who is not coming.
_ROSTER_EXCLUDED_STATUSES = {"declined", "cancelled", "no_show"}


async def _org_timezone(db: AsyncSession, organization_id: str) -> str:
    from app.models.user import Organization

    tz_name = await db.scalar(
        select(Organization.timezone).where(Organization.id == str(organization_id))
    )
    return tz_name or DEFAULT_TIMEZONE


def _to_local(value: Optional[datetime], tz_name: str) -> Optional[datetime]:
    """Move a stored UTC datetime into the organization's timezone."""
    if value is None:
        return None
    try:
        zone = ZoneInfo(tz_name)
    except Exception:
        zone = ZoneInfo(DEFAULT_TIMEZONE)
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(zone)


def _format_time(value: Optional[datetime], tz_name: str) -> str:
    local = _to_local(value, tz_name)
    return local.strftime("%H:%M") if local else "--:--"


def _person_name(user) -> str:
    if user is None:
        return "Unassigned"
    name = " ".join(filter(None, [user.first_name, user.last_name])).strip()
    return name or (user.username or "Member")


def _may_see_pass_down(shift, assignments, viewer) -> bool:
    """Whether *viewer* may read this shift's pass-down notes.

    Mirrors ``_authorize_handoff_access`` in the scheduling endpoints, which is
    the canonical rule: shift managers, the named shift officer, or somebody
    actually rostered on the shift. Pass-downs are deliberately withheld from
    the ordinary shift reads (``list_shifts`` and ``get_shift`` both pop the
    field) and served only by the handoff endpoint, so a roster printed on a
    flat ``scheduling.view`` grant must not become a way around that.
    """
    from app.api.dependencies import user_has_permission

    if user_has_permission(viewer, "scheduling.manage"):
        return True
    if shift.shift_officer_id and str(shift.shift_officer_id) == str(viewer.id):
        return True
    return any(
        str(assignment.user_id) == str(viewer.id)
        and str(
            getattr(assignment.assignment_status, "value", assignment.assignment_status)
        )
        in ("assigned", "confirmed")
        for assignment, _user in assignments
    )


async def build_shift_roster(
    db: AsyncSession, organization_id: str, record_id: str, tz_name: str, viewer
) -> Optional[PrintDocument]:
    """The crew on one shift, in the order a roster is read."""
    from app.models.training import Shift, ShiftAssignment
    from app.models.user import User

    shift = await db.scalar(
        select(Shift).where(
            Shift.id == str(record_id),
            Shift.organization_id == str(organization_id),
        )
    )
    if shift is None:
        return None

    rows_result = await db.execute(
        select(ShiftAssignment, User)
        .join(User, User.id == ShiftAssignment.user_id)
        .where(
            ShiftAssignment.shift_id == shift.id,
            ShiftAssignment.organization_id == str(organization_id),
        )
    )
    assignments = [
        (assignment, user)
        for assignment, user in rows_result.all()
        if str(
            getattr(assignment.assignment_status, "value", assignment.assignment_status)
        )
        not in _ROSTER_EXCLUDED_STATUSES
    ]

    def sort_key(pair):
        assignment, user = pair
        position = str(getattr(assignment.position, "value", assignment.position) or "")
        return (_POSITION_RANK.get(position, 99), _person_name(user).lower())

    assignments.sort(key=sort_key)

    unit_label = ""
    if shift.apparatus_id:
        from app.utils.apparatus_ref import resolve_apparatus_labels

        labels = await resolve_apparatus_labels(
            db, [shift.apparatus_id], organization_id
        )
        unit_label = labels.get(str(shift.apparatus_id), "") or ""

    start = _format_time(shift.start_time, tz_name)
    end = _format_time(shift.end_time, tz_name)
    subtitle_parts = [shift.shift_date.strftime("%a %d %b %Y")]
    subtitle_parts.append(f"{start}-{end}")
    if unit_label:
        subtitle_parts.append(unit_label)
    if shift.platoon:
        subtitle_parts.append(f"Platoon {shift.platoon}")

    crew_rows: List[DocumentRow] = []
    for assignment, user in assignments:
        position = str(getattr(assignment.position, "value", assignment.position) or "")
        status = str(
            getattr(assignment.assignment_status, "value", assignment.assignment_status)
            or ""
        )
        name = _person_name(user)
        marks = []
        if assignment.is_training:
            marks.append("training")
        # An unconfirmed seat is the one worth flagging on a printed roster:
        # it is the difference between a crew of four and a crew of three.
        if status not in ("confirmed", "assigned"):
            marks.append(status)
        elif status == "assigned":
            marks.append("unconfirmed")
        if marks:
            name = f"{name} ({', '.join(marks)})"
        crew_rows.append(DocumentRow(left=name, right=position.upper()[:12] or None))

    if not crew_rows:
        crew_rows.append(DocumentRow(left="No one assigned", emphasis=True))

    heading = f"Crew ({len(assignments)}"
    if shift.min_staffing:
        heading += f" of {shift.min_staffing} minimum"
    heading += ")"

    sections = [DocumentSection(heading=heading, rows=crew_rows)]

    officer_name = None
    if shift.shift_officer_id:
        officer = await db.scalar(
            select(User).where(
                User.id == shift.shift_officer_id,
                User.organization_id == str(organization_id),
            )
        )
        officer_name = _person_name(officer) if officer else None
    if officer_name:
        sections.insert(
            0,
            DocumentSection(
                rows=[DocumentRow(left="Shift officer", right=officer_name)]
            ),
        )

    if shift.notes:
        sections.append(
            DocumentSection(heading="Notes", rows=[DocumentRow(left=str(shift.notes))])
        )
    # The pass-down is the reason the previous crew wrote anything down, so it
    # goes on the sheet the next crew is holding — but only for the crew it
    # belongs to. See _may_see_pass_down.
    if shift.pass_down_notes and _may_see_pass_down(shift, assignments, viewer):
        sections.append(
            DocumentSection(
                heading="Pass-down",
                rows=[DocumentRow(left=str(shift.pass_down_notes))],
            )
        )

    return PrintDocument(
        title="Shift Roster",
        subtitle=" | ".join(subtitle_parts),
        sections=sections,
        footer=f"Printed {_to_local(datetime.now(timezone.utc), tz_name).strftime('%d %b %H:%M')}",
    )


def _item_expectation(item) -> Optional[str]:
    """The short right-hand note that says what "correct" looks like."""
    check_type = str(item.check_type or "")
    if check_type == "quantity":
        expected = item.required_quantity or item.expected_quantity
        return f"qty {expected}" if expected else "qty"
    if check_type == "level":
        if item.min_level is not None:
            unit = item.level_unit or ""
            return f"min {item.min_level:g}{unit}".strip()
        return "level"
    if check_type in ("date_lot", "reading", "text", "present", "functional"):
        return check_type.replace("_", " ")
    return None


async def build_apparatus_check_sheet(
    db: AsyncSession, organization_id: str, record_id: str, tz_name: str, viewer
) -> Optional[PrintDocument]:
    """A checklist template as a sheet somebody carries round the truck.

    Read through :class:`EquipmentCheckService` rather than with a query of our
    own, so this inherits the narrowing the module already applies: a member
    who only holds ``equipment_check.submit`` sees the checklists for the
    positions they actually check, and not the rest of the department's.
    Querying the table directly would quietly hand them all of it.
    """
    from app.api.dependencies import _collect_user_permissions, _has_permission
    from app.services.equipment_check_service import EquipmentCheckService

    service = EquipmentCheckService(db)
    permissions = _collect_user_permissions(viewer)
    visible_positions = None
    if not (
        _has_permission("equipment_check.view", permissions)
        or _has_permission("equipment_check.manage", permissions)
    ):
        visible_positions = await service.get_user_check_positions(
            str(viewer.id), str(organization_id)
        )

    template = await service.get_template(
        str(record_id),
        str(organization_id),
        visible_positions=visible_positions,
        submitter_user_id=str(viewer.id),
    )
    if template is None:
        return None

    unit_label = ""
    if template.apparatus_id:
        from app.utils.apparatus_ref import resolve_apparatus_labels

        labels = await resolve_apparatus_labels(
            db, [template.apparatus_id], organization_id
        )
        unit_label = labels.get(str(template.apparatus_id), "") or ""

    compartments = sorted(
        template.compartments or [], key=lambda c: (c.sort_order or 0, c.name or "")
    )
    by_parent: Dict[Optional[str], list] = {}
    for compartment in compartments:
        by_parent.setdefault(compartment.parent_compartment_id, []).append(compartment)

    sections: List[DocumentSection] = []

    def item_rows(compartment, depth: int) -> List[DocumentRow]:
        rows: List[DocumentRow] = []
        for item in sorted(
            compartment.items or [], key=lambda i: (i.sort_order or 0, i.name or "")
        ):
            name = item.name or "Item"
            if item.is_required:
                name = f"{name} *"
            rows.append(
                DocumentRow(
                    left=name,
                    right=_item_expectation(item),
                    checkbox=True,
                    indent=depth,
                )
            )
        return rows

    def walk(compartment, depth: int, rows: List[DocumentRow]) -> None:
        """Nested containers become indented blocks in their parent's section.

        A bag inside a compartment is not a new place to look — it is a place
        inside the one already open — so the printed sheet keeps it under the
        same heading rather than sending the reader back across the truck.
        """
        if depth > 0:
            rows.append(
                DocumentRow(
                    left=(compartment.name or "Container"),
                    emphasis=True,
                    indent=depth - 1,
                )
            )
        rows.extend(item_rows(compartment, depth))
        for child in by_parent.get(compartment.id, []):
            walk(child, depth + 1, rows)

    for compartment in by_parent.get(None, []):
        rows: List[DocumentRow] = []
        walk(compartment, 0, rows)
        if rows:
            sections.append(DocumentSection(heading=compartment.name, rows=rows))

    if not sections:
        sections.append(
            DocumentSection(rows=[DocumentRow(left="No items on this checklist")])
        )

    # A paper sheet needs somewhere to record who walked the truck, or it
    # proves nothing once it is handed in.
    sections.append(
        DocumentSection(
            heading="Signed",
            rows=[
                DocumentRow(left="Checked by: ______________________"),
                DocumentRow(left="Date / time: _____________________"),
            ],
        )
    )

    subtitle_parts = [p for p in [unit_label, template.check_timing] if p]
    return PrintDocument(
        title=template.name or "Check Sheet",
        subtitle=" | ".join(part.replace("_", " ") for part in subtitle_parts) or None,
        sections=sections,
        footer="* required item",
    )


# document key -> (permissions accepted (any-of), builder).
MODULE_DOCUMENTS: Dict[str, Tuple[Tuple[str, ...], DocumentBuilder]] = {
    "shift_roster": (
        ("scheduling.view", "scheduling.manage"),
        build_shift_roster,
    ),
    # The equipment_check family, matching GET /templates/{id} — not
    # apparatus.*, which is a rank default and would hand every member the
    # department's whole checklist configuration.
    "apparatus_check_sheet": (
        (
            "equipment_check.view",
            "equipment_check.submit",
            "equipment_check.manage",
        ),
        build_apparatus_check_sheet,
    ),
}


def _language_of(printer) -> str:
    """A printer's language, defaulting to ZPL for rows written before the
    column existed."""
    return getattr(printer, "language", None) or "zpl"


def is_known_document(document: str) -> bool:
    return document in MODULE_DOCUMENTS


def required_permissions_for_document(document: str) -> Optional[Tuple[str, ...]]:
    entry = MODULE_DOCUMENTS.get(document)
    return entry[0] if entry else None


class PrintDocumentService:
    """Builds station documents and hands them to a receipt printer."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def build(
        self, organization_id, document: str, record_id: str, viewer
    ) -> PrintDocument:
        entry = MODULE_DOCUMENTS.get(document)
        if entry is None:
            raise ValueError(f"Unknown document: {document}")
        _, builder = entry

        tz_name = await _org_timezone(self.db, str(organization_id))
        built = await builder(
            self.db, str(organization_id), str(record_id), tz_name, viewer
        )
        if built is None:
            raise ValueError("Record not found")
        return built

    async def preview(
        self, organization_id, document: str, record_id: str, viewer
    ) -> Dict[str, Any]:
        return (
            await self.build(organization_id, document, record_id, viewer)
        ).to_dict()

    async def _resolve_receipt_printer(self, organization_id, printer_id):
        """Pick the printer to send a document to.

        Restricted to ESC/POS: a document is a column of text on continuous
        paper, and a die-cut label printer has nowhere to put it. Choosing the
        organization default here would pick a Zebra in most departments, so
        the search is over receipt printers only and says so when there is
        none rather than printing a roster onto forty asset tags.
        """
        from app.services.label_printer_service import (
            LANGUAGE_ESCPOS,
            LabelPrinterService,
        )

        printers = LabelPrinterService(self.db)
        if printer_id:
            printer = await printers.get_printer(printer_id, organization_id)
            if _language_of(printer) != LANGUAGE_ESCPOS:
                raise ValueError(
                    f"{printer.name!r} is a label printer. Documents print to a "
                    "receipt printer."
                )
        else:
            candidates = [
                p
                for p in await printers.list_printers(organization_id)
                if _language_of(p) == LANGUAGE_ESCPOS
            ]
            if not candidates:
                raise ValueError(
                    "No receipt printer is configured. Add one in Organization "
                    "Settings > Label Printers, choosing the ESC/POS language."
                )
            printer = candidates[0]

        if not printer.is_active:
            raise ValueError(f"Printer {printer.name!r} is disabled")
        return printer

    async def print_document(
        self,
        organization_id,
        document: str,
        record_id: str,
        viewer,
        printer_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build a document and send it to a receipt printer."""
        from app.services.label_printer_service import LabelPrinterService
        from app.utils.escpos_renderer import render_escpos_document
        from app.utils.printer_transport import send_to_printer

        built = await self.build(organization_id, document, record_id, viewer)
        printer = await self._resolve_receipt_printer(organization_id, printer_id)

        payload = render_escpos_document(built, printer.label_format)
        await send_to_printer(printer.host, printer.port, payload)

        return {
            "printer_id": printer.id,
            "printer_name": printer.name,
            "document": document,
            "title": built.title,
            **await LabelPrinterService(self.db)._post_print_report(printer),
        }
