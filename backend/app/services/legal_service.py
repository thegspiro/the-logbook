"""
Legal Document Service

Business logic behind Governance -> Legal Documents: proposing alternative
wording for the public /privacy and /terms pages, and publishing it.

Publishing writes the body into ``Organization.settings["legal"]`` because that
is what the anonymous public endpoint reads. Keeping one source for the live
text (rather than having the public page consult this table) means an
unauthenticated request still needs no join, no org resolution, and no new
failure mode on the one page a visitor can always reach.
"""

import copy
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.legal import (
    LegalDocumentRevision,
    LegalDocumentType,
    LegalRevisionStatus,
)
from app.models.user import Organization, User
from app.utils.model_updates import apply_updates

# settings["legal"] keys, per document type. The public endpoint reads these
# exact keys; changing one here without changing app/api/public/legal.py
# publishes into a key nothing serves.
SETTINGS_KEY = {
    LegalDocumentType.PRIVACY_POLICY: "privacy_policy",
    LegalDocumentType.TERMS_OF_SERVICE: "terms_of_service",
}

PUBLIC_PATH = {
    LegalDocumentType.PRIVACY_POLICY: "/privacy",
    LegalDocumentType.TERMS_OF_SERVICE: "/terms",
}


class LegalDocumentService:
    """Draft/publish workflow for the department's public legal pages."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Reads ────────────────────────────────────────────────────────────

    async def get_revision(
        self, revision_id: str, organization_id: str
    ) -> LegalDocumentRevision:
        """Fetch one revision, scoped to the caller's organization.

        Org-scoped on purpose even though every caller already passed a
        permission check: a permission is held *within* an organization and says
        nothing about which org a path id belongs to (pitfall #14b).
        """
        result = await self.db.execute(
            select(LegalDocumentRevision).where(
                LegalDocumentRevision.id == revision_id,
                LegalDocumentRevision.organization_id == organization_id,
            )
        )
        revision = result.scalar_one_or_none()
        if revision is None:
            raise ValueError("Revision not found")
        return revision

    async def list_revisions(self, organization_id: str) -> list[LegalDocumentRevision]:
        result = await self.db.execute(
            select(LegalDocumentRevision)
            .where(LegalDocumentRevision.organization_id == organization_id)
            .order_by(LegalDocumentRevision.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_user_names(self, user_ids: set[str]) -> dict[str, str]:
        """Map user id -> display name for revision attribution."""
        ids = {uid for uid in user_ids if uid}
        if not ids:
            return {}
        result = await self.db.execute(select(User).where(User.id.in_(ids)))
        return {
            str(user.id): (user.full_name or user.username) for user in result.scalars()
        }

    async def get_organization(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        return result.scalar_one_or_none()

    # ── Drafting ─────────────────────────────────────────────────────────

    async def create_draft(
        self,
        organization_id: str,
        created_by: str,
        document_type: LegalDocumentType,
        body: str,
        change_note: str,
        effective_date: Optional[str] = None,
    ) -> LegalDocumentRevision:
        revision = LegalDocumentRevision(
            organization_id=organization_id,
            document_type=document_type,
            status=LegalRevisionStatus.DRAFT,
            body=body,
            change_note=change_note,
            effective_date=effective_date,
            created_by=created_by,
        )
        self.db.add(revision)
        await self.db.flush()
        return revision

    async def update_draft(
        self,
        revision_id: str,
        organization_id: str,
        updates: dict,
    ) -> LegalDocumentRevision:
        revision = await self.get_revision(revision_id, organization_id)
        if revision.status != LegalRevisionStatus.DRAFT:
            # Editing a published revision in place would rewrite what the
            # department is on record as having published on a date.
            raise ValueError("Only drafts can be edited")
        # apply_updates rather than a `if value is not None` loop: the payload
        # is dumped with exclude_unset, so a None that reaches here is the
        # drafter clearing the effective date, not an absent field. Skipping it
        # would acknowledge the clear with a 200 and leave the old date on the
        # revision (pitfall #1). A null against body/change_note — both NOT
        # NULL — raises ValueError, which the endpoint turns into a 400.
        apply_updates(
            revision,
            updates,
            skip={"id", "organization_id", "document_type", "status"},
        )
        await self.db.flush()
        return revision

    async def delete_draft(self, revision_id: str, organization_id: str) -> None:
        revision = await self.get_revision(revision_id, organization_id)
        if revision.status != LegalRevisionStatus.DRAFT:
            raise ValueError("Only drafts can be deleted")
        await self.db.delete(revision)
        await self.db.flush()

    # ── Publishing ───────────────────────────────────────────────────────

    async def publish(
        self, revision_id: str, organization_id: str, published_by: str
    ) -> LegalDocumentRevision:
        """Make a draft the live text on its public page."""
        revision = await self.get_revision(revision_id, organization_id)
        if revision.status == LegalRevisionStatus.PUBLISHED:
            raise ValueError("This revision is already published")
        if revision.status != LegalRevisionStatus.DRAFT:
            raise ValueError("Only drafts can be published")

        organization = await self.get_organization(organization_id)
        if organization is None:
            raise ValueError("Organization not found")

        await self._archive_published(organization_id, revision.document_type)

        revision.status = LegalRevisionStatus.PUBLISHED
        revision.published_by = published_by
        revision.published_at = datetime.now(timezone.utc)

        self._write_settings(
            organization,
            revision.document_type,
            body=revision.body,
            effective_date=revision.effective_date,
        )
        await self.db.flush()
        return revision

    async def revert_to_default(
        self, organization_id: str, document_type: LegalDocumentType
    ) -> None:
        """Drop the department's custom text so the built-in default shows."""
        organization = await self.get_organization(organization_id)
        if organization is None:
            raise ValueError("Organization not found")
        await self._archive_published(organization_id, document_type)
        self._write_settings(
            organization, document_type, body=None, effective_date=None
        )
        await self.db.flush()

    async def _archive_published(
        self, organization_id: str, document_type: LegalDocumentType
    ) -> None:
        result = await self.db.execute(
            select(LegalDocumentRevision).where(
                LegalDocumentRevision.organization_id == organization_id,
                LegalDocumentRevision.document_type == document_type,
                LegalDocumentRevision.status == LegalRevisionStatus.PUBLISHED,
            )
        )
        for previous in result.scalars().all():
            previous.status = LegalRevisionStatus.ARCHIVED

    def _write_settings(
        self,
        organization: Organization,
        document_type: LegalDocumentType,
        body: Optional[str],
        effective_date: Optional[str],
    ) -> None:
        """Write (or clear) the live text in the organization's settings.

        Deep-copied rather than shallow-copied: ``settings`` is a JSON column
        whose nested dicts are shared with SQLAlchemy's committed state, so
        mutating a nested key in place and reassigning can compare equal and
        skip the UPDATE entirely (pitfall #12) — publishing would report success
        and change nothing.
        """
        settings = copy.deepcopy(organization.settings or {})
        if not isinstance(settings, dict):
            settings = {}
        legal = settings.get("legal")
        if not isinstance(legal, dict):
            legal = {}
        key = SETTINGS_KEY[document_type]
        if body is None:
            legal.pop(key, None)
        else:
            legal[key] = body
        # One date covers both documents in settings, so only touch it when the
        # revision carries one — reverting the terms must not blank the date
        # shown above a privacy notice that is still published.
        if effective_date:
            legal["last_updated"] = effective_date
        settings["legal"] = legal
        organization.settings = settings
