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
| Department | `get_department_profile` — name, timezone, identifiers, active locations, enabled modules                                                                                                                                                                                                                                                                                                                          |
| Roster     | `list_members`, `get_member` — name, rank, station, platoon, class, status, hire date, positions                                                                                                                                                                                                                                                                                                                   |
| Events     | `list_events`, `get_event`, `get_event_description`, `list_event_attendees` — calendar with RSVP and waitlist counts (descriptions and location details cut at 20,000 characters, the rest read in pieces); the going list where the event shares it with members                                                                                                                                                  |
| Scheduling | `list_shifts`, `list_open_shifts`, `get_shift_notes`, `get_scheduling_summary` — seats, assignments, gaps (notes cut at 20,000 characters, the rest read in pieces); **only shifts open to all members** unless the full schedule is shared                                                                                                                                                                        |
| Training   | `list_expiring_certifications`, `get_member_training_summary`, `get_member_requirements_progress`, `list_member_training_records`                                                                                                                                                                                                                                                                                  |
| Inventory  | `get_inventory_summary`, `list_low_stock_items`, `list_inventory_items`, `list_overdue_checkouts` — gear, uniforms and equipment; **never medical supplies**                                                                                                                                                                                                                                                       |
| Apparatus  | `list_apparatus`, `get_fleet_summary`, `list_apparatus_maintenance`, `get_maintenance_record_text` — a maintenance record's description, work performed and findings cut at 20,000 characters, the rest read in pieces                                                                                                                                                                                             |
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
   default. A chief who wants to delegate it grants that permission to a
   position that already has the Integrations screen (`settings.manage`);
   the key permission on its own reaches nothing.
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

### Claude Desktop

Claude Desktop's custom-connector dialog authenticates remote servers with
OAuth, not a static bearer token; use its local-server configuration with a
stdio-to-HTTP bridge (such as `mcp-remote`) that passes the
`Authorization` header. The same applies to claude.ai custom connectors — see
**Limitations** below.

---

## Security model

- **One organization credential, not a member's.** Tools act for the
  department as a whole and see only what every member could see; anything
  restricted to leadership (draft minutes, executive sessions, restricted
  document folders) is excluded outright.
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
`mcp_service_keys`, created by migration `c4d5e6f7a8b9`.

---

## Limitations

- **claude.ai custom connectors need OAuth.** The claude.ai (and Claude
  Desktop remote-connector) dialog authenticates remote MCP servers with
  OAuth 2.1 and dynamic client registration; The Logbook is currently an
  OAuth _client_ (Google and Microsoft sign-in), not an authorization
  server. Until that is built, those clients connect through a local bridge
  as described above. Claude Code and the Messages API connector work
  directly.
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
