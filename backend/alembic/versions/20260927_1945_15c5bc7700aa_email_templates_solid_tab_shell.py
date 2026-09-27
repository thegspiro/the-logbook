"""Reset every stored email template to the solid-tab defaults, with a backup.

Revision ID: 15c5bc7700aa
Revises: 4acf7f8212a2
Create Date: 2026-09-27 19:45:00

Every email now uses one design ("2b, solid tab"): a masthead, a solid tab in
the notice's accent naming its category, the title on a tinted card, the body
card, stacked callouts and a centred footer. The markup for it lives in each
organization's ``email_templates`` rows, which were stamped with whatever the
defaults were the day an admin first opened the Email Templates screen.

**What this rewrites: every row of a type that ships a default.** The owner
decided that no email may keep the previous design, so edited templates are
reset too, not only verbatim copies of an old default. For each such row,
the columns Reset restores (subject, both bodies, the stylesheet, the footer
choice and the colourway) are set to the frozen defaults below, and
``css_styles`` is cleared: a per-template stylesheet is no longer honoured.
A row already identical to the new default is left alone and not backed up.
Rows of a type with no default (``custom``) are not touched; there is nothing
to reset them to.

**Nothing a department wrote is lost.** Before a row is reset, its previous
values are copied into the new ``email_template_backups`` table, tagged with
this revision's id. They can be read there, and restored by hand.

**Frozen copies.** The defaults are written out in full rather than read from
``EmailTemplateService``: a migration has to write what it wrote the day it
ran, and the service's defaults are free to change in a later release.

**Downgrade** copies every backup tagged with this revision back onto its
template (if the template still exists), and then drops the backup table.
Anything an admin changed after the upgrade is overwritten by what the row
held before it, which is the only content the previous release's stylesheet
can render.
"""

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "15c5bc7700aa"
down_revision: Union[str, Sequence[str], None] = "4acf7f8212a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BACKUP_TABLE = "email_template_backups"

# The columns Reset restores, in the order they are compared and backed up.
RESET_COLUMNS = (
    "subject",
    "html_body",
    "text_body",
    "css_styles",
    "footer_key",
    "header_accent",
    "status_chip",
    "layout",
)


