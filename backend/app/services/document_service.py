"""
Document Service

Business logic for document management, folder organization,
and publishing meeting minutes as formatted documents.
"""

from datetime import datetime, timezone
from html import escape
from typing import List, Optional, Sequence
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import (
    SYSTEM_FOLDERS,
    Document,
    DocumentFolder,
    DocumentType,
    FolderVisibility,
    system_folder_fields,
)
from app.models.minute import (
    MeetingMinutes,
    MinutesClosedSession,
    MinutesElectionResult,
    MinutesMeetingType,
    MinutesRevision,
    MinutesStatus,
)
from app.models.user import Organization
from app.utils.minutes_attendance import derive_status, effective_listing, is_listed
from app.utils.minutes_settings import attendance_listing_in
from app.utils.motion_votes import acceptance_label, recorded_motions, vote_summary
from app.utils.org_timezone import stored_calendar_day
from app.utils.rich_text import (
    FORMAT_HTML,
    normalize_format,
    sanitize_html,
    section_is_printed,
)


class DocumentService:
    """Service for document and folder management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Folder Management
    # ============================================

    async def initialize_system_folders(
        self, organization_id: UUID | str, created_by: UUID | str
    ) -> List[DocumentFolder]:
        """Create any system folders for an organization that don't exist yet"""
        # Locked before the existence check so this can't race
        # DocumentsService.ensure_member_folder's own organization-row lock
        # (Codex review, PR #2411): both are get-or-create paths that can
        # independently insert the "members" system folder, and with no
        # uniqueness constraint behind (organization_id, slug), a concurrent
        # first documents.py visit and a concurrent minutes publish could
        # each observe zero system folders and both create a full set,
        # leaving a duplicate "members" root that doesn't contain the
        # member's already-created personal folder.
        org = await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if org is None:
            raise ValueError("Organization not found")

        # Codex review, PR #2411: locking the organization row above is not
        # sufficient on its own (Pitfall #27's second half). publish_minutes
        # already reads a folder via get_folder_by_slug before calling this
        # method, which under this app's default REPEATABLE READ establishes
        # the transaction's snapshot before the lock above is acquired. A
        # plain read here would still answer from that earlier snapshot and
        # could report zero system folders even though a concurrent
        # ensure_member_folder already created and committed one while this
        # transaction waited for the lock. Making this a locking read forces
        # a current read, not the transaction's original snapshot.
        #
        # Reading slugs rather than a bare count (Codex review, round 2):
        # ensure_member_folder's own get-or-create only ever inserts the
        # single "members" definition, never the full SYSTEM_FOLDERS set --
        # "some system folder exists" is not the same fact as "every system
        # folder exists". Short-circuiting on any nonzero count let a member
        # visiting their Documents folder before anyone had ever published
        # minutes silently starve every other system folder: the next
        # publish_minutes call found "members" already present, returned
        # without creating "meeting-minutes", and failed with a
        # RuntimeError. Reconciling against the missing slugs instead of an
        # all-or-nothing create fixes this for every caller, not only the
        # race that surfaced it.
        existing_result = await self.db.execute(
            select(DocumentFolder.slug)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.is_system.is_(True))
            .with_for_update()
        )
        existing_slugs = set(existing_result.scalars().all())
        missing_defs = [d for d in SYSTEM_FOLDERS if d["slug"] not in existing_slugs]

        if missing_defs:
            for folder_def in missing_defs:
                folder = DocumentFolder(
                    organization_id=str(organization_id),
                    created_by=str(created_by),
                    **system_folder_fields(str(folder_def["slug"])),
                )
                self.db.add(folder)
            await self.db.commit()

        return await self.list_folders(organization_id)

    async def list_folders(
        self, organization_id: UUID | str, parent_id: Optional[str] = None
    ) -> List[DocumentFolder]:
        """List folders for an organization"""
        query = select(DocumentFolder).where(
            DocumentFolder.organization_id == str(organization_id)
        )
        if parent_id:
            query = query.where(DocumentFolder.parent_id == parent_id)
        else:
            query = query.where(DocumentFolder.parent_id.is_(None))

        query = query.order_by(DocumentFolder.sort_order, DocumentFolder.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_folder_by_slug(
        self, slug: str, organization_id: UUID | str
    ) -> Optional[DocumentFolder]:
        """Get a folder by slug"""
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.slug == slug)
            .where(DocumentFolder.organization_id == str(organization_id))
        )
        document_folder: Optional[DocumentFolder] = result.scalar_one_or_none()
        return document_folder

    # ============================================
    # Document CRUD
    # ============================================

    async def get_document(
        self, document_id: str, organization_id: UUID | str
    ) -> Optional[Document]:
        """Get a document by ID"""
        result = await self.db.execute(
            select(Document)
            .where(Document.id == document_id)
            .where(Document.organization_id == str(organization_id))
        )
        document: Optional[Document] = result.scalar_one_or_none()
        return document

    # ============================================
    # Publish Meeting Minutes
    # ============================================

    async def publish_minutes(
        self,
        minutes: MeetingMinutes,
        organization_id: UUID | str,
        published_by: UUID | str,
        *,
        allow_executive: bool = False,
    ) -> Document:
        """
        Publish approved meeting minutes as a formatted HTML document
        in the 'Meeting Minutes' system folder.

        Executive-session minutes are filed only when the department allows it
        (``allow_executive``, from its publishing settings), and then into a
        leadership-only folder, never the one every member can read.
        """
        if minutes.status != MinutesStatus.APPROVED.value:
            raise ValueError("Only approved minutes can be published")

        # MM2-1: executive-session minutes are restricted to minutes.manage
        # holders everywhere else (get/list/search/stats + the dashboard feed all
        # 404 them for plain viewers, to protect discipline/termination/legal
        # content). Publishing copies the full body into the meeting-minutes
        # folder, which is readable by the far broader `documents.view` audience —
        # silently defeating that restriction. Refuse to publish executive
        # minutes so the boundary the rest of the module enforces isn't
        # bypassable via a one-click publish. (A deliberate "share executive
        # minutes to a restricted audience" flow would be a separate build.)
        meeting_type_value = (
            minutes.meeting_type
            if isinstance(minutes.meeting_type, str)
            else minutes.meeting_type.value
        )
        is_executive = meeting_type_value == MinutesMeetingType.EXECUTIVE.value
        if is_executive and not allow_executive:
            raise ValueError(
                "Executive-session minutes cannot be published as a shared "
                "document — they are restricted to minutes managers"
            )

        # Get or create the meeting-minutes folder
        folder = await self.get_folder_by_slug("meeting-minutes", organization_id)
        if not folder:
            folders = await self.initialize_system_folders(
                organization_id, published_by
            )
            folder = next((f for f in folders if f.slug == "meeting-minutes"), None)
            if not folder:
                raise RuntimeError("Failed to create meeting-minutes folder")
        if is_executive:
            folder = await self._executive_minutes_folder(
                folder, organization_id, published_by
            )

        # Look up organization timezone for local date formatting
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tz_name = org.timezone if org else None

        # Generate HTML
        filed_results = (
            (
                await self.db.execute(
                    select(MinutesElectionResult)
                    .where(
                        MinutesElectionResult.minutes_id == minutes.id,
                        MinutesElectionResult.organization_id == str(organization_id),
                    )
                    .order_by(
                        MinutesElectionResult.created_at, MinutesElectionResult.id
                    )
                )
            )
            .scalars()
            .all()
        )
        sessions = (
            (
                await self.db.execute(
                    select(MinutesClosedSession)
                    .where(
                        MinutesClosedSession.minutes_id == minutes.id,
                        MinutesClosedSession.organization_id == str(organization_id),
                    )
                    .order_by(MinutesClosedSession.started_at, MinutesClosedSession.id)
                )
            )
            .scalars()
            .all()
        )
        listing = effective_listing(
            minutes.attendance_listing,
            attendance_listing_in(org.settings if org else None),
        )
        html = self._generate_minutes_html(
            minutes, tz_name, filed_results, sessions, listing
        )
        version = await self._current_revision_version(minutes.id, organization_id)
        note = self._replacement_note(minutes, tz_name)
        if note:
            html = note + html

        # Check if already published (update instead of creating duplicate)
        if minutes.published_document_id:
            existing = await self.get_document(
                minutes.published_document_id, organization_id
            )
            if existing:
                # Republishing replaces the document in place, so links to it
                # stay valid, and ends any correction notice a reopen set.
                existing.content_html = html
                existing.name = minutes.title
                existing.under_correction_since = None
                existing.updated_at = datetime.now(timezone.utc)
                if is_executive:
                    # Closed-session copies stay in the restricted folder even if
                    # someone moved the document out of it.
                    existing.folder_id = folder.id
                minutes.published_revision_version = version
                minutes.published_at = datetime.now(timezone.utc)
                await self.db.commit()
                await self.db.refresh(existing)
                return existing

        # Create the document
        meeting_date = (
            minutes.meeting_date.strftime("%Y-%m-%d")
            if minutes.meeting_date
            else "unknown"
        )
        mt_value = (
            minutes.meeting_type
            if isinstance(minutes.meeting_type, str)
            else minutes.meeting_type.value
        )
        doc = Document(
            organization_id=str(organization_id),
            folder_id=folder.id,
            name=minutes.title,
            description=f"Meeting minutes from {meeting_date}",
            document_type=DocumentType.GENERATED,
            content_html=html,
            file_type="text/html",
            source_type="meeting_minutes",
            source_id=minutes.id,
            tags=",".join(["meeting-minutes", mt_value]),
            uploaded_by=str(published_by),
        )
        self.db.add(doc)
        await self.db.flush()

        # Update the minutes record with the published document reference
        minutes.published_document_id = doc.id
        minutes.published_revision_version = version
        minutes.published_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    async def _current_revision_version(
        self, minutes_id: str, organization_id: UUID | str
    ) -> Optional[int]:
        """The adopted version these minutes are on, or None if never adopted."""
        revision = (
            await self.db.execute(
                select(MinutesRevision.version)
                .where(
                    MinutesRevision.minutes_id == str(minutes_id),
                    MinutesRevision.organization_id == str(organization_id),
                    MinutesRevision.superseded_at.is_(None),
                )
                .order_by(MinutesRevision.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        return revision

    @staticmethod
    def _replacement_note(
        minutes: MeetingMinutes, tz_name: Optional[str]
    ) -> Optional[str]:
        """The line at the top of a republished copy naming what it replaced.

        Only when a version was recorded at the earlier publish: minutes filed
        before versions were tracked get no note rather than a wrong one.
        """
        previous = minutes.published_revision_version
        filed = minutes.published_at
        if previous is None or not minutes.published_document_id:
            return None
        when = ""
        if filed is not None:
            stamp = filed if filed.tzinfo else filed.replace(tzinfo=timezone.utc)
            try:
                stamp = stamp.astimezone(ZoneInfo(tz_name)) if tz_name else stamp
            except Exception:  # an unknown zone name falls back to UTC
                pass
            when = f", published {stamp.strftime('%B %d, %Y')}"
        return (
            '<div class="minutes-replacement-note" style="margin-bottom:16px; '
            "padding:8px 12px; border-left:4px solid #1e3a5f; background:#f3f6fa; "
            'font-size:13px; color:#333;">'
            f"This version replaces version {int(previous)}{escape(when)}."
            "</div>"
        )

    async def _executive_minutes_folder(
        self,
        parent: DocumentFolder,
        organization_id: UUID | str,
        created_by: UUID | str,
    ) -> DocumentFolder:
        """The leadership-only folder executive-session copies are filed in.

        Created on first use under Meeting Minutes. If a library manager has
        since opened it up, this refuses rather than file closed-session
        content where every member can read it.
        """
        # Locked before the existence check, as in initialize_system_folders,
        # so two first publishes cannot each create one.
        await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        slug = "meeting-minutes-executive"
        folder = await self.db.scalar(
            select(DocumentFolder)
            .where(
                DocumentFolder.organization_id == str(organization_id),
                DocumentFolder.slug == slug,
            )
            .with_for_update()
        )
        if folder is None:
            folder = DocumentFolder(
                organization_id=str(organization_id),
                created_by=str(created_by),
                parent_id=parent.id,
                slug=slug,
                name="Executive Session Minutes",
                description="Executive-session minutes; library managers only",
                visibility=FolderVisibility.LEADERSHIP,
                is_system=False,
                sort_order=1,
                icon="shield",
            )
            self.db.add(folder)
            await self.db.flush()
        elif folder.visibility != FolderVisibility.LEADERSHIP:
            raise ValueError(
                "The Executive Session Minutes folder is no longer restricted to "
                "library managers; restore that before publishing executive minutes"
            )
        return folder

    @staticmethod
    def _attendee_label(entry: dict, status: str) -> str:
        """One roll-call line as it reads in the published minutes."""
        label = escape(str(entry.get("name", "")))
        if entry.get("role"):
            label += f' ({escape(str(entry["role"]))})'
        detail = {"late": "arrived late", "left_early": "left early"}.get(status)
        note = entry.get("note")
        extras = [x for x in (detail, escape(str(note)) if note else None) if x]
        if extras:
            label += f' <span style="color:#666;">[{"; ".join(extras)}]</span>'
        return label

    def _closed_sessions_html(
        self, sessions: Sequence[MinutesClosedSession], tz_name: Optional[str]
    ) -> list:
        """Closed sessions as published HTML: reason, authority, times, who was
        in the room, and the public summary."""
        parts: list = []

        def clock(value) -> str:
            if value is None:
                return ""
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return self._to_local(value, tz_name).strftime("%I:%M %p")

        for number, closed in enumerate(sessions, 1):
            parts.append(
                '<div class="minutes-closed-session" style="margin-bottom:24px;">'
            )
            parts.append(
                '<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">'
                f"Closed session {number}</h4>"
            )
            span = clock(closed.started_at) + (
                f" to {clock(closed.ended_at)}" if closed.ended_at else ""
            )
            facts = [
                f"<strong>Reason:</strong> {escape(closed.reason)}",
                f"<strong>Time:</strong> {escape(span)}",
            ]
            if closed.legal_basis:
                facts.append(
                    f"<strong>Authority:</strong> {escape(closed.legal_basis)}"
                )
            parts.append(f'<p style="font-size:13px;">{"<br/>".join(facts)}</p>')
            people = closed.participants or []
            if people:
                names = ", ".join(
                    escape(str(p.get("name", "")))
                    + (
                        f' ({escape(clock(p.get("joined_at")))}'
                        f'{" – " + escape(clock(p.get("left_at"))) if p.get("left_at") else ""})'
                        if p.get("joined_at")
                        else ""
                    )
                    for p in people
                )
                parts.append(
                    f'<p style="font-size:13px;"><strong>In the room ({len(people)}):</strong> {names}</p>'
                )
            if closed.summary:
                parts.append(
                    f'<p style="font-size:13px; white-space:pre-wrap;">{escape(closed.summary)}</p>'
                )
            parts.append("</div>")
        return parts

    def _election_results_html(self, results: Sequence[MinutesElectionResult]) -> list:
        """The election results filed with the minutes, as published HTML."""
        parts: list = []
        for filed in results:
            snapshot = filed.snapshot or {}
            parts.append('<div class="minutes-election" style="margin-bottom:24px;">')
            parts.append(
                '<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">'
                f"Election result — {escape(filed.election_title)}</h4>"
            )
            if getattr(filed, "is_addendum", False):
                parts.append(
                    '<p style="font-size:12px; color:#666;"><em>Addendum: filed after '
                    "these minutes were circulated. It records the final result of an "
                    "election held at this meeting that closed later; it is not part "
                    "of the text that was adopted.</em></p>"
                )
            facts = [
                (
                    f"Eligible voters: {escape(str(snapshot['total_eligible_voters']))}"
                    if "total_eligible_voters" in snapshot
                    else ""
                ),
                (
                    f"Ballots cast: {escape(str(snapshot['total_votes']))}"
                    if "total_votes" in snapshot
                    else ""
                ),
                (
                    f"Turnout: {escape(str(snapshot['voter_turnout_percentage']))}%"
                    if "voter_turnout_percentage" in snapshot
                    else ""
                ),
            ]
            facts_text = " &middot; ".join(f for f in facts if f)
            if facts_text:
                parts.append(f'<p style="font-size:13px;">{facts_text}</p>')
            contests = list(snapshot.get("results_by_position") or [])
            if snapshot.get("overall_results"):
                contests.append(
                    {
                        "position": "Other candidates" if contests else "",
                        "candidates": snapshot["overall_results"],
                    }
                )
            for contest in contests:
                title = contest.get("label") or contest.get("position")
                if title:
                    parts.append(
                        f'<p style="margin:8px 0 2px; font-size:13px;"><strong>{escape(str(title))}</strong></p>'
                    )
                parts.append(
                    '<table style="width:100%; border-collapse:collapse; font-size:13px;">'
                    '<tr style="background:#f3f4f6;"><th style="padding:6px; text-align:left; border:1px solid #ddd;">Candidate</th>'
                    '<th style="padding:6px; text-align:right; border:1px solid #ddd;">Votes</th>'
                    '<th style="padding:6px; text-align:right; border:1px solid #ddd;">%</th>'
                    '<th style="padding:6px; text-align:left; border:1px solid #ddd;">Outcome</th></tr>'
                )
                for cand in contest.get("candidates") or []:
                    outcome = (
                        "Winner"
                        if cand.get("is_winner")
                        else "Tied" if cand.get("is_tied") else ""
                    )
                    parts.append(
                        f'<tr><td style="padding:6px; border:1px solid #ddd;">{escape(str(cand.get("candidate_name", "")))}</td>'
                        f'<td style="padding:6px; text-align:right; border:1px solid #ddd;">{escape(str(cand.get("vote_count", 0)))}</td>'
                        f'<td style="padding:6px; text-align:right; border:1px solid #ddd;">{escape(str(cand.get("percentage", 0)))}</td>'
                        f'<td style="padding:6px; border:1px solid #ddd;">{outcome}</td></tr>'
                    )
                parts.append("</table>")
            parts.append("</div>")
        return parts

    def _to_local(self, dt: datetime, tz_name: Optional[str]) -> datetime:
        """Convert a UTC datetime to the organization's local timezone."""
        if not tz_name or not dt:
            return dt
        return dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name))

    def _generate_minutes_html(
        self,
        minutes: MeetingMinutes,
        tz_name: Optional[str] = None,
        election_results: Sequence[MinutesElectionResult] = (),
        closed_sessions: Sequence[MinutesClosedSession] = (),
        attendance_listing: str = "all",
    ) -> str:
        """Generate formatted HTML for published meeting minutes.

        ``attendance_listing`` is the listing already in force for these
        minutes; the roll is recorded in full and only what it names is shown.
        """
        header = minutes.get_effective_header() or {}
        footer = minutes.get_effective_footer() or {}

        mt_display = (
            minutes.meeting_type
            if isinstance(minutes.meeting_type, str)
            else minutes.meeting_type.value
        )
        meeting_date = (
            self._to_local(minutes.meeting_date, tz_name).strftime(
                "%B %d, %Y at %I:%M %p"
            )
            if minutes.meeting_date
            else ""
        )

        parts = []

        # Document header
        parts.append('<div class="minutes-document">')
        parts.append(
            '<div class="minutes-header" style="text-align:center; border-bottom:2px solid #1e3a5f; padding-bottom:16px; margin-bottom:24px;">'
        )
        if header.get("org_name"):
            parts.append(
                f'<h1 style="margin:0; font-size:24px; color:#1e3a5f;">{escape(header["org_name"])}</h1>'
            )
        subtitle = header.get("subtitle", "Official Meeting Minutes")
        parts.append(
            f'<h2 style="margin:4px 0 0; font-size:16px; color:#666; font-weight:normal;">{escape(subtitle)}</h2>'
        )
        parts.append("</div>")

        # Meeting info
        parts.append('<div class="minutes-info" style="margin-bottom:24px;">')
        parts.append(
            f'<h3 style="margin:0 0 8px; font-size:20px; color:#1e3a5f;">{escape(minutes.title)}</h3>'
        )
        info_items = []
        if header.get("show_meeting_type", True):
            info_items.append(
                f'<strong>Type:</strong> {escape(mt_display.replace("_", " ").title())}'
            )
        if header.get("show_date", True):
            info_items.append(f"<strong>Date:</strong> {escape(meeting_date)}")
        if minutes.location:
            info_items.append(f"<strong>Location:</strong> {escape(minutes.location)}")
        if minutes.called_by:
            info_items.append(
                f"<strong>Called by:</strong> {escape(minutes.called_by)}"
            )
        if info_items:
            parts.append(
                '<p style="color:#444; font-size:14px; margin:4px 0;">'
                + " &nbsp;|&nbsp; ".join(info_items)
                + "</p>"
            )

        adopted_on = getattr(minutes, "adopted_on", None)
        if adopted_on:
            how = getattr(minutes, "adopted_as_amended", None)
            parts.append(
                '<p style="font-size:13px; color:#666;">Adopted '
                f"{escape(self._to_local(adopted_on, tz_name).strftime('%B %d, %Y'))}"
                + (" as amended" if how else " as presented" if how is False else "")
                + "</p>"
            )

        # Called to order / adjourned
        if minutes.called_to_order_at:
            parts.append(
                f'<p style="font-size:13px; color:#666;">Called to order: {self._to_local(minutes.called_to_order_at, tz_name).strftime("%I:%M %p")}</p>'
            )
        if minutes.adjourned_at:
            parts.append(
                f'<p style="font-size:13px; color:#666;">Adjourned: {self._to_local(minutes.adjourned_at, tz_name).strftime("%I:%M %p")}</p>'
            )
        parts.append("</div>")

        # Attendees
        if minutes.attendees:
            parts.append('<div class="minutes-attendees" style="margin-bottom:24px;">')
            parts.append(
                '<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">Attendance</h4>'
            )
            # Grouped by the roll-call status, not by the derived ``present``
            # flag: that flag means "counted toward quorum", which would file
            # an excused member and a guest under Absent.
            by_status: dict = {}
            for entry in minutes.attendees:
                if is_listed(derive_status(entry), attendance_listing):
                    by_status.setdefault(derive_status(entry), []).append(entry)
            in_room = [
                (e, status)
                for status in ("present", "late", "left_early")
                for e in by_status.get(status, [])
            ]
            for label, entries, muted in (
                ("Present", in_room, False),
                (
                    "Excused",
                    [(e, "excused") for e in by_status.get("excused", [])],
                    True,
                ),
                ("Absent", [(e, "absent") for e in by_status.get("absent", [])], True),
                ("Guests", [(e, "guest") for e in by_status.get("guest", [])], False),
            ):
                if not entries:
                    continue
                names = ", ".join(
                    self._attendee_label(e, status) for e, status in entries
                )
                colour = " color:#999;" if muted else ""
                parts.append(
                    f'<p style="font-size:13px;{colour}"><strong>{label} ({len(entries)}):</strong> {names}</p>'
                )
            if minutes.quorum_met is not None:
                q_text = "Quorum met" if minutes.quorum_met else "Quorum NOT met"
                if minutes.quorum_count:
                    q_text += f" ({minutes.quorum_count} members)"
                parts.append(
                    f'<p style="font-size:13px;"><strong>{q_text}</strong></p>'
                )
            parts.append("</div>")

        # Content sections
        sections = minutes.get_sections()
        if sections:
            for section in sorted(sections, key=lambda s: s.get("order", 0)):
                if section_is_printed(section):
                    content = section.get("content", "")
                    title = escape(section.get("title", section.get("key", "Section")))
                    parts.append(
                        '<div class="minutes-section" style="margin-bottom:20px;">'
                    )
                    parts.append(
                        f'<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">{title}</h4>'
                    )
                    if section.get("presenter"):
                        parts.append(
                            '<div style="font-size:13px; color:#555;">'
                            f"Presented by {escape(section['presenter'])}</div>"
                        )
                    if section.get("not_taken_up"):
                        parts.append(
                            '<div style="font-size:14px; color:#555; '
                            'font-style:italic;">Not taken up.</div>'
                        )
                    if normalize_format(section.get("format")) == FORMAT_HTML:
                        # Cleaned again on the way out: the stored value was
                        # cleaned on write, and a published page is the last
                        # place to rely on that having always happened.
                        parts.append(
                            '<div style="font-size:14px; color:#333;">'
                            f"{sanitize_html(content)}</div>"
                        )
                    else:
                        parts.append(
                            f'<div style="font-size:14px; color:#333; white-space:pre-wrap;">{escape(content)}</div>'
                        )
                    parts.append("</div>")

        # Motions
        recorded = recorded_motions(minutes.motions)
        if recorded:
            parts.append('<div class="minutes-motions" style="margin-bottom:24px;">')
            parts.append(
                f'<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">Motions ({len(recorded)})</h4>'
            )
            for i, motion in enumerate(recorded, 1):
                status = (
                    motion.status
                    if isinstance(motion.status, str)
                    else motion.status.value
                )
                color = (
                    "#16a34a"
                    if status == "passed"
                    else "#dc2626" if status == "failed" else "#ca8a04"
                )
                parts.append(
                    '<div style="border:1px solid #ddd; border-radius:4px; padding:12px; margin-bottom:8px;">'
                )
                parts.append(
                    f'<p style="margin:0 0 4px; font-size:14px;"><strong>Motion #{i}</strong> — <span style="color:{color}; font-weight:bold;">{escape(status.upper())}</span></p>'
                )
                parts.append(
                    f'<p style="margin:0 0 8px; font-size:14px;">{escape(motion.motion_text)}</p>'
                )
                detail_parts = []
                if motion.moved_by:
                    detail_parts.append(f"Moved by: {escape(motion.moved_by)}")
                if motion.seconded_by:
                    detail_parts.append(f"Seconded by: {escape(motion.seconded_by)}")
                if vote_summary(motion):
                    detail_parts.append(escape(vote_summary(motion)))
                if acceptance_label(motion):
                    detail_parts.append(escape(acceptance_label(motion) or ""))
                ballot = getattr(getattr(motion, "election", None), "title", None)
                if ballot:
                    detail_parts.append(f"Decided by ballot: {escape(ballot)}")
                if detail_parts:
                    parts.append(
                        f'<p style="margin:0; font-size:12px; color:#666;">{" | ".join(detail_parts)}</p>'
                    )
                parts.append("</div>")
            parts.append("</div>")

        # Closed sessions: the record that they were held and who stayed. What
        # was said in them stays in the (restricted) executive section.
        parts.extend(self._closed_sessions_html(closed_sessions, tz_name))

        # Election results filed with the minutes
        parts.extend(self._election_results_html(election_results))

        # Action Items
        if minutes.action_items:
            parts.append(
                '<div class="minutes-action-items" style="margin-bottom:24px;">'
            )
            parts.append(
                f'<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">Action Items ({len(minutes.action_items)})</h4>'
            )
            parts.append(
                '<table style="width:100%; border-collapse:collapse; font-size:13px;">'
            )
            parts.append(
                '<tr style="background:#f3f4f6;"><th style="padding:6px; text-align:left; border:1px solid #ddd;">Description</th><th style="padding:6px; text-align:left; border:1px solid #ddd;">Assignee</th><th style="padding:6px; text-align:left; border:1px solid #ddd;">Due</th><th style="padding:6px; text-align:left; border:1px solid #ddd;">Priority</th></tr>'
            )
            for item in minutes.action_items:
                # A calendar day, not an instant: shown as stored.
                due_on = stored_calendar_day(item.due_date)
                due = due_on.isoformat() if due_on else "—"
                priority = (
                    item.priority
                    if isinstance(item.priority, str)
                    else item.priority.value
                )
                parts.append(
                    f'<tr><td style="padding:6px; border:1px solid #ddd;">{escape(item.description)}</td><td style="padding:6px; border:1px solid #ddd;">{escape(item.assignee_name or "—")}</td><td style="padding:6px; border:1px solid #ddd;">{escape(due)}</td><td style="padding:6px; border:1px solid #ddd;">{escape(priority)}</td></tr>'
                )
            parts.append("</table>")
            parts.append("</div>")

        # Footer
        parts.append(
            '<div class="minutes-footer" style="border-top:1px solid #ddd; padding-top:12px; margin-top:32px; font-size:11px; color:#999;">'
        )
        footer_parts = []
        if footer.get("left_text"):
            footer_parts.append(escape(footer["left_text"]))
        if footer.get("center_text"):
            footer_parts.append(escape(footer["center_text"]))
        if footer.get("confidentiality_notice"):
            footer_parts.append(escape(footer["confidentiality_notice"]))
        if footer_parts:
            parts.append(
                '<p style="text-align:center;">'
                + " &nbsp;|&nbsp; ".join(footer_parts)
                + "</p>"
            )

        if minutes.approved_at:
            parts.append(
                f'<p style="text-align:center;">Approved: {self._to_local(minutes.approved_at, tz_name).strftime("%B %d, %Y")}</p>'
            )
        parts.append("</div>")

        parts.append("</div>")
        return "\n".join(parts)
