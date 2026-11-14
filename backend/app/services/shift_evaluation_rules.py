"""What a shift evaluation is worth, and when it counts.

The rules two callers share (Pitfall #29): the program credit path
(``ShiftEvaluationService.sync_credit``), which writes each evaluation into a
program's own requirement through the credit ledger, and the compliance
grader (``training_compliance``), which counts the same evaluations for a
department requirement, linked into a program or not (owner decision,
2026-11-14). Kept free of service imports so the grader can read them
without importing the evaluation service, which imports the program service,
which imports the grader.
"""

from typing import Any, Optional

from app.models.external_shift_hours import ExternalShiftHoursStatus
from app.models.shift_evaluation import (
    EXTERNAL_OCCASION,
    SHIFT_OCCASION,
    ShiftEvaluation,
)
from app.models.training import RequirementType

# Requirement types credited only by submitted shift evaluations, and the
# column each one's target lives in. An evaluated-shift count reuses
# required_shifts, as the form beside it does.
EVALUATION_REQUIREMENT_TARGETS = {
    RequirementType.EVALUATED_SHIFTS: "required_shifts",
    RequirementType.TRANSPORTS: "required_transports",
    RequirementType.REFUSALS: "required_refusals",
}

# The requirement types an evaluation credits.
CREDITED_TYPES = tuple(EVALUATION_REQUIREMENT_TARGETS)


def credit_units(evaluation: ShiftEvaluation, requirement: Any) -> float:
    """What one submitted evaluation is worth toward one requirement."""
    rtype = requirement.requirement_type
    statistics = evaluation.statistics or {}
    if rtype == RequirementType.TRANSPORTS:
        return float(statistics.get("transports") or 0)
    if rtype == RequirementType.REFUSALS:
        return float(statistics.get("refusals") or 0)
    if rtype != RequirementType.EVALUATED_SHIFTS:
        return 0.0
    if requirement.evaluation_excludes_lowest_rating:
        # The form's own lowest rating, from the copy it was filled out on,
        # so a later edit to the template's scale cannot regrade it.
        scale = (evaluation.template_snapshot or {}).get("scale") or []
        values = [int(level["value"]) for level in scale if "value" in level]
        if values:
            lowest = min(values)
            for answer in (evaluation.responses or {}).values():
                if (answer or {}).get("rating") == lowest:
                    return 0.0
    return 1.0


def evaluation_visible(
    evaluation: ShiftEvaluation,
    *,
    review_required: bool,
    report_status: Optional[str],
    has_report: bool,
    shift_finalized: bool,
    entry_status: Optional[str],
) -> bool:
    """Whether the evaluated member may see it, on the shift report's terms.

    The decision behind ``ShiftEvaluationService.visible_to_member``, given
    the facts it reads: the department's report-review setting, the member's
    own report for that shift (``has_report`` and its review status), whether
    the shift is finalized, and, for an outside shift, the logged entry's
    status.
    """
    if evaluation.status != "submitted":
        return False
    if (evaluation.occasion or SHIFT_OCCASION) == EXTERNAL_OCCASION:
        # No report to wait for: the member sees it while the logged shift
        # it describes still counts.
        return (
            bool(evaluation.external_shift_id)
            and entry_status == ExternalShiftHoursStatus.COUNTED.value
        )
    if not review_required:
        return True
    if not evaluation.shift_id:
        return False
    if has_report:
        return report_status == "approved"
    # No report of their own to wait for (a general-form seat, or a
    # department that does not ask trainees for one): visible once the shift
    # is closed out (owner decision, 2026-11-13).
    return shift_finalized
