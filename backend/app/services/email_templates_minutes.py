"""
Default Email Templates — Meeting Minutes and Action Items

Five notices that were built in code until 2026-11-14, as editable templates:

- **Minutes circulated** — to the department when minutes are ready to read
  and comment on. Never sent for executive-session minutes.
- **Action items assigned** — to each member an approved set of minutes
  assigns work to, listing their items.
- **Action item reminder** — to an assignee whose items on adopted minutes are
  due soon or overdue, on the department's reminder schedule.
- **Open action items digest** — the weekly list of every open item and its
  owner, to the people who manage minutes.
- **Meeting action item reminder** — to an assignee of an action item on a
  meeting record (not minutes), shortly before and after it is due.

Each value was the ``template_type`` these emails already logged under, so a
department's send log runs on unbroken.

An item list is built by the sender and passed twice: as markup
(``*_html``, escaped by the sender and inserted as it stands) and as plain
text for the text version. A template has no loops, so this is how one body
holds however many items a member has.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import ACCENT_INDIGO, action, build_shell

_CHIP = "Meeting minutes"

# Filled by the sender with markup it builds and escapes; must render unescaped.
RAW_HTML_VARIABLES = {"action_items_html", "open_items_html"}


CIRCULATED_SUBJECT = "Minutes for review — {{minutes_title}}"
CIRCULATED_HTML = build_shell(
    "Minutes Ready for Review",
    """        <p>The minutes of <strong>{{minutes_title}}</strong> are ready for your
        review.</p>
        <p>Read them in Minutes and use <em>Suggest a change</em> if something
        is wrong or missing. The secretary will work in what is accepted before
        the minutes are adopted.</p>
""" + action("{{minutes_url}}", "Review the minutes"),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
)
CIRCULATED_TEXT = """Minutes Ready for Review

The minutes of {{minutes_title}} are ready for your review.

Read them in Minutes and use "Suggest a change" if something is wrong or
missing. The secretary will work in what is accepted before the minutes are
adopted.

Review the minutes: {{minutes_url}}

{{footer_text}}"""


ACTION_ITEMS_SUBJECT = "Action items assigned to you — {{minutes_title}}"
ACTION_ITEMS_HTML = build_shell(
    "Action Items Assigned to You",
    """        <p>You were assigned work at <strong>{{minutes_title}}</strong>.</p>
        {{action_items_html}}
""" + action("{{minutes_url}}", "View the minutes"),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
)
ACTION_ITEMS_TEXT = """Action Items Assigned to You

You were assigned work at {{minutes_title}}.

{{action_items_text}}

View the minutes: {{minutes_url}}

{{footer_text}}"""


REMINDER_SUBJECT = "{{reminder_summary}}"
REMINDER_HTML = build_shell(
    "Action Item Reminder",
    """        {{action_items_html}}
""" + action("{{action_items_url}}", "View your action items"),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
)
REMINDER_TEXT = """Action Item Reminder

{{action_items_text}}

View your action items: {{action_items_url}}

{{footer_text}}"""


DIGEST_SUBJECT = "Open action items — {{open_count}} to follow up"
DIGEST_HTML = build_shell(
    "Open Action Items",
    """        <p>{{summary}}</p>
        {{open_items_html}}
""" + action("{{action_items_url}}", "Open the action items"),
    accent=ACCENT_INDIGO,
    chip=_CHIP,
)
DIGEST_TEXT = """Open Action Items

{{summary}}

{{open_items_text}}

Open the action items: {{action_items_url}}

{{footer_text}}"""


MEETING_REMINDER_SUBJECT = "{{reminder_summary}}"
MEETING_REMINDER_HTML = build_shell(
    "Action Item Reminder",
    """        {{action_items_html}}
