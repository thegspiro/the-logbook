# Error Codes

Every JSON error response from the API carries a stable, support-facing
`code` field alongside the human-readable message:

```json
{ "detail": "Could not validate credentials", "code": "LB-AUTH-002" }
```

The frontend appends the code to the message shown to the member — e.g.
_"Could not validate credentials **(Error code: LB-AUTH-002)**"_ — so a member
can quote it to IT, and IT can look it up here without needing a screenshot or
a reproduction.

Where to look codes up:

- **In the app:** Admin → Error Monitoring → _Error Code Reference_
  (searchable; any signed-in member can also fetch `GET /api/v1/errors/codes`).
- **This document.**

## How codes are structured

`LB-<CATEGORY>-<NNN>`

- **Curated codes** (`NNN` below 100) are attached explicitly at the places
  that generate the questions IT actually gets: sessions, permissions, CSRF,
  MFA, outages. They come from `backend/app/core/error_codes.py`
  (`ErrorCode` + `ERROR_CODE_CATALOG`), the single source of truth.
- **Fallback codes** (`LB-API-<HTTP status>`, e.g. `LB-API-404`) are attached
  automatically by the global exception handlers to any error that has no
  curated code, so every error is identifiable without hand-tagging hundreds
  of raise sites. The number is simply the HTTP status of the failure.

Codes are a support contract: **never repurpose a published code**. Add a new
one instead. To add a curated code: add the `ErrorCode` member and its
`ERROR_CODE_CATALOG` entry, raise `CodedHTTPException(..., error_code=...)` at
the site, and list it in this document (`backend/tests/test_error_codes.py`
fails if this document misses a curated code).

## Authentication & session (LB-AUTH)

| Code        | Meaning                                                                | What to do                                                                                                                               |
| ----------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| LB-AUTH-001 | Not signed in — the request carried no session cookie or token.        | Sign in again. If it recurs right after login, check the browser accepts cookies and the site is accessed via the expected domain.       |
| LB-AUTH-002 | Session expired or invalid — a token was presented but rejected.       | Sign in again. If every user is affected at once, check whether `SECRET_KEY` was rotated (that invalidates all sessions).                |
| LB-AUTH-003 | Account inactive.                                                      | An administrator can reactivate the account from the Members page.                                                                       |
| LB-AUTH-004 | Password change required (flagged after an admin reset).               | Complete the password-change prompt shown after login.                                                                                   |
| LB-AUTH-005 | MFA enrollment required by the organization; account not enrolled yet. | Finish MFA setup under Profile → Security, or an admin can lift the org-wide requirement temporarily.                                    |
| LB-AUTH-006 | Incorrect username or password at login.                               | Check spelling; use password reset. Repeated failures are rate limited (see LB-SYS-003).                                                 |
| LB-AUTH-007 | Invalid MFA verification code.                                         | Re-enter the current code (they rotate every 30s). Persistent failures usually mean the phone's clock is skewed. An admin can reset MFA. |
| LB-AUTH-008 | Missing CSRF token on a logged-in request.                             | Reload the page and retry; sign out/in if it persists; check for cookie-stripping extensions.                                            |
| LB-AUTH-009 | Invalid CSRF token (usually a stale tab after a newer login).          | Reload the page; close duplicate tabs.                                                                                                   |
| LB-AUTH-010 | Self-registration attempted while disabled.                            | An administrator creates accounts from the Members page, or enables `REGISTRATION_ENABLED`.                                              |
| LB-AUTH-011 | MFA challenge expired (too long between password and code entry).      | Start the login again and enter the code promptly.                                                                                       |

## Permissions (LB-PERM)

| Code        | Meaning                                                         | What to do                                                                        |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| LB-PERM-001 | Signed in, but the member's positions/rank lack the permission. | Review the permissions on the member's positions under Admin → Roles & Positions. |

## Validation (LB-VAL)

| Code       | Meaning                                                               | What to do                                                                                       |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| LB-VAL-001 | Submitted data rejected (missing/invalid fields); message names them. | Correct the fields. If a valid-looking form is rejected, report the exact field to the dev team. |

## Organization (LB-ORG)

| Code       | Meaning                                                        | What to do                                                                     |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| LB-ORG-001 | The account references an organization record that is missing. | Escalate to the system administrator — this is a data problem, not user error. |

## System (LB-SYS)

| Code       | Meaning                                                      | What to do                                                                                                           |
| ---------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| LB-SYS-001 | Unhandled server error; traceback recorded in the error log. | Retry once; then check the Error Monitoring page for the matching server-side entry.                                 |
| LB-SYS-002 | Database temporarily unreachable (restart/failover/outage).  | Wait and retry; if persistent, check the MySQL service is running and reachable from the backend.                    |
| LB-SYS-003 | Rate limit exceeded.                                         | Wait a minute. Shared-IP stations can trip IP-based limits together — note the time and affected users if it recurs. |

## Automatic fallback (LB-API-\<status\>)

Any error without a curated code gets `LB-API-<HTTP status>`:

| Code       | Meaning                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| LB-API-400 | Request rejected as invalid; the message explains why.                    |
| LB-API-401 | Authentication required.                                                  |
| LB-API-403 | Access denied for this action.                                            |
| LB-API-404 | Record not found (deleted, or not visible to this member's organization). |
| LB-API-409 | Conflict with the record's current state (already exists / already done). |
| LB-API-422 | Request body failed validation.                                           |
| LB-API-429 | Too many requests.                                                        |
| LB-API-500 | Server error while handling the request.                                  |
| LB-API-502 | Reverse proxy could not reach the backend (backend down or restarting).   |
| LB-API-503 | Server or a dependency temporarily unavailable.                           |

Other statuses follow the same pattern (`LB-API-410`, `LB-API-507`, …).

## For developers

- Raise `CodedHTTPException` (from `app.core.error_codes`) with an
  `error_code=` wherever a condition deserves a curated code; plain
  `HTTPException` continues to work and gets the fallback code.
- The `code` reaches the frontend on `AppError.code`
  (`utils/errorHandling.ts`); `getErrorMessage()` appends it to displayed
  messages automatically.
- Client-side error reports attach the code to the Error Monitoring row
  (`context.error_code`), so a member's quoted code can be matched to the
  logged failure.
