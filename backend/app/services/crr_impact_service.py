"""What a department's community risk reduction work added up to over a period.

The CRR part of Outreach Impact (owner decisions, 2026-11-23): each activity
type's counts against the same span of the previous period, the same counts
under each risk and priority population, and where the work happened by ZIP
code, with each ZIP's centre for the map.

It reads only an activity's type, time, ZIP code, counts and tags -- never a
resident's details, which this report has no use for and which stay behind
crr.view_contact on the activity screens.

Every log entry and every activity recorded at an event counts, whatever the
event: an activity can only be recorded on an outreach event to begin with.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.crr import CrrActivity, CrrActivityMeasure, CrrActivityType, CrrTag
from app.services.zip_lookup import lookup_zip, zip_coordinates


@dataclass
class _Tally:
    """Activities, and each measure's total, for one group."""

    activities: int = 0
    quantities: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def add(self, activity: CrrActivity) -> None:
        self.activities += 1
        for count in activity.counts:
            self.quantities[count.measure_id] += count.quantity


@dataclass
class _Catalogue:
    """The department's types, measures and tags, retired ones included: an
    activity recorded against one before it was retired still happened."""

    types: dict[str, CrrActivityType]
    measures: dict[str, CrrActivityMeasure]
    tags: dict[str, CrrTag]

    def measure_order(self, measure_id: str) -> tuple[int, str, int]:
        measure = self.measures[measure_id]
        owner = self.types.get(measure.activity_type_id)
        return (
            owner.sort_order if owner else 0,
            owner.name if owner else "",
            measure.sort_order,
        )

    def counts(self, tally: _Tally) -> list[dict[str, Any]]:
        """A group's measure totals, each named with its type, in catalogue order."""
        known = sorted(
            (mid for mid in tally.quantities if mid in self.measures),
            key=self.measure_order,
        )
        out = []
        for measure_id in known:
            measure = self.measures[measure_id]
            owner = self.types.get(measure.activity_type_id)
            out.append(
                {
                    "measure_id": measure_id,
                    "activity_type_name": owner.name if owner else "",
                    "label": measure.label,
                    "quantity": tally.quantities[measure_id],
                }
            )
        return out


