"""
History Service

Past members, the managed title list and family links, plus the change
history every edit writes. Clearance lives in ``history_clearance_service``;
publication rules that depend on it are decided here, in one place.

Who receives what is decided by the server, never by the screen:

* the archive's keepers (``history.view`` / ``history.manage``) read every
  record and every field;
* every other signed-in member reads records published to members or the
  public, without the restricted fields, with each memorial field only where
  its own visibility allows, and with family links only to records they can
  read too.

Every query filters ``organization_id``; every client-sent id is resolved
inside the caller's department before it is stored (CLAUDE.md pitfall #14).
"""

import copy
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.models.history import (
    DatePrecision,
    FieldVisibility,
    HistoricalMember,
    HistoricalMemberPeriodTitle,
    HistoricalMemberRelation,
    HistoricalMemberServicePeriod,
    HistoryClearanceRequest,
    HistoryRevision,
    HistoryTitle,
    PublicationLevel,
    RelationType,
    RevisionKind,
    TitleSource,
)
from app.models.operational_rank import OperationalRank
from app.models.user import Organization, Position, User
from app.utils.markdown_render import render_markdown
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

RECORD_MEMBER = "member"

#: Never sent to anyone but the archive's keepers, whatever else is set.
RESTRICTED_FIELDS = (
    "birth_date",
    "birth_date_precision",
    "birth_date_circa",
    "addresses",
    "verification_sources",
    "research_notes",
)

#: Each memorial field and the column that decides who may read it.
MEMORIAL_FIELDS = {
    "death_date": "death_date_visibility",
    "death_date_precision": "death_date_visibility",
    "death_date_circa": "death_date_visibility",
    "death_circumstances": "death_circumstances_visibility",
    "burial_location": "burial_location_visibility",
}

_READABLE_BY_MEMBERS = (PublicationLevel.MEMBERS, PublicationLevel.PUBLIC)
_VISIBLE_TO_MEMBERS = (FieldVisibility.MEMBERS, FieldVisibility.PUBLIC)

_PERSON_FIELDS = (
    "first_name",
    "middle_name",
    "last_name",
    "suffix",
    "nickname",
    "badge_number",
    "birth_date",
    "birth_date_precision",
    "birth_date_circa",
    "biography",
    "addresses",
    "verification_sources",
    "research_notes",
    "is_memorial",
    "is_line_of_duty_death",
    "death_date",
    "death_date_precision",
    "death_date_circa",
    "death_date_visibility",
    "death_circumstances",
    "death_circumstances_visibility",
    "burial_location",
    "burial_location_visibility",
)

_TEXT_FIELDS = (
    "first_name",
    "middle_name",
    "last_name",
    "suffix",
    "nickname",
    "badge_number",
    "biography",
    "addresses",
    "verification_sources",
    "research_notes",
    "death_circumstances",
    "burial_location",
)

#: How the *other* person relates to the one being viewed, by stored type and
#: by which end of the stored row the viewed person sits at.
_RELATION_FROM_SUBJECT = {
    RelationType.PARENT_OF: "child",
    RelationType.GRANDPARENT_OF: "grandchild",
    RelationType.SIBLING: "sibling",
    RelationType.SPOUSE: "spouse",
}
_RELATION_FROM_OBJECT = {
    RelationType.PARENT_OF: "parent",
    RelationType.GRANDPARENT_OF: "grandparent",
    RelationType.SIBLING: "sibling",
    RelationType.SPOUSE: "spouse",
}


@dataclass(frozen=True)
class Viewer:
    """What one caller may do with the archive."""

    user_id: str
    organization_id: str
    can_view_archive: bool
    can_manage: bool
    can_publish: bool

    @classmethod
    def of(cls, user: User) -> "Viewer":
        manage = user_has_permission(user, "history.manage")
        return cls(
            user_id=str(user.id),
            organization_id=str(user.organization_id),
            # A publisher has to see a draft to publish it.
            can_view_archive=manage
            or user_has_permission(user, "history.view")
            or user_has_permission(user, "history.publish"),
            can_manage=manage,
            can_publish=user_has_permission(user, "history.publish"),
        )


# --- Small pure helpers ---


_WHITESPACE = re.compile(r"\s+")


def clean_title_name(name: str) -> str:
    return _WHITESPACE.sub(" ", name).strip()


def title_key(name: str) -> str:
    """What two titles must differ in to both be on the list."""
    return clean_title_name(name).casefold()


def normalize_partial_date(
    value: Optional[date], precision: Optional[DatePrecision]
) -> Optional[date]:
    """Store a year-only date as 1 January and a month-only date as the 1st,
    so sorting and decade filters compare like with like."""
    if value is None:
        return None
    if precision == DatePrecision.YEAR:
        return date(value.year, 1, 1)
    if precision == DatePrecision.MONTH:
        return date(value.year, value.month, 1)
    return value


