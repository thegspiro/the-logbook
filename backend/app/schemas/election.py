"""
Election Pydantic Schemas

Request and response schemas for election-related endpoints.
"""

import re
from datetime import date, datetime
from typing import AbstractSet, Any, Dict, List, Optional, Sequence, TypeVar
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.schemas.base import UTCResponseBase, as_utc
from app.schemas.column_bounds import INT32_MAX, INT32_MIN
from app.utils.membership import VOTER_TYPE_KEYS

VALID_VOTING_METHODS = {"simple_majority", "ranked_choice", "approval", "supermajority"}
VALID_VICTORY_CONDITIONS = {"most_votes", "majority", "supermajority", "threshold"}
VALID_RUNOFF_TYPES = {"top_two", "eliminate_lowest"}
VALID_QUORUM_TYPES = {"none", "percentage", "count"}
VALID_TIE_POLICIES = {"co_winners", "runoff", "revote", "chair_decides"}
VALID_BALLOT_ITEM_TYPES = {"membership_approval", "officer_election", "general_vote"}
VALID_VOTE_TYPES = {"approval", "candidate_selection"}

# The field validators below return exactly what they were given, so the
# helpers are generic over it: a required field stays ``str``, an optional one
# ``Optional[str]``, and a saved-template item list keeps its item type.
_ChoiceT = TypeVar("_ChoiceT", bound=Optional[str])
_BallotItemsT = TypeVar("_BallotItemsT", bound="Optional[Sequence[BallotItemInput]]")


def _validate_choice(
    value: _ChoiceT, valid_set: AbstractSet[str], label: str
) -> _ChoiceT:
    """Shared validation: reject values not in the allowed set, pass through None."""
    if value is not None and value not in valid_set:
        raise ValueError(
            f"Invalid {label} '{value}'. "
            f"Must be one of: {', '.join(sorted(valid_set))}"
        )
    return value


def _refuse_cleared(model: BaseModel, required: AbstractSet[str]) -> None:
    """Reject an explicit ``null`` for a field whose column is NOT NULL.

    The update schemas type every field ``Optional`` so a PATCH may omit it, and
    the handlers dump with ``exclude_unset``, so a field that *was* sent -- null
    included -- reaches the write. For a nullable column a null means "clear
    this"; for a NOT NULL one it can only mean a mistake, and left to the
    database it surfaces as an ``IntegrityError`` (or a ``TypeError`` from
    comparing a null date) and a 500. Refusing it here answers 422 before any
    handler logic runs.
    """
    cleared = sorted(
        name
        for name in model.model_fields_set & required
        if getattr(model, name) is None
    )
    if cleared:
        raise ValueError(
            f"{', '.join(cleared)} cannot be null; "
            "leave the field out to keep its current value"
        )


def _empty_roster_means_everyone(
    values: Optional[List[UUID]],
) -> Optional[List[UUID]]:
    # W50-41: the stored list is read two ways — in-app eligibility checks
    # ``is not None`` (an empty list bars every member) while the ballot
    # mailer, token voting and eligible-count paths test truthiness (an empty
    # list means "all members"). A form that clears the picker sends ``[]``;
    # settle it to the one value every reader agrees on before it is stored.
    if values is not None and len(values) == 0:
        return None
    return values


def _validate_ballot_item_identities(items: _BallotItemsT) -> _BallotItemsT:
    """Ids are unique, and no item's alias names a different item (ELEC-40).

    A stored ``Candidate`` or ``Vote`` records only a position string. A
    legacy item is matched by its title *or* its id and an explicit one by
    its ``position``, so an item whose title or position equals another
    item's id makes every row stored under that string ambiguous — the
    schema has no ``ballot_item_id`` to settle which item it belongs to.
    The owner chose (2026-10-05) to make that state unreachable when a
    ballot is written rather than migrate the tables, so both are refused
    here, on every write path (create, update, saved template).
    """
    if items is None:
        return items
    ids = [item.id for item in items]
    if len(set(ids)) != len(ids):
        raise ValueError("Ballot item IDs must be unique")
    for item in items:
        for label, alias in (("title", item.title), ("position", item.position)):
            if alias and alias != item.id and alias in ids:
                raise ValueError(
                    f"Ballot item '{item.id}' has a {label} '{alias}' that is "
                    "another ballot item's id; votes stored under it could "
                    "not be told apart. Rename the item or change its id."
                )
    return items


MAX_SEATS_PER_POSITION = 50


def seat_rule_error(
    seats: Optional[int],
    max_votes: Optional[int],
    voting_method: Optional[str],
    ballot_items: Optional[List[Any]] = None,
) -> Optional[str]:
    """Why a seat count cannot work with the rest of the configuration.

    Shared by create (schema) and update (endpoint, against the stored half
    of a partial update). Instant-runoff counting elects one candidate, so a
    multi-seat race needs plurality, majority, supermajority or approval
    voting; and unless the method is approval (no cap), a voter must be able
    to pick as many candidates as there are seats.
    """
    seats = seats or 1
    if seats <= 1:
        return None
    methods = {voting_method or "simple_majority"}
    for item in ballot_items or []:
        override = (
            item.get("voting_method")
            if isinstance(item, dict)
            else getattr(item, "voting_method", None)
        )
        if override:
            methods.add(override)
    if "ranked_choice" in methods:
        return (
            "A race with more than one seat cannot use ranked-choice voting, "
            "which elects one candidate per race"
        )
    if (voting_method or "simple_majority") != "approval" and (max_votes or 1) < seats:
        return (
            f"Voters must be able to choose as many candidates as there are "
            f"seats: max votes per position ({max_votes or 1}) is below "
            f"seats per position ({seats})"
        )
    return None


def clean_voter_types(values: List[str]) -> List[str]:
    """Keep eligibility rules deterministic and safe to persist as JSON.

    Shared by ballot items and the department's eligibility defaults, which
    seed ballot items, so a default can never hold a value an item refuses.
    """
    cleaned: List[str] = []
    for value in values:
        value = value.strip()
        if not value or len(value) > 100 or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("Voter types must be 1-100 letters, numbers, '_' or '-'")
        if value not in cleaned:
            cleaned.append(value)
    if "all" in cleaned and len(cleaned) > 1:
        raise ValueError("'all' cannot be combined with other voter types")
    return cleaned


# Ballot Item Schemas


class BallotItem(BaseModel):
    """Schema for a ballot item with voter eligibility rules.

    This is the tolerant, shared shape: response models deserialize ballot
    items stored as JSON on pre-existing election rows through this class,
    so it must accept whatever was historically persisted. Constraints that
    only new payloads can be expected to satisfy (the strict ``id`` pattern,
    supermajority-requires-percentage) live on :class:`BallotItemInput`,
    the write-path subclass — enforcing them here made GET fail *response*
    validation (a 500) for legacy rows that predate the rules, with no
    migration guarding them.
    """

    id: str = Field(
        ...,
        min_length=1,
        description="Unique, stable identifier for this ballot item",
    )
    type: str = Field(
        ..., description="Type: membership_approval, officer_election, general_vote"
    )
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=10_000)
    position: Optional[str] = Field(
        None, max_length=200, description="Position name for officer elections"
    )
    eligible_voter_types: List[str] = Field(
        default_factory=lambda: ["all"],
        min_length=1,
        max_length=50,
        description=(
            "Voter eligibility category based on membership_type. "
            "'all' = everyone, 'operational' = active members, "
            "'administrative' = administrative members, "
            "'regular' = active + life, 'life' = life only, "
            "'probationary' = probationary only. "
            "Specific role slugs (e.g. 'chief') are also accepted "
            "as a fallback for fine-grained restrictions."
        ),
    )
    vote_type: str = Field(
        default="approval", description="approval, candidate_selection"
    )
    required_for_approval: Optional[int] = Field(
        None, ge=1, le=INT32_MAX, description="Number of yes votes required"
    )
    require_attendance: bool = Field(
        default=False,
        description="If true, voter must be checked in as present at the meeting",
    )

    # Per-item victory condition overrides (optional — defaults to election-level)
    victory_condition: Optional[str] = Field(
        default=None,
        description=(
            "Override election-level victory condition for this item: "
            "most_votes, majority, supermajority, threshold"
        ),
    )
    victory_percentage: Optional[int] = Field(
        default=None,
        ge=1,
        le=100,
        description="Override election-level victory percentage (e.g., 67 for 2/3 supermajority)",
    )
    voting_method: Optional[str] = Field(
        default=None,
        description="Override election-level voting method for this item",
    )

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_BALLOT_ITEM_TYPES:
            raise ValueError(
                f"Invalid ballot item type '{v}'. Must be one of: {', '.join(sorted(VALID_BALLOT_ITEM_TYPES))}"
            )
        return v

    @field_validator("vote_type")
    @classmethod
    def validate_vote_type(cls, v: str) -> str:
        if v not in VALID_VOTE_TYPES:
            raise ValueError(
                f"Invalid vote type '{v}'. Must be one of: {', '.join(sorted(VALID_VOTE_TYPES))}"
            )
        return v

    @field_validator("victory_condition")
    @classmethod
    def validate_victory_condition(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_VICTORY_CONDITIONS, "victory condition")

    @field_validator("voting_method")
    @classmethod
    def validate_voting_method(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_VOTING_METHODS, "voting method")

    @field_validator("eligible_voter_types")
    @classmethod
    def validate_eligible_voter_types(cls, values: List[str]) -> List[str]:
        return clean_voter_types(values)


