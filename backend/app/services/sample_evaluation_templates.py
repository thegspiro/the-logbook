"""
A starting point for a department's first evaluation template.

Returned unsaved by ``GET /training/shift-evaluation-templates/example`` and loaded
into the editor, where the department renames, rewords and saves it as its
own. Nothing here is seeded into any database.

The content follows a volunteer EMT shift evaluation in real use: a 1-4 scale
with N/A for "not observed", comments required for a 1 or a 2, and three
sections of items.
"""

from app.schemas.shift_evaluation import ShiftEvaluationTemplateWrite


def _section(key: str, title: str, heading: str, items: list[tuple]) -> dict:
    return {
        "key": key,
        "title": title,
        "column_heading": heading,
        "items": [
            {
                "key": item_key,
                "label": label,
                "description": description,
                "comment_always_required": always,
            }
            for item_key, label, description, always in items
        ],
    }


def emt_shift_evaluation_example() -> ShiftEvaluationTemplateWrite:
    return ShiftEvaluationTemplateWrite.model_validate(
        {
            "name": "EMT Shift Evaluation",
            "description": (
                "Preceptor evaluation of an EMT's performance on one shift."
            ),
            "scale": [
                {"value": 1, "label": "Unsatisfactory"},
                {"value": 2, "label": "Needs Improvement"},
                {"value": 3, "label": "Meets Expectations"},
                {"value": 4, "label": "Exceeds Expectations"},
            ],
            "allow_not_applicable": True,
            "not_applicable_label": "Not Observed",
            "comment_required_at_or_below": 2,
            "header_fields": [
                {
                    "key": "platoon",
                    "label": "Shift (A, B, C)",
                    "type": "choice",
                    "options": ["A", "B", "C"],
                    "required": True,
                }
            ],
            "statistics": ["calls", "transports", "refusals"],
            "sections": [
                _section(
                    "clinical",
                    "Clinical Performance",
                    "Skill Area",
                    [
                        (
                            "als_assist",
                            "Assist with ALS skills",
                            "4 or 12 lead, spike a bag, etc. List specific skills.",
                            True,
                        ),
                        (
                            "vital_signs",
                            "Vital Signs",
                            "Accuracy & timeliness",
                            False,
                        ),
                        ("airway_bls", "Airway Management (BLS)", None, False),
                        ("cpr_aed", "CPR / AED Operation", None, False),
                        (
                            "patient_movement",
                            "Patient Movement & Lifting Techniques",
                            None,
                            False,
                        ),
                        ("equipment", "Equipment Use & Familiarity", None, False),
                        ("restock", "Help with Clean Up and Restock", None, False),
                        (
                            "scene_safety",
                            "Scene Safety & Situational Awareness",
                            None,
                            False,
                        ),
                    ],
                ),
                _section(
                    "professionalism",
                    "Professionalism & Affect",
                    "Attribute",
                    [
                        ("punctuality", "Punctuality & Preparedness", None, False),
                        ("uniform", "Uniform Appearance", None, False),
                        ("feedback", "Accepts Feedback Appropriately", None, False),
                        (
                            "initiative",
                            "Displays Initiative & Eagerness to Learn",
                            None,
                            False,
                        ),
                        (
                            "participation",
                            "Active Participation in Crew and Station Activities",
                            None,
                            False,
                        ),
                    ],
                ),
                _section(
                    "communication",
                    "Communication & Teamwork",
                    "Skill",
                    [
                        (
                            "patient_communication",
                            "Communicates Effectively with Patients",
                            None,
                            False,
                        ),
                        ("radio_report", "Radio & Report Communication", None, False),
                        ("crew", "Works Effectively with Crew", None, False),
                    ],
                ),
            ],
            "closing_comments_label": "Preceptor Comments",
            "closing_comments_hint": (
                "Strengths, notable calls, observations, suggested focus for "
                "upcoming shifts"
            ),
            "evaluator_rule": "shift_officer",
            "evaluated_seats": ["ems"],
        }
    )
