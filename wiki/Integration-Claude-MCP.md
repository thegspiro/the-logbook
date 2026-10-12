# Claude (MCP) Integration

_(Added 2026-09-03)_

The Claude (MCP) integration lets an MCP client — Claude Code, Claude
Desktop, or an application using the Messages API's MCP connector — ask
questions of a department's Logbook over the
[Model Context Protocol](https://modelcontextprotocol.io). It is an add-on:
**off on every installation until an administrator connects it and an IT
administrator issues a service key.**

Personal information is never available through it, whatever the settings:
no phone numbers, email addresses (work or personal), home addresses, dates
of birth, emergency contacts, photos, membership or certification numbers,
login names, or medical results. Members are identified by name, rank,
station and position.

The connection is a department-level integration, not a member. Within the
modules a department has switched on, it reads operational records the way
the responsible officer does — training and certification status for every
member, who holds which piece of gear, what is low or overdue — minus the
personal information above. That is the decision a department makes when
it connects the integration and issues a key; the switches below cover the
areas that carry money, health information or a schedule members do not
all see.

---

## What Claude can do with it

Read tools, always available once connected:

| Area       | Tools                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Department | `get_department_profile`, `list_locations`, `get_location_description` — name, timezone, identifiers, enabled modules; active locations paged, descriptions cut at 20,000 characters and the rest read in pieces                                                                                                                                                                                                   |
| Roster     | `list_members`, `get_member` — name, rank, station, platoon, class, status, hire date, positions                                                                                                                                                                                                                                                                                                                   |
| Events     | `list_events`, `get_event`, `get_event_description`, `list_event_attendees` — calendar with RSVP and waitlist counts (descriptions and location details cut at 20,000 characters, the rest read in pieces); the going list where the event shares it with members                                                                                                                                                  |
| Scheduling | `list_shifts`, `list_open_shifts`, `get_shift_notes`, `get_scheduling_summary` — seats, assignments, gaps (notes cut at 20,000 characters, the rest read in pieces); **only shifts open to all members** unless the full schedule is shared                                                                                                                                                                        |
| Training   | `list_expiring_certifications`, `get_member_training_summary`, `get_member_requirements_progress`, `list_member_training_records`                                                                                                                                                                                                                                                                                  |
| Inventory  | `get_inventory_summary`, `list_low_stock_items`, `list_inventory_items`, `list_overdue_checkouts` — gear, uniforms and equipment; **never medical supplies**                                                                                                                                                                                                                                                       |
| Apparatus  | `list_apparatus`, `get_apparatus_text`, `get_fleet_summary`, `list_apparatus_maintenance`, `get_maintenance_record_text` — an apparatus's description and status reason, and a maintenance record's description, work performed and findings, cut at 20,000 characters, the rest read in pieces                                                                                                                    |
| Facilities | `list_facilities`, `get_facility_description`, `get_facilities_counts` — descriptions cut at 20,000 characters, the rest read in pieces                                                                                                                                                                                                                                                                            |
| Meetings   | `list_meetings`, `get_meeting_agenda`, `list_open_action_items`, `get_action_item_description`, `list_minutes`, `get_minutes`, `get_minutes_text` — **approved, non-executive minutes only**; long text (the agenda, reports and business, a dynamic section, a motion's wording and discussion notes or an action item's description by id; a meeting's agenda or action item) is read in 20,000-character pieces |
| Documents  | `list_documents`, `get_document`, `get_document_description` — **active documents in folders every member can read**, uploaded or written by a person — reports the system generated (a property-return report, filed minutes) are never listed; text is read in 20,000-character pieces                                                                                                                           |
| Elections  | `list_elections`, `get_election_description`, `get_election_results` — descriptions cut at 20,000 characters, the rest read in pieces; results only after an election closes                                                                                                                                                                                                                                       |

Switched on per department, off by default:

| Switch                             | Adds                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read and write**                 | `create_event_draft`, `create_meeting_action_item`, `create_reorder_request` — drafts and pending requests for a person to review; nothing is published, approved, assigned or sent. An action item is created unassigned (an officer assigns it on review, and due-date reminders go only to an assignee), attributed to the administrator who issued the key and marked `source: mcp`                                                        |
| **Share finance totals**           | `list_fiscal_years`, `get_budget_summary`, `list_budgets`, `get_budget_notes` (notes cut at 20,000 characters, the rest read in pieces), and the finance sections inside published minutes (the treasurer's report, financial review, trust fund report, audit report, any built-in section whose name mentions money, and every section a department added itself, since a custom section carries nothing that says whether it holds figures) |
| **Share medical screening status** | `get_member_medical_compliance`, `list_expiring_screenings` — compliant or not and when it lapses; never a result, provider, note or the record's own status (a waiver is a result by another name)                                                                                                                                                                                                                                            |
| **Share the full duty schedule**   | Every shift and its assignments in `list_shifts` and `list_open_shifts`, as a scheduling manager sees them. Off, the tools list only shifts open to all members — what any eligible member can see, since a service key has no rank or qualifications to be eligible with                                                                                                                                                                      |

Tools a department has not switched on are not listed to the client, and
calling one anyway is refused with a message naming the setting.

Typical questions: _"Who has an EMT certification expiring this quarter, and
are any of them on next month's schedule?"_, _"What is below its reorder
point?"_, _"Summarise the open action items from the last three business
meetings."_, _"Which shifts next week still have an open driver seat?"_

---

## Setting it up

1. **Connect the integration** — Settings → Integrations → Claude (MCP) →
   Connect. Choose read-only or read/write and whether to share finance
   totals, medical screening status or the full duty schedule. Requires
   `integrations.manage`.
2. **Issue the service key** — on the connected card, open **Service key**,
   give the key a name and an expiry (30 days to a year, or lifetime) and
   issue it. The key is shown **once**; copy it then. Requires
   `integrations.mcp_keys`, which only the IT Manager position holds by
   default (through its wildcard). To delegate it, the IT Manager grants
   that permission to a position that already has the Integrations screen
   (`integrations.manage`); the key permission on its own reaches nothing.
   A chief cannot make that grant: a position can only be given
   permissions its granter already holds, and the seeded chief position
   has `integrations.manage` but not the key permission.
3. **Configure the client** with the endpoint URL and the key as a bearer
   token. The endpoint is `https://<your-logbook-host>/api/mcp`.

A department has one active key. Issuing a new one revokes the old one in
the same step, so rotation is a single action. Revoking, disconnecting the
integration, or the key expiring all stop the client immediately.

### Claude Code

```bash
claude mcp add --transport http logbook https://your-logbook.example.org/api/mcp \
  --header "Authorization: Bearer logbook_mcp_…"
```

### Messages API (MCP connector)

```json
"mcp_servers": [
  {
    "type": "url",
    "url": "https://your-logbook.example.org/api/mcp",
    "name": "logbook",
    "authorization_token": "logbook_mcp_…"
  }
]
```

### claude.ai and Claude Desktop (member sign-in)

The claude.ai custom-connector dialog and Claude Desktop's remote connectors
authenticate with OAuth rather than a pasted key. The Logbook includes an
OAuth 2.1 authorization server for them, **off by default** — see
[Member sign-in (OAuth)](#member-sign-in-oauth) below. Until it is turned on,
use Claude Desktop's local-server configuration with a stdio-to-HTTP bridge
(such as `mcp-remote`) that passes the `Authorization` header.

---

## Member sign-in (OAuth)

A service key acts for the whole department. Member sign-in lets each member
connect a client **with their own account** instead: they sign in, see what
the client is asking for, and approve it. That connection can then do only
what the member can do in The Logbook, within the switches the department set
on the integration.

### Turning it on

1. **Operator** — set two environment variables and restart the backend:

   ```bash
   MCP_OAUTH_ENABLED=true
   MCP_OAUTH_ISSUER_URL=https://logbook.yourdept.org   # public origin, no path
   ```

   The issuer must be an `https://` origin with no path (`http://` is
   accepted only for `localhost`). Tokens are bound to it, so it must be the
   address clients use. If it is missing or invalid the server stays off and
   startup logs a warning — nothing else changes.

2. **Proxy (optional)** — the shipped nginx configurations route
   `/.well-known/oauth-*` to the backend. Every document is also served under
   `/api/`, and the MCP endpoint's `401` points clients there, so a proxy you
   manage yourself works without the extra rule.

3. **Department** — Integrations → Claude (MCP) → settings → tick **Let
   members connect with their own account**.

4. **Register each client** — on the connected card, the **Member sign-in
   (OAuth)** panel (needs `integrations.mcp_keys`). Give it a name and its
   exact redirect URI(s), and choose whether it gets a secret:

   | Client               | Redirect URI                                                       | Secret                 |
   | -------------------- | ------------------------------------------------------------------ | ---------------------- |
   | claude.ai connector  | `https://claude.ai/api/mcp/auth_callback`                          | yes (confidential)     |
   | Claude Code          | `http://localhost:<port>/callback` — run it with `--callback-port` | no (public, PKCE only) |
   | Another OAuth client | whatever it documents, exactly                                     | if it can keep one     |

   The client ID (and secret, shown **once**) go into the client's OAuth
   settings — for claude.ai, the custom connector's **Advanced settings**.
   There is no dynamic client registration: a client the department did not
   register cannot start a sign-in.

### What a member sees

The client opens `https://<host>/api/oauth/authorize…`; the member signs in
if needed and lands on **Connect Claude to your account**
(`/claude/authorize`). It names the client, where they will be
sent back, and each requested permission with how many tools it would reach
**for them** right now — "would not reach anything" when the department has
the switch off or the member lacks the access. They can untick the optional
ones, then **Allow** or **Don't allow**.

Members review and end their own connections at
`/claude/connections`. Administrators see every connection in
the Member sign-in panel and can end any of them.

### Scopes

| Scope                   | Adds                                                                    | Also needs                                                                                         |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mcp:read`              | the read tools (always granted)                                         | the member's own permission for each tool                                                          |
| `mcp:write`             | draft events, action items, reorder requests — attributed to the member | department access **Read and write**, and `events.manage` / `meetings.manage` / `inventory.manage` |
| `mcp:finance`           | finance totals                                                          | department **Share finance totals**, and `finance.view`                                            |
| `mcp:medical_screening` | medical-screening status                                                | department **Share medical screening status**, and `medical_screening.view`                        |

Every tool declares the permission the app's own screen for that data
requires (`members.view` for the roster, `training.view_all` for another
member's training, `apparatus.view` for the fleet, …). The member's
permissions are re-read on **every** call, so removing a position from a
member takes effect on their next request.

### Lifetimes and revocation

- Authorization codes: 60 seconds, single use. Reusing one ends the
  connection it created.
- Access tokens: 15 minutes. Refresh tokens rotate on every use; presenting
  an old one ends the whole connection (theft detection). A connection idles
  out after 30 days without a refresh and ends after 90 days regardless.
- A connection also ends when the member changes or resets their password,
  when the member, an administrator or the client revokes it, when its client
  is revoked, or when the integration is disconnected. Turning the
  department switch off, deactivating the member or switching the
  Integrations module off refuses it on the next call.
- Only SHA-256 digests of codes, tokens and client secrets are stored.

### Audit events

`mcp.oauth_client_registered`, `mcp.oauth_client_revoked`,
`mcp.oauth_consent_granted`, `mcp.oauth_consent_declined`,
`mcp.oauth_token_issued`, `mcp.oauth_token_refreshed`,
`mcp.oauth_token_replay` (critical), `mcp.oauth_token_exchange_failed`,
`mcp.oauth_grant_revoked`. Tool calls made through a member's connection are
`mcp.tool_call` rows attributed to the member, with `auth_method: oauth` and
the client ID.

The threat model and residual risks are in
[`docs/security-review/MCPO-27-mcp-oauth-server.md`](../docs/security-review/MCPO-27-mcp-oauth-server.md).

---

## Security model

- **A service key is one organization credential, not a member's.** Tools
  act for the department as a whole and see only what every member could
  see; anything restricted to leadership (draft minutes, executive sessions,
  restricted document folders) is excluded outright. A member's OAuth
  connection is narrower still: the same tools, further limited to the ones
  that member's permissions reach.
- **Key storage.** Only a SHA-256 digest is stored, with a display prefix.
  The key is 32 bytes of CSPRNG output, so a slow hash adds nothing, and
  every tool call verifies the key.
- **Fail closed.** A revoked or expired key, an integration row that is
  missing, disabled or not in the `connected` state, or an organization that
  has been deactivated, is refused with 401/403 before the request reaches
  the MCP server. Disconnecting the integration revokes its active key, so a
  key never outlives the connection it was issued for.
- **Redaction is enforced in one place.** `app/mcp/redaction.py` strips
  denied field names at every depth of every tool result and scrubs every
  string value of email addresses (internationalized ones included) and
  phone numbers — international, North American, local and national
  formats without a country code, with or without a space after a
  parenthesized area code, and bare runs of seven to eleven digits — so a
  note or a document body cannot carry either out. `tests/test_mcp_redaction.py`
  asserts both behaviours and that no tool module names a denied field.
  What a value-level scrub cannot recognise — a street address written
  out, a diagnosis in prose — is why only _published_ minutes and
  documents in unrestricted folders are exposed at all.
- **Audit.** Every tool call — successful, refused by a switch or module,
  rejected by validation, or failed — is written to the audit log
  (`mcp.tool_call`) with the key id, the tool, its arguments (redacted, and
  cut to 200 characters per value so the audit table cannot grow by the size
  of every payload a client sends), the outcome, the reason when it did not
  succeed, and the client IP. A write tool records an `attempted` row
  before it changes anything and refuses the change if that row cannot be
  written, so no mutation is ever made without an audit trail; a read still
  answers when the audit log is down, and logs the failure. Key issue and
  revocation are `mcp.key_created` and `mcp.key_revoked`.
- **Medical supplies are a separate domain.** The Medical Supplies module
  has its own page and officer, and the inventory API keeps its stock out
  of the gear listing. The inventory tools and `create_reorder_request` do
  the same: medical items, categories, checkouts and counts are never
  returned, and a reorder that names a medical item or category is refused.
- **Input bounds.** No tool accepts a string argument longer than 4,000
  characters; a larger search term or draft body is refused before the
  handler runs.
- **Rate limit.** 240 requests per minute per key, Redis-backed with an
  in-memory fallback.

---

## Deployment

The endpoint is served by the existing backend process at `/api/mcp` — no
new container, port or environment variable. It runs the MCP
streamable-HTTP transport in **stateless, JSON-response** mode, so:

- any Uvicorn worker or container replica can answer any request;
- there are no server-sent events, so a reverse proxy needs no buffering or
  timeout changes for this path — an nginx that already forwards `/api/`
  reaches it unchanged.

Dependencies added: `mcp` 2.x (which brings in `httpx2`, `sse-starlette`,
`mcp-types`, `jsonschema` and `opentelemetry-api`). Schema: one table,
`mcp_service_keys`, created by migration `c4d5e6f7a8b9`. Member sign-in
adds `mcp_oauth_clients`, `mcp_oauth_authorizations` and `mcp_oauth_grants`
(migration `2d4304107b77`) and the two optional environment variables above.

---

## Limitations

- **No dynamic client registration.** Clients that only support DCR cannot
  connect through member sign-in; register them by hand (claude.ai accepts a
  client ID and secret in its connector's advanced settings) or use a service
  key through a local bridge.
- **Redirect URIs match exactly, ports included.** A desktop client must use
  a fixed callback port.
- **Department contact details are also withheld.** The redaction boundary
  works by field name so it can be proven by a test; a station's public
  phone number is stripped along with a member's. Locations and facilities
  are still listed by name, city and state.
- **Free text is scrubbed, not understood.** Email addresses and phone
  numbers are removed from every string; other personal details someone
  typed into a published document or note are not detectable and pass
  through. Keep personal information out of published content.
- **Tool results are point-in-time.** There are no resources or
  subscriptions; a client re-asks to refresh.
