# ADV-01 — Adversarial Exfiltration Pass (2026-11-08)

A one-off review outside the feature rotation: the application was attacked
from three positions — an unauthenticated outsider, a baseline member
(probationary firefighter grants), and an officer holding delegated `*.manage`
permissions — looking for ways to get data out. Every finding was traced
through the code end to end before it was accepted. The rotation's
`PROGRESS.md` is not edited by this pass, so it does not contend with the
rotation's own open pull request.

## Findings

| ID     | Persona  | Severity | Finding                                                                                                                                               | Status   |
| ------ | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ADV-1  | Officer  | High     | `members.manage` could change the Chief's email on `PATCH /users/{id}/contact-info`, then reset the `*` account's password through forgot-password    | Fixed    |
| ADV-2  | Officer  | Medium   | `members.manage` could name itself every member's supervisor and read evaluations, training records and time-off decisions it holds no grant for      | Fixed    |
| ADV-3  | Officer  | Medium   | `settings.manage` could rewrite the welcome/reset/ballot emails, unaudited, to beacon out temporary passwords and tokens                              | Fixed    |
| ADV-4  | Member   | Medium   | The Meetings API returned draft and executive-session notes, motions, attendance and action items to every member; the MCP meeting tools did the same | Fixed    |
| ADV-5  | Member   | Low–Med  | `GET /events?include_drafts=true` and `GET /events/{id}` returned unpublished drafts to any signed-in user                                            | Fixed    |
| ADV-6  | Member   | Low      | `/inventory/ws` streamed `{item_id, user_id}` for every issue/assignment/checkout to any authenticated member                                         | Fixed    |
| ADV-7  | Outsider | Low      | Login timing told an outsider which emails have accounts (unknown user ran a hash and a verify, 128 ms, against one verify, 77 ms)                    | Fixed    |
| ADV-8  | Outsider | Low      | The public guest-QR email lookup answered "member" for a member's address                                                                             | Fixed    |
| ADV-9  | Outsider | Info     | The locked-account branch logged the submitted username through an f-string (Pitfall #33)                                                             | Fixed    |
| ADV-10 | Officer  | —        | Emailing temporary passwords at all, and sending reset links to an unverified address                                                                 | Deferred |

## Fixes

- **ADV-1** — A colleague's email change now takes `_enforce_account_reset_ceiling`
  and step-up, as the password, MFA and passkey resets do. It is audited at
  `warning` with both addresses, and the address being replaced is notified
  (own changes included). `notify_security_event` gained a `to_email` override.
- **ADV-2** — `MemberSupervisorService.set_supervisor` refuses
  `supervisor_id == actor_id`; the candidate list leaves the caller out. Other
  assignments by `members.manage` holders are unchanged (owner decision,
  2026-11-08).
- **ADV-3** — Editing an `ALWAYS_SENT_TYPES` template needs `*` plus step-up.
  Its HTML may link only to `FRONTEND_URL`'s host, a lone placeholder,
  `mailto:`/`tel:` or an anchor; a placeholder inside a larger URL, a remote
  image, `srcset`, CSS `url()` and `@import` are refused with the offending
  links named. Every template update and reset is audited with a field diff
  (bodies as a unified diff plus SHA-256 fingerprints).
- **ADV-4** — Callers without `meetings.manage` or `minutes.manage` see only
  approved, non-executive meetings on the list, detail (404 otherwise) and open
  action items — the Minutes API's MM-24 rule. The MCP meeting tools now apply
  it to every principal, as the MCP minutes tools already did.
- **ADV-5** — `include_drafts` is honoured only for `events.manage`; a draft by
  id is a 404 to everyone else. `EV-16`'s statement that "the server decides
  independently who may actually see a draft" is now true.
- **ADV-6** — The socket closes with the final `4003` for callers without
  `inventory.manage`. Both pages that open it are already gated on it.
- **ADV-7** — The three refusing branches call
  `burn_password_verification`, one verify against a hash built once.
- **ADV-8** — A member's address answers exactly as an unknown one; the audit
  row still records the true outcome, and staff entry still keeps members out
  of the pipeline.

## Checked and held

Role/position grants (only-grant-what-you-hold), account-reset ceilings,
template rendering (regex placeholders, no Jinja2), secret masking in settings,
JWT handling and refresh rotation, OAuth state and account linking, MCP OAuth
(exact `redirect_uri`, PKCE S256), webhook signatures, public token entropy,
CORS and `/docs` in production, `dangerouslySetInnerHTML` (DOMPurify),
`subprocess`/`pickle`/`yaml.load`/`eval` (none), audit-log immutability.

## Residual

- The inventory socket still accepts `?token=` for non-browser clients, which
  puts a bearer token in proxy logs; browsers use the cookie.
- Two `members.manage` holders acting together can still make one the other's
  crew's supervisor; each assignment is audited.
- ADV-10 is recorded in `docs/KNOWN_LIMITATIONS.md` for the owner.