def display_name(person: HistoricalMember) -> str:
    parts = [person.first_name]
    if person.nickname:
        parts.append(f'"{person.nickname}"')
    parts.extend([person.middle_name, person.last_name])
    name = " ".join(p.strip() for p in parts if p and p.strip())
    if person.suffix:
        name = f"{name} {person.suffix.strip()}"
    return name or person.last_name


def _year_text(value: Optional[date], circa: bool) -> Optional[str]:
    if value is None:
        return None
    return f"c. {value.year}" if circa else str(value.year)


def service_years(periods: Iterable[HistoricalMemberServicePeriod]) -> Optional[str]:
    """ "1951–1972", "c. 1923–1940", "1998–present", or None with no dates."""
    periods = list(periods)
    starts = [p for p in periods if p.start_date is not None]
    if not periods or (not starts and not any(p.end_date for p in periods)):
        if any(p.is_ongoing for p in periods):
            return "present"
        return None
    # Filtered to dated periods above; the fallback only satisfies the type.
    first = min(starts, key=lambda p: p.start_date or date.max) if starts else None
    start = _year_text(first.start_date, first.start_circa) if first else "?"
    if any(p.is_ongoing for p in periods):
        return f"{start}–present"
    ends = [p for p in periods if p.end_date is not None]
    if not ends:
        return f"{start}–"
    last = max(ends, key=lambda p: p.end_date or date.min)
    end = _year_text(last.end_date, last.end_circa)
    return start if end == start else f"{start}–{end}"


def _period_titles(person: HistoricalMember) -> list[str]:
    seen: dict[str, None] = {}
    for period in sorted(
        person.service_periods,
        key=lambda p: (p.start_date or date.max, p.sort_order),
        reverse=True,
    ):
        for link in period.titles:
            seen.setdefault(link.title.name, None)
    return list(seen)


