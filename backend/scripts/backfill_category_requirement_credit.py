#!/usr/bin/env python3
"""
Credit the pipeline requirements that the category-match query used to miss.

Two feeds advance a requirement that is linked to a *training category* rather
than named explicitly: a finalized training session's hours, and an imported
external completion. Both selected their targets with
``TrainingRequirement.category_ids.contains([category_id])``, which is not an
array-membership test. ``contains_op`` is not in the ``JSON`` type's operator
classes, so SQLAlchemy fell back to the string operator and emitted
``category_ids LIKE '%["<id>"]%'`` against the serialized document. MySQL
renders a stored array as ``["a", "b"]``, so that pattern matched only an array
whose **sole** element was the id.

The consequence: a requirement tagged with two or more categories was invisible
to both feeds. Members attended the session, the ``TrainingRecord`` was written,
the hours counted toward general credit — and the requirement stayed at the
percentage it had before. Nothing raised, nothing was logged, and the member's
pipeline simply under-reported. Requirements tagged with exactly one category
were unaffected, which is why this went unnoticed: most are.

The query is fixed (``app.utils.json_ids.json_array_contains``), so new
completions credit correctly. This script repairs the ones already on record.

How it works
------------
It does not recompute anything. Both feeds write through
``apply_requirement_credit``, whose ledger is keyed on
``(progress_id, source_type, source_id)`` and is a no-op when that key is
already present. So the repair is a **replay**: walk the historical sources,
ask the fixed query which requirements they feed, and credit the pairs that have
no ledger row. The pairs that already have one are untouched, which is what
makes the script safe to re-run and what makes its dry run exact.

Because the credit goes through the real updater, requirement percentage,
auto-completion, enrollment rollup and phase advancement all follow — this does
not reimplement any of that, and deliberately does not reimplement the two
feeds' differing enrollment rules either:

  * **Sessions** credit an ACTIVE *or* COMPLETED enrollment, in the precedence
    ``TrainingSessionService._resolve_pipeline_enrollment`` documents (a member
    whose own credit carried them past 100% is no longer active, and is exactly
    the member who must not be skipped). This script calls that resolver.
  * **External imports** credit ACTIVE enrollments only. This script calls
    ``credit_category_progress`` itself, so that stays true.

Those rules differ on purpose. Inventing a third one here would make a member's
repaired history disagree with the feed that will maintain it tomorrow.

Replay, not restatement
-----------------------
The session feed's own helper passes ``restate=True``, which is right for a
re-finalize — the source changed and the pipeline must follow the new figure —
and wrong here. A backfill's sources have not changed; it is filling gaps. With
``restate=True``, any disagreement between a ``TrainingRecord``'s hours and an
existing ledger row would silently rewrite correct history. So this script
composes the real resolver with ``apply_requirement_credit(restate=False)``:
a pair that is already credited is a no-op, never a correction.

Safety
------
* **Dry run by default.** Nothing is written without ``--apply``.
* **Idempotent.** The ledger key means a second ``--apply`` writes nothing.
* **Per-organization.** Every query is org-scoped, and enrollment resolution
  runs inside the owning org, so this cannot move credit across tenants.
* **Rollback file.** ``--apply`` records every credit written;
  ``--restore FILE`` reverses exactly those through
  ``revoke_requirement_credit``, leaving pre-existing credit alone.
* **Audit trail.** Each credit is recorded through the normal audit logger, so
  it lands in the same tamper-evident chain as an officer's sign-off.
* **No notifications.** ``TrainingProgramService`` sends no email, SMS or push,
  so repairing months of history cannot spam a department.
* **Not atomic across credits.** The real updater commits internally, so this
  cannot run as one transaction. An interrupted run leaves the credits it
  already wrote; re-running resumes, and the rollback file covers what landed.

Scope note
----------
The repair walks every session and imported record the filters admit, not only
the multi-category requirements theory says were missed — the ledger is the
ground truth, and a run that trusted the theory would hide a case it did not
predict. The output reports how many repaired requirements carried two or more
categories, so the theory is confirmed by the run rather than assumed by it.

Usage:

    # What would be credited (default — writes nothing):
    docker exec -it intranet-backend python \
        scripts/backfill_category_requirement_credit.py

    # Repair, recording a rollback file:
    docker exec -it intranet-backend python \
        scripts/backfill_category_requirement_credit.py \
        --apply --rollback-file /tmp/category-credit-rollback.json

    # One organization, sessions only:
    docker exec -it intranet-backend python \
        scripts/backfill_category_requirement_credit.py \
        --org "Falls Church" --only sessions --apply

    # Undo:
    docker exec -it intranet-backend python \
        scripts/backfill_category_requirement_credit.py \
        --restore /tmp/category-credit-rollback.json

Exit codes:
    0 — nothing missing, or everything missing was credited
    1 — credits are missing and this was a dry run (or --restore hit a snag)
    2 — database connection error or unhandled exception
"""

