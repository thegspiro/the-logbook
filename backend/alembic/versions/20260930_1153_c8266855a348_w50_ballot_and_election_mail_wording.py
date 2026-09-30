"""Carry untouched election mail onto the W50 wording.

Revision ID: c8266855a348
Revises: d9f3a6c2e8b1
Create Date: 2026-09-30 11:53:00

The W50 browser drive of the elections module changed the shipped default
bodies of three templates, and ``15c5bc7700aa`` froze those defaults, so
the rows already holding the old text need a revision to move them on:

* ``ballot_notification`` (W50-68) — the link "opens your ballot" rather
  than "signs you in", the meeting date is a fact that is omitted entirely
  when the election has none (``meeting_date_html`` / ``meeting_date_text``
  instead of a bare ``meeting_date`` row), and the sample times carry a
  zone.
* ``election_rollback`` (W50-37) — a fixed "votes no longer count" callout
  that was false on every path is replaced by the per-transition
  ``rollback_effect`` sentence, and the facts gain the invalidated-link and
  resend counts.
* ``election_report`` — the closing time and officer are a fact, and the
  recipient and skipped headings carry their own counts rather than the
  eligible-voter total.

**What this rewrites.** For each type, a row whose ``html_body`` **and**
``text_body`` are still byte-identical to what ``15c5bc7700aa`` wrote, and
which has no stylesheet of its own, gets both new bodies. Every other row is
left as it is: a body a department edited (or restored from its backup)
keeps its wording and simply renders the old variables, which the senders
still fill. Subject, footer and colourway are unchanged and not written.

Both bodies are compared and written as a pair on purpose: a department
that edited one half has edited the template, and a half-move would leave
the HTML and the plain text describing the link two different ways.

**Frozen copies.** Every body is written out in full below rather than read
from ``EmailTemplateService``: a migration has to transform rows the way it
did the day it ran. ``tests/test_w50_mail_wording_migration.py`` pins that
the previous bodies are the ones ``15c5bc7700aa`` froze and the current
ones are what ships.

Idempotent: a row already on the new bodies matches nothing on upgrade, and
the step is skipped outright when ``email_templates`` does not exist yet.

**Downgrade** reverses exactly the same pairs: a row still byte-identical
to the new bodies is put back to the previous ones.
"""

