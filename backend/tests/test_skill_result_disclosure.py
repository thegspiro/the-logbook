"""
Tests for skills-test result disclosure.

Three axes, each resolved test → template → organization: how much of a result
the person tested may see (none / scores / full), when it becomes visible
(on completion, or only once an officer releases it), and who besides the
candidate may see it (named viewers, position holders).

Pure functions; no database.
"""

from types import SimpleNamespace

from app.models.skills_testing import ResultDisclosure, ResultRelease
from app.services.skills_testing_service import (
    RESULT_VIEW_PENDING,
    redact_test_for_view,
    resolve_disclosure_policy,
    resolve_result_view,
    viewer_positions_for,
)

CANDIDATE = "user-candidate"
EXAMINER = "user-examiner"
STRANGER = "user-stranger"


def _test(**overrides):
    base = {
        "candidate_id": CANDIDATE,
        "examiner_id": EXAMINER,
        "is_practice": False,
        "released_at": None,
        "result_disclosure": None,
        "result_release": None,
        "result_viewer_positions": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _template(**overrides):
    base = {
        "result_disclosure": None,
        "result_release": None,
        "result_viewer_positions": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _config(**overrides):
    base = {"skills_result_disclosure": None, "skills_result_release": None}
    base.update(overrides)
    return SimpleNamespace(**base)


def _view(test, template=None, config=None, *, user_id=CANDIDATE, **kwargs):
    return resolve_result_view(
        test,
        template,
        config,
        is_officer=kwargs.pop("is_officer", False),
        user_id=user_id,
        **kwargs,
    )


class TestPolicyResolution:
    def test_defaults_preserve_current_behavior(self):
        """Nothing configured anywhere must mean full results on completion —
        otherwise enabling this feature silently hides results members can
        already see."""
        assert resolve_disclosure_policy(_test(), None, None) == (
            ResultDisclosure.FULL.value,
            ResultRelease.ON_COMPLETION.value,
        )

    def test_organization_default_applies(self):
        disclosure, release = resolve_disclosure_policy(
            _test(),
            _template(),
            _config(
                skills_result_disclosure="scores",
                skills_result_release="on_release",
            ),
        )
        assert (disclosure, release) == ("scores", "on_release")

    def test_template_overrides_organization(self):
        disclosure, _ = resolve_disclosure_policy(
            _test(),
            _template(result_disclosure="none"),
            _config(skills_result_disclosure="full"),
        )
        assert disclosure == "none"

    def test_test_overrides_template(self):
        disclosure, _ = resolve_disclosure_policy(
            _test(result_disclosure="full"),
            _template(result_disclosure="none"),
            _config(skills_result_disclosure="scores"),
        )
        assert disclosure == "full"

    def test_each_field_falls_back_independently(self):
        """A template that sets only a release mode still inherits the
        organization's disclosure tier."""
        disclosure, release = resolve_disclosure_policy(
            _test(),
            _template(result_release="on_release"),
            _config(skills_result_disclosure="scores"),
        )
        assert (disclosure, release) == ("scores", "on_release")


class TestWhoCanSee:
    def test_officer_always_sees_everything(self):
        withheld = _test(result_disclosure="none")
        assert _view(withheld, user_id=STRANGER, is_officer=True) == "full"

    def test_examiner_sees_their_own_scoring(self):
        withheld = _test(result_disclosure="none")
        assert _view(withheld, user_id=EXAMINER) == "full"

    def test_unrelated_member_sees_nothing(self):
        assert _view(_test(), user_id=STRANGER) == "none"

    def test_candidate_sees_their_result(self):
        assert _view(_test()) == "full"

    def test_candidate_blocked_when_disclosure_is_none(self):
        assert _view(_test(result_disclosure="none")) == "none"

    def test_named_viewer_sees_the_result(self):
        assert _view(_test(), user_id=STRANGER, named_viewer_ids={STRANGER}) == "full"

    def test_position_holder_sees_the_result(self):
        template = _template(result_viewer_positions=["preceptor"])
        assert (
            _view(
                _test(),
                template,
                user_id=STRANGER,
                user_position_slugs={"preceptor"},
            )
            == "full"
        )

    def test_position_holder_without_the_position_sees_nothing(self):
        template = _template(result_viewer_positions=["preceptor"])
        assert (
            _view(
                _test(),
                template,
                user_id=STRANGER,
                user_position_slugs={"firefighter"},
            )
            == "none"
        )

    # A viewer is being shown someone else's evaluation; there is no reading of
    # "share this result" under which the observer sees more than its subject.
    def test_a_viewer_never_sees_more_than_the_candidate(self):
        redacted = _test(result_disclosure="scores")
        assert (
            _view(redacted, user_id=STRANGER, named_viewer_ids={STRANGER}) == "scores"
        )

    def test_a_viewer_sees_nothing_when_the_candidate_does_not(self):
        withheld = _test(result_disclosure="none")
        assert _view(withheld, user_id=STRANGER, named_viewer_ids={STRANGER}) == "none"

    def test_per_test_positions_add_to_the_templates(self):
        template = _template(result_viewer_positions=["preceptor"])
        test = _test(result_viewer_positions=["captain"])
        assert viewer_positions_for(test, template) == {"preceptor", "captain"}


class TestRelease:
    def test_unreleased_result_is_hidden_under_on_release(self):
        test = _test(result_release="on_release", released_at=None)
        assert _view(test) == "none"

    def test_released_result_becomes_visible(self):
        test = _test(result_release="on_release", released_at="2026-08-08T00:00:00Z")
        assert _view(test) == "full"

    def test_on_completion_needs_no_release(self):
        assert _view(_test(result_release="on_completion")) == "full"

    # Practice attempts are the candidate's own drill notes — never recorded,
    # never credited, and not the department's evaluation record to gate.
    def test_practice_is_not_gated_by_release(self):
        test = _test(result_release="on_release", is_practice=True, released_at=None)
        assert _view(test) == "full"

    def test_release_does_not_override_a_none_disclosure(self):
        test = _test(
            result_disclosure="none",
            result_release="on_release",
            released_at="2026-08-08T00:00:00Z",
        )
        assert _view(test) == "none"


class TestRedaction:
    def _payload(self):
        return {
            "notes": "Overall: needs work on air management",
            "overall_score": 82.0,
            "section_results": [
                {
                    "section_id": "section-0",
                    "section_name": "Donning",
                    "notes": "section level note",
                    "criteria_results": [
                        {
                            "criterion_id": "criterion-0-0",
                            "passed": True,
                            "score": 8,
                            "notes": "hesitant, needed two prompts",
                        },
                        {
                            "criterion_id": "section-0-review-notes",
                            "passed": None,
                            "notes": "Discussed at length after the drill",
                        },
                    ],
                }
            ],
        }

    def test_full_view_changes_nothing(self):
        payload = self._payload()
        assert redact_test_for_view(payload, "full") == payload

    def test_scores_view_keeps_marks_and_points(self):
        result = redact_test_for_view(self._payload(), "scores")
        criterion = result["section_results"][0]["criteria_results"][0]
        assert criterion["passed"] is True
        assert criterion["score"] == 8
        assert result["overall_score"] == 82.0

    def test_scores_view_drops_every_note(self):
        result = redact_test_for_view(self._payload(), "scores")
        assert result["notes"] is None
        section = result["section_results"][0]
        assert section["notes"] is None
        assert section["criteria_results"][0]["notes"] is None

    def test_scores_view_drops_the_correction_trail(self):
        payload = self._payload()
        payload.update(
            {
                "return_reason": "Step 4 contradicts your note — recheck",
                "returned_at": "2026-08-11T09:00:00Z",
                "returned_by": "user-officer",
                "returned_by_name": "Dana Ruiz",
                "return_count": 2,
            }
        )

        result = redact_test_for_view(payload, "scores")

        assert result["return_reason"] is None
        assert result["returned_at"] is None
        assert result["returned_by"] is None
        assert result["returned_by_name"] is None
        assert result["return_count"] == 0

    def test_scores_view_drops_the_section_review_note(self):
        """Review notes are stored as a pseudo-criterion rather than a field of
        their own, so dropping the obvious `notes` keys alone would leak them."""
        result = redact_test_for_view(self._payload(), "scores")
        ids = [
            c["criterion_id"] for c in result["section_results"][0]["criteria_results"]
        ]
        assert "section-0-review-notes" not in ids
        assert "criterion-0-0" in ids

    def test_redaction_does_not_mutate_the_input(self):
        """The payload is built from ORM-loaded JSON; editing it in place would
        write the redaction back to the database on the next flush."""
        payload = self._payload()
        redact_test_for_view(payload, "scores")
        assert payload["notes"] == "Overall: needs work on air management"
        assert (
            payload["section_results"][0]["criteria_results"][0]["notes"]
            == "hesitant, needed two prompts"
        )
        assert len(payload["section_results"][0]["criteria_results"]) == 2


class TestReturnedForCorrection:
    """A submission the officer sent back to its examiner.

    Returning reopens the test at ``in_progress`` with every mark intact, which
    is what lets the examiner fix step 4 instead of re-running the evolution.
    It also means the row stops matching ``is_pending_validation`` — and the
    candidate, who saw nothing while it was pending, would suddenly see the
    whole scorecard plus the reason it was bounced. The return endpoint
    deliberately does not even notify them.
    """

    def _returned(self, **overrides):
        fields = {
            "status": "in_progress",
            "validated_at": None,
            "returned_at": "2026-08-11T09:00:00Z",
        }
        fields.update(overrides)
        return _test(**fields)

    def test_the_candidate_still_sees_only_that_it_exists(self):
        assert _view(self._returned()) == RESULT_VIEW_PENDING

    def test_a_named_viewer_sees_no_more_than_the_candidate(self):
        assert (
            _view(
                self._returned(),
                user_id=STRANGER,
                named_viewer_ids={STRANGER},
            )
            == RESULT_VIEW_PENDING
        )

    def test_the_examiner_still_sees_it_in_full(self):
        """They are the one being asked to correct it."""
        assert _view(self._returned(), user_id=EXAMINER) == ResultDisclosure.FULL.value

    def test_an_officer_still_sees_it_in_full(self):
        assert _view(self._returned(), is_officer=True) == ResultDisclosure.FULL.value

    def test_a_practice_attempt_is_not_affected(self):
        """Practice runs are the candidate's own drill notes and are never
        submitted, so nothing about them is ever awaiting anyone."""
        test = self._returned(is_practice=True)
        assert _view(test) == ResultDisclosure.FULL.value

    def test_an_ordinary_in_progress_test_is_unchanged(self):
        """The guard keys on having been returned, not on the status alone."""
        assert (
            _view(_test(status="in_progress", validated_at=None))
            == ResultDisclosure.FULL.value
        )

    def test_a_resubmitted_test_goes_back_to_pending(self):
        """Completing it again puts it in the officer's queue, where the
        ordinary pending rule already covers it."""
        test = self._returned(status="completed")
        assert _view(test) == RESULT_VIEW_PENDING

    def test_the_correction_trail_is_withheld(self):
        """The reason names what the examiner got wrong. Telling the candidate
        discloses both that something was wrong with their evaluation and what
        is being changed, before anyone has decided the result stands."""
        redacted = redact_test_for_view(
            {
                "result": "pass",
                "overall_score": 91.0,
                "notes": "solid",
                "section_results": [{"section_id": "section-0"}],
                "score_breakdown": {"percentage": 91.0},
                "return_reason": "Step 4 contradicts your note — recheck",
                "returned_at": "2026-08-11T09:00:00Z",
                "returned_by": "user-officer",
                "returned_by_name": "Dana Ruiz",
                "return_count": 2,
            },
            RESULT_VIEW_PENDING,
        )

        assert redacted["return_reason"] is None
        assert redacted["returned_at"] is None
        assert redacted["returned_by"] is None
        assert redacted["returned_by_name"] is None
        # Zero, not None: the field is a non-optional count, and zero is what a
        # never-returned test carries — so the two are indistinguishable.
        assert redacted["return_count"] == 0
        # And the outcome itself is still withheld, as for any pending view.
        assert redacted["overall_score"] is None
        assert redacted["score_breakdown"] is None