import argparse
import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import or_, select  # noqa: E402

from app.core.audit import log_audit_event  # noqa: E402
from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.training import (  # noqa: E402
    EnrollmentStatus,
    ProgramEnrollment,
    ProgressCreditSource,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingStatus,
)
from app.models.user import Organization  # noqa: E402
from app.services.training_program_service import (  # noqa: E402
    TrainingProgramService,
)
from app.services.training_session_service import (  # noqa: E402
    TrainingSessionService,
)
from app.utils.json_ids import json_array_contains  # noqa: E402

SCRIPT_NAME = "scripts/backfill_category_requirement_credit.py"


@dataclass
class PlannedCredit:
    """One (requirement progress, source) pair with no ledger row."""

    organization_id: str
    organization_name: str
    progress_id: str
    source_type: ProgressCreditSource
    source_id: str
    units: float
    user_id: str
    requirement_id: str
    requirement_name: str
    category_count: int
    verified_by: Optional[str]
    origin: str


@dataclass
class Plan:
    session_credits: List[PlannedCredit] = field(default_factory=list)
    #: Imported records to replay. Their per-requirement fan-out is decided by
    #: ``credit_category_progress`` at apply time, so it is not predicted here;
    #: what landed is read back off the ledger afterwards.
    import_records: List[Dict[str, Any]] = field(default_factory=list)
    sessions_scanned: int = 0
    records_scanned: int = 0
    already_credited: int = 0
    unresolved: List[str] = field(default_factory=list)


async def _organizations(db, selector: Optional[str]) -> List[Organization]:
    query = select(Organization)
    if selector:
        query = query.where(
            or_(
                Organization.id == selector,
                Organization.name.ilike(f"%{selector}%"),
            )
        )
    return list((await db.execute(query.order_by(Organization.name))).scalars().all())


async def _already_credited(
    db, progress_id: str, source_type: ProgressCreditSource, source_id: str
) -> bool:
    row = await db.execute(
        select(RequirementProgressCredit.id).where(
            RequirementProgressCredit.progress_id == str(progress_id),
            RequirementProgressCredit.source_type == source_type,
            RequirementProgressCredit.source_id == str(source_id),
        )
    )
    return row.scalar_one_or_none() is not None


async def _credited_progress_ids(
    db, source_type: ProgressCreditSource, source_id: str
) -> set:
    rows = await db.execute(
        select(RequirementProgressCredit.progress_id).where(
            RequirementProgressCredit.source_type == source_type,
            RequirementProgressCredit.source_id == str(source_id),
        )
    )
    return {str(r[0]) for r in rows.all()}


