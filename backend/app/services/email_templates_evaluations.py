"""
Default Email Templates — Member Performance Evaluations

The four notices an evaluation sends, as editable templates (owner decision
2026-11-02):

- **Waiting on you** — a step opened and the recipient acts on it: the member's
  self-evaluation or acknowledgement, the evaluator's part, a calibration, or
  an approval signed by a position's holders.
- **Deadline reminder** — the step is still open a few days before it is due
  (the template's ``reminder_days_before``).
- **Overdue** — the step is still open after its due date; sent to whoever acts
  on it and to the department's evaluation managers.
- **Finalized** — the record is final and its PDF can be downloaded.

None of them carries anything from the evaluation itself. A rating or a
comment copied into a mailbox is out of the department's hands for good, so
the email names the member, the period and the step, and links to the
Logbook, where reading it is permission-checked and the download is audited.

``summary`` is one sentence the sender writes for the recipient's part in it
("Your self-evaluation for 2026 Annual Review is open."), so one template
serves the member, the evaluator and an approver without conditionals, which
the template system does not have.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import (
    ACCENT_AMBER,
    ACCENT_BLUE,
    ACCENT_GREEN,
    ACCENT_RED,
    action,
    build_shell,
    fact,
    facts,
)

_CHIP = "Performance evaluation"

_NOT_IN_EMAIL = (
    "        <p>The evaluation itself is not in this email. Open it in the "
    "Logbook to read it.</p>\n"
)

_NOT_IN_EMAIL_TEXT = (
    "The evaluation itself is not in this email. Open it in the Logbook to " "read it."
)


def _step_facts() -> str:
    return facts(
        [
            [
                fact("Member", "{{member_name}}"),
                fact("Review period", "{{period_name}}"),
            ],
            [fact("Step", "{{step_label}}"), fact("Due", "{{due_date}}")],
        ],
        panel=True,
    )


def _step_text(title: str) -> str:
    return f"""{title}

Hello {{{{recipient_name}}}},

{{{{summary}}}}

Member: {{{{member_name}}}}
Review period: {{{{period_name}}}}
Step: {{{{step_label}}}}
Due: {{{{due_date}}}}

{_NOT_IN_EMAIL_TEXT}

Open the evaluation: {{{{evaluation_url}}}}

{{{{footer_text}}}}"""


STEP_WAITING_SUBJECT = "Evaluation waiting on you: {{step_label}}"
STEP_WAITING_HTML = build_shell(
    "An Evaluation Is Waiting on You",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
    + _step_facts()
    + _NOT_IN_EMAIL
    + action("{{evaluation_url}}", "Open the evaluation"),
    accent=ACCENT_BLUE,
    chip=_CHIP,
)
STEP_WAITING_TEXT = _step_text("An Evaluation Is Waiting on You")

DEADLINE_REMINDER_SUBJECT = "Evaluation step due {{due_date}}: {{step_label}}"
DEADLINE_REMINDER_HTML = build_shell(
    "An Evaluation Step Is Due Soon",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
    + _step_facts()
    + _NOT_IN_EMAIL
    + action("{{evaluation_url}}", "Open the evaluation"),
    accent=ACCENT_AMBER,
    chip=_CHIP,
)
DEADLINE_REMINDER_TEXT = _step_text("An Evaluation Step Is Due Soon")

OVERDUE_SUBJECT = "Overdue evaluation step: {{step_label}}"
OVERDUE_HTML = build_shell(
    "An Evaluation Step Is Overdue",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
    + _step_facts()
    + _NOT_IN_EMAIL
    + action("{{evaluation_url}}", "Open the evaluation"),
    accent=ACCENT_RED,
    chip=_CHIP,
)
OVERDUE_TEXT = _step_text("An Evaluation Step Is Overdue")

FINALIZED_SUBJECT = "Evaluation finalized: {{period_name}}"
FINALIZED_HTML = build_shell(
    "An Evaluation Is Final",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{summary}}</p>
"""
    + facts(
        [[fact("Member", "{{member_name}}"), fact("Review period", "{{period_name}}")]],
        panel=True,
    )
    + """        <p>You can read it and download its PDF in the Logbook.</p>
"""
    + action("{{evaluation_url}}", "Open the evaluation"),
    accent=ACCENT_GREEN,
    chip=_CHIP,
)
FINALIZED_TEXT = """An Evaluation Is Final

Hello {{recipient_name}},

{{summary}}

Member: {{member_name}}
Review period: {{period_name}}

You can read it and download its PDF in the Logbook.

Open the evaluation: {{evaluation_url}}

{{footer_text}}"""


# ----------------------------------------------------------------------
# Editor catalogue and samples
# ----------------------------------------------------------------------

