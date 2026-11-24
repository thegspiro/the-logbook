"""Each department's CRR catalogue: activity types, their counts, and tags.

Defaults are seeded per department the first time the catalogue is read
(``ensure_defaults``) rather than by a seed migration, because the rows belong
to the department: a seed migration only reaches departments that exist when
it runs, while this reaches one onboarded next year the same way.
"""

import re
from typing import Any, Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.admin_hours import AdminHoursCategory
from app.models.crr import (
    CRR_TAG_KINDS,
    CrrActivityMeasure,
    CrrActivityType,
    CrrActivityTypeTag,
    CrrTag,
)
from app.models.user import Organization
from app.services.crr_catalogue_defaults import DEFAULT_ACTIVITY_TYPES, DEFAULT_TAGS
from app.utils.model_updates import apply_updates

_CODE_MAX = 64

DEFAULT_RETENTION_MONTHS = 24
MIN_RETENTION_MONTHS = 1
MAX_RETENTION_MONTHS = 120


def retention_months(org: Optional[Organization]) -> int:
    """How long the department keeps CRR resident details, read defensively:
    a missing or malformed setting means the default, never "keep forever" or
    "clear now" (pitfall #19)."""
    raw = ((org.settings or {}).get("crr") or {}) if org is not None else {}
    value = (
        raw.get("resident_details_retention_months") if isinstance(raw, dict) else None
    )
    if isinstance(value, bool) or not isinstance(value, int):
        return DEFAULT_RETENTION_MONTHS
    return min(max(value, MIN_RETENTION_MONTHS), MAX_RETENTION_MONTHS)


def code_from_label(label: str) -> str:
    """A stable lowercase key for a label: "CO alarm install" -> "co_alarm_install"."""
    code = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return (code or "item")[:_CODE_MAX]


def _unique_code(base: str, taken: Iterable[str]) -> str:
    used = set(taken)
    if base not in used:
        return base
    n = 2
    while True:
        suffix = f"_{n}"
        candidate = base[: _CODE_MAX - len(suffix)] + suffix
        if candidate not in used:
            return candidate
        n += 1


_WHITESPACE = re.compile(r"\s+")


def _clean_label(value: str, what: str) -> str:
    cleaned = _WHITESPACE.sub(" ", value).strip()
    if not cleaned:
        raise ValueError(f"{what} cannot be blank")
    return cleaned


