"""
Salesforce Bidirectional Sync Service

Maps Logbook entities to Salesforce sObjects and provides push/pull
sync operations for members, events, training records, and incidents.

Mapping strategy:
  Logbook Member   → Salesforce Contact
  Logbook Event    → Salesforce Event
  Training Record  → Salesforce Task  (with custom fields)
  Shift Call       → Salesforce Task  (with custom fields)
"""

import logging
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration
from app.services.integration_services.salesforce_service import (
    SalesforceService,
)

logger = logging.getLogger(__name__)


# ============================================================
# Default field mappings  (Logbook field → Salesforce field)
# Departments can override via the integration config JSON.
# ============================================================

MEMBER_TO_CONTACT: dict[str, str] = {
    "first_name": "FirstName",
    "last_name": "LastName",
    "email": "Email",
    "phone": "Phone",
    "mobile": "MobilePhone",
    "rank": "Title",
    "station": "Department",
    "address_street": "MailingStreet",
    "address_city": "MailingCity",
    "address_state": "MailingState",
    "address_zip": "MailingPostalCode",
    "address_country": "MailingCountry",
    "date_of_birth": "Birthdate",
    "membership_number": "Employee_Number__c",
    "membership_type": "Membership_Type__c",
    "status": "Member_Status__c",
    "hire_date": "Hire_Date__c",
}

EVENT_TO_SF_EVENT: dict[str, str] = {
    "title": "Subject",
    "description": "Description",
    "location": "Location",
    "start_datetime": "StartDateTime",
    "end_datetime": "EndDateTime",
    "event_type": "Type",
    "is_mandatory": "Mandatory__c",
}

TRAINING_RECORD_TO_TASK: dict[str, str] = {
    "course_name": "Subject",
    "completion_date": "ActivityDate",
    "hours_completed": "Hours_Completed__c",
    "status": "Status",
    "certification_number": "Certification_Number__c",
    "expiration_date": "Certification_Expiration__c",
    "training_type": "Training_Type__c",
    "instructor": "Description",
}

INCIDENT_TO_TASK: dict[str, str] = {
    "incident_number": "Subject",
    "incident_type": "Type",
    "dispatched_at": "Dispatch_Time__c",
    "on_scene_at": "On_Scene_Time__c",
    "cleared_at": "Clear_Time__c",
    "notes": "Description",
}

# Reverse mappings for inbound (Salesforce → Logbook)
CONTACT_TO_MEMBER: dict[str, str] = {v: k for k, v in MEMBER_TO_CONTACT.items()}


def _serialize_value(value: Any) -> Any:
    """Convert Python values to Salesforce-compatible JSON types."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        return None
    return str(value) if not isinstance(value, (int, float, bool)) else value


def _map_fields(
    source: dict[str, Any],
    mapping: dict[str, str],
    *,
    custom_overrides: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Apply a field mapping to produce a Salesforce-ready dict."""
    effective_mapping = {**mapping}
    if custom_overrides:
        effective_mapping.update(custom_overrides)

    result: dict[str, Any] = {}
    for src_field, sf_field in effective_mapping.items():
        if src_field in source and source[src_field] is not None:
            result[sf_field] = _serialize_value(source[src_field])
    return result


def _reverse_map_fields(
    source: dict[str, Any],
    mapping: dict[str, str],
) -> dict[str, Any]:
    """Apply a reverse mapping (Salesforce → Logbook)."""
    result: dict[str, Any] = {}
    for sf_field, lb_field in mapping.items():
        if sf_field in source and source[sf_field] is not None:
            result[lb_field] = source[sf_field]
    return result


