"""
Default Email Template — Leave of Absence Notice

Tells a member that an officer recorded, changed or removed a leave of absence
on their record, and what it does to their training requirements. One template
serves all three, worded by ``summary`` and ``change_word``, so a department
edits one notice rather than three that must say the same things.

**Neither the leave's reason nor its type is in the email.** Members explain a
leave in their own words, often medical or family detail, and it is stored
encrypted; a type of "Medical" says much the same in one word. Email is not a
channel the department controls once it is sent, so the notice carries the
dates and the training effect only, and the member reads the rest after
signing in.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import ACCENT_BLUE, action, build_shell, fact, facts

SUBJECT = "Leave of absence {{change_word}}"

HTML = build_shell(
    "Your Leave of Absence",
    """        <p>Hello {{member_name}},</p>
        <p>{{summary}}</p>
"""
    + facts(
        [
            [fact("From", "{{start_date}}"), fact("To", "{{end_date}}")],
        ],
        panel=True,
    )
    + """        <p>{{training_effect}}</p>
        <p>If any of this is wrong, speak to the officer who manages leave.</p>
"""
    + action("{{training_url}}", "Open My Training"),
    accent=ACCENT_BLUE,
    chip="Leave of absence",
)

TEXT = """Your Leave of Absence

Hello {{member_name}},

{{summary}}

From: {{start_date}}
To: {{end_date}}

{{training_effect}}

If any of this is wrong, speak to the officer who manages leave.

My Training: {{training_url}}

{{footer_text}}"""

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    EmailTemplateType.LEAVE_OF_ABSENCE_NOTICE.value: [
        {"name": "member_name", "description": "The member whose leave it is"},
        {
            "name": "change_word",
            "description": (
                'What happened, for the subject line: "recorded", "updated" '
                'or "removed"'
            ),
        },
        {
            "name": "summary",
            "description": (
                "One sentence naming the officer and what they did, ending in "
                "a full stop"
            ),
        },
        {"name": "start_date", "description": "The leave's first day"},
        {
            "name": "end_date",
            "description": 'The leave\'s last day, or "No end date"',
        },
        {
            "name": "training_effect",
            "description": (
                "What the leave does to the member's training requirements, "
                "including the department's rule for a partly covered month. "
                "The leave's reason and type are never included."
            ),
        },
        {"name": "training_url", "description": "Link to My Training"},
    ],
}

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    EmailTemplateType.LEAVE_OF_ABSENCE_NOTICE.value: {
        "member_name": "Alex Johnson",
        "change_word": "recorded",
        "summary": "Captain Maria Lopez recorded a leave of absence for you.",
        "start_date": "November 01, 2026",
        "end_date": "January 31, 2027",
        "training_effect": (
            "While you are on leave, your training requirements are reduced "
            "for the months it covers. Any day of leave excuses the whole "
            "month. Training you complete during the leave still counts."
        ),
        "training_url": "https://example.org/training/my-training",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    EmailTemplateType.LEAVE_OF_ABSENCE_NOTICE.value: {"member_name": "full"},
}

# Days from today a test send places the leave at: begun two weeks ago,
# ending in two months.
SAMPLE_LEAVE_DAYS: Dict[str, Dict[str, int]] = {
    EmailTemplateType.LEAVE_OF_ABSENCE_NOTICE.value: {
        "start_date": -14,
        "end_date": 60,
    },
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": EmailTemplateType.LEAVE_OF_ABSENCE_NOTICE,
        "name": "Leave of Absence Notice",
        "subject": SUBJECT,
        "html": HTML,
        "text": TEXT,
        "description": (
            "Sent to a member when an officer records, changes or removes a "
            "leave of absence on their record, with its dates and what it "
            "does to their training requirements. Never includes the leave's "
            "reason or type."
        ),
    },
]
