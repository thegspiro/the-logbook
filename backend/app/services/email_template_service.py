"""
Email Template Service

Manages CRUD operations for email templates and renders them with context variables.
"""

import html as _html_mod
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.email_template import EmailTemplate, EmailTemplateType

# Default CSS styles shared across all email templates.
# Colour contrast ratios meet WCAG 2.1 AA (4.5:1 for normal text):
#   #333 on #f9fafb = 10.6:1, white on #dc2626 = 4.6:1,
#   white on #2563eb = 4.6:1, #4b5563 on white = 7.5:1.
DEFAULT_CSS = """
body { font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.logo { text-align: center; padding: 16px 0 0 0; }
.logo img { max-height: 80px; max-width: 200px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #4b5563; }
"""

# Variables available to ALL template types (injected automatically)
GLOBAL_VARIABLES: List[Dict[str, str]] = [
    {"name": "organization_name", "description": "Organization name"},
    {
        "name": "organization_logo",
        "description": "Organization logo URL (use in an <img> tag)",
    },
    {
        "name": "organization_mailing_address",
        "description": "Full mailing address (multi-line)",
    },
    {
        "name": "organization_physical_address",
        "description": "Full physical/station address (multi-line)",
    },
    {"name": "organization_phone", "description": "Organization phone number"},
    {"name": "organization_email", "description": "Organization email address"},
]


def get_variables_for_type(
    template_type: Any,
) -> List[Dict[str, str]]:
    """Return the canonical variable list for a given template type.

    Combines ``GLOBAL_VARIABLES`` with the type-specific entries in
    ``TEMPLATE_VARIABLES``.  Accepts either a string or an
    ``EmailTemplateType`` enum value.
    """
    key = template_type.value if hasattr(template_type, "value") else str(template_type)
    return GLOBAL_VARIABLES + TEMPLATE_VARIABLES.get(key, [])


# Variable definitions per template type
TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    "welcome": [
        {"name": "first_name", "description": "Recipient's first name"},
        {"name": "last_name", "description": "Recipient's last name"},
        {"name": "full_name", "description": "Recipient's full name"},
        {"name": "username", "description": "Login username"},
        {"name": "temp_password", "description": "Temporary password"},

        {"name": "login_url", "description": "URL to the login page"},
    ],
    "password_reset": [
        {"name": "first_name", "description": "Recipient's first name"},
        {"name": "reset_url", "description": "Password reset link"},

        {"name": "expiry_minutes", "description": "Minutes until link expires"},
    ],
    "inventory_change": [
        {"name": "first_name", "description": "Member's first name"},

        {"name": "change_date", "description": "Date the changes occurred"},
        {
            "name": "items_issued_html",
            "description": "HTML list of items issued/assigned",
        },
        {"name": "items_returned_html", "description": "HTML list of items returned"},
        {
            "name": "items_issued_text",
            "description": "Plain-text list of items issued/assigned",
        },
        {
            "name": "items_returned_text",
            "description": "Plain-text list of items returned",
        },
    ],
    "member_dropped": [
        {"name": "member_name", "description": "Full name of the dropped member"},

        {
            "name": "drop_type_display",
            "description": "Type of separation (Voluntary/Involuntary)",
        },
        {"name": "reason", "description": "Reason for the status change"},
        {"name": "effective_date", "description": "Date the drop takes effect"},
        {"name": "return_deadline", "description": "Deadline to return all property"},
        {"name": "item_count", "description": "Number of outstanding items"},
        {
            "name": "total_value",
            "description": "Total dollar value of outstanding items",
        },
        {
            "name": "items_list_html",
            "description": "HTML table of outstanding items with name, serial #, asset tag, condition, and value",
        },
        {
            "name": "items_list_text",
            "description": "Plain-text list of outstanding items with details",
        },
        {
            "name": "performed_by_name",
            "description": "Name of the officer who performed the drop",
        },
        {"name": "performed_by_title", "description": "Title/rank of the officer"},
    ],
    "event_reminder": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "event_title", "description": "Title of the event"},
        {"name": "event_type", "description": "Type of event (e.g. Business Meeting)"},
        {"name": "event_start", "description": "Event start date and time"},
        {"name": "event_end", "description": "Event end time"},
        {"name": "location_name", "description": "Event location name"},
        {"name": "location_details", "description": "Additional location details"},
        {"name": "event_url", "description": "Link to view the event"},
    ],
    "series_end_reminder": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "event_title", "description": "Title of the recurring event series"},
        {
            "name": "recurrence_pattern",
            "description": "Recurrence pattern (e.g. Weekly, Monthly)",
        },
        {"name": "series_end_date", "description": "Date the recurring series ends"},
        {
            "name": "remaining_occurrences",
            "description": "Number of remaining occurrences",
        },
        {"name": "event_url", "description": "Link to view the parent event"},
    ],
    "event_cancellation": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "event_title", "description": "Title of the cancelled event"},
        {"name": "event_date", "description": "Original event date"},

        {"name": "reason", "description": "Reason for cancellation"},
    ],
    "training_approval": [
        {"name": "course_name", "description": "Name of the training course"},
        {"name": "event_title", "description": "Title of the training event"},
        {"name": "event_date", "description": "Date/time of the training event"},
        {"name": "attendee_count", "description": "Number of attendees to approve"},
        {"name": "approval_deadline", "description": "Deadline for approval"},
        {"name": "submitter_name", "description": "Name of the person who submitted"},
        {"name": "approval_url", "description": "Link to the approval page"},
    ],
    "ballot_notification": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the election/ballot"},
        {"name": "meeting_date", "description": "Date of the meeting"},
        {"name": "custom_message", "description": "Custom message from secretary"},
        {"name": "ballot_url", "description": "Link to the voting page"},
        {"name": "voting_opens", "description": "Date and time voting opens"},
        {"name": "voting_closes", "description": "Date and time voting closes"},
        {
            "name": "positions",
            "description": "Positions being voted on (comma-separated)",
        },
        {
            "name": "ballot_items_html",
            "description": "HTML list of ballot items the voter is eligible for",
        },
        {
            "name": "ballot_items_text",
            "description": "Plain-text list of ballot items the voter is eligible for",
        },
        {
            "name": "admin_contact_name",
            "description": "Election administrator's name",
        },
        {
            "name": "admin_contact_email",
            "description": "Election administrator's email address",
        },
    ],
    "cert_expiration": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "cert_name", "description": "Name of the certification"},
        {"name": "expiration_date", "description": "Expiration date of the cert"},
        {"name": "days_remaining", "description": "Days until expiration"},

        {"name": "renewal_url", "description": "Link to training/certification page"},
    ],
    "post_event_validation": [
        {"name": "recipient_name", "description": "Event creator's name"},
        {"name": "event_title", "description": "Title of the event"},
        {"name": "event_date", "description": "Date of the event"},
        {"name": "attendee_count", "description": "Number of attendees recorded"},
        {"name": "validation_url", "description": "Link to validate attendance"},

    ],
    "post_shift_validation": [
        {"name": "recipient_name", "description": "Shift officer's name"},
        {"name": "shift_date", "description": "Date of the shift"},
        {"name": "shift_name", "description": "Name/label of the shift"},
        {"name": "attendee_count", "description": "Number of members on shift"},
        {"name": "validation_url", "description": "Link to validate attendance"},

    ],
    "property_return_reminder": [
        {"name": "member_name", "description": "Member's full name"},

        {"name": "item_count", "description": "Number of outstanding items"},
        {"name": "total_value", "description": "Total value of outstanding items"},
        {
            "name": "items_list_html",
            "description": "HTML table of outstanding items with name, serial #, asset tag, and value",
        },
        {
            "name": "items_list_text",
            "description": "Plain-text list of outstanding items with details",
        },
        {"name": "days_since_drop", "description": "Days since membership was dropped"},
        {"name": "return_deadline", "description": "Deadline for returning property"},
    ],
    "inactivity_warning": [
        {"name": "coordinator_name", "description": "Pipeline coordinator's name"},
        {"name": "prospect_name", "description": "Prospective member's name"},
        {"name": "days_inactive", "description": "Number of days inactive"},
        {
            "name": "timeout_days",
            "description": "Configured inactivity timeout threshold in days",
        },
        {"name": "pipeline_stage", "description": "Current pipeline stage"},

        {"name": "prospect_url", "description": "Link to prospect profile"},
    ],
    "election_rollback": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the election"},
        {"name": "performer_name", "description": "Name of the person who rolled back"},
        {"name": "reason", "description": "Reason for the rollback"},

    ],
    "election_deleted": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the deleted election"},
        {"name": "performer_name", "description": "Name of the person who deleted it"},
        {"name": "reason", "description": "Reason for deletion"},

    ],
    "election_report": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the election"},
        {"name": "election_type", "description": "Type of election"},
        {"name": "start_date", "description": "Voting start date"},
        {"name": "end_date", "description": "Voting end date"},
        {"name": "total_eligible_voters", "description": "Number of eligible voters"},
        {"name": "total_votes_cast", "description": "Number of votes cast"},
        {
            "name": "voter_turnout_percentage",
            "description": "Voter turnout as a percentage",
        },
        {"name": "quorum_status", "description": "Whether quorum was met"},
        {"name": "quorum_detail", "description": "Quorum requirement details"},
        {
            "name": "results_html",
            "description": "HTML table of election results by position",
        },
        {
            "name": "results_text",
            "description": "Plain-text election results by position",
        },
        {
            "name": "ballot_recipients_html",
            "description": "HTML list of members who received ballots",
        },
        {
            "name": "ballot_recipients_text",
            "description": "Plain-text list of members who received ballots",
        },
        {
            "name": "skipped_voters_html",
            "description": "HTML table of members who did not receive ballots with reasons",
        },
        {
            "name": "skipped_voters_text",
            "description": "Plain-text list of members who did not receive ballots with reasons",
        },

    ],
    "member_archived": [
        {"name": "member_name", "description": "Archived member's full name"},
        {"name": "previous_status", "description": "Member's status before archival"},

    ],
    "event_request_status": [
        {"name": "contact_name", "description": "Requester's name"},
        {"name": "status_label", "description": "New request status"},
        {"name": "event_date", "description": "Scheduled event date (if set)"},
        {"name": "decline_reason", "description": "Reason for decline (if applicable)"},
        {"name": "message", "description": "Additional message from coordinator"},

    ],
    "it_password_notification": [
        {
            "name": "user_name",
            "description": "Name of the user who requested the reset",
        },
        {"name": "user_email", "description": "Email of the user"},
        {"name": "request_time", "description": "Time the request was made"},
        {"name": "ip_address", "description": "IP address of the request"},

    ],
    "duplicate_application": [
        {"name": "applicant_name", "description": "Applicant's full name"},

        {
            "name": "original_date",
            "description": "Date the original application was received",
        },
    ],
}

