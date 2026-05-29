"""Skills testing business logic.

Scoring and pass/fail evaluation for skill-test records is kept here, out of
the HTTP endpoint layer, so it can be unit-tested in isolation. The scoring is
pure (it reads only the template definition and the recorded section results),
so it takes no database session and the model imports are type-checking only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.skills_testing import SkillTemplate, SkillTest


def calculate_test_result(
    test: SkillTest, template: SkillTemplate
) -> tuple[float | None, str]:
    """
    Calculate the overall score and pass/fail result for a completed test.

    Returns:
        Tuple of (overall_score, result_string)
    """
    section_results = test.section_results or []
    template_sections = template.sections or []

    if not section_results:
        return None, "fail"

    # Calculate overall score using point-based totals from score criteria.
    # Sum earned points and total available points across all sections.
    total_earned = 0.0
    total_available = 0.0
    has_score_criteria = False

    for section_idx, section in enumerate(template_sections):
        if not isinstance(section, dict):
            continue
        section_id = f"section-{section_idx}"
        section_name = section.get("name")

        # Find matching section result
        sr_match = None
        for sr in section_results:
            if not isinstance(sr, dict):
                continue
            if (
                sr.get("section_id") == section_id
                or sr.get("section_name") == section_name
            ):
                sr_match = sr
                break

        criteria = section.get("criteria", [])
        for ci, criterion in enumerate(criteria):
            if not isinstance(criterion, dict):
                continue
            if criterion.get("type") != "score":
                continue
            max_score = criterion.get("max_score")
            if max_score is None or max_score <= 0:
                continue

            has_score_criteria = True
            total_available += max_score

            if sr_match:
                criterion_id = f"criterion-{section_idx}-{ci}"
                criterion_label = criterion.get("label")
                for cr in sr_match.get("criteria_results", []):
                    if not isinstance(cr, dict):
                        continue
                    if (
                        cr.get("criterion_id") == criterion_id
                        or cr.get("criterion_label") == criterion_label
                    ):
                        earned = cr.get("score")
                        if earned is not None:
                            total_earned += earned
                        break

    # Use point-based totals when score criteria exist, otherwise fall back
    # to averaging section_score percentages
    if has_score_criteria and total_available > 0:
        overall_score: float | None = round((total_earned / total_available) * 100, 1)
    else:
        section_scores = []
        for sr in section_results:
            if isinstance(sr, dict) and sr.get("section_score") is not None:
                section_scores.append(sr["section_score"])
        overall_score = (
            round(sum(section_scores) / len(section_scores), 1)
            if section_scores
            else None
        )

    # Check passing percentage
    passes_percentage = True
    if template.passing_percentage is not None and overall_score is not None:
        passes_percentage = overall_score >= template.passing_percentage

    # Check critical criteria (required criteria must all pass)
    all_critical_passed = True
    if template.require_all_critical:
        for section_idx, section in enumerate(template_sections):
            if not isinstance(section, dict):
                continue
            criteria = section.get("criteria", [])
            section_id = f"section-{section_idx}"
            section_name = section.get("name")

            # Find matching section result (by ID or name)
            section_result = None
            for sr in section_results:
                if not isinstance(sr, dict):
                    continue
                if (
                    sr.get("section_id") == section_id
                    or sr.get("section_name") == section_name
                ):
                    section_result = sr
                    break

            if not section_result:
                # If a section with required criteria has no result, it fails
                if any(
                    c.get("required", False) for c in criteria if isinstance(c, dict)
                ):
                    all_critical_passed = False
                continue

            criteria_results = section_result.get("criteria_results", [])
            for ci, criterion in enumerate(criteria):
                if not isinstance(criterion, dict) or not criterion.get(
                    "required", False
                ):
                    continue
                # Statement criteria are read-only informational items
                # and always count as passed
                if criterion.get("type") == "statement":
                    continue
                criterion_id = f"criterion-{section_idx}-{ci}"
                criterion_label = criterion.get("label")

                # Find matching criterion result (by ID or label)
                cr_result = None
                for cr in criteria_results:
                    if not isinstance(cr, dict):
                        continue
                    if (
                        cr.get("criterion_id") == criterion_id
                        or cr.get("criterion_label") == criterion_label
                    ):
                        cr_result = cr
                        break
                if not cr_result or not cr_result.get("passed", False):
                    all_critical_passed = False

    # Determine final result
    if passes_percentage and all_critical_passed:
        test_result = "pass"
    else:
        test_result = "fail"

    return overall_score, test_result
