"""
Officer Service

Resolves which member currently holds each department office and turns that
into the ``{{president_name}}`` / ``{{chief_title}}`` style variables email
templates sign their messages with.

Resolution order for each office, highest priority first:

1. An explicit override stored on the ``organization_officers`` row.
2. The member linked to that row (``user_id``).
3. Auto-detection from the position slugs listed in ``OFFICE_CATALOG`` —
   so a department that never opens the Officers screen still signs its
   notices with the member who holds the matching position.

The resolved values are also written back to
``Organization.settings["officer_directory"]`` as a flat variable map.  That
snapshot is what ``EmailTemplateService.render()`` reads: rendering is
synchronous and already receives the organization, so the alternative would
be threading an async lookup through every one of the ten render call sites.
The snapshot is rebuilt whenever an office is saved, whenever the Officers
screen is loaded, and whenever a member record changes.
"""

import copy
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import (
    OFFICE_CATALOG,
    OFFICE_KEYS,
    OFFICE_VARIABLE_SUFFIXES,
    ORG_SETTINGS_OFFICER_KEY,
)
from app.models.organization_officer import OrganizationOfficer
from app.models.user import Organization, Position, User

# Source of a resolved office holder, surfaced to the admin UI so it can show
# whether a name is pinned or merely inferred from position assignments.
SOURCE_ASSIGNED = "assigned"
SOURCE_AUTO = "auto"
SOURCE_UNSET = "unset"


def build_office_variables() -> List[Dict[str, str]]:
    """Return the template-variable catalogue contributed by the offices."""
    variables: List[Dict[str, str]] = []
    for office in OFFICE_CATALOG:
        label = str(office["label"])
        for suffix, description in OFFICE_VARIABLE_SUFFIXES:
            variables.append(
                {
                    "name": f"{office['key']}_{suffix}",
                    "description": description.format(label=label),
                }
            )
    return variables


def _member_name(user: User) -> str:
    """Best available display name for a member record.

    Built from the name columns rather than ``User.full_name``: that property
    interpolates the columns unconditionally, so a member with no recorded
    name yields the literal string "None None".
    """
    parts = [
        getattr(user, "first_name", "") or "",
        getattr(user, "last_name", "") or "",
    ]
    joined = " ".join(p for p in parts if p).strip()
    return joined or (getattr(user, "username", "") or "")


def _sort_key(user: User) -> tuple:
    """Deterministic ordering for auto-detected holders.

    Auto-detection has to pick one member when several hold the same position;
    ordering by name (rather than by whatever the database returns) keeps the
    signature on a department's emails stable between sends.
    """
    return (
        (getattr(user, "last_name", "") or "").lower(),
        (getattr(user, "first_name", "") or "").lower(),
        str(user.id),
    )


def resolve_office(
    office: Dict[str, object],
    record: Optional[OrganizationOfficer],
    linked: Optional[User],
    candidates: List[User],
) -> Dict[str, Any]:
    """Apply the resolution precedence for a single office.

    Split out from the database walk in ``OfficerService.resolve`` because the
    precedence — override beats linked member beats position auto-detection —
    is the part with real behaviour, and it is worth testing without a
    database.

    ``record`` is the stored assignment (if any), ``linked`` the member it
    points at, and ``candidates`` the members auto-detected from the office's
    position slugs, already in deterministic order.
    """
    key = str(office["key"])
    slugs: List[str] = list(office["position_slugs"])  # type: ignore[arg-type]
    auto = candidates[0] if candidates else None

    # A record with neither a name override nor a resolvable member is a
    # stale row (its member was deleted), not an assignment — fall through to
    # auto-detection rather than reporting the office as filled-but-blank.
    if record is not None and (record.display_name or linked):
        source = SOURCE_ASSIGNED
        member = linked
    elif auto is not None:
        source = SOURCE_AUTO
        member = auto
    else:
        source = SOURCE_UNSET
        member = None

    override_name = record.display_name if record else None
    override_title = record.title if record else None
    override_email = record.email if record else None
    override_phone = record.phone if record else None

    return {
        "office_key": key,
        "label": str(office["label"]),
        "category": str(office["category"]),
        "default_title": str(office["default_title"]),
        "position_slugs": slugs,
        "user_id": str(record.user_id) if record and record.user_id else None,
        "name": override_name or (_member_name(member) if member else ""),
        "title": override_title or str(office["default_title"]),
        "email": override_email
        or (getattr(member, "email", "") or "" if member else ""),
        "phone": override_phone
        or (getattr(member, "phone", "") or "" if member else ""),
        "source": source,
        # The raw overrides are echoed back separately from the resolved
        # values so the admin form can round-trip an edit: without them it
        # cannot tell "email inherited from the member" from "email
        # deliberately overridden", and would silently drop it on the next
        # save.
        "override_name": override_name,
        "override_title": override_title,
        "override_email": override_email,
        "override_phone": override_phone,
        "auto_candidates": [
            {"id": str(u.id), "name": _member_name(u)} for u in candidates
        ],
    }


