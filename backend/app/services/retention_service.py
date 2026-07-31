"""
Records Retention Service (ISO 15489 / ISO/IEC 27701)

Org-configurable retention schedules for business records, with a daily
enforcement job. Each record class declares a safe default and a minimum
floor; departments override per class in organization settings
(``settings["retention"]``, days as int, or null = keep forever).

Deliberate scope decisions:
- Documents and meeting minutes are NOT auto-deleted. They are official
  records whose statutory retention varies by state; destroying them on a
  timer is a department decision that belongs in their SOPs, executed by a
  human. This service covers operational/log-class records only.
- Never-configured classes use their default; a null default means "keep
  forever until the department opts in".
- Floors exist so a typo can't wipe recent records (e.g. retention of 1
  day on form submissions).

Platform-level classes (no organization column, e.g. blocked access
attempts) are configured via environment settings, not org settings.
"""

import copy
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_template import MessageHistory
from app.models.forms import FormSubmission
from app.models.ip_security import BlockedAccessAttempt
from app.models.notification import NotificationLog
from app.models.user import Organization

_DELETE_BATCH_SIZE = 1000


@dataclass(frozen=True)
class RecordClass:
    key: str
    description: str
    model: type
    timestamp_attr: str
    default_days: int | None  # None = keep forever unless the org opts in
    min_days: int  # floor a department cannot go below


# Org-scoped record classes. Adding one here is the whole registration:
# policy API, enforcement, and settings validation all read this list.
RECORD_CLASSES: list[RecordClass] = [
    RecordClass(
        key="message_history",
        description=(
            "Delivery history of sent emails/SMS (recipients, subjects, "
            "delivery status). Default preserves the platform's original "
            "90-day cleanup."
        ),
        model=MessageHistory,
        timestamp_attr="sent_at",
        default_days=90,
        min_days=30,
    ),
    RecordClass(
        key="notification_logs",
        description=(
            "In-app/email/SMS notification delivery records. Kept forever "
            "by default; 365 days is a reasonable opt-in."
        ),
        model=NotificationLog,
        timestamp_attr="sent_at",
        default_days=None,
        min_days=30,
    ),
    RecordClass(
        key="form_submissions",
        description=(
            "Public/internal form submissions, which may hold applicant "
            "PII. Kept forever by default — configure per your records "
            "schedule. Links from prospect/event records are severed "
            "safely (SET NULL)."
        ),
        model=FormSubmission,
        timestamp_attr="submitted_at",
        default_days=None,
        min_days=90,
    ),
]


class RetentionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ----- policy management -------------------------------------------

    @staticmethod
    def _org_config(org: Organization) -> dict:
        return (org.settings or {}).get("retention", {})

    def get_policy(self, org: Organization) -> list[dict[str, Any]]:
        """Effective policy per record class for the admin UI/API."""
        config = self._org_config(org)
        items = []
        for rc in RECORD_CLASSES:
            configured = config.get(rc.key, "__unset__")
            effective = rc.default_days if configured == "__unset__" else configured
            items.append(
                {
                    "record_class": rc.key,
                    "description": rc.description,
                    "default_days": rc.default_days,
                    "min_days": rc.min_days,
                    "configured_days": (
                        None if configured == "__unset__" else configured
                    ),
                    "effective_days": effective,
                    "is_configured": configured != "__unset__",
                }
            )
        return items

    async def set_policy(
        self, org: Organization, record_class: str, days: int | None
    ) -> dict[str, Any]:
        """Set one class's retention (days, or None = keep forever)."""
        rc = next((r for r in RECORD_CLASSES if r.key == record_class), None)
        if rc is None:
            raise ValueError(f"Unknown record class: {record_class}")
        if days is not None:
            if days < rc.min_days:
                raise ValueError(
                    f"Retention for {record_class} cannot be below "
                    f"{rc.min_days} days"
                )
        # Pitfall #12: nested JSON mutation needs a deep copy, or SQLAlchemy
        # silently skips the UPDATE.
        new_settings = copy.deepcopy(org.settings or {})
        new_settings.setdefault("retention", {})[record_class] = days
        org.settings = new_settings
        await self.db.flush()
        return {"record_class": record_class, "days": days}

    # ----- enforcement ---------------------------------------------------

    async def _delete_expired(
        self, model: type, timestamp_attr: str, cutoff: datetime, org_id: str | None
    ) -> int:
        """Batch-delete expired rows (bounded batches, like the original
        message-history cleanup, to avoid long table locks)."""
        ts_col = getattr(model, timestamp_attr)
        deleted = 0
        while True:
            query = select(model.id).where(ts_col < cutoff).limit(_DELETE_BATCH_SIZE)
            if org_id is not None:
                query = query.where(model.organization_id == org_id)
            ids = (await self.db.execute(query)).scalars().all()
            if not ids:
                break
            await self.db.execute(delete(model).where(model.id.in_(ids)))
            await self.db.flush()
            deleted += len(ids)
            if len(ids) < _DELETE_BATCH_SIZE:
                break
        return deleted

    async def enforce(self, only_class: str | None = None) -> dict[str, Any]:
        """Apply every org's retention policy plus platform-level classes.

        ``only_class`` restricts the run to one record class — used by the
        legacy message_history_cleanup task so it honors per-org config
        instead of its original hardcoded 90 days.
        """
        now = datetime.now(UTC)
        results: dict[str, Any] = {"orgs_processed": 0, "deleted": {}}

        orgs = (await self.db.execute(select(Organization))).scalars().all()
        for org in orgs:
            config = self._org_config(org)
            for rc in RECORD_CLASSES:
                if only_class is not None and rc.key != only_class:
                    continue
                days = config.get(rc.key, rc.default_days)
                if days is None:
                    continue
                # Defense in depth: a floor also applies at enforcement
                # time, in case settings were edited outside the API.
                days = max(int(days), rc.min_days)
                deleted = await self._delete_expired(
                    rc.model,
                    rc.timestamp_attr,
                    now - timedelta(days=days),
                    org.id,
                )
                if deleted:
                    key = f"{org.id}:{rc.key}"
                    results["deleted"][key] = deleted
            results["orgs_processed"] += 1

        # Platform-level: blocked access attempts carry IP/user-agent PII
        # and have no org column. Env-configured, 0/None disables.
        platform_days = (
            settings.RETENTION_BLOCKED_ATTEMPTS_DAYS if only_class is None else 0
        )
        if platform_days:
            deleted = await self._delete_expired(
                BlockedAccessAttempt,
                "blocked_at",
                now - timedelta(days=max(int(platform_days), 30)),
                None,
            )
            if deleted:
                results["deleted"]["platform:blocked_access_attempts"] = deleted

        total = sum(results["deleted"].values())
        if total:
            logger.info(
                f"Retention enforcement deleted {total} expired records "
                f"across {len(results['deleted'])} class instances"
            )
        return results
