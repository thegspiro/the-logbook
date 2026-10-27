"""Let an untouched certification reminder say "today", not "0 days left".

Revision ID: 8079ea63f119
Revises: c616fa1bd492
Create Date: 2026-10-27 15:34:00

The Cert Expiration template is what the certification reminder now sends;
until this release the reminder was built in code and the template was
stored but never read. Its shipped default counted down in
``{{days_remaining}} days``, which reads "0 days left" on a certificate's
last day and "1 days" the day before, the wording the code-built email had
been fixed to stop using. The default now says ``{{expires_when}}``
("today", "tomorrow", "in N days") and counts with ``{{days_unit}}``.

**What this rewrites.** A ``cert_expiration`` row with no stylesheet of its
own whose ``html_body`` is still byte-identical to the body ``15c5bc7700aa``
wrote gets the new body; its ``text_body`` is carried the same way, on its
own. A field a department edited is left exactly as it is. Subject, footer
and colourway are unchanged and not written.

**Frozen copies.** All four texts are written out in full below rather than
read from ``EmailTemplateService``: a migration has to transform rows the way
it did the day it ran.

**Downgrade** reverses exactly the same pairs: a field still byte-identical
to the new text is put back to the previous one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8079ea63f119"
down_revision: Union[str, Sequence[str], None] = "c616fa1bd492"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TEMPLATE_TYPE = "cert_expiration"


def _templates_table() -> sa.Table:
    return sa.table(
        "email_templates",
        sa.column("id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("text_body", sa.Text),
        sa.column("css_styles", sa.Text),
    )


def _swap(html_source: str, html_target: str, text_source: str, text_target: str):
    connection = op.get_bind()
    table = _templates_table()
    rows = connection.execute(
        sa.select(
            table.c.id,
            table.c.template_type,
            table.c.html_body,
            table.c.text_body,
            table.c.css_styles,
        )
    ).all()
    for row in rows:
        if str(row.template_type or "").lower() != TEMPLATE_TYPE:
            continue
        values = {}
        if row.css_styles is None and row.html_body == html_source:
            values["html_body"] = html_target
        if row.text_body == text_source:
            values["text_body"] = text_target
        if values:
            connection.execute(
                table.update().where(table.c.id == row.id).values(**values)
            )


def upgrade() -> None:
    _swap(PREVIOUS_HTML, CURRENT_HTML, PREVIOUS_TEXT, CURRENT_TEXT)


def downgrade() -> None:
    _swap(CURRENT_HTML, PREVIOUS_HTML, CURRENT_TEXT, PREVIOUS_TEXT)


# The certification reminder's default as 15c5bc7700aa wrote it.
PREVIOUS_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{cert_name}} expires in {{days_remaining}} days&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">{{days_remaining}} days left</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <table class="summary-row" role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td class="summary-lead"><table class="tile-count" role="presentation" cellpadding="0" cellspacing="0" style="background-color: {{header_accent}};"><tr><td class="tile-count-num">{{days_remaining}}</td></tr><tr><td class="tile-count-unit">days</td></tr></table></td>
            <td class="summary-text">
            <h1>{{cert_name}} expires {{expiration_date}}</h1>
            <p>Renew to stay compliant for calls and drills</p>
            </td>
        </tr></table>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder that your certification is approaching its expiration date.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Certification</p><p class="fact-value">{{cert_name}}</p></td><td class="fact" width="50%"><p class="fact-label">Expiration date</p><p class="fact-value">{{expiration_date}}</p></td></tr>
        </table>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{renewal_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Certifications</a></td></tr></table>
        <p class="action-link">Or open this link: {{renewal_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""

PREVIOUS_TEXT = """Certification Expiration Notice

Hello {{recipient_name}},

This is a reminder that your certification is approaching its expiration date:

Certification: {{cert_name}}
Expiration Date: {{expiration_date}}
Days Remaining: {{days_remaining}}

Please take action to renew this certification before it expires.

View your certifications: {{renewal_url}}

{{footer_text}}"""

# The default this release ships.
CURRENT_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{cert_name}} expires {{expires_when}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Expires {{expires_when}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <table class="summary-row" role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td class="summary-lead"><table class="tile-count" role="presentation" cellpadding="0" cellspacing="0" style="background-color: {{header_accent}};"><tr><td class="tile-count-num">{{days_remaining}}</td></tr><tr><td class="tile-count-unit">{{days_unit}}</td></tr></table></td>
            <td class="summary-text">
            <h1>{{cert_name}} expires {{expiration_date}}</h1>
            <p>Renew to stay compliant for calls and drills</p>
            </td>
        </tr></table>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder that your certification is approaching its expiration date.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Certification</p><p class="fact-value">{{cert_name}}</p></td><td class="fact" width="50%"><p class="fact-label">Expiration date</p><p class="fact-value">{{expiration_date}}</p></td></tr>
        </table>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{renewal_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Certifications</a></td></tr></table>
        <p class="action-link">Or open this link: {{renewal_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""

CURRENT_TEXT = """Certification Expiration Notice

Hello {{recipient_name}},

This is a reminder that your certification is approaching its expiration date:

Certification: {{cert_name}}
Expiration Date: {{expiration_date}} ({{expires_when}})

Please take action to renew this certification before it expires.

View your certifications: {{renewal_url}}

{{footer_text}}"""
