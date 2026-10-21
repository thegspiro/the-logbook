# API Reference

The Logbook provides a RESTful API built with FastAPI. This page covers the
conventions every endpoint follows and the cross-module endpoints. Each
module's own routes, permissions and data model are on its developer page:
[Training](Module-Training-Developer), [Scheduling](Module-Scheduling-Developer),
[Events](Module-Events-Developer), [Elections](Module-Elections-Developer) and
[Inventory](Module-Inventory-Developer).

---

## Interactive Documentation

| URL             | Format      | Description                                       |
| --------------- | ----------- | ------------------------------------------------- |
| `/docs`         | Swagger UI  | Interactive API explorer — try endpoints directly |
| `/redoc`        | ReDoc       | Clean, readable API documentation                 |
| `/openapi.json` | OpenAPI 3.x | Machine-readable JSON spec                        |

Open them on the backend port, e.g. `http://YOUR-IP:3001/docs`. All three
exist only while `ENABLE_DOCS=true` (the development default). Production must
set `ENABLE_DOCS=false` — the backend refuses to start in production with it
on — and the shipped nginx configuration answers `404` for all three paths
regardless.

---

## Authentication

Sessions are carried in **cookies**, not in the response body. A successful
sign-in sets three cookies:

| Cookie          | Flags                                       | Path            | Purpose                         |
| --------------- | ------------------------------------------- | --------------- | ------------------------------- |
| `access_token`  | httpOnly, Secure, SameSite=Strict           | `/`             | The session JWT                 |
| `refresh_token` | httpOnly, Secure, SameSite=Strict           | `/api/v1/auth/` | Sent only to the auth endpoints |
| `csrf_token`    | **readable by JS**, Secure, SameSite=Strict | `/`             | Double-submit CSRF token        |

`Secure` is always on in production and staging; in development it is dropped
automatically when an `http://` origin is configured (`COOKIE_SECURE`
overrides both).

### Signing in

```bash
curl -c cookies.txt -X POST http://YOUR-IP:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "your-username", "password": "your-password"}'
```

`username` also accepts an email address. The JSON body carries **no tokens**:

```json
{
  "token_type": "bearer",
  "expires_in": 1800,
  "user": { "id": "…", "username": "…", "permissions": ["…"] }
}
```

When the account has TOTP MFA enabled the response is instead
`{ "mfa_required": true, "mfa_token": "…" }` with no cookies set; complete the
second factor with `POST /api/v1/auth/mfa/login`, sending the `mfa_token` with
either a TOTP `code` or a single-use `recovery_code`.

### Authenticating later requests

The backend accepts the token from, in order of preference:

1. the `access_token` cookie (what the browser app uses), or
2. an `Authorization: Bearer <token>` header (non-browser clients).

`POST /api/v1/auth/refresh` rotates the pair using the `refresh_token` cookie;
`POST /api/v1/auth/logout` clears all three cookies.

### CSRF

Every state-changing request (anything but `GET`/`HEAD`/`OPTIONS`) under
`/api/v1` passes a double-submit check: echo the `csrf_token` cookie's value in
an `X-CSRF-Token` header. A cookie-authenticated request without the
`csrf_token` cookie is refused (`403`, `LB-AUTH-008`), as is a mismatched
header. A request carrying no session cookie at all — an unauthenticated call,
or a Bearer-header client — is not subject to the check, because nothing a
browser sends automatically is involved. Onboarding endpoints carry their own
session-based CSRF validation instead.

### OAuth Sign-In

```
GET    /api/v1/auth/oauth-config                         # Enabled OAuth providers (for the login page)
GET    /api/v1/auth/oauth/google                         # Initiate Google sign-in (404 if not configured)
GET    /api/v1/auth/oauth/google/callback                # Google OAuth callback
GET    /api/v1/auth/oauth/microsoft                      # Initiate Microsoft sign-in (404 if not configured)
GET    /api/v1/auth/oauth/microsoft/callback             # Microsoft OAuth callback
GET    /api/v1/auth/oauth/authentik                      # Initiate Authentik (OIDC) sign-in (404 if not configured)
GET    /api/v1/auth/oauth/authentik/callback             # Authentik OAuth callback
```

