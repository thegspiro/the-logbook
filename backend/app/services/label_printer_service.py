"""
Network label printer management and direct (ZPL) printing.

Two responsibilities:

* CRUD for an organization's registered label printers;
* turning a set of record ids in a module into ZPL and putting it on the wire.

The second reuses the per-module spec builders registered in
:mod:`app.services.label_service`, so a module that can already produce a PDF
label can print directly with no additional per-module code — the two output
paths differ only in the renderer they hand the specs to.
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.label_printer import LabelPrinter
from app.services.label_service import MODULE_LABELS, _filter_ids
from app.utils.label_renderer import (
    SYMBOLOGY_CODE128,
    LabelSpec,
    is_known_label_format,
    validate_symbology,
)
from app.utils.model_updates import apply_updates
from app.utils.printer_status import summarize
from app.utils.printer_transport import (
    PrinterUnreachableError,
    query_printer,
    send_to_printer,
    validate_printer_port,
)
from app.utils.zpl_renderer import (
    MAX_DARKNESS,
    MIN_DARKNESS,
    SUPPORTED_DPI,
    render_zpl,
    resolve_label_size,
)

# A print job is bounded well below the transport's byte cap so the failure a
# user hits is "that is too many labels", not a truncated roll.
MAX_LABELS_PER_JOB = 500


def _validate_printer_config(
    host: Optional[str],
    port: Optional[int],
    dpi: Optional[int],
    label_format: Optional[str],
    custom_width: Optional[float],
    custom_height: Optional[float],
    darkness: Optional[int],
) -> None:
    """Validate the fields present in a create/update payload.

    Called before the row is written so a printer can never be *stored* in a
    configuration that would fail at print time — the person registering the
    printer is the one who can fix it, and they are not the one who later hits
    the failure.
    """
    if host is not None and not host.strip():
        raise ValueError("Printer host is required")
    if port is not None:
        validate_printer_port(port)
    if dpi is not None and dpi not in SUPPORTED_DPI:
        raise ValueError(
            f"Unsupported printer resolution: {dpi}. "
            f"Supported: {', '.join(str(d) for d in SUPPORTED_DPI)}"
        )
    if darkness is not None and not MIN_DARKNESS <= darkness <= MAX_DARKNESS:
        raise ValueError(f"darkness must be between {MIN_DARKNESS} and {MAX_DARKNESS}")
    if label_format is not None:
        if not is_known_label_format(label_format):
            raise ValueError(f"Unknown label format: {label_format}")
        # Rejects sheet layouts (Avery) and missing custom dimensions.
        resolve_label_size(label_format, custom_width, custom_height)


class LabelPrinterService:
    """Org-scoped label printer configuration and direct printing."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def list_printers(
        self, organization_id, include_inactive: bool = False
    ) -> List[LabelPrinter]:
        query = select(LabelPrinter).where(
            LabelPrinter.organization_id == str(organization_id)
        )
        if not include_inactive:
            query = query.where(LabelPrinter.is_active.is_(True))
        rows = await self.db.scalars(
            query.order_by(LabelPrinter.is_default.desc(), LabelPrinter.name)
        )
        return list(rows.all())

    async def get_printer(self, printer_id: str, organization_id) -> LabelPrinter:
        """Fetch one printer, scoped to the caller's organization.

        The org filter is the access control here — holding
        ``settings.manage`` in one organization must not reach another's
        printer row (CLAUDE.md pitfall 14a/14b).
        """
        printer = await self.db.scalar(
            select(LabelPrinter).where(
                LabelPrinter.id == str(printer_id),
                LabelPrinter.organization_id == str(organization_id),
            )
        )
        if printer is None:
            raise ValueError("Printer not found")
        return printer

    async def _clear_other_defaults(self, organization_id, keep_id: Optional[str]):
        rows = await self.db.scalars(
            select(LabelPrinter).where(
                LabelPrinter.organization_id == str(organization_id),
                LabelPrinter.is_default.is_(True),
            )
        )
        for row in rows.all():
            if keep_id is None or row.id != keep_id:
                row.is_default = False

    async def create_printer(
        self, organization_id, created_by_id: Optional[str], data: Dict[str, Any]
    ) -> LabelPrinter:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ValueError("Printer name is required")

        _validate_printer_config(
            host=data.get("host"),
            port=data.get("port"),
            dpi=data.get("dpi"),
            label_format=data.get("label_format"),
            custom_width=data.get("custom_width"),
            custom_height=data.get("custom_height"),
            darkness=data.get("darkness"),
        )

        existing = await self.db.scalar(
            select(LabelPrinter).where(
                LabelPrinter.organization_id == str(organization_id),
                LabelPrinter.name == name,
            )
        )
        if existing is not None:
            raise ValueError(f"A printer named {name!r} already exists")

        printer = LabelPrinter(
            organization_id=str(organization_id),
            name=name,
            location=(data.get("location") or None),
            host=str(data["host"]).strip(),
            port=data.get("port") or 9100,
            dpi=data.get("dpi") or 203,
            label_format=data.get("label_format") or "zebra_2x1",
            custom_width=data.get("custom_width"),
            custom_height=data.get("custom_height"),
            darkness=data.get("darkness"),
            is_default=bool(data.get("is_default")),
            is_active=True,
            created_by_id=created_by_id,
        )
        self.db.add(printer)
        await self.db.flush()

        # The first printer registered becomes the default, so an organization
        # that adds exactly one never has to also mark it.
        count = len(await self.list_printers(organization_id, include_inactive=True))
        if printer.is_default or count == 1:
            printer.is_default = True
            await self._clear_other_defaults(organization_id, keep_id=printer.id)
        await self.db.flush()
        return printer

    async def update_printer(
        self, printer_id: str, organization_id, updates: Dict[str, Any]
    ) -> LabelPrinter:
        printer = await self.get_printer(printer_id, organization_id)

        if "name" in updates:
            name = str(updates.get("name") or "").strip()
            if not name:
                raise ValueError("Printer name is required")
            clash = await self.db.scalar(
                select(LabelPrinter).where(
                    LabelPrinter.organization_id == str(organization_id),
                    LabelPrinter.name == name,
                    LabelPrinter.id != printer.id,
                )
            )
            if clash is not None:
                raise ValueError(f"A printer named {name!r} already exists")
            updates = {**updates, "name": name}

        # Validate the resulting configuration, not just the changed keys — a
        # format switched to "custom" without dimensions is only detectable
        # against the merged values.
        merged = {
            "host": updates.get("host", printer.host),
            "port": updates.get("port", printer.port),
            "dpi": updates.get("dpi", printer.dpi),
            "label_format": updates.get("label_format", printer.label_format),
            "custom_width": updates.get("custom_width", printer.custom_width),
            "custom_height": updates.get("custom_height", printer.custom_height),
            "darkness": updates.get("darkness", printer.darkness),
        }
        _validate_printer_config(**merged)

        apply_updates(printer, updates, skip={"organization_id", "id", "created_by_id"})

        if updates.get("is_default"):
            await self._clear_other_defaults(organization_id, keep_id=printer.id)
        await self.db.flush()
        return printer

    async def delete_printer(self, printer_id: str, organization_id) -> None:
        printer = await self.get_printer(printer_id, organization_id)
        was_default = printer.is_default
        await self.db.delete(printer)
        await self.db.flush()

        # Promote another printer rather than leaving the organization with
        # none marked, which would make the print page open with no selection.
        if was_default:
            remaining = await self.list_printers(organization_id)
            if remaining:
                remaining[0].is_default = True
                await self.db.flush()

    # ------------------------------------------------------------------
    # Printing
    # ------------------------------------------------------------------

    async def _resolve_printer(
        self, organization_id, printer_id: Optional[str]
    ) -> LabelPrinter:
        if printer_id:
            printer = await self.get_printer(printer_id, organization_id)
        else:
            printers = await self.list_printers(organization_id)
            if not printers:
                raise ValueError(
                    "No label printer is configured. Add one in Organization "
                    "Settings > Label Printers."
                )
            printer = printers[0]
        if not printer.is_active:
            raise ValueError(f"Printer {printer.name!r} is disabled")
        return printer

    def _job_settings(
        self,
        printer: LabelPrinter,
        label_format: Optional[str],
        custom_width: Optional[float],
        custom_height: Optional[float],
    ) -> Tuple[str, Optional[float], Optional[float]]:
        """Per-job overrides fall back to the printer's loaded stock.

        A caller that overrides the format supplies its own custom dimensions;
        inheriting the printer's would silently print at the wrong size.
        """
        if label_format:
            return label_format, custom_width, custom_height
        return printer.label_format, printer.custom_width, printer.custom_height

    async def print_labels(
        self,
        organization_id,
        module: str,
        ids: List[str],
        printer_id: Optional[str] = None,
        label_format: Optional[str] = None,
        custom_width: Optional[float] = None,
        custom_height: Optional[float] = None,
        copies: int = 1,
        extra_lines: Optional[List[str]] = None,
        exclude_ids: Optional[Set[str]] = None,
        symbology: str = SYMBOLOGY_CODE128,
    ) -> Dict[str, Any]:
        """Build, render and send labels for *module* records to a printer."""
        validate_symbology(symbology)
        entry = MODULE_LABELS.get(module)
        if entry is None:
            raise ValueError(f"Labels are not available for module: {module}")
        _, builder = entry

        printer = await self._resolve_printer(organization_id, printer_id)
        fmt, width, height = self._job_settings(
            printer, label_format, custom_width, custom_height
        )

        specs, auto_populated = await builder(
            self.db, str(organization_id), _filter_ids(ids, exclude_ids), extra_lines
        )
        if not specs:
            raise ValueError("No records found for label generation")
        if len(specs) * copies > MAX_LABELS_PER_JOB:
            raise ValueError(
                f"That is {len(specs) * copies} labels. Print at most "
                f"{MAX_LABELS_PER_JOB} at a time."
            )

        zpl = self.render_job(specs, printer, fmt, width, height, copies, symbology)
        await send_to_printer(printer.host, printer.port, zpl)

        return {
            "printer_id": printer.id,
            "printer_name": printer.name,
            "labels_sent": len(specs) * copies,
            "auto_populated": auto_populated,
            # Bytes on the wire is not a printed label. Asking afterwards is
            # what turns "sent 40 labels" into "sent 40 labels, printer is out
            # of stock" instead of a silent roll of nothing.
            **await self._post_print_report(printer),
        }

    def render_job(
        self,
        specs: List[LabelSpec],
        printer: LabelPrinter,
        label_format: str,
        custom_width: Optional[float],
        custom_height: Optional[float],
        copies: int = 1,
        symbology: str = SYMBOLOGY_CODE128,
    ) -> str:
        return render_zpl(
            specs,
            label_format=label_format,
            custom_width=custom_width,
            custom_height=custom_height,
            dpi=printer.dpi,
            darkness=printer.darkness,
            copies=copies,
            symbology=symbology,
        )

    async def _post_print_report(self, printer) -> Dict[str, Any]:
        """Ask the printer how it is, after a job has been sent.

        Best-effort by design: a status query that fails must never turn a
        successful print into a reported failure, so everything here degrades
        to "we do not know" rather than raising.
        """
        try:
            reply = await query_printer(printer.host, printer.port)
        except (ValueError, PrinterUnreachableError):
            return {
                "printer_errors": [],
                "printer_warnings": [],
                "status_known": False,
            }

        status = summarize(reply)
        return {
            "printer_errors": status["errors"],
            "printer_warnings": status["warnings"],
            "status_known": bool(status["status_available"]),
        }

    async def get_status(self, printer_id: str, organization_id) -> Dict[str, Any]:
        """Identity and fault status for a saved printer."""
        printer = await self.get_printer(printer_id, organization_id)
        reply = await query_printer(printer.host, printer.port)
        return {
            "printer_id": printer.id,
            "printer_name": printer.name,
            "configured_dpi": printer.dpi,
            **summarize(reply),
        }

    async def probe_target(self, host: str, port: int) -> Dict[str, Any]:
        """Identity and fault status for a host that is not saved yet.

        Lets somebody confirm an address before committing it, instead of
        having to save a printer, discover it is wrong, and edit it back. Same
        address and port guards as every other path — this widens no target.
        """
        validate_printer_port(port)
        reply = await query_printer(host, port)
        return summarize(reply)

    async def print_test_label(
        self,
        printer_id: str,
        organization_id,
        symbology: str = SYMBOLOGY_CODE128,
    ) -> Dict[str, Any]:
        """Send one self-describing label, to prove the path end to end.

        The label carries the printer's own name and a scannable value so the
        person can confirm three things at once: the job reached the printer,
        the stock size is right, and the barcode scans.
        """
        validate_symbology(symbology)
        printer = await self.get_printer(printer_id, organization_id)
        if not printer.is_active:
            raise ValueError(f"Printer {printer.name!r} is disabled")

        spec = LabelSpec(
            name=printer.name,
            barcode_value="TEST-LABEL",
            extra=f"{printer.dpi} dpi | {printer.label_format}",
        )
        zpl = self.render_job(
            [spec],
            printer,
            printer.label_format,
            printer.custom_width,
            printer.custom_height,
            copies=1,
            symbology=symbology,
        )
        await send_to_printer(printer.host, printer.port, zpl)
        return {
            "printer_id": printer.id,
            "printer_name": printer.name,
            **await self._post_print_report(printer),
        }
