# API Reference

The Logbook provides a RESTful API built with FastAPI. Interactive documentation is available at runtime.

---

## Interactive Documentation

| URL             | Format      | Description                                       |
| --------------- | ----------- | ------------------------------------------------- |
| `/docs`         | Swagger UI  | Interactive API explorer — try endpoints directly |
| `/redoc`        | ReDoc       | Clean, readable API documentation                 |
| `/openapi.json` | OpenAPI 3.0 | Machine-readable JSON spec                        |

> Access these at `http://YOUR-IP:3001/docs` (or your configured backend port).

---

## Authentication

All authenticated endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Obtaining a Token

```bash
curl -X POST http://YOUR-IP:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "your-username", "password": "your-password"}'
```

Response:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer"
}
```

---

## API Modules

### Core Endpoints

| Prefix                  | Module         | Description                                                                                 |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `/api/v1/auth`          | Authentication | Login, logout, refresh, password reset, MFA                                                 |
| `/api/v1/users`         | Members        | User CRUD, profiles, leaves, rank validation, personal-data export, consents, anonymization |
| `/api/v1/organizations` | Organization   | Org settings, modules, retention policy, template export                                    |
| `/api/v1/onboarding`    | Onboarding     | Organization setup wizard                                                                   |
| `/api/v1/settings`      | Settings       | Organization and module configuration                                                       |
| `/api/v1/notifications` | Notifications  | Notification rules, logs, user inbox, and department messages                               |

### Module Endpoints

| Prefix                        | Module                                                | Permission                       |
| ----------------------------- | ----------------------------------------------------- | -------------------------------- |
| `/api/v1/training`            | Training                                              | `training.manage` (admin)        |
| `/api/v1/scheduling`          | Scheduling                                            | `scheduling.manage` (admin)      |
| `/api/v1/events`              | Events                                                | `events.manage` (admin)          |
| `/api/v1/elections`           | Elections                                             | `elections.manage` (admin)       |
| `/api/v1/inventory`           | Inventory                                             | `inventory.manage` (admin)       |
| `/api/v1/equipment-checks`    | Equipment Checks                                      | `equipment_check.manage` (admin) |
| `/api/v1/facilities`          | Facilities                                            | `facilities.manage` (admin)      |
| `/api/v1/apparatus`           | Apparatus                                             | Authenticated                    |
| `/api/v1/forms`               | Forms                                                 | Authenticated                    |
| `/api/v1/minutes`             | Meeting Minutes                                       | Authenticated                    |
| `/api/v1/documents`           | Documents                                             | Authenticated                    |
| `/api/v1/pipelines`           | Prospective Members                                   | `prospective_members.manage`     |
| `/api/v1/prospective-members` | Prospective Members (pipelines, prospects, documents) | `prospective_members.manage`     |
| `/api/v1/audit-logs`          | Audit Logs (admin read API)                           | `audit.view`                     |
| `/api/v1/reports`             | Reports                                               | `reports.view`                   |

### Public Endpoints (No Auth Required)

| Prefix                                                           | Description                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/public/v1/forms/{slug}`                                    | Public form access                                                                                                                                                             |
| `/api/public/v1/forms/{slug}/submit`                             | Public form submission (rate-limited)                                                                                                                                          |
| `/api/public/portal/*`                                           | Public portal endpoints (`X-API-Key` required). IP rate limit runs before bcrypt; keys use a selective 16-char lookup prefix (`logbook_`+8), legacy keys self-heal on next use |
| `/api/public/v1/display/{code}`                                  | Room display (kiosk) — current events in that room                                                                                                                             |
| `/api/public/v1/display/{code}/events/{event_id}/guest`          | Guest sign-in page detail _(2026-08-09)_                                                                                                                                       |
| `/api/public/v1/display/{code}/events/{event_id}/guest-check-in` | Guest (non-member) attendance write _(2026-08-09)_                                                                                                                             |
| `/health`                                                        | Health check                                                                                                                                                                   |
| `/health/db`                                                     | Database health                                                                                                                                                                |
| `/health/redis`                                                  | Redis health                                                                                                                                                                   |

### Security & Monitoring

| Prefix                                        | Description                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/api/v1/security/status`                     | Security dashboard                                                                                   |
| `/api/v1/security/alerts`                     | Security alerts (org-scoped — caller sees/acks/resolves only their own org's alerts)                 |
| `/api/v1/security/audit-log/integrity`        | Audit log verification                                                                               |
| `/api/v1/security/audit-log/export`           | Audit log export (org-scoped; redacts `session_id` to a fingerprint)                                 |
| `/api/v1/security/audit-log/rehash`           | Break-glass legacy-hash repair (gated by `AUDIT_ALLOW_CHAIN_REHASH`; fails closed on keyed mismatch) |
| `/api/v1/security/intrusion-detection/status` | IDS status                                                                                           |
| `/api/v1/ip-security/blocked-countries`       | List / add / remove country blocks (add/remove gated by `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT`)       |

---

## Notification Endpoints _(2026-03-23)_

```
GET    /api/v1/notifications/rules                       # List notification rules
POST   /api/v1/notifications/rules                       # Create notification rule
GET    /api/v1/notifications/rules/{id}                  # Get rule
PATCH  /api/v1/notifications/rules/{id}                  # Update rule
DELETE /api/v1/notifications/rules/{id}                  # Delete rule
POST   /api/v1/notifications/rules/{id}/toggle           # Toggle rule enabled/disabled
GET    /api/v1/notifications/logs                        # List notification logs
POST   /api/v1/notifications/logs/{id}/read              # Mark log as read
GET    /api/v1/notifications/my                          # User's in-app notifications
GET    /api/v1/notifications/my/unread-count             # User's unread count
POST   /api/v1/notifications/my/read-all                 # Bulk mark all as read
POST   /api/v1/notifications/my/{log_id}/read            # Mark own notification as read
GET    /api/v1/notifications/summary                     # Rule and send statistics
```

## Equipment Check Endpoints _(2026-03-19)_

```
POST   /api/v1/equipment-checks/templates                    # Create template
GET    /api/v1/equipment-checks/templates                    # List templates
GET    /api/v1/equipment-checks/templates/{id}               # Get template
PATCH  /api/v1/equipment-checks/templates/{id}               # Update template
DELETE /api/v1/equipment-checks/templates/{id}               # Delete template
POST   /api/v1/equipment-checks/templates/{id}/compartments  # Add compartment
PATCH  /api/v1/equipment-checks/compartments/{id}            # Update compartment
DELETE /api/v1/equipment-checks/compartments/{id}            # Delete compartment
POST   /api/v1/equipment-checks/compartments/{id}/items      # Add item
PATCH  /api/v1/equipment-checks/items/{id}                   # Update item
DELETE /api/v1/equipment-checks/items/{id}                   # Delete item
GET    /api/v1/equipment-checks/shifts/{shift_id}/checklists # Applicable checklists for shift
POST   /api/v1/equipment-checks/shifts/{shift_id}/checks     # Submit equipment check
GET    /api/v1/equipment-checks/my-checklists                # Member's pending/recent checks
POST   /api/v1/equipment-checks/checks/{id}/items/{item_id}/photos  # Upload check photos
GET    /api/v1/equipment-checks/reports/compliance           # Compliance dashboard
GET    /api/v1/equipment-checks/reports/failures             # Failure/deficiency log
GET    /api/v1/equipment-checks/reports/trends               # Item trend history
GET    /api/v1/equipment-checks/reports/export               # CSV/PDF export
```

### Supply & Deployed Lots _(2026-08-10)_

The bridge between Inventory and the Equipment Check system. **Reads** accept
`equipment_check.view` or `inventory.view`; **writes** accept
`equipment_check.submit` — the default member position — as well as
`equipment_check.manage` / `inventory.manage`. Recording what you just used is
crew work; gating it behind a manage permission is what leaves the gap for the
next morning's check to find.

```
GET    /api/v1/equipment-checks/supply/expiring-items                        # ?days_ahead=30 (1-365)
GET    /api/v1/equipment-checks/supply/item-deployments/{inventory_item_id}  # Reverse lookup
GET    /api/v1/equipment-checks/apparatus/{apparatus_id}/inventory           # Standing view of one truck

