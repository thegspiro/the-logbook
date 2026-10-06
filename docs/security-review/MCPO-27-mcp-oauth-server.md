# Security Review — Claude (MCP) OAuth 2.1 Authorization Server

**Prefix:** `MCPO` · **Iteration:** 1 (design review of new code) · **Reviewed:** 2026-10-06 · **PR:** branch `worktree-l-mcp-oauth`

**Backend:** `app/mcp/oauth.py` (service, every decision), `app/api/public/mcp_oauth.py` (5 routes + 6 metadata paths), `app/api/v1/endpoints/mcp_oauth.py` (4 routes), `app/api/v1/endpoints/mcp_oauth_admin.py` (6 routes), `app/mcp/transport.py` (credential dispatch), `app/mcp/registry.py` + `app/mcp/principal.py` (per-member tool gating), `app/models/mcp_oauth.py`
**Frontend:** `pages/ClaudeAuthorizePage.tsx` (consent), `pages/ClaudeConnectionsPage.tsx`, `components/integrations/McpOAuthPanel.tsx`
**Migrations:** `2d4304107b77` (`mcp_oauth_clients`, `mcp_oauth_authorizations`, `mcp_oauth_grants`)

Owner decision: _"Build it — L effort, new auth surface"_ for the
`KNOWN_LIMITATIONS.md` entry "Claude (MCP) — claude.ai Custom Connectors Need
an OAuth Server". This file is the threat model the build was written
against, the controls that answer each threat, and what is left over.

---

## Scope

Read in full and written in this change: every file listed above. The
existing service-key path (`app/mcp/keys.py`) was refactored only to extract
`resolve_department_access`, the department-level gate both credentials now
share; its behaviour and messages are unchanged and its suites
(`test_mcp_keys.py`, `test_mcp_key_endpoints.py`, `test_mcp_transport.py`)
pass unmodified. Tool bodies (`app/mcp/tools/*.py`) were
not re-reviewed; each gained only a `permissions=` declaration.

## What it is

An OAuth 2.1 authorization server that lets a **member** connect an MCP
client (claude.ai custom connector, Claude Desktop, Claude Code) with their
own account, beside the department's **service key**, which is untouched.

- Authorization code grant with PKCE, `S256` only. No implicit grant, no
  password grant, no client-credentials grant.
- Clients are **registered by an administrator** holding
  `integrations.mcp_keys`. There is **no dynamic client registration**.
- Opt-in twice: the deployment (`MCP_OAUTH_ENABLED` + a valid
  `MCP_OAUTH_ISSUER_URL`) and the department (`oauth_enabled` on the
  Claude (MCP) integration). Either off, and every OAuth route answers 404
  or refuses.

## Route inventory

| Method | Path                                                                                                                                                                       | Auth                            | Permission                                       | Org-scoped                     | Notes                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ | ------------------------------ | -------------------------------------- |
| GET    | `/.well-known/oauth-authorization-server/api/oauth`, `/api/oauth/.well-known/{oauth-authorization-server,openid-configuration}`, `/.well-known/oauth-authorization-server` | none                            | —                                                | n/a                            | RFC 8414 metadata; 404 while off       |
| GET    | `/.well-known/oauth-protected-resource/api/mcp`, `/api/mcp/.well-known/oauth-protected-resource`                                                                           | none                            | —                                                | n/a                            | RFC 9728 metadata; 404 while off       |
| GET    | `/api/oauth/authorize`                                                                                                                                                     | none (client verified)          | —                                                | org taken from the client      | 60/min/IP                              |
| POST   | `/api/oauth/token`                                                                                                                                                         | client secret or PKCE           | —                                                | grant/code carry the org       | 120/min/IP                             |
| POST   | `/api/oauth/revoke`                                                                                                                                                        | client secret or PKCE client    | —                                                | only the owning client's grant | 60/min/IP, 200 for unknown tokens      |
| GET    | `/api/v1/mcp-oauth/requests/{id}`                                                                                                                                          | session + CSRF router           | authenticated                                    | `organization_id == user.org`  | consent screen data                    |
| POST   | `/api/v1/mcp-oauth/requests/{id}/decision`                                                                                                                                 | session + CSRF                  | authenticated                                    | same, row locked               | audited; refused without audit row     |
| GET    | `/api/v1/mcp-oauth/connections`                                                                                                                                            | session                         | authenticated                                    | org + own `user_id`            |                                        |
| DELETE | `/api/v1/mcp-oauth/connections/{grant_id}`                                                                                                                                 | session + CSRF                  | authenticated                                    | org + own `user_id`            | audited                                |
| GET    | `/api/v1/integrations/claude-mcp/oauth/{status,clients,grants}`                                                                                                            | session                         | `integrations.manage` or `integrations.mcp_keys` | org                            |                                        |
| POST   | `/api/v1/integrations/claude-mcp/oauth/clients`                                                                                                                            | session + CSRF                  | `integrations.mcp_keys`                          | org from the caller            | audited; secret shown once             |
| DELETE | `/api/v1/integrations/claude-mcp/oauth/clients/{id}`, `/grants/{id}`                                                                                                       | session + CSRF                  | `integrations.mcp_keys`                          | org                            | audited; client revoke ends its grants |
| \*     | `/api/mcp`                                                                                                                                                                 | service key **or** access token | per-tool member permission for OAuth             | principal's org                | dispatch by prefix                     |

