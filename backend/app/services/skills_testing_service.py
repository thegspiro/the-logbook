"""Skills testing business logic.

Scoring and pass/fail evaluation for skill-test records is kept here, out of
the HTTP endpoint layer, so it can be unit-tested in isolation. ``calculate_test_result``
is pure (it reads only the template definition and the recorded section results),
so it takes no database session and its model imports are type-checking only.

``apply_test_pass_to_pipeline`` is the one DB-touching helper here: it feeds a
passing test's result into the training pipeline, and uses lazy imports so the
pure-scoring path stays import-light.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from app.models.skills_testing import SkillTemplate, SkillTest


def build_template_snapshot(template: SkillTemplate) -> dict[str, Any]:
    """Freeze the parts of a template a test must be scored and displayed against.

    Deep-copied because ``sections`` is a JSON column: storing the live list
    would leave the snapshot aliasing the template's own value, so a later edit
    to that template would mutate the "frozen" copy too — exactly the bug this
    exists to prevent (Pitfall #12).
    """
    return {
        "version": template.version,
        "sections": copy.deepcopy(template.sections or []),
        "passing_percentage": template.passing_percentage,
        "require_all_critical": template.require_all_critical,
        "time_limit_seconds": template.time_limit_seconds,
    }


def resolve_test_template(
    test: SkillTest, template: SkillTemplate | None
) -> SimpleNamespace | SkillTemplate | None:
    """The structure and scoring rules a given test must be judged by.

    Prefers the test's own snapshot, so editing a published template never
    re-scores or re-labels a test taken against the old one. Falls back to the
    live template for rows created before snapshots existed and for any row the
    backfill could not reach.
    """
    snapshot = getattr(test, "template_snapshot", None)
    if not snapshot:
        return template

    return SimpleNamespace(
        sections=snapshot.get("sections") or [],
        passing_percentage=snapshot.get("passing_percentage"),
        require_all_critical=snapshot.get("require_all_critical"),
        time_limit_seconds=snapshot.get("time_limit_seconds"),
        # Display name always comes from the live template — a renamed template
        # is the same template, and the snapshot exists to freeze structure and
        # scoring rules, not identity.
        name=getattr(template, "name", None),
    )


def resolve_elapsed_seconds(
    measured_seconds: int | None,
    started_at: datetime | None,
    completed_at: datetime | None,
) -> int | None:
    """How long the evaluation took, preferring the examiner's stopwatch.

    The test screen runs a timer the examiner starts, pauses between attempts,
    and stops while equipment resets; its reading is saved before the test is
    completed. Wall clock (``completed_at - started_at``) measures the whole
    sitting instead — a test begun at 09:00 and finished after lunch logged
    seven hours — and time limits are pass/fail criteria here, so it is only a
    fallback for tests completed without a measured value.
    """
    if measured_seconds is not None:
        return measured_seconds
    if started_at and completed_at:
        return int((completed_at - started_at).total_seconds())
    return None


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


# A view tier that is not a disclosure setting: the reader may see that the
# test exists and is awaiting an officer's sign-off, but none of its marks. It
# sits outside ResultDisclosure deliberately — disclosure is what the
# department configured, this is a transient state of one test.
RESULT_VIEW_PENDING = "pending"


def is_pending_validation(test: SkillTest) -> bool:
    """Whether ``test`` is a completed official result no officer has signed off.

    Practice attempts are never validated (there is nothing to credit), and a
    test that is still in progress, cancelled, or voided is not waiting on
    anyone.

    Read through ``getattr`` like the rest of this module's pure helpers, so it
    accepts any object shaped like a test — the disclosure rules are unit-tested
    against lightweight stand-ins rather than ORM rows.
    """
    from app.models.skills_testing import SkillTestStatus

    if getattr(test, "is_practice", False):
        return False
    if getattr(test, "status", None) != SkillTestStatus.COMPLETED.value:
        return False
    return getattr(test, "validated_at", None) is None


class AttemptLimitReached(Exception):
    """Raised when a candidate has used every attempt a requirement allows."""


async def assert_attempts_remaining(
    db: AsyncSession,
    candidate_id: str,
    requirement_id: str | None,
    organization_id: UUID,
) -> None:
    """Guard a requirement's ``max_attempts`` cap for skills tests.

    A passing skills test completes its linked pipeline requirement, so the cap
    has to hold here too — otherwise a candidate capped at two attempts can be
    tested a third time and have the pass credited, while the officer-entered
    knowledge-test path (``update_requirement_progress``) refuses the same
    thing. This mirrors that check: attempts already spent, the cap, and an
    exemption once the requirement is satisfied.

    An attempt is a *validated*, official, non-voided test against this
    requirement — pass or fail, because a failure is an attempt. Voided results
    are excluded: the department withdrew them, so they should not consume a
    candidate's remaining chances. Tests still in progress do not count, which
    means the test currently being completed is not counted against itself.

    Validation, not completion, is what spends the attempt. A peer-run test an
    officer has not signed off is not yet a result, and one the officer
    ultimately rejects must cost the candidate nothing — the same reasoning that
    excludes voided tests.

    Callers must skip practice attempts before calling — they are never
    recorded or credited, so they never consume an attempt.

    Raises:
        AttemptLimitReached: when no attempts remain.
    """
    if not requirement_id:
        return

    from sqlalchemy import func, select

    from app.models.skills_testing import SkillTest, SkillTestStatus
    from app.models.training import (
        EnrollmentStatus,
        ProgramEnrollment,
        RequirementProgress,
        RequirementProgressStatus,
        TrainingRequirement,
    )

    requirement = (
        await db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.id == str(requirement_id)
            )
        )
    ).scalar_one_or_none()

    max_attempts = getattr(requirement, "max_attempts", None) if requirement else None
    if not max_attempts:
        return

    # Already satisfied — nothing to ration. Matches the knowledge-test path,
    # and keeps recertification testing possible for a completed requirement.
    satisfied = (
        await db.execute(
            select(func.count(RequirementProgress.id))
            .join(
                ProgramEnrollment,
                RequirementProgress.enrollment_id == ProgramEnrollment.id,
            )
            .where(
                ProgramEnrollment.user_id == str(candidate_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                RequirementProgress.requirement_id == str(requirement_id),
                RequirementProgress.status.in_(
                    [
                        RequirementProgressStatus.COMPLETED,
                        RequirementProgressStatus.VERIFIED,
                        RequirementProgressStatus.WAIVED,
                    ]
                ),
            )
        )
    ).scalar() or 0
    if satisfied:
        return

    spent = (
        await db.execute(
            select(func.count(SkillTest.id)).where(
                SkillTest.organization_id == str(organization_id),
                SkillTest.candidate_id == str(candidate_id),
                SkillTest.requirement_id == str(requirement_id),
                SkillTest.is_practice.is_(False),
                SkillTest.status == SkillTestStatus.COMPLETED.value,
                SkillTest.validated_at.isnot(None),
            )
        )
    ).scalar() or 0

    if spent >= max_attempts:
        raise AttemptLimitReached(
            f"Maximum attempts ({max_attempts}) reached for this requirement. "
            f"Practice attempts are still available and are never recorded."
        )


async def apply_test_pass_to_pipeline(
    db: AsyncSession,
    candidate_id: str,
    requirement_id: str,
    organization_id: UUID,
    verified_by: UUID,
) -> None:
    """Mark a passed skills test's linked requirement complete on the
    candidate's active enrollment(s).

    Routes through ``TrainingProgramService.update_requirement_progress`` — the
    same path shift completion and session approval use — so the requirement
    reaches 100%, the enrollment rolls up, and phases auto-advance. Call this
    AFTER the test has committed (the updater commits internally); failures are
    logged, never surfaced, since the test result is already saved.
    """
    from sqlalchemy import select

    from app.models.training import (
        EnrollmentStatus,
        ProgramEnrollment,
        RequirementProgress,
    )
    from app.schemas.training_program import RequirementProgressUpdate
    from app.services.training_program_service import TrainingProgramService

    try:
        rows = await db.execute(
            select(RequirementProgress)
            .join(
                ProgramEnrollment,
                RequirementProgress.enrollment_id == ProgramEnrollment.id,
            )
            .where(
                ProgramEnrollment.user_id == str(candidate_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                RequirementProgress.requirement_id == str(requirement_id),
            )
        )
        progress_rows = rows.scalars().all()
        if not progress_rows:
            return

        service = TrainingProgramService(db)
        for progress in progress_rows:
            _, error = await service.update_requirement_progress(
                progress_id=progress.id,
                organization_id=organization_id,
                updates=RequirementProgressUpdate(status="completed"),
                verified_by=verified_by,
            )
            if error:
                logger.error(
                    f"Skills-test pipeline feed failed: candidate={candidate_id} "
                    f"requirement={requirement_id}: {error}"
                )
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Failed to apply skills-test pipeline progress: {e}")


async def revert_test_pass_from_pipeline(
    db: AsyncSession,
    candidate_id: str,
    requirement_id: str,
    organization_id: UUID,
) -> None:
    """Release the requirement a now-voided passing test had credited.

    The mirror of :func:`apply_test_pass_to_pipeline`, run when an official pass
    is voided. Without it a voided test leaves the candidate's enrollment
    showing a satisfied requirement — and a phase possibly advanced — on the
    strength of a result the department has withdrawn.

    Only rows still sitting in a satisfied state are reverted, and they go back
    to ``not_started`` (which clears ``completed_at`` and the rollup
    percentage). A requirement a member has since re-earned by another route
    reads as completed for that reason, not this test, but the two are
    indistinguishable at this layer: ``RequirementProgress`` records the state,
    not which artifact produced it. Reverting is the safe direction — an
    officer re-verifies, whereas a silently retained pass is a credential the
    member never earned. ``WAIVED`` is deliberately left alone: a waiver is an
    officer's own decision, not something this test granted.

    Runs after the void has committed; failures are logged, never surfaced,
    since the void itself is already saved.
    """
    from sqlalchemy import select

    from app.models.training import (
        EnrollmentStatus,
        ProgramEnrollment,
        RequirementProgress,
        RequirementProgressStatus,
    )
    from app.schemas.training_program import RequirementProgressUpdate
    from app.services.training_program_service import TrainingProgramService

    try:
        rows = await db.execute(
            select(RequirementProgress)
            .join(
                ProgramEnrollment,
                RequirementProgress.enrollment_id == ProgramEnrollment.id,
            )
            .where(
                ProgramEnrollment.user_id == str(candidate_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                RequirementProgress.requirement_id == str(requirement_id),
                RequirementProgress.status.in_(
                    [
                        RequirementProgressStatus.COMPLETED,
                        RequirementProgressStatus.VERIFIED,
                    ]
                ),
            )
        )
        progress_rows = rows.scalars().all()
        if not progress_rows:
            return

        service = TrainingProgramService(db)
        for progress in progress_rows:
            _, error = await service.update_requirement_progress(
                progress_id=progress.id,
                organization_id=organization_id,
                updates=RequirementProgressUpdate(status="not_started"),
            )
            if error:
                logger.error(
                    f"Skills-test pipeline revert failed: candidate={candidate_id} "
                    f"requirement={requirement_id}: {error}"
                )
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Failed to revert skills-test pipeline progress: {e}")


# ===========================================================================
# Result disclosure — who may see a scorecard, and how much of it
# ===========================================================================


def resolve_disclosure_policy(
    test: SkillTest,
    template: SkillTemplate | None,
    org_config: Any | None,
) -> tuple[str, str]:
    """The disclosure tier and release mode in force for one test.

    Three levels, most specific first: the test's own override, then its
    template's, then the department default on ``TrainingModuleConfig``. Each
    field falls back independently — a template that only sets a release mode
    still inherits the department's disclosure tier.

    Falls back to full/on_completion, which is the behavior members already
    have. A department that wants results withheld or redacted opts in; nobody
    silently loses sight of results they can see today.
    """
    from app.models.skills_testing import ResultDisclosure, ResultRelease

    def _first(*values: str | None) -> str | None:
        for value in values:
            if value:
                return value
        return None

    disclosure = (
        _first(
            getattr(test, "result_disclosure", None),
            getattr(template, "result_disclosure", None),
            getattr(org_config, "skills_result_disclosure", None),
        )
        or ResultDisclosure.FULL.value
    )
    release = (
        _first(
            getattr(test, "result_release", None),
            getattr(template, "result_release", None),
            getattr(org_config, "skills_result_release", None),
        )
        or ResultRelease.ON_COMPLETION.value
    )
    return disclosure, release


def viewer_positions_for(test: SkillTest, template: SkillTemplate | None) -> set[str]:
    """Position slugs granted sight of this test's result.

    The test's slugs are added to the template's rather than replacing them:
    these are grants, and a per-test list is naturally read as "these people
    as well", not "these people instead of the standing ones".
    """
    slugs: set[str] = set()
    for source in (template, test):
        values = getattr(source, "result_viewer_positions", None) or []
        if isinstance(values, list):
            slugs.update(str(v) for v in values if v)
    return slugs


def resolve_result_view(
    test: SkillTest,
    template: SkillTemplate | None,
    org_config: Any | None,
    *,
    is_officer: bool,
    user_id: str,
    named_viewer_ids: set[str] | None = None,
    user_position_slugs: set[str] | None = None,
) -> str:
    """How much of ``test`` this user may see: "none", "pending", "scores" or "full".

    Officers and the examiner who ran the test always get the full scorecard —
    the policy exists to govern what the person *being evaluated* sees, not to
    hide an officer's own record-keeping from them.

    Everyone else (the candidate, named viewers, position holders) is bound by
    the resolved policy, and by release: under ``on_release`` a completed
    result stays invisible until an officer releases it. A viewer never sees
    more than the candidate does.

    "pending" is returned for an official result still awaiting an officer's
    validation: the reader is told the test exists and is under review, but no
    marks are shown. It is resolved *after* the disclosure and release gates, so
    a test those gates hide stays hidden rather than surfacing as a pending row
    that would vanish again the moment it was validated.
    """
    from app.models.skills_testing import ResultDisclosure, ResultRelease

    if is_officer:
        return ResultDisclosure.FULL.value

    uid = str(user_id)

    # The examiner sees what they themselves recorded, including a practice
    # test they ran as a peer with no officer involved.
    if str(test.examiner_id) == uid:
        return ResultDisclosure.FULL.value

    is_candidate = str(test.candidate_id) == uid
    is_named = uid in (named_viewer_ids or set())
    is_position_viewer = bool(
        viewer_positions_for(test, template) & (user_position_slugs or set())
    )

    if not (is_candidate or is_named or is_position_viewer):
        return ResultDisclosure.NONE.value

    disclosure, release = resolve_disclosure_policy(test, template, org_config)

    if disclosure == ResultDisclosure.NONE.value:
        return ResultDisclosure.NONE.value

    # Practice attempts are the candidate's own drill notes, never recorded and
    # never credited. They are not the department's evaluation record, so the
    # release gate does not apply to them.
    if release == ResultRelease.ON_RELEASE.value and not test.is_practice:
        if not getattr(test, "released_at", None):
            return ResultDisclosure.NONE.value

    if is_pending_validation(test):
        return RESULT_VIEW_PENDING

    return disclosure


def redact_test_for_view(payload: dict[str, Any], view: str) -> dict[str, Any]:
    """Strip from a test response whatever ``view`` does not permit.

    ``scores`` removes every piece of written commentary while leaving the marks
    and points intact. That covers the test's own notes, each criterion's note,
    and the synthetic per-section review-notes entries the examiner writes on
    the review screen — which live inside criteria_results rather than in a
    field of their own, so dropping the obvious `notes` keys alone would leak
    them.

    ``pending`` removes the outcome entirely. The reader may know an official
    test was taken and is awaiting an officer's sign-off; they may not know how
    it went, because until it is validated nobody has decided that it stands.
    The result reads as ``incomplete`` — the same value an unfinished test
    carries — rather than a pass/fail the officer may yet reject.

    Mutates nothing the caller passed in: section results are rebuilt rather
    than edited, so the ORM's loaded JSON is never touched (Pitfall #12).
    """
    from app.models.skills_testing import ResultDisclosure, SkillTestResult

    if view == RESULT_VIEW_PENDING:
        withheld = dict(payload)
        withheld["result"] = SkillTestResult.INCOMPLETE.value
        withheld["overall_score"] = None
        withheld["section_results"] = []
        withheld["notes"] = None
        return withheld

    if view != ResultDisclosure.SCORES.value:
        return payload

    redacted = dict(payload)
    redacted["notes"] = None

    sections = redacted.get("section_results") or []
    clean_sections = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        criteria = []
        for criterion in section.get("criteria_results") or []:
            if not isinstance(criterion, dict):
                continue
            criterion_id = str(criterion.get("criterion_id") or "")
            # The section review note is a pseudo-criterion carrying nothing
            # but prose — redacting its text would leave an empty row, so drop
            # the entry entirely.
            if criterion_id.endswith("-review-notes"):
                continue
            scrubbed = dict(criterion)
            scrubbed["notes"] = None
            criteria.append(scrubbed)
        clean_section = dict(section)
        clean_section["criteria_results"] = criteria
        clean_section["notes"] = None
        clean_sections.append(clean_section)

    redacted["section_results"] = clean_sections
    return redacted


# ===========================================================================
# Candidate notification — telling the member a result is theirs to read
# ===========================================================================


def candidate_result_view(
    test: SkillTest,
    template: SkillTemplate | None,
    org_config: Any | None,
) -> str:
    """How much of ``test`` its own candidate may currently see.

    A thin wrapper over :func:`resolve_result_view` that fixes the reader as the
    person tested. Used by the officer-facing UI to state, before an officer
    acts, exactly what the member will end up seeing — and by the notification
    path below to decide whether there is anything to tell them about at all.
    """
    return resolve_result_view(
        test,
        template,
        org_config,
        is_officer=False,
        user_id=str(test.candidate_id),
    )


def _result_headline(test: SkillTest) -> str:
    """ "Passed (86%)" / "Failed" — the outcome in the form a member reads it."""
    from app.models.skills_testing import SkillTestResult

    outcome = {
        SkillTestResult.PASS.value: "Passed",
        SkillTestResult.FAIL.value: "Failed",
    }.get(getattr(test, "result", None) or "", "Recorded")

    score = getattr(test, "overall_score", None)
    if score is None:
        return outcome
    return f"{outcome} ({round(score)}%)"


async def notify_candidate_result_available(
    db: AsyncSession,
    *,
    test: SkillTest,
    template: SkillTemplate | None,
    org_config: Any | None,
    organization_id: Any,
) -> bool:
    """Tell the candidate their result is now theirs to read. Returns whether it sent.

    Gated on :func:`candidate_result_view` rather than on the officer's action,
    because the two are not the same event. Validating a result under the
    ``on_release`` mode makes it count without making it visible; releasing one
    that is still awaiting validation reveals nothing. A notification is only
    honest when the member can actually open what it points at, so the same
    resolver the read endpoints use decides whether this fires.

    Best-effort: a notification failure must not fail the validation or release
    that produced it, so everything here is caught and logged. The result stands
    either way; the member would simply find it in their history unprompted.
    """
    if getattr(test, "is_practice", False):
        return False

    view = candidate_result_view(test, template, org_config)
    from app.models.skills_testing import ResultDisclosure

    if view not in (ResultDisclosure.SCORES.value, ResultDisclosure.FULL.value):
        return False

    template_name = getattr(template, "name", None) or "Skills test"
    # SCORES strips every note before the member ever sees the scorecard, so
    # promising notes at that tier would send them looking for something that
    # was deliberately withheld.
    notes_line = (
        " The scorecard includes the examiner's notes."
        if view == ResultDisclosure.FULL.value
        else " Per-criterion scoring is shown; examiner notes are not."
    )

    return await _log_candidate_notification(
        db,
        organization_id=organization_id,
        candidate_id=str(test.candidate_id),
        test_id=str(test.id),
        subject=f"Skills test result: {template_name}",
        message=(
            f"Your {template_name} skills test has been reviewed and recorded: "
            f"{_result_headline(test)}.{notes_line}"
        ),
    )


async def notify_candidate_result_voided(
    db: AsyncSession,
    *,
    test: SkillTest,
    template: SkillTemplate | None,
    org_config: Any | None,
    organization_id: Any,
) -> bool:
    """Tell the candidate a result of theirs was withdrawn. Returns whether it sent.

    Same visibility gate as the release notification: a member who was never
    shown the result has nothing to reconcile, and telling them one was voided
    would disclose by implication the evaluation the policy withheld.
    """
    if getattr(test, "is_practice", False):
        return False

    view = candidate_result_view(test, template, org_config)
    from app.models.skills_testing import ResultDisclosure

    if view not in (ResultDisclosure.SCORES.value, ResultDisclosure.FULL.value):
        return False

    template_name = getattr(template, "name", None) or "Skills test"
    reason = (getattr(test, "void_reason", None) or "").strip()

    return await _log_candidate_notification(
        db,
        organization_id=organization_id,
        candidate_id=str(test.candidate_id),
        test_id=str(test.id),
        subject=f"Skills test result withdrawn: {template_name}",
        message=(
            f"Your {template_name} skills test result has been voided and no "
            "longer counts toward your record."
            + (f" Reason: {reason}" if reason else "")
        ),
    )


async def _log_candidate_notification(
    db: AsyncSession,
    *,
    organization_id: Any,
    candidate_id: str,
    test_id: str,
    subject: str,
    message: str,
) -> bool:
    """Write one in-app notification to the candidate, swallowing any failure."""
    try:
        from app.models.notification import NotificationCategory, NotificationChannel
        from app.services.notifications_service import NotificationsService

        _, error = await NotificationsService(db).log_notification(
            organization_id=organization_id,
            log_data={
                "recipient_id": candidate_id,
                "channel": NotificationChannel.IN_APP,
                "subject": subject,
                "message": message,
                "category": NotificationCategory.TRAINING,
                "action_url": f"/training/my-skill-tests/{test_id}",
                "delivered": True,
                "sent_at": datetime.now(timezone.utc),
            },
        )
        if error:
            logger.error(f"Skills-test candidate notification failed: {error}")
            return False
        return True
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Skills-test candidate notification failed: {e}")
        return False
