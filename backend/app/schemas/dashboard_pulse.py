"""Layout of the dashboard's "Department pulse" cards.

A layout is an ordered list of the cards a department or a member wants, each
with a show/hide flag and an optional replacement title, plus the reporting
period the section opens on. Two places store one:

* ``Organization.settings["dashboard_pulse"]`` — the department default,
  written by a holder of ``settings.manage``.
* ``User.dashboard_pulse`` — a member's own override, written only by that
  member.

The stored JSON is free-form, so everything read back goes through
``normalize_pulse_layout`` and degrades to "not set" instead of raising: this is
read on every dashboard load, and a malformed value must cost the layout, not
the page (pitfall #19).

A layout only expresses *preference*. Which cards a member may see at all is
still decided by ``GET /dashboard/widgets`` — a card whose block the server
returned as ``null`` is never rendered, whatever the layout says.
"""

import re
from typing import Any, Literal, Optional, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator

PulseCardId = Literal[
    "dues",
    "cash_flow",
    "budget_threshold",
    "grant_deadlines",
    "application_stages",
    "campaign_progress",
    "community_engagement",
    "public_requests",
]

PULSE_CARD_IDS: tuple[PulseCardId, ...] = get_args(PulseCardId)

PulsePeriod = Literal["month", "quarter", "year", "rolling_30"]

PULSE_TITLE_MAX_LENGTH = 40

# Any control character (tab, newline, DEL, …) would make a title that renders
# as nothing or breaks a card header onto two lines.
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def _clean_title(value: Optional[str]) -> Optional[str]:
    """Trim, and read a blank as "use the built-in title"."""
    if value is None:
        return None
    value = value.strip()
    return value or None


class PulseCardPreference(BaseModel):
    """One card's place in a layout."""

    id: PulseCardId
    visible: bool = True
    title: Optional[str] = Field(default=None, max_length=PULSE_TITLE_MAX_LENGTH * 4)

    model_config = ConfigDict(extra="forbid")

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: Optional[str]) -> Optional[str]:
        v = _clean_title(v)
        if v is None:
            return None
        if _CONTROL_CHARS.search(v):
            raise ValueError("A card title cannot contain control characters")
        if len(v) > PULSE_TITLE_MAX_LENGTH:
            raise ValueError(
                f"A card title is at most {PULSE_TITLE_MAX_LENGTH} characters"
            )
        return v


class DashboardPulseLayout(BaseModel):
    """A layout, written and returned as a whole.

    ``cards`` lists cards in display order. A layout sent for saving may omit
    cards; the resolver appends any it leaves out, visible and in built-in
    order, so a card added in a later release is never silently hidden by a
    layout saved before it existed.
    """

    period: Optional[PulsePeriod] = None
    cards: list[PulseCardPreference] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @field_validator("cards")
    @classmethod
    def _validate_cards(cls, v: list[PulseCardPreference]) -> list[PulseCardPreference]:
        ids = [card.id for card in v]
        if len(set(ids)) != len(ids):
            raise ValueError("A card can appear only once in a layout")
        return v


class DashboardPulseResponse(BaseModel):
    """What the calling member's dashboard should use.

    ``layout`` is always complete: every card appears exactly once. ``personal``
    and ``organization_default`` say where it came from, so the screen can offer
    "reset to department default" only when there is a personal choice to reset.
    ``personal_layout`` is the member's own stored choice, uncompleted, so a save
    that changes only the period can resend their cards and not the department's.
    """

    layout: DashboardPulseLayout
    personal: bool
    organization_default: bool
    personal_layout: Optional[DashboardPulseLayout] = None


def normalize_pulse_layout(stored: object) -> Optional[DashboardPulseLayout]:
    """The stored value as a layout, or ``None`` when nothing usable is there.

    Unknown card ids, duplicates, non-dict entries and bad titles are dropped one
    by one, so a single bad entry costs that entry rather than the layout. A
    stored value that is not a dict, or that holds no recognisable card and no
    period, reads as "not set".
    """
    if not isinstance(stored, dict):
        return None

    cards: list[PulseCardPreference] = []
    seen: set[str] = set()
    raw_cards = stored.get("cards")
    for entry in raw_cards if isinstance(raw_cards, list) else []:
        if not isinstance(entry, dict):
            continue
        card_id = entry.get("id")
        if card_id not in PULSE_CARD_IDS or card_id in seen:
            continue
        visible = entry.get("visible", True)
        try:
            cards.append(
                PulseCardPreference(
                    id=card_id,
                    visible=visible if type(visible) is bool else True,
                    title=(
                        entry.get("title")
                        if isinstance(entry.get("title"), str)
                        else None
                    ),
                )
            )
        except ValueError:
            cards.append(
                PulseCardPreference(
                    id=card_id,
                    visible=visible if type(visible) is bool else True,
                )
            )
        seen.add(card_id)

    period = stored.get("period")
    valid_period: Optional[PulsePeriod] = (
        period if period in ("month", "quarter", "year", "rolling_30") else None
    )
    if not cards and valid_period is None:
        return None
    return DashboardPulseLayout(period=valid_period, cards=cards)


def resolve_pulse_layout(
    organization_stored: object, personal_stored: object
) -> DashboardPulseResponse:
    """Settle the layout a member's dashboard uses.

    A member's own cards replace the department's wholesale rather than merging
    card by card: a half-and-half order the member never chose and the
    department never set would be neither. The period falls back separately,
    because a member who only reordered cards has not chosen a period.
    """
    organization = normalize_pulse_layout(organization_stored)
    personal = normalize_pulse_layout(personal_stored)

    base_cards = (
        personal.cards
        if personal is not None and personal.cards
        else organization.cards if organization is not None else []
    )
    period = next(
        (
            layout.period
            for layout in (personal, organization)
            if layout is not None and layout.period is not None
        ),
        None,
    )

    present = {card.id for card in base_cards}
    cards = list(base_cards) + [
        PulseCardPreference(id=card_id)
        for card_id in PULSE_CARD_IDS
        if card_id not in present
    ]
    return DashboardPulseResponse(
        layout=DashboardPulseLayout(period=period, cards=cards),
        personal=personal is not None,
        organization_default=organization is not None,
        personal_layout=personal,
    )


def stored_layout(layout: DashboardPulseLayout) -> dict[str, Any]:
    """The layout as the dict written to a JSON column."""
    return layout.model_dump(mode="json")
