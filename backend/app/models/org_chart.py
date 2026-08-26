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
already knows the answer. A seat may therefore be **linked** to a corporate
``Position`` or an ``OperationalRank``: whoever holds it in the application is
listed in the box, and stays listed as the roster changes, so an election is
one edit rather than two.

The link assists the chart; it does not define it. A linked seat still carries
its own hand-listed people, and the two are shown together — the department
that puts its Chief's role on the Chief's box and adds an auxiliary co-chair
with no login gets both names. Leadership names the seat, places it, and says
what it covers; the application only offers to keep the names underneath
current.

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

    # The corporate position this seat is linked to, if any. NULL is a seat
    # that names its people itself.
    #
    # SET NULL, so nullable — MySQL rejects SET NULL on a NOT NULL column with
    # error 1830 (pitfall #2). Deleting a role must leave the seat standing,
    # falling back to whoever leadership listed by hand, rather than deleting a
    # branch of the chart.
    position_id = Column(
        String(36),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The operational rank this seat is linked to, if any. Stores
    # OperationalRank.rank_code rather than its id, matching User.rank — the
    # column the holders are actually resolved against.
    #
    # A seat links to a position or a rank, never both: the editor asks one
    # question ("which role is this?") and two answers to it would leave the
    # box explaining itself twice.
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
    """One person leadership listed in a seat by hand.

    These are stored; the people a seat gets from its link are not. Persisting
    the linked ones here as well would give the chart its own copy of the
    roster to go stale against the membership screen it is meant to follow —
    the whole point of the link is that there is one answer to "who is the
    Chief", not two.
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
