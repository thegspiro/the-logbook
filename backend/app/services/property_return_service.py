"""
Property Return Report Service

Generates a formal property-return letter when a member's status
changes to dropped_voluntary or dropped_involuntary.

The report:
  - Lists every inventory item assigned to the member with dollar values
  - Includes predefined language about returning department property
  - Is formatted as a printable HTML document (suitable for email or postal mail)
  - Is saved to the Documents module for record-keeping
"""

import logging
from datetime import date, datetime, timedelta, timezone
from html import escape
from zoneinfo import ZoneInfo
from typing import Dict, Any, Optional, List, Tuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.user import User, Organization, UserStatus
from app.models.inventory import InventoryItem, ItemAssignment, CheckOutRecord
from app.models.document import Document, DocumentFolder, DocumentType, DocumentStatus

logger = logging.getLogger(__name__)


class PropertyReturnService:
    """Generates and stores property-return reports for dropped members."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_report(
        self,
        user_id: str,
        organization_id: str,
        drop_type: str,
        performed_by: str,
        return_deadline_days: int = 14,
        custom_instructions: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], str]:
        """
        Generate a property-return report for a dropped member.

        Args:
            user_id: The dropped member's user ID.
            organization_id: The organization ID.
            drop_type: "dropped_voluntary" or "dropped_involuntary".
            performed_by: User ID of the officer performing the drop.
            return_deadline_days: Days the member has to return property.
            custom_instructions: Optional extra paragraph added to the letter.
            reason: Reason for the status change (included in the notification).

        Returns:
            Tuple of (report_data dict, html_content string).
        """
        # Load member
        result = await self.db.execute(
            select(User).where(User.id == str(user_id))
        )
        member = result.scalar_one_or_none()
        if not member:
            raise ValueError(f"Member {user_id} not found")

        # Load organization
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        org_name = org.name if org else "Department"
        org_tz = ZoneInfo(org.timezone) if org and org.timezone else ZoneInfo("America/New_York")

        # Load the officer who performed the action
        officer_result = await self.db.execute(
            select(User).where(User.id == performed_by)
        )
        officer = officer_result.scalar_one_or_none()

        # Gather assigned items (permanent assignments)
        assign_result = await self.db.execute(
            select(ItemAssignment)
            .where(
                ItemAssignment.organization_id == organization_id,
                ItemAssignment.user_id == user_id,
                ItemAssignment.is_active == True,  # noqa: E712
            )
            .options(selectinload(ItemAssignment.item))
        )
        assignments = assign_result.scalars().all()

        # Gather checked-out items
        checkout_result = await self.db.execute(
            select(CheckOutRecord)
            .where(
                CheckOutRecord.organization_id == organization_id,
                CheckOutRecord.user_id == user_id,
                CheckOutRecord.is_returned == False,  # noqa: E712
            )
            .options(selectinload(CheckOutRecord.item))
        )
        checkouts = checkout_result.scalars().all()

        # Build item list with values
        items: List[Dict[str, Any]] = []
        total_value = 0.0

        for a in assignments:
            item = a.item
            value = float(item.current_value or item.purchase_price or 0)
            total_value += value
            items.append({
                "name": item.name,
                "serial_number": item.serial_number or "-",
                "asset_tag": item.asset_tag or "-",
                "condition": item.condition.value if item.condition else "unknown",
                "value": value,
                "type": "assigned",
                "assigned_date": a.assigned_date.astimezone(org_tz).strftime("%m/%d/%Y") if a.assigned_date else "-",
            })

        for c in checkouts:
            item = c.item
            value = float(item.current_value or item.purchase_price or 0)
            total_value += value
            items.append({
                "name": item.name,
                "serial_number": item.serial_number or "-",
                "asset_tag": item.asset_tag or "-",
                "condition": c.checkout_condition.value if c.checkout_condition else (item.condition.value if item.condition else "unknown"),
                "value": value,
                "type": "checked_out",
                "assigned_date": c.checked_out_at.astimezone(org_tz).strftime("%m/%d/%Y") if c.checked_out_at else "-",
            })

        today = date.today()
        return_deadline = today + timedelta(days=return_deadline_days)

        report_data = {
            "member_id": user_id,
            "member_name": member.full_name,
            "member_email": member.email,
            "member_address": self._format_address(member),
            "member_number": member.membership_number,
            "member_rank": member.rank,
            "organization_name": org_name,
            "organization_address": self._format_org_address(org) if org else "",
            "drop_type": drop_type,
            "drop_type_display": "Voluntary Separation" if drop_type == "dropped_voluntary" else "Involuntary Separation",
            "reason": reason,
            "effective_date": today.strftime("%B %d, %Y"),
            "return_deadline": return_deadline.strftime("%B %d, %Y"),
            "return_deadline_days": return_deadline_days,
            "items": items,
            "total_value": total_value,
            "item_count": len(items),
            "performed_by_name": officer.full_name if officer else "Department Administration",
            "performed_by_title": officer.rank if officer and officer.rank else "Administrator",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        html = self._render_html(report_data, custom_instructions, reason=reason)
        return report_data, html

    async def save_as_document(
        self,
        organization_id: str,
        member_name: str,
        html_content: str,
        created_by: str,
    ) -> Optional[Document]:
        """Save the report as a generated document in the Reports folder."""
        # Find the Reports system folder
        folder_result = await self.db.execute(
            select(DocumentFolder).where(
                DocumentFolder.organization_id == organization_id,
                DocumentFolder.name == "Reports",
                DocumentFolder.is_system == True,  # noqa: E712
            )
        )
        folder = folder_result.scalar_one_or_none()

        doc = Document(
            organization_id=organization_id,
            folder_id=str(folder.id) if folder else None,
            name=f"Property Return - {member_name} - {date.today().strftime('%Y-%m-%d')}",
            file_type="text/html",
            document_type=DocumentType.GENERATED,
            status=DocumentStatus.ACTIVE,
            content_html=html_content,
            source_type="property_return_report",
            tags="property-return,member-dropped,inventory",
            uploaded_by=created_by,
        )
        self.db.add(doc)
        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _format_address(user: User) -> str:
        parts = []
        if user.address_street:
            parts.append(user.address_street)
        city_state = ", ".join(
            filter(None, [user.address_city, user.address_state])
        )
        if city_state and user.address_zip:
            city_state += f" {user.address_zip}"
        if city_state:
            parts.append(city_state)
        return "\n".join(parts) if parts else ""

    @staticmethod
    def _format_org_address(org: Organization) -> str:
        if not org.settings:
            return ""
        addr = org.settings.get("address", {})
        if not addr:
            return ""
        parts = []
        if addr.get("street"):
            parts.append(addr["street"])
        city_state = ", ".join(filter(None, [addr.get("city"), addr.get("state")]))
        if city_state and addr.get("zip"):
            city_state += f" {addr['zip']}"
        if city_state:
            parts.append(city_state)
        return "\n".join(parts) if parts else ""

    def _render_html(
        self,
        data: Dict[str, Any],
        custom_instructions: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> str:
        """Render a printable, mailable HTML property return letter."""

        # Build the item rows
        item_rows = ""
        for idx, item in enumerate(data["items"], 1):
            item_type_label = "Assigned" if item["type"] == "assigned" else "Checked Out"
            item_rows += f"""
            <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">{idx}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{escape(item['name'])}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{escape(item['serial_number'])}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{escape(item['asset_tag'])}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-transform:capitalize;">{escape(item['condition'])}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{item_type_label}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${item['value']:,.2f}</td>
            </tr>"""

        no_items_row = ""
        if not data["items"]:
            no_items_row = """
            <tr>
                <td colspan="7" style="padding:16px;text-align:center;color:#6b7280;font-style:italic;">
                    No department property is currently assigned to this member.
                </td>
            </tr>"""

        member_address_block = ""
        if data["member_address"]:
            addr_html = escape(data["member_address"]).replace("\n", "<br/>")
            member_address_block = f"""
            <p style="margin:0 0 4px 0;">{escape(data['member_name'])}</p>
            <p style="margin:0;color:#374151;">{addr_html}</p>"""
        else:
            member_address_block = f"""
            <p style="margin:0;">{escape(data['member_name'])}</p>
            <p style="margin:0;color:#6b7280;font-style:italic;">(Address on file)</p>"""

        custom_paragraph = ""
        if custom_instructions:
            custom_paragraph = f"""
        <p style="margin:16px 0;">{escape(custom_instructions)}</p>"""

        involuntary_notice = ""
        if data["drop_type"] == "dropped_involuntary":
            involuntary_notice = """
        <p style="margin:16px 0;padding:12px;background-color:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">
            <strong>Important:</strong> Failure to return department property by the deadline
            listed above may result in the department pursuing recovery through all available
            legal remedies, which may include the cost of unreturned or damaged items.
        </p>"""

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <title>Property Return Notice — {escape(data['member_name'])}</title>
    <style>
        @media print {{
            body {{ margin: 0; }}
            .no-print {{ display: none; }}
        }}
        body {{
            font-family: "Times New Roman", Times, Georgia, serif;
            font-size: 13px;
            line-height: 1.5;
            color: #111827;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 48px;
        }}
        table {{ border-collapse: collapse; width: 100%; }}
        th {{
            background-color: #1f2937;
            color: white;
            padding: 10px 12px;
            text-align: left;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}
        th:last-child {{ text-align: right; }}
    </style>
</head>
<body>

    <!-- Letterhead -->
    <div style="border-bottom:3px solid #dc2626;padding-bottom:16px;margin-bottom:24px;">
        <h1 style="margin:0;font-size:22px;color:#111827;">{escape(data['organization_name'])}</h1>
        {f'<p style="margin:4px 0 0;color:#4b5563;font-size:12px;">{escape(data["organization_address"]).replace(chr(10)," | ")}</p>' if data['organization_address'] else ''}
    </div>

    <!-- Date -->
    <p style="text-align:right;color:#4b5563;margin:0 0 24px 0;">{escape(data['effective_date'])}</p>

    <!-- Member address block (for window envelope) -->
    <div style="margin-bottom:32px;">
        {member_address_block}
    </div>

    <!-- Subject -->
    <p style="margin:0 0 4px 0;"><strong>Re: {escape(data['drop_type_display'])} — Notice of Department Property Return</strong></p>
    {f'<p style="margin:0 0 20px 0;color:#4b5563;">Member #{escape(data["member_number"])}</p>' if data.get('member_number') else '<div style="margin-bottom:20px;"></div>'}

    <!-- Salutation -->
    <p style="margin:0 0 16px 0;">Dear {escape(data['member_name'])},</p>

    <!-- Body -->
    <p style="margin:0 0 16px 0;">
        This letter serves as formal notice that your membership status with
        <strong>{escape(data['organization_name'])}</strong> has been changed to
        <strong>{escape(data['drop_type_display'])}</strong> effective
        <strong>{escape(data['effective_date'])}</strong>.
    </p>

    {f'<p style="margin:0 0 16px 0;"><strong>Reason:</strong> {escape(reason)}</p>' if reason else ''}

    <p style="margin:0 0 16px 0;">
        In accordance with department policy, all department-issued property must be
        returned in its current condition no later than
        <strong>{escape(data['return_deadline'])}</strong>
        ({data['return_deadline_days']} days from the effective date of separation).
    </p>

    <p style="margin:0 0 16px 0;">
        The following items are currently recorded as assigned to you or checked out
        in your name. Please review this list carefully and arrange for their return.
    </p>

    <!-- Item table -->
    <table style="margin:24px 0;">
        <thead>
            <tr>
                <th style="width:40px;">#</th>
                <th>Item</th>
                <th>Serial #</th>
                <th>Asset Tag</th>
                <th>Condition</th>
                <th>Type</th>
                <th style="text-align:right;">Value</th>
            </tr>
        </thead>
        <tbody>
            {item_rows}
            {no_items_row}
        </tbody>
        <tfoot>
            <tr style="font-weight:bold;background-color:#f3f4f6;">
                <td colspan="6" style="padding:10px 12px;text-align:right;">Total Assessed Value:</td>
                <td style="padding:10px 12px;text-align:right;">${data['total_value']:,.2f}</td>
            </tr>
        </tfoot>
    </table>

    <!-- Return instructions -->
    <h3 style="margin:24px 0 8px 0;font-size:14px;">How to Return Department Property</h3>
    <ol style="margin:0 0 16px 0;padding-left:24px;">
        <li style="margin-bottom:8px;">
            <strong>In Person:</strong> Bring all items to the department station during
            normal business hours. A designated officer will inspect and receipt each item.
        </li>
        <li style="margin-bottom:8px;">
            <strong>By Appointment:</strong> Contact the department quartermaster or
            administration office to schedule a convenient drop-off time.
        </li>
        <li style="margin-bottom:8px;">
            <strong>By Mail or Courier:</strong> If you are unable to return items in person,
            ship them to the department address above via insured carrier. Include a copy of
            this letter in the package. The department is not responsible for items lost in
            transit; please retain tracking information.
        </li>
    </ol>

    <p style="margin:0 0 16px 0;">
        Upon receipt and inspection, a signed acknowledgment will be provided confirming
        the return of each item. Any items found to be damaged beyond normal wear and tear
        will be documented and you may be notified of applicable charges per department policy.
    </p>

    {involuntary_notice}
    {custom_paragraph}

    <p style="margin:16px 0;">
        If you believe this inventory list is inaccurate, or if any items listed were
        previously returned, please contact the department administration immediately so
        that records can be corrected before the return deadline.
    </p>

    <p style="margin:24px 0 8px 0;">Respectfully,</p>
    <div style="margin-bottom:48px;">
        <p style="margin:0;font-weight:bold;">{escape(data['performed_by_name'])}</p>
        <p style="margin:0;color:#4b5563;">{escape(data['performed_by_title'])}</p>
        <p style="margin:0;color:#4b5563;">{escape(data['organization_name'])}</p>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #d1d5db;padding-top:12px;font-size:11px;color:#6b7280;">
        <p style="margin:0;">
            This document was generated on {escape(data['effective_date'])} and constitutes an official
            departmental record. A copy has been placed in the member's file.
            Items listed reflect the department inventory system as of the date of this notice.
        </p>
    </div>

</body>
</html>"""
        return html
