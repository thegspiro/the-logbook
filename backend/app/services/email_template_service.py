"""
Email Template Service

Manages CRUD operations for email templates and renders them with context variables.
"""

import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.email_template import EmailTemplate, EmailTemplateType

# Default CSS styles shared across all email templates
DEFAULT_CSS = """
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.logo { text-align: center; padding: 16px 0 0 0; }
.logo img { max-height: 80px; max-width: 200px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
"""

# Variables available to ALL template types (injected automatically)
GLOBAL_VARIABLES: List[Dict[str, str]] = [
    {"name": "organization_name", "description": "Organization name"},
    {
        "name": "organization_logo",
        "description": "Organization logo URL (use in an <img> tag)",
    },
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
        {"name": "organization_name", "description": "Organization name"},
        {"name": "login_url", "description": "URL to the login page"},
    ],
    "password_reset": [
        {"name": "first_name", "description": "Recipient's first name"},
        {"name": "reset_url", "description": "Password reset link"},
        {"name": "organization_name", "description": "Organization name"},
        {"name": "expiry_minutes", "description": "Minutes until link expires"},
    ],
    "inventory_change": [
        {"name": "first_name", "description": "Member's first name"},
        {"name": "organization_name", "description": "Organization/department name"},
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
        {"name": "organization_name", "description": "Organization/department name"},
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
    "event_cancellation": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "event_title", "description": "Title of the cancelled event"},
        {"name": "event_date", "description": "Original event date"},
        {"name": "organization_name", "description": "Organization name"},
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
        {"name": "positions", "description": "Positions being voted on (comma-separated)"},
    ],
    "cert_expiration": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "cert_name", "description": "Name of the certification"},
        {"name": "expiration_date", "description": "Expiration date of the cert"},
        {"name": "days_remaining", "description": "Days until expiration"},
        {"name": "organization_name", "description": "Organization name"},
        {"name": "renewal_url", "description": "Link to training/certification page"},
    ],
    "post_event_validation": [
        {"name": "recipient_name", "description": "Event creator's name"},
        {"name": "event_title", "description": "Title of the event"},
        {"name": "event_date", "description": "Date of the event"},
        {"name": "attendee_count", "description": "Number of attendees recorded"},
        {"name": "validation_url", "description": "Link to validate attendance"},
        {"name": "organization_name", "description": "Organization name"},
    ],
    "post_shift_validation": [
        {"name": "recipient_name", "description": "Shift officer's name"},
        {"name": "shift_date", "description": "Date of the shift"},
        {"name": "shift_name", "description": "Name/label of the shift"},
        {"name": "attendee_count", "description": "Number of members on shift"},
        {"name": "validation_url", "description": "Link to validate attendance"},
        {"name": "organization_name", "description": "Organization name"},
    ],
    "property_return_reminder": [
        {"name": "member_name", "description": "Member's full name"},
        {"name": "organization_name", "description": "Organization name"},
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
        {"name": "organization_name", "description": "Organization name"},
        {"name": "prospect_url", "description": "Link to prospect profile"},
    ],
    "election_rollback": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the election"},
        {"name": "performer_name", "description": "Name of the person who rolled back"},
        {"name": "reason", "description": "Reason for the rollback"},
        {"name": "organization_name", "description": "Organization name"},
    ],
    "election_deleted": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the deleted election"},
        {"name": "performer_name", "description": "Name of the person who deleted it"},
        {"name": "reason", "description": "Reason for deletion"},
        {"name": "organization_name", "description": "Organization name"},
    ],
    "member_archived": [
        {"name": "member_name", "description": "Archived member's full name"},
        {"name": "previous_status", "description": "Member's status before archival"},
        {"name": "organization_name", "description": "Organization name"},
    ],
    "event_request_status": [
        {"name": "contact_name", "description": "Requester's name"},
        {"name": "status_label", "description": "New request status"},
        {"name": "event_date", "description": "Scheduled event date (if set)"},
        {"name": "decline_reason", "description": "Reason for decline (if applicable)"},
        {"name": "message", "description": "Additional message from coordinator"},
        {"name": "organization_name", "description": "Organization name"},
    ],
    "it_password_notification": [
        {"name": "user_name", "description": "Name of the user who requested the reset"},
        {"name": "user_email", "description": "Email of the user"},
        {"name": "request_time", "description": "Time the request was made"},
        {"name": "ip_address", "description": "IP address of the request"},
        {"name": "organization_name", "description": "Organization name"},
    ],
}

