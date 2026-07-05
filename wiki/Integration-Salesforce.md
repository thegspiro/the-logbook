# Salesforce CRM Integration

*(Added 2026-04-11)*

The Salesforce integration enables bidirectional synchronization between The Logbook and Salesforce CRM, allowing departments to manage contacts, donors, training records, and events across both platforms.

---

## Key Features

- **One-Click OAuth 2.0 Connect** — Departments connect their Salesforce org through an authorization-code redirect flow ("Connect Salesforce" → consent → done); the refresh token is stored encrypted. A deployment-wide Connected App can be provided, or each org can supply its own client ID/secret. Manual refresh-token entry is still supported. Production and sandbox environments both work
- **Safe Matching / De-duplication** — Works against a Salesforce org that already contains Contacts. Before creating a Contact, the sync matches existing records (by Logbook external ID, then a configurable fallback) and *adopts* them instead of creating duplicates. See [Matching existing Salesforce data](#matching-existing-salesforce-data)
- **Readiness Check & Dry-Run Preview** — Before writing anything, confirm the target org has the custom fields the sync needs, and preview how many members would be created vs. matched. Ideal for an org that is still being built out
- **Graceful Field Handling** — Custom fields the org has not created yet are dropped at write time (and reported) instead of failing the record, so a half-configured org still receives data
- **Bidirectional Sync** — Push Logbook data to Salesforce and pull Salesforce changes back. Sync direction configurable: push-only, pull-only, or bidirectional
- **Configurable Field Mappings** — Map Logbook fields to Salesforce fields per object type (members↔contacts, training→tasks, events→events)
- **Real-Time Webhooks** — Receive Salesforce outbound messages via HMAC-validated webhook for immediate updates
- **Sync History** — Full audit trail of sync operations with created/updated/adopted/failed counts

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/integrations` | Integrations Hub | `integrations.manage` |

The Salesforce integration is configured via the **Integrations** page. A dedicated Salesforce card shows connection status, last sync timestamp, and action buttons.

---

## API Endpoints

### Authenticated Endpoints (`/api/v1/`)

Generic connect/disconnect (config + manual credentials) live under the
integrations router; sync, readiness, preview, and the OAuth flow live under
`/integrations/salesforce`:

```
POST   /api/v1/integrations/{id}/connect                       # Store config/credentials, enable
POST   /api/v1/integrations/{id}/disconnect                    # Disconnect integration
GET    /api/v1/integrations/salesforce/status                  # Sync status (last sync, direction, mappings)
GET    /api/v1/integrations/salesforce/readiness               # Which custom fields exist; is dedup ready?
POST   /api/v1/integrations/salesforce/preview/members         # Dry run: would_create / would_update / would_adopt
POST   /api/v1/integrations/salesforce/push/members            # Push members to Salesforce as Contacts
POST   /api/v1/integrations/salesforce/push/training           # Push training records as Tasks
POST   /api/v1/integrations/salesforce/push/events             # Push events
POST   /api/v1/integrations/salesforce/pull/contacts           # Pull Contacts (incremental)
GET    /api/v1/integrations/salesforce/oauth/authorize         # Begin one-click connect (302 → Salesforce consent)
GET    /api/v1/integrations/salesforce/oauth/callback          # OAuth redirect target (stores refresh token)
```

All endpoints require `integrations.manage` permission, except the OAuth
`callback` — it is unauthenticated by design and instead verifies a signed
`state` token plus a double-submitted nonce cookie issued by `authorize`.

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

### Connection Flow (one-click OAuth)

```
1. Admin navigates to /integrations and configures the Salesforce card
   (instance URL, environment, and either their own Connected App
   client_id/client_secret or the deployment-wide app).
2. Admin's browser navigates to
   GET /api/v1/integrations/salesforce/oauth/authorize
3. Backend issues a signed `state` token + nonce cookie and 302-redirects to
   the Salesforce consent screen (login.salesforce.com or test.salesforce.com).
4. Admin grants consent; Salesforce redirects back to /oauth/callback?code=...
5. Backend verifies state + nonce, exchanges the code for access + refresh
   tokens, stores them encrypted, records the canonical instance_url, and
   marks the integration connected.
6. Admin runs the readiness check, previews a member sync, then pushes data.
```

Departments that cannot use the redirect flow may still connect by pasting a
`refresh_token` directly into the integration config via
`POST /api/v1/integrations/{id}/connect`.

### Matching existing Salesforce data

When pushing a member, the sync first looks for a Contact carrying that
member's Logbook external ID (`Logbook_Member_ID__c`). If none is found, the
per-org **match strategy** decides how to reconcile with Contacts the
department may already have:

| `match_strategy` | Fallback lookup | Result on match |
|------------------|-----------------|-----------------|
| `email` (default) | `Email` | **Adopt**: stamp the Logbook ID onto the existing Contact and update it |
| `email_lastname` | `Email` **and** `LastName` | Adopt (stricter; fewer false matches) |
| `external_id` | *(none)* | Never adopts — always creates. May produce duplicates for people already in Salesforce |

"Adopting" a record means future syncs match it directly by external ID, so no
duplicate is ever created. Email-based matching also provides de-duplication
even in an org that has **not** yet created the `Logbook_Member_ID__c` field
(Email is a standard field). Objects without an email (Events, Tasks) rely on
the external-ID custom fields — the readiness check flags when those are
missing so an admin knows duplicates are possible until the fields are added.

Set the strategy in the integration config, e.g. `{ "match_strategy": "email_lastname" }`.

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
| OAuth token expires mid-sync | Auto-refresh token and retry the request once |
| Member already exists in Salesforce (no Logbook external ID yet) | Matched by the configured strategy (email / email+lastname) and **adopted** — the Logbook ID is stamped on and the record updated, never duplicated |
| Target org is missing a custom field referenced by a mapping | Field is dropped at write time and reported in `skipped_fields`; the record still saves (unless `graceful_fields` is disabled) |
| Custom fields for external IDs not yet created | Readiness check reports `external_id_fields_ready: false`; Contacts still de-dup by email, but Events/Tasks may duplicate until the fields exist |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SALESFORCE_CLIENT_ID` | No | Deployment-wide Connected App client ID (overridden by per-org value) |
| `SALESFORCE_CLIENT_SECRET` | No | Deployment-wide Connected App client secret (overridden by per-org value) |
| `SALESFORCE_OAUTH_REDIRECT_URI` | No | Callback URL for the one-click flow. Must match the Connected App's Callback URL; if blank, derived from the request base URL |

### Organization Settings

Salesforce configuration is stored in the `integrations` table with `provider_type = 'salesforce'`. The `config` JSON column holds:

```json
{
  "instance_url": "https://yourinstance.salesforce.com",
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "...",
  "api_version": "v62.0",
  "environment": "production",
  "sync_direction": "bidirectional",
  "sync_types": ["members", "training", "events"],
  "match_strategy": "email",
  "graceful_fields": true,
  "field_mappings": { ... },
  "webhook_secret": "..."
}
```

Secret values (`client_secret`, `refresh_token`, `access_token`,
`webhook_secret`) are stored in the encrypted `encrypted_config` column, not in
plaintext `config`.

---

## Permissions

| Permission | Required For |
|------------|-------------|
| `integrations.manage` | Connect/disconnect, configure field mappings, trigger sync |
| `settings.manage` | Access the Integrations page |