_COMMON_VARS: List[Dict[str, str]] = [
    {"name": "recipient_name", "description": "Recipient's name"},
    {"name": "member_name", "description": "The evaluated member's name"},
    {"name": "period_name", "description": "The review period's name"},
    {
        "name": "summary",
        "description": (
            "What the recipient is asked to do, as a sentence ending in a full "
            'stop: "You are evaluating Alex Johnson for 2026 Annual Review."'
        ),
    },
    {
        "name": "evaluation_url",
        "description": "Link to the evaluation in the Logbook",
    },
]

_STEP_VARS: List[Dict[str, str]] = _COMMON_VARS + [
    {
        "name": "step_label",
        "description": 'The step, as the template names it ("Self-evaluation")',
    },
    {"name": "due_date", "description": "The day the step is due"},
]

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    EmailTemplateType.EVALUATION_STEP_WAITING.value: _STEP_VARS,
    EmailTemplateType.EVALUATION_DEADLINE_REMINDER.value: _STEP_VARS,
    EmailTemplateType.EVALUATION_OVERDUE.value: _STEP_VARS,
    EmailTemplateType.EVALUATION_FINALIZED.value: _COMMON_VARS,
}

_SAMPLE_COMMON: Dict[str, str] = {
    "recipient_name": "Captain Maria Lopez",
    "member_name": "Alex Johnson",
    "period_name": "2026 Annual Review",
    "evaluation_url": "https://example.org/reports/evaluations/sample",
}

_SAMPLE_STEP: Dict[str, str] = {
    **_SAMPLE_COMMON,
    "step_label": "Evaluator",
    "due_date": "January 30, 2027",
}

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    EmailTemplateType.EVALUATION_STEP_WAITING.value: {
        **_SAMPLE_STEP,
        "summary": "You are evaluating Alex Johnson for 2026 Annual Review.",
    },
    EmailTemplateType.EVALUATION_DEADLINE_REMINDER.value: {
        **_SAMPLE_STEP,
        "summary": (
            "Your evaluation of Alex Johnson for 2026 Annual Review is due soon."
        ),
    },
    EmailTemplateType.EVALUATION_OVERDUE.value: {
        **_SAMPLE_STEP,
        "summary": (
            "Your evaluation of Alex Johnson for 2026 Annual Review is past its "
            "due date."
        ),
    },
    EmailTemplateType.EVALUATION_FINALIZED.value: {
        **_SAMPLE_COMMON,
        "summary": "Alex Johnson's evaluation for 2026 Annual Review is final.",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    key: {"recipient_name": "full"} for key in SAMPLE_CONTEXT
}

# Days from today that a test send places ``due_date`` at, as the real notice
# would: ahead for a waiting step and a reminder, behind for an overdue one.
SAMPLE_DUE_DAYS: Dict[str, int] = {
    EmailTemplateType.EVALUATION_STEP_WAITING.value: 14,
    EmailTemplateType.EVALUATION_DEADLINE_REMINDER.value: 3,
    EmailTemplateType.EVALUATION_OVERDUE.value: -2,
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": EmailTemplateType.EVALUATION_STEP_WAITING,
        "name": "Evaluation Waiting on You",
        "subject": STEP_WAITING_SUBJECT,
        "html": STEP_WAITING_HTML,
        "text": STEP_WAITING_TEXT,
        "description": (
            "Sent when an evaluation step opens to the people who act on it: "
            "the member, the evaluator, the calibrators or an approving "
            "position's holders. Carries a link only."
        ),
    },
    {
        "type": EmailTemplateType.EVALUATION_DEADLINE_REMINDER,
        "name": "Evaluation Step Due Soon",
        "subject": DEADLINE_REMINDER_SUBJECT,
        "html": DEADLINE_REMINDER_HTML,
        "text": DEADLINE_REMINDER_TEXT,
        "description": (
            "Sent once per step, the number of days before it is due that the "
            "evaluation template sets, to the people who act on it."
        ),
    },
    {
        "type": EmailTemplateType.EVALUATION_OVERDUE,
        "name": "Evaluation Step Overdue",
        "subject": OVERDUE_SUBJECT,
        "html": OVERDUE_HTML,
        "text": OVERDUE_TEXT,
        "description": (
            "Sent once per step, the day after it falls due, to the people who "
            "act on it and to the evaluation managers."
        ),
    },
    {
        "type": EmailTemplateType.EVALUATION_FINALIZED,
        "name": "Evaluation Finalized",
        "subject": FINALIZED_SUBJECT,
        "html": FINALIZED_HTML,
        "text": FINALIZED_TEXT,
        "description": (
            "Sent to the member and the evaluator when an evaluation is final "
            "and its PDF can be downloaded."
        ),
    },
]