class SalesforceSyncService:
    """Orchestrates bidirectional data sync between Logbook and Salesforce."""

    def __init__(
        self,
        db: AsyncSession,
        sf_service: SalesforceService,
        integration: Integration,
    ):
        self.db = db
        self.sf = sf_service
        self.integration = integration
        config = integration.config or {}
        self._custom_mappings: dict[str, Any] = config.get(
            "field_mappings", {}
        )

    # ============================================================
    # Outbound: Logbook → Salesforce
    # ============================================================

    async def push_member(self, member: dict[str, Any]) -> str | None:
        """Push a single member to Salesforce as a Contact.

        Returns the Salesforce Contact ID or None on failure.
        """
        sf_fields = _map_fields(
            member,
            MEMBER_TO_CONTACT,
            custom_overrides=self._custom_mappings.get("member"),
        )
        if not sf_fields.get("LastName"):
            logger.warning(
                "Skipping member push — missing LastName: %s",
                member.get("id", "?"),
            )
            return None

        # Use Logbook ID as the external ID for upsert-style sync
        sf_fields["Logbook_Member_ID__c"] = member.get("id", "")

        existing = await self._find_contact_by_logbook_id(member.get("id", ""))
        if existing:
            await self.sf.update_record("Contact", existing, sf_fields)
            logger.info("Updated Salesforce Contact %s", existing)
            return existing

        record_id = await self.sf.create_record("Contact", sf_fields)
        logger.info("Created Salesforce Contact %s", record_id)
        return record_id

    async def push_event(self, event: dict[str, Any]) -> str | None:
        """Push an event to Salesforce as an Event object."""
        sf_fields = _map_fields(
            event,
            EVENT_TO_SF_EVENT,
            custom_overrides=self._custom_mappings.get("event"),
        )
        if not sf_fields.get("Subject"):
            return None

        sf_fields["Logbook_Event_ID__c"] = event.get("id", "")
        # Salesforce Events require DurationInMinutes or EndDateTime
        if "StartDateTime" in sf_fields and "EndDateTime" not in sf_fields:
            sf_fields["DurationInMinutes"] = 60

        existing = await self._find_record_by_external_id(
            "Event", "Logbook_Event_ID__c", event.get("id", "")
        )
        if existing:
            await self.sf.update_record("Event", existing, sf_fields)
            return existing

        record_id = await self.sf.create_record("Event", sf_fields)
        logger.info("Created Salesforce Event %s", record_id)
        return record_id

    async def push_training_record(
        self,
        record: dict[str, Any],
        contact_id: str | None = None,
    ) -> str | None:
        """Push a training completion to Salesforce as a Task."""
        sf_fields = _map_fields(
            record,
            TRAINING_RECORD_TO_TASK,
            custom_overrides=self._custom_mappings.get("training"),
        )
        if not sf_fields.get("Subject"):
            return None

        sf_fields["Logbook_Training_ID__c"] = record.get("id", "")
        # Link to the Contact if we know the Salesforce ID
        if contact_id:
            sf_fields["WhoId"] = contact_id
        # Tag so it's identifiable as a training record
        sf_fields["Task_Source__c"] = "Logbook Training"

        # Map Logbook statuses to Salesforce Task statuses
        status_map = {
            "completed": "Completed",
            "scheduled": "Not Started",
            "in_progress": "In Progress",
            "cancelled": "Deferred",
            "failed": "Completed",
        }
        raw_status = record.get("status", "")
        if isinstance(raw_status, str):
            sf_fields["Status"] = status_map.get(raw_status, "Not Started")

        existing = await self._find_record_by_external_id(
            "Task", "Logbook_Training_ID__c", record.get("id", "")
        )
        if existing:
            await self.sf.update_record("Task", existing, sf_fields)
            return existing

        record_id = await self.sf.create_record("Task", sf_fields)
        logger.info("Created Salesforce Task (training) %s", record_id)
        return record_id

    async def push_incident(
        self, call: dict[str, Any], contact_ids: list[str] | None = None
    ) -> str | None:
        """Push a shift call / incident to Salesforce as a Task."""
        sf_fields = _map_fields(
            call,
            INCIDENT_TO_TASK,
            custom_overrides=self._custom_mappings.get("incident"),
        )
        incident_num = call.get("incident_number", "")
        sf_fields["Subject"] = f"Incident {incident_num}"
        sf_fields["Logbook_Call_ID__c"] = call.get("id", "")
        sf_fields["Task_Source__c"] = "Logbook Incident"
        sf_fields["Status"] = "Completed"

        if contact_ids:
            # Link to the first responding member's Contact
            sf_fields["WhoId"] = contact_ids[0]

        existing = await self._find_record_by_external_id(
            "Task", "Logbook_Call_ID__c", call.get("id", "")
        )
        if existing:
            await self.sf.update_record("Task", existing, sf_fields)
            return existing

        record_id = await self.sf.create_record("Task", sf_fields)
        logger.info("Created Salesforce Task (incident) %s", record_id)
        return record_id

    # ============================================================
    # Inbound: Salesforce → Logbook
    # ============================================================

    async def pull_contacts(
        self, since: Optional[datetime] = None
    ) -> list[dict[str, Any]]:
        """Pull Contacts from Salesforce, returning Logbook-shaped dicts.

        If *since* is provided only Contacts modified after that timestamp
        are returned (incremental sync).
        """
        soql = (
            "SELECT Id, FirstName, LastName, Email, Phone, MobilePhone, "
            "Title, Department, MailingStreet, MailingCity, MailingState, "
            "MailingPostalCode, MailingCountry, Birthdate, "
            "Employee_Number__c, Membership_Type__c, Member_Status__c, "
            "Hire_Date__c, Logbook_Member_ID__c, LastModifiedDate "
            "FROM Contact"
        )
        if since:
            ts = since.strftime("%Y-%m-%dT%H:%M:%SZ")
            soql += f" WHERE LastModifiedDate > {ts}"
        soql += " ORDER BY LastModifiedDate ASC"

        records = await self.sf.query(soql)
        mapped: list[dict[str, Any]] = []
        for rec in records:
            lb_fields = _reverse_map_fields(rec, CONTACT_TO_MEMBER)
            lb_fields["salesforce_id"] = rec.get("Id", "")
            lb_fields["logbook_member_id"] = rec.get(
                "Logbook_Member_ID__c", ""
            )
            mapped.append(lb_fields)
        return mapped

    def parse_inbound_contact(
        self, sf_contact: dict[str, Any]
    ) -> dict[str, Any]:
        """Convert an inbound Salesforce Contact payload to Logbook fields.

        Used by the webhook handler to process Salesforce Outbound Messages.
        """
        lb_fields = _reverse_map_fields(sf_contact, CONTACT_TO_MEMBER)
        lb_fields["salesforce_id"] = sf_contact.get("Id", "")
        lb_fields["logbook_member_id"] = sf_contact.get(
            "Logbook_Member_ID__c", ""
        )
        return lb_fields

    # ============================================================
    # Bulk sync helpers
    # ============================================================

    async def sync_all_members_to_salesforce(
        self, members: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Push all members. Returns counts of created/updated/failed."""
        created = 0
        updated = 0
        failed = 0
        for member in members:
            try:
                existing = await self._find_contact_by_logbook_id(
                    member.get("id", "")
                )
                result = await self.push_member(member)
                if result:
                    if existing:
                        updated += 1
                    else:
                        created += 1
                else:
                    failed += 1
            except Exception:
                logger.warning(
                    "Failed to sync member %s",
                    member.get("id", "?"),
                    exc_info=True,
                )
                failed += 1
        return {"created": created, "updated": updated, "failed": failed}

    async def sync_all_training_to_salesforce(
        self, records: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Push all training records. Returns counts."""
        created = 0
        updated = 0
        failed = 0
        for rec in records:
            try:
                existing = await self._find_record_by_external_id(
                    "Task",
                    "Logbook_Training_ID__c",
                    rec.get("id", ""),
                )
                result = await self.push_training_record(rec)
                if result:
                    if existing:
                        updated += 1
                    else:
                        created += 1
                else:
                    failed += 1
            except Exception:
                logger.warning(
                    "Failed to sync training record %s",
                    rec.get("id", "?"),
                    exc_info=True,
                )
                failed += 1
        return {"created": created, "updated": updated, "failed": failed}

    # ============================================================
    # Internal helpers
    # ============================================================

    async def _find_contact_by_logbook_id(
        self, logbook_id: str
    ) -> str | None:
        """Find a Salesforce Contact by the Logbook external ID."""
        if not logbook_id:
            return None
        return await self._find_record_by_external_id(
            "Contact", "Logbook_Member_ID__c", logbook_id
        )

    async def _find_record_by_external_id(
        self, sobject: str, field: str, value: str
    ) -> str | None:
        """Query Salesforce for a record with a specific external ID value."""
        if not value:
            return None
        # Escape single quotes in SOQL
        safe_value = value.replace("'", "\\'")
        soql = (
            f"SELECT Id FROM {sobject} "
            f"WHERE {field} = '{safe_value}' LIMIT 1"
        )
        try:
            records = await self.sf.query(soql)
            if records:
                return records[0].get("Id")
        except Exception:
            logger.debug(
                "External ID lookup failed for %s.%s=%s",
                sobject,
                field,
                value,
                exc_info=True,
            )
        return None


# ============================================================
# Factory: build a sync service from an Integration record
# ============================================================


def build_salesforce_credentials(integration: Integration) -> dict[str, Any]:
    """Extract Salesforce credentials from an Integration record."""
    config = integration.config or {}
    creds: dict[str, Any] = {
        "instance_url": config.get("instance_url", ""),
        "api_version": config.get("api_version", "v62.0"),
        "environment": config.get("environment", "production"),
    }
    for key in ("client_id", "client_secret", "refresh_token", "access_token"):
        val = integration.get_secret(key)
        if val:
            creds[key] = val
    return creds


async def get_salesforce_sync_service(
    db: AsyncSession,
    organization_id: str,
) -> SalesforceSyncService | None:
    """Load the Salesforce integration for an org and return a sync service.

    Returns None if Salesforce is not connected for this org.
    """
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == "salesforce",
            Integration.enabled.is_(True),
            Integration.status == "connected",
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        return None

    creds = build_salesforce_credentials(integration)
    sf_service = SalesforceService(creds)
    return SalesforceSyncService(db, sf_service, integration)