class BallotItemInput(BallotItem):
    """Ballot item as accepted on the write path (create / update / saved
    templates).

    WHY a subclass: input must stay strict — ballot item ids are persisted
    verbatim into JSON and referenced by votes, so new ids are limited to a
    safe character set, and a supermajority override without a percentage
    is unresolvable at tally time. But legacy rows stored before these
    rules existed must still round-trip through the response models, so
    the shared :class:`BallotItem` stays tolerant and the strictness lives
    only here.
    """

    id: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="Unique, stable identifier for this ballot item",
    )

    @model_validator(mode="after")
    def validate_victory_override(self):
        if (
            self.victory_condition == "supermajority"
            and self.victory_percentage is None
        ):
            raise ValueError(
                "victory_percentage is required for a supermajority ballot item"
            )
        return self


class PositionEligibility(BaseModel):
    """Schema for position-specific voter eligibility"""

    voter_types: List[str] = Field(
        ..., description="Role slugs that can vote for this position"
    )
    min_votes_required: Optional[int] = Field(
        None, ge=0, le=INT32_MAX, description="Minimum votes needed for approval"
    )


VALID_ATTENDANCE_RULE_MODES = {"none", "count", "percent"}
# Which of the department's eligibility defaults an election copies: those
# for regular business meetings, or the annual meeting's own.
VALID_MEETING_KINDS = {"regular", "annual"}
# Mirrors app.models.meeting.MeetingType; kept as literals so this schema
# module does not import the ORM.
VALID_MEETING_TYPES = {
    "business",
    "special",
    "committee",
    "board",
    "trustee",
    "executive",
    "annual",
    "other",
}
MAX_ATTENDANCE_LOOKBACK_MEETINGS = 60
MAX_ATTENDANCE_PERIOD_MONTHS = 60
MAX_WAITING_PERIOD_MONTHS = 600
VALID_WAITING_PERIOD_MODES = {"none", "never", "months"}


