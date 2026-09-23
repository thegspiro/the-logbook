"""
Tests for scripts/clear_hidden_form_answers.py.

The script deletes stored applicant answers, so the tests concentrate on the
decision that makes a deletion safe: the question was hidden under the rule the
submitter actually saw. Anything that cannot be shown to be that rule must be
left alone and reported.

Pure decision logic runs without a database; plan/apply/restore run against
real rows, because the org scoping and the JSON write are what a fake session
would hide.
"""

import importlib.util
import json
import os
import pathlib
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.models.forms import (
    FieldType,
    Form,
    FormField,
    FormStatus,
    FormSubmission,
)

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "clear_hidden_form_answers.py"
)
_spec = importlib.util.spec_from_file_location("_clear_hidden", _SCRIPT)
cleaner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cleaner)

RULE_SET = datetime(2026, 1, 1, tzinfo=timezone.utc)
BEFORE_RULE = RULE_SET - timedelta(days=1)
AFTER_RULE = RULE_SET + timedelta(days=1)


def _field(id_, label, updated_at=RULE_SET, **condition):
    return SimpleNamespace(
        id=id_,
        label=label,
        updated_at=updated_at,
        condition_field_id=condition.get("parent"),
        condition_operator=condition.get("operator"),
        condition_value=condition.get("value"),
    )


MEMBERSHIP = _field("membership", "Membership Type")
EXPERIENCE = _field(
    "experience",
    "Previous EMT experience",
    parent="membership",
    operator="equals",
    value="EMT",
)
FIELDS = {"membership": MEMBERSHIP, "experience": EXPERIENCE}


def _submission(data, submitted_at=AFTER_RULE):
    return SimpleNamespace(data=data, submitted_at=submitted_at)


@pytest.mark.unit
class TestClassifySubmission:
    def test_stale_answer_to_hidden_question_is_removed(self):
        result = cleaner.classify_submission(
            _submission({"membership": "Administrative", "experience": "5 years"}),
            FIELDS,
        )
        assert result == {"remove": [EXPERIENCE], "skip": []}

    def test_answer_to_shown_question_is_kept_and_not_reported(self):
        result = cleaner.classify_submission(
            _submission({"membership": "EMT", "experience": "5 years"}), FIELDS
        )
        assert result == {"remove": [], "skip": []}

    def test_unconditional_answers_are_never_touched(self):
        result = cleaner.classify_submission(
            _submission({"membership": "Administrative"}), FIELDS
        )
        assert result == {"remove": [], "skip": []}

    def test_rule_edited_after_submission_is_skipped(self):
        """The submitter saw an older rule, so the answer may be genuine."""
        result = cleaner.classify_submission(
            _submission(
                {"membership": "Administrative", "experience": "5 years"},
                submitted_at=BEFORE_RULE,
            ),
            FIELDS,
        )
        assert result["remove"] == []
        assert result["skip"] == [(EXPERIENCE, "question edited after this submission")]

    def test_controlling_question_edited_after_submission_is_skipped(self):
        parent = _field("membership", "Membership Type", updated_at=AFTER_RULE)
        result = cleaner.classify_submission(
            _submission(
                {"membership": "Administrative", "experience": "5 years"},
                submitted_at=RULE_SET + timedelta(hours=1),
            ),
            {"membership": parent, "experience": EXPERIENCE},
        )
        assert result["remove"] == []
        assert result["skip"][0][1] == "question edited after this submission"

    def test_edit_at_the_same_instant_counts_as_after(self):
        result = cleaner.classify_submission(
            _submission(
                {"membership": "Administrative", "experience": "5 years"},
                submitted_at=RULE_SET,
            ),
            FIELDS,
        )
        assert result["remove"] == []

    def test_deleted_controlling_question_is_skipped(self):
        result = cleaner.classify_submission(
            _submission({"experience": "5 years"}), {"experience": EXPERIENCE}
        )
        assert result == {
            "remove": [],
            "skip": [(EXPERIENCE, "controlling question has been deleted")],
        }

    def test_missing_timestamps_are_skipped(self):
        result = cleaner.classify_submission(
            _submission(
                {"membership": "Administrative", "experience": "x"},
                submitted_at=None,
            ),
            FIELDS,
        )
        assert result["skip"] == [(EXPERIENCE, "no edit time recorded")]

    def test_naive_timestamps_are_read_as_utc(self):
        """MySQL returns naive datetimes; they must compare with aware ones."""
        result = cleaner.classify_submission(
            _submission(
                {"membership": "Administrative", "experience": "x"},
                submitted_at=AFTER_RULE.replace(tzinfo=None),
            ),
            FIELDS,
        )
        assert result["remove"] == [EXPERIENCE]

    def test_stored_escaping_is_undone_before_comparing(self):
        """A stored "Fire &amp; EMS" was typed as "Fire & EMS"."""
        experience = _field(
            "experience",
            "Experience",
            parent="membership",
            operator="equals",
            value="Fire & EMS",
        )
        result = cleaner.classify_submission(
            _submission({"membership": "Fire &amp; EMS", "experience": "x"}),
            {"membership": MEMBERSHIP, "experience": experience},
        )
        assert result == {"remove": [], "skip": []}

    def test_non_dict_data_is_ignored(self):
        assert cleaner.classify_submission(_submission(None), FIELDS) == {
            "remove": [],
            "skip": [],
        }


async def _seed_org(db, label):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"Hidden Answers {label}", "slug": f"ha-{org_id[:8]}"},
    )
    return org_id