See [Authentication > OAuth](Security-Authentication#oauth) for the
link-existing-only policy, domain restriction, and callback error codes.

OAuth verifies only the primary credential. When the matched account has TOTP
MFA enabled, the callback issues **no** session cookies: it 302-redirects to
the SPA's configured success URL (`OAUTH_SUCCESS_REDIRECT`) with a short-lived
`mfa_token` in the **URL fragment** (`#mfa_token=…`), and the client completes
the second factor through `POST /api/v1/auth/mfa/login` before any session
exists. Audit event: `oauth_mfa_challenge`.

---

## Response Casing

**Casing is per module, not API-wide.** Pydantic schema modules that set
`alias_generator=to_camel` serialize their responses in camelCase (FastAPI
dumps response models by alias); the rest serialize snake_case, exactly as the
Python attributes are named. Roughly a third of the schema modules are
camelCase — among them apparatus, equipment checks, facilities, finance,
grants, integrations, IP security, legal documents, NFC tags, org chart,
storefront, suggestions, the scheduling module config and the administration
hub. Members, notifications, messages, email templates, medical screening and
most others are snake_case.

To check a module, look for `alias_generator=to_camel` in
`backend/app/schemas/<module>.py`. The camelCase modules also set
`populate_by_name=True`, so their request bodies accept either the camelCase
or the snake_case field names. A hand-written client type in the wrong casing
does not fail loudly — every field simply reads as missing — so check before
writing one.

Some lists return a bare array; others return a page object. The page object's
shape is module-specific (`{ "items": [...], "total", "skip", "limit" }` is
the common one); the module's developer reference states which a given list
returns.

---

## Common Response Patterns

### Success (200/201)

```json
{
  "id": "uuid",
  "field": "value",
  "created_at": "2026-02-23T12:00:00Z"
}
```

IDs are string UUIDs. Timestamps are UTC ISO 8601; converting to the viewer's
or department's timezone is the client's job. (Field names follow the
module's casing — see above.)

### Errors

Every error body carries a `detail` and a support `code`. The code is a
curated `LB-<AREA>-<NNN>` value where one exists, otherwise the automatic
`LB-API-<status>` fallback, so any error a member can quote to IT is
identifiable.

```json
{ "detail": "Insufficient permissions", "code": "LB-PERM-001" }
```

| Status | Typical `detail`                                              | `code`                       |
| ------ | ------------------------------------------------------------- | ---------------------------- |
| 401    | Not authenticated / session expired                           | `LB-AUTH-…`                  |
| 403    | `Insufficient permissions`                                    | `LB-PERM-001`                |
| 403    | `The <Module> module is not enabled for this organization. …` | `LB-ORG-002`                 |
| 403    | `Missing CSRF token` / `Invalid CSRF token`                   | `LB-AUTH-…`                  |
| 429    | Rate-limit message                                            | `LB-SYS-003` or `LB-API-429` |
| 500    | `Internal server error` (details are logged, never returned)  | `LB-SYS-001`                 |

A permission denial names no permission. A module the department has switched
off answers `403` with its own code, so a client can tell "your department
turned this off" apart from "you lack the permission". Some endpoints answer
`404` instead of `403` on purpose, so the response does not confirm that a
record (or a module) exists; those are noted in their sections.

### Validation Error (422)

```json
{
  "detail": [{ "field": "start_date", "message": "This field is required." }],
  "code": "LB-VAL-001"
}
```

`detail` is always an **array** here, never a string — code that renders
errors has to handle both this and the string form above. The published
OpenAPI schema describes this shape, so a generated client gets the right
type.

`field` is a dotted path to the offending field (`address.zip`), or the
literal `request` when the error is not attributable to one. `message` is a
short human-readable sentence, already safe to show a user; a validator's own
message is passed through after sanitizing.

---

## Rate Limiting

Limits are applied per endpoint scope, keyed on the client IP; there is no
blanket per-user limit across the API. A limited request answers `429`,
usually with a `Retry-After` header.

| Endpoint                                   | Limit                                           |
| ------------------------------------------ | ----------------------------------------------- |
| `POST /auth/login`, `POST /auth/mfa/login` | 5 / minute per IP (30-minute lockout)           |
| `POST /auth/register`                      | 3 / minute per IP                               |
| `POST /auth/forgot-password`               | 3 / 5 minutes per IP                            |
| Reset-token validate / reset               | 10 / 5 minutes per IP                           |
| `POST /auth/refresh`                       | 10 / minute per IP                              |
| `POST /auth/change-password`               | 5 / minute per IP                               |
| `GET /users/me/data-export`                | 3 / hour                                        |
| `POST /member-badges/resolve`              | 120 / minute per IP                             |
| Public form view / submit                  | 60 / minute / 10 / minute per IP                |
| Public legal text                          | 30 / minute per IP                              |
| Room display view                          | 60 / minute per IP                              |
| Room kiosk badge tap                       | 60 / minute per IP **and** 60 / minute per room |
| Public portal (`X-API-Key`)                | Per-IP limit first, then the key's hourly quota |

Counters live in Redis and fall back to an in-memory limiter when Redis is
unavailable. The production nginx profile adds its own outer limits: 50
requests/second per IP across `/api/` (with a burst allowance) and 5/minute on
`/api/v1/auth/login`.

---

## Pagination

Most list endpoints page with **`skip` / `limit`**:

```
GET /api/v1/messages?skip=0&limit=50
```

| Parameter | Default | Description                                        |
| --------- | ------- | -------------------------------------------------- |
| `skip`    | 0       | Records to skip (≥ 0)                              |
| `limit`   | 100     | Records to return (1–1000 on the shared paginator) |

Individual endpoints narrow the range — `50` with a maximum of `200` or `500`
is common — and the OpenAPI spec states each one. A few lists page with
`page` / `page_size` instead, and some small lists (the member roster,
`GET /users`) are not paginated. The notification lists page by cursor; see
[Notification Endpoints](#notification-endpoints).

---

## API Modules

All authenticated routes live under `/api/v1`. A router owned by a
configurable module refuses with `403 LB-ORG-002` while the department has
that module switched off; essential modules (members, events, documents,
roles, settings) and cross-module infrastructure (locations, forms, labels,
NFC tags, email templates) are not gated this way.

### Core Endpoints

| Prefix                  | Module         | Description                                                                                        |
| ----------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `/api/v1/auth`          | Authentication | Login, logout, refresh, password reset, MFA, OAuth                                                 |
| `/api/v1/users`         | Members        | User CRUD, profiles, leaves, status, qualifications, personal-data export, consents, anonymization |
| `/api/v1/organization`  | Organization   | Org settings (`/settings/*`), modules, profile, setup checklist, retention policy, template export |
| `/api/v1/onboarding`    | Onboarding     | Organization setup wizard                                                                          |
| `/api/v1/roles`         | Roles          | Positions and their permissions                                                                    |
| `/api/v1/notifications` | Notifications  | Notification rules, send log, user inbox, web push                                                 |
| `/api/v1/messages`      | Messages       | Department messages (admin and member inbox)                                                       |
| `/api/v1/dashboard`     | Dashboard      | Aggregate widgets and layouts                                                                      |
| `/api/v1/admin-hub`     | Administration | Per-module administration page frame                                                               |

### Module Endpoints

| Prefix                                                                  | Module                                                | Main permissions                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/training`                                                      | Training                                              | `training.manage` (admin); see [Training developer reference](Module-Training-Developer)                                                  |
| `/api/v1/scheduling`                                                    | Scheduling                                            | `scheduling.manage` (admin); see [Scheduling developer reference](Module-Scheduling-Developer)                                            |
| `/api/v1/events`                                                        | Events                                                | `events.manage` (admin); see [Events developer reference](Module-Events-Developer)                                                        |
| `/api/v1/elections`                                                     | Elections                                             | `elections.manage` (admin); see [Elections developer reference](Module-Elections-Developer)                                               |
| `/api/v1/inventory`                                                     | Inventory                                             | `inventory.manage` (admin); see [Inventory developer reference](Module-Inventory-Developer)                                               |
| `/api/v1/equipment-checks`                                              | Equipment Checks                                      | `inventory.check_view` / `.check_submit` / `.check_manage`                                                                                |
| `/api/v1/facilities`                                                    | Facilities                                            | `facilities.view`; `facilities.create` / `.edit` / `.delete` or `facilities.manage` to write                                              |
| `/api/v1/locations`                                                     | Locations & room kiosks                               | Authenticated (reads); `locations.create`/`.edit`/`.delete`/`.manage` to write, `locations.manage_nfc_tags` for the badge-check-in toggle |
| `/api/v1/apparatus`                                                     | Apparatus                                             | `apparatus.view`; `apparatus.edit` or `apparatus.manage` to write                                                                         |
| `/api/v1/forms`                                                         | Forms                                                 | `forms.view`; `forms.manage` to write                                                                                                     |
| `/api/v1/meetings`                                                      | Meetings (Minutes module)                             | `meetings.view` or `minutes.view`; `meetings.manage` to write                                                                             |
| `/api/v1/minutes-records`                                               | Meeting Minutes                                       | `minutes.view`; `minutes.manage` to write                                                                                                 |
| `/api/v1/documents`                                                     | Documents                                             | `documents.view`; `documents.manage` to write                                                                                             |
| `/api/v1/prospective-members`                                           | Prospective Members (pipelines, prospects, documents) | `prospective_members.view`; `prospective_members.manage` to write                                                                         |
| `/api/v1/legal-documents`                                               | Legal Documents (Governance)                          | `legal.propose`, `legal.publish`, `settings.manage`                                                                                       |
| `/api/v1/email-templates`                                               | Email templates                                       | `settings.manage` or `organization.update_settings`                                                                                       |
| `/api/v1/member-badges`                                                 | Member badge codes                                    | `members.manage` or `members.manage_id_cards`                                                                                             |
| `/api/v1/member-id-cards`                                               | ID card printing                                      | `members.manage` or `members.manage_id_cards`                                                                                             |
| `/api/v1/nfc-tags`                                                      | NFC ID cards & station check-in                       | `members.manage_id_cards`; `members.check_in` for the station                                                                             |
| `/api/v1/label-printers`, `/api/v1/labels`, `/api/v1/station-documents` | Labels and station printing                           | See [Label Printers & Station Documents](#label-printers--station-documents)                                                              |
| `/api/v1/audit-logs`                                                    | Audit Logs (admin read API)                           | `audit.view`                                                                                                                              |
| `/api/v1/reports`                                                       | Reports                                               | `reports.view`; `reports.manage`                                                                                                          |

### Public Endpoints (No Auth Required)

| Path                                                                            | Description                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/public/v1/forms/{slug}`                                               | Public form access (60/min per IP)                                                                                                                                                                                                                                                |
| `POST /api/public/v1/forms/{slug}/submit`                                       | Public form submission (10/min per IP; CAPTCHA when enabled)                                                                                                                                                                                                                      |
| `GET /api/public/v1/organization/info`, `/organization/stats`, `/events/public` | Public portal endpoints (`X-API-Key` required). The per-IP limit runs before any key lookup or bcrypt check; keys are found by a 16-character lookup prefix (`logbook_` + 8), and a key issued with the older 8-character prefix is upgraded on its next use                      |
| `GET /api/public/v1/health`                                                     | Public portal health                                                                                                                                                                                                                                                              |
| `GET /api/public/v1/application-status/{token}` (+ `POST …/withdraw`)           | Applicant's own pipeline status, addressed by an emailed token                                                                                                                                                                                                                    |
| `GET /api/public/v1/display/{code}`                                             | Room display (kiosk) — current events in that room                                                                                                                                                                                                                                |
| `POST /api/public/v1/display/{code}/badge-tap`                                  | Member ID card tap at a room kiosk — rate-limited 60/min per IP **and** per room; refuses unless both the room's own switch and the department's NFC ID Cards integration are on, re-checked on every tap. Response carries a first name and last initial only, never a member id |
| `GET /api/public/v1/display/{code}/events/{event_id}/guest`                     | Guest sign-in page detail                                                                                                                                                                                                                                                         |
| `POST /api/public/v1/display/{code}/events/{event_id}/guest-check-in`           | Guest (non-member) attendance write (10/min per IP)                                                                                                                                                                                                                               |
| `GET /api/public/v1/calendar/{token}.ics`                                       | Per-member calendar feed, addressed by its token                                                                                                                                                                                                                                  |
| `GET /api/public/v1/calendar/org/{token}.ics`                                   | Department events feed behind the iCalendar integration, addressed by its token — published events only; title, times, location, type and a link back, never descriptions or attendees                                                                                            |
| `/api/public/v1/finance/approvals/{token}` (+ `/approve`, `/deny`)              | External approver actions, addressed by an emailed token                                                                                                                                                                                                                          |
| `GET /api/public/v1/branding/*`                                                 | Department-branded install icons; `404` when no logo is set                                                                                                                                                                                                                       |
| `GET /api/public/v1/legal`                                                      | Public privacy / terms text — see [Public Legal Text](#public-legal-text)                                                                                                                                                                                                         |
| `POST /api/public/v1/webhooks/{documenso,calcom,paypal,salesforce}/…`           | Inbound integration webhooks (signature-verified)                                                                                                                                                                                                                                 |
| `GET /.well-known/security.txt`                                                 | Vulnerability disclosure — see [Vulnerability Disclosure](#vulnerability-disclosure)                                                                                                                                                                                              |
| `GET /health`                                                                   | Health check: `{ status, ready }`; `503` when unhealthy. Before startup completes it also reports version, startup phase and database/Redis checks                                                                                                                                |
| `GET /health/detailed`                                                          | System diagnostics; served only when `ENVIRONMENT=development`, `404` otherwise                                                                                                                                                                                                   |

### Security & Monitoring

| Path                                                                     | Permission                             | Description                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/security/status`                                            | `audit.view`                           | Security dashboard                                                                                              |
| `GET /api/v1/security/alerts` (+ `POST …/{id}/acknowledge`, `…/resolve`) | `audit.view` / `audit.export`          | Security alerts (org-scoped — caller sees/acks/resolves only their own org's alerts)                            |
| `GET /api/v1/security/audit-log/integrity`                               | `audit.view`                           | Audit log hash-chain verification                                                                               |
| `GET /api/v1/security/audit-log/export`                                  | `audit.export`                         | Audit log export (org-scoped; redacts `session_id` to a fingerprint)                                            |
| `POST /api/v1/security/audit-log/rehash`                                 | `audit.export`                         | Break-glass legacy-hash repair (`403` unless `AUDIT_ALLOW_CHAIN_REHASH` is set; fails closed on keyed mismatch) |
| `GET /api/v1/security/intrusion-detection/status`                        | `audit.view`                           | IDS status                                                                                                      |
| `/api/v1/ip-security/blocked-countries`                                  | `security.manage` or `settings.manage` | List / add / remove country blocks (add/remove refused unless `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` is set)     |

---

## Notification Endpoints

```
GET    /api/v1/notifications/rules                       # List notification rules (notifications.view)
POST   /api/v1/notifications/rules                       # Create notification rule (notifications.manage)
GET    /api/v1/notifications/rules/{id}                  # Get rule (notifications.view)
PATCH  /api/v1/notifications/rules/{id}                  # Update rule (notifications.manage)
DELETE /api/v1/notifications/rules/{id}                  # Delete rule (notifications.manage)
POST   /api/v1/notifications/rules/{id}/toggle           # Toggle rule enabled/disabled (notifications.manage)
GET    /api/v1/notifications/logs                        # Send log; ?scope=mine (default) or organization; ?channel; ?cursor
POST   /api/v1/notifications/logs/read-all               # Mark send log read; same ?scope
POST   /api/v1/notifications/logs/{id}/read              # Mark any log as read (notifications.manage)
GET    /api/v1/notifications/my                          # User's in-app notifications; ?include_read, ?include_expired, ?cursor
GET    /api/v1/notifications/my/unread-count             # User's unread count
GET    /api/v1/notifications/my/unread-by-category       # Unread, unpinned counts per category (inbox stacks)
POST   /api/v1/notifications/my/read-category            # Mark one category read; ?category (skips pinned)
POST   /api/v1/notifications/my/read-all                 # Bulk mark all as read
POST   /api/v1/notifications/my/{log_id}/read            # Mark own notification as read
POST   /api/v1/notifications/my/{log_id}/pin             # Pin or unpin own notification; ?pinned=true|false
GET    /api/v1/notifications/summary                     # Rule and send statistics (notifications.view)
GET    /api/v1/notifications/push/config                 # Whether web push is available, and the VAPID public key
POST   /api/v1/notifications/push/subscribe              # Register the caller's browser for push
POST   /api/v1/notifications/push/unsubscribe            # Drop one of the caller's device endpoints
```

The `/my/*` and push routes need only authentication and are always scoped to
the caller. `GET /logs` with the default `scope=mine` likewise returns only
the caller's own deliveries; `scope=organization` returns every recipient's,
including subject, message and recipient address, and requires
`notifications.manage` (the same gate as the organization-wide `read-all`).

Each rule in a rules response carries `enforced`: whether any sender actually
reads rules of that trigger. A stored rule whose trigger nothing consults is
reported as not enforced rather than as active.

Both notification lists page by cursor. Pass `cursor` from a response's
`next_cursor` to get the page after it; the value is opaque, so hand back
exactly what was returned, and a malformed one answers `400`. **`next_cursor`
is `null` at the end of the list** — the key is always present in the
response, never omitted — and that null is the signal to stop. It is more
reliable than comparing loaded rows against `total`, which counts the whole
filtered list including rows _ahead_ of your cursor that a continuation can
never return; the two disagree whenever a notification arrives between two
page requests. `skip` also works, and a `cursor` supersedes it.

---

## Department Messages

Admin endpoints require `notifications.manage`. Inbox/read/acknowledge
endpoints are available to any authenticated member (scoped to messages
targeted to them).

```
# Admin (notifications.manage)
GET    /api/v1/messages                                  # List messages (include_inactive, search, priority, skip/limit) -> { messages, total }
POST   /api/v1/messages                                  # Create message (scheduled_at for deferred publish)
GET    /api/v1/messages/roles                            # Roles available for targeting (id, name, slug)
GET    /api/v1/messages/{id}                             # Get message
PATCH  /api/v1/messages/{id}                             # Update message (edit / reschedule)
DELETE /api/v1/messages/{id}                             # Soft-delete message (read/ack records preserved)
GET    /api/v1/messages/{id}/stats                       # Read/ack counts with audience denominator
GET    /api/v1/messages/{id}/acknowledgments             # Per-recipient read/ack breakdown

# Member (authenticated)
GET    /api/v1/messages/inbox                            # Messages targeted to the current user (include_read, skip/limit)
GET    /api/v1/messages/inbox/unread-count               # Current user's unread/pending count
GET    /api/v1/messages/inbox/{id}                       # One message from the caller's own inbox
POST   /api/v1/messages/{id}/read                        # Mark message as read
POST   /api/v1/messages/{id}/acknowledge                 # Acknowledge (for ack-required messages)
```

Posting a message fans it out across in-app / email / SMS channels by priority
(see the
[Training guide](https://github.com/thegspiro/the-logbook/blob/main/docs/training/07-documents-forms.md#department-messages)).

---

## Email Templates

### Email template backups

```
GET    /api/v1/email-templates/{template_id}/backups   # settings.manage OR organization.update_settings
```

Read-only. Lists the saved earlier versions of a template — the versions kept
when a release reset the template to a new design — newest first. Each carries
the backup as saved (`subject`, `html_body`, `text_body`, `reason`,
`created_at`) and a restore draft (`restored_subject`, `restored_html_body`,
`restored_text_body`): the department's own wording placed inside the current
design. The editor loads the draft; nothing is written until the admin saves
the template. `404` for a template outside the caller's organization.

### Email footer library

```
GET    /api/v1/email-templates/footers   # settings.manage OR organization.update_settings
PUT    /api/v1/email-templates/footers   # Replaces the library whole
```

`GET` returns the built-in library until the department saves one of its own,
together with a live per-footer **usage count**, so the screen can say "3
templates use this" before one is deleted. A template's `footer_key` of NULL
counts toward the library's `default_key`. `PUT` takes
`{ default_key, footers }` (1–12 footers, unique keys, and `default_key` must
name one of them) and replaces the library **whole** — a per-footer save could
leave `default_key` naming a footer the same request deleted.

---

## Legal Documents

Governance record for the wording served on the public `/privacy` and
`/terms` pages. Backs Governance → Legal Documents, where the secretary and
department leaders read what those pages publish and propose alternatives for
local rules. **Proposing and publishing are separate grants.** Responses and
request bodies are camelCase (snake_case request names are also accepted).

```
GET    /api/v1/legal-documents                                # Both documents: current text + first page of drafts/history
GET    /api/v1/legal-documents/{document_type}/revisions      # ?kind=drafts|history&offset=&limit= (Load more)
POST   /api/v1/legal-documents/revisions                      # Draft a revision
PUT    /api/v1/legal-documents/revisions/{id}                 # Edit a draft
DELETE /api/v1/legal-documents/revisions/{id}                 # Discard a draft (204)
POST   /api/v1/legal-documents/revisions/{id}/publish         # Make it public
POST   /api/v1/legal-documents/{document_type}/revert-to-default   # 204
```

| Endpoint                     | Permission (any of)                                 |
| ---------------------------- | --------------------------------------------------- |
| Read / draft / edit / delete | `legal.propose`, `legal.publish`, `settings.manage` |
| Publish, revert to default   | `legal.publish`, `settings.manage`                  |

`document_type` ∈ `privacy_policy` | `terms_of_service`.

**`GET /legal-documents`** returns `organizationName`, `canPublish` for the
caller (so the screen can hide controls it would only `403` on), and one entry
per document with what members currently see (`publishedBody`,
`publishedEffectiveDate`, `publishedAt`, `publishedByName`,
`usingPlatformDefault`), and the newest page of `drafts` and published
`history` with `draftsTotal` / `historyTotal`. The revisions endpoint serves
the rest, newest first, as `{ items, total, offset, limit }` (default `limit`
10, maximum 50).

**Notes.**

- The **published text is not served from this API.** It lives in
  `organizations.settings["legal"]`, which the anonymous
  [public endpoint](#public-legal-text) reads with no join and no auth. These
  endpoints manage the governance record around it.
- `changeNote` is **required** on a revision (max 2,000 characters); `body`
  is required and capped at 100,000 characters, the same cap the public
  endpoint applies.
- `effectiveDate` is free text (max 64 chars) and is never parsed — it is
  displayed as "Last updated". On an edit, send an explicit `null` (or blank)
  to clear it; an omitted key means "leave it alone".
- Only drafts are editable or deletable — a published revision is what the
  department is on record as having published on a date. A proposer may
  modify only their own draft (`403` otherwise); a publisher may modify
  anyone's.
- Publishing archives the previously published revision, writes the body and
  its effective date into the organization's settings, and audits as
  `legal.document_published`. Reverting archives the published revision and
  removes the custom text so the built-in default renders again
  (`legal.document_reverted_to_default`). Archived revisions are never
  deleted. Proposing, editing and discarding audit as
  `legal.revision_proposed`, `legal.revision_updated` and
  `legal.revision_discarded`.
- `legal.propose` is granted to every position holding `settings.view` (or
  `settings.*`), and `legal.publish` to every position holding
  `settings.manage` (or `settings.*`) — the split that already distinguishes
  leadership from the general membership.

---

## Public Legal Text

Unauthenticated, rate-limited (30/min per IP). Backs the public `/privacy` and
`/terms` pages.

```
GET    /api/public/v1/legal
```

```json
{
  "organizationName": "…",
  "privacyPolicy": "…",
  "termsOfService": null,
  "privacyPolicyLastUpdated": "January 2026",
  "termsOfServiceLastUpdated": null,
  "lastUpdated": "January 2026"
}
```

Returns the single organization's configured text
(`settings.legal.privacy_policy` / `settings.legal.terms_of_service`) and each
document's own effective date, shown above custom text. `null` values mean the
frontend renders its built-in defaults, which carry their own date.
`lastUpdated` is kept for existing v1 clients: it is the privacy policy's date
if it has one, otherwise the terms' date. On a multi-organization install all
fields are `null` — with no org context, no tenant's text is served.

`settings["legal"]` is unvalidated JSON, so values are read defensively: a
non-string value, a non-dict `legal` key, or blank/whitespace text all return
`null` (the defaults render) rather than erroring on a page anonymous visitors
reach. Returned text is plain text (rendered as paragraphs, never HTML) and
capped at 100,000 characters; dates at 64.

---

## Privacy, Consent & Retention

Data-subject rights and records retention. See
[Privacy & Data Rights](Security-Privacy) for behavior and guarantees.

```
# Member self-service (authenticated; always scoped to the caller)
GET    /api/v1/users/me/data-export                      # Full personal-data export (JSON download; 3/hour)
GET    /api/v1/users/me/consents                         # Consent state per type (granted=null means never asked)
PUT    /api/v1/users/me/consents/{consent_type}?granted= # Record a consent choice (audited)

# Administrative (members.manage)
POST   /api/v1/users/{user_id}/anonymize                 # Irreversibly scrub a DEPARTED member's PII

# Records retention (settings.manage OR organization.update_settings)
GET    /api/v1/organization/retention-policy             # Effective schedule per record class
PUT    /api/v1/organization/retention-policy/{class}?days=   # Set retention; omit days for keep-forever
```

Consent types: `photo_use`, `public_roster_listing`, `sms_notifications`.

Retention record classes and their minimum floors — `PUT` returns `400` below
the floor, and enforcement runs daily:

| Record class           | Minimum days |
| ---------------------- | ------------ |
| `message_history`      | 30           |
| `notification_logs`    | 30           |
| `error_logs`           | 30           |
| `form_submissions`     | 90           |
| `guest_check_ins`      | 90           |
| `practice_skill_tests` | 30           |

`POST /anonymize` returns `400` for a member who has not departed (drop or
archive them first), for an already-anonymized member, or for your own
account, and `404` for a member outside your organization. Audit logs and
election records are never modified.

---

## Vulnerability Disclosure

Served at the site root (not under `/api`), per RFC 9116.

```
GET    /.well-known/security.txt                         # Contact, policy, expiry (text/plain)
```

Configured with `SECURITY_TXT_CONTACT` and `SECURITY_TXT_POLICY_URL`. The
`Expires` field is regenerated per request so the file never goes stale.

---

## Audit Logs (Admin)

Read-only admin API for browsing the audit trail. Permission: `audit.view`.
Results are org-scoped on the `audit_logs.organization_id` column, which is
stamped at write time and covered by the hash chain. Platform-level rows with
a NULL organization are never returned to org admins.

```
GET    /api/v1/audit-logs                                # List (filters below; skip/limit)
GET    /api/v1/audit-logs/stats                          # Summary counts (by severity, by category)
GET    /api/v1/audit-logs/{log_id}                       # Get a single audit entry
```

Filters on the list endpoint: `event_type`, `event_category`,
`severity` (`info` \| `warning` \| `critical`), `user_id`, `search` (username or
event-type substring), `start_date`, `end_date`, `skip` (≥0), `limit` (1–500,
default 50).

Hash-chain verification and export live under
[Security & Monitoring](#security--monitoring).

---

## Dashboard Widgets

Three aggregate endpoints for the dashboard. All authenticate as the current
user and authorize each section independently, but **they do not all behave the
same way** — do not generalize from one to the others:

| Endpoint                   | Unauthorized section is…    | Module-gated?                                                             |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `/dashboard/widgets`       | **`null`** in the response  | Yes — every section checks module **and** permission                      |
| `/dashboard/operations`    | **omitted** from `sections` | Every section except `pending_approvals` checks module **and** permission |
| `/dashboard/asset-widgets` | **omitted** from `widgets`  | Yes — every block checks module **and** permission                        |

Only the two list-based responses omit what the caller cannot see.
`/dashboard/widgets` serializes `finance`, `fundraising` and `community` as
`null` instead.

```
GET /api/v1/dashboard/widgets?period=month|quarter|year|rolling_30
GET /api/v1/dashboard/operations
GET /api/v1/dashboard/asset-widgets
```

### `/dashboard/widgets`

Response: `{ period, period_label, finance, fundraising, community }`.

| Section       | Requires                                   |
| ------------- | ------------------------------------------ |
| `finance`     | `finance` module **and** `finance.manage`  |
| `fundraising` | `grants` module **and** `fundraising.view` |
| `community`   | `events` module **and** `events.manage`    |

`settings.manage` is **intentionally not financial access.** Any of the three
sections may be `null`, and `null` means the section is withheld — the caller
lacks the permission or the department does not run the module. A section the
caller may see is never `null`, even for an empty period, so treat `null` as
"not available to you" rather than as "no data".

### `/dashboard/operations`

Response: `{ generated_at, timezone, sections: [{ key, title, items: [...] }] }`,
where each item is `{ key, label, severity, count, oldest_age_days,
most_urgent, href }`.

| Section                  | Requires (any of)                                                                                          | Module             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------ |
| `operational_readiness`  | `scheduling.manage`                                                                                        | `scheduling`       |
| `critical_exceptions`    | `meetings.manage`, `minutes.manage`, `scheduling.manage`, `inventory.check_manage`, `notifications.manage` | per item           |
| `membership_health`      | `members.manage`                                                                                           | `members`          |
| `upcoming_command_dates` | `events.manage`                                                                                            | `events`           |
| `period_trends`          | `training.manage`                                                                                          | `training`         |
| `pending_approvals`      | `admin_hours.manage`                                                                                       | — (no module flag) |

`critical_exceptions` is finer-grained than the row above suggests: it is
assembled item by item, each item behind its own module and the single
permission owning its data source, and the section is omitted entirely when no
item survived:

| Item                        | Module          | Permission               |
| --------------------------- | --------------- | ------------------------ |
| `unassigned_shift_officers` | `scheduling`    | `scheduling.manage`      |
| `overdue_action_items`      | `minutes`       | `meetings.manage`        |
| `minutes_action_items`      | `minutes`       | `minutes.manage`         |
| `equipment_checks`          | `inventory`     | `inventory.check_manage` |
| `notification_failures`     | `notifications` | `notifications.manage`   |

Holding `notifications.manage` alone therefore returns the section with the
notification item only — not the shift, action-item or equipment-check items.

Dates and ages are resolved in the organization's configured timezone, falling
back to the scheduling default (`America/New_York`) if it is unset or
unrecognized; the zone used is reported in `timezone`.

### `/dashboard/asset-widgets`

Returns **counts and fixed links only** for Inventory, Apparatus and
Facilities. Each block is authorized independently, so managing inventory does
not reveal apparatus or facilities. Protected facility fields (codes, accounts,
budgets, leases) are deliberately not reachable through this endpoint.

**A `*.view` grant is not enough, and the module must be switched on.** These
are management-reporting tallies — deficiency counts, overdue checks,
compliance deadlines — so each block requires its module's _manage_ permission
or `settings.manage`, **and** the module enabled for the organization:

| Block        | Requires                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `inventory`  | module on, **and** `inventory.manage`                                                                           |
| `apparatus`  | module on, **and** (`apparatus.manage` or `settings.manage`), **and** `apparatus.view` or `apparatus.manage`    |
| `facilities` | module on, **and** (`facilities.manage` or `settings.manage`), **and** `facilities.view` or `facilities.manage` |

The second condition on each row is a destination check, not a second data
gate: every widget links into that module's pages, and those routes have their
own entry permissions, so a caller who cannot open the destination is not shown
a tile whose only action is Access Denied. For `inventory` the destination gate
(`inventory.manage`) is the stricter of the two and subsumes the
`settings.manage` arm.

### Other dashboard endpoints

| Endpoint                                     | Gate                                                         | Returns                                                                         |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET /dashboard/stats`                       | Authenticated                                                | Member, document and event counts, setup percentage                             |
| `GET /dashboard/admin-summary`               | `settings.manage`                                            | Department-wide summary; module-owned figures are `null` when the module is off |
| `GET /dashboard/action-items`                | Authenticated; each half gated as its owning module gates it | Unified meeting and minutes action items                                        |
| `GET /dashboard/community-engagement`        | `events.manage`                                              | Public-outreach event and attendee counts                                       |
| `GET/PUT/DELETE /dashboard/pulse-layout`     | Authenticated                                                | The caller's own dashboard layout                                               |
| `PUT/DELETE /dashboard/pulse-layout/default` | `settings.manage` or `organization.update_settings`          | The department's default layout                                                 |

---

## Administration Page Frame

One shape serves every module's administration page: four headline metrics and
a **Needs attention** queue, plus the settings that choose which three metrics
fill the open slots. Responses and request bodies are camelCase.

```
GET  /api/v1/admin-hub/{module_key}/summary
GET  /api/v1/admin-hub/{module_key}/metrics
PUT  /api/v1/admin-hub/{module_key}/metrics
```

`module_key` is one of `members`, `training`, `inventory`, `events`,
`scheduling`, and is pattern-constrained to `^[a-z_]{1,50}$` at the path.

**Authorization is the module's own manage permission** — `members.manage`,
`training.manage`, `inventory.manage`, `events.manage`, `scheduling.manage` —
never a blanket admin gate. The attention queue rows name people, so an
inventory officer who cannot manage members must not read the member queue.

**An unknown module and a forbidden one both answer `404`.** This is
deliberate: a caller who may not administer Training should not be able to
learn from this endpoint whether the department runs Training at all. Do not
"fix" it into a `403`.

`summary` returns `{ moduleKey, generatedAt, timezone, metrics, attention }`.
Each metric is `{ key, label, value, context, fixed }`, with `value`
pre-formatted for display (`"87%"`, `"1,840"`); the fourth, `fixed: true`, is
`needs_attention`. Each attention item is `{ key, title, detail, actionLabel,
href, severity, count, oldestAgeDays }`, critical items first. `metrics`
(`GET`) returns the settings screen's state: `options` (each with its current
value and, when it cannot be chosen, an `unavailableReason`), `selected`,
`appliesToEveryone`, `isPersonal`, `departmentDefault` and `builtInDefault`.
`PUT` takes `{ metricKeys, appliesToEveryone }` and audits as
`admin_hub.metrics_updated`.

Two rules an integrator will otherwise get wrong:

- **Only three metric keys are stored.** The fourth slot is always the count
  that feeds the attention queue and is not part of the settings payload. A
  `PUT` naming more than three keys is rejected (`422`).
- **No stored preference means the module's built-in default three, never an
  empty row.** Absence is "current behaviour", not "off". A stored key whose
  metric is no longer available (its module switched off, say) falls back to
  the default rather than leaving a blank card.

Preferences have two scopes in one table. The department-wide record carries
the scope key `__department__`; its `applies_to_everyone` flag decides
whether an individual administrator may keep a personal selection.

Some metrics carry a **second** permission beyond the module's. On `members`,
the screening-currency metric (`screening_current`) and the whole attention
queue additionally require `medical_screening.view`; without it the metric is
returned with the placeholder value `—` rather than omitted, and the queue is
empty.

---

## Member Badges and ID Card Printing

```
GET    /api/v1/member-badges/settings               # { accept_legacy } (badge officers)
PUT    /api/v1/member-badges/settings               # { accept_legacy: bool } (audit: member_badge_settings_updated)
POST   /api/v1/member-badges/resolve                # { code } -> the member a scan identifies (120/min per address)
GET    /api/v1/member-badges/{user_id}              # { user_id, badge_code } - the member themselves, or a badge officer; else 404
POST   /api/v1/member-badges/{user_id}/reissue      # Cancel a lost badge, issue a new code (badge officers; audit: member_badge_reissued)
GET    /api/v1/member-id-cards/layout               # Saved CR80 layout, or the default
PUT    /api/v1/member-id-cards/layout               # { orientation, sides, symbology } (audit: id_card_layout_updated)
POST   /api/v1/member-id-cards/pdf                  # { user_ids (1-500), orientation?, sides?, symbology? } -> application/pdf (audit: id_cards_printed)
```

Badge officers are holders of `members.manage` or `members.manage_id_cards`;
the ID card endpoints use the same pair. `resolve` also accepts `users.view`
and `inventory.manage` holders, the two scanners' own gates, and answers only
within the caller's organization with
`{ user_id, name, membership_number, is_active, matched }` where `matched` is
`badge_code` or `legacy`; an unrecognised code answers `404`. The badge code
(`users.badge_code`, `MB-` plus ten characters) is **never** in a roster,
profile, export or anonymized record; `GET /{user_id}` assigns one if the
member has none yet. Old badges (membership number, short id, old digital-card
QR) resolve while `accept_legacy` is not `false`; absent means accepted.

Layout options: `orientation` ∈ `landscape` | `portrait`, `sides` ∈ `front` |
`both`, `symbology` ∈ `code128` | `qr`. The default is landscape, front only,
Code 128. Options omitted from a print request take the saved layout. See
[Member ID cards](Member-ID-Cards#badge-codes-and-printing-cr80-id-cards-2026-10-05).

---

## NFC ID Cards & Station Check-In

```
GET    /api/v1/nfc-tags                    # ?user_id, ?status -> { items, total } (members.manage_id_cards)
POST   /api/v1/nfc-tags                    # Register a card to a member (members.manage_id_cards)
PATCH  /api/v1/nfc-tags/{tag_id}           # Relabel / change status (members.manage_id_cards)
DELETE /api/v1/nfc-tags/{tag_id}           # (members.manage_id_cards)
POST   /api/v1/nfc-tags/check-in           # A station records a tap (members.check_in)
```

There is no self-service path: a member cannot register, relabel or revoke a
card, not even their own. Responses are camelCase.

The whole feature is gated by the `nfc-id-cards` integration row, which starts
**off**. Every one of these endpoints checks it **server-side** and answers
`403` while it is off — hiding the screen would leave the credential surface
reachable. The guard fails **closed**: an organization whose catalog row has
never been seeded, or whose row is not enabled and connected, counts as not
having turned it on.

**The credential is never stored or returned in plaintext.** A card's serial
is the whole of the credential, so the table holds a peppered SHA-256 hash;
`uidPreview` carries the last four characters purely so an officer can tell
two of a member's cards apart. There is no endpoint that reads a card number
back out, and none should be added.

`POST /nfc-tags/check-in` takes `{ tagUid, tagPayload?, targetType, targetId,
direction? }`, where the target is a shift, an event or an admin-hours
category and `direction` defaults to `auto`. Every domain outcome is a `200`
with a `status` the station draws on screen: `checked_in`, `checked_out`,
`already_checked_in`, `already_checked_out`, `unknown_card`, `card_inactive`,
`member_inactive` or `refused`. A second tap within 60 seconds is treated as a
bounce and reports the current state instead of checking the member out.

A tap will not attach to a shift once it is **finalized** — but not merely
because its end time has passed. Checking out has no deadline, so an
unfinalized shift is one somebody may still need to tap out of, and a
clock-based cutoff would take the station away from a crew at the moment they
go off duty. Retired and on-leave members are accepted — they attend meetings
and banquets, which is what a station records — while inactive, suspended,
dropped, archived and deleted members are refused. A lost or revoked card is
never reactivated; a replacement is a fresh registration.

An ID card tapped at an officer-operated station into an admin-hours category
is recorded with entry method **`nfc_station`**, not `qr_scan`. The two are
different acts by different people and exports must be able to tell them
apart.

The unattended room-kiosk equivalent is the public
`POST /api/public/v1/display/{code}/badge-tap` — see
[Public Endpoints](#public-endpoints-no-auth-required).

---

## Label Printers & Station Documents

```
GET    /api/v1/label-printers                       # Any authenticated member; ?include_inactive
POST   /api/v1/label-printers                       # settings.manage OR organization.update_settings
PUT    /api/v1/label-printers/{printer_id}          # settings.manage OR organization.update_settings
DELETE /api/v1/label-printers/{printer_id}          # settings.manage OR organization.update_settings
POST   /api/v1/label-printers/{printer_id}/test     # settings.manage OR organization.update_settings
GET    /api/v1/label-printers/{printer_id}/status   # settings.manage OR organization.update_settings
POST   /api/v1/label-printers/probe                 # settings.manage OR organization.update_settings
POST   /api/v1/labels/preview                       # The module's view permission
POST   /api/v1/labels/generate                      # PDF labels; the module's view permission
POST   /api/v1/labels/print                         # Send to a network printer; the module's view permission
GET    /api/v1/label-preset/{module}                # The caller's position's preset for a module
PUT    /api/v1/label-preset/{module}
POST   /api/v1/station-documents/preview
POST   /api/v1/station-documents/print
```

Label requests name a `module`; an unknown module answers `404`, and a caller
holding none of that module's view or manage permissions answers `403`.
Printing a label reveals nothing the PDF does not, so both share the gate.

**The server opens the socket to the printer**, using the registered host and
port. Reachability is therefore the backend container's, not the operator's
browser's — a printer an operator can ping from their laptop may be
unreachable from the server, and registration will still succeed because
nothing validates the address at save time.

Each printer records the **command language** it speaks: `zpl` (Zebra and the
many printers with ZPL emulation) or `escpos` (receipt-class thermal, some
with linerless label media). The renderer, the stock sizes offered and the
status query all branch on it. A printer with no recorded language is `zpl`.

Status is **best-effort and per printer**: a printer that fails to answer
reports its status as unknown and does not suppress the answers from the
others.

`station-documents` renders the shift roster and the equipment check sheet to
the watch-desk printer:

| Document                | Requires (any of)                                                          |
| ----------------------- | -------------------------------------------------------------------------- |
| `shift_roster`          | `scheduling.view`, `scheduling.manage`                                     |
| `apparatus_check_sheet` | `inventory.check_view`, `inventory.check_submit`, `inventory.check_manage` |

An unknown document answers `404`. A printed roster includes the shift's
pass-down notes only for a viewer who may read them through the handoff
endpoint — a shift manager, the named shift officer, or a member rostered on
that shift — so a flat `scheduling.view` grant is not a way around that rule.

---

## Labels — Generic Cross-Module Endpoints

Any module that prints barcode labels goes through one generic API. The
caller must hold one of the permissions the target module accepts for
labels; an unknown module is a `404`, a caller holding none of the module's
permissions a `403`. (Assembler: place this beside the "Label Printers"
section, which documents `/label-printers/*` and `POST /labels/print`.)

```
POST   /api/v1/labels/preview            # { module, ids } → { items: [{ name, barcode_value, subtitle }] } (read-only)
POST   /api/v1/labels/generate           # { module, ids, label_format, ... } → application/pdf
GET    /api/v1/label-preset/{module}     # Label preset for the caller's position in {module}
PUT    /api/v1/label-preset/{module}     # Save it
```

| Module                | Accepted permissions                                     |
| --------------------- | -------------------------------------------------------- |
| `inventory`           | `inventory.manage`                                       |
| `apparatus`           | `apparatus.view`, `apparatus.manage`                     |
| `prospective_members` | `prospective_members.view`, `prospective_members.manage` |
| `facilities`          | `facilities.view`, `facilities.manage`                   |
| `membership`          | `members.manage`, `members.manage_id_cards`              |
| `storage_areas`       | `inventory.manage`                                       |

**`POST /labels/generate`** takes `ids` (1–2000), `label_format` (default
`letter`), `custom_width` (0.5–8 in) and `custom_height` (0.5–11 in),
`auto_rotate`, `extra_lines` (up to 20 entries of at most 100 characters —
a field key or `custom:<text>`), `symbology` (default `code128`) and
`start_position` (1–30; sheet formats only, ignored on rolls). The PDF
response carries an `X-Barcodes-Auto-Populated` header with the number of
records that were given a barcode as part of the run. Generating
`prospective_members` or `membership` labels is audited as
`labels_generated`. The caller's own prospect application is filtered out
of the id list for preview and generate.

**`PUT /label-preset/{module}`** takes `preset`, `printer_id`,
`custom_width`, `custom_height` and `symbology`. `printer_id` is checked
against the caller's organization before it is stored; omitting it leaves
the remembered printer alone and an explicit `null` clears it. The GET
returns `{ preset, printer_id, custom_width, custom_height, symbology,
extra_lines, position_id, module }`, or `preset: null` when the caller's
position has none saved. Inventory also exposes its own
`GET/PUT /api/v1/inventory/label-preset` (see
[Module-Inventory-Developer](Module-Inventory-Developer#labels)).

---

## Prospective Member Documents

```
GET    /api/v1/prospective-members/prospects/{id}/documents                        # List (prospective_members.view or .manage)
POST   /api/v1/prospective-members/prospects/{id}/documents                        # Upload (multipart, ≤50MB) (members.manage or prospective_members.manage)
GET    /api/v1/prospective-members/prospects/{id}/documents/{document_id}/download # Download (prospective_members.view or .manage)
DELETE /api/v1/prospective-members/prospects/{id}/documents/{document_id}          # Delete (members.manage or prospective_members.manage)
```

Accepted types are PDF, Word (`.doc`, `.docx`), JPEG, PNG and GIF. Uploads
are type-checked by magic bytes against that allowlist and for consistency
with the file extension, and malware-scanned, before they are stored; every
later read and delete is confined to the organization's applicant storage.

---

## Prospective Members — Pipeline Board, Advancement and Bulk Actions

Router prefix `/api/v1/prospective-members`, behind the Prospective Members
module gate. Bodies are snake_case.

```
GET    /api/v1/prospective-members/pipelines/{pipeline_id}/kanban   # KanbanBoardResponse (prospective_members.view or prospective_members.manage)
POST   /api/v1/prospective-members/prospects/{prospect_id}/advance  # Advance to the next stage (members.manage or prospective_members.manage)
POST   /api/v1/prospective-members/prospects/{prospect_id}/regress  # Back to the previous stage (members.manage or prospective_members.manage)
POST   /api/v1/prospective-members/prospects/{prospect_id}/assign-stage  # Place a prospect with no stage onto one (members.manage or prospective_members.manage)
POST   /api/v1/prospective-members/prospects/{prospect_id}/status   # Set one prospect's status (members.manage or prospective_members.manage)
POST   /api/v1/prospective-members/prospects/bulk-advance           # Advance up to 200 prospects (members.manage or prospective_members.manage)
POST   /api/v1/prospective-members/prospects/bulk-status            # Set the status of up to 200 prospects (members.manage or prospective_members.manage)
```

**Kanban board.** The endpoint declares `KanbanBoardResponse`, whose cards carry
the **same projection as the prospect list** via a shared mapper — never the
full `ProspectiveMember` row (no `status_token`, coordinator notes, date of
birth or home address). The caller's own prospective-membership record is
omitted. Cards are capped at 500 per board; each column's `count` is the true
total regardless.

| `KanbanBoardResponse` field                            | Notes                                            |
| ------------------------------------------------------ | ------------------------------------------------ |
| `pipeline`                                             | `PipelineResponse`                               |
| `columns[].step`                                       | `PipelineStepResponse \| null`                   |
| `columns[].prospects[]`                                | `ProspectListResponse`                           |
| `columns[].count`                                      | True column size — can exceed the cards returned |
| `total_prospects` / `returned_prospects` / `truncated` | Board truncation state                           |

**Advance.** Optional body `{ notes, completed_items }`. `completed_items` is
the list of checklist items ticked when completing a checklist stage (at most
200 items, each at most 255 characters); a checklist stage refuses to complete
until its items are ticked, and the ticks arrive with the advance that
completes it. Advance and regress answer **`409`** when the prospect has
nowhere to move (already at the final stage, no current stage, or a status
that stops the move) and `404` when the prospect is not in the caller's
organization. `assign-stage` (body `{ step_id, notes? }`) is recovery only: it
is refused with `409` when the applicant already has a stage.

**Status changes.** `status` is one of `active`, `on_hold`, `approved`,
`rejected`, `withdrawn` or `inactive`; `transferred` is refused, because it is
set by converting the applicant to a member. `reason` (at most 1000
characters) is recorded in the prospect's **activity log** and never written to
the `notes` column.

**Bulk actions** take `prospect_ids` (1–200) plus `notes` (advance) or
`status` + `reason` (status), and return `BulkActionResponse`:
`succeeded_count`, `failed_count`, and `results[]` of
`{ prospect_id, name, succeeded, error }`. **One failure never aborts the
rest**: each prospect is committed before the next is attempted, and a prospect
already at the final stage is reported as a failure, not counted as advanced.
Bulk ids arrive in the body, where the router's path-parameter privacy guard
cannot see them, so both endpoints filter the caller's own prospect record
explicitly and report it as **"Prospect not found"** — identical to an id that
does not exist.

**Referrer validation.** `referred_by` (and `target_role_id`) are validated
against the caller's organization on prospect create and update
(`assert_in_org`, fails closed, generic message so the endpoint is not a
cross-tenant existence oracle); a `ValueError` there is a `400`. Conversion to
a member drops an out-of-org referrer rather than copying it onto
`User.referred_by_user_id`.

---

## Finance — Approval Steps and Approver Coverage

Router prefix `/api/v1/finance`. Finance request and response bodies are
camelCase (`alias_generator=to_camel`).

```
GET    /api/v1/finance/approval-chains/approver-coverage   # Every approval step, who can act on it, any problem, requests waiting (finance.configure_approvals)
POST   /api/v1/finance/approvals/{step_record_id}/approve  # Approve the step a request is waiting on (finance.approve)
POST   /api/v1/finance/approvals/{step_record_id}/deny     # Deny it (finance.approve)
```

**Approve and deny are limited to the step's named approver.** Body
(`ApprovalActionRequest`): `notes` (optional), `overrideReason` (optional,
at most 2000 characters, blank treated as absent) and
`acknowledgeLateSubstantiation` (boolean, default `false` — required to approve
an expense report with lines submitted after the department's substantiation
deadline).

- An approvals administrator (`finance.configure_approvals`) who is not the
  named approver may act by giving `overrideReason`; the override is recorded
  in the audit log (`finance.approval_step_approved` /
  `finance.approval_step_denied`).
- The requester can never approve their own request; a requester may deny
  (withdraw) it.

| Status | When                                                            |
| ------ | --------------------------------------------------------------- |
| `400`  | The step cannot be acted on (validation failure, wrong state)   |
| `403`  | The caller is not the named approver and gave no valid override |
| `409`  | Approving would exceed a budget limit                           |

**Approver coverage** returns one row per approval step in the organization's
chains, so an administrator can find steps nobody can act on before requests
pile up behind them:

| Field                                            | Notes                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `chainId`, `chainName`, `chainIsActive`          | The chain the step belongs to                                                                    |
| `stepId`, `stepName`, `stepOrder`                | The step                                                                                         |
| `approverType`, `approverValue`, `assigneeLabel` | Who the step names                                                                               |
| `eligibleActiveCount`                            | Active members who match the step and may approve (`finance.approve`, except on an email step)   |
| `problem`                                        | `null`, `no_value`, `not_found`, `no_active_members`, `no_approve_permission` or `invalid_email` |
| `pendingRequestCount`                            | Requests waiting on this step now                                                                |

---

## Finance — Member Dues Payment Ledger

Each payment against a member's dues is its own row in `dues_payments`. The
dues record's `amountPaid` is the **sum of that ledger**, recomputed on every
write, and `paidDate`, `paymentMethod`, `transactionReference` and `notes`
project the newest payment. Write payments, not totals.

```
PUT    /api/v1/finance/dues/{dues_id}            # Record a payment (finance.manage)
GET    /api/v1/finance/dues/{dues_id}/payments   # Payment ledger, oldest first (finance.view or finance.manage)
POST   /api/v1/finance/dues/{dues_id}/waive      # Waive dues; reason required (finance.manage)
POST   /api/v1/finance/dues/{dues_id}/unwaive    # Reverse a waiver; reason required (finance.manage)
```

| Route         | Body                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `PUT`         | `amountPaid` (required, `> 0`, two decimals); `paymentMethod`, `transactionReference`, `notes` |
| `.../waive`   | `reason` (required, non-empty) — stored as `waiveReason`                                       |
| `.../unwaive` | `reason` (required, non-empty) — handled transiently, never stored or audited                  |

Each ledger row (`DuesPaymentResponse`) carries `id`, `memberDuesId`, `amount`,
`paymentMethod`, `transactionReference`, `notes`, `receivedAt`, `recordedBy`,
`createdAt`, `updatedAt`.

**Idempotency.** `PUT /finance/dues/{id}` is idempotent on
`transactionReference`: resubmitting a reference already recorded against those
dues returns the record unchanged rather than erroring, so a retried or
double-submitted payment cannot double-credit. A unique constraint on
`(member_dues_id, transaction_reference)` backs this. Payments **without** a
reference are never deduplicated — two identical cash amounts are two payments.
The dues row is locked while a payment is recorded, so two concurrent payments
cannot overwrite each other's total.

**Separation of duties.** The person recording a payment, or waiving dues,
must not be the member who owes them (`400`).

**Waived dues reject payment.** `PUT` returns `400` when the record is `WAIVED`
or `EXEMPT`; those are not owing, and recording money against them would cancel
the waiver as a side effect. Use `/unwaive` first: it clears `waivedBy`,
`waivedAt` and `waiveReason`, restores whatever the ledger says (`PENDING`,
`PARTIAL` or `PAID`) and writes a `finance.dues_waiver_reversed` audit event
carrying the dues id and the restored status. The free-text reasons are kept
out of the audit log because they may contain personal information. `/unwaive`
on dues that are not waived is `400`.

**Reading the ledger.** A caller without `finance.manage` can read only the
ledger of their own dues; any other id answers `404`, the same as an id that
does not exist.

---

**See also:** [Backend Development](Development-Backend) | [Technology Stack](Technology-Stack)
