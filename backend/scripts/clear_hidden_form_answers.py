#!/usr/bin/env python3
"""
Remove stale answers to conditional form questions from stored submissions.

A conditional question is shown only while its controlling question has a
particular answer ("Previous EMT experience" only when Membership Type is
EMT). Before submissions were cleaned at the write, a submitter who answered
the conditional question and then changed the controlling answer still sent
the hidden answer, and it was stored. Submissions saved since that fix never
hold one; this script clears the ones saved before it.

When an answer is removed
-------------------------
An answer is removed only when **both** hold:

  * The question's rule, evaluated against the submission's own answers with
    ``FormsService._is_field_visible`` (the same check submission uses now),
    says the question was hidden.
  * Neither the question nor its controlling question has been edited since
    the submission came in (``form_fields.updated_at`` earlier than
    ``form_submissions.submitted_at``).

The second condition exists because no history of rule changes is kept. A
rule added or edited after someone submitted is not the rule they saw, and
judging them by it could delete a genuine answer. Those answers are left in
place and listed in the report for a person to review, as are answers whose
controlling question has since been deleted and rows with no edit time.

``updated_at`` moves on any edit to a field, not just to its rule, so this
errs toward skipping: a relabelled question is treated as possibly changed.

Safety
------
* **Dry run by default.** Nothing is written without ``--apply``.
* **Backup required.** ``--apply`` refuses to run without ``--backup-file``,
  and writes every removed answer to it *before* touching the database. The
  file will not overwrite an existing one and is created readable by its owner
  only, because it holds applicants' answers.
* **Reversible.** ``--restore FILE`` puts the removed answers back, skipping
  any that have been re-added since.
* **Per-organization.** Fields are resolved through an org-scoped form, and
  restore matches submissions by id *and* organization.
* **Audit trail.** Each changed submission is recorded through the normal
  audit logger. The audit entry names the removed questions but never carries
  the answers themselves.
* **No answer values in the report.** Output lists submissions and question
  labels only, so it can be pasted into a ticket.

Usage:

    # See what would be removed (default — writes nothing):
    docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py

    # One organization, or one form:
    docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \\
        --org "Falls Church" --form "Membership Interest"

    # Apply, keeping a backup:
    docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \\
        --apply --backup-file /tmp/hidden-answers-backup.json

    # Undo:
    docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \\
        --restore /tmp/hidden-answers-backup.json

Exit codes:
    0 — nothing left for a person to review
    1 — answers were skipped and need review (or a restore was incomplete)
    2 — database connection error or unhandled exception
"""

import argparse
import asyncio
import html
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.audit import log_audit_event  # noqa: E402
from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.forms import Form, FormField, FormSubmission  # noqa: E402
from app.models.user import Organization  # noqa: E402
from app.services.forms_service import FormsService  # noqa: E402

SOURCE = "scripts/clear_hidden_form_answers.py"