async def _seed_form(db, org_id):
    form = Form(
        organization_id=org_id,
        name="Membership Interest",
        status=FormStatus.PUBLISHED,
    )
    db.add(form)
    await db.flush()
    membership = FormField(
        form_id=form.id,
        label="Membership Type",
        field_type=FieldType.TEXT,
        updated_at=RULE_SET,
    )
    db.add(membership)
    await db.flush()
    experience = FormField(
        form_id=form.id,
        label="Previous EMT experience",
        field_type=FieldType.TEXT,
        condition_field_id=membership.id,
        condition_operator="equals",
        condition_value="EMT",
        updated_at=RULE_SET,
    )
    db.add(experience)
    await db.flush()
    return form, membership, experience


async def _seed_submission(db, org_id, form, data, submitted_at=AFTER_RULE):
    submission = FormSubmission(
        organization_id=org_id,
        form_id=form.id,
        data=data,
        submitted_at=submitted_at,
    )
    db.add(submission)
    await db.flush()
    return submission


async def _reload(db, submission_id):
    """Read the row back from the database. ``populate_existing`` refreshes
    just this one instead of expiring the session, which would force lazy
    loads of the seeded fields outside an awaitable context."""
    row = await db.execute(
        select(FormSubmission)
        .where(FormSubmission.id == submission_id)
        .execution_options(populate_existing=True)
    )
    return row.scalar_one()


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_apply_removes_only_stale_answers_and_restore_undoes_it(
        self, db_session, tmp_path
    ):
        org_id = await _seed_org(db_session, "A")
        form, membership, experience = await _seed_form(db_session, org_id)
        stale = await _seed_submission(
            db_session,
            org_id,
            form,
            {membership.id: "Administrative", experience.id: "5 years"},
        )
        genuine = await _seed_submission(
            db_session,
            org_id,
            form,
            {membership.id: "EMT", experience.id: "3 years"},
        )
        older = await _seed_submission(
            db_session,
            org_id,
            form,
            {membership.id: "Administrative", experience.id: "2 years"},
            submitted_at=BEFORE_RULE,
        )
        await db_session.commit()

        plan = await cleaner._plan(db_session, org_id, None)
        by_submission = {item["submission"].id: item for item in plan}
        assert set(by_submission) == {stale.id, older.id}
        assert cleaner._print_plan(plan, applying=False) == 1

        backup = tmp_path / "backup.json"
        assert await cleaner._apply(db_session, plan, str(backup)) == 1

        assert (await _reload(db_session, stale.id)).data == {
            membership.id: "Administrative"
        }
        assert (await _reload(db_session, genuine.id)).data[experience.id] == (
            "3 years"
        )
        assert (await _reload(db_session, older.id)).data[experience.id] == ("2 years")

        payload = json.loads(backup.read_text())
        assert payload["changes"] == [
            {
                "submission_id": stale.id,
                "organization_id": org_id,
                "form_id": form.id,
                "removed": {experience.id: "5 years"},
            }
        ]
        assert os.stat(backup).st_mode & 0o777 == 0o600

        assert await cleaner._restore(db_session, str(backup)) == 0
        assert (await _reload(db_session, stale.id)).data == {
            membership.id: "Administrative",
            experience.id: "5 years",
        }

    async def test_other_organizations_are_not_touched(self, db_session, tmp_path):
        org_a = await _seed_org(db_session, "A")
        org_b = await _seed_org(db_session, "B")
        form_b, membership_b, experience_b = await _seed_form(db_session, org_b)
        other = await _seed_submission(
            db_session,
            org_b,
            form_b,
            {membership_b.id: "Administrative", experience_b.id: "5 years"},
        )
        await db_session.commit()

        assert await cleaner._plan(db_session, org_a, None) == []
        assert (await _reload(db_session, other.id)).data[experience_b.id] == (
            "5 years"
        )

    async def test_restore_leaves_a_re_added_answer_alone(self, db_session, tmp_path):
        org_id = await _seed_org(db_session, "A")
        form, membership, experience = await _seed_form(db_session, org_id)
        submission = await _seed_submission(
            db_session,
            org_id,
            form,
            {membership.id: "Administrative", experience.id: "5 years"},
        )
        await db_session.commit()

        backup = tmp_path / "backup.json"
        plan = await cleaner._plan(db_session, org_id, None)
        await cleaner._apply(db_session, plan, str(backup))

        current = await _reload(db_session, submission.id)
        current.data = {membership.id: "EMT", experience.id: "corrected"}
        await db_session.commit()

        assert await cleaner._restore(db_session, str(backup)) == 1
        assert (await _reload(db_session, submission.id)).data[experience.id] == (
            "corrected"
        )

    async def test_existing_backup_file_is_never_overwritten(
        self, db_session, tmp_path
    ):
        org_id = await _seed_org(db_session, "A")
        form, membership, experience = await _seed_form(db_session, org_id)
        submission = await _seed_submission(
            db_session,
            org_id,
            form,
            {membership.id: "Administrative", experience.id: "5 years"},
        )
        await db_session.commit()

        backup = tmp_path / "backup.json"
        backup.write_text("earlier backup")
        plan = await cleaner._plan(db_session, org_id, None)

        with pytest.raises(FileExistsError):
            await cleaner._apply(db_session, plan, str(backup))

        assert backup.read_text() == "earlier backup"
        assert (await _reload(db_session, submission.id)).data[experience.id] == (
            "5 years"
        )
