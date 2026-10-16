"""Signing adopted minutes.

A signature is a member attesting, in the app, that a particular adopted
version is a true record. It is deliberately more than a click: the signer must
type their name as it stands on their account and confirm their password, which
ties the act to a logged-in person who is at the keyboard now, not a session
someone walked away from.

Who may sign a slot is the department's rule (``minutes.signature_slots``): a
slot names a position, and a member holding it may sign; a slot with none is
signed by anyone who manages minutes. Nothing forbids the person who circulated
or adopted the minutes from signing, since signing is a separate attestation
from adopting.

A signature belongs to the revision current when it was given and records that
revision's hash. Minutes reopened for a correction supersede the revision, so
the signatures stay on file against the text they were given for and the
corrected version starts unsigned.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import permission_matches
from app.core.security import verify_password
from app.models.minute import (
    MeetingMinutes,
    MinutesRevision,
    MinutesSignature,
    MinutesStatus,
)
from app.models.user import User
from app.services.minute_service import MinuteService
from app.services.minutes_record_service import MinutesRecordService
from app.utils.minutes_settings import SignatureSlot, load_signature_slots

MAX_NAME_LENGTH = 200


def _squash(value: str) -> str:
    return " ".join(value.lower().split())


def accepted_names(user: User) -> set[str]:
    """The names a signer may type: the legal name of record, or the name the
    member is known by. Compared without regard to case or spacing."""
    return {
        _squash(name)
        for name in (user.full_name, user.display_name)
        if name and name.strip()
    }


def can_sign(user: User, slot: SignatureSlot) -> bool:
    """Whether *user* holds what the slot asks of its signer."""
    if slot.position_slug:
        return any(
            getattr(role, "slug", None) == slot.position_slug
            for role in (user.roles or [])
        )
    granted: set[str] = set()
    for role in user.roles or []:
        granted.update(role.permissions or [])
    return permission_matches("minutes.manage", granted)


class MinutesSignatureService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _current_revision(self, minutes_id: str) -> Optional[MinutesRevision]:
        return (
            await self.db.execute(
                select(MinutesRevision)
                .where(
                    MinutesRevision.minutes_id == str(minutes_id),
                    MinutesRevision.superseded_at.is_(None),
                )
                .order_by(MinutesRevision.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def status(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        user: User,
        restricted: bool,
    ) -> Optional[Dict[str, Any]]:
        """Every slot with its signature, if any, for the current version.

        ``None`` when the minutes are not visible to the caller. Minutes that
        are not adopted have no version to sign, so they report no slots to
        sign and ``version`` of ``None``.
        """
        minutes = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        slots = await load_signature_slots(self.db, str(organization_id))
        revision = (
            await self._current_revision(minutes.id)
            if minutes.status == MinutesStatus.APPROVED.value
            else None
        )
        signatures: Dict[str, MinutesSignature] = {}
        if revision is not None:
            rows = (
                (
                    await self.db.execute(
                        select(MinutesSignature).where(
                            MinutesSignature.revision_id == revision.id,
                            MinutesSignature.organization_id == str(organization_id),
                        )
                    )
                )
                .scalars()
                .all()
            )
            signatures = {row.slot_key: row for row in rows}

        return {
            "version": revision.version if revision else None,
            "slots": [
                {
                    "key": slot.key,
                    "title": slot.title,
                    "position_slug": slot.position_slug,
                    "can_sign": (
                        revision is not None
                        and slot.key not in signatures
                        and can_sign(user, slot)
                    ),
                    "signature": (
                        self._describe(signatures[slot.key], revision)
                        if revision and slot.key in signatures
                        else None
                    ),
                }
                for slot in slots
            ],
        }

    @staticmethod
    def _describe(signature: MinutesSignature, revision: MinutesRevision) -> dict:
        return {
            "id": signature.id,
            "slot_key": signature.slot_key,
            "slot_title": signature.slot_title,
            "signed_name": signature.signed_name,
            "signed_at": signature.signed_at,
            "intact": signature.content_hash == revision.content_hash,
        }

    async def for_revision(
        self, minutes_id: str, organization_id: UUID | str
    ) -> List[MinutesSignature]:
        """The signatures on the current version, in the order of the slots."""
        revision = await self._current_revision(minutes_id)
        if revision is None:
            return []
        rows = (
            (
                await self.db.execute(
                    select(MinutesSignature).where(
                        MinutesSignature.revision_id == revision.id,
                        MinutesSignature.organization_id == str(organization_id),
                    )
                )
            )
            .scalars()
            .all()
        )
        order = {
            slot.key: i
            for i, slot in enumerate(
                await load_signature_slots(self.db, str(organization_id))
            )
        }
        return sorted(
            rows, key=lambda s: (order.get(s.slot_key, len(order)), s.signed_at)
        )

    async def sign(
        self,
        minutes_id: str,
        organization_id: UUID | str,
        user: User,
        slot_key: str,
        signed_name: str,
        password: str,
        restricted: bool,
    ) -> Optional[MinutesSignature]:
        """Record *user*'s signature on a slot of the current adopted version.

        ``None`` when the minutes are not visible. ``ValueError`` for anything
        the signer can fix or must be told: not adopted, no such slot, not their
        slot to sign, already signed, a name that is not theirs, a wrong
        password.
        """
        # Locked first: two people signing at once, or the same person twice,
        # must see each other.
        if (
            await MinutesRecordService(self.db).lock_minutes(
                minutes_id, organization_id
            )
            is None
        ):
            return None
        minutes: Optional[MeetingMinutes] = await MinuteService(self.db).get_minutes(
            minutes_id, organization_id, restricted=restricted, load_children=False
        )
        if minutes is None:
            return None
        if minutes.status != MinutesStatus.APPROVED.value:
            raise ValueError("Minutes can only be signed once they are adopted")
        revision = await self._current_revision(minutes.id)
        if revision is None:
            raise ValueError("These minutes have no adopted version to sign")

        slots = await load_signature_slots(self.db, str(organization_id))
        slot = next((s for s in slots if s.key == slot_key), None)
        if slot is None:
            raise ValueError("That is not a signature these minutes ask for")
        if not can_sign(user, slot):
            raise ValueError(f"You do not hold the role that signs as {slot.title}")

        taken = (
            await self.db.execute(
                select(MinutesSignature.id).where(
                    MinutesSignature.revision_id == revision.id,
                    MinutesSignature.slot_key == slot.key,
                )
            )
        ).first()
        if taken is not None:
            raise ValueError(f"These minutes are already signed as {slot.title}")

        typed = signed_name.strip()
        if not typed or _squash(typed) not in accepted_names(user):
            raise ValueError("Type your name as it appears on your account")
        if not user.password_hash:
            raise ValueError(
                "Your account has no password to confirm with; set one in My "
                "Account before signing"
            )
        matches, _ = verify_password(password, user.password_hash)
        if not matches:
            raise ValueError("Your password is incorrect")

        signature = MinutesSignature(
            minutes_id=minutes.id,
            revision_id=revision.id,
            organization_id=str(organization_id),
            slot_key=slot.key,
            slot_title=slot.title,
            signer_id=str(user.id),
            signed_name=typed[:MAX_NAME_LENGTH],
            signed_at=datetime.now(timezone.utc).replace(microsecond=0),
            content_hash=revision.content_hash,
        )
        self.db.add(signature)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            logger.info("Signature for {} raced another: {}", slot.key, exc)
            raise ValueError(f"These minutes are already signed as {slot.title}")
        await self.db.commit()
        return signature
