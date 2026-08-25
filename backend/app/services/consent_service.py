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
``PHOTO_USE`` is surfaced to staff by ``roster`` (the PIO's photo-use page)
but is not yet *enforced* anywhere, because nothing in the app publishes
member photos on its own — the department's own publishing happens outside
it, so the roster is the enforcement point until that changes.
``PUBLIC_ROSTER_LISTING`` has **no consumer yet**. Whoever builds either must
gate it here; the consent is already being collected.
"""

from typing import Any, Sequence

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.consent import ConsentType, UserConsent
from app.models.user import User, UserStatus


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

    async def roster(
        self,
        organization_id: str,
        consent_type: ConsentType,
        include_inactive: bool = False,
    ) -> dict[str, Any]:
        """Every member's standing on one consent, for the staff who act on it.

        A consent nobody can see is a consent nobody can honour: the PIO
        choosing photos for a newsletter needs the whole roster in one view,
        not a per-member lookup they have to remember to do. Members with no
        row are reported as ``not_answered`` and counted separately from an
        explicit ``declined`` — the two are identical in effect (both mean
        "do not use") but not in remedy, since one of them is a member who
        can still be asked.
        """
        conditions = [
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
        ]
        if not include_inactive:
            conditions.append(User.status == UserStatus.ACTIVE)

        result = await self.db.execute(
            select(
                User.id,
                User.first_name,
                User.last_name,
                User.email,
                User.photo_url,
                User.rank,
                User.station,
                User.membership_number,
                User.status,
                UserConsent.granted,
                UserConsent.updated_at,
            )
            .outerjoin(
                UserConsent,
                and_(
                    UserConsent.user_id == User.id,
                    UserConsent.consent_type == consent_type,
                    # Redundant against the org filter on User, kept so the
                    # join can never pull a row from another tenant.
                    UserConsent.organization_id == organization_id,
                ),
            )
            .where(*conditions)
            .order_by(User.last_name, User.first_name)
        )

        members: list[dict[str, Any]] = []
        summary = {"granted": 0, "declined": 0, "not_answered": 0}
        for row in result.all():
            if row.granted is None:
                status = "not_answered"
            elif row.granted:
                status = "granted"
            else:
                status = "declined"
            summary[status] += 1
            members.append(
                {
                    "user_id": str(row.id),
                    "first_name": row.first_name,
                    "last_name": row.last_name,
                    "email": row.email,
                    "photo_url": row.photo_url,
                    "rank": row.rank,
                    "station": row.station,
                    "membership_number": row.membership_number,
                    "member_status": (
                        row.status.value if hasattr(row.status, "value") else row.status
                    ),
                    "status": status,
                    "granted": row.granted,
                    "decided_at": (
                        row.updated_at.isoformat() if row.updated_at else None
                    ),
                }
            )

        return {
            "consent_type": consent_type.value,
            "summary": {**summary, "total": len(members)},
            "members": members,
        }

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
