"""
Default Email Templates — Election Notices

Five election notices that were built in code until 2026-11-14, as editable
templates:

- **Nominations open** — to every member who takes election notices, when an
  election enters its nominations phase.
- **Nominated** — to a member someone else nominated: their name reaches the
  ballot only if they accept.
- **Nomination accepted for you** — to a nominee an election manager accepted
  on their behalf, with how to decline.
- **Proxy authorized** — to the member a proxy was authorized for, warning on
  an anonymous election that the proxy ballot is attributable.
- **Pre-meeting package** — the secretary's hand send of the package PDF, with
  the secretary's own message above the standard wording.

The three emails telling election managers that ballots, the nominations
announcement or the automatic reminder did not all go out are deliberately not
here: they report the mail system failing, and a department that switched one
off would never learn its ballots were not sent.

A template has no conditionals, so a line that depends on the election — the
nomination deadline, how to decline, the anonymity warning — is written by the
sender into a variable.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import (
    ACCENT_AMBER,
    ACCENT_INDIGO,
    action,
    build_shell,
    callout,
    fact,
    facts,
)

_CHIP = "Election"

# Filled by the sender with markup it builds and escapes; must render unescaped.
RAW_HTML_VARIABLES = {"anonymity_warning_html", "message_html"}


NOMINATIONS_OPEN_SUBJECT = "Nominations Open: {{election_title}}"
NOMINATIONS_OPEN_HTML = build_shell(
    "Nominations Are Open",
    """        <p>Nominations are now open for <strong>{{election_title}}</strong>.</p>
"""
    + facts(
        [
            [fact("Positions", "{{positions}}")],
            [fact("Nominations close", "{{nominations_close}}")],
        ]
    )
    + """        <p>Nominate a member, or yourself, from the election's Nominations
        tab.</p>
"""
    + action("{{nominations_url}}", "Open the Nominations tab"),
    accent=ACCENT_INDIGO,
    chip="Nominations open",
)
NOMINATIONS_OPEN_TEXT = """Nominations Are Open

Nominations are now open for {{election_title}}.

Positions: {{positions}}
Nominations close: {{nominations_close}}

Nominate a member, or yourself, from the election's Nominations tab:
{{nominations_url}}

{{footer_text}}"""


NOMINATED_SUBJECT = "You've been nominated for {{position}} — {{election_title}}"
NOMINATED_HTML = build_shell(
    "You've Been Nominated",
    """        <p>Hello {{recipient_name}},</p>
        <p>You have been nominated for <strong>{{position}}</strong> in
        <strong>{{election_title}}</strong>.</p>
"""
    + facts(
        [
            [fact("Position", "{{position}}"), fact("Respond by", "{{respond_by}}")],
        ]
    )
    + """        <p>Your name will only appear on the ballot if you accept. Open the
        election's Nominations tab to accept or decline.</p>
"""
    + action("{{nominations_url}}", "Review your nomination"),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
    tab_note="Please respond",
)
NOMINATED_TEXT = """You've Been Nominated

Hello {{recipient_name}},

You have been nominated for {{position}} in {{election_title}}.

Position: {{position}}
Respond by: {{respond_by}}

Your name will only appear on the ballot if you accept. Open the election's
Nominations tab to accept or decline:
{{nominations_url}}

{{footer_text}}"""


ACCEPTED_FOR_YOU_SUBJECT = (
    "Your nomination for {{position}} was accepted on your behalf — "
    "{{election_title}}"
)
ACCEPTED_FOR_YOU_HTML = build_shell(
    "Your Nomination Was Accepted for You",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{manager_name}} accepted your nomination for
        <strong>{{position}}</strong> in <strong>{{election_title}}</strong> on
        your behalf. Your name will appear on the ballot, labelled as accepted by
        an election manager.</p>
        <p>{{decline_instructions}}</p>
""" + action("{{nominations_url}}", "Open the election"),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
)
ACCEPTED_FOR_YOU_TEXT = """Your Nomination Was Accepted for You

Hello {{recipient_name}},

{{manager_name}} accepted your nomination for {{position}} in
{{election_title}} on your behalf. Your name will appear on the ballot,
labelled as accepted by an election manager.

{{decline_instructions}}

Open the election: {{nominations_url}}

{{footer_text}}"""


