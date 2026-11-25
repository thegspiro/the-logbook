"""
Default Email Templates — Community Outreach

- **Guest Headcount Reminder** — the morning after an outreach event ends with
  no guest headcount recorded, to whichever of its organizer, alternate or
  creator holds ``events.manage``, asking them to record how many people
  attended. Sent once per event; see ``guest_headcount_reminder_service``.
- **Requester Feedback Received** — when a requester answers the feedback
  form on a completed request's status page, to the request's coordinator, or
  failing that the default coordinator, or failing both every member who
  manages events. One per response; see ``outreach_feedback_notice_service``.

The Outreach Impact report counts an event's audience from that
headcount, so a count that never gets entered leaves the event on the
requester's estimate, or on nothing at all.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import ACCENT_BLUE, action, build_shell, fact, facts

_CHIP = "Community outreach"

# Every value here is plain text, escaped when it is rendered.
RAW_HTML_VARIABLES: set[str] = set()

HEADCOUNT_REMINDER_SUBJECT = "How many people came to {{event_title}}?"

HEADCOUNT_REMINDER_HTML = build_shell(
    "Record the Guest Headcount",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{event_title}} has ended, and no guest headcount has been recorded
        for it yet.</p>
"""
    + facts([[fact("Event", "{{event_title}}"), fact("Date", "{{event_date}}")]])
    + """        <p>Enter how many people attended on the event page. The Outreach
        Impact report counts the event's audience from that number, rather
        than from the requester's estimate.</p>
"""
    + action("{{event_url}}", "Record the Headcount"),
    accent=ACCENT_BLUE,
    chip=_CHIP,
)

HEADCOUNT_REMINDER_TEXT = """Record the Guest Headcount

Hello {{recipient_name}},

{{event_title}} has ended, and no guest headcount has been recorded for it yet.

Event: {{event_title}}
Date: {{event_date}}

Enter how many people attended on the event page. The Outreach Impact
report counts the event's audience from that number, rather than from the
requester's estimate.

Record the headcount: {{event_url}}

{{footer_text}}"""

FEEDBACK_RECEIVED_SUBJECT = "{{low_rating_prefix}}Feedback from {{requester_name}}"

FEEDBACK_RECEIVED_HTML = build_shell(
    "Requester Feedback",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{requester_name}} sent feedback on their {{outreach_type}}
        request.</p>
"""
    + facts(
        [
            [fact("Request", "{{request_title}}"), fact("Visit", "{{visit_date}}")],
            [fact("Rating", "{{rating_text}}")],
        ]
    )
    + """        <p>Their answers are on the request page. Each requester can send
        feedback once, so this is their final word on the visit.</p>
"""
    + action("{{request_url}}", "Read the Feedback"),
    accent=ACCENT_BLUE,
    chip=_CHIP,
)

FEEDBACK_RECEIVED_TEXT = """Requester Feedback

Hello {{recipient_name}},

{{requester_name}} sent feedback on their {{outreach_type}} request.

Request: {{request_title}}
Visit: {{visit_date}}
Rating: {{rating_text}}

Their answers are on the request page. Each requester can send feedback
once, so this is their final word on the visit.

Read the feedback: {{request_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Editor catalogue and samples
# ----------------------------------------------------------------------

_T = EmailTemplateType

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    _T.GUEST_HEADCOUNT_REMINDER.value: [
        {"name": "recipient_name", "description": "The officer it is sent to"},
        {"name": "event_title", "description": "The outreach event's title"},
        {"name": "event_date", "description": "The day the event started"},
        {"name": "event_url", "description": "Link to the event page"},
    ],
    _T.OUTREACH_FEEDBACK_RECEIVED.value: [
        {"name": "recipient_name", "description": "The officer it is sent to"},
        {"name": "requester_name", "description": "Who sent the feedback"},
        {
            "name": "request_title",
            "description": "The requesting organization, or the requester",
        },
        {"name": "outreach_type", "description": "What was requested"},
        {"name": "visit_date", "description": "The day of the visit"},
        {
            "name": "rating_text",
            "description": 'The rating, as "4 out of 5", or "No rating given"',
        },
        {
            "name": "low_rating_prefix",
            "description": '"Low rating: " when the rating is in the bottom '
            "three-fifths of the scale, otherwise empty",
        },
        {"name": "request_url", "description": "Link to the request page"},
    ],
}

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    _T.GUEST_HEADCOUNT_REMINDER.value: {
        "recipient_name": "Captain Maria Lopez",
        "event_title": "Station 2 Open House",
        "event_date": "October 12, 2026",
        "event_url": "https://example.org/events/sample",
    },
    _T.OUTREACH_FEEDBACK_RECEIVED.value: {
        "recipient_name": "Captain Maria Lopez",
        "requester_name": "Priya Natarajan",
        "request_title": "Willow Creek Preschool",
        "outreach_type": "Station Tour",
        "visit_date": "October 12, 2026",
        "rating_text": "3 out of 5",
        "low_rating_prefix": "Low rating: ",
        "request_url": "https://example.org/events/admin/requests/sample",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    _T.GUEST_HEADCOUNT_REMINDER.value: {"recipient_name": "full"},
    _T.OUTREACH_FEEDBACK_RECEIVED.value: {"recipient_name": "full"},
}

# Days from today a test send places a date at: the headcount reminder's event
# yesterday, as the real reminder does, and the feedback's visit a few days
# back, about when a requester answers.
SAMPLE_DAYS: Dict[str, Dict[str, int]] = {
    _T.GUEST_HEADCOUNT_REMINDER.value: {"event_date": -1},
    _T.OUTREACH_FEEDBACK_RECEIVED.value: {"visit_date": -3},
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": _T.GUEST_HEADCOUNT_REMINDER,
        "name": "Guest Headcount Reminder",
        "subject": HEADCOUNT_REMINDER_SUBJECT,
        "html": HEADCOUNT_REMINDER_HTML,
        "text": HEADCOUNT_REMINDER_TEXT,
        "description": (
            "Sent the morning after an outreach event ends with no guest "
            "headcount recorded, once, to whichever of its organizer, "
            "alternate or creator holds events.manage."
        ),
    },
    {
        "type": _T.OUTREACH_FEEDBACK_RECEIVED,
        "name": "Requester Feedback Received",
        "subject": FEEDBACK_RECEIVED_SUBJECT,
        "html": FEEDBACK_RECEIVED_HTML,
        "text": FEEDBACK_RECEIVED_TEXT,
        "description": (
            "Sent when a requester answers the feedback form on a completed "
            "outreach request, to its coordinator, or failing that the default "
            "coordinator, or failing both every member who manages events."
        ),
    },
]
