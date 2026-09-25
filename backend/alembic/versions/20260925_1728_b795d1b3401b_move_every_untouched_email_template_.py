"""Move every untouched email template onto the current defaults.

Revision ID: b795d1b3401b
Revises: 53ce8e3e29a5
Create Date: 2026-09-25 17:28:00

A department's templates are written to ``email_templates`` the first time
an admin opens the Email Templates screen (``ensure_default_templates``),
stamped with whatever the defaults were that day, and never rewritten after.
``f0d76814a9ab`` carried the centred-masthead redesign to rows still holding
the body shipped *immediately* before it, which left every department that
first opened the screen earlier than that on an older design: the defaults
changed dozens of times between February and September, and a row holding
any of those versions matched nothing. Those rows also read "Edited" on the
Templates screen although nobody touched them, and 107 of the older bodies
still carry "Please do not reply to this email." inline.

**What this rewrites.** Each of ``html_body``, ``text_body`` and ``subject``
is compared, on its own, against every version of that field this codebase
has shipped for the row's ``template_type``: all 71 importable commits that
touched the template definitions, plus the two February migrations that
wrote rows directly. A field identical to one of those is set to the current
default. A field that matches nothing — somebody edited it — is left exactly
as it is, so a department that reworded a subject still has its subject and
gets the new design underneath it.

* The body is only converted when ``css_styles`` is NULL. A department that
  styled its own mail wrote that stylesheet against the old markup's class
  names; swapping the markup under it could quietly undo their work.
* A converted body takes ``footer_key`` from the type's default when the row
  has none. Bodies from before ``20260810_0004`` wrote their footer inline;
  the current body draws it from the footer library, and without this a
  notice to the public (event requests, applicants) would close with the
  members' footer.
* The colourway columns are not written. A row that predates them has them
  NULL, which renders the type's own colours — the same as a fresh default —
  and a row an admin recoloured keeps its colours.

**Why hashes.** The earlier versions are needed only to be recognised, so
they are held as SHA-256 digests of their UTF-8 text rather than 316 copies
of old markup. The current defaults are frozen in full below: a migration
must write what it wrote the day it ran, not whatever the service ships in a
later release.

**Downgrade** does not restore the old versions. What it replaced was a
verbatim copy of a shipped default, not anything a department wrote, and
which of the dozens of versions each row held is not recorded; the code at
the revision below renders the current defaults exactly as it does here. So
downgrade leaves the rows as they are — the only thing it could otherwise
do is guess.
"""

