"""
Minutes record-keeping service

What turns a page of notes into a record: the roll call, the election results
the meeting heard, the files filed with it, the action items that carry from
one meeting to the next, and the approved versions that can be told apart and
verified later.

Everything here is org-scoped (CLAUDE.md pitfall #14) and honours the same
lock as the rest of the module (MM-17): once minutes are submitted or
approved, nothing that is part of the ratified record changes. The one
deliberate exception is a ``signed_copy`` attachment, which is the signed
paper evidence of the approval and can only exist after it.
"""

import asyncio
import copy
import os
from datetime import date, datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import HTTPException, Response, UploadFile, status
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, ElectionStatus
from app.models.event import Event, EventExternalAttendee, EventRSVP
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesAttachment,
    MinutesAttachmentCategory,
    MinutesClosedSession,
    MinutesElectionResult,
    MinutesMeetingType,
    MinutesRevision,
    MinutesStatus,
    MinutesSuggestion,
    MinutesSuggestionStatus,
    Motion,
)
from app.models.user import User
from app.schemas.minute import (
    ClosedSessionCreate,
    ClosedSessionUpdate,
    SuggestionApply,
    SuggestionCreate,
    SuggestionResolve,
)
from app.services import file_storage_service as file_storage
from app.services.file_storage_service import (
    FileRules,
    FileStorageService,
    StorageArea,
    stored_file_response,
)
from app.services.minute_service import MinuteService
from app.utils import download_names
from app.utils.minutes_attendance import normalize_attendee
from app.utils.minutes_snapshot import (
    build_snapshot,
    content_hash,
)
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_all_in_org, assert_in_org
from app.utils.redline import apply_changes, canonical, compute_changes, plain_to_html
from app.utils.rich_text import FORMAT_HTML, normalize_format

EDITABLE_STATUSES = (MinutesStatus.DRAFT.value, MinutesStatus.REJECTED.value)


class SuggestionApplyConflict(ValueError):
    """Some accepted changes no longer fit the section they were made against.

    Carries the ids that could not be placed. The section is left as it was, so
    the secretary can reject those changes or make them by hand.
    """

    def __init__(self, failed: List[str]):
        super().__init__(
            "Some of these changes no longer fit the section, which has been "
            "edited since: " + ", ".join(failed)
        )
        self.failed = failed


def _section_html(section: dict) -> str:
    """A section's text as the rich-text subset, whichever format it is stored in."""
    content = section.get("content") or ""
    if normalize_format(section.get("format")) == FORMAT_HTML:
        return canonical(content)
    return canonical(plain_to_html(content))


OPEN_ITEM_STATUSES = (
    MinutesActionItemStatus.PENDING.value,
    MinutesActionItemStatus.IN_PROGRESS.value,
    MinutesActionItemStatus.OVERDUE.value,
)

# Reports, handouts and the signed copy: the documents a meeting is run from.
# Narrower than the shared Documents rules on purpose — no archives, no
# presentations — because these are read as part of the record.
ATTACHMENT_FILE_RULES = FileRules(
    allowed_types={
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
            ".docx"
        ),
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "text/plain": ".txt",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    },
    max_bytes=25 * 1024 * 1024,
    description="PDF, Word, Excel, text, or JPEG, PNG, GIF or WebP images",
)

# Most items a single carry-forward request lists for review.
CARRY_FORWARD_LIST_LIMIT = 200