class OfficerService:
    """Read/write access to a department's office assignments."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _load_records(
        self, organization_id: str
    ) -> Dict[str, OrganizationOfficer]:
        result = await self.db.execute(
            select(OrganizationOfficer).where(
                OrganizationOfficer.organization_id == organization_id
            )
        )
        return {row.office_key: row for row in result.scalars().all()}

    async def _load_holders(self, organization_id: str) -> Dict[str, List[User]]:
        """Map each catalogued position slug to the active members holding it."""
        wanted = {
            slug
            for office in OFFICE_CATALOG
            for slug in office["position_slugs"]  # type: ignore[union-attr]
        }
        result = await self.db.execute(
            select(User)
            .join(User.positions)
            .where(
                User.organization_id == organization_id,
                User.is_active,
                Position.slug.in_(wanted),
            )
            .options(selectinload(User.positions))
            .distinct()
        )
        by_slug: Dict[str, List[User]] = {slug: [] for slug in wanted}
        for user in result.scalars().unique().all():
            for position in user.positions:
                if position.slug in by_slug:
                    by_slug[position.slug].append(user)
        for users in by_slug.values():
            users.sort(key=_sort_key)
        return by_slug

    async def _load_members(
        self, organization_id: str, user_ids: List[str]
    ) -> Dict[str, User]:
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.id.in_(user_ids),
                User.organization_id == organization_id,
            )
        )
        return {str(user.id): user for user in result.scalars().all()}

    async def resolve(self, organization_id: str) -> List[Dict[str, Any]]:
        """Resolve every catalogued office for an organization.

        Returns one entry per office in ``OFFICE_CATALOG`` order, whether or
        not a holder could be determined, so the admin UI can render the full
        list without knowing the catalogue itself.
        """
        records = await self._load_records(organization_id)
        holders = await self._load_holders(organization_id)
        members = await self._load_members(
            organization_id,
            [str(r.user_id) for r in records.values() if r.user_id],
        )

        resolved: List[Dict[str, Any]] = []
        for office in OFFICE_CATALOG:
            key = str(office["key"])
            record = records.get(key)

            # Candidates the admin can pick from, deduplicated across slugs.
            candidates: List[User] = []
            seen: set = set()
            for slug in office["position_slugs"]:  # type: ignore[union-attr]
                for user in holders.get(slug, []):
                    if str(user.id) not in seen:
                        seen.add(str(user.id))
                        candidates.append(user)

            linked = (
                members.get(str(record.user_id)) if record and record.user_id else None
            )
            resolved.append(resolve_office(office, record, linked, candidates))
        return resolved

    @staticmethod
    def build_context(resolved: List[Dict[str, Any]]) -> Dict[str, str]:
        """Flatten resolved offices into the render-time variable map.

        Offices with no holder contribute empty strings rather than being
        omitted, so an unfilled ``{{treasurer_name}}`` renders as blank
        instead of leaking the raw placeholder into a member's inbox.
        """
        context: Dict[str, str] = {}
        for office in resolved:
            key = office["office_key"]
            context[f"{key}_name"] = office.get("name") or ""
            context[f"{key}_title"] = office.get("title") or ""
            context[f"{key}_email"] = office.get("email") or ""
            context[f"{key}_phone"] = office.get("phone") or ""
        return context

    async def overlay_preview_context(
        self, organization_id: str, context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Replace sample office variables with the department's real ones.

        Preview and test-send build their context from ``SAMPLE_CONTEXT``,
        which carries placeholder officeholders.  Any office the department
        has actually filled should show its real holder instead, the same way
        the organization name does — offices still unfilled keep the sample so
        the preview does not render a half-empty signature block.
        """
        for office in await self.resolve(organization_id):
            if office["source"] == SOURCE_UNSET:
                continue
            key = office["office_key"]
            context[f"{key}_name"] = office["name"]
            context[f"{key}_title"] = office["title"]
            context[f"{key}_email"] = office["email"]
            context[f"{key}_phone"] = office["phone"]
        return context

    async def sync_directory(
        self, organization_id: str, resolved: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, str]:
        """Rebuild the render-time office directory on the organization row.

        Returns the flattened directory.  The caller owns the commit — this
        only stages the change so it joins whatever transaction it was called
        from.
        """
        if resolved is None:
            resolved = await self.resolve(organization_id)
        directory = self.build_context(resolved)

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        organization = org_result.scalar_one_or_none()
        if organization is None:
            return directory

        existing = organization.settings or {}
        if existing.get(ORG_SETTINGS_OFFICER_KEY) == directory:
            return directory

        # Deep copy before reassigning: a shallow dict() shares the nested
        # values with SQLAlchemy's committed state, and the UPDATE is skipped
        # when the comparison sees old == new (see CLAUDE.md pitfall #12).
        updated = copy.deepcopy(dict(existing))
        updated[ORG_SETTINGS_OFFICER_KEY] = directory
        organization.settings = updated
        return directory

    async def set_officer(
        self,
        organization_id: str,
        office_key: str,
        *,
        user_id: Optional[str] = None,
        display_name: Optional[str] = None,
        title: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        updated_by: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Assign (or re-assign) an office. Returns the re-resolved offices."""
        if office_key not in OFFICE_KEYS:
            raise ValueError(f"Unknown office: {office_key}")

        if user_id:
            member_result = await self.db.execute(
                select(User.id).where(
                    User.id == user_id,
                    User.organization_id == organization_id,
                )
            )
            if member_result.scalar_one_or_none() is None:
                raise ValueError("Selected member is not part of this organization")

        result = await self.db.execute(
            select(OrganizationOfficer).where(
                OrganizationOfficer.organization_id == organization_id,
                OrganizationOfficer.office_key == office_key,
            )
        )
        record = result.scalar_one_or_none()
        if record is None:
            record = OrganizationOfficer(
                organization_id=organization_id, office_key=office_key
            )
            self.db.add(record)

        record.user_id = user_id
        record.display_name = display_name
        record.title = title
        record.email = email
        record.phone = phone
        record.updated_by = updated_by

        await self.db.flush()
        resolved = await self.resolve(organization_id)
        await self.sync_directory(organization_id, resolved)
        return resolved

    async def clear_officer(
        self, organization_id: str, office_key: str
    ) -> List[Dict[str, Any]]:
        """Remove an explicit assignment, falling back to auto-detection."""
        if office_key not in OFFICE_KEYS:
            raise ValueError(f"Unknown office: {office_key}")

        result = await self.db.execute(
            select(OrganizationOfficer).where(
                OrganizationOfficer.organization_id == organization_id,
                OrganizationOfficer.office_key == office_key,
            )
        )
        record = result.scalar_one_or_none()
        if record is not None:
            await self.db.delete(record)
            await self.db.flush()

        resolved = await self.resolve(organization_id)
        await self.sync_directory(organization_id, resolved)
        return resolved