from typing import Dict, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8266855a348"
down_revision: Union[str, Sequence[str], None] = "d9f3a6c2e8b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "email_templates"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _templates_table() -> sa.Table:
    return sa.table(
        TABLE,
        sa.column("id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("text_body", sa.Text),
        sa.column("css_styles", sa.Text),
    )


def _swap(source_key: str, target_key: str) -> None:
    if not _has_table(TABLE):
        return
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
        carried = CARRIED.get(str(row.template_type or "").lower())
        if (
            carried is not None
            and row.css_styles is None
            and row.html_body == carried[source_key]["html"]
            and row.text_body == carried[source_key]["text"]
        ):
            connection.execute(
                table.update()
                .where(table.c.id == row.id)
                .values(
                    html_body=carried[target_key]["html"],
                    text_body=carried[target_key]["text"],
                )
            )


def upgrade() -> None:
    _swap("previous", "current")


def downgrade() -> None:
    _swap("current", "previous")


# The ballot_notification default HTML body as 15c5bc7700aa wrote it.
PREVIOUS_BALLOT_NOTIFICATION_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Closes {{voting_closes}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>{{election_title}}</h1>
        <p>Voting closes {{voting_closes}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, a ballot is now available for your review and vote.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Voting opens</p><p class="fact-value">{{voting_opens}}</p></td><td class="fact" width="50%"><p class="fact-label">Voting closes</p><p class="fact-value">{{voting_closes}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Meeting date</p><p class="fact-value">{{meeting_date}}</p></td></tr>
        </table>
        <h2>Your ballot items</h2>
        {{ballot_items_html}}
        {{custom_message_html}}
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{ballot_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Vote Now</a></td></tr></table>
        <p class="action-link">Or open this link: {{ballot_url}}</p>
        <p>If you have any questions, please contact your election administrator:<br/>
        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>
    </div>
    <div class="callout-info"><p class="callout-title-info">This link is yours alone</p><p class="callout-text-info">It signs you in to vote automatically. Don't forward this email: anyone with the link can vote as you.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The ballot_notification default HTML body as of this revision.
CURRENT_BALLOT_NOTIFICATION_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Closes {{voting_closes}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>{{election_title}}</h1>
        <p>Voting closes {{voting_closes}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, a ballot is now available for your review and vote.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Voting opens</p><p class="fact-value">{{voting_opens}}</p></td><td class="fact" width="50%"><p class="fact-label">Voting closes</p><p class="fact-value">{{voting_closes}}</p></td></tr>
        </table>
{{meeting_date_html}}
        <h2>Your ballot items</h2>
        {{ballot_items_html}}
        {{custom_message_html}}
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{ballot_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Vote Now</a></td></tr></table>
        <p class="action-link">Or open this link: {{ballot_url}}</p>
        <p>If you have any questions, please contact your election administrator:<br/>
        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>
    </div>
    <div class="callout-info"><p class="callout-title-info">This link is yours alone</p><p class="callout-text-info">It opens your ballot. Don't forward this email: anyone with the link can vote as you.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The ballot_notification default plain-text body as 15c5bc7700aa wrote it.
PREVIOUS_BALLOT_NOTIFICATION_TEXT = """Ballot Available: {{election_title}}

Hello {{recipient_name}},

A ballot is now available for your review and vote.

Election: {{election_title}}
Meeting Date: {{meeting_date}}
Voting Opens: {{voting_opens}}
Voting Closes: {{voting_closes}}

Your Ballot Items:
{{ballot_items_text}}

{{custom_message}}

Vote here: {{ballot_url}}
(This link will automatically log you in to vote.)

If you have any questions, please contact your election administrator:
{{admin_contact_name}} ({{admin_contact_email}})

{{footer_text}}"""


# The ballot_notification default plain-text body as of this revision.
CURRENT_BALLOT_NOTIFICATION_TEXT = """Ballot Available: {{election_title}}

Hello {{recipient_name}},

A ballot is now available for your review and vote.

Election: {{election_title}}
Voting Opens: {{voting_opens}}
Voting Closes: {{voting_closes}}{{meeting_date_text}}

Your Ballot Items:
{{ballot_items_text}}

{{custom_message}}

Vote here: {{ballot_url}}
(This link opens your ballot.)

If you have any questions, please contact your election administrator:
{{admin_contact_name}} ({{admin_contact_email}})

{{footer_text}}"""


# The election_rollback default HTML body as 15c5bc7700aa wrote it.
PREVIOUS_ELECTION_ROLLBACK_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">{{previous_stage}} → {{current_stage}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Rolled Back</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been rolled back to a previous stage.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Moved from</p><p class="fact-value">{{previous_stage}}</p></td><td class="fact" width="50%"><p class="fact-label">Moved to</p><p class="fact-value">{{current_stage}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Rolled back by</p><p class="fact-value">{{performer_name}}</p></td><td class="fact" width="50%"><p class="fact-label">When</p><p class="fact-value">{{action_time}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <p>This rollback has been logged in the election's audit trail. Please review the election details and coordinate with your team as needed.</p>
        <p>If you have questions, please contact {{performer_name}}.</p>
    </div>
    <div class="callout-warning"><p class="callout-title-warning">Some votes no longer count</p><p class="callout-text-warning">Votes recorded after the stage this election returned to are no longer counted.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The election_rollback default HTML body as of this revision.
CURRENT_ELECTION_ROLLBACK_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">{{previous_stage}} → {{current_stage}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Rolled Back</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been rolled back to a previous stage.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Moved from</p><p class="fact-value">{{previous_stage}}</p></td><td class="fact" width="50%"><p class="fact-label">Moved to</p><p class="fact-value">{{current_stage}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Rolled back by</p><p class="fact-value">{{performer_name}}</p></td><td class="fact" width="50%"><p class="fact-label">When</p><p class="fact-value">{{action_time}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Ballot links invalidated</p><p class="fact-value">{{tokens_invalidated}}</p></td><td class="fact" width="50%"><p class="fact-label">Ballots must be resent</p><p class="fact-value">{{ballots_must_be_resent}}</p></td></tr>
        </table>
        <p>This rollback has been logged in the election's audit trail. Please review the election details and coordinate with your team as needed.</p>
        <p>If you have questions, please contact {{performer_name}}.</p>
    </div>
    <div class="callout-warning"><p class="callout-title-warning">What this rollback changed</p><p class="callout-text-warning">{{rollback_effect}}</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The election_rollback default plain-text body as 15c5bc7700aa wrote it.
PREVIOUS_ELECTION_ROLLBACK_TEXT = """Election Rolled Back

Hello {{recipient_name}},

An election has been rolled back to a previous stage:

Election: {{election_title}}
Moved from: {{previous_stage}}
Moved to: {{current_stage}}
Rolled back by: {{performer_name}}
When: {{action_time}}
Reason: {{reason}}

Votes recorded after the stage this election returned to are no longer counted.

This rollback has been logged in the election's audit trail. Please review the
election details and coordinate with your team as needed. If you have
questions, please contact {{performer_name}}.

{{footer_text}}"""


# The election_rollback default plain-text body as of this revision.
CURRENT_ELECTION_ROLLBACK_TEXT = """Election Rolled Back

Hello {{recipient_name}},

An election has been rolled back to a previous stage:

Election: {{election_title}}
Moved from: {{previous_stage}}
Moved to: {{current_stage}}
Rolled back by: {{performer_name}}
When: {{action_time}}
Reason: {{reason}}
Ballot links invalidated: {{tokens_invalidated}}
Ballots must be resent: {{ballots_must_be_resent}}

{{rollback_effect}}

This rollback has been logged in the election's audit trail. Please review the
election details and coordinate with your team as needed. If you have
questions, please contact {{performer_name}}.

{{footer_text}}"""


# The election_report default HTML body as 15c5bc7700aa wrote it.
PREVIOUS_ELECTION_REPORT_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Report</h1>
        <p>{{election_title}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following election has been closed. Below is the official report.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Type</p><p class="fact-value">{{election_type}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Voting period</p><p class="fact-value">{{start_date}} &mdash; {{end_date}}</p></td></tr>
        </table>
        <h2>Turnout &amp; quorum</h2>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Eligible voters</p><p class="fact-value">{{total_eligible_voters}}</p></td><td class="fact" width="50%"><p class="fact-label">Votes cast</p><p class="fact-value">{{total_votes_cast}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Turnout</p><p class="fact-value">{{voter_turnout_percentage}}%</p></td><td class="fact" width="50%"><p class="fact-label">Quorum</p><p class="fact-value">{{quorum_status}}</p></td></tr>
        </table>
        <p>{{quorum_detail}}</p>
        <h2>Results</h2>
        {{results_html}}
        <h2>Ballot recipients ({{total_eligible_voters}})</h2>
        <p>The following members received ballots:</p>
        {{ballot_recipients_html}}
        <h2>Members who did not receive ballots</h2>
        <p>The following active members were not sent a ballot, with the reason why:</p>
        {{skipped_voters_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The election_report default HTML body as of this revision.
CURRENT_ELECTION_REPORT_HTML = """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Report</h1>
        <p>{{election_title}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following election has been closed. Below is the official report.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Type</p><p class="fact-value">{{election_type}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Voting period</p><p class="fact-value">{{start_date}} &mdash; {{end_date}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Closed</p><p class="fact-value">{{closed_at}} by {{closed_by}}</p></td></tr>
        </table>
        <h2>Turnout &amp; quorum</h2>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Eligible voters</p><p class="fact-value">{{total_eligible_voters}}</p></td><td class="fact" width="50%"><p class="fact-label">Votes cast</p><p class="fact-value">{{total_votes_cast}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Turnout</p><p class="fact-value">{{voter_turnout_percentage}}%</p></td><td class="fact" width="50%"><p class="fact-label">Quorum</p><p class="fact-value">{{quorum_status}}</p></td></tr>
        </table>
        <p>{{quorum_detail}}</p>
        <h2>Results</h2>
        {{results_html}}
        <h2>Ballot recipients ({{ballot_recipients_count}})</h2>
        {{ballot_recipients_html}}
        <h2>Members who did not receive ballots ({{skipped_voters_count}})</h2>
        <p>Members the ballot send skipped, with the reason recorded at the time:</p>
        {{skipped_voters_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->"""


# The election_report default plain-text body as 15c5bc7700aa wrote it.
PREVIOUS_ELECTION_REPORT_TEXT = """Election Report — {{election_title}}

Hello {{recipient_name}},

The following election has been closed. Below is the official report.

Election: {{election_title}}
Type: {{election_type}}
Voting Period: {{start_date}} — {{end_date}}

TURNOUT & QUORUM
Eligible Voters: {{total_eligible_voters}}
Votes Cast: {{total_votes_cast}}
Turnout: {{voter_turnout_percentage}}%
Quorum: {{quorum_status}}
{{quorum_detail}}

RESULTS
{{results_text}}

BALLOT RECIPIENTS ({{total_eligible_voters}})
{{ballot_recipients_text}}

MEMBERS WHO DID NOT RECEIVE BALLOTS
{{skipped_voters_text}}

{{footer_text}}"""


# The election_report default plain-text body as of this revision.
CURRENT_ELECTION_REPORT_TEXT = """Election Report — {{election_title}}

Hello {{recipient_name}},

The following election has been closed. Below is the official report.

Election: {{election_title}}
Type: {{election_type}}
Voting Period: {{start_date}} — {{end_date}}
Closed: {{closed_at}} by {{closed_by}}

TURNOUT & QUORUM
Eligible Voters: {{total_eligible_voters}}
Votes Cast: {{total_votes_cast}}
Turnout: {{voter_turnout_percentage}}%
Quorum: {{quorum_status}}
{{quorum_detail}}

RESULTS
{{results_text}}

BALLOT RECIPIENTS ({{ballot_recipients_count}})
{{ballot_recipients_text}}

MEMBERS WHO DID NOT RECEIVE BALLOTS ({{skipped_voters_count}})
{{skipped_voters_text}}

{{footer_text}}"""


# template_type -> the pair of bodies this revision moves between.
CARRIED: Dict[str, Dict[str, Dict[str, str]]] = {
    "ballot_notification": {
        "previous": {
            "html": PREVIOUS_BALLOT_NOTIFICATION_HTML,
            "text": PREVIOUS_BALLOT_NOTIFICATION_TEXT,
        },
        "current": {
            "html": CURRENT_BALLOT_NOTIFICATION_HTML,
            "text": CURRENT_BALLOT_NOTIFICATION_TEXT,
        },
    },
    "election_rollback": {
        "previous": {
            "html": PREVIOUS_ELECTION_ROLLBACK_HTML,
            "text": PREVIOUS_ELECTION_ROLLBACK_TEXT,
        },
        "current": {
            "html": CURRENT_ELECTION_ROLLBACK_HTML,
            "text": CURRENT_ELECTION_ROLLBACK_TEXT,
        },
    },
    "election_report": {
        "previous": {
            "html": PREVIOUS_ELECTION_REPORT_HTML,
            "text": PREVIOUS_ELECTION_REPORT_TEXT,
        },
        "current": {
            "html": CURRENT_ELECTION_REPORT_HTML,
            "text": CURRENT_ELECTION_REPORT_TEXT,
        },
    },
}
