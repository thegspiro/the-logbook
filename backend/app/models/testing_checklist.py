"""
Testing checklist entries

Backs the in-app testing home (`/testing`): one row per (tester, page)
recording whether that page has been walked and what was found.

**Why the server and not the browser.** The run started life in localStorage,
which meant a department's checklist lived in whichever browser happened to
have done the testing, and — more to the point — a checklist of *permission*
gates is only meaningful when it spans accounts. The whole method is to sign
in as a firefighter, then a lieutenant, then a chief and confirm each one is
refused what they should be refused; that evidence is worthless if it is
scattered across three private windows. The IT manager reads every tester's
marks in one place, which is what the table exists for.

Rows are per user, never merged: two testers marking the same page are two
observations, and the one made by the account with fewer grants is usually the
interesting one. ``tested_as`` snapshots the positions the tester held at the
time, because a mark recorded before a position change no longer describes the
account that made it.
"""

import enum

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class TestingCheckStatus(str, enum.Enum):
    """What a tester found on one page."""

    # Recorded but not yet judged — the row exists because a note or a sample
    # record id was typed before the page was opened.
    UNTESTED = "untested"
    PASS = "pass"
    FAIL = "fail"
    # Could not be tested from this account or in this environment: the page
    # refused, the module is off, or its data does not exist yet.
    BLOCKED = "blocked"


class TestingChecklistEntry(Base):
    __tablename__ = "testing_checklist_entries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The route pattern as declared in the frontend router, ":id" segments and
    # all — not a resolved URL. The pattern is what the checklist is a list of.
    route_path = Column(String(200), nullable=False)
    status = Column(
        Enum(TestingCheckStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=TestingCheckStatus.UNTESTED,
    )
    note = Column(Text, nullable=True)
    # Sample record ids for a parameterized route, keyed by parameter name.
    params = Column(JSON, nullable=True)
    # The tester's positions when the mark was made.
    tested_as = Column(JSON, nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        # One row per tester per page. The upsert relies on it: without the
        # constraint a double-tap on Pass writes two rows and the page shows a
        # tester's own mark twice.
        Index(
            "idx_testing_check_unique",
            "organization_id",
            "user_id",
            "route_path",
            unique=True,
        ),
    )
