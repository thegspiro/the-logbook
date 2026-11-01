"""
Shift evaluation template schemas

These are the write-side authority for the template's JSON columns
(Pitfall #20): every create and update passes through
``ShiftEvaluationTemplateWrite``, which settles each column onto one canonical
shape, so readers never have to tell variants apart.

Keys on sections, items and header fields are what a filled-out evaluation
will reference, so they are kept when the client sends them back and minted
only for a new entry. Renaming an item's label therefore does not orphan the
ratings already given against it.
"""

import re
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.base import UTCResponseBase
from app.utils.positions import canonical_position

_KEY_PATTERN = re.compile(r"^[a-z0-9_-]{1,40}$")

# Bounds on a JSON column every shift-report read will deserialize. A paper
# form has a dozen or two items; these leave generous room without letting a
# runaway editor store thousands.
MAX_SCALE_LEVELS = 10
MAX_HEADER_FIELDS = 10
MAX_CHOICE_OPTIONS = 20
MAX_SECTIONS = 20
MAX_ITEMS_PER_SECTION = 50
MAX_ITEMS_TOTAL = 150
MAX_EVALUATED_SEATS = 30

EvaluatorRule = Literal["shift_officer"]
GeneralShiftEvaluationMode = Literal["off", "optional", "required"]
StatisticKey = Literal["calls", "transports", "refusals"]

# tests/test_shift_evaluation_templates.py holds these Literals equal to the
# model's tuples, which later readers use.


def _mint_key() -> str:
    return uuid.uuid4().hex[:12]


def _settle_key(value: Optional[str]) -> str:
    if value is None or value == "":
        return _mint_key()
    if not _KEY_PATTERN.match(value):
        raise ValueError(
            "Keys may use only lowercase letters, digits, '-' and '_' "
            "(at most 40 characters)"
        )
    return value


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


class ScaleLevel(BaseModel):
    value: int = Field(..., ge=0, le=100)
    label: str = Field(..., min_length=1, max_length=100)

    @field_validator("label")
    @classmethod
    def _strip_label(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Each rating needs a label")
        return cleaned


class HeaderField(BaseModel):
    key: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=100)
    type: Literal["text", "choice"] = "text"
    options: List[str] = Field(default_factory=list, max_length=MAX_CHOICE_OPTIONS)
    required: bool = False

    @model_validator(mode="after")
    def _settle(self) -> "HeaderField":
        self.key = _settle_key(self.key)
        self.label = self.label.strip()
        if not self.label:
            raise ValueError("Each header field needs a label")
        options: List[str] = []
        for option in self.options:
            cleaned = option.strip()
            if not cleaned:
                continue
            if len(cleaned) > 50:
                raise ValueError("Choice options are limited to 50 characters")
            if cleaned not in options:
                options.append(cleaned)
        if self.type == "choice" and len(options) < 2:
            raise ValueError(
                f"'{self.label}' needs at least two options to choose from"
            )
        # A text field carries no options; storing stale ones from a field
        # that was switched from choice would leave a second shape behind.
        self.options = options if self.type == "choice" else []
        return self


class TemplateItem(BaseModel):
    key: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=300)
    comment_always_required: bool = False

    @model_validator(mode="after")
    def _settle(self) -> "TemplateItem":
        self.key = _settle_key(self.key)
        self.label = self.label.strip()
        if not self.label:
            raise ValueError("Each item needs a name")
        self.description = _clean_text(self.description)
        return self


class TemplateSection(BaseModel):
    key: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=150)
    column_heading: str = Field("Skill", min_length=1, max_length=60)
    items: List[TemplateItem] = Field(
        ..., min_length=1, max_length=MAX_ITEMS_PER_SECTION
    )

    @model_validator(mode="after")
    def _settle(self) -> "TemplateSection":
        self.key = _settle_key(self.key)
        self.title = self.title.strip()
        self.column_heading = self.column_heading.strip() or "Skill"
        if not self.title:
            raise ValueError("Each section needs a title")
        return self