async def _plan_sessions(db, org: Organization, plan: Plan, limit: Optional[int]):
    """Session-fed credit that the old query never wrote.

    Mirrors the live condition in ``_finalize_training_records``: a session
    feeds its category's requirements only when it is program-linked, carries a
    category, names no explicit requirement, and counts toward certification.
    """
    session_service = TrainingSessionService(db)
    org_id = UUID(str(org.id))

    sessions = (
        (
            await db.execute(
                select(TrainingSession)
                .where(
                    TrainingSession.organization_id == str(org.id),
                    TrainingSession.program_id.isnot(None),
                    TrainingSession.category_id.isnot(None),
                    TrainingSession.requirement_id.is_(None),
                    TrainingSession.counts_toward_certification.is_(True),
                )
                .order_by(TrainingSession.created_at)
            )
        )
        .scalars()
        .all()
    )

    for training_session in sessions:
        if limit is not None and len(plan.session_credits) >= limit:
            return
        plan.sessions_scanned += 1

        # The FIXED query. This is the whole point: it now returns the
        # multi-category requirements the broken one skipped.
        requirement_ids = await session_service._resolve_category_requirement_ids(
            training_session.program_id,
            training_session.category_id,
            training_session.phase_id,
        )
        if not requirement_ids:
            continue

        requirements = {
            str(r.id): r
            for r in (
                await db.execute(
                    select(TrainingRequirement).where(
                        TrainingRequirement.id.in_([str(i) for i in requirement_ids]),
                        TrainingRequirement.organization_id == str(org.id),
                    )
                )
            )
            .scalars()
            .all()
        }

        # The hours each member was actually credited for this session are the
        # ones its TrainingRecord carries: `_finalize_training_records` writes
        # the same `hours_completed` value to the record and to the pipeline
        # update, so the record is a faithful source for the replay. A member
        # with nothing to credit has their record voided rather than zeroed,
        # which is why only COMPLETED rows are read.
        records = (
            (
                await db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == str(org.id),
                        TrainingRecord.source_event_id
                        == str(training_session.event_id),
                        TrainingRecord.status == TrainingStatus.COMPLETED,
                        TrainingRecord.hours_completed > 0,
                    )
                )
            )
            .scalars()
            .all()
        )

        for record in records:
            plan.records_scanned += 1
            enrollment = await session_service._resolve_pipeline_enrollment(
                user_id=str(record.user_id),
                program_id=str(training_session.program_id),
                session_id=str(training_session.id),
                organization_id=org_id,
            )
            if not enrollment:
                # No enrollment means no destination — the live feed treats
                # this as resolved-and-nothing-to-do, and so does this.
                continue

            for requirement_id in requirement_ids:
                requirement = requirements.get(str(requirement_id))
                if requirement is None:
                    continue

                progress = (
                    await db.execute(
                        select(RequirementProgress)
                        .where(RequirementProgress.enrollment_id == enrollment.id)
                        .where(
                            RequirementProgress.requirement_id == str(requirement_id)
                        )
                    )
                ).scalar_one_or_none()
                if progress is None:
                    continue

                if await _already_credited(
                    db,
                    progress.id,
                    ProgressCreditSource.TRAINING_SESSION,
                    str(training_session.id),
                ):
                    plan.already_credited += 1
                    continue

                plan.session_credits.append(
                    PlannedCredit(
                        organization_id=str(org.id),
                        organization_name=org.name,
                        progress_id=str(progress.id),
                        source_type=ProgressCreditSource.TRAINING_SESSION,
                        source_id=str(training_session.id),
                        units=float(record.hours_completed),
                        user_id=str(record.user_id),
                        requirement_id=str(requirement_id),
                        requirement_name=requirement.name,
                        category_count=len(requirement.category_ids or []),
                        verified_by=(
                            str(record.created_by) if record.created_by else None
                        ),
                        origin="session",
                    )
                )


