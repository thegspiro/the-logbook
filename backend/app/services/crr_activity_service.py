"""Recording CRR activities, crediting their Admin Hours, and clearing resident
details after the department's retention period.

The rules (owner decisions, 2026-11-21/22):

* An activity is a log entry, or is recorded against an outreach event.
* Resident details (street address, name, phone, email) and notes are
  encrypted at rest, and only holders of ``crr.view_contact`` see them. The
  endpoint layer decides who sees; this service never returns them unless
  asked.
* A log entry credits Admin Hours to the members who carried it out: the
  activity type's own category if it has one, otherwise the department's
  mapping for Public Education events (the fallback apparatus nights use). An
  activity recorded against an event credits nothing, because the event's
  attendance already does.
* Resident details are cleared after the department's retention period, 24
  months unless it chose otherwise; the ZIP code, city, state, county and the
  counts are kept for audit.
"""

import calendar
import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
)
from app.models.crr import (
    CrrActivity,
    CrrActivityCount,
    CrrActivityMeasure,
    CrrActivityMember,
    CrrActivityTag,
    CrrActivityType,
    CrrTag,
)
from app.models.event import Event
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.schemas.base import as_utc
from app.services.admin_hours_service import AdminHoursService
from app.services.crr_catalogue_service import (
    MAX_RETENTION_MONTHS,
    MIN_RETENTION_MONTHS,
    CrrCatalogueService,
    retention_months,
)
from app.services.dashboard_widget_service import is_outreach_event
from app.services.zip_lookup import lookup_zip, normalize_zip

#: Fields only crr.view_contact holders see or change.
RESIDENT_FIELDS = (
    "street_address",
    "resident_name",
    "resident_phone",
    "resident_email",
)

_US_NAMES = {"us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"}


def months_before(moment: datetime, months: int) -> datetime:
    """The same day-of-month ``months`` earlier, clamped to that month's end."""
    total = moment.year * 12 + (moment.month - 1) - months
    year, month = divmod(total, 12)
    last_day = calendar.monthrange(year, month + 1)[1]
    return moment.replace(year=year, month=month + 1, day=min(moment.day, last_day))


def department_address(org: Organization) -> dict[str, Optional[str]]:
    """The department's own city, state and ZIP: its physical address, or its
    mailing address when the physical one is "the same"."""
    use_mailing = org.physical_address_same is not False
    prefix = "mailing" if use_mailing else "physical"
    return {
        "city": getattr(org, f"{prefix}_city"),
        "state": getattr(org, f"{prefix}_state"),
        "zip_code": getattr(org, f"{prefix}_zip"),
        "country": getattr(org, f"{prefix}_country"),
    }


def zip_lookup_enabled(org: Organization) -> bool:
    """On for a department whose own address is in the US (owner decision,
    2026-11-22); a blank country counts as the US, the column's default."""
    country = (department_address(org)["country"] or "").strip().lower()
    return country == "" or country in _US_NAMES


class CrrActivityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Form options

    async def form_options(self, organization_id: str) -> dict[str, Any]:
        org_id = str(organization_id)
        catalogue = await CrrCatalogueService(self.db).catalogue(org_id)
        org = await self.db.get(Organization, org_id)
        members = (
            await self.db.execute(
                select(User)
                .where(
                    User.organization_id == org_id,
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                    User.deleted_at.is_(None),
                )
                .order_by(User.last_name, User.first_name)
            )
        ).scalars()
        address = department_address(org) if org else {}
        return {
            "activity_types": [
                {**t, "measures": [m for m in t["measures"] if m["is_active"]]}
                for t in catalogue["activity_types"]
                if t["is_active"]
            ],
            "tags": [t for t in catalogue["tags"] if t["is_active"]],
            "default_city": address.get("city"),
            "default_state": address.get("state"),
            "zip_lookup_enabled": bool(org and zip_lookup_enabled(org)),
            "members": [{"id": u.id, "name": u.display_name} for u in members],
            "retention_months": retention_months(org),
        }

    # ------------------------------------------------------------------
    # Reads

    def _base_query(self, org_id: str):
        return (
            select(CrrActivity)
            .where(CrrActivity.organization_id == org_id)
            .options(
                selectinload(CrrActivity.counts),
                selectinload(CrrActivity.tag_links),
                selectinload(CrrActivity.members),
            )
        )

    async def list_activities(
        self,
        organization_id: str,
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        activity_type_id: Optional[str] = None,
        event_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[CrrActivity], int]:
        org_id = str(organization_id)
        query = self._base_query(org_id)
        count_query = select(func.count(CrrActivity.id)).where(
            CrrActivity.organization_id == org_id
        )
        filters = []
        if start is not None:
            filters.append(CrrActivity.occurred_at >= as_utc(start))
        if end is not None:
            filters.append(CrrActivity.occurred_at < as_utc(end))
        if activity_type_id:
            filters.append(CrrActivity.activity_type_id == str(activity_type_id))
        if event_id:
            filters.append(CrrActivity.event_id == str(event_id))
        query = query.where(*filters)
        count_query = count_query.where(*filters)
        total = int(await self.db.scalar(count_query) or 0)
        rows = (
            (
                await self.db.execute(
                    query.order_by(CrrActivity.occurred_at.desc(), CrrActivity.id)
                    .limit(limit)
                    .offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(rows), total

    async def get(self, organization_id: str, activity_id: str) -> CrrActivity:
        found: Optional[CrrActivity] = await self.db.scalar(
            self._base_query(str(organization_id))
            .where(CrrActivity.id == str(activity_id))
            .execution_options(populate_existing=True)
        )
        if found is None:
            raise LookupError("Activity not found")
        return found

    async def names(self, organization_id: str, activities: list[CrrActivity]) -> dict:
        """Labels the rows need: type, measure, tag, member and event names."""
        org_id = str(organization_id)
        type_ids = {a.activity_type_id for a in activities}
        user_ids = {m.user_id for a in activities for m in a.members} | {
            a.recorded_by for a in activities if a.recorded_by
        }
        event_ids = {a.event_id for a in activities if a.event_id}
        types = {
            t.id: t.name
            for t in (
                await self.db.execute(
                    select(CrrActivityType).where(
                        CrrActivityType.organization_id == org_id,
                        CrrActivityType.id.in_(type_ids or {""}),
                    )
                )
            ).scalars()
        }
        measures = {
            m.id: m.label
            for m in (
                await self.db.execute(
                    select(CrrActivityMeasure).where(
                        CrrActivityMeasure.organization_id == org_id
                    )
                )
            ).scalars()
        }
        tags = {
            t.id: t.label
            for t in (
                await self.db.execute(
                    select(CrrTag).where(CrrTag.organization_id == org_id)
                )
            ).scalars()
        }
        users = {
            u.id: u.display_name
            for u in (
                await self.db.execute(
                    select(User).where(
                        User.organization_id == org_id, User.id.in_(user_ids or {""})
                    )
                )
            ).scalars()
        }
        events = {
            eid: title
            for eid, title in (
                await self.db.execute(
                    select(Event.id, Event.title).where(
                        Event.organization_id == org_id,
                        Event.id.in_(event_ids or {""}),
                    )
                )
            ).all()
        }
        return {
            "types": types,
            "measures": measures,
            "tags": tags,
            "users": users,
            "events": events,
        }

    # ------------------------------------------------------------------
    # Validation helpers (pitfall #14c: every client-supplied id is in-org)

    async def _active_type(self, org_id: str, type_id: str) -> CrrActivityType:
        activity_type = await self.db.scalar(
            select(CrrActivityType)
            .where(
                CrrActivityType.id == str(type_id),
                CrrActivityType.organization_id == org_id,
            )
            .options(
                selectinload(CrrActivityType.measures),
                selectinload(CrrActivityType.tag_links),
            )
        )
        if activity_type is None:
            raise ValueError("Activity type not found")
        if not activity_type.is_active:
            raise ValueError(f"{activity_type.name} is retired")
        return activity_type

    @staticmethod
    def _counts(
        activity_type: CrrActivityType,
        counts: dict[str, int],
        already_counted: frozenset[str] = frozenset(),
    ) -> dict[str, int]:
        """Counts against the type's active measures, or against a retired one
        the activity already carries: retiring a count stops new tallies, it
        does not make an existing one uneditable."""
        allowed = {
            m.id: m
            for m in activity_type.measures
            if m.is_active or m.id in already_counted
        }
        for measure_id, quantity in counts.items():
            if measure_id not in allowed:
                raise ValueError("A count does not belong to this activity type")
            if quantity < 0:
                raise ValueError("A count cannot be negative")
        return {mid: q for mid, q in counts.items()}

    async def _tags(
        self,
        org_id: str,
        tag_ids: list[str],
        already_tagged: frozenset[str] = frozenset(),
    ) -> list[str]:
        """The department's own tags (pitfall #14c). A retired tag is refused
        unless the activity already carries it (owner decision, 2026-11-26):
        it may stay, or be removed, but is not newly added."""
        wanted = list(dict.fromkeys(str(t) for t in tag_ids))
        if not wanted:
            return []
        found = dict(
            (
                await self.db.execute(
                    select(CrrTag.id, CrrTag.is_active).where(
                        CrrTag.organization_id == org_id, CrrTag.id.in_(wanted)
                    )
                )
            ).all()
        )
        if set(found) != set(wanted):
            raise ValueError("One or more tags were not found")
        if any(not found[t] and t not in already_tagged for t in wanted):
            raise ValueError("A retired tag cannot be added")
        return wanted

    async def _members(self, org_id: str, members: dict[str, int]) -> dict[str, int]:
        if not members:
            return {}
        found = set(
            (
                await self.db.execute(
                    select(User.id).where(
                        User.organization_id == org_id,
                        User.id.in_(list(members)),
                        User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                        User.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
        if found != set(members):
            raise ValueError("One or more members were not found")
        for minutes in members.values():
            if minutes < 0 or minutes > 1440:
                raise ValueError("Time spent must be between 0 and 24 hours")
        return dict(members)

    @staticmethod
    def _location(zip_code: Optional[str], city: Optional[str], state: Optional[str]):
        """ZIP plus the place it names; a typed city or state wins over the
        lookup, because the GeoNames data is provided "as is"."""
        cleaned_zip = None
        county = None
        if zip_code and zip_code.strip():
            cleaned_zip = normalize_zip(zip_code)
            if cleaned_zip is None:
                raise ValueError("Enter a five-digit ZIP code")
            place = lookup_zip(cleaned_zip)
            if place is not None:
                city = city or place.city
                state = state or place.state
                county = place.county
        return {
            "zip_code": cleaned_zip,
            "city": (city or "").strip() or None,
            "state": (state or "").strip() or None,
            "county": county,
        }

    # ------------------------------------------------------------------
    # Writes

    async def create(
        self,
        organization_id: str,
        recorded_by: str,
        data: dict[str, Any],
        *,
        may_enter_resident_details: bool = True,
    ) -> CrrActivity:
        org_id = str(organization_id)
        activity_type = await self._active_type(org_id, data["activity_type_id"])
        counts = self._counts(activity_type, data.get("counts") or {})
        tag_ids = await self._tags(
            org_id,
            (
                data["tag_ids"]
                if data.get("tag_ids") is not None
                else [link.tag_id for link in activity_type.tag_links]
            ),
        )
        event_id = data.get("event_id")
        if event_id:
            if not await is_outreach_event(self.db, org_id, str(event_id)):
                raise ValueError("Activities can be recorded only on outreach events")
        members = await self._members(org_id, data.get("members") or {})
        if event_id and members:
            # Their time at the event is credited by its attendance.
            members = {}

        activity = CrrActivity(
            organization_id=org_id,
            activity_type_id=activity_type.id,
            event_id=str(event_id) if event_id else None,
            occurred_at=as_utc(data["occurred_at"]),
            recorded_by=str(recorded_by),
            notes=(data.get("notes") or "").strip() or None,
            **self._location(data.get("zip_code"), data.get("city"), data.get("state")),
        )
        if data.get("has_resident_details") and may_enter_resident_details:
            for field in RESIDENT_FIELDS:
                value = (data.get(field) or "").strip()
                setattr(activity, field, value or None)
        self.db.add(activity)
        await self.db.flush()

        for measure_id, quantity in counts.items():
            self.db.add(
                CrrActivityCount(
                    organization_id=org_id,
                    activity_id=activity.id,
                    measure_id=measure_id,
                    quantity=quantity,
                )
            )
        for tag_id in tag_ids:
            self.db.add(
                CrrActivityTag(
                    organization_id=org_id, activity_id=activity.id, tag_id=tag_id
                )
            )
        for user_id, minutes in members.items():
            self.db.add(
                CrrActivityMember(
                    organization_id=org_id,
                    activity_id=activity.id,
                    user_id=user_id,
                    minutes=minutes,
                )
            )
        await self.db.flush()
        if members and not activity.event_id:
            await self._credit_hours(org_id, activity, activity_type, members)
        return await self.get(org_id, activity.id)

    async def _categories(
        self, org_id: str, activity_type: CrrActivityType
    ) -> list[tuple[str, int, Optional[AdminHoursCategory]]]:
        """(category id, percentage, category) to credit, by the type's own
        category or else the Public Education mapping. Replaces the mapping
        rather than adding to it, so nothing is credited twice."""
        if activity_type.admin_hours_category_id:
            category = await self.db.scalar(
                select(AdminHoursCategory).where(
                    AdminHoursCategory.id == activity_type.admin_hours_category_id,
                    AdminHoursCategory.organization_id == org_id,
                    AdminHoursCategory.is_active.is_(True),
                )
            )
            return [(category.id, 100, category)] if category else []
        return await AdminHoursService(self.db).get_mappings_for_event(
            org_id, "public_education", None
        )

    async def _credit_hours(
        self,
        org_id: str,
        activity: CrrActivity,
        activity_type: CrrActivityType,
        members: dict[str, int],
    ) -> None:
        categories = await self._categories(org_id, activity_type)
        start = as_utc(activity.occurred_at)
        for user_id, minutes in members.items():
            if minutes <= 0:
                continue
            for category_id, percentage, category in categories:
                share = max(1, int(minutes * percentage / 100))
                status = AdminHoursService._determine_post_clockout_status(
                    category, share
                )
                entry = AdminHoursEntry(
                    organization_id=org_id,
                    user_id=user_id,
                    category_id=category_id,
                    clock_in_at=start,
                    clock_out_at=start + timedelta(minutes=minutes),
                    duration_minutes=share,
                    description=f"CRR activity: {activity_type.name}",
                    entry_method=AdminHoursEntryMethod.CRR_ACTIVITY,
                    status=status,
                    source_crr_activity_id=activity.id,
                )
                if status == AdminHoursEntryStatus.APPROVED:
                    entry.approved_at = start + timedelta(minutes=minutes)
                self.db.add(entry)
        await self.db.flush()

    async def update(
        self,
        organization_id: str,
        activity_id: str,
        data: dict[str, Any],
        *,
        may_edit_resident_details: bool,
    ) -> CrrActivity:
        """Change the counts, tags, location, notes and resident details.

        The type, the event, when it happened and who carried it out are fixed
        once recorded, because Admin Hours were credited from them; to change
        those, delete the activity and record it again.
        """
        org_id = str(organization_id)
        activity = await self.get(org_id, activity_id)
        activity_type = await self.db.scalar(
            select(CrrActivityType)
            .where(
                CrrActivityType.id == activity.activity_type_id,
                CrrActivityType.organization_id == org_id,
            )
            .options(selectinload(CrrActivityType.measures))
        )
        if activity_type is None:
            raise LookupError("Activity type not found")

        if "counts" in data and data["counts"] is not None:
            existing = set(
                (
                    await self.db.execute(
                        select(CrrActivityCount.measure_id).where(
                            CrrActivityCount.activity_id == activity.id
                        )
                    )
                ).scalars()
            )
            counts = self._counts(activity_type, data["counts"], frozenset(existing))
            # Replaces the active counts and any sent; a retired count the
            # payload leaves out keeps its tally, because the form cannot
            # offer it and so its absence is not a request to erase it.
            active = {m.id for m in activity_type.measures if m.is_active}
            await self.db.execute(
                delete(CrrActivityCount).where(
                    CrrActivityCount.activity_id == activity.id,
                    CrrActivityCount.measure_id.in_(active | set(counts)),
                )
            )
            for measure_id, quantity in counts.items():
                self.db.add(
                    CrrActivityCount(
                        organization_id=org_id,
                        activity_id=activity.id,
                        measure_id=measure_id,
                        quantity=quantity,
                    )
                )
        if "tag_ids" in data and data["tag_ids"] is not None:
            current = set(
                (
                    await self.db.execute(
                        select(CrrActivityTag.tag_id).where(
                            CrrActivityTag.activity_id == activity.id
                        )
                    )
                ).scalars()
            )
            tag_ids = await self._tags(org_id, data["tag_ids"], frozenset(current))
            await self.db.execute(
                delete(CrrActivityTag).where(CrrActivityTag.activity_id == activity.id)
            )
            for tag_id in tag_ids:
                self.db.add(
                    CrrActivityTag(
                        organization_id=org_id, activity_id=activity.id, tag_id=tag_id
                    )
                )
        if {"zip_code", "city", "state"} & set(data):
            # A new ZIP brings its own city and state unless they are sent
            # too; the old ones described the old ZIP.
            new_zip = "zip_code" in data
            location = self._location(
                data.get("zip_code", activity.zip_code),
                data.get("city", None if new_zip else activity.city),
                data.get("state", None if new_zip else activity.state),
            )
            for field, value in location.items():
                setattr(activity, field, value)
        if "notes" in data:
            activity.notes = (data["notes"] or "").strip() or None

        touched = [f for f in RESIDENT_FIELDS if f in data]
        if touched:
            if not may_edit_resident_details:
                raise PermissionError(
                    "Only members who can see resident details can change them"
                )
            if activity.resident_details_cleared_at is not None:
                raise ValueError(
                    "This activity's resident details were cleared after the "
                    "retention period and cannot be added back"
                )
            for field in touched:
                setattr(activity, field, (data[field] or "").strip() or None)
        await self.db.flush()
        return await self.get(org_id, activity.id)

    async def delete(self, organization_id: str, activity_id: str) -> None:
        """Delete an activity and the Admin Hours it credited.

        Only entries this service created are removed; one an officer has since
        re-entered by hand is theirs, the rule event attendance follows.
        """
        org_id = str(organization_id)
        activity = await self.get(org_id, activity_id)
        await self.db.execute(
            delete(AdminHoursEntry).where(
                AdminHoursEntry.organization_id == org_id,
                AdminHoursEntry.source_crr_activity_id == activity.id,
                AdminHoursEntry.entry_method == AdminHoursEntryMethod.CRR_ACTIVITY,
            )
        )
        await self.db.delete(activity)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Retention

    async def set_retention_months(self, organization_id: str, months: int) -> int:
        if not MIN_RETENTION_MONTHS <= months <= MAX_RETENTION_MONTHS:
            raise ValueError(
                f"Keep resident details between {MIN_RETENTION_MONTHS} and "
                f"{MAX_RETENTION_MONTHS} months"
            )
        org = await self.db.scalar(
            select(Organization).where(Organization.id == str(organization_id))
        )
        if org is None:
            raise LookupError("Organization not found")
        settings = copy.deepcopy(org.settings or {})  # pitfall #12
        existing = settings.get("crr")
        crr: dict[str, Any] = dict(existing) if isinstance(existing, dict) else {}
        crr["resident_details_retention_months"] = months
        settings["crr"] = crr
        org.settings = settings
        await self.db.flush()
        return months

    async def clear_expired_resident_details(
        self, organization: Organization, now: Optional[datetime] = None
    ) -> int:
        """Clear resident details older than the retention period; caller commits.

        Safe to run any number of times (pitfall #36): an activity is cleared
        once, stamped, and skipped by every later run.
        """
        moment = now or datetime.now(timezone.utc)
        cutoff = months_before(moment, retention_months(organization))
        activities = (
            (
                await self.db.execute(
                    select(CrrActivity).where(
                        CrrActivity.organization_id == str(organization.id),
                        CrrActivity.occurred_at < cutoff,
                        CrrActivity.resident_details_cleared_at.is_(None),
                        # Only rows holding something to clear: the stamp is
                        # what the page reads as "details were cleared", so an
                        # activity that never had any must not carry it.
                        or_(
                            *(
                                getattr(CrrActivity, field).isnot(None)
                                for field in (*RESIDENT_FIELDS, "notes")
                            )
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        for activity in activities:
            for field in RESIDENT_FIELDS:
                setattr(activity, field, None)
            # Notes are free text, where resident details turn up.
            activity.notes = None
            activity.resident_details_cleared_at = moment
        if activities:
            await self.db.flush()
        return len(activities)