POST   /api/v1/equipment-checks/items/{item_id}/used                # Report used/pulled  → restock report
DELETE /api/v1/equipment-checks/items/{item_id}/used                # Withdraw the report
PUT    /api/v1/equipment-checks/items/{item_id}/quantity            # Recount the position
POST   /api/v1/equipment-checks/items/{item_id}/swap                # Move a ready lot onto the truck

GET    /api/v1/equipment-checks/items/{item_id}/deployed-lots           # Lots aboard, soonest first
PUT    /api/v1/equipment-checks/items/{item_id}/deployed-lots/{lot_id}  # Correct count + number + date

GET    /api/v1/equipment-checks/templates/{id}/inventory-matches    # Propose catalog links (read-only)
POST   /api/v1/equipment-checks/templates/{id}/inventory-links      # Apply a reviewed set of links
```

| Behaviour               | Detail                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Derived values**      | A position's count is the **sum** of its deployed lots; its expiration is the **earliest**. Neither is read from `check_template_items` any more                            |
| **Consumption order**   | First-expiring-first-out. Undated lots sort last                                                                                                                            |
| **Expiry**              | Recomputed **server-side** from the soonest date aboard. A client-supplied `is_expired` is ignored — that flag is what force-fails a safety-critical item                   |
| **Expired shelf stock** | Excluded from `ready_stock`, flagged in the payload, and **`POST .../swap` refuses it** with a 400                                                                          |
| **Partial updates**     | `PUT .../deployed-lots/{lot_id}` uses `exclude_unset`: an omitted field is left alone, an explicit `null` clears, and `quantity: 0` removes the lot                         |
| **Match confidence**    | `inventory-matches` returns `exact` / `strong` / `weak`. Only `exact` is pre-selected client-side — "Oxygen Mask" scores high against both the adult and the pediatric mask |
| **404 vs 400**          | An unknown template/item/lot is a 404; a business-rule refusal (expired lot, over-draw, cross-org FK) is a 400 via `safe_error_detail()`                                    |

### Inventory bulk write paths _(2026-08-10)_

```
POST   /api/v1/inventory/items/bulk    # inventory.manage — existing names skipped and reported
POST   /api/v1/inventory/lots/bulk     # inventory.manage — receive a delivery, all lines or none
```

`items/bulk` returns `{created, skipped[], item_ids[]}`. `lots/bulk` returns the
created lots. **Both are all-or-nothing on validation failure**: a partly applied
delivery is worse than a rejected one, because the caller cannot tell which lines
landed and re-entering it would double-count whatever did.

### Email footer library _(2026-08-10)_

```
GET    /api/v1/email-templates/footers   # settings.manage OR organization.update_settings
PUT    /api/v1/email-templates/footers   # Replaces the library whole
```

`GET` seeds the library on first read and returns a live per-footer **usage
count**, so the screen can say "3 templates use this" before one is deleted. A
template's `footer_key` of NULL counts toward the library's `default_key`. `PUT`
replaces the library **whole** — a per-footer save could leave `default_key`
naming a footer the same request deleted.

## Shift Completion Reports _(2026-03-28)_

```
POST   /api/v1/training/shift-reports                                  # Create shift completion report
GET    /api/v1/training/shift-reports/my-reports                       # Trainee's approved reports
GET    /api/v1/training/shift-reports/my-stats                         # Trainee's aggregate statistics
GET    /api/v1/training/shift-reports/officer-analytics                # Org-wide officer analytics
GET    /api/v1/training/shift-reports/by-officer                       # Reports filed by current officer
GET    /api/v1/training/shift-reports/pending-review                   # Reports awaiting review
GET    /api/v1/training/shift-reports/drafts                           # Auto-created drafts from finalization
GET    /api/v1/training/shift-reports/all                              # All org reports (filtered, paginated)
GET    /api/v1/training/shift-reports/trainee/{trainee_id}             # Reports for specific trainee
GET    /api/v1/training/shift-reports/trainee/{trainee_id}/stats       # Stats for specific trainee
GET    /api/v1/training/shift-reports/shift-preview/{shift_id}/{trainee_id}  # Auto-populate preview
GET    /api/v1/training/shift-reports/{report_id}                      # Get specific report
PUT    /api/v1/training/shift-reports/{report_id}                      # Update draft report
POST   /api/v1/training/shift-reports/{report_id}/acknowledge          # Trainee acknowledges report
POST   /api/v1/training/shift-reports/{report_id}/review               # Officer reviews (approve/flag/redact)
```

## Shift Finalization _(2026-03-28)_

```
POST   /api/v1/scheduling/shifts/{id}/finalize                         # Finalize shift (snapshot data, create draft reports)
```

## Shift Calls / Runs _(2026-06-09)_

Log the calls/runs a crew responded to during a shift. Read: `scheduling.view`;
write: `scheduling.manage`. Hidden once a shift is finalized.

```
GET    /api/v1/scheduling/shifts/{shift_id}/calls                       # List calls for a shift
POST   /api/v1/scheduling/shifts/{shift_id}/calls                       # Log a call (incident_type required)
GET    /api/v1/scheduling/calls/{call_id}                               # Get a call
PATCH  /api/v1/scheduling/calls/{call_id}                               # Update a call
DELETE /api/v1/scheduling/calls/{call_id}                               # Delete a call
```

> Open-shift results _(2026-06-09)_: `GET /api/v1/scheduling/open-shifts` now returns shifts by **actual staffing** (unfilled required position, or active `ASSIGNED`/`CONFIRMED` count below `min_staffing`), capped at 500 candidates in the window, excluding shifts the caller already holds — fixing fully-staffed shifts pushing open ones off a fixed page.

## Inventory — Allowances, Size Preferences & Fulfillment _(2026-06-09)_

```
GET    /api/v1/inventory/allowances/check/{user_id}/{category_id}       # Remaining issue allowance { max_quantity, issued_this_period, remaining, period_type }
POST   /api/v1/inventory/allowances                                     # Create allowance (audit: issuance_allowance_created)
PUT    /api/v1/inventory/allowances/{allowance_id}                      # Update allowance
DELETE /api/v1/inventory/allowances/{allowance_id}                      # Delete allowance
GET    /api/v1/inventory/my/size-preferences                           # Current user's sizes (404 if unset)
PUT    /api/v1/inventory/my/size-preferences                           # Upsert own sizes
GET    /api/v1/inventory/label-preset                                  # (inventory) Label printer preset { preset, custom_width, custom_height, position_id, module }
PUT    /api/v1/inventory/label-preset                                  # (inventory) Save label preset { preset, custom_width?, custom_height? }
GET    /api/v1/label-preset/{module}                                   # Generic: label preset for the user's position in {module}
PUT    /api/v1/label-preset/{module}                                   # Generic: save label preset for {module}
POST   /api/v1/labels/preview                                          # { module, ids } → { items: [{ name, barcode_value, subtitle }] } (read-only)
POST   /api/v1/labels/generate                                         # { module, ids, label_format, ... } → label PDF. Modules: inventory, apparatus, prospective_members, facilities, membership
GET    /api/v1/inventory/members/{user_id}/size-preferences            # Member sizes (inventory.view)
PUT    /api/v1/inventory/members/{user_id}/size-preferences            # Upsert member sizes (inventory.manage)
PUT    /api/v1/inventory/requests/{request_id}/fulfill                  # Fulfill approved request → issuance/checkout/assignment
GET    /api/v1/inventory/items/{item_id}/issuances?skip=&limit=        # Paginated issuances (default 50, max 200)
DELETE /api/v1/inventory/categories/{category_id}                      # Soft-delete category (blocked if active items)
DELETE /api/v1/inventory/variant-groups/{group_id}                     # Soft-delete variant group
DELETE /api/v1/inventory/kits/{kit_id}                                 # Soft-delete equipment kit
```

> Issuing a pool item enforces the per-category allowance unless `override_allowance=true`. Member-specific inventory endpoints (`/inventory/my/`, `/inventory/members/`, `/inventory/charges`, `/inventory/checkout/`, `/inventory/users/`, `/inventory/members-summary`) are excluded from client caching (PII).

## Inventory — Impact Planner _(2026-06-23)_

All endpoints require `inventory.manage`.

```
GET    /api/v1/inventory/impact-planner/options                        # Filter options (ranks, stations, positions, statuses, membership types, categories, size fields)
POST   /api/v1/inventory/impact-planner                                # Analyze a filter set → matched members, per-size breakdown, counts (contact gated by org settings)
POST   /api/v1/inventory/impact-planner/reorder                        # Create one pending, pre-priced reorder request per shortfall size
POST   /api/v1/inventory/impact-planner/issue                          # Bulk-issue matching on-hand pool stock to members who need it (audit + WS event)
POST   /api/v1/inventory/impact-planner/request-sizes                  # In-app notification to members missing a size on file
POST   /api/v1/inventory/impact-planner/pdf                            # Print-ready PDF summary (application/pdf)
GET    /api/v1/inventory/impact-planner/plans                          # List saved plans
POST   /api/v1/inventory/impact-planner/plans                          # Save a named plan (filter set)
PATCH  /api/v1/inventory/impact-planner/plans/{plan_id}                # Update a saved plan
DELETE /api/v1/inventory/impact-planner/plans/{plan_id}                # Delete a saved plan
```

> The analyze body (statuses, membership types, ranks, stations, position ids, related/stock category, size field, `replacement_aware`, `allowance_aware`) is reused by reorder/issue/pdf and stored verbatim by saved plans. On-hand netting, cost, replacement, and allowance layers only run when their inputs are supplied.

## Election Results & Verification _(2026-03-29)_

```
POST   /api/v1/elections/{id}/send-report                              # Email election results to voters
GET    /api/v1/elections/{id}/verify-receipt                            # Public vote receipt verification (rate-limited)
```

## Election Pre-Meeting Package _(2026-07-28)_

All require `elections.manage`; draft/open elections only.

```
GET    /api/v1/elections/{id}/package-recipients?mode=                  # Prefill list (leadership | eligible_voters)
GET    /api/v1/elections/{id}/package-pdf?variant=                      # Download package PDF (member | full)
POST   /api/v1/elections/{id}/send-package                              # Email package to an edited address list (BCC + PDF attachment)
```

## Election Nominations, Paper Ballots & Meeting-Night Workflows _(2026-07-29)_

Optional workflows are gated by per-org feature toggles in
`org.settings.election_features` (enforced server-side). All require
`elections.manage` unless noted. See [Module-Elections](Module-Elections) for
the full endpoint table and workflow details.

```
# Nomination phase
POST   /api/v1/elections/{id}/open-nominations                          # Draft -> nomination phase
POST   /api/v1/elections/{id}/close-nominations                         # Nomination phase -> draft
POST   /api/v1/elections/{id}/nominations                               # Nominate a member or yourself (any member)
POST   /api/v1/elections/{id}/nominations/{cid}/accept                  # Nominee accepts (nominee only)
POST   /api/v1/elections/{id}/nominations/{cid}/decline                 # Nominee declines (entry removed)

