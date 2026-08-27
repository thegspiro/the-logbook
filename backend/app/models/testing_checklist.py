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

Marks belong to a **run** — one named pass over the checklist, so "what we
tested before the 1.4 release" stays readable after the next pass begins. A run
is never closed and there is no active flag: the newest run for an organization
is the current one, which makes starting a run and archiving the previous one
the same action and leaves no state that can disagree with itself.
"""

import enum

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Enum,
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


class TestingAccessExpectation(str, enum.Enum):
    """What the app predicted the signed-in account would meet on a page.

    Recorded as the **client** computed it, from the route registry plus that
    account's own permissions — the same calculation the screen shows in the
    box. It is not an authority on the gate; its worth is being comparable
    against what the tester actually found, which is how a page that opens for
    somebody it should refuse becomes visible instead of being read as a pass.
    """

    OPEN = "open"
    ALLOWED = "allowed"
    DENIED = "denied"
    MODULE_OFF = "module-off"


class TestingRun(Base):
    """One named pass over the checklist.

    Starting a run archives the previous one by existing: the newest run is the
    current one. Nothing is closed, so there is no "two active runs" state to
    repair, and every earlier run stays readable and exportable.
    """

    __tablename__ = "testing_runs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 1, 2, 3 … per department. Timestamps cannot order these: MySQL DATETIME
    # keeps whole seconds, so a run started in the same second as its
    # predecessor would tie, and the tie-break would decide which pass a mark
    # lands in. The sequence also gives the unique index below something real
    # to enforce, which is what makes "one run at a time" a database rule
    # rather than a hope (CLAUDE.md pitfall #27).
    sequence = Column(Integer, nullable=False)
    label = Column(String(120), nullable=False)
    # The build the run was started against. Absent in development, where the
    # bundle carries no build id.
    build_id = Column(String(64), nullable=True)
    started_by_id = Column(
        String(36),
        # SET NULL, so nullable — MySQL 1830 rejects the pair otherwise
        # (CLAUDE.md pitfall #2). A run outlives the account that opened it;
        # losing the name is better than losing the run.
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    started_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    entries = relationship(
        "TestingChecklistEntry", back_populates="run", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Resolving "the current run" is a read of the highest sequence for one
        # organization, on every load of the screen — and two runs may never
        # share a number, which is what stops a double press opening two.
        Index(
            "idx_testing_run_org_sequence",
            "organization_id",
            "sequence",
            unique=True,
        ),
    )


class TestingChecklistEntry(Base):
    """One tester's finding on one page, in one run.

    Never merged with another tester's: two accounts marking the same page are
    two observations, and the one made by the account holding fewer grants is
    usually the interesting one.
    """

    __tablename__ = "testing_checklist_entries"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Denormalized alongside run_id on purpose: every query stays directly
    # org-scoped (CLAUDE.md pitfall #14a) instead of reaching the tenancy
    # column through a join that a future caller can forget.
    run_id = Column(
        String(36),
        ForeignKey("testing_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        String(36),
        # SET NULL, so nullable — MySQL 1830 rejects the pair otherwise
        # (CLAUDE.md pitfall #2). A mark is evidence about a *run*, and an
        # archived run is the record of what was found then: hard-deleting a
        # member must not rewrite it. Attribution is released the way
        # `release_user_references` releases every other nullable owner, and
        # `tested_as` still says which seat made the observation. The unique
        # index tolerates the NULLs: MySQL permits repeats of NULL there, so
        # two departed testers' marks on one page coexist.
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
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
    # The build the tester was actually looking at, so a mark made three
    # deployments ago can be told from one made against what is running now.
    build_id = Column(String(64), nullable=True)
    expected_access = Column(
        Enum(
            TestingAccessExpectation,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=True,
    )
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

    run = relationship("TestingRun", back_populates="entries")

    __table_args__ = (
        # One row per tester per page *per run*. The upsert relies on it:
        # without the constraint a double-tap on Pass writes two rows and the
        # page shows a tester's own mark twice. Scoped to the run so the next
        # pass over the checklist records fresh marks rather than overwriting
        # the evidence of the last one.
        Index(
            "idx_testing_check_unique",
            "run_id",
            "user_id",
            "route_path",
            unique=True,
        ),
    )
