"""Yearly outreach goals: requests and the progress response (snake_case, as
the CRR and Outreach Impact schemas are)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.services.outreach_goal_service import MAX_TARGET, MAX_YEAR, MIN_YEAR

OutreachMetric = Literal["events_held", "people_reached", "member_hours"]


class OutreachGoalCreate(BaseModel):
    year: int = Field(ge=MIN_YEAR, le=MAX_YEAR)
    target: int = Field(ge=1, le=MAX_TARGET)
    measure_id: Optional[str] = Field(default=None, max_length=36)
    outreach_metric: Optional[OutreachMetric] = None

    @model_validator(mode="after")
    def _one_target(self) -> "OutreachGoalCreate":
        if (self.measure_id is None) == (self.outreach_metric is None):
            raise ValueError("Choose either a CRR count or an outreach figure")
        return self


class OutreachGoalUpdate(BaseModel):
    target: int = Field(ge=1, le=MAX_TARGET)


class OutreachGoalProgress(BaseModel):
    id: str
    year: int
    kind: Literal["crr_measure", "outreach"]
    measure_id: Optional[str] = None
    outreach_metric: Optional[OutreachMetric] = None
    # "Events held", or "Smoke alarm install · Alarms installed".
    label: str
    target: int
    actual: float
    # Where the goal should be by now if the year's work were spread evenly.
    pace_target: float
    met: bool
    on_pace: bool


class OutreachMetricOption(BaseModel):
    value: OutreachMetric
    label: str


class OutreachGoalsResponse(BaseModel):
    year: int
    # The department's current year, so a screen can tell this year's goals
    # from last year's or next year's.
    current_year: int
    # How much of the year has gone, 0 to 1.
    year_fraction: float
    year_complete: bool
    goals: list[OutreachGoalProgress]
    metrics: list[OutreachMetricOption]