# Paper ballots + officer attestation
GET    /api/v1/elections/{id}/printable-ballot                          # Official blank paper ballot PDF
POST   /api/v1/elections/{id}/manual-ballots                            # Record in-room tally (plausibility-guarded; allow_over_count override audited)
GET    /api/v1/elections/{id}/manual-ballots                            # List paper batches with attestation trail
POST   /api/v1/elections/{id}/manual-ballots/{batch}/attest             # Attest a batch's count (not the recorder; once per officer)
POST   /api/v1/elections/{id}/manual-ballots/{batch}/void               # Void a mis-keyed batch (reason required)

# Reminders & lifecycle
GET    /api/v1/elections/{id}/non-voters                                # Eligible voters who haven't voted
POST   /api/v1/elections/{id}/remind-non-voters                         # Reminder ballot email (fresh link; 1h cooldown)

# Meeting-night tooling
POST   /api/v1/elections/{id}/clone                                     # Fresh draft from this election's setup (new salt; votes/tokens never copied)
POST   /api/v1/elections/{id}/write-ins/merge                           # Consolidate write-in variants (audited alias; vote rows untouched)
GET    /api/v1/elections/{id}/certified-results                         # Certified results package PDF (closed elections only)

# Public token-ballot endpoints (no auth, rate-limited; token travels in the
# POST body — never a query string or path)
POST   /api/v1/elections/ballot/lookup                                  # Load ballot + candidates in one call (eligibility-filtered minimal view)
POST   /api/v1/elections/ballot/vote                                    # Cast one vote (method-aware)
POST   /api/v1/elections/ballot/vote/bulk                               # Submit full ballot atomically (choice | candidate_ids | rankings per item)
```

## Saved Ballot Templates _(2026-08-12)_

Org-scoped, reusable ballot **configuration** snapshots (never candidates,
voters, votes, tokens, or attendance — the create schema forbids extra
fields). All require `elections.manage`.

```
GET    /api/v1/elections/templates/saved-ballots                        # List the org's saved templates
POST   /api/v1/elections/templates/saved-ballots                        # Save a named template (201; 409 on case-insensitive duplicate name)
DELETE /api/v1/elections/templates/saved-ballots/{template_id}          # Delete (204; 404 if not in the caller's org)
```

## Department Messages _(updated 2026-07-17)_

Admin endpoints require `notifications.manage`. Inbox/read/acknowledge endpoints
are available to any authenticated member (scoped to messages targeted to them).

```
# Admin (notifications.manage)
GET    /api/v1/messages                                  # List messages (supports include_inactive, search, priority, pagination)
POST   /api/v1/messages                                  # Create message (supports scheduled_at for deferred publish)
GET    /api/v1/messages/roles                            # Roles available for targeting (id, name, slug)
GET    /api/v1/messages/{id}                             # Get message
PATCH  /api/v1/messages/{id}                             # Update message (edit / reschedule)
DELETE /api/v1/messages/{id}                             # Soft-delete message (read/ack records preserved)
GET    /api/v1/messages/{id}/stats                       # Read/ack counts with audience denominator
GET    /api/v1/messages/{id}/acknowledgments             # Per-recipient read/ack breakdown

