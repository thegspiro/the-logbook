"""
Intake questions on a suggestion box: the pure, database-free half.

A box may ask questions on submission. A question can be shown only when an
earlier answer matches a rule ("branching"), and a single-choice option can
name another box, which moves the submission there. ``SuggestionService``
does the parts that need the database — checking a route names a box in the
same department, and loading the destination when a member submits.

Visibility is the forms module's rule, not a copy of it: questions are handed
to ``FormsService._visible_field_ids`` and ``FormsService._condition_error``
through ``_as_fields``. The frontend uses ``getVisibleFieldIds`` from
``utils/formVisibility.ts``, the same function the form renderers use, so the
browser and the server cannot disagree about which questions were shown.
"""

import json
import math
import uuid
from datetime import date
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.schemas.suggestion import (
    CHOICE_QUESTION_TYPES,
    ROUTING_QUESTION_TYPES,
    IntakeQuestion,
)
from app.services.forms_service import FormsService

# A submission's answers arrive as one multipart field; this bounds the parse.
MAX_ANSWERS_PAYLOAD_BYTES = 64 * 1024
MAX_TEXT_ANSWER_LENGTH = 500
MAX_TEXTAREA_ANSWER_LENGTH = 5000
_VALUE_OPERATORS = frozenset({"equals", "not_equals", "contains"})


def _as_fields(questions: Sequence[Dict[str, Any]]) -> List[SimpleNamespace]:
    """Present stored questions in the shape the forms branching rule reads."""
    return [
        SimpleNamespace(
            id=q["id"],
            field_type=q["type"],
            condition_field_id=q.get("condition_question_id"),
            condition_operator=q.get("condition_operator"),
            condition_value=q.get("condition_value"),
        )
        for q in questions
    ]


def normalize_questions(questions: Sequence[IntakeQuestion]) -> Optional[List[Dict]]:
    """The canonical stored list for ``questions``, or None for no questions.

    Gives each new question an id, and rejects a branch that names a missing
    question, branches on itself or on one of its own follow-ups (a cycle no
    member could enter), or compares a choice question against a value none of
    its options has (a follow-up that could never appear).
    """
    if not questions:
        return None
    stored: List[Dict[str, Any]] = []
    seen_ids = set()
    for question in questions:
        entry = question.model_dump()
        entry["id"] = entry["id"] or str(uuid.uuid4())
        if entry["id"] in seen_ids:
            raise ValueError("Two questions share one id.")
        seen_ids.add(entry["id"])
        stored.append(entry)

    fields = _as_fields(stored)
    by_id = {q["id"]: q for q in stored}
    for entry in stored:
        parent_id = entry["condition_question_id"]
        if not parent_id:
            continue
        error = FormsService._condition_error(entry["id"], parent_id, fields)
        if error:
            raise ValueError(f"'{entry['label']}': {error}.")
        parent = by_id[parent_id]
        if (
            parent["type"] in CHOICE_QUESTION_TYPES
            and entry["condition_operator"] in _VALUE_OPERATORS
            and entry["condition_value"] not in {o["value"] for o in parent["options"]}
        ):
            raise ValueError(
                f"'{entry['label']}' depends on an answer '{parent['label']}' "
                "does not offer."
            )
    return stored


def route_ids(questions: Optional[Sequence[Dict[str, Any]]]) -> List[str]:
    """Every box a box's questions can route to, in question order."""
    found: List[str] = []
    for question in questions or []:
        for option in question.get("options") or []:
            target = option.get("route_to_box_id")
            if target and target not in found:
                found.append(target)
    return found


def without_routes_to(
    questions: Optional[Sequence[Dict[str, Any]]], box_ids: Sequence[str]
) -> Optional[List[Dict[str, Any]]]:
    """A copy of ``questions`` with every route to ``box_ids`` removed.

    Always a new list of new dicts, never the stored one: a JSON column does
    not see a nested in-place change, and would skip the UPDATE.
    """
    if questions is None:
        return None
    dropped = set(box_ids)
    copied = []
    for question in questions:
        options = [
            {
                **option,
                "route_to_box_id": (
                    None
                    if option.get("route_to_box_id") in dropped
                    else option.get("route_to_box_id")
                ),
            }
            for option in question.get("options") or []
        ]
        copied.append({**question, "options": options})
    return copied


