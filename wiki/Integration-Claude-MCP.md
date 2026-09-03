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

---

## What Claude can do with it

Read tools, always available once connected:

| Area       | Tools                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Department | `get_department_profile` — name, timezone, identifiers, active locations, enabled modules                                                          |
| Roster     | `list_members`, `get_member` — name, rank, station, platoon, class, status, hire date, positions                                                   |
| Events     | `list_events`, `get_event`, `list_event_attendees` — calendar with RSVP and waitlist counts; the going list where the event shares it with members |
| Scheduling | `list_shifts`, `list_open_shifts`, `get_scheduling_summary` — seats, assignments, gaps                                                             |
| Training   | `list_expiring_certifications`, `get_member_training_summary`, `get_member_requirements_progress`, `list_member_training_records`                  |
| Inventory  | `get_inventory_summary`, `list_low_stock_items`, `list_inventory_items`, `list_overdue_checkouts`                                                  |
| Apparatus  | `list_apparatus`, `get_fleet_summary`, `list_apparatus_maintenance`                                                                                |
| Facilities | `list_facilities`, `get_facilities_counts`                                                                                                         |
| Meetings   | `list_meetings`, `list_open_action_items`, `list_minutes`, `get_minutes` — **approved, non-executive minutes only**                                |
| Documents  | `list_documents`, `get_document` — **active documents in folders every member can read**                                                           |
| Elections  | `list_elections`, `get_election_results` — results only after an election closes                                                                   |

Switched on per department, off by default:

| Switch                             | Adds                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read and write**                 | `create_event_draft`, `create_meeting_action_item`, `create_reorder_request` — drafts and pending requests for a person to review; nothing is published, approved or sent |
| **Share finance totals**           | `list_fiscal_years`, `get_budget_summary`, `list_budgets`, and the treasurer's report inside published minutes                                                            |
| **Share medical screening status** | `get_member_medical_compliance`, `list_expiring_screenings` — compliant or not and when it lapses; never a result, provider or note                                       |

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
   totals or medical screening status. Requires `integrations.manage`.
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
- **Fail closed.** A revoked or expired key, or an integration row that is
  missing, disabled or not in the `connected` state, is refused with 401/403
  before the request reaches the MCP server.
- **Redaction is enforced in one place.** `app/mcp/redaction.py` strips
  denied field names at every depth of every tool result and scrubs every
  string value of email addresses and phone numbers, so a note or a
  document body cannot carry either out. `tests/test_mcp_redaction.py`
  asserts both behaviours and that no tool module names a denied field.
  What a value-level scrub cannot recognise — a street address written
  out, a diagnosis in prose — is why only _published_ minutes and
  documents in unrestricted folders are exposed at all.
- **Audit.** Every tool call, key issue and key revocation is written to the
  audit log (`mcp.tool_call`, `mcp.key_created`, `mcp.key_revoked`) with the
  key id, the tool, its arguments (redacted, and cut to 200 characters per
  value so the audit table cannot grow by the size of every payload a
  client sends) and the client IP.
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
