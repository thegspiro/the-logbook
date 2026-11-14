"""
History merge: two records of one person become one.

The Historian chooses the record to keep, then, for each field the two records
disagree on, which value to keep (owner decision, 2026-11-03). A field blank on
one side takes the other side's value without asking. Research text — notes,
sources, addresses, all Historian-only — may also keep both, joined.

What moves to the kept record: every service period (an exact repeat folds into
the one already held), every family link (one that would point at the kept
record itself, or repeat a link it already has, is dropped), the change history,
and any import row waiting to match the removed record. The removed record's
address forwards to the kept one.

Refused: merging a record into itself, and merging two records linked to
different member accounts, since one person cannot be two accounts.

A merge is a substantial edit of the kept record. A public record therefore
keeps showing the public its last cleared version until the merged result is
cleared in turn.
"""

from typing import Any, Optional

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import list_within_detail_limit
from app.models.history import (
    HistoricalMember,
    HistoricalMemberPeriodTitle,
    HistoricalMemberRelation,
    HistoricalMemberServicePeriod,
    HistoryClearanceRequest,
    HistoryImportRow,
    HistoryRecordRedirect,
    HistoryRevision,
    PublicationLevel,
)
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_media_service import HistoryMediaService
from app.services.history_service import (
    RECORD_MEMBER,
    HistoryService,
    display_name,
    service_years,
)

KEEP = "keep"
OTHER = "other"
BOTH = "both"

SAME = "same"
KEEP_BLANK = "keep_blank"
OTHER_BLANK = "other_blank"
DIFFERS = "differs"

#: Each choice the merge offers, the label it is shown under, and every column
#: the choice carries: a date travels with its precision and "circa" flag, a
#: memorial field with its visibility.
FIELD_GROUPS: dict[str, tuple[str, tuple[str, ...]]] = {
    "first_name": ("First name", ("first_name",)),
    "middle_name": ("Middle name", ("middle_name",)),
    "last_name": ("Last name", ("last_name",)),
    "suffix": ("Suffix", ("suffix",)),
    "nickname": ("Nickname", ("nickname",)),
    "badge_number": ("Badge number", ("badge_number",)),
    "birth_date": (
        "Birth date",
        ("birth_date", "birth_date_precision", "birth_date_circa"),
    ),
    "biography": ("Biography", ("biography",)),
    "addresses": ("Addresses", ("addresses",)),
    "verification_sources": ("Verification sources", ("verification_sources",)),
    "research_notes": ("Research notes", ("research_notes",)),
    "death_date": (
        "Death date",
        (
            "death_date",
            "death_date_precision",
            "death_date_circa",
            "death_date_visibility",
        ),
    ),
    "death_circumstances": (
        "Circumstances of death",
        ("death_circumstances", "death_circumstances_visibility"),
    ),
    "burial_location": (
        "Burial location",
        ("burial_location", "burial_location_visibility"),
    ),
}

#: Historian-only research text, where keeping both is offered.
COMBINABLE = ("addresses", "verification_sources", "research_notes")

_BOTH_SEPARATOR = "\n\n---\n\n"

_LEVEL_ORDER = [
    PublicationLevel.DRAFT,
    PublicationLevel.MEMBERS,
    PublicationLevel.PUBLIC,
]


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _shown(person: HistoricalMember, columns: tuple[str, ...]) -> Optional[str]:
    """The group's value as the merge screen shows it."""
    value = getattr(person, columns[0])
    if _blank(value):
        return None
    if hasattr(value, "isoformat"):
        circa = getattr(person, f"{columns[0]}_circa", False)
        text = value.isoformat()
        return f"c. {text}" if circa else text
    return str(value)


def _group_values(person: HistoricalMember, columns: tuple[str, ...]) -> tuple:
    return tuple(getattr(person, column) for column in columns)


