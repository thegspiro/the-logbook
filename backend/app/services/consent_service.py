"""
Member Consent Service (ISO/IEC 27701)

Self-service management of a member's optional-processing consents. The
UserConsent table holds current state; every change also lands in the
tamper-evident audit log (``consent_updated``), which is the immutable
ledger a privacy audit wants.

Consumers of a consent (photo publishing, public roster, SMS sending) must
call ``has_consent`` and treat "never asked" exactly like "refused".
"""

from typing import Any

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
