"""
Inventory Notification Service

Handles queuing inventory change events and processing them into
consolidated email notifications.  The delayed-send approach means
offsetting actions (e.g. issue a shirt, then return it within the
delay window) are netted out so members aren't confused by redundant
messages.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional

from loguru import logger
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.inventory import (
    InventoryActionType,
    InventoryItem,
    InventoryNotificationQueue,
)
from app.models.user import User, Organization
from app.services.email_service import EmailService
from app.services.email_template_service import (
    EmailTemplateService,
    DEFAULT_INVENTORY_CHANGE_SUBJECT,
    DEFAULT_INVENTORY_CHANGE_HTML,
    DEFAULT_INVENTORY_CHANGE_TEXT,
    DEFAULT_CSS,
)
from app.models.email_template import EmailTemplateType


# Pairs of actions that cancel each other out for the same item
_NETTING_PAIRS = {
    InventoryActionType.ASSIGNED: InventoryActionType.UNASSIGNED,
    InventoryActionType.UNASSIGNED: InventoryActionType.ASSIGNED,
    InventoryActionType.ISSUED: InventoryActionType.RETURNED,
    InventoryActionType.RETURNED: InventoryActionType.ISSUED,
    InventoryActionType.CHECKED_OUT: InventoryActionType.CHECKED_IN,
    InventoryActionType.CHECKED_IN: InventoryActionType.CHECKED_OUT,
}

# Actions that represent an item going TO the member
_OUTGOING_ACTIONS = {
    InventoryActionType.ASSIGNED,
    InventoryActionType.ISSUED,
    InventoryActionType.CHECKED_OUT,
}

# Human-readable labels
_ACTION_LABELS = {
    InventoryActionType.ASSIGNED: "Permanently Assigned",
    InventoryActionType.UNASSIGNED: "Returned (Unassigned)",
    InventoryActionType.ISSUED: "Issued",
    InventoryActionType.RETURNED: "Returned",
    InventoryActionType.CHECKED_OUT: "Checked Out",
    InventoryActionType.CHECKED_IN: "Checked In",
}


class InventoryNotificationService:
    """Service for queuing and processing inventory change notifications."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Queue an event
    # ------------------------------------------------------------------

    async def queue_notification(
        self,
        organization_id: str,
        user_id: str,
        action_type: InventoryActionType,
        item: InventoryItem,
        quantity: int = 1,
        performed_by: Optional[str] = None,
    ) -> None:
        """
        Add an inventory change event to the notification queue.
        Called by the inventory service after every successful mutation.
        """
        record = InventoryNotificationQueue(
            id=generate_uuid(),
            organization_id=organization_id,
            user_id=user_id,
            action_type=action_type,
            item_id=item.id,
            item_name=item.name,
            item_serial_number=item.serial_number,
            item_asset_tag=item.asset_tag,
            quantity=quantity,
            performed_by=performed_by,
            processed=False,
        )
        self.db.add(record)
        # Don't commit here — let the calling service's commit capture this

    # ------------------------------------------------------------------
    # Process the queue (called by scheduled task)
    # ------------------------------------------------------------------

    async def process_pending_notifications(
        self,
        delay_minutes: int = 60,
    ) -> Dict[str, Any]:
        """
        Find all unprocessed queue records older than *delay_minutes*,
        consolidate per member, net out cancelling pairs, and send one
        email per member.

        Returns a summary dict suitable for the scheduled-task response.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=delay_minutes)

        # Fetch pending records older than the cutoff
        result = await self.db.execute(
            select(InventoryNotificationQueue)
            .where(
                InventoryNotificationQueue.processed == False,  # noqa: E712
                InventoryNotificationQueue.created_at <= cutoff,
            )
            .order_by(
                InventoryNotificationQueue.organization_id,
                InventoryNotificationQueue.user_id,
                InventoryNotificationQueue.created_at,
            )
        )
        records = list(result.scalars().all())

        if not records:
            return {"task": "inventory_notifications", "emails_sent": 0, "records_processed": 0}

        # Group by (org_id, user_id)
        grouped: Dict[tuple, List[InventoryNotificationQueue]] = defaultdict(list)
        for rec in records:
            grouped[(rec.organization_id, rec.user_id)].append(rec)

        emails_sent = 0
        records_processed = 0

        for (org_id, member_id), member_records in grouped.items():
            try:
                net_items = self._net_actions(member_records)

                # If everything netted out, mark processed and skip email
                if not net_items:
                    for rec in member_records:
                        rec.processed = True
                        rec.processed_at = datetime.now(timezone.utc)
                    records_processed += len(member_records)
                    continue

                # Load user + org for email
                user = await self._get_user(member_id)
                org = await self._get_organization(org_id)

                if not user or not user.email:
                    logger.warning(f"No email for user {member_id}, skipping inventory notification")
                    for rec in member_records:
                        rec.processed = True
                        rec.processed_at = datetime.now(timezone.utc)
                    records_processed += len(member_records)
                    continue

                # Build email content
                issued_items = [n for n in net_items if n["action_type"] in _OUTGOING_ACTIONS]
                returned_items = [n for n in net_items if n["action_type"] not in _OUTGOING_ACTIONS]

                items_issued_html = self._build_item_list_html(issued_items, "Items Issued / Assigned")
                items_returned_html = self._build_item_list_html(returned_items, "Items Returned")
                items_issued_text = self._build_item_list_text(issued_items, "Items Issued / Assigned")
                items_returned_text = self._build_item_list_text(returned_items, "Items Returned")

                context = {
                    "first_name": user.first_name or "Member",
                    "organization_name": org.name if org else "Your Department",
                    "change_date": datetime.now(timezone.utc).strftime("%B %d, %Y"),
                    "items_issued_html": items_issued_html,
                    "items_returned_html": items_returned_html,
                    "items_issued_text": items_issued_text,
                    "items_returned_text": items_returned_text,
                }

                sent = await self._send_notification_email(user, org, context)
                if sent:
                    emails_sent += 1

                # Mark all records as processed
                for rec in member_records:
                    rec.processed = True
                    rec.processed_at = datetime.now(timezone.utc)
                records_processed += len(member_records)

            except Exception as e:
                logger.error(f"Failed to process inventory notifications for user {member_id}: {e}")

        await self.db.commit()

        logger.info(f"Inventory notifications: {emails_sent} emails sent, {records_processed} records processed")
        return {
            "task": "inventory_notifications",
            "emails_sent": emails_sent,
            "records_processed": records_processed,
        }

    # ------------------------------------------------------------------
    # Netting logic
    # ------------------------------------------------------------------

    def _net_actions(
        self, records: List[InventoryNotificationQueue]
    ) -> List[Dict[str, Any]]:
        """
        Net out offsetting actions for the same item_id.

        For quantity-based actions (issued/returned), quantities are
        subtracted.  For binary actions (assigned/unassigned,
        checked_out/checked_in) the actions cancel fully.

        Returns a list of dicts representing only the net changes.
        """
        # Accumulate per item_id: {action_type: total_quantity}
        per_item: Dict[str, Dict[InventoryActionType, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        # Keep item metadata keyed by item_id
        item_meta: Dict[str, Dict[str, Any]] = {}

        for rec in records:
            key = rec.item_id or rec.item_name  # fallback if item was deleted
            per_item[key][rec.action_type] += rec.quantity
            # Store latest metadata
            item_meta[key] = {
                "item_id": rec.item_id,
                "item_name": rec.item_name,
                "item_serial_number": rec.item_serial_number,
                "item_asset_tag": rec.item_asset_tag,
            }

        net_items = []

        for item_key, actions in per_item.items():
            meta = item_meta[item_key]

            # Net offsetting pairs
            for action, opposite in _NETTING_PAIRS.items():
                if action in actions and opposite in actions:
                    net_qty = min(actions[action], actions[opposite])
                    actions[action] -= net_qty
                    actions[opposite] -= net_qty

            # Emit only non-zero net actions
            for action_type, qty in actions.items():
                if qty > 0:
                    net_items.append({
                        "action_type": action_type,
                        "quantity": qty,
                        **meta,
                    })

        return net_items

    # ------------------------------------------------------------------
    # Email rendering helpers
    # ------------------------------------------------------------------

    def _build_item_list_html(
        self, items: List[Dict[str, Any]], heading: str
    ) -> str:
        if not items:
            return ""

        rows = ""
        for item in items:
            identifier = item.get("item_serial_number") or item.get("item_asset_tag") or ""
            qty_str = f" (x{item['quantity']})" if item["quantity"] > 1 else ""
            label = _ACTION_LABELS.get(item["action_type"], str(item["action_type"]))
            id_display = f" — {identifier}" if identifier else ""
            rows += f"<li><strong>{item['item_name']}</strong>{id_display}{qty_str} <em>({label})</em></li>\n"

        return f"""<h3 style="margin-top: 20px;">{heading}</h3>
