"""
Suggestion Box Models

A department runs any number of suggestion boxes — a training-ideas box, a
complaints box, a president's ideas box — each with its own reviewers,
anonymity rule and follow-up setting.

**Anonymity is structural, not presentational.** An anonymous submission is
stored with no reference to its author anywhere: ``submitted_by`` is NULL, no
audit entry is written, uploaded screenshots are re-encoded (which drops EXIF
and the original filename), and every timestamp on the anonymous side is
truncated to the day so it cannot be lined up against session activity. An
anonymous submitter who wants follow-up holds a random key; only its SHA-256
digest is stored, so the row cannot be walked back to a member either.
``SuggestionService`` is where those guarantees are enforced — change them
there, not here.
"""

import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class SuggestionAnonymityMode(str, enum.Enum):
    """Whether a box accepts, requires or refuses anonymous submissions."""

    ALLOWED = "allowed"
    REQUIRED = "required"
    DISABLED = "disabled"


class SuggestionDisposition(str, enum.Enum):
    NEW = "new"
    UNDER_REVIEW = "under_review"
    ACCEPTED = "accepted"
    IMPLEMENTED = "implemented"
    DECLINED = "declined"
    DUPLICATE = "duplicate"


class SuggestionAuthorRole(str, enum.Enum):
    SUBMITTER = "submitter"
    REVIEWER = "reviewer"


class SuggestionBox(Base):
    """A configurable intake box.

    Closing a box is ``is_active``. Deleting one cascades through every
    submission it received (screenshots, threads, forwards), so
    ``SuggestionService.delete_box`` requires the administrator to type the
    box's name before deleting a box that holds any submissions."""

    __tablename__ = "suggestion_boxes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    # Plain strings rather than a MySQL ENUM so a new mode or disposition is a
    # code change, not an ALTER TABLE; the Pydantic schemas validate values.
    anonymity_mode = Column(
        String(16),
        nullable=False,
        default=SuggestionAnonymityMode.ALLOWED.value,
        server_default=SuggestionAnonymityMode.ALLOWED.value,
    )
    follow_up_enabled = Column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    # Lets reviewers publish a rewritten copy of a submission for members to
    # see and vote on. Off by default: a box has always been private, and a
    # department opts each one in.
    public_board_enabled = Column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    reviewers = relationship(
        "SuggestionBoxReviewer",
        back_populates="box",
        cascade="all, delete-orphan",
    )
    watchers = relationship(
        "SuggestionBoxWatcher",
        back_populates="box",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_suggestion_box_org_name"),
        Index("idx_suggestion_boxes_org_active", "organization_id", "is_active"),
    )


