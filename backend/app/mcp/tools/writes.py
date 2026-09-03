"""Write tools. Registered only for a connection the department set to
read/write, and even then every one of them creates something for a person
to review: a draft event, an open action item, a pending reorder request.
Nothing here publishes, approves, assigns or sends.

Rows are attributed to the administrator who issued the service key — a
service key has no member of its own — and the audit trail records the tool
call alongside. If that administrator's account is gone the writes refuse
rather than create an unattributed row.
"""

from typing import Any, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    iso,
    org_uuid,
    parse_date,
    parse_datetime,
    parse_uuid,
)
from app.models.event import EventType
from app.models.inventory import MEDICAL_ITEM_TYPES, ReorderUrgency
from app.models.user import User
from app.schemas.event import EventCreate
from app.services.event_service import EventService
from app.services.inventory_service import InventoryService
from app.services.meetings_service import MeetingsService

_PRIORITIES = {"normal": 0, "high": 1, "urgent": 2}

# Medical stock has its own module and officer; the inventory tools never
# show it, so a reorder must not be able to reach it either.
_MEDICAL_REORDER_REFUSED = (
    "Medical supplies are managed separately and cannot be reordered through "
    "this connection"
)


async def _actor(db: AsyncSession, principal: McpPrincipal) -> UUID:
    """The member writes are attributed to, verified to still exist in-org."""
    if not principal.issued_by_user_id:
        raise ValueError(
            "The administrator who issued this service key no longer has an "
            "account, so writes cannot be attributed. Issue a new key."
        )
    user = await db.get(User, principal.issued_by_user_id)
    if user is None or user.organization_id != principal.organization_id:
        raise ValueError("The issuing administrator's account was not found")
    # Deprovisioning is a soft delete or a status change, not a row delete:
    # an issuer who can no longer sign in must not keep signing writes.
    if not user.is_active:
        raise ValueError(
            "The administrator who issued this service key is no longer active, "
            "so writes cannot be attributed. Issue a new key."
        )
    return UUID(user.id)


def register(server: Any) -> None:
    @logbook_tool(server, title="Create draft event", gate="write")
    async def create_event_draft(
        db: AsyncSession,
        principal: McpPrincipal,
        title: str,
        start_datetime: str,
        end_datetime: str,
        event_type: str = "training",
        description: Optional[str] = None,
        location: Optional[str] = None,
        requires_rsvp: bool = False,
        is_mandatory: bool = False,
    ) -> dict:
        """Create an event as an unpublished draft for an officer to review and
        publish. Times are ISO-8601 (UTC unless an offset is given).
        ``event_type`` is one of the department's event types such as
        training, business_meeting, drill, fundraiser, social or other."""
        try:
            EventType(event_type)
        except ValueError:
            raise ValueError(
                "event_type must be one of: " + ", ".join(e.value for e in EventType)
            )
        start = parse_datetime(start_datetime, "start_datetime")
        end = parse_datetime(end_datetime, "end_datetime")
        if start is None or end is None:
            raise ValueError("start_datetime and end_datetime are required")
        actor = await _actor(db, principal)
        payload = EventCreate(
            title=title.strip(),
            description=description or None,
            event_type=event_type,
            location=location or None,
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=requires_rsvp,
            is_mandatory=is_mandatory,
            is_draft=True,
        )
        event = await EventService(db).create_event(payload, org_uuid(principal), actor)
        return {
            "id": event.id,
            "title": event.title,
            "event_type": iso(event.event_type),
            "start_datetime": iso(event.start_datetime),
            "end_datetime": iso(event.end_datetime),
            "is_draft": bool(event.is_draft),
        }

    @logbook_tool(server, title="Create action item", gate="write", module="minutes")
    async def create_meeting_action_item(
        db: AsyncSession,
        principal: McpPrincipal,
        meeting_id: str,
        description: str,
        assigned_to_member_id: Optional[str] = None,
        due_date: Optional[str] = None,
        priority: str = "normal",
    ) -> dict:
        """Add an open action item to a meeting. ``priority`` is normal, high
        or urgent; ``due_date`` is YYYY-MM-DD; the assignee is a member id
        from list_members."""
        if priority not in _PRIORITIES:
            raise ValueError("priority must be normal, high or urgent")
        await _actor(db, principal)
        data: dict[str, Any] = {
            "description": description.strip(),
            "priority": _PRIORITIES[priority],
        }
        if assigned_to_member_id:
            data["assigned_to"] = str(parse_uuid(assigned_to_member_id, "member_id"))
        due = parse_date(due_date, "due_date")
        if due is not None:
            data["due_date"] = due
        if not data["description"]:
            raise ValueError("description is required")
        item, error = await MeetingsService(db).create_action_item(
            parse_uuid(meeting_id, "meeting_id"), org_uuid(principal), data
        )
        if item is None:
            raise ValueError(error or "Action item could not be created")
        return {
            "id": item.id,
            "meeting_id": item.meeting_id,
            "description": item.description,
            "assigned_to_member_id": item.assigned_to,
            "due_date": iso(item.due_date),
            "status": iso(item.status),
            "priority": item.priority,
        }

    @logbook_tool(
        server, title="Create reorder request", gate="write", module="inventory"
    )
    async def create_reorder_request(
        db: AsyncSession,
        principal: McpPrincipal,
        item_name: str,
        quantity: int,
        urgency: str = "normal",
        item_id: Optional[str] = None,
        category_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> dict:
        """Open a pending inventory reorder request for the quartermaster to
        approve. ``urgency`` is low, normal, high or critical. Link an
        existing item or category by id when known. Medical supplies cannot
        be reordered through this connection."""
        try:
            urgency_value = ReorderUrgency(urgency.lower())
        except ValueError:
            raise ValueError("urgency must be low, normal, high or critical")
        if quantity <= 0:
            raise ValueError("quantity must be at least 1")
        actor = await _actor(db, principal)
        data: dict[str, Any] = {
            "item_name": item_name.strip(),
            "quantity_requested": quantity,
            "urgency": urgency_value,
            "notes": notes or None,
        }
        if not data["item_name"]:
            raise ValueError("item_name is required")
        service = InventoryService(db)
        if item_id:
            data["item_id"] = str(parse_uuid(item_id, "item_id"))
            if await service.item_in_domain(
                data["item_id"], principal.organization_id, MEDICAL_ITEM_TYPES
            ):
                raise ValueError(_MEDICAL_REORDER_REFUSED)
        if category_id:
            data["category_id"] = str(parse_uuid(category_id, "category_id"))
            if await service.category_in_domain(
                data["category_id"], principal.organization_id, MEDICAL_ITEM_TYPES
            ):
                raise ValueError(_MEDICAL_REORDER_REFUSED)
        reorder, error = await service.create_reorder_request(
            org_uuid(principal), data, str(actor)
        )
        if reorder is None:
            raise ValueError(error or "Reorder request could not be created")
        await db.commit()
        return {
            "id": reorder.id,
            "item_name": reorder.item_name,
            "quantity_requested": reorder.quantity_requested,
            "urgency": iso(reorder.urgency),
            "status": iso(reorder.status),
        }
