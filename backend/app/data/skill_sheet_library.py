#!/usr/bin/env python3
"""
Skill sheet blueprints for seeding the skills-testing module.

A department opening Skills Testing for the first time sees an empty table and
a "New Template" button, and building an NREMT-style sheet from scratch is
twenty minutes of typing before the first candidate can be tested. These
blueprints give a seeded environment a library that looks like one a training
officer would actually have built, and give the test suite and the screenshot
harness a single definition to share.

Pure data — no I/O, no third-party imports — so the API can serve it, the
seeders (``scripts/seed_skills_testing.py``, ``scripts/screenshots/
seed_demo_data.py``) can post it, and the tests can validate it, all from one
definition.

It lives inside the application rather than in ``scripts/`` because a new
department is offered these sheets at runtime: Skills Testing otherwise opens
on an empty table and a New Template button, and building an NREMT sheet from
scratch is twenty minutes of typing before the first candidate can be tested.

**Criterion types are a closed set.** ``pass_fail``, ``score``, ``time_limit``,
``checklist`` and ``statement`` are the only values the examiner screen knows
how to render; anything else draws no input control at all, so the step cannot
be scored and — under ``require_all_critical`` — counts as a critical failure.
Use the ``C_*`` constants below rather than string literals so a typo is an
``AttributeError`` here instead of an unscorable sheet in production.
"""

from __future__ import annotations

from typing import Any

# The five criterion types the examiner screen can render. Mirrors
# CriterionType in frontend/src/types/skillsTesting.ts and the whitelist in
# app/schemas/skills_testing.py.
C_PASS_FAIL = "pass_fail"
C_SCORE = "score"
C_TIME_LIMIT = "time_limit"
C_CHECKLIST = "checklist"
C_STATEMENT = "statement"


def _c(
    label: str,
    ctype: str = C_PASS_FAIL,
    *,
    critical: bool = False,
    description: str | None = None,
    max_score: float | None = None,
    passing_score: float | None = None,
    time_limit_seconds: int | None = None,
    checklist_items: list[str] | None = None,
    statement_text: str | None = None,
    starts_timer: bool = False,
) -> dict[str, Any]:
    """One criterion, in the shape the create-template endpoint accepts.

    ``critical`` maps to the API's ``required`` flag — the builder labels it
    "Critical: must pass to pass the test", and that is what it does when the
    template has ``require_all_critical`` set.
    """
    criterion: dict[str, Any] = {
        "label": label,
        "type": ctype,
        "required": critical,
    }
    if description:
        criterion["description"] = description
    if max_score is not None:
        criterion["max_score"] = max_score
    if passing_score is not None:
        criterion["passing_score"] = passing_score
    if time_limit_seconds is not None:
        criterion["time_limit_seconds"] = time_limit_seconds
    if checklist_items:
        criterion["checklist_items"] = checklist_items
    if statement_text:
        criterion["statement_text"] = statement_text
    if starts_timer:
        criterion["starts_timer"] = True
    return criterion


def _s(name: str, criteria: list[dict[str, Any]], description: str | None = None):
    """One evaluation section."""
    section: dict[str, Any] = {"name": name, "criteria": criteria}
    if description:
        section["description"] = description
    return section


# ---------------------------------------------------------------------------
# The library
# ---------------------------------------------------------------------------
#
# Ten sheets spanning the disciplines a combination department tests against,
# chosen so that between them every criterion type and every scoring mode is
# exercised by real content rather than by a fixture named "test":
#
#   * pass/fail sheets with critical steps        — the NREMT psychomotor form
#   * a timed evolution opened by a statement     — SCBA, ladder raise
#   * point-scored rubrics                        — pump ops, EVOC, size-up
#   * checklists inside a step                    — hazmat suit, hose advance
#   * ``score_pass_fail_criteria`` turned on      — the knowledge-question sheet
#
# Keeping them all in one list means a seeded environment shows the templates
# table with a realistic spread of categories, section counts and criteria
# counts instead of two near-identical rows.

