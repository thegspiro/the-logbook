"""
Default Email Templates — Leave Reminders, Digest and Requests

- **Leave Ending Reminder** — to the member, the department's chosen number
  of days before their leave ends, saying when their requirements resume.
- **Leave Ending (Officers)** — the same date to the officers who manage
  leave, when the department copies them.
- **Open-Ended Leave Digest** — once a month to the officers who manage
  leave, listing leaves with no end date that began six or more months ago,
  so none is forgotten. Not sent when there are none.
- **Leave Request Submitted** — to each member who may decide a request,
  with the dates, whether a reason was given, and the department's rule.
- **Leave Request Denied** — to the member, with who decided and their note.
  An approval is told by the Leave of Absence Notice instead, which already
  carries the dates and what the leave does to the member's training.

**Neither a leave's reason nor its type is in any of them**, for the reason
``email_templates_leave`` gives: both are often medical, and email leaves the
department's control once it is sent.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import (
    ACCENT_AMBER,
    ACCENT_BLUE,
    ACCENT_SLATE,
    action,
    build_shell,
    fact,
    facts,
)

_CHIP = "Leave of absence"

# Filled by the sender with markup it builds and escapes; must render unescaped.
RAW_HTML_VARIABLES = {"leaves_html"}

# ----------------------------------------------------------------------
# Leave ending — to the member
# ----------------------------------------------------------------------

ENDING_SUBJECT = "Your leave of absence ends {{end_date}}"

ENDING_HTML = build_shell(
    "Your Leave Is Ending",
    """        <p>Hello {{member_name}},</p>
        <p>Your leave of absence ends on {{end_date}}.</p>
"""
    + facts([[fact("Leave ends", "{{end_date}}")]], panel=True)
    + """        <p>{{resume_note}}</p>
        <p>If your leave needs to be extended, speak to the officer who
        manages leave before it ends.</p>
"""
    + action("{{training_url}}", "Open My Training"),
    accent=ACCENT_BLUE,
    chip=_CHIP,
)

ENDING_TEXT = """Your Leave Is Ending

Hello {{member_name}},

Your leave of absence ends on {{end_date}}.

{{resume_note}}

If your leave needs to be extended, speak to the officer who manages leave
before it ends.

