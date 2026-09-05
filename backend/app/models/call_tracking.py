"""
Call tracking models — PII-free call volume for departments without an RMS.

A department that does not run incident reporting still needs to answer "how
many calls did we run, and what did each apparatus go on?" for grant
applications, ISO ratings, apparatus replacement and staffing cases. This
module records exactly that and deliberately nothing more.

**What is intentionally not here.** No address, no cross streets, no patient
or caller identity, no narrative, no dispatch/on-scene/clear times, no CAD
incident number. Those are the fields that make a call record PHI/PII, and
collecting them is what the department declined to do. The rows here carry a
date, an org-defined type slug, and which units responded — aggregate
operational data, and no more identifiable than the shift roster it hangs off.
Anything richer belongs in a real incident module behind its own consent and
access-control story, not in a call counter.

**Why a call row exists at all, rather than an integer on the shift.** Two
integers cannot be deduplicated. When Engine 5 reports 5 runs and Medic 1
reports 3, nothing in those numbers says whether they were on the same MVA or
on eight unrelated calls, so a department total summed from per-unit counts
double-counts every mutual response. ``OrgCall`` is the shared thing both units
point at, which makes "one call, two units" representable:

* **Department call volume** = distinct ``OrgCall`` rows in the period.
* **Apparatus runs** = ``OrgCallResponse`` rows for that unit ("unit
  responses" — a department of 400 calls can legitimately have 380 engine runs
  and 240 medic runs; these do not sum to the department total, and are not
  supposed to).
* **Member credit** = per-member, held on ``ShiftAttendance.call_count``,
  because a member who came on at 0300 was not on the 2200 call.
"""

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class CallSource:
    """Where a call record came from.

    Not a DB enum: a new dispatch vendor should not need a schema migration,
    and the value is only ever read for provenance display and precedence.
    """

    MANUAL = "manual"
    DISPATCH = "dispatch"
    DERIVED = "derived"

    ALL = (MANUAL, DISPATCH, DERIVED)


# An officer closing out a shift is reporting a tour, not a year. The cap keeps
# a fat-fingered "500" from writing five hundred rows and skewing every report
# that reads them; a department genuinely running more than this on one shift
# has an RMS and is not using count-only mode.
MAX_CALLS_PER_SHIFT = 100


class CallTrackingMode:
    """How an organization records call volume.

    ``DETAILED`` is the default for every existing organization, because a
    setting's absence must mean "current behaviour", never "off" (pitfall #19).
    An org that has been logging per-incident ``ShiftCall`` rows keeps doing so
    until somebody deliberately changes this.
    """

    # Per-incident ShiftCall logging. Counts derive from those rows.
    DETAILED = "detailed"
    # Close-out asks for a number (plus an optional per-type tally) and nothing
    # else. No incident detail is collected or accepted.
    COUNT_ONLY = "count_only"
    # Do not ask at all.
    OFF = "off"

    ALL = (DETAILED, COUNT_ONLY, OFF)


# The bucket a call with no type falls into when a breakdown is reported. Not
# a configurable type — it is the remainder, and it is deliberately the same
# quantity the close-out wizard calls "Not categorised". Never stored on a row;
# an untyped call has ``call_type`` NULL.
UNCLASSIFIED_CALL_TYPE = "unclassified"


# Seeded type list for a department that has not defined its own. Slugs are the
# stored value and are permanent; labels are display-only and may be renamed
# freely, which is exactly why the slug is what lands in ``OrgCall.call_type``.
DEFAULT_CALL_TYPES = [
    {"slug": "fire", "label": "Fire"},
    {"slug": "ems", "label": "EMS"},
    {"slug": "mva", "label": "Motor Vehicle Accident"},
    {"slug": "rescue", "label": "Rescue"},
    {"slug": "hazmat", "label": "Hazmat"},
    {"slug": "service", "label": "Service Call"},
    {"slug": "alarm", "label": "Alarm / Good Intent"},
    {"slug": "mutual_aid", "label": "Mutual Aid"},
    {"slug": "other", "label": "Other"},
]


class OrgCall(Base):
    """One call the department ran, counted once no matter how many units went.

    Deliberately minimal — see the module docstring for what is excluded and
    why. ``call_type`` is a slug into the org's own configured type list
    (``scheduling.call_tracking.call_types``), never a free-text label: types
    get renamed, and a stored label orphans last year's history the moment
    somebody fixes a typo in settings.
    """

    __tablename__ = "org_calls"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Date only. A timestamp would let response times be reconstructed, which
    # is the first step back toward an incident record.
    call_date = Column(Date, nullable=False, index=True)

    # Slug into the org's configured call types. Nullable: a department that
    # tracks only a total still gets rows, they are simply untyped.
    call_type = Column(String(50), nullable=True)

    source = Column(
        String(20), nullable=False, default=CallSource.MANUAL, server_default="manual"
    )

    # Dispatch's own identifier for the call, when an integration supplied it.
    # Its only jobs are idempotent re-sync and cross-unit dedup; it is never
    # displayed, because a CAD incident number is a lookup key into a system
    # that does hold PII.
    external_ref = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("idx_org_call_org_date", "organization_id", "call_date"),
        # Makes a dispatch re-sync idempotent instead of duplicating the day's
        # calls on every poll. Scoped to the org because two departments on the
        # same CAD share its numbering.
        UniqueConstraint(
            "organization_id", "external_ref", name="uq_org_call_external_ref"
        ),
    )

    def __repr__(self):
        return f"<OrgCall(date={self.call_date}, type={self.call_type})>"


class OrgCallResponse(Base):
    """One apparatus responding to one call.

    The join that makes dedup work: N of these against a single ``OrgCall`` is
    N units on one call, which counts as **one** for the department and **one
    run each** for the units.
    """

    __tablename__ = "org_call_responses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    call_id = Column(
        String(36),
        ForeignKey("org_calls.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The shift whose close-out reported this response. SET NULL rather than
    # CASCADE: deleting a shift must not silently reduce the department's
    # historical call volume. Nullable per pitfall #2.
    shift_id = Column(
        String(36),
        ForeignKey("shifts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Polymorphic exactly like ``shifts.apparatus_id`` — resolves against either
    # apparatus table via utils/apparatus_ref. No FK for the same reason that
    # column has none: a department on BasicApparatus has no ``apparatus.id``
    # to point at, and constraining to one table locks the other out.
    apparatus_id = Column(String(36), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # A unit responds to a given call once. Without this, re-finalizing a
        # shift would add a second run for the same call to the apparatus's
        # tally every time an officer corrected a number.
        UniqueConstraint("call_id", "apparatus_id", name="uq_call_response_apparatus"),
        Index("idx_call_response_apparatus", "organization_id", "apparatus_id"),
    )

    def __repr__(self):
        return (
            f"<OrgCallResponse(call_id={self.call_id}, apparatus={self.apparatus_id})>"
        )
