"""The weekly email listing folders only full administrators can open.

Decision 30 (docs/FILE_STORAGE_HARDENING.md) lists these folders on the
Documents page, but an administrator learns of them only by opening it. This
sends the same list to every active full administrator, once a week while any
folder is on it, so a folder shut by an unattended change (auto-archive, tier
advancement) does not wait for someone to happen by.

The list is :meth:`DocumentsService.admin_only_folders`, not a re-derivation of
it (CLAUDE.md pitfall #29), so the email and the page cannot disagree. Every
folder still listed is sent each week, not only new ones: the owner chose a
weekly digest of all of them over remembering which were already reported.
"""

import copy
import html
from datetime import date
from typing import Optional

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models.user import Organization
from app.services.documents_service import DocumentsService
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService, wrap_email_body
from app.services.email_theme import ACCENT_AMBER, action
from app.utils.org_timezone import org_today

DOCUMENTS_SETTINGS_KEY = "documents"
LAST_DIGEST_KEY = "admin_only_digest_last_sent"
DIGEST_MIN_GAP_DAYS = 7
DIGEST_ROWS_SHOWN = 50


def _last_digest_day(organization: Organization) -> Optional[date]:
    stored = organization.settings if isinstance(organization.settings, dict) else {}
    section = stored.get(DOCUMENTS_SETTINGS_KEY)
    raw = section.get(LAST_DIGEST_KEY) if isinstance(section, dict) else None
    if not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        # A bad value must not stop the email for good; treat it as never sent.
        return None


def _record_digest(organization: Organization, today: date) -> None:
    # A deep copy reassigned whole: a nested mutation of a JSON column is not
    # seen by SQLAlchemy (CLAUDE.md pitfall #12).
    current = copy.deepcopy(organization.settings or {})
    section = current.get(DOCUMENTS_SETTINGS_KEY)
    if not isinstance(section, dict):
        section = {}
    section[LAST_DIGEST_KEY] = today.isoformat()
    current[DOCUMENTS_SETTINGS_KEY] = section
    organization.settings = current


async def send_admin_only_folder_digest(
    db: AsyncSession, organization: Organization
) -> int:
    """Email this department's full administrators the folders only they can
    open, at most once every seven days. Returns the number of emails sent.

    Nothing is recorded unless at least one email went out, so a department
    whose mail is failing is tried again the next day rather than a week on.
    """
    org_id = str(organization.id)
    today = org_today(organization)
    last_sent = _last_digest_day(organization)
    if last_sent is not None and (today - last_sent).days < DIGEST_MIN_GAP_DAYS:
        return 0

    service = DocumentsService(db)
    administrators = await service.active_full_administrators(org_id)
    if not administrators:
        return 0
    # Any full administrator is a valid viewer: the list is the same for all.
    folders = await service.admin_only_folders(org_id, administrators[0])
    if not folders:
        return 0
    recipients = recipients_for(
        [member for member in administrators if member.email],
        EmailKind.DOCUMENT_DUTIES,
        department_required_kinds(organization),
    )
    if not recipients:
        return 0

    shown = folders[:DIGEST_ROWS_SHOWN]
    more = len(folders) - len(shown)
    rows = "".join(f"<li>{html.escape(folder.name)}</li>" for folder in shown)
    link = f"{app_settings.FRONTEND_URL.rstrip('/')}/documents"
    body = (
        f"<p>{len(folders)} document folder(s) can now be opened by full "
        "administrators only. Nobody else holds the position or permission "
        "each one requires, usually because a member changed position or "
        "left.</p>"
        f"<ul>{rows}</ul>"
        + (f"<p>…and {more} more.</p>" if more > 0 else "")
        + "<p>On the Documents page, change who can open each folder, or keep "
        "it for administrators if that is intended. A kept folder is not "
        "listed again.</p>" + action(html.escape(link), "Open Documents")
    )
    html_body = wrap_email_body(
        organization,
        "Folders only administrators can open",
        body,
        header_color=ACCENT_AMBER,
        chip="Documents",
    )

    sent_total = 0
    for member in recipients:
        try:
            sent, _failed = await EmailService().send_email(
                to_emails=[member.email],
                subject=(
                    f"{len(folders)} document folder(s) only administrators " "can open"
                ),
                html_body=html_body,
                db=db,
                template_type="documents_admin_only_digest",
            )
            sent_total += sent
        except Exception as exc:
            logger.warning(
                "Admin-only folder digest to member {} failed: {}", member.id, exc
            )
    if sent_total:
        _record_digest(organization, today)
        await db.commit()
    return sent_total
