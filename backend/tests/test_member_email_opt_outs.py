"""The administrators' view of who has opted out of which emails.

Owner decision 2026-11-01: administrators may see which members have opted out
of which emails. The view must agree with the senders — a member it lists as
"not emailed" a kind is exactly a member ``member_receives_email`` skips — or
it would mislead the officer deciding whether to make a kind required
(CLAUDE.md pitfall #29). The database half is in
``test_member_email_opt_outs_integration.py``.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.email_policy import (
    EmailKind,
    member_opt_outs,
    member_receives_email,
    not_emailed,
)

pytestmark = pytest.mark.unit

NONE = frozenset()


class TestReadingAMembersOptOuts:
    def test_a_member_who_chose_nothing_has_no_opt_outs(self):
        for prefs in (None, {}, {"email_notifications": True}, "garbage"):
            opt_outs = member_opt_outs(prefs)
            assert opt_outs.email_notifications_off is False
            assert tuple(opt_outs.turned_off) == ()
            assert opt_outs.has_any is False

    def test_the_master_switch_is_reported_apart_from_the_kinds(self):
        opt_outs = member_opt_outs(
            {
                "email_notifications": False,
                "email_kinds": {"shift_notices": False, "volunteer_calls": True},
            }
        )
        assert opt_outs.email_notifications_off is True
        # Turning the switch back on restores exactly these choices.
        assert tuple(opt_outs.turned_off) == (EmailKind.SHIFT_NOTICES,)

    def test_the_older_per_topic_switch_counts_as_an_opt_out(self):
        opt_outs = member_opt_outs({"training_reminders": False})
        assert tuple(opt_outs.turned_off) == (EmailKind.TRAINING_REMINDERS,)

    def test_a_stored_false_for_a_required_kind_is_not_an_opt_out(self):
        opt_outs = member_opt_outs({"email_kinds": {"election_ballots": False}})
        assert tuple(opt_outs.turned_off) == ()


PREFERENCE_CASES = [
    None,
    {},
    {"email_notifications": False},
    {"email_kinds": {"shift_notices": False, "inventory_duties": False}},
    {"email_notifications": False, "email_kinds": {"event_reminders": True}},
    {"event_reminders": False, "email_kinds": {"event_reminders": True}},
    {"training_reminders": False},
]
DEPARTMENT_CASES = [NONE, frozenset({EmailKind.SHIFT_NOTICES})]


class TestAgreementWithTheSenders:
    @pytest.mark.parametrize("prefs", PREFERENCE_CASES)
    @pytest.mark.parametrize("department_required", DEPARTMENT_CASES)
    def test_not_emailed_is_exactly_what_the_senders_skip(
        self, prefs, department_required
    ):
        opt_outs = member_opt_outs(prefs)
        for kind in EmailKind:
            assert not_emailed(opt_outs, kind, department_required) is (
                not member_receives_email(prefs, kind, department_required)
            ), kind

    def test_a_department_required_kind_reaches_a_member_who_turned_it_off(self):
        opt_outs = member_opt_outs(
            {"email_notifications": False, "email_kinds": {"shift_notices": False}}
        )
        assert not_emailed(opt_outs, EmailKind.SHIFT_NOTICES, NONE) is True
        assert (
            not_emailed(
                opt_outs, EmailKind.SHIFT_NOTICES, frozenset({EmailKind.SHIFT_NOTICES})
            )
            is False
        )


class TestTheFilter:
    @pytest.mark.parametrize("kind", ["election_ballots", "made_up"])
    async def test_only_an_optional_kind_can_be_filtered_on(self, kind):
        from app.api.v1.endpoints.email_templates import list_member_email_opt_outs

        user = SimpleNamespace(id="u", organization_id="org-1")
        with pytest.raises(HTTPException) as caught:
            # The refusal comes before any query, so no database is needed.
            await list_member_email_opt_outs(
                kind=kind, skip=0, limit=50, db=None, current_user=user
            )
        assert caught.value.status_code == 400