async def _plan_imports(db, org: Organization, plan: Plan, limit: Optional[int]):
    """Imported external completions whose category feed has gaps.

    ``credit_category_progress`` remains the authority at apply time: this
    script calls it rather than reimplementing it, and reads back off the
    ledger what it actually wrote. The planner below mirrors two of its filters
    — ACTIVE enrollments, and HOURS/COURSES requirement types — purely so the
    dry run can say whether anything is missing. If those rules ever change,
    the apply stays correct and only this estimate drifts, which is the right
    way round.
    """
    records = (
        (
            await db.execute(
                select(TrainingRecord)
                .where(
                    TrainingRecord.organization_id == str(org.id),
                    TrainingRecord.category_id.isnot(None),
                    TrainingRecord.external_record_id.isnot(None),
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                    TrainingRecord.hours_completed > 0,
                )
                .order_by(TrainingRecord.created_at)
            )
        )
        .scalars()
        .all()
    )

    for record in records:
        if limit is not None and len(plan.import_records) >= limit:
            return
        plan.records_scanned += 1

        # Requirements this record's category now reaches, via the same helper
        # the fixed feed uses rather than re-deriving array membership here.
        candidates = (
            await db.execute(
                select(TrainingRequirement.id, TrainingRequirement.category_ids)
                .where(TrainingRequirement.organization_id == str(org.id))
                .where(TrainingRequirement.active.is_(True))
                .where(
                    TrainingRequirement.requirement_type.in_(
                        (RequirementType.HOURS, RequirementType.COURSES)
                    )
                )
                .where(
                    json_array_contains(
                        TrainingRequirement.category_ids, record.category_id
                    )
                )
            )
        ).all()
        if not candidates:
            continue

        # Scoped to THIS member's active enrollments — a progress row belonging
        # to somebody else is not this record's to credit.
        progress_rows = (
            await db.execute(
                select(RequirementProgress.id)
                .join(
                    ProgramEnrollment,
                    RequirementProgress.enrollment_id == ProgramEnrollment.id,
                )
                .where(
                    ProgramEnrollment.user_id == str(record.user_id),
                    ProgramEnrollment.organization_id == str(org.id),
                    ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                    RequirementProgress.requirement_id.in_(
                        [str(r[0]) for r in candidates]
                    ),
                )
            )
        ).all()
        if not progress_rows:
            continue

        credited = await _credited_progress_ids(
            db, ProgressCreditSource.EXTERNAL_IMPORT, str(record.id)
        )
        outstanding = {str(r[0]) for r in progress_rows} - credited
        if not outstanding:
            plan.already_credited += len(credited)
            continue

        plan.import_records.append(
            {
                "organization_id": str(org.id),
                "organization_name": org.name,
                "record_id": str(record.id),
                "user_id": str(record.user_id),
                "category_id": str(record.category_id),
                "hours": float(record.hours_completed or 0),
                "outstanding": len(outstanding),
                "multi_category_matches": sum(
                    1 for r in candidates if len(r[1] or []) > 1
                ),
                "already_credited": len(credited),
            }
        )


async def _plan(db, selector, only, limit) -> Plan:
    plan = Plan()
    for org in await _organizations(db, selector):
        if only in (None, "sessions"):
            await _plan_sessions(db, org, plan, limit)
        if only in (None, "imports"):
            await _plan_imports(db, org, plan, limit)
    return plan


def _print_plan(plan: Plan, applying: bool) -> int:
    bar = "=" * 78
    verb = "APPLYING" if applying else "DRY RUN — no changes written"
    print(bar)
    print(f"BACKFILL CATEGORY-MATCHED REQUIREMENT CREDIT  ({verb})")
    print(bar)
    print(
        f"\nScanned {plan.sessions_scanned} session(s) and "
        f"{plan.records_scanned} training record(s); "
        f"{plan.already_credited} credit(s) already on the ledger."
    )

    if not plan.session_credits and not plan.import_records:
        print("\nNothing missing — every category-matched credit is on the ledger.")
        print(f"\n{bar}")
        return 0

    if plan.session_credits:
        print(f"\nSession-fed credits missing: {len(plan.session_credits)}")
        by_requirement: Dict[str, List[PlannedCredit]] = {}
        for credit in plan.session_credits:
            by_requirement.setdefault(credit.requirement_id, []).append(credit)
        for requirement_id, credits in by_requirement.items():
            first = credits[0]
            hours = sum(c.units for c in credits)
            print(
                f"\n  {first.organization_name} / {first.requirement_name}"
                f"  ({first.category_count} categor"
                f"{'ies' if first.category_count != 1 else 'y'})"
            )
            print(f"    requirement={requirement_id}")
            print(
                f"    {len(credits)} credit(s), {hours:g} hour(s), "
                f"{len({c.user_id for c in credits})} member(s)"
            )

    if plan.import_records:
        print(f"\nImported records to replay: {len(plan.import_records)}")
        for item in plan.import_records[:20]:
            print(
                f"  {item['organization_name']}  record={item['record_id']}"
                f"  {item['hours']:g}h  category={item['category_id']}"
                f"  ({item['multi_category_matches']} multi-category match(es))"
            )
        if len(plan.import_records) > 20:
            print(f"  ... and {len(plan.import_records) - 20} more")

    multi = sum(1 for c in plan.session_credits if c.category_count > 1)
    print(
        f"\n{multi} of {len(plan.session_credits)} missing session credit(s) are for "
        "a requirement carrying two or more categories — the shape the broken "
        "query could not match."
    )
    if plan.unresolved:
        print(f"\n{len(plan.unresolved)} source(s) could not be resolved:")
        for note in plan.unresolved[:10]:
            print(f"  {note}")

    print(f"\n{bar}")
    if not applying:
        print("Re-run with --apply to write these, ideally with --rollback-file.")
    print(bar)
    return 0 if applying else 1