class SuggestionBoxReviewer(Base):
    """One reviewer grant on a box: either a position or a single member.

    Reviewers are the only people who can read a box's submissions (a
    ``SuggestionForward`` extends one suggestion, never the box). Holding
    ``suggestions.manage`` configures boxes but does not confer read access,
    so a complaint about an officer is not visible to that officer merely
    because they administer the boxes.
    """

    __tablename__ = "suggestion_box_reviewers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    box_id = Column(
        String(36),
        ForeignKey("suggestion_boxes.id", ondelete="CASCADE"),
        nullable=False,
    )
    position_id = Column(
        String(36), ForeignKey("positions.id", ondelete="CASCADE"), nullable=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    box = relationship("SuggestionBox", back_populates="reviewers")

    __table_args__ = (
        Index("idx_suggestion_reviewers_org_box", "organization_id", "box_id"),
        UniqueConstraint("box_id", "position_id", name="uq_suggestion_reviewer_pos"),
        UniqueConstraint("box_id", "user_id", name="uq_suggestion_reviewer_user"),
    )


class SuggestionBoxWatcher(Base):
    """Someone told that a box received a submission, without being able to
    read it: either a position or a single member.

    Kept apart from ``SuggestionBoxReviewer`` because the two grant different
    things. A chief who wants to know the Compliance box is being used must
    not, by asking, become able to read a complaint about themselves.
    """

    __tablename__ = "suggestion_box_watchers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    box_id = Column(
        String(36),
        ForeignKey("suggestion_boxes.id", ondelete="CASCADE"),
        nullable=False,
    )
    position_id = Column(
        String(36), ForeignKey("positions.id", ondelete="CASCADE"), nullable=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    box = relationship("SuggestionBox", back_populates="watchers")

    __table_args__ = (
        Index("idx_suggestion_watchers_org_box", "organization_id", "box_id"),
        UniqueConstraint("box_id", "position_id", name="uq_suggestion_watcher_pos"),
        UniqueConstraint("box_id", "user_id", name="uq_suggestion_watcher_user"),
    )


class Suggestion(Base):
    __tablename__ = "suggestions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    box_id = Column(
        String(36),
        ForeignKey("suggestion_boxes.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_anonymous = Column(Boolean, nullable=False, default=False)
    # NULL for every anonymous submission — never populated and then hidden.
    submitted_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # SHA-256 hex digest of an anonymous submitter's follow-up key.
    follow_up_key_hash = Column(String(64), nullable=True, unique=True)
    title = Column(String(200), nullable=False)
    details = Column(Text, nullable=False)
    disposition = Column(
        String(32),
        nullable=False,
        default=SuggestionDisposition.NEW.value,
        server_default=SuggestionDisposition.NEW.value,
    )
    # Reviewer-only; never returned to the submitter.
    internal_note = Column(Text, nullable=True)
    disposition_updated_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    disposition_updated_at = Column(DateTime(timezone=True), nullable=True)
    # The idea board shows a reviewer-written copy, never the submission: the
    # original may name people or carry screenshots, and its wording can give
    # away an anonymous author. NULL published_at means not on the board.
    published_at = Column(DateTime(timezone=True), nullable=True)
    published_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_title = Column(String(200), nullable=True)
    published_summary = Column(Text, nullable=True)
    # Set explicitly by the service (day-truncated when anonymous), so no
    # server default here.
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

    box = relationship("SuggestionBox")
    attachments = relationship(
        "SuggestionAttachment",
        back_populates="suggestion",
        cascade="all, delete-orphan",
        order_by="SuggestionAttachment.position",
    )
    messages = relationship(
        "SuggestionMessage",
        back_populates="suggestion",
        cascade="all, delete-orphan",
        order_by="SuggestionMessage.sequence",
    )

    __table_args__ = (
        Index("idx_suggestions_org_box", "organization_id", "box_id"),
        Index("idx_suggestions_submitter", "submitted_by"),
    )


class SuggestionStatusEvent(Base):
    """One step a reviewer took that the submitter can see: a disposition
    change, a public response, or both at once.

    Deliberately carries no reviewer id. The submitter sees "Reviewers", not a
    name, and who acted is already in the audit log. Receipt is not stored as
    an event: it is the suggestion's own ``created_at``, which for an
    anonymous submission is already truncated to the day.
    """

    __tablename__ = "suggestion_status_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    suggestion_id = Column(
        String(36),
        ForeignKey("suggestions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Orders the steps. Timestamps cannot: MySQL keeps whole seconds, and a
    # status change and a response saved together share one.
    sequence = Column(Integer, nullable=False)
    # The disposition in force after this step, so a response given without
    # a status change still reads in context.
    disposition = Column(String(32), nullable=False)
    public_response = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index(
            "idx_suggestion_status_events_org_suggestion",
            "organization_id",
            "suggestion_id",
        ),
        UniqueConstraint(
            "suggestion_id", "sequence", name="uq_suggestion_status_event_seq"
        ),
    )


class SuggestionVote(Base):
    """One member's support for a published suggestion.

    Who voted is stored only so a member can take their vote back and cannot
    vote twice; no endpoint returns another member's vote.
    """

    __tablename__ = "suggestion_votes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    suggestion_id = Column(
        String(36),
        ForeignKey("suggestions.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index(
            "idx_suggestion_votes_org_suggestion", "organization_id", "suggestion_id"
        ),
        UniqueConstraint("suggestion_id", "user_id", name="uq_suggestion_vote_user"),
    )


class SuggestionAttachment(Base):
    """A screenshot, re-encoded to WebP on upload. The display name is
    server-generated because a client filename can identify its author."""

    __tablename__ = "suggestion_attachments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    suggestion_id = Column(
        String(36),
        ForeignKey("suggestions.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False, default=0)
    file_name = Column(String(100), nullable=False)
    file_path = Column(String(500), nullable=False)
    content_type = Column(String(50), nullable=False)
    file_size = Column(Integer, nullable=False)
    # Set by the service to the submission's own stamp, so an anonymous
    # submission's screenshots are day-precision too.
    created_at = Column(DateTime(timezone=True), nullable=False)

    suggestion = relationship("Suggestion", back_populates="attachments")

    __table_args__ = (
        Index("idx_suggestion_attachments_suggestion", "suggestion_id"),
        Index(
            "idx_suggestion_attachments_org_suggestion",
            "organization_id",
            "suggestion_id",
        ),
    )


class SuggestionMessage(Base):
    """One entry in a follow-up thread.

    Ordered by ``sequence`` rather than ``created_at``: the submitter side of
    an anonymous thread is stored at day precision, so timestamps cannot
    order it.
    """

    __tablename__ = "suggestion_messages"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    suggestion_id = Column(
        String(36),
        ForeignKey("suggestions.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence = Column(Integer, nullable=False)
    author_role = Column(String(16), nullable=False)
    # Set for reviewers and for a named submitter; NULL for an anonymous one.
    author_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)

    suggestion = relationship("Suggestion", back_populates="messages")

    __table_args__ = (
        UniqueConstraint("suggestion_id", "sequence", name="uq_suggestion_msg_seq"),
        Index(
            "idx_suggestion_messages_org_suggestion",
            "organization_id",
            "suggestion_id",
        ),
    )


class SuggestionForward(Base):
    """One suggestion forwarded to a member or a position.

    A forward makes its recipients reviewers of that single suggestion — they
    can read it, set its disposition and reply — without opening the rest of
    the box to them. Only the box's own reviewers can forward or withdraw
    one; a recipient cannot pass it on, so access never spreads further
    without a box reviewer's decision.
    """

    __tablename__ = "suggestion_forwards"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    suggestion_id = Column(
        String(36),
        ForeignKey("suggestions.id", ondelete="CASCADE"),
        nullable=False,
    )
    position_id = Column(
        String(36), ForeignKey("positions.id", ondelete="CASCADE"), nullable=True
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    forwarded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "suggestion_id", "position_id", name="uq_suggestion_forward_pos"
        ),
        UniqueConstraint("suggestion_id", "user_id", name="uq_suggestion_forward_user"),
        Index(
            "idx_suggestion_forwards_org_suggestion",
            "organization_id",
            "suggestion_id",
        ),
    )