def _templates_table() -> sa.Table:
    return sa.table(
        "email_templates",
        sa.column("id", sa.String),
        sa.column("organization_id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("name", sa.String),
        *(sa.column(name, sa.Text) for name in RESET_COLUMNS),
    )


def _backups_table() -> sa.Table:
    return sa.table(
        BACKUP_TABLE,
        sa.column("id", sa.String),
        sa.column("template_id", sa.String),
        sa.column("organization_id", sa.String),
        sa.column("template_type", sa.String),
        sa.column("name", sa.String),
        *(sa.column(name, sa.Text) for name in RESET_COLUMNS),
        sa.column("reason", sa.String),
    )


def target_for(row) -> dict:
    """The values *row* is reset to, or an empty mapping to leave it alone.

    Empty for a type with no frozen default, and for a row that already
    holds every one of those values.
    """
    default = DEFAULTS.get(str(row.template_type or "").lower())
    if default is None:
        return {}
    target = {name: default.get(name) for name in RESET_COLUMNS}
    target["css_styles"] = None
    if all(getattr(row, name) == value for name, value in target.items()):
        return {}
    return target


def _create_backup_table() -> None:
    if sa.inspect(op.get_bind()).has_table(BACKUP_TABLE):
        return
    op.create_table(
        BACKUP_TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("email_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("template_type", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("subject", sa.String(500), nullable=True),
        sa.Column("html_body", sa.Text(), nullable=True),
        sa.Column("text_body", sa.Text(), nullable=True),
        sa.Column("css_styles", sa.Text(), nullable=True),
        sa.Column("footer_key", sa.String(32), nullable=True),
        sa.Column("header_accent", sa.String(7), nullable=True),
        sa.Column("status_chip", sa.String(40), nullable=True),
        sa.Column("layout", sa.String(16), nullable=True),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_email_template_backups_template_id", BACKUP_TABLE, ["template_id"]
    )
    op.create_index(
        "ix_email_template_backups_organization_id",
        BACKUP_TABLE,
        ["organization_id"],
    )


def upgrade() -> None:
    _create_backup_table()
    connection = op.get_bind()
    templates = _templates_table()
    backups = _backups_table()
    rows = connection.execute(
        sa.select(
            templates.c.id,
            templates.c.organization_id,
            templates.c.template_type,
            templates.c.name,
            *(templates.c[name] for name in RESET_COLUMNS),
        )
    ).all()
    for row in rows:
        target = target_for(row)
        if not target:
            continue
        connection.execute(
            backups.insert().values(
                id=str(uuid.uuid4()),
                template_id=row.id,
                organization_id=row.organization_id,
                template_type=str(row.template_type),
                name=row.name,
                reason=revision,
                **{name: getattr(row, name) for name in RESET_COLUMNS},
            )
        )
        connection.execute(
            templates.update().where(templates.c.id == row.id).values(**target)
        )


def downgrade() -> None:
    """Put back what each reset row held, then drop the backup table."""
    connection = op.get_bind()
    if sa.inspect(connection).has_table(BACKUP_TABLE):
        templates = _templates_table()
        backups = _backups_table()
        saved = connection.execute(
            sa.select(
                backups.c.template_id,
                *(backups.c[name] for name in RESET_COLUMNS),
            ).where(backups.c.reason == revision)
        ).all()
        for backup in saved:
            if backup.template_id is None:
                continue
            connection.execute(
                templates.update()
                .where(templates.c.id == backup.template_id)
                .values(**{name: getattr(backup, name) for name in RESET_COLUMNS})
            )
    op.execute(f"DROP TABLE IF EXISTS {BACKUP_TABLE}")


# The shipped defaults as of this revision, per template type.
DEFAULTS = {
    "application_withdrawn": {
        "subject": "Your application has been withdrawn — {{organization_name}}",
        "footer_key": "public",
        "header_accent": "#334155",
        "status_chip": "Withdrawn",
        "layout": "notice",
        "text_body": """Application Withdrawn

Hello {{applicant_name}},

This confirms that you withdrew your application to join
{{organization_name}} on {{withdrawal_date}}. Our membership coordinators
have been told, and your application is now closed.

Thank you for your interest in the department. If you withdrew by mistake,
or would like to apply again in the future, please contact us directly.

{{footer_text}}""",
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "ballot_eligibility_summary": {
        "subject": "Ballot Eligibility Summary: {{election_title}} — {{organization_name}}",
        "footer_key": "official",
        "header_accent": "#4338ca",
        "status_chip": "Eligibility summary",
        "layout": "digest",
        "text_body": """Ballot Eligibility Summary — {{election_title}}

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "ballot_notification": {
        "subject": "Ballot Available: {{election_title}}",
        "footer_key": None,
        "header_accent": "#4338ca",
        "status_chip": "Ballot open",
        "layout": "notice",
        "text_body": """Ballot Available: {{election_title}}

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Voting closes {{voting_closes}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "cert_expiration": {
        "subject": "Certification Expiring: {{cert_name}} — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#b45309",
        "status_chip": "Action required",
        "layout": "notice",
        "text_body": """Certification Expiration Notice

Hello {{recipient_name}},

This is a reminder that your certification is approaching its expiration date:

Certification: {{cert_name}}
Expiration Date: {{expiration_date}}
Days Remaining: {{days_remaining}}

Please take action to renew this certification before it expires.

View your certifications: {{renewal_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{cert_name}} expires in {{days_remaining}} days&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "duplicate_application": {
        "subject": "Application Already on File — {{organization_name}}",
        "footer_key": "public",
        "header_accent": "#b91c1c",
        "status_chip": "Already on file",
        "layout": "notice",
        "text_body": """Application Already on File

Hello {{applicant_name}},

Thank you for your interest in joining {{organization_name}}.

Our records show that we already have an application on file for this
email address, originally received on {{original_date}}. A duplicate
application has not been created.

If you believe this is an error, or if you have questions about the
status of your application, please contact us directly.

{{footer_text}}""",
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "election_deleted": {
        "subject": "CRITICAL: Election Deleted — {{election_title}}",
        "footer_key": "official",
        "header_accent": "#4338ca",
        "status_chip": "Deleted",
        "layout": "notice",
        "text_body": """Election Deleted

Hello {{recipient_name}},

An election has been permanently deleted:

Election: {{election_title}}
Stage when deleted: {{election_status}}
Votes at deletion: {{vote_count}}
Deleted by: {{performer_name}}
When: {{action_time}}
Reason: {{reason}}

All associated ballots and results have been removed. This cannot be undone.

This deletion has been logged in the audit trail with critical severity.
Please review it and coordinate with your team immediately if it was not
authorized. If you have questions, please contact {{performer_name}}.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div class="container">
    <div class="masthead">
        {{organization_logo_block}}
        <p>{{organization_name}}</p>
    </div>
    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="{{header_accent}}" style="background-color: {{header_accent}};"><tr><td class="tab-label">{{status_chip}}</td><td class="tab-note">Critical</td></tr></table>
    <div class="summary" style="background-color: {{chip_tint}};">
        <h1>Election Deleted</h1>
    </div>
    <div class="{{content_class}}">
        <p>Hello {{recipient_name}}, an election has been permanently deleted.</p>
        <table class="facts" role="presentation" cellpadding="0" cellspacing="0">
            <tr><td class="fact" colspan="2"><p class="fact-label">Election</p><p class="fact-value">{{election_title}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Stage when deleted</p><p class="fact-value">{{election_status}}</p></td><td class="fact" width="50%"><p class="fact-label">Votes at deletion</p><p class="fact-value">{{vote_count}}</p></td></tr>
            <tr><td class="fact" width="50%"><p class="fact-label">Deleted by</p><p class="fact-value">{{performer_name}}</p></td><td class="fact" width="50%"><p class="fact-label">When</p><p class="fact-value">{{action_time}}</p></td></tr>
            <tr><td class="fact" colspan="2"><p class="fact-label">Reason</p><p class="fact-value">{{reason}}</p></td></tr>
        </table>
        <p>This deletion has been logged in the audit trail with critical severity. Please review it and coordinate with your team immediately if it was not authorized.</p>
        <p>If you have questions, please contact {{performer_name}}.</p>
    </div>
    <div class="callout-critical"><p class="callout-title-critical">This cannot be undone</p><p class="callout-text-critical">All associated ballots and results have been removed.</p></div>
    {{footer_html}}
</div>
<!--[if mso]></td></tr></table><![endif]-->""",
    },
    "election_report": {
        "subject": "Election Report: {{election_title}} — {{organization_name}}",
        "footer_key": "official",
        "header_accent": "#4338ca",
        "status_chip": "Official report",
        "layout": "digest",
        "text_body": """Election Report — {{election_title}}

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "election_rollback": {
        "subject": "ALERT: Election Rolled Back — {{election_title}}",
        "footer_key": None,
        "header_accent": "#4338ca",
        "status_chip": "Rolled back",
        "layout": "notice",
        "text_body": """Election Rolled Back

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

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{election_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
<!--[if mso]></td></tr></table><![endif]-->""",
    },
    "event_cancellation": {
        "subject": "Event Cancelled: {{event_title}} — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#1d4ed8",
        "status_chip": "Cancelled",
        "layout": "notice",
        "text_body": """Event Cancelled

Hello {{recipient_name}},

The following event has been cancelled:

Event: {{event_title}}
Original Date: {{event_date}}
Reason: {{reason}}

Please update your calendar accordingly.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "event_reminder": {
        "subject": "Reminder: {{event_title}} — {{event_start}}",
        "footer_key": None,
        "header_accent": "#1d4ed8",
        "status_chip": "Reminder",
        "layout": "notice",
        "text_body": """Event Reminder

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "event_request_status": {
        "subject": "Event Request Update — {{status_label}}",
        "footer_key": "public",
        "header_accent": "#1d4ed8",
        "status_chip": "Request update",
        "layout": "notice",
        "text_body": """Event Request Update

Hello {{contact_name}},

Your event request has been updated to: {{status_label}}.

{{details_text}}
{{message}}

Thank you for your request.

{{footer_text}}""",
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "inactivity_warning": {
        "subject": "Inactivity Alert: {{prospect_name}} — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#b45309",
        "status_chip": "Needs attention",
        "layout": "notice",
        "text_body": """Prospective Member Inactivity Alert

Hello {{coordinator_name}},

A prospective member in your pipeline has been inactive and may need attention:

Prospect: {{prospect_name}}
Current Stage: {{pipeline_stage}}
Days Inactive: {{days_inactive}} days
Timeout Threshold: {{timeout_days}} days

Please review their progress and take appropriate action.

View prospect: {{prospect_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{prospect_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "inventory_change": {
        "subject": "Inventory Update — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#b91c1c",
        "status_chip": "Property update",
        "layout": "notice",
        "text_body": """Inventory Change Confirmation — {{organization_name}}

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
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "it_password_notification": {
        "subject": "[IT Notice] Password Reset Requested — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#334155",
        "status_chip": "Security",
        "layout": "notice",
        "text_body": """IT Notice: Password Reset Requested

A password reset has been requested for the following user:

User: {{user_name}}
Email: {{user_email}}
Requested at: {{request_time}}
IP Address: {{ip_address}}

This is an informational notice. No action is required unless the request appears suspicious.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{user_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "member_archived": {
        "subject": "Member Archived: {{member_name}} — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#b91c1c",
        "status_chip": "Member archived",
        "layout": "notice",
        "text_body": """Member Archived: {{member_name}}

All department property has been returned. Previous status: {{previous_status}}.

The member's profile remains accessible for legal requests or future reactivation.

{{footer_text}}""",
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "member_dropped": {
        "subject": "Notice of Department Property Return — {{organization_name}}",
        "footer_key": "official",
        "header_accent": "#b91c1c",
        "status_chip": "Property return",
        "layout": "notice",
        "text_body": """Department Property Return Notice

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}} · ${{total_value}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "password_reset": {
        "subject": "Password Reset — {{organization_name}}",
        "footer_key": None,
        "header_accent": "#334155",
        "status_chip": "Security",
        "layout": "notice",
        "text_body": """Password Reset Request

Hello {{first_name}},

We received a request to reset your password for {{organization_name}}.

Click the link below to set a new password. This link will expire in {{expiry_minutes}} minutes.

Reset your password: {{reset_url}}

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

{{footer_text}}""",
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "post_event_validation": {
        "subject": "Attendance Validation Needed: {{event_title}}",
        "footer_key": None,
        "header_accent": "#1d4ed8",
        "status_chip": "Action required",
        "layout": "notice",
        "text_body": """Please Validate Attendance

Hello {{recipient_name}},

The following event has ended and needs attendance validation:

Event: {{event_title}}
Date: {{event_date}}
Recorded Attendees: {{attendee_count}}

Please review and validate the attendance records.

Validate attendance: {{validation_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{event_title}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "post_shift_validation": {
        "subject": "Shift Validation Needed: {{shift_name}} — {{shift_date}}",
        "footer_key": None,
        "header_accent": "#047857",
        "status_chip": "Action required",
        "layout": "notice",
        "text_body": """Shift Attendance Validation

Hello {{recipient_name}},

The following shift has ended and needs attendance validation:

Shift: {{shift_name}}
Date: {{shift_date}}
Members on Shift: {{attendee_count}}

Please review and confirm the shift attendance.

Validate shift: {{validation_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "property_return_reminder": {
        "subject": "Property Return Reminder — {{organization_name}}",
        "footer_key": "official",
        "header_accent": "#b91c1c",
        "status_chip": "Reminder",
        "layout": "notice",
        "text_body": """Property Return Reminder

Dear {{member_name}},

This is a reminder that you still have outstanding department property that needs to be returned.

Outstanding Items: {{item_count}} item(s)
Total Assessed Value: ${{total_value}}
Days Since Separation: {{days_since_drop}}
Return Deadline: {{return_deadline}}

{{items_list_text}}

Please contact the department administration to arrange return of these items.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{return_deadline}} · ${{total_value}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "series_end_reminder": {
        "subject": "Recurring Series Ending Soon: {{event_title}} — Ends {{series_end_date}}",
        "footer_key": None,
        "header_accent": "#1d4ed8",
        "status_chip": "Ending soon",
        "layout": "notice",
        "text_body": """Recurring Series Ending Soon

Hello {{recipient_name}},

This is a reminder that the following recurring event series is scheduled to end in approximately 6 months:

Event: {{event_title}}
Pattern: {{recurrence_pattern}}
Series Ends: {{series_end_date}}
Remaining Occurrences: {{remaining_occurrences}}

If you would like to extend or modify this series, please update the event before the series end date.

View event: {{event_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{series_end_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "shift_assignment": {
        "subject": "Shift Assignment: {{position}} on {{shift_date}}",
        "footer_key": None,
        "header_accent": "#047857",
        "status_chip": "Assignment",
        "layout": "notice",
        "text_body": """New Shift Assignment

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "shift_decline": {
        "subject": "Shift Coverage Needed: {{position}} on {{shift_date}}",
        "footer_key": None,
        "header_accent": "#b45309",
        "status_chip": "Coverage needed",
        "layout": "notice",
        "text_body": """Shift Coverage Needed

{{member_name}} {{action}} the following position. It is now open:

Position: {{position}}
Date: {{shift_date}}

Please assign a replacement so the shift is not left short.

Open the schedule: {{shift_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "shift_reminder": {
        "subject": "Shift Reminder — {{shift_date}} at {{shift_start}}",
        "footer_key": None,
        "header_accent": "#047857",
        "status_chip": "Shift briefing",
        "layout": "notice",
        "text_body": """Start-of-Shift Reminder

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
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{shift_date}} at {{shift_start}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_new_order_admin": {
        "subject": "New store order {{order_number}}",
        "footer_key": None,
        "header_accent": "#6d28d9",
        "status_chip": "New order",
        "layout": "notice",
        "text_body": """{{customer_name}} placed order {{order_number}} for {{order_total}}.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_order_cancelled": {
        "subject": "Order {{order_number}} cancelled",
        "footer_key": None,
        "header_accent": "#b91c1c",
        "status_chip": "Cancelled",
        "layout": "notice",
        "text_body": """Order {{order_number}} was cancelled.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_order_confirmation": {
        "subject": "Order {{order_number}} received",
        "footer_key": None,
        "header_accent": "#6d28d9",
        "status_chip": "Receipt",
        "layout": "receipt",
        "text_body": """Hi {{first_name}},

Thanks for your order from the {{store_name}}.
Order {{order_number}} received. Total {{order_total}}.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Total {{order_total}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_order_update": {
        "subject": "Order {{order_number}}{{status_subject_suffix}}",
        "footer_key": None,
        "header_accent": "#6d28d9",
        "status_chip": "Update",
        "layout": "notice",
        "text_body": """Order {{order_number}}: {{update_message}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_payment_received": {
        "subject": "Payment received — order {{order_number}}",
        "footer_key": None,
        "header_accent": "#047857",
        "status_chip": "Payment received",
        "layout": "notice",
        "text_body": """Payment received for order {{order_number}}.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{order_number}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_payment_reminder": {
        "subject": "Payment reminder — order {{order_number}}",
        "footer_key": None,
        "header_accent": "#b45309",
        "status_chip": "Payment reminder",
        "layout": "receipt",
        "text_body": """Order {{order_number}} has a balance of {{balance_due}}.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{balance_due}} outstanding&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_vendor_order_placed": {
        "subject": "Order placed with the vendor — {{window_name}}",
        "footer_key": None,
        "header_accent": "#6d28d9",
        "status_chip": "With the vendor",
        "layout": "notice",
        "text_body": """The {{window_name}} order has been placed with the vendor.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_window_closed": {
        "subject": "Ordering closed — {{window_name}}",
        "footer_key": None,
        "header_accent": "#6d28d9",
        "status_chip": "Closed",
        "layout": "notice",
        "text_body": """The {{window_name}} order window has closed.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_window_closing": {
        "subject": "Last call — {{window_name}} closes soon",
        "footer_key": None,
        "header_accent": "#b45309",
        "status_chip": "Last call",
        "layout": "notice",
        "text_body": """The {{window_name}} order window closes soon.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "storefront_window_open": {
        "subject": "Store orders are open — {{window_name}}",
        "footer_key": None,
        "header_accent": "#047857",
        "status_chip": "Now open",
        "layout": "notice",
        "text_body": """Store orders are open for {{window_name}}.

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{window_name}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "suggestion_submitted": {
        "subject": "New submission in the {{box_name}} box",
        "footer_key": None,
        "header_accent": "#1d4ed8",
        "status_chip": "Suggestion box",
        "layout": "notice",
        "text_body": """New Suggestion Box Submission

Hello {{recipient_name}},

A new submission was received in the {{box_name}} suggestion box, which you
review. Open it in the Logbook to read it and set its status.

Review it: {{suggestion_url}}

{{footer_text}}""",
        "html_body": """<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
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
    },
    "training_approval": {
        "subject": "Training Approval Needed: {{course_name}} — {{event_date}}",
        "footer_key": None,
        "header_accent": "#b45309",
        "status_chip": "Approval needed",
        "layout": "notice",
        "text_body": """Training Approval Needed

A training event has been submitted and requires your approval:

Course: {{course_name}}
Event: {{event_title}}
Date: {{event_date}}
Attendees: {{attendee_count}}
Submitted by: {{submitter_name}}
Approval Deadline: {{approval_deadline}}

Review and approve: {{approval_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">Due {{approval_deadline}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
    "welcome": {
        "subject": "Welcome to {{organization_name}} — Your Account is Ready",
        "footer_key": None,
        "header_accent": "#047857",
        "status_chip": "Account ready",
        "layout": "notice",
        "text_body": """Welcome to {{organization_name}}

Hello {{first_name}},

Your account has been created for {{organization_name}}. You can now log in and access the system.

Username: {{username}}
Temporary Password: {{temp_password}}

For security, please change your password after your first login.

Log in at: {{login_url}}

{{footer_text}}""",
        "html_body": """<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">{{username}}&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;&#847;&zwnj;&nbsp;&#8199;&shy;</div>
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
    },
}
