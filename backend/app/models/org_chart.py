"""
Organizational Chart Model

The department's *real-life* chain of command, as the general membership needs
to read it: who is in charge of which area, and who they report to.

The **shape** of the chart is deliberately not derived from positions, roles,
or application permissions. Those describe what someone may do in this
software, and the two hierarchies genuinely disagree — the IT manager holds the
wildcard grant and sits at the top of the permission tree while reporting to
the Chief in real life, and a committee chair with no elevated access may be
the person a member actually needs to find. Generating the reporting lines from
``Position`` rows would therefore publish an org chart nobody in the department
recognises, which is why leadership curates the tree by hand.

*Who fills* a seat is a different question, and there the application often
does know the answer. A seat may therefore name a source:

``manual``
    Leadership lists the holders outright. The only option for a seat held by
    somebody with no login (a trustee, a chaplain, an auxiliary officer).
``position``
    The holders are whoever currently holds a corporate ``Position``. Put the
    Chief's position on the Chief's seat and the chart follows the roster on
    its own — nobody has to remember to edit two screens after an election.
``rank``
    The holders are whoever currently carries an ``OperationalRank``.

One row is one *seat*, and a seat has a list of holders rather than a single
one. Trustees, co-chairs, two assistant chiefs and a three-person board are all
one seat on the chart with one area of responsibility and one reporting line;
splitting them into sibling rows duplicated the responsibility text onto every
one of them and made the chart claim a hierarchy the department does not have.
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
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

# Where a seat's holders come from. Stored as a plain string rather than a
# native enum so adding a source later is a code change, not a MySQL ALTER on
# a table every organization has rows in.
HOLDER_SOURCE_MANUAL = "manual"
HOLDER_SOURCE_POSITION = "position"
HOLDER_SOURCE_RANK = "rank"

HOLDER_SOURCES = (
    HOLDER_SOURCE_MANUAL,
    HOLDER_SOURCE_POSITION,
    HOLDER_SOURCE_RANK,
)


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

    # One of HOLDER_SOURCES. NOT NULL with a server default so a row written by
    # a path that does not know about this column still resolves as a manually
    # held seat rather than as a seat with no way to name anybody.
    holder_source = Column(
        String(20),
        nullable=False,
        default=HOLDER_SOURCE_MANUAL,
        server_default=HOLDER_SOURCE_MANUAL,
    )

    # Set only when holder_source == "position". SET NULL so deleting a
    # position leaves the seat standing (and resolving as vacant) rather than
    # deleting a branch of the chart; the service treats a source of "position"
    # with no position_id as vacant.
    position_id = Column(
        String(36),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Set only when holder_source == "rank". Stores OperationalRank.rank_code
    # rather than its id, matching User.rank — the column the holders are
    # actually resolved against.
    rank_code = Column(String(100), nullable=True)

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

    holders = relationship(
        "OrgChartNodeHolder",
        back_populates="node",
        cascade="all, delete-orphan",
        order_by="OrgChartNodeHolder.sort_order",
    )

    __table_args__ = (
        Index("ix_org_chart_nodes_org_parent", "organization_id", "parent_id"),
    )

    def __repr__(self):
        return f"<OrgChartNode(title={self.title}, parent_id={self.parent_id})>"


class OrgChartNodeHolder(Base):
    """One person listed in one seat.

    Only ever written for a ``manual`` seat. A seat sourced from a position or
    a rank resolves its holders at read time from the roster, so persisting
    them here as well would give the chart a copy to go stale against the
    membership screen it is supposed to follow.
    """

    __tablename__ = "org_chart_node_holders"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    node_id = Column(
        String(36),
        ForeignKey("org_chart_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The member holding the seat. SET NULL so removing a member leaves the
    # seat (and the other people in it) standing rather than deleting the row
    # out from under a co-chair.
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Name typed outright, for a holder with no login (a board member, a
    # volunteer chaplain) or to override how a linked member is announced.
    display_name = Column(String(200), nullable=True)

    sort_order = Column(Integer, nullable=False, default=0, server_default="0")

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    node = relationship("OrgChartNode", back_populates="holders")

    __table_args__ = (Index("ix_org_chart_node_holders_node", "node_id", "sort_order"),)

    def __repr__(self):
        return f"<OrgChartNodeHolder(node_id={self.node_id}, user_id={self.user_id})>"
