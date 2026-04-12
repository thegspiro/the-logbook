# Salesforce CRM Integration

*(Added 2026-04-11)*

The Salesforce integration enables bidirectional synchronization between The Logbook and Salesforce CRM, allowing departments to manage contacts, donors, training records, and events across both platforms.

---

## Key Features

- **OAuth 2.0 Connection** — Connect to Salesforce using client credentials (client ID, client secret, refresh token). Supports both production and sandbox environments
- **Bidirectional Sync** — Push Logbook data to Salesforce and pull Salesforce changes back. Sync direction configurable: push-only, pull-only, or bidirectional
- **Configurable Field Mappings** — Map Logbook fields to Salesforce fields per object type (members↔contacts, training→tasks, events→events)
- **Real-Time Webhooks** — Receive Salesforce outbound messages via HMAC-validated webhook for immediate updates
- **Conflict Resolution** — Configurable strategies when records are modified on both sides: Salesforce wins, Logbook wins, or most recent wins
- **Sync History** — Full audit trail of sync operations with created/updated/failed counts

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/integrations` | Integrations Hub | `integrations.manage` |

The Salesforce integration is configured via the **Integrations** page. A dedicated Salesforce card shows connection status, last sync timestamp, and action buttons.

---

## API Endpoints

### Authenticated Endpoints (`/api/v1/`)

```
POST   /api/v1/integrations/salesforce/connect          # Initialize OAuth connection
POST   /api/v1/integrations/salesforce/disconnect        # Disconnect integration
GET    /api/v1/salesforce-sync/status                    # Get sync status and history
POST   /api/v1/salesforce-sync/push/members              # Push all active members to Salesforce as Contacts
POST   /api/v1/salesforce-sync/push/training             # Push training records to Salesforce as Tasks
POST   /api/v1/salesforce-sync/push/events               # Push events to Salesforce
POST   /api/v1/salesforce-sync/pull/contacts              # Pull Contacts from Salesforce (incremental)
GET    /api/v1/salesforce-sync/field-mappings             # Get current field mappings
PUT    /api/v1/salesforce-sync/field-mappings             # Update field mappings
```

All endpoints require `integrations.manage` permission.

### Public Webhook

```
POST   /public/v1/webhooks/salesforce/{integration_id}   # Salesforce outbound message receiver
```

Rate limited: 30 requests/minute per IP with 5-minute lockout. Validates HMAC-SHA256 signature using per-integration `webhook_secret`.

---

## Data Mapping

### Member → Salesforce Contact

| Logbook Field | Salesforce Field | Notes |
|---------------|-----------------|-------|
| `first_name` | `FirstName` | |
| `last_name` | `LastName` | |
| `email` | `Email` | |
| `phone` | `Phone` | |
| `mobile` | `MobilePhone` | |
| `rank` | `Title` | |
| `station` | `Department` | |
| `address` fields | `MailingStreet`, `MailingCity`, `MailingState`, `MailingPostalCode` | |
| `date_of_birth` | `Birthdate` | |
| `membership_number` | `Logbook_Member_ID__c` | Custom field, used as external ID |
| `membership_type` | `Logbook_Membership_Type__c` | Custom field |
| `status` | `Logbook_Status__c` | Custom field |
| `hire_date` | `Logbook_Hire_Date__c` | Custom field |

### Training Record → Salesforce Task

| Logbook Field | Salesforce Field | Notes |
|---------------|-----------------|-------|
| `course_name` | `Subject` | |
| `completion_date` | `ActivityDate` | |
| `hours_completed` | `Logbook_Hours__c` | Custom field |
| `status` | `Status` | Mapped to Salesforce Task status |
| `certification_number` | `Logbook_Cert_Number__c` | Custom field |
| `expiration_date` | `Logbook_Cert_Expiry__c` | Custom field |
| `training_type` | `Logbook_Training_Type__c` | Custom field |
| `instructor` | `Logbook_Instructor__c` | Custom field |

### Event → Salesforce Event

| Logbook Field | Salesforce Field | Notes |
|---------------|-----------------|-------|
| `title` | `Subject` | |
| `description` | `Description` | |
| `location` | `Location` | |
| `start_datetime` | `StartDateTime` | |
| `end_datetime` | `EndDateTime` | |
| `event_type` | `Logbook_Event_Type__c` | Custom field |
| `is_mandatory` | `Logbook_Is_Mandatory__c` | Custom field |

---

## Architecture

### Backend Services

```
backend/app/services/integration_services/
├── salesforce_service.py           # REST API client (OAuth, SOQL, CRUD)
├── salesforce_sync_service.py      # Bidirectional sync with field mappings
└── notification_dispatcher.py      # Cross-integration notification routing

backend/app/api/
├── v1/endpoints/salesforce_sync.py # Authenticated sync endpoints
└── public/salesforce_webhook.py    # Public webhook receiver
```

### Connection Flow

```
1. Admin navigates to /integrations
2. Clicks "Connect Salesforce"
3. Enters instance URL, client ID, client secret
4. POST /api/v1/integrations/salesforce/connect
5. Backend tests connection via Salesforce /limits endpoint
6. On success: Integration record created, webhook_secret generated
7. Admin configures field mappings and sync direction
8. Manual or scheduled sync pushes/pulls data
```

### Webhook Flow

```
1. Salesforce fires outbound message on Contact change
2. POST /public/v1/webhooks/salesforce/{integration_id}
3. HMAC-SHA256 signature validated against integration webhook_secret
4. Salesforce Organization ID validated against stored config
5. Contact payload parsed and mapped to Logbook member fields
6. Member record created or updated
7. 200 OK returned to Salesforce
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Salesforce API rate limit exceeded during sync | Sync pauses, retries with exponential backoff, logs partial progress |
| Webhook received for unmapped Salesforce object | Event logged and skipped; no error returned to Salesforce |
| Member deleted in Logbook but exists in Salesforce | Configurable: soft-delete in Salesforce or unlink without delete |
| Salesforce field mapping references nonexistent field | Mapping validation on save rejects invalid field references |
| OAuth token expires mid-sync | Auto-refresh token and retry from the failed record |
| Duplicate contact detected in Salesforce | Matched by `Logbook_Member_ID__c` external ID; existing record updated |
| Sync runs while another sync is already in progress | Second sync queued; only one sync runs at a time per organization |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SALESFORCE_CLIENT_ID` | No | Default client ID (can be overridden per-org) |
| `SALESFORCE_CLIENT_SECRET` | No | Default client secret (can be overridden per-org) |

### Organization Settings

Salesforce configuration is stored in the `integrations` table with `provider_type = 'salesforce'`. The `config` JSON column holds:

```json
{
  "instance_url": "https://yourinstance.salesforce.com",
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "...",
  "api_version": "v59.0",
  "environment": "production",
  "sync_direction": "bidirectional",
  "sync_types": ["members", "training", "events"],
  "field_mappings": { ... },
  "webhook_secret": "..."
}
```

---

## Permissions

| Permission | Required For |
|------------|-------------|
| `integrations.manage` | Connect/disconnect, configure field mappings, trigger sync |
| `settings.manage` | Access the Integrations page |
