"""
Email Template Service

Manages CRUD operations for email templates and renders them with context variables.
"""

import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings as app_settings
from app.core.constants import (
    OFFICE_CATALOG,
    OFFICE_VARIABLE_NAMES,
    ORG_SETTINGS_OFFICER_KEY,
)
from app.models.email_template import (
    EmailTemplate,
    EmailTemplateType,
    MessageHistory,
)
from app.services import email_footers as _footers
from app.services import email_templates_storefront as _storefront_templates
from app.services.email_theme import (  # noqa: F401  (re-exported: many services import DEFAULT_CSS from here)
    ACCENT_AMBER,
    ACCENT_BLUE,
    ACCENT_GREEN,
    ACCENT_INDIGO,
    ACCENT_RED,
    ACCENT_SLATE,
    ACCENT_VIOLET,
    DEFAULT_CSS,
    DEFAULT_LAYOUT,
    TABLE_STYLE,
    TD_STYLE,
    TFOOT_STYLE,
    TH_STYLE,
    build_email_document,
    build_logo_cell,
    build_shell,
    colourway_context,
    colourway_for,
)
from app.utils.model_updates import apply_updates

# Organization columns that reach templates unchanged, as
# {column: variable}. Driving the injection from a map rather than a run of
# hand-written setdefaults is what lets the catalogue test assert that every
# column on the model has been *decided about* — see
# ORGANIZATION_FIELDS_WITHOUT_VARIABLES for the other half of that ledger.
ORGANIZATION_FIELD_VARIABLES: Dict[str, str] = {
    "name": "organization_name",
    "description": "organization_description",
    "phone": "organization_phone",
    "fax": "organization_fax",
    "email": "organization_email",
    "website": "organization_website",
    "county": "organization_county",
    "founded_year": "organization_founded_year",
    "tax_id": "organization_tax_id",
    "fdid": "organization_fdid",
    "state_id": "organization_state_id",
    "department_id": "organization_department_id",
    "logo": "organization_logo",
}

# Every other column on Organization, with the reason it is not a template
# variable. A column in neither map is one nobody has ruled on, which the
# catalogue test reports rather than letting it sit unnoticed.
ORGANIZATION_FIELDS_WITHOUT_VARIABLES: Dict[str, str] = {
    "id": "internal key",
    "slug": "internal key, and it appears in URLs rather than in prose",
    "type": "legacy duplicate of organization_type",
    "organization_type": "surfaced in readable form as organization_type_label",
    "identifier_type": "selects which identifier organization_identifier carries",
    "timezone": "send sites format times before they reach a template",
    "settings": "configuration, not content",
    "active": "operational flag",
    "created_at": "bookkeeping",
    "updated_at": "bookkeeping",
    "mailing_address_line1": "composed into organization_mailing_address",
    "mailing_address_line2": "composed into organization_mailing_address",
    "mailing_city": "composed into organization_mailing_address",
    "mailing_state": "composed into organization_mailing_address",
    "mailing_zip": "composed into organization_mailing_address",
    "mailing_country": "composed into organization_mailing_address",
    "physical_address_same": "decides whether the physical address is composed",
    "physical_address_line1": "composed into organization_physical_address",
    "physical_address_line2": "composed into organization_physical_address",
    "physical_city": "composed into organization_physical_address",
    "physical_state": "composed into organization_physical_address",
    "physical_zip": "composed into organization_physical_address",
    "physical_country": "composed into organization_physical_address",
}

_ORGANIZATION_TYPE_LABELS: Dict[str, str] = {
    "fire_department": "Fire Department",
    "ems_only": "EMS",
    "fire_ems_combined": "Fire & EMS",
}

# The three identifiers a department may keep, and what to call the one it
# nominated. A footer saying "FDID 12345" has to name the right scheme.
_IDENTIFIER_LABELS: Dict[str, str] = {
    "fdid": "FDID",
    "state_id": "State ID",
    "department_id": "Department ID",
}

# Variables available to ALL template types (injected automatically)
GLOBAL_VARIABLES: List[Dict[str, str]] = [
    {"name": "organization_name", "description": "Organization name"},
    {
        "name": "organization_description",
        "description": "The department's description, from Organization Settings",
    },
    {
        "name": "organization_type_label",
        "description": "Fire Department, EMS, or Fire & EMS",
    },
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
    {"name": "organization_fax", "description": "Organization fax number"},
    {"name": "organization_email", "description": "Organization email address"},
    {"name": "organization_website", "description": "Organization website URL"},
    {"name": "organization_county", "description": "County the department serves"},
    {
        "name": "organization_founded_year",
        "description": "Year founded, e.g. for a 'Serving since 1923' line",
    },
    {
        "name": "organization_tax_id",
        "description": (
            "EIN. A 501(c)(3) asking for money is expected to state this on "
            "the message that asks."
        ),
    },
    {
        "name": "organization_identifier",
        "description": (
            "Whichever of FDID / state ID / department ID the department "
            "nominated as its own in Organization Settings"
        ),
    },
    {
        "name": "organization_identifier_label",
        "description": "What that identifier is called — FDID, State ID, Department ID",
    },
    {"name": "organization_fdid", "description": "Fire Department ID (NFIRS)"},
    {
        "name": "organization_state_id",
        "description": "State license or certification number",
    },
    {"name": "organization_department_id", "description": "Internal department ID"},
    {
        "name": "login_url",
        "description": "URL to the application login page",
    },
    {
        "name": "footer_html",
        "description": (
            "The closing block, from the footer this template is set to use. "
            "Edit the wording once under Footers instead of in every template."
        ),
    },
    {
        "name": "footer_text",
        "description": "Plain-text version of the footer block",
    },
]


# Variables ``build_context`` produces itself rather than taking from a
# caller. Send sites never pass them and sample contexts do not carry them,
# so anything checking "is every variable in this body supplied?" has to
# discount these.
RENDERER_INJECTED_VARIABLES: frozenset = frozenset(
    {
        "organization_logo_img",
        "organization_logo_cell",
        # The colourway. Filled from the template's own columns rather than
        # by a caller, which is the whole point of them being columns.
        "header_accent",
        "chip_tint",
        "status_chip",
        "footer_html",
        "footer_text",
    }
)


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
            "name": "items_removed_html",
            "description": "HTML list of items retired/removed from the member",
        },
        {
            "name": "items_issued_text",
            "description": "Plain-text list of items issued/assigned",
        },
        {
            "name": "items_returned_text",
            "description": "Plain-text list of items returned",
        },
        {
            "name": "items_removed_text",
            "description": "Plain-text list of items retired/removed from the member",
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
        {
            "name": "custom_message_html",
            "description": (
                "The secretary's message as a paragraph, omitted entirely when "
                "no message was written"
            ),
        },
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
        {
            "name": "details_html",
            "description": (
                "Panel listing the scheduled date and decline reason, showing "
                "only the ones that are set"
            ),
        },
        {
            "name": "details_text",
            "description": "Plain-text version of the details panel",
        },
        {
            "name": "message_html",
            "description": "The coordinator's message as a paragraph, empty if none",
        },
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
    "ballot_eligibility_summary": [
        {"name": "recipient_name", "description": "Recipient's display name"},
        {"name": "election_title", "description": "Title of the election"},
        {"name": "sent_count", "description": "Number of ballots sent"},
        {
            "name": "skipped_count",
            "description": "Number of members skipped as ineligible",
        },
        {
            "name": "total_checked_in",
            "description": "Number of members checked in at the meeting",
        },
        {
            "name": "recipients_html",
            "description": "HTML list of members who received ballots",
        },
        {
            "name": "recipients_text",
            "description": "Plain-text list of members who received ballots",
        },
        {
            "name": "skipped_voters_html",
            "description": "HTML table of skipped members with the reason for each",
        },
        {
            "name": "skipped_voters_text",
            "description": "Plain-text list of skipped members with the reason for each",
        },
    ],
    "shift_assignment": [
        {"name": "recipient_name", "description": "Assigned member's name"},
        {"name": "position", "description": "Position the member is filling"},
        {"name": "shift_date", "description": "Date of the shift"},
        {"name": "shift_start", "description": "Shift start time, department timezone"},
        {
            "name": "checklist_html",
            "description": (
                "Equipment checklists due at the start of this shift, omitted "
                "entirely when the apparatus has none"
            ),
        },
        {"name": "checklist_text", "description": "Plain-text checklist list"},
        {"name": "shift_url", "description": "Link to the shift in the schedule"},
    ],
    "shift_decline": [
        {"name": "member_name", "description": "Member who declined or was removed"},
        {
            "name": "action",
            "description": "What happened — 'declined' or 'was removed from'",
        },
        {"name": "position", "description": "Position now open"},
        {"name": "shift_date", "description": "Date of the shift"},
        {"name": "shift_url", "description": "Link to the shift in the schedule"},
    ],
    "shift_reminder": [
        {"name": "recipient_name", "description": "Member's first name"},
        {"name": "position", "description": "Position the member is filling"},
        {"name": "shift_date", "description": "Date of the shift"},
        {"name": "shift_start", "description": "Shift start time, department timezone"},
        {
            "name": "time_range",
            "description": "Shift start and end times, department timezone",
        },
        {"name": "apparatus_name", "description": "Apparatus assigned, if any"},
        {
            "name": "apparatus_html",
            "description": "Apparatus line, omitted entirely when the shift has none",
        },
        {"name": "apparatus_text", "description": "Plain-text apparatus line"},
        {"name": "roster_html", "description": "Table of the crew on this shift"},
        {"name": "roster_text", "description": "Plain-text crew list"},
        {
            "name": "checklist_html",
            "description": "Start-of-shift equipment checklists to complete",
        },
        {"name": "checklist_text", "description": "Plain-text checklist list"},
        {"name": "arrival_url", "description": "Link to mark arrival at the station"},
    ],
}

