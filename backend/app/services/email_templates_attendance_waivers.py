"""
Default Email Templates — Attendance Waiver Requests

A member asks to be excused from a session that counts toward an attendance
requirement, and a routed approver decides (owner decisions 2026-11-10). Three
notices per workflow, each an editable template:

- **Requested** — to each approver the request is routed to. Names the member,
  the session, its date and the category, says whether a reason was given, and
  carries Approve and Deny buttons.
- **Decided** — to the member: approved, denied, or approved on the Chief's
  override of a denial, with who decided and their note.
- **Withdrawn** — to the approvers who were asked: the member took the request
  back, so nothing is left for them to do.

Training sessions and business meetings get a set each, because they are
separate workflows with separate policies and a department words them
separately. Only the training set is sent today; the meeting set is defined so
it can be worded ahead of the meeting workflow, which sends it.

**The member's reason is never in an email.** It is often medical and is
stored encrypted; the approver email says only whether one was given, and the
approver reads it in the Logbook after signing in.

**The buttons decide nothing.** Each links to the request's page with
``?action=approve`` or ``?action=deny``. Mail scanners (Safe Links,
Proofpoint) open every link in a message, so opening one must change nothing:
the page requires sign-in, and the decision is a POST made only after the
approver confirms on it.

**A template's CC gets its own copy.** ``review_buttons_html``, ``category``
and ``decision_note`` are filled per recipient by ``AttendanceWaiverEmails``:
the buttons and those two values for the person the notice is for, and a
sentence saying it is a copy for anyone the template CCs. A template has no
conditionals, so this is how one body serves both.
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

# Filled by the sender with markup it builds and escapes; must render unescaped.
RAW_HTML_VARIABLES = {"review_buttons_html"}


def _facts(with_category: bool) -> str:
    rows = [
        [fact("Member", "{{member_name}}"), fact("Date", "{{session_date}}")],
    ]
    second = [fact("Session", "{{session_title}}")]
    if with_category:
        second.append(fact("Category", "{{category}}"))
    rows.append(second)
    return facts(rows, panel=True)


def _requested_html(chip: str) -> str:
    return build_shell(
        "A Waiver Request Needs a Decision",
        """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
        + _facts(with_category=True)
        + facts([[fact("Reason provided", "{{reason_provided}}")]])
        + """        <p>Any reason the member gave is not in this email. Open the
        request in the Logbook to read it.</p>
        {{review_buttons_html}}
""",
        accent=ACCENT_BLUE,
        chip=chip,
    )


_REQUESTED_TEXT = """A Waiver Request Needs a Decision

Hello {{recipient_name}},

{{summary}}

Member: {{member_name}}
Session: {{session_title}}
Date: {{session_date}}
Category: {{category}}
Reason provided: {{reason_provided}}

Any reason the member gave is not in this email. Open the request in the
Logbook to read it.

{{review_links_text}}

{{footer_text}}"""


def _decided_html(chip: str) -> str:
    return build_shell(
        "Your Waiver Request Was Decided",
        """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
        + facts(
            [
                [fact("Outcome", "{{outcome}}"), fact("Decided by", "{{decided_by}}")],
                [
                    fact("Session", "{{session_title}}"),
                    fact("Date", "{{session_date}}"),
                ],
                [fact("Note", "{{decision_note}}")],
            ],
            panel=True,
        )
        + action("{{request_url}}", "Open the request"),
        accent=ACCENT_SLATE,
        chip=chip,
    )


_DECIDED_TEXT = """Your Waiver Request Was Decided

Hello {{recipient_name}},

{{summary}}

Outcome: {{outcome}}
Decided by: {{decided_by}}
Session: {{session_title}}
Date: {{session_date}}
Note: {{decision_note}}

Open the request: {{request_url}}

{{footer_text}}"""


def _withdrawn_html(chip: str) -> str:
    return build_shell(
        "A Waiver Request Was Withdrawn",
        """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
        + _facts(with_category=False)
        + """        <p>Nothing is left for you to decide.</p>
""",
        accent=ACCENT_AMBER,
        chip=chip,
    )


_WITHDRAWN_TEXT = """A Waiver Request Was Withdrawn

Hello {{recipient_name}},

{{summary}}

Member: {{member_name}}
Session: {{session_title}}
Date: {{session_date}}

Nothing is left for you to decide.

{{footer_text}}"""


_TRAINING_CHIP = "Training waiver"
_MEETING_CHIP = "Meeting waiver"

SESSION_REQUESTED_SUBJECT = "Waiver request: {{member_name}}, {{session_title}}"
SESSION_REQUESTED_HTML = _requested_html(_TRAINING_CHIP)
SESSION_DECIDED_SUBJECT = "Waiver request {{outcome_word}}: {{session_title}}"
SESSION_DECIDED_HTML = _decided_html(_TRAINING_CHIP)
SESSION_WITHDRAWN_SUBJECT = (
    "Waiver request withdrawn: {{member_name}}, {{session_title}}"
)
SESSION_WITHDRAWN_HTML = _withdrawn_html(_TRAINING_CHIP)

