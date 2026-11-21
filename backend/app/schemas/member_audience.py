"""Schemas for choosing which members an email goes to.

Shared by the apparatus-event open-seat email and the request pipeline's
volunteer call; see ``app/services/member_audience.py`` for the rules.
Snake_case on the wire, like both modules that use it.
"""

from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints

from app.services.member_audience import AudienceFilter

_Value = Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)]
_Id = Annotated[str, StringConstraints(strip_whitespace=True, max_length=36)]


class MemberAudiencePayload(BaseModel):
    """Which members to email. An empty or omitted list does not narrow."""

    member_classes: List[_Value] = Field(default_factory=list, max_length=10)
    member_statuses: List[_Value] = Field(default_factory=list, max_length=50)
    position_ids: List[_Id] = Field(default_factory=list, max_length=200)

    def to_filter(self) -> AudienceFilter:
        return AudienceFilter(
            member_classes=tuple(self.member_classes),
            member_statuses=tuple(self.member_statuses),
            position_ids=tuple(self.position_ids),
        )


class MemberStatusOption(BaseModel):
    value: str
    # Set for a department's own tier; the frontend names built-in statuses.
    label: Optional[str] = None


class PositionOption(BaseModel):
    id: str
    name: str


class MemberAudienceOptions(BaseModel):
    member_classes: List[str]
    member_statuses: List[MemberStatusOption]
    positions: List[PositionOption]


class MemberAudiencePreview(BaseModel):
    """How many members a send with these choices would reach."""

    recipients: int
    skipped_opted_out: int
