# Department Officers & Email Signatures

Records who holds each department office so outgoing email can be **signed by
the officeholder** rather than by whoever happened to trigger the send. A
member-services clerk generating a drop notice, or a nightly scheduled task
sending a certification alert, both produce a message signed "Susan Whitfield,
President" — because the signature comes from the office, not from the sender.

Managed at **Communications → Email Templates → Officers**
(`/communications/email-templates`), gated on `settings.manage` **or**
`organization.update_settings` — the same pair as the rest of that screen.

## Template variables

Every office in the catalogue contributes four variables. Use them anywhere a
template accepts `{{...}}` — subject line, HTML body, or plain-text body:

| Variable | Value |
|----------|-------|
| `{{<office>_name}}` | Full name of the current holder |
| `{{<office>_title}}` | Signature title (defaults to the office label) |
| `{{<office>_email}}` | Holder's email address |
| `{{<office>_phone}}` | Holder's phone number |

Offices (`<office>` above):

| Key | Label | Category |
|-----|-------|----------|
| `chief` | Chief | Operational |
| `deputy_chief` | Deputy Chief | Operational |
| `assistant_chief` | Assistant Chief | Operational |
| `safety_officer` | Safety Officer | Operational |
| `training_officer` | Training Officer | Operational |
| `president` | President | Administrative |
| `vice_president` | Vice President | Administrative |
| `secretary` | Secretary | Administrative |
| `assistant_secretary` | Assistant Secretary | Administrative |
| `treasurer` | Treasurer | Administrative |
| `quartermaster` | Quartermaster | Administrative |

Example signature block:

```html
<p>
  Sincerely,<br/>
  {{president_name}}<br/>
  {{president_title}}, {{organization_name}}<br/>
  {{president_email}}
</p>
```

An office nobody holds renders as an empty string, never as a literal
`{{president_name}}`.

## How a holder is resolved

Highest priority first:

1. **Override** stored on the office (name, title, email, or phone typed in by
   an admin). Each override is independent — overriding the title still leaves
   the name and email following the linked member.
2. **Linked member** — the office points at a member record, so the name,
   email, and phone track that member's profile.
3. **Position auto-detection** — nobody has been assigned, so the holder is
   inferred from the members carrying the matching position slug (`president`,
   `fire_chief`/`chief`, …). A department that never opens this screen still
   signs its notices correctly. When several members hold the position, the
   first by last name is used; assign someone explicitly to pin it.

The Officers screen labels each row `Assigned`, `Auto-detected`, or `Vacant` so
it is clear which rule produced the name.

Deleting a member does not delete the office: the row's `user_id` is set NULL
(preserving any overrides) and the office falls back to auto-detection.

## Architecture

| Layer | File |
|-------|------|
| Office catalogue | `backend/app/core/constants.py` (`OFFICE_CATALOG`) |
| Model | `backend/app/models/organization_officer.py` (`organization_officers`) |
| Service | `backend/app/services/officer_service.py` |
| Endpoints | `backend/app/api/v1/endpoints/officers.py` (`/api/v1/officers`) |
| Nightly refresh | `backend/app/services/scheduled_tasks.py` (`run_officer_directory_sync`) |
| Frontend panel | `frontend/src/modules/communications/components/OfficersPanel.tsx` |
| Frontend store | `frontend/src/modules/communications/store/officersStore.ts` |

### Why the values are cached on the organization

`EmailTemplateService.render()` is synchronous and is called from ten different
send paths. Rather than thread an async lookup through all ten, the resolved
values are flattened into `Organization.settings["officer_directory"]` — a plain
`{"president_name": "...", ...}` map that `render()` reads from the organization
it already receives. Only variable names in `OFFICE_VARIABLE_NAMES` are injected,
so a hand-edited settings blob cannot introduce arbitrary template variables.

The snapshot is rebuilt when an office is saved or cleared, when the Officers
screen is loaded, and nightly by `officer_directory_sync` — the last of which
catches changes made to the *member* behind an office (a rename, a new email
address, a departure) rather than to the assignment itself.

## Adding an office

Add an entry to `OFFICE_CATALOG` in `backend/app/core/constants.py`. The
variable catalogue, the admin UI rows, the editor's variable palette, and the
render-time directory are all generated from that list — nothing else needs to
change.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/officers` | Full office list plus the variables they expose |
| `PUT` | `/api/v1/officers/{office_key}` | Assign a member and/or overrides |
| `DELETE` | `/api/v1/officers/{office_key}` | Clear the assignment (falls back to auto-detection) |

All three return the complete re-resolved directory, so the UI never needs a
follow-up read. Responses carry member names, emails, and phone numbers, so the
route is excluded from the frontend API cache (`UNCACHEABLE_PREFIXES`).
