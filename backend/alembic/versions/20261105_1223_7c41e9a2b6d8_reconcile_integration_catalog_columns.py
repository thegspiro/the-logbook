"""reconcile integration catalog columns

INT2-4, owner decision 2026-11-01: a change to the integration catalog reaches
departments that were seeded before it. ``ensure_catalog`` used to insert only
the rows an organization lacked, so an entry promoted from coming soon,
demoted, renamed or reworded kept its seeded values in every existing
department.

The catalog owns ``name``, ``description`` and ``category`` outright, and
``status`` only between ``available`` and ``coming_soon``. A row that is
``connected`` or in ``error`` is the department's connection and keeps its
status; so do ``enabled``, ``config``, the encrypted secrets, the health
columns and ``contains_phi`` (which the Claude MCP row derives from a
department setting). From now on ``ensure_catalog`` applies the same rule
whenever the integrations page lists a department's rows; this revision
settles the rows that exist today, before anyone opens that page.

``_CATALOG`` below is a frozen copy of
``app.api.v1.endpoints.integrations.INTEGRATION_CATALOG`` as of this revision.
It is copied rather than imported because a migration must keep doing what it
did on the day it ran, and the live catalog is free to change.

A row whose integration type the catalog no longer lists is left alone.

``integrations`` is built by ``create_all`` rather than by any migration, so
on a database where it does not exist yet this does nothing: the table is
created later and seeded from the live catalog.

Irreversible: the values replaced were stale copies of older catalog text and
statuses, with no record of which older catalog each came from, so there is
nothing meaningful to restore. The downgrade leaves the rows as they are.

Revision ID: 7c41e9a2b6d8
Revises: 81b38694152f
Create Date: 2026-11-05 12:23:20.017602

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c41e9a2b6d8"
down_revision: Union[str, None] = "81b38694152f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "integrations"
_AVAILABILITY = ("available", "coming_soon")

# (integration_type, name, description, category, status)
_CATALOG = (
    (
        "google-calendar",
        "Google Calendar",
        "Publish department events one way to a dedicated calendar that The Logbook creates in the department's Google account; members subscribe to that calendar. Edits made in Google are not copied back.",
        "Calendar",
        "available",
    ),
    (
        "outlook",
        "Microsoft Outlook",
        "Publish department events one way to a dedicated calendar that The Logbook creates in the department's Microsoft 365 account; members subscribe to that calendar. Edits made in Outlook are not copied back.",
        "Calendar",
        "available",
    ),
    (
        "slack",
        "Slack",
        "Send automated notifications to Slack channels for real-time updates.",
        "Messaging",
        "available",
    ),
    (
        "discord",
        "Discord",
        "Post updates to Discord servers for volunteer department communication.",
        "Messaging",
        "available",
    ),
    (
        "csv-import",
        "CSV Import/Export",
        "Import and export data in CSV format for reporting and migration. Not yet usable as a configured integration — there is no generic import/export route here. Individual modules do ship their own working CSV exports (members, admin hours, finance, compliance reports) from their own pages.",
        "Data",
        "coming_soon",
    ),
    (
        "ical",
        "iCalendar (ICS)",
        "A read-only subscribe link to the department's published events — title, time, location and type, no descriptions or attendee details. Works with Apple Calendar, Google Calendar, Outlook and any app that subscribes to an iCal URL.",
        "Calendar",
        "available",
    ),
    (
        "microsoft-teams",
        "Microsoft Teams",
        "Send automated notifications to Teams channels via incoming webhooks.",
        "Messaging",
        "available",
    ),
    (
        "nws-weather",
        "NWS Weather Alerts",
        "Receive NOAA weather alerts (tornado, flood, fire weather) for your station's zone. Free — no API key required.",
        "Safety",
        "available",
    ),
    (
        "nfirs-export",
        "NFIRS Export",
        "Export incident data in NFIRS 5.0 format for state fire marshal reporting. Not yet usable: The Logbook has no incident/run record to export from, and no export route is wired up. The field mapping exists in nfirs_service.py awaiting an incident module.",
        "Reporting",
        "coming_soon",
    ),
    (
        "generic-webhook",
        "Generic Webhooks",
        "Send outbound webhooks to any URL when events occur. Includes HMAC-SHA256 signatures for verification.",
        "Automation",
        "available",
    ),
    (
        "epcr-import",
        "Generic ePCR Import",
        "Import run data from any ePCR vendor (ImageTrend, ESO, Zoll, etc.) via CSV or NEMSIS XML file export. Not yet usable: the NEMSIS parser exists but there is no upload route and no incident record to import into.",
        "EMS",
        "coming_soon",
    ),
    (
        "nemsis-export",
        "NEMSIS Response Module Export",
        "Export dispatch and response data in NEMSIS 3.5 format for state EMS reporting. Not yet usable: there is no response record to export from and no export route is wired up. The field mapping exists in nemsis_service.py awaiting an incident module.",
        "EMS",
        "coming_soon",
    ),
    (
        "salesforce",
        "Salesforce",
        "Sync department contacts, donors, and community engagement data with Salesforce CRM. Supports push, pull, or bidirectional sync of members, events, training records, and incidents.",
        "CRM",
        "available",
    ),
    (
        "nfc-id-cards",
        "NFC ID Cards",
        "Issue member ID cards carrying an NFC tag, and check members in to shifts, meetings and admin hours by tapping one against a reader. Cards are issued by an officer from the member's profile; members cannot register their own. Turn this off and no card can be issued or read.",
        "Access Control",
        "available",
    ),
    (
        "google-workspace",
        "Google Workspace",
        "Create a Google Workspace account for each applicant the department converts to a member, at their department email address, and add it to the groups you choose. Uses a service account with domain-wide delegation. Only an organization administrator can connect or change it.",
        "Access Control",
        "available",
    ),
    (
        "microsoft-365",
        "Microsoft 365",
        "Create a Microsoft 365 account for each applicant the department converts to a member, at their department email address, license it and add it to the groups you choose. Uses an Entra ID application with Microsoft Graph permissions. Only an organization administrator can connect or change it, and only one of Google Workspace and Microsoft 365 can be connected.",
        "Access Control",
        "available",
    ),
    (
        "documenso",
        "Documenso",
        "Send documents for electronic signature via Documenso, the open-source DocuSign alternative. Works with Documenso Cloud or a self-hosted instance.",
        "Documents",
        "available",
    ),
    (
        "calcom",
        "Cal.com",
        "Pull scheduled bookings from Cal.com, the open-source Calendly alternative. Surface member interviews, inspections, and appointments as Logbook events.",
        "Scheduling",
        "available",
    ),
    (
        "paypal",
        "PayPal",
        "Reconcile store payments automatically. Connect the department's own PayPal Business account and PayPal will tell Logbook what it received; captures whose reference carries a store order number settle that order without anyone marking it paid by hand. No payment is ever taken on this site.",
        "Payments",
        "available",
    ),
    (
        "zeffy",
        "Zeffy",
        "Read donations, event tickets and memberships sold through the department's Zeffy account into the Logbook. Link each Zeffy campaign to a fundraising campaign, fundraising event or dues schedule, and its payments are recorded there as they arrive, including refunds. Read-only: nothing is ever changed in Zeffy, and Zeffy keeps issuing the tax receipts.",
        "Payments",
        "available",
    ),
    (
        "claude-mcp",
        "Claude (MCP)",
        "Let Claude answer questions about the department over the Model Context Protocol: rosters, schedules, training and certification status, inventory, apparatus, facilities, published minutes and documents. Member records never carry personal information — phone numbers, email, home addresses, dates of birth, emergency contacts, medical results — whatever the settings, and free text is scrubbed of phone numbers and email addresses; other details typed into published content pass through. Off until an IT administrator connects it and issues a service key.",
        "AI Assistants",
        "available",
    ),
    (
        "active911",
        "Active911",
        "Receive dispatch alerts and mapping from Active911 paging platform.",
        "Dispatch",
        "coming_soon",
    ),
    (
        "google-maps",
        "Google Maps",
        "Hydrant mapping, pre-plan locations, and route optimization.",
        "Mapping",
        "coming_soon",
    ),
    (
        "zapier",
        "Zapier",
        "Connect to 5,000+ apps with no-code automation workflows.",
        "Automation",
        "coming_soon",
    ),
    (
        "whatsapp",
        "WhatsApp Business",
        "Send department notifications via WhatsApp for international teams.",
        "Messaging",
        "coming_soon",
    ),
    (
        "imagetrend",
        "ImageTrend",
        "Connect to ImageTrend for automated ePCR sync. Requires ImageTrend Connect API access (contact your ImageTrend rep to verify your plan includes API access).",
        "EMS",
        "coming_soon",
    ),
    (
        "eso-solutions",
        "ESO Solutions",
        "Import run reports from ESO. Requires ESO API agreement (most departments can use the Generic ePCR Import with ESO's CSV export in the meantime).",
        "EMS",
        "coming_soon",
    ),
    (
        "nremt",
        "NREMT Verification",
        "Verify EMS certification status. Note: NREMT does not currently offer a programmatic API — this integration is pending future NREMT API availability.",
        "EMS",
        "coming_soon",
    ),
    (
        "firstwatch",
        "FirstWatch",
        "Clinical quality analytics integration. Requires FirstWatch vendor partnership.",
        "EMS",
        "coming_soon",
    ),
    (
        "pulse-point",
        "PulsePoint",
        "CPR/AED citizen responder alerts and public safety data.",
        "Dispatch",
        "coming_soon",
    ),
)


def upgrade() -> None:
    bind = op.get_bind()
    if _TABLE not in sa.inspect(bind).get_table_names():
        return

    columns = sa.text(
        "UPDATE integrations SET name = :name, description = :description, "
        "category = :category WHERE integration_type = :itype"
    )
    availability = sa.text(
        "UPDATE integrations SET status = :status "
        "WHERE integration_type = :itype AND status IN :settable"
    ).bindparams(sa.bindparam("settable", expanding=True))
    for itype, name, description, category, status in _CATALOG:
        bind.execute(
            columns,
            {
                "itype": itype,
                "name": name,
                "description": description,
                "category": category,
            },
        )
        bind.execute(
            availability,
            {"itype": itype, "status": status, "settable": list(_AVAILABILITY)},
        )


def downgrade() -> None:
    """Deliberately irreversible; see the module docstring.

    The values replaced were stale copies of an older catalog, with nothing
    recording which, so there is nothing to put back.
    """
    return