def _aware(value: datetime) -> datetime:
    """A stored datetime read back naive is UTC; compare like with like."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _status_value(minutes: MeetingMinutes) -> str:
    value = minutes.status
    return value if isinstance(value, str) else value.value


def _type_value(minutes: MeetingMinutes) -> str:
    value = minutes.meeting_type
    return value if isinstance(value, str) else value.value


class MinutesRecordService:
    """Roll call, election results, attachments, carry-forward and revisions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Shared lookups
    # ============================================

    async def lock_minutes(
        self, minutes_id: str, organization_id: UUID | str
    ) -> Optional[MeetingMinutes]:
        """The minutes row, locked for this transaction.

        A submit, an approval or an upload racing each other would otherwise
        each read a status the other is about to change. ``populate_existing``
        because the row may already sit in this session's identity map from an
        earlier plain read, and a locked re-read must see what a concurrent
        transaction committed, not that cached copy.
        """
        result = await self.db.execute(
            select(MeetingMinutes)
            .where(MeetingMinutes.id == str(minutes_id))
            .where(MeetingMinutes.organization_id == str(organization_id))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _require_editable(minutes: MeetingMinutes, what: str) -> None:
        if _status_value(minutes) not in EDITABLE_STATUSES:
            raise ValueError(
                f"{what} can only be changed while the minutes are in draft or "
                "rejected status. Approved minutes are locked; reopen them to "
                "make a correction."
            )

    async def member_names(
        self, user_ids: Iterable[Optional[str]], organization_id: UUID | str
    ) -> Dict[str, str]:
        """Display names for *user_ids*, from this organization only.

        A user who has since left or been removed is simply absent from the
        result, so a caller shows the name it has or none rather than failing.
        """
        wanted = {str(i) for i in user_ids if i}
        if not wanted:
            return {}
        rows = await self.db.execute(
            select(User).where(
                User.id.in_(wanted), User.organization_id == str(organization_id)
            )
        )
        return {u.id: (u.display_name or u.username) for u in rows.scalars().all()}

    # ============================================
    # Attendance
    # ============================================

    async def suggest_attendance(
        self, minutes_id: str, organization_id: UUID | str
    ) -> Optional[dict]:
        """A starting roll for these minutes, or None if they do not exist.

        The roll is the department's active members. When the minutes are
        linked to an event, a member who checked in is marked present and any
        checked-in outside guest is listed as a guest; with no event everyone
        starts as absent for the secretary to mark. Whatever the minutes
        already record for a member wins over the suggestion, so asking again
        never overwrites the secretary's corrections. Nothing is saved.
        """
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, load_children=False
        )
        if minutes is None:
            return None

        checked_in: set[str] = set()
        guests: List[str] = []
        event_title: Optional[str] = None
        if minutes.event_id:
            event = (
                await self.db.execute(
                    select(Event).where(
                        Event.id == minutes.event_id,
                        Event.organization_id == str(organization_id),
                    )
                )
            ).scalar_one_or_none()
            if event is not None:
                event_title = event.title
                rsvps = await self.db.execute(
                    select(EventRSVP.user_id).where(
                        EventRSVP.event_id == event.id,
                        EventRSVP.organization_id == str(organization_id),
                        EventRSVP.checked_in.is_(True),
                    )
                )
                checked_in = {str(row[0]) for row in rsvps.all()}
                external = await self.db.execute(
                    select(EventExternalAttendee.name).where(
                        EventExternalAttendee.event_id == event.id,
                        EventExternalAttendee.organization_id == str(organization_id),
                        EventExternalAttendee.checked_in.is_(True),
                    )
                )
                guests = [str(row[0]) for row in external.all()]

        members = (
            (
                await self.db.execute(
                    select(User).where(
                        User.organization_id == str(organization_id), User.is_active
                    )
                )
            )
            .scalars()
            .all()
        )

        recorded = [e for e in (minutes.attendees or []) if isinstance(e, dict)]
        by_user = {str(e["user_id"]): e for e in recorded if e.get("user_id")}
        entries: List[dict] = []
        for member in sorted(
            members, key=lambda u: (u.display_name or u.username or "").lower()
        ):
            existing = by_user.get(str(member.id))
            if existing is not None:
                entries.append(normalize_attendee(existing))
                continue
            entries.append(
                normalize_attendee(
                    {
                        "user_id": str(member.id),
                        "name": member.display_name or member.username,
                        "status": (
                            "present" if str(member.id) in checked_in else "absent"
                        ),
                    }
                )
            )

        # Entries naming no member (a guest typed in earlier) and members who
        # have since left the department stay on the roll as recorded.
        roster_ids = {str(m.id) for m in members}
        for entry in recorded:
            uid = entry.get("user_id")
            if not uid or str(uid) not in roster_ids:
                entries.append(normalize_attendee(entry))

        known_guests = {
            str(e.get("name", "")).strip().lower() for e in entries if not e["user_id"]
        }
        for name in guests:
            if name.strip().lower() not in known_guests:
                entries.append(normalize_attendee({"name": name, "status": "guest"}))
                known_guests.add(name.strip().lower())

        return {
            "source": "event" if event_title is not None else "roster",
            "event_title": event_title,
            "entries": entries,
        }

    # ============================================
    # Election results
    # ============================================

    async def list_importable_elections(
        self, minutes_id: str, organization_id: UUID | str
    ) -> Optional[List[dict]]:
        """Closed elections that can be filed with these minutes.

        Most recently closed first. Draft, open and cancelled elections have
        no result to file. Each row says whether it is already filed here.
        """
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, load_children=False
        )
        if minutes is None:
            return None
        filed = {
            r.election_id
            for r in await self._election_rows(minutes.id)
            if r.election_id
        }
        rows = await self.db.execute(
            select(Election)
            .where(
                Election.organization_id == str(organization_id),
                Election.status == ElectionStatus.CLOSED.value,
            )
            .order_by(Election.closed_at.desc(), Election.id.desc())
            .limit(50)
        )

        def linked(election: Election) -> bool:
            """Held at this meeting: its event, or its meeting record."""
            return bool(
                (minutes.event_id and election.event_id == minutes.event_id)
                or (minutes.meeting_id and election.meeting_id == minutes.meeting_id)
            )

        offered = [
            {
                "id": e.id,
                "title": e.title,
                "election_type": e.election_type,
                "closed_at": e.closed_at,
                "positions": e.positions,
                "already_imported": e.id in filed,
                "linked_to_meeting": linked(e),
                "ballot_items": [
                    {
                        "id": str(item["id"]),
                        "title": str(item.get("title") or item["id"]),
                    }
                    for item in (e.ballot_items or [])
                    if isinstance(item, dict) and item.get("id")
                ],
            }
            for e in rows.scalars().all()
        ]
        # The ones held at this meeting first, newest first within each group.
        return sorted(offered, key=lambda e: not e["linked_to_meeting"])

    async def _election_rows(self, minutes_id: str) -> List[MinutesElectionResult]:
        result = await self.db.execute(
            select(MinutesElectionResult)
            .where(MinutesElectionResult.minutes_id == str(minutes_id))
            .order_by(MinutesElectionResult.created_at, MinutesElectionResult.id)
        )
        return list(result.scalars().all())

    async def list_election_results(
        self, minutes_id: str, organization_id: UUID | str, restricted: bool = False
    ) -> Optional[List[MinutesElectionResult]]:
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        return await self._election_rows(minutes.id)

    async def capture_election_result(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        election_id: str,
        captured_by: UUID | str | None,
    ) -> Optional[MinutesElectionResult]:
        """Freeze a closed election's result into the minutes."""
        from app.services.election_service import ElectionService

        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None
        # An election can close after the meeting's minutes were written, or
        # after they were adopted; the result still belongs to that meeting. On
        # a draft it is part of the minutes. Once the minutes have been
        # circulated or adopted it is an addendum: filed, dated, permanent, and
        # not part of what was adopted.
        is_addendum = _status_value(minutes) not in EDITABLE_STATUSES

        # XC-1: the id is the client's. A foreign or unknown election and a
        # still-open one read the same way so this is no existence oracle.
        await assert_in_org(
            self.db, Election, election_id, organization_id, label="election"
        )
        election = (
            await self.db.execute(
                select(Election).where(
                    Election.id == str(election_id),
                    Election.organization_id == str(organization_id),
                )
            )
        ).scalar_one()
        if election.status != ElectionStatus.CLOSED:
            raise ValueError(
                "Only a closed election has a result to file with the minutes"
            )

        existing = await self.db.execute(
            select(MinutesElectionResult.id).where(
                MinutesElectionResult.minutes_id == minutes.id,
                MinutesElectionResult.election_id == election.id,
            )
        )
        if existing.first() is not None:
            raise ValueError(
                "This election's result is already filed with these minutes."
                + (
                    ""
                    if is_addendum
                    else " Remove it first to file the current result instead."
                )
            )

        results = await ElectionService(self.db).get_election_results(
            election.id, organization_id
        )
        if results is None:
            raise ValueError("The election's result is not available yet")

        row = MinutesElectionResult(
            minutes_id=minutes.id,
            organization_id=str(organization_id),
            election_id=election.id,
            election_title=election.title,
            election_closed_at=election.closed_at,
            snapshot=results.model_dump(mode="json"),
            is_addendum=is_addendum,
            captured_by=str(captured_by) if captured_by else None,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return row

    async def remove_election_result(
        self, minutes_id: str, result_id: str, organization_id: UUID | str
    ) -> bool:
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return False
        row = (
            await self.db.execute(
                select(MinutesElectionResult).where(
                    MinutesElectionResult.id == str(result_id),
                    MinutesElectionResult.minutes_id == minutes.id,
                    MinutesElectionResult.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        if row.is_addendum:
            raise ValueError(
                "A result filed after the minutes were circulated is a permanent "
                "addendum and cannot be removed"
            )
        self._require_editable(minutes, "Election results")
        await self.db.delete(row)
        await self.db.commit()
        return True

    # ============================================
    # Attachments
    # ============================================

    async def _attachment_rows(self, minutes_id: str) -> List[MinutesAttachment]:
        result = await self.db.execute(
            select(MinutesAttachment)
            .where(MinutesAttachment.minutes_id == str(minutes_id))
            .order_by(MinutesAttachment.uploaded_at, MinutesAttachment.id)
        )
        return list(result.scalars().all())

    async def list_attachments(
        self, minutes_id: str, organization_id: UUID | str, restricted: bool = False
    ) -> Optional[List[MinutesAttachment]]:
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        return await self._attachment_rows(minutes.id)

    async def store_minutes_attachment(
        self,
        minutes_id: str,
        user: User,
        upload: UploadFile,
        title: str,
        category: str,
        description: Optional[str],
    ) -> Optional[MinutesAttachment]:
        """Scan, store and record a file filed with the minutes."""
        organization_id = str(user.organization_id)
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None

        current = _status_value(minutes)
        if current not in EDITABLE_STATUSES:
            if not (
                current == MinutesStatus.APPROVED.value
                and category == MinutesAttachmentCategory.SIGNED_COPY.value
            ):
                raise ValueError(
                    "Files can only be attached while the minutes are in draft "
                    "or rejected status. Once approved, only the signed copy "
                    "can be added."
                )
        elif category == MinutesAttachmentCategory.SIGNED_COPY.value:
            raise ValueError(
                "A signed copy is filed after the minutes are approved, " "not before"
            )

        stored = await FileStorageService(self.db).store_upload(
            upload,
            organization_id=organization_id,
            area=StorageArea.MINUTES_ATTACHMENTS,
            rules=ATTACHMENT_FILE_RULES,
            user=user,
            record_id=minutes.id,
            upload_kind="minutes_attachment",
        )
        attachment = MinutesAttachment(
            minutes_id=minutes.id,
            organization_id=organization_id,
            title=title,
            category=category,
            description=description,
            original_name=stored.original_name[:255],
            file_path=stored.path,
            mime_type=stored.mime_type,
            file_size=stored.size,
            sha256=stored.sha256,
            uploaded_by=str(user.id),
        )
        self.db.add(attachment)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            await asyncio.to_thread(file_storage.remove_quietly, stored.path)
            raise
        await self.db.refresh(attachment)
        return attachment

    async def get_attachment(
        self, minutes_id: str, attachment_id: str, organization_id: UUID | str
    ) -> Optional[MinutesAttachment]:
        result = await self.db.execute(
            select(MinutesAttachment).where(
                MinutesAttachment.id == str(attachment_id),
                MinutesAttachment.minutes_id == str(minutes_id),
                MinutesAttachment.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def serve_attachment(
        self,
        minutes: MeetingMinutes,
        attachment: MinutesAttachment,
        organization_id: UUID | str,
        local_day: Optional[date] = None,
    ) -> Response:
        """The stored bytes, or 404 for a file that is missing or outside the
        organization's storage. The caller has already authorized the minutes."""
        path = file_storage.resolve(
            attachment.file_path, str(organization_id), StorageArea.MINUTES_ATTACHMENTS
        )
        if path is None:
            logger.warning(
                f"Refused to serve minutes attachment {attachment.id}: its "
                "stored path is outside the organization's storage"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
            )
        if not await asyncio.to_thread(os.path.isfile, path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
            )
        return stored_file_response(
            path=path,
            filename=download_names.descriptive_filename(
                local_day,
                minutes.title,
                attachment.title,
                extension=download_names.stored_extension(path),
                fallback="minutes-attachment",
            ),
            media_type=attachment.mime_type or "application/octet-stream",
        )

    async def delete_attachment(
        self, minutes_id: str, attachment_id: str, organization_id: UUID | str
    ) -> bool:
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return False
        self._require_editable(minutes, "Attachments")
        attachment = await self.get_attachment(
            minutes.id, attachment_id, organization_id
        )
        if attachment is None:
            return False
        path = file_storage.resolve(
            attachment.file_path, str(organization_id), StorageArea.MINUTES_ATTACHMENTS
        )
        await self.db.delete(attachment)
        await self.db.commit()
        if path:
            await asyncio.to_thread(file_storage.remove_quietly, path)
        return True

    # ============================================
    # Revisions
    # ============================================

    async def record_approval(
        self, minutes: MeetingMinutes, approved_by: UUID | str, approved_at: datetime
    ) -> MinutesRevision:
        """Write the immutable revision for an approval.

        Called by ``approve_minutes`` inside its transaction, with the minutes
        row already locked, so the next version number cannot be taken twice.
        The unique (minutes_id, version) key is the backstop.
        """
        snapshot = build_snapshot(
            minutes,
            await self._election_rows(minutes.id),
            await self._attachment_rows(minutes.id),
            await self._closed_session_rows(minutes.id),
        )
        latest = (
            await self.db.execute(
                select(func.max(MinutesRevision.version)).where(
                    MinutesRevision.minutes_id == minutes.id
                )
            )
        ).scalar()
        revision = MinutesRevision(
            minutes_id=minutes.id,
            organization_id=minutes.organization_id,
            version=(latest or 0) + 1,
            snapshot=snapshot,
            content_hash=content_hash(snapshot),
            submitted_by=minutes.submitted_by,
            approved_by=str(approved_by),
            approved_at=approved_at,
        )
        self.db.add(revision)
        await self.db.flush()
        return revision

    async def supersede_on_reopen(
        self,
        minutes: MeetingMinutes,
        superseded_by: Optional[UUID | str],
        reason: Optional[str],
        superseded_at: datetime,
    ) -> None:
        """Mark the revision a reopen replaces. Nothing is deleted."""
        revision = (
            await self.db.execute(
                select(MinutesRevision)
                .where(
                    MinutesRevision.minutes_id == minutes.id,
                    MinutesRevision.superseded_at.is_(None),
                )
                .order_by(MinutesRevision.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if revision is None:
            return
        revision.superseded_at = superseded_at
        revision.superseded_by = str(superseded_by) if superseded_by else None
        revision.superseded_reason = reason

    async def list_revisions(
        self, minutes_id: str, organization_id: UUID | str, restricted: bool = False
    ) -> Optional[List[MinutesRevision]]:
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        result = await self.db.execute(
            select(MinutesRevision)
            .where(
                MinutesRevision.minutes_id == minutes.id,
                MinutesRevision.organization_id == str(organization_id),
            )
            .order_by(MinutesRevision.version.desc())
        )
        return list(result.scalars().all())

    async def get_revision(
        self,
        minutes_id: str,
        revision_id: str,
        organization_id: UUID | str,
        restricted: bool = False,
    ) -> Optional[MinutesRevision]:
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        result = await self.db.execute(
            select(MinutesRevision).where(
                MinutesRevision.id == str(revision_id),
                MinutesRevision.minutes_id == minutes.id,
                MinutesRevision.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def verify(
        self, minutes_id: str, organization_id: UUID | str, restricted: bool = False
    ) -> Optional[dict]:
        """Whether the minutes still match their current approved revision.

        The live content is rebuilt with the same function that built the
        revision and compared by hash; when it differs the sections that
        differ are named, so "changed" comes with where to look.
        """
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted
        )
        if minutes is None:
            return None

        if _status_value(minutes) != MinutesStatus.APPROVED.value:
            return {
                "verified": False,
                "detail": "These minutes are not approved, so there is no "
                "approved version to verify against.",
            }
        revision = (
            await self.db.execute(
                select(MinutesRevision)
                .where(
                    MinutesRevision.minutes_id == minutes.id,
                    MinutesRevision.superseded_at.is_(None),
                )
                .order_by(MinutesRevision.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if revision is None:
            return {
                "verified": False,
                "detail": "These minutes were approved before approved versions "
                "were recorded. Reopen and re-approve them to establish a "
                "verifiable version.",
            }

        live = build_snapshot(
            minutes,
            await self._election_rows(minutes.id),
            await self._attachment_rows(minutes.id),
            await self._closed_session_rows(minutes.id),
        )
        current = content_hash(live)
        matches = current == revision.content_hash
        changed = (
            []
            if matches
            else sorted(
                key
                for key in set(live) | set(revision.snapshot or {})
                if live.get(key) != (revision.snapshot or {}).get(key)
            )
        )
        return {
            "verified": matches,
            "version": revision.version,
            "content_hash": revision.content_hash,
            "current_hash": current,
            "changed": changed,
            "detail": (
                f"Matches version {revision.version} as approved."
                if matches
                else f"Differs from version {revision.version} as approved."
            ),
        }

    # ============================================
    # Closed sessions
    # ============================================

    async def _closed_session_rows(self, minutes_id: str) -> List[MinutesClosedSession]:
        result = await self.db.execute(
            select(MinutesClosedSession)
            .where(MinutesClosedSession.minutes_id == str(minutes_id))
            .order_by(MinutesClosedSession.started_at, MinutesClosedSession.id)
        )
        return list(result.scalars().all())

    async def list_closed_sessions(
        self, minutes_id: str, organization_id: UUID | str, restricted: bool = False
    ) -> Optional[List[MinutesClosedSession]]:
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        return await self._closed_session_rows(minutes.id)

    async def _check_closed_session_links(
        self,
        minutes: MeetingMinutes,
        motion_id: Optional[str],
        participants: Optional[Sequence[dict]],
        organization_id: UUID | str,
    ) -> None:
        """The motion must be one of these minutes' own, and every named
        participant a member of this department (XC-1)."""
        if motion_id:
            found = await self.db.execute(
                select(Motion.id).where(
                    Motion.id == str(motion_id), Motion.minutes_id == minutes.id
                )
            )
            if found.first() is None:
                raise ValueError("That motion is not one of these minutes' motions")
        await assert_all_in_org(
            self.db,
            User,
            [p["user_id"] for p in (participants or []) if p.get("user_id")],
            organization_id,
            label="participant",
        )

    async def add_closed_session(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        data: ClosedSessionCreate,
        created_by: UUID | str,
    ) -> Optional[MinutesClosedSession]:
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None
        self._require_editable(minutes, "A closed session")
        participants = [p.model_dump(mode="json") for p in data.participants or []]
        await self._check_closed_session_links(
            minutes, data.motion_id, participants, organization_id
        )
        session = MinutesClosedSession(
            minutes_id=minutes.id,
            organization_id=str(organization_id),
            motion_id=data.motion_id,
            reason=data.reason.strip(),
            legal_basis=(data.legal_basis or "").strip() or None,
            started_at=data.started_at,
            ended_at=data.ended_at,
            participants=participants,
            summary=(data.summary or "").strip() or None,
            created_by=str(created_by),
        )
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def update_closed_session(
        self,
        minutes_id: str,
        session_id: str,
        organization_id: UUID | str,
        data: ClosedSessionUpdate,
    ) -> Optional[MinutesClosedSession]:
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None
        self._require_editable(minutes, "A closed session")
        session = (
            await self.db.execute(
                select(MinutesClosedSession).where(
                    MinutesClosedSession.id == str(session_id),
                    MinutesClosedSession.minutes_id == minutes.id,
                    MinutesClosedSession.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if session is None:
            return None

        changes = data.model_dump(exclude_unset=True, mode="json")
        await self._check_closed_session_links(
            minutes,
            changes.get("motion_id"),
            changes.get("participants"),
            organization_id,
        )
        # The span is validated whole: a start moved past the stored end, or an
        # end moved before the stored start, is as wrong as a bad pair in one
        # request.
        start = data.started_at or session.started_at
        end = data.ended_at if "ended_at" in changes else session.ended_at
        if start and end and _aware(end) < _aware(start):
            raise ValueError("A closed session cannot end before it starts")
        # model_dump(mode="json") renders datetimes as text; the columns want
        # the datetimes themselves.
        for key in ("started_at", "ended_at"):
            if key in changes:
                changes[key] = getattr(data, key)
        apply_updates(
            session, changes, skip={"id", "minutes_id", "organization_id", "created_by"}
        )
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def delete_closed_session(
        self, minutes_id: str, session_id: str, organization_id: UUID | str
    ) -> bool:
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return False
        self._require_editable(minutes, "A closed session")
        session = (
            await self.db.execute(
                select(MinutesClosedSession).where(
                    MinutesClosedSession.id == str(session_id),
                    MinutesClosedSession.minutes_id == minutes.id,
                    MinutesClosedSession.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if session is None:
            return False
        await self.db.delete(session)
        await self.db.commit()
        return True

    # ============================================
    # Member suggestions
    # ============================================

    async def has_accepted_suggestions(self, minutes_id: str) -> bool:
        """Whether any suggestion on these minutes was accepted, which is what
        makes an adoption "as amended" unless the adopter says otherwise."""
        count = await self.db.execute(
            select(func.count(MinutesSuggestion.id)).where(
                MinutesSuggestion.minutes_id == str(minutes_id),
                MinutesSuggestion.status == MinutesSuggestionStatus.ACCEPTED.value,
            )
        )
        return (count.scalar() or 0) > 0

    async def list_suggestions(
        self,
        minutes_id: str,
        user: User,
        organization_id: UUID | str,
        can_manage: bool,
    ) -> Optional[List[MinutesSuggestion]]:
        """Every suggestion for a manager; a member sees only their own."""
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id,
            organization_id,
            restricted=not can_manage,
            load_children=False,
        )
        if minutes is None:
            return None
        query = select(MinutesSuggestion).where(
            MinutesSuggestion.minutes_id == minutes.id,
            MinutesSuggestion.organization_id == str(organization_id),
        )
        if not can_manage:
            query = query.where(MinutesSuggestion.created_by == str(user.id))
        result = await self.db.execute(
            query.order_by(MinutesSuggestion.created_at, MinutesSuggestion.id)
        )
        rows = list(result.scalars().all())
        current = {s.get("key"): _section_html(s) for s in minutes.get_sections()}
        for row in rows:
            # Read by the response: has the section been edited since the
            # reviewer saw it? A suggestion that is already answered has no
            # use for the question.
            row.section_changed = bool(
                row.changes
                and row.status == MinutesSuggestionStatus.OPEN.value
                and current.get(row.section_key) != row.base_content
            )
        return rows

    async def add_suggestion(
        self,
        minutes_id: str,
        user: User,
        data: SuggestionCreate,
        can_manage: bool,
    ) -> Optional[MinutesSuggestion]:
        """A member proposes a change while the minutes are circulated."""
        organization_id = str(user.organization_id)
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=not can_manage, load_children=False
        )
        if minutes is None:
            return None
        if _status_value(minutes) != MinutesStatus.SUBMITTED.value:
            raise ValueError(
                "Changes can be suggested only while the minutes are circulated "
                "for review"
            )
        sections = {s.get("key"): s for s in minutes.get_sections()}
        if data.section_key and data.section_key not in sections:
            raise ValueError("That section is not in these minutes")

        base_content = proposed_content = None
        changes = None
        if data.proposed_html:
            base_content = _section_html(sections[str(data.section_key)])
            proposed_content = canonical(data.proposed_html)
            changes = compute_changes(base_content, proposed_content)
            if not changes:
                raise ValueError(
                    "Your copy is the same as the section; nothing changed"
                )
        suggestion = MinutesSuggestion(
            minutes_id=minutes.id,
            organization_id=organization_id,
            section_key=data.section_key or None,
            comment=data.comment,
            proposed_text=(data.proposed_text or "").strip() or None,
            base_content=base_content,
            proposed_content=proposed_content,
            changes=changes,
            created_by=str(user.id),
        )
        self.db.add(suggestion)
        await self.db.commit()
        await self.db.refresh(suggestion)
        return suggestion

    async def resolve_suggestion(
        self,
        minutes_id: str,
        suggestion_id: str,
        organization_id: UUID | str,
        resolved_by: UUID | str,
        data: SuggestionResolve,
    ) -> Optional[MinutesSuggestion]:
        """Accept or decline a suggestion. Accepting does not edit the minutes:
        it records that the secretary will, and counts toward "as amended"."""
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None
        if _status_value(minutes) == MinutesStatus.APPROVED.value:
            raise ValueError("Adopted minutes can no longer take suggestions")
        suggestion = (
            await self.db.execute(
                select(MinutesSuggestion)
                .where(
                    MinutesSuggestion.id == str(suggestion_id),
                    MinutesSuggestion.minutes_id == minutes.id,
                    MinutesSuggestion.organization_id == str(organization_id),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if suggestion is None:
            return None
        if suggestion.changes and data.status == MinutesSuggestionStatus.ACCEPTED.value:
            raise ValueError(
                "A suggestion with tracked changes is accepted by applying the "
                "changes you accept"
            )
        if suggestion.changes:
            suggestion.changes = [
                {**c, "decision": "rejected"} for c in suggestion.changes
            ]
        suggestion.status = data.status
        suggestion.resolution_note = (data.note or "").strip() or None
        suggestion.resolved_by = str(resolved_by)
        suggestion.resolved_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(suggestion)
        return suggestion

    async def apply_suggestion(
        self,
        minutes_id: str,
        suggestion_id: str,
        organization_id: UUID | str,
        applied_by: UUID | str,
        data: SuggestionApply,
    ) -> Optional[MinutesSuggestion]:
        """Write the accepted tracked changes into the section and settle it.

        Draft or rejected minutes only: circulated minutes are locked, so the
        secretary recalls them first. All or nothing — if any accepted change no
        longer fits the section (it was edited since), nothing is written and
        ``SuggestionApplyConflict`` names the ones that do not. The changes not
        accepted are rejected, and the suggestion is accepted if anything was
        applied and declined if nothing was.
        """
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None
        self._require_editable(minutes, "apply a suggestion's changes to")
        suggestion = (
            await self.db.execute(
                select(MinutesSuggestion)
                .where(
                    MinutesSuggestion.id == str(suggestion_id),
                    MinutesSuggestion.minutes_id == minutes.id,
                    MinutesSuggestion.organization_id == str(organization_id),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if suggestion is None:
            return None
        if not suggestion.changes:
            raise ValueError("This suggestion has no tracked changes to apply")
        if suggestion.status != MinutesSuggestionStatus.OPEN.value:
            raise ValueError("This suggestion has already been answered")

        known = {c["id"] for c in suggestion.changes}
        accepted = set(data.accepted)
        if not accepted <= known:
            raise ValueError("Those changes are not part of this suggestion")

        sections = copy.deepcopy(minutes.get_sections())
        target = next(
            (s for s in sections if s.get("key") == suggestion.section_key), None
        )
        if target is None:
            raise ValueError("The section this suggestion is about is gone")

        applied_text = None
        if accepted:
            applied_text, failed = apply_changes(
                suggestion.base_content or "",
                _section_html(target),
                suggestion.changes,
                accepted,
            )
            if failed:
                raise SuggestionApplyConflict(failed)
            target["content"] = canonical(applied_text)
            target["format"] = FORMAT_HTML
            minutes.sections = sections

        suggestion.changes = [
            {**c, "decision": "accepted" if c["id"] in accepted else "rejected"}
            for c in suggestion.changes
        ]
        now = datetime.now(timezone.utc)
        suggestion.status = (
            MinutesSuggestionStatus.ACCEPTED.value
            if accepted
            else MinutesSuggestionStatus.DECLINED.value
        )
        suggestion.resolution_note = (data.note or "").strip() or None
        suggestion.resolved_by = str(applied_by)
        suggestion.resolved_at = now
        suggestion.applied_at = now if accepted else None
        await self.db.commit()
        await self.db.refresh(suggestion)
        return suggestion

    # ============================================
    # Action items across meetings
    # ============================================

    def _carry_source_filter(self, target: MeetingMinutes, include_other_types: bool):
        """Which earlier minutes' open items may be carried into *target*.

        Approved minutes only: the items of a draft are not yet a commitment.
        The same meeting type by default, because a committee's follow-ups do
        not belong on the board's agenda unasked. Executive-session items are
        never carried into a meeting of another type — their text would
        surface in minutes a wider audience can read.
        """
        conditions = [
            MeetingMinutes.organization_id == target.organization_id,
            MeetingMinutes.id != target.id,
            MeetingMinutes.status == MinutesStatus.APPROVED.value,
            MeetingMinutes.meeting_date <= target.meeting_date,
            ActionItem.status.in_(OPEN_ITEM_STATUSES),
            ActionItem.carried_forward_at.is_(None),
        ]
        target_type = _type_value(target)
        if include_other_types and target_type != MinutesMeetingType.EXECUTIVE.value:
            conditions.append(
                MeetingMinutes.meeting_type != MinutesMeetingType.EXECUTIVE.value
            )
        else:
            conditions.append(MeetingMinutes.meeting_type == target_type)
        return conditions

    async def list_open_items_for_carry_forward(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        include_other_types: bool = False,
    ) -> Optional[List[Tuple[ActionItem, str, datetime]]]:
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, load_children=False
        )
        if minutes is None:
            return None
        rows = await self.db.execute(
            select(ActionItem, MeetingMinutes.title, MeetingMinutes.meeting_date)
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(*self._carry_source_filter(minutes, include_other_types))
            .order_by(MeetingMinutes.meeting_date.desc(), ActionItem.created_at)
            .limit(CARRY_FORWARD_LIST_LIMIT)
        )
        return [(item, title, date) for item, title, date in rows.all()]

    async def carry_forward(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        item_ids: Sequence[str],
        include_other_types: bool = False,
    ) -> Optional[List[ActionItem]]:
        """Copy open items from earlier approved minutes into *minutes_id*.

        All or nothing. The source rows are locked so two minutes carrying the
        same item at once cannot both succeed, which would leave the item open
        in two places.
        """
        minutes = await self.lock_minutes(minutes_id, organization_id)
        if minutes is None:
            return None
        self._require_editable(minutes, "Carrying action items forward")

        rows = await self.db.execute(
            select(ActionItem)
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(
                ActionItem.id.in_([str(i) for i in item_ids]),
                *self._carry_source_filter(minutes, include_other_types),
            )
            .with_for_update(of=ActionItem)
        )
        sources = list(rows.scalars().all())
        # One message for "does not exist", "other department", "already
        # carried" and "not open" — no existence oracle across tenants.
        if len(sources) != len(set(str(i) for i in item_ids)):
            raise ValueError(
                "One or more of those action items cannot be carried forward"
            )

        now = datetime.now(timezone.utc)
        created: List[ActionItem] = []
        for source in sources:
            carried_status = (
                MinutesActionItemStatus.IN_PROGRESS
                if source.status == MinutesActionItemStatus.IN_PROGRESS.value
                else MinutesActionItemStatus.PENDING
            )
            copy = ActionItem(
                minutes_id=minutes.id,
                description=source.description,
                assignee_id=source.assignee_id,
                assignee_name=source.assignee_name,
                due_date=source.due_date,
                priority=source.priority,
                status=carried_status,
                carried_from_id=source.id,
            )
            self.db.add(copy)
            source.carried_forward_at = now
            created.append(copy)
        await self.db.commit()
        for item in created:
            await self.db.refresh(item)
        return created

    async def list_my_action_items(
        self,
        user_id: UUID | str,
        organization_id: UUID | str,
        include_closed: bool = False,
    ) -> List[Tuple[ActionItem, str, datetime, str]]:
        """Action items assigned to *user_id* in approved minutes.

        Items of draft or submitted minutes are not shown: they are not yet a
        commitment and may still change. Items an officer carried forward are
        hidden with the open ones, since the copy in the newer minutes is the
        one to act on.
        """
        conditions = [
            MeetingMinutes.organization_id == str(organization_id),
            MeetingMinutes.status == MinutesStatus.APPROVED.value,
            ActionItem.assignee_id == str(user_id),
        ]
        if not include_closed:
            conditions += [
                ActionItem.status.in_(OPEN_ITEM_STATUSES),
                ActionItem.carried_forward_at.is_(None),
            ]
        rows = await self.db.execute(
            select(
                ActionItem,
                MeetingMinutes.title,
                MeetingMinutes.meeting_date,
                MeetingMinutes.status,
            )
            .join(MeetingMinutes, ActionItem.minutes_id == MeetingMinutes.id)
            .where(*conditions)
            .order_by(ActionItem.due_date.is_(None), ActionItem.due_date.asc())
            .limit(500)
        )
        return [
            (
                item,
                title,
                date,
                state if isinstance(state, str) else state.value,
            )
            for item, title, date, state in rows.all()
        ]