# Sample context data for previewing each template type.
# Used by the preview endpoint to substitute realistic placeholder values.
# Shared organization fields are merged from _SAMPLE_ORG_CONTEXT.
_SAMPLE_ORG_CONTEXT: Dict[str, str] = {
    "organization_name": "Sample Fire Department",
    "organization_logo": "https://example.com/logo.png",
    "organization_mailing_address": "100 Main Street\nAnytown, CA 90210",
    "organization_physical_address": "100 Main Street\nAnytown, CA 90210",
    "organization_phone": "(555) 555-1234",
    "organization_email": "info@samplefd.org",
}


def _sample(*dicts: Dict[str, str]) -> Dict[str, str]:
    """Merge sample org context with type-specific fields."""
    merged = dict(_SAMPLE_ORG_CONTEXT)
    for d in dicts:
        merged.update(d)
    return merged


SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    "welcome": _sample({
        "first_name": "John",
        "last_name": "Doe",
        "full_name": "John Doe",
        "username": "jdoe",
        "temp_password": "TempPass123!",
        "login_url": "https://example.com/login",
    }),
    "password_reset": _sample({
        "first_name": "John",
        "reset_url": "https://example.com/reset-password?token=sample-token",
        "expiry_minutes": "30",
    }),
    "event_reminder": _sample({
        "recipient_name": "John Doe",
        "event_title": "Monthly Business Meeting",
        "event_type": "Business Meeting",
        "event_start": "March 15, 2026 at 07:00 PM",
        "event_end": "09:00 PM",
        "location_name": "Main Station \u2014 Meeting Room A",
        "location_details": "123 Main St, Anytown, USA",
        "event_url": "https://example.com/events/123",
    }),
    "series_end_reminder": _sample({
        "recipient_name": "John Doe",
        "event_title": "Weekly Officers Meeting",
        "recurrence_pattern": "Weekly",
        "series_end_date": "September 15, 2026",
        "remaining_occurrences": "26",
        "event_url": "https://example.com/events/456",
    }),
    "event_cancellation": _sample({
        "recipient_name": "John Doe",
        "event_title": "Monthly Business Meeting",
        "event_date": "March 15, 2026",
        "reason": "Inclement weather",
    }),
    "training_approval": _sample({
        "course_name": "Hazardous Materials Awareness",
        "event_title": "HazMat Refresher Training",
        "event_date": "March 20, 2026 at 09:00 AM",
        "attendee_count": "12",
        "approval_deadline": "March 18, 2026",
        "submitter_name": "Jane Smith",
        "approval_url": "https://example.com/training/approve/123",
    }),
    "ballot_notification": _sample({
        "recipient_name": "John Doe",
        "election_title": "Captain Election 2026",
        "meeting_date": "April 1, 2026 at 07:00 PM",
        "custom_message": "Please review the candidates before voting.",
        "ballot_url": "https://example.com/ballot?token=sample-token",
        "voting_opens": "March 28, 2026 at 08:00 AM",
        "voting_closes": "April 1, 2026 at 05:00 PM",
        "positions": "Captain, Lieutenant",
        "ballot_items_html": (
            "<ul>"
            "<li><strong>Captain</strong> — Officer Election (candidate selection)</li>"
            "<li><strong>Lieutenant</strong> — Officer Election (candidate selection)</li>"
            "</ul>"
        ),
        "ballot_items_text": (
            "  - Captain — Officer Election (candidate selection)\n"
            "  - Lieutenant — Officer Election (candidate selection)"
        ),
        "admin_contact_name": "FCVFD Secretary",
        "admin_contact_email": "secretary@samplefd.org",
    }),
    "member_dropped": _sample({
        "member_name": "John Doe",
        "drop_type_display": "Voluntary Separation",
        "reason": "Relocation",
        "effective_date": "March 31, 2026",
        "return_deadline": "April 14, 2026",
        "item_count": "5",
        "total_value": "2,450.00",
        "items_list_html": (
            '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
            '<thead><tr style="background-color:#374151;color:white;">'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">#</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Item</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Serial #</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Asset Tag</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Condition</th>'
            '<th style="padding:8px 10px;text-align:right;font-size:12px;">Value</th>'
            "</tr></thead><tbody>"
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">1</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Turnout Coat (Size L)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">TC-2024-0456</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">TCOAT-012</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Good</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$850.00</td></tr>'
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">2</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Turnout Pants (Size L)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">TP-2024-0789</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">TPANT-012</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Good</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$650.00</td></tr>'
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">3</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Helmet (Black)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">HLM-2024-0089</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">HLM-089</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Excellent</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$450.00</td></tr>'
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">4</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">SCBA Mask</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">SCBA-2023-0234</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">SCBA-234</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Fair</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$350.00</td></tr>'
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">5</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Radio (Portable)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">RAD-2024-0567</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">RAD-567</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Good</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$150.00</td></tr>'
            "</tbody>"
            '<tfoot><tr style="font-weight:bold;background-color:#f3f4f6;">'
            '<td colspan="5" style="padding:8px 10px;text-align:right;">Total Outstanding Value:</td>'
            '<td style="padding:8px 10px;text-align:right;">$2,450.00</td>'
            "</tr></tfoot></table>"
        ),
        "items_list_text": (
            "Outstanding Items:\n"
            "  1. Turnout Coat (Size L) — Serial: TC-2024-0456 — Asset Tag: TCOAT-012 — Condition: Good — $850.00\n"
            "  2. Turnout Pants (Size L) — Serial: TP-2024-0789 — Asset Tag: TPANT-012 — Condition: Good — $650.00\n"
            "  3. Helmet (Black) — Serial: HLM-2024-0089 — Asset Tag: HLM-089 — Condition: Excellent — $450.00\n"
            "  4. SCBA Mask — Serial: SCBA-2023-0234 — Asset Tag: SCBA-234 — Condition: Fair — $350.00\n"
            "  5. Radio (Portable) — Serial: RAD-2024-0567 — Asset Tag: RAD-567 — Condition: Good — $150.00\n"
            "\n"
            "Total Outstanding Value: $2,450.00"
        ),
        "performed_by_name": "Chief Robert Johnson",
        "performed_by_title": "Fire Chief",
    }),
    "inventory_change": _sample({
        "first_name": "John",
        "change_date": "March 1, 2026",
        "items_issued_html": (
            "<h3>Items Issued</h3>"
            "<ul><li>Turnout Coat (Size L) \u2014 Serial #TC-2024-0456</li>"
            "<li>Helmet (Black) \u2014 Serial #HLM-2024-0089</li></ul>"
        ),
        "items_returned_html": (
            "<h3>Items Returned</h3>"
            "<ul><li>Old Turnout Coat (Size L) \u2014 Serial #TC-2020-0123</li></ul>"
        ),
        "items_issued_text": (
            "Items Issued:\n"
            "- Turnout Coat (Size L) \u2014 Serial #TC-2024-0456\n"
            "- Helmet (Black) \u2014 Serial #HLM-2024-0089"
        ),
        "items_returned_text": (
            "Items Returned:\n"
            "- Old Turnout Coat (Size L) \u2014 Serial #TC-2020-0123"
        ),
    }),
    "cert_expiration": _sample({
        "recipient_name": "John Doe",
        "cert_name": "EMT-Basic Certification",
        "expiration_date": "April 15, 2026",
        "days_remaining": "45",
        "renewal_url": "https://example.com/training/certifications",
    }),
    "post_event_validation": _sample({
        "recipient_name": "Jane Smith",
        "event_title": "Monthly Business Meeting",
        "event_date": "March 15, 2026",
        "attendee_count": "24",
        "validation_url": "https://example.com/events/123/validate",
    }),
    "post_shift_validation": _sample({
        "recipient_name": "Capt. Mike Davis",
        "shift_date": "March 14, 2026",
        "shift_name": "Engine 1 \u2014 Night Shift",
        "attendee_count": "6",
        "validation_url": "https://example.com/scheduling/shifts/456/validate",
    }),
    "property_return_reminder": _sample({
        "member_name": "John Doe",
        "item_count": "3",
        "total_value": "1,200.00",
        "items_list_html": (
            '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
            '<thead><tr style="background-color:#374151;color:white;">'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">#</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Item</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Serial #</th>'
            '<th style="padding:8px 10px;text-align:left;font-size:12px;">Asset Tag</th>'
            '<th style="padding:8px 10px;text-align:right;font-size:12px;">Value</th>'
            "</tr></thead><tbody>"
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">1</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Turnout Coat (Size L)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">TC-2024-0456</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">TCOAT-012</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$500.00</td></tr>'
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">2</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Helmet (Black)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">HLM-2024-0089</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">HLM-089</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$450.00</td></tr>'
            '<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">3</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Radio (Portable)</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">RAD-2024-0567</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">RAD-567</td>'
            '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$250.00</td></tr>'
            "</tbody>"
            '<tfoot><tr style="font-weight:bold;background-color:#f3f4f6;">'
            '<td colspan="4" style="padding:8px 10px;text-align:right;">Total Outstanding Value:</td>'
            '<td style="padding:8px 10px;text-align:right;">$1,200.00</td>'
            "</tr></tfoot></table>"
        ),
        "items_list_text": (
            "Outstanding Items:\n"
            "  1. Turnout Coat (Size L) — Serial: TC-2024-0456 — Asset Tag: TCOAT-012 — $500.00\n"
            "  2. Helmet (Black) — Serial: HLM-2024-0089 — Asset Tag: HLM-089 — $450.00\n"
            "  3. Radio (Portable) — Serial: RAD-2024-0567 — Asset Tag: RAD-567 — $250.00\n"
            "\n"
            "Total Outstanding Value: $1,200.00"
        ),
        "days_since_drop": "30",
        "return_deadline": "April 30, 2026",
    }),
    "inactivity_warning": _sample({
        "coordinator_name": "Jane Smith",
        "prospect_name": "Alex Johnson",
        "days_inactive": "21",
        "timeout_days": "30",
        "pipeline_stage": "Application Review",
        "prospect_url": "https://example.com/prospective-members/789",
    }),
    "election_rollback": _sample({
        "recipient_name": "Lt. Jane Smith",
        "election_title": "Captain Election 2026",
        "performer_name": "Secretary Robert Johnson",
        "reason": "Ballots were distributed to ineligible members",
    }),
    "election_deleted": _sample({
        "recipient_name": "Lt. Jane Smith",
        "election_title": "Captain Election 2026",
        "performer_name": "Secretary Robert Johnson",
        "reason": "Election created in error — new election will be scheduled",
    }),
    "election_report": _sample({
        "recipient_name": "Secretary Robert Johnson",
        "election_title": "Captain Election 2026",
        "election_type": "Officer Election",
        "start_date": "March 28, 2026 at 08:00 AM",
        "end_date": "April 1, 2026 at 05:00 PM",
        "total_eligible_voters": "45",
        "total_votes_cast": "38",
        "voter_turnout_percentage": "84.4",
        "quorum_status": "Quorum Met",
        "quorum_detail": "Quorum requires 50% turnout. Actual: 84.4% (38/45).",
        "results_html": (
            '<table style="width:100%;border-collapse:collapse;margin:10px 0;">'
            '<tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Position</th>'
            '<th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Candidate</th>'
            '<th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Votes</th>'
            '<th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">%</th>'
            '<th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Result</th></tr>'
            '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Captain</td>'
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">John Smith</td>'
            '<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">22</td>'
            '<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">57.9%</td>'
            '<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">\u2705 Elected</td></tr>'
            '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Captain</td>'
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">Jane Doe</td>'
            '<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">16</td>'
            '<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">42.1%</td>'
            '<td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;">&mdash;</td></tr>'
            "</table>"
        ),
        "results_text": (
            "Position: Captain\n"
            "  John Smith — 22 votes (57.9%) — ELECTED\n"
            "  Jane Doe — 16 votes (42.1%)"
        ),
        "ballot_recipients_html": (
            "<ul>"
            "<li>John Smith (jsmith@example.com)</li>"
            "<li>Jane Doe (jdoe@example.com)</li>"
            "<li>Mike Wilson (mwilson@example.com)</li>"
            "<li>... and 35 others</li>"
            "</ul>"
        ),
        "ballot_recipients_text": (
            "  - John Smith (jsmith@example.com)\n"
            "  - Jane Doe (jdoe@example.com)\n"
            "  - Mike Wilson (mwilson@example.com)\n"
            "  ... and 35 others"
        ),
        "skipped_voters_html": (
            '<table style="width:100%;border-collapse:collapse;margin:10px 0;">'
            '<tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Member</th>'
            '<th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Reason</th></tr>'
            '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Tom Brown</td>'
            "<td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">Membership tier 'Social' is not eligible to vote</td></tr>"
            '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Sarah Lee</td>'
            '<td style="padding:8px;border-bottom:1px solid #e5e7eb;">Not checked in as present at the meeting</td></tr>'
            "</table>"
        ),
        "skipped_voters_text": (
            "  - Tom Brown: Membership tier 'Social' is not eligible to vote\n"
            "  - Sarah Lee: Not checked in as present at the meeting"
        ),
    }),
    "member_archived": _sample({
        "member_name": "John Doe",
        "previous_status": "Dropped",
    }),
    "event_request_status": _sample({
        "contact_name": "John Doe",
        "status_label": "Scheduled",
        "event_date": "April 15, 2026 at 06:00 PM",
        "decline_reason": "",
        "message": "Your event has been approved and added to the calendar.",
    }),
    "it_password_notification": _sample({
        "user_name": "John Doe",
        "user_email": "jdoe@example.com",
        "request_time": "March 1, 2026 at 02:30 PM",
        "ip_address": "192.168.1.100",
    }),
    "duplicate_application": _sample({
        "applicant_name": "Alex Johnson",
        "original_date": "February 15, 2026",
    }),
}