My Training: {{training_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Leave ending — to the officers
# ----------------------------------------------------------------------

ENDING_OFFICER_SUBJECT = "Leave ending: {{member_name}}, {{end_date}}"

ENDING_OFFICER_HTML = build_shell(
    "A Member's Leave Is Ending",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{member_name}}'s leave of absence ends on {{end_date}}. Their
        training requirements apply again after that, and they can be
        scheduled for shifts.</p>
"""
    + facts(
        [[fact("Member", "{{member_name}}"), fact("Leave ends", "{{end_date}}")]],
        panel=True,
    )
    + action("{{leaves_url}}", "Open leaves and waivers"),
    accent=ACCENT_SLATE,
    chip=_CHIP,
)

ENDING_OFFICER_TEXT = """A Member's Leave Is Ending

Hello {{recipient_name}},

{{member_name}}'s leave of absence ends on {{end_date}}. Their training
requirements apply again after that, and they can be scheduled for shifts.

Leaves and waivers: {{leaves_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Open-ended leave digest — to the officers
# ----------------------------------------------------------------------

DIGEST_SUBJECT = "Open-ended leaves to review ({{leave_count}})"

DIGEST_HTML = build_shell(
    "Leaves With No End Date",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{leave_count}} leave(s) of absence have no end date and began six
        or more months ago. Each one keeps excusing the member's training
        requirements until it is given an end date or removed.</p>
        {{leaves_html}}
        <p>If a member has returned, give their leave an end date.</p>
""" + action("{{leaves_url}}", "Open leaves and waivers"),
    accent=ACCENT_AMBER,
    chip=_CHIP,
)

DIGEST_TEXT = """Leaves With No End Date

Hello {{recipient_name}},

{{leave_count}} leave(s) of absence have no end date and began six or more
months ago. Each one keeps excusing the member's training requirements until
it is given an end date or removed.

{{leaves_text}}

If a member has returned, give their leave an end date.

Leaves and waivers: {{leaves_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Leave request submitted — to the approvers
# ----------------------------------------------------------------------

REQUESTED_SUBJECT = "Leave request: {{member_name}}"

REQUESTED_HTML = build_shell(
    "A Leave Request Needs a Decision",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{member_name}} asked for a leave of absence.</p>
"""
    + facts(
        [
            [fact("From", "{{start_date}}"), fact("To", "{{end_date}}")],
            [fact("Reason provided", "{{reason_provided}}")],
        ],
        panel=True,
    )
    + """        <p>{{rule_sentence}}</p>
        <p>Any reason the member gave is not in this email. Open the request
        in the Logbook to read it and decide.</p>
"""
    + action("{{request_url}}", "Open the request"),
    accent=ACCENT_BLUE,
    chip=_CHIP,
)

REQUESTED_TEXT = """A Leave Request Needs a Decision

Hello {{recipient_name}},

{{member_name}} asked for a leave of absence.

From: {{start_date}}
To: {{end_date}}
Reason provided: {{reason_provided}}

{{rule_sentence}}

Any reason the member gave is not in this email. Open the request in the
Logbook to read it and decide.

Open the request: {{request_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Leave request denied — to the member
# ----------------------------------------------------------------------

DENIED_SUBJECT = "Your leave request was denied"

DENIED_HTML = build_shell(
    "Your Leave Request Was Denied",
    """        <p>Hello {{member_name}},</p>
        <p>Your request for a leave of absence was denied.</p>
"""
    + facts(
        [
            [fact("From", "{{start_date}}"), fact("To", "{{end_date}}")],
            [fact("Decided by", "{{decided_by}}")],
            [fact("Note", "{{decision_note}}")],
        ],
        panel=True,
    )
    + """        <p>Your training requirements are unchanged. Speak to the officer
        who manages leave if you have questions.</p>
"""
    + action("{{request_url}}", "Open your requests"),
    accent=ACCENT_SLATE,
    chip=_CHIP,
)

DENIED_TEXT = """Your Leave Request Was Denied

Hello {{member_name}},

Your request for a leave of absence was denied.

From: {{start_date}}
To: {{end_date}}
Decided by: {{decided_by}}
Note: {{decision_note}}

Your training requirements are unchanged. Speak to the officer who manages
leave if you have questions.

Your requests: {{request_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Editor catalogue and samples
# ----------------------------------------------------------------------

_T = EmailTemplateType

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    _T.LEAVE_ENDING_REMINDER.value: [
        {"name": "member_name", "description": "The member whose leave it is"},
        {"name": "end_date", "description": "The leave's last day"},
        {
            "name": "resume_note",
            "description": (
                "When the member's training requirements apply again, by the "
                "department's rule for a partly covered month"
            ),
        },
        {"name": "training_url", "description": "Link to My Training"},
    ],
    _T.LEAVE_ENDING_OFFICER_NOTICE.value: [
        {"name": "recipient_name", "description": "The officer it is sent to"},
        {"name": "member_name", "description": "The member whose leave it is"},
        {"name": "end_date", "description": "The leave's last day"},
        {"name": "leaves_url", "description": "Link to Leaves & Waivers"},
    ],
    _T.OPEN_ENDED_LEAVE_DIGEST.value: [
        {"name": "recipient_name", "description": "The officer it is sent to"},
        {"name": "leave_count", "description": "How many leaves are listed"},
        {
            "name": "leaves_html",
            "description": "Table of each member and the date their leave began",
        },
        {"name": "leaves_text", "description": "Plain-text version of the list"},
        {"name": "leaves_url", "description": "Link to Leaves & Waivers"},
    ],
    _T.LEAVE_REQUEST_SUBMITTED.value: [
        {"name": "recipient_name", "description": "The approver it is sent to"},
        {"name": "member_name", "description": "The member who asked"},
        {"name": "start_date", "description": "The first day asked for"},
        {"name": "end_date", "description": 'The last day, or "No end date"'},
        {
            "name": "reason_provided",
            "description": (
                'Whether the member gave a reason: "Yes" or "No". The reason '
                "itself is never emailed."
            ),
        },
        {
            "name": "rule_sentence",
            "description": "How the department's approvers decide it",
        },
        {"name": "request_url", "description": "Link to the request"},
    ],
    _T.LEAVE_REQUEST_DENIED.value: [
        {"name": "member_name", "description": "The member who asked"},
        {"name": "start_date", "description": "The first day asked for"},
        {"name": "end_date", "description": 'The last day, or "No end date"'},
        {"name": "decided_by", "description": "Who decided"},
        {"name": "decision_note", "description": 'The decider\'s note, or "None"'},
        {"name": "request_url", "description": "Link to the member's requests"},
    ],
}

_SAMPLE_TABLE = (
    '<table class="facts" role="presentation" cellpadding="0" cellspacing="0">'
    '<tr><td class="fact"><p class="fact-label">Alex Johnson</p>'
    '<p class="fact-value">Since March 03, 2026</p></td></tr></table>'
)

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    _T.LEAVE_ENDING_REMINDER.value: {
        "member_name": "Alex Johnson",
        "end_date": "January 31, 2027",
        "resume_note": (
            "Your training requirements apply again from February 2027. Any "
            "day of leave excuses the whole month, so January is still "
            "excused."
        ),
        "training_url": "https://example.org/training/my-training",
    },
    _T.LEAVE_ENDING_OFFICER_NOTICE.value: {
        "recipient_name": "Captain Maria Lopez",
        "member_name": "Alex Johnson",
        "end_date": "January 31, 2027",
        "leaves_url": "https://example.org/members/admin/waivers",
    },
    _T.OPEN_ENDED_LEAVE_DIGEST.value: {
        "recipient_name": "Captain Maria Lopez",
        "leave_count": "1",
        "leaves_html": _SAMPLE_TABLE,
        "leaves_text": "- Alex Johnson, since March 03, 2026",
        "leaves_url": "https://example.org/members/admin/waivers",
    },
    _T.LEAVE_REQUEST_SUBMITTED.value: {
        "recipient_name": "Captain Maria Lopez",
        "member_name": "Alex Johnson",
        "start_date": "December 01, 2026",
        "end_date": "February 28, 2027",
        "reason_provided": "Yes",
        "rule_sentence": (
            "It is approved once 3 of the 5 approvers approve it, and denied "
            "once that can no longer happen."
        ),
        "request_url": "https://example.org/members/leave-requests",
    },
    _T.LEAVE_REQUEST_DENIED.value: {
        "member_name": "Alex Johnson",
        "start_date": "December 01, 2026",
        "end_date": "February 28, 2027",
        "decided_by": "Captain Maria Lopez",
        "decision_note": "We need you through the holiday coverage period.",
        "request_url": "https://example.org/members/leave-requests",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    _T.LEAVE_ENDING_REMINDER.value: {"member_name": "full"},
    _T.LEAVE_ENDING_OFFICER_NOTICE.value: {"recipient_name": "full"},
    _T.OPEN_ENDED_LEAVE_DIGEST.value: {"recipient_name": "full"},
    _T.LEAVE_REQUEST_SUBMITTED.value: {"recipient_name": "full"},
    _T.LEAVE_REQUEST_DENIED.value: {"member_name": "full"},
}

# Days from today a test send places each date at.
SAMPLE_DAYS: Dict[str, Dict[str, int]] = {
    _T.LEAVE_ENDING_REMINDER.value: {"end_date": 7},
    _T.LEAVE_ENDING_OFFICER_NOTICE.value: {"end_date": 7},
    _T.LEAVE_REQUEST_SUBMITTED.value: {"start_date": 14, "end_date": 90},
    _T.LEAVE_REQUEST_DENIED.value: {"start_date": 14, "end_date": 90},
}

# Dates quoted inside the digest's list: the sample leave began about eight
# months before the test send.
SAMPLE_PROSE_DAYS: Dict[str, Dict[str, int]] = {
    _T.OPEN_ENDED_LEAVE_DIGEST.value: {"leaves_html": -250, "leaves_text": -250},
}

DEFAULTS: Dict[str, tuple] = {
    _T.LEAVE_ENDING_REMINDER.value: (ENDING_SUBJECT, ENDING_HTML, ENDING_TEXT),
    _T.LEAVE_ENDING_OFFICER_NOTICE.value: (
        ENDING_OFFICER_SUBJECT,
        ENDING_OFFICER_HTML,
        ENDING_OFFICER_TEXT,
    ),
    _T.OPEN_ENDED_LEAVE_DIGEST.value: (DIGEST_SUBJECT, DIGEST_HTML, DIGEST_TEXT),
    _T.LEAVE_REQUEST_SUBMITTED.value: (
        REQUESTED_SUBJECT,
        REQUESTED_HTML,
        REQUESTED_TEXT,
    ),
    _T.LEAVE_REQUEST_DENIED.value: (DENIED_SUBJECT, DENIED_HTML, DENIED_TEXT),
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": _T.LEAVE_ENDING_REMINDER,
        "name": "Leave Ending Reminder",
        "subject": ENDING_SUBJECT,
        "html": ENDING_HTML,
        "text": ENDING_TEXT,
        "description": (
            "Sent to a member before their leave of absence ends, as many days "
            "ahead as Members > Settings > Leave sets, saying when their "
            "training requirements apply again."
        ),
    },
    {
        "type": _T.LEAVE_ENDING_OFFICER_NOTICE,
        "name": "Leave Ending (Officers)",
        "subject": ENDING_OFFICER_SUBJECT,
        "html": ENDING_OFFICER_HTML,
        "text": ENDING_OFFICER_TEXT,
        "description": (
            "Sent to the officers who manage leave when a member's leave is "
            "about to end, if Members > Settings > Leave copies them."
        ),
    },
    {
        "type": _T.OPEN_ENDED_LEAVE_DIGEST,
        "name": "Open-Ended Leave Digest",
        "subject": DIGEST_SUBJECT,
        "html": DIGEST_HTML,
        "text": DIGEST_TEXT,
        "description": (
            "Sent on the 1st of each month to the officers who manage leave, "
            "listing leaves with no end date that began six or more months "
            "ago. Not sent when there are none."
        ),
    },
    {
        "type": _T.LEAVE_REQUEST_SUBMITTED,
        "name": "Leave Request Submitted",
        "subject": REQUESTED_SUBJECT,
        "html": REQUESTED_HTML,
        "text": REQUESTED_TEXT,
        "description": (
            "Sent to each member who may decide a leave request when a member "
            "asks for leave. Never includes the reason or the type of leave."
        ),
    },
    {
        "type": _T.LEAVE_REQUEST_DENIED,
        "name": "Leave Request Denied",
        "subject": DENIED_SUBJECT,
        "html": DENIED_HTML,
        "text": DENIED_TEXT,
        "description": (
            "Sent to a member when their leave request is denied. An approved "
            "request is told by the Leave of Absence Notice."
        ),
    },
]
