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
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.config import settings
from app.models.email_template import MessageHistory
from app.models.error_log import ErrorLog
from app.models.event import EventExternalAttendee
from app.models.forms import FormSubmission
from app.models.ip_security import BlockedAccessAttempt
from app.models.notification import NotificationLog
from app.models.skills_testing import SkillTest
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
    # Narrows the sweep to a subset of the table, for classes that share a
    # table with records this service must never touch. Receives the model and
    # returns a SQLAlchemy criterion ANDed onto the expiry query. None sweeps
    # every row, which is what a dedicated table wants.
    row_filter: Callable[[type], Any] | None = None


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
        key="error_logs",
        description=(
            "Application error reports shown on the Error Monitoring page. "
            "Every failed request and uncaught exception writes one, so this "
            "is the fastest-growing operational table in the platform — it "
            "defaults to 180 days rather than forever. Errors are a "
            "troubleshooting aid, not a business record."
        ),
        model=ErrorLog,
        timestamp_attr="created_at",
        default_days=180,
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
    RecordClass(
        key="guest_check_ins",
        description=(
            "External (non-member) event attendees — guest check-in and "
            "public outreach sign-in rows holding name/email/phone submitted "
            "by the public. Kept forever by default, like form submissions — "
            "configure per your records schedule. A prospective-member record "
            "opened from a check-in lives in the recruitment pipeline and is "
            "never touched by this sweep."
        ),
        model=EventExternalAttendee,
        timestamp_attr="created_at",
        default_days=None,
        min_days=90,
    ),
    RecordClass(
        key="practice_skill_tests",
        description=(
            "Practice skills-test attempts — drill runs a member and a peer "
            "examiner keep for their own review. They are never recorded "
            "against the member, never counted in statistics, and never feed "
            "the training pipeline, so they expire on a timer (1 year) rather "
            "than being kept as records. Official results share this table and "
            "are never swept: they are evaluation records, removable only by "
            "voiding, which preserves the row."
        ),
        model=SkillTest,
        timestamp_attr="created_at",
        default_days=365,
        min_days=30,
        row_filter=lambda m: m.is_practice.is_(True),
    ),
]


class RetentionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ----- policy management -------------------------------------------

    @staticmethod
    def _org_config(org: Organization) -> dict:
        org_settings = org.settings if isinstance(org.settings, dict) else {}
        config = org_settings.get("retention", {})
        return config if isinstance(config, dict) else {}

    @staticmethod
    def _effective_days(config: dict, rc: RecordClass) -> int | None:
        """Return a safe retention period even for legacy/untyped JSON."""
        configured = config.get(rc.key, rc.default_days)
        if configured is None:
            return None
        try:
            return max(int(configured), rc.min_days)
        except (TypeError, ValueError):
            logger.warning(
                "Ignoring invalid retention setting for record class {}",
                rc.key,
            )
            return rc.default_days

    def get_policy(self, org: Organization) -> list[dict[str, Any]]:
        """Effective policy per record class for the admin UI/API."""
        config = self._org_config(org)
        items = []
        for rc in RECORD_CLASSES:
            configured = config.get(rc.key, "__unset__")
            items.append(
                {
                    "record_class": rc.key,
                    "description": rc.description,
                    "default_days": rc.default_days,
                    "min_days": rc.min_days,
                    "configured_days": (
                        None if configured == "__unset__" else configured
                    ),
                    # Resolve through the same helper enforcement uses, so
                    # the API reports the duration actually applied — a
                    # malformed stored value falls back to the default and a
                    # below-floor value is floored, exactly as in enforce().
                    "effective_days": self._effective_days(config, rc),
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
        self,
        model: type,
        timestamp_attr: str,
        cutoff: datetime,
        org_id: str | None,
        row_filter: Callable[[type], Any] | None = None,
    ) -> int:
        """Batch-delete expired rows (bounded batches, like the original
        message-history cleanup, to avoid long table locks)."""
        ts_col = getattr(model, timestamp_attr)
        deleted = 0
        while True:
            query = select(model.id).where(ts_col < cutoff).limit(_DELETE_BATCH_SIZE)
            if org_id is not None:
                query = query.where(model.organization_id == org_id)
            if row_filter is not None:
                query = query.where(row_filter(model))
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
        results: dict[str, Any] = {"orgs_processed": 0, "deleted": {}, "errors": []}

        # Deliberately not filtered on Organization.active: retention exists
        # to keep PII-bearing operational records from piling up
        # indefinitely, and a decommissioned department's stale records are
        # the case this most needs to run against, not an exception to it.
        #
        # Snapshot id + config into plain values *before* the loop, rather
        # than reading org.id/org.settings from the ORM object inside it.
        # await self.db.rollback() expires every persistent object in the
        # session, not just the failed org's — so once any org's rollback
        # fires, every later org's pre-fetched Organization row is expired,
        # and touching one of its attributes (org.settings, even org.id)
        # triggers an implicit reload that AsyncSession cannot do outside
        # the greenlet bridge, raising MissingGreenlet and aborting every
        # remaining org (Codex review, PR #1915).
        orgs = (await self.db.execute(select(Organization))).scalars().all()
        org_snapshots = [(str(org.id), self._org_config(org)) for org in orgs]

        for org_id, config in org_snapshots:
            try:
                org_deleted: dict[str, int] = {}
                for rc in RECORD_CLASSES:
                    if only_class is not None and rc.key != only_class:
                        continue
                    days = self._effective_days(config, rc)
                    if days is None:
                        continue
                    # Defense in depth: a floor also applies at enforcement
                    # time, in case settings were edited outside the API.
                    deleted = await self._delete_expired(
                        rc.model,
                        rc.timestamp_attr,
                        now - timedelta(days=days),
                        org_id,
                        rc.row_filter,
                    )
                    if deleted:
                        org_deleted[rc.key] = deleted
                if org_deleted:
                    results["deleted"].update(
                        {f"{org_id}:{k}": v for k, v in org_deleted.items()}
                    )
                    await log_audit_event(
                        db=self.db,
                        event_type="retention_enforcement",
                        event_category="security",
                        severity="info",
                        event_data={"deleted": org_deleted},
                        organization_id=org_id,
                    )
                # Commit this org's deletions (and its audit event, via the
                # nested savepoint log_audit_event uses) before moving to the
                # next. Orgs share one session with no per-org isolation
                # here — unlike every multi-org loop elsewhere in the
                # scheduled-tasks file — so one org's failed delete/flush
                # would otherwise poison the session for every org after it
                # (CRON2-31-7), and a failure anywhere in the run would
                # discard every earlier org's deletions when the outer
                # caller's eventual rollback fires. orgs_processed/errors are
                # only recorded after commit succeeds, so a rolled-back org
                # is never reported as processed or its deletions as real.
                await self.db.commit()
                results["orgs_processed"] += 1
            except Exception as e:
                logger.error(f"Retention enforcement failed for org {org_id}: {e}")
                results["errors"].append({"org_id": org_id, "error": str(e)})
                for key in list(results["deleted"]):
                    if key.startswith(f"{org_id}:"):
                        del results["deleted"][key]
                try:
                    await self.db.rollback()
                except Exception:
                    pass

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