# Member (authenticated)
GET    /api/v1/messages/inbox                            # Messages targeted to the current user
GET    /api/v1/messages/inbox/unread-count               # Current user's unread/pending count
POST   /api/v1/messages/{id}/read                        # Mark message as read
POST   /api/v1/messages/{id}/acknowledge                 # Acknowledge (for ack-required messages)
```

Posting a message fans it out across in-app / email / SMS channels by priority
(see the [Training guide](../docs/training/07-documents-forms.md#department-messages)).

---

## Audit Logs (Admin) _(updated 2026-07-30)_

Read-only admin API for browsing the audit trail. Permission: `audit.view`.
Results are org-scoped on the `audit_logs.organization_id` column (stamped at
write time and covered by hash-chain v3; previously derived by joining through
the mutable users table). Platform-level rows with a NULL organization are
never returned to org admins.

```
GET    /api/v1/audit-logs                                # List (filters below; skip/limit)
GET    /api/v1/audit-logs/stats                          # Summary counts (by severity, by category)
GET    /api/v1/audit-logs/{log_id}                       # Get a single audit entry
```

Filters on the list endpoint: `event_type`, `event_category`,
`severity` (`info` \| `warning` \| `critical`), `user_id`, `search` (username or
event-type substring), `start_date`, `end_date`, `skip` (≥0), `limit` (1–500).

## OAuth Sign-In _(2026-05-29)_

```
GET    /api/v1/auth/oauth-config                         # Enabled OAuth providers (for the login page)
GET    /api/v1/auth/oauth/google                         # Initiate Google sign-in (404 if not configured)
GET    /api/v1/auth/oauth/google/callback                # Google OAuth callback
GET    /api/v1/auth/oauth/microsoft                      # Initiate Microsoft sign-in (404 if not configured)
GET    /api/v1/auth/oauth/microsoft/callback             # Microsoft OAuth callback
```

See [Authentication > OAuth](Security-Authentication#oauth) for the
link-existing-only policy, domain restriction, and callback error codes.

*(2026-08-12)* When the matched account has TOTP MFA enabled, the callback no
longer issues session cookies: it 302-redirects to the SPA with a short-lived
`mfa_pending` token in the **URL fragment** (`/auth/callback#mfa_token=…`),
and the client completes the second factor through the normal
`POST /api/v1/auth/mfa/login` before any session exists. Audit event:
`oauth_mfa_challenge`.

## Prospective Member Documents _(2026-05-29)_

```
GET    /api/v1/prospective-members/prospects/{id}/documents                       # List documents
POST   /api/v1/prospective-members/prospects/{id}/documents                       # Upload document (multipart, ≤50MB, magic-byte MIME)
GET    /api/v1/prospective-members/prospects/{id}/documents/{document_id}/download # Download a stored document
```

---

## Training Programs _(2026-07-14)_

Endpoints live under `/api/v1/training/programs` (note the doubled `programs`
segment on program-scoped routes: prefix `/training/programs` + path
`/programs/...`).

```
POST   /api/v1/training/programs/programs/build                        # Atomically create a program + phases + requirements + milestones (training.manage)
GET    /api/v1/training/programs/programs/{program_id}/enrollments      # List a program's enrollments with member names (training.view_all OR training.manage)
POST   /api/v1/training/programs/enrollments/{enrollment_id}/advance-phase?force=<bool>  # Manually advance to the next phase (training.manage); requires the current phase complete unless force=true
PATCH  /api/v1/training/programs/progress/{progress_id}                 # Update requirement progress (training.manage)
PATCH  /api/v1/training/programs/programs/{program_id}/requirements/{program_requirement_id}  # Toggle a requirement's is_required / is_prerequisite / sort_order (training.manage)
GET    /api/v1/training/programs/sample-templates                      # List built-in sample program templates (training.manage)
POST   /api/v1/training/programs/sample-templates/{key}/instantiate    # Add a sample template to the org (training.manage)
GET    /api/v1/training/programs/programs/{program_id}/eligibility     # Per-member enroll eligibility, eligible first (training.manage)
PATCH  /api/v1/training/programs/programs/{program_id}                 # Edit program details (training.manage)
DELETE /api/v1/training/programs/programs/{program_id}                 # Delete a program + all children (training.manage)
PATCH  /api/v1/training/programs/programs/{program_id}/phases/{phase_id}          # Edit a phase (training.manage)
POST   /api/v1/training/programs/programs/{program_id}/phases/reorder            # Renumber phases (training.manage)
DELETE /api/v1/training/programs/programs/{program_id}/phases/{phase_id}          # Delete a phase, auto-clean enrollees (training.manage)
POST   /api/v1/training/programs/programs/{program_id}/requirements/reorder       # Set requirement sort order (training.manage)
DELETE /api/v1/training/programs/programs/{program_id}/requirements/{prog_req_id} # Remove a requirement, auto-clean (training.manage)
PATCH  /api/v1/training/programs/programs/{program_id}/milestones/{milestone_id}  # Edit a milestone (training.manage)
DELETE /api/v1/training/programs/programs/{program_id}/milestones/{milestone_id}  # Delete a milestone (training.manage)
```

- **`PATCH .../progress/{progress_id}`** — `RequirementProgressUpdate` now also
  accepts `test_score` (0–100) for officer-entered knowledge/skills scoring.
  Pass/fail is derived from the requirement's `passing_score`, and `max_attempts`
  is enforced.
