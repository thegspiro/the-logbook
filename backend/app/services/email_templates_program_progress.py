"""
Default Email Templates — Training Program Progress

- **Program Requirement Reopened** — to the training officers, when a
  correction (a shift report fixed, a training session re-finalized, a record
  voided) takes a member below a program requirement they had completed. The
  requirement goes back to in progress; certificates already issued, the
  enrollment's completion and phase advancement are left as they were (owner
  decision 2026-11-23), so an officer decides what, if anything, follows.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import ACCENT_AMBER, action, build_shell, fact, facts

_CHIP = "Training programs"

# Every value here is plain text, escaped when it is rendered.
RAW_HTML_VARIABLES: set[str] = set()

REOPENED_SUBJECT = "{{member_name}}: {{requirement_name}} is back in progress"

REOPENED_HTML = build_shell(
    "A Completed Requirement Was Reopened",
    """        <p>Hello {{recipient_name}},</p>
        <p>A correction took {{member_name}} below a requirement they had
        completed in {{program_name}}, so it is back in progress.</p>
"""
    + facts(
        [
            [fact("Member", "{{member_name}}"), fact("Program", "{{program_name}}")],
            [
                fact("Requirement", "{{requirement_name}}"),
                fact("Progress now", "{{progress_now}}"),
            ],
        ],
        panel=True,
    )
    + """        <p>Nothing else was changed: certificates already issued, the
        program's completion and any phase the member advanced to stand as
        they were. Review the member's progress and decide whether anything
        should follow.</p>
"""
    + action("{{progress_url}}", "Open the Member's Progress"),
    accent=ACCENT_AMBER,
    chip=_CHIP,
)

REOPENED_TEXT = """A Completed Requirement Was Reopened

Hello {{recipient_name}},

A correction took {{member_name}} below a requirement they had completed in
{{program_name}}, so it is back in progress.

Member: {{member_name}}
Program: {{program_name}}
Requirement: {{requirement_name}}
Progress now: {{progress_now}}

Nothing else was changed: certificates already issued, the program's
completion and any phase the member advanced to stand as they were. Review
the member's progress and decide whether anything should follow.

Open the member's progress: {{progress_url}}

{{footer_text}}"""

# ----------------------------------------------------------------------
# Editor catalogue and samples
# ----------------------------------------------------------------------

_T = EmailTemplateType

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    _T.PROGRAM_REQUIREMENT_REOPENED.value: [
        {"name": "recipient_name", "description": "The training officer"},
        {"name": "member_name", "description": "The member whose progress fell"},
        {"name": "program_name", "description": "The training program"},
        {"name": "requirement_name", "description": "The requirement reopened"},
        {
            "name": "progress_now",
            "description": "Where the member stands after the correction",
        },
        {"name": "progress_url", "description": "Link to the member's progress"},
    ],
}

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    _T.PROGRAM_REQUIREMENT_REOPENED.value: {
        "recipient_name": "Captain Maria Lopez",
        "member_name": "Jordan Reyes",
        "program_name": "Probationary Firefighter",
        "requirement_name": "Live Fire Hours",
        "progress_now": "18 of 24 (75%)",
        "progress_url": "https://example.org/training/programs/sample",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    _T.PROGRAM_REQUIREMENT_REOPENED.value: {"recipient_name": "full"},
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": _T.PROGRAM_REQUIREMENT_REOPENED,
        "name": "Program Requirement Reopened",
        "subject": REOPENED_SUBJECT,
        "html": REOPENED_HTML,
        "text": REOPENED_TEXT,
        "description": (
            "Sent to the training officers when a correction takes a member "
            "below a program requirement they had completed, which goes back "
            "to in progress. Certificates, the program's completion and phase "
            "advancement are not changed."
        ),
    },
]
