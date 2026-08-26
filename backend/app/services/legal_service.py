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

# Effective date, per document type — deliberately *not* one shared key.
# Privacy and terms are independent documents with independent revision
# histories; a single "last_updated" (the original shape) let publishing one
# silently misdate the other, or inherit its date when published without one
# of its own. Legacy installs that only ever published one document under the
# old shared key are still read via the ``last_updated`` fallback below.
EFFECTIVE_DATE_KEY = {
    LegalDocumentType.PRIVACY_POLICY: "privacy_policy_effective_date",
    LegalDocumentType.TERMS_OF_SERVICE: "terms_of_service_effective_date",
}
LEGACY_SHARED_DATE_KEY = "last_updated"

PUBLIC_PATH = {
    LegalDocumentType.PRIVACY_POLICY: "/privacy",
    LegalDocumentType.TERMS_OF_SERVICE: "/terms",
}


def effective_date_for(legal: dict, document_type: LegalDocumentType) -> Optional[str]:
    """The effective date to display for one document's live text.

    Reads the per-type key first, falling back to the legacy shared key so an
    install that published under the old shared-date shape (pre-fix) doesn't
    lose its displayed date the moment this deploys — it will simply keep
    reading the old value until the document is republished with its own.
    """
    date = legal.get(EFFECTIVE_DATE_KEY[document_type])
    if date:
        return date
    return legal.get(LEGACY_SHARED_DATE_KEY)


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

    async def _get_organization_for_update(
        self, organization_id: str
    ) -> Optional[Organization]:
        """Lock the organization row for the duration of a publish/revert.

        Two concurrent publishes of the same document type both read the
        current published revision, archive it, and mark their own row
        published — same shape as CLAUDE.md pitfall #27 (a read-then-write
        decision needs the row locked). ``settings`` lives on the
        organization, and it is the only row that exists before a first
        publish, so it is the parent lock rather than the revision row.
        """
        result = await self.db.execute(
            select(Organization)
            .where(Organization.id == organization_id)
            .with_for_update()
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

        organization = await self._get_organization_for_update(organization_id)
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
        organization = await self._get_organization_for_update(organization_id)
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
        # A locking read, not a plain one: under InnoDB REPEATABLE READ (this
        # app's default), a plain SELECT answers from the snapshot taken at
        # the transaction's first read, which predates the organization-row
        # lock above. Only a locking read is defined to see the latest
        # committed version — the same "the count itself must be locking"
        # half of pitfall #27, applied to this read-then-archive instead of a
        # capacity count.
        result = await self.db.execute(
            select(LegalDocumentRevision)
            .where(
                LegalDocumentRevision.organization_id == organization_id,
                LegalDocumentRevision.document_type == document_type,
                LegalDocumentRevision.status == LegalRevisionStatus.PUBLISHED,
            )
            .with_for_update()
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
        date_key = EFFECTIVE_DATE_KEY[document_type]
        if body is None:
            legal.pop(key, None)
            legal.pop(date_key, None)
        else:
            legal[key] = body
            # Each document type owns its own date key — the original shared
            # "last_updated" let publishing one document silently misdate the
            # other, or inherit its date when published without one of its
            # own (DOC-10 finding #3). The date belongs to the revision, not
            # to the document type, so publishing one without an effective
            # date clears whatever date a *previous* revision of this same
            # type left behind rather than keeping it — a carried-over date
            # would misattribute the new text to an old revision's date.
            if effective_date:
                legal[date_key] = effective_date
            else:
                legal.pop(date_key, None)
            # Retire the ambiguous pre-fix shared key the moment either
            # document type publishes under the per-type scheme: once that
            # happens, ``effective_date_for``'s legacy fallback would
            # otherwise resurrect an old, disambiguated date on a *later*
            # dateless republish of either document (Codex finding). The
            # fallback exists only to bridge an upgraded install's first
            # read before anyone has published again — the first genuine
            # publish is exactly the point at which that bridge is no
            # longer needed for either document type.
            legal.pop(LEGACY_SHARED_DATE_KEY, None)
        settings["legal"] = legal
        organization.settings = settings
