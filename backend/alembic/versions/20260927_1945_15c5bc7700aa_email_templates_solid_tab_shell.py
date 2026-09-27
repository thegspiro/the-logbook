"""Move untouched email templates onto the solid-tab shell.

Revision ID: 15c5bc7700aa
Revises: 4acf7f8212a2
Create Date: 2026-09-27 19:45:00

The default templates were redesigned again (design "2b, solid tab"): the
masthead is unchanged, but the notice now opens with a solid tab in its
accent naming the category and, on the right, the one piece of urgency it
carries; the title sits on a card tinted with the accent; the button spans
the card; callouts are stacked as cards of their own under the body; and the
footer is centred. The stylesheet reaches every installation on its own —
``css_styles`` is NULL for any row that never customised it — but the
*markup* lives in each organization's ``email_templates.html_body``, so a
code change alone reaches only new organizations and templates somebody
resets.

**What this rewrites.** A row whose ``html_body`` is still byte-identical to
the body the previous release shipped for its own ``template_type`` gets the
new body. That previous body is what ``b795d1b3401b`` moved every untouched
row onto, so one frozen version per type recognises every row nobody
edited. Nothing else is touched:

* A body a department edited matches nothing here and keeps rendering as it
  does today, against a stylesheet that still defines every class the
  previous shells used.
* A row with its own ``css_styles`` is skipped even when its body is
  untouched. The department wrote that stylesheet against the old markup's
  class names; swapping the markup under it could quietly undo their work.
* Subjects, plain-text bodies and footers are identical before and after and
  are not written.

**The Welcome accent.** Welcome moves from red to green, so red is left to
official notices. ``header_accent`` on a converted Welcome row is moved with
it — but only when it still holds the red the row was stamped with. NULL
already means "the type's own colour", which is now green; any other value
is a colour an officer picked and is left alone.

**Frozen copies.** Both bodies for every type are written out in full below,
rather than read from ``EmailTemplateService``: a migration has to transform
rows the way it did the day it ran, and the service's defaults are free to
change in the next release.

**Downgrade** reverses exactly the same pairs: a row still byte-identical to
the new body is put back to the previous one, and a converted Welcome row
still holding the new green goes back to red. A template edited after the
upgrade keeps its edits and its new markup; code from before this release
renders the solid tab's ``{{status_chip}}`` and ``{{chip_tint}}``
correctly (both tokens predate this revision) but has no rules for the new
classes, so such a body sends with its tab and cards unstyled.
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "15c5bc7700aa"
down_revision: Union[str, Sequence[str], None] = "4acf7f8212a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Welcome's accent, before and after this revision.
_WELCOME = "welcome"
_PREVIOUS_WELCOME_ACCENT = "#b91c1c"
_CURRENT_WELCOME_ACCENT = "#047857"


def _templates_table() -> sa.Table:
    return sa.table(
        "email_templates",
        sa.column("id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("css_styles", sa.Text),
        sa.column("header_accent", sa.String),
    )


def changes_for(row, source: dict, target: dict, accents: tuple) -> dict:
    """The columns to rewrite for one row moving from *source* to *target*.

    *accents* is the (from, to) pair for a converted Welcome row. Empty when
    the row is not a verbatim copy of *source*'s body for its own type, or
    carries its own stylesheet.
    """
    template_type = str(row.template_type or "").lower()
    body: Optional[str] = source.get(template_type)
    if body is None or row.css_styles is not None or row.html_body != body:
        return {}
    changes = {"html_body": target[template_type]}
    if template_type == _WELCOME and row.header_accent == accents[0]:
        changes["header_accent"] = accents[1]
    return changes


def _swap(source: dict, target: dict, accents: tuple) -> None:
    connection = op.get_bind()
    table = _templates_table()
    rows = connection.execute(
        sa.select(
            table.c.id,
            table.c.template_type,
            table.c.html_body,
            table.c.css_styles,
            table.c.header_accent,
        )
    ).all()
    for row in rows:
        changes = changes_for(row, source, target, accents)
        if changes:
            connection.execute(
                table.update().where(table.c.id == row.id).values(**changes)
            )


def upgrade() -> None:
    _swap(
        PREVIOUS_BODIES,
        CURRENT_BODIES,
        (_PREVIOUS_WELCOME_ACCENT, _CURRENT_WELCOME_ACCENT),
    )


def downgrade() -> None:
    _swap(
        CURRENT_BODIES,
        PREVIOUS_BODIES,
        (_CURRENT_WELCOME_ACCENT, _PREVIOUS_WELCOME_ACCENT),
    )


# The body each default template shipped with immediately before this
# revision, keyed by template_type value.
PREVIOUS_BODIES = {
    "application_withdrawn": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Application Withdrawn</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{applicant_name}},</p>
        <p>This confirms that you withdrew your application to join
        {{organization_name}} on <strong>{{withdrawal_date}}</strong>. Our
        membership coordinators have been told, and your application is now
        closed.</p>
        <p>Thank you for your interest in the department. If you withdrew by
        mistake, or would like to apply again in the future, please contact us
        directly.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "ballot_eligibility_summary": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Ballot Eligibility Summary</h1>
        <p style="color: {{header_accent}};">{{election_title}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, ballot emails for <strong>{{election_title}}</strong> have been sent. Below is a summary of member eligibility.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Ballots sent</p><p class="fact-value">{{sent_count}}</p></td><td class="fact" width="50%"><p class="fact-label">Members skipped</p><p class="fact-value">{{skipped_count}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Total checked in</p><p class="fact-value">{{total_checked_in}}</p></td></tr>
        </table>
        <h2>Members who received ballots ({{sent_count}})</h2>
        {{recipients_html}}
        <h2>Members who did not receive ballots ({{skipped_count}})</h2>
        <div class="alert">
            <p>These members were skipped because they did not meet the eligibility
            requirements for any ballot item. The specific reason for each is listed below.</p>
        </div>
        {{skipped_voters_html}}
        <h2>What you can do</h2>
        <ul>
            <li><strong>Voter overrides:</strong> if a skipped member should be allowed to vote, use the Voter Override feature on the election page to grant them an exception.</li>
            <li><strong>Check in members:</strong> if a member was skipped due to attendance, check them in on the Meeting Attendance panel and resend ballots.</li>
            <li><strong>Review tier settings:</strong> if a membership tier is incorrectly marked as ineligible, update it in Organization Settings &gt; Membership Tiers.</li>
        </ul>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "ballot_notification": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>{{election_title}}</h1>
        <p style="color: {{header_accent}};">Voting closes {{voting_closes}}</p>
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
        <p class="action"><a href="{{ballot_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Vote Now</a></p>
        <p class="action-link">Or open this link: {{ballot_url}}</p>
        <p class="fineprint">Clicking the link above will automatically log you in to vote.</p>
        <p>If you have any questions, please contact your election administrator:<br/>
        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "cert_expiration": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{expiration_date}} · {{days_remaining}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>{{cert_name}} expires in {{days_remaining}} days</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder that your certification is approaching its expiration date.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Expiration date</p><p class="fact-value">{{expiration_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Days remaining</p><p class="fact-value">{{days_remaining}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Certification</p><p class="fact-value">{{cert_name}}</p></td></tr>
        </table>
        <div class="alert">
            <p>Renew before it expires to stay compliant for calls and drills.</p>
        </div>
        <p class="action"><a href="{{renewal_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">View Certifications</a></p>
        <p class="action-link">Or open this link: {{renewal_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "duplicate_application": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Application Already on File</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{applicant_name}},</p>
        <p>Thank you for your interest in joining {{organization_name}}.</p>
        <p>Our records show that we already have an application on file for
        this email address, originally received on <strong>{{original_date}}</strong>.
        A duplicate application has not been created.</p>
        <p>If you believe this is an error, or if you have questions about the
        status of your application, please contact us directly.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "election_deleted": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Election Deleted</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been permanently deleted.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Deleted by</p><p class="fact-value">{{performer_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <div class="alert">
            <p>All associated ballots and results have been removed. This cannot be undone.</p>
        </div>
        <p>If you have questions, please contact {{performer_name}}.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "election_report": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Election Report</h1>
        <p style="color: {{header_accent}};">{{election_title}}</p>
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
<!--[if mso]></td></tr></table><![endif]-->""",
    "election_rollback": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Election Rolled Back</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been rolled back to a previous stage.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Rolled back by</p><p class="fact-value">{{performer_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <div class="alert">
            <p>Votes recorded after the stage this election returned to are no longer counted.</p>
        </div>
        <p>Please review the election details and coordinate with your team as needed.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "event_cancellation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Event Cancelled</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following event has been cancelled.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Original date</p><p class="fact-value">{{event_date}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <p>Please update your calendar accordingly. If you have questions, contact your department leadership.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "event_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>{{event_title}}</h1>
        <p style="color: {{header_accent}};">{{event_start}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder about an upcoming event.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Start</p><p class="fact-value">{{event_start}}</p></td><td class="fact" width="50%"><p class="fact-label">End</p><p class="fact-value">{{event_end}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Location</p><p class="fact-value">{{location_name}}<br/>{{location_details}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Type</p><p class="fact-value">{{event_type}}</p></td></tr>
        </table>
        <p class="action"><a href="{{event_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">View Event</a></p>
        <p class="action-link">Or open this link: {{event_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "event_request_status": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Event Request Update</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{contact_name}},</p>
        <p>Your event request has been updated to: <strong>{{status_label}}</strong>.</p>
        {{details_html}}
        {{message_html}}
        <p>Thank you for your request.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "inactivity_warning": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{prospect_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Prospective Member Inactivity Alert</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{coordinator_name}}, a prospective member in your pipeline has been inactive and may need attention.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Prospect</p><p class="fact-value">{{prospect_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Current stage</p><p class="fact-value">{{pipeline_stage}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Days inactive</p><p class="fact-value">{{days_inactive}} days</p></td><td class="fact" width="50%"><p class="fact-label">Timeout threshold</p><p class="fact-value">{{timeout_days}} days</p></td></tr>
        </table>
        <p>Please review their progress and take appropriate action.</p>
        <p class="action"><a href="{{prospect_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">View Prospect</a></p>
        <p class="action-link">Or open this link: {{prospect_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "inventory_change": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Inventory Change Confirmation</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{first_name}},</p>
        <p>
            This message is to confirm recent changes to the department property
            assigned to you as of <strong>{{change_date}}</strong>.
        </p>
        {{items_issued_html}}
        {{items_returned_html}}
        {{items_removed_html}}
        <div class="alert">
            <p>All items listed above remain the property of
            <strong>{{organization_name}}</strong>. Members are responsible for the
            care, maintenance, and safekeeping of all department-issued property.
            Any lost, stolen, or damaged items must be reported to the Quartermaster
            immediately.</p>
        </div>
        <p>If you believe there is an error in this notice, please contact the
        Quartermaster or department administration at your earliest convenience.</p>
        <p>Thank you,<br/>{{organization_name}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "it_password_notification": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{user_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>IT Notice: Password Reset Requested</h1>
    </div>
    <div class="{{content_class}}">
        <p>A password reset has been requested for the following user.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">User</p><p class="fact-value">{{user_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Email</p><p class="fact-value">{{user_email}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Requested at</p><p class="fact-value">{{request_time}}</p></td><td class="fact" width="50%"><p class="fact-label">IP address</p><p class="fact-value">{{ip_address}}</p></td></tr>
        </table>
        <p>This is an informational notice. No action is required unless the request appears suspicious.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "member_archived": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Member Archived</h1>
    </div>
    <div class="{{content_class}}">
        <p><strong>{{member_name}}</strong> has been automatically archived.</p>
        <p>All department property has been returned. Previous status: <strong>{{previous_status}}</strong>.</p>
        <p>The member's profile remains accessible for legal requests or future reactivation.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "member_dropped": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Department Property Return Notice</h1>
    </div>
    <div class="{{content_class}}">
        <p>Dear {{member_name}},</p>
        <p>
            This message serves as formal notice that your membership status with
            <strong>{{organization_name}}</strong> has been changed to
            <strong>{{drop_type_display}}</strong> effective <strong>{{effective_date}}</strong>.
        </p>
        <p><strong>Reason:</strong> {{reason}}</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Return deadline</p><p class="fact-value">{{return_deadline}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Outstanding items</p><p class="fact-value">{{item_count}} item(s)</p></td><td class="fact" width="50%"><p class="fact-label">Total assessed value</p><p class="fact-value">${{total_value}}</p></td></tr>
        </table>
        {{items_list_html}}
        <p>
            In accordance with department policy, all department-issued property must be
            returned in its current condition by the deadline above. Please contact the
            department administration to arrange return of these items.
        </p>
        <p>
            Respectfully,<br/>
            {{performed_by_name}}<br/>
            {{performed_by_title}}<br/>
            {{organization_name}}
        </p>
        <p class="fineprint">A copy of this notice has been placed in your member file.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "password_reset": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Reset your password</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{first_name}},</p>
        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>. This link expires in <strong>{{expiry_minutes}} minutes</strong>.</p>
        <p class="action"><a href="{{reset_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Reset Password</a></p>
        <p class="action-link">Or open this link: {{reset_url}}</p>
        <p>If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "post_event_validation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Please Validate Attendance</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following event has ended and needs attendance validation.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{event_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Recorded attendees</p><p class="fact-value">{{attendee_count}}</p></td></tr>
        </table>
        <p>Please review and validate the attendance records at your earliest convenience.</p>
        <p class="action"><a href="{{validation_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Validate Attendance</a></p>
        <p class="action-link">Or open this link: {{validation_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "post_shift_validation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Shift Attendance Validation</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following shift has ended and needs attendance validation.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Shift</p><p class="fact-value">{{shift_name}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Members on shift</p><p class="fact-value">{{attendee_count}}</p></td></tr>
        </table>
        <p>Please review and confirm the shift attendance.</p>
        <p class="action"><a href="{{validation_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Validate Shift</a></p>
        <p class="action-link">Or open this link: {{validation_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "property_return_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}} · {{days_since_drop}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Property Return Reminder</h1>
    </div>
    <div class="{{content_class}}">
        <p>Dear {{member_name}},</p>
        <p>This is a reminder that you still have outstanding department property that needs to be returned.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Return deadline</p><p class="fact-value">{{return_deadline}}</p></td><td class="fact" width="50%"><p class="fact-label">Days since separation</p><p class="fact-value">{{days_since_drop}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Outstanding items</p><p class="fact-value">{{item_count}} item(s)</p></td><td class="fact" width="50%"><p class="fact-label">Total assessed value</p><p class="fact-value">${{total_value}}</p></td></tr>
        </table>
        {{items_list_html}}
        <p>Please contact the department administration to arrange return of these items as soon as possible.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "series_end_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{series_end_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Recurring Series Ending Soon</h1>
        <p style="color: {{header_accent}};">{{series_end_date}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder that the following recurring event series is scheduled to end in approximately <strong>6 months</strong>.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Series ends</p><p class="fact-value">{{series_end_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Remaining occurrences</p><p class="fact-value">{{remaining_occurrences}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Pattern</p><p class="fact-value">{{recurrence_pattern}}</p></td></tr>
        </table>
        <p>If you would like to extend or modify this series, please update the event before the series end date.</p>
        <p class="action"><a href="{{event_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">View Event</a></p>
        <p class="action-link">Or open this link: {{event_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "shift_assignment": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>New shift assignment</h1>
        <p style="color: {{header_accent}};">{{shift_date}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, you have been assigned to an upcoming shift.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Starts</p><p class="fact-value">{{shift_start}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Position</p><p class="fact-value">{{position}}</p></td></tr>
        </table>
        {{checklist_html}}
        <p>Please confirm or decline this assignment so the shift officer knows
        whether the position is covered.</p>
        <p class="action"><a href="{{shift_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">View Shift</a></p>
        <p class="action-link">Or open this link: {{shift_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "shift_decline": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Shift Coverage Needed</h1>
        <p style="color: {{header_accent}};">{{shift_date}}</p>
    </div>
    <div class="{{content_class}}">
        <p><strong>{{member_name}}</strong> {{action}} the following position. It is now open.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Position</p><p class="fact-value">{{position}}</p></td></tr>
        </table>
        <p>Please assign a replacement so the shift is not left short.</p>
        <p class="action"><a href="{{shift_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Open the Schedule</a></p>
        <p class="action-link">Or open this link: {{shift_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "shift_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}} at {{shift_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Start-of-Shift Reminder</h1>
        <p style="color: {{header_accent}};">{{shift_date}} at {{shift_start}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, your upcoming shift briefing is below. Please arrive on time and mark
        your arrival when you get to the station.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Time</p><p class="fact-value">{{time_range}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Your position</p><p class="fact-value">{{position}}</p></td></tr>
        </table>
        {{apparatus_html}}
        {{roster_html}}
        {{checklist_html}}
        <p class="action"><a href="{{arrival_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Mark Arrival</a></p>
        <p class="action-link">Or open this link: {{arrival_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_new_order_admin": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>New Store Order</h1>
        <p style="color: {{header_accent}};">{{order_total}}</p>
    </div>
    <div class="{{content_class}}">
        <p><strong>{{customer_name}}</strong> placed order
           <strong>{{order_number}}</strong>.</p>
        {{items_table_html}}
        {{member_notes_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_order_cancelled": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Order Cancelled</h1>
        <p style="color: {{header_accent}};">{{order_number}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Your order <strong>{{order_number}}</strong> has been cancelled.</p>
        {{cancellation_reason_html}}
        {{refund_notice_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_order_confirmation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Total {{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Order {{order_number}} received</h1>
        <p style="color: {{header_accent}};">Total {{order_total}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hi {{first_name}},</p>
        <p>Thanks for your order from the {{store_name}}. Your order number is
           <strong>{{order_number}}</strong>.</p>
        {{items_table_html}}
        {{payment_block_html}}
        {{receipt_footer_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_order_update": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Order Update</h1>
        <p style="color: {{header_accent}};">{{order_number}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Update on your order <strong>{{order_number}}</strong>{{status_label_suffix}}.</p>
        <p style="white-space:pre-line;">{{update_message}}</p>
        {{payment_block_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_payment_received": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Payment Received</h1>
        <p style="color: {{header_accent}};">{{order_number}}</p>
    </div>
    <div class="{{content_class}}">
        {{payment_summary_html}}
        {{balance_notice_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_payment_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{balance_due}} outstanding&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Payment Reminder</h1>
        <p style="color: {{header_accent}};">{{balance_due}} outstanding</p>
    </div>
    <div class="{{content_class}}">
        <p>Your order <strong>{{order_number}}</strong> still has a balance of
           <strong>{{balance_due}}</strong>.</p>
        {{items_table_html}}
        {{payment_block_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_vendor_order_placed": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Order Placed</h1>
        <p style="color: {{header_accent}};">{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Your order has been placed with the vendor.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_window_closed": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Order Window Closed</h1>
        <p style="color: {{header_accent}};">{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Ordering has closed and the department is placing the order.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_window_closing": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Order Window Closing</h1>
        <p style="color: {{header_accent}};">{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Last call — the store order window closes soon.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_window_open": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Ordering Is Open</h1>
        <p style="color: {{header_accent}};">{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>The department store is now taking orders.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "suggestion_submitted": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>New Suggestion Box Submission</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}},</p>
        <p>A new submission was received in the <strong>{{box_name}}</strong>
        suggestion box, which you review.</p>
        <p>Open it in the Logbook to read it and set its status.</p>
        <p class="action"><a href="{{suggestion_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Review Submission</a></p>
        <p class="action-link">Or open this link: {{suggestion_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "training_approval": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Due {{approval_deadline}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Training Approval Needed</h1>
        <p style="color: {{header_accent}};">Due {{approval_deadline}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello, a training event has been submitted and requires your approval.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Approval deadline</p><p class="fact-value">{{approval_deadline}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Course</p><p class="fact-value">{{course_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{event_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Attendees</p><p class="fact-value">{{attendee_count}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Submitted by</p><p class="fact-value">{{submitter_name}}</p></td></tr>
        </table>
        <p class="action"><a href="{{approval_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Review &amp; Approve</a></p>
        <p class="action-link">Or open this link: {{approval_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "welcome": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{username}} · {{temp_password}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <div class="header">
        {{status_line}}
        <h1>Your account is ready</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{first_name}},</p>
        <p>Your account has been created for <strong>{{organization_name}}</strong>. You can now log in and access the system.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Username</p><p class="fact-mono">{{username}}</p></td><td class="fact" width="50%"><p class="fact-label">Temporary password</p><p class="fact-mono">{{temp_password}}</p></td></tr>
        </table>
        <p>For security, please change your password after your first login.</p>
        <p class="action"><a href="{{login_url}}" class="button" style="background-color: {{header_accent}}; border: 1px solid {{header_accent}};">Log In Now</a></p>
        <p class="action-link">Or open this link: {{login_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
}


# The body each default template ships with as of this revision.
CURRENT_BODIES = {
    "application_withdrawn": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Application Withdrawn</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{applicant_name}},</p>
        <p>This confirms that you withdrew your application to join
        {{organization_name}} on <strong>{{withdrawal_date}}</strong>. Our
        membership coordinators have been told, and your application is now
        closed.</p>
        <p>Thank you for your interest in the department. If you withdrew by
        mistake, or would like to apply again in the future, please contact us
        directly.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "ballot_eligibility_summary": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Ballot Eligibility Summary</h1>
        <p>{{election_title}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, ballot emails for <strong>{{election_title}}</strong> have been sent. Below is a summary of member eligibility.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Ballots sent</p><p class="fact-value">{{sent_count}}</p></td><td class="fact" width="50%"><p class="fact-label">Members skipped</p><p class="fact-value">{{skipped_count}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Total checked in</p><p class="fact-value">{{total_checked_in}}</p></td></tr>
        </table>
        <h2>Members who received ballots ({{sent_count}})</h2>
        {{recipients_html}}
        <h2>Members who did not receive ballots ({{skipped_count}})</h2>
        <div class="alert">
            <p>These members were skipped because they did not meet the eligibility
            requirements for any ballot item. The specific reason for each is listed below.</p>
        </div>
        {{skipped_voters_html}}
        <h2>What you can do</h2>
        <ul>
            <li><strong>Voter overrides:</strong> if a skipped member should be allowed to vote, use the Voter Override feature on the election page to grant them an exception.</li>
            <li><strong>Check in members:</strong> if a member was skipped due to attendance, check them in on the Meeting Attendance panel and resend ballots.</li>
            <li><strong>Review tier settings:</strong> if a membership tier is incorrectly marked as ineligible, update it in Organization Settings &gt; Membership Tiers.</li>
        </ul>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "ballot_notification": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
<!--[if mso]></td></tr></table><![endif]-->""",
    "cert_expiration": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{cert_name}} expires in {{days_remaining}} days&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
<!--[if mso]></td></tr></table><![endif]-->""",
    "duplicate_application": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Application Already on File</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{applicant_name}},</p>
        <p>Thank you for your interest in joining {{organization_name}}.</p>
        <p>Our records show that we already have an application on file for
        this email address, originally received on <strong>{{original_date}}</strong>.
        A duplicate application has not been created.</p>
        <p>If you believe this is an error, or if you have questions about the
        status of your application, please contact us directly.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "election_deleted": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Deleted</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been permanently deleted.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Deleted by</p><p class="fact-value">{{performer_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <p>If you have questions, please contact {{performer_name}}.</p>
    </div>
    <div class="callout-critical"><p class="callout-title-critical">This cannot be undone</p><p class="callout-text-critical">All associated ballots and results have been removed.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "election_report": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
<!--[if mso]></td></tr></table><![endif]-->""",
    "election_rollback": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Rolled Back</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been rolled back to a previous stage.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Rolled back by</p><p class="fact-value">{{performer_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <p>Please review the election details and coordinate with your team as needed.</p>
    </div>
    <div class="callout-warning"><p class="callout-title-warning">Some votes no longer count</p><p class="callout-text-warning">Votes recorded after the stage this election returned to are no longer counted.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "event_cancellation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Event Cancelled</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following event has been cancelled.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Original date</p><p class="fact-value">{{event_date}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <p>Please update your calendar accordingly. If you have questions, contact your department leadership.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "event_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
<!--[if mso]></td></tr></table><![endif]-->""",
    "event_request_status": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Event Request Update</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{contact_name}},</p>
        <p>Your event request has been updated to: <strong>{{status_label}}</strong>.</p>
        {{details_html}}
        {{message_html}}
        <p>Thank you for your request.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "inactivity_warning": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{prospect_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Prospective Member Inactivity Alert</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{coordinator_name}}, a prospective member in your pipeline has been inactive and may need attention.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Prospect</p><p class="fact-value">{{prospect_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Current stage</p><p class="fact-value">{{pipeline_stage}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Days inactive</p><p class="fact-value">{{days_inactive}} days</p></td><td class="fact" width="50%"><p class="fact-label">Timeout threshold</p><p class="fact-value">{{timeout_days}} days</p></td></tr>
        </table>
        <p>Please review their progress and take appropriate action.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{prospect_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Prospect</a></td></tr></table>
        <p class="action-link">Or open this link: {{prospect_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "inventory_change": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Inventory Change Confirmation</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{first_name}},</p>
        <p>
            This message is to confirm recent changes to the department property
            assigned to you as of <strong>{{change_date}}</strong>.
        </p>
        {{items_issued_html}}
        {{items_returned_html}}
        {{items_removed_html}}
        <div class="alert">
            <p>All items listed above remain the property of
            <strong>{{organization_name}}</strong>. Members are responsible for the
            care, maintenance, and safekeeping of all department-issued property.
            Any lost, stolen, or damaged items must be reported to the Quartermaster
            immediately.</p>
        </div>
        <p>If you believe there is an error in this notice, please contact the
        Quartermaster or department administration at your earliest convenience.</p>
        <p>Thank you,<br/>{{organization_name}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "it_password_notification": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{user_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>IT Notice: Password Reset Requested</h1>
    </div>
    <div class="{{content_class}}">
        <p>A password reset has been requested for the following user.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">User</p><p class="fact-value">{{user_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Email</p><p class="fact-value">{{user_email}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Requested at</p><p class="fact-value">{{request_time}}</p></td><td class="fact" width="50%"><p class="fact-label">IP address</p><p class="fact-value">{{ip_address}}</p></td></tr>
        </table>
        <p>This is an informational notice. No action is required unless the request appears suspicious.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "member_archived": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Member Archived</h1>
    </div>
    <div class="{{content_class}}">
        <p><strong>{{member_name}}</strong> has been automatically archived.</p>
        <p>All department property has been returned. Previous status: <strong>{{previous_status}}</strong>.</p>
        <p>The member's profile remains accessible for legal requests or future reactivation.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "member_dropped": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}} · ${{total_value}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Due {{return_deadline}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Department Property Return Notice</h1>
        <table class="summary-facts" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="summary-fact" width="50%"><p class="summary-fact-label">Return deadline</p><p class="summary-fact-value" style="color: {{header_accent}};">{{return_deadline}}</p></td><td class="summary-gap">&nbsp;</td><td class="summary-fact" width="50%"><p class="summary-fact-label">Total assessed value</p><p class="summary-fact-value">${{total_value}}</p></td></tr></table>
    </div>
    <div class="{{content_class}}">
        <p>Dear {{member_name}},</p>
        <p>
            This message serves as formal notice that your membership status with
            <strong>{{organization_name}}</strong> has been changed to
            <strong>{{drop_type_display}}</strong> effective <strong>{{effective_date}}</strong>.
        </p>
        <p><strong>Reason:</strong> {{reason}}</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Outstanding items</p><p class="fact-value">{{item_count}} item(s)</p></td></tr>
        </table>
        {{items_list_html}}
        <p>
            In accordance with department policy, all department-issued property must be
            returned in its current condition by the deadline above. Please contact the
            department administration to arrange return of these items.
        </p>
        <p>
            Respectfully,<br/>
            {{performed_by_name}}<br/>
            {{performed_by_title}}<br/>
            {{organization_name}}
        </p>
        <p class="fineprint">A copy of this notice has been placed in your member file.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "password_reset": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Link expires in {{expiry_minutes}} min</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Reset your password</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{first_name}},</p>
        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>. This link expires in <strong>{{expiry_minutes}} minutes</strong>.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{reset_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Reset Password</a></td></tr></table>
        <p class="action-link">Or open this link: {{reset_url}}</p>
    </div>
    <div class="callout-neutral"><p class="callout-title-neutral">Didn't ask for this?</p><p class="callout-text-neutral">You can safely ignore this email. Your password will not be changed.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "post_event_validation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Please Validate Attendance</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following event has ended and needs attendance validation.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{event_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Recorded attendees</p><p class="fact-value">{{attendee_count}}</p></td></tr>
        </table>
        <p>Please review and validate the attendance records at your earliest convenience.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{validation_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Validate Attendance</a></td></tr></table>
        <p class="action-link">Or open this link: {{validation_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "post_shift_validation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Shift Attendance Validation</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, the following shift has ended and needs attendance validation.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Shift</p><p class="fact-value">{{shift_name}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Members on shift</p><p class="fact-value">{{attendee_count}}</p></td></tr>
        </table>
        <p>Please review and confirm the shift attendance.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{validation_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Validate Shift</a></td></tr></table>
        <p class="action-link">Or open this link: {{validation_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "property_return_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}} · ${{total_value}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Due {{return_deadline}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Property Return Reminder</h1>
        <table class="summary-facts" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="summary-fact" width="50%"><p class="summary-fact-label">Return deadline</p><p class="summary-fact-value" style="color: {{header_accent}};">{{return_deadline}}</p></td><td class="summary-gap">&nbsp;</td><td class="summary-fact" width="50%"><p class="summary-fact-label">Total assessed value</p><p class="summary-fact-value">${{total_value}}</p></td></tr></table>
    </div>
    <div class="{{content_class}}">
        <p>Dear {{member_name}},</p>
        <p>This is a reminder that you still have outstanding department property that needs to be returned.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Outstanding items</p><p class="fact-value">{{item_count}} item(s)</p></td><td class="fact" width="50%"><p class="fact-label">Days since separation</p><p class="fact-value">{{days_since_drop}}</p></td></tr>
        </table>
        {{items_list_html}}
        <p>Please contact the department administration to arrange return of these items as soon as possible.</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "series_end_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{series_end_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Recurring Series Ending Soon</h1>
        <p>{{series_end_date}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, this is a reminder that the following recurring event series is scheduled to end in approximately <strong>6 months</strong>.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Series ends</p><p class="fact-value">{{series_end_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Remaining occurrences</p><p class="fact-value">{{remaining_occurrences}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Pattern</p><p class="fact-value">{{recurrence_pattern}}</p></td></tr>
        </table>
        <p>If you would like to extend or modify this series, please update the event before the series end date.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{event_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Event</a></td></tr></table>
        <p class="action-link">Or open this link: {{event_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "shift_assignment": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Please respond</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>New shift assignment</h1>
        <p>{{shift_date}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, you have been assigned to an upcoming shift.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Starts</p><p class="fact-value">{{shift_start}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Position</p><p class="fact-value">{{position}}</p></td></tr>
        </table>
        {{checklist_html}}
        <p>Please confirm or decline this assignment so the shift officer knows
        whether the position is covered.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{shift_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">View Shift</a></td></tr></table>
        <p class="action-link">Or open this link: {{shift_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "shift_decline": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Shift Coverage Needed</h1>
        <p>{{shift_date}}</p>
    </div>
    <div class="{{content_class}}">
        <p><strong>{{member_name}}</strong> {{action}} the following position. It is now open.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Position</p><p class="fact-value">{{position}}</p></td></tr>
        </table>
        <p>Please assign a replacement so the shift is not left short.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{shift_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Open the Schedule</a></td></tr></table>
        <p class="action-link">Or open this link: {{shift_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "shift_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}} at {{shift_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Start-of-Shift Reminder</h1>
        <p>{{shift_date}} at {{shift_start}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, your upcoming shift briefing is below. Please arrive on time and mark
        your arrival when you get to the station.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{shift_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Time</p><p class="fact-value">{{time_range}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Your position</p><p class="fact-value">{{position}}</p></td></tr>
        </table>
        {{apparatus_html}}
        {{roster_html}}
        {{checklist_html}}
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{arrival_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Mark Arrival</a></td></tr></table>
        <p class="action-link">Or open this link: {{arrival_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_new_order_admin": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Order {{order_number}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>New Store Order</h1>
        <p>{{order_total}}</p>
    </div>
    <div class="{{content_class}}">
        <p><strong>{{customer_name}}</strong> placed order
           <strong>{{order_number}}</strong>.</p>
        {{items_table_html}}
        {{member_notes_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_order_cancelled": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Order Cancelled</h1>
        <p>{{order_number}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Your order <strong>{{order_number}}</strong> has been cancelled.</p>
        {{cancellation_reason_html}}
        {{refund_notice_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_order_confirmation": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Total {{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Order {{order_number}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Order {{order_number}} received</h1>
        <p>Total {{order_total}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hi {{first_name}},</p>
        <p>Thanks for your order from the {{store_name}}. Your order number is
           <strong>{{order_number}}</strong>.</p>
        {{items_table_html}}
        {{payment_block_html}}
        {{receipt_footer_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_order_update": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Order Update</h1>
        <p>{{order_number}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Update on your order <strong>{{order_number}}</strong>{{status_label_suffix}}.</p>
        <p style="white-space:pre-line;">{{update_message}}</p>
        {{payment_block_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_payment_received": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Payment Received</h1>
        <p>{{order_number}}</p>
    </div>
    <div class="{{content_class}}">
        {{payment_summary_html}}
        {{balance_notice_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_payment_reminder": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{balance_due}} outstanding&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Order {{order_number}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Payment Reminder</h1>
        <p>{{balance_due}} outstanding</p>
    </div>
    <div class="{{content_class}}">
        <p>Your order <strong>{{order_number}}</strong> still has a balance of
           <strong>{{balance_due}}</strong>.</p>
        {{items_table_html}}
        {{payment_block_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_vendor_order_placed": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Order Placed</h1>
        <p>{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Your order has been placed with the vendor.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_window_closed": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Order Window Closed</h1>
        <p>{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Ordering has closed and the department is placing the order.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_window_closing": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Order Window Closing</h1>
        <p>{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Last call — the store order window closes soon.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "storefront_window_open": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{store_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Ordering Is Open</h1>
        <p>{{window_name}}</p>
    </div>
    <div class="{{content_class}}">
        <p>The department store is now taking orders.</p>
        <p><strong>{{window_name}}</strong> — {{store_name}}</p>
        {{window_description_html}}
        {{window_extra_html}}
        {{pickup_instructions_html}}
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "suggestion_submitted": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>New Suggestion Box Submission</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}},</p>
        <p>A new submission was received in the <strong>{{box_name}}</strong>
        suggestion box, which you review.</p>
        <p>Open it in the Logbook to read it and set its status.</p>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{suggestion_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Review Submission</a></td></tr></table>
        <p class="action-link">Or open this link: {{suggestion_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "training_approval": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Due {{approval_deadline}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Due {{approval_deadline}}</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Training Approval Needed</h1>
        <p>Due {{approval_deadline}}</p>
    </div>
    <div class="{{content_class}}">
        <p>Hello, a training event has been submitted and requires your approval.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Approval deadline</p><p class="fact-value">{{approval_deadline}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Course</p><p class="fact-value">{{course_name}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Event</p><p class="fact-value">{{event_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Date</p><p class="fact-value">{{event_date}}</p></td><td class="fact" width="50%"><p class="fact-label">Attendees</p><p class="fact-value">{{attendee_count}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Submitted by</p><p class="fact-value">{{submitter_name}}</p></td></tr>
        </table>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{approval_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Review &amp; Approve</a></td></tr></table>
        <p class="action-link">Or open this link: {{approval_url}}</p>
    </div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    "welcome": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{username}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Welcome aboard</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Your account is ready</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{first_name}},</p>
        <p>Your account has been created for <strong>{{organization_name}}</strong>. You can now log in and access the system.</p>
        <table class="facts-panel" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact-boxed" colspan="2"><p class="fact-label">Username</p><p class="fact-mono">{{username}}</p></td></tr>
            <tr><td class="fact-boxed" colspan="2"><p class="fact-label">Temporary password</p><p class="fact-mono">{{temp_password}}</p></td></tr>
        </table>
        <table class="cta" role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cta-cell" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><a href="{{login_url}}" class="cta-link" style="border: 1px solid {{header_accent}};">Log In Now</a></td></tr></table>
        <p class="action-link">Or open this link: {{login_url}}</p>
    </div>
    <div class="callout-warning"><p class="callout-title-warning">Change your password</p><p class="callout-text-warning">For security, please set a new password after your first login.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
}