<ul style="margin: 8px 0; padding-left: 20px;">
{rows}</ul>"""

    def _build_item_list_text(
        self, items: List[Dict[str, Any]], heading: str
    ) -> str:
        if not items:
            return ""

        lines = [f"{heading}:", ""]
        for item in items:
            identifier = item.get("item_serial_number") or item.get("item_asset_tag") or ""
            qty_str = f" (x{item['quantity']})" if item["quantity"] > 1 else ""
            label = _ACTION_LABELS.get(item["action_type"], str(item["action_type"]))
            id_display = f" — {identifier}" if identifier else ""
            lines.append(f"  - {item['item_name']}{id_display}{qty_str} ({label})")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Email sending
    # ------------------------------------------------------------------

    async def _send_notification_email(
        self,
        user: User,
        org: Optional[Organization],
        context: Dict[str, Any],
    ) -> bool:
        """Render and send the inventory change email."""
        import re

        subject = None
        html_body = None
        text_body = None

        # Try loading the admin-configured template
        if org:
            try:
                template_service = EmailTemplateService(self.db)
                template = await template_service.get_template(
                    str(org.id), EmailTemplateType.INVENTORY_CHANGE
                )
                if template:
                    subject, html_body, text_body = template_service.render(template, context)
            except Exception as e:
                logger.warning(f"Failed to load inventory change email template: {e}")

        # Fallback to defaults
        if not subject:
            def _replace(text: str) -> str:
                def replacer(match):
                    var = match.group(1).strip()
                    return str(context.get(var, match.group(0)))
                return re.sub(r'\{\{(\s*\w+\s*)\}\}', replacer, text)

            subject = _replace(DEFAULT_INVENTORY_CHANGE_SUBJECT)
            html_body = (
                f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head>"
                f"<body>{_replace(DEFAULT_INVENTORY_CHANGE_HTML)}</body></html>"
            )
            text_body = _replace(DEFAULT_INVENTORY_CHANGE_TEXT)

        # Send
        email_service = EmailService(organization=org)
        success, _ = await email_service.send_email(
            to_emails=[user.email],
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )
        return success > 0

    # ------------------------------------------------------------------
    # Data loaders
    # ------------------------------------------------------------------

    async def _get_user(self, user_id: str) -> Optional[User]:
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def _get_organization(self, org_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        return result.scalar_one_or_none()