All `/api/v1` routes sit behind the Integrations module gate.

## Threat model

Assets: the department's records reachable through the MCP tools, a member's
standing in the app, and the integrity of the audit trail.

Actors: an outside attacker on the network; a malicious or compromised MCP
client; a member of the department trying to exceed their own permissions; a
member or administrator of **another** department on the same installation;
anyone who obtains a leaked token, code or link.

| #   | Threat                                                      | Control                                                                                                                                                                                                                                                                                                     | Test                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Authorization code intercepted and redeemed by someone else | PKCE `S256` required at `/authorize`; the verifier is checked in constant time at `/token`; the code is bound to its client and redirect URI and lives 60 s                                                                                                                                                 | `test_pkce_mismatch_burns_the_code`, `test_missing_verifier_is_refused`, `test_code_issued_to_another_client`                                                                                              |
| T2  | Verifier guessed by retrying one code                       | Any failed exchange after the code is found **burns** it; a second attempt is a replay                                                                                                                                                                                                                      | `test_pkce_mismatch_burns_the_code`                                                                                                                                                                        |
| T3  | Code replay                                                 | Single use; a replay revokes the grant the code minted (RFC 6749 §4.1.2) and is audited at `critical`                                                                                                                                                                                                       | `test_code_reuse_revokes_the_grant_it_minted`, HTTP flow                                                                                                                                                   |
| T4  | Open redirect / code sent to an attacker's URI              | Redirect URIs are registered by an administrator and matched **byte for byte**; until both client and URI are verified, errors are rendered as a page, never redirected; the consent page follows only the URL the server built, and only if it is http(s)                                                  | `test_redirect_uri_must_match_exactly` (trailing slash, query, case, port, host), `test_authorize_bad_redirect_is_a_page_not_a_redirect`, `safeRedirect` test                                              |
| T5  | Refresh token theft                                         | Rotation on every use; only the current digest is stored and the token names its grant, so any older refresh token for a live grant is a replay → the whole grant is revoked (both holders cut off); refresh tokens idle out at 30 days and grants end at 90                                                | `test_replayed_refresh_token_revokes_the_whole_grant`, `test_expired_refresh_token`                                                                                                                        |
| T6  | Access token theft                                          | 15-minute lifetime; superseded on refresh; digest only at rest; audience-bound to `<issuer origin>/api/mcp`                                                                                                                                                                                                 | `test_rotation_retires_the_previous_pair`, `test_token_for_another_issuer_is_refused`                                                                                                                      |
| T7  | Token or secret leaked from the database                    | SHA-256 digests only (all values are 256-bit CSPRNG output, so a fast hash is not brute-forceable); comparisons are constant time                                                                                                                                                                           | `test_no_plaintext_in_any_column`, `test_approval_stores_only_the_code_digest`                                                                                                                             |
| T8  | Member exceeds their own permissions through Claude         | Every tool declares the member permissions its app equivalent requires (`logbook_tool(permissions=…)`, required keyword); for an OAuth principal the registry and the list filter check them against the member's permissions **re-read on every call**; no declaration, or unresolved permissions, refuses | `test_mcp_member_gating.py`, `test_losing_a_permission_takes_effect_on_the_next_call`                                                                                                                      |
| T9  | Scope escalation                                            | Consent can only narrow what the client asked for; a refresh can only narrow (permanently); unknown scopes are `invalid_scope`; each scope also needs the department switch **and** the member permission                                                                                                   | `test_consent_cannot_add_scopes…`, `test_refresh_cannot_widen_scope`, `test_scopes_and_switches_intersect`                                                                                                 |
| T10 | Cross-department access                                     | The organization is always the client's (never from the request); consent lookups, revocations and admin actions filter `organization_id`; a member moved to another department is refused because the grant's org no longer matches the user's                                                             | `test_member_of_another_department_cannot_see_or_answer`, `test_consent_screen_is_org_scoped`, `test_admin_cannot_revoke_another_departments_client`, `test_member_moved_to_another_department_is_refused` |
| T11 | Consent CSRF / clickjacking a member into approving         | The decision is a POST on the CSRF-protected `/api/v1` router with the session cookie (`SameSite=Strict`); the consent screen is a normal SPA page under the app's frame-ancestors policy; the request id is a random UUID valid 10 minutes and answerable once                                             | `test_a_request_is_answered_once`, `test_an_expired_request_cannot_be_approved`                                                                                                                            |
| T12 | Account compromise outlives a password change               | Password change and password reset end every one of the member's grants; deactivation is checked live                                                                                                                                                                                                       | `test_password_change_ends_every_connection`, `test_deactivated_member_is_refused`                                                                                                                         |
| T13 | Department turns the feature off but tokens keep working    | Every call re-reads the integration row (`connected`, `enabled`, `oauth_enabled`), `Organization.active` and the Integrations module; disconnecting revokes every grant                                                                                                                                     | `test_department_switch_off_refuses_existing_tokens`, `test_disconnect_ends_every_connection`                                                                                                              |
| T14 | Compromised client                                          | An administrator revokes the client: its grants end and pending requests/unexchanged codes are deleted; a public client may not present a secret and a confidential one must                                                                                                                                | `test_revoked_client_refuses_existing_tokens`, `TestClientAuthentication`                                                                                                                                  |
| T15 | Resource exhaustion by unauthenticated callers              | Per-IP limits on all three endpoints; pending requests capped at 100 per client and finished rows pruned after a day; at most 5 live grants per member per client (oldest superseded); at most 25 clients per department and 10 redirect URIs per client                                                    | `test_token_endpoint_is_rate_limited`, `test_connections_per_member_and_client_are_capped`                                                                                                                 |
| T16 | Unaudited issuance                                          | Token issue/refresh, consent, client registration and every revocation write an audit row; issue, consent and registration are refused if the row cannot be written                                                                                                                                         | HTTP flow asserts `mcp.oauth_token_issued` / `mcp.oauth_token_replay`; `test_decision_endpoint_audits…`                                                                                                    |
| T17 | Host-header poisoning of issued metadata or token audience  | The issuer is the configured `MCP_OAUTH_ISSUER_URL`, validated as a bare `https://` origin (loopback `http://` only); never derived from the request or from `FRONTEND_URL`, which a saved link domain can repoint                                                                                          | `test_issuer_must_be_a_bare_https_origin`, `test_misconfigured_issuer_keeps_the_server_off`                                                                                                                |
| T18 | Service-key path weakened by the change                     | Credentials are told apart by prefix before any lookup; the service-key branch calls the unchanged `McpKeyService.authenticate`; an OAuth token is refused outright while the server is off                                                                                                                 | `test_service_keys_still_go_to_the_key_service`, `test_oauth_token_refused_while_the_server_is_off`, existing MCP suites                                                                                   |

