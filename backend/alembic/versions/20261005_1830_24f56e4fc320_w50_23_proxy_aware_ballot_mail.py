"""Carry untouched ballot mail onto the proxy-aware link notice (W50-23).

Revision ID: 24f56e4fc320
Revises: 7c2e9a41b6d3
Create Date: 2026-10-05 18:30:00

The ballot notification's "This link is yours alone" card was written into
the shipped body, so a proxy holder Cc'd on a delegating member's ballot
read that the link was the recipient's alone and must not be forwarded,
with no word of the proxy (W50-23). The owner kept the Cc and asked for the
wording to say whose ballot it is and who holds the proxy. The card is now
a variable the sender fills — ``{{ballot_link_notice_html}}`` and
``{{ballot_link_notice_text}}`` — with the old wording for a member's own
ballot and a notice naming both members on a proxied one.

**What this rewrites.** A ``ballot_notification`` row whose ``html_body``
**and** ``text_body`` are still byte-identical to what ``c8266855a348``
wrote, and which has no stylesheet of its own, gets both new bodies. A row
a department edited keeps its wording; the sender then puts the proxy
notice at the head of the message instead, so the names still reach both
readers. Subject, footer and colourway are not written.

**Frozen copies.** Both pairs of bodies are written out in full below
rather than read from ``EmailTemplateService``: a migration must transform
rows the way it did the day it ran. ``tests/test_w50_proxy_ballot_mail.py``
pins that the previous bodies are ``c8266855a348``'s current ones and the
new ones are what ships.

Idempotent: a row already on the new bodies matches nothing on upgrade,
and the step is skipped when ``email_templates`` does not exist yet.

**Downgrade** puts back exactly the rows still byte-identical to the new
bodies.
"""

from typing import Dict, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "24f56e4fc320"
down_revision: Union[str, Sequence[str], None] = "7c2e9a41b6d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "email_templates"
TEMPLATE_TYPE = "ballot_notification"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _swap(source_key: str, target_key: str) -> None:
    if not _has_table(TABLE):
        return
    connection = op.get_bind()
    table = sa.table(
        TABLE,
        sa.column("id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("text_body", sa.Text),
        sa.column("css_styles", sa.Text),
    )
    rows = connection.execute(
        sa.select(
            table.c.id,
            table.c.template_type,
            table.c.html_body,
            table.c.text_body,
            table.c.css_styles,
        )
    ).all()
    source = BODIES[source_key]
    target = BODIES[target_key]
    for row in rows:
        if (
            str(row.template_type or "").lower() == TEMPLATE_TYPE
            and row.css_styles is None
            and row.html_body == source["html"]
            and row.text_body == source["text"]
        ):
            connection.execute(
                table.update()
                .where(table.c.id == row.id)
                .values(html_body=target["html"], text_body=target["text"])
            )


def upgrade() -> None:
    _swap("previous", "current")


def downgrade() -> None:
    _swap("current", "previous")


# The ballot_notification bodies as c8266855a348 wrote them.
PREVIOUS_HTML = '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>\n<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->\n<div class="container">\n    <div class="masthead">\n        {{organization_logo_block}}\n        <p>{{organization_name}}</p>\n    </div>\n    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Closes {{voting_closes}}</td></tr></table>\n    <div class="summary" style="background-color: {{chip_tint}};">\n        <h1>{{election_title}}</h1>\n        <p>Voting closes {{voting_closes}}</p>\n    </div>\n    <div class="{{content_class}}">\n        <p>Hello {{recipient_name}}, a ballot is now available for your review and vote.</p>\n        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">\n            <tr><td class="fact" width="50%"><p class="fact-label">Voting opens</p><p class="fact-value">{{voting_opens}}</p></td><td class="fact" width="50%"><p class="fact-label">Voting closes</p><p class="fact-value">{{voting_closes}}</p></td></tr>\n        </table>\n{{meeting_date_html}}\n        <h2>Your ballot items</h2>\n        {{ballot_items_html}}\n        {{custom_message_html}}\n        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{ballot_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Vote Now</a></td></tr></table>\n        <p class="action-link">Or open this link: {{ballot_url}}</p>\n        <p>If you have any questions, please contact your election administrator:<br/>\n        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>\n    </div>\n    <div class="callout-info"><p class="callout-title-info">This link is yours alone</p><p class="callout-text-info">It opens your ballot. Don\'t forward this email: anyone with the link can vote as you.</p></div>\n    {{footer_html}}\n</div>\n<!--[if mso]></td></tr></table><![endif]-->'

PREVIOUS_TEXT = "Ballot Available: {{election_title}}\n\nHello {{recipient_name}},\n\nA ballot is now available for your review and vote.\n\nElection: {{election_title}}\nVoting Opens: {{voting_opens}}\nVoting Closes: {{voting_closes}}{{meeting_date_text}}\n\nYour Ballot Items:\n{{ballot_items_text}}\n\n{{custom_message}}\n\nVote here: {{ballot_url}}\n(This link opens your ballot.)\n\nIf you have any questions, please contact your election administrator:\n{{admin_contact_name}} ({{admin_contact_email}})\n\n{{footer_text}}"

# The bodies this revision ships: the link notice is a variable.
CURRENT_HTML = '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>\n<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->\n<div class="container">\n    <div class="masthead">\n        {{organization_logo_block}}\n        <p>{{organization_name}}</p>\n    </div>\n    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Closes {{voting_closes}}</td></tr></table>\n    <div class="summary" style="background-color: {{chip_tint}};">\n        <h1>{{election_title}}</h1>\n        <p>Voting closes {{voting_closes}}</p>\n    </div>\n    <div class="{{content_class}}">\n        <p>Hello {{recipient_name}}, a ballot is now available for your review and vote.</p>\n        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">\n            <tr><td class="fact" width="50%"><p class="fact-label">Voting opens</p><p class="fact-value">{{voting_opens}}</p></td><td class="fact" width="50%"><p class="fact-label">Voting closes</p><p class="fact-value">{{voting_closes}}</p></td></tr>\n        </table>\n{{meeting_date_html}}\n        <h2>Your ballot items</h2>\n        {{ballot_items_html}}\n        {{custom_message_html}}\n        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{ballot_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Vote Now</a></td></tr></table>\n        <p class="action-link">Or open this link: {{ballot_url}}</p>\n        <p>If you have any questions, please contact your election administrator:<br/>\n        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>\n    </div>\n{{ballot_link_notice_html}}\n    {{footer_html}}\n</div>\n<!--[if mso]></td></tr></table><![endif]-->'

CURRENT_TEXT = "Ballot Available: {{election_title}}\n\nHello {{recipient_name}},\n\nA ballot is now available for your review and vote.\n\nElection: {{election_title}}\nVoting Opens: {{voting_opens}}\nVoting Closes: {{voting_closes}}{{meeting_date_text}}\n\nYour Ballot Items:\n{{ballot_items_text}}\n\n{{custom_message}}\n\nVote here: {{ballot_url}}\n{{ballot_link_notice_text}}\n\nIf you have any questions, please contact your election administrator:\n{{admin_contact_name}} ({{admin_contact_email}})\n\n{{footer_text}}"

BODIES: Dict[str, Dict[str, str]] = {
    "previous": {"html": PREVIOUS_HTML, "text": PREVIOUS_TEXT},
    "current": {"html": CURRENT_HTML, "text": CURRENT_TEXT},
}
