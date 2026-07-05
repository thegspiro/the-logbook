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

from datetime import date, datetime
from typing import Any, Optional

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration
from app.models.user import User
from app.services.integration_services.salesforce_service import SalesforceService

# Logbook User attributes an inbound Salesforce sync may overwrite. Deliberately
# limited to contact/demographic fields. Identity fields (email, membership
# number), the status state machine, and typed date fields are intentionally
# excluded — Salesforce is not authoritative for those, and changing email would
# break login/matching.
INBOUND_UPDATABLE_FIELDS: frozenset[str] = frozenset(
    {
        "first_name",
        "last_name",
        "phone",
        "mobile",
        "rank",
        "station",
        "address_street",
        "address_city",
        "address_state",
        "address_zip",
        "address_country",
    }
)

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

# Logbook-owned external-ID custom fields. These are the fields the sync stamps
# onto Salesforce records so a re-sync updates rather than duplicates. Their
# presence in the target org is what makes the sync idempotent, so the
# readiness check reports on them specifically.
EXTERNAL_ID_FIELDS: dict[str, str] = {
    "Contact": "Logbook_Member_ID__c",
    "Event": "Logbook_Event_ID__c",
}
# Tasks carry two different external IDs depending on what they represent.
TASK_EXTERNAL_ID_FIELDS: tuple[str, ...] = (
    "Logbook_Training_ID__c",
    "Logbook_Call_ID__c",
)

# Supported per-org matching strategies for reconciling members with Contacts
# that may already exist in the department's Salesforce org.
VALID_MATCH_STRATEGIES = ("email", "email_lastname", "external_id")
DEFAULT_MATCH_STRATEGY = "email"