SKILL_SHEETS: list[dict[str, Any]] = [
    {
        "name": "Patient Assessment / Management — Medical",
        "category": "Emergency Medical",
        "description": (
            "NREMT-style psychomotor sheet for a medical patient assessment. "
            "Critical steps mirror the National Registry's failure criteria."
        ),
        "tags": ["NREMT", "EMS", "Recertification"],
        "passing_percentage": 70,
        "require_all_critical": True,
        "sections": [
            _s(
                "Scene Size-Up",
                [
                    _c("Takes or verbalizes standard precautions", critical=True),
                    _c("Determines the scene is safe", critical=True),
                    _c("Determines the mechanism of injury / nature of illness"),
                    _c("Determines the number of patients"),
                    _c("Requests additional EMS assistance if necessary"),
                ],
            ),
            _s(
                "Primary Survey",
                [
                    _c("Verbalizes general impression of the patient"),
                    _c("Determines responsiveness / level of consciousness"),
                    _c(
                        "Determines chief complaint / apparent life threats",
                        critical=True,
                    ),
                    _c("Assesses airway and breathing", critical=True),
                    _c("Assesses circulation", critical=True),
                    _c(
                        "Identifies priority patients and makes a transport "
                        "decision",
                        critical=True,
                    ),
                ],
            ),
            _s(
                "History Taking",
                [
                    _c("Obtains history of the present illness (OPQRST)"),
                    _c("Obtains past medical history (SAMPLE)"),
                    _c("Performs a focused physical examination"),
                    _c(
                        "Obtains a complete set of baseline vital signs",
                        critical=True,
                    ),
                ],
            ),
            _s(
                "Reassessment and Hand-Off",
                [
                    _c("Repeats the primary survey and vitals"),
                    _c("Evaluates the response to interventions"),
                    _c(
                        "Gives a verbal hand-off report",
                        C_SCORE,
                        description=(
                            "0 = omits critical findings, 3 = complete, "
                            "organized, hands off in under 60 seconds."
                        ),
                        max_score=3,
                        passing_score=2,
                    ),
                ],
            ),
        ],
    },
    {
        "name": "SCBA Donning — Timed Evolution",
        "category": "Fire Suppression",
        "description": (
            "Seated-donning evolution against a 60-second clock. The opening "
            "statement is read off the clock; the timer starts on the "
            "candidate's first movement."
        ),
        "tags": ["NFPA 1001", "SCBA", "Probationary"],
        "time_limit_seconds": 300,
        "require_all_critical": True,
        "sections": [
            _s(
                "Preparation",
                [
                    _c(
                        "Pre-evolution brief",
                        C_STATEMENT,
                        statement_text=(
                            "Read to the candidate before the clock starts: "
                            '"On my mark you will don this SCBA from the '
                            "seated position, seal the facepiece, and go on "
                            'air. You have 60 seconds."'
                        ),
                    ),
                    _c("Inspects cylinder pressure before donning", critical=True),
                    _c("Checks harness, straps and regulator for damage"),
                ],
            ),
            _s(
                "Donning",
                [
                    _c(
                        "Start of evolution",
                        C_STATEMENT,
                        statement_text=(
                            'Say "Go" and start the clock on the candidate\'s '
                            "first movement."
                        ),
                        starts_timer=True,
                    ),
                    _c("Dons the pack without assistance", critical=True),
                    _c("Seals the facepiece and checks for leaks", critical=True),
                    _c("Activates the PASS device", critical=True),
                    _c(
                        "Completes donning within the time limit",
                        C_TIME_LIMIT,
                        critical=True,
                        time_limit_seconds=60,
                        description=(
                            "Stop the clock when the candidate signals they "
                            "are on air."
                        ),
                    ),
                ],
            ),
        ],
    },
    {
        "name": "Bleeding Control and Shock Management",
        "category": "Emergency Medical",
        "description": (
            "NREMT-style sheet for arterial haemorrhage control progressing to "
            "tourniquet application and shock management."
        ),
        "tags": ["NREMT", "EMS"],
        "require_all_critical": True,
        "sections": [
            _s(
                "Haemorrhage Control",
                [
                    _c("Takes or verbalizes standard precautions", critical=True),
                    _c("Applies direct pressure to the wound", critical=True),
                    _c("Applies a pressure dressing over the wound"),
                    _c(
                        "Wound continues to bleed",
                        C_STATEMENT,
                        statement_text=(
                            'Tell the candidate: "The wound continues to '
                            'bleed through the dressing."'
                        ),
                    ),
                    _c(
                        "Applies a tourniquet proximal to the wound",
                        critical=True,
                    ),
                    _c("Notes and reports the time of application", critical=True),
                ],
            ),
            _s(
                "Shock Management",
                [
                    _c("Properly positions the patient"),
                    _c("Administers high-concentration oxygen", critical=True),
                    _c("Initiates steps to prevent heat loss"),
                    _c("Indicates the need for immediate transport", critical=True),
                ],
            ),
        ],
    },
    {
        "name": "24' Extension Ladder — Two-Firefighter Raise",
        "category": "Fire Suppression",
        "description": (
            "Two-firefighter flat raise, extension and heeling of a 24-foot "
            "extension ladder to a second-floor window."
        ),
        "tags": ["NFPA 1001", "Ladders"],
        "require_all_critical": True,
        "sections": [
            _s(
                "Carry and Placement",
                [
                    _c(
                        "Size-up and pre-raise checks",
                        C_CHECKLIST,
                        description="Check each item the candidate performs.",
                        checklist_items=[
                            "Selects the correct ladder for the objective",
                            "Checks overhead for electrical hazards",
                            "Judges the climbing angle before raising",
                            "Confirms footing and surface stability",
                        ],
                    ),
                    _c("Carries the ladder with correct hand and shoulder position"),
                    _c("Places the butt at the correct distance from the building"),
                ],
            ),
            _s(
                "Raise and Extension",
                [
                    _c(
                        "Start of evolution",
                        C_STATEMENT,
                        statement_text=(
                            "Start the clock when the ladder leaves the " "apparatus."
                        ),
                        starts_timer=True,
                    ),
                    _c("Raises the ladder under control", critical=True),
                    _c("Extends the fly to the correct height", critical=True),
                    _c("Confirms the dogs are locked before climbing", critical=True),
                    _c("Heels the ladder while the partner climbs", critical=True),
                    _c(
                        "Ladder is in service within the time limit",
                        C_TIME_LIMIT,
                        time_limit_seconds=180,
                    ),
                ],
            ),
        ],
    },
    {
        "name": '1¾" Handline — Advance and Flow',
        "category": "Fire Suppression",
        "description": (
            "Deploy, advance and flow a 1¾-inch attack line from a "
            "pre-connect to a second-floor interior objective."
        ),
        "tags": ["NFPA 1001", "Hose", "Probationary"],
        "require_all_critical": True,
        "sections": [
            _s(
                "Deployment",
                [
                    _c(
                        "Personal protective equipment",
                        C_CHECKLIST,
                        critical=True,
                        description=(
                            "Full PPE is a pass/fail gate — check every item "
                            "before the evolution begins."
                        ),
                        checklist_items=[
                            "Helmet with chinstrap secured",
                            "Hood fully deployed over the facepiece seal",
                            "Coat and pants fully closed",
                            "Gloves donned",
                            "SCBA donned and on air",
                        ],
                    ),
                    _c("Pulls the correct pre-connect for the objective"),
                    _c("Clears the load without kinks or entanglement"),
                ],
            ),
            _s(
                "Advance",
                [
                    _c("Bleeds air from the line before entry", critical=True),
                    _c("Advances with the nozzle under control", critical=True),
                    _c("Maintains a working loop at the entry point"),
                    _c("Communicates water needs to the pump operator"),
                ],
            ),
            _s(
                "Nozzle Operation",
                [
                    _c(
                        "Stream selection and application",
                        C_SCORE,
                        description=(
                            "0 = wrong pattern or wasted water, 5 = correct "
                            "pattern, correct angle, controlled application."
                        ),
                        max_score=5,
                        passing_score=3,
                    ),
                    _c("Controls nozzle reaction throughout"),
                    _c("Shuts down and drains the line on command"),
                ],
            ),
        ],
    },
    {
        "name": "Pump Operations — Draft and Relay Supply",
        "category": "Apparatus Operations",
        "description": (
            "Graded rubric for establishing a draft from a static source and "
            "supplying a relay. Scored on points, 75% to pass."
        ),
        "tags": ["Driver/Operator", "NFPA 1002"],
        "passing_percentage": 75,
        "require_all_critical": True,
        "sections": [
            _s(
                "Establishing the Draft",
                [
                    _c("Sets the parking brake and chocks the wheels", critical=True),
                    _c(
                        "Hard sleeve and strainer assembly",
                        C_SCORE,
                        description=(
                            "0 = leaks or incorrect strainer depth, 5 = "
                            "airtight, strainer correctly submerged."
                        ),
                        max_score=5,
                        passing_score=3,
                    ),
                    _c(
                        "Priming technique and time to water",
                        C_SCORE,
                        description="0 = fails to prime, 5 = water in under 45s.",
                        max_score=5,
                        passing_score=3,
                    ),
                ],
            ),
            _s(
                "Supplying the Relay",
                [
                    _c(
                        "Discharge pressure calculation",
                        C_SCORE,
                        description=(
                            "0 = incorrect, 10 = friction loss, elevation and "
                            "appliance losses all correct."
                        ),
                        max_score=10,
                        passing_score=7,
                    ),
                    _c(
                        "Throttle and pressure governor control",
                        C_SCORE,
                        max_score=5,
                        passing_score=3,
                    ),
                    _c("Maintains intake pressure above 20 psi", critical=True),
                    _c("Monitors engine temperature and reports it"),
                ],
            ),
        ],
    },
    {
        "name": "Emergency Vehicle Operations — Driving Course",
        "category": "Apparatus Operations",
        "description": (
            "NFPA 1002 driving course: alley dock, serpentine, diminishing "
            "clearance and opposite-direction turn."
        ),
        "tags": ["Driver/Operator", "NFPA 1002", "Annual"],
        "passing_percentage": 70,
        "require_all_critical": True,
        "sections": [
            _s(
                "Pre-Trip",
                [
                    _c(
                        "Pre-trip inspection",
                        C_CHECKLIST,
                        critical=True,
                        checklist_items=[
                            "Fluid levels checked",
                            "Tyres and wheels inspected",
                            "Warning lights and siren tested",
                            "Mirrors adjusted before moving",
                            "Seatbelt worn and crew secured",
                        ],
                    ),
                ],
            ),
            _s(
                "Course Manoeuvres",
                [
                    _c(
                        "Alley dock",
                        C_SCORE,
                        description="Deduct 1 point per cone struck or pull-up.",
                        max_score=5,
                        passing_score=3,
                    ),
                    _c(
                        "Serpentine",
                        C_SCORE,
                        max_score=5,
                        passing_score=3,
                    ),
                    _c(
                        "Diminishing clearance",
                        C_SCORE,
                        max_score=5,
                        passing_score=3,
                    ),
                    _c(
                        "Opposite-direction turn",
                        C_SCORE,
                        max_score=5,
                        passing_score=3,
                    ),
                    _c(
                        "Completes the course within the time limit",
                        C_TIME_LIMIT,
                        time_limit_seconds=600,
                    ),
                ],
            ),
            _s(
                "Safety",
                [
                    _c("No contact with any course boundary", critical=True),
                    _c("Comes to a complete stop at every marked stop", critical=True),
                ],
            ),
        ],
    },
    {
        "name": "Primary Search — Limited Visibility",
        "category": "Rescue",
        "description": (
            "Two-firefighter primary search of a single-storey structure under "
            "blacked-out facepiece conditions, with a victim removal."
        ),
        "tags": ["NFPA 1001", "Search", "RIT"],
        "require_all_critical": True,
        "sections": [
            _s(
                "Entry",
                [
                    _c("Performs a door size-up before entry", critical=True),
                    _c("Maintains contact with the partner throughout", critical=True),
                    _c("Tracks the means of egress"),
                    _c("Reports entry to command"),
                ],
            ),
            _s(
                "Search",
                [
                    _c("Uses a consistent search pattern"),
                    _c("Sweeps under windows and behind doors"),
                    _c(
                        "Victim located",
                        C_STATEMENT,
                        statement_text=(
                            'Tell the candidate: "You have contacted an '
                            'unresponsive adult victim."'
                        ),
                    ),
                    _c("Announces the find to command", critical=True),
                    _c("Assesses the victim before moving them"),
                ],
            ),
            _s(
                "Removal",
                [
                    _c("Selects an appropriate drag or carry"),
                    _c("Protects the victim's head and airway", critical=True),
                    _c("Exits by the shortest safe route"),
                    _c(
                        "Air management — exits with reserve air",
                        critical=True,
                        description="Low-air alarm must not have activated.",
                    ),
                ],
            ),
        ],
    },
    {
        "name": "Hazmat — Level A Suit Donning and Doffing",
        "category": "Hazardous Materials",
        "description": (
            "Technician-level encapsulating suit procedure with a buddy "
            "checker. Every checklist item is a safety gate."
        ),
        "tags": ["NFPA 470", "Hazmat", "Technician"],
        "require_all_critical": True,
        "sections": [
            _s(
                "Pre-Entry",
                [
                    _c("Completes the pre-entry medical check", critical=True),
                    _c(
                        "Suit inspection",
                        C_CHECKLIST,
                        critical=True,
                        checklist_items=[
                            "Suit pressure-tested within the service interval",
                            "Visor free of crazing or damage",
                            "Zipper and seals intact",
                            "Gloves and boots correctly attached",
                            "Communications checked",
                        ],
                    ),
                ],
            ),
            _s(
                "Donning",
                [
                    _c("Dons SCBA before entering the suit", critical=True),
                    _c("Buddy verifies every seal and closure", critical=True),
                    _c("Confirms communications from inside the suit"),
                    _c("Reports air pressure before entry", critical=True),
                ],
            ),
            _s(
                "Doffing and Decontamination",
                [
                    _c("Enters decon in the correct sequence", critical=True),
                    _c(
                        "Does not break the suit seal before decon is complete",
                        critical=True,
                    ),
                    _c("Removes the suit without self-contamination", critical=True),
                    _c("Completes the post-entry medical check", critical=True),
                ],
            ),
        ],
    },
    {
        "name": "Company Officer — Incident Size-Up and Initial IAP",
        "category": "Command",
        "description": (
            "Tabletop evaluation. Knowledge questions are written as pass/fail "
            "steps and carry points, so a wrong answer costs marks."
        ),
        "tags": ["Officer Development", "NFPA 1021", "Promotional"],
        "passing_percentage": 80,
        "require_all_critical": True,
        # Knowledge questions written as pass/fail steps: without this they
        # would carry no points at all and the percentage would come from the
        # rubric section alone.
        "score_pass_fail_criteria": True,
        "sections": [
            _s(
                "Scenario",
                [
                    _c(
                        "Scenario brief",
                        C_STATEMENT,
                        statement_text=(
                            'Read aloud: "You are first-due at 0230 to a '
                            "two-storey wood-frame dwelling, smoke showing "
                            "from a second-floor window on side C. One "
                            "occupant is unaccounted for. Your engine has a "
                            'crew of three."'
                        ),
                    ),
                ],
            ),
            _s(
                "Knowledge Questions",
                [
                    _c("States the correct construction type and its hazards"),
                    _c("Identifies the likely fire location and extension path"),
                    _c("States the required flow rate for the involved area"),
                    _c("Names the resources needed for a two-in/two-out compliance"),
                    _c("Identifies the mandatory reporting conditions"),
                ],
            ),
            _s(
                "Initial Action Plan",
                [
                    _c(
                        "Radio size-up report",
                        C_SCORE,
                        description=(
                            "0 = omits location or conditions, 10 = complete "
                            "CAN report delivered in under 30 seconds."
                        ),
                        max_score=10,
                        passing_score=7,
                    ),
                    _c(
                        "Assignment of the initial crew",
                        C_SCORE,
                        max_score=10,
                        passing_score=7,
                    ),
                    _c(
                        "Establishes and names command",
                        critical=True,
                    ),
                    _c(
                        "Requests appropriate additional alarms",
                        C_SCORE,
                        max_score=5,
                        passing_score=3,
                    ),
                ],
            ),
        ],
    },
]