class AttendanceRule(BaseModel):
    """A meeting-attendance requirement every voter in an election must meet.

    ``count``: attended at least ``min_meetings`` of the member's last
    ``of_last_meetings`` meetings. ``percent``: attended at least ``min_pct``
    of the meetings held in the last ``period_months``. Either way, waived
    meetings and meetings during a leave of absence are not counted, and
    only meetings since the member's current stint began are considered.
    """

    model_config = ConfigDict(extra="forbid")

    mode: str = Field(default="none")
    min_meetings: Optional[int] = Field(
        default=None, ge=1, le=MAX_ATTENDANCE_LOOKBACK_MEETINGS
    )
    of_last_meetings: Optional[int] = Field(
        default=None, ge=1, le=MAX_ATTENDANCE_LOOKBACK_MEETINGS
    )
    min_pct: Optional[float] = Field(default=None, gt=0, le=100)
    period_months: Optional[int] = Field(
        default=None, ge=1, le=MAX_ATTENDANCE_PERIOD_MONTHS
    )
    meeting_types: Optional[List[str]] = Field(
        default=None,
        max_length=len(VALID_MEETING_TYPES),
        description="Meeting types that count; null counts every meeting",
    )

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        return _validate_choice(v, VALID_ATTENDANCE_RULE_MODES, "attendance rule mode")

    @field_validator("meeting_types")
    @classmethod
    def validate_meeting_types(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        cleaned: List[str] = []
        for value in v:
            _validate_choice(value, VALID_MEETING_TYPES, "meeting type")
            if value not in cleaned:
                cleaned.append(value)
        # An empty list would count no meetings at all, which reads as a
        # perfect record for everyone -- say "every meeting" explicitly.
        return cleaned or None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> "AttendanceRule":
        if self.mode == "count":
            if self.min_meetings is None or self.of_last_meetings is None:
                raise ValueError(
                    "A meeting-count rule needs both the number of meetings to "
                    "attend and how many recent meetings to look back over"
                )
            if self.min_meetings > self.of_last_meetings:
                raise ValueError(
                    "Meetings required cannot exceed the meetings looked back over"
                )
        elif self.mode == "percent":
            if self.min_pct is None or self.period_months is None:
                raise ValueError(
                    "A percentage rule needs both the minimum percentage and "
                    "the look-back period in months"
                )
        return self


class WaitingPeriod(BaseModel):
    """How long a member of one type waits before they may vote.

    ``none``: no wait. ``never``: members of this type may not vote at all.
    ``months``: they may vote ``months`` after becoming that type, counted from
    ``users.member_class_since`` / ``member_status_since`` (or a secretary's
    ``voting_wait_from``) and never from before their current stint.
    """

    model_config = ConfigDict(extra="forbid")

    mode: str = Field(default="none")
    months: Optional[int] = Field(default=None, ge=1, le=MAX_WAITING_PERIOD_MONTHS)

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        return _validate_choice(v, VALID_WAITING_PERIOD_MODES, "waiting period mode")

    @model_validator(mode="after")
    def validate_months(self) -> "WaitingPeriod":
        if self.mode == "months" and self.months is None:
            raise ValueError("A waiting period in months needs the number of months")
        if self.mode != "months":
            self.months = None
        return self


class ElectionEligibilityRules(BaseModel):
    """Election-wide voter rules, stored on ``elections.eligibility_rules``.

    These apply to every ballot item and position in the election, on top of
    each item's own voter types and check-in requirement and each membership
    tier's own rules. A secretary's voter override bypasses them.
    """

    model_config = ConfigDict(extra="forbid")

    attendance: AttendanceRule = Field(default_factory=AttendanceRule)
    waiting_periods: Dict[str, WaitingPeriod] = Field(
        default_factory=dict,
        description=(
            "Per member type (see app.utils.membership.VOTER_TYPE_KEYS): how "
            "long after becoming that type a member may vote. A type not "
            "listed has no waiting period"
        ),
    )

    @field_validator("waiting_periods")
    @classmethod
    def validate_waiting_periods(
        cls, v: Dict[str, WaitingPeriod]
    ) -> Dict[str, WaitingPeriod]:
        unknown = sorted(set(v) - set(VOTER_TYPE_KEYS))
        if unknown:
            raise ValueError(
                f"Unknown member type(s) {', '.join(unknown)}. Must be one of: "
                f"{', '.join(VOTER_TYPE_KEYS)}"
            )
        # "none" is what an absent key already means; storing it would make
        # two spellings of one rule.
        return {k: p for k, p in v.items() if p.mode != "none"}


class ElectionEligibilityRulesRead(ElectionEligibilityRules):
    """The rules as read back from a stored election.

    Ignores keys the write model no longer knows, so a row written by an
    earlier build of this feature (one carrying ``min_tenure_months``) reads
    rather than failing response validation with a 500.
    """

    model_config = ConfigDict(extra="ignore")


class EligibilityDefaults(BaseModel):
    """The department's default voter eligibility, set on Election Settings.

    ``rules`` is copied onto each election created afterwards. The other
    fields seed what a secretary builds: new ballot items take
    ``default_require_attendance`` and ``default_voter_types``, and a new
    election's ``position_eligibility`` takes ``position_voter_types`` for
    the positions it names. Changing these never touches an existing
    election.
    """

    model_config = ConfigDict(extra="forbid")

    rules: ElectionEligibilityRules = Field(default_factory=ElectionEligibilityRules)
    default_require_attendance: bool = True
    default_voter_types: List[str] = Field(
        default_factory=lambda: ["all"], min_length=1, max_length=50
    )
    position_voter_types: Dict[str, List[str]] = Field(
        default_factory=dict, max_length=100
    )

    @field_validator("default_voter_types")
    @classmethod
    def validate_default_voter_types(cls, v: List[str]) -> List[str]:
        return clean_voter_types(v)

    @field_validator("position_voter_types")
    @classmethod
    def validate_position_voter_types(
        cls, v: Dict[str, List[str]]
    ) -> Dict[str, List[str]]:
        cleaned: Dict[str, List[str]] = {}
        # Elections match these names without regard to case, so "Chief" and
        # "chief" would be one position configured twice.
        seen: set = set()
        for position, types in v.items():
            name = position.strip()
            if not name or len(name) > 200:
                raise ValueError("Position names must be 1-200 characters")
            if name.casefold() in seen:
                raise ValueError(f"Position '{name}' is listed more than once")
            seen.add(name.casefold())
            if not types:
                raise ValueError(f"Position '{name}' needs at least one voter type")
            cleaned[name] = clean_voter_types(types)
        return cleaned


class TierVotingRule(BaseModel):
    """One membership tier's own voting rules, reported read-only so the
    eligibility settings can show them beside the election-wide rules."""

    tier_id: str
    name: str
    voting_eligible: bool
    requires_meeting_attendance: bool
    min_attendance_pct: float
    attendance_period_months: int


# Election Schemas


class ElectionBase(BaseModel):
    """Base election schema"""

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=50_000)
    election_type: str = Field(default="general", max_length=50)
    positions: Optional[List[str]] = Field(
        default=None,
        max_length=100,
        description="List of positions to vote for",
    )
    ballot_items: Optional[List[BallotItemInput]] = Field(
        default=None,
        max_length=250,
        description="Structured ballot items with per-item eligibility",
    )
    position_eligibility: Optional[Dict[str, PositionEligibility]] = Field(
        default=None, description="Eligibility rules per position"
    )
    eligibility_rules: Optional[ElectionEligibilityRules] = Field(
        default=None,
        description=(
            "Election-wide voter rules; omitted on create to copy the "
            "department's defaults"
        ),
    )
    meeting_kind: Optional[str] = Field(
        default=None,
        description=(
            "regular or annual: which of the department's eligibility "
            "defaults the election copies. Omitted on create, it is annual "
            "when the linked meeting is an annual meeting, else regular"
        ),
    )
    meeting_date: Optional[datetime] = Field(
        default=None, description="Meeting date for ballot"
    )
    meeting_id: Optional[UUID] = Field(
        default=None, description="Optional link to a formal meeting record"
    )
    event_id: Optional[UUID] = Field(
        default=None,
        description="Optional link to a calendar event (e.g. business meeting)",
    )
    # NOTE: attendees is deliberately NOT accepted here. Attendance feeds
    # require_attendance voting eligibility, so check-ins must go through the
    # POST /{id}/attendees endpoint (which validates the user and audits the
    # check-in) — never through raw create/update payloads.
    start_date: datetime
    end_date: datetime
    anonymous_voting: bool = Field(default=True)
    allow_write_ins: bool = Field(default=False)
    max_votes_per_position: int = Field(default=1, ge=1, le=INT32_MAX)
    seats_per_position: int = Field(default=1, ge=1, le=MAX_SEATS_PER_POSITION)
    results_visible_immediately: bool = Field(default=False)
    eligible_voters: Optional[List[UUID]] = Field(
        default=None,
        description="List of user IDs eligible to vote, null means all members",
    )

    # Voting method and victory conditions
    voting_method: str = Field(
        default="simple_majority",
        description="Voting method: simple_majority, ranked_choice, approval, supermajority",
    )
    victory_condition: str = Field(
        default="most_votes",
        description="Victory condition: most_votes, majority, supermajority, threshold",
    )
    victory_threshold: Optional[int] = Field(
        default=None,
        description="Numerical threshold for victory (e.g., 10 votes)",
        ge=INT32_MIN,
        le=INT32_MAX,
    )
    victory_percentage: Optional[int] = Field(
        default=None,
        ge=1,
        le=100,
        description="Percentage threshold for victory (e.g., 60%)",
    )

    # Runoff configuration
    enable_runoffs: bool = Field(
        default=False, description="Automatically create runoff elections if no winner"
    )
    runoff_type: str = Field(
        default="top_two",
        description="Runoff type: top_two (top 2 advance), eliminate_lowest (remove lowest)",
    )
    max_runoff_rounds: int = Field(
        default=3, ge=1, le=10, description="Maximum number of runoff rounds"
    )

    # Quorum configuration
    quorum_type: str = Field(
        default="none",
        description="Quorum type: none, percentage, count",
    )
    quorum_value: Optional[int] = Field(
        default=None,
        ge=1,
        description="Quorum value (percentage or count depending on quorum_type)",
        le=INT32_MAX,
    )

    # Lifecycle automation
    auto_open: bool = Field(
        default=False,
        description="Automatically open this election at its start date",
    )
    reminder_hours_before_close: Optional[int] = Field(
        default=None,
        ge=1,
        le=720,
        description=(
            "Automatically remind non-voters this many hours before the "
            "election closes (null = no automatic reminder)"
        ),
    )
    nomination_deadline: Optional[datetime] = Field(
        default=None,
        description=(
            "When set, the nomination phase closes automatically at this "
            "time (null = close nominations manually)"
        ),
    )
    tie_policy: str = Field(
        default="co_winners",
        description=(
            "most_votes tie handling: co_winners (all tied declared "
            "winners — legacy behavior), runoff, revote, or chair_decides "
            "(the last three declare no winner and flag the tie)"
        ),
    )

    @field_validator("tie_policy")
    @classmethod
    def validate_tie_policy(cls, v: str) -> str:
        return _validate_choice(v, VALID_TIE_POLICIES, "tie policy")

    @field_validator("meeting_kind")
    @classmethod
    def validate_meeting_kind(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_MEETING_KINDS, "meeting kind")

    @field_validator("quorum_type")
    @classmethod
    def validate_quorum_type(cls, v: str) -> str:
        return _validate_choice(v, VALID_QUORUM_TYPES, "quorum type")

    @field_validator("voting_method")
    @classmethod
    def validate_voting_method(cls, v: str) -> str:
        return _validate_choice(v, VALID_VOTING_METHODS, "voting method")

    @field_validator("victory_condition")
    @classmethod
    def validate_victory_condition(cls, v: str) -> str:
        return _validate_choice(v, VALID_VICTORY_CONDITIONS, "victory condition")

    @field_validator("runoff_type")
    @classmethod
    def validate_runoff_type(cls, v: str) -> str:
        return _validate_choice(v, VALID_RUNOFF_TYPES, "runoff type")

    @field_validator("meeting_date", "start_date", "end_date", "nomination_deadline")
    @classmethod
    def normalize_datetimes(cls, v: Optional[datetime]) -> Optional[datetime]:
        # See as_utc: without this, a payload mixing naive and aware
        # datetimes makes validate_election_configuration raise TypeError
        # (a 500) instead of returning a 422.
        return as_utc(v)

    @field_validator("eligible_voters")
    @classmethod
    def normalize_eligible_voters(
        cls, values: Optional[List[UUID]]
    ) -> Optional[List[UUID]]:
        return _empty_roster_means_everyone(values)

    @field_validator("positions")
    @classmethod
    def validate_positions(cls, values: Optional[List[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 200 for value in cleaned):
            raise ValueError("Positions must be between 1 and 200 characters")
        if len({value.casefold() for value in cleaned}) != len(cleaned):
            raise ValueError("Position names must be unique")
        return cleaned

    @field_validator("ballot_items")
    @classmethod
    def validate_unique_ballot_item_ids(
        cls, values: Optional[List[BallotItemInput]]
    ) -> Optional[List[BallotItemInput]]:
        return _validate_ballot_item_identities(values)

    @model_validator(mode="after")
    def validate_election_configuration(self):
        if self.end_date <= self.start_date:
            raise ValueError("End date must be after start date")
        if self.quorum_type != "none" and self.quorum_value is None:
            raise ValueError("quorum_value is required when quorum is enabled")
        if (
            self.quorum_type == "percentage"
            and self.quorum_value
            and self.quorum_value > 100
        ):
            raise ValueError("Percentage quorum cannot exceed 100")
        seat_error = seat_rule_error(
            self.seats_per_position,
            self.max_votes_per_position,
            self.voting_method,
            self.ballot_items,
        )
        if seat_error:
            raise ValueError(seat_error)
        return self


class ElectionCreate(ElectionBase):
    """Schema for creating a new election"""


# Every ElectionUpdate field whose `elections` column is NOT NULL. Kept beside
# the schema because the schema cannot see the column; `test_election_update_null_
# columns_integration.py` derives the set from the model and fails if the two
# drift, so a new NOT NULL column cannot be added without being listed here.
ELECTION_UPDATE_REQUIRED_FIELDS = frozenset(
    {
        "title",
        "election_type",
        "start_date",
        "end_date",
        "anonymous_voting",
        "allow_write_ins",
        "max_votes_per_position",
        "seats_per_position",
        "results_visible_immediately",
        "voting_method",
        "victory_condition",
        "enable_runoffs",
        "runoff_type",
        "max_runoff_rounds",
        "quorum_type",
        "auto_open",
        "tie_policy",
        "meeting_kind",
    }
)


class ElectionUpdate(BaseModel):
    """Schema for updating an election

    NOTE: status is intentionally excluded. Use the dedicated
    /open, /close, and /rollback endpoints to change election status.
    This prevents bypassing validation logic (candidate checks, result
    calculation, runoff creation, audit trails).
    """

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=50_000)
    election_type: Optional[str] = Field(None, max_length=50)
    positions: Optional[List[str]] = Field(default=None, max_length=100)
    ballot_items: Optional[List[BallotItemInput]] = Field(default=None, max_length=250)
    position_eligibility: Optional[Dict[str, PositionEligibility]] = None
    eligibility_rules: Optional[ElectionEligibilityRules] = None
    meeting_kind: Optional[str] = None
    meeting_date: Optional[datetime] = None
    meeting_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    anonymous_voting: Optional[bool] = None
    allow_write_ins: Optional[bool] = None
    max_votes_per_position: Optional[int] = Field(None, ge=1, le=INT32_MAX)
    seats_per_position: Optional[int] = Field(None, ge=1, le=MAX_SEATS_PER_POSITION)
    results_visible_immediately: Optional[bool] = None
    eligible_voters: Optional[List[UUID]] = None
    voting_method: Optional[str] = None
    victory_condition: Optional[str] = None
    victory_threshold: Optional[int] = Field(None, ge=INT32_MIN, le=INT32_MAX)
    victory_percentage: Optional[int] = Field(None, ge=1, le=100)
    enable_runoffs: Optional[bool] = None
    runoff_type: Optional[str] = None
    max_runoff_rounds: Optional[int] = Field(None, ge=1, le=10)
    quorum_type: Optional[str] = None
    quorum_value: Optional[int] = Field(None, ge=1, le=INT32_MAX)
    auto_open: Optional[bool] = None
    reminder_hours_before_close: Optional[int] = Field(None, ge=1, le=720)
    nomination_deadline: Optional[datetime] = None
    tie_policy: Optional[str] = None

    @field_validator("meeting_kind")
    @classmethod
    def validate_meeting_kind(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_MEETING_KINDS, "meeting kind")

    @field_validator("tie_policy")
    @classmethod
    def validate_tie_policy(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_TIE_POLICIES, "tie policy")

    @field_validator("quorum_type")
    @classmethod
    def validate_quorum_type(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_QUORUM_TYPES, "quorum type")

    @field_validator("voting_method")
    @classmethod
    def validate_voting_method(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_VOTING_METHODS, "voting method")

    @field_validator("victory_condition")
    @classmethod
    def validate_victory_condition(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_VICTORY_CONDITIONS, "victory condition")

    @field_validator("runoff_type")
    @classmethod
    def validate_runoff_type(cls, v: Optional[str]) -> Optional[str]:
        return _validate_choice(v, VALID_RUNOFF_TYPES, "runoff type")

    @field_validator("meeting_date", "start_date", "end_date", "nomination_deadline")
    @classmethod
    def normalize_datetimes(cls, v: Optional[datetime]) -> Optional[datetime]:
        # See as_utc: the update endpoint compares these against each other
        # and against stored values; a naive/aware mix raised TypeError (500).
        return as_utc(v)

    @field_validator("eligible_voters")
    @classmethod
    def normalize_eligible_voters(
        cls, values: Optional[List[UUID]]
    ) -> Optional[List[UUID]]:
        return _empty_roster_means_everyone(values)

    @field_validator("positions")
    @classmethod
    def validate_positions(cls, values: Optional[List[str]]) -> Optional[List[str]]:
        if values is None:
            return None
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 200 for value in cleaned):
            raise ValueError("Positions must be between 1 and 200 characters")
        if len({value.casefold() for value in cleaned}) != len(cleaned):
            raise ValueError("Position names must be unique")
        return cleaned

    @field_validator("ballot_items")
    @classmethod
    def validate_unique_ballot_item_ids(
        cls, values: Optional[List[BallotItemInput]]
    ) -> Optional[List[BallotItemInput]]:
        return _validate_ballot_item_identities(values)

    @model_validator(mode="after")
    def refuse_cleared_required_fields(self) -> "ElectionUpdate":
        _refuse_cleared(self, ELECTION_UPDATE_REQUIRED_FIELDS)
        return self


