"""The daily email about Google Workspace accounts that need a person to act.

The Integrations page lists them (``attention_items``), but an administrator
learns of them only by opening it, and the item that matters most -- a member
who left and whose account Google still has not suspended -- is exactly the
one nobody goes looking for. This sends the overdue part of that same list to
every active member holding ``admin.access`` (the people who connect and
change the integration), at most once a day per department, and only while
something has waited longer than ``ATTENTION_OVERDUE_AFTER``.

The list is :meth:`DirectoryAccountService.attention_items`, not a
re-derivation of it (CLAUDE.md pitfall #29).
"""

import copy
import html
from datetime import date
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings as app_settings
from app.models.user import Organization, User
from app.services.directory_account_service import (
    AttentionIssue,
    AttentionItem,
    DirectoryAccountService,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService, wrap_email_body
from app.services.email_theme import ACCENT_AMBER, action
from app.utils.org_timezone import org_today

SETTINGS_KEY = "google_workspace"
LAST_DIGEST_KEY = "attention_digest_last_sent"
DIGEST_ROWS_SHOWN = 50
RECIPIENT_PERMISSION = "admin.access"


def _last_digest_day(organization: Organization) -> Optional[date]:
    stored = organization.settings if isinstance(organization.settings, dict) else {}
    section = stored.get(SETTINGS_KEY)
    raw = section.get(LAST_DIGEST_KEY) if isinstance(section, dict) else None
    if not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        # A bad value must not stop the alert for good; treat it as never sent.
        return None


def _record_digest(organization: Organization, today: date) -> None:
    # A deep copy reassigned whole: a nested mutation of a JSON column is not
    # seen by SQLAlchemy (CLAUDE.md pitfall #12).
    current = copy.deepcopy(organization.settings or {})
    section = current.get(SETTINGS_KEY)
    if not isinstance(section, dict):
        section = {}
    section[LAST_DIGEST_KEY] = today.isoformat()
    current[SETTINGS_KEY] = section
    organization.settings = current


async def _administrators(db: AsyncSession, organization_id: str) -> list[User]:
    members = (
        (
            await db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(
                    User.organization_id == organization_id,
                    User.is_active,
                    User.email.isnot(None),
                )
                .order_by(User.id)
            )
        )
        .scalars()
        .all()
    )
    return [m for m in members if user_has_permission(m, RECIPIENT_PERMISSION)]


def _body(items: list[AttentionItem]) -> str:
    base = app_settings.FRONTEND_URL.rstrip("/")
    shown = items[:DIGEST_ROWS_SHOWN]
    more = len(items) - len(shown)
    rows = "".join(
        "<li>"
        f'<a href="{html.escape(f"{base}/members/{item.user_id}")}">'
        f"{html.escape(item.member_name)}</a> ({html.escape(item.primary_email)})"
        f" &mdash; {html.escape(item.label)}"
        + (f"<br><small>{html.escape(item.detail)}</small>" if item.detail else "")
        + "</li>"
        for item in shown
    )
    departed = sum(1 for i in items if i.issue == AttentionIssue.NOT_SUSPENDED)
    lead = (
        f"<p><strong>{departed} member(s) who have left still have a working "
        "Google account.</strong> The Logbook has been retrying for over a "
        "day.</p>"
        if departed
        else ""
    )
    return (
        lead + f"<p>{len(items)} Google Workspace account(s) have been waiting over "
        "a day for something The Logbook could not finish on its own.</p>"
        f"<ul>{rows}</ul>"
        + (f"<p>…and {more} more.</p>" if more > 0 else "")
        + "<p>Each member's profile shows the reason and a <strong>Retry</strong>."
        " A suspension can also be applied directly in the Google Admin "
        "console.</p>"
        + action(html.escape(f"{base}/integrations"), "Open Integrations")
    )


async def send_google_workspace_attention_digest(
    db: AsyncSession, organization: Organization
) -> int:
    """Email this department's administrators the overdue Google Workspace
    accounts, at most once a day. Returns the number of emails sent.

    Nothing is recorded unless at least one email went out, so a department
    whose mail is failing is tried again on the next run.
    """
    org_id = str(organization.id)
    today = org_today(organization)
    if _last_digest_day(organization) == today:
        return 0
    service = DirectoryAccountService(db)
    if not await service.is_connected(org_id):
        return 0
    overdue = [i for i in await service.attention_items(org_id) if i.overdue]
    if not overdue:
        return 0
    recipients = recipients_for(
        await _administrators(db, org_id),
        EmailKind.MEMBERSHIP_ADMIN,
        department_required_kinds(organization),
    )
    if not recipients:
        return 0

    html_body = wrap_email_body(
        organization,
        "Google Workspace accounts need attention",
        _body(overdue),
        header_color=ACCENT_AMBER,
        chip="Google Workspace",
    )
    subject = f"{len(overdue)} Google Workspace account(s) need attention"
    sent_total = 0
    for member in recipients:
        try:
            # The department's own mail settings and sender, not the defaults.
            sent, _failed = await EmailService(organization).send_email(
                to_emails=[member.email],
                subject=subject,
                html_body=html_body,
                db=db,
                template_type="google_workspace_attention_digest",
            )
            sent_total += sent
        except Exception as exc:
            logger.warning(
                "Google Workspace attention digest to member {} failed: {}",
                member.id,
                type(exc).__name__,
            )
    if sent_total:
        _record_digest(organization, today)
        await db.commit()
    return sent_total
