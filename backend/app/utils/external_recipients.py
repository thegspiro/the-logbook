"""
External-recipient audit logging.

Owner decision (2026-08-09): report/notification emails may be sent to any
address the sender types — including addresses outside the department — but every
send to a **non-member** recipient must leave an audit trail, because those emails
carry member/compliance data to someone the platform doesn't otherwise know. This
module centralizes the "which of these addresses aren't org members?" test and the
audit write so both the compliance-report path and the scheduled-email path record
external sends identically.
"""

from typing import List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.user import User


def _norm(email: Optional[str]) -> str:
    return (email or "").strip().lower()


async def _member_emails(db: AsyncSession, organization_id: str) -> set[str]:
    """Every address that belongs to a member of the org (work + personal)."""
    result = await db.execute(
        select(User.email, User.personal_email).where(
            User.organization_id == organization_id
        )
    )
    addresses: set[str] = set()
    for work, personal in result.all():
        if work:
            addresses.add(_norm(work))
        if personal:
            addresses.add(_norm(personal))
    addresses.discard("")
    return addresses


async def external_recipients(
    db: AsyncSession, organization_id: str, recipients: List[str]
) -> List[str]:
    """Return the subset of ``recipients`` that are not org members.

    Comparison is case-insensitive on the trimmed address. Blank entries are
    ignored. The returned list preserves the original casing of the input.
    """
    if not recipients:
        return []
    members = await _member_emails(db, organization_id)
    seen: set[str] = set()
    external: List[str] = []
    for addr in recipients:
        norm = _norm(addr)
        if not norm or norm in members or norm in seen:
            continue
        seen.add(norm)
        external.append(addr)
    return external


async def audit_external_recipients(
    db: AsyncSession,
    *,
    organization_id: str,
    recipients: List[str],
    context: str,
    user_id: Optional[str] = None,
) -> List[str]:
    """Audit-log a send to any recipient outside the org's membership.

    Records one audit event listing every external address so a reviewer can see
    when member/compliance data left the department. Returns the external subset
    (empty when every recipient is a member) for the caller's own use/logging.

    Never raises: a failure to classify or log must not block the underlying send
    (the audit layer already isolates its own write in a savepoint).
    """
    try:
        external = await external_recipients(db, organization_id, recipients)
        if not external:
            return []
        await log_audit_event(
            db=db,
            event_type="external_recipient_send",
            event_category="data_access",
            severity="warning",
            event_data={
                "context": context,
                "external_recipients": external,
                "external_count": len(external),
                "total_recipients": len(recipients),
            },
            user_id=user_id,
            organization_id=organization_id,
        )
        return external
    except Exception as e:  # pragma: no cover - audit must never break a send
        logger.error(f"Failed to audit external recipients ({context}): {e}")
        return []