class ResultsRevision(BaseModel):
    """One correction made to a closed election's result (W50-9)."""

    at: datetime
    by: Optional[str] = None
    by_name: Optional[str] = None
    # vote_voided | paper_batch_voided | write_ins_merged
    action: str
    detail: Optional[str] = None


class ElectionResponse(UTCResponseBase):
    """Schema for election response"""

    id: UUID
    organization_id: UUID
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    election_type: str = Field(default="general", max_length=50)
    positions: Optional[List[str]] = None
    ballot_items: Optional[List[BallotItem]] = None
    position_eligibility: Optional[Dict[str, PositionEligibility]] = None
    eligibility_rules: Optional[ElectionEligibilityRulesRead] = None
    meeting_kind: str = "regular"
    meeting_date: Optional[datetime] = None
    meeting_id: Optional[UUID] = None
    meeting_title: Optional[str] = None
    meeting_type: Optional[str] = None
    event_id: Optional[UUID] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    start_date: datetime
    end_date: datetime
    anonymous_voting: bool = True
    allow_write_ins: bool = False
    max_votes_per_position: int = 1
    seats_per_position: int = 1
    results_visible_immediately: bool = False
    eligible_voters: Optional[List[UUID]] = None
    voting_method: str = "simple_majority"
    victory_condition: str = "most_votes"
    victory_threshold: Optional[int] = None
    victory_percentage: Optional[int] = None
    enable_runoffs: bool = False
    runoff_type: str = "top_two"
    max_runoff_rounds: int = 3
    quorum_type: str = "none"
    quorum_value: Optional[int] = None
    auto_open: bool = False
    reminder_hours_before_close: Optional[int] = None
    reminder_sent_at: Optional[datetime] = None
    nomination_deadline: Optional[datetime] = None
    # Set by Close Nominations; the slate is frozen while it is (W50-38).
    nominations_closed_at: Optional[datetime] = None
    # Ballot links already sent were retired — by a ballot change (W50-47)
    # or a reopen (W50-36) — and no ballot email has gone out since.
    # Resolved by the endpoint; reason is "ballot_changed" or "reopened".
    ballots_must_be_resent: bool = False
    ballots_resend_reason: Optional[str] = None
    # The latest nominations-open announcement, for the managers only.
    # Resolved by the endpoint.
    nominations_announcement: Optional["BallotSendJobResponse"] = None
    tie_policy: str = "co_winners"
    status: str
    created_by: Optional[UUID] = None
    # Actual close, distinct from the scheduled end_date. closed_by is None
    # for a lifecycle (automatic) close; closed_by_name is resolved by the
    # endpoint so a card can print the officer without a second request.
    closed_at: Optional[datetime] = None
    closed_by: Optional[UUID] = None
    closed_by_name: Optional[str] = None
    # Each change to the result after close (W50-9), oldest first, so the
    # Results tab can mark the result "revised <when> by <who>".
    results_revisions: Optional[List[ResultsRevision]] = None
    created_at: datetime
    updated_at: datetime

    # Email tracking
    email_sent: bool = False
    email_sent_at: Optional[datetime] = None
    email_recipients: Optional[List[UUID]] = None

    # Runoff tracking
    is_runoff: bool = False
    parent_election_id: Optional[UUID] = None
    runoff_round: int = 0

    # Include vote counts if results are visible
    total_votes: Optional[int] = None
    total_voters: Optional[int] = None
    voter_turnout_percentage: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class ElectionListResponse(UTCResponseBase):
    """Schema for election list item"""

    id: UUID
    title: str
    election_type: str
    start_date: datetime
    end_date: datetime
    closed_at: Optional[datetime] = None
    status: str
    positions: Optional[List[str]] = None
    total_votes: Optional[int] = None
    meeting_id: Optional[UUID] = None
    meeting_title: Optional[str] = None
    meeting_date: Optional[datetime] = None
    is_runoff: bool = False
    parent_election_id: Optional[UUID] = None
    runoff_round: int = 0
    enable_runoffs: bool = False

    model_config = ConfigDict(from_attributes=True)


class BallotElectionResponse(UTCResponseBase):
    """Minimal election view for anonymous token voters.

    SECURITY: the public GET /elections/ballot endpoint must never expose
    roster/PII fields (attendees, eligible_voters, email_recipients,
    created_by, ...) to a token holder — only what the voting page needs.
    """

    id: UUID
    title: str
    description: Optional[str] = None
    election_type: str = "general"
    meeting_date: Optional[datetime] = None
    start_date: datetime
    end_date: datetime
    status: str
    positions: Optional[List[str]] = None
    ballot_items: Optional[List[BallotItem]] = None
    allow_write_ins: bool = False
    voting_method: str = "simple_majority"
    max_votes_per_position: int = 1
    seats_per_position: int = 1

    model_config = ConfigDict(from_attributes=True)


# Candidate Schemas

CANDIDATE_STATEMENT_MAX_LENGTH = 5000


