"""
Legal Document Models

Revisions of the department's public privacy notice and terms of service
(the /privacy and /terms pages).

The published text itself lives where the anonymous public endpoint can reach
it without a join — ``Organization.settings["legal"]`` — and these rows are the
governance record around it: who proposed which wording, what local rule they
were addressing, who published it, and what the page said before. Without that
record a department can see its current notice but cannot answer the question a
records request actually asks, which is what the notice said on a given date.
"""

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class LegalDocumentType(str, enum.Enum):
    """Which public page a revision belongs to."""

    PRIVACY_POLICY = "privacy_policy"
    TERMS_OF_SERVICE = "terms_of_service"


class LegalRevisionStatus(str, enum.Enum):
    """Lifecycle of a revision.

    ``DRAFT`` is a proposal and is not public. ``PUBLISHED`` is what /privacy or
    /terms currently serves — at most one per document type per organization.
    ``ARCHIVED`` is a revision that was published and has since been replaced,
    or a draft that was superseded; archived rows are kept, never deleted, so
    the history of what members were shown stays intact. A revert row
    (``reverts_to_default``) is born ``ARCHIVED``: it is a history entry, never
    a draft and never the live text.
    """

    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class LegalDocumentRevision(Base):
    """A proposed or published version of one public legal document."""

    __tablename__ = "legal_document_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    document_type: Mapped[LegalDocumentType] = mapped_column(
        Enum(LegalDocumentType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    status: Mapped[LegalRevisionStatus] = mapped_column(
        Enum(LegalRevisionStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=LegalRevisionStatus.DRAFT,
        server_default="draft",
    )

    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Why this wording: the bylaw, SOP, statute, or counsel note behind it. The
    # whole point of proposing rather than editing in place is that somebody
    # later can see the reason, so this is required at the schema layer.
    change_note: Mapped[str] = mapped_column(Text, nullable=False)
    # Shown to the public as "Last updated"; free text because departments date
    # their policies however their records officer does ("March 3, 2026",
    # "FY26-Q1"), and this is displayed, never parsed.
    effective_date: Mapped[Optional[str]] = mapped_column(String(64))

    # SET NULL keeps the revision readable after a member is removed — the
    # wording published on a date is a department record and outlives the
    # account that drafted it. Both columns are nullable to match (pitfall #2).
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Owner decision W54-3 (2026-11-01): restoring the built-in text is part of
    # the visible history, not only the audit log. It is recorded as a row of
    # its own — empty body, ``published_by``/``published_at`` saying who
    # restored it and when — because a revert can follow text that has no row
    # here at all (configured in settings before this screen existed). Without
    # it the history reads "Replaced" and stops, and cannot say what members
    # saw on a date after the revert.
    reverts_to_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    # Owner decision W54-4 (2026-11-01): a publisher may edit anyone's draft,
    # and the proposer stays the proposer — so an edit by somebody else is
    # named separately. Only an edit by someone other than ``created_by`` sets
    # these; the proposer revising their own wording is not an attribution
    # question. The latest such edit wins; every edit is in the audit log.
    edited_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index(
            "ix_legal_revisions_org_type_status",
            "organization_id",
            "document_type",
            "status",
        ),
    )