PROXY_AUTHORIZED_SUBJECT = "Proxy authorized — {{election_title}}"
PROXY_AUTHORIZED_HTML = build_shell(
    "A Proxy Was Authorized for You",
    """        <p>Hello {{recipient_name}},</p>
        <p>{{proxy_holder_name}} has been authorized to vote on your behalf in
        <strong>{{election_title}}</strong>.</p>
        {{anonymity_warning_html}}
""",
    accent=ACCENT_AMBER,
    chip=_CHIP,
    after=callout(
        "warning",
        "Didn't ask for this?",
        "Contact your secretary before voting opens.",
    ),
)
PROXY_AUTHORIZED_TEXT = """A Proxy Was Authorized for You

Hello {{recipient_name}},

{{proxy_holder_name}} has been authorized to vote on your behalf in
{{election_title}}.

{{anonymity_warning}}

Didn't ask for this? Contact your secretary before voting opens.

{{footer_text}}"""


PRE_MEETING_PACKAGE_SUBJECT = "Pre-Meeting Package: {{election_title}}"
PRE_MEETING_PACKAGE_HTML = build_shell(
    "Pre-Meeting Package",
    """        {{message_html}}
        <p>The pre-meeting package for <strong>{{election_title}}</strong> is
        attached as a PDF. It contains the meeting details, the ballot preview
        with candidates, and {{package_contents}}.</p>
"""
    + facts(
        [
            [
                fact("Voting opens", "{{voting_opens}}"),
                fact("Voting closes", "{{voting_closes}}"),
            ],
        ]
    ),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
)
PRE_MEETING_PACKAGE_TEXT = """Pre-Meeting Package

{{message_text}}The pre-meeting package for {{election_title}} is attached as a
PDF. It contains the meeting details, the ballot preview with candidates, and
{{package_contents}}.

Voting opens: {{voting_opens}}
Voting closes: {{voting_closes}}

{{footer_text}}"""


_ELECTION = {"name": "election_title", "description": "The election's title"}
_RECIPIENT = {"name": "recipient_name", "description": "The member's first name"}
_NOMINATIONS_URL = {
    "name": "nominations_url",
    "description": "Link to the election's Nominations tab",
}

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    EmailTemplateType.ELECTION_NOMINATIONS_OPEN.value: [
        _ELECTION,
        {"name": "positions", "description": "The positions, comma-separated"},
        {
            "name": "nominations_close",
            "description": (
                "When nominations close, in the department's time zone, or "
                '"When the election managers close them" when no deadline is set'
            ),
        },
        _NOMINATIONS_URL,
    ],
    EmailTemplateType.ELECTION_NOMINATED.value: [
        _RECIPIENT,
        _ELECTION,
        {"name": "position", "description": "The position nominated for"},
        {
            "name": "respond_by",
            "description": (
                "When nominations close, or "
                '"Before nominations close" when no deadline is set'
            ),
        },
        _NOMINATIONS_URL,
    ],
    EmailTemplateType.ELECTION_NOMINATION_ACCEPTED_FOR_YOU.value: [
        _RECIPIENT,
        _ELECTION,
        {"name": "position", "description": "The position nominated for"},
        {
            "name": "manager_name",
            "description": "The election manager who accepted the nomination",
        },
        {
            "name": "decline_instructions",
            "description": (
                "How to decline: from the Nominations tab while nominations "
                "are open, otherwise by contacting the secretary"
            ),
        },
        _NOMINATIONS_URL,
    ],
    EmailTemplateType.ELECTION_PROXY_AUTHORIZED.value: [
        _RECIPIENT,
        _ELECTION,
        {
            "name": "proxy_holder_name",
            "description": "The member authorized to vote on the recipient's behalf",
        },
        {
            "name": "anonymity_warning_html",
            "description": (
                "On an anonymous election, a paragraph warning that a proxy "
                "ballot can be traced; empty otherwise"
            ),
        },
        {
            "name": "anonymity_warning",
            "description": "The same warning as plain text, for the text version",
        },
    ],
    EmailTemplateType.PRE_MEETING_PACKAGE.value: [
        _ELECTION,
        {
            "name": "message_html",
            "description": (
                "The message the secretary typed when sending, above a rule; "
                "empty when none was typed"
            ),
        },
        {
            "name": "message_text",
            "description": "The secretary's message as plain text, for the text version",
        },
        {
            "name": "package_contents",
            "description": (
                'What the roster section holds: "the eligible-voter list" or the '
                "full voter-eligibility roster"
            ),
        },
        {"name": "voting_opens", "description": "When voting opens"},
        {"name": "voting_closes", "description": "When voting closes"},
    ],
}