def parse_answers(raw: Optional[str]) -> Dict[str, str]:
    """The submitted answers as ``{question_id: text}``.

    Arrives as a JSON object in one multipart field. Anything else is a client
    error, and an answer that is not a string is refused rather than coerced:
    the stored answer must be what the member chose, not a guess at it.
    """
    if not raw:
        return {}
    if len(raw.encode("utf-8")) > MAX_ANSWERS_PAYLOAD_BYTES:
        raise ValueError("The answers are too long.")
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        raise ValueError("The answers could not be read.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("The answers could not be read.")
    answers: Dict[str, str] = {}
    for key, value in parsed.items():
        if value is None:
            continue
        if not isinstance(value, str):
            raise ValueError("The answers could not be read.")
        answers[str(key)] = value.strip()
    return answers


def _checked_answer(question: Dict[str, Any], value: str) -> Tuple[str, str]:
    """``(stored value, display text)`` for one non-empty answer, or a
    ``ValueError`` naming the question."""
    label = question["label"]
    kind = question["type"]
    if kind in CHOICE_QUESTION_TYPES:
        labels = {o["value"]: o["label"] for o in question["options"]}
        chosen = (
            [part.strip() for part in value.split(",") if part.strip()]
            if kind == "checkbox"
            else [value]
        )
        if not chosen or any(c not in labels for c in chosen):
            raise ValueError(f"'{label}' has an answer that is not one of its options.")
        # Option order, without repeats, so equal choices store equally.
        ordered = [v for v in labels if v in set(chosen)]
        return ",".join(ordered), ", ".join(labels[v] for v in ordered)
    if kind == "text" and len(value) > MAX_TEXT_ANSWER_LENGTH:
        raise ValueError(
            f"'{label}' is limited to {MAX_TEXT_ANSWER_LENGTH} characters."
        )
    if kind == "textarea" and len(value) > MAX_TEXTAREA_ANSWER_LENGTH:
        raise ValueError(
            f"'{label}' is limited to {MAX_TEXTAREA_ANSWER_LENGTH} characters."
        )
    if kind == "number":
        try:
            number = float(value)
        except ValueError as exc:
            raise ValueError(f"'{label}' needs a number.") from exc
        if not math.isfinite(number):
            raise ValueError(f"'{label}' needs a number.")
    if kind == "date":
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"'{label}' needs a date.") from exc
    return value, value


def resolve_answers(
    questions: Optional[Sequence[Dict[str, Any]]], answers: Dict[str, str]
) -> Tuple[Optional[List[Dict[str, str]]], Optional[str]]:
    """Check ``answers`` against the questions a member was shown.

    Returns the answer snapshot to store (None when nothing was answered) and
    the box the answers route to, if any. An answer to a hidden or unknown
    question is dropped: it belongs to a branch the member backed out of. A
    required question counts only while it is shown.

    The first shown single-choice answer that names a box decides the route,
    in question order. ``resolveRoute`` in the frontend's
    ``modules/communications/utils/suggestionRouting.ts`` previews the same
    rule; this one decides.
    """
    if not questions:
        return None, None
    visible = FormsService._visible_field_ids(_as_fields(questions), answers)
    snapshot: List[Dict[str, str]] = []
    route: Optional[str] = None
    for question in questions:
        if question["id"] not in visible:
            continue
        value = answers.get(question["id"], "")
        if not value:
            if question.get("required"):
                raise ValueError(f"Please answer '{question['label']}'.")
            continue
        stored, display = _checked_answer(question, value)
        snapshot.append(
            {
                "question_id": question["id"],
                "label": question["label"],
                "value": stored,
                "display": display,
            }
        )
        if route is None and question["type"] in ROUTING_QUESTION_TYPES:
            option = next(o for o in question["options"] if o["value"] == stored)
            route = option.get("route_to_box_id") or None
    return snapshot or None, route