## Decisions made without an owner decision (safer option chosen)

- **No dynamic client registration (RFC 7591).** The KL entry noted that
  claude.ai's dialog uses DCR; an open registration endpoint lets anyone
  create clients, cannot bind a client to a department without
  authentication, and is the largest single addition to the attack surface.
  claude.ai's connector accepts a pre-registered client ID and secret in its
  advanced settings, so registration by an administrator covers it. If the
  owner wants DCR later, the shape that keeps the department binding is an
  **authenticated** registration (an initial access token minted by an
  administrator), not open registration.
- **Exact redirect-URI matching, including loopback ports.** OAuth 2.1 lets
  a server accept any port on a loopback redirect. Not doing so means a
  desktop client must use a fixed callback port (Claude Code:
  `--callback-port`). Exactness was the requirement; it is also the simpler
  rule to audit.
- **Consent needs no permission of its own.** Any active member may connect a
  client; what the connection can do is bounded by the member's own
  permissions per tool. The department controls whether members may connect
  at all with `oauth_enabled`.

## Residual risks

- **R1 — Concurrent refresh by one legitimate client revokes its grant.**
  Rotation with replay detection cannot tell a client that retried a refresh
  (lost response) from a thief. The member reconnects. A grace window for the
  immediately previous refresh token would soften this at the cost of a
  window in which a stolen token is not detected; it was not added.
