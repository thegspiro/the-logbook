"""
Section and overall grades for a form whose ``overall_mode`` is ``sectioned``.

This is the one definition of how an evaluation is graded. The evaluation
screen, the builder's preview, the detail response and the PDF all read it,
through ``grade_content``, rather than each working the arithmetic out for
itself (CLAUDE.md pitfall #29).

Every rating is first placed on the five-level grade scale, so items rated on
different scales combine: a 3 on a 1-5 scale is 3.0, the middle of a 1-3 scale
is 3.0, and meets / does not meet is 5 / 1. A section's score is the weighted
average of its rated items, an item marked N/A dropping out with its weight
shared by the rest. The overall is the weighted average of the sections' scores
in the same way.

A grade is read from the score as it is shown, rounded to one decimal. Reading
it from the unrounded value would let a printed "3.5" sit beside "Meets
expectations" when the band for Exceeds starts at 3.5.

An evaluator may give a section or the overall a different grade, with a
reason. That grade stands, and both are reported, so the record shows what the
ratings came to and what the evaluator decided.
"""

from typing import Any, Dict, List, Optional, Tuple

from app.schemas.evaluation import (
    OVERALL_LEVELS,
    SCORED_TOOLS,
    EvaluationTool,
    GradeBand,
    PartContent,
    TemplateDefinition,
    TemplateItem,
)

_LABELS = {level.value: level.label for level in OVERALL_LEVELS}
_LOW, _HIGH = 1.0, 5.0


def grade_value(item: TemplateItem, rating: int) -> Optional[float]:
    """A rating placed on the 1-5 grade scale, or None if it has no place."""
    if item.tool == EvaluationTool.MEETS:
        return _HIGH if rating else _LOW
    values = [level.value for level in item.levels]
    if not values:
        return None
    low, high = min(values), max(values)
    if high == low:
        return None
    return _LOW + (rating - low) / (high - low) * (_HIGH - _LOW)


def grade_for(score: Optional[float], bands: List[GradeBand]) -> Optional[int]:
    """The grade a score earns: the highest band whose minimum it reaches."""
    if score is None:
        return None
    earned = [band.level for band in bands if score >= band.min]
    return max(earned) if earned else bands[0].level


#: (weight, value on the 1-5 grade scale) for one rated item or one section.
Weighted = List[Tuple[int, float]]


def _weighted(pairs: Weighted) -> Optional[float]:
    total = sum(weight for weight, _ in pairs)
    if not total:
        return None
    return round(sum(weight * value for weight, value in pairs) / total, 1)


def _result(
    score: Optional[float],
    bands: List[GradeBand],
    override_level: Optional[int],
    reason: Optional[str],
) -> Dict[str, Any]:
    calculated = grade_for(score, bands)
    # An override naming the calculated grade changes nothing, so it is not
    # reported as one.
    changed = (
        override_level
        if override_level is not None and override_level != calculated
        else None
    )
    level = changed if changed is not None else calculated
    return {
        "score": score,
        "calculated_level": calculated,
        "calculated_label": _LABELS.get(calculated) if calculated else None,
        "override_level": changed,
        "override_label": _LABELS.get(changed) if changed is not None else None,
        "reason": reason if changed is not None else None,
        "level": level,
        "label": _LABELS.get(level) if level else None,
    }


def grade_content(
    definition: TemplateDefinition, content: PartContent
) -> Optional[Dict[str, Any]]:
    """Section and overall grades for an evaluator's answers, or None when
    the form is not graded by section.

    ``definition`` is the form as the member's evaluation shows it, officer
    sections already removed for a member who does not hold an officer rank.
    """
    if definition.overall_mode != "sectioned":
        return None
    bands = definition.grade_bands
    sections: List[Dict[str, Any]] = []
    overall_pairs: Weighted = []
    for section in definition.sections:
        pairs: Weighted = []
        for item in section.items:
            if item.tool not in SCORED_TOOLS or not item.weight:
                continue
            answer = content.answers.get(item.key)
            if answer is None or answer.rating is None:
                continue
            value = grade_value(item, answer.rating)
            if value is not None:
                pairs.append((item.weight, value))
        if not section.weight:
            continue
        score = _weighted(pairs)
        override = content.section_grades.get(section.key)
        result = _result(
            score,
            bands,
            override.level if override else None,
            override.reason if override else None,
        )
        if result["level"] is not None:
            # The overall is built from the grade that stands, so a section
            # the evaluator regraded counts at the grade they gave it.
            standing = (
                float(result["override_level"])
                if result["override_level"] is not None
                else score
            )
            if standing is not None:
                overall_pairs.append((section.weight, standing))
        sections.append(
            {
                **result,
                "key": section.key,
                "title": section.title,
                "weight": section.weight,
            }
        )
    overall = _result(
        _weighted(overall_pairs),
        bands,
        content.overall_rating,
        content.overall_override_reason,
    )
    return {"sections": sections, "overall": overall}


def grade_errors(
    definition: TemplateDefinition, content: PartContent, evaluator: bool
) -> List[str]:
    """What is wrong with the grades an evaluator gave, as the shape of what
    was sent: only the evaluator grades, only a graded section can be
    regraded, and a changed grade needs its reason."""
    errors: List[str] = []
    if not evaluator:
        if content.section_grades or content.overall_override_reason:
            errors.append("Only the evaluator grades sections.")
        return errors
    if content.section_grades and definition.overall_mode != "sectioned":
        errors.append("This form does not grade sections.")
        return errors
    graded = {s.key for s in definition.sections if s.weight}
    unknown = sorted(set(content.section_grades) - graded)
    if unknown:
        errors.append("A section grade names a section that is not graded.")
    return errors


def override_reason_errors(
    definition: TemplateDefinition, content: PartContent
) -> List[str]:
    """Before submitting: every grade the evaluator changed says why."""
    grades = grade_content(definition, content)
    if grades is None:
        return []
    errors = [
        f"Explain why '{section['title']}' is graded {section['override_label']} "
        f"rather than {section['calculated_label'] or 'ungraded'}."
        for section in grades["sections"]
        if section["override_level"] is not None and not section["reason"]
    ]
    overall = grades["overall"]
    if overall["override_level"] is not None and not overall["reason"]:
        errors.append(
            f"Explain why the overall grade is {overall['override_label']} rather "
            f"than {overall['calculated_label'] or 'ungraded'}."
        )
    return errors


def describe_calculated(result: Dict[str, Any]) -> str:
    """The calculated grade in words: "3.6 of 5 — Exceeds expectations"."""
    if result.get("score") is None:
        return "Not graded"
    return f"{result['score']:.1f} of 5 — {result['calculated_label']}"
