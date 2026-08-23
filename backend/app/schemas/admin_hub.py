"""
Schemas for the administration-page frame.

Every admin page renders the same three data-driven pieces — four headline
metrics, a "Needs attention" queue, and the settings screen that chooses the
metrics. The shapes below are shared by all modules; only the *content* of the
queue differs, which is the whole point of the pattern.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_camel_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)


class AdminMetric(BaseModel):
    """One of the four cards in the metrics row."""

    model_config = _camel_config

    key: str
    label: str
    #: Pre-formatted for display ("87%", "1,840") because the unit belongs with
    #: the number, and a client that re-formats it invents its own rounding.
    value: str
    context: str = ""
    #: True for the fourth slot, which always reports the attention count.
    fixed: bool = False


class AdminAttentionItem(BaseModel):
    """One exception the module wants an admin to end today.

    The writing rule, from the pattern: a named subject, an age or a deadline,
    and one action that finishes it. Anything that cannot be acted on today
    belongs in a metric instead.
    """

    model_config = _camel_config

    key: str
    title: str
    detail: str = ""
    action_label: str
    href: str
    #: "critical" outranks "warning" in the queue's sort order.
    severity: str = "warning"
    count: int = 0
    oldest_age_days: Optional[int] = None


class AdminHubSummary(BaseModel):
    """The frame's data for one module."""

    model_config = _camel_config

    module_key: str
    generated_at: datetime
    timezone: str
    metrics: List[AdminMetric]
    attention: List[AdminAttentionItem]


class AdminMetricOption(BaseModel):
    """A metric a module could show, and whether it can be chosen right now."""

    model_config = _camel_config

    key: str
    label: str
    description: str
    #: Current value, so the settings list can show what an admin would gain.
    value: Optional[str] = None
    #: Filled when the metric cannot be selected — a module that is off, or a
    #: field the department has never entered. Shown rather than hidden, so an
    #: admin can see what enabling a module would buy them.
    unavailable_reason: Optional[str] = None
    #: The always-on fourth slot. Listed, never selectable, never removable.
    fixed: bool = False


class AdminMetricSettings(BaseModel):
    """The settings screen's whole state for one module."""

    model_config = _camel_config

    module_key: str
    options: List[AdminMetricOption]
    #: The three chosen open slots, in display order.
    selected: List[str]
    applies_to_everyone: bool
    #: True when the caller's selection is their own rather than inherited.
    is_personal: bool
    #: The department-wide selection, so the screen can offer "reset".
    department_default: List[str]
    #: The module's built-in default, which a reset with no department row
    #: falls back to.
    built_in_default: List[str]


class AdminMetricSettingsUpdate(BaseModel):
    """Save body for the metrics settings screen.

    Every field the screen owns is sent on every save — an omitted key on an
    update path is how a cleared value silently survives (CLAUDE.md Pitfall #1).
    """

    model_config = _camel_config

    metric_keys: List[str] = Field(..., min_length=0, max_length=3)
    applies_to_everyone: bool