class CandidateBase(BaseModel):
    """Base candidate schema"""

    name: str = Field(..., min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    # The column is TEXT, so without a bound a nominee can file 60 000 chars
    # that every ballot, preview and package then renders in full (W50-67).
    statement: Optional[str] = Field(
        None,
        max_length=CANDIDATE_STATEMENT_MAX_LENGTH,
        description="Candidate's statement or platform",
    )
    photo_url: Optional[str] = Field(None, max_length=500)
    display_order: int = Field(
        default=0,
        description="Order to display candidate in list",
        ge=INT32_MIN,
        le=INT32_MAX,
    )


class CandidateCreate(CandidateBase):
    """Schema for creating/nominating a candidate"""

    election_id: UUID
    user_id: Optional[UUID] = Field(
        None, description="User ID if candidate is a member"
    )
    is_write_in: bool = Field(default=False)


# `accepted` is NOT NULL too but is refused in `update_candidate` itself, which
# answers 400 with its own message after routing acceptance through the service.
CANDIDATE_UPDATE_REQUIRED_FIELDS = frozenset({"name", "display_order"})


class CandidateUpdate(BaseModel):
    """Schema for updating a candidate"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    statement: Optional[str] = Field(None, max_length=CANDIDATE_STATEMENT_MAX_LENGTH)
    photo_url: Optional[str] = Field(None, max_length=500)
    accepted: Optional[bool] = None
    display_order: Optional[int] = Field(None, ge=INT32_MIN, le=INT32_MAX)

    @model_validator(mode="after")
    def refuse_cleared_required_fields(self) -> "CandidateUpdate":
        _refuse_cleared(self, CANDIDATE_UPDATE_REQUIRED_FIELDS)
        return self


class NominationCreate(BaseModel):
    """Nominate a member (or yourself) for a position during the
    nomination phase. Omit nominee_user_id to self-nominate."""

    position: str = Field(..., min_length=1, max_length=100)
    nominee_user_id: Optional[UUID] = None
    statement: Optional[str] = Field(None, max_length=2000)


class NominationActionResponse(BaseModel):
    """Result of accepting or declining a nomination."""

    success: bool
    message: str


class ManualBallotEntry(BaseModel):
    """One paper-tally line: N ballots for a candidate."""

    candidate_id: UUID
    count: int = Field(..., ge=1, le=500)


class RankedPaperBallot(BaseModel):
    """One ranked paper ballot (or ``count`` identical ones): candidate ids
    in preference order, first choice first.

    A ranked-choice race cannot be entered as per-candidate totals — the
    count needs each ballot's order — so its paper ballots arrive this way.
    """

    rankings: List[UUID] = Field(..., min_length=1, max_length=50)
    count: int = Field(default=1, ge=1, le=500)

    @field_validator("rankings")
    @classmethod
    def no_repeated_candidate(cls, value: List[UUID]) -> List[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("A candidate can be ranked only once on a ballot")
        return value


class ManualBallotsRequest(BaseModel):
    """Record an in-room paper-ballot tally.

    ``entries`` carries per-candidate totals for single-choice and approval
    races; ``ranked_ballots`` carries ballot-by-ballot rankings for
    ranked-choice races. At least one must be present.
    """

    entries: List[ManualBallotEntry] = Field(default_factory=list, max_length=50)
    ranked_ballots: List[RankedPaperBallot] = Field(
        default_factory=list, max_length=500
    )
    notes: Optional[str] = Field(None, max_length=1000)
    ballots_cast: Optional[int] = Field(
        None,
        ge=1,
        le=2000,
        description=(
            "Number of physical ballots this batch was tallied from. "
            "For approval/ranked-choice tallies the per-candidate counts "
            "alone only bound turnout from below; recording the physical "
            "ballot count makes quorum math exact."
        ),
    )
    allow_over_count: bool = Field(
        default=False,
        description=(
            "Bypass the plausibility checks (per-position total ballots and "
            "the attested physical ballot count, each vs eligible voters). "
            "The override is recorded in the audit log."
        ),
    )

    @model_validator(mode="after")
    def has_something_to_record(self) -> "ManualBallotsRequest":
        if not self.entries and not self.ranked_ballots:
            raise ValueError("No ballot entries provided")
        return self


class ManualBallotsResponse(BaseModel):
    """Result of recording paper ballots."""

    recorded: int
    batch_id: Optional[str] = None
    # 'pending' until the required officer attestations are in;
    # 'confirmed' immediately when the org has attestations disabled.
    status: str = "confirmed"
    attestations_required: int = 0
    message: str


class ManualBallotAttestationInfo(BaseModel):
    """One officer's attestation of a paper-tally batch."""

    user_id: Optional[str] = None
    name: Optional[str] = None
    attested_at: Optional[datetime] = None


class ManualBallotBatchTotal(BaseModel):
    """Recorded count for one candidate within a batch."""

    candidate_id: str
    candidate_name: str
    position: Optional[str] = None
    count: int


class ManualBallotBatchInfo(BaseModel):
    """One paper-tally batch with its attestation trail."""

    batch_id: str
    status: str  # pending | confirmed | voided
    recorded_by: Optional[str] = None
    recorded_by_name: Optional[str] = None
    recorded_at: Optional[datetime] = None
    notes: Optional[str] = None
    # Physical ballots the recorder attested for the batch; None on batches
    # recorded before the count existed (turnout falls back to the estimate).
    ballots_cast: Optional[int] = None
    # The recorder overrode the plausibility guard; attesting officers are
    # confirming an implausible count and the card must say so (W50-66).
    over_count_override: bool = False
    required_attestations: int = 0
    # Set only when status is "voided".
    voided_by: Optional[str] = None
    voided_by_name: Optional[str] = None
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    attestations: List[ManualBallotAttestationInfo] = []
    totals: List[ManualBallotBatchTotal] = []
    total_ballots: int = 0


class ManualBallotBatchListResponse(BaseModel):
    """All paper-tally batches for an election."""

    batches: List[ManualBallotBatchInfo]


class AttestManualBallotsResponse(BaseModel):
    """Result of attesting a paper-ballot batch."""

    attestations: int
    required: int
    status: str
    message: str


class VoidManualBallotsRequest(BaseModel):
    """Void every paper ballot recorded in one batch."""

    reason: str = Field(..., min_length=3, max_length=500)


class VoidManualBallotsResponse(BaseModel):
    """Result of voiding a paper-ballot batch."""

    voided: int
    message: str


class CloneElectionRequest(BaseModel):
    """Create a fresh draft from an existing election's setup."""

    title: str = Field(..., min_length=1, max_length=200)
    start_date: datetime
    end_date: datetime
    nomination_deadline: Optional[datetime] = None
    include_candidates: bool = Field(
        default=False,
        description="Also copy the source election's accepted candidates",
    )

    @field_validator("start_date", "end_date", "nomination_deadline")
    @classmethod
    def normalize_datetimes(cls, v: Optional[datetime]) -> Optional[datetime]:
        # See as_utc: naive/aware mix in validate_dates was TypeError (500).
        return as_utc(v)

    @model_validator(mode="after")
    def validate_dates(self) -> "CloneElectionRequest":
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class MergeWriteInsRequest(BaseModel):
    """Consolidate write-in spelling variants under one candidate."""

    source_candidate_ids: List[UUID] = Field(..., min_length=1, max_length=20)
    target_candidate_id: UUID

    @model_validator(mode="after")
    def validate_target_not_source(self) -> "MergeWriteInsRequest":
        if self.target_candidate_id in self.source_candidate_ids:
            raise ValueError("The target candidate cannot also be a source")
        if len(set(self.source_candidate_ids)) != len(self.source_candidate_ids):
            raise ValueError("Duplicate source candidate ids")
        return self


class MergeWriteInsResponse(BaseModel):
    """Result of a write-in consolidation."""

    merged: int
    message: str


class CandidateResponse(UTCResponseBase):
    """Schema for candidate response"""

    id: UUID
    election_id: UUID
    user_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    statement: Optional[str] = None
    photo_url: Optional[str] = Field(None, max_length=500)
    display_order: int = 0
    nomination_date: datetime
    nominated_by: Optional[UUID] = None
    # Set when this (write-in) candidate was consolidated into another;
    # results count its votes under the target candidate.
    merged_into_candidate_id: Optional[str] = None
    accepted: bool
    # A manager accepted for the nominee (W50-38): the list labels it
    # "Accepted by manager". None when the nominee accepted themselves.
    accepted_on_behalf_by: Optional[UUID] = None
    accepted_on_behalf_at: Optional[datetime] = None
    is_write_in: bool
    created_at: datetime
    updated_at: datetime

    # Include vote count if results are visible
    vote_count: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class BallotCandidateResponse(UTCResponseBase):
    """A candidate as a ballot shows it (W50-70): no member ids.

    The emailed ballot's lookup and the in-app ballot served every
    candidate's ``user_id`` and ``nominated_by`` to whoever held a token or
    opened the Cast Vote tab — who nominated whom, and which member account
    each name is, while voting is open. The owner decided ids are withheld
    from everyone but election managers; a ballot needs only what it shows.
    """

    id: UUID
    election_id: UUID
    name: str = Field(..., min_length=1, max_length=200)
    position: Optional[str] = Field(None, max_length=100)
    statement: Optional[str] = None
    photo_url: Optional[str] = Field(None, max_length=500)
    display_order: int = 0
    nomination_date: datetime
    merged_into_candidate_id: Optional[str] = None
    accepted: bool
    is_write_in: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CandidateAcceptance(BaseModel):
    """Schema for accepting/declining a nomination"""

    accepted: bool


# Vote Schemas


class VoteCreate(BaseModel):
    """Schema for casting a vote"""

    election_id: UUID
    candidate_id: UUID
    position: Optional[str] = Field(None, max_length=100)
    vote_rank: Optional[int] = Field(
        None,
        ge=1,
        description="Rank for ranked-choice voting (1 = first choice)",
        le=INT32_MAX,
    )


class VoteResponse(UTCResponseBase):
    """Schema for vote response (limited info for privacy)"""

    id: UUID
    election_id: UUID
    candidate_id: UUID
    position: Optional[str] = None
    voted_at: datetime

    # Only include voter_id if voting is not anonymous
    voter_id: Optional[UUID] = None

    # Voter receipt — can be used to verify the vote was recorded
    receipt_hash: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Election Results and Statistics


class CandidateResult(BaseModel):
    """Results for a single candidate"""

    candidate_id: UUID
    candidate_name: str
    position: Optional[str] = None
    vote_count: int
    percentage: float
    is_winner: bool
    # True when this candidate is part of a top-count tie under most_votes,
    # whatever the tie_policy does with it: under co_winners the tied
    # candidates are also winners; under runoff / revote / chair_decides no
    # winner is declared and the tie is resolved per the policy.
    is_tied: bool = False


class PositionResults(BaseModel):
    """Results for a specific position"""

    position: str
    # Set for a ballot-item contest, whose ``position`` is the item's id;
    # the screen, email and certified PDF show this instead.
    label: Optional[str] = None
    # The ballot item this contest is (None for a plain position with no
    # item) and how it is answered — "candidate_selection" for a race,
    # "approval" for a motion. Each contest is graded on its own (W50-7);
    # the runoff check reads vote_type to leave motions alone.
    ballot_item_id: Optional[str] = None
    vote_type: Optional[str] = None
    total_votes: int
    candidates: List[CandidateResult]
    is_tie: bool = False


class ElectionResults(BaseModel):
    """Complete election results"""

    election_id: UUID
    election_title: str
    status: str
    total_votes: int
    total_eligible_voters: int
    voter_turnout_percentage: float
    # One entry per contest — each position and each ballot item — graded
    # on its own. This is the result.
    results_by_position: List[PositionResults]
    # Only candidates that belong to no contest (a legacy election whose
    # candidates carry no position). Before W50-7 this pooled every
    # contest's candidates into one ranking — one motion's Approve against
    # another's Deny, percentages over the whole ballot — and the results
    # screen, PDF and runoff check read that pool for item-only ballots.
    # Empty whenever every candidate is in a contest.
    overall_results: List[CandidateResult]
    # None means the election has no quorum rule at all (quorum_type
    # "none"), so no surface can honestly say "met" — a default of True
    # certified a quorum on every election, including 0-vote ones (W50-48).
    quorum_met: Optional[bool] = None
    quorum_detail: Optional[str] = None
    tie_policy: Optional[str] = None


class ElectionStats(BaseModel):
    """Election statistics"""

    election_id: UUID
    total_candidates: int
    total_votes_cast: int
    total_eligible_voters: int
    total_voters: int  # Unique voters
    voter_turnout_percentage: float
    votes_by_position: Dict[str, int]
    # Paper-tally transparency: discrepancies between the room count and
    # the electronic count must be visible, not buried in vote rows.
    manual_votes: int = 0
    electronic_votes: int = 0
    voting_timeline: Optional[List[Dict[str, Any]]] = Field(
        None, description="Votes over time for charts"
    )


class VoterEligibility(BaseModel):
    """Check if current user is eligible to vote"""

    is_eligible: bool
    has_voted: bool
    positions_voted: List[str]
    positions_remaining: List[str]
    reason: Optional[str] = Field(None, description="Reason if not eligible")


class BulkVoteItem(BaseModel):
    """A single vote within a bulk submission"""

    candidate_id: UUID
    position: Optional[str] = Field(None, max_length=100)
    vote_rank: Optional[int] = Field(
        None,
        ge=1,
        description="Rank for ranked-choice voting (1 = first choice)",
        le=INT32_MAX,
    )


class BulkVoteCreate(BaseModel):
    """Schema for casting multiple votes atomically.

    Used for multi-position ballots, and for approval / ranked-choice
    elections where a voter legitimately submits several votes at once.
    """

    election_id: UUID
    votes: List[BulkVoteItem] = Field(..., min_length=1, max_length=250)


class EmailBallot(BaseModel):
    """Schema for sending ballot emails"""

    recipient_user_ids: Optional[List[UUID]] = Field(
        None, description="Specific users to email, null means all eligible"
    )
    subject: Optional[str] = Field(None, description="Email subject line")
    message: Optional[str] = Field(None, description="Additional message to include")
    include_ballot_link: bool = Field(
        default=True, description="Include link to voting page"
    )
    send_eligibility_summary: bool = Field(
        default=False,
        description="Email the secretary a summary of who received "
        "ballots and who was skipped with reasons",
    )


class SkippedVoterDetail(BaseModel):
    """Detail about a voter who was skipped during ballot email sending"""

    user_id: str
    name: str
    reason: str


class EmailBallotResponse(BaseModel):
    """Response after sending ballot emails"""

    success: bool
    recipients_count: int
    failed_count: int
    skipped_count: int = 0
    skipped_details: List[SkippedVoterDetail] = []
    message: str


class BallotSendJobResponse(UTCResponseBase):
    """A background ballot send and, once it has finished, its outcome.

    ``kind`` is ballots, reminder, package or announcement. ``status`` is queued, running, completed
    or failed. ``result`` is set on completed and carries what the synchronous
    send-ballot / remind-non-voters endpoint returns; ``error`` is set on
    failed.
    """

    id: str
    election_id: str
    kind: str
    status: str
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    result: Optional[EmailBallotResponse] = None
    error: Optional[str] = None


class ElectionRollback(BaseModel):
    """Schema for rolling back an election"""

    reason: str = Field(
        ..., min_length=10, max_length=500, description="Reason for rollback (required)"
    )


class ElectionRollbackResponse(BaseModel):
    """Response after rolling back an election"""

    success: bool
    election: ElectionResponse
    message: str
    notifications_sent: int


class ElectionReportResponse(BaseModel):
    """Response after sending an election report"""

    success: bool
    message: str


# Pre-Meeting Package Schemas


class PackageRecipient(BaseModel):
    """One prefill recipient for the pre-meeting package modal"""

    user_id: str
    name: str
    email: str


class PackageRecipientsResponse(BaseModel):
    """Prefill recipient list (leadership or eligible voters)"""

    recipients: List[PackageRecipient]


class PreMeetingPackageSend(BaseModel):
    """Send the pre-meeting package to a secretary-edited email list.

    recipient_emails is the FINAL list — prefills are resolved and freely
    edited (including outside addresses) in the modal before submission.
    """

    recipient_emails: List[EmailStr] = Field(..., min_length=1)
    message: Optional[str] = Field(None, max_length=5000)
    include_full_roster: bool = Field(
        default=False,
        description=(
            "Attach the full roster variant including per-member "
            "ineligibility reasons (leadership detail) instead of the "
            "member variant (eligible-voter names and counts only)"
        ),
    )


class PreMeetingPackageResponse(BaseModel):
    """Response after sending the pre-meeting package"""

    success: bool
    message: str
    sent_count: int
    # Addresses the package could not be sent to; empty when all went.
    unreached: List[str] = Field(default_factory=list)


class ElectionDelete(BaseModel):
    """Schema for deleting an election. Reason required for non-draft elections."""

    reason: Optional[str] = Field(
        None,
        min_length=10,
        max_length=500,
        description="Reason for deletion (required for open/closed elections)",
    )


class ElectionDeleteResponse(BaseModel):
    """Response after deleting an election"""

    success: bool
    message: str
    notifications_sent: int


# Attendance Schemas


class AttendeeRecord(BaseModel):
    """Schema for a meeting attendee"""

    user_id: str
    name: str
    checked_in_at: str
    checked_in_by: str


class AttendeeCheckIn(BaseModel):
    """Schema for checking in an attendee"""

    user_id: str = Field(..., description="User ID of the member to check in")


class AttendeeCheckInResponse(BaseModel):
    """Response after checking in an attendee"""

    success: bool
    attendee: AttendeeRecord
    message: str
    total_attendees: int


class ImportMeetingAttendeesResponse(BaseModel):
    """Response after importing attendees from a linked meeting"""

    success: bool
    imported: int
    skipped: int
    total_attendees: int
    message: str


# Ballot Template Schemas


class BallotTemplate(BaseModel):
    """Schema for a pre-configured ballot item template"""

    id: str
    name: str
    description: str
    type: str
    vote_type: str
    eligible_voter_types: List[str]
    require_attendance: bool
    title_template: str = Field(
        ...,
        description="Template string for the ballot item title, may contain {name} placeholder",
    )
    description_template: Optional[str] = None


class BallotTemplatesResponse(BaseModel):
    """Response containing available ballot templates"""

    templates: List[BallotTemplate]


class SavedBallotTemplateItemInput(BallotItemInput):
    """A ballot item inside a saved template, which rejects unknown keys.

    WHY only here: the template body already forbids extras at its top level,
    and an item carrying ``candidates`` was answered 201 and stored without
    them, so the caller believed the candidates were saved. Election
    create/update keep the shared, extra-tolerant :class:`BallotItemInput`
    (owner decision 2026-10-05) — tightening that would reject requests other
    clients send today.
    """

    model_config = ConfigDict(extra="forbid")


class SavedBallotTemplateCreate(BaseModel):
    """Persisted ballot definition that can be reused by the organization."""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2_000)
    ballot_items: List[SavedBallotTemplateItemInput] = Field(
        ..., min_length=1, max_length=250
    )
    voting_method: str = Field(default="simple_majority", max_length=50)
    allow_write_ins: bool = False
    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Template name cannot be blank")
        return value

    @field_validator("voting_method")
    @classmethod
    def validate_voting_method(cls, value: str) -> str:
        return _validate_choice(value, VALID_VOTING_METHODS, "voting method")

    @field_validator("ballot_items")
    @classmethod
    def unique_item_ids(
        cls, values: List[SavedBallotTemplateItemInput]
    ) -> List[SavedBallotTemplateItemInput]:
        return _validate_ballot_item_identities(values)