# Stable identifiers for the import endpoint. Explicit rather than derived from
# the name: these names carry em dashes, fractions and slashes, and a slug
# generated from them would change the moment anyone tidied a title — breaking
# the link between a department's copy and the sheet it came from.
SHEET_SLUGS: dict[str, str] = {
    "Patient Assessment / Management — Medical": "patient-assessment-medical",
    "SCBA Donning — Timed Evolution": "scba-donning-timed",
    "Bleeding Control and Shock Management": "bleeding-control-shock",
    "24' Extension Ladder — Two-Firefighter Raise": "ladder-24-two-firefighter-raise",
    '1¾" Handline — Advance and Flow': "handline-advance-and-flow",
    "Pump Operations — Draft and Relay Supply": "pump-ops-draft-relay",
    "Emergency Vehicle Operations — Driving Course": "evoc-driving-course",
    "Primary Search — Limited Visibility": "primary-search-limited-visibility",
    "Hazmat — Level A Suit Donning and Doffing": "hazmat-level-a-suit",
    "Company Officer — Incident Size-Up and Initial IAP": "officer-size-up-iap",
}


def slug_for(sheet: dict[str, Any]) -> str:
    """The stable id a department's imported copy is traced back to."""
    return SHEET_SLUGS[sheet["name"]]