class CrrCatalogueService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Defaults

    async def ensure_defaults(self, organization_id: str) -> None:
        """Seed the default catalogue once per department (caller commits).

        The department's row is locked first: two officers opening the screen
        at once would otherwise both see nothing seeded and both insert, and
        the unique codes would turn the second insert into an error page.
        Seeded rows are never deleted (only retired), so "no seeded row" means
        "never seeded", not "the department removed them all".
        """
        org_id = str(organization_id)
        await self.db.execute(
            select(Organization.id).where(Organization.id == org_id).with_for_update()
        )

        seeded_tags = await self.db.scalar(
            select(func.count(CrrTag.id)).where(
                CrrTag.organization_id == org_id, CrrTag.is_system.is_(True)
            )
        )
        if not seeded_tags:
            for order, tag in enumerate(DEFAULT_TAGS):
                self.db.add(
                    CrrTag(
                        organization_id=org_id,
                        kind=tag.kind,
                        code=tag.code,
                        label=tag.label,
                        is_system=True,
                        sort_order=order,
                    )
                )
            await self.db.flush()

        seeded_types = await self.db.scalar(
            select(func.count(CrrActivityType.id)).where(
                CrrActivityType.organization_id == org_id,
                CrrActivityType.is_system.is_(True),
            )
        )
        if seeded_types:
            return

        tags_by_code = {
            code: tag_id
            for code, tag_id in (
                await self.db.execute(
                    select(CrrTag.code, CrrTag.id).where(
                        CrrTag.organization_id == org_id
                    )
                )
            ).all()
        }
        for order, default in enumerate(DEFAULT_ACTIVITY_TYPES):
            activity_type = CrrActivityType(
                organization_id=org_id,
                code=default.code,
                name=default.name,
                description=default.description,
                is_system=True,
                sort_order=order,
            )
            self.db.add(activity_type)
            await self.db.flush()
            for m_order, measure in enumerate(default.measures):
                self.db.add(
                    CrrActivityMeasure(
                        organization_id=org_id,
                        activity_type_id=activity_type.id,
                        code=measure.code,
                        label=measure.label,
                        sort_order=m_order,
                    )
                )
            for tag_code in default.tags:
                tag_id = tags_by_code.get(tag_code)
                # A department that renamed a seeded tag keeps its code, so the
                # lookup finds it; only a tag it never had is skipped.
                if tag_id:
                    self.db.add(
                        CrrActivityTypeTag(
                            organization_id=org_id,
                            activity_type_id=activity_type.id,
                            tag_id=tag_id,
                        )
                    )
        await self.db.flush()

    # ------------------------------------------------------------------
    # Reads

    async def catalogue(self, organization_id: str) -> dict[str, Any]:
        org_id = str(organization_id)
        await self.ensure_defaults(org_id)
        types = (
            (
                await self.db.execute(
                    select(CrrActivityType)
                    .where(CrrActivityType.organization_id == org_id)
                    .options(
                        selectinload(CrrActivityType.measures),
                        selectinload(CrrActivityType.tag_links),
                    )
                    .order_by(CrrActivityType.sort_order, CrrActivityType.name)
                )
            )
            .scalars()
            .all()
        )
        tags = (
            (
                await self.db.execute(
                    select(CrrTag)
                    .where(CrrTag.organization_id == org_id)
                    .order_by(CrrTag.kind, CrrTag.sort_order, CrrTag.label)
                )
            )
            .scalars()
            .all()
        )
        categories = (
            await self.db.execute(
                select(AdminHoursCategory.id, AdminHoursCategory.name)
                .where(
                    AdminHoursCategory.organization_id == org_id,
                    AdminHoursCategory.is_active.is_(True),
                )
                .order_by(AdminHoursCategory.sort_order, AdminHoursCategory.name)
            )
        ).all()
        org = await self.db.get(Organization, org_id)
        return {
            "activity_types": [self._type_row(t) for t in types],
            "tags": [self._tag_row(t) for t in tags],
            "admin_hours_categories": [
                {"id": cid, "name": name} for cid, name in categories
            ],
            "resident_details_retention_months": retention_months(org),
        }

    @staticmethod
    def _type_row(activity_type: CrrActivityType) -> dict[str, Any]:
        return {
            "id": activity_type.id,
            "code": activity_type.code,
            "name": activity_type.name,
            "description": activity_type.description,
            "is_system": bool(activity_type.is_system),
            "is_active": bool(activity_type.is_active),
            "sort_order": activity_type.sort_order,
            "measures": [
                {
                    "id": m.id,
                    "code": m.code,
                    "label": m.label,
                    "is_active": bool(m.is_active),
                    "sort_order": m.sort_order,
                }
                for m in activity_type.measures
            ],
            "tag_ids": sorted(link.tag_id for link in activity_type.tag_links),
            "admin_hours_category_id": activity_type.admin_hours_category_id,
        }

    @staticmethod
    def _tag_row(tag: CrrTag) -> dict[str, Any]:
        return {
            "id": tag.id,
            "kind": tag.kind,
            "code": tag.code,
            "label": tag.label,
            "is_system": bool(tag.is_system),
            "is_active": bool(tag.is_active),
            "sort_order": tag.sort_order,
        }

    async def _type(self, organization_id: str, type_id: str) -> CrrActivityType:
        found = await self.db.scalar(
            select(CrrActivityType)
            .where(
                CrrActivityType.id == str(type_id),
                CrrActivityType.organization_id == str(organization_id),
            )
            .options(
                selectinload(CrrActivityType.measures),
                selectinload(CrrActivityType.tag_links),
            )
            # Measures added with db.add() bypass the relationship, so a type
            # already in the session would otherwise answer with its old list.
            .execution_options(populate_existing=True)
        )
        if found is None:
            raise LookupError("Activity type not found")
        return found

    async def get_type(self, organization_id: str, type_id: str) -> dict[str, Any]:
        return self._type_row(await self._type(organization_id, type_id))

    # ------------------------------------------------------------------
    # Activity types

    async def _check_type_name(
        self, org_id: str, name: str, exclude_id: Optional[str] = None
    ) -> None:
        clash = select(CrrActivityType.id).where(
            CrrActivityType.organization_id == org_id,
            func.lower(CrrActivityType.name) == name.lower(),
        )
        if exclude_id:
            clash = clash.where(CrrActivityType.id != exclude_id)
        if await self.db.scalar(clash):
            raise ValueError(f'There is already an activity type named "{name}"')

    async def create_type(
        self,
        organization_id: str,
        name: str,
        description: Optional[str],
        measures: list[str],
    ) -> dict[str, Any]:
        org_id = str(organization_id)
        await self.ensure_defaults(org_id)
        name = _clean_label(name, "Name")
        await self._check_type_name(org_id, name)
        taken = (
            await self.db.execute(
                select(CrrActivityType.code).where(
                    CrrActivityType.organization_id == org_id
                )
            )
        ).scalars()
        next_order = await self.db.scalar(
            select(func.coalesce(func.max(CrrActivityType.sort_order), -1)).where(
                CrrActivityType.organization_id == org_id
            )
        )
        activity_type = CrrActivityType(
            organization_id=org_id,
            code=_unique_code(code_from_label(name), taken),
            name=name,
            description=(description or "").strip() or None,
            is_system=False,
            sort_order=int(next_order or 0) + 1,
        )
        self.db.add(activity_type)
        await self.db.flush()
        for label in measures:
            await self._add_measure(org_id, activity_type, label)
        await self.db.flush()
        return await self.get_type(org_id, activity_type.id)

    async def update_type(
        self, organization_id: str, type_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        org_id = str(organization_id)
        activity_type = await self._type(org_id, type_id)
        changes = dict(updates)
        if "name" in changes:
            if changes["name"] is None:
                raise ValueError("Name cannot be blank")
            changes["name"] = _clean_label(changes["name"], "Name")
            await self._check_type_name(org_id, changes["name"], activity_type.id)
        if "description" in changes:
            changes["description"] = (changes["description"] or "").strip() or None
        if changes.get("admin_hours_category_id"):
            # A client-supplied id must be one of the department's own
            # active categories (pitfall #14c).
            found = await self.db.scalar(
                select(AdminHoursCategory.id).where(
                    AdminHoursCategory.id == str(changes["admin_hours_category_id"]),
                    AdminHoursCategory.organization_id == org_id,
                    AdminHoursCategory.is_active.is_(True),
                )
            )
            if found is None:
                raise ValueError("Admin Hours category not found")
        apply_updates(activity_type, changes)
        await self.db.flush()
        return await self.get_type(org_id, activity_type.id)

    async def delete_type(self, organization_id: str, type_id: str) -> None:
        """Delete a type the department added. A seeded type is only retired.

        A type activities were recorded against will also be refused by the
        database once activities exist (their link restricts deletion); retire
        it instead, which keeps those records naming it.
        """
        activity_type = await self._type(organization_id, type_id)
        if activity_type.is_system:
            raise ValueError(
                "A built-in activity type cannot be deleted. Retire it instead."
            )
        await self.db.delete(activity_type)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Measures

    async def _add_measure(
        self, org_id: str, activity_type: CrrActivityType, label: str
    ) -> CrrActivityMeasure:
        label = _clean_label(label, "A count's name")
        existing = await self.db.execute(
            select(CrrActivityMeasure.code, CrrActivityMeasure.label).where(
                CrrActivityMeasure.activity_type_id == activity_type.id
            )
        )
        codes, labels = [], []
        for code, existing_label in existing.all():
            codes.append(code)
            labels.append(existing_label.lower())
        if label.lower() in labels:
            raise ValueError(f'"{activity_type.name}" already counts "{label}"')
        measure = CrrActivityMeasure(
            organization_id=org_id,
            activity_type_id=activity_type.id,
            code=_unique_code(code_from_label(label), codes),
            label=label,
            sort_order=len(codes),
        )
        self.db.add(measure)
        await self.db.flush()
        return measure

    async def add_measure(
        self, organization_id: str, type_id: str, label: str
    ) -> dict[str, Any]:
        org_id = str(organization_id)
        activity_type = await self._type(org_id, type_id)
        await self._add_measure(org_id, activity_type, label)
        return await self.get_type(org_id, activity_type.id)

    async def update_measure(
        self, organization_id: str, measure_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        org_id = str(organization_id)
        measure = await self.db.scalar(
            select(CrrActivityMeasure).where(
                CrrActivityMeasure.id == str(measure_id),
                CrrActivityMeasure.organization_id == org_id,
            )
        )
        if measure is None:
            raise LookupError("Count not found")
        changes = dict(updates)
        if "label" in changes:
            if changes["label"] is None:
                raise ValueError("A count's name cannot be blank")
            changes["label"] = _clean_label(changes["label"], "A count's name")
            clash = await self.db.scalar(
                select(CrrActivityMeasure.id).where(
                    CrrActivityMeasure.activity_type_id == measure.activity_type_id,
                    CrrActivityMeasure.id != measure.id,
                    func.lower(CrrActivityMeasure.label) == changes["label"].lower(),
                )
            )
            if clash:
                raise ValueError(f'This type already counts "{changes["label"]}"')
        apply_updates(measure, changes)
        await self.db.flush()
        return await self.get_type(org_id, measure.activity_type_id)

    # ------------------------------------------------------------------
    # Tags

    async def create_tag(
        self, organization_id: str, kind: str, label: str
    ) -> dict[str, Any]:
        org_id = str(organization_id)
        if kind not in CRR_TAG_KINDS:
            raise ValueError("A tag is a risk or a population")
        await self.ensure_defaults(org_id)
        label = _clean_label(label, "Name")
        rows = (
            await self.db.execute(
                select(CrrTag.code, CrrTag.label, CrrTag.sort_order).where(
                    CrrTag.organization_id == org_id, CrrTag.kind == kind
                )
            )
        ).all()
        if any(existing.lower() == label.lower() for _c, existing, _o in rows):
            raise ValueError(f'There is already a tag named "{label}"')
        tag = CrrTag(
            organization_id=org_id,
            kind=kind,
            code=_unique_code(code_from_label(label), [c for c, _l, _o in rows]),
            label=label,
            is_system=False,
            sort_order=max([o for _c, _l, o in rows], default=-1) + 1,
        )
        self.db.add(tag)
        await self.db.flush()
        return self._tag_row(tag)

    async def update_tag(
        self, organization_id: str, tag_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        org_id = str(organization_id)
        tag = await self.db.scalar(
            select(CrrTag).where(
                CrrTag.id == str(tag_id), CrrTag.organization_id == org_id
            )
        )
        if tag is None:
            raise LookupError("Tag not found")
        changes = dict(updates)
        if "label" in changes:
            if changes["label"] is None:
                raise ValueError("Name cannot be blank")
            changes["label"] = _clean_label(changes["label"], "Name")
            clash = await self.db.scalar(
                select(CrrTag.id).where(
                    CrrTag.organization_id == org_id,
                    CrrTag.kind == tag.kind,
                    CrrTag.id != tag.id,
                    func.lower(CrrTag.label) == changes["label"].lower(),
                )
            )
            if clash:
                raise ValueError(f'There is already a tag named "{changes["label"]}"')
        apply_updates(tag, changes)
        await self.db.flush()
        return self._tag_row(tag)

    async def set_type_tags(
        self, organization_id: str, type_id: str, tag_ids: list[str]
    ) -> dict[str, Any]:
        """Replace a type's default tags. Every id must be one of the
        department's own tags (pitfall #14c)."""
        org_id = str(organization_id)
        activity_type = await self._type(org_id, type_id)
        wanted = {str(t) for t in tag_ids}
        if wanted:
            found = set(
                (
                    await self.db.execute(
                        select(CrrTag.id).where(
                            CrrTag.organization_id == org_id, CrrTag.id.in_(wanted)
                        )
                    )
                ).scalars()
            )
            if found != wanted:
                raise ValueError("One or more tags were not found")
        current = {link.tag_id: link for link in activity_type.tag_links}
        for tag_id, link in current.items():
            if tag_id not in wanted:
                activity_type.tag_links.remove(link)
        for tag_id in wanted - set(current):
            activity_type.tag_links.append(
                CrrActivityTypeTag(organization_id=org_id, tag_id=tag_id)
            )
        await self.db.flush()
        return await self.get_type(org_id, activity_type.id)
