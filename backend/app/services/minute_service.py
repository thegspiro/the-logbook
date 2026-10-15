"""
Meeting Minutes Service

Business logic for meeting minutes management.
"""

import copy
from datetime import datetime, time, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, selectinload

from app.core.utils import generate_uuid
from app.models.document import Document
from app.models.election import Election
from app.models.event import Event
from app.models.minute import (
    DEFAULT_ANNUAL_SECTIONS,
    DEFAULT_BUSINESS_SECTIONS,
    DEFAULT_COMMITTEE_SECTIONS,
    DEFAULT_EXECUTIVE_SECTIONS,
    DEFAULT_SPECIAL_SECTIONS,
    DEFAULT_TRUSTEE_SECTIONS,
    ActionItem,
    ActionItemPriority,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesMeetingType,
    MinutesStatus,
    MinutesTemplate,
    Motion,
    MotionStatus,
)
from app.models.user import User
from app.schemas.minute import (
    ActionItemCreate,
    ActionItemUpdate,
    MinutesAdopt,
    MinutesCreate,
    MinutesUpdate,
    MotionCreate,
    MotionUpdate,
)
from app.services.separation_of_duties import assert_different_person
from app.services.template_service import TemplateService
from app.utils.minutes_attendance import normalize_attendee
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_all_in_org, assert_in_org
from app.utils.org_timezone import resolve_scheduling_timezone
from app.utils.rich_text import normalize_format, section_is_blank
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

_DEFAULT_SECTIONS_BY_TYPE = {
    "special": DEFAULT_SPECIAL_SECTIONS,
    "committee": DEFAULT_COMMITTEE_SECTIONS,
    "trustee": DEFAULT_TRUSTEE_SECTIONS,
    "executive": DEFAULT_EXECUTIVE_SECTIONS,
    "annual": DEFAULT_ANNUAL_SECTIONS,
}


# The only fields a member may change on an action item assigned to them
# without minutes.manage (W52-7). Widening this widens a write permission.
ASSIGNEE_EDITABLE_FIELDS = frozenset({"status", "completion_notes"})


def member_visible_conditions() -> tuple:
    """What a caller without ``minutes.manage`` may read.

    Minutes that have been circulated for review (submitted) or adopted
    (approved), and never executive-session minutes. A draft is the secretary's
    work in progress and stays hidden until it is circulated.
    """
    return (
        MeetingMinutes.status.in_(
            [MinutesStatus.SUBMITTED.value, MinutesStatus.APPROVED.value]
        ),
        MeetingMinutes.meeting_type != MinutesMeetingType.EXECUTIVE.value,
    )


def _default_sections_for(meeting_type) -> list:
    """The starting sections for a meeting type; business for anything else."""
    value = getattr(meeting_type, "value", meeting_type)
    return _DEFAULT_SECTIONS_BY_TYPE.get(value, DEFAULT_BUSINESS_SECTIONS)


