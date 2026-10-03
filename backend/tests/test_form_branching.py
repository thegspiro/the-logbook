"""
Branching ("conditional visibility") in custom forms — workflow review W60.

DB-free. Covers the rules the browser drive found broken:

* a follow-up to a hidden question is itself hidden, and its ``required`` flag
  is not enforced — otherwise answering "No" at the top of a branch left a
  required grandchild demanding an answer about a branch the submitter left;
* "contains" against a checkbox / multi-select answer matches a whole option,
  so selecting "AEMT" does not open the "EMT card number" question;
* the builder may not store a rule naming a question from another form, a
  section header, the field itself, or anything that branches from it;
* removing a rule clears all of it, and deleting a question releases the
  follow-ups that branched from it.

The frontend twin of ``_visible_field_ids`` is ``getVisibleFieldIds`` in
``frontend/src/utils/formVisibility.ts``; ``formVisibility.test.ts`` asserts
the same cases there.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.forms import FieldType, Form, FormField, FormStatus
from app.services.forms_service import FormsService

pytestmark = pytest.mark.unit


def _field(id_, label, field_type=FieldType.TEXT, required=False, rule=None):
    parent, operator, value = (tuple(rule) + (None,) * 3)[:3] if rule else (None,) * 3
    return SimpleNamespace(
        id=id_,
        label=label,
        field_type=field_type,
        required=required,
        min_length=None,
        max_length=None,
        min_value=None,
        max_value=None,
        validation_pattern=None,
        options=None,
        condition_field_id=parent,
        condition_operator=operator,
        condition_value=value,
    )


def _intake_fields():
    """The form built in the W60 drive: a yes/no question, a checkbox list
    shown on "yes", and a required card number shown when EMT is ticked."""
    certified = _field("certified", "Medical certification?", FieldType.RADIO, True)
    certified.options = [{"value": "yes"}, {"value": "no"}]
    which = _field(
        "which",
        "Which certifications?",
        FieldType.CHECKBOX,
        True,
        ("certified", "equals", "yes"),
    )
    which.options = [{"value": "EMT"}, {"value": "AEMT"}, {"value": "Paramedic"}]
    card = _field(
        "card", "EMT card number", FieldType.TEXT, True, ("which", "contains", "EMT")
    )
    name = _field("name", "Full name", FieldType.TEXT, True)
    return [certified, which, card, name]


class TestVisibleFieldIds:
    def test_follow_up_of_a_hidden_question_is_hidden(self):
        visible = FormsService._visible_field_ids(
            _intake_fields(), {"certified": "no", "which": "EMT", "name": "Pat"}
        )
        assert visible == {"certified", "name"}

    def test_whole_branch_shows_when_every_level_is_answered(self):
        visible = FormsService._visible_field_ids(
            _intake_fields(), {"certified": "yes", "which": "EMT,Paramedic"}
        )
        assert visible == {"certified", "which", "card", "name"}

    def test_negative_rule_under_a_hidden_question_stays_hidden(self):
        fields = _intake_fields()
        fields.append(
            _field("why-not", "Why no card?", required=True, rule=("card", "is_empty"))
        )
        visible = FormsService._visible_field_ids(fields, {"certified": "no"})
        assert "why-not" not in visible

    def test_contains_on_a_checkbox_matches_a_whole_option(self):
        visible = FormsService._visible_field_ids(
            _intake_fields(), {"certified": "yes", "which": "AEMT"}
        )
        assert "card" not in visible

    def test_contains_on_a_checkbox_accepts_a_list_answer(self):
        visible = FormsService._visible_field_ids(
            _intake_fields(), {"certified": "yes", "which": ["Paramedic", "EMT"]}
        )
        assert "card" in visible

    def test_contains_on_free_text_is_still_a_substring_match(self):
        fields = [
            _field("notes", "Notes"),
            _field("ems", "EMS detail", rule=("notes", "contains", "ems")),
        ]
        visible = FormsService._visible_field_ids(fields, {"notes": "I do EMS calls"})
        assert "ems" in visible

    def test_rule_naming_a_missing_question_reads_an_empty_answer(self):
        fields = [
            _field("a", "Shown when blank", rule=("gone", "is_empty")),
            _field("b", "Shown on yes", rule=("gone", "equals", "yes")),
        ]
        assert FormsService._visible_field_ids(fields, {}) == {"a"}

    def test_a_cycle_terminates_and_judges_each_rule_on_its_own(self):
        fields = [
            _field("a", "A", rule=("b", "not_empty")),
            _field("b", "B", rule=("a", "not_empty")),
        ]
        assert FormsService._visible_field_ids(fields, {"a": "x", "b": "y"}) == {
            "a",
            "b",
        }
        assert FormsService._visible_field_ids(fields, {}) == set()

    def test_single_rule_check_is_unchanged_for_the_cleanup_script(self):
        # scripts/clear_hidden_form_answers.py decides deletions with this; it
        # must keep judging one rule in isolation, substring "contains" included.
        card = _intake_fields()[2]
        assert FormsService._is_field_visible(card, {"which": "AEMT"}) is True


def _intake_form():
    return SimpleNamespace(
        id="form-id",
        status=FormStatus.PUBLISHED,
        fields=_intake_fields(),
        require_authentication=False,
        allow_multiple_submissions=True,
    )


class TestSubmissionFollowsBranches:
    async def test_public_submit_does_not_demand_a_hidden_grandchild(self):
        service = FormsService(AsyncMock())
        service.get_form_by_slug = AsyncMock(return_value=_intake_form())
        service._sanitize_submission_data = MagicMock(
            return_value=({}, "stop-after-required-check")
        )

        _, error = await service.submit_public_form(
            "abc123abc123", {"certified": "no", "which": "EMT", "name": "Pat"}
        )

        assert error == "stop-after-required-check"

    async def test_authenticated_submit_does_not_demand_a_hidden_grandchild(self):
        service = FormsService(AsyncMock())
        service.get_form_by_id = AsyncMock(return_value=_intake_form())
        service._sanitize_submission_data = MagicMock(
            return_value=({}, "stop-after-required-check")
        )

        _, error = await service.submit_form(
            uuid.uuid4(),
            uuid.uuid4(),
            {"certified": "yes", "which": "AEMT", "name": "Pat"},
        )

        assert error == "stop-after-required-check"

    async def test_a_shown_grandchild_is_still_required(self):
        db = AsyncMock()
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(return_value=_intake_form())

        result, error = await service.submit_form(
            uuid.uuid4(),
            uuid.uuid4(),
            {"certified": "yes", "which": "EMT", "name": "Pat"},
        )

        assert result is None
        assert error == "Required field 'EMT card number' is missing"
        db.add.assert_not_called()

    def test_stale_answers_down_a_hidden_branch_are_not_stored(self):
        sanitized, error = FormsService._sanitize_submission_data(
            {"certified": "no", "which": "EMT", "card": "123", "name": "Pat"},
            _intake_fields(),
        )

        assert error is None
        assert sanitized == {"certified": "no", "name": "Pat"}


class TestConditionError:
    def test_a_question_on_the_same_form_is_accepted(self):
        assert FormsService._condition_error("card", "which", _intake_fields()) is None

    def test_a_question_from_elsewhere_is_refused(self):
        assert FormsService._condition_error(
            "card", str(uuid.uuid4()), _intake_fields()
        )

    def test_a_section_header_is_refused(self):
        fields = _intake_fields() + [
            _field("hdr", "About you", FieldType.SECTION_HEADER)
        ]
        assert FormsService._condition_error("card", "hdr", fields)

    def test_the_field_itself_is_refused(self):
        assert FormsService._condition_error("card", "card", _intake_fields())

    def test_a_question_that_branches_from_the_field_is_refused(self):
        # The top question may not depend on its own grandchild.
        assert FormsService._condition_error("certified", "card", _intake_fields())

    def test_a_new_field_only_needs_an_existing_parent(self):
        assert FormsService._condition_error(None, "card", _intake_fields()) is None


def _stored(id_, label, rule=None, field_type=FieldType.TEXT):
    parent, operator, value = (tuple(rule) + (None,) * 3)[:3] if rule else (None,) * 3
    return FormField(
        id=id_,
        form_id="f1",
        label=label,
        field_type=field_type,
        condition_field_id=parent,
        condition_operator=operator,
        condition_value=value,
    )


def _db_returning(row):
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=row))
    )
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    db.delete = AsyncMock()
    return db


def _form_with(fields):
    form = Form(id="f1", organization_id="org-1", name="Intake")
    form.fields = fields
    return form


class TestBuilderWrites:
    async def test_update_refuses_a_cycle(self):
        top = _stored("top", "Top")
        child = _stored("child", "Child", ("top", "equals", "yes"))
        service = FormsService(_db_returning(top))
        service.get_form_by_id = AsyncMock(return_value=_form_with([top, child]))

        result, error = await service.update_field(
            "top",
            "f1",
            "org-1",
            {"condition_field_id": "child", "condition_operator": "not_empty"},
        )

        assert result is None
        assert "depends on it" in error
        assert top.condition_field_id is None

    async def test_removing_the_controlling_question_clears_the_whole_rule(self):
        top = _stored("top", "Top")
        child = _stored("child", "Child", ("top", "equals", "yes"))
        service = FormsService(_db_returning(child))
        service.get_form_by_id = AsyncMock(return_value=_form_with([top, child]))

        result, error = await service.update_field(
            "child", "f1", "org-1", {"condition_field_id": None}
        )

        assert error is None
        assert (
            result.condition_field_id,
            result.condition_operator,
            result.condition_value,
        ) == (None, None, None)

    async def test_add_refuses_a_question_from_another_form(self):
        db = _db_returning(None)
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(
            return_value=_form_with([_stored("top", "Top")])
        )

        result, error = await service.add_field(
            "f1",
            "org-1",
            {
                "label": "Child",
                "field_type": "text",
                "condition_field_id": str(uuid.uuid4()),
                "condition_operator": "not_empty",
            },
        )

        assert result is None
        assert error == "The question this field depends on is not on this form"
        db.add.assert_not_called()

    async def test_deleting_a_question_releases_its_follow_ups(self):
        top = _stored("top", "Top")
        child = _stored("child", "Child", ("top", "equals", "yes"))
        other = _stored("other", "Other", ("child", "not_empty"))
        db = _db_returning(top)
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(return_value=_form_with([top, child, other]))
        service._refresh_integration_mappings = AsyncMock()

        ok, error = await service.delete_field("top", "f1", "org-1")

        assert (ok, error) == (True, None)
        assert child.condition_field_id is None
        assert child.condition_operator is None
        # A rule on a question that survives is left alone.
        assert other.condition_field_id == "child"
        db.delete.assert_awaited_once_with(top)