# Sample context data for previewing each template type.
# Used by the preview endpoint to substitute realistic placeholder values.
SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    "welcome": {
        "first_name": "John",
        "last_name": "Doe",
        "full_name": "John Doe",
        "username": "jdoe",
        "temp_password": "TempPass123!",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
        "login_url": "https://example.com/login",
    },
    "password_reset": {
        "first_name": "John",
        "reset_url": "https://example.com/reset-password?token=sample-token",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
        "expiry_minutes": "30",
    },
    "event_reminder": {
        "recipient_name": "John Doe",
        "event_title": "Monthly Business Meeting",
        "event_type": "Business Meeting",
        "event_start": "March 15, 2026 at 07:00 PM",
        "event_end": "09:00 PM",
        "location_name": "Main Station \u2014 Meeting Room A",
        "location_details": "123 Main St, Anytown, USA",
        "event_url": "https://example.com/events/123",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "event_cancellation": {
        "recipient_name": "John Doe",
        "event_title": "Monthly Business Meeting",
        "event_date": "March 15, 2026",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
        "reason": "Inclement weather",
    },
    "training_approval": {
        "course_name": "Hazardous Materials Awareness",
        "event_title": "HazMat Refresher Training",
        "event_date": "March 20, 2026 at 09:00 AM",
        "attendee_count": "12",
        "approval_deadline": "March 18, 2026",
        "submitter_name": "Jane Smith",
        "approval_url": "https://example.com/training/approve/123",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "ballot_notification": {
        "recipient_name": "John Doe",
        "election_title": "Captain Election 2026",
        "meeting_date": "April 1, 2026 at 07:00 PM",
        "custom_message": "Please review the candidates before voting.",
        "ballot_url": "https://example.com/ballot?token=sample-token",
        "voting_opens": "March 28, 2026 at 08:00 AM",
        "voting_closes": "April 1, 2026 at 05:00 PM",
        "positions": "Captain, Lieutenant",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "member_dropped": {
        "member_name": "John Doe",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
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
    },
    "inventory_change": {
        "first_name": "John",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
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
    },
    "cert_expiration": {
        "recipient_name": "John Doe",
        "cert_name": "EMT-Basic Certification",
        "expiration_date": "April 15, 2026",
        "days_remaining": "45",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
        "renewal_url": "https://example.com/training/certifications",
    },
    "post_event_validation": {
        "recipient_name": "Jane Smith",
        "event_title": "Monthly Business Meeting",
        "event_date": "March 15, 2026",
        "attendee_count": "24",
        "validation_url": "https://example.com/events/123/validate",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "post_shift_validation": {
        "recipient_name": "Capt. Mike Davis",
        "shift_date": "March 14, 2026",
        "shift_name": "Engine 1 \u2014 Night Shift",
        "attendee_count": "6",
        "validation_url": "https://example.com/scheduling/shifts/456/validate",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "property_return_reminder": {
        "member_name": "John Doe",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
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
    },
    "inactivity_warning": {
        "coordinator_name": "Jane Smith",
        "prospect_name": "Alex Johnson",
        "days_inactive": "21",
        "timeout_days": "30",
        "pipeline_stage": "Application Review",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
        "prospect_url": "https://example.com/prospective-members/789",
    },
    "election_rollback": {
        "recipient_name": "Lt. Jane Smith",
        "election_title": "Captain Election 2026",
        "performer_name": "Secretary Robert Johnson",
        "reason": "Ballots were distributed to ineligible members",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "election_deleted": {
        "recipient_name": "Lt. Jane Smith",
        "election_title": "Captain Election 2026",
        "performer_name": "Secretary Robert Johnson",
        "reason": "Election created in error — new election will be scheduled",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "member_archived": {
        "member_name": "John Doe",
        "previous_status": "Dropped",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "event_request_status": {
        "contact_name": "John Doe",
        "status_label": "Scheduled",
        "event_date": "April 15, 2026 at 06:00 PM",
        "decline_reason": "",
        "message": "Your event has been approved and added to the calendar.",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
    "it_password_notification": {
        "user_name": "John Doe",
        "user_email": "jdoe@example.com",
        "request_time": "March 1, 2026 at 02:30 PM",
        "ip_address": "192.168.1.100",
        "organization_name": "Sample Fire Department",
        "organization_logo": "https://example.com/logo.png",
    },
}

# Default welcome email HTML body
DEFAULT_WELCOME_HTML = """<div class="container">
    <div class="header">
        <h1>Welcome to {{organization_name}}</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>Your account has been created for <strong>{{organization_name}}</strong>. You can now log in and access the system.</p>

        <div class="details">
            <p><strong>Username:</strong> {{username}}</p>
            <p><strong>Temporary Password:</strong> {{temp_password}}</p>
        </div>

        <p>For security, please change your password after your first login.</p>

        <p style="text-align: center;">
            <a href="{{login_url}}" class="button">Log In Now</a>
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
    <div class="header">
        <h1>Password Reset Request</h1>
    </div>
    <div class="content">
        <p>Hello {{first_name}},</p>

        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>.</p>

        <p>Click the button below to set a new password. This link will expire in <strong>{{expiry_minutes}} minutes</strong>.</p>

        <p style="text-align: center;">
            <a href="{{reset_url}}" class="button">Reset Password</a>
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
            <a href="{{renewal_url}}" class="button">View Certifications</a>
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
            <a href="{{validation_url}}" class="button">Validate Attendance</a>
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

DEFAULT_POST_EVENT_VALIDATION_SUBJECT = (
    "Attendance Validation Needed: {{event_title}}"
)


# Default post-shift validation email
DEFAULT_POST_SHIFT_VALIDATION_HTML = """<div class="container">
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
            <a href="{{validation_url}}" class="button">Validate Shift</a>
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
            <a href="{{prospect_url}}" class="button">View Prospect</a>
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

DEFAULT_ELECTION_ROLLBACK_SUBJECT = (
    "ALERT: Election Rolled Back — {{election_title}}"
)


# Default election deleted alert email
DEFAULT_ELECTION_DELETED_HTML = """<div class="container">
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

DEFAULT_ELECTION_DELETED_SUBJECT = (
    "CRITICAL: Election Deleted — {{election_title}}"
)


# Default member archived notification email
DEFAULT_MEMBER_ARCHIVED_HTML = """<div class="container">
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

DEFAULT_EVENT_REQUEST_STATUS_SUBJECT = (
    "Event Request Update — {{status_label}}"
)


# Default IT password reset notification email
DEFAULT_IT_PASSWORD_NOTIFICATION_HTML = """<div class="container">
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
            <p><strong>Positions:</strong> {{positions}}</p>
            <p><strong>Voting Opens:</strong> {{voting_opens}}</p>
            <p><strong>Voting Closes:</strong> {{voting_closes}}</p>
        </div>

        {{#custom_message}}
        <p>{{custom_message}}</p>
        {{/custom_message}}

        <p style="text-align: center;">
            <a href="{{ballot_url}}" class="button">Vote Now</a>
        </p>
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
Positions: {{positions}}
Voting Opens: {{voting_opens}}
Voting Closes: {{voting_closes}}

{{custom_message}}

Vote here: {{ballot_url}}

---
This is an automated message from {{organization_name}}.
Please do not reply to this email."""

DEFAULT_BALLOT_NOTIFICATION_SUBJECT = "Ballot Available: {{election_title}}"


# Default event cancellation email
DEFAULT_EVENT_CANCELLATION_HTML = """<div class="container">
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
            <a href="{{event_url}}" class="button">View Event</a>
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


# Default training approval email
DEFAULT_TRAINING_APPROVAL_HTML = """<div class="container">
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
            <a href="{{approval_url}}" class="button">Review &amp; Approve</a>
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
        await self.db.refresh(
            template, attribute_names=["created_at", "updated_at"]
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
        }
        for key, value in fields.items():
            if key in allowed_fields and value is not None:
                setattr(template, key, value)

        template.updated_by = updated_by
        await self.db.flush()
        # Refresh server-computed updated_at to avoid MissingGreenlet on
        # async lazy-load when Pydantic serializes the response.
        await self.db.refresh(template, attribute_names=["updated_at"])
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
        ``organization_logo``, and ``organization_logo_img`` are
        auto-injected into the context (without overwriting values
        already supplied by the caller).
        """
        ctx = dict(context)
        if organization:
            ctx.setdefault("organization_name", getattr(organization, "name", ""))
            logo = getattr(organization, "logo", None) or ""
            ctx.setdefault("organization_logo", logo)
        # Build a ready-to-use <img> tag so templates can just insert it
        logo_val = ctx.get("organization_logo", "")
        if logo_val:
            import html as _h

            ctx.setdefault(
                "organization_logo_img",
                f'<img src="{_h.escape(str(logo_val))}" alt="Logo" class="logo" style="max-height:80px;max-width:200px;" />',
            )
        else:
            ctx.setdefault("organization_logo_img", "")

        subject = self._replace_variables(template.subject, ctx)
        html_body = self._replace_variables(template.html_body, ctx)
        text_body = None
        if template.text_body:
            text_body = self._replace_variables(template.text_body, ctx)

        # Wrap HTML body with full document structure and CSS
        css = template.css_styles or DEFAULT_CSS
        full_html = f"""<!DOCTYPE html>
<html>
<head>
<style>
{css}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

        return subject, full_html, text_body

    # Variable names whose values contain pre-rendered, system-generated
    # HTML (e.g. item tables, logo <img> tags).  These are built by
    # trusted backend code and must NOT be HTML-escaped during rendering.
    _RAW_HTML_VARIABLES: set = {
        "items_list_html",
        "items_issued_html",
        "items_returned_html",
        "organization_logo_img",
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
            value = str(context.get(var_name, match.group(0)))
            if var_name in self._RAW_HTML_VARIABLES:
                return value
            return _html.escape(value)

        return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, text)

    async def ensure_default_templates(
        self,
        organization_id: str,
        created_by: Optional[str] = None,
    ) -> List[EmailTemplate]:
        """
        Ensure default templates exist for an organization.
        Creates any missing default templates. Idempotent.
        """
        created = []

        # Check for welcome template
        existing = await self.get_template(
            organization_id, EmailTemplateType.WELCOME, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.WELCOME,
                name="Welcome Email",
                subject=DEFAULT_WELCOME_SUBJECT,
                html_body=DEFAULT_WELCOME_HTML,
                text_body=DEFAULT_WELCOME_TEXT,
                description="Sent to new members when their account is created. Includes login credentials.",
                allow_attachments=True,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default welcome email template for org {organization_id}"
            )

        # Check for password reset template
        existing = await self.get_template(
            organization_id, EmailTemplateType.PASSWORD_RESET, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.PASSWORD_RESET,
                name="Password Reset",
                subject=DEFAULT_PASSWORD_RESET_SUBJECT,
                html_body=DEFAULT_PASSWORD_RESET_HTML,
                text_body=DEFAULT_PASSWORD_RESET_TEXT,
                description="Sent when a member requests a password reset. Only used with local authentication.",
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default password reset email template for org {organization_id}"
            )

        # Check for event cancellation template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.EVENT_CANCELLATION,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.EVENT_CANCELLATION,
                name="Event Cancellation",
                subject=DEFAULT_EVENT_CANCELLATION_SUBJECT,
                html_body=DEFAULT_EVENT_CANCELLATION_HTML,
                text_body=DEFAULT_EVENT_CANCELLATION_TEXT,
                description=(
                    "Sent to attendees when an event is cancelled. "
                    "Includes the event name, original date, and cancellation reason."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default event cancellation email template for org {organization_id}"
            )

        # Check for event reminder template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.EVENT_REMINDER,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.EVENT_REMINDER,
                name="Event Reminder",
                subject=DEFAULT_EVENT_REMINDER_SUBJECT,
                html_body=DEFAULT_EVENT_REMINDER_HTML,
                text_body=DEFAULT_EVENT_REMINDER_TEXT,
                description=(
                    "Sent to attendees as a reminder before an upcoming event. "
                    "Includes event details, time, and location."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default event reminder email template for org {organization_id}"
            )

        # Check for training approval template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.TRAINING_APPROVAL,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.TRAINING_APPROVAL,
                name="Training Approval Request",
                subject=DEFAULT_TRAINING_APPROVAL_SUBJECT,
                html_body=DEFAULT_TRAINING_APPROVAL_HTML,
                text_body=DEFAULT_TRAINING_APPROVAL_TEXT,
                description=(
                    "Sent to approvers when a training event is submitted for approval. "
                    "Includes course details, attendee count, and approval deadline."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default training approval email template for org {organization_id}"
            )

        # Check for ballot notification template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.BALLOT_NOTIFICATION,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.BALLOT_NOTIFICATION,
                name="Ballot Notification",
                subject=DEFAULT_BALLOT_NOTIFICATION_SUBJECT,
                html_body=DEFAULT_BALLOT_NOTIFICATION_HTML,
                text_body=DEFAULT_BALLOT_NOTIFICATION_TEXT,
                description=(
                    "Sent to eligible voters when a ballot is available. "
                    "Includes the election title, meeting date, and a link to vote."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default ballot notification email template for org {organization_id}"
            )

        # Check for member dropped template
        existing = await self.get_template(
            organization_id, EmailTemplateType.MEMBER_DROPPED, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.MEMBER_DROPPED,
                name="Member Dropped — Property Return Notice",
                subject="Notice of Department Property Return — {{organization_name}}",
                html_body=DEFAULT_MEMBER_DROPPED_HTML,
                text_body=DEFAULT_MEMBER_DROPPED_TEXT,
                description=(
                    "Sent to a member when their status changes to dropped. "
                    "Includes the reason for separation and a notice to return all department property. "
                    "CC recipients are controlled in Organization Settings > Drop Notifications."
                ),
                allow_attachments=True,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default member dropped email template for org {organization_id}"
            )

        # Check for inventory change template
        existing = await self.get_template(
            organization_id, EmailTemplateType.INVENTORY_CHANGE, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.INVENTORY_CHANGE,
                name="Inventory Change Confirmation",
                subject=DEFAULT_INVENTORY_CHANGE_SUBJECT,
                html_body=DEFAULT_INVENTORY_CHANGE_HTML,
                text_body=DEFAULT_INVENTORY_CHANGE_TEXT,
                description=(
                    "Sent to a member approximately one hour after inventory changes "
                    "(items issued, assigned, returned, etc.). Multiple changes within "
                    "the window are consolidated into a single email. Offsetting actions "
                    "(e.g. issue + return of the same item) are netted out."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default inventory change email template for org {organization_id}"
            )

        # Check for cert expiration template
        existing = await self.get_template(
            organization_id, EmailTemplateType.CERT_EXPIRATION, active_only=False
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.CERT_EXPIRATION,
                name="Certification Expiration Alert",
                subject=DEFAULT_CERT_EXPIRATION_SUBJECT,
                html_body=DEFAULT_CERT_EXPIRATION_HTML,
                text_body=DEFAULT_CERT_EXPIRATION_TEXT,
                description=(
                    "Sent to members when a certification is approaching its expiration date. "
                    "Tiered alerts are sent at 90, 60, 30, and 7 days before expiry."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default cert expiration email template for org {organization_id}"
            )

        # Check for post-event validation template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.POST_EVENT_VALIDATION,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.POST_EVENT_VALIDATION,
                name="Post-Event Attendance Validation",
                subject=DEFAULT_POST_EVENT_VALIDATION_SUBJECT,
                html_body=DEFAULT_POST_EVENT_VALIDATION_HTML,
                text_body=DEFAULT_POST_EVENT_VALIDATION_TEXT,
                description=(
                    "Sent to the event creator after an event ends, asking them to "
                    "review and validate the attendance records."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default post-event validation email template for org {organization_id}"
            )

        # Check for post-shift validation template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.POST_SHIFT_VALIDATION,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.POST_SHIFT_VALIDATION,
                name="Post-Shift Attendance Validation",
                subject=DEFAULT_POST_SHIFT_VALIDATION_SUBJECT,
                html_body=DEFAULT_POST_SHIFT_VALIDATION_HTML,
                text_body=DEFAULT_POST_SHIFT_VALIDATION_TEXT,
                description=(
                    "Sent to the shift officer after a shift ends, asking them to "
                    "review and confirm the shift attendance."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default post-shift validation email template for org {organization_id}"
            )

        # Check for property return reminder template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.PROPERTY_RETURN_REMINDER,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.PROPERTY_RETURN_REMINDER,
                name="Property Return Reminder",
                subject=DEFAULT_PROPERTY_RETURN_REMINDER_SUBJECT,
                html_body=DEFAULT_PROPERTY_RETURN_REMINDER_HTML,
                text_body=DEFAULT_PROPERTY_RETURN_REMINDER_TEXT,
                description=(
                    "Sent to dropped members as a follow-up reminder to return "
                    "department property. Sent at 30 and 90 days after separation."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default property return reminder email template for org {organization_id}"
            )

        # Check for inactivity warning template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.INACTIVITY_WARNING,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.INACTIVITY_WARNING,
                name="Prospect Inactivity Warning",
                subject=DEFAULT_INACTIVITY_WARNING_SUBJECT,
                html_body=DEFAULT_INACTIVITY_WARNING_HTML,
                text_body=DEFAULT_INACTIVITY_WARNING_TEXT,
                description=(
                    "Sent to pipeline coordinators when a prospective member has "
                    "been inactive for an extended period."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)
            logger.info(
                f"Created default inactivity warning email template for org {organization_id}"
            )

        # Check for election rollback template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.ELECTION_ROLLBACK,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.ELECTION_ROLLBACK,
                name="Election Rollback Alert",
                subject=DEFAULT_ELECTION_ROLLBACK_SUBJECT,
                html_body=DEFAULT_ELECTION_ROLLBACK_HTML,
                text_body=DEFAULT_ELECTION_ROLLBACK_TEXT,
                description=(
                    "Sent to department leadership when an election is rolled "
                    "back to a previous stage. Includes the reason and who performed it."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)

        # Check for election deleted template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.ELECTION_DELETED,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.ELECTION_DELETED,
                name="Election Deleted Alert",
                subject=DEFAULT_ELECTION_DELETED_SUBJECT,
                html_body=DEFAULT_ELECTION_DELETED_HTML,
                text_body=DEFAULT_ELECTION_DELETED_TEXT,
                description=(
                    "Sent to department leadership when an election is permanently "
                    "deleted. All ballots and results are removed."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)

        # Check for member archived template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.MEMBER_ARCHIVED,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.MEMBER_ARCHIVED,
                name="Member Archived Notification",
                subject=DEFAULT_MEMBER_ARCHIVED_SUBJECT,
                html_body=DEFAULT_MEMBER_ARCHIVED_HTML,
                text_body=DEFAULT_MEMBER_ARCHIVED_TEXT,
                description=(
                    "Sent to admins when a dropped member is automatically archived "
                    "after all department property has been returned."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)

        # Check for event request status template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.EVENT_REQUEST_STATUS,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.EVENT_REQUEST_STATUS,
                name="Event Request Status Update",
                subject=DEFAULT_EVENT_REQUEST_STATUS_SUBJECT,
                html_body=DEFAULT_EVENT_REQUEST_STATUS_HTML,
                text_body=DEFAULT_EVENT_REQUEST_STATUS_TEXT,
                description=(
                    "Sent to the event requester and/or assigned coordinator when "
                    "an event request status changes (e.g. submitted, scheduled, declined)."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)

        # Check for IT password notification template
        existing = await self.get_template(
            organization_id,
            EmailTemplateType.IT_PASSWORD_NOTIFICATION,
            active_only=False,
        )
        if not existing:
            template = await self.create_template(
                organization_id=organization_id,
                template_type=EmailTemplateType.IT_PASSWORD_NOTIFICATION,
                name="IT Password Reset Notice",
                subject=DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT,
                html_body=DEFAULT_IT_PASSWORD_NOTIFICATION_HTML,
                text_body=DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT,
                description=(
                    "Sent to the IT team contacts when a user requests a password "
                    "reset. Informational only — includes the user's name, email, "
                    "and request IP address."
                ),
                allow_attachments=False,
                created_by=created_by,
            )
            created.append(template)

        return created