import hashlib
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b795d1b3401b"
down_revision: Union[str, Sequence[str], None] = "53ce8e3e29a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _templates_table() -> sa.Table:
    return sa.table(
        "email_templates",
        sa.column("id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("subject", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("text_body", sa.Text),
        sa.column("css_styles", sa.Text),
        sa.column("footer_key", sa.String),
    )


def _digest(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _is_earlier_default(history: dict, template_type: str, value) -> bool:
    return _digest(value) in history.get(template_type, frozenset())


def changes_for(row) -> dict:
    """The columns to rewrite for one ``email_templates`` row, if any."""
    template_type = str(row.template_type or "").lower()
    current = CURRENT.get(template_type)
    if current is None:
        return {}

    changes = {}
    if row.css_styles is None and _is_earlier_default(
        HTML_HISTORY, template_type, row.html_body
    ):
        changes["html_body"] = current["html"]
        if row.footer_key is None and current["footer"] is not None:
            changes["footer_key"] = current["footer"]
    if _is_earlier_default(TEXT_HISTORY, template_type, row.text_body):
        changes["text_body"] = current["text"]
    if _is_earlier_default(SUBJECT_HISTORY, template_type, row.subject):
        changes["subject"] = current["subject"]
    return changes


def upgrade() -> None:
    connection = op.get_bind()
    table = _templates_table()
    rows = connection.execute(
        sa.select(
            table.c.id,
            table.c.template_type,
            table.c.subject,
            table.c.html_body,
            table.c.text_body,
            table.c.css_styles,
            table.c.footer_key,
        )
    ).all()
    for row in rows:
        changes = changes_for(row)
        if changes:
            connection.execute(
                table.update().where(table.c.id == row.id).values(**changes)
            )


def downgrade() -> None:
    """Leave the rows as they are; see the module docstring.

    Every value this revision wrote is the current shipped default, which the
    code at the revision below renders unchanged, and the earlier version
    each row held is not recorded — only its digest was ever compared.
    """


# Frozen: the shipped defaults as of this revision, per template type.
CURRENT = {
    "application_withdrawn": {
        "subject": """Your application has been withdrawn — {{organization_name}}""",
        "html": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
        "text": """Application Withdrawn

Hello {{applicant_name}},

This confirms that you withdrew your application to join
{{organization_name}} on {{withdrawal_date}}. Our membership coordinators
have been told, and your application is now closed.

Thank you for your interest in the department. If you withdrew by mistake,
or would like to apply again in the future, please contact us directly.

{{footer_text}}""",
        "footer": """public""",
    },
    "ballot_eligibility_summary": {
        "subject": """Ballot Eligibility Summary: {{election_title}} — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Ballot Eligibility Summary — {{election_title}}

Hello {{recipient_name}},

Ballot emails for "{{election_title}}" have been sent. Below is a summary of member eligibility.

Ballots Sent: {{sent_count}}
Members Skipped: {{skipped_count}}
Total Checked In: {{total_checked_in}}

MEMBERS WHO RECEIVED BALLOTS ({{sent_count}})
{{recipients_text}}

MEMBERS WHO DID NOT RECEIVE BALLOTS ({{skipped_count}})
{{skipped_voters_text}}

WHAT YOU CAN DO
- Voter Overrides: If a skipped member should be allowed to vote, use the Voter Override feature on the election page.
- Check-In Members: If a member was skipped due to attendance, check them in and resend ballots.
- Review Tier Settings: If a membership tier is incorrectly marked as ineligible, update it in Organization Settings > Membership Tiers.

{{footer_text}}""",
        "footer": """official""",
    },
    "ballot_notification": {
        "subject": """Ballot Available: {{election_title}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Ballot Available: {{election_title}}

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

{{footer_text}}""",
        "footer": None,
    },
    "cert_expiration": {
        "subject": """Certification Expiring: {{cert_name}} — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{expiration_date}} · {{days_remaining}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Certification Expiration Notice

Hello {{recipient_name}},

This is a reminder that your certification is approaching its expiration date:

Certification: {{cert_name}}
Expiration Date: {{expiration_date}}
Days Remaining: {{days_remaining}}

Please take action to renew this certification before it expires.

View your certifications: {{renewal_url}}

{{footer_text}}""",
        "footer": None,
    },
    "duplicate_application": {
        "subject": """Application Already on File — {{organization_name}}""",
        "html": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
        "text": """Application Already on File

Hello {{applicant_name}},

Thank you for your interest in joining {{organization_name}}.

Our records show that we already have an application on file for this
email address, originally received on {{original_date}}. A duplicate
application has not been created.

If you believe this is an error, or if you have questions about the
status of your application, please contact us directly.

{{footer_text}}""",
        "footer": """public""",
    },
    "election_deleted": {
        "subject": """CRITICAL: Election Deleted — {{election_title}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Election Deleted

Hello {{recipient_name}},

An election has been permanently deleted:

Election: {{election_title}}
Deleted by: {{performer_name}}
Reason: {{reason}}

All associated ballots and results have been removed.

{{footer_text}}""",
        "footer": """official""",
    },
    "election_report": {
        "subject": """Election Report: {{election_title}} — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Election Report — {{election_title}}

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

{{footer_text}}""",
        "footer": """official""",
    },
    "election_rollback": {
        "subject": """ALERT: Election Rolled Back — {{election_title}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Election Rolled Back

Hello {{recipient_name}},

An election has been rolled back to a previous stage:

Election: {{election_title}}
Rolled back by: {{performer_name}}
Reason: {{reason}}

Please review the election details and coordinate with your team as needed.

{{footer_text}}""",
        "footer": None,
    },
    "event_cancellation": {
        "subject": """Event Cancelled: {{event_title}} — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Event Cancelled

Hello {{recipient_name}},

The following event has been cancelled:

Event: {{event_title}}
Original Date: {{event_date}}
Reason: {{reason}}

Please update your calendar accordingly.

{{footer_text}}""",
        "footer": None,
    },
    "event_reminder": {
        "subject": """Reminder: {{event_title}} — {{event_start}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Event Reminder

Hello {{recipient_name}},

This is a reminder about an upcoming event:

Event: {{event_title}}
Type: {{event_type}}
Start: {{event_start}}
End: {{event_end}}
Location: {{location_name}}
{{location_details}}

View event: {{event_url}}

{{footer_text}}""",
        "footer": None,
    },
    "event_request_status": {
        "subject": """Event Request Update — {{status_label}}""",
        "html": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
        "text": """Event Request Update

Hello {{contact_name}},

Your event request has been updated to: {{status_label}}.

{{details_text}}
{{message}}

Thank you for your request.

{{footer_text}}""",
        "footer": """public""",
    },
    "inactivity_warning": {
        "subject": """Inactivity Alert: {{prospect_name}} — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{prospect_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Prospective Member Inactivity Alert

Hello {{coordinator_name}},

A prospective member in your pipeline has been inactive and may need attention:

Prospect: {{prospect_name}}
Current Stage: {{pipeline_stage}}
Days Inactive: {{days_inactive}} days
Timeout Threshold: {{timeout_days}} days

Please review their progress and take appropriate action.

View prospect: {{prospect_url}}

{{footer_text}}""",
        "footer": None,
    },
    "inventory_change": {
        "subject": """Inventory Update — {{organization_name}}""",
        "html": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
        "text": """Inventory Change Confirmation — {{organization_name}}

Hello {{first_name}},

This message is to confirm recent changes to the department property
assigned to you as of {{change_date}}.

{{items_issued_text}}

{{items_returned_text}}

{{items_removed_text}}

IMPORTANT REMINDER: All items listed above remain the property of
{{organization_name}}. Members are responsible for the care, maintenance,
and safekeeping of all department-issued property. Any lost, stolen, or
damaged items must be reported to the Quartermaster immediately.

If you believe there is an error in this notice, please contact the
Quartermaster or department administration at your earliest convenience.

Thank you,
{{organization_name}}

{{footer_text}}""",
        "footer": None,
    },
    "it_password_notification": {
        "subject": """[IT Notice] Password Reset Requested — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{user_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """IT Notice: Password Reset Requested

A password reset has been requested for the following user:

User: {{user_name}}
Email: {{user_email}}
Requested at: {{request_time}}
IP Address: {{ip_address}}

This is an informational notice. No action is required unless the request appears suspicious.

{{footer_text}}""",
        "footer": None,
    },
    "member_archived": {
        "subject": """Member Archived: {{member_name}} — {{organization_name}}""",
        "html": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
        "text": """Member Archived: {{member_name}}

All department property has been returned. Previous status: {{previous_status}}.

The member's profile remains accessible for legal requests or future reactivation.

{{footer_text}}""",
        "footer": None,
    },
    "member_dropped": {
        "subject": """Notice of Department Property Return — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Department Property Return Notice

Dear {{member_name}},

Your membership status with {{organization_name}} has been changed to {{drop_type_display}} effective {{effective_date}}.

Reason: {{reason}}

Outstanding Items: {{item_count}} item(s)
Total Assessed Value: ${{total_value}}
Return Deadline: {{return_deadline}}

{{items_list_text}}

In accordance with department policy, all department-issued property must be returned in its current condition by the deadline above.

Please contact the department administration to arrange return of these items.

Respectfully,
{{performed_by_name}}
{{performed_by_title}}
{{organization_name}}

A copy of this notice has been placed in your member file.

{{footer_text}}""",
        "footer": """official""",
    },
    "password_reset": {
        "subject": """Password Reset — {{organization_name}}""",
        "html": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
        "text": """Password Reset Request

Hello {{first_name}},

We received a request to reset your password for {{organization_name}}.

Click the link below to set a new password. This link will expire in {{expiry_minutes}} minutes.

Reset your password: {{reset_url}}

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

{{footer_text}}""",
        "footer": None,
    },
    "post_event_validation": {
        "subject": """Attendance Validation Needed: {{event_title}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Please Validate Attendance

Hello {{recipient_name}},

The following event has ended and needs attendance validation:

Event: {{event_title}}
Date: {{event_date}}
Recorded Attendees: {{attendee_count}}

Please review and validate the attendance records.

Validate attendance: {{validation_url}}

{{footer_text}}""",
        "footer": None,
    },
    "post_shift_validation": {
        "subject": """Shift Validation Needed: {{shift_name}} — {{shift_date}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Shift Attendance Validation

Hello {{recipient_name}},

The following shift has ended and needs attendance validation:

Shift: {{shift_name}}
Date: {{shift_date}}
Members on Shift: {{attendee_count}}

Please review and confirm the shift attendance.

Validate shift: {{validation_url}}

{{footer_text}}""",
        "footer": None,
    },
    "property_return_reminder": {
        "subject": """Property Return Reminder — {{organization_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}} · {{days_since_drop}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Property Return Reminder

Dear {{member_name}},

This is a reminder that you still have outstanding department property that needs to be returned.

Outstanding Items: {{item_count}} item(s)
Total Assessed Value: ${{total_value}}
Days Since Separation: {{days_since_drop}}
Return Deadline: {{return_deadline}}

{{items_list_text}}

Please contact the department administration to arrange return of these items.

{{footer_text}}""",
        "footer": """official""",
    },
    "series_end_reminder": {
        "subject": """Recurring Series Ending Soon: {{event_title}} — Ends {{series_end_date}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{series_end_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Recurring Series Ending Soon

Hello {{recipient_name}},

This is a reminder that the following recurring event series is scheduled to end in approximately 6 months:

Event: {{event_title}}
Pattern: {{recurrence_pattern}}
Series Ends: {{series_end_date}}
Remaining Occurrences: {{remaining_occurrences}}

If you would like to extend or modify this series, please update the event before the series end date.

View event: {{event_url}}

{{footer_text}}""",
        "footer": None,
    },
    "shift_assignment": {
        "subject": """Shift Assignment: {{position}} on {{shift_date}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """New Shift Assignment

Hello {{recipient_name}},

You have been assigned to an upcoming shift:

Position: {{position}}
Date: {{shift_date}}
Starts: {{shift_start}}

{{checklist_text}}

Please confirm or decline this assignment so the shift officer knows whether
the position is covered.

View shift: {{shift_url}}

{{footer_text}}""",
        "footer": None,
    },
    "shift_decline": {
        "subject": """Shift Coverage Needed: {{position}} on {{shift_date}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Shift Coverage Needed

{{member_name}} {{action}} the following position. It is now open:

Position: {{position}}
Date: {{shift_date}}

Please assign a replacement so the shift is not left short.

Open the schedule: {{shift_url}}

{{footer_text}}""",
        "footer": None,
    },
    "shift_reminder": {
        "subject": """Shift Reminder — {{shift_date}} at {{shift_start}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}} at {{shift_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Start-of-Shift Reminder

Hello {{recipient_name}},

Your upcoming shift briefing is below. Please arrive on time and mark your
arrival when you get to the station.

Date: {{shift_date}}
Time: {{time_range}}
Your position: {{position}}
{{apparatus_text}}
{{roster_text}}
{{checklist_text}}

Mark arrival: {{arrival_url}}

{{footer_text}}""",
        "footer": None,
    },
    "storefront_new_order_admin": {
        "subject": """New store order {{order_number}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """{{customer_name}} placed order {{order_number}} for {{order_total}}.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_order_cancelled": {
        "subject": """Order {{order_number}} cancelled""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Order {{order_number}} was cancelled.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_order_confirmation": {
        "subject": """Order {{order_number}} received""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Total {{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Hi {{first_name}},

Thanks for your order from the {{store_name}}.
Order {{order_number}} received. Total {{order_total}}.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_order_update": {
        "subject": """Order {{order_number}}{{status_subject_suffix}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Order {{order_number}}: {{update_message}}

{{footer_text}}""",
        "footer": None,
    },
    "storefront_payment_received": {
        "subject": """Payment received — order {{order_number}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Payment received for order {{order_number}}.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_payment_reminder": {
        "subject": """Payment reminder — order {{order_number}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{balance_due}} outstanding&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Order {{order_number}} has a balance of {{balance_due}}.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_vendor_order_placed": {
        "subject": """Order placed with the vendor — {{window_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """The {{window_name}} order has been placed with the vendor.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_window_closed": {
        "subject": """Ordering closed — {{window_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """The {{window_name}} order window has closed.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_window_closing": {
        "subject": """Last call — {{window_name}} closes soon""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """The {{window_name}} order window closes soon.

{{footer_text}}""",
        "footer": None,
    },
    "storefront_window_open": {
        "subject": """Store orders are open — {{window_name}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Store orders are open for {{window_name}}.

{{footer_text}}""",
        "footer": None,
    },
    "training_approval": {
        "subject": """Training Approval Needed: {{course_name}} — {{event_date}}""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Due {{approval_deadline}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Training Approval Needed

A training event has been submitted and requires your approval:

Course: {{course_name}}
Event: {{event_title}}
Date: {{event_date}}
Attendees: {{attendee_count}}
Submitted by: {{submitter_name}}
Approval Deadline: {{approval_deadline}}

Review and approve: {{approval_url}}

{{footer_text}}""",
        "footer": None,
    },
    "welcome": {
        "subject": """Welcome to {{organization_name}} — Your Account is Ready""",
        "html": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{username}} · {{temp_password}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
        "text": """Welcome to {{organization_name}}

Hello {{first_name}},

Your account has been created for {{organization_name}}. You can now log in and access the system.

Username: {{username}}
Temporary Password: {{temp_password}}

For security, please change your password after your first login.

Log in at: {{login_url}}

{{footer_text}}""",
        "footer": None,
    },
}

# SHA-256 of every earlier shipped html for each type (UTF-8).
HTML_HISTORY = {
    "application_withdrawn": frozenset(
        {
            "60d9503bddcc8ec1cbce9a3be211a536e799d265ca2e2616c057cd9571ddb0fb",
            "7d3206c2566034cd23efc554b589132fc4100f8ed159107c9814003fa40a5247",
        }
    ),
    "ballot_eligibility_summary": frozenset(
        {
            "0b9bac49a423e06d548eb756f0ab1735087e8dd0a7b8de3d675d2515fb8d9e5d",
            "377e1b6a416541dbc824d29f30b8c1a436336829765bb58e530a23d247ff177e",
            "38fd29df5f27544b9869236df841cbc856a8656469dddfc87267e5df0a2a25bd",
            "4a5020964cb31adbecf8f111e6f04df13151967d7beeacd869a71e1b0f1896fa",
            "8bb566915d0ade222906b802e562678fa733b17d3b34fec9d9fe5aae08ea1787",
            "9b94c974bd58c1b41a61216ade9c7dc6c2dbde1546cc54fb69c88b45d38f8de9",
            "ab30a291d889ddcea7b546d31e34b081a160cf11b104029f37fd4bc4e7361199",
            "b6011a786c68561c73869004018e3b9a5984ee6986a10a5aefb2e5dcb6338686",
        }
    ),
    "ballot_notification": frozenset(
        {
            "6170fc709511d59e1e15454593dd077e7fbfe6b099446c8d896a650f4ea81e54",
            "676af460b05f243dd53f24e335bbcb2199285faf33831b3c9299bab548a7e75b",
            "69749559ba8cee77a804a4a302e671669b8f9ab221a9a5add87b8871f58718f8",
            "78dc5015c9fb8085980082c54aa0be412b00f992ccd26ceb41043289a1d4f810",
            "81d2fdf2f28358e3ee48c0032f60ab9343c8e7627597d1cf14ee804c0cde9cb1",
            "8e88ef8cc0bd30f2bb354a03ef2cee75c7cd83e633bdc5a80e8d4bb6ee6750e4",
            "ae19676a99c9107be53a4c69c4f849648644b0c289b65cebca7daac9f440ac9f",
            "dcfdc78d26b833971021c3520186c642240df70bb7219a6b26398a153ea74440",
            "e1ef42f3e6a97c7cd292f47134c9ffe2304a0cd2aeb5c15ff12ee76e8fef701c",
            "edd982f7799384a1929f27e9d7ad868028a875b5b7d11f55f393e61b89c42f12",
            "f0942a3ad12b7995fa5de94c203b5616a4f9508e18bea03e5fc0936d62b6a8ca",
            "f5e6061c1506e47edc77eee26ae20df62f93a73f73c4d54d43c353838b007693",
        }
    ),
    "cert_expiration": frozenset(
        {
            "0c6a54ab9b47728246cf3dff0b5ab43bab8868615719d69872b416b1f0859088",
            "1929c11a586de898739f60d12ce4787eb91fa017bd7928dd62aa8cf30665c731",
            "1e63261cdbbcfa37aad3ff39cfa6a784205ddfe8b70715221e0034be0c0b2edf",
            "23699fe421694990949c5aa34702bf7e24fc4bcb4778a3184939d39c3eeb502c",
            "4093a9eeb2e574a0737630701a653bbb399f41e06da9a16e1bc1a19debc8207d",
            "42b6ce77c16c0c2d8cf4233b1d2804315c8e5346a8738da4a7fbf9708f826544",
            "bb5552a2bd2eac350238dfdc2b5a0c0509f89a5f2407926f9ac2c88b12eeb218",
            "c644263eea1226b77eb7059b449fcfb60609a792ce032f69b4f3e7ab5588bd4c",
            "c7b7b5f151740e7c00b48df4f9e97a60290a1986d758241cfcd72cbb334ee419",
            "f3ba88f435d0ec316e889a4ab22098ba65f6816caa6b18be534a15140223e681",
        }
    ),
    "duplicate_application": frozenset(
        {
            "0a5417c2a8aab60d181dd69640b477e6bec1da58e6d10608b6cae5a72658bef4",
            "1404ed258080962c370dfda34cb4023403ac40b1ef6a397102537200c1d065ca",
            "2e7b6ead7c56dc3b52409b4b6a2f0858cdad5a06383b146aa9631bbd1eb912bf",
            "33c3bbfb9a7f185aa1c4d7d63c8f1bebbec8edb517ff9b6ce92f976448408aea",
            "71d84d3ad4ba435233b4c90e793e7f533cedaf160142507c5aa33b4026ade364",
            "8ea652ca4d6874d934b5a3c8e202b0fa6b6e0e28aae811a17e8daaec31b64797",
            "9872efe2cf8dbe62f0e6ee5c86087efb2ae4be171a1d9e5c2df0eaaa7a5282b4",
            "aece40d6d9f99eafd61e58243e7309edeb81707202747ef8a694a157b5179b9e",
            "b4f1da2b4d87ce12549d560e9024fd51d476a5063978a9dfff27ff22c292aaab",
            "c39ec269ac3576350bad47bee0b9969387205d7098e8156be29b8ed969c16d91",
        }
    ),
    "election_deleted": frozenset(
        {
            "435bbc8798953527bd37ad47d2e56c876b61bea1df57f178bc194e83f8d7217c",
            "52310ce06eea971d2c648f3db19ee7c6e763185c67bfff489be4e7f769952854",
            "6395f90928bee3db7ebd1aa303763585da96f12097664da3c9c1faa83376f21b",
            "68685dd7daf167d411f3124ddb43816d8fdd3e19033f3eab4973fc90d2ba07f5",
            "6d5a91926cfd63ef015cc31afe6e66488e7597ce6811257ae6975cc86ce5d937",
            "7c657864aa9d995a3574aa64ebcee29724ad8f1d1502985338042a29b024e8da",
            "c4d99f2ef9dedb8157035685c42f15c246a477975a2007155893fbf8b0a76d53",
            "cf595fbaeb418bce0d81309913a475556969f4e9f9f4697f85d67d2b5196dbc4",
            "d79fb5bcb9e675c5b4ee57f272b7fa8872558f374e838044a393abf5f7812cff",
            "fee0e973b0efc39e830201e931950c43768ab76a441fc43cb053666a1afbf094",
        }
    ),
    "election_report": frozenset(
        {
            "291af660e001bf892d4e4dfd255e6b22430ae70495efc5944db845cf72a221de",
            "330828c919341bc8bb5594df040109def3d0826489b7f43b4de1c11ae9c23bd7",
            "4e27065daa4ab4061ed1a5e557d929205d9ad922bc272104a6b58e387314fcf0",
            "66305e6f12de7cb1afcf16676dfb4266019f7b2973fd3d3c0e6bc9a9d310eb39",
            "6c19c7d70c7ee4d87a3533a4b1642df532c8d55a9154a38f1393d9bf3d15a401",
            "922e3cec3dedb2a2f6c5d3539a8760eba96c6da7829b226f27ecfd680ae7cc83",
            "9595f477e99c2da8edd4128ef7ae19db8b238294344f464b52a65bc3ff67ad5b",
            "d2c49923a788c25f7b48007ca31e189d20a9fd45beb42b58d41c78c7b6ce46d9",
        }
    ),
    "election_rollback": frozenset(
        {
            "29a55b6bcc2617a569769649f5e37b52882797433a40023a0d3024d537207273",
            "35b304002d10653510c9b45d0ff764b02a0e29539d0dbaf259b45e55865f9c7b",
            "365793b181157511db5ab32047cac3917a7d2addb7bd6376e8964b34a5c10c42",
            "3b00678106f17052188af33c08e3e465c11e1de141a9ee48cb323f8312e2e4c1",
            "4dca1fea4fe64623eb728afc503b870a5cf41639e8affc9590e1d72c3ac34dd1",
            "56656f3d01c63ef40c263ba0655256de4c19849334feabf61e797f302fb4d669",
            "7e8b08969cb40a4eabdf47ea5f32c3397f8d4c0acf4866720a890ef1d166401b",
            "a6b9dd527865d64ada906203a1dbd321b0cb1dd4136fde5cd4b5c58d62c17466",
            "c28cd8a4114b5e56e3015ef68024b232b4de995ea6b9674cf965275826e02d76",
            "f846e2651bbd0a7d30a308e50168875e358e0be593e7e60999d75adee53f95d9",
        }
    ),
    "event_cancellation": frozenset(
        {
            "0e0c1aeb821aaed68171c7d4b8ee98062838f3a273dee1b18065f4ef63de0f6b",
            "13650ff38ab71613cbd998e5172067327b42720a63371fff002d117676f54ac7",
            "22af213312cb2c00a1233fe1344589041970c94b5469dd75f50ab1a36718e82f",
            "3d3729e42cafb0d489f8e32353bc32c8bcf2debfd0411519558efeebb536d649",
            "4d797aaca8c1a24478ff8d1e90a83d76e9195c95955d2a6e2ef6b40bfaebfa5d",
            "4e67d6f29eb322a592a8859ab03d284a55681be2818fd195b720c79a498d0e89",
            "906fc3bb93faffd1ae5b174b6c1df8ca873fa755e7fa63f43c30393d806e40dd",
            "a23b85231fbf3582fc4f74809fdbef047bf2fc965ca8798248a80376160bee4c",
            "b4376a06eae19e36e757bb3b9c4515958593faad462f3fc770fbd62689899346",
        }
    ),
    "event_reminder": frozenset(
        {
            "13468f278ab9fd6ca5f3f271d5de10f0f17f850769b5a0f6eb2b338406a40d5a",
            "21a4452b091b3981181fceb50b4eff7629155c3090fa1909bd72adf772bed600",
            "32ff282a4ad7c33368d1ad96675e9000a6c0948a49e969a3a07eaf6077d7cb03",
            "543204580ed2fb7eeb2ed651a8b0e0523058ef792d814bad99fb5cff250c3469",
            "8003547dde37427b4c5d42051f37c7edf3377f66820254f6a9cbdb507b98f683",
            "821278238d0bc041ee866654d9eb7b0bbc614bd2b4e34015604c7a9319cbcf46",
            "85b2d6aa8dc35477c22c4d61328c76318861437ff3cf2bd3c1255a2a2498e8d9",
            "87e8dedf990eb8e2f180362ff82fd35a5a3fbcf8857c1c7c0c35e57dffd192a5",
            "a30d2cfb4c4aaac0c9364aad966c99943c88cb34e53bf869e2ad535a26ece613",
            "a5d85266241390b79d2b9dae030e196c1a4590bec0c798c04542193ecbc80942",
            "f38e36d0f0c9f3814184567146fbde640d6c24e36f8ccba131a879310cc2dbae",
        }
    ),
    "event_request_status": frozenset(
        {
            "15c095c1d67022b82ed31e9ee1cf67dcaaa388bfe2a8bc239e395a049ee593a2",
            "2c55f5251d1188c2ea1b57aefe66bf4b44e836ae0a22b23b81eb16944411c47f",
            "2ca57185e1b33074f5fd6e9277e2789568bed327919a4b20d9c15c482463960f",
            "34f529c4f93d395faacfbf568793e9b9a360ee364ce25d29d103c28bf3d09757",
            "35367c9b757d579eaa819040dfd9fab1bd132d55e76928ea787565ae2627e3dc",
            "532c61e00321634b6d7e7ea0c0db5f6502a4600a53ee7ac95fb4343c7d62d81c",
            "7aa368a7bf55ba6222102375c3fe957a86ea91632c0f4ed5490a91638d1cd71e",
            "90b0dd927fbec7f67c48f42e5847675d744d521e6d057d4fee735f643578ed68",
            "bb17460419ba9c23e5f92f9b28cc0beed0dd090c6f207f823bb4d7253ade889f",
            "cd0adc481ab0bfd5526a39a1e9a3bd68198394a46e60babee2e88b8ad9d9cd19",
            "ecf2f6c81d5d01d33a2a452fbc1e5b8916fae0b7384a8ec6d8c683217869169e",
        }
    ),
    "inactivity_warning": frozenset(
        {
            "05c68f33d0e687ebca80ca125b9efe7e07f97a1cbad2ca3c928080345bb7db1d",
            "0bf5a6e663b324fab6373ab05bbd32eb21c9258907fddf1e450a4791ed9adf37",
            "13cf9dafa7bf83c94968972d341ec93190038de53167f7098d283d87fa3ee1d9",
            "19260459392eb8f013fcdbca62eaaf8b29c2aaa42fcbf31c6834bcd83f0eac41",
            "4e0b9b057d6a9588a8fc3b249154c3e1cbebe8c14831c395ffe8368a16422cfb",
            "7fbb961cc70cd914e549b561f07e9f7d7a944dc6f4032f5d97da9d0c40ddd530",
            "8e967d63a5ad6344e327efa5573cb2705e04320e21a5aa9e2b94fa7d166ffe55",
            "c15da1862e998583c95dcbb165559c57b9ecf0fc503941939be9aca685e18312",
            "d7bc48095e83f74141bed8f4c9d16e56ed7901c0dbf9180b3c446cb1697afc52",
            "de4b2a2655a5eb5448863342a30639f31a204fbcc58b61a2b06bf780ec4afc73",
            "e5b7edf4a87716b3a09b980a754ff963863f667950a9fa08f2a603cd5658d701",
        }
    ),
    "inventory_change": frozenset(
        {
            "1879b6564f56589fc10a8a8022e9cdf6c6e91c16787a43a359d3d0a74d5ddb35",
            "4ca8a4c593a355fce54b16bae301b3e19880a7e7d16a7cc3ec71a3c5605a5cf7",
            "65b2a78ba50301bf8d1e4cd13ac72cddc8ce4f00186276d0059d390d437ca4ba",
            "686da1efe78be77abbdeb31b54569da10dd7c4a9fc28646be95b3c895aff8a04",
            "871b247ad21d246281d3bf134502f4080610f87e64a043b77938f9f9ea78bdd6",
            "9548477a1d9092ed1a0950a1a8368d8f2db27c2c4e7490f85d3148cdf70a1fdf",
            "afc026044f3221d308568d3e65357eb33e543b315982125707414e14b1848648",
            "c9a08bff04e98bd577eaec8dfde1922f8da1fd27aa533b562617b74c6816854b",
            "e265d367b6b2c299a537bed8379d162b2075e62424958284a4b15585759f03a9",
            "e6dd3215bb52dd35fe040a0587807a0a5368f1baa8646f7a089a73d99a9d0775",
            "f5a2f7f6920127cc3d7f84e9518d62febd61a4e7bbf1e655898166cd340e02d7",
        }
    ),
    "it_password_notification": frozenset(
        {
            "1325e0058d550cf8440ff60ce136e60a19769fb6ff99b89a989bec155ef70f80",
            "1fc26969eed7018269b8d743ad950698af3ef6c8d058c37bc0b6c190cdad2c67",
            "97249439910d0099b93fcb600e07e1104dd8d07d6c5638d638d6e7df41d1aaf9",
            "98ffb9539d4591a8a10017b583bfc6dad622981ecbc0b75186d051a63a7cb0c2",
            "9b509d0afbff7a18c39ca1d6f8ca4ab0618e200413721bc401a007662ab50901",
            "9d7cbddedbc7ff2277ab57162a1c8677000fede4178c2f170b4d66bbaa4c05d1",
            "a61a5986c2ef9f8006cc9ecd44a6b8e334e99af6b4d9a88b1cbab9d27b89a986",
            "bf2e99970a97ea7ae66110d0e5a17c8e2c3ef8d4b46ab9165af1fc45f6f9048d",
            "d16386ab563908731fcf668a4a0d05898647157437ee344239d0648531cf5628",
            "d167b01997bb3d8e7fcb6d8ce7d56c7bed2822ed7852076ba77f7c6f54b53b24",
        }
    ),
    "member_archived": frozenset(
        {
            "03350cb55337bbb2e157fbbd76fb0b786936eb0d9defef4130b60bab0dfb2ad4",
            "12a15ba3e5e75c33ee1639d428236f6166499241a424f5c709f056c3ebbfd8cf",
            "3752dc3e2c759d8d556c5b94c33668bb11f12c1cbf0721f26e645807b63d1f27",
            "4ba76caab68439566823df3b65ff89f47715044e7120fd946b06dcf0bc64aeca",
            "68d63273e06a64ede4ccefdece431fdd84b16ef0d8b854031be6e1c70d7c6cb9",
            "8896a1e6990e891789c810346e83288fb337a283e057e1933139e2cf3c058ba4",
            "bc80b0aad8989cf20852de231b3771fc1c145b66a6d8670eed5a856bb913cbe2",
            "ce42eaacf81549bb7a06b885f178ba0ae6a00cd2ca57703aacc88387f626e656",
            "e5fe1c275e7d151535853aacb6ec49ac17843f2de4335e739143a9d6eb4da44b",
            "fe5754e17e68317c530ce4c5f144bef0e25beacdff10d5e41f97d5fe84293709",
        }
    ),
    "member_dropped": frozenset(
        {
            "0016ff1e39f18a11535047b2db44b6de57e57f742307bf3f3b01e7aa3a9f7166",
            "21a828cb73782727dc916ab60a3d0fa902253e64e6cf51799e218ebf5fe3259f",
            "2e61534e446f46a7e7d86878d7b3c92d1d8441a21df5a66145ee137c709a0d42",
            "558f6b295eb476c60f62539e202c11aa33a4878e40651713172cc57b00b259c9",
            "6a2cdc55f5f25223ea1bd4148cc7a28d1c84eac78f6f4313edf9344103b75bf7",
            "7f13464933bbc8d17717901c7d6411a1797f61020dec644ce5d92a7104dddbff",
            "9b1fc0c8af535ae024e5741718b0464bdcf93776fe593512d8e3431ebf7257af",
            "be48ad52858abc209295952f56b0636bbfa84f1f08925c032034f7fd858d4c98",
            "d262352cd417fba3fac22547d5ecfa2b5eb8486fcc2a7577dde910d8580eebd8",
            "d93d65196928e7d1a4600d922f5fce3e1fecaff12b000200d2410fa397ce0fc7",
            "e617ecd84eb0074e6454a4f21752776e79c1fcc146b97af0c02c6d9d2fe82f86",
        }
    ),
    "password_reset": frozenset(
        {
            "118d3f787e767f6002585a96f3a5e42e31ec22dc22ee07a3294a4dab7a792a27",
            "3640193f19f53994cc7a1439c895ddb91e4691fad647c1801d4bf2d5a953f7d5",
            "39ee16b47871ae2fc8ea2aac4b4add1795ae6c4b6a9139c6287be8ec94b46099",
            "70b59ed7577b26c0d7041c7777967f32f7f94d592e04308a5461e0c9984008c0",
            "749070d7e0e371cfab64538d91e92713b9cbe26c4e9e1dd50c6d4e54d3d0b23d",
            "77c9932e509e9c7e1ace16e00a1ce113542d672bc3e616670dfffabf3933ccf4",
            "80b11214980fcca1e987f9f4ec8fb36febcefccf19d9ff808706df47d8fb4b69",
            "8adb8f069dbbd253c05a14faaf654801c4cb0a196b6c9a22a617a70e2cacd783",
            "b7b4bc5254644a5c08f1778b5727aa9bcc6f50f93e91d457fd95853d600885f7",
            "c5bf86612c7e2eb6cbdc8d00b2b7b08439bc3bf16859e6cd1ef4f90312ef5072",
            "e9f4a5f90cc0a3c07dd49169a9f437a67df5cc20d9725e6e1a31d333f12d4555",
            "eedf278d6b40cf7ac95620e946a49f7cd901565df3f0baaf4bafcd3725a052a9",
        }
    ),
    "post_event_validation": frozenset(
        {
            "1fe12487538966b99fca93b28cb0e86e840dbf3cd2dd7b2b056a72edc2fa4273",
            "2556a68e1c2cb6dbacdb9b52790ee8139cf28f7266c1be9326457f12cc063808",
            "83230f268623d3587e4c356a0d060c6a3b8f3fb2c5d02f03777251c064c79bfc",
            "a74f5e055373891ba67329a70cea22b6c8fd39c58edb96d5dd84b6d2dde565f1",
            "ba76b11255f00163353bd54929a40028432cb6f538880431213639ba99e3f3c0",
            "c83dcc2cd3d921653f65f64f224f99a6f899f44b9bd4b33088bef1c81c3d6cd2",
            "d53a466c38595751c88d49135bc010bfabdc9bf11492d207c50fe01ef9cd9d32",
            "dcf5e6b87f0fe9492d60feffedc447f3d95a1a6fcca0bca89bd8c23e5ae3c952",
            "f1f66e8d10a9ce9c2b2db8bbf1967ea6fe46e0860a9ae5bde557bcf21311b50d",
            "f936ea6527fdb93bcc3be402e496b8bf0b5d85f6e848437a62afcbdbddcada3a",
        }
    ),
    "post_shift_validation": frozenset(
        {
            "1464d7154788e0630197c2bb2aa05061d99795d5452e4472ad9a32d8daadd5b0",
            "3af4b43ab28e3d2f2fc8ac29a91713e5bc7f0523b91107951eaefac890556ed7",
            "701bdac872cc35c36a129b0d53e92d04bfc36ecd766c5126f5510b4419baab9b",
            "780fdd3ab416217fa871f5d762b3e487356355c8f47b617ddec86b1dacc97955",
            "7e64e4629d2d0f77f4c6902d45ce95cb14a705b870a72d6211a3a9ad98d9eb24",
            "8946fd0c26c150c4b5a018ccd6668ff6f3b8fd79b977a14dc1f63c063a5d6df1",
            "91c695d2ca59b5935f1a1d721b56ea469ab76890ac8ad7f20056b9e65dfd800c",
            "b698a2f00646618a21849c52be005a382bc96adb0e17f6b82f25fb8661b4b0d0",
            "e2d825662e1c8cefd5a4be7b415f9aebbb08eff6ac39716f71a9210fa91be9d2",
            "fc7c6bb5bbd47c6f40a76dfc1af6f2efe2986bd3835ad355d92772eaba9cdb85",
        }
    ),
    "property_return_reminder": frozenset(
        {
            "029b976ac57c1b874c679905f7249dcf0fbae2ed71ba2eb08dc37f36c599f5f5",
            "16652f598580333d916c11978146114f9387537d420a0333bda5e37c21fbb763",
            "37919949b8dbed1cd334aead7f7dfe67454ed508511b1ae85a13616caecd89d2",
            "43c288a6356da81fc9d8a1b7d444b9a67ed74b3e50dbd8d8deba7924e9437f90",
            "97007fdf9b3b8a5dbd8253d29af4151591098cb5a37cdf11a3e7d74f01bc32ae",
            "b19d867575ee5205f7b2c917b7496b4c4207a23f5fe25a751c0f1ece7fb2ed92",
            "bf2274749da75e2d93dc0f41351c93629d479dabc304733ce9d457f59961b090",
            "cbf3d72f5aef5c9f49d14cd9d6b298f6d5d1e3c0eece9bbbc554a8097980d017",
            "cf5ebd92188dc4326816c7d40e9befd64b4d4b2664981c17f330317534f6e379",
            "e6452c62f7f6012a9d2283951cba0ec291c13fe9029407618369b4125da99a22",
            "f14588db01b611239ed37f9bb007e04fd5db740f7b7bf9e861a3628af53f84f3",
        }
    ),
    "series_end_reminder": frozenset(
        {
            "2cd51aafc374764275852b3c34cf9f33d39d5c9875b730632591d16529899c94",
            "35af82b66bb1774c75645a5095dc34df9cdeffda53c0ca490312c6033d7c8398",
            "4ee225eac7304417b35b421fd95b398bb060f21b7a1aadd3afd40dc29eee2dc8",
            "519fc9aa195e37996164089e2787baf3517d16d7ba8a143ee880ecbecd5058c0",
            "5cb17ca2429e25225db06706f394a637660c3ed5eb67c8f7d5b7079cbd3f704d",
            "93481b3aa9769af2bfc5d85cbc42796d4f7f16a62d504623a8b925d3aef3db08",
            "b226a311f85fc44fd570863e7d8a7ef27ff7325339852372151eb456af5ccc68",
            "eb401cd97398dd1f66c688c479402d55491872ff4b385c5c0418cd87bea7c897",
            "fca0bec3d24c577562f829a63a555cddcf844ac8a10390d697daaf960bacd6c8",
        }
    ),
    "shift_assignment": frozenset(
        {
            "132d824da4cead449d7f83852cb4a37215e733aacfeedf4e8deee185a39637be",
            "24efa0458a17c77394b4ba80cb628384ad162fd0aaf7f5dda1fbc981d12751e4",
            "2ce72a498d6ce36f8cea28bc71995e3132b5baccedfe959ed764bec879cf8dc4",
            "5d1eccc3385cd308b2bccd27bb7d7e917bfc5c2aabdee6d70817248e84779fc6",
            "8d0f5e549676560b43bb7d3b2d33a0a220aa92e408d87bec21101f6f7e6c80e5",
            "a215f1dc8d7ed20be3cf089b8db8cde50aa9f443cc1f7d3de95b004626e5c138",
        }
    ),
    "shift_decline": frozenset(
        {
            "1275fdaf7e203f1edfb5a2047c3dc900b6f5c982be8dc46a879ae3944f627be9",
            "16f7decd5565e716e1580a48b9e30694b2981b88ac7d73547f7796cd8416cace",
            "2107445c479b0d992a34ebf5addfda292031e050c23a10aad7dfb0f905d10fc1",
            "25717c6aada7f5847ae6cdb643712fe70d86fa70a7532bd772fe9c27301609e2",
            "69ff92f0856677ed6c9299b9e37ccc7f46af3df6f951140977b333281be018d6",
            "8c964940b2ffe05fcbfe1ba9da8e2039b27fdf9c140b2b27710ea4c98a5c54c5",
        }
    ),
    "shift_reminder": frozenset(
        {
            "0c2043626be90374015003215a78c0ea1946c2bb5cf139d8702bfec1ca9537ce",
            "4fd474d89cd1eb96bb12dd5647630d1e06bcb4b777e08feaa3495ea9e088df66",
            "6102452507917f0ccc5d22bbcb7e44d09132156defe465d838b59c30fdd5a175",
            "9af239c9b5e4f32e16c079b45514ceb61462d7b8aaed1f300229a81d6068aaea",
            "c52108b8a60c45aec65808d8d7aaa23e76b62a3a181089e9fbcb6a633a419577",
            "cacdf73f8d029dedcef485a2469fbced114126f8ae7b3c045b7b5b1f8780374b",
            "cb8acaa8b8bf6b886f85051d4f0a1fcc181bbb8717bfb3dd087b4e271cb92268",
        }
    ),
    "storefront_new_order_admin": frozenset(
        {
            "1643d271b8a4e457aa279ab8c724a4c321c6f2aea02eb1dbac759b79268ff811",
            "65b9326e8d9ea7763418a8af2a33f2711bab7fc1bf40f62a3015c52a3b39a812",
            "66204f2a2581ccb0fd5e2a973d07232676b0c4801962ff54165fbdbcb1d09dec",
            "8a9c2e778ae4963373adccac38adff49e2e26cf22f8b1f2b691e866fe4baf2f5",
            "b1c6a8f16a8ef02d398e5d2c831dde7ebb67ca3c2e105b50a9e5741029650f4b",
            "c11c825a757ebaf2837a0f52cd0e40cef4b52c8ac14d87af5d4492b8f3c28f27",
            "ed0ab7fd15f11a9de023340437f2e0e662c1248ba6b3e197f1b737d39c4c8a26",
        }
    ),
    "storefront_order_cancelled": frozenset(
        {
            "7152690f0ac741d26ee612d489aee674ccbdf75d196f6ffefbcee8b3f2e5516c",
            "91b76da2fdaf8d1014f264a7cb1721afe55bd7f5e41942b601a2919a6d494e86",
            "b3688226eda4d05b88e5395d83e2af03c43f2599f11d3182302548e8428ec40b",
            "b805f3128eac892f8aa7790ef5178c2bdba4e6b992d5b8a1c9863fcbd3a77663",
            "e6cc8bad9566b08bfff1509a8e9037a34e90e82cac760a9f5c98fa89b28da489",
            "ed71acb832989bf129d0c641a7c098082f0d64e2d7f9b2cbf0be414fbd6ef9ce",
            "fdf8ecb93f8ca3fe7e04c9b0a705a3c940f04505032780cbb33b61128a7e2524",
        }
    ),
    "storefront_order_confirmation": frozenset(
        {
            "2293633d998d8be38d6534318774b1bb933c074a92f3b953d3a0ef33291aac30",
            "459052abf04e86615a41035840a051c1d7942fdc0c4c42e28b0414a68ec64abf",
            "4efde205548cdc8690329db9dda76ce24fff1f504b5b2c14213fb2334726d6f1",
            "6968a4bd404a69b86234d0eee6f9d8428738acb4ee81b8f41a30527dbbfa0614",
            "69d2d592181e6929a140ffd6e1fb66020b5c27b37c45dabab02483e44a29792e",
            "77c4cb8c2a0c329551779271a659e86a34f753887184beb4d949ab649d44ab50",
            "7877fe92d3c99b12010752d2a43cb8f448fe4f40deaa6c24cccce5ebf9f60d4f",
        }
    ),
    "storefront_order_update": frozenset(
        {
            "3b6ef3f33669d43ed82a30a437e59b49704bd18cc8fbae4ec08bbab573310adf",
            "3f544495bee088ffa1c5c01c896147322e500a3a378f8b485e9bf4764cc1f6d7",
            "450bb94634679a92fa51ed93a54a2f029647f3f53da69d7f530f9717a77be219",
            "58ff3f62c1180c068633c74e0238f9e6c540754a1e1cd88d3ff9dc78d79cf9be",
            "5c337a666365cd134497a3d4cfc90c650fa2d34cd7228a9656b3ca7e7db88852",
            "981300b2158f587aa466c7d4995f2fb95a7a2a52666ffbcc6e92d7718a3bcc17",
            "fa695b8538be87ccf865f24ea07e9a6f0639dea578cdc5f66fbbe766ffaf3045",
        }
    ),
    "storefront_payment_received": frozenset(
        {
            "0ae11577d2fcbce37ae574d71ca6022970d2c48a4eb80f01706d7c7bfb68f8b7",
            "3620bc31e6105b476fea378e7d4363ae2c90559bb4b98e1a25a3a1d1b7a3600b",
            "5f5e161540ca03a11774ad5355d89cdbf9861e8f7599685b92c67c4c0b70087c",
            "69f28db80998c25471a509e1e581769debcb01d843fee1e1a363cfeabf79e71c",
            "72037db73ce8f06e5765614d504030ea612989ec8d2d53598237b9cad5804ac5",
            "7346f2b217ec83cb558cb3b49140ab314d2a24d4bb519307c712fbeb88896a8c",
            "bbface37a3ff29cb39f538e93bdb089981177e9abcdb98ec498e3cb7cfb400eb",
        }
    ),
    "storefront_payment_reminder": frozenset(
        {
            "0a2ffb52501078ae83802fb6614d146bd6bbddffdc7dccb6b37bc57bfacd63fa",
            "1eccf624d1ef5bcf0a450cf4d8e7def30b8f56c252870a628f747212d4a4c9aa",
            "30d23970a3173eee7fd81c9834e035ff25421b92512f0b51f27f49534612bf64",
            "39919019d3470a4925d94ad5829d2431aa6f7ee454a5e49ec9280d9b4f665bb2",
            "73a949e7c39d662d85d499b66433fbe3931beeb87d74c3462e51cc3fb2dc0801",
            "c063611dea615480dd7b29d91d4bfdb312843cc41f02b4d6ccf4f38b72d46931",
            "f3fec1caefb50793f0b3d4044837afc3e6d413e40436077f28ac1af1ae261f47",
        }
    ),
    "storefront_vendor_order_placed": frozenset(
        {
            "15ba78eb3f3a957653be54ffd81c85ffaaf44e3fc9e544479fbb44015f9ed8d9",
            "290ee496fc1e9d216d352aba33b6dfda401768a481f63771df1cd09f09be3c69",
            "2df079c0fecf0cf7ee66a69272378b1e3b2bbabe801e0b6fe0d2686540311752",
            "61cdca84fea6a7f76faf4b6b2b42bb5746fb5562fb43da677320cfe67a73d515",
            "61fff6c4f1d6fc89cce3af34419a92db9269acf43f073264539e1bc88733c472",
            "904f791799596d7c3addda1998c38d475a4941ed15a5b0e19dc3758838a26860",
            "a5948785040cb268b65feacf07ea79d02701be33dabb5af81fb7e89aa9afca4c",
        }
    ),
    "storefront_window_closed": frozenset(
        {
            "1c8bbcc3d9b1a5bea8b14e2385b0a22b76375f831640660e8fbddc0d70c31c79",
            "3c5d7ddae88f02987389941f8a0ba57b350d08f033ea69b5434bc11513aa54a4",
            "8ae6b648e164573045bf48db8681a5a9439113382f83c217d5fe32cb038d2f61",
            "9ccc7181de86ace991aeed3a9e6461710753fd5c9447940d7e33cd7f457c2354",
            "ab07240fb40de29fbd6ebdec6f8b942c0ba9da3083b2588f82daa6394ec15ea4",
            "e9de7cc43f4c56d8e5a9ab37effa37143fc499345f108902fedac58f907076a8",
            "f35b6d46de153fb0ff5a9b83549a08cb9fc5146fe9470df7cf8c09f91abbd340",
        }
    ),
    "storefront_window_closing": frozenset(
        {
            "28bc069b00a4f0bdf09b55962d767fcf4125c1407f4942adc9fb91c0aa7d176a",
            "5cbe8e82ce042cf7f5ee9e0ce27158ee2d8eecdc80dcbbe016edf390d9d86069",
            "60067ea018241dd2d6a1ac8d00fec7beef7a51024e0b8690e93a0eda33c7ae38",
            "6ddbd4e0f46160e9968b3a8c430e15c11b798353a685258942588f107c5001c9",
            "bd9e0df5f720361674aebd0f45d69e0ceb41f56305463670df2a09d7c1e7cfc0",
            "dad8b5ffe097379b11e8748dc2cfa5d3a99219b8f3381c65d2601ba78c9ce887",
            "f5b5c3d1459011a0494d8cfa9b85b5be06946b1077e6b306ecaeae8e022562a7",
        }
    ),
    "storefront_window_open": frozenset(
        {
            "1ee16b03c3476e3ed900811f7bc70ecb653261a0b7e4f5f14590c29fc91995bb",
            "423b0834542405fa2666f893dddc2faa5c2175ac5239b818c71dfbc26c5f6aed",
            "94be5d6a9f1a8c61f5fd61ba9a0e86585a870f6835891d4bba6fb6ffc7aed407",
            "b20e27a035924138487ebe74e9faad22094a4e9017fe2f5fe38552618c149179",
            "b521d494c814a9c5ce8e24d981f1ed303d6275da0fdb28fdc4d783eef4de88f5",
            "b85869b2a3bf75df4742fb83708e145590a7718e24af4d83aef3fa06383b73d4",
            "fff43a6595ee339b7c23bee1b6fb1dc6c07921a5b73e644b96db87c7decc9e7e",
        }
    ),
    "training_approval": frozenset(
        {
            "1b546bb4a5095b6fee947f3a69e3b7f53181c59decc651021a5b85ad18c2ad2a",
            "2e21792ecf0889ee3cd261d41f6de43691c5a8f49876b54ef7b295dc1be6a1d8",
            "3ea396fdc2305dba5e32d2dc027f721082948eb297b5e263f8055d4fe87e9324",
            "42240a2b572f5782b70ccf55a9f2a575ec409b440800c24d7bb1ce660d40161a",
            "6329c79e06337aec5695b70b82d49b115da08b4f4b7f16c054410e14edb3b8c3",
            "640167ec00738abbf87599ea4ae49f37192b0d15113aa1aaa055c88552635ee0",
            "7f5fd5c00d2407677531eb99bfb5442f5e7f64da5e245e5b644cf221d656eaa5",
            "848770c4579157d500b400515ab0de95eb969e1dd9e88d2d1f45b4da293dc5ba",
            "8ba4a9862a8b86a58923130d6679f88e2f0905bd8e03978c511b173b02a853f3",
            "a5ebb706cd92febf1274177fbd2194dbe699ab5b860a0e13c03dff3c7503dba0",
            "cd62dc0c243a1eb6a57d8784c0701883fe17f2a72d23631a5e22b7bdfb24cb09",
        }
    ),
    "welcome": frozenset(
        {
            "0f3955780326bfa1f47c6b7a9006effc6706aa26883b963e18af748d646acf1c",
            "0fb39c58894c8afa50fb997a7a9324eb5f51f9b69a9821752ae5f338d2447e51",
            "5da699e0993bac97fde92d403553364aec435175bc558b3fc9eb79b11bc0f368",
            "5e995798c3d964f79fdc67b78d0475820601f78882485973af12a86f1e5e4aa3",
            "6177d3a62fe339f77c097ebfad9fe91246bd6589f9f2432cc5f1e180925106f7",
            "847e1a23f7e7dcdbaa220b299d758f58b8c944400ebb6dea4c21bbc8d410ae99",
            "9d44dfe7b7a672e9c9b7c4f525f22bc7b69ceeabbd840ace08af8205335cc702",
            "c800a9d96999f344670dff6f789182a8edb01e48654d7efdb45a2e39629b339d",
            "d994a51e6fb77998dba7f930a52e71288714d9e8d1a1cef1bd12e3c3af8c0015",
            "e951cade3f8fca044c653163a34b517861d0f139ef9004002cbbc44f0da8c437",
        }
    ),
}

# SHA-256 of every earlier shipped text for each type (UTF-8).
TEXT_HISTORY = {
    "ballot_eligibility_summary": frozenset(
        {
            "ae94136cbe46ff475c562a3a3e68ff70da286f03e0f9b0e8ec2d79d92d77d3d1",
            "fcbc6e761944835a428a1d73973ae85d884556d3772cffdf927a8bb476cfd0c2",
        }
    ),
    "ballot_notification": frozenset(
        {
            "474add0c13409ecb11e719af04bbedd37ee9d8a31dbb8df8f854b70acaea89d9",
            "57c6d96adad2b91677224f53c492e5f2033021297c389cd00c9069f1d163cfbc",
            "8a0c9bbc535e2252622010f8c590d6534abbe16ddef982c51b89691f3612d72d",
            "d6890a0cef64d1f7a3fa348d2bc7d2a92d9de205f1eaef122afde87bb892cb44",
        }
    ),
    "cert_expiration": frozenset(
        {
            "01c087f3b0592d3520d1b521b548e130504bf7182ac960b54d2c9483e79fe453",
            "f7d30623f7023df3bf4a07fb1ec69080a4e1df7d7caa508f409b048a8270600a",
        }
    ),
    "duplicate_application": frozenset(
        {
            "1703d07f2ce2065b0a0ca710e840c190c4b4291ea2b0fbb0355d9d51a7bd470b",
            "1b0ce74a62495328e470ccb31b05d9237e261df95baa7d36480bd0b2aed7b329",
            "45c7b55165e6dfd3c23c5270af9354fd9d5f543bd7f2fd7c682b6060a79111aa",
            "c466b34017ef30cee6e23f73fe8c0467497b82b5adec65cf6012f5f0fd5aa62b",
        }
    ),
    "election_deleted": frozenset(
        {
            "2ff8794644d7f45b21a3a3ee656e0d0873c6ae856c775ecc9dcb2e8fb9d146ef",
            "45b9f5e2b863fdd8a477ad5e50a64dc2c8399c73296d7451fe15f8675292b7f1",
            "9567b419faeaa5745c578931dc11836f5e81fe132981faa65d3142b7c33ebc41",
        }
    ),
    "election_report": frozenset(
        {
            "540b5d79472f902d8d5b2337874959286c26a47d2210d765c71fc96ace0ae82d",
            "f39ffed06e909498a2777b3a5ac173a00c85c0bf3c2d997786253b22a2254014",
        }
    ),
    "election_rollback": frozenset(
        {
            "086797f625553cd026297e58e56288fcef3470e32e75202f5a0eae7034ab9509",
            "3dcd518fde74fe8e3c86248ee01c3d5b19e092cd51ed0e933a030ac6e91f7e73",
            "f11e08014216484fe783326c58b692ee61da5e2303b2b06dc6a84418761ca86a",
        }
    ),
    "event_cancellation": frozenset(
        {
            "7f3032b8d24c7a5ebf618ae1bc0901bed409afdb30b86c089c357ad0722820b5",
            "ed45fe8e462c5af8b04e8046df9cab6a70de21fbf328d7e55e415d76b561f4ff",
        }
    ),
    "event_reminder": frozenset(
        {
            "a0f73dae85c1eaad8c2e13f9cef7cc3ef4425055990b01fd54185a61ac53951e",
            "a9dcaea2905101ef0b349cf046ea6259945414ea9013fe4974bbdf3ec9dfad3e",
            "fa3c42d5ca052d69c805f9c6eacf5ede11f9bfcdd3409c2e3b17ee2d18688c1d",
        }
    ),
    "event_request_status": frozenset(
        {
            "155a36d6b4c2859f0d0bef1355808e0601974a0a0a01395247018f7780cab9bf",
            "7fecce1168e5553f0f1246a4c55dd42e7f3cbaf025ddecf8ae5279a738d09815",
            "b61c1c73d68b094ee00e4c3027bef73e770db31d86f7d665050d6e7d8d06e8e9",
            "bcbfdf52d0074d35b7b6c6226d49394432e81c384be6e68f603644db469e449b",
            "bf4f70c88f933bdba6bdd489fbba559618cb03b311620ec69961b7e1c0296f19",
        }
    ),
    "inactivity_warning": frozenset(
        {
            "61fdb1b395ee9ef03584133fd3cdd2545573220ccdfcc0fe99fe140a904046b8",
            "85ccbd4754ca1a8e29792badcceebe0bb730c24237de6c808e5626040b93092b",
            "a5ed44cbace246c95d8595462ddaa003292d00c478788fc166bee1966f45e756",
        }
    ),
    "inventory_change": frozenset(
        {
            "43d9322b646725b2d132b84844462d8a43d260be2e9fe1fceffabf4d5272c7b0",
            "5402d670cf8310834a8a85ebd67b8a8a655c61c30680070bbb1c942497f87b34",
            "688635773a57d270b70e0ac3ccd1314b980b8e3474443b9da88530f8b6f1b296",
        }
    ),
    "it_password_notification": frozenset(
        {
            "9f5277605b4212004930a7d3564087811190f92f31fbe4545fc28c1202b3d686",
            "a3d0d4fcc6617ddb2a2b416a044227c5b746a317771cfb13dfd80121991cc5a9",
            "e920f95ba46aca2e3718277f835c548d03aa84a817a35e7783e3490c72594c4a",
        }
    ),
    "member_archived": frozenset(
        {
            "07ba87a3e5e13305d4fca62e6bdd71f8f312ae92d6b252dc157864ba0c75f655",
            "4a7207bcf5ca1e18ddf50f79fb4f93d4b51fc57674f5955163f5577504d88ba2",
            "cd3593d04aba843034e1d111c153efa25f8497fd41633521f5f8bc48855b9d06",
        }
    ),
    "member_dropped": frozenset(
        {
            "725a35b0d49b0b0d9a06877e8cde7ddb9de02225ae4f033e2235dd2f4606ee06",
            "73832c1d4125a87a20919d0f0bf9e652dc1f768a472ea4b31bb6d1450eb050ab",
            "8b150e78e6132e0a70b8a81ff882986084e42b859bc96f00d6445feaa66c2102",
            "fe24245c513a4cfa5a7210999f2070a0da054bd31f0278ac9af1d36c3870ad19",
        }
    ),
    "password_reset": frozenset(
        {
            "09912153d161a15af1861e0bc69b5e5b9114170260c015e165a48ca7a97fff75",
            "5096a6077a68ae5a8b078f8ad20db5c8ebac5b34b4bf8a99ad3522c5f2965742",
            "547bd2ab51aa78eea6e0f171d4846328c235cf5a56a7842c03bcfd7dac86557f",
            "7cafa6322892db5fee56ac50e7572332357fa59b3611e3a5b698fdf4c0cb775c",
        }
    ),
    "post_event_validation": frozenset(
        {
            "ca3e6cc3c8af7e79b214329c85a2788bc91fa84cdb8eda37c7c3509d58cc87c9",
            "f7f6bcd79fde6e341e7de14e4843dc29aee05250848b3b3ea9e2ef3690f6cc9b",
        }
    ),
    "post_shift_validation": frozenset(
        {
            "1ffe03675e27cea5c931061dd6b585498cc65ddd3d77555f472792a000211890",
            "bc54b57b040b9141c0599131d8787a826d79e05cc7187a5c40e2502c5fef669a",
        }
    ),
    "property_return_reminder": frozenset(
        {
            "042a1fda953fd96591c17af8a423fd794a09b901e810799ff9d05a3b5b044bf6",
            "872a722d9c3e2066c4a3a207cc36a1c27b448dfb547d80583dae4b150c0aaeb6",
            "b17d88e98e1a000cc824f2b8dadef8a4b4d290588ef5ad53b7298f458153da97",
            "e03ddc4648e500e9f62291691ea1e5d58124ac1ad219f7c6e457f47ab8e45d04",
        }
    ),
    "series_end_reminder": frozenset(
        {
            "0b411a0b26292b1916ed3665840bf02fcc590ebd559970d711d49c4fa4cef15a",
            "de4de3e82d3581d14c7f9391fe04e0f345c849139fd2f162d82a0714a4330fac",
        }
    ),
    "shift_assignment": frozenset(
        {
            "0482366658a4730d1f8356bb4475e66e3a1209268b81a3b8f774b0350974a78c",
        }
    ),
    "shift_decline": frozenset(
        {
            "eed0e645150b0dd2a70d8c4035d498ce80f543f6576d196b3b6da2db9510bf1c",
        }
    ),
    "shift_reminder": frozenset(
        {
            "5c3bb36c3a1f94e773b5df24990246ff4ff1fdee2b396f7b62e8159e21f738d2",
            "7d51cf5d9f53a2e8aae2db6ceaec728690217705d2ef2084d982c7aa57683c5e",
        }
    ),
    "storefront_new_order_admin": frozenset(
        {
            "f62fcd1b8798cac8019a59091d2c51991505218986d2690288ffdbeba3f9a170",
        }
    ),
    "storefront_order_cancelled": frozenset(
        {
            "3b46bf823d33185a7db672323b55ab11c09daded8d23700ccfe4db679a5ca869",
        }
    ),
    "storefront_order_confirmation": frozenset(
        {
            "0b4dda74a03275365c4b6631be02bb3a60549a58e3dff111ffa19efdcf89ca48",
        }
    ),
    "storefront_order_update": frozenset(
        {
            "4e2fd46b179e08a3b72ec9749237e4aa8be409af9370994da69e6071e1989a11",
        }
    ),
    "storefront_payment_received": frozenset(
        {
            "1022c254e447b7d30ee8bab854d3cf95e8dc36c202e0ca481c10499febb9c6db",
        }
    ),
    "storefront_payment_reminder": frozenset(
        {
            "ce066c7f8273edfc1f4a2fd22db7b3658406758a9e6f25079ac6f17a8404244e",
        }
    ),
    "storefront_vendor_order_placed": frozenset(
        {
            "d5485e9fe0d90bea10abd3abf4c5085d0adfebf2cc12ff63e6646c34b3fa70d9",
        }
    ),
    "storefront_window_closed": frozenset(
        {
            "b070d9488daae458d7a874dae321f0b01038b8b676e1c5cf828a04750a83327a",
        }
    ),
    "storefront_window_closing": frozenset(
        {
            "e0e143e97127e29964ed20424f5f07c2f296742f36546bc6f0a757f3d5d307b5",
        }
    ),
    "storefront_window_open": frozenset(
        {
            "60684ee5411b18a1219445d47cc3a749dbd55de9ce55a352210d946855b9654e",
        }
    ),
    "training_approval": frozenset(
        {
            "044317b83dce8e579ac6b071c4d503e08fc57041c0666c766b5874d5696d43d0",
            "5bce80e473f68bd510175df46a0d085b903f800ce7ced4760bd171c31834bced",
            "dff21a2c77cd22ee0770ebbe23bbbbf90c7c91ab0bcbb4c998786f5c25f1c4d7",
        }
    ),
    "welcome": frozenset(
        {
            "8ec569539638ca00586dbde089adae69c3024a079aab21b250089c10eabcfbdf",
            "a48c616221e0663b63145e2407295c61383b58bc60e6fb8c720b6b1fd876ca76",
        }
    ),
}

# SHA-256 of every earlier shipped subject for each type (UTF-8).
SUBJECT_HISTORY = {
    "shift_reminder": frozenset(
        {
            "6dda7f3ef84c51d0787f1bc22a7b7679bba4b6db08fcb287e3f60b12df68718b",
        }
    ),
}