- **`PATCH .../requirements/{program_requirement_id}`** — flipping `is_required`
  recomputes affected members' progress and re-checks phase advancement.
- **`.../sample-templates`** — three curated starting points (Firefighter recruit
  school, EMT recruit school, new-member orientation). `instantiate` replays the
  atomic build into the org as an editable template; optional body
  `{ "name": "…", "is_template": true }`.
- **`.../{program_id}/eligibility`** — returns every member with `eligible`, a
  `status` (`eligible` / `enrolled` / `prerequisite` / `concurrent`), and a `reason`.
  Hard gates (already enrolled, missing prerequisite) set `eligible: false`.
  **`concurrent`** (active in another program) is a soft advisory: `eligible: true`
  with a `reason` — never a block. Target position/roles are not gated.
- **Registry pick-and-choose import.** `GET …/requirements/registries/{name}/preview`
  lists a registry's requirements (each flagged `already_imported`, with its topic-area
  `sections`) for a selection UI; `POST …/requirements/import/{name}` accepts a body
  `{ registry_codes: [...], skip_existing }` to import only those codes (omit the body
  to import the whole registry). Importing a requirement that distributes hours across
  sections auto-creates a training category per section and links the requirement to
  them; the result's `categories_created` reports how many were made.
- **Editing endpoints** back the inline pipeline editor. `PATCH …requirements/{id}`
  also accepts `phase_id` to move a requirement between phases. `DELETE` on a phase or
  requirement is auto-cleaning: it clears only this program's enrolled members'
  progress for the affected items and re-anchors/recomputes them (see the changelog
  entry). Reorder endpoints take an ordered id list and renumber in one transaction.
- **Program create/response** now include `code` and `version`; each program
  phase includes `requires_manual_advancement`.
- **Phase prerequisites.** `prerequisite_phase_ids` on a phase create/update names
  phases in the same program that must be _finished_ before it opens (distinct from
  `phase_number`, which is only the order). Rejected with a 400 when an id belongs to
  another program, a phase lists itself, or the result would form a cycle. Both
  `advance-phase` and automatic advancement honor them; `force=true` overrides.
- **Requirement prerequisites.** A program↔requirement link with
  `is_prerequisite: true` gates the other requirements in its scope (its phase, or
  the program-level pool). `PATCH /progress/{progress_id}` refuses a gated
  requirement, and `GET /enrollments/{enrollment_id}` returns
  `locked_requirements: { requirement_id: [blocking requirement names] }` so the UI
  can grey the step out with the reason.
- **Deadline reminders.** `reminder_conditions` is now accepted on program
  create/update: `days_before_deadline` (int or list of ints) and
  `send_if_below_percentage` (0–100). Unset falls back to `warning_days_before`
  plus 14- and 7-day follow-ups; the weekly `enrollment_deadline_warnings` sweep
  reads it per program instead of a fixed `[30, 14, 7]`.
  `milestone_threshold` is accepted and **ignored** — `ProgramMilestone` rows
  already fire progress-based notifications, and two mechanisms for one job is
  how the two drift apart.

### Checklist Requirements — Per-Step Sign-Off _(2026-08-09)_

A `checklist` requirement's steps are stored on `checklist_items`, which now
holds objects rather than bare strings:

```json
{ "id": "…", "text": "Tour the apparatus bay", "member_visible": true }
```

- **Both shapes are accepted on input.** A bare string, an object, or a mix
  normalizes to the object form (`app/utils/checklist.py`); the `id` is assigned
  server-side when a step is created. Editors send existing ids back so a step
  keeps its identity — and the ticks recorded against it — through a rename or a
  reorder. **Legacy string rows normalize on read**, not through a migration.
- **`PATCH /progress/{progress_id}`** accepts `checklist_done: [step_id, …]` —
  the steps ticked so far. Completion is `ticked / total`, so the requirement
  fills up as the work happens instead of being all-or-nothing.
- **`member_visible: false`** keeps a step off the member's view (references
  called, background check returned). **Hidden steps still count toward the
  denominator** — excluding them would let a requirement read 100% while the
  background check was outstanding — so the member is told "+N more steps your
  officer records" rather than shown a total that does not match their screen.

### Enrollment Expiry and Reopen _(2026-08-09)_

```
POST   /api/v1/training/programs/enrollments/{enrollment_id}/reopen    # Put an expired enrollment back to active (training.manage)
```

Optional body: `{ "target_completion_date": "…" }` — an officer granting an
extension to a member who ran out of time.

- **Enrollments past `target_completion_date` now become `EXPIRED`.** The status
  was read (recert treats it as a renewable state) but never written, so a member
  stayed `ACTIVE` indefinitely with their page reading "42 days overdue" against a
  status claiming otherwise.
- Expiry happens **on read** — the progress endpoint transitions an overdue
  enrollment the moment someone opens it, the same pattern `auto_reset_if_due`
  already used — and in a **daily** `enrollment_expiry` scheduled task (05:15).
  The weekly `enrollment_deadline_warnings` sweep no longer expires anything; it
  sends warnings.
- **Reopen leaves progress rows untouched** — the member keeps everything they
  finished — and re-runs the rollup, so someone who quietly completed the work
  while expired is marked complete rather than waiting for the next edit.
- Returns `404` when the enrollment is not in the caller's organization, `400`
  when it is not in a state that can be reopened.

### Soft Phase Gate on Attendance _(2026-07-14)_

```
POST   /api/v1/events/{event_id}/rsvp?override=<bool>                   # RSVP to an event
POST   /api/v1/events/{event_id}/self-check-in?override=<bool>          # Self check-in to an event
```

When the member is enrolled in a program and the session's phase is **ahead of**
their current phase, these endpoints return HTTP **409**:

```json
{ "detail": { "warning_type": "phase_gate", "message": "..." } }
```

Pass `override=true` to proceed anyway.

## Guest Check-In — Non-Member Attendance _(2026-08-09)_

Unauthenticated endpoints reached by scanning the **guest** QR code on a room
display. They only work when the event has `allow_guest_check_in` set **and** is
held in the room the display code belongs to.

```
GET    /api/public/v1/display/{display_code}/events/{event_id}/guest            # Event detail for the sign-in page
POST   /api/public/v1/display/{display_code}/events/{event_id}/guest-check-in   # Record a guest's attendance (201)
```

**Why the display code is in the path.** The department is resolved from the
room's display code, **never from the request body** — an anonymous caller must
not be able to name the organization it is writing to. The event is then checked
to be held in that room, so a valid display code cannot be used to sign people in
to an event somewhere else.

**Request** (`GuestCheckInRequest`):

