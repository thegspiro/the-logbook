"""
Default Email Templates — Training Session Sign-Off

- **Training Approval Reminder** — to the training officers, when a training
  session that needs an officer's sign-off has waited 7 days for a decision,
  and once more at 14 days (owner decision 2026-11-23). Until an officer
  approves or rejects it, nobody who attended is credited. Sent by the daily
  ``training_approval_reminders`` task; see ``training_approval_reminders``.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import ACCENT_AMBER, action, build_shell, fact, facts

_CHIP = "Training sign-off"

# Every value here is plain text, escaped when it is rendered.
RAW_HTML_VARIABLES: set[str] = set()

REMINDER_SUBJECT = "Still waiting for sign-off: {{course_name}}"

REMINDER_HTML = build_shell(
    "Training Attendance Still Needs Your Sign-Off",
    """        <p>Hello {{recipient_name}},</p>
        <p>The attendance for {{course_name}} has waited {{days_waiting}} days
        for a training officer to approve it. Until it is approved or
        rejected, none of the {{attendee_count}} members who attended is
        credited for it.</p>
"""
    + facts(
        [
            [fact("Course", "{{course_name}}"), fact("Event", "{{event_title}}")],
            [
                fact("Held", "{{event_date}}"),
                fact("Attendees", "{{attendee_count}}"),
            ],
        ],
        panel=True,
    )
    + action("{{approval_url}}", "Review and Approve"),
    accent=ACCENT_AMBER,
    chip=_CHIP,
)

REMINDER_TEXT = """Training Attendance Still Needs Your Sign-Off

Hello {{recipient_name}},

The attendance for {{course_name}} has waited {{days_waiting}} days for a
training officer to approve it. Until it is approved or rejected, none of the
{{attendee_count}} members who attended is credited for it.

Course: {{course_name}}
Event: {{event_title}}
Held: {{event_date}}
Attendees: {{attendee_count}}

Review and approve: {{approval_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Editor catalogue and samples
# ----------------------------------------------------------------------

_T = EmailTemplateType

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    _T.TRAINING_APPROVAL_REMINDER.value: [
        {"name": "recipient_name", "description": "The training officer"},
        {"name": "course_name", "description": "The session's course"},
        {"name": "event_title", "description": "The training event's title"},
        {"name": "event_date", "description": "When the session was held"},
        {"name": "attendee_count", "description": "Members waiting on credit"},
        {"name": "days_waiting", "description": "Days since it was finalized"},
        {"name": "approval_url", "description": "Link to the approval page"},
    ],
}

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    _T.TRAINING_APPROVAL_REMINDER.value: {
        "recipient_name": "Captain Maria Lopez",
        "course_name": "Ladder Operations",
        "event_title": "Tuesday Drill: Ladders",
        "event_date": "October 12, 2026",
        "attendee_count": "14",
        "days_waiting": "7",
        "approval_url": "https://example.org/training/approve/sample",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    _T.TRAINING_APPROVAL_REMINDER.value: {"recipient_name": "full"},
}

# Days from today a test send places the session at: a week ago, as the first
# real reminder does.
SAMPLE_DAYS: Dict[str, Dict[str, int]] = {
    _T.TRAINING_APPROVAL_REMINDER.value: {"event_date": -7},
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": _T.TRAINING_APPROVAL_REMINDER,
        "name": "Training Approval Reminder",
        "subject": REMINDER_SUBJECT,
        "html": REMINDER_HTML,
        "text": REMINDER_TEXT,
        "description": (
            "Sent to the training officers when a training session that needs "
            "sign-off has waited 7 days for a decision, and once more at 14 "
            "days. Attendees are credited only once it is approved."
        ),
    },
]