class MinuteService:
    """Service for meeting minutes management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Action-item assignees (W52-6)
    # ============================================

    async def list_assignable_members(self, organization_id: UUID | str) -> List[dict]:
        """Every active member of the department, as ``{id, name}``.

        Any active member may be assigned an action item — the owner's
        decision; it is not limited to members who can read minutes.
        """
        result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.is_active,
            )
        )
        members = [
            {"id": str(u.id), "name": u.display_name or u.username}
            for u in result.scalars().all()
        ]
        return sorted(members, key=lambda m: (m["name"] or "").lower())

    async def _active_assignee_name(self, assignee_id: str, organization_id) -> str:
        """The name to store beside ``assignee_id``, or ValueError.

        One query does the org check (XC-1) and the active check: the error
        does not say which failed, so it is no existence oracle across
        departments.
        """
        result = await self.db.execute(
            select(User).where(
                User.id == str(assignee_id),
                User.organization_id == str(organization_id),
                User.is_active,
            )
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise ValueError("Invalid assignee: choose an active member")
        name: str = user.display_name or user.username
        return name

    # ============================================
    # Outlines and motion ballots
    # ============================================

    @staticmethod
    def _sections_from_outline(sections) -> list:
        """Minutes sections from an outline's (or a built-in's) section list.

        The outline's ``default_content`` becomes the starting ``content`` and
        its ``required`` flag travels with the section, so the rule survives the
        outline being edited later.
        """
        return [
            {
                "order": s.get("order", index),
                "key": s["key"],
                "title": s["title"],
                "content": s.get("default_content") or s.get("content") or "",
                "format": normalize_format(s.get("format")),
                "required": bool(s.get("required", False)),
                "needs_motion": bool(s.get("needs_motion", False)),
                "motion_text": s.get("motion_text") or "",
            }
            for index, s in enumerate(sections)
        ]

    async def _check_motion_ballot(
        self,
        election_id: Optional[str],
        ballot_item_id: Optional[str],
        organization_id: UUID | str,
    ) -> None:
        """A motion's ballot link must name this department's election and an
        item that is really on that ballot (XC-1)."""
        if not election_id:
            if ballot_item_id:
                raise ValueError("A ballot item needs the election it belongs to")
            return
        await assert_in_org(
            self.db, Election, election_id, organization_id, label="election"
        )
        if not ballot_item_id:
            return
        election = (
            await self.db.execute(
                select(Election).where(
                    Election.id == str(election_id),
                    Election.organization_id == str(organization_id),
                )
            )
        ).scalar_one()
        known = {
            str(item.get("id"))
            for item in (election.ballot_items or [])
            if isinstance(item, dict) and item.get("id")
        }
        if str(ballot_item_id) not in known:
            raise ValueError("That item is not on the election's ballot")

    @staticmethod
    def _check_meeting_times(started, ended) -> None:
        """The meeting cannot have ended at or before the moment it began.

        MySQL hands back naive datetimes and a client may send either, so a
        naive value is read as UTC, the zone everything here is stored in.
        """
        if started is None or ended is None:
            return

        def utc(value: datetime) -> datetime:
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

        if utc(ended) <= utc(started):
            raise ValueError(
                "The meeting must be adjourned after it is called to order"
            )

    @staticmethod
    def _check_motion_section(minutes: MeetingMinutes, section_key) -> None:
        """A motion's section must be one of these minutes' own sections."""
        if section_key and section_key not in {
            s.get("key") for s in minutes.get_sections()
        }:
            raise ValueError("That section is not part of these minutes")

    async def apply_outline(
        self, minutes_id: str, organization_id: UUID | str, template_id: str
    ) -> Optional[MeetingMinutes]:
        """Lay an outline over draft minutes without losing what is written.

        Sections the minutes already have keep their text and take the
        outline's position and required flag; sections the outline has and the
        minutes lack are added empty; sections only the minutes have stay if
        they hold text and go if they are empty.
        """
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None
        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError(
                "An outline can only be applied to draft or rejected minutes"
            )
        outline = await self._get_template(template_id, organization_id)
        if outline is None:
            raise ValueError("Invalid outline")

        existing = {s["key"]: s for s in minutes.get_sections()}
        merged = []
        for wanted in self._sections_from_outline(outline.sections or []):
            have = existing.pop(wanted["key"], None)
            if have is not None:
                wanted["content"] = have.get("content", "")
                wanted["format"] = normalize_format(have.get("format"))
                wanted["title"] = have.get("title") or wanted["title"]
            merged.append(wanted)
        for leftover in existing.values():
            if not section_is_blank(leftover):
                merged.append(
                    {
                        "order": len(merged),
                        "key": leftover["key"],
                        "title": leftover.get("title", leftover["key"]),
                        "content": leftover["content"],
                        "format": normalize_format(leftover.get("format")),
                        "required": False,
                    }
                )
        for index, section in enumerate(merged):
            section["order"] = index

        minutes.sections = merged
        minutes.template_id = outline.id
        if not minutes.header_config and outline.header_config:
            minutes.header_config = copy.deepcopy(outline.header_config)
        if not minutes.footer_config and outline.footer_config:
            minutes.footer_config = copy.deepcopy(outline.footer_config)
        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    # ============================================
    # Meeting Minutes CRUD
    # ============================================

    async def create_minutes(
        self, data: MinutesCreate, organization_id: UUID | str, created_by: UUID | str
    ) -> MeetingMinutes:
        """Create new meeting minutes with optional motions and action items"""
        minutes_dict = data.model_dump(exclude={"motions", "action_items"})

        # MM-4 (XC-1): validate client-supplied FKs are in-org before storing.
        # event_id links the minutes to a meeting event; each action item may
        # name an assignee. None is allowed (both are optional).
        await assert_in_org(
            self.db,
            Event,
            minutes_dict.get("event_id"),
            organization_id,
            allow_none=True,
            label="event",
        )
        assignee_names: dict[str, str] = {}
        for item_data in data.action_items or []:
            if item_data.assignee_id:
                assignee_names[item_data.assignee_id] = (
                    await self._active_assignee_name(
                        item_data.assignee_id, organization_id
                    )
                )
        # Attendees are a JSON list; an entry may name a member by user_id or
        # be a free-text guest (user_id omitted). A named member must be ours.
        await assert_all_in_org(
            self.db,
            User,
            [a.user_id for a in data.attendees or [] if a.user_id],
            organization_id,
            label="attendee",
        )

        # Serialize attendees to dicts for JSON storage
        if minutes_dict.get("attendees"):
            minutes_dict["attendees"] = [
                a.model_dump() if hasattr(a, "model_dump") else a
                for a in data.attendees or []
            ]

        # Serialize sections to dicts
        if minutes_dict.get("sections"):
            minutes_dict["sections"] = [
                s.model_dump() if hasattr(s, "model_dump") else s
                for s in data.sections or []
            ]

        # Serialize header/footer configs
        if minutes_dict.get("header_config") and data.header_config is not None:
            minutes_dict["header_config"] = data.header_config.model_dump()
        if minutes_dict.get("footer_config") and data.footer_config is not None:
            minutes_dict["footer_config"] = data.footer_config.model_dump()

        # Validate any client-supplied template_id belongs to the caller's org
        # *whenever* it is present — not only when populating sections from it.
        # Otherwise a foreign template_id is persisted and later eager-loaded by
        # get_minutes (template FK join, no org filter), leaking another org's
        # header/footer config into the response and the published document.
        template = None
        if minutes_dict.get("template_id"):
            template = await self._get_template(
                minutes_dict["template_id"], organization_id
            )
            if template is None:
                raise ValueError("Invalid template")

        # If a template is provided but no sections, populate from template
        if template and not minutes_dict.get("sections"):
            if template.sections:
                minutes_dict["sections"] = self._sections_from_outline(
                    template.sections
                )
                # Inherit header/footer from template if not explicitly set
                if not minutes_dict.get("header_config") and template.header_config:
                    minutes_dict["header_config"] = template.header_config
                if not minutes_dict.get("footer_config") and template.footer_config:
                    minutes_dict["footer_config"] = template.footer_config

        # If no template and no sections, generate default sections for the meeting type
        if not minutes_dict.get("sections"):
            minutes_dict["sections"] = self._sections_from_outline(
                _default_sections_for(minutes_dict.get("meeting_type"))
            )

        self._check_meeting_times(
            minutes_dict.get("called_to_order_at"), minutes_dict.get("adjourned_at")
        )
        minutes = MeetingMinutes(
            **minutes_dict,
            organization_id=str(organization_id),
            created_by=str(created_by),
            status=MinutesStatus.DRAFT,
        )
        self.db.add(minutes)
        await self.db.flush()

        # Create inline motions
        if data.motions:
            for i, motion_data in enumerate(data.motions):
                await self._check_motion_ballot(
                    motion_data.election_id, motion_data.ballot_item_id, organization_id
                )
                motion = Motion(
                    minutes_id=minutes.id,
                    order=motion_data.order if motion_data.order else i,
                    motion_text=motion_data.motion_text,
                    moved_by=motion_data.moved_by,
                    seconded_by=motion_data.seconded_by,
                    discussion_notes=motion_data.discussion_notes,
                    status=MotionStatus(motion_data.status),
                    votes_for=motion_data.votes_for,
                    votes_against=motion_data.votes_against,
                    votes_abstain=motion_data.votes_abstain,
                    election_id=motion_data.election_id,
                    ballot_item_id=motion_data.ballot_item_id,
                )
                self.db.add(motion)

        # Create inline action items
        if data.action_items:
            for item_data in data.action_items:
                item = ActionItem(
                    minutes_id=minutes.id,
                    description=item_data.description,
                    assignee_id=item_data.assignee_id,
                    assignee_name=(
                        assignee_names.get(
                            item_data.assignee_id, item_data.assignee_name
                        )
                        if item_data.assignee_id
                        else item_data.assignee_name
                    ),
                    due_date=item_data.due_date,
                    priority=ActionItemPriority(item_data.priority),
                    status=MinutesActionItemStatus.PENDING,
                )
                self.db.add(item)

        await self.db.commit()
        await self.db.refresh(minutes)

        # Reload with relationships
        reloaded = await self.get_minutes(minutes.id, organization_id)
        if reloaded is None:
            raise RuntimeError("Meeting minutes vanished immediately after creation")
        return reloaded

    async def _get_template(
        self, template_id: str, organization_id: UUID | str
    ) -> Optional[MinutesTemplate]:
        """Get a template by ID"""
        result = await self.db.execute(
            select(MinutesTemplate)
            .where(MinutesTemplate.id == str(template_id))
            .where(MinutesTemplate.organization_id == str(organization_id))
        )
        minutes_template: Optional[MinutesTemplate] = result.scalar_one_or_none()
        return minutes_template

    async def get_minutes(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        restricted: bool = False,
        load_children: bool = True,
        refresh: bool = False,
    ) -> Optional[MeetingMinutes]:
        """Get a single meeting minutes record with all relationships.

        ``restricted=True`` (a caller without ``minutes.manage``) limits the
        result to approved, non-executive minutes — unpublished drafts and
        closed executive-session minutes return None (→ 404) so their existence
        isn't revealed. Internal/manage callers use the default (see all).

        ``refresh=True`` re-reads the row and its relationships even if the
        session already holds it, for a caller that has just changed what a
        relationship points at (the adopting meeting) and must not return the
        stale object.

        ``load_children=False`` leaves the motions and action items unloaded
        for a caller that pages them with queries of its own; the returned
        row must not have those attributes read.
        """
        options = [
            selectinload(MeetingMinutes.template),
            selectinload(MeetingMinutes.adopting_minutes),
        ]
        if load_children:
            options = [
                selectinload(MeetingMinutes.motions),
                selectinload(MeetingMinutes.action_items),
                *options,
            ]
        query = (
            select(MeetingMinutes)
            .where(MeetingMinutes.id == minutes_id)
            .where(MeetingMinutes.organization_id == str(organization_id))
            .options(*options)
        )
        if restricted:
            query = query.where(
                *member_visible_conditions(),
            )
        if refresh:
            query = query.execution_options(populate_existing=True)
        result = await self.db.execute(query)
        meeting_minutes: Optional[MeetingMinutes] = result.scalar_one_or_none()
        return meeting_minutes

    async def list_minutes(
        self,
        organization_id: UUID | str,
        meeting_type: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
        restricted: bool = False,
        summary_only: bool = False,
    ) -> List[MeetingMinutes]:
        """List meeting minutes with filtering.

        ``restricted=True`` (a caller without ``minutes.manage``) confines the
        listing to approved, non-executive minutes regardless of the requested
        status/meeting-type filters.

        ``summary_only=True`` leaves the body columns (the reports, the
        sections JSON, attendees) unloaded and does not load motions or
        action items, for a caller that renders headings only; the returned
        rows must not have those attributes read.
        """
        query = select(MeetingMinutes).where(
            MeetingMinutes.organization_id == str(organization_id)
        )
        if summary_only:
            query = query.options(
                *(
                    defer(getattr(MeetingMinutes, name))
                    for name in (
                        "agenda",
                        "old_business",
                        "new_business",
                        "treasurer_report",
                        "chief_report",
                        "committee_reports",
                        "announcements",
                        "notes",
                        "sections",
                        "attendees",
                        "header_config",
                        "footer_config",
                    )
                )
            )
        else:
            query = query.options(
                selectinload(MeetingMinutes.motions),
                selectinload(MeetingMinutes.action_items),
            )

        if meeting_type:
            query = query.where(MeetingMinutes.meeting_type == meeting_type)

        if restricted:
            # Members see only ratified, non-executive minutes; a requested
            # status filter cannot widen this.
            query = query.where(
                *member_visible_conditions(),
            )
        elif status:
            query = query.where(MeetingMinutes.status == status)

        if search:
            search_term = like_pattern(search)
            query = query.where(
                or_(
                    MeetingMinutes.title.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    MeetingMinutes.notes.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    MeetingMinutes.old_business.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                    MeetingMinutes.new_business.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                    MeetingMinutes.agenda.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    MeetingMinutes.announcements.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                )
            )

        # The id breaks ties between minutes of one day, so an offset page
        # never repeats or skips one.
        query = (
            query.order_by(MeetingMinutes.meeting_date.desc(), MeetingMinutes.id.desc())
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_minutes(
        self, minutes_id: str, organization_id: UUID | str, data: MinutesUpdate
    ) -> Optional[MeetingMinutes]:
        """Update meeting minutes (only if in draft or rejected status)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError("Can only edit minutes in draft or rejected status")

        update_data = data.model_dump(exclude_unset=True)

        # Clear event_id if empty string
        if "event_id" in update_data and not update_data["event_id"]:
            update_data["event_id"] = None

        # MM-4 (XC-1): validate a re-pointed event_id is in-org before applying.
        if update_data.get("event_id"):
            await assert_in_org(
                self.db,
                Event,
                update_data["event_id"],
                organization_id,
                label="event",
            )
        if update_data.get("attendees"):
            await assert_all_in_org(
                self.db,
                User,
                [a.user_id for a in data.attendees or [] if a.user_id],
                organization_id,
                label="attendee",
            )

        # Serialize attendees
        if "attendees" in update_data and update_data["attendees"]:
            update_data["attendees"] = [
                a.model_dump() if hasattr(a, "model_dump") else a
                for a in data.attendees or []
            ]

        # Serialize sections
        if "sections" in update_data and update_data["sections"]:
            update_data["sections"] = [
                s.model_dump() if hasattr(s, "model_dump") else s
                for s in data.sections or []
            ]

        # Serialize header/footer configs
        if (
            "header_config" in update_data
            and data.header_config
            and hasattr(data.header_config, "model_dump")
        ):
            update_data["header_config"] = data.header_config.model_dump()
        if (
            "footer_config" in update_data
            and data.footer_config
            and hasattr(data.footer_config, "model_dump")
        ):
            update_data["footer_config"] = data.footer_config.model_dump()

        # Only when a time is being changed, so minutes saved before this check
        # existed stay editable. Judged on what the minutes will hold: moving
        # only the end is checked against the saved start.
        if "called_to_order_at" in update_data or "adjourned_at" in update_data:
            self._check_meeting_times(
                update_data.get("called_to_order_at", minutes.called_to_order_at),
                update_data.get("adjourned_at", minutes.adjourned_at),
            )

        apply_updates(
            minutes, update_data, skip={"id", "organization_id", "created_by"}
        )

        # Reset to draft if was rejected
        if minutes.status == MinutesStatus.REJECTED.value:
            minutes.status = MinutesStatus.DRAFT
            minutes.rejected_at = None
            minutes.rejected_by = None
            minutes.rejection_reason = None

        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    async def delete_minutes(
        self, minutes_id: str, organization_id: UUID | str
    ) -> bool:
        """Delete meeting minutes (only if in draft status)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return False

        if minutes.status not in (MinutesStatus.DRAFT.value,):
            raise ValueError("Can only delete draft minutes")

        await self.db.delete(minutes)
        await self.db.commit()
        return True

    # ============================================
    # Approval Workflow
    # ============================================

    async def submit_for_approval(
        self, minutes_id: str, organization_id: UUID | str, submitted_by: UUID | str
    ) -> Optional[MeetingMinutes]:
        """Circulate draft minutes for review (the 'submitted' status)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError("Can only submit draft or rejected minutes")

        missing = self.missing_required_sections(minutes)
        if missing:
            raise ValueError(
                "These sections are required by the outline and have no "
                f"content yet: {', '.join(missing)}"
            )

        minutes.status = MinutesStatus.SUBMITTED
        minutes.submitted_at = datetime.now(timezone.utc)
        minutes.submitted_by = str(submitted_by)
        minutes.rejected_at = None
        minutes.rejected_by = None
        minutes.rejection_reason = None

        await self.db.commit()
        circulated = await self.get_minutes(minutes_id, organization_id)
        if circulated is not None:
            await self._notify_circulated(circulated)
        return circulated

    async def _notify_circulated(self, minutes: MeetingMinutes) -> None:
        """Tell the members the minutes are out for review; never raises.

        The status change has already committed, so a mail problem must not
        turn a successful circulation into an error the secretary retries.
        """
        from app.services.minutes_notifications import notify_minutes_circulated

        try:
            await notify_minutes_circulated(self.db, minutes)
            await self.db.commit()
        except Exception as exc:
            await self.db.rollback()
            logger.warning(
                "Circulation notification for minutes {} failed: {}", minutes.id, exc
            )

    @staticmethod
    def missing_required_sections(minutes: MeetingMinutes) -> List[str]:
        """Titles of the outline's required sections that are still empty.

        The roll-call section is met by a recorded roll, since attendance is
        taken on its own panel and not typed into the section.
        """
        missing = []
        for section in minutes.get_sections():
            if not section.get("required"):
                continue
            if not section_is_blank(section):
                continue
            if section.get("key") == "roll_call" and minutes.attendees:
                continue
            missing.append(section.get("title") or section.get("key") or "Untitled")
        return missing

    async def recall_minutes(
        self, minutes_id: str, organization_id: UUID | str
    ) -> Optional[MeetingMinutes]:
        """Take circulated minutes back to draft so suggestions can be made.

        Suggestions already made are kept. The minutes must be circulated again
        before they can be adopted.
        """
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None
        if minutes.status != MinutesStatus.SUBMITTED.value:
            raise ValueError("Only minutes circulated for review can be recalled")

        minutes.status = MinutesStatus.DRAFT
        minutes.submitted_at = None
        minutes.submitted_by = None
        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    async def approve_minutes(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        approved_by: UUID | str,
        adoption: Optional[MinutesAdopt] = None,
    ) -> Optional[MeetingMinutes]:
        """Adopt submitted minutes and record the adopted version

        ``adoption`` says what the body did: the day of the vote, the minutes of
        the meeting that adopted these, and whether as presented or as amended.
        Left out, the vote is dated now and "as amended" follows whether any
        suggestion was accepted.
        """
        from app.services.minutes_record_service import MinutesRecordService

        # Locked before the status is read: two approvers acting at once would
        # otherwise both see SUBMITTED and each write a revision.
        records = MinutesRecordService(self.db)
        if await records.lock_minutes(minutes_id, organization_id) is None:
            return None
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status != MinutesStatus.SUBMITTED.value:
            raise ValueError("Can only approve submitted minutes")

        # Separation of duties: holding minutes.manage says nothing about
        # whose minutes these are. Without this, a single secretary could
        # submit and then immediately approve their own record — the same
        # self-certification gap already closed for finance requests (FIN-4),
        # skills tests (CS-8), and admin hours (AH-4) via this shared guard.
        assert_different_person(
            str(approved_by),
            minutes.submitted_by,
            action="approve",
            record="meeting minutes",
        )

        adoption = adoption or MinutesAdopt()
        if adoption.adopting_minutes_id:
            # XC-1: the id is the client's. The adopting meeting must be one of
            # this department's own, and not these minutes themselves.
            if str(adoption.adopting_minutes_id) == str(minutes.id):
                raise ValueError("Minutes cannot be adopted at their own meeting")
            await assert_in_org(
                self.db,
                MeetingMinutes,
                adoption.adopting_minutes_id,
                organization_id,
                label="adopting meeting",
            )
        as_amended = adoption.as_amended
        if as_amended is None:
            as_amended = await records.has_accepted_suggestions(minutes.id)

        # Whole seconds: MySQL rounds a fractional second when it stores one,
        # MariaDB truncates, and the snapshot truncates. A value with a
        # fraction would be stored a second later than it was hashed, and
        # verify would report the adoption as changed on MySQL only.
        approved_at = datetime.now(timezone.utc).replace(microsecond=0)
        minutes.status = MinutesStatus.APPROVED
        minutes.approved_at = approved_at
        minutes.approved_by = str(approved_by)
        minutes.adopted_on = (
            adoption.adopted_on.replace(microsecond=0)
            if adoption.adopted_on
            else approved_at
        )
        minutes.adopted_as_amended = as_amended
        minutes.adoption_moved_by = adoption.moved_by
        minutes.adoption_seconded_by = adoption.seconded_by
        minutes.adopting_minutes_id = (
            str(adoption.adopting_minutes_id) if adoption.adopting_minutes_id else None
        )

        await records.record_approval(minutes, approved_by, approved_at)
        await self.db.commit()

        approved = await self.get_minutes(minutes_id, organization_id, refresh=True)
        if approved is not None:
            await self._notify_assignees(approved, approved.action_items or [])
        return approved

    async def _notify_assignees(self, minutes: MeetingMinutes, items) -> None:
        """Email assignees about items in approved minutes; never raises.

        The approval has already committed, so a mail problem must not turn a
        successful approval into an error the secretary retries.
        """
        from app.services.minutes_notifications import notify_action_item_assignees

        try:
            await notify_action_item_assignees(self.db, minutes, items)
            await self.db.commit()
        except Exception as exc:
            await self.db.rollback()
            logger.warning(
                "Action item notification for minutes {} failed: {}", minutes.id, exc
            )

    async def reject_minutes(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        rejected_by: UUID | str,
        reason: str,
    ) -> Optional[MeetingMinutes]:
        """Reject submitted minutes with a reason"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status != MinutesStatus.SUBMITTED.value:
            raise ValueError("Can only reject submitted minutes")

        minutes.status = MinutesStatus.REJECTED
        minutes.rejected_at = datetime.now(timezone.utc)
        minutes.rejected_by = str(rejected_by)
        minutes.rejection_reason = reason

        await self.db.commit()
        return await self.get_minutes(minutes_id, organization_id)

    async def reopen_minutes(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        reopened_by: Optional[UUID | str] = None,
        reason: Optional[str] = None,
    ) -> Optional[Tuple[MeetingMinutes, dict]]:
        """Return approved minutes to draft so a correction can be made.

        MM-17 (owner decision): approved minutes are locked — content, motions,
        action items and the quorum settings — and a correction goes through
        this path rather than through an exemption on any one endpoint. The
        record leaves APPROVED, so members stop seeing it as ratified until it
        is submitted and approved again, by someone other than its submitter
        (approve_minutes' separation of duties applies to the re-approval as
        it did to the first). The prior approval is returned so the caller can
        write it into the audit trail, which is the only place it survives.
        """
        from app.services.minutes_record_service import MinutesRecordService

        records = MinutesRecordService(self.db)
        if await records.lock_minutes(minutes_id, organization_id) is None:
            return None
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status != MinutesStatus.APPROVED.value:
            raise ValueError("Only approved minutes can be reopened")

        prior = {
            "previous_approved_by": minutes.approved_by,
            "previous_approved_at": (
                minutes.approved_at.isoformat() if minutes.approved_at else None
            ),
            "previous_submitted_by": minutes.submitted_by,
        }

        # The approved version is kept on file, marked as replaced, so the
        # text the body first approved survives the correction.
        await records.supersede_on_reopen(
            minutes, reopened_by, reason, datetime.now(timezone.utc)
        )

        minutes.status = MinutesStatus.DRAFT
        minutes.approved_at = None
        minutes.approved_by = None
        minutes.adopted_on = None
        minutes.adopted_as_amended = None
        minutes.adoption_moved_by = None
        minutes.adoption_seconded_by = None
        minutes.adopting_minutes_id = None
        minutes.submitted_at = None
        minutes.submitted_by = None
        minutes.rejected_at = None
        minutes.rejected_by = None
        minutes.rejection_reason = None

        # Owner decision (2026-10-12): a document already published from the
        # approved version stays readable, flagged as being corrected, until
        # the corrected minutes are republished over it (publish_minutes
        # clears the flag). Resolved in-org: published_document_id is a plain
        # column with no FK, so it is never trusted on its own.
        if minutes.published_document_id:
            doc_result = await self.db.execute(
                select(Document).where(
                    Document.id == minutes.published_document_id,
                    Document.organization_id == str(organization_id),
                )
            )
            published = doc_result.scalar_one_or_none()
            if published is not None:
                published.under_correction_since = datetime.now(timezone.utc)

        await self.db.commit()
        refreshed = await self.get_minutes(minutes_id, organization_id, refresh=True)
        if refreshed is None:
            return None
        return refreshed, prior

    # ============================================
    # Motion CRUD
    # ============================================

    async def add_motion(
        self, minutes_id: str, organization_id: UUID | str, data: MotionCreate
    ) -> Optional[Motion]:
        """Add a motion to meeting minutes"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError("Can only add motions to draft or rejected minutes")

        self._check_motion_section(minutes, data.section_key)
        await self._check_motion_ballot(
            data.election_id, data.ballot_item_id, organization_id
        )
        motion = Motion(
            minutes_id=minutes_id,
            order=data.order,
            motion_text=data.motion_text,
            moved_by=data.moved_by,
            seconded_by=data.seconded_by,
            section_key=data.section_key,
            discussion_notes=data.discussion_notes,
            status=MotionStatus(data.status),
            votes_for=data.votes_for,
            votes_against=data.votes_against,
            votes_abstain=data.votes_abstain,
            election_id=data.election_id,
            ballot_item_id=data.ballot_item_id,
        )
        self.db.add(motion)
        await self.db.commit()
        await self.db.refresh(motion)
        return motion

    async def update_motion(
        self,
        motion_id: str,
        minutes_id: str,
        organization_id: UUID | str,
        data: MotionUpdate,
    ) -> Optional[Motion]:
        """Update a motion"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError("Can only edit motions on draft or rejected minutes")

        result = await self.db.execute(
            select(Motion)
            .where(Motion.id == motion_id)
            .where(Motion.minutes_id == minutes_id)
        )
        motion: Optional[Motion] = result.scalar_one_or_none()
        if not motion:
            return None

        update_data = data.model_dump(exclude_unset=True)
        if "status" in update_data:
            update_data["status"] = MotionStatus(update_data["status"])
        self._check_motion_section(minutes, update_data.get("section_key"))

        if "election_id" in update_data or "ballot_item_id" in update_data:
            election_id = update_data.get("election_id", motion.election_id)
            # Un-linking the ballot drops the item that belonged to it.
            ballot_item_id = (
                update_data.get("ballot_item_id", motion.ballot_item_id)
                if election_id
                else None
            )
            await self._check_motion_ballot(
                election_id, ballot_item_id, organization_id
            )
            update_data["election_id"] = election_id or None
            update_data["ballot_item_id"] = ballot_item_id

        apply_updates(motion, update_data, skip={"id", "minutes_id"})

        await self.db.commit()
        await self.db.refresh(motion)
        return motion

    async def delete_motion(
        self, motion_id: str, minutes_id: str, organization_id: UUID | str
    ) -> bool:
        """Delete a motion"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return False

        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError("Can only delete motions on draft or rejected minutes")

        result = await self.db.execute(
            select(Motion)
            .where(Motion.id == motion_id)
            .where(Motion.minutes_id == minutes_id)
        )
        motion = result.scalar_one_or_none()
        if not motion:
            return False

        await self.db.delete(motion)
        await self.db.commit()
        return True

    # ============================================
    # Action Item CRUD
    # ============================================

    async def add_action_item(
        self, minutes_id: str, organization_id: UUID | str, data: ActionItemCreate
    ) -> Optional[ActionItem]:
        """Add an action item to meeting minutes"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        assignee_name = data.assignee_name
        if data.assignee_id:
            assignee_name = await self._active_assignee_name(
                data.assignee_id, organization_id
            )

        item = ActionItem(
            minutes_id=minutes_id,
            description=data.description,
            assignee_id=data.assignee_id,
            assignee_name=assignee_name,
            due_date=data.due_date,
            priority=ActionItemPriority(data.priority),
            status=MinutesActionItemStatus.PENDING,
        )
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        # Items added to draft minutes are announced when the minutes are
        # approved; one added to approved minutes is already a commitment.
        if minutes.status == MinutesStatus.APPROVED.value:
            await self._notify_assignees(minutes, [item])
        return item

    async def update_action_item(
        self,
        item_id: str,
        minutes_id: str,
        organization_id: UUID | str,
        data: ActionItemUpdate,
        as_assignee: Optional[str] = None,
    ) -> Optional[ActionItem]:
        """Update an action item (status can be updated even on approved minutes)

        ``as_assignee`` is the caller's user id when they hold no
        ``minutes.manage`` and act only as the item's assignee (W52-7): the
        item must be assigned to them by ``assignee_id``, and only status and
        completion notes may change.
        """
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return None

        result = await self.db.execute(
            select(ActionItem)
            .where(ActionItem.id == str(item_id))
            .where(ActionItem.minutes_id == minutes_id)
        )
        item: Optional[ActionItem] = result.scalar_one_or_none()
        if not item:
            return None

        update_data = data.model_dump(exclude_unset=True)

        if as_assignee is not None:
            # Someone else's item answers as missing, not forbidden, so this
            # path cannot be used to learn which items exist.
            if not item.assignee_id or str(item.assignee_id) != str(as_assignee):
                return None
            extra = set(update_data) - ASSIGNEE_EDITABLE_FIELDS
            if extra:
                raise PermissionError(
                    "As the assignee you can change only the status and "
                    "completion notes of this action item."
                )

        # For approved minutes, only allow status and completion updates
        if minutes.status == MinutesStatus.APPROVED.value:
            allowed = {"status", "completion_notes"}
            update_data = {k: v for k, v in update_data.items() if k in allowed}

        # Non-mapped attribute (same convention as MeetingsService's
        # attach_creator_names): the endpoint's audit log needs to record
        # what was actually applied, not what the client sent — on approved
        # minutes those differ, since the filter above silently drops
        # everything but status/completion_notes.
        item.applied_fields = set(update_data.keys())

        # MM-4 (XC-1) and W52-6: a new owner must be an active member of this
        # department. Keeping the current owner is not re-checked, so an item
        # whose assignee has since left can still be edited.
        new_assignee = update_data.get("assignee_id")
        if new_assignee and new_assignee != item.assignee_id:
            update_data["assignee_name"] = await self._active_assignee_name(
                new_assignee, organization_id
            )

        if "status" in update_data:
            new_status = MinutesActionItemStatus(update_data["status"])
            update_data["status"] = new_status
            # Keep completed_at consistent with the status: stamp it when the
            # item is completed, and clear it when the item is reopened so a
            # previously-completed item doesn't keep a stale completion date.
            if new_status == MinutesActionItemStatus.COMPLETED:
                update_data["completed_at"] = datetime.now(timezone.utc)
            else:
                update_data["completed_at"] = None

        if "priority" in update_data:
            update_data["priority"] = ActionItemPriority(update_data["priority"])

        apply_updates(item, update_data, skip={"id", "minutes_id"})

        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def delete_action_item(
        self, item_id: str, minutes_id: str, organization_id: UUID | str
    ) -> bool:
        """Delete an action item (only on draft/rejected minutes)"""
        minutes = await self.get_minutes(minutes_id, organization_id)
        if not minutes:
            return False

        if minutes.status not in (
            MinutesStatus.DRAFT.value,
            MinutesStatus.REJECTED.value,
        ):
            raise ValueError(
                "Can only delete action items on draft or rejected minutes"
            )

        result = await self.db.execute(
            select(ActionItem)
            .where(ActionItem.id == str(item_id))
            .where(ActionItem.minutes_id == minutes_id)
        )
        item = result.scalar_one_or_none()
        if not item:
            return False

        await self.db.delete(item)
        await self.db.commit()
        return True

    # ============================================
    # Stats & Search
    # ============================================

    async def get_stats(
        self, organization_id: UUID | str, restricted: bool = False
    ) -> dict:
        """Get aggregate stats for the minutes dashboard.

        ``restricted=True`` (a caller without ``minutes.manage``) counts only
        approved, non-executive minutes, so dashboard totals match what the
        viewer can actually open.
        """
        base = select(func.count(MeetingMinutes.id)).where(
            MeetingMinutes.organization_id == str(organization_id)
        )
        if restricted:
            base = base.where(
                *member_visible_conditions(),
            )

        total_result = await self.db.execute(base)
        total = total_result.scalar() or 0

        # This month
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        this_month_result = await self.db.execute(
            base.where(MeetingMinutes.meeting_date >= month_start)
        )
        this_month = this_month_result.scalar() or 0

        # Open action items
        open_items_query = (
            select(func.count(ActionItem.id))
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(MeetingMinutes.organization_id == str(organization_id))
            .where(
                ActionItem.status.in_(
                    [
                        MinutesActionItemStatus.PENDING.value,
                        MinutesActionItemStatus.IN_PROGRESS.value,
                        MinutesActionItemStatus.OVERDUE.value,
                    ]
                )
            )
            # An item carried into later minutes is open there, not here.
            .where(ActionItem.carried_forward_at.is_(None))
        )
        if restricted:
            open_items_query = open_items_query.where(
                MeetingMinutes.status == MinutesStatus.APPROVED.value,
                MeetingMinutes.meeting_type != MinutesMeetingType.EXECUTIVE.value,
            )
        open_items_result = await self.db.execute(open_items_query)
        open_items = open_items_result.scalar() or 0

        # Pending approval
        pending_result = await self.db.execute(
            base.where(MeetingMinutes.status == MinutesStatus.SUBMITTED.value)
        )
        pending_approval = pending_result.scalar() or 0

        return {
            "total": total,
            "this_month": this_month,
            "open_action_items": open_items,
            "pending_approval": pending_approval,
        }

    async def search_minutes(
        self,
        organization_id: UUID | str,
        query: str,
        limit: int = 20,
        restricted: bool = False,
    ) -> List[dict]:
        """Full-text search across meeting minutes content.

        ``restricted=True`` (a caller without ``minutes.manage``) confines
        matches to approved, non-executive minutes so unpublished drafts and
        executive-session snippets aren't surfaced to plain viewers.
        """
        search_term = like_pattern(query)

        # Search across all text fields
        search_fields = [
            ("title", MeetingMinutes.title),
            ("notes", MeetingMinutes.notes),
            ("agenda", MeetingMinutes.agenda),
            ("old_business", MeetingMinutes.old_business),
            ("new_business", MeetingMinutes.new_business),
            ("announcements", MeetingMinutes.announcements),
            ("treasurer_report", MeetingMinutes.treasurer_report),
            ("chief_report", MeetingMinutes.chief_report),
            ("committee_reports", MeetingMinutes.committee_reports),
        ]

        results: List[dict] = []
        seen_ids = set()

        for field_name, field in search_fields:
            if len(results) >= limit:
                break

            stmt = (
                select(MeetingMinutes)
                .where(MeetingMinutes.organization_id == str(organization_id))
                .where(field.ilike(search_term, escape=LIKE_ESCAPE_CHAR))
                .order_by(MeetingMinutes.meeting_date.desc())
                .limit(limit - len(results))
            )
            if restricted:
                stmt = stmt.where(
                    *member_visible_conditions(),
                )

            res = await self.db.execute(stmt)
            for row in res.scalars().all():
                if row.id not in seen_ids:
                    seen_ids.add(row.id)
                    field_value = getattr(row, field_name) or ""
                    # Extract a snippet around the match
                    lower_val = field_value.lower()
                    idx = lower_val.find(query.lower())
                    start = max(0, idx - 50)
                    end = min(len(field_value), idx + len(query) + 50)
                    snippet = (
                        ("..." if start > 0 else "")
                        + field_value[start:end]
                        + ("..." if end < len(field_value) else "")
                    )

                    results.append(
                        {
                            "id": row.id,
                            "title": row.title,
                            "meeting_type": (
                                row.meeting_type
                                if isinstance(row.meeting_type, str)
                                else row.meeting_type.value
                            ),
                            "meeting_date": row.meeting_date,
                            "status": (
                                row.status
                                if isinstance(row.status, str)
                                else row.status.value
                            ),
                            "snippet": snippet,
                            "match_field": field_name,
                        }
                    )

        return results

    # ============================================
    # Cross-module Bridges
    # ============================================

    async def create_from_meeting(
        self,
        meeting_id: UUID,
        organization_id: UUID | str,
        created_by: UUID | str,
        template_id: Optional[str] = None,
    ) -> Optional[MeetingMinutes]:
        """
        Create meeting minutes pre-populated from a Meeting record.
        Bridges the Meeting module → Minutes module gap identified in architecture review.
        Copies: title, date, attendees, meeting type, and location.
        """
        from app.models.meeting import Meeting

        result = await self.db.execute(
            select(Meeting)
            .options(selectinload(Meeting.attendees))
            .where(
                Meeting.id == str(meeting_id),
                Meeting.organization_id == str(organization_id),
            )
        )
        meeting = result.scalar_one_or_none()
        if not meeting:
            return None

        # Map meeting type to minutes meeting type
        # Every meeting type has a minutes type of the same name. Executive is
        # the one that matters: falling back to "business" would publish a
        # closed session's minutes to every member once approved (W51-4).
        type_map = {
            "business": MinutesMeetingType.BUSINESS,
            "special": MinutesMeetingType.SPECIAL,
            "committee": MinutesMeetingType.COMMITTEE,
            "board": MinutesMeetingType.BOARD,
            "trustee": MinutesMeetingType.TRUSTEE,
            "executive": MinutesMeetingType.EXECUTIVE,
            "annual": MinutesMeetingType.ANNUAL,
            "other": MinutesMeetingType.OTHER,
        }
        meeting_type_val = (
            meeting.meeting_type.value
            if hasattr(meeting.meeting_type, "value")
            else str(meeting.meeting_type)
        )
        minutes_type = type_map.get(meeting_type_val, MinutesMeetingType.BUSINESS)

        # Build attendees JSON from meeting attendees
        attendees_json = []
        if meeting.attendees:
            for att in meeting.attendees:
                # MM-16: org-filter this name lookup even though att.user_id
                # is always in-org today (every write path onto
                # MeetingAttendee.user_id validates membership first) — same
                # "cheap insurance against a future unvalidated write path"
                # rationale as MM-14's grantor/waiver-member lookups.
                user_result = await self.db.execute(
                    select(User).where(
                        User.id == att.user_id,
                        User.organization_id == str(organization_id),
                    )
                )
                user = user_result.scalar_one_or_none()
                attendees_json.append(
                    normalize_attendee(
                        {
                            "user_id": att.user_id,
                            # The name the member goes by, as colleagues know
                            # them. Snapshotted, so minutes already drafted
                            # keep the name they were drafted with.
                            "name": (
                                (user.display_name or user.username)
                                if user
                                else "Unknown"
                            ),
                            "present": att.present,
                            "excused": att.excused,
                        }
                    )
                )

        # The outline: the one asked for, else the department's default for
        # this kind of meeting, else the built-in order of business.
        outline = await TemplateService(self.db).resolve_outline(
            organization_id, minutes_type.value, template_id, created_by
        )
        section_defaults = (
            outline.sections
            if outline is not None and outline.sections
            else _default_sections_for(minutes_type)
        )

        # The meeting's date and start time are the department's wall clock,
        # not UTC. Combining them as UTC put a 7 PM meeting at 2 PM, and a
        # meeting with no start time at UTC midnight — the evening before, for
        # any department west of Greenwich (W51-1).
        if meeting.meeting_date:
            org_tz = await resolve_scheduling_timezone(self.db, organization_id)
            meeting_date_dt = datetime.combine(
                meeting.meeting_date,
                meeting.start_time or time.min,
                tzinfo=org_tz,
            ).astimezone(timezone.utc)
        else:
            meeting_date_dt = datetime.now(timezone.utc)

        minutes = MeetingMinutes(
            id=generate_uuid(),
            organization_id=str(organization_id),
            title=f"Minutes: {meeting.title}",
            meeting_type=minutes_type,
            meeting_date=meeting_date_dt,
            location=meeting.location,
            called_by=meeting.called_by,
            attendees=attendees_json,
            sections=self._sections_from_outline(section_defaults),
            template_id=outline.id if outline is not None else None,
            header_config=(
                copy.deepcopy(outline.header_config) if outline is not None else None
            ),
            footer_config=(
                copy.deepcopy(outline.footer_config) if outline is not None else None
            ),
            agenda=meeting.agenda if hasattr(meeting, "agenda") else None,
            meeting_id=str(meeting_id),
            event_id=meeting.event_id,
            status=MinutesStatus.DRAFT,
            created_by=str(created_by),
        )

        self.db.add(minutes)
        await self.db.commit()
        await self.db.refresh(minutes)
        return minutes