def _utc(value):
    """Compare timestamps as UTC. MySQL hands back naive datetimes that are
    already UTC, while a test or a driver change may hand back aware ones."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _is_conditional(field) -> bool:
    return bool(field.condition_field_id and field.condition_operator)


def _raw_answers(data: dict) -> dict:
    """Stored answers are HTML-escaped at the write; visibility was decided
    in the browser against what the submitter typed, so undo the escaping
    before comparing ("A&amp;B" must match a rule written as "A&B")."""
    return {
        key: html.unescape(value) if isinstance(value, str) else value
        for key, value in data.items()
    }


def classify_submission(submission, fields_by_id: dict) -> dict:
    """Decide which of one submission's answers are stale.

    Returns ``{"remove": [field, ...], "skip": [(field, reason), ...]}``.
    Answers to questions the rule shows are neither, and are not reported.
    """
    data = submission.data if isinstance(submission.data, dict) else {}
    answers = _raw_answers(data)
    submitted_at = _utc(submission.submitted_at)

    remove, skip = [], []
    for field_id in data:
        field = fields_by_id.get(field_id)
        if field is None or not _is_conditional(field):
            continue

        parent = fields_by_id.get(str(field.condition_field_id))
        if parent is None:
            # Without the controlling question there is no telling what the
            # submitter saw.
            skip.append((field, "controlling question has been deleted"))
            continue

        if FormsService._is_field_visible(field, answers):
            continue

        field_edited, parent_edited = _utc(field.updated_at), _utc(parent.updated_at)
        if submitted_at is None or field_edited is None or parent_edited is None:
            skip.append((field, "no edit time recorded"))
        elif field_edited >= submitted_at or parent_edited >= submitted_at:
            skip.append((field, "question edited after this submission"))
        else:
            remove.append(field)

    return {"remove": remove, "skip": skip}


async def _plan(db, org_filter, form_filter):
    """Build the list of intended changes without writing anything."""
    orgs = (await db.execute(select(Organization))).scalars().all()
    if org_filter:
        needle = org_filter.strip().lower()
        orgs = [
            o
            for o in orgs
            if str(o.id) == org_filter or needle in (o.name or "").lower()
        ]
        if not orgs:
            raise SystemExit(f"No organization matched {org_filter!r}")

    plan = []
    for org in orgs:
        forms = (
            (await db.execute(select(Form).where(Form.organization_id == str(org.id))))
            .scalars()
            .all()
        )
        if form_filter:
            needle = form_filter.strip().lower()
            forms = [
                f
                for f in forms
                if str(f.id) == form_filter or needle in (f.name or "").lower()
            ]

        for form in forms:
            # FormField has no organization column; it is reached only
            # through a form already scoped to this organization.
            fields = (
                (
                    await db.execute(
                        select(FormField).where(FormField.form_id == str(form.id))
                    )
                )
                .scalars()
                .all()
            )
            if not any(_is_conditional(f) for f in fields):
                continue
            fields_by_id = {str(f.id): f for f in fields}

            submissions = (
                (
                    await db.execute(
                        select(FormSubmission).where(
                            FormSubmission.form_id == str(form.id),
                            FormSubmission.organization_id == str(org.id),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for submission in submissions:
                decision = classify_submission(submission, fields_by_id)
                if decision["remove"] or decision["skip"]:
                    plan.append(
                        {
                            "org": org,
                            "form": form,
                            "submission": submission,
                            **decision,
                        }
                    )
    return plan


def _print_plan(plan, applying: bool) -> int:
    bar = "=" * 78
    verb = "APPLYING" if applying else "DRY RUN — no changes written"
    print(bar)
    print(f"CLEAR STALE ANSWERS TO HIDDEN FORM QUESTIONS  ({verb})")
    print(bar)

    if not plan:
        print("\nNothing to do — no stored submission holds a hidden answer.")
        print(f"\n{bar}")
        return 0

    removed = skipped = 0
    for item in plan:
        submission = item["submission"]
        print(f"\n{item['org'].name} / {item['form'].name}")
        print(f"  submission={submission.id}  submitted_at={submission.submitted_at}")
        for field in item["remove"]:
            removed += 1
            print(f"  REMOVE  {field.label!r}")
        for field, reason in item["skip"]:
            skipped += 1
            print(f"  SKIP    {field.label!r} — {reason}")

    print(f"\n{bar}")
    print(f"{removed} answer(s) to remove, {skipped} left for a person to review.")
    if not applying and removed:
        print("\nRe-run with --apply --backup-file PATH to remove them.")
    if skipped:
        print(
            "\nSkipped answers may be genuine: the rule was changed after they "
            "were given, or cannot be checked. Review them on the submission."
        )
    print(bar)
    return 1 if skipped else 0


def _write_backup(path: str, changes: list) -> None:
    """Write the backup, refusing to overwrite and readable by owner only."""
    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE,
        "changes": changes,
    }
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


async def _apply(db, plan, backup_path) -> int:
    """Remove the planned answers. The backup is written first, so a failure
    writing it leaves the database untouched."""
    pending = []
    for item in plan:
        if not item["remove"]:
            continue
        submission = item["submission"]
        removed = {
            str(field.id): submission.data[str(field.id)] for field in item["remove"]
        }
        change = {
            "submission_id": str(submission.id),
            "organization_id": str(submission.organization_id),
            "form_id": str(submission.form_id),
            "removed": removed,
        }
        pending.append((item, change))

    if not pending:
        return 0

    changes = [change for _, change in pending]
    _write_backup(backup_path, changes)

    for item, change in pending:
        submission = item["submission"]
        # A new dict, not an in-place delete: a plain Column(JSON) does not
        # track mutation, so popping keys from the loaded dict would be
        # silently dropped at commit (CLAUDE.md pitfall 12).
        submission.data = {
            key: value
            for key, value in submission.data.items()
            if key not in change["removed"]
        }

        await log_audit_event(
            db=db,
            event_type="form_submission_hidden_answers_cleared",
            event_category="forms",
            severity="info",
            event_data={
                "submission_id": change["submission_id"],
                "form_id": change["form_id"],
                "removed_fields": [
                    {"field_id": str(f.id), "label": f.label} for f in item["remove"]
                ],
                "applied_by": SOURCE,
            },
            organization_id=change["organization_id"],
        )

    await db.commit()
    print(f"\nBackup written to {backup_path} ({len(changes)} submission(s))")
    print("  Undo with: --restore " + backup_path)
    return len(changes)


async def _restore(db, path) -> int:
    """Put removed answers back from a backup file."""
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

    changes = payload.get("changes", [])
    if not changes:
        print(f"{path} records no changes — nothing to restore.")
        return 0

    restored, missing, conflicts = 0, 0, 0
    for change in changes:
        submission = (
            await db.execute(
                select(FormSubmission).where(
                    FormSubmission.id == change["submission_id"],
                    FormSubmission.organization_id == change["organization_id"],
                )
            )
        ).scalar_one_or_none()

        if submission is None:
            missing += 1
            print(f"  MISSING  submission {change['submission_id']}")
            continue

        current = submission.data if isinstance(submission.data, dict) else {}
        back = {k: v for k, v in change["removed"].items() if k not in current}
        if len(back) < len(change["removed"]):
            # An answer is present again; restoring over it would discard it.
            conflicts += 1
            print(
                f"  CHANGED  submission {change['submission_id']} — "
                "an answer was re-added since; that one is left alone"
            )
        if not back:
            continue

        # New dict, same reasoning as in _apply().
        submission.data = {**current, **back}

        await log_audit_event(
            db=db,
            event_type="form_submission_hidden_answers_restored",
            event_category="forms",
            severity="info",
            event_data={
                "submission_id": change["submission_id"],
                "form_id": change["form_id"],
                "restored_field_ids": sorted(back),
                "applied_by": SOURCE,
            },
            organization_id=change["organization_id"],
        )
        restored += 1
        print(f"  RESTORE  submission {change['submission_id']}")

    if restored:
        await db.commit()

    print(
        f"\n{restored} restored, {conflicts} with answers re-added since, "
        f"{missing} missing."
    )
    return 1 if (conflicts or missing) else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Remove stale answers to conditional questions that were hidden "
            "when the form was submitted."
        )
    )
    parser.add_argument(
        "--org",
        metavar="ID_OR_NAME",
        help="Limit to one organization (id, or case-insensitive name substring)",
    )
    parser.add_argument(
        "--form",
        metavar="ID_OR_NAME",
        help="Limit to one form (id, or case-insensitive name substring)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Remove the answers (without this, the run is a dry run)",
    )
    parser.add_argument(
        "--backup-file",
        metavar="PATH",
        help="Required with --apply: where to save the removed answers",
    )
    parser.add_argument(
        "--restore",
        metavar="PATH",
        help="Put answers back from a previous --apply's backup file",
    )
    args = parser.parse_args()

    if args.restore and args.apply:
        parser.error("--restore and --apply are mutually exclusive")
    if args.apply and not args.backup_file:
        parser.error("--apply requires --backup-file")
    if args.backup_file and not args.apply:
        parser.error("--backup-file only makes sense with --apply")
    if args.backup_file and os.path.exists(args.backup_file):
        parser.error(f"{args.backup_file} already exists; choose a new path")

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                if args.restore:
                    return await _restore(db, args.restore)

                plan = await _plan(db, args.org, args.form)
                status = _print_plan(plan, args.apply)
                if args.apply:
                    await _apply(db, plan, args.backup_file)
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
