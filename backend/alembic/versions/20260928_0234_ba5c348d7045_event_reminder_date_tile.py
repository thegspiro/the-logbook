"""Give untouched event reminders the date tile.

Revision ID: ba5c348d7045
Revises: 15c5bc7700aa
Create Date: 2026-09-28 02:34:00

The event reminder's default body now leads its title with a calendar-page
tile (the month over the day), filled from two new variables,
``event_month`` and ``event_day``, that ``send_event_reminder`` computes in
the department's timezone.

**What this rewrites.** An ``event_reminder`` row whose ``html_body`` is
still byte-identical to the body ``15c5bc7700aa`` wrote, and which has no
stylesheet of its own, gets the new body. Every other row is left as it is:
a body a department edited (or restored from its backup) keeps its wording
and simply has no tile. Subject, plain text, footer and colourway are
unchanged and not written.

**Frozen copies.** Both bodies are written out in full below rather than
read from ``EmailTemplateService``: a migration has to transform rows the way
it did the day it ran.

**Downgrade** reverses exactly the same pair: a row still byte-identical to
the new body is put back to the previous one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ba5c348d7045"
down_revision: Union[str, Sequence[str], None] = "15c5bc7700aa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TEMPLATE_TYPE = "event_reminder"


def _templates_table() -> sa.Table:
    return sa.table(
        "email_templates",
        sa.column("id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("css_styles", sa.Text),
    )


def _swap(source: str, target: str) -> None:
    connection = op.get_bind()
    table = _templates_table()
    rows = connection.execute(
        sa.select(
            table.c.id, table.c.template_type, table.c.html_body, table.c.css_styles
        )
    ).all()
    for row in rows:
        if (
            str(row.template_type or "").lower() == TEMPLATE_TYPE
            and row.css_styles is None
            and row.html_body == source
        ):
            connection.execute(
                table.update().where(table.c.id == row.id).values(html_body=target)
            )


def upgrade() -> None:
    _swap(PREVIOUS_BODY, CURRENT_BODY)


def downgrade() -> None:
    _swap(CURRENT_BODY, PREVIOUS_BODY)


# The event reminder's default body as 15c5bc7700aa wrote it.
PREVIOUS_BODY = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>{{event_title}}</h1>
        <p>{{event_start}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder about an upcoming event.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Start</p><p class="fact-value">{{event_start}}</p></td><td class="fact" width="50%"><p class="fact-label">End</p><p class="fact-value">{{event_end}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Location</p><p class="fact-value">{{location_name}}<br/>{{location_details}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Type</p><p class="fact-value">{{event_type}}</p></td></tr>
        </table>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{event_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Event</a></td></tr></table>
        <p class="action-link">Or open this link: {{event_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The event reminder's default body as of this revision, with the date tile.
CURRENT_BODY = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <table class="summary-row" role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td class="summary-lead"><table class="tile-date" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="tile-date-month" style="background-color: {{header_accent}};">{{event_month}}</td></tr><tr><td class="tile-date-day">{{event_day}}</td></tr></table></td>
            <td class="summary-text">
            <h1>{{event_title}}</h1>
            <p>{{event_start}}</p>
            </td>
        </tr></table>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder about an upcoming event.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Start</p><p class="fact-value">{{event_start}}</p></td><td class="fact" width="50%"><p class="fact-label">End</p><p class="fact-value">{{event_end}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Location</p><p class="fact-value">{{location_name}}<br/>{{location_details}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Type</p><p class="fact-value">{{event_type}}</p></td></tr>
        </table>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{event_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Event</a></td></tr></table>
        <p class="action-link">Or open this link: {{event_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""