MEETING_REQUESTED_SUBJECT = SESSION_REQUESTED_SUBJECT
MEETING_REQUESTED_HTML = _requested_html(_MEETING_CHIP)
MEETING_DECIDED_SUBJECT = SESSION_DECIDED_SUBJECT
MEETING_DECIDED_HTML = _decided_html(_MEETING_CHIP)
MEETING_WITHDRAWN_SUBJECT = SESSION_WITHDRAWN_SUBJECT
MEETING_WITHDRAWN_HTML = _withdrawn_html(_MEETING_CHIP)


# ----------------------------------------------------------------------
# Editor catalogue and samples
# ----------------------------------------------------------------------

_COMMON_VARS: List[Dict[str, str]] = [
    {"name": "recipient_name", "description": "Recipient's name"},
    {"name": "member_name", "description": "The member who asked"},
    {"name": "session_title", "description": "The session's title"},
    {"name": "session_date", "description": "The session's date"},
    {
        "name": "summary",
        "description": (
            "One sentence for this recipient, ending in a full stop. A person "
            "the template CCs is told it is a copy and needs no action."
        ),
    },
]

_REQUESTED_VARS: List[Dict[str, str]] = _COMMON_VARS + [
    {
        "name": "category",
        "description": (
            'The category the member chose, or "None given". Not included in '
            "a CC copy."
        ),
    },
    {
        "name": "reason_provided",
        "description": (
            'Whether the member gave a written reason: "Yes" or "No". The '
            "reason itself is never emailed."
        ),
    },
    {
        "name": "review_buttons_html",
        "description": (
            "The Approve and Deny buttons. Each opens the request in the "
            "Logbook, where the approver confirms; opening one decides "
            "nothing. Empty in a CC copy."
        ),
    },
    {
        "name": "review_links_text",
        "description": (
            "The Approve and Deny links, for the plain-text version. A short "
            "note in a CC copy."
        ),
    },
]

_DECIDED_VARS: List[Dict[str, str]] = _COMMON_VARS + [
    {
        "name": "outcome",
        "description": ('"Approved", "Denied" or "Approved on the Chief\'s override"'),
    },
    {
        "name": "outcome_word",
        "description": 'The outcome for a subject line: "approved" or "denied"',
    },
    {"name": "decided_by", "description": "Who decided"},
    {
        "name": "decision_note",
        "description": ('The decider\'s note, or "None". Not included in a CC copy.'),
    },
    {"name": "request_url", "description": "Link to the request in the Logbook"},
]

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    EmailTemplateType.SESSION_WAIVER_REQUESTED.value: _REQUESTED_VARS,
    EmailTemplateType.SESSION_WAIVER_DECIDED.value: _DECIDED_VARS,
    EmailTemplateType.SESSION_WAIVER_WITHDRAWN.value: _COMMON_VARS,
    EmailTemplateType.MEETING_WAIVER_REQUESTED.value: _REQUESTED_VARS,
    EmailTemplateType.MEETING_WAIVER_DECIDED.value: _DECIDED_VARS,
    EmailTemplateType.MEETING_WAIVER_WITHDRAWN.value: _COMMON_VARS,
}

_SAMPLE_BUTTONS = (
    '<p><a href="https://example.org/attendance-waivers/sample?action=approve">'
    "Approve</a> &middot; "
    '<a href="https://example.org/attendance-waivers/sample?action=deny">'
    "Deny</a></p>"
)


def _sample_set(session_title: str, noun: str) -> Dict[str, Dict[str, str]]:
    common = {
        "recipient_name": "Captain Maria Lopez",
        "member_name": "Alex Johnson",
        "session_title": session_title,
        "session_date": "November 20, 2026",
    }
    return {
        "requested": {
            **common,
            "summary": (
                f'Alex Johnson asked to be excused from "{session_title}" on '
                f"November 20, 2026. Approve or deny the request."
            ),
            "category": "Work",
            "reason_provided": "Yes",
            "review_buttons_html": _SAMPLE_BUTTONS,
            "review_links_text": (
                "Approve: https://example.org/attendance-waivers/sample"
                "?action=approve\n"
                "Deny: https://example.org/attendance-waivers/sample?action=deny"
            ),
        },
        "decided": {
            **common,
            "recipient_name": "Alex Johnson",
            "summary": (
                f'Your request to be excused from "{session_title}" on '
                "November 20, 2026 was approved."
            ),
            "outcome": "Approved",
            "outcome_word": "approved",
            "decided_by": "Captain Maria Lopez",
            "decision_note": f"Thanks for letting us know before the {noun}.",
            "request_url": "https://example.org/attendance-waivers/sample",
        },
        "withdrawn": {
            **common,
            "summary": (
                f'Alex Johnson withdrew their request to be excused from "'
                f'{session_title}" on November 20, 2026.'
            ),
        },
    }


