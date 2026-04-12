"""
Seed Admin Hours Categories & Event-Hour Mappings

Provides default admin hours categories and optional event-type-to-category
mappings so organizations have common hour-tracking buckets out of the box.
Categories can be customised after seeding.
"""

from typing import Any, Dict, List

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.admin_hours import (
    AdminHoursCategory,
    EventHourMapping,
)

DEFAULT_ADMIN_HOURS_CATEGORIES: List[Dict[str, Any]] = [
    {
        "name": "Community Outreach",
        "description": (
            "Public education, open houses, school visits, fire prevention "
            "week, and other community engagement activities"
        ),
        "color": "#10B981",
        "require_approval": False,
        "auto_approve_under_hours": 8.0,
        "max_hours_per_session": 12.0,
        "sort_order": 1,
    },
    {
        "name": "Fundraising",
        "description": (
            "Fundraising events, campaigns, grant writing, donor outreach, "
            "and related activities"
        ),
        "color": "#F59E0B",
        "require_approval": False,
        "auto_approve_under_hours": 8.0,
        "max_hours_per_session": 12.0,
        "sort_order": 2,
    },
    {
        "name": "Administrative Work",
        "description": (
            "General administrative duties such as paperwork, data entry, "
            "policy review, and office tasks"
        ),
        "color": "#6366F1",
        "require_approval": True,
        "auto_approve_under_hours": 4.0,
        "max_hours_per_session": 10.0,
        "sort_order": 3,
    },
    {
        "name": "Station Maintenance",
        "description": (
            "Facility upkeep, cleaning, equipment maintenance, and "
            "station improvement projects"
        ),
        "color": "#8B5CF6",
        "require_approval": False,
        "auto_approve_under_hours": 8.0,
        "max_hours_per_session": 12.0,
        "sort_order": 4,
    },
    {
        "name": "Meetings & Governance",
        "description": (
            "Board meetings, committee meetings, officer meetings, "
            "and organizational governance activities"
        ),
        "color": "#3B82F6",
        "require_approval": False,
        "auto_approve_under_hours": 4.0,
        "max_hours_per_session": 8.0,
        "sort_order": 5,
    },
    {
        "name": "Volunteer Hours",
        "description": (
            "General volunteer time not covered by other categories, "
            "including standby, parades, and special events"
        ),
        "color": "#EC4899",
        "require_approval": False,
        "auto_approve_under_hours": 8.0,
        "max_hours_per_session": 16.0,
        "sort_order": 6,
    },
]

# Maps event types to admin hours category names so event attendance
# auto-credits the correct bucket.  Only categories that have a natural
# 1:1 relationship with an event type are included here.
DEFAULT_EVENT_HOUR_MAPPINGS: List[Dict[str, str]] = [
    {
        "event_type": "public_education",
        "category_name": "Community Outreach",
    },
    {
        "event_type": "fundraiser",
        "category_name": "Fundraising",
    },
    {
        "event_type": "business_meeting",
        "category_name": "Meetings & Governance",
    },
]


async def seed_admin_hours_categories(
    db: AsyncSession,
    organization_id: str,
    created_by: str,
) -> Dict[str, str]:
    """Seed default admin hours categories for an organization.

    Idempotent: skips categories that already exist (matched by name).

    Returns a mapping of category name -> category id.
    """
    logger.info("Seeding admin hours categories for organization %s", organization_id)
    category_map: Dict[str, str] = {}

    for cat_data in DEFAULT_ADMIN_HOURS_CATEGORIES:
        result = await db.execute(
            select(AdminHoursCategory).where(
                AdminHoursCategory.organization_id == organization_id,
                AdminHoursCategory.name == cat_data["name"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            logger.info("Admin hours category already exists: %s", cat_data["name"])
            category_map[cat_data["name"]] = existing.id
            continue

        cat_id = generate_uuid()
        category = AdminHoursCategory(
            id=cat_id,
            organization_id=organization_id,
            name=cat_data["name"],
            description=cat_data["description"],
            color=cat_data["color"],
            require_approval=cat_data["require_approval"],
            auto_approve_under_hours=cat_data["auto_approve_under_hours"],
            max_hours_per_session=cat_data["max_hours_per_session"],
            is_active=True,
            sort_order=cat_data["sort_order"],
            created_by=created_by,
        )
        db.add(category)
        category_map[cat_data["name"]] = cat_id
        logger.info("Created admin hours category: %s", cat_data["name"])

    await db.flush()
    logger.info("Admin hours categories seeded (%d total)", len(category_map))
    return category_map


async def seed_event_hour_mappings(
    db: AsyncSession,
    organization_id: str,
    category_map: Dict[str, str],
    created_by: str,
) -> int:
    """Seed default event-type-to-admin-hours-category mappings.

    Idempotent: skips mappings that already exist.

    Returns the number of mappings created.
    """
    created = 0

    for mapping_data in DEFAULT_EVENT_HOUR_MAPPINGS:
        cat_name = mapping_data["category_name"]
        cat_id = category_map.get(cat_name)
        if not cat_id:
            logger.warning(
                "Skipping event mapping for '%s' — category '%s' not found",
                mapping_data["event_type"],
                cat_name,
            )
            continue

        result = await db.execute(
            select(EventHourMapping).where(
                EventHourMapping.organization_id == organization_id,
                EventHourMapping.event_type == mapping_data["event_type"],
                EventHourMapping.admin_hours_category_id == cat_id,
            )
        )
        if result.scalar_one_or_none():
            logger.info(
                "Event mapping already exists: %s -> %s",
                mapping_data["event_type"],
                cat_name,
            )
            continue

        mapping = EventHourMapping(
            id=generate_uuid(),
            organization_id=organization_id,
            event_type=mapping_data["event_type"],
            admin_hours_category_id=cat_id,
            percentage=100,
            is_active=True,
            created_by=created_by,
        )
        db.add(mapping)
        created += 1
        logger.info(
            "Created event mapping: %s -> %s",
            mapping_data["event_type"],
            cat_name,
        )

    await db.flush()
    return created


async def seed_admin_hours_data(
    db: AsyncSession,
    organization_id: str,
    created_by: str,
) -> Dict[str, Any]:
    """Seed all admin hours defaults (categories + event mappings).

    Top-level entry point that orchestrates category and mapping seeding.
    Returns a summary of what was created.
    """
    category_map = await seed_admin_hours_categories(db, organization_id, created_by)
    mappings_created = await seed_event_hour_mappings(
        db, organization_id, category_map, created_by
    )

    return {
        "categories_count": len(category_map),
        "category_names": list(category_map.keys()),
        "mappings_created": mappings_created,
    }