| Field               | Type   | Required | Notes                                                                |
| ------------------- | ------ | -------- | -------------------------------------------------------------------- |
| `first_name`        | string | yes      | 1–100 chars, must contain a non-whitespace character (`\S`), trimmed |
| `last_name`         | string | yes      | Same                                                                 |
| `email`             | email  | no       | Required for a prospect to be created                                |
| `phone`             | string | no       | ≤ 50 chars                                                           |
| `organization_name` | string | no       | ≤ 255 chars — the company/agency the guest is with                   |
| `interest_reason`   | string | no       | ≤ 2000 chars, stored on the attendance row as `notes`                |
| `hp_website`        | string | no       | **Honeypot.** Hidden in the real form; only a bot fills it in        |

**Response** (`GuestCheckInResponse`): `status` (`checked_in` | `already_checked_in`),
`attendee_id`, `event_name`, `checked_in_at`, `prospect_created`, `message`.

**GET response** (`GuestCheckInEventInfo`) exposes only what a visitor standing in
the room can already see — name, type, start/end, room, department name,
`is_open` + `closed_reason`, `collects_prospect_details`, and the department
`timezone` so an unauthenticated tablet renders local times rather than UTC. The
event **description is withheld**, matching the kiosk display.

**Defences and their status codes:**

| Condition                                        | Result                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Per-IP rate limit exceeded                       | `429`                                                                |
| Per-event daily cap exceeded                     | `429` — `GUEST_CHECK_IN_DAILY_LIMIT`, default `300`, `0` disables it |
| Honeypot field populated                         | **`201` with a plausible success body**, nothing written             |
| Outside the check-in window                      | `400` with the reason (not opened yet / has closed)                  |
| Event not in that room, or guest check-in is off | `404`                                                                |

> **Guests do not get the member early-arrival grace.** A member may check in
> before a FLEXIBLE window opens because a member checking in early is
> identifiable and correctable; an anonymous early write is neither. Guests are
> held to the window the organizer actually configured.

> **The honeypot answers with success, not an error.** A bot that receives a
> rejection learns which field to stop filling; one that receives a plausible
> confirmation has no signal to adapt to. This matches the public forms endpoint.

**Side effects.** Always writes an `event_external_attendees` row with
`source = 'kiosk_qr'`. When the event also has `guest_check_in_creates_prospect`
and the guest supplied an email, it opens (or reuses) a `prospective_members`
record, links it to the event through `prospect_event_links`, and stores the
prospect id on the attendance row. **A pipeline failure is logged and swallowed**
— it never costs a guest their attendance.

**Duplicate handling.** A repeat sign-in matches on email where one was given and
on name where it was not, and returns `already_checked_in` rather than creating a
second row. Name matching is the weaker fallback: two different Chris Smiths at
one open house collapse into a single row. A guest pre-registered by staff keeps
the details staff entered; the kiosk sign-in only fills blanks.

## Skills Testing — Pipeline Requirement Link _(2026-07-14)_

Skills templates and tests can point at the training-pipeline requirement they
satisfy via a nullable `requirement_id`. Endpoints are under
`/api/v1/training/skills-testing`.

```
POST   /api/v1/training/skills-testing/templates                       # Create template (accepts/validates requirement_id — must be a real requirement in the org)
PUT    /api/v1/training/skills-testing/templates/{id}                   # Update template (accepts/validates requirement_id)
POST   /api/v1/training/skills-testing/tests                           # Create test (requirement_id from body, else inherited from the template)
POST   /api/v1/training/skills-testing/tests/{id}/complete             # Complete test; a PASS on a non-practice test with a requirement_id marks it COMPLETE on the candidate's active enrollment(s)
```

- Template list/detail responses and test responses now include
  `requirement_id`.
- On completion, a **pass** routes through the training-program progress updater
  (percentage, completion, rollup, and phase-advancement all run). A **fail**,
  a **practice** test, or a test with no `requirement_id` does nothing to the
  pipeline.

> **Superseded in part on 2026-08-08.** The pipeline credit no longer lands at
> completion for a member-run test — it lands at **validation**. See the next
> section.

---

## Skills Testing — Member Examining & Officer Validation _(2026-08-08)_

Skills testing was gated on `training.manage` end to end. **Examining is now
open to every member**; the officer's authority moved to a second step,
**validating** the result against the candidate's account.

```
GET    /api/v1/training/skills-testing/candidates?q=<fragment>   # Name lookup for the start-test picker (training.view | training.manage)
POST   /api/v1/training/skills-testing/tests                     # Start a test — official is now AUTH-ONLY
POST   /api/v1/training/skills-testing/tests/{id}/complete       # Score — AUTH-ONLY. An officer's completion validates in the same step
POST   /api/v1/training/skills-testing/tests/{id}/validate       # Accept the result against the candidate's record (training.manage). Idempotent
POST   /api/v1/training/skills-testing/tests/{id}/void           # The rejection path — keeps the record and the reason (training.manage)
GET    /api/v1/training/skills-testing/tests?pending_validation=true   # Officer review queue
GET    /api/v1/training/skills-testing/summary                   # Now carries `pending_validation`
```

**Until `validated_at` is set, an official test is a submission, not a
record.** It credits no pipeline requirement, spends no attempt against
`max_attempts`, and is excluded from the summary's pass rate and average score.
The candidate sees it listed as _awaiting validation_ with the outcome withheld.

| Gate change                                                                 | Before                | After                         |
| --------------------------------------------------------------------------- | --------------------- | ----------------------------- |
| `POST /tests` (official), `PUT`, `/complete`, `/cancel`                     | `training.manage`     | Authenticated                 |
| `/validate` _(new)_, `/void`, `/release`, `/viewers*`, `DELETE /tests/{id}` | — / `training.manage` | `training.manage`             |
| `/templates` writes                                                         | `training.manage`     | `training.manage` (unchanged) |

**Separation of duties (CS-8)** holds at both ends: a member cannot examine
themselves on an official test, and an **officer cannot validate a test they
are the candidate in** — that would launder a peer-run self-pass. Both are
`400`.

**`GET /candidates` is a lookup, not a listing.** It exists because examining is
open to every member while `GET /users` needs `users.view`, which the baseline
member position does not carry. It returns `[{ id, name }]` only.

