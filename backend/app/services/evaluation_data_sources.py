"""
The data an evaluation template can pull from the rest of the application.

A template's data block names one of these keys. The catalog is the single
list both sides read: the template schema validates a block's ``source``
against it, and the builder offers exactly these entries
(``GET /evaluations/data-sources``). A source is measured over the member's
coverage within the review period — from the first full month after joining,
without separations or approved leaves of absence — not over the nominal
period.

``unit`` decides what a department may do with a source: anything numeric can
carry a scoring rule that suggests a rating, a ``list`` is shown to the
evaluator and member but never scored.
"""

from dataclasses import dataclass
from typing import Literal

DataSourceUnit = Literal["percent", "hours", "count", "rating", "list"]

#: Units a scoring rule can band. A list of certifications has no number to
#: compare against a threshold.
SCOREABLE_UNITS: frozenset[str] = frozenset({"percent", "hours", "count", "rating"})


@dataclass(frozen=True)
class DataSource:
    key: str
    label: str
    unit: DataSourceUnit
    module: str
    description: str

    @property
    def scoreable(self) -> bool:
        return self.unit in SCOREABLE_UNITS


DATA_SOURCES: tuple[DataSource, ...] = (
    DataSource(
        "training.hours",
        "Training hours",
        "hours",
        "training",
        "Hours of completed training records in the period.",
    ),
    DataSource(
        "training.requirements_met_pct",
        "Training requirements met",
        "percent",
        "training",
        "Share of the member's applicable training requirements met, using the "
        "same compliance rules as the training dashboard.",
    ),
    DataSource(
        "training.session_attendance_pct",
        "Training session attendance",
        "percent",
        "training",
        "Training events attended out of those held, with sessions the member "
        "was excused from by a waiver left out of both counts.",
    ),
    DataSource(
        "events.meeting_attendance_pct",
        "Business meeting attendance",
        "percent",
        "events",
        "Business meetings attended out of those held.",
    ),
    DataSource(
        "events.attended_count",
        "Events attended",
        "count",
        "events",
        "Department events the member checked in to.",
    ),
    DataSource(
        "shifts.hours",
        "Shift hours",
        "hours",
        "scheduling",
        "Hours on shifts the member worked.",
    ),
    DataSource(
        "shifts.count",
        "Shifts worked",
        "count",
        "scheduling",
        "Number of shifts the member worked.",
    ),
    DataSource(
        "shifts.performance_rating_avg",
        "Shift performance rating",
        "rating",
        "scheduling",
        "Average of the 1–5 performance ratings on the member's shift "
        "completion reports.",
    ),
    DataSource(
        "calls.responses",
        "Calls responded to",
        "count",
        "calls",
        "Department calls the member responded to.",
    ),
    DataSource(
        "calls.response_pct",
        "Call response rate",
        "percent",
        "calls",
        "Calls responded to out of all department calls in the period.",
    ),
    DataSource(
        "admin_hours.hours",
        "Administrative hours",
        "hours",
        "admin_hours",
        "Approved administrative hours.",
    ),
    DataSource(
        "skills.tests_passed",
        "Skills tests passed",
        "count",
        "training",
        "Skills tests the member passed.",
    ),
    DataSource(
        "certifications.current",
        "Certifications",
        "list",
        "training",
        "Qualifications held at the end of the period, with expiration dates.",
    ),
    DataSource(
        "positions.held",
        "Positions held",
        "list",
        "members",
        "Offices and committee positions the member held during the period.",
    ),
)

DATA_SOURCES_BY_KEY: dict[str, DataSource] = {s.key: s for s in DATA_SOURCES}