# Sample context data for previewing each template type.
# Used by the preview endpoint to substitute realistic placeholder values.
# Shared organization fields are merged from _SAMPLE_ORG_CONTEXT.
_SAMPLE_ORG_CONTEXT: Dict[str, str] = {
    "organization_name": "Sample Fire Department",
    "organization_description": "Serving Anytown and the surrounding county since 1923.",
    "organization_type_label": "Fire & EMS",
    "organization_logo": "https://example.com/logo.png",
    "organization_mailing_address": "100 Main Street\nAnytown, CA 90210",
    "organization_physical_address": "100 Main Street\nAnytown, CA 90210",
    "organization_phone": "(555) 555-1234",
    "organization_fax": "(555) 555-1235",
    "organization_email": "info@samplefd.org",
    "organization_website": "https://www.samplefd.org",
    "organization_county": "Sample County",
    "organization_founded_year": "1923",
    "organization_tax_id": "12-3456789",
    "organization_identifier": "12345",
    "organization_identifier_label": "FDID",
    "organization_fdid": "12345",
    "organization_state_id": "CA-FD-0042",
    "organization_department_id": "SFD-01",
    "login_url": "https://example.com/login",
}

# Placeholder officeholders so a preview shows a plausible signature block
# before the department has filled in its Officers screen.  Live values
# overwrite these in the preview endpoint for every office that is actually
# assigned, so a configured department previews its real signatures.
_SAMPLE_OFFICER_NAMES: Dict[str, str] = {
    "chief": "Robert Hayes",
    "deputy_chief": "Alan Pierce",
    "assistant_chief": "Maria Delgado",
    "safety_officer": "Karen Boyle",
    "training_officer": "Daniel Ruiz",
    "president": "Susan Whitfield",
    "vice_president": "Marcus Bell",
    "secretary": "Elena Novak",
    "assistant_secretary": "Priya Raman",
    "treasurer": "Thomas Grady",
    "quartermaster": "Wesley Kim",
}

for _office in OFFICE_CATALOG:
    _key = str(_office["key"])
    _name = _SAMPLE_OFFICER_NAMES.get(_key, f"Sample {_office['label']}")
    _SAMPLE_ORG_CONTEXT[f"{_key}_name"] = _name
    _SAMPLE_ORG_CONTEXT[f"{_key}_title"] = str(_office["default_title"])
    _SAMPLE_ORG_CONTEXT[f"{_key}_email"] = f"{_key.replace('_', '')}@samplefd.org"
    _SAMPLE_ORG_CONTEXT[f"{_key}_phone"] = "(555) 555-1234"


def _sample(*dicts: Dict[str, str]) -> Dict[str, str]:
    """Merge sample org context with type-specific fields."""
    merged = dict(_SAMPLE_ORG_CONTEXT)
    for d in dicts:
        merged.update(d)
    return merged