| Guard            | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `q`              | **Required**, min 2 characters — no request returns the roster                          |
| Whitespace-only  | `422`, refused before the query runs                                                    |
| `LIKE` wildcards | `\`, `%`, `_` escaped — a bare `%` would match every row                                |
| Result cap       | **15**, truncated silently                                                              |
| Scope            | Caller's org, `status = ACTIVE`, `deleted_at IS NULL`; matched on the full display name |

**New response fields:** `SkillTestResponse` gains `validated_at`,
`validated_by`, `validated_by_name` and the derived `pending_validation`;
`SkillTestListResponse` gains `validated_at` and `pending_validation`;
`SkillTestingSummaryResponse` gains a `pending_validation` count (`0` for
readers who cannot validate).

**Schema:** `skill_tests.validated_at` (`DATETIME`, nullable),
`skill_tests.validated_by` (`VARCHAR(36)` → `users.id` `ON DELETE SET NULL`),
index `idx_skill_test_org_validation` (`organization_id`, `is_practice`,
`validated_at`). Migration `20260808_0001`; existing completed official results
are backfilled as validated by their examiner.

---

## Prospective Members — Kanban Response Model & Bulk Actions _(2026-08-08)_

Router prefix `/api/v1/membership-pipeline`.

```
GET    /api/v1/membership-pipeline/pipelines/{id}/kanban   # Now returns KanbanBoardResponse, not a bare dict
POST   /api/v1/membership-pipeline/prospects/bulk-advance  # members.manage | prospective_members.manage
POST   /api/v1/membership-pipeline/prospects/bulk-status   # members.manage | prospective_members.manage
POST   /api/v1/membership-pipeline/prospects/{id}/advance  # Now 409 when there is nowhere to advance to
```

**The kanban endpoint declared no response model**, so FastAPI serialized every
column of `ProspectiveMember` — putting `status_token` (the credential behind
the public application-status page), coordinator notes, date of birth and home
address into a board held by anyone with `prospective_members.view`. It now
returns `KanbanBoardResponse`, whose cards carry the **same projection as the
prospect list** via a shared mapper.

| `KanbanBoardResponse` field                            | Notes                                            |
| ------------------------------------------------------ | ------------------------------------------------ |
| `pipeline`                                             | `PipelineResponse`                               |
| `columns[].step`                                       | `PipelineStepResponse \| null`                   |
| `columns[].prospects[]`                                | `ProspectListResponse`                           |
| `columns[].count`                                      | True column size — can exceed the cards returned |
| `total_prospects` / `returned_prospects` / `truncated` | Board truncation state                           |

**Bulk actions** take `prospect_ids` (1–**200**) plus `notes` (advance) or
`status` + `reason` (status), and return `BulkActionResponse`:
`succeeded_count`, `failed_count`, and a `results[]` of
`{ prospect_id, name, succeeded, error }`. **One failure never aborts the
rest.** Bulk ids arrive in the body, where the router's path-parameter privacy
guard cannot see them, so both endpoints filter the caller's own prospect record
explicitly and report it as **"not found"**. A `bulk-status` `reason` is
recorded in the **activity log** and never written to the `notes` column.

**`POST /prospects/{id}/advance` now answers `409`** when the prospect is
already at the final stage or has no current stage, instead of `200` with an
untouched record and a fabricated `membership_pipeline.prospect_advanced` audit
entry.

**`referred_by` is validated against the caller's org** on prospect create and
update (`assert_in_org`, fails closed, generic message so the endpoint is not a
cross-tenant existence oracle). Conversion **drops** an out-of-org referrer
rather than copying it onto `User.referred_by_user_id`. Both endpoints now
translate `ValueError` into `400` rather than letting it surface as a `500`.

---

## Training — Multi-Class Courses & Cohorts _(2026-08-05)_

A course can carry an ordered **syllabus** of classes; a **cohort** is one
scheduled run of that course. Syllabus routes hang off the existing course
paths; cohort routes live under `/api/v1/training/cohorts`.

```
GET    /api/v1/training/courses/{course_id}/classes                     # List the syllabus, in order (authenticated)
POST   /api/v1/training/courses/{course_id}/classes                     # Add a class (training.manage)
PATCH  /api/v1/training/courses/{course_id}/classes/{class_id}          # Update one class (training.manage)
DELETE /api/v1/training/courses/{course_id}/classes/{class_id}          # Remove a class (training.manage)
POST   /api/v1/training/courses/{course_id}/classes/reorder             # Set the order — must list every class exactly once (training.manage)
POST   /api/v1/training/courses/{course_id}/classes/autofill            # Recompute every day_offset from a meeting pattern (training.manage)
POST   /api/v1/training/cohorts/preview                                 # Compute the dates a cohort would get — read-only (training.manage)
GET    /api/v1/training/cohorts                                         # List cohorts, filterable by course_id / status (training.manage)
GET    /api/v1/training/cohorts/mine                                    # Cohorts the caller is on the roster for (authenticated)
POST   /api/v1/training/cohorts                                         # Generate a cohort (training.manage)
GET    /api/v1/training/cohorts/{cohort_id}                             # Cohort with class timeline + roster (officer, or a roster member)
PATCH  /api/v1/training/cohorts/{cohort_id}                             # Update cohort details (training.manage)
POST   /api/v1/training/cohorts/{cohort_id}/regenerate                  # Create events for classes that have none (training.manage)
POST   /api/v1/training/cohorts/{cohort_id}/shift                       # Shift upcoming classes by N days (training.manage)
POST   /api/v1/training/cohorts/{cohort_id}/cancel                      # Cancel the cohort and its remaining classes (training.manage)
POST   /api/v1/training/cohorts/{cohort_id}/classes                     # Add an ad-hoc class (training.manage)
PATCH  /api/v1/training/cohorts/{cohort_id}/classes/{cohort_class_id}   # Reschedule one class (training.manage)
POST   /api/v1/training/cohorts/{cohort_id}/classes/{cohort_class_id}/cancel  # Cancel one class (training.manage)
POST   /api/v1/training/cohorts/{cohort_id}/members                     # Add roster members (training.manage)
DELETE /api/v1/training/cohorts/{cohort_id}/members/{user_id}           # Withdraw a member (training.manage)
```

- **`POST .../courses/{id}/classes`** — `class_course_id` is **required**: every
  class teaches a real catalog course, which is what supplies its credit hours,
  certification settings and categories. Title, credit hours and instructor
  default from that course when omitted. Timing is _relative_ — `day_offset`
  (days from the cohort start, 0-based) plus a local `start_time` (`"HH:MM"`)
  and `duration_minutes`. A course cannot list itself as one of its classes,
  and a syllabus is capped at 200.
- **`POST .../classes/reorder`** — changes `sequence` only, **not** `day_offset`.
  Ordering and timing are independent; re-space with `/autofill` or by editing
  offsets. The body must list every class in the course exactly once.
- **`POST .../classes/autofill`** — `{meeting_days: [1, 3], start_weekday: 0}`
  ("Tuesdays and Thursdays, course starts on a Monday") rewrites every class's
  `day_offset` in sequence order: 1, 3, 8, 10, … Times and durations are only
  overwritten when defaults are supplied.
- **`POST /cohorts/preview`** — the safety step. Read-only; creates nothing.
  Returns every class with its resolved UTC `scheduled_start`/`scheduled_end`
  plus per-class `warnings` (a date moved off a weekend or blackout day, an
  archived catalog course, a room already booked), and
  `suggested_blackout_dates` (US federal holidays inside the course span).
  Times are resolved as **local wall clock against the organization timezone**,
  so a course spanning a DST change keeps the same clock time throughout.
- **`POST /cohorts`** — the consequential call. In one transaction it creates
  one `Event` + one linked `TrainingSession` **per class**, optionally builds a
  matching pipeline (`generate_program`), enrolls `member_user_ids` in it, and
  RSVPs them to every class. `classes` carries the officer's edits from the
  preview (`scheduled_start`/`scheduled_end` overrides and `skip`). A class
  whose session fails (room conflict) does not fail the generation — the class
  is created without an event and the reason comes back in the response's
  warnings, to be repaired with `/regenerate`.
- **`POST /cohorts/{id}/regenerate`** — creates events only for classes whose
  `event_id` is NULL. Safe to run repeatedly: the
  `(cohort_id, course_class_id)` unique constraint means it can never duplicate
  a class, and it never moves an existing one.
- **`PATCH /cohorts/{id}/classes/{class_id}`** — moves the cohort class _and_
  its linked event; RSVPs are preserved. Rejected for a cancelled class.
- **`POST .../classes/{class_id}/cancel`** — **cancels** the event rather than
  deleting it, so members who RSVP'd see a cancellation instead of the class
  silently disappearing. The class stays on the cohort for the record.
- **`POST /cohorts/{id}/shift`** — moves only classes that have not started
  (or, with `from_sequence`, from that position onward). Cancelled classes never
  move, and classes that already ran keep their dates because attendance is
  anchored to them. `days` may be negative; zero is rejected.
- **`POST /cohorts/{id}/members`** — a member added mid-run is RSVP'd only to
  classes **still to come**; past classes are never backfilled. A member who
  fails the pipeline's eligibility rules is still added to the roster, with the
  reason returned in `warnings` rather than failing the request.
- **`DELETE /cohorts/{id}/members/{user_id}`** — soft withdrawal. The
  enrollment, training records, and any class already checked into are kept;
  RSVPs on classes still to come are removed so the course leaves their
  calendar.

---

## Member Dues — Payment Ledger _(2026-08-02)_

Each payment against a member's dues is its own row. The dues record's
`amountPaid` is the **sum of that ledger**, recomputed on every write, and
`paymentMethod` / `transactionReference` / `notes` / `paidDate` project the
newest payment. Write payments, not totals.

```
PUT    /api/v1/finance/dues/{dues_id}            # Record a payment (finance.manage)
GET    /api/v1/finance/dues/{dues_id}/payments   # Payment ledger, oldest first (finance.view)
POST   /api/v1/finance/dues/{dues_id}/waive      # Waive dues; reason required (finance.manage)
POST   /api/v1/finance/dues/{dues_id}/unwaive    # Reverse a waiver; reason required (finance.manage)
```

**Idempotency.** `PUT /finance/dues/{id}` is idempotent on
`transactionReference`: resubmitting a reference already recorded against those
dues returns the record unchanged rather than erroring, so a retried or
double-submitted payment cannot double-credit. Enforced by a uniqueness
constraint on `(member_dues_id, transaction_reference)`. Payments **without** a
reference are never deduplicated — two identical cash amounts are two payments.

**Waived dues reject payment.** `PUT` returns `400` when the record is `WAIVED`
or `EXEMPT`; those are not owing, and recording money against them would cancel
the waiver as a side effect. Use `/unwaive` first — it restores whatever the
ledger says (`PENDING` / `PARTIAL` / `PAID`) and writes a
`finance.dues_waiver_reversed` audit event carrying the erased waive reason.

## Privacy, Consent & Retention _(2026-07-31)_

Data-subject rights and records retention. See
[Privacy & Data Rights](Security-Privacy) for behavior and guarantees.

```
# Member self-service (authenticated; always scoped to the caller)
GET    /api/v1/users/me/data-export                      # Full personal-data export (JSON download; 3/hour)
GET    /api/v1/users/me/consents                         # Consent state per type (granted=null means never asked)
PUT    /api/v1/users/me/consents/{consent_type}?granted= # Record a consent choice (audited)