class SavedBallotTemplateResponse(UTCResponseBase):
    id: UUID
    name: str
    description: Optional[str] = None
    ballot_items: List[BallotItem]
    voting_method: str = "simple_majority"
    allow_write_ins: bool = False
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Ballot Submission Schemas (Token-Based)


class BallotItemVote(BaseModel):
    """A single vote within a ballot submission.

    Exactly one selection form may be used per item:
    - ``choice`` — the single-selection form (yes/no items, single-winner
      candidate items, write-ins). Kept required-compatible for existing
      clients.
    - ``candidate_ids`` — multi-select for approval / multi-vote items.
    - ``rankings`` — ordered candidate ids for ranked-choice items
      (index 0 = rank 1).
    Sending none of the three counts as an abstention.
    """

    ballot_item_id: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="ID of the ballot item being voted on",
    )
    choice: Optional[str] = Field(
        None,
        max_length=200,
        description="'approve', 'deny', 'abstain', 'write_in', or a candidate UUID",
    )
    candidate_ids: Optional[List[str]] = Field(
        None,
        description="Multi-select candidate ids (approval / multi-vote items)",
    )
    rankings: Optional[List[str]] = Field(
        None,
        description="Ordered candidate ids, index 0 = rank 1 (ranked choice)",
    )
    write_in_name: Optional[str] = Field(
        None, min_length=1, max_length=200, description="Name for write-in votes"
    )
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_selection(self) -> "BallotItemVote":
        forms = [
            self.choice is not None,
            self.candidate_ids is not None,
            self.rankings is not None,
        ]
        if sum(forms) > 1:
            raise ValueError(
                "Use only one of choice, candidate_ids, or rankings per item"
            )
        for label, ids in (
            ("candidate_ids", self.candidate_ids),
            ("rankings", self.rankings),
        ):
            if ids is None:
                continue
            if not ids:
                raise ValueError(f"{label} must not be empty when provided")
            if len(ids) > 50:
                raise ValueError(f"{label} cannot exceed 50 entries")
            if len(set(ids)) != len(ids):
                raise ValueError(f"{label} contains duplicate candidates")
            for cid in ids:
                try:
                    UUID(cid)
                except (ValueError, TypeError):
                    raise ValueError(f"{label} entries must be candidate UUIDs")
        return self