def _custom_fields(mapping: dict[str, str]) -> set[str]:
    """Return the custom (``__c``) Salesforce fields used by a mapping."""
    return {sf for sf in mapping.values() if sf.endswith("__c")}


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
        self._custom_mappings: dict[str, Any] = config.get("field_mappings", {})
        strategy = str(config.get("match_strategy", DEFAULT_MATCH_STRATEGY)).lower()
        if strategy not in VALID_MATCH_STRATEGIES:
            strategy = DEFAULT_MATCH_STRATEGY
        self._match_strategy: str = strategy

    # ============================================================
    # Outbound: Logbook → Salesforce
    # ============================================================

    async def push_member(self, member: dict[str, Any]) -> str | None:
        """Push a single member to Salesforce as a Contact.

        Returns the Salesforce Contact ID or None on failure. See
        ``upsert_member`` for the created/updated/adopted classification.
        """
        sf_id, _action = await self.upsert_member(member)
        return sf_id

    async def upsert_member(self, member: dict[str, Any]) -> tuple[str | None, str]:
        """Create, update, or adopt a Salesforce Contact for a member.

        Returns ``(salesforce_id, action)`` where action is one of:
          - ``created``  — no existing record; a new Contact was made
          - ``updated``  — a Contact previously synced by Logbook was updated
          - ``adopted``  — a pre-existing Contact (matched by email/name) was
            claimed: its Logbook external ID was stamped on and mapped fields
            updated, so future syncs match it directly. This is what prevents
            duplicate Contacts in a Salesforce org that already holds data.
          - ``skipped``  — the member lacked the required LastName
          - ``failed``   — the Salesforce write did not succeed
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
            return None, "skipped"

        # Use Logbook ID as the external ID for upsert-style sync
        sf_fields["Logbook_Member_ID__c"] = member.get("id", "")

        existing_id, match_type = await self._find_contact_for_member(member)
        if existing_id:
            ok = await self.sf.update_record("Contact", existing_id, sf_fields)
            if not ok:
                return None, "failed"
            # A record found by our own external ID is one we already own; a
            # record found by email/name is a pre-existing one we are adopting.
            action = "updated" if match_type == "external" else "adopted"
            logger.info(
                "%s Salesforce Contact %s (match=%s)",
                action.capitalize(),
                existing_id,
                match_type,
            )
            return existing_id, action

        record_id = await self.sf.create_record("Contact", sf_fields)
        logger.info("Created Salesforce Contact %s", record_id)
        return record_id, "created"

    async def _find_contact_for_member(
        self, member: dict[str, Any]
    ) -> tuple[str | None, str | None]:
        """Locate an existing Salesforce Contact for a member.

        Resolution order:
          1. The Logbook external ID (records we previously synced).
          2. The configured fallback strategy (email, or email + last name)
             to catch Contacts the department already had in Salesforce.

        Returns ``(salesforce_id, match_type)`` — match_type is ``"external"``,
        the strategy name, or ``None`` when no match was found.
        """
        logbook_id = member.get("id", "")
        existing = await self._find_contact_by_logbook_id(logbook_id)
        if existing:
            return existing, "external"

        if self._match_strategy == "external_id":
            return None, None

        email = (member.get("email") or "").strip()
        if not email:
            return None, None

        if self._match_strategy == "email_lastname":
            last_name = (member.get("last_name") or "").strip()
            if not last_name:
                return None, None
            sf_id = await self._find_contact_by_email(email, last_name=last_name)
        else:  # "email"
            sf_id = await self._find_contact_by_email(email)

        if sf_id:
            return sf_id, self._match_strategy
        return None, None

    async def _find_contact_by_email(
        self, email: str, *, last_name: str | None = None
    ) -> str | None:
        """Find a Salesforce Contact by email (optionally also last name)."""
        if not email:
            return None
        safe_email = email.replace("'", "\\'")
        soql = f"SELECT Id FROM Contact WHERE Email = '{safe_email}'"
        if last_name:
            safe_last = last_name.replace("'", "\\'")
            soql += f" AND LastName = '{safe_last}'"
        soql += " LIMIT 1"
        try:
            records = await self.sf.query(soql)
            if records:
                return records[0].get("Id")
        except Exception:
            logger.debug("Contact email lookup failed", exc_info=True)
        return None

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
            lb_fields["logbook_member_id"] = rec.get("Logbook_Member_ID__c", "")
            mapped.append(lb_fields)
        return mapped

    def parse_inbound_contact(self, sf_contact: dict[str, Any]) -> dict[str, Any]:
        """Convert an inbound Salesforce Contact payload to Logbook fields.

        Used by the webhook handler to process Salesforce Outbound Messages.
        """
        lb_fields = _reverse_map_fields(sf_contact, CONTACT_TO_MEMBER)
        lb_fields["salesforce_id"] = sf_contact.get("Id", "")
        lb_fields["logbook_member_id"] = sf_contact.get("Logbook_Member_ID__c", "")
        return lb_fields

    # ============================================================
    # Inbound persistence: Salesforce → Logbook
    # ============================================================

    @property
    def inbound_enabled(self) -> bool:
        """Whether the org's sync direction permits writing inbound changes.

        A push-only org receives no updates from Salesforce even if a webhook
        fires or a pull is triggered.
        """
        direction = str(
            (self.integration.config or {}).get("sync_direction", "push")
        ).lower()
        return direction in ("pull", "both")

    async def _find_user_for_inbound(
        self, lb_fields: dict[str, Any]
    ) -> Optional[User]:
        """Match an inbound Salesforce Contact to an existing Logbook user.

        Resolution mirrors the outbound path: the Logbook external ID first,
        then email — both scoped to this integration's organization. Never
        creates a user (link-to-existing policy, matching the app's OAuth
        account model).
        """
        org_id = self.integration.organization_id

        logbook_id = (lb_fields.get("logbook_member_id") or "").strip()
        if logbook_id:
            result = await self.db.execute(
                select(User).where(
                    User.id == logbook_id,
                    User.organization_id == org_id,
                    User.deleted_at.is_(None),
                )
            )
            user = result.scalar_one_or_none()
            if user:
                return user

        email = (lb_fields.get("email") or "").strip()
        if email:
            result = await self.db.execute(
                select(User).where(
                    func.lower(User.email) == email.lower(),
                    User.organization_id == org_id,
                    User.deleted_at.is_(None),
                )
            )
            return result.scalar_one_or_none()

        return None

    async def apply_inbound_contact(self, lb_fields: dict[str, Any]) -> str:
        """Apply one inbound Salesforce Contact to a Logbook user.

        Returns one of:
          - ``updated``   — a matched user had one or more fields changed
          - ``unchanged`` — a user matched but no whitelisted field differed
          - ``unmatched`` — no existing Logbook user matched (nothing created)

        Only fields in ``INBOUND_UPDATABLE_FIELDS`` are written, and only when
        the inbound value is non-empty, so Salesforce never blanks out Logbook
        data. The row is mutated on the session but not committed here.
        """
        user = await self._find_user_for_inbound(lb_fields)
        if not user:
            return "unmatched"

        changed = False
        for field in INBOUND_UPDATABLE_FIELDS:
            if field not in lb_fields:
                continue
            value = lb_fields[field]
            if value is None or value == "":
                continue
            if getattr(user, field, None) != value:
                setattr(user, field, value)
                changed = True

        return "updated" if changed else "unchanged"

    async def sync_inbound_contacts(
        self, contacts: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Apply a batch of inbound Salesforce Contacts to Logbook users.

        *contacts* are Logbook-shaped dicts (from ``parse_inbound_contact`` or
        ``pull_contacts``). Returns counts keyed by action. Does not commit —
        the caller owns the transaction.
        """
        counts = {"updated": 0, "unchanged": 0, "unmatched": 0, "failed": 0}
        for lb_fields in contacts:
            try:
                action = await self.apply_inbound_contact(lb_fields)
                counts[action] += 1
            except Exception:
                logger.warning(
                    "Failed to apply inbound contact %s",
                    lb_fields.get("salesforce_id", "?"),
                    exc_info=True,
                )
                counts["failed"] += 1
        return counts

    # ============================================================
    # Bulk sync helpers
    # ============================================================

    async def sync_all_members_to_salesforce(
        self, members: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Push all members. Returns counts keyed by action.

        Includes ``adopted`` (pre-existing Contacts claimed by email/name
        match) and ``skipped_fields`` (custom fields dropped because the org
        has not created them yet).
        """
        counts = {"created": 0, "updated": 0, "adopted": 0, "skipped": 0, "failed": 0}
        for member in members:
            try:
                _sf_id, action = await self.upsert_member(member)
                counts[action] = counts.get(action, 0) + 1
            except Exception:
                logger.warning(
                    "Failed to sync member %s",
                    member.get("id", "?"),
                    exc_info=True,
                )
                counts["failed"] += 1
        counts["skipped_fields"] = sorted(self.sf.skipped_fields)
        return counts

    async def sync_all_training_to_salesforce(
        self, records: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Push all training records. Returns counts keyed by action."""
        counts = {"created": 0, "updated": 0, "failed": 0}
        for rec in records:
            try:
                existing = await self._find_record_by_external_id(
                    "Task",
                    "Logbook_Training_ID__c",
                    rec.get("id", ""),
                )
                result = await self.push_training_record(rec)
                if result:
                    counts["updated" if existing else "created"] += 1
                else:
                    counts["failed"] += 1
            except Exception:
                logger.warning(
                    "Failed to sync training record %s",
                    rec.get("id", "?"),
                    exc_info=True,
                )
                counts["failed"] += 1
        counts["skipped_fields"] = sorted(self.sf.skipped_fields)
        return counts

    # ============================================================
    # Dry-run preview  (read-only; nothing is written to Salesforce)
    # ============================================================

    async def preview_member_sync(
        self, members: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Preview a member push without writing anything.

        Runs the same matching logic as ``upsert_member`` but only issues
        read-only queries, so an admin can see how many records would be
        created versus matched against existing Salesforce data before
        committing to a sync.
        """
        counts = {
            "total": len(members),
            "would_create": 0,
            "would_update": 0,
            "would_adopt": 0,
            "skipped": 0,
        }
        for member in members:
            sf_fields = _map_fields(
                member,
                MEMBER_TO_CONTACT,
                custom_overrides=self._custom_mappings.get("member"),
            )
            if not sf_fields.get("LastName"):
                counts["skipped"] += 1
                continue
            existing_id, match_type = await self._find_contact_for_member(member)
            if not existing_id:
                counts["would_create"] += 1
            elif match_type == "external":
                counts["would_update"] += 1
            else:
                counts["would_adopt"] += 1
        return counts

    # ============================================================
    # Readiness  (does the target org have the fields the sync needs?)
    # ============================================================

    async def check_readiness(self) -> dict[str, Any]:
        """Report whether the target Salesforce org is ready for sync.

        Checks connectivity and, for each mapped sObject, which expected
        custom fields exist. The Logbook external-ID fields are called out
        separately because idempotent (non-duplicating) sync depends on them;
        other missing custom fields are merely dropped at write time.
        """
        report: dict[str, Any] = {
            "connected": False,
            "objects": {},
            "external_id_fields_ready": False,
            "ready": False,
        }

        try:
            await self.sf.test_connection()
            report["connected"] = True
        except Exception as exc:
            report["error"] = str(exc)
            return report

        expected: dict[str, set[str]] = {
            "Contact": (
                _custom_fields(MEMBER_TO_CONTACT) | {EXTERNAL_ID_FIELDS["Contact"]}
            ),
            "Event": (
                _custom_fields(EVENT_TO_SF_EVENT) | {EXTERNAL_ID_FIELDS["Event"]}
            ),
            "Task": (
                _custom_fields(TRAINING_RECORD_TO_TASK)
                | _custom_fields(INCIDENT_TO_TASK)
                | {"Task_Source__c", *TASK_EXTERNAL_ID_FIELDS}
            ),
        }

        external_id_ready = True
        for sobject, expected_fields in expected.items():
            entry: dict[str, Any] = {
                "accessible": False,
                "missing_fields": [],
                "error": None,
            }
            try:
                present = await self.sf.get_field_names(sobject)
                entry["accessible"] = True
                missing = sorted(expected_fields - present)
                entry["missing_fields"] = missing
                # Is every Logbook external-ID field for this object present?
                ext_ids = {
                    f
                    for f in expected_fields
                    if f.startswith("Logbook_") and f.endswith("__c")
                }
                if ext_ids & set(missing):
                    external_id_ready = False
            except Exception as exc:
                entry["error"] = str(exc)
                external_id_ready = False
            report["objects"][sobject] = entry

        report["external_id_fields_ready"] = external_id_ready
        report["ready"] = report["connected"] and external_id_ready
        return report

    # ============================================================
    # Internal helpers
    # ============================================================

    async def _find_contact_by_logbook_id(self, logbook_id: str) -> str | None:
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
        soql = f"SELECT Id FROM {sobject} " f"WHERE {field} = '{safe_value}' LIMIT 1"
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
    config = integration.config or {}
    graceful = bool(config.get("graceful_fields", True))
    sf_service = SalesforceService(creds, skip_unknown_fields=graceful)
    return SalesforceSyncService(db, sf_service, integration)