class HistoryMergeService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.history = HistoryService(db)

    # ------------------------------------------------------------------
    # Preview
    # ------------------------------------------------------------------

    @staticmethod
    def _refusal(keep: HistoricalMember, other: HistoricalMember) -> Optional[str]:
        if keep.id == other.id:
            return "Choose a different record to merge"
        if keep.organization_id != other.organization_id:
            return "Person not found"
        if keep.user_id and other.user_id and keep.user_id != other.user_id:
            return (
                "These records are linked to different member accounts. One person "
                "cannot be two accounts: unlink one of them first"
            )
        return None

    def _field_states(
        self, keep: HistoricalMember, other: HistoricalMember
    ) -> list[dict[str, Any]]:
        out = []
        for key, (label, columns) in FIELD_GROUPS.items():
            mine, theirs = _group_values(keep, columns), _group_values(other, columns)
            if mine == theirs:
                state = SAME
            elif _blank(mine[0]):
                state = KEEP_BLANK
            elif _blank(theirs[0]):
                state = OTHER_BLANK
            else:
                state = DIFFERS
            out.append(
                {
                    "field": key,
                    "label": label,
                    "keep_value": _shown(keep, columns),
                    "other_value": _shown(other, columns),
                    "state": state,
                    "can_keep_both": key in COMBINABLE,
                }
            )
        return out

    async def _relation_count(self, person: HistoricalMember) -> int:
        result = await self.db.execute(
            select(HistoricalMemberRelation.id).where(
                HistoricalMemberRelation.organization_id == person.organization_id,
                or_(
                    HistoricalMemberRelation.member_id == person.id,
                    HistoricalMemberRelation.related_member_id == person.id,
                ),
            )
        )
        return len(result.all())

    async def _side(self, person: HistoricalMember) -> dict[str, Any]:
        linked = person.user
        return {
            "id": person.id,
            "display_name": display_name(person),
            "service_years": service_years(person.service_periods),
            "publication_level": person.publication_level,
            "period_count": len(person.service_periods),
            "relation_count": await self._relation_count(person),
            "linked_member_name": linked.full_name if linked is not None else None,
            "is_memorial": person.is_memorial,
            "is_line_of_duty_death": person.is_line_of_duty_death,
        }

    async def preview(
        self, keep: HistoricalMember, other: HistoricalMember
    ) -> dict[str, Any]:
        refusal = self._refusal(keep, other)
        warnings = []
        if _LEVEL_ORDER.index(other.publication_level) > _LEVEL_ORDER.index(
            keep.publication_level
        ):
            warnings.append(
                f"{display_name(other)} is published to "
                f"{other.publication_level.value}, and the record you are keeping is "
                f"{keep.publication_level.value}. The merged record stays "
                f"{keep.publication_level.value}: publish it again afterwards if it "
                "should be."
            )
        if keep.publication_level == PublicationLevel.PUBLIC:
            warnings.append(
                "The record you are keeping is public. The merge is a substantial "
                "change, so the public keeps seeing the current version until the "
                "merged record is cleared."
            )
        return {
            "keep": await self._side(keep),
            "other": await self._side(other),
            "fields": [] if refusal else self._field_states(keep, other),
            "refusal": refusal,
            "warnings": warnings,
        }

    # ------------------------------------------------------------------
    # Merge
    # ------------------------------------------------------------------

    async def merge(
        self,
        organization_id: str,
        keep_id: str,
        other_id: str,
        choices: dict[str, str],
        actor_id: str,
    ) -> HistoricalMember:
        # Both rows locked, in id order so two merges of the same pair started
        # from opposite ends cannot deadlock.
        await self.db.execute(
            select(HistoricalMember.id)
            .where(
                HistoricalMember.organization_id == str(organization_id),
                HistoricalMember.id.in_(sorted({str(keep_id), str(other_id)})),
            )
            .order_by(HistoricalMember.id)
            .with_for_update()
        )
        keep = await self.history.get_person(organization_id, keep_id)
        other = await self.history.get_person(organization_id, other_id)
        if keep is None or other is None:
            raise LookupError("Person not found")
        refusal = self._refusal(keep, other)
        if refusal:
            raise ValueError(refusal)

        self._apply_fields(keep, other, choices)
        if not keep.user_id and other.user_id:
            keep.user_id = other.user_id
        # A memorial or line-of-duty designation on either record carries: a
        # flag that is off is an absence, not a competing value.
        keep.is_memorial = keep.is_memorial or other.is_memorial
        keep.is_line_of_duty_death = (
            keep.is_line_of_duty_death or other.is_line_of_duty_death
        )
        other_label = display_name(other)
        await self.db.flush()

        await self._move_periods(keep, other)
        await self._move_relations(keep, other)
        # Photo and media tags follow the person; an item tagged with both
        # keeps one tag.
        await HistoryMediaService(self.db).move_tags(other.id, keep.id)
        await self._move_references(keep, other, actor_id)

        # A plain DELETE: the periods and links have already moved, and the
        # ORM's cascade would reload the collections it is about to delete.
        await self.db.execute(
            delete(HistoricalMember).where(
                HistoricalMember.id == other.id,
                HistoricalMember.organization_id == str(organization_id),
            )
        )
        self.db.expunge(other)
        keep.updated_by = actor_id
        await self.db.flush()
        reloaded = await self.history.get_person(organization_id, keep.id)
        if reloaded is None:
            raise LookupError("Person not found")
        return await self.history._after_edit(
            reloaded, "substantial", f"Merged with {other_label}", actor_id
        )

    @staticmethod
    def _apply_fields(
        keep: HistoricalMember, other: HistoricalMember, choices: dict[str, str]
    ) -> None:
        missing = []
        for key, (label, columns) in FIELD_GROUPS.items():
            mine, theirs = _group_values(keep, columns), _group_values(other, columns)
            if mine == theirs or _blank(theirs[0]):
                continue
            if _blank(mine[0]):
                for column in columns:
                    setattr(keep, column, getattr(other, column))
                continue
            choice = choices.get(key)
            if choice == KEEP:
                continue
            if choice == OTHER:
                for column in columns:
                    setattr(keep, column, getattr(other, column))
            elif choice == BOTH and key in COMBINABLE:
                setattr(keep, key, f"{mine[0]}{_BOTH_SEPARATOR}{theirs[0]}")
            else:
                missing.append(label)
        if missing:
            raise ValueError(
                list_within_detail_limit("Choose which value to keep for: ", missing)
            )

    async def _move_periods(
        self, keep: HistoricalMember, other: HistoricalMember
    ) -> None:
        order = len(keep.service_periods)
        for period in list(other.service_periods):
            twin = next(
                (
                    p
                    for p in keep.service_periods
                    if p.start_date == period.start_date
                    and p.end_date == period.end_date
                    and p.is_ongoing == period.is_ongoing
                ),
                None,
            )
            if twin is None:
                await self.db.execute(
                    update(HistoricalMemberServicePeriod)
                    .where(HistoricalMemberServicePeriod.id == period.id)
                    .values(member_id=keep.id, sort_order=order)
                    .execution_options(synchronize_session=False)
                )
                order += 1
                continue
            held = {t.title_id for t in twin.titles}
            for link in period.titles:
                if link.title_id not in held:
                    self.db.add(
                        HistoricalMemberPeriodTitle(
                            period_id=twin.id, title_id=link.title_id
                        )
                    )
                    held.add(link.title_id)
            await self.db.execute(
                delete(HistoricalMemberServicePeriod).where(
                    HistoricalMemberServicePeriod.id == period.id
                )
            )
        # The relationship collections were read before the moves above.
        self.db.expire(other, ["service_periods"])
        self.db.expire(keep, ["service_periods"])
        await self.db.flush()

    async def _move_relations(
        self, keep: HistoricalMember, other: HistoricalMember
    ) -> None:
        result = await self.db.execute(
            select(HistoricalMemberRelation).where(
                HistoricalMemberRelation.organization_id == keep.organization_id,
                or_(
                    HistoricalMemberRelation.member_id == other.id,
                    HistoricalMemberRelation.related_member_id == other.id,
                ),
            )
        )
        for relation in result.scalars().all():
            member_id = (
                keep.id if relation.member_id == other.id else relation.member_id
            )
            related_id = (
                keep.id
                if relation.related_member_id == other.id
                else relation.related_member_id
            )
            third = related_id if member_id == keep.id else member_id
            duplicate = None
            if member_id != related_id:
                duplicate = await self.db.scalar(
                    select(HistoricalMemberRelation.id).where(
                        HistoricalMemberRelation.organization_id
                        == keep.organization_id,
                        HistoricalMemberRelation.id != relation.id,
                        or_(
                            and_(
                                HistoricalMemberRelation.member_id == keep.id,
                                HistoricalMemberRelation.related_member_id == third,
                            ),
                            and_(
                                HistoricalMemberRelation.member_id == third,
                                HistoricalMemberRelation.related_member_id == keep.id,
                            ),
                        ),
                    )
                )
            if member_id == related_id or duplicate:
                await self.db.delete(relation)
            else:
                relation.member_id = member_id
                relation.related_member_id = related_id
            await self.db.flush()

    async def _move_references(
        self, keep: HistoricalMember, other: HistoricalMember, actor_id: str
    ) -> None:
        org = keep.organization_id
        # The removed record's open review is reviewing a record that is about
        # to stop existing. Its requests are then deleted rather than moved:
        # clearance compares revision numbers, so a request cleared for the
        # removed record's revision 4 would vouch for the kept record's.
        # The change history keeps the review's every step regardless.
        await HistoryClearanceService(self.db).withdraw_pending(
            org, RECORD_MEMBER, other.id, actor_id
        )
        await self.db.execute(
            delete(HistoryClearanceRequest).where(
                HistoryClearanceRequest.organization_id == org,
                HistoryClearanceRequest.record_type == RECORD_MEMBER,
                HistoryClearanceRequest.record_id == other.id,
            )
        )
        await self.db.execute(
            update(HistoryRevision)
            .where(
                HistoryRevision.organization_id == org,
                HistoryRevision.record_type == RECORD_MEMBER,
                HistoryRevision.record_id == other.id,
            )
            .values(record_id=keep.id)
            .execution_options(synchronize_session=False)
        )
        await self.db.execute(
            update(HistoryImportRow)
            .where(HistoryImportRow.target_member_id == other.id)
            .values(target_member_id=keep.id)
            .execution_options(synchronize_session=False)
        )
        # Never a chain: whatever led to the removed record now leads straight
        # to the kept one.
        await self.db.execute(
            update(HistoryRecordRedirect)
            .where(
                HistoryRecordRedirect.organization_id == org,
                HistoryRecordRedirect.record_type == RECORD_MEMBER,
                HistoryRecordRedirect.new_id == other.id,
            )
            .values(new_id=keep.id)
            .execution_options(synchronize_session=False)
        )
        await self.db.execute(
            delete(HistoryRecordRedirect).where(
                HistoryRecordRedirect.organization_id == org,
                HistoryRecordRedirect.record_type == RECORD_MEMBER,
                HistoryRecordRedirect.old_id == keep.id,
            )
        )
        self.db.add(
            HistoryRecordRedirect(
                organization_id=org,
                record_type=RECORD_MEMBER,
                old_id=other.id,
                new_id=keep.id,
                merged_by=actor_id,
            )
        )
        await self.db.flush()
