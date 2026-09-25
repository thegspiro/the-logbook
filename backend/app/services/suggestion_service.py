"""
Suggestion box service.

Boxes are configured by holders of ``suggestions.manage``; members submit to
them, named or anonymously as each box allows; each box's reviewers — and only
they — read what it receives and set its disposition. A reviewer may forward a
single suggestion to another member or position, who then reviews that
suggestion alone and cannot pass it on. A box with follow-up enabled adds a
two-way thread between the reviewers and the submitter.

Anonymity invariants — every one is load-bearing, and the tests in
``tests/test_suggestion_boxes.py`` pin them:

* An anonymous submission never stores its author: ``submitted_by`` and every
  submitter-side ``author_id`` stay NULL, and no email is sent on its author's
  behalf with ``sent_by`` set.
* Nothing on the anonymous side carries an exact time. ``created_at`` on the
  submission, its screenshots' file mtimes and the submitter's own thread
  replies are all truncated to 12:00 UTC of the day, so a row cannot be lined
  up against session or login activity. Noon rather than midnight keeps the
  calendar date the same when the frontend renders it in any US timezone.
* An anonymous submitter in a follow-up box is identified by a random key
  whose SHA-256 digest alone is stored; the key itself is returned once and
  never persisted or logged.
* Screenshots are decoded and re-encoded, which drops EXIF (GPS position,
  device serial) and the client's filename, either of which can name a person.
"""

import asyncio
import hashlib
import html
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from loguru import logger
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.suggestion import (
    Suggestion,
    SuggestionAnonymityMode,
    SuggestionAttachment,
    SuggestionAuthorRole,
    SuggestionBox,
    SuggestionBoxReviewer,
    SuggestionBoxWatcher,
    SuggestionDisposition,
    SuggestionForward,
    SuggestionMessage,
    SuggestionStatusEvent,
    SuggestionVote,
)
from app.models.user import Organization, Position, User, user_positions
from app.schemas.suggestion import (
    MAX_DETAILS_LENGTH,
    MAX_TITLE_LENGTH,
    SuggestionBoxWrite,
)
from app.utils.image_processing import optimize_image
from app.utils.mime_validation import detect_mime_type
from app.utils.org_scoping import assert_all_in_org

SUGGESTION_ATTACHMENT_DIR = "/app/uploads/suggestions"
MAX_SCREENSHOTS = 5
MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
ALLOWED_SCREENSHOT_MIME = frozenset(
    {"image/png", "image/jpeg", "image/webp", "image/gif"}
)
# Tall enough for a full-height phone screenshot to stay legible; the pixel
# cap in optimize_image still bounds decompression.
SCREENSHOT_MAX_DIMENSIONS = (2560, 2560)
OPEN_DISPOSITIONS = (
    SuggestionDisposition.NEW.value,
    SuggestionDisposition.UNDER_REVIEW.value,
)
EMAIL_TEMPLATE_TYPE = "suggestion_box"

# The box every department starts with, reviewed by the seeded Compliance
# Officer position. Seeded **active** by the owner's decision (2026-09-24), so
# members can file a concern from day one. The cost is accepted: until someone
# is appointed to the position, reports land in a box nobody reads. Where no
# position carries the reviewer slug the box is seeded inactive instead, because
# ``_validate_box_write`` refuses a live box with no reviewer at all. Migration
# ``3c918c06466d`` carries a frozen copy for existing departments, and
# ``7d2b4e8a1c35`` switches on the boxes it seeded inactive.
COMPLIANCE_BOX_NAME = "Compliance"
COMPLIANCE_BOX_DESCRIPTION = (
    "Report a compliance concern: a policy, safety, training-record or "
    "regulatory issue. Reviewed by the Compliance Officer."
)
COMPLIANCE_REVIEWER_SLUG = "compliance_officer"


def hash_follow_up_key(key: str) -> str:
    # A bare digest is enough: the key is 256 bits of randomness, so there is
    # no dictionary for a salt to defend against.
    return hashlib.sha256(key.strip().encode("utf-8")).hexdigest()


def anonymous_timestamp(moment: datetime) -> datetime:
    return moment.astimezone(timezone.utc).replace(
        hour=12, minute=0, second=0, microsecond=0
    )


def process_screenshot(content: bytes) -> bytes:
    """Validate by magic bytes and re-encode to WebP.

    Raises ``RuntimeError`` when MIME detection is unavailable (the caller
    maps that to 503) and ``ValueError`` for anything that is not a readable
    image of an allowed type.
    """
    mime = detect_mime_type(content)
    if mime not in ALLOWED_SCREENSHOT_MIME:
        raise ValueError("Screenshots must be PNG, JPEG, WebP or GIF images.")
    try:
        return optimize_image(
            content,
            max_size=SCREENSHOT_MAX_DIMENSIONS,
            quality=85,
            output_format="WEBP",
        )
    except Exception as exc:
        logger.info("Rejected unreadable suggestion screenshot: {}", exc)
        raise ValueError("A screenshot could not be read as an image.") from exc


def _display_name(user: Optional[User]) -> Optional[str]:
    if user is None:
        return None
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or user.username or None


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


class SuggestionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Box administration
    # ------------------------------------------------------------------

    async def get_box(
        self, organization_id: str, box_id: str
    ) -> Optional[SuggestionBox]:
        # populate_existing so a read after a reviewer change sees the
        # collection as written, not as first loaded into the session.
        result = await self.db.execute(
            select(SuggestionBox)
            .options(
                selectinload(SuggestionBox.reviewers),
                selectinload(SuggestionBox.watchers),
            )
            .where(
                SuggestionBox.id == str(box_id),
                SuggestionBox.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def list_boxes_for_admin(self, organization_id: str) -> List[Dict[str, Any]]:
        result = await self.db.execute(
            select(SuggestionBox)
            .options(
                selectinload(SuggestionBox.reviewers),
                selectinload(SuggestionBox.watchers),
            )
            .where(SuggestionBox.organization_id == str(organization_id))
            .order_by(SuggestionBox.is_active.desc(), SuggestionBox.name)
        )
        boxes = list(result.scalars().all())
        position_names, member_names = await self._reviewer_names(boxes)
        return [self._box_admin_view(b, position_names, member_names) for b in boxes]

    async def create_box(
        self, organization_id: str, data: SuggestionBoxWrite, actor_id: str
    ) -> Dict[str, Any]:
        await self._validate_box_write(organization_id, data, exclude_box_id=None)
        box = SuggestionBox(
            organization_id=str(organization_id),
            name=data.name,
            description=data.description,
            anonymity_mode=data.anonymity_mode,
            follow_up_enabled=data.follow_up_enabled,
            is_active=data.is_active,
            public_board_enabled=bool(data.public_board_enabled),
            created_by=str(actor_id),
            # Initialized so _replace_grants never lazy-loads a collection on
            # a new instance, which an async session cannot do.
            reviewers=[],
            watchers=[],
        )
        self.db.add(box)
        await self.db.flush()
        self._replace_reviewers(box, organization_id, data)
        self._replace_watchers(box, organization_id, data)
        await self.db.commit()
        return await self._reload_admin_view(organization_id, box.id)

    async def update_box(
        self, organization_id: str, box_id: str, data: SuggestionBoxWrite
    ) -> Optional[Dict[str, Any]]:
        box = await self.get_box(organization_id, box_id)
        if box is None:
            return None
        await self._validate_box_write(organization_id, data, exclude_box_id=box.id)
        box.name = data.name
        box.description = data.description
        box.anonymity_mode = data.anonymity_mode
        box.follow_up_enabled = data.follow_up_enabled
        box.is_active = data.is_active
        if data.public_board_enabled is not None:
            box.public_board_enabled = data.public_board_enabled
        self._replace_reviewers(box, organization_id, data)
        self._replace_watchers(box, organization_id, data)
        await self.db.commit()
        return await self._reload_admin_view(organization_id, box.id)

    async def seed_compliance_box(
        self, organization_id: str
    ) -> Optional[SuggestionBox]:
        """Create the default Compliance box if the org lacks one.

        Flushes without committing so onboarding keeps it in the same
        transaction as the organization it belongs to. A box already named
        ``Compliance`` is the department's own and is left alone. The reviewer
        is whichever position holds the ``compliance_officer`` slug — the
        seeded one, or a custom position a department created under it.
        """
        existing = await self.db.execute(
            select(SuggestionBox.id).where(
                SuggestionBox.organization_id == str(organization_id),
                SuggestionBox.name == COMPLIANCE_BOX_NAME,
            )
        )
        if existing.first() is not None:
            return None
        position_id = (
            await self.db.execute(
                select(Position.id).where(
                    Position.organization_id == str(organization_id),
                    Position.slug == COMPLIANCE_REVIEWER_SLUG,
                )
            )
        ).scalar_one_or_none()
        box = SuggestionBox(
            organization_id=str(organization_id),
            name=COMPLIANCE_BOX_NAME,
            description=COMPLIANCE_BOX_DESCRIPTION,
            anonymity_mode=SuggestionAnonymityMode.ALLOWED.value,
            follow_up_enabled=True,
            is_active=position_id is not None,
            reviewers=[],
            watchers=[],
        )
        if position_id:
            box.reviewers.append(
                SuggestionBoxReviewer(
                    organization_id=str(organization_id),
                    position_id=position_id,
                )
            )
        self.db.add(box)
        await self.db.flush()
        return box

    async def reviewer_options(self, organization_id: str) -> Dict[str, Any]:
        positions = await self.db.execute(
            select(Position.id, Position.name)
            .where(Position.organization_id == str(organization_id))
            .order_by(Position.name)
        )
        members = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id), User.is_active)
            .order_by(User.last_name, User.first_name)
        )
        return {
            "positions": [{"id": r.id, "name": r.name} for r in positions.all()],
            "members": [
                {"id": u.id, "name": _display_name(u) or u.id}
                for u in members.scalars().all()
            ],
        }

    async def _validate_box_write(
        self,
        organization_id: str,
        data: SuggestionBoxWrite,
        exclude_box_id: Optional[str],
    ) -> None:
        await assert_all_in_org(
            self.db,
            Position,
            data.reviewer_position_ids,
            organization_id,
            label="reviewer position",
        )
        await assert_all_in_org(
            self.db,
            User,
            data.reviewer_member_ids,
            organization_id,
            label="reviewer member",
        )
        await assert_all_in_org(
            self.db,
            Position,
            data.watcher_position_ids or [],
            organization_id,
            label="notified position",
        )
        await assert_all_in_org(
            self.db,
            User,
            data.watcher_member_ids or [],
            organization_id,
            label="notified member",
        )
        # A live box with nobody able to read it would accept submissions into
        # a void — the submitter would believe they had been heard.
        if data.is_active and not (
            data.reviewer_position_ids or data.reviewer_member_ids
        ):
            raise ValueError("An active suggestion box needs at least one reviewer.")
        query = select(SuggestionBox.id).where(
            SuggestionBox.organization_id == str(organization_id),
            SuggestionBox.name == data.name,
        )
        if exclude_box_id:
            query = query.where(SuggestionBox.id != str(exclude_box_id))
        if (await self.db.execute(query)).first() is not None:
            raise ValueError("A suggestion box with that name already exists.")

    def _replace_reviewers(
        self, box: SuggestionBox, organization_id: str, data: SuggestionBoxWrite
    ) -> None:
        self._replace_grants(
            box.reviewers,
            SuggestionBoxReviewer,
            organization_id,
            data.reviewer_position_ids,
            data.reviewer_member_ids,
        )

    def _replace_watchers(
        self, box: SuggestionBox, organization_id: str, data: SuggestionBoxWrite
    ) -> None:
        # Both omitted means "leave them alone": an older client that does not
        # know about watchers must not clear them by saving the box.
        if data.watcher_position_ids is None and data.watcher_member_ids is None:
            return
        self._replace_grants(
            box.watchers,
            SuggestionBoxWatcher,
            organization_id,
            data.watcher_position_ids or [],
            data.watcher_member_ids or [],
        )

    @staticmethod
    def _replace_grants(
        collection: List[Any],
        model: Any,
        organization_id: str,
        position_ids: Iterable[str],
        member_ids: Iterable[str],
    ) -> None:
        """Make ``collection`` hold exactly the named positions and members,
        keeping rows that survive so their ids and timestamps do too."""
        wanted = {("position", pid) for pid in position_ids} | {
            ("member", uid) for uid in member_ids
        }
        current = {}
        for grant in list(collection):
            key = (
                ("position", grant.position_id)
                if grant.position_id
                else ("member", grant.user_id)
            )
            if key in wanted:
                current[key] = grant
            else:
                collection.remove(grant)
        for kind, ref in wanted - set(current):
            collection.append(
                model(
                    organization_id=str(organization_id),
                    position_id=ref if kind == "position" else None,
                    user_id=ref if kind == "member" else None,
                )
            )

    async def _reload_admin_view(
        self, organization_id: str, box_id: str
    ) -> Dict[str, Any]:
        box = await self.get_box(organization_id, box_id)
        if box is None:  # pragma: no cover - just written in this transaction
            raise LookupError("Suggestion box not found")
        position_names, member_names = await self._reviewer_names([box])
        return self._box_admin_view(box, position_names, member_names)

    async def _reviewer_names(
        self, boxes: Sequence[SuggestionBox]
    ) -> Tuple[Dict[str, str], Dict[str, str]]:
        grants = [g for b in boxes for g in (*b.reviewers, *b.watchers)]
        position_ids = {g.position_id for g in grants if g.position_id}
        member_ids = {g.user_id for g in grants if g.user_id}
        position_names: Dict[str, str] = {}
        member_names: Dict[str, str] = {}
        if position_ids:
            rows = await self.db.execute(
                select(Position.id, Position.name).where(Position.id.in_(position_ids))
            )
            position_names = {r.id: r.name for r in rows.all()}
        if member_ids:
            users = await self._users_by_id(member_ids)
            member_names = {uid: _display_name(u) or uid for uid, u in users.items()}
        return position_names, member_names

    @staticmethod
    def _box_admin_view(
        box: SuggestionBox,
        position_names: Dict[str, str],
        member_names: Dict[str, str],
    ) -> Dict[str, Any]:
        def refs(grants: Iterable[Any]) -> Tuple[List[Dict], List[Dict]]:
            grants = list(grants)
            positions = [
                {"id": g.position_id, "name": position_names.get(g.position_id, "")}
                for g in grants
                if g.position_id
            ]
            members = [
                {"id": g.user_id, "name": member_names.get(g.user_id, "")}
                for g in grants
                if g.user_id
            ]
            return (
                sorted(positions, key=lambda p: p["name"]),
                sorted(members, key=lambda m: m["name"]),
            )

        reviewer_positions, reviewer_members = refs(box.reviewers)
        watcher_positions, watcher_members = refs(box.watchers)
        return {
            "id": box.id,
            "name": box.name,
            "description": box.description,
            "anonymity_mode": box.anonymity_mode,
            "follow_up_enabled": bool(box.follow_up_enabled),
            "is_active": bool(box.is_active),
            "reviewer_positions": reviewer_positions,
            "reviewer_members": reviewer_members,
            "watcher_positions": watcher_positions,
            "watcher_members": watcher_members,
            "public_board_enabled": bool(box.public_board_enabled),
            "created_at": box.created_at,
            "updated_at": box.updated_at,
        }

    # ------------------------------------------------------------------
    # Submitting
    # ------------------------------------------------------------------

    async def list_open_boxes(self, organization_id: str) -> List[SuggestionBox]:
        result = await self.db.execute(
            select(SuggestionBox)
            .where(
                SuggestionBox.organization_id == str(organization_id),
                SuggestionBox.is_active.is_(True),
            )
            .order_by(SuggestionBox.name)
        )
        return list(result.scalars().all())

    async def get_open_box(
        self, organization_id: str, box_id: str
    ) -> Optional[SuggestionBox]:
        result = await self.db.execute(
            select(SuggestionBox).where(
                SuggestionBox.id == str(box_id),
                SuggestionBox.organization_id == str(organization_id),
                SuggestionBox.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    def resolve_anonymity(box: SuggestionBox, requested: bool) -> bool:
        if box.anonymity_mode == SuggestionAnonymityMode.REQUIRED.value:
            return True
        if box.anonymity_mode == SuggestionAnonymityMode.DISABLED.value:
            if requested:
                raise ValueError("This box does not accept anonymous submissions.")
            return False
        return requested

    async def submit(
        self,
        *,
        box: SuggestionBox,
        user_id: str,
        title: str,
        details: str,
        anonymous: bool,
        screenshots: Sequence[bytes],
    ) -> Tuple[Suggestion, Optional[str]]:
        """Store a submission. ``screenshots`` are already processed bytes.

        Returns the row and, for an anonymous submission to a follow-up box,
        the plaintext follow-up key — the only time it exists server-side.
        """
        title = (title or "").strip()
        details = (details or "").strip()
        if not title or len(title) > MAX_TITLE_LENGTH:
            raise ValueError(
                f"A title of 1 to {MAX_TITLE_LENGTH} characters is required."
            )
        if not details or len(details) > MAX_DETAILS_LENGTH:
            raise ValueError(
                f"Details of 1 to {MAX_DETAILS_LENGTH} characters are required."
            )
        if len(screenshots) > MAX_SCREENSHOTS:
            raise ValueError(f"At most {MAX_SCREENSHOTS} screenshots may be attached.")
        is_anonymous = self.resolve_anonymity(box, anonymous)

        now = datetime.now(timezone.utc)
        stamp = anonymous_timestamp(now) if is_anonymous else now
        key: Optional[str] = None
        if is_anonymous and box.follow_up_enabled:
            key = secrets.token_urlsafe(32)

        suggestion = Suggestion(
            organization_id=box.organization_id,
            box_id=box.id,
            is_anonymous=is_anonymous,
            submitted_by=None if is_anonymous else str(user_id),
            follow_up_key_hash=hash_follow_up_key(key) if key else None,
            title=title,
            details=details,
            disposition=SuggestionDisposition.NEW.value,
            created_at=stamp,
            updated_at=stamp,
        )
        self.db.add(suggestion)
        await self.db.flush()

        written: List[str] = []
        try:
            for index, content in enumerate(screenshots):
                path = await self._write_screenshot(
                    box.organization_id, content, stamp if is_anonymous else None
                )
                written.append(path)
                self.db.add(
                    SuggestionAttachment(
                        organization_id=box.organization_id,
                        suggestion_id=suggestion.id,
                        position=index,
                        file_name=f"screenshot-{index + 1}.webp",
                        file_path=path,
                        content_type="image/webp",
                        file_size=len(content),
                        created_at=stamp,
                    )
                )
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            for path in written:
                await asyncio.to_thread(_remove_quietly, path)
            raise
        return suggestion, key

    async def _write_screenshot(
        self, organization_id: str, content: bytes, mtime: Optional[datetime]
    ) -> str:
        org_dir = os.path.join(SUGGESTION_ATTACHMENT_DIR, str(organization_id))
        path = os.path.join(org_dir, f"{uuid.uuid4().hex}.webp")

        def _write() -> None:
            os.makedirs(org_dir, exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(content)
            if mtime is not None:
                # The filesystem would otherwise keep the exact upload time the
                # row itself declines to record.
                seconds = mtime.timestamp()
                os.utime(path, (seconds, seconds))

        await asyncio.to_thread(_write)
        return path

    # ------------------------------------------------------------------
    # The submitter's side
    # ------------------------------------------------------------------

    def _with_children(self, query):
        # populate_existing: sessions keep objects across commits
        # (expire_on_commit=False), so without it a re-read after a reply
        # would hand back the thread as it was before the reply.
        return query.options(
            selectinload(Suggestion.box),
            selectinload(Suggestion.attachments),
            selectinload(Suggestion.messages),
        ).execution_options(populate_existing=True)

    async def list_mine(
        self, organization_id: str, user_id: str
    ) -> List[Dict[str, Any]]:
        message_counts = (
            select(func.count(SuggestionMessage.id))
            .where(SuggestionMessage.suggestion_id == Suggestion.id)
            .correlate(Suggestion)
            .scalar_subquery()
        )
        result = await self.db.execute(
            select(Suggestion, SuggestionBox, message_counts)
            .join(SuggestionBox, SuggestionBox.id == Suggestion.box_id)
            .where(
                Suggestion.organization_id == str(organization_id),
                Suggestion.submitted_by == str(user_id),
                Suggestion.is_anonymous.is_(False),
            )
            .order_by(Suggestion.created_at.desc())
            .limit(200)
        )
        items = []
        for suggestion, box, count in result.all():
            follow_up = bool(box.follow_up_enabled)
            items.append(
                {
                    "id": suggestion.id,
                    "box_id": box.id,
                    "box_name": box.name,
                    "title": suggestion.title,
                    "follow_up_enabled": follow_up,
                    "disposition": suggestion.disposition if follow_up else None,
                    "message_count": int(count or 0) if follow_up else 0,
                    "created_at": suggestion.created_at,
                }
            )
        return items

    async def get_mine(
        self, organization_id: str, user_id: str, suggestion_id: str
    ) -> Optional[Suggestion]:
        result = await self.db.execute(
            self._with_children(select(Suggestion)).where(
                Suggestion.id == str(suggestion_id),
                Suggestion.organization_id == str(organization_id),
                Suggestion.submitted_by == str(user_id),
                Suggestion.is_anonymous.is_(False),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_key(self, organization_id: str, key: str) -> Optional[Suggestion]:
        result = await self.db.execute(
            self._with_children(select(Suggestion)).where(
                Suggestion.organization_id == str(organization_id),
                Suggestion.follow_up_key_hash == hash_follow_up_key(key),
            )
        )
        return result.scalar_one_or_none()

    async def submitter_view(
        self, suggestion: Suggestion, viewer_id: Optional[str]
    ) -> Dict[str, Any]:
        """``viewer_id`` is None for a key holder, whose identity is unknown
        by design."""
        follow_up = bool(suggestion.box.follow_up_enabled)
        messages = await self._thread(suggestion, viewer_id) if follow_up else []
        return {
            "id": None if suggestion.is_anonymous else suggestion.id,
            "box_name": suggestion.box.name,
            "title": suggestion.title,
            "details": suggestion.details,
            "is_anonymous": bool(suggestion.is_anonymous),
            "follow_up_enabled": follow_up,
            "disposition": suggestion.disposition if follow_up else None,
            "attachments": [self._attachment_view(a) for a in suggestion.attachments],
            "messages": messages,
            "timeline": await self.timeline(suggestion) if follow_up else [],
            "created_at": suggestion.created_at,
            "timestamp_precision": "day" if suggestion.is_anonymous else "exact",
        }

    async def add_submitter_message(
        self, suggestion: Suggestion, author_id: Optional[str], body: str
    ) -> None:
        if not suggestion.box.follow_up_enabled:
            raise ValueError("This box does not take follow-up replies.")
        now = datetime.now(timezone.utc)
        if suggestion.is_anonymous:
            await self._append_message(
                suggestion,
                SuggestionAuthorRole.SUBMITTER,
                None,
                body,
                anonymous_timestamp(now),
            )
            # updated_at deliberately left alone: bumping it would record the
            # exact moment the anonymous submitter was active.
        else:
            await self._append_message(
                suggestion, SuggestionAuthorRole.SUBMITTER, author_id, body, now
            )
            suggestion.updated_at = now
        await self.db.commit()

    # ------------------------------------------------------------------
    # The reviewers' side
    # ------------------------------------------------------------------

    @staticmethod
    def _held_positions(user_id: str):
        return select(user_positions.c.position_id).where(
            user_positions.c.user_id == str(user_id)
        )

    def _forwarded_to(self, organization_id: str, user_id: str):
        """Suggestion ids forwarded to the member, directly or by position."""
        return select(SuggestionForward.suggestion_id).where(
            SuggestionForward.organization_id == str(organization_id),
            or_(
                SuggestionForward.user_id == str(user_id),
                SuggestionForward.position_id.in_(self._held_positions(user_id)),
            ),
        )

    async def _review_access(
        self, organization_id: str, user_id: str
    ) -> Tuple[Set[str], Any]:
        """The boxes the member reviews, and the SQL condition selecting every
        suggestion they may review: those boxes plus anything forwarded."""
        box_ids = await self.reviewer_box_ids(organization_id, user_id)
        forwarded = self._forwarded_to(organization_id, user_id)
        condition = (
            or_(Suggestion.box_id.in_(box_ids), Suggestion.id.in_(forwarded))
            if box_ids
            else Suggestion.id.in_(forwarded)
        )
        return box_ids, condition

    async def reviewer_box_ids(self, organization_id: str, user_id: str) -> Set[str]:
        held_positions = self._held_positions(user_id)
        result = await self.db.execute(
            select(SuggestionBoxReviewer.box_id).where(
                SuggestionBoxReviewer.organization_id == str(organization_id),
                or_(
                    SuggestionBoxReviewer.user_id == str(user_id),
                    SuggestionBoxReviewer.position_id.in_(held_positions),
                ),
            )
        )
        return {str(row[0]) for row in result.all()}

    async def review_summary(
        self, organization_id: str, user_id: str
    ) -> Dict[str, Any]:
        box_ids, condition = await self._review_access(organization_id, user_id)
        has_forwards = (
            await self.db.execute(self._forwarded_to(organization_id, user_id).limit(1))
        ).first() is not None
        if not box_ids and not has_forwards:
            return {"is_reviewer": False, "open_count": 0, "boxes": []}
        boxes = await self.db.execute(
            select(SuggestionBox)
            .where(
                SuggestionBox.organization_id == str(organization_id),
                SuggestionBox.id.in_(box_ids),
            )
            .order_by(SuggestionBox.name)
        )
        open_count = await self.db.scalar(
            select(func.count(Suggestion.id)).where(
                Suggestion.organization_id == str(organization_id),
                condition,
                Suggestion.disposition.in_(OPEN_DISPOSITIONS),
            )
        )
        return {
            "is_reviewer": True,
            "open_count": int(open_count or 0),
            "boxes": list(boxes.scalars().all()),
        }

    async def list_for_review(
        self,
        organization_id: str,
        user_id: str,
        *,
        box_id: Optional[str] = None,
        disposition: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Dict[str, Any]], int]:
        box_ids, condition = await self._review_access(organization_id, user_id)
        filters = [Suggestion.organization_id == str(organization_id), condition]
        if box_id:
            filters.append(Suggestion.box_id == str(box_id))
        if disposition == "open":
            filters.append(Suggestion.disposition.in_(OPEN_DISPOSITIONS))
        elif disposition:
            filters.append(Suggestion.disposition == disposition)

        total = await self.db.scalar(select(func.count(Suggestion.id)).where(*filters))
        message_counts = (
            select(func.count(SuggestionMessage.id))
            .where(SuggestionMessage.suggestion_id == Suggestion.id)
            .correlate(Suggestion)
            .scalar_subquery()
        )
        attachment_counts = (
            select(func.count(SuggestionAttachment.id))
            .where(SuggestionAttachment.suggestion_id == Suggestion.id)
            .correlate(Suggestion)
            .scalar_subquery()
        )
        result = await self.db.execute(
            select(Suggestion, SuggestionBox.name, message_counts, attachment_counts)
            .join(SuggestionBox, SuggestionBox.id == Suggestion.box_id)
            .where(*filters)
            .order_by(Suggestion.created_at.desc(), Suggestion.id.desc())
            .offset(skip)
            .limit(limit)
        )
        rows = result.all()
        submitters = await self._users_by_id(
            s.submitted_by for s, *_ in rows if s.submitted_by
        )
        items = [
            {
                "id": s.id,
                "box_id": s.box_id,
                "box_name": box_name,
                "title": s.title,
                "is_anonymous": bool(s.is_anonymous),
                "submitter_name": (
                    None
                    if s.is_anonymous
                    else _display_name(submitters.get(s.submitted_by or ""))
                ),
                "disposition": s.disposition,
                "message_count": int(msgs or 0),
                "attachment_count": int(atts or 0),
                "created_at": s.created_at,
                "timestamp_precision": "day" if s.is_anonymous else "exact",
                "via_forward": s.box_id not in box_ids,
            }
            for s, box_name, msgs, atts in rows
        ]
        return items, int(total or 0)

    async def get_for_review(
        self, organization_id: str, user_id: str, suggestion_id: str
    ) -> Optional[Suggestion]:
        _, condition = await self._review_access(organization_id, user_id)
        result = await self.db.execute(
            self._with_children(select(Suggestion)).where(
                Suggestion.id == str(suggestion_id),
                Suggestion.organization_id == str(organization_id),
                condition,
            )
        )
        return result.scalar_one_or_none()

    async def is_box_reviewer(
        self, organization_id: str, user_id: str, box_id: str
    ) -> bool:
        return str(box_id) in await self.reviewer_box_ids(organization_id, user_id)

    @staticmethod
    def can_follow_up(suggestion: Suggestion) -> bool:
        if not suggestion.box.follow_up_enabled:
            return False
        # An anonymous submission made before the box enabled follow-up has
        # no key, so nobody could ever read a reply to it.
        return not suggestion.is_anonymous or bool(suggestion.follow_up_key_hash)

    async def reviewer_view(
        self, suggestion: Suggestion, viewer_id: str
    ) -> Dict[str, Any]:
        people = await self._users_by_id(
            [suggestion.submitted_by, suggestion.disposition_updated_by]
        )
        can_forward = await self.is_box_reviewer(
            suggestion.organization_id, viewer_id, suggestion.box_id
        )
        return {
            "id": suggestion.id,
            "box_id": suggestion.box_id,
            "box_name": suggestion.box.name,
            "title": suggestion.title,
            "details": suggestion.details,
            "is_anonymous": bool(suggestion.is_anonymous),
            "submitter_name": (
                None
                if suggestion.is_anonymous
                else _display_name(people.get(suggestion.submitted_by or ""))
            ),
            "follow_up_enabled": bool(suggestion.box.follow_up_enabled),
            "can_follow_up": self.can_follow_up(suggestion),
            "disposition": suggestion.disposition,
            "internal_note": suggestion.internal_note,
            "disposition_updated_by_name": _display_name(
                people.get(suggestion.disposition_updated_by or "")
            ),
            "disposition_updated_at": suggestion.disposition_updated_at,
            "attachments": [self._attachment_view(a) for a in suggestion.attachments],
            "messages": await self._thread(suggestion, viewer_id),
            "created_at": suggestion.created_at,
            "timestamp_precision": "day" if suggestion.is_anonymous else "exact",
            "can_forward": can_forward,
            "via_forward": not can_forward,
            "forwards": await self.list_forwards(suggestion),
            "timeline": await self.timeline(suggestion),
            "board_enabled": bool(suggestion.box.public_board_enabled),
            "can_publish": can_forward and bool(suggestion.box.public_board_enabled),
            "published_at": suggestion.published_at,
            "published_title": suggestion.published_title,
            "published_summary": suggestion.published_summary,
            "vote_count": await self._vote_count(suggestion.id),
        }

    # ------------------------------------------------------------------
    # Forwarding
    # ------------------------------------------------------------------

    async def list_forwards(self, suggestion: Suggestion) -> List[Dict[str, Any]]:
        result = await self.db.execute(
            select(SuggestionForward)
            .where(
                SuggestionForward.organization_id == suggestion.organization_id,
                SuggestionForward.suggestion_id == suggestion.id,
            )
            .order_by(SuggestionForward.created_at, SuggestionForward.id)
        )
        forwards = list(result.scalars().all())
        position_ids = {f.position_id for f in forwards if f.position_id}
        position_names: Dict[str, str] = {}
        if position_ids:
            rows = await self.db.execute(
                select(Position.id, Position.name).where(Position.id.in_(position_ids))
            )
            position_names = {r.id: r.name for r in rows.all()}
        people = await self._users_by_id(
            [f.user_id for f in forwards] + [f.forwarded_by for f in forwards]
        )
        return [
            {
                "id": f.id,
                "kind": "position" if f.position_id else "member",
                "target_id": f.position_id or f.user_id,
                "name": (
                    position_names.get(f.position_id, "")
                    if f.position_id
                    else _display_name(people.get(f.user_id or "")) or ""
                ),
                "forwarded_by_name": _display_name(people.get(f.forwarded_by or "")),
                "created_at": f.created_at,
            }
            for f in forwards
        ]

    async def add_forwards(
        self,
        suggestion: Suggestion,
        actor_id: str,
        position_ids: Sequence[str],
        member_ids: Sequence[str],
    ) -> Tuple[List[str], List[str]]:
        """Forward to positions and members not already forwarded to.

        Returns the (position_ids, member_ids) actually added, so the caller
        notifies only the people who just gained access.
        """
        org_id = suggestion.organization_id
        await assert_all_in_org(
            self.db, Position, position_ids, org_id, label="position"
        )
        await assert_all_in_org(self.db, User, member_ids, org_id, label="member")
        if not position_ids and not member_ids:
            raise ValueError("Choose at least one member or position to forward to.")
        existing = await self.db.execute(
            select(SuggestionForward.position_id, SuggestionForward.user_id).where(
                SuggestionForward.organization_id == org_id,
                SuggestionForward.suggestion_id == suggestion.id,
            )
        )
        rows = existing.all()
        have_positions = {r.position_id for r in rows if r.position_id}
        have_members = {r.user_id for r in rows if r.user_id}
        new_positions = [
            p for p in dict.fromkeys(position_ids) if p not in have_positions
        ]
        new_members = [m for m in dict.fromkeys(member_ids) if m not in have_members]
        for position_id in new_positions:
            self.db.add(
                SuggestionForward(
                    organization_id=org_id,
                    suggestion_id=suggestion.id,
                    position_id=position_id,
                    forwarded_by=str(actor_id),
                )
            )
        for member_id in new_members:
            self.db.add(
                SuggestionForward(
                    organization_id=org_id,
                    suggestion_id=suggestion.id,
                    user_id=member_id,
                    forwarded_by=str(actor_id),
                )
            )
        await self.db.commit()
        return new_positions, new_members

    async def remove_forward(
        self, suggestion: Suggestion, forward_id: str
    ) -> Optional[Dict[str, Optional[str]]]:
        result = await self.db.execute(
            select(SuggestionForward).where(
                SuggestionForward.id == str(forward_id),
                SuggestionForward.organization_id == suggestion.organization_id,
                SuggestionForward.suggestion_id == suggestion.id,
            )
        )
        forward = result.scalar_one_or_none()
        if forward is None:
            return None
        removed = {"position_id": forward.position_id, "user_id": forward.user_id}
        await self.db.delete(forward)
        await self.db.commit()
        return removed

    async def update_disposition(
        self,
        suggestion: Suggestion,
        actor_id: str,
        fields: Dict[str, Any],
    ) -> Tuple[Optional[str], bool]:
        """Apply a partial update.

        Returns the previous disposition when it changed (otherwise None),
        and whether a public response was recorded. Either one adds a step to
        the submitter's timeline; an internal-note edit alone adds nothing.
        """
        previous: Optional[str] = None
        now = datetime.now(timezone.utc)
        new_disposition = fields.get("disposition")
        response = fields.get("public_response")
        if response and not suggestion.box.follow_up_enabled:
            # Nobody could ever read it: a one-way box shows its submitter
            # neither status nor responses.
            raise ValueError(
                "This box is one-way, so its submitters never see a response."
            )
        # Two reviewers saving at once would both read the same last step and
        # collide on its sequence. Lock the suggestion to serialize them, and
        # make the max a locking read so it is not answered from a snapshot
        # taken before the lock (CLAUDE.md pitfall #27).
        await self.db.execute(
            select(Suggestion.id)
            .where(Suggestion.id == suggestion.id)
            .with_for_update()
        )
        if new_disposition and new_disposition != suggestion.disposition:
            previous = suggestion.disposition
            suggestion.disposition = new_disposition
            suggestion.disposition_updated_by = str(actor_id)
            suggestion.disposition_updated_at = now
        if "internal_note" in fields:
            suggestion.internal_note = (fields["internal_note"] or "").strip() or None
        if previous is not None or response:
            last = await self.db.scalar(
                select(func.max(SuggestionStatusEvent.sequence))
                .where(SuggestionStatusEvent.suggestion_id == suggestion.id)
                .with_for_update()
            )
            self.db.add(
                SuggestionStatusEvent(
                    organization_id=suggestion.organization_id,
                    suggestion_id=suggestion.id,
                    sequence=int(last or 0) + 1,
                    disposition=suggestion.disposition,
                    public_response=response or None,
                    created_at=now,
                )
            )
        suggestion.updated_at = now
        await self.db.commit()
        return previous, bool(response)

    async def timeline(self, suggestion: Suggestion) -> List[Dict[str, Any]]:
        """Receipt, then every step reviewers took, oldest first.

        Receipt carries the submission's own date and precision. The steps
        after it are reviewer actions, timed exactly: when a reviewer acted
        says nothing about who submitted.
        """
        events = (
            (
                await self.db.execute(
                    select(SuggestionStatusEvent)
                    .where(
                        SuggestionStatusEvent.organization_id
                        == suggestion.organization_id,
                        SuggestionStatusEvent.suggestion_id == suggestion.id,
                    )
                    .order_by(SuggestionStatusEvent.sequence)
                )
            )
            .scalars()
            .all()
        )
        entries = [
            {
                "disposition": SuggestionDisposition.NEW.value,
                "public_response": None,
                "created_at": suggestion.created_at,
                "timestamp_precision": "day" if suggestion.is_anonymous else "exact",
            }
        ]
        entries.extend(
            {
                "disposition": event.disposition,
                "public_response": event.public_response,
                "created_at": event.created_at,
                "timestamp_precision": "exact",
            }
            for event in events
        )
        return entries

    async def add_reviewer_message(
        self, suggestion: Suggestion, actor_id: str, body: str
    ) -> None:
        if not self.can_follow_up(suggestion):
            raise ValueError("This submission does not take follow-up replies.")
        now = datetime.now(timezone.utc)
        await self._append_message(
            suggestion, SuggestionAuthorRole.REVIEWER, str(actor_id), body, now
        )
        suggestion.updated_at = now
        await self.db.commit()

    async def reviewer_recipient_ids(
        self, organization_id: str, box_id: str
    ) -> List[str]:
        """Active members who review ``box_id``, directly or by position."""
        reviewers = select(SuggestionBoxReviewer).where(
            SuggestionBoxReviewer.organization_id == str(organization_id),
            SuggestionBoxReviewer.box_id == str(box_id),
        )
        rows = (await self.db.execute(reviewers)).scalars().all()
        return await self.active_member_ids(
            organization_id,
            {r.user_id for r in rows if r.user_id},
            {r.position_id for r in rows if r.position_id},
        )

    async def watcher_recipient_ids(
        self, organization_id: str, box_id: str
    ) -> List[str]:
        """Active members told of a box's new submissions without reviewing
        it. Anyone who also reviews the box is left out: they get the
        reviewer's notice, which links to the submission, and one is enough."""
        rows = (
            (
                await self.db.execute(
                    select(SuggestionBoxWatcher).where(
                        SuggestionBoxWatcher.organization_id == str(organization_id),
                        SuggestionBoxWatcher.box_id == str(box_id),
                    )
                )
            )
            .scalars()
            .all()
        )
        watchers = await self.active_member_ids(
            organization_id,
            {r.user_id for r in rows if r.user_id},
            {r.position_id for r in rows if r.position_id},
        )
        reviewers = set(await self.reviewer_recipient_ids(organization_id, box_id))
        return [w for w in watchers if w not in reviewers]

    async def suggestion_recipient_ids(self, suggestion: Suggestion) -> List[str]:
        """Everyone who reviews this suggestion: the box's reviewers plus
        whoever it was forwarded to."""
        org_id = suggestion.organization_id
        forwards = (
            (
                await self.db.execute(
                    select(SuggestionForward).where(
                        SuggestionForward.organization_id == org_id,
                        SuggestionForward.suggestion_id == suggestion.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        forwarded = await self.active_member_ids(
            org_id,
            {f.user_id for f in forwards if f.user_id},
            {f.position_id for f in forwards if f.position_id},
        )
        box = await self.reviewer_recipient_ids(org_id, suggestion.box_id)
        return sorted(set(box) | set(forwarded))

    async def active_member_ids(
        self,
        organization_id: str,
        direct: Iterable[str],
        position_ids: Iterable[str],
    ) -> List[str]:
        """Active members in the org named directly or holding a position."""
        member_set = {str(d) for d in direct if d}
        position_set = {str(p) for p in position_ids if p}
        conditions = []
        if member_set:
            conditions.append(User.id.in_(member_set))
        if position_set:
            conditions.append(
                User.id.in_(
                    select(user_positions.c.user_id).where(
                        user_positions.c.position_id.in_(position_set)
                    )
                )
            )
        if not conditions:
            return []
        result = await self.db.execute(
            select(User.id).where(
                User.organization_id == str(organization_id),
                User.is_active,
                or_(*conditions),
            )
        )
        return sorted(str(row[0]) for row in result.all())

    # ------------------------------------------------------------------
    # Idea board
    # ------------------------------------------------------------------

    async def publish(
        self, suggestion: Suggestion, actor_id: str, title: str, summary: str
    ) -> bool:
        """Put a reviewer-written copy on the board, or replace the copy
        already there. Returns True when it was not published before."""
        if not suggestion.box.public_board_enabled:
            raise ValueError("This box does not have an idea board.")
        now = datetime.now(timezone.utc)
        first = suggestion.published_at is None
        suggestion.published_title = title
        suggestion.published_summary = summary
        suggestion.published_by = str(actor_id)
        if first:
            suggestion.published_at = now
        suggestion.updated_at = now
        await self.db.commit()
        return first

    async def unpublish(self, suggestion: Suggestion) -> bool:
        """Take a suggestion off the board. Its votes are kept, so publishing
        it again does not wipe the support it had. Returns False when it was
        not published."""
        if suggestion.published_at is None:
            return False
        suggestion.published_at = None
        suggestion.published_by = None
        suggestion.published_title = None
        suggestion.published_summary = None
        suggestion.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        return True

    @staticmethod
    def _board_filters(organization_id: str) -> List[Any]:
        # A published suggestion leaves the board when its box is archived
        # or the board is switched off, without anyone unpublishing it.
        return [
            Suggestion.organization_id == str(organization_id),
            Suggestion.published_at.is_not(None),
            SuggestionBox.is_active,
            SuggestionBox.public_board_enabled,
        ]

    async def list_board(
        self,
        organization_id: str,
        user_id: str,
        *,
        box_id: Optional[str] = None,
        disposition: Optional[str] = None,
        sort: str = "top",
        skip: int = 0,
        limit: int = 25,
    ) -> Tuple[List[Dict[str, Any]], int]:
        filters = self._board_filters(organization_id)
        if box_id:
            filters.append(Suggestion.box_id == str(box_id))
        if disposition == "open":
            filters.append(Suggestion.disposition.in_(OPEN_DISPOSITIONS))
        elif disposition:
            filters.append(Suggestion.disposition == disposition)
        total = await self.db.scalar(
            select(func.count(Suggestion.id))
            .join(SuggestionBox, SuggestionBox.id == Suggestion.box_id)
            .where(*filters)
        )
        votes = self._vote_count_column()
        order = (
            [votes.desc(), Suggestion.published_at.desc(), Suggestion.id.desc()]
            if sort == "top"
            else [Suggestion.published_at.desc(), Suggestion.id.desc()]
        )
        rows = (
            await self.db.execute(
                select(
                    Suggestion,
                    SuggestionBox.name,
                    votes,
                    self._has_voted_column(user_id),
                )
                .join(SuggestionBox, SuggestionBox.id == Suggestion.box_id)
                .where(*filters)
                .order_by(*order)
                .offset(skip)
                .limit(limit)
            )
        ).all()
        return await self._board_entries(rows), int(total or 0)

    async def get_board_entry(
        self, organization_id: str, user_id: str, suggestion_id: str
    ) -> Optional[Dict[str, Any]]:
        rows = (
            await self.db.execute(
                select(
                    Suggestion,
                    SuggestionBox.name,
                    self._vote_count_column(),
                    self._has_voted_column(user_id),
                )
                .join(SuggestionBox, SuggestionBox.id == Suggestion.box_id)
                .where(
                    *self._board_filters(organization_id),
                    Suggestion.id == str(suggestion_id),
                )
            )
        ).all()
        entries = await self._board_entries(rows)
        return entries[0] if entries else None

    async def set_vote(
        self, organization_id: str, user_id: str, suggestion_id: str, on: bool
    ) -> Optional[Dict[str, Any]]:
        """Add or withdraw the member's vote; either is idempotent. Returns
        None when the suggestion is not on a board the member can see."""
        entry = await self.get_board_entry(organization_id, user_id, suggestion_id)
        if entry is None:
            return None
        if on and not entry["has_voted"]:
            try:
                # A savepoint, so a double tap that loses the race on the
                # unique constraint rolls back only its own insert.
                async with self.db.begin_nested():
                    self.db.add(
                        SuggestionVote(
                            organization_id=str(organization_id),
                            suggestion_id=str(suggestion_id),
                            user_id=str(user_id),
                        )
                    )
            except IntegrityError:
                pass
        elif not on and entry["has_voted"]:
            existing = (
                await self.db.execute(
                    select(SuggestionVote).where(
                        SuggestionVote.organization_id == str(organization_id),
                        SuggestionVote.suggestion_id == str(suggestion_id),
                        SuggestionVote.user_id == str(user_id),
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                await self.db.delete(existing)
        await self.db.commit()
        return await self.get_board_entry(organization_id, user_id, suggestion_id)

    @staticmethod
    def _vote_count_column():
        return (
            select(func.count(SuggestionVote.id))
            .where(SuggestionVote.suggestion_id == Suggestion.id)
            .correlate(Suggestion)
            .scalar_subquery()
            .label("vote_count")
        )

    @staticmethod
    def _has_voted_column(user_id: str):
        return (
            exists()
            .where(
                SuggestionVote.suggestion_id == Suggestion.id,
                SuggestionVote.user_id == str(user_id),
            )
            .correlate(Suggestion)
            .label("has_voted")
        )

    async def _vote_count(self, suggestion_id: str) -> int:
        count = await self.db.scalar(
            select(func.count(SuggestionVote.id)).where(
                SuggestionVote.suggestion_id == str(suggestion_id)
            )
        )
        return int(count or 0)

    async def _board_entries(self, rows: Sequence[Any]) -> List[Dict[str, Any]]:
        responses = await self._latest_public_responses([s.id for s, *_ in rows])
        return [
            {
                "id": s.id,
                "box_id": s.box_id,
                "box_name": box_name,
                "title": s.published_title,
                "summary": s.published_summary,
                "disposition": s.disposition,
                "public_response": responses.get(s.id),
                "vote_count": int(votes or 0),
                "has_voted": bool(voted),
                "published_at": s.published_at,
            }
            for s, box_name, votes, voted in rows
        ]

    async def _latest_public_responses(self, ids: List[str]) -> Dict[str, str]:
        """The newest response reviewers wrote for each suggestion, the one a
        member reading the board most needs."""
        if not ids:
            return {}
        rows = (
            await self.db.execute(
                select(
                    SuggestionStatusEvent.suggestion_id,
                    SuggestionStatusEvent.public_response,
                )
                .where(
                    SuggestionStatusEvent.suggestion_id.in_(ids),
                    SuggestionStatusEvent.public_response.is_not(None),
                )
                .order_by(SuggestionStatusEvent.sequence)
            )
        ).all()
        # Ordered by sequence, so the last write per suggestion is the newest.
        return {suggestion_id: response for suggestion_id, response in rows}

    # ------------------------------------------------------------------
    # Attachments and threads
    # ------------------------------------------------------------------

    @staticmethod
    def find_attachment(
        suggestion: Suggestion, attachment_id: str
    ) -> Optional[SuggestionAttachment]:
        for attachment in suggestion.attachments:
            if attachment.id == str(attachment_id):
                return attachment
        return None

    @staticmethod
    def confined_path(attachment: SuggestionAttachment) -> Optional[str]:
        real_path = os.path.realpath(attachment.file_path)
        org_root = os.path.realpath(
            os.path.join(SUGGESTION_ATTACHMENT_DIR, str(attachment.organization_id))
        )
        if not real_path.startswith(org_root + os.sep):
            return None
        return real_path

    @staticmethod
    def _attachment_view(attachment: SuggestionAttachment) -> Dict[str, Any]:
        return {
            "id": attachment.id,
            "file_name": attachment.file_name,
            "content_type": attachment.content_type,
            "file_size": attachment.file_size,
        }

    async def _thread(
        self, suggestion: Suggestion, viewer_id: Optional[str]
    ) -> List[Dict[str, Any]]:
        authors = await self._users_by_id(m.author_id for m in suggestion.messages)
        thread = []
        for message in suggestion.messages:
            anonymous_author = (
                message.author_role == SuggestionAuthorRole.SUBMITTER.value
                and suggestion.is_anonymous
            )
            is_mine = (
                message.author_role == SuggestionAuthorRole.SUBMITTER.value
                if viewer_id is None
                else bool(message.author_id) and message.author_id == str(viewer_id)
            )
            thread.append(
                {
                    "id": message.id,
                    "author_role": message.author_role,
                    "author_name": (
                        None
                        if anonymous_author
                        else _display_name(authors.get(message.author_id or ""))
                    ),
                    "is_mine": is_mine,
                    "body": message.body,
                    "created_at": message.created_at,
                    "timestamp_precision": "day" if anonymous_author else "exact",
                }
            )
        return thread

    async def _append_message(
        self,
        suggestion: Suggestion,
        role: SuggestionAuthorRole,
        author_id: Optional[str],
        body: str,
        created_at: datetime,
    ) -> SuggestionMessage:
        body = (body or "").strip()
        if not body:
            raise ValueError("A reply cannot be empty.")
        # Two replies at once would both read the same maximum and collide on
        # the unique sequence. Lock the parent to serialize them, and make the
        # max itself a locking read so it is not answered from a snapshot
        # taken before the lock (CLAUDE.md pitfall #27).
        await self.db.execute(
            select(Suggestion.id)
            .where(Suggestion.id == suggestion.id)
            .with_for_update()
        )
        last = await self.db.scalar(
            select(func.max(SuggestionMessage.sequence))
            .where(SuggestionMessage.suggestion_id == suggestion.id)
            .with_for_update()
        )
        message = SuggestionMessage(
            organization_id=suggestion.organization_id,
            suggestion_id=suggestion.id,
            sequence=int(last or 0) + 1,
            author_role=role.value,
            author_id=author_id,
            body=body,
            created_at=created_at,
        )
        self.db.add(message)
        await self.db.flush()
        return message

    async def _users_by_id(self, ids: Iterable[Optional[str]]) -> Dict[str, User]:
        wanted = {str(i) for i in ids if i}
        if not wanted:
            return {}
        result = await self.db.execute(select(User).where(User.id.in_(wanted)))
        return {str(u.id): u for u in result.scalars().all()}


# ----------------------------------------------------------------------
# Notification emails
# ----------------------------------------------------------------------


def _subject_safe(text: str) -> str:
    # A subject is a header; a line break in a box name would end it early.
    return " ".join((text or "").split())


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def reviewer_notice(
    box_name: str, suggestion_id: str, *, reply: bool
) -> Dict[str, str]:
    """A notice with no submission content. The submission stays inside the
    application; a complaint copied into mailboxes is out of the department's
    control for good."""
    box = html.escape(box_name)
    path = f"/suggestions?tab=review&id={suggestion_id}"
    if reply:
        subject = f"New follow-up reply in the {_subject_safe(box_name)} box"
        lead = (
            f"The submitter replied on a submission in the <strong>{box}</strong> box."
        )
        message = f"The submitter replied on a submission in the {box_name} box."
    else:
        subject = f"New submission in the {_subject_safe(box_name)} box"
        lead = f"A new submission was received in the <strong>{box}</strong> box."
        message = f"A new submission was received in the {box_name} box."
    url = html.escape(_link(path))
    body = (
        f"<p>{lead}</p>"
        f'<p><a href="{url}">Open it in the Logbook</a> to read it.</p>'
    )
    notice = {
        "subject": subject,
        "heading": subject,
        "body_html": body,
        "message": message,
        "action_path": path,
    }
    if not reply:
        # The new-submission email is the administrator-editable template;
        # the bell and push still use the fields above.
        notice["template"] = "suggestion_submitted"
        notice["box_name"] = box_name
    return notice


def watcher_notice(box_name: str) -> Dict[str, str]:
    """For someone told of a submission who cannot read it. No link to the
    submission, because following one would only reach a refusal."""
    box = html.escape(box_name)
    subject = f"New submission in the {_subject_safe(box_name)} box"
    message = (
        f"A new submission was received in the {box_name} box. "
        "Its reviewers have been notified."
    )
    body = (
        f"<p>A new submission was received in the <strong>{box}</strong> box.</p>"
        "<p>You are notified of this box's submissions but do not review it; "
        "its reviewers have been notified and will handle it.</p>"
    )
    return {
        "subject": subject,
        "heading": subject,
        "body_html": body,
        "message": message,
        "action_path": "/suggestions",
    }


def forward_notice(box_name: str, suggestion_id: str) -> Dict[str, str]:
    """Like ``reviewer_notice``: no submission content, only a link."""
    box = html.escape(box_name)
    subject = f"A submission in the {_subject_safe(box_name)} box was forwarded to you"
    path = f"/suggestions?tab=review&id={suggestion_id}"
    url = html.escape(_link(path))
    body = (
        f"<p>A reviewer of the <strong>{box}</strong> box forwarded a submission "
        "to you for review.</p>"
        f'<p><a href="{url}">Open it in the Logbook</a> to read it.</p>'
    )
    return {
        "subject": subject,
        "heading": subject,
        "body_html": body,
        "message": (f"A reviewer of the {box_name} box forwarded a submission to you."),
        "action_path": path,
    }


def submitter_notice(
    box_name: str,
    suggestion_id: str,
    *,
    disposition: Optional[str],
    responded: bool = False,
) -> Dict[str, str]:
    """Tell a named submitter something changed. Like every notice here, it
    carries no content: a reviewer's response is read in the Logbook."""
    box = html.escape(box_name)
    if disposition:
        label = disposition.replace("_", " ")
        subject = f"Your submission to the {_subject_safe(box_name)} box was updated"
        lead = (
            f"The status of your submission to the <strong>{box}</strong> box "
            f"is now <strong>{html.escape(label)}</strong>."
        )
        message = f"The status of your submission to the {box_name} box is now {label}."
        if responded:
            lead += " A reviewer also left a response."
            message += " A reviewer also left a response."
    elif responded:
        subject = (
            f"A reviewer responded to your submission to the "
            f"{_subject_safe(box_name)} box"
        )
        lead = (
            "A reviewer responded to your submission to the "
            f"<strong>{box}</strong> box."
        )
        message = f"A reviewer responded to your submission to the {box_name} box."
    else:
        subject = f"New reply on your submission to the {_subject_safe(box_name)} box"
        lead = (
            f"A reviewer replied on your submission to the <strong>{box}</strong> box."
        )
        message = f"A reviewer replied on your submission to the {box_name} box."
    path = f"/suggestions?tab=mine&id={suggestion_id}"
    url = html.escape(_link(path))
    body = f'<p>{lead}</p><p><a href="{url}">Open it in the Logbook</a>.</p>'
    return {
        "subject": subject,
        "heading": subject,
        "body_html": body,
        "message": message,
        "action_path": path,
    }


async def send_suggestion_notice(
    organization_id: str, user_ids: List[str], notice: Dict[str, str]
) -> None:
    """Background task: deliver ``notice`` to the active members in
    ``user_ids`` — a bell entry, a web push where configured, and an email.
    Runs on its own session after the response; never raises.

    Each member gets their own email, so no recipient sees another's address.
    The email goes out whatever the member's preferences say: for a reviewer
    it is the channel of record (CLAUDE.md pitfall #18), and the bell is an
    addition, not a substitute. Email only, never SMS — nothing here warrants
    a text. ``sent_by`` is never passed: the triggering member may be
    anonymous, and nothing identifying them goes into the bell entry either.
    """
    if not user_ids:
        return
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            org = await session.get(Organization, str(organization_id))
            result = await session.execute(
                select(User).where(
                    User.id.in_(user_ids),
                    User.organization_id == str(organization_id),
                    User.is_active,
                )
            )
            users = sorted(result.scalars().all(), key=lambda u: str(u.id))
            if not users:
                return
            await _record_in_app(session, str(organization_id), users, notice)
            await _push(session, str(organization_id), users, notice)
            await _email(session, org, users, notice)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Suggestion box notification failed: {}", exc)


# A bell entry about a suggestion is a pointer, not a record; the suggestion
# itself is where the history lives.
NOTICE_EXPIRY_DAYS = 30


async def _record_in_app(
    session: AsyncSession,
    organization_id: str,
    users: Sequence[User],
    notice: Dict[str, str],
) -> None:
    from app.models.notification import NotificationChannel, NotificationLog

    expires_at = datetime.now(timezone.utc) + timedelta(days=NOTICE_EXPIRY_DAYS)
    for user in users:
        session.add(
            NotificationLog(
                organization_id=organization_id,
                recipient_id=str(user.id),
                channel=NotificationChannel.IN_APP,
                category="suggestions",
                subject=notice["subject"],
                message=notice.get("message") or notice["subject"],
                action_url=notice.get("action_path"),
                expires_at=expires_at,
                delivered=True,
            )
        )
    try:
        await session.commit()
    except Exception as exc:
        # The email below still carries the notice; a failed bell insert must
        # not take it down too.
        await session.rollback()
        logger.warning("Suggestion box in-app notification failed: {}", exc)


async def _push(
    session: AsyncSession,
    organization_id: str,
    users: Sequence[User],
    notice: Dict[str, str],
) -> None:
    try:
        from app.services.push_service import PushService

        push = PushService(session)
        if not push.is_configured():
            return
        for user in users:
            await push.send_to_user(
                organization_id=uuid.UUID(organization_id),
                user_id=uuid.UUID(str(user.id)),
                title=notice["subject"],
                body=notice.get("message") or "",
                url=notice.get("action_path") or "/notifications?tab=inbox",
                tag="suggestions",
            )
    except Exception as exc:
        logger.warning("Suggestion box web push failed: {}", exc)


async def _email(
    session: AsyncSession,
    org: Optional[Organization],
    users: Sequence[User],
    notice: Dict[str, str],
) -> None:
    from app.services.email_service import EmailService, wrap_email_body

    email_service = EmailService(organization=org)
    for user in users:
        if not user.email:
            continue
        try:
            if notice.get("template") == "suggestion_submitted":
                await email_service.send_suggestion_submitted_email(
                    to_email=user.email,
                    recipient_name=_display_name(user) or "",
                    box_name=notice["box_name"],
                    suggestion_url=_link(notice["action_path"]),
                    db=session,
                    organization_id=str(org.id) if org else None,
                )
            else:
                await email_service.send_email(
                    to_emails=[user.email],
                    subject=notice["subject"],
                    html_body=wrap_email_body(
                        org, notice["heading"], notice["body_html"]
                    ),
                    db=session,
                    template_type=EMAIL_TEMPLATE_TYPE,
                )
        except Exception as exc:
            # One bad address must not stop the rest of the reviewers hearing.
            logger.warning("Suggestion box email to a recipient failed: {}", exc)
