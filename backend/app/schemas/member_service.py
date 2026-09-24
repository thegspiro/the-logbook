"""
Schemas for a member's service history (length-of-service stints).
"""

from datetime import date
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.organization import RejoinServiceCredit


class SeparationStatus(str, Enum):
    """How a closed stint ended."""

    DROPPED_VOLUNTARY = "dropped_voluntary"
    DROPPED_INVOLUNTARY = "dropped_involuntary"
    RETIRED = "retired"


class ServicePeriodResponse(BaseModel):
    # None for the stint implied by hire_date when nothing is recorded yet.
    id: Optional[str] = None
    start_date: Optional[date] = None
    start_is_hire_date: bool = False
    end_date: Optional[date] = None
    separation_status: Optional[str] = None
    counts_toward_service: bool = True
    notes: Optional[str] = None
    days: int = 0


class ServiceHistoryResponse(BaseModel):
    user_id: str
    hire_date: Optional[date] = None
    periods: List[ServicePeriodResponse]
    credited_days: int
    credited_years: int
    prior_days: int
    effective_service_start: Optional[date] = None
    is_recorded: bool = Field(
        ..., description="False when service is inferred from hire_date alone"
    )
    is_estimated: bool = Field(
        ...,
        description=(
            "True when the member is separated with no recorded stints, so the "
            "end of their service was inferred from their last status change"
        ),
    )
    default_rejoin_credit: RejoinServiceCredit


class ServicePeriodItem(BaseModel):
    """One stint in a full replacement of a member's service history."""

    id: Optional[str] = Field(None, max_length=36)
    start_date: Optional[date] = Field(
        None, description="None means the member's hire date"
    )
    end_date: Optional[date] = Field(None, description="None means still serving")
    counts_toward_service: bool = True
    separation_status: Optional[SeparationStatus] = None
    notes: Optional[str] = Field(None, max_length=2000)


class ServiceHistoryReplace(BaseModel):
    periods: List[ServicePeriodItem] = Field(..., max_length=100)


class RejoinServiceOptions(BaseModel):
    """Fields a reinstatement accepts to decide how earlier service counts."""

    service_credit: Optional[RejoinServiceCredit] = Field(
        None,
        description=(
            "'continue' keeps crediting earlier stints; 'restart' starts service "
            "at zero and keeps them as prior service. Defaults to the "
            "department's setting."
        ),
    )
    rejoin_date: Optional[date] = Field(
        None, description="First day of the new stint; defaults to today"
    )
    previous_service_end: Optional[date] = Field(
        None,
        description=(
            "Last day of earlier service, used only when none is recorded yet "
            "(otherwise inferred from the member's last status change)"
        ),
    )
