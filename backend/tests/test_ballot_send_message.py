"""The secretary's account of a ballot send (workflow review W50).

With email off, sending ballots reported "eligibility summary emailed to you"
although no summary email went: the message claimed it whenever one was
asked for, without reading what the send returned.
"""

import pytest

from app.api.v1.endpoints.elections import ballot_send_message

pytestmark = pytest.mark.unit


def test_a_summary_that_went_is_reported_as_emailed():
    message = ballot_send_message(3, 0, 0, summary_requested=True, summary_sent=True)
    assert message.endswith("Eligibility summary emailed to you")


def test_a_summary_that_did_not_go_is_not_claimed():
    message = ballot_send_message(0, 0, 27, summary_requested=True, summary_sent=False)
    assert "emailed to you" not in message
    assert message.endswith("The eligibility summary email could not be sent")


def test_no_summary_line_when_none_was_asked_for():
    message = ballot_send_message(2, 1, 0, summary_requested=False, summary_sent=False)
    assert message == "Ballot emails sent to 2 recipient(s). 1 failed"


def test_recorded_reasons_are_named_when_the_send_reports_them():
    # W50-55: the fixed wording blamed a ballot-item rule for a member who was
    # skipped for not being on the frozen voter roll.
    message = ballot_send_message(
        1,
        0,
        2,
        summary_requested=False,
        summary_sent=False,
        skipped_details=[
            {"reason": "Not on the voter roll frozen when the election opened"},
            {"reason": "Not checked in for meeting"},
        ],
    )
    assert "did not meet ballot item requirements" not in message
    assert "Not on the voter roll frozen when the election opened" in message
    assert "Not checked in for meeting" in message


def test_a_caller_without_reasons_keeps_the_generic_clause():
    message = ballot_send_message(1, 0, 2, summary_requested=False, summary_sent=False)
    assert "2 skipped (did not meet ballot item requirements" in message