class BallotSubmission(BaseModel):
    """Full ballot submission with all votes"""

    votes: List[BallotItemVote] = Field(
        ...,
        min_length=1,
        max_length=250,
        description="List of votes, one per ballot item",
    )
    model_config = ConfigDict(extra="forbid")

    @field_validator("votes")
    @classmethod
    def ballot_items_must_be_unique(
        cls, votes: List[BallotItemVote]
    ) -> List[BallotItemVote]:
        item_ids = [vote.ballot_item_id for vote in votes]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("Only one vote entry may be submitted per ballot item")
        return votes


class BallotSubmissionResponse(BaseModel):
    """Response after submitting a ballot"""

    success: bool
    votes_cast: int
    abstentions: int
    message: str
    # Receipts the voter can keep to verify their votes were recorded
    # (via GET /{election_id}/verify-receipt) without revealing content
    receipt_hashes: List[str] = []


class MemberBallotSubmission(BallotSubmission):
    """A signed-in member's ballot (the in-app Cast Vote tab): the emailed
    ballot's shape, optionally cast as the holder of a proxy."""

    proxy_authorization_id: Optional[str] = Field(default=None, max_length=64)


class MemberBallotItemStatus(BaseModel):
    """Whether the voter may vote on one ballot item, and whether they have."""

    ballot_item_id: str
    eligible: bool
    reason: Optional[str] = None
    voted: bool = False


class MemberBallotProxy(BaseModel):
    authorization_id: str
    delegating_user_id: Optional[str] = None
    delegating_user_name: Optional[str] = None


class MemberBallotResponse(BaseModel):
    """The in-app ballot: every contest the emailed ballot carries (plain
    positions included, served as ballot items), the candidates, and this
    voter's per-item standing."""

    election: BallotElectionResponse
    candidates: List[BallotCandidateResponse] = []
    items: List[MemberBallotItemStatus] = []
    proxy: Optional[MemberBallotProxy] = None


class MyProxyAuthorizationsResponse(BaseModel):
    """The live authorizations naming the caller as proxy holder."""

    proxies: List[MemberBallotProxy] = []
    # Set when the caller holds proxies that cannot be voted here (proxy
    # voting off for the department, or an anonymous election).
    unavailable_reason: Optional[str] = None


# Proxy Voting Schemas


class ProxyAuthorizationCreate(BaseModel):
    """Request to authorize one member to vote on behalf of another"""

    delegating_user_id: UUID = Field(
        ..., description="The absent member who is delegating their vote"
    )
    proxy_user_id: UUID = Field(
        ..., description="The member who will cast the vote on their behalf"
    )
    proxy_type: str = Field(
        default="single_election",
        description="'single_election' (one-time for this election) or 'regular' (standing proxy for future elections)",
    )
    reason: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Why the proxy is being authorized",
    )
    anonymity_acknowledged: bool = Field(
        default=False,
        description=(
            "Required on an anonymous election: the delegating member has "
            "been told, and accepts, that their proxy holder sees how they "
            "vote and that the proxy ballot is stored linked to them."
        ),
    )

    @field_validator("proxy_type")
    @classmethod
    def validate_proxy_type(cls, v: str) -> str:
        if v not in {"single_election", "regular"}:
            raise ValueError("proxy_type must be 'single_election' or 'regular'")
        return v


class ProxyAuthorizationResponse(BaseModel):
    """A proxy authorization record"""

    id: str
    delegating_user_id: str
    delegating_user_name: str
    proxy_user_id: str
    proxy_user_name: str
    proxy_type: str
    reason: str
    authorized_by: str
    authorized_by_name: str
    authorized_at: str
    revoked_at: Optional[str] = None
    # Set when the delegating member acknowledged that this proxy ballot is
    # attributable (anonymous elections only; W50-2 / ELEC-43).
    anonymity_acknowledged_at: Optional[str] = None


class ProxyAuthorizationListResponse(BaseModel):
    """List of proxy authorizations for an election"""

    election_id: str
    election_title: str
    proxy_voting_enabled: bool
    anonymous_voting: bool = False
    authorizations: List[ProxyAuthorizationResponse]


class ProxyVoteCreate(BaseModel):
    """Cast a vote on behalf of another member using a proxy authorization"""

    election_id: UUID
    candidate_id: UUID
    proxy_authorization_id: str = Field(
        ..., description="ID of the proxy authorization being used"
    )
    position: Optional[str] = Field(None, max_length=100)
    vote_rank: Optional[int] = Field(
        None, ge=1, description="Rank for ranked-choice voting", le=INT32_MAX
    )


# ============================================
# Response Models for Previously Untyped Endpoints
# ============================================


class SuccessResponse(BaseModel):
    """Generic success response for simple operations"""

    success: bool
    message: str


class ElectionSettingsResponse(BaseModel):
    """Organization-level election settings"""

    default_voting_method: Optional[str] = "simple_majority"
    default_victory_condition: Optional[str] = "most_votes"
    default_victory_percentage: Optional[int] = None
    default_anonymous_voting: Optional[bool] = True
    default_allow_write_ins: Optional[bool] = False
    default_quorum_type: Optional[str] = "none"
    default_quorum_value: Optional[int] = None
    proxy_voting_enabled: Optional[bool] = False
    max_proxies_per_person: Optional[int] = 1
    # Per-department feature toggles (all default ON)
    nominations_enabled: bool = True
    paper_ballots_enabled: bool = True
    reminders_enabled: bool = True
    auto_open_enabled: bool = True
    # Officers (other than the recorder) who must attest a paper-ballot
    # batch before its votes count. 0 disables attestation.
    paper_ballot_attestations_required: Optional[int] = 2
    eligibility: EligibilityDefaults = Field(default_factory=EligibilityDefaults)
    # The annual meeting's own defaults; null means it uses ``eligibility``.
    annual_eligibility: Optional[EligibilityDefaults] = None
    # Each membership tier's own voting rules, read-only here: they are
    # edited on the membership tier settings and apply alongside these.
    tier_voting_rules: List[TierVotingRule] = Field(default_factory=list)
    security: Optional[Dict[str, Any]] = None


class MemberWaitOutcome(BaseModel):
    """Where a member stands against one meeting kind's waiting period."""

    meeting_kind: str
    state: str = Field(..., description="no_rule, never, waived, eligible or waiting")
    months: Optional[int] = None
    eligible_from: Optional[date] = None
    reason: Optional[str] = None


class MemberVotingEligibilityResponse(BaseModel):
    """A member's voting waiting period, for their profile."""

    user_id: str
    member_type: Optional[str] = None
    member_type_label: Optional[str] = None
    # When the member became their type, as recorded (before any override).
    type_since: Optional[date] = None
    # The date the wait actually counts from (override, else type_since
    # clamped to the current stint).
    wait_starts: Optional[date] = None
    voting_wait_from: Optional[date] = None
    voting_wait_waived: bool = False
    voting_wait_override_reason: Optional[str] = None
    # One per meeting kind, under the department's current defaults.
    outcomes: List[MemberWaitOutcome] = Field(default_factory=list)


class MemberVotingEligibilityUpdate(BaseModel):
    """A secretary's per-member override of the voting waiting period.

    Omit a field to leave it alone; ``voting_wait_from: null`` clears the
    date. ``reason`` is required whenever the result leaves an override in
    place, and is cleared with the last of them.
    """

    model_config = ConfigDict(extra="forbid")

    voting_wait_from: Optional[date] = None
    voting_wait_waived: Optional[bool] = None
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("voting_wait_waived", mode="before")
    @classmethod
    def waived_must_be_boolean(cls, value):
        if value is None:
            raise ValueError("voting_wait_waived must be true or false")
        return value

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: Optional[str]) -> Optional[str]:
        return (value or "").strip() or None