class CrrImpactService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _activities(
        self, organization_id: str, start: Optional[datetime], end: datetime
    ) -> list[CrrActivity]:
        query = (
            select(CrrActivity)
            .options(
                selectinload(CrrActivity.counts),
                selectinload(CrrActivity.tag_links),
            )
            .where(
                CrrActivity.organization_id == organization_id,
                CrrActivity.occurred_at < end,
            )
        )
        if start is not None:
            query = query.where(CrrActivity.occurred_at >= start)
        return list((await self.db.execute(query)).scalars().all())

    async def _catalogue(self, organization_id: str) -> _Catalogue:
        types = (
            await self.db.execute(
                select(CrrActivityType).where(
                    CrrActivityType.organization_id == organization_id
                )
            )
        ).scalars()
        measures = (
            await self.db.execute(
                select(CrrActivityMeasure).where(
                    CrrActivityMeasure.organization_id == organization_id
                )
            )
        ).scalars()
        tags = (
            await self.db.execute(
                select(CrrTag).where(CrrTag.organization_id == organization_id)
            )
        ).scalars()
        return _Catalogue(
            types={t.id: t for t in types},
            measures={m.id: m for m in measures},
            tags={t.id: t for t in tags},
        )

    async def breakdown(
        self,
        organization_id: str,
        start: Optional[datetime],
        end: datetime,
        previous: Optional[tuple[datetime, datetime]],
    ) -> dict[str, Any]:
        rows = await self._activities(organization_id, start, end)
        prior = (
            await self._activities(organization_id, *previous)
            if previous is not None
            else None
        )
        catalogue = await self._catalogue(organization_id)
        return {
            "activities": len(rows),
            "previous_activities": len(prior) if prior is not None else None,
            "by_type": self._by_type(rows, prior, catalogue),
            "by_tag": self._by_tag(rows, catalogue),
            "by_zip": self._by_zip(rows, catalogue),
            "unplaced_activities": sum(1 for a in rows if not a.zip_code),
        }

    @staticmethod
    def _by_type(
        rows: list[CrrActivity],
        prior: Optional[list[CrrActivity]],
        catalogue: _Catalogue,
    ) -> list[dict[str, Any]]:
        current: dict[str, _Tally] = defaultdict(_Tally)
        before: dict[str, _Tally] = defaultdict(_Tally)
        for activity in rows:
            current[activity.activity_type_id].add(activity)
        for activity in prior or ():
            before[activity.activity_type_id].add(activity)

        # A type appears when it was done in either span, so a drop to nothing
        # shows as a drop rather than as the type vanishing.
        keyed: list[tuple[tuple[int, str], dict[str, Any]]] = []
        for type_id in set(current) | set(before):
            activity_type = catalogue.types.get(type_id)
            if activity_type is None:
                continue
            now_tally, then_tally = current[type_id], before[type_id]
            measure_ids = sorted(
                (
                    mid
                    for mid in set(now_tally.quantities) | set(then_tally.quantities)
                    if mid in catalogue.measures
                ),
                key=catalogue.measure_order,
            )
            keyed.append(
                (
                    (activity_type.sort_order, activity_type.name),
                    {
                        "activity_type_id": type_id,
                        "name": activity_type.name,
                        "activities": now_tally.activities,
                        "previous_activities": (
                            then_tally.activities if prior is not None else None
                        ),
                        "counts": [
                            {
                                "measure_id": mid,
                                "label": catalogue.measures[mid].label,
                                "quantity": now_tally.quantities.get(mid, 0),
                                "previous_quantity": (
                                    then_tally.quantities.get(mid, 0)
                                    if prior is not None
                                    else None
                                ),
                            }
                            for mid in measure_ids
                        ],
                    },
                )
            )
        keyed.sort(key=lambda pair: pair[0])
        return [row for _, row in keyed]

    @staticmethod
    def _by_tag(rows: list[CrrActivity], catalogue: _Catalogue) -> list[dict[str, Any]]:
        # An activity with two tags counts under both (owner decision,
        # 2026-11-23): the question is "how much went to older adults", not a
        # partition, so these rows do not add up to the total.
        tallies: dict[str, _Tally] = defaultdict(_Tally)
        for activity in rows:
            for link in activity.tag_links:
                tallies[link.tag_id].add(activity)
        # Risks, then populations; within each, the most worked first.
        keyed: list[tuple[tuple[int, int, int, str], dict[str, Any]]] = []
        for tag_id, tally in tallies.items():
            tag = catalogue.tags.get(tag_id)
            if tag is None:
                continue
            keyed.append(
                (
                    (
                        0 if tag.kind == "risk" else 1,
                        -tally.activities,
                        tag.sort_order,
                        tag.label,
                    ),
                    {
                        "tag_id": tag_id,
                        "kind": tag.kind,
                        "label": tag.label,
                        "activities": tally.activities,
                        "counts": catalogue.counts(tally),
                    },
                )
            )
        keyed.sort(key=lambda pair: pair[0])
        return [row for _, row in keyed]

    @staticmethod
    def _by_zip(rows: list[CrrActivity], catalogue: _Catalogue) -> list[dict[str, Any]]:
        tallies: dict[str, _Tally] = defaultdict(_Tally)
        recorded: dict[str, tuple[Optional[str], Optional[str]]] = {}
        for activity in rows:
            if not activity.zip_code:
                continue
            zip_code = activity.zip_code[:5]
            tallies[zip_code].add(activity)
            recorded.setdefault(zip_code, (activity.city, activity.state))
        keyed: list[tuple[tuple[int, str], dict[str, Any]]] = []
        for zip_code, tally in tallies.items():
            # GeoNames' name for the ZIP first, so every activity in it reads
            # the same; what the recorder typed only when the ZIP is unknown.
            place = lookup_zip(zip_code)
            city, state = (
                (place.city, place.state)
                if place
                else recorded.get(zip_code, (None, None))
            )
            centre = zip_coordinates(zip_code)
            keyed.append(
                (
                    (-tally.activities, zip_code),
                    {
                        "zip_code": zip_code,
                        "city": city,
                        "state": state,
                        "latitude": centre[0] if centre else None,
                        "longitude": centre[1] if centre else None,
                        "activities": tally.activities,
                        "counts": catalogue.counts(tally),
                    },
                )
            )
        keyed.sort(key=lambda pair: pair[0])
        return [row for _, row in keyed]