_TRAINING_SAMPLES = _sample_set("Hose Line Advancement", "session")
_MEETING_SAMPLES = _sample_set("November Business Meeting", "meeting")

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    EmailTemplateType.SESSION_WAIVER_REQUESTED.value: _TRAINING_SAMPLES["requested"],
    EmailTemplateType.SESSION_WAIVER_DECIDED.value: _TRAINING_SAMPLES["decided"],
    EmailTemplateType.SESSION_WAIVER_WITHDRAWN.value: _TRAINING_SAMPLES["withdrawn"],
    EmailTemplateType.MEETING_WAIVER_REQUESTED.value: _MEETING_SAMPLES["requested"],
    EmailTemplateType.MEETING_WAIVER_DECIDED.value: _MEETING_SAMPLES["decided"],
    EmailTemplateType.MEETING_WAIVER_WITHDRAWN.value: _MEETING_SAMPLES["withdrawn"],
}

# Days from today a test send places the session at, as the real notice
# would: ahead for a request or a withdrawal, a week ago for a decision made
# within the after-the-session deadlines. The summary quotes the same date.
SAMPLE_SESSION_DAYS: Dict[str, int] = {
    EmailTemplateType.SESSION_WAIVER_REQUESTED.value: 9,
    EmailTemplateType.SESSION_WAIVER_DECIDED.value: -3,
    EmailTemplateType.SESSION_WAIVER_WITHDRAWN.value: 9,
    EmailTemplateType.MEETING_WAIVER_REQUESTED.value: 9,
    EmailTemplateType.MEETING_WAIVER_DECIDED.value: -3,
    EmailTemplateType.MEETING_WAIVER_WITHDRAWN.value: 9,
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    key: {"recipient_name": "full"} for key in SAMPLE_CONTEXT
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": EmailTemplateType.SESSION_WAIVER_REQUESTED,
        "name": "Training Waiver Requested",
        "subject": SESSION_REQUESTED_SUBJECT,
        "html": SESSION_REQUESTED_HTML,
        "text": _REQUESTED_TEXT,
        "description": (
            "Sent to each approver when a member asks to be excused from a "
            "training session, with Approve and Deny buttons. Says whether a "
            "reason was given; the reason stays in the Logbook."
        ),
    },
    {
        "type": EmailTemplateType.SESSION_WAIVER_DECIDED,
        "name": "Training Waiver Decided",
        "subject": SESSION_DECIDED_SUBJECT,
        "html": SESSION_DECIDED_HTML,
        "text": _DECIDED_TEXT,
        "description": (
            "Sent to the member when their request to be excused from a "
            "training session is approved, denied, or approved on the Chief's "
            "override."
        ),
    },
    {
        "type": EmailTemplateType.SESSION_WAIVER_WITHDRAWN,
        "name": "Training Waiver Withdrawn",
        "subject": SESSION_WITHDRAWN_SUBJECT,
        "html": SESSION_WITHDRAWN_HTML,
        "text": _WITHDRAWN_TEXT,
        "description": (
            "Sent to the approvers who were asked when a member withdraws a "
            "request to be excused from a training session."
        ),
    },
    {
        "type": EmailTemplateType.MEETING_WAIVER_REQUESTED,
        "name": "Meeting Waiver Requested",
        "subject": MEETING_REQUESTED_SUBJECT,
        "html": MEETING_REQUESTED_HTML,
        "text": _REQUESTED_TEXT,
        "description": (
            "Sent to each approver when a member asks to be excused from a "
            "business meeting, with Approve and Deny buttons. Not sent until "
            "the meeting workflow is available."
        ),
    },
    {
        "type": EmailTemplateType.MEETING_WAIVER_DECIDED,
        "name": "Meeting Waiver Decided",
        "subject": MEETING_DECIDED_SUBJECT,
        "html": MEETING_DECIDED_HTML,
        "text": _DECIDED_TEXT,
        "description": (
            "Sent to the member when their request to be excused from a "
            "business meeting is decided. Not sent until the meeting workflow "
            "is available."
        ),
    },
    {
        "type": EmailTemplateType.MEETING_WAIVER_WITHDRAWN,
        "name": "Meeting Waiver Withdrawn",
        "subject": MEETING_WITHDRAWN_SUBJECT,
        "html": MEETING_WITHDRAWN_HTML,
        "text": _WITHDRAWN_TEXT,
        "description": (
            "Sent to the approvers who were asked when a member withdraws a "
            "request to be excused from a business meeting. Not sent until the "
            "meeting workflow is available."
        ),
    },
]