def sheet_by_slug(slug: str) -> dict[str, Any] | None:
    """Look a blueprint up by its import id, or None if the slug is unknown."""
    for sheet in SKILL_SHEETS:
        if SHEET_SLUGS.get(sheet["name"]) == slug:
            return sheet
    return None


def build_template_payload(sheet: dict[str, Any]) -> dict[str, Any]:
    """Turn a blueprint into a POST /training/skills-testing/templates body.

    Fills the ``sort_order`` fields from list position so the blueprints do not
    have to carry index bookkeeping, and defaults ``visibility`` to
    ``all_members`` — the list endpoint hides anything else from non-officers,
    which would leave a seeded environment's members with an empty
    "Available Tests" tab.
    """
    payload: dict[str, Any] = {
        "name": sheet["name"],
        "description": sheet.get("description"),
        "category": sheet.get("category"),
        "visibility": sheet.get("visibility", "all_members"),
        "require_all_critical": sheet.get("require_all_critical", True),
        "score_pass_fail_criteria": sheet.get("score_pass_fail_criteria", False),
        "sections": [
            {
                "name": section["name"],
                "description": section.get("description"),
                "sort_order": si,
                "criteria": [
                    {**criterion, "sort_order": ci}
                    for ci, criterion in enumerate(section["criteria"])
                ],
            }
            for si, section in enumerate(sheet["sections"])
        ],
    }
    if sheet.get("passing_percentage") is not None:
        payload["passing_percentage"] = sheet["passing_percentage"]
    if sheet.get("time_limit_seconds") is not None:
        payload["time_limit_seconds"] = sheet["time_limit_seconds"]
    if sheet.get("tags"):
        payload["tags"] = sheet["tags"]
    return payload


