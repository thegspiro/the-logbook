"""The CRR catalogue a department starts with (owner decisions, 2026-11-22).

The activity types and their counts are the ones the owner confirmed. Each
department gets its own copy, which it can rename, extend or retire.

Juvenile firesetter intervention is deliberately absent: the owner made it a
separate option shown as "coming soon", which the settings screen draws itself
without storing anything (pitfall #19).
"""

from typing import NamedTuple


class DefaultTag(NamedTuple):
    kind: str
    code: str
    label: str


class DefaultMeasure(NamedTuple):
    code: str
    label: str


class DefaultActivityType(NamedTuple):
    code: str
    name: str
    description: str
    measures: tuple[DefaultMeasure, ...]
    tags: tuple[str, ...]  # tag codes, risk and population alike


DEFAULT_TAGS: tuple[DefaultTag, ...] = (
    DefaultTag("risk", "fire", "Fire"),
    DefaultTag("risk", "falls", "Falls"),
    DefaultTag("risk", "carbon_monoxide", "Carbon monoxide"),
    DefaultTag("risk", "drowning", "Drowning"),
    DefaultTag("risk", "motor_vehicle", "Motor vehicle crashes"),
    DefaultTag("risk", "cardiac_arrest", "Cardiac arrest"),
    DefaultTag("risk", "severe_bleeding", "Severe bleeding"),
    DefaultTag("population", "older_adults", "Older adults"),
    DefaultTag("population", "children", "Children"),
    DefaultTag("population", "people_with_disabilities", "People with disabilities"),
    DefaultTag("population", "non_english_speakers", "Non-English speakers"),
    DefaultTag("population", "low_income_households", "Low-income households"),
)

_HOMES = DefaultMeasure("homes", "Homes")
_PEOPLE_TRAINED = DefaultMeasure("people_trained", "People trained")

DEFAULT_ACTIVITY_TYPES: tuple[DefaultActivityType, ...] = (
    DefaultActivityType(
        "smoke_alarm_install",
        "Smoke alarm install",
        "Smoke alarms installed in a resident's home.",
        (DefaultMeasure("alarms_installed", "Alarms installed"), _HOMES),
        ("fire",),
    ),
    DefaultActivityType(
        "co_alarm_install",
        "CO alarm install",
        "Carbon monoxide alarms installed in a resident's home.",
        (DefaultMeasure("alarms_installed", "Alarms installed"), _HOMES),
        ("carbon_monoxide",),
    ),
    DefaultActivityType(
        "home_safety_survey",
        "Home safety survey",
        "A walk-through of a home's fire and fall hazards with the resident.",
        (DefaultMeasure("homes_surveyed", "Homes surveyed"),),
        ("fire", "falls"),
    ),
    DefaultActivityType(
        "car_seat_inspection",
        "Car seat inspection",
        "Child car seats checked, and installed or corrected where needed.",
        (
            DefaultMeasure("seats_inspected", "Seats inspected"),
            DefaultMeasure("seats_installed", "Seats installed"),
        ),
        ("motor_vehicle", "children"),
    ),
    DefaultActivityType(
        "extinguisher_training",
        "Extinguisher training",
        "Hands-on fire extinguisher training.",
        (_PEOPLE_TRAINED,),
        ("fire",),
    ),
    DefaultActivityType(
        "hands_only_cpr",
        "Hands-only CPR",
        "Hands-only CPR taught to members of the public.",
        (_PEOPLE_TRAINED,),
        ("cardiac_arrest",),
    ),
    DefaultActivityType(
        "stop_the_bleed",
        "Stop the Bleed",
        "Bleeding-control training for members of the public.",
        (_PEOPLE_TRAINED,),
        ("severe_bleeding",),
    ),
    DefaultActivityType(
        "fall_prevention",
        "Fall prevention",
        "Fall-prevention education or home checks, usually with older adults.",
        (DefaultMeasure("people_reached", "People reached"),),
        ("falls", "older_adults"),
    ),
    DefaultActivityType(
        "school_program",
        "School program",
        "A safety program delivered at a school.",
        (
            DefaultMeasure("students_reached", "Students reached"),
            DefaultMeasure("classes", "Classes"),
        ),
        ("fire", "children"),
    ),
)