# The storefront's notices keep their variable catalogue, sample data and
# default bodies in their own module — ten more entries inline here would
# bury the rest.
TEMPLATE_VARIABLES.update(_storefront_templates.TEMPLATE_VARIABLES)

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    "welcome": _sample(
        {
            "first_name": "John",
            "last_name": "Doe",
            "full_name": "John Doe",
            "username": "jdoe",
            "temp_password": "TempPass123!",
        }
    ),
    "password_reset": _sample(
        {
            "first_name": "John",
            "reset_url": "https://example.com/reset-password?token=sample-token",
            "expiry_minutes": "30",
        }
    ),
    "event_reminder": _sample(
        {
            "recipient_name": "John Doe",
            "event_title": "Monthly Business Meeting",
            "event_type": "Business Meeting",
            "event_start": "March 15, 2026 at 07:00 PM",
            "event_end": "09:00 PM",
            "location_name": "Main Station \u2014 Meeting Room A",
            "location_details": "123 Main St, Anytown, USA",
            "event_url": "https://example.com/events/123",
        }
    ),
    "series_end_reminder": _sample(
        {
            "recipient_name": "John Doe",
            "event_title": "Weekly Officers Meeting",
            "recurrence_pattern": "Weekly",
            "series_end_date": "September 15, 2026",
            "remaining_occurrences": "26",
            "event_url": "https://example.com/events/456",
        }
    ),
    "event_cancellation": _sample(
        {
            "recipient_name": "John Doe",
            "event_title": "Monthly Business Meeting",
            "event_date": "March 15, 2026",
            "reason": "Inclement weather",
        }
    ),
    "training_approval": _sample(
        {
            "course_name": "Hazardous Materials Awareness",
            "event_title": "HazMat Refresher Training",
            "event_date": "March 20, 2026 at 09:00 AM",
            "attendee_count": "12",
            "approval_deadline": "March 18, 2026",
            "submitter_name": "Jane Smith",
            "approval_url": "https://example.com/training/approve/123",
        }
    ),
    "ballot_notification": _sample(
        {
            "recipient_name": "John Doe",
            "election_title": "Captain Election 2026",
            "meeting_date": "April 1, 2026 at 07:00 PM",
            "custom_message": "Please review the candidates before voting.",
            "custom_message_html": (
                "<p>Please review the candidates before voting.</p>"
            ),
            "ballot_url": "https://example.com/ballot#token=sample-token",
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
        }
    ),
    "member_dropped": _sample(
        {
            "member_name": "John Doe",
            "drop_type_display": "Voluntary Separation",
            "reason": "Relocation",
            "effective_date": "March 31, 2026",
            "return_deadline": "April 14, 2026",
            "item_count": "5",
            "total_value": "2,450.00",
            "items_list_html": (
                f'<table style="{TABLE_STYLE}">'
                "<thead><tr>"
                f'<th style="{TH_STYLE}text-align:left;">#</th>'
                f'<th style="{TH_STYLE}text-align:left;">Item</th>'
                f'<th style="{TH_STYLE}text-align:left;">Serial #</th>'
                f'<th style="{TH_STYLE}text-align:left;">Asset Tag</th>'
                f'<th style="{TH_STYLE}text-align:left;">Condition</th>'
                f'<th style="{TH_STYLE}text-align:right;">Value</th>'
                "</tr></thead><tbody>"
                f'<tr><td style="{TD_STYLE}">1</td>'
                f'<td style="{TD_STYLE}">Turnout Coat (Size L)</td>'
                f'<td style="{TD_STYLE}">TC-2024-0456</td>'
                f'<td style="{TD_STYLE}">TCOAT-012</td>'
                f'<td style="{TD_STYLE}">Good</td>'
                f'<td style="{TD_STYLE}text-align:right;">$850.00</td></tr>'
                f'<tr><td style="{TD_STYLE}">2</td>'
                f'<td style="{TD_STYLE}">Turnout Pants (Size L)</td>'
                f'<td style="{TD_STYLE}">TP-2024-0789</td>'
                f'<td style="{TD_STYLE}">TPANT-012</td>'
                f'<td style="{TD_STYLE}">Good</td>'
                f'<td style="{TD_STYLE}text-align:right;">$650.00</td></tr>'
                f'<tr><td style="{TD_STYLE}">3</td>'
                f'<td style="{TD_STYLE}">Helmet (Black)</td>'
                f'<td style="{TD_STYLE}">HLM-2024-0089</td>'
                f'<td style="{TD_STYLE}">HLM-089</td>'
                f'<td style="{TD_STYLE}">Excellent</td>'
                f'<td style="{TD_STYLE}text-align:right;">$450.00</td></tr>'
                f'<tr><td style="{TD_STYLE}">4</td>'
                f'<td style="{TD_STYLE}">SCBA Mask</td>'
                f'<td style="{TD_STYLE}">SCBA-2023-0234</td>'
                f'<td style="{TD_STYLE}">SCBA-234</td>'
                f'<td style="{TD_STYLE}">Fair</td>'
                f'<td style="{TD_STYLE}text-align:right;">$350.00</td></tr>'
                f'<tr><td style="{TD_STYLE}">5</td>'
                f'<td style="{TD_STYLE}">Radio (Portable)</td>'
                f'<td style="{TD_STYLE}">RAD-2024-0567</td>'
                f'<td style="{TD_STYLE}">RAD-567</td>'
                f'<td style="{TD_STYLE}">Good</td>'
                f'<td style="{TD_STYLE}text-align:right;">$150.00</td></tr>'
                "</tbody>"
                "<tfoot><tr>"
                f'<td colspan="5" style="{TFOOT_STYLE}text-align:right;">Total Outstanding Value:</td>'
                f'<td style="{TFOOT_STYLE}text-align:right;">$2,450.00</td>'
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
        }
    ),
    "inventory_change": _sample(
        {
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
            "items_removed_html": (
                "<h3>Items Removed from Your Inventory</h3>"
                "<ul><li>Damaged Helmet \u2014 Serial #HLM-2019-0007 "
                "<em>(Retired / Removed)</em></li></ul>"
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
            "items_removed_text": (
                "Items Removed from Your Inventory:\n"
                "- Damaged Helmet \u2014 Serial #HLM-2019-0007 (Retired / Removed)"
            ),
        }
    ),
    "cert_expiration": _sample(
        {
            "recipient_name": "John Doe",
            "cert_name": "EMT-Basic Certification",
            "expiration_date": "April 15, 2026",
            "days_remaining": "45",
            "renewal_url": "https://example.com/training/certifications",
        }
    ),
    "post_event_validation": _sample(
        {
            "recipient_name": "Jane Smith",
            "event_title": "Monthly Business Meeting",
            "event_date": "March 15, 2026",
            "attendee_count": "24",
            "validation_url": "https://example.com/events/123/validate",
        }
    ),
    "post_shift_validation": _sample(
        {
            "recipient_name": "Capt. Mike Davis",
            "shift_date": "March 14, 2026",
            "shift_name": "Engine 1 \u2014 Night Shift",
            "attendee_count": "6",
            "validation_url": "https://example.com/scheduling/shifts/456/validate",
        }
    ),
    "property_return_reminder": _sample(
        {
            "member_name": "John Doe",
            "item_count": "3",
            "total_value": "1,200.00",
            "items_list_html": (
                f'<table style="{TABLE_STYLE}">'
                "<thead><tr>"
                f'<th style="{TH_STYLE}text-align:left;">#</th>'
                f'<th style="{TH_STYLE}text-align:left;">Item</th>'
                f'<th style="{TH_STYLE}text-align:left;">Serial #</th>'
                f'<th style="{TH_STYLE}text-align:left;">Asset Tag</th>'
                f'<th style="{TH_STYLE}text-align:right;">Value</th>'
                "</tr></thead><tbody>"
                f'<tr><td style="{TD_STYLE}">1</td>'
                f'<td style="{TD_STYLE}">Turnout Coat (Size L)</td>'
                f'<td style="{TD_STYLE}">TC-2024-0456</td>'
                f'<td style="{TD_STYLE}">TCOAT-012</td>'
                f'<td style="{TD_STYLE}text-align:right;">$500.00</td></tr>'
                f'<tr><td style="{TD_STYLE}">2</td>'
                f'<td style="{TD_STYLE}">Helmet (Black)</td>'
                f'<td style="{TD_STYLE}">HLM-2024-0089</td>'
                f'<td style="{TD_STYLE}">HLM-089</td>'
                f'<td style="{TD_STYLE}text-align:right;">$450.00</td></tr>'
                f'<tr><td style="{TD_STYLE}">3</td>'
                f'<td style="{TD_STYLE}">Radio (Portable)</td>'
                f'<td style="{TD_STYLE}">RAD-2024-0567</td>'
                f'<td style="{TD_STYLE}">RAD-567</td>'
                f'<td style="{TD_STYLE}text-align:right;">$250.00</td></tr>'
                "</tbody>"
                "<tfoot><tr>"
                f'<td colspan="4" style="{TFOOT_STYLE}text-align:right;">Total Outstanding Value:</td>'
                f'<td style="{TFOOT_STYLE}text-align:right;">$1,200.00</td>'
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
        }
    ),
    "inactivity_warning": _sample(
        {
            "coordinator_name": "Jane Smith",
            "prospect_name": "Alex Johnson",
            "days_inactive": "21",
            "timeout_days": "30",
            "pipeline_stage": "Application Review",
            "prospect_url": "https://example.com/prospective-members/789",
        }
    ),
    "election_rollback": _sample(
        {
            "recipient_name": "Lt. Jane Smith",
            "election_title": "Captain Election 2026",
            "performer_name": "Secretary Robert Johnson",
            "reason": "Ballots were distributed to ineligible members",
        }
    ),
    "election_deleted": _sample(
        {
            "recipient_name": "Lt. Jane Smith",
            "election_title": "Captain Election 2026",
            "performer_name": "Secretary Robert Johnson",
            "reason": "Election created in error — new election will be scheduled",
        }
    ),
    "election_report": _sample(
        {
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
                f'<table style="{TABLE_STYLE}">'
                f'<tr><th style="{TH_STYLE}text-align:left;">Position</th>'
                f'<th style="{TH_STYLE}text-align:left;">Candidate</th>'
                f'<th style="{TH_STYLE}text-align:center;">Votes</th>'
                f'<th style="{TH_STYLE}text-align:center;">%</th>'
                f'<th style="{TH_STYLE}text-align:center;">Result</th></tr>'
                f'<tr><td style="{TD_STYLE}">Captain</td>'
                f'<td style="{TD_STYLE}">John Smith</td>'
                f'<td style="{TD_STYLE}text-align:center;">22</td>'
                f'<td style="{TD_STYLE}text-align:center;">57.9%</td>'
                f'<td style="{TD_STYLE}text-align:center;">\u2705 Elected</td></tr>'
                f'<tr><td style="{TD_STYLE}">Captain</td>'
                f'<td style="{TD_STYLE}">Jane Doe</td>'
                f'<td style="{TD_STYLE}text-align:center;">16</td>'
                f'<td style="{TD_STYLE}text-align:center;">42.1%</td>'
                f'<td style="{TD_STYLE}text-align:center;">&mdash;</td></tr>'
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
                f'<table style="{TABLE_STYLE}">'
                f'<tr><th style="{TH_STYLE}text-align:left;">Member</th>'
                f'<th style="{TH_STYLE}text-align:left;">Reason</th></tr>'
                f'<tr><td style="{TD_STYLE}">Tom Brown</td>'
                "<td style=\"{TD_STYLE}\">Membership tier 'Social' is not eligible to vote</td></tr>"
                f'<tr><td style="{TD_STYLE}">Sarah Lee</td>'
                f'<td style="{TD_STYLE}">Not checked in as present at the meeting</td></tr>'
                "</table>"
            ),
            "skipped_voters_text": (
                "  - Tom Brown: Membership tier 'Social' is not eligible to vote\n"
                "  - Sarah Lee: Not checked in as present at the meeting"
            ),
        }
    ),
    "member_archived": _sample(
        {
            "member_name": "John Doe",
            "previous_status": "Dropped",
        }
    ),
    "event_request_status": _sample(
        {
            "contact_name": "John Doe",
            "status_label": "Scheduled",
            "event_date": "April 15, 2026 at 06:00 PM",
            "decline_reason": "",
            "message": "Your event has been approved and added to the calendar.",
            "details_html": (
                '<div class="details">'
                "<p><strong>Scheduled Date:</strong> April 15, 2026 at 06:00 PM</p>"
                "</div>"
            ),
            "details_text": "Scheduled Date: April 15, 2026 at 06:00 PM",
            "message_html": (
                '<p style="white-space:pre-line;">Your event has been approved '
                "and added to the calendar.</p>"
            ),
        }
    ),
    "it_password_notification": _sample(
        {
            "user_name": "John Doe",
            "user_email": "jdoe@example.com",
            "request_time": "March 1, 2026 at 02:30 PM",
            "ip_address": "192.168.1.100",
        }
    ),
    "duplicate_application": _sample(
        {
            "applicant_name": "Alex Johnson",
            "original_date": "February 15, 2026",
        }
    ),
    "ballot_eligibility_summary": _sample(
        {
            "recipient_name": "Secretary Robert Johnson",
            "election_title": "Captain Election 2026",
            "sent_count": "38",
            "skipped_count": "7",
            "total_checked_in": "41",
            "recipients_html": (
                "<ul>"
                "<li>John Smith (jsmith@example.com)</li>"
                "<li>Jane Doe (jdoe@example.com)</li>"
                "<li>Mike Wilson (mwilson@example.com)</li>"
                "<li>... and 35 others</li>"
                "</ul>"
            ),
            "recipients_text": (
                "  - John Smith (jsmith@example.com)\n"
                "  - Jane Doe (jdoe@example.com)\n"
                "  - Mike Wilson (mwilson@example.com)\n"
                "  ... and 35 others"
            ),
            "skipped_voters_html": (
                f'<table style="{TABLE_STYLE}">'
                f'<tr><th style="{TH_STYLE}text-align:left;">Member</th>'
                f'<th style="{TH_STYLE}text-align:left;">Reason</th></tr>'
                f'<tr><td style="{TD_STYLE}">Tom Brown</td>'
                "<td style=\"{TD_STYLE}\">Membership tier 'Social' is not eligible to vote</td></tr>"
                f'<tr><td style="{TD_STYLE}">Sarah Lee</td>'
                f'<td style="{TD_STYLE}">Not checked in as present at the meeting</td></tr>'
                "</table>"
            ),
            "skipped_voters_text": (
                "  - Tom Brown: Membership tier 'Social' is not eligible to vote\n"
                "  - Sarah Lee: Not checked in as present at the meeting"
            ),
        }
    ),
    "shift_assignment": _sample(
        {
            "recipient_name": "John Doe",
            "position": "Driver",
            "shift_date": "March 18, 2026",
            "shift_start": "06:00",
            "checklist_html": (
                "<p><strong>Equipment checklists to complete:</strong></p>"
                "<ul><li>Engine 1 Start-of-Shift Check</li></ul>"
            ),
            "checklist_text": (
                "Equipment checklists to complete: Engine 1 Start-of-Shift Check"
            ),
            "shift_url": "https://example.com/scheduling?shift=456",
        }
    ),
    "shift_decline": _sample(
        {
            "member_name": "John Doe",
            "action": "declined",
            "position": "Driver",
            "shift_date": "March 18, 2026",
            "shift_url": "https://example.com/scheduling?shift=456",
        }
    ),
    "shift_reminder": _sample(
        {
            "recipient_name": "John",
            "position": "Driver",
            "shift_date": "Mar 18, 2026",
            "shift_start": "06:00",
            "time_range": "06:00 – 18:00",
            "apparatus_name": "Engine 1",
            "apparatus_html": "<p><strong>Apparatus:</strong> Engine 1</p>",
            "apparatus_text": "Apparatus: Engine 1",
            "roster_html": (
                "<p><strong>Crew roster:</strong></p>"
                f'<table style="{TABLE_STYLE}">'
                f'<tr><td style="{TD_STYLE}">John Doe</td>'
                f'<td style="{TD_STYLE}">Driver</td></tr>'
                f'<tr><td style="{TD_STYLE}">Jane Smith</td>'
                f'<td style="{TD_STYLE}">Officer</td></tr>'
                "</table>"
            ),
            "roster_text": "Crew: John Doe (Driver), Jane Smith (Officer)",
            "checklist_html": (
                "<p><strong>Start-of-shift checklists to complete:</strong></p>"
                "<ul><li>Engine 1 Start-of-Shift Check</li></ul>"
            ),
            "checklist_text": (
                "Start-of-shift checklists: Engine 1 Start-of-Shift Check"
            ),
            "arrival_url": "https://example.com/scheduling/checkin?shift=456",
        }
    ),
}

# Storefront samples merge in with organization fields, the same as every
# entry above — the preview would otherwise show a bare {{organization_name}}.
SAMPLE_CONTEXT.update(
    {key: _sample(value) for key, value in _storefront_templates.SAMPLE_CONTEXT.items()}
)

# Default welcome email HTML body
DEFAULT_WELCOME_HTML = build_shell(
    "Your account is ready",
    """        <p>Hello {{first_name}},</p>
        <p>Your account has been created for <strong>{{organization_name}}</strong>. You can now log in and access the system.</p>
        <div class="details" style="border-left-color: {accent};" role="region" aria-label="Account credentials">
            <table>
                <tr><th>Username</th><td>{{username}}</td></tr>
                <tr><th>Temporary password</th><td>{{temp_password}}</td></tr>
            </table>
        </div>
        <p>For security, please change your password after your first login.</p>
        <p><a href="{{login_url}}" class="button" style="background-color: {accent};" role="link">Log In Now</a></p>
        <p class="fineprint">If the button doesn't work, copy and paste this URL into your browser:<br/>{{login_url}}</p>""",
    accent=ACCENT_RED,
    chip="Account ready",
)

DEFAULT_WELCOME_TEXT = """Welcome to {{organization_name}}

Hello {{first_name}},

Your account has been created for {{organization_name}}. You can now log in and access the system.

Username: {{username}}
Temporary Password: {{temp_password}}

For security, please change your password after your first login.

Log in at: {{login_url}}

{{footer_text}}"""

DEFAULT_WELCOME_SUBJECT = "Welcome to {{organization_name}} — Your Account is Ready"

# Default password reset email
DEFAULT_PASSWORD_RESET_HTML = build_shell(
    "Reset your password",
    """        <p>Hello {{first_name}},</p>
        <p>We received a request to reset your password for <strong>{{organization_name}}</strong>. This link expires in <strong>{{expiry_minutes}} minutes</strong>.</p>
        <p><a href="{{reset_url}}" class="button" style="background-color: {accent};" role="link">Reset Password</a></p>
        <p class="fineprint">If the button doesn't work, copy and paste this URL into your browser:<br/>{{reset_url}}</p>
        <p>If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>""",
    accent=ACCENT_SLATE,
    chip="Security",
)

DEFAULT_PASSWORD_RESET_TEXT = """Password Reset Request

Hello {{first_name}},

We received a request to reset your password for {{organization_name}}.

Click the link below to set a new password. This link will expire in {{expiry_minutes}} minutes.

Reset your password: {{reset_url}}

If you did not request a password reset, you can safely ignore this email. Your password will not be changed.

{{footer_text}}"""

DEFAULT_PASSWORD_RESET_SUBJECT = "Password Reset — {{organization_name}}"

# Default member dropped / property return email template
DEFAULT_MEMBER_DROPPED_HTML = build_shell(
    "Department Property Return Notice",
    """        <p>Dear {{member_name}},</p>
        <p>
            This message serves as formal notice that your membership status with
            <strong>{{organization_name}}</strong> has been changed to
            <strong>{{drop_type_display}}</strong> effective <strong>{{effective_date}}</strong>.
        </p>
        <p><strong>Reason:</strong> {{reason}}</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Outstanding items</th><td>{{item_count}} item(s)</td></tr>
                <tr><th>Total assessed value</th><td>${{total_value}}</td></tr>
                <tr><th>Return deadline</th><td>{{return_deadline}}</td></tr>
            </table>
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
        <p class="fineprint">A copy of this notice has been placed in your member file.</p>""",
    accent=ACCENT_RED,
    chip="Property return",
)

DEFAULT_MEMBER_DROPPED_TEXT = """Department Property Return Notice

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

{{footer_text}}"""

# Default inventory change notification email
DEFAULT_INVENTORY_CHANGE_HTML = build_shell(
    "Inventory Change Confirmation",
    """        <p>Hello {{first_name}},</p>
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
        <p>Thank you,<br/>{{organization_name}}</p>""",
    accent=ACCENT_RED,
    chip="Property update",
)

DEFAULT_INVENTORY_CHANGE_TEXT = """Inventory Change Confirmation — {{organization_name}}

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

{{footer_text}}"""

DEFAULT_INVENTORY_CHANGE_SUBJECT = "Inventory Update — {{organization_name}}"

# Default certification expiration alert email
DEFAULT_CERT_EXPIRATION_HTML = build_shell(
    "{{cert_name}} expires in {{days_remaining}} days",
    """        <p>Hello {{recipient_name}}, this is a reminder that your certification is approaching its expiration date.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Certification</th><td>{{cert_name}}</td></tr>
                <tr><th>Expiration date</th><td>{{expiration_date}}</td></tr>
                <tr><th>Days remaining</th><td>{{days_remaining}}</td></tr>
            </table>
        </div>
        <div class="alert">
            <p>Renew before it expires to stay compliant for calls and drills.</p>
        </div>
        <p><a href="{{renewal_url}}" class="button" style="background-color: {accent};" role="link">View Certifications</a></p>""",
    accent=ACCENT_AMBER,
    chip="Action required",
)

DEFAULT_CERT_EXPIRATION_TEXT = """Certification Expiration Notice

Hello {{recipient_name}},

This is a reminder that your certification is approaching its expiration date:

Certification: {{cert_name}}
Expiration Date: {{expiration_date}}
Days Remaining: {{days_remaining}}

Please take action to renew this certification before it expires.

View your certifications: {{renewal_url}}

{{footer_text}}"""

DEFAULT_CERT_EXPIRATION_SUBJECT = (
    "Certification Expiring: {{cert_name}} — {{organization_name}}"
)

# Default post-event validation email
DEFAULT_POST_EVENT_VALIDATION_HTML = build_shell(
    "Please Validate Attendance",
    """        <p>Hello {{recipient_name}}, the following event has ended and needs attendance validation.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Event</th><td>{{event_title}}</td></tr>
                <tr><th>Date</th><td>{{event_date}}</td></tr>
                <tr><th>Recorded attendees</th><td>{{attendee_count}}</td></tr>
            </table>
        </div>
        <p>Please review and validate the attendance records at your earliest convenience.</p>
        <p><a href="{{validation_url}}" class="button" style="background-color: {accent};" role="link">Validate Attendance</a></p>""",
    accent=ACCENT_BLUE,
    chip="Action required",
)

DEFAULT_POST_EVENT_VALIDATION_TEXT = """Please Validate Attendance

Hello {{recipient_name}},

The following event has ended and needs attendance validation:

Event: {{event_title}}
Date: {{event_date}}
Recorded Attendees: {{attendee_count}}

Please review and validate the attendance records.

Validate attendance: {{validation_url}}

{{footer_text}}"""

DEFAULT_POST_EVENT_VALIDATION_SUBJECT = "Attendance Validation Needed: {{event_title}}"

# Default post-shift validation email
DEFAULT_POST_SHIFT_VALIDATION_HTML = build_shell(
    "Shift Attendance Validation",
    """        <p>Hello {{recipient_name}}, the following shift has ended and needs attendance validation.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Shift</th><td>{{shift_name}}</td></tr>
                <tr><th>Date</th><td>{{shift_date}}</td></tr>
                <tr><th>Members on shift</th><td>{{attendee_count}}</td></tr>
            </table>
        </div>
        <p>Please review and confirm the shift attendance.</p>
        <p><a href="{{validation_url}}" class="button" style="background-color: {accent};" role="link">Validate Shift</a></p>""",
    accent=ACCENT_GREEN,
    chip="Action required",
)

DEFAULT_POST_SHIFT_VALIDATION_TEXT = """Shift Attendance Validation

Hello {{recipient_name}},

The following shift has ended and needs attendance validation:

Shift: {{shift_name}}
Date: {{shift_date}}
Members on Shift: {{attendee_count}}

Please review and confirm the shift attendance.

Validate shift: {{validation_url}}

{{footer_text}}"""

DEFAULT_POST_SHIFT_VALIDATION_SUBJECT = (
    "Shift Validation Needed: {{shift_name}} — {{shift_date}}"
)

# Default property return reminder email
DEFAULT_PROPERTY_RETURN_REMINDER_HTML = build_shell(
    "Property Return Reminder",
    """        <p>Dear {{member_name}},</p>
        <p>This is a reminder that you still have outstanding department property that needs to be returned.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Outstanding items</th><td>{{item_count}} item(s)</td></tr>
                <tr><th>Total assessed value</th><td>${{total_value}}</td></tr>
                <tr><th>Days since separation</th><td>{{days_since_drop}}</td></tr>
                <tr><th>Return deadline</th><td>{{return_deadline}}</td></tr>
            </table>
        </div>
        {{items_list_html}}
        <p>Please contact the department administration to arrange return of these items as soon as possible.</p>""",
    accent=ACCENT_RED,
    chip="Reminder",
)

DEFAULT_PROPERTY_RETURN_REMINDER_TEXT = """Property Return Reminder

Dear {{member_name}},

This is a reminder that you still have outstanding department property that needs to be returned.

Outstanding Items: {{item_count}} item(s)
Total Assessed Value: ${{total_value}}
Days Since Separation: {{days_since_drop}}
Return Deadline: {{return_deadline}}

{{items_list_text}}

Please contact the department administration to arrange return of these items.

{{footer_text}}"""

DEFAULT_PROPERTY_RETURN_REMINDER_SUBJECT = (
    "Property Return Reminder — {{organization_name}}"
)

# Default inactivity warning email
DEFAULT_INACTIVITY_WARNING_HTML = build_shell(
    "Prospective Member Inactivity Alert",
    """        <p>Hello {{coordinator_name}}, a prospective member in your pipeline has been inactive and may need attention.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Prospect</th><td>{{prospect_name}}</td></tr>
                <tr><th>Current stage</th><td>{{pipeline_stage}}</td></tr>
                <tr><th>Days inactive</th><td>{{days_inactive}} days</td></tr>
                <tr><th>Timeout threshold</th><td>{{timeout_days}} days</td></tr>
            </table>
        </div>
        <p>Please review their progress and take appropriate action.</p>
        <p><a href="{{prospect_url}}" class="button" style="background-color: {accent};" role="link">View Prospect</a></p>""",
    accent=ACCENT_AMBER,
    chip="Needs attention",
)

DEFAULT_INACTIVITY_WARNING_TEXT = """Prospective Member Inactivity Alert

Hello {{coordinator_name}},

A prospective member in your pipeline has been inactive and may need attention:

Prospect: {{prospect_name}}
Current Stage: {{pipeline_stage}}
Days Inactive: {{days_inactive}} days
Timeout Threshold: {{timeout_days}} days

Please review their progress and take appropriate action.

View prospect: {{prospect_url}}

{{footer_text}}"""

DEFAULT_INACTIVITY_WARNING_SUBJECT = (
    "Inactivity Alert: {{prospect_name}} — {{organization_name}}"
)

# Default election rollback alert email
DEFAULT_ELECTION_ROLLBACK_HTML = build_shell(
    "Election Rolled Back",
    """        <p>Hello {{recipient_name}}, an election has been rolled back to a previous stage.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Election</th><td>{{election_title}}</td></tr>
                <tr><th>Rolled back by</th><td>{{performer_name}}</td></tr>
                <tr><th>Reason</th><td>{{reason}}</td></tr>
            </table>
        </div>
        <div class="alert">
            <p>Votes recorded after the stage this election returned to are no longer counted.</p>
        </div>
        <p>Please review the election details and coordinate with your team as needed.</p>""",
    accent=ACCENT_INDIGO,
    chip="Rolled back",
)

DEFAULT_ELECTION_ROLLBACK_TEXT = """Election Rolled Back

Hello {{recipient_name}},

An election has been rolled back to a previous stage:

Election: {{election_title}}
Rolled back by: {{performer_name}}
Reason: {{reason}}

Please review the election details and coordinate with your team as needed.

{{footer_text}}"""

DEFAULT_ELECTION_ROLLBACK_SUBJECT = "ALERT: Election Rolled Back — {{election_title}}"

# Default election deleted alert email
DEFAULT_ELECTION_DELETED_HTML = build_shell(
    "Election Deleted",
    """        <p>Hello {{recipient_name}}, an election has been permanently deleted.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Election</th><td>{{election_title}}</td></tr>
                <tr><th>Deleted by</th><td>{{performer_name}}</td></tr>
                <tr><th>Reason</th><td>{{reason}}</td></tr>
            </table>
        </div>
        <div class="alert">
            <p>All associated ballots and results have been removed. This cannot be undone.</p>
        </div>
        <p>If you have questions, please contact {{performer_name}}.</p>""",
    accent=ACCENT_INDIGO,
    chip="Deleted",
)

DEFAULT_ELECTION_DELETED_TEXT = """Election Deleted

Hello {{recipient_name}},

An election has been permanently deleted:

Election: {{election_title}}
Deleted by: {{performer_name}}
Reason: {{reason}}

All associated ballots and results have been removed.

{{footer_text}}"""

DEFAULT_ELECTION_DELETED_SUBJECT = "CRITICAL: Election Deleted — {{election_title}}"

# Default member archived notification email
DEFAULT_MEMBER_ARCHIVED_HTML = build_shell(
    "Member Archived",
    """        <p><strong>{{member_name}}</strong> has been automatically archived.</p>
        <p>All department property has been returned. Previous status: <strong>{{previous_status}}</strong>.</p>
        <p>The member's profile remains accessible for legal requests or future reactivation.</p>""",
    accent=ACCENT_RED,
    chip="Member archived",
)

DEFAULT_MEMBER_ARCHIVED_TEXT = """Member Archived: {{member_name}}

All department property has been returned. Previous status: {{previous_status}}.

The member's profile remains accessible for legal requests or future reactivation.

{{footer_text}}"""

DEFAULT_MEMBER_ARCHIVED_SUBJECT = (
    "Member Archived: {{member_name}} — {{organization_name}}"
)

# Default event request status update email.
#
# This one goes to a member of the public, and most status changes carry only
# some of the optional fields — a scheduled request has a date and no decline
# reason, a declined one the reverse. The panel and the coordinator's note are
# therefore injected pre-built so an absent value leaves nothing behind; the
# earlier body labelled all three unconditionally and mailed "Reason:" followed
# by empty space to whoever asked the department to come to their block party.
DEFAULT_EVENT_REQUEST_STATUS_HTML = build_shell(
    "Event Request Update",
    """        <p>Hello {{contact_name}},</p>
        <p>Your event request has been updated to: <strong>{{status_label}}</strong>.</p>
        {{details_html}}
        {{message_html}}
        <p>Thank you for your request.</p>""",
    accent=ACCENT_BLUE,
    chip="Request update",
)

DEFAULT_EVENT_REQUEST_STATUS_TEXT = """Event Request Update

Hello {{contact_name}},

Your event request has been updated to: {{status_label}}.

{{details_text}}
{{message}}

Thank you for your request.

{{footer_text}}"""

DEFAULT_EVENT_REQUEST_STATUS_SUBJECT = "Event Request Update — {{status_label}}"

# Default IT password reset notification email
DEFAULT_IT_PASSWORD_NOTIFICATION_HTML = build_shell(
    "IT Notice: Password Reset Requested",
    """        <p>A password reset has been requested for the following user.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>User</th><td>{{user_name}}</td></tr>
                <tr><th>Email</th><td>{{user_email}}</td></tr>
                <tr><th>Requested at</th><td>{{request_time}}</td></tr>
                <tr><th>IP address</th><td>{{ip_address}}</td></tr>
            </table>
        </div>
        <p>This is an informational notice. No action is required unless the request appears suspicious.</p>""",
    accent=ACCENT_SLATE,
    chip="Security",
)

DEFAULT_IT_PASSWORD_NOTIFICATION_TEXT = """IT Notice: Password Reset Requested

A password reset has been requested for the following user:

User: {{user_name}}
Email: {{user_email}}
Requested at: {{request_time}}
IP Address: {{ip_address}}

This is an informational notice. No action is required unless the request appears suspicious.

{{footer_text}}"""

DEFAULT_IT_PASSWORD_NOTIFICATION_SUBJECT = (
    "[IT Notice] Password Reset Requested — {{organization_name}}"
)

# Default duplicate application notification email
DEFAULT_DUPLICATE_APPLICATION_HTML = build_shell(
    "Application Already on File",
    """        <p>Hello {{applicant_name}},</p>
        <p>Thank you for your interest in joining {{organization_name}}.</p>
        <p>Our records show that we already have an application on file for
        this email address, originally received on <strong>{{original_date}}</strong>.
        A duplicate application has not been created.</p>
        <p>If you believe this is an error, or if you have questions about the
        status of your application, please contact us directly.</p>""",
    accent=ACCENT_RED,
    chip="Already on file",
)

DEFAULT_DUPLICATE_APPLICATION_TEXT = """Application Already on File

Hello {{applicant_name}},

Thank you for your interest in joining {{organization_name}}.

Our records show that we already have an application on file for this
email address, originally received on {{original_date}}. A duplicate
application has not been created.

If you believe this is an error, or if you have questions about the
status of your application, please contact us directly.

{{footer_text}}"""

DEFAULT_DUPLICATE_APPLICATION_SUBJECT = (
    "Application Already on File — {{organization_name}}"
)

# Default ballot notification email
DEFAULT_BALLOT_NOTIFICATION_HTML = build_shell(
    "{{election_title}}",
    """        <p>Hello {{recipient_name}}, a ballot is now available for your review and vote.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Meeting date</th><td>{{meeting_date}}</td></tr>
                <tr><th>Voting opens</th><td>{{voting_opens}}</td></tr>
                <tr><th>Voting closes</th><td>{{voting_closes}}</td></tr>
            </table>
        </div>
        <h2>Your ballot items</h2>
        {{ballot_items_html}}
        {{custom_message_html}}
        <p><a href="{{ballot_url}}" class="button" style="background-color: {accent};" role="link">Vote Now</a></p>
        <p class="fineprint">Clicking the link above will automatically log you in to vote.</p>
        <p>If you have any questions, please contact your election administrator:<br/>
        <strong>{{admin_contact_name}}</strong> ({{admin_contact_email}})</p>""",
    accent=ACCENT_INDIGO,
    chip="Ballot open",
    subtitle="Voting closes {{voting_closes}}",
)

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

{{footer_text}}"""

DEFAULT_BALLOT_NOTIFICATION_SUBJECT = "Ballot Available: {{election_title}}"

# Default election report email
DEFAULT_ELECTION_REPORT_HTML = build_shell(
    "Election Report",
    """        <p>Hello {{recipient_name}}, the following election has been closed. Below is the official report.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Election</th><td>{{election_title}}</td></tr>
                <tr><th>Type</th><td>{{election_type}}</td></tr>
                <tr><th>Voting period</th><td>{{start_date}} &mdash; {{end_date}}</td></tr>
            </table>
        </div>
        <h2>Turnout &amp; quorum</h2>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Eligible voters</th><td>{{total_eligible_voters}}</td></tr>
                <tr><th>Votes cast</th><td>{{total_votes_cast}}</td></tr>
                <tr><th>Turnout</th><td>{{voter_turnout_percentage}}%</td></tr>
                <tr><th>Quorum</th><td>{{quorum_status}}</td></tr>
            </table>
            <p>{{quorum_detail}}</p>
        </div>
        <h2>Results</h2>
        {{results_html}}
        <h2>Ballot recipients ({{total_eligible_voters}})</h2>
        <p>The following members received ballots:</p>
        {{ballot_recipients_html}}
        <h2>Members who did not receive ballots</h2>
        <p>The following active members were not sent a ballot, with the reason why:</p>
        {{skipped_voters_html}}""",
    accent=ACCENT_INDIGO,
    chip="Official report",
    subtitle="{{election_title}}",
    layout="digest",
)

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

{{footer_text}}"""

DEFAULT_ELECTION_REPORT_SUBJECT = (
    "Election Report: {{election_title}} — {{organization_name}}"
)

# Default ballot eligibility summary email (sent to secretary after ballot dispatch)
DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_HTML = build_shell(
    "Ballot Eligibility Summary",
    """        <p>Hello {{recipient_name}}, ballot emails for <strong>{{election_title}}</strong> have been sent. Below is a summary of member eligibility.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Ballots sent</th><td>{{sent_count}}</td></tr>
                <tr><th>Members skipped</th><td>{{skipped_count}}</td></tr>
                <tr><th>Total checked in</th><td>{{total_checked_in}}</td></tr>
            </table>
        </div>
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
        </ul>""",
    accent=ACCENT_INDIGO,
    chip="Eligibility summary",
    subtitle="{{election_title}}",
    layout="digest",
)

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

{{footer_text}}"""

DEFAULT_BALLOT_ELIGIBILITY_SUMMARY_SUBJECT = (
    "Ballot Eligibility Summary: {{election_title}} — {{organization_name}}"
)

# Default event cancellation email
DEFAULT_EVENT_CANCELLATION_HTML = build_shell(
    "Event Cancelled",
    """        <p>Hello {{recipient_name}}, the following event has been cancelled.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Event</th><td>{{event_title}}</td></tr>
                <tr><th>Original date</th><td>{{event_date}}</td></tr>
                <tr><th>Reason</th><td>{{reason}}</td></tr>
            </table>
        </div>
        <p>Please update your calendar accordingly. If you have questions, contact your department leadership.</p>""",
    accent=ACCENT_BLUE,
    chip="Cancelled",
)

DEFAULT_EVENT_CANCELLATION_TEXT = """Event Cancelled

Hello {{recipient_name}},

The following event has been cancelled:

Event: {{event_title}}
Original Date: {{event_date}}
Reason: {{reason}}

Please update your calendar accordingly.

{{footer_text}}"""

DEFAULT_EVENT_CANCELLATION_SUBJECT = (
    "Event Cancelled: {{event_title}} — {{organization_name}}"
)

# Default event reminder email
DEFAULT_EVENT_REMINDER_HTML = build_shell(
    "{{event_title}}",
    """        <p>Hello {{recipient_name}}, this is a reminder about an upcoming event.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Type</th><td>{{event_type}}</td></tr>
                <tr><th>Start</th><td>{{event_start}}</td></tr>
                <tr><th>End</th><td>{{event_end}}</td></tr>
                <tr><th>Location</th><td>{{location_name}}<br/>{{location_details}}</td></tr>
            </table>
        </div>
        <p><a href="{{event_url}}" class="button" style="background-color: {accent};" role="link">View Event</a></p>""",
    accent=ACCENT_BLUE,
    chip="Reminder",
    subtitle="{{event_start}}",
)

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

{{footer_text}}"""

DEFAULT_EVENT_REMINDER_SUBJECT = "Reminder: {{event_title}} — {{event_start}}"

# Default series end reminder email
DEFAULT_SERIES_END_REMINDER_HTML = build_shell(
    "Recurring Series Ending Soon",
    """        <p>Hello {{recipient_name}}, this is a reminder that the following recurring event series is scheduled to end in approximately <strong>6 months</strong>.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Event</th><td>{{event_title}}</td></tr>
                <tr><th>Pattern</th><td>{{recurrence_pattern}}</td></tr>
                <tr><th>Series ends</th><td>{{series_end_date}}</td></tr>
                <tr><th>Remaining occurrences</th><td>{{remaining_occurrences}}</td></tr>
            </table>
        </div>
        <p>If you would like to extend or modify this series, please update the event before the series end date.</p>
        <p><a href="{{event_url}}" class="button" style="background-color: {accent};" role="link">View Event</a></p>""",
    accent=ACCENT_BLUE,
    chip="Ending soon",
    subtitle="{{series_end_date}}",
)

DEFAULT_SERIES_END_REMINDER_TEXT = """Recurring Series Ending Soon

Hello {{recipient_name}},

This is a reminder that the following recurring event series is scheduled to end in approximately 6 months:

Event: {{event_title}}
Pattern: {{recurrence_pattern}}
Series Ends: {{series_end_date}}
Remaining Occurrences: {{remaining_occurrences}}

If you would like to extend or modify this series, please update the event before the series end date.

View event: {{event_url}}

{{footer_text}}"""

DEFAULT_SERIES_END_REMINDER_SUBJECT = (
    "Recurring Series Ending Soon: {{event_title}} — Ends {{series_end_date}}"
)

# Default training approval email
DEFAULT_TRAINING_APPROVAL_HTML = build_shell(
    "Training Approval Needed",
    """        <p>Hello, a training event has been submitted and requires your approval.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Course</th><td>{{course_name}}</td></tr>
                <tr><th>Event</th><td>{{event_title}}</td></tr>
                <tr><th>Date</th><td>{{event_date}}</td></tr>
                <tr><th>Attendees</th><td>{{attendee_count}}</td></tr>
                <tr><th>Submitted by</th><td>{{submitter_name}}</td></tr>
                <tr><th>Approval deadline</th><td>{{approval_deadline}}</td></tr>
            </table>
        </div>
        <p><a href="{{approval_url}}" class="button" style="background-color: {accent};" role="link">Review &amp; Approve</a></p>""",
    accent=ACCENT_AMBER,
    chip="Approval needed",
    subtitle="Due {{approval_deadline}}",
)

DEFAULT_TRAINING_APPROVAL_TEXT = """Training Approval Needed

A training event has been submitted and requires your approval:

Course: {{course_name}}
Event: {{event_title}}
Date: {{event_date}}
Attendees: {{attendee_count}}
Submitted by: {{submitter_name}}
Approval Deadline: {{approval_deadline}}

Review and approve: {{approval_url}}

{{footer_text}}"""

DEFAULT_TRAINING_APPROVAL_SUBJECT = (
    "Training Approval Needed: {{course_name}} — {{event_date}}"
)

# Shift notices. Departments send these more often than anything else in the
# catalogue, and until these defaults existed the wording lived in
# SchedulingService and run_shift_reminders with no way to change it — the
# template type was already in the enum and already had a home in the Email
# Templates screen, so the row was simply never created.
#
# {{checklist_names}} and {{hours_until}} may arrive empty (no apparatus
# checklist configured, no reminder offset), so both sit on their own line
# rather than inside a labelled panel row where an empty value would leave a
# dangling "Checklists:".
DEFAULT_SHIFT_ASSIGNMENT_HTML = build_shell(
    "New shift assignment",
    """        <p>Hello {{recipient_name}}, you have been assigned to an upcoming shift.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Position</th><td>{{position}}</td></tr>
                <tr><th>Date</th><td>{{shift_date}}</td></tr>
                <tr><th>Starts</th><td>{{shift_start}}</td></tr>
            </table>
        </div>
        {{checklist_html}}
        <p>Please confirm or decline this assignment so the shift officer knows
        whether the position is covered.</p>
        <p><a href="{{shift_url}}" class="button" style="background-color: {accent};" role="link">View Shift</a></p>""",
    accent=ACCENT_GREEN,
    chip="Assignment",
    subtitle="{{shift_date}}",
)

DEFAULT_SHIFT_ASSIGNMENT_TEXT = """New Shift Assignment

Hello {{recipient_name}},

You have been assigned to an upcoming shift:

Position: {{position}}
Date: {{shift_date}}
Starts: {{shift_start}}

{{checklist_text}}

Please confirm or decline this assignment so the shift officer knows whether
the position is covered.

View shift: {{shift_url}}

{{footer_text}}"""

DEFAULT_SHIFT_ASSIGNMENT_SUBJECT = "Shift Assignment: {{position}} on {{shift_date}}"

DEFAULT_SHIFT_DECLINE_HTML = build_shell(
    "Shift Coverage Needed",
    """        <p><strong>{{member_name}}</strong> {{action}} the following position. It is now open.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Position</th><td>{{position}}</td></tr>
                <tr><th>Date</th><td>{{shift_date}}</td></tr>
            </table>
        </div>
        <p>Please assign a replacement so the shift is not left short.</p>
        <p><a href="{{shift_url}}" class="button" style="background-color: {accent};" role="link">Open the Schedule</a></p>""",
    accent=ACCENT_AMBER,
    chip="Coverage needed",
    subtitle="{{shift_date}}",
)

DEFAULT_SHIFT_DECLINE_TEXT = """Shift Coverage Needed

{{member_name}} {{action}} the following position. It is now open:

Position: {{position}}
Date: {{shift_date}}

Please assign a replacement so the shift is not left short.

Open the schedule: {{shift_url}}

{{footer_text}}"""

DEFAULT_SHIFT_DECLINE_SUBJECT = "Shift Coverage Needed: {{position}} on {{shift_date}}"

DEFAULT_SHIFT_REMINDER_HTML = build_shell(
    "Start-of-Shift Reminder",
    """        <p>Hello {{recipient_name}}, your upcoming shift briefing is below. Please arrive on time and mark
        your arrival when you get to the station.</p>
        <div class="details" style="border-left-color: {accent};">
            <table>
                <tr><th>Date</th><td>{{shift_date}}</td></tr>
                <tr><th>Time</th><td>{{time_range}}</td></tr>
                <tr><th>Your position</th><td>{{position}}</td></tr>
            </table>
        </div>
        {{apparatus_html}}
        {{roster_html}}
        {{checklist_html}}
        <p><a href="{{arrival_url}}" class="button" style="background-color: {accent};" role="link">Mark Arrival</a></p>""",
    accent=ACCENT_GREEN,
    chip="Shift briefing",
    subtitle="{{shift_date}} at {{shift_start}}",
)

DEFAULT_SHIFT_REMINDER_TEXT = """Start-of-Shift Reminder

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

{{footer_text}}"""

DEFAULT_SHIFT_REMINDER_SUBJECT = "Shift Reminder — {{shift_date}} at {{shift_start}}"


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
        f'<th style="{TH_STYLE}text-align:{"right" if c == "Value" else "left"};">{c}</th>'
        for c in cols
    )
    rows = ""
    for idx, item in enumerate(items, 1):
        cells = (
            f'<td style="{TD_STYLE}">{idx}</td>'
            f'<td style="{TD_STYLE}">{_h.escape(str(item.get("name", "")))}</td>'
            f'<td style="{TD_STYLE}">{_h.escape(str(item.get("serial_number", "-")))}</td>'
            f'<td style="{TD_STYLE}">{_h.escape(str(item.get("asset_tag", "-")))}</td>'
        )
        if include_condition:
            cond = item.get("condition", "unknown")
            cells += f'<td style="{TD_STYLE}">{_h.escape(str(cond).title())}</td>'
        cells += (
            f'<td style="{TD_STYLE}text-align:right;">${item.get("value", 0):,.2f}</td>'
        )
        rows += f"<tr>{cells}</tr>"

    col_count = len(cols)
    return (
        f'<table style="{TABLE_STYLE}">'
        f"<thead><tr>{header_cells}</tr></thead>"
        f"<tbody>{rows}</tbody>"
        f'<tfoot><tr><td colspan="{col_count - 1}" style="{TFOOT_STYLE}text-align:right;">Total Outstanding Value:</td>'
        f'<td style="{TFOOT_STYLE}text-align:right;">${total_value:,.2f}</td>'
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

    @classmethod
    def _colourway_defaults(cls, template_type: Any) -> Dict[str, Any]:
        """The accent and chip a type ships with, or an empty mapping.

        Empty for CUSTOM — the blank slate an admin creates by hand. Its body
        is whatever they wrote, so there is no colourway to assume and
        assuming one would paint a rule across markup that never asked for
        it.
        """
        defn = next(
            (d for d in cls._DEFAULT_TEMPLATE_DEFS if d["type"] == template_type),
            None,
        )
        if not defn:
            return {}
        return {
            "accent": defn.get("accent"),
            "chip": defn.get("chip", ""),
            "layout": defn.get("layout", DEFAULT_LAYOUT),
        }

    def default_for(self, template_type: Any) -> Optional[Dict[str, Any]]:
        """The registered default definition for a type, or ``None``.

        One lookup, so ``reset_to_default`` and the customised check cannot
        disagree about what "the default" is — which they would eventually,
        because the answer to "has this been edited?" is only meaningful if
        it is measured against the same constant Reset would restore.
        """
        return next(
            (d for d in self._DEFAULT_TEMPLATE_DEFS if d["type"] == template_type),
            None,
        )

    def is_customized(self, template: EmailTemplate) -> bool:
        """Has a department changed anything Reset would put back?

        Compares the fields ``reset_to_default`` restores, not just the body:
        a notice whose subject line was reworded is edited, and telling an
        admin otherwise sends them looking for the change somewhere else.

        A type with no registered default — ``CUSTOM``, the blank slate an
        admin creates by hand — is customised by definition: there is nothing
        it could be a copy of.

        The colourway columns are deliberately *not* part of this. Recolouring
        a notice leaves every word of it as shipped, and calling that "Edited"
        would send an admin looking through the body for a change that is not
        in there. Reset still restores the colour, because Reset means "what
        we ship" — the two questions are different.
        """
        defn = self.default_for(template.template_type)
        if not defn:
            return True
        return (
            template.subject != defn["subject"]
            or template.html_body != defn["html"]
            or (template.text_body or "") != (defn["text"] or "")
            or (template.footer_key or None) != defn.get("footer")
        )

    async def sent_counts(self, organization_id: str) -> Dict[str, int]:
        """How many messages this organization has sent per template type.

        One grouped query for the whole list rather than a count per row:
        the catalogue is past three dozen entries, so per-row would be three
        dozen round trips to render one sidebar.

        Keyed on ``template_type`` because that is what ``MessageHistory``
        records — it stores a snapshot of the send, not a foreign key to a
        template row that may since have been reset or deleted.
        """
        result = await self.db.execute(
            select(MessageHistory.template_type, func.count(MessageHistory.id))
            .where(
                MessageHistory.organization_id == str(organization_id),
                MessageHistory.template_type.is_not(None),
            )
            .group_by(MessageHistory.template_type)
        )
        return {row[0]: row[1] for row in result.all()}

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
        footer_key: Optional[str] = None,
        header_accent: Optional[str] = None,
        status_chip: Optional[str] = None,
        layout: Optional[str] = None,
    ) -> EmailTemplate:
        """Create a new email template"""
        template = EmailTemplate(
            id=str(uuid.uuid4()),
            organization_id=organization_id,
            template_type=template_type,
            name=name,
            footer_key=footer_key,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            # NULL, not a copy of DEFAULT_CSS. render() falls back to the
            # current default for a NULL, so a department that never touched
            # the stylesheet tracks improvements to it; baking a snapshot in
            # at creation time froze every existing organization on the
            # stylesheet that shipped the day they signed up.
            css_styles=css_styles or None,
            # The colourway the body was built with. Stored rather than left
            # NULL so the accent swatches have something to show as selected,
            # and so an admin recolouring one notice does not have to
            # discover what the other thirty-four are set to.
            header_accent=header_accent,
            status_chip=status_chip,
            layout=layout,
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
            "Template created id={} type={} org={} by={}",
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

        # An allowlist, not a skip list: `fields` arrives as **kwargs, so a
        # caller could otherwise name `id` or `organization_id` and move a
        # template between departments.
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
            "footer_key",
            "header_accent",
            "status_chip",
            "layout",
        }
        # apply_updates, not `if value is not None`. That guard collapses
        # "the caller did not mention this field" and "the caller sent an
        # explicit null to clear it" into one case, so emptying the CC box
        # was acknowledged with a 200 while the old address kept receiving
        # every copy. The endpoint pairs this with exclude_unset, so a key
        # that reaches here at all is one the client actually sent.
        apply_updates(
            template,
            {k: v for k, v in fields.items() if k in allowed_fields},
        )

        template.updated_by = updated_by
        await self.db.flush()
        # Refresh server-computed updated_at to avoid MissingGreenlet on
        # async lazy-load when Pydantic serializes the response.
        await self.db.refresh(template, attribute_names=["updated_at"])
        logger.info(
            "Template updated id={} fields=[{}] org={} by={}",
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

    async def reset_to_default(
        self,
        template_id: str,
        organization_id: str,
        updated_by: Optional[str] = None,
    ) -> Optional[EmailTemplate]:
        """Reset a template to its built-in default content.

        Looks up the template's type in ``_DEFAULT_TEMPLATE_DEFS`` and
        restores the subject, HTML body, text body, and CSS to the
        system defaults.  Returns ``None`` if the template is not found
        or its type has no registered default.
        """
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

        ttype = template.template_type
        defn = next(
            (d for d in self._DEFAULT_TEMPLATE_DEFS if d["type"] == ttype),
            None,
        )
        if not defn:
            return None

        template.subject = defn["subject"]
        template.html_body = defn["html"]
        template.text_body = defn["text"]
        # See create_template: NULL means "track the built-in stylesheet".
        template.css_styles = None
        # The footer choice is part of the default, not a separate preference:
        # the shipped body for a public notice assumes the public footer.
        template.footer_key = defn.get("footer")
        # Same for the colourway. Reset means "what we ship", and a body
        # restored to the default with the admin's old accent still on the
        # row would render the shipped markup in a colour the shipped design
        # never used.
        template.header_accent = defn.get("accent")
        template.status_chip = defn.get("chip")
        template.layout = defn.get("layout")
        template.updated_by = updated_by
        await self.db.flush()
        await self.db.refresh(template, attribute_names=["updated_at"])

        logger.info(
            "Template reset to default id={} type={} org={} by={}",
            template_id,
            ttype,
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
            "Template deleted id={} type={} org={}",
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
        ctx = self.build_context(
            context,
            organization,
            footer_key=getattr(template, "footer_key", None),
            template=template,
        )

        # The subject becomes the SMTP Subject: header and the text body the
        # text/plain alternative — neither is markup, so neither is escaped.
        # Only html_body is.
        subject = self._replace_variables(template.subject, ctx, escape_html=False)
        html_body = self._replace_variables(template.html_body, ctx)
        text_body = None
        if template.text_body:
            text_body = self._replace_variables(
                template.text_body, ctx, escape_html=False
            )

        full_html = build_email_document(
            subject, html_body, template.css_styles or DEFAULT_CSS
        )

        return subject, full_html, text_body

    @classmethod
    def build_context(
        cls,
        context: Dict[str, Any],
        organization: Optional[Any] = None,
        footer_key: Optional[str] = None,
        template: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Add the variables every template may use to a caller's context.

        Split out of :meth:`render` because the code-default fallback in
        ``EmailService._render_with_fallback`` needs exactly the same set. It
        did not have it, so a department that had never opened the Email
        Templates screen — and therefore had no template rows, because that
        screen is what creates them — received footers reading a literal
        ``{{organization_phone}} | {{organization_email}}``.

        Caller-supplied values always win; every key here is a ``setdefault``.
        """
        ctx = dict(context)
        if organization:
            for column, variable in ORGANIZATION_FIELD_VARIABLES.items():
                value = getattr(organization, column, None)
                ctx.setdefault(variable, "" if value is None else str(value))

            # The department nominated one of its three identifiers as the one
            # it goes by; a footer reading "FDID 12345" has to name the right
            # scheme, so the label travels with the value.
            identifier_type = getattr(organization, "identifier_type", None)
            identifier_key = getattr(identifier_type, "value", identifier_type) or ""
            ctx.setdefault(
                "organization_identifier",
                str(getattr(organization, str(identifier_key), None) or ""),
            )
            ctx.setdefault(
                "organization_identifier_label",
                _IDENTIFIER_LABELS.get(str(identifier_key), ""),
            )

            org_type = getattr(organization, "organization_type", None)
            org_type_key = getattr(org_type, "value", org_type) or ""
            ctx.setdefault(
                "organization_type_label",
                _ORGANIZATION_TYPE_LABELS.get(str(org_type_key), ""),
            )

            # Build formatted mailing address
            ctx.setdefault(
                "organization_mailing_address",
                cls._format_address(
                    getattr(organization, "mailing_address_line1", None),
                    getattr(organization, "mailing_address_line2", None),
                    getattr(organization, "mailing_city", None),
                    getattr(organization, "mailing_state", None),
                    getattr(organization, "mailing_zip", None),
                    getattr(organization, "mailing_country", None),
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
                    cls._format_address(
                        getattr(organization, "physical_address_line1", None),
                        getattr(organization, "physical_address_line2", None),
                        getattr(organization, "physical_city", None),
                        getattr(organization, "physical_state", None),
                        getattr(organization, "physical_zip", None),
                        getattr(organization, "physical_country", None),
                    ),
                )
            # Office signature variables ({{president_name}}, {{chief_title}},
            # ...). These come from the flat directory that OfficerService
            # keeps on the organization row precisely so this synchronous
            # render path needs no extra query — every send site already
            # passes the organization. Unknown keys are filtered out so a
            # hand-edited settings blob cannot inject arbitrary variables.
            org_settings = getattr(organization, "settings", None) or {}
            if isinstance(org_settings, dict):
                directory = org_settings.get(ORG_SETTINGS_OFFICER_KEY) or {}
                if isinstance(directory, dict):
                    for var_name, var_value in directory.items():
                        if var_name in OFFICE_VARIABLE_NAMES:
                            ctx.setdefault(var_name, var_value or "")

        # login_url: always available regardless of organization
        frontend_url = getattr(app_settings, "FRONTEND_URL", "") or ""
        ctx.setdefault("login_url", f"{frontend_url}/login" if frontend_url else "")

        # Build a ready-to-use <img> tag so templates can just insert it.
        # Skip base64 data URIs — they embed the full image payload in the
        # HTML and easily exceed Gmail's 102 KB message-clipping threshold.
        logo_val = ctx.get("organization_logo", "")
        if logo_val and not str(logo_val).startswith("data:"):
            import html as _h

            org_name = ctx.get("organization_name", "Organization")
            # No class on the <img>: it sits inside <div class="logo">, and the
            # inliner would otherwise copy that div's centring and padding onto
            # the image as well.
            ctx.setdefault(
                "organization_logo_img",
                f'<img src="{_h.escape(str(logo_val))}" alt="{_h.escape(str(org_name))}" style="max-height:72px;max-width:200px;" />',
            )
        else:
            ctx.setdefault("organization_logo_img", "")

        # The 1b header lockup takes the whole cell, not the bare <img>: with
        # no logo the cell has to disappear, and a template cannot express
        # that — {{name}} substitution has no conditionals, so a <td> written
        # into the shell around an empty variable mails as an empty bordered
        # box. Both variables stay populated: a department that customised its
        # body before 1b is still using {{organization_logo_img}}.
        ctx.setdefault(
            "organization_logo_cell",
            build_logo_cell(str(logo_val or ""), str(ctx.get("organization_name", ""))),
        )

        # The colourway, for the {{header_accent}} / {{chip_tint}} /
        # {{status_chip}} tokens build_shell leaves in a body. Taken from the
        # template's own columns, falling back to the colourway its type
        # ships with, so a row written before those columns existed still
        # renders — and one an admin has recoloured renders their choice.
        #
        # A body with literal hexes has no tokens to fill and is unaffected
        # either way, which is what makes this safe to apply unconditionally.
        colourway: Dict[str, Any] = {}
        if template is not None:
            defaults = cls._colourway_defaults(getattr(template, "template_type", None))
            accent = getattr(template, "header_accent", None) or defaults.get("accent")
            chip = getattr(template, "status_chip", None)
            if chip is None:
                chip = defaults.get("chip", "")
            if accent:
                colourway = colourway_context(accent, chip)
        for key, value in colourway.items():
            ctx.setdefault(key, value)

        # Last, because the footer's own text is resolved against everything
        # above it. Rendering is a single substitution pass, so a
        # {{organization_name}} left inside an already-substituted
        # {{footer_html}} would mail as those literal braces.
        footer = _footers.resolve(organization, footer_key)
        ctx.setdefault("footer_html", _footers.render_html(footer, ctx))
        ctx.setdefault("footer_text", _footers.render_text(footer, ctx))

        return ctx

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

    #: Country omitted from a formatted address when it is this one. A US
    #: department's own mail does not say "USA" under every address, and the
    #: column defaults to it, so printing it unconditionally would add a line
    #: of noise to every footer that shows an address.
    _IMPLIED_COUNTRY = "USA"

    @classmethod
    def _format_address(
        cls,
        line1: Optional[str],
        line2: Optional[str],
        city: Optional[str],
        state: Optional[str],
        zip_code: Optional[str],
        country: Optional[str] = None,
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
        if country and country.strip().upper() != cls._IMPLIED_COUNTRY:
            parts.append(country.strip())
        return "\n".join(parts)

    # Variable names whose values contain pre-rendered, system-generated
    # HTML (e.g. item tables, logo <img> tags).  These are built by
    # trusted backend code and must NOT be HTML-escaped during rendering.
    _RAW_HTML_VARIABLES: set = {
        "items_list_html",
        "items_issued_html",
        "items_returned_html",
        "items_removed_html",
        "organization_logo_img",
        "organization_logo_cell",
        # Hexes going into style attributes. Escaping a "#" is a no-op, but
        # listing them keeps the set honest about what is markup-bearing.
        "header_accent",
        "chip_tint",
        "ballot_items_html",
        "results_html",
        "ballot_recipients_html",
        "recipients_html",
        "skipped_voters_html",
        "custom_message_html",
        "footer_html",
        "details_html",
        "message_html",
        "apparatus_html",
        "roster_html",
        "checklist_html",
    } | _storefront_templates.RAW_HTML_VARIABLES

    def _replace_variables(
        self, text: str, context: Dict[str, Any], escape_html: bool = True
    ) -> str:
        """Replace {{variable_name}} placeholders with context values.

        When rendering into HTML, values are HTML-escaped to prevent injection
        of malicious HTML/JS through user-controlled template variables (e.g.
        election titles, custom messages, recipient names).

        Variables listed in ``_RAW_HTML_VARIABLES`` are inserted without
        escaping because they contain system-generated HTML (item tables,
        logo images, etc.) that is already safe.

        ``escape_html=False`` is for the two destinations that are **not**
        HTML — the ``Subject:`` header and the ``text/plain`` alternative.
        Escaping there is not merely unnecessary, it corrupts the output: a
        member named O'Brien reads as ``O&#x27;Brien`` and an organization
        called "Falls Church Fire & Rescue" as ``…Fire &amp; Rescue``. There is
        no injection risk to trade off, because neither destination is parsed
        as markup.
        """
        import html as _html

        def replacer(match):
            var_name = match.group(1).strip()
            if var_name not in context:
                return ""
            value = str(context[var_name])
            if not escape_html or var_name in self._RAW_HTML_VARIABLES:
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
            "footer": "official",
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
            "footer": "official",
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
            "footer": "official",
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
            "footer": "official",
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
            "footer": "official",
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
            "footer": "public",
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
            "footer": "public",
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
        {
            "type": EmailTemplateType.SHIFT_ASSIGNMENT,
            "name": "Shift Assignment",
            "subject": DEFAULT_SHIFT_ASSIGNMENT_SUBJECT,
            "html": DEFAULT_SHIFT_ASSIGNMENT_HTML,
            "text": DEFAULT_SHIFT_ASSIGNMENT_TEXT,
            "description": (
                "Sent to a member when they are assigned to a shift. Only sent "
                "when email is enabled in Scheduling Settings > Assignment "
                "Notifications."
            ),
        },
        {
            "type": EmailTemplateType.SHIFT_DECLINE,
            "name": "Shift Coverage Needed",
            "subject": DEFAULT_SHIFT_DECLINE_SUBJECT,
            "html": DEFAULT_SHIFT_DECLINE_HTML,
            "text": DEFAULT_SHIFT_DECLINE_TEXT,
            "description": (
                "Sent to the shift officer and the notified roles when a member "
                "declines or is removed from a shift, leaving the position open."
            ),
        },
        {
            "type": EmailTemplateType.SHIFT_REMINDER,
            "name": "Shift Reminder",
            "subject": DEFAULT_SHIFT_REMINDER_SUBJECT,
            "html": DEFAULT_SHIFT_REMINDER_HTML,
            "text": DEFAULT_SHIFT_REMINDER_TEXT,
            "description": (
                "Sent to members ahead of a shift they are assigned to, on the "
                "lead times set in Scheduling Settings > Shift Reminders."
            ),
        },
        # The storefront's ten live in their own module; see
        # email_templates_storefront.py for why they need raw-HTML
        # variables where other templates need none.
        *_storefront_templates.DEFAULT_TEMPLATE_DEFS,
    ]

    # Stamp each definition with the colourway build_shell recorded for its
    # body, rather than restating an accent beside markup that already
    # carries one. A definition whose body this module did not build (there
    # are none today, and CUSTOM has no body at all) simply has no colourway,
    # and nothing is stamped on the row.
    for _defn in _DEFAULT_TEMPLATE_DEFS:
        _defn.update(colourway_for(_defn["html"]))
    del _defn

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
                    footer_key=defn.get("footer"),
                    header_accent=defn.get("accent"),
                    status_chip=defn.get("chip"),
                    layout=defn.get("layout"),
                )
                created.append(template)

        return created
