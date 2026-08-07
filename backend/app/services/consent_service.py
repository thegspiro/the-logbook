"""
Member Consent Service (ISO/IEC 27701)

Self-service management of a member's optional-processing consents. The
UserConsent table holds current state; every change also lands in the
tamper-evident audit log (``consent_updated``), which is the immutable
ledger a privacy audit wants.

Consumers of a consent (photo publishing, public roster, SMS sending) must
call ``has_consent`` (or ``granted_user_ids`` for fan-out) and treat "never
asked" exactly like "refused".

**Email is deliberately not a consent-gated channel.** Consent governs the
*optional* processing above; it does not govern the department's ability to
notify a member of something that concerns them. Email is the channel of
record precisely so that suppressing SMS can never leave a member able to say
they were never told. See ``message_delivery_service``.

Enforcement status: ``SMS_NOTIFICATIONS`` is enforced at the send path.
``PHOTO_USE`` and ``PUBLIC_ROSTER_LISTING`` have **no consumer yet** — nothing
in the app publishes member photos or a public roster today. Whoever builds
those must gate them here; the consent is already being collected.
"""

from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.consent import ConsentType, UserConsent
from app.models.user import User


class ConsentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_for_user(self, user: User) -> list[dict[str, Any]]:
        """Current state of every consent type for one member.

        Types the member was never asked about are returned with
        ``granted: None`` so the UI can distinguish "not answered" from an
        explicit refusal.
        """
        result = await self.db.execute(
            select(UserConsent).where(UserConsent.user_id == user.id)
        )
        by_type = {row.consent_type: row for row in result.scalars().all()}
        items = []
        for consent_type in ConsentType:
            row = by_type.get(consent_type)
            items.append(
                {
                    "consent_type": consent_type.value,
                    "granted": row.granted if row else None,
                    "updated_at": (
                        row.updated_at.isoformat() if row and row.updated_at else None
                    ),
                }
            )
        return items

    async def set_consent(
        self, user: User, consent_type: ConsentType, granted: bool
    ) -> UserConsent:
        """Record the member's choice (upsert on the unique user+type row)."""
        result = await self.db.execute(
            select(UserConsent).where(
                UserConsent.user_id == user.id,
                UserConsent.consent_type == consent_type,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = UserConsent(
                organization_id=user.organization_id,
                user_id=user.id,
                consent_type=consent_type,
                granted=granted,
            )
            self.db.add(row)
        else:
            row.granted = granted
        await self.db.flush()
        return row

    async def has_consent(self, user_id: str, consent_type: ConsentType) -> bool:
        """Fail closed: no record means NO consent."""
        result = await self.db.execute(
            select(UserConsent.granted).where(
                UserConsent.user_id == user_id,
                UserConsent.consent_type == consent_type,
            )
        )
        granted = result.scalar_one_or_none()
        return bool(granted)

    async def granted_user_ids(
        self, user_ids: Sequence[str], consent_type: ConsentType
    ) -> set[str]:
        """The subset of *user_ids* that granted *consent_type*.

        The bulk form of ``has_consent``, for fan-out paths (a department
        message can target the whole roster, and a per-recipient query there
        would be an N+1 against the send path). Fails closed the same way:
        an id with no row is simply absent from the returned set.
        """
        if not user_ids:
            return set()
        result = await self.db.execute(
            select(UserConsent.user_id).where(
                UserConsent.user_id.in_([str(uid) for uid in user_ids]),
                UserConsent.consent_type == consent_type,
                UserConsent.granted.is_(True),
            )
        )
        return {str(row) for row in result.scalars().all()}