def _date_iso(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


class HistoryService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Titles
    # ------------------------------------------------------------------

    async def ensure_titles_seeded(self, organization_id: str) -> None:
        """Pre-fill a department's title list once, from its current ranks and
        positions, as independent entries the Historian then edits.

        Seeded exactly once: titles are retired, never deleted, so an
        organization with no rows has never been seeded. The organization row
        is locked so two first visits cannot both seed.
        """
        if await self._title_count(organization_id):
            return
        await self.db.execute(
            select(Organization.id)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if await self._title_count(organization_id):
            return
        names: list[tuple[str, TitleSource]] = []
        ranks = await self.db.execute(
            select(OperationalRank.display_name)
            .where(
                OperationalRank.organization_id == str(organization_id),
                OperationalRank.is_active.is_(True),
            )
            .order_by(OperationalRank.sort_order, OperationalRank.display_name)
        )
        names.extend((name, TitleSource.RANK) for (name,) in ranks.all())
        positions = await self.db.execute(
            select(Position.name)
            .where(
                Position.organization_id == str(organization_id),
                # Everyone holds Member; it is not a title anyone held.
                Position.slug != "member",
            )
            .order_by(Position.priority.desc(), Position.name)
        )
        names.extend((name, TitleSource.POSITION) for (name,) in positions.all())
        seen: set[str] = set()
        order = 0
        for raw, source in names:
            name = clean_title_name(raw or "")
            key = title_key(name)
            if not name or key in seen:
                continue
            seen.add(key)
            self.db.add(
                HistoryTitle(
                    organization_id=str(organization_id),
                    name=name[:150],
                    name_key=key[:150],
                    source=source,
                    sort_order=order,
                )
            )
            order += 1
        await self.db.flush()

    async def _title_count(self, organization_id: str) -> int:
        return int(
            await self.db.scalar(
                select(func.count())
                .select_from(HistoryTitle)
                .where(HistoryTitle.organization_id == str(organization_id))
            )
            or 0
        )

    async def list_titles(
        self, organization_id: str, *, include_retired: bool
    ) -> list[tuple[HistoryTitle, int]]:
        await self.ensure_titles_seeded(organization_id)
        usage = (
            select(
                HistoricalMemberPeriodTitle.title_id,
                func.count().label("uses"),
            )
            .group_by(HistoricalMemberPeriodTitle.title_id)
            .subquery()
        )
        query = (
            select(HistoryTitle, func.coalesce(usage.c.uses, 0))
            .outerjoin(usage, usage.c.title_id == HistoryTitle.id)
            .where(HistoryTitle.organization_id == str(organization_id))
            .order_by(HistoryTitle.sort_order, HistoryTitle.name)
        )
        if not include_retired:
            query = query.where(HistoryTitle.is_retired.is_(False))
        result = await self.db.execute(query)
        return [(title, int(uses)) for title, uses in result.all()]

    async def get_title(
        self, organization_id: str, title_id: str
    ) -> Optional[HistoryTitle]:
        return await self.db.scalar(
            select(HistoryTitle).where(
                HistoryTitle.id == str(title_id),
                HistoryTitle.organization_id == str(organization_id),
            )
        )

    async def _title_by_key(
        self, organization_id: str, key: str
    ) -> Optional[HistoryTitle]:
        return await self.db.scalar(
            select(HistoryTitle).where(
                HistoryTitle.organization_id == str(organization_id),
                HistoryTitle.name_key == key,
            )
        )

    async def create_title(
        self, organization_id: str, name: str, actor_id: str
    ) -> HistoryTitle:
        await self.ensure_titles_seeded(organization_id)
        cleaned = clean_title_name(name)
        if not cleaned:
            raise ValueError("Enter a title")
        existing = await self._title_by_key(organization_id, title_key(cleaned))
        if existing:
            raise ValueError(f'"{existing.name}" is already on the list')
        highest = await self.db.scalar(
            select(func.max(HistoryTitle.sort_order)).where(
                HistoryTitle.organization_id == str(organization_id)
            )
        )
        title = HistoryTitle(
            organization_id=str(organization_id),
            name=cleaned,
            name_key=title_key(cleaned),
            source=TitleSource.CUSTOM,
            sort_order=int(highest or 0) + 1,
            created_by=actor_id,
        )
        self.db.add(title)
        await self.db.flush()
        return title

    async def update_title(
        self, title: HistoryTitle, updates: dict[str, Any]
    ) -> HistoryTitle:
        if "name" in updates and updates["name"] is not None:
            cleaned = clean_title_name(updates["name"])
            if not cleaned:
                raise ValueError("Enter a title")
            clash = await self._title_by_key(title.organization_id, title_key(cleaned))
            if clash and clash.id != title.id:
                raise ValueError(
                    f'"{clash.name}" is already on the list — merge into it instead'
                )
            title.name = cleaned
            title.name_key = title_key(cleaned)
        if updates.get("is_retired") is not None:
            title.is_retired = bool(updates["is_retired"])
        if updates.get("sort_order") is not None:
            title.sort_order = int(updates["sort_order"])
        await self.db.flush()
        return title

    async def merge_title(
        self, source: HistoryTitle, target: HistoryTitle
    ) -> HistoryTitle:
        """Move every use of *source* onto *target*, then remove *source*."""
        if source.id == target.id:
            raise ValueError("Choose a different title to merge into")
        if source.organization_id != target.organization_id:
            raise ValueError("Title not found")
        # A period carrying both keeps the one row it already has for target.
        # The ids are read first rather than used as a subquery: MySQL refuses
        # a DELETE whose WHERE selects from the table being deleted from
        # (error 1093), though MariaDB accepts it.
        already = list(
            (
                await self.db.execute(
                    select(HistoricalMemberPeriodTitle.period_id).where(
                        HistoricalMemberPeriodTitle.title_id == target.id
                    )
                )
            ).scalars()
        )
        if already:
            await self.db.execute(
                delete(HistoricalMemberPeriodTitle).where(
                    HistoricalMemberPeriodTitle.title_id == source.id,
                    HistoricalMemberPeriodTitle.period_id.in_(already),
                )
            )
        await self.db.execute(
            update(HistoricalMemberPeriodTitle)
            .where(HistoricalMemberPeriodTitle.title_id == source.id)
            .values(title_id=target.id)
            .execution_options(synchronize_session=False)
        )
        await self.db.flush()
        await self.db.delete(source)
        await self.db.flush()
        return target

    async def _validated_title_ids(
        self, organization_id: str, title_ids: Iterable[str]
    ) -> list[str]:
        wanted = list(dict.fromkeys(str(t) for t in title_ids))
        if not wanted:
            return []
        found = set(
            (
                await self.db.execute(
                    select(HistoryTitle.id).where(
                        HistoryTitle.organization_id == str(organization_id),
                        HistoryTitle.id.in_(wanted),
                    )
                )
            ).scalars()
        )
        if len(found) != len(wanted):
            raise ValueError("A chosen title is not on this department's list")
        return wanted

    # ------------------------------------------------------------------
    # People: reads
    # ------------------------------------------------------------------

    def _person_options(self):
        return (
            selectinload(HistoricalMember.service_periods)
            .selectinload(HistoricalMemberServicePeriod.titles)
            .selectinload(HistoricalMemberPeriodTitle.title),
            selectinload(HistoricalMember.user),
        )

    async def get_person(
        self, organization_id: str, person_id: str
    ) -> Optional[HistoricalMember]:
        return await self.db.scalar(
            select(HistoricalMember)
            .options(*self._person_options())
            .where(
                HistoricalMember.id == str(person_id),
                HistoricalMember.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )

    async def get_readable_person(
        self, viewer: Viewer, person_id: str
    ) -> Optional[HistoricalMember]:
        person = await self.get_person(viewer.organization_id, person_id)
        if person is None or not self.can_read(viewer, person):
            return None
        return person

    @staticmethod
    def can_read(viewer: Viewer, person: HistoricalMember) -> bool:
        return viewer.can_view_archive or person.publication_level in (
            _READABLE_BY_MEMBERS
        )

    async def list_people(
        self,
        viewer: Viewer,
        *,
        search: Optional[str] = None,
        decade: Optional[int] = None,
        title_id: Optional[str] = None,
        memorial: Optional[bool] = None,
        line_of_duty: Optional[bool] = None,
        level: Optional[PublicationLevel] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[HistoricalMember], int]:
        conditions = [HistoricalMember.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(
                HistoricalMember.publication_level.in_(_READABLE_BY_MEMBERS)
            )
        elif level is not None:
            conditions.append(HistoricalMember.publication_level == level)
        if search and search.strip():
            pattern = like_pattern(search.strip())
            conditions.append(
                or_(
                    *(
                        column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                        for column in (
                            HistoricalMember.first_name,
                            HistoricalMember.last_name,
                            HistoricalMember.nickname,
                            HistoricalMember.badge_number,
                        )
                    )
                )
            )
        if memorial is not None:
            conditions.append(HistoricalMember.is_memorial.is_(memorial))
        if line_of_duty is not None:
            conditions.append(HistoricalMember.is_line_of_duty_death.is_(line_of_duty))
        if decade is not None:
            conditions.append(self._served_in_decade(decade))
        if title_id:
            conditions.append(
                exists(
                    select(HistoricalMemberPeriodTitle.period_id)
                    .join(
                        HistoricalMemberServicePeriod,
                        HistoricalMemberServicePeriod.id
                        == HistoricalMemberPeriodTitle.period_id,
                    )
                    .where(
                        HistoricalMemberServicePeriod.member_id == HistoricalMember.id,
                        HistoricalMemberPeriodTitle.title_id == str(title_id),
                    )
                )
            )
        total = int(
            await self.db.scalar(
                select(func.count()).select_from(HistoricalMember).where(*conditions)
            )
            or 0
        )
        result = await self.db.execute(
            select(HistoricalMember)
            .options(*self._person_options())
            .where(*conditions)
            .order_by(HistoricalMember.last_name, HistoricalMember.first_name)
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().unique().all()), total

    @staticmethod
    def _served_in_decade(decade: int):
        start = date(decade, 1, 1)
        end = date(decade + 9, 12, 31)
        period = HistoricalMemberServicePeriod
        return exists(
            select(period.id).where(
                period.member_id == HistoricalMember.id,
                or_(period.start_date.is_(None), period.start_date <= end),
                or_(
                    period.end_date >= start,
                    and_(
                        period.end_date.is_(None),
                        or_(period.is_ongoing.is_(True), period.start_date >= start),
                    ),
                ),
            )
        )

    async def honor_roll(self, viewer: Viewer) -> list[HistoricalMember]:
        people, _ = await self.list_people(viewer, line_of_duty=True, limit=1000)
        return sorted(
            people,
            key=lambda p: (p.death_date or date.max, p.last_name, p.first_name or ""),
        )

    async def relations_for(
        self, viewer: Viewer, person: HistoricalMember
    ) -> list[dict[str, Any]]:
        """Family links from *person*'s side, only to people *viewer* can read."""
        result = await self.db.execute(
            select(HistoricalMemberRelation).where(
                HistoricalMemberRelation.organization_id == viewer.organization_id,
                or_(
                    HistoricalMemberRelation.member_id == person.id,
                    HistoricalMemberRelation.related_member_id == person.id,
                ),
            )
        )
        relations = list(result.scalars().all())
        other_ids = {
            r.related_member_id if r.member_id == person.id else r.member_id
            for r in relations
        }
        others = {}
        if other_ids:
            rows = await self.db.execute(
                select(HistoricalMember).where(
                    HistoricalMember.organization_id == viewer.organization_id,
                    HistoricalMember.id.in_(other_ids),
                )
            )
            others = {p.id: p for p in rows.scalars().all()}
        out = []
        for relation in relations:
            is_subject = relation.member_id == person.id
            other = others.get(
                relation.related_member_id if is_subject else relation.member_id
            )
            if other is None or not self.can_read(viewer, other):
                continue
            if relation.relation_type == RelationType.OTHER:
                label = relation.label or "relative"
            elif is_subject:
                label = _RELATION_FROM_SUBJECT[relation.relation_type]
            else:
                label = _RELATION_FROM_OBJECT[relation.relation_type]
            out.append(
                {
                    "id": relation.id,
                    "other_member_id": other.id,
                    "other_display_name": display_name(other),
                    "relationship": label,
                }
            )
        return sorted(out, key=lambda r: (r["relationship"], r["other_display_name"]))

    async def check_warnings(
        self,
        organization_id: str,
        *,
        last_name: Optional[str],
        first_name: Optional[str],
        badge_number: Optional[str],
        exclude_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Warnings for the entry form. Never a refusal: badge numbers were
        reissued, and two different John Smiths both served somewhere."""
        warnings: list[dict[str, Any]] = []
        base = [HistoricalMember.organization_id == str(organization_id)]
        if exclude_id:
            base.append(HistoricalMember.id != str(exclude_id))
        badge = (badge_number or "").strip()
        if badge:
            rows = await self.db.execute(
                select(HistoricalMember)
                .options(*self._person_options())
                .where(
                    *base, func.lower(HistoricalMember.badge_number) == badge.lower()
                )
            )
            for other in rows.scalars().unique().all():
                warnings.append(
                    {
                        "kind": "badge_number",
                        "message": f"Badge {badge} is also recorded for "
                        f"{display_name(other)}",
                        "member_id": other.id,
                        "display_name": display_name(other),
                        "service_years": service_years(other.service_periods),
                    }
                )
        last = (last_name or "").strip()
        if last:
            rows = await self.db.execute(
                select(HistoricalMember)
                .options(*self._person_options())
                .where(*base, func.lower(HistoricalMember.last_name) == last.lower())
            )
            first = (first_name or "").strip().casefold()
            for other in rows.scalars().unique().all():
                other_first = (other.first_name or "").strip().casefold()
                # "J." for "John", a missing first name on either side, or the
                # same name: all worth a second look.
                if first and other_first and first[0] != other_first[0]:
                    continue
                warnings.append(
                    {
                        "kind": "possible_duplicate",
                        "message": f"{display_name(other)} may be the same person",
                        "member_id": other.id,
                        "display_name": display_name(other),
                        "service_years": service_years(other.service_periods),
                    }
                )
        return warnings

    async def revisions(
        self, organization_id: str, record_type: str, record_id: str
    ) -> list[HistoryRevision]:
        result = await self.db.execute(
            select(HistoryRevision)
            .options(selectinload(HistoryRevision.actor))
            .where(
                HistoryRevision.organization_id == str(organization_id),
                HistoryRevision.record_type == record_type,
                HistoryRevision.record_id == str(record_id),
            )
            .order_by(HistoryRevision.created_at.desc(), HistoryRevision.id)
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # People: views
    # ------------------------------------------------------------------

    @staticmethod
    def period_view(period: HistoricalMemberServicePeriod) -> dict[str, Any]:
        return {
            "id": period.id,
            "start_date": period.start_date,
            "start_precision": period.start_precision,
            "start_circa": period.start_circa,
            "end_date": period.end_date,
            "end_precision": period.end_precision,
            "end_circa": period.end_circa,
            "is_ongoing": period.is_ongoing,
            "notes": period.notes,
            "titles": sorted(
                ({"id": t.title.id, "name": t.title.name} for t in period.titles),
                key=lambda t: t["name"],
            ),
        }

    def summary(self, person: HistoricalMember) -> dict[str, Any]:
        return {
            "id": person.id,
            "display_name": display_name(person),
            "last_name": person.last_name,
            "first_name": person.first_name,
            "nickname": person.nickname,
            "service_years": service_years(person.service_periods),
            "titles": _period_titles(person),
            "is_memorial": person.is_memorial,
            "is_line_of_duty_death": person.is_line_of_duty_death,
            "publication_level": person.publication_level,
        }

    def member_view(
        self, person: HistoricalMember, relations: list[dict[str, Any]]
    ) -> dict[str, Any]:
        view = {
            "view": "member",
            "id": person.id,
            "display_name": display_name(person),
            "first_name": person.first_name,
            "middle_name": person.middle_name,
            "last_name": person.last_name,
            "suffix": person.suffix,
            "nickname": person.nickname,
            "badge_number": person.badge_number,
            "biography_html": render_markdown(person.biography) or None,
            "is_memorial": person.is_memorial,
            "is_line_of_duty_death": person.is_line_of_duty_death,
            "service_periods": [self.period_view(p) for p in person.service_periods],
            "relations": relations,
            "publication_level": person.publication_level,
        }
        for field, visibility_field in MEMORIAL_FIELDS.items():
            if getattr(person, visibility_field) in _VISIBLE_TO_MEMBERS:
                view[field] = getattr(person, field)
        return view

    def full_view(
        self,
        viewer: Viewer,
        person: HistoricalMember,
        relations: list[dict[str, Any]],
        clearance: Optional[dict[str, Any]],
        *,
        clearance_required: bool,
        cleared_for_public: bool,
    ) -> dict[str, Any]:
        view: dict[str, Any] = {
            field: getattr(person, field) for field in _PERSON_FIELDS
        }
        linked = person.user
        view.update(
            {
                "view": "full",
                "id": person.id,
                "display_name": display_name(person),
                "user_id": person.user_id,
                "linked_member_name": (
                    linked.full_name if linked is not None else None
                ),
                "biography_html": render_markdown(person.biography) or None,
                "service_periods": [
                    self.period_view(p) for p in person.service_periods
                ],
                "relations": relations,
                "publication_level": person.publication_level,
                "published_at": person.published_at,
                "revision_number": person.revision_number,
                "public_revision_number": person.public_revision_number,
                "public_changes_pending": self.public_changes_pending(person),
                "clearance": clearance,
                "clearance_required": clearance_required,
                "cleared_for_public": cleared_for_public,
                "can_edit": viewer.can_manage,
                "can_publish": viewer.can_publish,
                "created_at": person.created_at,
                "updated_at": person.updated_at,
            }
        )
        return view

    @staticmethod
    def public_changes_pending(person: HistoricalMember) -> bool:
        return (
            person.publication_level == PublicationLevel.PUBLIC
            and (person.public_revision_number or 0)
            < person.substantial_revision_number
        )

    # ------------------------------------------------------------------
    # People: writes
    # ------------------------------------------------------------------

    async def _validated_user_id(
        self, organization_id: str, user_id: Optional[str]
    ) -> Optional[str]:
        if not user_id:
            return None
        found = await self.db.scalar(
            select(User.id).where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        if found is None:
            raise ValueError("Member not found")
        return str(found)

    @staticmethod
    def _clean(values: dict[str, Any]) -> dict[str, Any]:
        """Trim text and settle partial dates to their canonical stored form."""
        cleaned = dict(values)
        for field in _TEXT_FIELDS:
            if field in cleaned and isinstance(cleaned[field], str):
                cleaned[field] = cleaned[field].strip() or None
        return cleaned

    @staticmethod
    def _settle_dates(person: HistoricalMember) -> None:
        person.birth_date = normalize_partial_date(
            person.birth_date, person.birth_date_precision
        )
        person.death_date = normalize_partial_date(
            person.death_date, person.death_date_precision
        )

    def _snapshot(self, person: HistoricalMember) -> dict[str, Any]:
        """The whole record as it stands, for the change history."""
        data: dict[str, Any] = {}
        for field in _PERSON_FIELDS:
            value = getattr(person, field)
            data[field] = (
                value.isoformat() if isinstance(value, date) else _enum_value(value)
            )
        data["user_id"] = person.user_id
        data["service_periods"] = [
            {
                "start_date": _date_iso(p.start_date),
                "start_precision": _enum_value(p.start_precision),
                "start_circa": p.start_circa,
                "end_date": _date_iso(p.end_date),
                "end_precision": _enum_value(p.end_precision),
                "end_circa": p.end_circa,
                "is_ongoing": p.is_ongoing,
                "notes": p.notes,
                "title_ids": sorted(t.title_id for t in p.titles),
            }
            for p in person.service_periods
        ]
        return data

    def _public_snapshot(self, person: HistoricalMember) -> dict[str, Any]:
        """What the public may see of the record as it stands now.

        Built from the member view, then narrowed: a memorial field must be
        set to ``public`` itself, not merely visible to members.
        """
        snapshot = copy.deepcopy(
            {
                key: value
                for key, value in self._snapshot(person).items()
                if key not in RESTRICTED_FIELDS
                and key not in MEMORIAL_FIELDS
                and not key.endswith("_visibility")
                and key not in ("addresses", "research_notes", "user_id")
            }
        )
        for field, visibility_field in MEMORIAL_FIELDS.items():
            if getattr(person, visibility_field) == FieldVisibility.PUBLIC:
                value = getattr(person, field)
                snapshot[field] = (
                    value.isoformat() if isinstance(value, date) else _enum_value(value)
                )
        snapshot["display_name"] = display_name(person)
        snapshot["service_years"] = service_years(person.service_periods)
        snapshot["titles"] = _period_titles(person)
        return snapshot

    async def _log(
        self,
        person: HistoricalMember,
        kind: RevisionKind,
        actor_id: Optional[str],
        note: Optional[str] = None,
        *,
        with_snapshot: bool = False,
    ) -> HistoryRevision:
        revision = HistoryRevision(
            organization_id=person.organization_id,
            record_type=RECORD_MEMBER,
            record_id=person.id,
            revision_number=person.revision_number,
            kind=kind,
            snapshot=self._snapshot(person) if with_snapshot else None,
            note=(note or "").strip() or None,
            actor_id=actor_id,
        )
        self.db.add(revision)
        await self.db.flush()
        return revision

    async def create_person(
        self, organization_id: str, values: dict[str, Any], actor_id: str
    ) -> HistoricalMember:
        values = self._clean(values)
        if not values.get("last_name"):
            raise ValueError("Enter a last name")
        user_id = await self._validated_user_id(
            organization_id, values.pop("user_id", None)
        )
        person = HistoricalMember(
            organization_id=str(organization_id),
            user_id=user_id,
            created_by=actor_id,
            updated_by=actor_id,
            revision_number=1,
            substantial_revision_number=1,
        )
        for field in _PERSON_FIELDS:
            if values.get(field) is not None:
                setattr(person, field, values[field])
        self._settle_dates(person)
        self.db.add(person)
        await self.db.flush()
        created = await self.get_person(organization_id, person.id)
        if created is None:
            raise ValueError("The new record could not be read back")
        await self._log(created, RevisionKind.CREATED, actor_id, with_snapshot=True)
        return created

    async def create_from_member(
        self, organization_id: str, user_id: str, actor_id: str
    ) -> HistoricalMember:
        user = await self.db.scalar(
            select(User).where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        if user is None:
            raise ValueError("Member not found")
        if not (user.last_name or "").strip():
            raise ValueError("That member has no last name to start a record from")
        return await self.create_person(
            organization_id,
            {
                "user_id": user.id,
                "first_name": user.first_name,
                "middle_name": user.middle_name,
                "last_name": user.last_name,
                "nickname": user.preferred_name,
                "badge_number": user.membership_number,
            },
            actor_id,
        )

    async def update_person(
        self,
        person: HistoricalMember,
        values: dict[str, Any],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoricalMember:
        values = self._clean(values)
        if "user_id" in values:
            values["user_id"] = await self._validated_user_id(
                person.organization_id, values["user_id"]
            )
        apply_updates(
            person,
            values,
            skip={
                "id",
                "organization_id",
                "publication_level",
                "published_at",
                "published_by",
                "public_snapshot",
                "public_revision_number",
                "substantial_revision_number",
                "revision_number",
                "created_by",
                "created_at",
            },
        )
        self._settle_dates(person)
        person.updated_by = actor_id
        return await self._after_edit(person, edit_kind, edit_note, actor_id)

    async def replace_periods(
        self,
        person: HistoricalMember,
        periods: list[dict[str, Any]],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoricalMember:
        for period in list(person.service_periods):
            await self.db.delete(period)
        await self.db.flush()
        for index, values in enumerate(periods):
            title_ids = await self._validated_title_ids(
                person.organization_id, values.get("title_ids") or []
            )
            period = HistoricalMemberServicePeriod(
                member_id=person.id,
                start_date=normalize_partial_date(
                    values.get("start_date"), values.get("start_precision")
                ),
                start_precision=values.get("start_precision") or DatePrecision.YEAR,
                start_circa=bool(values.get("start_circa")),
                end_date=normalize_partial_date(
                    values.get("end_date"), values.get("end_precision")
                ),
                end_precision=values.get("end_precision") or DatePrecision.YEAR,
                end_circa=bool(values.get("end_circa")),
                is_ongoing=bool(values.get("is_ongoing")),
                notes=(values.get("notes") or "").strip() or None,
                sort_order=index,
            )
            self.db.add(period)
            await self.db.flush()
            for title_id in title_ids:
                self.db.add(
                    HistoricalMemberPeriodTitle(period_id=period.id, title_id=title_id)
                )
        person.updated_by = actor_id
        await self.db.flush()
        reloaded = await self.get_person(person.organization_id, person.id)
        assert reloaded is not None
        return await self._after_edit(reloaded, edit_kind, edit_note, actor_id)

    async def _after_edit(
        self,
        person: HistoricalMember,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoricalMember:
        """Number the revision and decide what the edit means for the public.

        A substantial edit needs clearing again: the public keeps the last
        cleared version, and any request still waiting is withdrawn because it
        is reviewing text that no longer exists. A minor edit reaches the
        public copy at once — unless substantial changes are already waiting,
        in which case the public copy stays the cleared one and this edit
        joins what is waiting.
        """
        from app.services.history_clearance_service import HistoryClearanceService

        substantial = edit_kind == "substantial"
        person.revision_number += 1
        if substantial:
            person.substantial_revision_number = person.revision_number
        await self.db.flush()
        await self._log(
            person,
            RevisionKind.SUBSTANTIAL if substantial else RevisionKind.MINOR,
            actor_id,
            edit_note,
            with_snapshot=True,
        )
        if substantial:
            await HistoryClearanceService(self.db).withdraw_pending(
                person.organization_id, RECORD_MEMBER, person.id, actor_id
            )
        elif (
            person.publication_level == PublicationLevel.PUBLIC
            and not self.public_changes_pending(person)
        ):
            person.public_snapshot = self._public_snapshot(person)
            person.public_revision_number = person.revision_number
            await self.db.flush()
        return person

    async def delete_person(self, person: HistoricalMember) -> None:
        if person.publication_level != PublicationLevel.DRAFT:
            raise ValueError("Unpublish this record before deleting it")
        for model in (HistoryRevision, HistoryClearanceRequest):
            await self.db.execute(
                delete(model).where(
                    model.organization_id == person.organization_id,
                    model.record_type == RECORD_MEMBER,
                    model.record_id == person.id,
                )
            )
        await self.db.delete(person)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Relations
    # ------------------------------------------------------------------

    async def add_relation(
        self,
        person: HistoricalMember,
        related_member_id: str,
        relation_type: RelationType,
        label: Optional[str],
        actor_id: str,
    ) -> HistoricalMemberRelation:
        other = await self.get_person(person.organization_id, related_member_id)
        if other is None:
            raise ValueError("Person not found")
        if other.id == person.id:
            raise ValueError("A person cannot be linked to themselves")
        existing = await self.db.scalar(
            select(HistoricalMemberRelation.id).where(
                HistoricalMemberRelation.organization_id == person.organization_id,
                or_(
                    and_(
                        HistoricalMemberRelation.member_id == person.id,
                        HistoricalMemberRelation.related_member_id == other.id,
                    ),
                    and_(
                        HistoricalMemberRelation.member_id == other.id,
                        HistoricalMemberRelation.related_member_id == person.id,
                    ),
                ),
            )
        )
        if existing:
            raise ValueError("These two people are already linked")
        relation = HistoricalMemberRelation(
            organization_id=person.organization_id,
            member_id=person.id,
            related_member_id=other.id,
            relation_type=relation_type,
            label=(
                (label or "").strip() or None
                if relation_type == RelationType.OTHER
                else None
            ),
            created_by=actor_id,
        )
        self.db.add(relation)
        await self.db.flush()
        return relation

    async def get_relation(
        self, organization_id: str, relation_id: str
    ) -> Optional[HistoricalMemberRelation]:
        return await self.db.scalar(
            select(HistoricalMemberRelation).where(
                HistoricalMemberRelation.id == str(relation_id),
                HistoricalMemberRelation.organization_id == str(organization_id),
            )
        )

    async def delete_relation(self, relation: HistoricalMemberRelation) -> None:
        await self.db.delete(relation)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Publication
    # ------------------------------------------------------------------

    async def publish(
        self, person: HistoricalMember, level: PublicationLevel, actor_id: str
    ) -> HistoricalMember:
        from app.services.history_clearance_service import HistoryClearanceService

        if level == PublicationLevel.PUBLIC:
            if (
                person.publication_level == PublicationLevel.PUBLIC
                and not self.public_changes_pending(person)
            ):
                raise ValueError("This record is already public and up to date")
            clearance = HistoryClearanceService(self.db)
            if not await clearance.is_cleared(
                person.organization_id,
                RECORD_MEMBER,
                person.id,
                person.substantial_revision_number,
            ):
                raise ValueError(
                    "This record must pass the department's clearance list "
                    "before it is published to the public"
                )
            person.public_snapshot = self._public_snapshot(person)
            person.public_revision_number = person.revision_number
        elif person.publication_level != PublicationLevel.DRAFT:
            raise ValueError("This record is already published to members")
        person.publication_level = level
        person.published_at = datetime.now(timezone.utc)
        person.published_by = actor_id
        await self.db.flush()
        await self._log(
            person, RevisionKind.PUBLISHED, actor_id, f"Published to {level.value}"
        )
        return person

    async def unpublish(
        self, person: HistoricalMember, level: PublicationLevel, actor_id: str
    ) -> HistoricalMember:
        order = [
            PublicationLevel.DRAFT,
            PublicationLevel.MEMBERS,
            PublicationLevel.PUBLIC,
        ]
        if order.index(level) >= order.index(person.publication_level):
            raise ValueError("Choose a level below the record's current one")
        person.publication_level = level
        person.public_snapshot = None
        person.public_revision_number = None
        if level == PublicationLevel.DRAFT:
            person.published_at = None
            person.published_by = None
        await self.db.flush()
        await self._log(
            person,
            RevisionKind.UNPUBLISHED,
            actor_id,
            "Returned to draft" if level == PublicationLevel.DRAFT else "Members only",
        )
        return person