# Default welcome email HTML body
DEFAULT_WELCOME_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Welcome to {{organization_name}}</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>Your account has been created for <strong>{{organization_name}}</strong>. You can now log in and access the system.</p>

        <div class="details" role="region" aria-label="Account credentials">
            <p><strong>Username:</strong> {{username}}</p>
            <p><strong>Temporary Password:</strong> {{temp_password}}</p>
        </div>

        <p>For security, please change your password after your first login.</p>

        <p style="text-align: center;">
            <a href="{{login_url}}" class="button" role="link">Log In Now</a>
        </p>

        <p><small>If the button doesn't work, copy and paste this URL into your browser:<br/>{{login_url}}</small></p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_WELCOME_TEXT = """Welcome to {{organization_name}}

Hello {{first_name}},

Your account has been created for {{organization_name}}. You can now log in and access the system.

Username: {{username}}
Temporary Password: {{temp_password}}

For security, please change your password after your first login.

Log in at: {{login_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_WELCOME_SUBJECT = "Welcome to {{organization_name}} — Your Account is Ready"

# Default password reset email
DEFAULT_PASSWORD_RESET_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Password Reset Request</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>.</p>

        <p>Click the button below to set a new password. This link will expire in <strong>{{expiry_minutes}} minutes</strong>.</p>

        <p style="text-align: center;">
            <a href="{{reset_url}}" class="button" role="link">Reset Password</a>
        </p>

        <p><small>If the button doesn't work, copy and paste this URL into your browser:<br/>{{reset_url}}</small></p>

        <p>If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_PASSWORD_RESET_TEXT = """Password Reset Request

Hello {{first_name}},

We received a request to reset your password for {{organization_name}}.

Click the link below to set a new password. This link will expire in {{expiry_minutes}} minutes.

Reset your password: {{reset_url}}

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_PASSWORD_RESET_SUBJECT = "Password Reset — {{organization_name}}"

# Default member dropped / property return email template
DEFAULT_MEMBER_DROPPED_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>{{organization_name}}</h1>
    </div>
    <div class="content">
        <p><strong>Re: {{drop_type_display}} — Notice of Department Property Return</strong></p>
        <p>Dear {{member_name}},</p>
        <p>
            This message serves as formal notice that your membership status with
            <strong>{{organization_name}}</strong> has been changed to
            <strong>{{drop_type_display}}</strong> effective <strong>{{effective_date}}</strong>.
        </p>
        <p><strong>Reason:</strong> {{reason}}</p>
        <div class="details">
            <p><strong>Outstanding Items:</strong> {{item_count}} item(s)</p>
            <p><strong>Total Assessed Value:</strong> ${{total_value}}</p>
            <p><strong>Return Deadline:</strong> {{return_deadline}}</p>
        </div>

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
    </div>
    <div class="footer">
        <p>This is an official department notice. A copy has been placed in your member file.</p>
    </div>
</div>"""

DEFAULT_MEMBER_DROPPED_TEXT = """Notice of Department Property Return

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

---
This is an official department notice. A copy has been placed in your member file."""

# Default inventory change notification email
DEFAULT_INVENTORY_CHANGE_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>{{organization_name}}</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>
        <p>
            This message is to confirm recent changes to the department property
            assigned to you as of <strong>{{change_date}}</strong>.
        </p>

        {{items_issued_html}}

        {{items_returned_html}}

        <div class="details">
            <p><strong>Important Reminder:</strong> All items listed above remain
            the property of <strong>{{organization_name}}</strong>. Members are
            responsible for the care, maintenance, and safekeeping of all
            department-issued property. Any lost, stolen, or damaged items
            must be reported to the Quartermaster immediately.</p>
        </div>

        <p>If you believe there is an error in this notice, please contact the
        Quartermaster or department administration at your earliest convenience.</p>

        <p>Thank you,<br/>{{organization_name}}</p>
    </div>
    <div class="footer">
        <p>This is an automated inventory notice from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_INVENTORY_CHANGE_TEXT = """Inventory Change Confirmation — {{organization_name}}

Hello {{first_name}},

This message is to confirm recent changes to the department property
assigned to you as of {{change_date}}.

{{items_issued_text}}

{{items_returned_text}}

IMPORTANT REMINDER: All items listed above remain the property of
{{organization_name}}. Members are responsible for the care, maintenance,
and safekeeping of all department-issued property. Any lost, stolen, or
damaged items must be reported to the Quartermaster immediately.

If you believe there is an error in this notice, please contact the
Quartermaster or department administration at your earliest convenience.

Thank you,
{{organization_name}}

---
This is an automated inventory notice from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_INVENTORY_CHANGE_SUBJECT = "Inventory Update — {{organization_name}}"

# Default certification expiration alert email
DEFAULT_CERT_EXPIRATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Certification Expiration Notice</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>This is a reminder that your certification is approaching its expiration date:</p>

        <div class="details">
            <p><strong>Certification:</strong> {{cert_name}}</p>
            <p><strong>Expiration Date:</strong> {{expiration_date}}</p>
            <p><strong>Days Remaining:</strong> {{days_remaining}}</p>
        </div>

        <p>Please take action to renew this certification before it expires to maintain your compliance status.</p>

        <p style="text-align: center;">
            <a href="{{renewal_url}}" class="button" role="link">View Certifications</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_CERT_EXPIRATION_TEXT = """Certification Expiration Notice

Hello {{recipient_name}},

This is a reminder that your certification is approaching its expiration date:

Certification: {{cert_name}}
Expiration Date: {{expiration_date}}
Days Remaining: {{days_remaining}}

Please take action to renew this certification before it expires.

View your certifications: {{renewal_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_CERT_EXPIRATION_SUBJECT = (
    "Certification Expiring: {{cert_name}} — {{organization_name}}"
)

# Default post-event validation email
DEFAULT_POST_EVENT_VALIDATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Please Validate Attendance</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>The following event has ended and needs attendance validation:</p>

        <div class="details">
            <p><strong>Event:</strong> {{event_title}}</p>
            <p><strong>Date:</strong> {{event_date}}</p>
            <p><strong>Recorded Attendees:</strong> {{attendee_count}}</p>
        </div>

        <p>Please review and validate the attendance records at your earliest convenience.</p>

        <p style="text-align: center;">
            <a href="{{validation_url}}" class="button" role="link">Validate Attendance</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_POST_EVENT_VALIDATION_TEXT = """Please Validate Attendance

Hello {{recipient_name}},

The following event has ended and needs attendance validation:

Event: {{event_title}}
Date: {{event_date}}
Recorded Attendees: {{attendee_count}}

Please review and validate the attendance records.

Validate attendance: {{validation_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_POST_EVENT_VALIDATION_SUBJECT = "Attendance Validation Needed: {{event_title}}"

# Default post-shift validation email
DEFAULT_POST_SHIFT_VALIDATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Shift Attendance Validation</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>The following shift has ended and needs attendance validation:</p>

        <div class="details">
            <p><strong>Shift:</strong> {{shift_name}}</p>
            <p><strong>Date:</strong> {{shift_date}}</p>
            <p><strong>Members on Shift:</strong> {{attendee_count}}</p>
        </div>

        <p>Please review and confirm the shift attendance.</p>

        <p style="text-align: center;">
            <a href="{{validation_url}}" class="button" role="link">Validate Shift</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_POST_SHIFT_VALIDATION_TEXT = """Shift Attendance Validation

Hello {{recipient_name}},

The following shift has ended and needs attendance validation:

Shift: {{shift_name}}
Date: {{shift_date}}
Members on Shift: {{attendee_count}}

Please review and confirm the shift attendance.

Validate shift: {{validation_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_POST_SHIFT_VALIDATION_SUBJECT = (
    "Shift Validation Needed: {{shift_name}} — {{shift_date}}"
)

# Default property return reminder email
DEFAULT_PROPERTY_RETURN_REMINDER_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>{{organization_name}}</h1>
    </div>
    <div class="content">
        <p><strong>Re: Department Property Return Reminder</strong></p>
        <p>Dear {{member_name}},</p>

        <p>This is a reminder that you still have outstanding department property that needs to be returned.</p>

        <div class="details">
            <p><strong>Outstanding Items:</strong> {{item_count}} item(s)</p>
            <p><strong>Total Assessed Value:</strong> ${{total_value}}</p>
            <p><strong>Days Since Separation:</strong> {{days_since_drop}}</p>
            <p><strong>Return Deadline:</strong> {{return_deadline}}</p>
        </div>

        {{items_list_html}}

        <p>Please contact the department administration to arrange return of these items as soon as possible.</p>
    </div>
    <div class="footer">
        <p>This is an official department notice from {{organization_name}}.</p>
    </div>
</div>"""

DEFAULT_PROPERTY_RETURN_REMINDER_TEXT = """Department Property Return Reminder

Dear {{member_name}},

This is a reminder that you still have outstanding department property that needs to be returned.

Outstanding Items: {{item_count}} item(s)
Total Assessed Value: ${{total_value}}
Days Since Separation: {{days_since_drop}}
Return Deadline: {{return_deadline}}

{{items_list_text}}

Please contact the department administration to arrange return of these items.

---
This is an official department notice from {{organization_name}}."""

DEFAULT_PROPERTY_RETURN_REMINDER_SUBJECT = (
    "Property Return Reminder — {{organization_name}}"
)

# Default inactivity warning email
DEFAULT_INACTIVITY_WARNING_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Prospective Member Inactivity Alert</h1>
    </div>
    <div class="content">
        <p>Hello {{coordinator_name}},</p>

        <p>A prospective member in your pipeline has been inactive and may need attention:</p>

        <div class="details">
            <p><strong>Prospect:</strong> {{prospect_name}}</p>
            <p><strong>Current Stage:</strong> {{pipeline_stage}}</p>
            <p><strong>Days Inactive:</strong> {{days_inactive}} days</p>
            <p><strong>Timeout Threshold:</strong> {{timeout_days}} days</p>
        </div>

        <p>Please review their progress and take appropriate action.</p>

        <p style="text-align: center;">
            <a href="{{prospect_url}}" class="button" role="link">View Prospect</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_INACTIVITY_WARNING_TEXT = """Prospective Member Inactivity Alert

Hello {{coordinator_name}},

A prospective member in your pipeline has been inactive and may need attention:

Prospect: {{prospect_name}}
Current Stage: {{pipeline_stage}}
Days Inactive: {{days_inactive}} days
Timeout Threshold: {{timeout_days}} days

Please review their progress and take appropriate action.

View prospect: {{prospect_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_INACTIVITY_WARNING_SUBJECT = (
    "Inactivity Alert: {{prospect_name}} — {{organization_name}}"
)

# Default election rollback alert email
DEFAULT_ELECTION_ROLLBACK_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #dc2626;">
        <h1>Election Rolled Back</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>An election has been rolled back to a previous stage:</p>

        <div class="details">
            <p><strong>Election:</strong> {{election_title}}</p>
            <p><strong>Rolled back by:</strong> {{performer_name}}</p>
            <p><strong>Reason:</strong> {{reason}}</p>
        </div>

        <p>Please review the election details and coordinate with your team as needed.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
    </div>
</div>"""

DEFAULT_ELECTION_ROLLBACK_TEXT = """Election Rolled Back

Hello {{recipient_name}},

An election has been rolled back to a previous stage:

Election: {{election_title}}
Rolled back by: {{performer_name}}
Reason: {{reason}}

Please review the election details and coordinate with your team as needed.

---
This is an automated message from {{organization_name}}."""

DEFAULT_ELECTION_ROLLBACK_SUBJECT = "ALERT: Election Rolled Back — {{election_title}}"

# Default election deleted alert email
DEFAULT_ELECTION_DELETED_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #dc2626;">
        <h1>Election Deleted</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>An election has been permanently deleted:</p>

        <div class="details">
            <p><strong>Election:</strong> {{election_title}}</p>
            <p><strong>Deleted by:</strong> {{performer_name}}</p>
            <p><strong>Reason:</strong> {{reason}}</p>
        </div>

        <p>All associated ballots and results have been removed. If you have questions, please contact {{performer_name}}.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
    </div>
</div>"""

DEFAULT_ELECTION_DELETED_TEXT = """Election Deleted

Hello {{recipient_name}},

An election has been permanently deleted:

Election: {{election_title}}
Deleted by: {{performer_name}}
Reason: {{reason}}

All associated ballots and results have been removed.

---
This is an automated message from {{organization_name}}."""

DEFAULT_ELECTION_DELETED_SUBJECT = "CRITICAL: Election Deleted — {{election_title}}"

# Default member archived notification email
DEFAULT_MEMBER_ARCHIVED_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Member Archived</h1>
    </div>
    <div class="content">
        <p><strong>{{member_name}}</strong> has been automatically archived.</p>

        <p>All department property has been returned. Previous status: <strong>{{previous_status}}</strong>.</p>

        <p>The member's profile remains accessible for legal requests or future reactivation.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
    </div>
</div>"""

DEFAULT_MEMBER_ARCHIVED_TEXT = """Member Archived: {{member_name}}

All department property has been returned. Previous status: {{previous_status}}.

The member's profile remains accessible for legal requests or future reactivation.

---
This is an automated message from {{organization_name}}."""

DEFAULT_MEMBER_ARCHIVED_SUBJECT = (
    "Member Archived: {{member_name}} — {{organization_name}}"
)

# Default event request status update email
DEFAULT_EVENT_REQUEST_STATUS_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Event Request Update</h1>
    </div>
    <div class="content">
        <p>Hello {{contact_name}},</p>

        <p>Your event request has been updated to: <strong>{{status_label}}</strong>.</p>

        <div class="details">
            <p><strong>Scheduled Date:</strong> {{event_date}}</p>
            <p><strong>Reason:</strong> {{decline_reason}}</p>
            <p><strong>Message:</strong> {{message}}</p>
        </div>

        <p>Thank you for your request.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
    </div>
</div>"""

DEFAULT_EVENT_REQUEST_STATUS_TEXT = """Event Request Update

Hello {{contact_name}},

Your event request has been updated to: {{status_label}}.

Scheduled Date: {{event_date}}
Reason: {{decline_reason}}
Message: {{message}}

Thank you for your request.

---
This is an automated message from {{organization_name}}."""

DEFAULT_EVENT_REQUEST_STATUS_SUBJECT = "Event Request Update — {{status_label}}"

# Default IT password reset notification email
DEFAULT_IT_PASSWORD_NOTIFICATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>IT Notice: Password Reset Requested</h1>
    </div>
    <div class="content">
        <p>A password reset has been requested for the following user:</p>

        <div class="details">
            <p><strong>User:</strong> {{user_name}}</p>
            <p><strong>Email:</strong> {{user_email}}</p>
            <p><strong>Requested at:</strong> {{request_time}}</p>
            <p><strong>IP Address:</strong> {{ip_address}}</p>
        </div>

        <p>This is an informational notice. No action is required unless the request appears suspicious.</p>
    </div>
    <div class="footer">
        <p>This is an automated IT security notice from {{organization_name}}.</p>
    </div>
</div>"""

DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT = """IT Notice: Password Reset Requested

A password reset has been requested for the following user:

User: {{user_name}}
Email: {{user_email}}
Requested at: {{request_time}}
IP Address: {{ip_address}}

This is an informational notice. No action is required unless the request appears suspicious.

---
This is an automated IT security notice from {{organization_name}}."""

DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT = (
    "[IT Notice] Password Reset Requested — {{organization_name}}"
)

# Default duplicate application notification email
DEFAULT_DUPLICATE_APPLICATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Application Already on File</h1>
    </div>
    <div class="content">
        <p>Hello {{applicant_name}},</p>

        <p>Thank you for your interest in joining {{organization_name}}.</p>

        <p>Our records show that we already have an application on file for
        this email address, originally received on <strong>{{original_date}}</strong>.
        A duplicate application has not been created.</p>

        <p>If you believe this is an error, or if you have questions about the
        status of your application, please contact us directly.</p>
    </div>
    <div class="footer">
        <p>{{organization_name}}</p>
        <p>{{organization_phone}}</p>
        <p>{{organization_email}}</p>
    </div>
</div>"""

DEFAULT_DUPLICATE_APPLICATION_TEXT = """Application Already on File

Hello {{applicant_name}},

Thank you for your interest in joining {{organization_name}}.

Our records show that we already have an application on file for this
email address, originally received on {{original_date}}. A duplicate
application has not been created.

If you believe this is an error, or if you have questions about the
status of your application, please contact us directly.

---
{{organization_name}}
{{organization_phone}}
{{organization_email}}"""

DEFAULT_DUPLICATE_APPLICATION_SUBJECT = (
    "Application Already on File — {{organization_name}}"
)

# Default ballot notification email
DEFAULT_BALLOT_NOTIFICATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #4f46e5;">
        <h1>{{election_title}}</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>A ballot is now available for your review and vote.</p>

        <div class="details">
            <p><strong>Election:</strong> {{election_title}}</p>
            <p><strong>Meeting Date:</strong> {{meeting_date}}</p>
            <p><strong>Voting Opens:</strong> {{voting_opens}}</p>
            <p><strong>Voting Closes:</strong> {{voting_closes}}</p>
        </div>

        <p><strong>Your Ballot Items:</strong></p>
        {{ballot_items_html}}

        {{custom_message_html}}

        <p style="text-align: center;">
            <a href="{{ballot_url}}" class="button" role="link">Vote Now</a>
        </p>
        <p style="text-align: center;"><small>(Clicking the above link will automatically log you in to vote)</small></p>

        <p>If you have any questions, please contact your election administrator:<br/>
        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_BALLOT_NOTIFICATION_TEXT = """Ballot Available: {{election_title}}

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

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_BALLOT_NOTIFICATION_SUBJECT = "Ballot Available: {{election_title}}"

# Default election report email
DEFAULT_ELECTION_REPORT_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #059669;">
        <h1>Election Report</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>The following election has been closed. Below is the official report.</p>

        <div class="details">
            <p><strong>Election:</strong> {{election_title}}</p>
            <p><strong>Type:</strong> {{election_type}}</p>
            <p><strong>Voting Period:</strong> {{start_date}} &mdash; {{end_date}}</p>
        </div>

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">Turnout &amp; Quorum</h2>
        <div class="details">
            <p><strong>Eligible Voters:</strong> {{total_eligible_voters}}</p>
            <p><strong>Votes Cast:</strong> {{total_votes_cast}}</p>
            <p><strong>Turnout:</strong> {{voter_turnout_percentage}}%</p>
            <p><strong>Quorum:</strong> {{quorum_status}}</p>
            <p>{{quorum_detail}}</p>
        </div>

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">Results</h2>
        {{results_html}}

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">Ballot Recipients ({{total_eligible_voters}})</h2>
        <p>The following members received ballots:</p>
        {{ballot_recipients_html}}

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">Members Who Did Not Receive Ballots</h2>
        <p>The following active members were not sent a ballot, with the reason why:</p>
        {{skipped_voters_html}}
    </div>
    <div class="footer">
        <p>This is an automated election report from {{organization_name}}.</p>
        <p>Please retain this email for your records.</p>
    </div>
</div>"""

DEFAULT_ELECTION_REPORT_TEXT = """Election Report — {{election_title}}

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

---
This is an automated election report from {{organization_name}}.
Please retain this email for your records."""

DEFAULT_ELECTION_REPORT_SUBJECT = (
    "Election Report: {{election_title}} — {{organization_name}}"
)

# Default ballot eligibility summary email (sent to secretary after ballot dispatch)
DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #d97706;">
        <h1>Ballot Eligibility Summary</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>Ballot emails for <strong>{{election_title}}</strong> have been sent. Below is a summary of member eligibility.</p>

        <div class="details">
            <p><strong>Ballots Sent:</strong> {{sent_count}}</p>
            <p><strong>Members Skipped:</strong> {{skipped_count}}</p>
            <p><strong>Total Checked In:</strong> {{total_checked_in}}</p>
        </div>

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">Members Who Received Ballots ({{sent_count}})</h2>
        {{recipients_html}}

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #f59e0b;padding-bottom:6px;color:#92400e;">Members Who Did Not Receive Ballots ({{skipped_count}})</h2>
        <p>The following members were skipped because they did not meet the eligibility requirements for any ballot item. The specific reason for each member is listed below.</p>
        {{skipped_voters_html}}

        <h2 style="margin-top:20px;font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">What You Can Do</h2>
        <ul>
            <li><strong>Voter Overrides:</strong> If a skipped member should be allowed to vote, use the Voter Override feature on the election page to grant them an exception.</li>
            <li><strong>Check-In Members:</strong> If a member was skipped due to attendance, check them in on the Meeting Attendance panel and resend ballots.</li>
            <li><strong>Review Tier Settings:</strong> If a membership tier is incorrectly marked as ineligible, update it in Organization Settings &gt; Membership Tiers.</li>
        </ul>
    </div>
    <div class="footer">
        <p>This is an automated eligibility summary from {{organization_name}}.</p>
        <p>Please retain this email for your records.</p>
    </div>
</div>"""

DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_TEXT = """Ballot Eligibility Summary — {{election_title}}

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

---
This is an automated eligibility summary from {{organization_name}}.
Please retain this email for your records."""

DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_SUBJECT = (
    "Ballot Eligibility Summary: {{election_title}} — {{organization_name}}"
)

# Default event cancellation email
DEFAULT_EVENT_CANCELLATION_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #dc2626;">
        <h1>Event Cancelled</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>The following event has been cancelled:</p>

        <div class="details">
            <p><strong>Event:</strong> {{event_title}}</p>
            <p><strong>Original Date:</strong> {{event_date}}</p>
            <p><strong>Reason:</strong> {{reason}}</p>
        </div>

        <p>Please update your calendar accordingly. If you have questions, contact your department leadership.</p>
    </div>
    <div class="footer">
        <p>This is an automated message from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_EVENT_CANCELLATION_TEXT = """Event Cancelled

Hello {{recipient_name}},

The following event has been cancelled:

Event: {{event_title}}
Original Date: {{event_date}}
Reason: {{reason}}

Please update your calendar accordingly.

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_EVENT_CANCELLATION_SUBJECT = (
    "Event Cancelled: {{event_title}} — {{organization_name}}"
)

# Default event reminder email
DEFAULT_EVENT_REMINDER_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header">
        <h1>Event Reminder</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>This is a reminder about an upcoming event:</p>

        <div class="details">
            <p><strong>Event:</strong> {{event_title}}</p>
            <p><strong>Type:</strong> {{event_type}}</p>
            <p><strong>Start:</strong> {{event_start}}</p>
            <p><strong>End:</strong> {{event_end}}</p>
            <p><strong>Location:</strong> {{location_name}}</p>
            <p>{{location_details}}</p>
        </div>

        <p style="text-align: center;">
            <a href="{{event_url}}" class="button" role="link">View Event</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated reminder.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_EVENT_REMINDER_TEXT = """Event Reminder

Hello {{recipient_name}},

This is a reminder about an upcoming event:

Event: {{event_title}}
Type: {{event_type}}
Start: {{event_start}}
End: {{event_end}}
Location: {{location_name}}
{{location_details}}

View event: {{event_url}}

---
This is an automated reminder.
Please do not reply to this email."""

DEFAULT_EVENT_REMINDER_SUBJECT = "Reminder: {{event_title}} — {{event_start}}"

# Default series end reminder email
DEFAULT_SERIES_END_REMINDER_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #f59e0b;">
        <h1>Recurring Series Ending Soon</h1>
    </div>
    <div class="content">
        <p>Hello {{recipient_name}},</p>

        <p>This is a reminder that the following recurring event series is scheduled to end in approximately <strong>6 months</strong>:</p>

        <div class="details">
            <p><strong>Event:</strong> {{event_title}}</p>
            <p><strong>Pattern:</strong> {{recurrence_pattern}}</p>
            <p><strong>Series Ends:</strong> {{series_end_date}}</p>
            <p><strong>Remaining Occurrences:</strong> {{remaining_occurrences}}</p>
        </div>

        <p>If you would like to extend or modify this series, please update the event before the series end date.</p>

        <p style="text-align: center;">
            <a href="{{event_url}}" class="button" role="link">View Event</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated reminder from {{organization_name}}.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_SERIES_END_REMINDER_TEXT = """Recurring Series Ending Soon

Hello {{recipient_name}},

This is a reminder that the following recurring event series is scheduled to end in approximately 6 months:

Event: {{event_title}}
Pattern: {{recurrence_pattern}}
Series Ends: {{series_end_date}}
Remaining Occurrences: {{remaining_occurrences}}

If you would like to extend or modify this series, please update the event before the series end date.

View event: {{event_url}}

---
This is an automated reminder from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_SERIES_END_REMINDER_SUBJECT = (
    "Recurring Series Ending Soon: {{event_title}} — Ends {{series_end_date}}"
)

# Default training approval email
DEFAULT_TRAINING_APPROVAL_HTML = """<div class="container">
    <div class="logo">{{organization_logo_img}}</div>
    <div class="header" style="background-color: #7c3aed;">
        <h1>Training Approval Needed</h1>
    </div>
    <div class="content">
        <p>Hello,</p>

        <p>A training event has been submitted and requires your approval:</p>

        <div class="details">
            <p><strong>Course:</strong> {{course_name}}</p>
            <p><strong>Event:</strong> {{event_title}}</p>
            <p><strong>Date:</strong> {{event_date}}</p>
            <p><strong>Attendees:</strong> {{attendee_count}}</p>
            <p><strong>Submitted by:</strong> {{submitter_name}}</p>
            <p><strong>Approval Deadline:</strong> {{approval_deadline}}</p>
        </div>

        <p style="text-align: center;">
            <a href="{{approval_url}}" class="button" role="link">Review &amp; Approve</a>
        </p>
    </div>
    <div class="footer">
        <p>This is an automated message.</p>
        <p>Please do not reply to this email.</p>
    </div>
</div>"""

DEFAULT_TRAINING_APPROVAL_TEXT = """Training Approval Needed

A training event has been submitted and requires your approval:

Course: {{course_name}}
Event: {{event_title}}
Date: {{event_date}}
Attendees: {{attendee_count}}
Submitted by: {{submitter_name}}
Approval Deadline: {{approval_deadline}}

Review and approve: {{approval_url}}

---
This is an automated message.
Please do not reply to this email."""

DEFAULT_TRAINING_APPROVAL_SUBJECT = (
    "Training Approval Needed: {{course_name}} — {{event_date}}"
)


def build_items_list_html(
    items: List[Dict[str, Any]],
    total_value: float,
    include_condition: bool = False,
) -> str:
    """Build an HTML table of outstanding items for email templates.

    Args:
        items: List of item dicts with keys: name, serial_number, asset_tag,
               value, and optionally condition.
        total_value: Pre-computed total value of all items.
        include_condition: Whether to include a Condition column.

    Returns:
        An HTML ``<table>`` string ready for insertion into email templates.
    """
    import html as _h

    cols = ["#", "Item", "Serial #", "Asset Tag"]
    if include_condition:
        cols.append("Condition")
    cols.append("Value")

    header_cells = "".join(
        f'<th style="padding:8px 10px;text-align:{"right" if c == "Value" else "left"};font-size:12px;">{c}</th>'
        for c in cols
    )
    rows = ""
    for idx, item in enumerate(items, 1):
        cells = (
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">{idx}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">{_h.escape(str(item.get("name", "")))}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">{_h.escape(str(item.get("serial_number", "-")))}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">{_h.escape(str(item.get("asset_tag", "-")))}</td>'
        )
        if include_condition:
            cond = item.get("condition", "unknown")
            cells += f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">{_h.escape(str(cond).title())}</td>'
        cells += f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.get("value", 0):,.2f}</td>'
        rows += f"<tr>{cells}</tr>"

    col_count = len(cols)
    return (
        '<table style="border-collapse:collapse;width:100%;margin:16px 0;">'
        f'<thead><tr style="background-color:#374151;color:white;">{header_cells}</tr></thead>'
        f"<tbody>{rows}</tbody>"
        '<tfoot><tr style="font-weight:bold;background-color:#f3f4f6;">'
        f'<td colspan="{col_count - 1}" style="padding:8px 10px;text-align:right;">Total Outstanding Value:</td>'
        f'<td style="padding:8px 10px;text-align:right;">${total_value:,.2f}</td>'
        "</tr></tfoot></table>"
    )


def build_items_list_text(
    items: List[Dict[str, Any]],
    total_value: float,
    include_condition: bool = False,
) -> str:
    """Build a plain-text list of outstanding items for email templates.

    Args:
        items: List of item dicts with keys: name, serial_number, asset_tag,
               value, and optionally condition.
        total_value: Pre-computed total value of all items.
        include_condition: Whether to include condition info.

    Returns:
        A plain-text string listing all items.
    """
    lines = ["Outstanding Items:"]
    for idx, item in enumerate(items, 1):
        parts = [
            f'  {idx}. {item.get("name", "Unknown")}',
            f'Serial: {item.get("serial_number", "-")}',
            f'Asset Tag: {item.get("asset_tag", "-")}',
        ]
        if include_condition:
            parts.append(f'Condition: {str(item.get("condition", "unknown")).title()}')
        parts.append(f'${item.get("value", 0):,.2f}')
        lines.append(" \u2014 ".join(parts))
    lines.append("")
    lines.append(f"Total Outstanding Value: ${total_value:,.2f}")
    return "\n".join(lines)


class EmailTemplateService:
    """Service for managing and rendering email templates"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_template(
        self,
        organization_id: str,
        template_type: EmailTemplateType,
        active_only: bool = True,
    ) -> Optional[EmailTemplate]:
        """Get a specific template by type for an organization"""
        conditions = [
            EmailTemplate.organization_id == organization_id,
            EmailTemplate.template_type == template_type,
        ]
        if active_only:
            conditions.append(EmailTemplate.is_active == True)  # noqa: E712

        result = await self.db.execute(
            select(EmailTemplate)
            .where(and_(*conditions))
            .options(selectinload(EmailTemplate.attachments))
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_templates(self, organization_id: str) -> List[EmailTemplate]:
        """List all templates for an organization.

        Also refreshes the ``available_variables`` column on each template
        so the API always returns the current code-defined variable list.
        """
        result = await self.db.execute(
            select(EmailTemplate)
            .where(EmailTemplate.organization_id == str(organization_id))
            .options(selectinload(EmailTemplate.attachments))
            .order_by(EmailTemplate.template_type, EmailTemplate.name)
        )
        templates = list(result.scalars().all())

        # Sync available_variables with current code definitions
        dirty_templates: list[EmailTemplate] = []
        for tmpl in templates:
            canonical = get_variables_for_type(tmpl.template_type)
            if tmpl.available_variables != canonical:
                tmpl.available_variables = canonical
                dirty_templates.append(tmpl)
        if dirty_templates:
            await self.db.flush()
            # Refresh dirty objects so updated_at (onupdate=func.now()) is
            # eagerly loaded — prevents MissingGreenlet during serialization.
            for tmpl in dirty_templates:
                await self.db.refresh(tmpl, ["updated_at"])

        return templates

    async def create_template(
        self,
        organization_id: str,
        template_type: EmailTemplateType,
        name: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        css_styles: Optional[str] = None,
        description: Optional[str] = None,
        allow_attachments: bool = False,
        created_by: Optional[str] = None,
    ) -> EmailTemplate:
        """Create a new email template"""
        template = EmailTemplate(
            id=str(uuid.uuid4()),
            organization_id=organization_id,
            template_type=template_type,
            name=name,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            css_styles=css_styles or DEFAULT_CSS,
            description=description,
            allow_attachments=allow_attachments,
            available_variables=GLOBAL_VARIABLES
            + TEMPLATE_VARIABLES.get(template_type.value, []),
            created_by=created_by,
            updated_by=created_by,
        )
        self.db.add(template)
        await self.db.flush()
        # Refresh server-computed timestamps (server_default / onupdate)
        # to prevent MissingGreenlet when serializing in async mode.
        await self.db.refresh(template, attribute_names=["created_at", "updated_at"])
        logger.info(
            "Template created id=%s type=%s org=%s by=%s",
            template.id,
            template_type,
            organization_id,
            created_by,
        )
        return template

    async def update_template(
        self,
        template_id: str,
        organization_id: str,
        updated_by: Optional[str] = None,
        **fields,
    ) -> Optional[EmailTemplate]:
        """Update an existing email template"""
        result = await self.db.execute(
            select(EmailTemplate)
            .where(
                EmailTemplate.id == template_id,
                EmailTemplate.organization_id == organization_id,
            )
            .options(selectinload(EmailTemplate.attachments))
        )
        template = result.scalar_one_or_none()
        if not template:
            return None

        allowed_fields = {
            "name",
            "subject",
            "html_body",
            "text_body",
            "css_styles",
            "description",
            "is_active",
            "allow_attachments",
            "default_cc",
            "default_bcc",
        }
        for key, value in fields.items():
            if key in allowed_fields and value is not None:
                setattr(template, key, value)

        template.updated_by = updated_by
        await self.db.flush()
        # Refresh server-computed updated_at to avoid MissingGreenlet on
        # async lazy-load when Pydantic serializes the response.
        await self.db.refresh(template, attribute_names=["updated_at"])
        logger.info(
            "Template updated id=%s fields=[%s] org=%s by=%s",
            template_id,
            ",".join(
                sorted(
                    k
                    for k, v in fields.items()
                    if v is not None and k in allowed_fields
                )
            ),
            organization_id,
            updated_by,
        )
        return template

    async def delete_template(self, template_id: str, organization_id: str) -> bool:
        """Delete an email template"""
        result = await self.db.execute(
            select(EmailTemplate).where(
                EmailTemplate.id == template_id,
                EmailTemplate.organization_id == organization_id,
            )
        )
        template = result.scalar_one_or_none()
        if not template:
            return False

        logger.info(
            "Template deleted id=%s type=%s org=%s",
            template_id,
            template.template_type,
            organization_id,
        )
        await self.db.delete(template)
        await self.db.flush()
        return True

    def render(
        self,
        template: EmailTemplate,
        context: Dict[str, Any],
        organization: Optional[Any] = None,
    ) -> Tuple[str, str, Optional[str]]:
        """
        Render a template with the given context variables.

        Returns (subject, html_body, text_body) with variables replaced.
        Variables use {{variable_name}} syntax.
        CSS styles are injected into the HTML wrapper.

        If ``organization`` is provided, ``organization_name``,
        ``organization_logo``, ``organization_logo_img``,
        ``organization_mailing_address``, ``organization_physical_address``,
        ``organization_phone``, and ``organization_email`` are auto-injected
        into the context (without overwriting values already supplied by the
        caller).
        """
        ctx = dict(context)
        if organization:
            ctx.setdefault("organization_name", getattr(organization, "name", ""))
            logo = getattr(organization, "logo", None) or ""
            ctx.setdefault("organization_logo", logo)
            ctx.setdefault(
                "organization_phone", getattr(organization, "phone", None) or ""
            )
            ctx.setdefault(
                "organization_email", getattr(organization, "email", None) or ""
            )
            # Build formatted mailing address
            ctx.setdefault(
                "organization_mailing_address",
                self._format_address(
                    getattr(organization, "mailing_address_line1", None),
                    getattr(organization, "mailing_address_line2", None),
                    getattr(organization, "mailing_city", None),
                    getattr(organization, "mailing_state", None),
                    getattr(organization, "mailing_zip", None),
                ),
            )
            # Build formatted physical address (falls back to mailing if same)
            if getattr(organization, "physical_address_same", True):
                ctx.setdefault(
                    "organization_physical_address",
                    ctx.get("organization_mailing_address", ""),
                )
            else:
                ctx.setdefault(
                    "organization_physical_address",
                    self._format_address(
                        getattr(organization, "physical_address_line1", None),
                        getattr(organization, "physical_address_line2", None),
                        getattr(organization, "physical_city", None),
                        getattr(organization, "physical_state", None),
                        getattr(organization, "physical_zip", None),
                    ),
                )
        # Build a ready-to-use <img> tag so templates can just insert it.
        # Skip base64 data URIs — they embed the full image payload in the
        # HTML and easily exceed Gmail's 102 KB message-clipping threshold.
        logo_val = ctx.get("organization_logo", "")
        if logo_val and not str(logo_val).startswith("data:"):
            import html as _h

            org_name = ctx.get("organization_name", "Organization")
            ctx.setdefault(
                "organization_logo_img",
                f'<img src="{_h.escape(str(logo_val))}" alt="{_h.escape(str(org_name))}" class="logo" style="max-height:80px;max-width:200px;" />',
            )
        else:
            ctx.setdefault("organization_logo_img", "")

        subject = self._replace_variables(template.subject, ctx)
        html_body = self._replace_variables(template.html_body, ctx)
        text_body = None
        if template.text_body:
            text_body = self._replace_variables(template.text_body, ctx)

        # Wrap HTML body with full document structure and CSS.
        # lang/dir for screen readers (WCAG 3.1.1), meta charset for
        # consistent rendering, viewport for mobile clients.
        css = template.css_styles or DEFAULT_CSS
        safe_subject_attr = _html_mod.escape(subject, quote=True)
        full_html = f"""<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>{_html_mod.escape(subject)}</title>
<style>
{css}
</style>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
</head>
<body>
<div role="article" aria-roledescription="email" aria-label="{safe_subject_attr}">
{html_body}
</div>
</body>
</html>"""

        return subject, full_html, text_body

    @classmethod
    def render_static(
        cls,
        template: EmailTemplate,
        context: Dict[str, Any],
        organization: Optional[Any] = None,
    ) -> Tuple[str, str, Optional[str]]:
        """Render a template without requiring a DB session.

        Identical to :meth:`render` but usable without instantiating the
        service (no ``db`` parameter needed).  Useful when the template
        has already been loaded and only rendering is required.
        """
        # Create a lightweight instance — render() does not use self.db
        instance = cls.__new__(cls)
        return instance.render(template, context, organization=organization)

    @staticmethod
    def _format_address(
        line1: Optional[str],
        line2: Optional[str],
        city: Optional[str],
        state: Optional[str],
        zip_code: Optional[str],
    ) -> str:
        """Format address fields into a multi-line string."""
        parts: List[str] = []
        if line1:
            parts.append(line1)
        if line2:
            parts.append(line2)
        city_state = ", ".join(filter(None, [city, state]))
        if city_state and zip_code:
            city_state += f" {zip_code}"
        if city_state:
            parts.append(city_state)
        return "\n".join(parts)

    # Variable names whose values contain pre-rendered, system-generated
    # HTML (e.g. item tables, logo <img> tags).  These are built by
    # trusted backend code and must NOT be HTML-escaped during rendering.
    _RAW_HTML_VARIABLES: set = {
        "items_list_html",
        "items_issued_html",
        "items_returned_html",
        "organization_logo_img",
        "ballot_items_html",
        "results_html",
        "ballot_recipients_html",
        "skipped_voters_html",
        "custom_message_html",
    }

    def _replace_variables(self, text: str, context: Dict[str, Any]) -> str:
        """Replace {{variable_name}} placeholders with context values.

        All values are HTML-escaped to prevent injection of malicious
        HTML/JS through user-controlled template variables (e.g.
        election titles, custom messages, recipient names).

        Variables listed in ``_RAW_HTML_VARIABLES`` are inserted without
        escaping because they contain system-generated HTML (item tables,
        logo images, etc.) that is already safe.
        """
        import html as _html

        def replacer(match):
            var_name = match.group(1).strip()
            if var_name not in context:
                return ""
            value = str(context[var_name])
            if var_name in self._RAW_HTML_VARIABLES:
                return value
            return _html.escape(value)

        return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

    # Registry of default template definitions, keyed by EmailTemplateType.
    # Used by ensure_default_templates() to create missing templates in a
    # single data-driven loop instead of 20+ copy-pasted blocks.
    _DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
        {
            "type": EmailTemplateType.WELCOME,
            "name": "Welcome Email",
            "subject": DEFAULT_WELCOME_SUBJECT,
            "html": DEFAULT_WELCOME_HTML,
            "text": DEFAULT_WELCOME_TEXT,
            "description": "Sent to new members when their account is created. Includes login credentials.",
            "attachments": True,
        },
        {
            "type": EmailTemplateType.PASSWORD_RESET,
            "name": "Password Reset",
            "subject": DEFAULT_PASSWORD_RESET_SUBJECT,
            "html": DEFAULT_PASSWORD_RESET_HTML,
            "text": DEFAULT_PASSWORD_RESET_TEXT,
            "description": "Sent when a member requests a password reset. Only used with local authentication.",
        },
        {
            "type": EmailTemplateType.EVENT_CANCELLATION,
            "name": "Event Cancellation",
            "subject": DEFAULT_EVENT_CANCELLATION_SUBJECT,
            "html": DEFAULT_EVENT_CANCELLATION_HTML,
            "text": DEFAULT_EVENT_CANCELLATION_TEXT,
            "description": (
                "Sent to attendees when an event is cancelled. "
                "Includes the event name, original date, and cancellation reason."
            ),
        },
        {
            "type": EmailTemplateType.EVENT_REMINDER,
            "name": "Event Reminder",
            "subject": DEFAULT_EVENT_REMINDER_SUBJECT,
            "html": DEFAULT_EVENT_REMINDER_HTML,
            "text": DEFAULT_EVENT_REMINDER_TEXT,
            "description": (
                "Sent to attendees as a reminder before an upcoming event. "
                "Includes event details, time, and location."
            ),
        },
        {
            "type": EmailTemplateType.SERIES_END_REMINDER,
            "name": "Series End Reminder",
            "subject": DEFAULT_SERIES_END_REMINDER_SUBJECT,
            "html": DEFAULT_SERIES_END_REMINDER_HTML,
            "text": DEFAULT_SERIES_END_REMINDER_TEXT,
            "description": (
                "Sent to event managers 6 months before a recurring event "
                "series is scheduled to end. Includes series details and "
                "remaining occurrences."
            ),
        },
        {
            "type": EmailTemplateType.TRAINING_APPROVAL,
            "name": "Training Approval Request",
            "subject": DEFAULT_TRAINING_APPROVAL_SUBJECT,
            "html": DEFAULT_TRAINING_APPROVAL_HTML,
            "text": DEFAULT_TRAINING_APPROVAL_TEXT,
            "description": (
                "Sent to approvers when a training event is submitted for approval. "
                "Includes course details, attendee count, and approval deadline."
            ),
        },
        {
            "type": EmailTemplateType.BALLOT_NOTIFICATION,
            "name": "Ballot Notification",
            "subject": DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
            "html": DEFAULT_BALLOT_NOTIFICATION_HTML,
            "text": DEFAULT_BALLOT_NOTIFICATION_TEXT,
            "description": (
                "Sent to eligible voters when a ballot is available. "
                "Includes the election title, meeting date, and a link to vote."
            ),
        },
        {
            "type": EmailTemplateType.ELECTION_REPORT,
            "name": "Election Report",
            "subject": DEFAULT_ELECTION_REPORT_SUBJECT,
            "html": DEFAULT_ELECTION_REPORT_HTML,
            "text": DEFAULT_ELECTION_REPORT_TEXT,
            "description": (
                "Sent to the secretary when an election is closed. "
                "Includes election results, ballot recipients, and "
                "reasons why members did not receive ballots."
            ),
        },
        {
            "type": EmailTemplateType.BALLOT_ELIGIBILITY_SUMMARY,
            "name": "Ballot Eligibility Summary",
            "subject": DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_SUBJECT,
            "html": DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_HTML,
            "text": DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_TEXT,
            "description": (
                "Sent to the secretary after ballot emails are dispatched. "
                "Lists who received ballots and who was skipped with reasons."
            ),
        },
        {
            "type": EmailTemplateType.MEMBER_DROPPED,
            "name": "Member Dropped \u2014 Property Return Notice",
            "subject": "Notice of Department Property Return \u2014 {{organization_name}}",
            "html": DEFAULT_MEMBER_DROPPED_HTML,
            "text": DEFAULT_MEMBER_DROPPED_TEXT,
            "description": (
                "Sent to a member when their status changes to dropped. "
                "Includes the reason for separation and a notice to return all department property. "
                "CC recipients are controlled in Organization Settings > Drop Notifications."
            ),
            "attachments": True,
        },
        {
            "type": EmailTemplateType.INVENTORY_CHANGE,
            "name": "Inventory Change Confirmation",
            "subject": DEFAULT_INVENTORY_CHANGE_SUBJECT,
            "html": DEFAULT_INVENTORY_CHANGE_HTML,
            "text": DEFAULT_INVENTORY_CHANGE_TEXT,
            "description": (
                "Sent to a member approximately one hour after inventory changes "
                "(items issued, assigned, returned, etc.). Multiple changes within "
                "the window are consolidated into a single email. Offsetting actions "
                "(e.g. issue + return of the same item) are netted out."
            ),
        },
        {
            "type": EmailTemplateType.CERT_EXPIRATION,
            "name": "Certification Expiration Alert",
            "subject": DEFAULT_CERT_EXPIRATION_SUBJECT,
            "html": DEFAULT_CERT_EXPIRATION_HTML,
            "text": DEFAULT_CERT_EXPIRATION_TEXT,
            "description": (
                "Sent to members when a certification is approaching its expiration date. "
                "Tiered alerts are sent at 90, 60, 30, and 7 days before expiry."
            ),
        },
        {
            "type": EmailTemplateType.POST_EVENT_VALIDATION,
            "name": "Post-Event Attendance Validation",
            "subject": DEFAULT_POST_EVENT_VALIDATION_SUBJECT,
            "html": DEFAULT_POST_EVENT_VALIDATION_HTML,
            "text": DEFAULT_POST_EVENT_VALIDATION_TEXT,
            "description": (
                "Sent to the event creator after an event ends, asking them to "
                "review and validate the attendance records."
            ),
        },
        {
            "type": EmailTemplateType.POST_SHIFT_VALIDATION,
            "name": "Post-Shift Attendance Validation",
            "subject": DEFAULT_POST_SHIFT_VALIDATION_SUBJECT,
            "html": DEFAULT_POST_SHIFT_VALIDATION_HTML,
            "text": DEFAULT_POST_SHIFT_VALIDATION_TEXT,
            "description": (
                "Sent to the shift officer after a shift ends, asking them to "
                "review and confirm the shift attendance."
            ),
        },
        {
            "type": EmailTemplateType.PROPERTY_RETURN_REMINDER,
            "name": "Property Return Reminder",
            "subject": DEFAULT_PROPERTY_RETURN_REMINDER_SUBJECT,
            "html": DEFAULT_PROPERTY_RETURN_REMINDER_HTML,
            "text": DEFAULT_PROPERTY_RETURN_REMINDER_TEXT,
            "description": (
                "Sent to dropped members as a follow-up reminder to return "
                "department property. Sent at 30 and 90 days after separation."
            ),
        },
        {
            "type": EmailTemplateType.INACTIVITY_WARNING,
            "name": "Prospect Inactivity Warning",
            "subject": DEFAULT_INACTIVITY_WARNING_SUBJECT,
            "html": DEFAULT_INACTIVITY_WARNING_HTML,
            "text": DEFAULT_INACTIVITY_WARNING_TEXT,
            "description": (
                "Sent to pipeline coordinators when a prospective member has "
                "been inactive for an extended period."
            ),
        },
        {
            "type": EmailTemplateType.ELECTION_ROLLBACK,
            "name": "Election Rollback Alert",
            "subject": DEFAULT_ELECTION_ROLLBACK_SUBJECT,
            "html": DEFAULT_ELECTION_ROLLBACK_HTML,
            "text": DEFAULT_ELECTION_ROLLBACK_TEXT,
            "description": (
                "Sent to department leadership when an election is rolled "
                "back to a previous stage. Includes the reason and who performed it."
            ),
        },
        {
            "type": EmailTemplateType.ELECTION_DELETED,
            "name": "Election Deleted Alert",
            "subject": DEFAULT_ELECTION_DELETED_SUBJECT,
            "html": DEFAULT_ELECTION_DELETED_HTML,
            "text": DEFAULT_ELECTION_DELETED_TEXT,
            "description": (
                "Sent to department leadership when an election is permanently "
                "deleted. All ballots and results are removed."
            ),
        },
        {
            "type": EmailTemplateType.MEMBER_ARCHIVED,
            "name": "Member Archived Notification",
            "subject": DEFAULT_MEMBER_ARCHIVED_SUBJECT,
            "html": DEFAULT_MEMBER_ARCHIVED_HTML,
            "text": DEFAULT_MEMBER_ARCHIVED_TEXT,
            "description": (
                "Sent to admins when a dropped member is automatically archived "
                "after all department property has been returned."
            ),
        },
        {
            "type": EmailTemplateType.EVENT_REQUEST_STATUS,
            "name": "Event Request Status Update",
            "subject": DEFAULT_EVENT_REQUEST_STATUS_SUBJECT,
            "html": DEFAULT_EVENT_REQUEST_STATUS_HTML,
            "text": DEFAULT_EVENT_REQUEST_STATUS_TEXT,
            "description": (
                "Sent to the event requester and/or assigned coordinator when "
                "an event request status changes (e.g. submitted, scheduled, declined)."
            ),
        },
        {
            "type": EmailTemplateType.IT_PASSWORD_NOTIFICATION,
            "name": "IT Password Reset Notice",
            "subject": DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT,
            "html": DEFAULT_IT_PASSWORD_NOTIFICATION_HTML,
            "text": DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT,
            "description": (
                "Sent to the IT team contacts when a user requests a password "
                "reset. Informational only \u2014 includes the user's name, email, "
                "and request IP address."
            ),
        },
        {
            "type": EmailTemplateType.DUPLICATE_APPLICATION,
            "name": "Duplicate Application Notice",
            "subject": DEFAULT_DUPLICATE_APPLICATION_SUBJECT,
            "html": DEFAULT_DUPLICATE_APPLICATION_HTML,
            "text": DEFAULT_DUPLICATE_APPLICATION_TEXT,
            "description": (
                "Sent to the applicant when a duplicate membership application "
                "is detected for the same email address. The department is "
                "BCC'd automatically."
            ),
        },
    ]

    async def ensure_default_templates(
        self,
        organization_id: str,
        created_by: Optional[str] = None,
    ) -> List[EmailTemplate]:
        """
        Ensure default templates exist for an organization.
        Creates any missing default templates. Idempotent.
        """
        created: List[EmailTemplate] = []

        for defn in self._DEFAULT_TEMPLATE_DEFS:
            existing = await self.get_template(
                organization_id, defn["type"], active_only=False
            )
            if not existing:
                template = await self.create_template(
                    organization_id=organization_id,
                    template_type=defn["type"],
                    name=defn["name"],
                    subject=defn["subject"],
                    html_body=defn["html"],
                    text_body=defn["text"],
                    description=defn.get("description"),
                    allow_attachments=defn.get("attachments", False),
                    created_by=created_by,
                )
                created.append(template)

        return created
