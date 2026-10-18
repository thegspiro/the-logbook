"""Publishing minutes: the library copy, and the public copy beside it.

Publishing files the library copy (``DocumentService.publish_minutes``) and, if
the department's settings allow it for this kind of meeting, posts a public copy
as well. Both are replaced in place when the minutes are published again, with
a note of the version they replaced.

The public copy is a snapshot built from the printed copy's data and narrowed by
``app/utils/minutes_public.py``. The settings are checked twice, on purpose: when
posting, and again every time the public page is read, so switching public
posting off takes the page down at once instead of leaving earlier copies up.

If posting the public copy fails after the library copy was filed, the library
copy stays; publishing again repeats both and is safe to repeat.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.models.minute import (
    MeetingMinutes,
    MinutesMeetingType,
    MinutesPublicCopy,
)
from app.models.user import User
from app.services.document_service import DocumentService
from app.services.minutes_print_data import build_print_data
from app.utils.minutes_public import narrow_for_public
from app.utils.minutes_settings import (
    MinutesPublishingSettings,
    load_minutes_publishing_settings,
)

# Most items one page of the public list returns.
PUBLIC_LIST_LIMIT = 200


def is_executive(minutes_or_type: Any) -> bool:
    value = getattr(minutes_or_type, "meeting_type", minutes_or_type)
    value = getattr(value, "value", value)
    return bool(value == MinutesMeetingType.EXECUTIVE.value)


@dataclass
class PublishOutcome:
    document: Document
    public_copy: Optional[MinutesPublicCopy]
    # Whether the department's settings let this meeting be posted publicly,
    # so the screen can say "posted" or "not posted, and here is why".
    public_allowed: bool


class MinutesPublishingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ----------------------------------------------------------------
    # Publishing
    # ----------------------------------------------------------------

    async def publish(
        self, minutes: MeetingMinutes, organization_id: UUID | str, user: User
    ) -> PublishOutcome:
        """File the library copy and, where allowed, post the public copy."""
        settings = await load_minutes_publishing_settings(self.db, str(organization_id))
        executive = is_executive(minutes)
        if not settings.library_allowed(executive):
            raise ValueError(
                "Executive-session minutes can only be published when the "
                "department allows it under Minutes → Publishing"
            )

        documents = DocumentService(self.db)
        document = await documents.publish_minutes(
            minutes, organization_id, user.id, allow_executive=executive
        )

        copy: Optional[MinutesPublicCopy] = None
        allowed = settings.public_allowed(executive)
        if allowed:
            version = await documents._current_revision_version(
                minutes.id, organization_id
            )
            copy = await self._post_public(minutes, organization_id, user, version)
        return PublishOutcome(
            document=document, public_copy=copy, public_allowed=allowed
        )

    async def _post_public(
        self,
        minutes: MeetingMinutes,
        organization_id: UUID | str,
        user: User,
        version: Optional[int],
    ) -> MinutesPublicCopy:
        # restricted=False: the publisher manages minutes, and an executive set
        # only reaches here when the department switched all three settings on.
        printed = await build_print_data(
            self.db, minutes, organization_id, restricted=False
        )
        content = narrow_for_public(printed.data)
        now = datetime.now(timezone.utc)
        meeting_type = (
            minutes.meeting_type
            if isinstance(minutes.meeting_type, str)
            else minutes.meeting_type.value
        )

        copy = await self._copy_for(minutes.id, organization_id)
        if copy is None:
            copy = MinutesPublicCopy(
                organization_id=str(organization_id),
                minutes_id=str(minutes.id),
                posted_at=now,
            )
            self.db.add(copy)
        elif copy.withdrawn_at is None:
            # Replacing a copy the public could see: say what it replaced.
            copy.replaced_version = copy.revision_version
            copy.replaced_posted_at = copy.posted_at
        else:
            # Posting again after a withdrawal is a fresh posting, not a
            # replacement: nothing public was standing to be replaced.
            copy.replaced_version = None
            copy.replaced_posted_at = None

        copy.title = (minutes.title or "")[:255]
        copy.meeting_type = meeting_type
        copy.meeting_date = minutes.meeting_date
        copy.content = content
        copy.revision_version = version
        copy.posted_at = now
        copy.posted_by = str(user.id)
        copy.under_correction_since = None
        copy.withdrawn_at = None
        copy.withdrawn_by = None
        await self.db.commit()
        await self.db.refresh(copy)
        logger.info(
            "Minutes posted publicly | minutes={} version={} by={}",
            minutes.id,
            version,
            user.id,
        )
        return copy

    # ----------------------------------------------------------------
    # Taking it down, and flagging a correction
    # ----------------------------------------------------------------

    async def withdraw(
        self, minutes_id: str, organization_id: UUID | str, user: User
    ) -> Optional[MinutesPublicCopy]:
        """Stop serving the public copy. ``None`` if there is none to withdraw."""
        copy = await self._copy_for(minutes_id, organization_id)
        if copy is None or copy.withdrawn_at is not None:
            return None
        copy.withdrawn_at = datetime.now(timezone.utc)
        copy.withdrawn_by = str(user.id)
        await self.db.commit()
        await self.db.refresh(copy)
        logger.info(
            "Minutes public copy withdrawn | minutes={} by={}", minutes_id, user.id
        )
        return copy

    async def mark_under_correction(
        self, minutes_id: str, organization_id: UUID | str
    ) -> None:
        """Flag a standing public copy because its minutes were reopened.

        The page keeps showing the copy, marked as being corrected, until the
        corrected version replaces it: the same rule the library copy follows.
        Does not commit; the reopen's own commit carries it.
        """
        copy = await self._copy_for(minutes_id, organization_id)
        if copy is not None and copy.withdrawn_at is None:
            copy.under_correction_since = datetime.now(timezone.utc)

    async def status(
        self, minutes: MeetingMinutes, organization_id: UUID | str
    ) -> Dict[str, Any]:
        """Where these minutes stand: library, public, and what settings allow."""
        settings = await load_minutes_publishing_settings(self.db, str(organization_id))
        executive = is_executive(minutes)
        copy = await self._copy_for(minutes.id, organization_id)
        return {
            "library_allowed": settings.library_allowed(executive),
            "library_published": bool(minutes.published_document_id),
            "library_version": minutes.published_revision_version,
            "library_published_at": minutes.published_at,
            "public_allowed": settings.public_allowed(executive),
            "public_posted": bool(copy and copy.withdrawn_at is None),
            "public_withdrawn": bool(copy and copy.withdrawn_at is not None),
            "public_version": copy.revision_version if copy else None,
            "public_posted_at": copy.posted_at if copy else None,
            "public_replaced_version": copy.replaced_version if copy else None,
            "public_under_correction": bool(
                copy
                and copy.withdrawn_at is None
                and copy.under_correction_since is not None
            ),
            "public_copy_id": copy.id if copy else None,
        }

    async def _copy_for(
        self, minutes_id: str, organization_id: UUID | str
    ) -> Optional[MinutesPublicCopy]:
        return (
            await self.db.execute(
                select(MinutesPublicCopy).where(
                    MinutesPublicCopy.minutes_id == str(minutes_id),
                    MinutesPublicCopy.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()

    # ----------------------------------------------------------------
    # What the public page reads
    # ----------------------------------------------------------------

    @staticmethod
    def _servable(copy: MinutesPublicCopy, settings: MinutesPublishingSettings) -> bool:
        """Whether a copy may be shown right now, whatever it was when posted."""
        return copy.withdrawn_at is None and settings.public_allowed(
            is_executive(copy.meeting_type)
        )

    async def list_public(
        self, organization_id: UUID | str, skip: int = 0, limit: int = 50
    ) -> Tuple[List[MinutesPublicCopy], int]:
        settings = await load_minutes_publishing_settings(self.db, str(organization_id))
        if not settings.public_posting:
            return [], 0
        rows = (
            (
                await self.db.execute(
                    select(MinutesPublicCopy)
                    .where(
                        MinutesPublicCopy.organization_id == str(organization_id),
                        MinutesPublicCopy.withdrawn_at.is_(None),
                    )
                    .order_by(
                        MinutesPublicCopy.meeting_date.desc(),
                        MinutesPublicCopy.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        # Filtered here rather than in SQL: the executive rule is a function of
        # three settings, and the set is one department's published minutes.
        servable = [r for r in rows if self._servable(r, settings)]
        window = max(1, min(int(limit), PUBLIC_LIST_LIMIT))
        start = max(0, int(skip))
        return servable[start : start + window], len(servable)

    async def get_public(
        self, organization_id: UUID | str, copy_id: str
    ) -> Optional[MinutesPublicCopy]:
        settings = await load_minutes_publishing_settings(self.db, str(organization_id))
        copy = (
            await self.db.execute(
                select(MinutesPublicCopy).where(
                    MinutesPublicCopy.id == str(copy_id),
                    MinutesPublicCopy.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if copy is None or not self._servable(copy, settings):
            return None
        return copy
