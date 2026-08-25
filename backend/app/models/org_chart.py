"""
Organizational Chart Model

The department's *real-life* chain of command, as the general membership needs
to read it: who is in charge of which area, and who they report to.

This is deliberately **not** derived from positions, roles, or application
permissions. Those describe what someone may do in this software, and the two
hierarchies genuinely disagree — the IT manager holds the wildcard grant and
sits at the top of the permission tree while reporting to the Chief in real
life, and a committee chair with no elevated access may be the person a member
actually needs to find. Generating this chart from ``Position`` rows would
therefore publish an org chart nobody in the department recognises, which is
why leadership curates it by hand.

One row is one *seat*. A seat held by two people (co-chairs, two assistant
chiefs) is two sibling rows rather than one row with a list, so that each
person keeps their own reporting line and area of responsibility — an org
chart's whole purpose.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class OrgChartNode(Base):
    """One seat on the department's organizational chart."""

    __tablename__ = "org_chart_nodes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Who this seat reports to. NULL is a root of the chart — a department may
    # legitimately have several (an operational branch and an administrative
    # branch that meet only at the membership).
    #
    # SET NULL rather than CASCADE, and nullable to satisfy MySQL 1830: a
    # delete that reaches this column directly must promote the orphans to
    # roots, never silently delete a subtree. The service reparents children
    # onto the removed seat's own parent first, so this is the safety net for
    # a path that bypasses it.
    parent_id = Column(
        String(36),
        ForeignKey("org_chart_nodes.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The real-life title, not an application role: "Fire Chief", "Training
    # Committee Chair", "Station 2 Captain".
    title = Column(String(150), nullable=False)

    # What this seat is in charge of — the question the chart exists to answer.
    responsibility = Column(Text, nullable=True)

    # The member holding the seat. SET NULL so removing a member leaves the
    # seat (and its area of responsibility) standing as vacant rather than
    # deleting a branch of the chart.
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Name typed outright, for a holder with no login (a board member, a
    # volunteer chaplain) or to override how a linked member is announced.
    display_name = Column(String(200), nullable=True)

    # Published *office* contact details, e.g. training@department.org. These
    # are never derived from the holder's member record: the roster's personal
    # email and phone are governed by the organization's contact-visibility
    # setting, and the chart is read by the whole membership, so anything shown
    # here has to be something leadership deliberately chose to publish.
    contact_email = Column(String(320), nullable=True)
    contact_phone = Column(String(50), nullable=True)

    sort_order = Column(Integer, nullable=False, default=0, server_default="0")

    # Lets leadership build out a reorganisation before the membership sees it.
    # Unpublished seats are visible only to those who can manage the chart.
    is_published = Column(Boolean, nullable=False, default=True, server_default="1")

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
        Index("ix_org_chart_nodes_org_parent", "organization_id", "parent_id"),
    )

    def __repr__(self):
        return f"<OrgChartNode(title={self.title}, parent_id={self.parent_id})>"