class ShiftEvaluationTemplateWrite(BaseModel):
    """A whole template, as the editor saves it.

    Create and update take the same body: the editor always sends the full
    form, and a partial update of nested JSON would need merge rules nobody
    could predict.
    """

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    is_active: bool = True

    scale: List[ScaleLevel] = Field(..., min_length=2, max_length=MAX_SCALE_LEVELS)
    allow_not_applicable: bool = True
    not_applicable_label: str = Field("Not Observed", min_length=1, max_length=100)
    comment_required_at_or_below: Optional[int] = Field(None, ge=0, le=100)

    header_fields: List[HeaderField] = Field(
        default_factory=list, max_length=MAX_HEADER_FIELDS
    )
    statistics: List[StatisticKey] = Field(default_factory=list)
    sections: List[TemplateSection] = Field(..., min_length=1, max_length=MAX_SECTIONS)
    closing_comments_label: Optional[str] = Field(None, max_length=200)
    closing_comments_hint: Optional[str] = Field(None, max_length=500)

    evaluator_rule: EvaluatorRule = "shift_officer"
    evaluated_seats: List[str] = Field(
        default_factory=list, max_length=MAX_EVALUATED_SEATS
    )

    @model_validator(mode="after")
    def _settle(self) -> "ShiftEvaluationTemplateWrite":
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("The template needs a name")
        self.description = _clean_text(self.description)
        self.not_applicable_label = self.not_applicable_label.strip() or "Not Observed"
        self.closing_comments_label = _clean_text(self.closing_comments_label)
        self.closing_comments_hint = _clean_text(self.closing_comments_hint)
        if self.closing_comments_label is None:
            # A hint under a section that is not shown is a stale value.
            self.closing_comments_hint = None

        values = [level.value for level in self.scale]
        if len(set(values)) != len(values):
            raise ValueError("Each rating value may appear only once")
        self.scale = sorted(self.scale, key=lambda level: level.value)
        if (
            self.comment_required_at_or_below is not None
            and self.comment_required_at_or_below not in values
        ):
            raise ValueError(
                "'Comment required at or below' must be one of the rating values"
            )

        seen_stats: List[StatisticKey] = []
        for stat in self.statistics:
            if stat not in seen_stats:
                seen_stats.append(stat)
        self.statistics = seen_stats

        seats: List[str] = []
        for seat in self.evaluated_seats:
            if len(seat) > 100:
                raise ValueError("Seat names are limited to 100 characters")
            token = canonical_position(seat)
            if token and token not in seats:
                seats.append(token)
        self.evaluated_seats = seats

        _assert_unique([f.key for f in self.header_fields], "header field")
        _assert_unique([s.key for s in self.sections], "section")
        item_keys = [item.key for s in self.sections for item in s.items]
        if len(item_keys) > MAX_ITEMS_TOTAL:
            raise ValueError(f"A template may have at most {MAX_ITEMS_TOTAL} items")
        _assert_unique(item_keys, "item")
        return self

    def column_values(self) -> dict:
        """The model columns this body writes, in their stored shape."""
        return {
            "name": self.name,
            "description": self.description,
            "is_active": self.is_active,
            "scale": [level.model_dump() for level in self.scale],
            "allow_not_applicable": self.allow_not_applicable,
            "not_applicable_label": self.not_applicable_label,
            "comment_required_at_or_below": self.comment_required_at_or_below,
            "header_fields": [field.model_dump() for field in self.header_fields],
            "statistics": list(self.statistics),
            "sections": [section.model_dump() for section in self.sections],
            "closing_comments_label": self.closing_comments_label,
            "closing_comments_hint": self.closing_comments_hint,
            "evaluator_rule": self.evaluator_rule,
            "evaluated_seats": list(self.evaluated_seats),
        }


def _assert_unique(keys: List[Optional[str]], label: str) -> None:
    if len(set(keys)) != len(keys):
        raise ValueError(f"Two entries share the same {label} key")


class ShiftEvaluationTemplateResponse(UTCResponseBase):
    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    is_active: bool
    version: int

    scale: List[ScaleLevel]
    allow_not_applicable: bool
    not_applicable_label: str
    comment_required_at_or_below: Optional[int] = None
    header_fields: List[HeaderField]
    statistics: List[str]
    sections: List[TemplateSection]
    closing_comments_label: Optional[str] = None
    closing_comments_hint: Optional[str] = None
    evaluator_rule: str
    evaluated_seats: List[str]

    # Programs that name this template, for the list and for warning before a
    # delete clears their form.
    program_names: List[str] = Field(default_factory=list)
    is_general_form: bool = False

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ShiftEvaluationSettingsResponse(BaseModel):
    general_shift_evaluation_template_id: Optional[str] = None
    general_shift_evaluation_mode: GeneralShiftEvaluationMode = "off"
    one_shift_evaluation_for_multiple_programs: bool = False


class ShiftEvaluationSettingsUpdate(BaseModel):
    """Omitted fields are left alone; a null template clears the general form."""

    general_shift_evaluation_template_id: Optional[uuid.UUID] = None
    general_shift_evaluation_mode: Optional[GeneralShiftEvaluationMode] = None
    one_shift_evaluation_for_multiple_programs: Optional[bool] = None