""" + action("{{action_items_url}}", "View your action items"),
    accent=ACCENT_INDIGO,
    chip="Meetings",
)
MEETING_REMINDER_TEXT = REMINDER_TEXT


_MINUTES_TITLE = {"name": "minutes_title", "description": "The minutes' title"}
_MINUTES_URL = {"name": "minutes_url", "description": "Link to the minutes"}
_ITEMS_URL = {
    "name": "action_items_url",
    "description": "Link to the action items page",
}
_ITEMS_TEXT = {
    "name": "action_items_text",
    "description": "The same list as plain text, for the text version",
}
_REMINDER_SUMMARY = {
    "name": "reminder_summary",
    "description": (
        'How many items and how urgent, for the subject: "2 overdue action '
        'item(s) and 1 due soon"'
    ),
}

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    EmailTemplateType.MINUTES_CIRCULATED.value: [_MINUTES_TITLE, _MINUTES_URL],
    EmailTemplateType.MINUTES_ACTION_ITEMS.value: [
        _MINUTES_TITLE,
        {
            "name": "action_items_html",
            "description": "The member's items from these minutes, with due dates",
        },
        _ITEMS_TEXT,
        _MINUTES_URL,
    ],
    EmailTemplateType.MINUTES_ACTION_ITEM_REMINDER.value: [
        _REMINDER_SUMMARY,
        {
            "name": "action_items_html",
            "description": (
                "The member's overdue and due-soon items, each with its due date "
                "and the minutes it came from"
            ),
        },
        _ITEMS_TEXT,
        _ITEMS_URL,
    ],
    EmailTemplateType.MINUTES_OPEN_ITEMS_DIGEST.value: [
        {"name": "open_count", "description": "How many items are open"},
        {
            "name": "summary",
            "description": (
                'One sentence: "12 action item(s) from adopted minutes are still '
                'open, 3 of them overdue."'
            ),
        },
        {
            "name": "open_items_html",
            "description": (
                "A table of open items with owner and due date, overdue first"
            ),
        },
        {
            "name": "open_items_text",
            "description": "The same list as plain text, for the text version",
        },
        _ITEMS_URL,
    ],
    EmailTemplateType.MEETING_ACTION_ITEM_REMINDER.value: [
        {
            "name": "reminder_summary",
            "description": (
                'How many items and how urgent, for the subject: "Action item '
                'due tomorrow" or "3 action items need attention, 1 overdue"'
            ),
        },
        {
            "name": "action_items_html",
            "description": (
                "The member's items, each with how soon it is due and its meeting"
            ),
        },
        _ITEMS_TEXT,
        _ITEMS_URL,
    ],
}

_SAMPLE_MINUTES_URL = "https://example.org/minutes/sample"
_SAMPLE_ITEMS_URL = "https://example.org/action-items"
_SAMPLE_TITLE = "November Business Meeting"

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    EmailTemplateType.MINUTES_CIRCULATED.value: {
        "minutes_title": _SAMPLE_TITLE,
        "minutes_url": _SAMPLE_MINUTES_URL,
    },
    EmailTemplateType.MINUTES_ACTION_ITEMS.value: {
        "minutes_title": _SAMPLE_TITLE,
        "action_items_html": (
            "<ul><li>Get three quotes for the bay door repair — due Dec 01, "
            "2026</li><li>Update the station phone list</li></ul>"
        ),
        "action_items_text": (
            "- Get three quotes for the bay door repair — due Dec 01, 2026\n"
            "- Update the station phone list"
        ),
        "minutes_url": _SAMPLE_MINUTES_URL,
    },
    EmailTemplateType.MINUTES_ACTION_ITEM_REMINDER.value: {
        "reminder_summary": "1 overdue action item(s) and 1 due soon",
        "action_items_html": (
            "<p><strong>Overdue (1)</strong></p><ul><li>Update the station "
            "phone list — due Nov 10, 2026 (October Business Meeting)</li></ul>"
            "<p><strong>Due soon (1)</strong></p><ul><li>Get three quotes for "
            "the bay door repair — due Dec 01, 2026 (November Business "
            "Meeting)</li></ul>"
        ),
        "action_items_text": (
            "Overdue (1)\n- Update the station phone list — due Nov 10, 2026 "
            "(October Business Meeting)\n\nDue soon (1)\n- Get three quotes for "
            "the bay door repair — due Dec 01, 2026 (November Business Meeting)"
        ),
        "action_items_url": _SAMPLE_ITEMS_URL,
    },
    EmailTemplateType.MINUTES_OPEN_ITEMS_DIGEST.value: {
        "open_count": "2",
        "summary": (
            "2 action item(s) from adopted minutes are still open, 1 of them "
            "overdue."
        ),
        "open_items_html": (
            '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
            '<thead><tr style="background:#f3f4f6;">'
            '<th style="padding:8px 12px;text-align:left;">Item</th>'
            '<th style="padding:8px 12px;text-align:left;">Owner</th>'
            '<th style="padding:8px 12px;text-align:left;">Due</th></tr></thead>'
            "<tbody><tr><td style='padding:8px 12px;'>Update the station phone "
            "list</td><td style='padding:8px 12px;'>Alex Johnson</td>"
            "<td style='padding:8px 12px;'>Nov 10, 2026 (overdue)</td></tr>"
            "<tr><td style='padding:8px 12px;'>Get three quotes for the bay "
            "door repair</td><td style='padding:8px 12px;'>Unassigned</td>"
            "<td style='padding:8px 12px;'>Dec 01, 2026</td></tr></tbody></table>"
        ),
        "open_items_text": (
            "- Update the station phone list — Alex Johnson — Nov 10, 2026 "
            "(overdue)\n- Get three quotes for the bay door repair — Unassigned "
            "— Dec 01, 2026"
        ),
        "action_items_url": _SAMPLE_ITEMS_URL,
    },
    EmailTemplateType.MEETING_ACTION_ITEM_REMINDER.value: {
        "reminder_summary": "Action item due tomorrow",
        "action_items_html": (
            "<ul><li>Bring the hose test records — due tomorrow (Nov 15, 2026)"
            "<br><small>Officers' Meeting</small></li></ul>"
        ),
        "action_items_text": (
            "- Bring the hose test records — due tomorrow (Nov 15, 2026)\n"
            "  Officers' Meeting"
        ),
        "action_items_url": _SAMPLE_ITEMS_URL,
    },
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": EmailTemplateType.MINUTES_CIRCULATED,
        "name": "Minutes Ready for Review",
        "subject": CIRCULATED_SUBJECT,
        "html": CIRCULATED_HTML,
        "text": CIRCULATED_TEXT,
        "description": (
            "Sent to the department when minutes are circulated for review. "
            "Never sent for executive-session minutes."
        ),
    },
    {
        "type": EmailTemplateType.MINUTES_ACTION_ITEMS,
        "name": "Action Items Assigned",
        "subject": ACTION_ITEMS_SUBJECT,
        "html": ACTION_ITEMS_HTML,
        "text": ACTION_ITEMS_TEXT,
        "description": (
            "Sent to each member approved minutes assign work to, listing their "
            "items."
        ),
    },
    {
        "type": EmailTemplateType.MINUTES_ACTION_ITEM_REMINDER,
        "name": "Action Item Reminder (Minutes)",
        "subject": REMINDER_SUBJECT,
        "html": REMINDER_HTML,
        "text": REMINDER_TEXT,
        "description": (
            "Sent to a member whose action items on adopted minutes are due soon "
            "or overdue, on the department's reminder schedule."
        ),
    },
    {
        "type": EmailTemplateType.MINUTES_OPEN_ITEMS_DIGEST,
        "name": "Open Action Items Digest",
        "subject": DIGEST_SUBJECT,
        "html": DIGEST_HTML,
        "text": DIGEST_TEXT,
        "description": (
            "The weekly list of open action items and who owns them, sent to "
            "the members who manage minutes."
        ),
    },
    {
        "type": EmailTemplateType.MEETING_ACTION_ITEM_REMINDER,
        "name": "Action Item Reminder (Meetings)",
        "subject": MEETING_REMINDER_SUBJECT,
        "html": MEETING_REMINDER_HTML,
        "text": MEETING_REMINDER_TEXT,
        "description": (
            "Sent to the assignee of an action item on a meeting record three "
            "days and one day before it is due, on the day, and the day after."
        ),
    },
]