def criterion_result(criterion: dict[str, Any], passing: bool) -> dict[str, Any]:
    """One criterion result, shaped the way the examiner screen writes it.

    Each type carries its own evidence field, and the scorecard renders that
    field rather than a generic score: a timed step shows the stopwatch
    reading, a checklist shows which boxes were ticked. A seeder that writes
    only ``passed``/``score`` produces a result that scores correctly but
    displays blank where the evidence should be.

    Accepts either a blueprint criterion or one read back from a test's frozen
    ``template_snapshot`` — they are the same shape.
    """
    ctype = criterion.get("type")

    if ctype == C_STATEMENT:
        # Statements mark themselves as the section renders — they are read
        # aloud, not judged, and are excluded from every tally.
        return {"passed": True}

    if ctype == C_SCORE:
        max_score = criterion.get("max_score") or 1
        if passing:
            return {"score": max_score, "passed": True}
        # A failing score sits below passing_score so the criterion reads as
        # failed rather than merely low.
        floor = criterion.get("passing_score")
        return {"score": max(0, (floor - 1) if floor else 0), "passed": True}

    if ctype == C_TIME_LIMIT:
        limit = criterion.get("time_limit_seconds") or 60
        seconds = int(limit * 0.8) if passing else int(limit * 1.3)
        return {"time_seconds": seconds, "passed": passing}

    if ctype == C_CHECKLIST:
        boxes = criterion.get("checklist_items") or []
        completed = [True] * len(boxes)
        if not passing and completed:
            # One box left unticked — the shape a real partial completion takes.
            completed[-1] = False
        return {"checklist_completed": completed, "passed": passing}

    return {"passed": passing}


def section_id(section_index: int) -> str:
    """The id a section result must carry.

    Section and criterion identity is positional, generated client-side by
    ``hydrateTemplateSections``. A seeder writing results directly through the
    API has to produce the same ids or the scorecard matches nothing.
    """
    return f"section-{section_index}"


def criterion_id(section_index: int, criterion_index: int) -> str:
    """The id a criterion result must carry. See :func:`section_id`."""
    return f"criterion-{section_index}-{criterion_index}"


def iter_criteria(sheet: dict[str, Any]):
    """Yield ``(section_index, criterion_index, section, criterion)`` in order."""
    for si, section in enumerate(sheet["sections"]):
        for ci, criterion in enumerate(section["criteria"]):
            yield si, ci, section, criterion


def sheet_by_name(name: str) -> dict[str, Any]:
    """Look a blueprint up by name, for seeders that want a specific sheet."""
    for sheet in SKILL_SHEETS:
        if sheet["name"] == name:
            return sheet
    raise KeyError(f"No skill sheet named {name!r}")