- **R2 — Access tokens are bearer tokens.** No sender-constraining (DPoP,
  mTLS). A leaked access token works for up to 15 minutes from anywhere.
- **R3 — `/authorize` is unauthenticated and stores a row.** Bounded by the
  per-IP limit, the per-client cap and the pruning; a determined attacker
  can fill one client's pending cap for ten minutes, denying new connections
  through that client (existing connections are unaffected).
- **R4 — The consent screen trusts the registered client name.** An
  administrator registers the name the member sees; a misleading name is an
  administrator's mistake, not something the server can detect.
- **R5 — Write tools are attributed to the member, but the department's
  read/write switch still applies on top.** A member with `events.manage`
  in a read-only department gets no write tools; this is intended, and the
  consent screen reports "would not reach anything" for that scope.
- **R6 — Parity is per tool, not per row.** Each tool requires the
  permission the app's equivalent screen requires (for example
  `members.view` for the roster, `training.view_all` for another member's
  training), and a member without it gets nothing from that tool. Within a
  tool, the rows are the service key's existing slice — restricted document
  folders, draft minutes and executive sessions excluded for everyone, shifts
  limited to open ones unless the department shares the full schedule — not
  re-filtered by any per-record rule a screen might add on top of its
  permission. No tool was found returning rows its permission's screen
  hides, but the registry cannot prove that for future tools; a new tool's
  author owns it, and the `permissions=` keyword makes them decide.
- **R7 — No refresh-token family history.** Only the current refresh digest
  is kept, so a replay of a token from a **revoked** grant is indistinguishable
  from any invalid token; it is refused either way.

- **R8 — A public client's ID plus a grant ID can end that grant.** A
  refresh token names its grant, and a mismatched secret for a live grant is
  treated as a replay. Someone holding a public client's (public) client ID
  and the grant ID — which appears only inside that grant's own tokens — can
  therefore end the connection by presenting a wrong secret. That is a
  denial of service against a member who has already leaked a token, never
  access; the member reconnects.
- **R9 — Org-scoping ratchet exceptions.** The three grant lookups by id in
  `app/mcp/oauth.py` are recorded in `tests/org_scoping_baseline.txt` with
  the reason: the id comes out of a bearer token and is used only when the
  token's digest matches, so the token is the credential and the
  organization comes from the grant.

## Schema & migration notes

Three tables, created by `2d4304107b77` with existence guards and a real
downgrade (drops the three tables; service keys untouched). Every
`ondelete="SET NULL"` column is `nullable=True`. `redirect_uris` is JSON with
one canonical shape (list of strings) set by `normalize_redirect_uris` on the
only write path and read defensively (`stored_redirect_uris`). Verified with
`alembic upgrade head` on an empty database, `downgrade -1` and `upgrade head`
again. `docs/DATABASE_SCHEMA.md` regenerated.

## Guard tests added

- `tests/test_mcp_member_gating.py` (unit) — every tool declares known
  member permissions; write tools need a `.manage` permission; omitting
  `permissions=` is a `TypeError`; OAuth principals fail closed.
- `tests/test_mcp_oauth.py` (integration, 88 tests) — the threat table above.
- `tests/test_mcp_oauth_transport.py` (unit) — challenge header and
  credential dispatch.
- Frontend: `ClaudeAuthorizePage.test.tsx`, `ClaudeConnectionsPage.test.tsx`,
  `McpOAuthPanel.test.tsx`, `utils/browserNavigation.test.ts`.

## Completion gate

| Check                                                                   | Result                      |
| ----------------------------------------------------------------------- | --------------------------- |
| `flake8` on every changed Python file                                   | ✅ clean                    |
| `black --check` / `isort --check-only`                                  | ✅ clean                    |
| MCP suites + gating + password + module-gate tests                      | ✅ 409 passed               |
| `scripts/check_endpoint_permissions.py --strict`                        | ✅ 0 errors, 0 warnings     |
| `scripts/check_route_permissions.py --strict`                           | ✅ 0 errors, 0 warnings     |
| backend unit job (`-m "not integration and not slow and not docker"`)   | ✅ 12,920 passed, 1 skipped |
| `alembic upgrade head` / `downgrade -1` / `upgrade head` on an empty DB | ✅                          |
| `npm run typecheck`                                                     | ✅                          |
| `npm run lint` (frontend)                                               | ✅                          |
| Route registries (vitest + Playwright inventory)                        | ✅                          |