# Administrative (members.manage)
POST   /api/v1/users/{user_id}/anonymize                 # Irreversibly scrub a DEPARTED member's PII

# Records retention (settings.manage)
GET    /api/v1/organizations/retention-policy            # Effective schedule per record class
PUT    /api/v1/organizations/retention-policy/{class}?days=  # Set retention; omit days for keep-forever
```

Consent types: `photo_use`, `public_roster_listing`, `sms_notifications`.
Retention record classes: `message_history`, `notification_logs`,
`form_submissions` — each has a minimum floor, and `PUT` returns 400 below it.

`POST /anonymize` returns 400 for an active member, for an already-anonymized
member, or for your own account, and 404 for a member outside your
organization. Audit logs and election records are never modified.

---

## Public Legal Text _(2026-07-31)_

Unauthenticated, rate-limited (30/min per IP). Backs the public `/privacy` and
`/terms` pages.

```
GET    /api/public/v1/legal                              # { organizationName, privacyPolicy, termsOfService }
```

Returns the single organization's configured text
(`settings.legal.privacy_policy` / `legal.terms_of_service`); `null` values
mean the frontend renders its built-in defaults. On a multi-organization
install all fields are `null` — with no org context, no tenant's text is served.

---

## Vulnerability Disclosure _(2026-07-31)_

Served at the site root (not under `/api`), per RFC 9116.

```
GET    /.well-known/security.txt                         # Contact, policy, expiry (text/plain)
```

Configured with `SECURITY_TXT_CONTACT` and `SECURITY_TXT_POLICY_URL`. The
`Expires` field is regenerated per request so the file never goes stale.

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

### Validation Error (422)

```json
{
  "detail": [
    {
      "field": "start_date",
      "message": "This field is required."
    }
  ]
}
```

`detail` is always an **array**, never a string — code that renders errors has
to handle both this and the string form used by 4xx responses below.

`field` is a dotted path to the offending field (`address.zip`), or the
literal `request` when the error is not attributable to one. `message` is a
short human-readable sentence, already safe to show a user.

> **This replaced FastAPI's stock `loc`/`msg`/`type` shape.** The application
> has always returned the `field`/`message` form, but the published OpenAPI
> advertised FastAPI's default — so a client generated from `/openapi.json`
> had the wrong type for the most common error response in the API. The schema
> was corrected on 2026-08-01 and an automated contract suite now checks that
> the two stay in agreement.

### Permission Error (403)

```json
{
  "detail": "Insufficient permissions. Required: training.manage"
}
```

---

## Rate Limiting

| Endpoint Type      | Limit                       |
| ------------------ | --------------------------- |
| Login              | 5 requests/minute per IP    |
| General API        | 60 requests/minute per user |
| Public form view   | 60 requests/minute per IP   |
| Public form submit | 10 requests/minute per IP   |

---

## Pagination

List endpoints support pagination:

```
GET /api/v1/users?page=1&per_page=25&sort=last_name&order=asc
```

| Parameter  | Default | Description                      |
| ---------- | ------- | -------------------------------- |
| `page`     | 1       | Page number                      |
| `per_page` | 25      | Items per page (max 100)         |
| `sort`     | varies  | Sort field                       |
| `order`    | `asc`   | Sort direction (`asc` or `desc`) |

---

**See also:** [Backend Development](Development-Backend) | [Technology Stack](Technology-Stack)