_SAMPLE_NOMINATIONS_URL = "https://example.org/elections/sample?tab=nominations"
_SAMPLE_TITLE = "2027 Officer Election"

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    EmailTemplateType.ELECTION_NOMINATIONS_OPEN.value: {
        "election_title": _SAMPLE_TITLE,
        "positions": "Chief, Deputy Chief, Secretary",
        "nominations_close": "December 1, 2026 at 07:00 PM",
        "nominations_url": _SAMPLE_NOMINATIONS_URL,
    },
    EmailTemplateType.ELECTION_NOMINATED.value: {
        "recipient_name": "Alex",
        "election_title": _SAMPLE_TITLE,
        "position": "Deputy Chief",
        "respond_by": "December 1, 2026 at 07:00 PM",
        "nominations_url": _SAMPLE_NOMINATIONS_URL,
    },
    EmailTemplateType.ELECTION_NOMINATION_ACCEPTED_FOR_YOU.value: {
        "recipient_name": "Alex",
        "election_title": _SAMPLE_TITLE,
        "position": "Deputy Chief",
        "manager_name": "Captain Maria Lopez",
        "decline_instructions": (
            "If you do not wish to stand, decline from the election's "
            "Nominations tab before nominations close."
        ),
        "nominations_url": _SAMPLE_NOMINATIONS_URL,
    },
    EmailTemplateType.ELECTION_PROXY_AUTHORIZED.value: {
        "recipient_name": "Alex",
        "election_title": _SAMPLE_TITLE,
        "proxy_holder_name": "Sam Carter",
        "anonymity_warning_html": (
            "<p><strong>This is an anonymous election, but a proxy ballot is "
            "not anonymous: your proxy holder will see how you vote, and the "
            "ballot they cast for you is stored linked to your name.</strong></p>"
        ),
        "anonymity_warning": (
            "This is an anonymous election, but a proxy ballot is not anonymous: "
            "your proxy holder will see how you vote, and the ballot they cast "
            "for you is stored linked to your name."
        ),
    },
    EmailTemplateType.PRE_MEETING_PACKAGE.value: {
        "election_title": _SAMPLE_TITLE,
        "message_html": (
            "<p style='white-space:pre-line'>Please read this before Tuesday's "
            "meeting.</p><hr/>"
        ),
        "message_text": "Please read this before Tuesday's meeting.\n\n---\n\n",
        "package_contents": "the eligible-voter list",
        "voting_opens": "December 8, 2026 at 07:00 PM",
        "voting_closes": "December 8, 2026 at 09:00 PM",
    },
}

# The test send greets the admin it goes to.
TEST_RECIPIENT_FIELDS: Dict[str, Dict[str, str]] = {
    EmailTemplateType.ELECTION_NOMINATED.value: {"recipient_name": "first"},
    EmailTemplateType.ELECTION_NOMINATION_ACCEPTED_FOR_YOU.value: {
        "recipient_name": "first"
    },
    EmailTemplateType.ELECTION_PROXY_AUTHORIZED.value: {"recipient_name": "first"},
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": EmailTemplateType.ELECTION_NOMINATIONS_OPEN,
        "name": "Nominations Open",
        "subject": NOMINATIONS_OPEN_SUBJECT,
        "html": NOMINATIONS_OPEN_HTML,
        "text": NOMINATIONS_OPEN_TEXT,
        "description": (
            "Sent to every member who takes election notices when an election "
            "opens for nominations."
        ),
    },
    {
        "type": EmailTemplateType.ELECTION_NOMINATED,
        "name": "You've Been Nominated",
        "subject": NOMINATED_SUBJECT,
        "html": NOMINATED_HTML,
        "text": NOMINATED_TEXT,
        "description": (
            "Sent to a member someone else nominated, asking them to accept or "
            "decline. Their name reaches the ballot only if they accept."
        ),
    },
    {
        "type": EmailTemplateType.ELECTION_NOMINATION_ACCEPTED_FOR_YOU,
        "name": "Nomination Accepted for You",
        "subject": ACCEPTED_FOR_YOU_SUBJECT,
        "html": ACCEPTED_FOR_YOU_HTML,
        "text": ACCEPTED_FOR_YOU_TEXT,
        "description": (
            "Sent to a nominee when an election manager accepts their "
            "nomination on their behalf, with how to decline."
        ),
    },
    {
        "type": EmailTemplateType.ELECTION_PROXY_AUTHORIZED,
        "name": "Proxy Authorized",
        "subject": PROXY_AUTHORIZED_SUBJECT,
        "html": PROXY_AUTHORIZED_HTML,
        "text": PROXY_AUTHORIZED_TEXT,
        "description": (
            "Sent to a member when a proxy is authorized to vote on their behalf. "
            "On an anonymous election it warns that the proxy ballot can be traced."
        ),
    },
    {
        "type": EmailTemplateType.PRE_MEETING_PACKAGE,
        "name": "Pre-Meeting Package",
        "subject": PRE_MEETING_PACKAGE_SUBJECT,
        "html": PRE_MEETING_PACKAGE_HTML,
        "text": PRE_MEETING_PACKAGE_TEXT,
        "description": (
            "Sent by the secretary from an election, with the package PDF "
            "attached. Switched off, the Send button refuses and says so."
        ),
    },
]