async def _apply(db, plan: Plan, rollback_path, verified_by_fallback) -> int:
    """Write the missing credits, recording rollback state and audit entries."""
    program_service = TrainingProgramService(db)
    written: List[Dict[str, Any]] = []
    failures: List[str] = []

    for credit in plan.session_credits:
        actor = credit.verified_by or verified_by_fallback
        _, error = await program_service.apply_requirement_credit(
            progress_id=credit.progress_id,
            organization_id=UUID(credit.organization_id),
            source_type=credit.source_type,
            source_id=credit.source_id,
            units=credit.units,
            verified_by=UUID(actor) if actor else None,
            applied_by=UUID(actor) if actor else None,
            can_manage=True,
            # Replay, never restatement — see the module docstring.
            restate=False,
        )
        if error:
            failures.append(
                f"session {credit.source_id} -> {credit.requirement_name}: {error}"
            )
            continue

        written.append(
            {
                "organization_id": credit.organization_id,
                "progress_id": credit.progress_id,
                "source_type": credit.source_type.value,
                "source_id": credit.source_id,
                "units": credit.units,
                "requirement_id": credit.requirement_id,
                "requirement_name": credit.requirement_name,
                "user_id": credit.user_id,
                "origin": credit.origin,
            }
        )
        await log_audit_event(
            db=db,
            event_type="training_category_credit_backfilled",
            event_category="training",
            severity="info",
            event_data={
                "progress_id": credit.progress_id,
                "requirement_id": credit.requirement_id,
                "requirement_name": credit.requirement_name,
                "user_id": credit.user_id,
                "source_type": credit.source_type.value,
                "source_id": credit.source_id,
                "units": credit.units,
                "applied_by": SCRIPT_NAME,
                "action": "category_credit_backfilled",
            },
            organization_id=credit.organization_id,
        )

    for item in plan.import_records:
        before = await _credited_progress_ids(
            db, ProgressCreditSource.EXTERNAL_IMPORT, item["record_id"]
        )
        try:
            await program_service.credit_category_progress(
                user_id=item["user_id"],
                organization_id=UUID(item["organization_id"]),
                category_id=item["category_id"],
                hours=item["hours"],
                is_course_completion=True,
                source_id=item["record_id"],
            )
        except Exception as exc:  # pragma: no cover - operational safety net
            failures.append(f"record {item['record_id']}: {exc}")
            continue

        # Read back what landed rather than predicting it, so the rollback
        # reverses exactly the credits this run created and nothing else.
        after = await _credited_progress_ids(
            db, ProgressCreditSource.EXTERNAL_IMPORT, item["record_id"]
        )
        for progress_id in sorted(after - before):
            written.append(
                {
                    "organization_id": item["organization_id"],
                    "progress_id": progress_id,
                    "source_type": ProgressCreditSource.EXTERNAL_IMPORT.value,
                    "source_id": item["record_id"],
                    "units": item["hours"],
                    "requirement_id": None,
                    "requirement_name": None,
                    "user_id": item["user_id"],
                    "origin": "external-import",
                }
            )
            await log_audit_event(
                db=db,
                event_type="training_category_credit_backfilled",
                event_category="training",
                severity="info",
                event_data={
                    "progress_id": progress_id,
                    "user_id": item["user_id"],
                    "source_type": ProgressCreditSource.EXTERNAL_IMPORT.value,
                    "source_id": item["record_id"],
                    "units": item["hours"],
                    "applied_by": SCRIPT_NAME,
                    "action": "category_credit_backfilled",
                },
                organization_id=item["organization_id"],
            )

    await db.commit()

    print(f"\n{len(written)} credit(s) written.")
    if failures:
        print(f"{len(failures)} failed:")
        for note in failures[:20]:
            print(f"  {note}")

    if rollback_path and written:
        payload = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": SCRIPT_NAME,
            "credits": written,
        }
        with open(rollback_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        print(f"\nRollback written to {rollback_path} ({len(written)} credit(s))")
        print("  Undo with: --restore " + rollback_path)

    return 1 if failures else 0


async def _restore(db, path) -> int:
    """Reverse exactly the credits a rollback file records."""
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

    credits = payload.get("credits", [])
    if not credits:
        print(f"{path} records no credits — nothing to restore.")
        return 0

    program_service = TrainingProgramService(db)
    reversed_count, failed = 0, 0
    for credit in credits:
        _, error = await program_service.revoke_requirement_credit(
            progress_id=credit["progress_id"],
            organization_id=UUID(credit["organization_id"]),
            source_type=ProgressCreditSource(credit["source_type"]),
            source_id=credit["source_id"],
        )
        if error:
            failed += 1
            print(f"  FAILED   {credit['progress_id']}: {error}")
            continue
        reversed_count += 1
        await log_audit_event(
            db=db,
            event_type="training_category_credit_backfill_reversed",
            event_category="training",
            severity="info",
            event_data={
                "progress_id": credit["progress_id"],
                "source_type": credit["source_type"],
                "source_id": credit["source_id"],
                "units": credit.get("units"),
                "applied_by": SCRIPT_NAME,
                "action": "category_credit_backfill_reversed",
            },
            organization_id=credit["organization_id"],
        )

    await db.commit()
    print(f"\n{reversed_count} reversed, {failed} failed.")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Credit the pipeline requirements that the category-match query "
            "used to miss, by replaying historical sessions and imports "
            "through the idempotent credit ledger."
        )
    )
    parser.add_argument(
        "--org",
        metavar="ID_OR_NAME",
        help="Limit to one organization (id, or case-insensitive name substring)",
    )
    parser.add_argument(
        "--only",
        choices=("sessions", "imports"),
        help="Repair only one of the two feeds (default: both)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        metavar="N",
        help="Stop after planning N credits/records per feed (for a first look)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the credits (without this, the run is a dry run)",
    )
    parser.add_argument(
        "--verified-by",
        metavar="USER_ID",
        help=(
            "Actor to attribute a credit to when its source row records none "
            "(pre-upgrade training records carry no created_by). Without this, "
            "such a credit is written with no actor rather than a guessed one."
        ),
    )
    parser.add_argument(
        "--rollback-file",
        metavar="PATH",
        help="With --apply, record every credit written so it can be undone",
    )
    parser.add_argument(
        "--restore",
        metavar="PATH",
        help="Reverse a previous --apply using its rollback file",
    )
    args = parser.parse_args()

    if args.restore and args.apply:
        parser.error("--restore and --apply are mutually exclusive")
    if args.rollback_file and not args.apply:
        parser.error("--rollback-file only makes sense with --apply")
    if args.verified_by:
        try:
            UUID(args.verified_by)
        except ValueError:
            parser.error("--verified-by must be a UUID")

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                if args.restore:
                    return await _restore(db, args.restore)

                plan = await _plan(db, args.org, args.only, args.limit)
                status = _print_plan(plan, args.apply)
                if args.apply:
                    return await _apply(db, plan, args.rollback_file, args.verified_by)
                return status
        finally:
            await database_manager.disconnect()

    try:
        return asyncio.run(_main())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - operational safety net
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