class NonVoterRecord(BaseModel):
    """A voter who hasn't voted yet"""

    id: str
    full_name: str
    email: str


class NonVotersResponse(BaseModel):
    """Response for non-voters endpoint"""

    non_voters: List[NonVoterRecord]
    count: int


class VoteIntegrityResponse(BaseModel):
    """Response for vote integrity check.

    These names are the ones `ElectionService.verify_vote_integrity` produces
    and the ones the frontend's `VoteIntegrityResult` reads. The model
    previously required an entirely different vocabulary — `election_title`,
    `total_votes_checked`, `valid_votes`, `invalid_votes`, `chain_valid` —
    none of which the service returns, so every call to `/integrity` failed
    response validation and the Forensics panel's integrity check was a 500.
    """

    election_id: str
    total_votes: int
    # total_votes = counted + pending paper + test: every chained row is
    # checked, but only counted_votes appear in the tally (W50-65)
    counted_votes: int = 0
    pending_paper_votes: int = 0
    test_votes: int = 0
    valid_signatures: int
    unsigned_votes: int
    tampered_votes: int
    tampered_vote_ids: List[str] = Field(default_factory=list)
    chain_verified: bool
    chain_break_at: Optional[str] = None
    integrity_status: str
    error: Optional[str] = None
    # Voided votes stay in the chain and are verified with it (W50-31);
    # they are reported here rather than reading as a broken chain.
    voided_votes: int = 0
    voids: List["VoteVoidSummary"] = []


class VoteVoidSummary(BaseModel):
    """Voided votes sharing one officer and reason (W50-31)."""

    count: int
    voided_by: Optional[str] = None
    voided_by_name: Optional[str] = None
    reason: str = ""
    voided_at: Optional[str] = None


VoteIntegrityResponse.model_rebuild()
ElectionResponse.model_rebuild()


class SoftDeleteVoteResponse(BaseModel):
    """Response after soft-deleting a vote"""

    message: str
    vote_id: str


class DeletedVoteRecord(BaseModel):
    """A single soft-deleted vote in the forensics report"""

    vote_id: str
    # None on an anonymous election: the choice would join to the voter
    # through the audit log's vote_id (W50-2)
    candidate_id: Optional[str] = None
    position: Optional[str] = None
    deleted_at: Optional[str] = None
    deleted_by: Optional[str] = None
    deletion_reason: Optional[str] = None
    is_manual: bool = False
    manual_batch_id: Optional[str] = None


class DeletedVotesSummary(BaseModel):
    """Deleted votes section of forensics report"""

    count: int
    # Distinct voided paper batches among ``records`` — a voided batch is
    # one action, not ``count`` voided votes (W50-65)
    paper_batch_count: int = 0
    records: List[DeletedVoteRecord]


class TokenAccessRecord(BaseModel):
    """A single voting token access record"""

    token_id: str
    used: bool
    used_at: Optional[str] = None
    superseded_at: Optional[str] = None
    first_accessed_at: Optional[str] = None
    access_count: int = 0
    positions_voted: Optional[List[str]] = None
    created_at: Optional[str] = None
    expires_at: Optional[str] = None


class VotingTokensSummary(BaseModel):
    """Voting tokens section of forensics report"""

    total_issued: int
    total_used: int
    # issued = used + superseded + expired + live (W50-65)
    total_superseded: int = 0
    total_expired: int = 0
    total_live: int = 0
    records: List[TokenAccessRecord]


class AuditLogEntry(BaseModel):
    """A single audit log entry"""

    id: str
    timestamp: Optional[str] = None
    event_type: str
    severity: Optional[str] = None
    user_id: Optional[str] = None
    ip_address: Optional[str] = None
    event_data: Optional[Dict[str, Any]] = None


class AuditLogSummary(BaseModel):
    """Audit log section of forensics report"""

    total_entries: int
    entries: List[AuditLogEntry]


class AnomalyDetection(BaseModel):
    """Anomaly detection section of forensics report.

    SEC (ELEC-6): deliberately does NOT expose a full per-IP vote map —
    only the thresholded suspicious set plus an aggregate count. A full
    distribution allowed vote-to-voter correlation in small departments.
    """

    suspicious_ips: Dict[str, int] = {}
    unique_ip_count: int = 0
    # True once an anonymous election has closed and per-vote IP/user-agent
    # metadata has been purged (counts above will be empty/"unknown")
    ip_metadata_purged: bool = False


class ProxyVoteRecord(BaseModel):
    """A single proxy vote in the forensics report"""

    vote_id: str
    position: Optional[str] = None
    proxy_voter_id: Optional[str] = None
    delegating_user_id: Optional[str] = None
    authorization_id: Optional[str] = None
    voted_at: Optional[str] = None


class ProxyVotingSummary(BaseModel):
    """Proxy voting section of forensics report"""

    authorizations: List[Dict[str, Any]] = []
    total_proxy_votes: int = 0
    proxy_votes: List[ProxyVoteRecord] = []


class ForensicsResponse(BaseModel):
    """Response for election forensics report"""

    election_id: str
    election_title: str
    election_status: str
    anonymous_voting: bool
    voting_method: str
    created_at: Optional[str] = None
    vote_integrity: Optional[Dict[str, Any]] = None
    deleted_votes: Optional[DeletedVotesSummary] = None
    rollback_history: Optional[List[Dict[str, Any]]] = None
    voting_tokens: Optional[VotingTokensSummary] = None
    audit_log: Optional[AuditLogSummary] = None
    anomaly_detection: Optional[AnomalyDetection] = None
    proxy_voting: Optional[ProxyVotingSummary] = None
    voting_timeline: Optional[Dict[str, int]] = None
    # IANA zone the timeline's hour buckets are keyed in
    voting_timeline_timezone: Optional[str] = None


class AttendeeListResponse(BaseModel):
    """Response for attendance list"""

    attendees: List[AttendeeRecord]
    total: int


class VoterOverrideRecord(BaseModel):
    """A single voter override entry"""

    user_id: str
    member_name: Optional[str] = None
    reason: str
    overridden_by: str
    overridden_by_name: Optional[str] = None
    overridden_at: str


class VoterOverrideListResponse(BaseModel):
    """Response for voter override list"""

    election_id: str
    election_title: str
    overrides: List[VoterOverrideRecord]


class BulkVoterOverrideAddedMember(BaseModel):
    """A member who was added in a bulk override operation"""

    user_id: str
    name: str


class BulkVoterOverrideResponse(BaseModel):
    """Response for bulk voter override"""

    success: bool
    added: List[BulkVoterOverrideAddedMember]
    added_count: int
    skipped_count: int
    message: str


class TestBallotResponse(BaseModel):
    """Response for test ballot send"""

    success: bool
    message: str


class BallotPreviewCandidate(BaseModel):
    """Simplified candidate for ballot preview"""

    id: str
    name: str
    position: Optional[str] = None
    statement: Optional[str] = None


class BallotPreviewEligibility(BaseModel):
    """Eligibility summary for ballot preview"""

    is_eligible: bool
    reason: Optional[str] = None


class BallotPreviewResponse(BaseModel):
    """Response for ballot preview endpoint"""

    election_id: str
    election_title: str
    user_id: str
    user_name: str
    overall_eligibility: BallotPreviewEligibility
    ballot_items: List[Dict[str, Any]]
    candidates: List[BallotPreviewCandidate]
    eligible_item_count: int
    total_item_count: int
    would_receive_ballot: bool


class VoteReceiptResponse(BaseModel):
    """Response for vote receipt verification"""

    verified: bool
    # A test-ballot receipt verifies (the vote exists) but is never counted;
    # the two are reported separately so the page does not have to parse
    # the message to tell them apart.
    counted: bool = False
    # A voided vote's receipt still matches a row, and the voter deserves to
    # hear that an officer voided it rather than that no such vote exists
    # (W50-54). Reported as its own flag so the page can say so without
    # parsing the message.
    voided: bool = False
    message: str
    voted_at: Optional[str] = None
    position: Optional[str] = None


# Eligibility Roster (Secretary View)


class RosterItemEligibility(BaseModel):
    """Per-ballot-item eligibility for one member"""

    ballot_item_id: str
    ballot_item_title: str
    eligible: bool
    reason: Optional[str] = None


class RosterMember(BaseModel):
    """A single member's eligibility status in the roster"""

    user_id: str
    full_name: str
    email: str
    membership_type: str
    has_override: bool
    has_voted: bool
    is_attending: bool
    will_receive_ballot: bool
    # True once a live send or reminder delivered this member a ballot
    ballot_sent: bool = False
    eligible_item_count: int
    total_item_count: int
    ineligibility_reason: Optional[str] = None
    item_eligibility: List[RosterItemEligibility] = []


class EligibilityRosterResponse(BaseModel):
    """Full eligibility roster for secretary dashboard"""

    election_id: str
    election_title: str
    election_status: str
    total_members: int
    total_eligible: int
    total_ineligible: int
    total_voted: int
    total_overrides: int
    total_ballots_sent: int = 0
    email_sent_at: Optional[datetime] = None
    roster: List[RosterMember]
