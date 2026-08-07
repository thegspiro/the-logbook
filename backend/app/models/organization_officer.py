"""
Organization Officer Model

Records which member holds each department office (President, Chief,
Secretary, ...) so outgoing email can be signed by the officeholder rather
than by whoever happened to trigger the send.

The office keys themselves are not stored per-organization — they come from
``OFFICE_CATALOG`` in ``app.core.constants``.  A row here only records the
*assignment* for one office, plus any admin overrides of the values derived
from the linked member.
"""

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class OrganizationOfficer(Base):
    """
    One department office and the member who currently holds it.

    ``user_id`` is the normal case: the name/email/phone are read from that
    member's record so they stay correct when the member updates their
    profile.  The override columns exist for the cases a member record cannot
    express — an office held by someone without a login, a signature title
    that differs from the office label ("Fire Chief" vs. "Chief"), or a
    published office address that is not the holder's personal one.
    """

    __tablename__ = "organization_officers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Office identifier from OFFICE_CATALOG (e.g. "president", "chief").
    office_key = Column(String(50), nullable=False)

    # The member holding the office. SET NULL (not CASCADE) so removing a
    # member leaves the office row — and its overrides — in place instead of
    # silently emptying the department's signature block.
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Admin overrides. NULL means "derive from the linked member".
    display_name = Column(String(200), nullable=True)
    title = Column(String(150), nullable=True)
    email = Column(String(320), nullable=True)
    phone = Column(String(50), nullable=True)

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "office_key", name="uq_org_officer_org_office"
        ),
    )

    def __repr__(self):
        return f"<OrganizationOfficer(office_key={self.office_key}, user_id={self.user_id})>"
