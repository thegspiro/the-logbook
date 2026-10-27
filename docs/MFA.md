# Multi-Factor Authentication (MFA)

The Logbook supports two second factors, and a member may have either or both:

- **Passkeys** _(2026-10-25)_ — a WebAuthn credential on the member's phone or
  computer, unlocked with Face ID, a fingerprint or the device PIN. See
  [Passkeys](#passkeys-webauthn) below.
- **App-based TOTP** (Time-based One-Time Password) with any standard
  authenticator app (Google Authenticator, Authy, 1Password, etc.).

Either one satisfies every MFA requirement, including the floor for
privileged members. Both come after the password (or an SSO sign-in); neither
replaces it. MFA is **self-enrolled** by default, and a department can
**require** it for every member.

`User.mfa_enabled` still means the authenticator app specifically. Every
"does this member have a second factor?" decision goes through
`passkey_service.has_second_factor`, which is `mfa_enabled` or a passkey that
works on this site.

## How It Works

### Enrollment (Settings → Security)

1. The member opens **Settings → Security** and starts MFA setup.
2. The backend generates a secret and an `otpauth://` provisioning URI
   (`POST /auth/mfa/setup` → `{ secret, qr_code_url }`). MFA is **not** enabled
   yet — the secret is stored but inactive.
3. The member scans the QR code in their authenticator app and confirms the
   6-digit code (`POST /auth/mfa/verify-setup`). On success, MFA is enabled and
   a one-time set of **recovery codes** is returned and shown **exactly once**.
4. The member stores the recovery codes somewhere safe. They are never shown
   again (stored hashed/encrypted at rest).

### Login Challenge

1. The member submits username + password to `POST /auth/login`.
2. If the account has MFA enabled, **no session cookies are issued**. The
   response is `{ mfa_required: true, mfa_token }`, where `mfa_token` is a
   short-lived pending token (`type: mfa_pending`).
3. The client completes the second factor at `POST /auth/mfa/login` with the
   pending token (`temp_token`) plus **either** a `code` (6-digit TOTP) **or** a
   `recovery_code`. TOTP verification accepts the current 30-second step ±1 to
   tolerate clock drift. A consumed recovery code is removed from the stored
   set.
4. Only after the second factor verifies are full session cookies issued.

**Wrong codes count toward the account lockout** _(2026-09-28)_. For an MFA
account the password step does not reset `failed_login_attempts`: a correct
password is not full authentication, and resetting there let anyone holding
the password guess four codes, sign in again and guess four more. Each wrong
TOTP or recovery code at `/auth/mfa/login` adds to the same counter the
password step uses; at `MAX_LOGIN_ATTEMPTS` (default 5) the account locks for
`ACCOUNT_LOCKOUT_DURATION_MINUTES` (default 15). Only a successful second
factor clears the count. With `ACCOUNT_LOCKOUT_REVEAL` off (the default) the
member sees only the generic wrong-credentials message, so a help-desk report
reads "my password stopped working". An administrator's password reset clears
the lock, as does `backend/scripts/reset_login_lockout.py <username> --unlock`.
Password-only accounts are unchanged: a correct password clears the count.

### OAuth Logins Are Challenged Too _(2026-08-12)_

"Sign in with Google" / "Sign in with Microsoft" no longer bypasses the second
factor. When the OAuth callback matches an account with `mfa_enabled`:

1. **No session is created** — `create_user_tokens` is never called, no cookies
   are set, no `UserSession` row is written.
2. The callback 302-redirects to the SPA with the same short-lived
   `mfa_pending` token (5 min TTL) the password flow uses, carried in the
   **URL fragment**: `/auth/callback#mfa_token=<jwt>`. Fragments are never sent
   to a server, and `OAuthCallbackPage` strips the token from browser history
   (`history.replaceState`) before navigating.
3. The page stores the challenge in the auth store (`mfaRequired`, `mfaToken`)
   and routes to `/login`, where the existing two-factor form completes
   `POST /auth/mfa/login` — the only endpoint that issues session cookies.
4. Audit: an `oauth_mfa_challenge` event (category `authentication`) records
   the provider and email; the OAuth CSRF `oauth_state` cookie is cleared on
   this branch so an abandoned challenge leaves no stale state.

Why: OAuth verifies only the _primary_ credential. Before this change, a
compromised Google/Microsoft account (or IdP session) yielded a full Logbook
session with the app-level TOTP never consulted.

### Disabling MFA

A member disables MFA from Settings → Security by verifying a current
authenticator code (`POST /auth/mfa/disable`). This clears the secret, and the
recovery codes too unless the member still has a passkey for them to back up.

## Passkeys (WebAuthn)

A member adds up to **three** passkeys from **Settings → Security → Passkeys**
and then confirms sign-in with one instead of typing a code. Passkeys that
sync between devices (iCloud Keychain, Google Password Manager) are accepted.
**User verification is required**: the device must check a biometric or PIN,
not just register a tap. A member at a station computer can use their phone
through the browser's QR-code prompt, which needs Bluetooth on that computer;
the authenticator code works there as before.

### Where passkeys work

A passkey belongs to one domain, and browsers only offer passkeys over HTTPS
on a hostname. The relying party is taken from `FRONTEND_URL`:

| `FRONTEND_URL`                                  | Passkeys                                   |
| ----------------------------------------------- | ------------------------------------------ |
| `https://logbook.example.org` (any port)        | available; domain `logbook.example.org`    |
| `http://localhost:3000`                         | available (development)                    |
| `http://…` on any other host, or any IP address | hidden; members use the authenticator code |

Each passkey records the domain it was created for (`user_passkeys.rp_id`). A
passkey for another domain is listed nowhere and **does not count as a second
factor**, so a member whose only factor it was is treated as not enrolled
rather than asked for a proof their browser cannot give. **Changing the site's
address therefore retires every passkey**: members add new ones, and where
MFA is required they are sent to setup at their next sign-in. See
`docs/UPGRADING.md`.

### Flows

- **Register:** `POST /auth/passkeys/register-options` returns options for
  `navigator.credentials.create()`; `POST /auth/passkeys/register` verifies
  the browser's response and stores the public key. When the passkey is the
  member's **first** second factor the response carries a fresh set of
  recovery codes, shown once. Adding a passkey when the member already has a
  second factor, or removing one, needs a fresh **step-up**.
- **Sign in:** after the password (or SSO) step returns `mfa_token`, the
  client calls `POST /auth/mfa/challenge` for `{ totp, passkey_options }`,
  runs `navigator.credentials.get()` and sends the result to
  `POST /auth/mfa/login` as `passkey_credential`. A failed passkey counts
  toward the account lockout exactly as a wrong code does.
- **Step-up:** `POST /auth/step-up/passkey-options`, then `POST /auth/step-up`
  with `passkey_credential`. A member whose only second factor is a passkey
  cannot step up with their password.
- **Recovery codes** for a passkey-only member are regenerated with
  `POST /auth/passkeys/recovery-codes`, which needs a fresh step-up (a passkey
  cannot be typed into a request body the way a TOTP code can).

Every challenge is stored in `webauthn_challenges` and **deleted by the
response that answers it**, so a captured response cannot be replayed. A
challenge expires after five minutes and is bound to its purpose (`register`,
`login`, `stepup`). At most five are kept per member.

### Organization switch

`org.settings["security"]["passkeys_enabled"]` (default on; read and written
with the MFA policy, `GET`/`PUT /auth/mfa/policy`, shown on `MfaPolicyCard`).
Turning it off stops **new** registrations only. Passkeys already registered
keep working until the member or an administrator removes them, so no member
silently loses their second factor.

## Org-Wide Requirement (Admin)

Administrators with `settings.manage` (or `organization.update_settings`) can
require MFA for the whole department from **Settings → Authentication**
(`MfaPolicyCard`).

- The policy is stored at `org.settings["security"]["mfa_required"]` and read /
  written via `GET`/`PUT /auth/mfa/policy`.
- Enforcement is **server-side** in `get_current_user`: when the org requires
  MFA, a member who has **not** enrolled is blocked from every endpoint except
  the enrollment/session paths until they set up MFA.
- `/auth/me` surfaces `mfa_enrollment_required` so the frontend can force the
  member into the setup flow (`ProtectedRoute` redirect).
- For performance, the org-policy lookup is **skipped** for members who are
  already enrolled — only un-enrolled members trigger the check.

## API Reference

| Method & Path                           | Auth                                        | Purpose                                                                         |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /auth/login`                      | none                                        | Password step; returns `{ mfa_required, mfa_token }` when MFA is enabled        |
| `POST /auth/mfa/login`                  | pending token                               | Verify second factor (`temp_token` + `code` or `recovery_code`); issues session |
| `POST /auth/mfa/setup`                  | session                                     | Begin enrollment; returns `{ secret, qr_code_url }`                             |
| `POST /auth/mfa/verify-setup`           | session                                     | Confirm code, enable MFA, return one-time recovery codes                        |
| `POST /auth/mfa/disable`                | session                                     | Verify a code and disable MFA                                                   |
| `GET /auth/mfa/status`                  | session                                     | `{ mfa_enabled, recovery_codes_remaining }`                                     |
| `POST /auth/mfa/recovery-codes`         | session                                     | Regenerate recovery codes (verifies a TOTP code), returns the new set once      |
| `GET /auth/mfa/policy`                  | `settings.manage`                           | Read org-wide MFA requirement and `passkeys_enabled`                            |
| `PUT /auth/mfa/policy`                  | `settings.manage`                           | Set org-wide MFA requirement; `passkeys_enabled` when present                   |
| `POST /users/{user_id}/reset-mfa`       | `users.create` / `members.manage`           | Admin: reset a member's MFA (lost device), passkeys included                    |
| `POST /auth/mfa/challenge`              | pending token                               | `{ totp, passkey_options }` for the second sign-in step                         |
| `POST /auth/step-up/passkey-options`    | session                                     | A passkey challenge for `POST /auth/step-up`                                    |
| `GET /auth/passkeys`                    | session                                     | The caller's passkeys, the limit, and whether passkeys are available/allowed    |
| `POST /auth/passkeys/register-options`  | session (+ step-up once enrolled)           | Options for creating a passkey                                                  |
| `POST /auth/passkeys/register`          | session (+ step-up once enrolled)           | Store a passkey; first factor returns recovery codes once                       |
| `DELETE /auth/passkeys/{id}`            | session + step-up                           | Remove one of the caller's passkeys                                             |
| `POST /auth/passkeys/recovery-codes`    | session + step-up                           | New recovery codes for a passkey-only member                                    |
| `GET /users/{user_id}/passkeys`         | `users.create` / `members.manage`           | Admin: a member's passkeys (names and dates only)                               |
| `DELETE /users/{user_id}/passkeys/{id}` | `users.create` / `members.manage` + step-up | Admin: remove one passkey (lost phone); signs the member out                    |

## Implementation Notes

- **Service:** `app/services/mfa_service.py` — `generate_secret`,
  `provisioning_uri`, `verify_totp` (±30 s window), `generate_recovery_codes`,
  `normalize_recovery_code`. TOTP via `pyotp`.
- **Pending token:** `create_mfa_pending_token` in `core/security.py`
  (`type: mfa_pending`, short TTL).
- **Storage:** `User.mfa_enabled`, `User.mfa_secret`, `User.mfa_backup_codes`
  — secret and codes encrypted at rest via `encrypt_data` / `decrypt_data`
  (now **AES-256-GCM**; values written under the legacy Fernet scheme still
  decrypt). No migration was required.
- **Schemas:** `MFASetup`, `MFAVerify`, `MFALogin`, `MFAPolicy` in
  `schemas/auth.py`.
- **Audit:** `mfa_enabled` / `mfa_disabled` /
  `mfa_recovery_codes_regenerated` / `admin_mfa_reset` / `passkey_registered` /
  `passkey_removed` / `admin_passkey_removed` events logged via
  `log_audit_event`. Sign-in records `method: password+passkey`, step-up
  `method: passkey`.
- **Passkeys:** `app/services/passkey_service.py` (py_webauthn `webauthn`
  3.0.1), models `UserPasskey` / `WebAuthnChallenge` in `app/models/passkey.py`.
  Frontend: `@simplewebauthn/browser` behind `utils/passkeys.ts`;
  `PasskeySettingsCard`; the passkey button on `LoginPage` and in
  `StepUpProvider`. Safari only shows the prompt from a direct tap, so every
  screen fetches its challenge before the tap rather than inside the handler.
- **Notifications:** `app/utils/security_notifications.py` notifies the affected
  member on each of those events. The in-app notification is written
  synchronously in the request transaction; the email is dispatched to a FastAPI
  background task (`_send_security_email`, its own DB session) so SMTP I/O never
  blocks the response. Both are fire-and-forget — a notification failure never
  blocks the security action.
- **Frontend:** `authService` MFA methods; `authStore` challenge state
  (`mfaRequired`, `mfaToken`, `completeMfaLogin`, `cancelMfa`); the two-factor
  step on `LoginPage`; `MfaSettingsCard` (enrollment) and `MfaPolicyCard`
  (admin toggle).

## Recovery Codes

- Generated once at enrollment and shown a single time.
- Each code is single-use — using one removes it from the stored set.
- `GET /auth/mfa/status` reports `recovery_codes_remaining`.
- **Regenerate:** members can mint a fresh set from **Settings → Security**
  (`POST /auth/mfa/recovery-codes`, requires a current TOTP code). The new set
  replaces the old one (previous codes stop working) and is shown once. The
  Security card warns when codes are running low (≤3) or exhausted.
- **A lost response is retry-safe (AUTH-7).** `verify-setup` and
  `recovery-codes` accept an `Idempotency-Key` header. A retry with the same
  key and the same authenticator code, from the same member, within 10
  minutes, returns the set already issued instead of failing on the spent
  code. A key reused with a different code is refused (422), and a set
  replaced since, or MFA turned off since, is never replayed. The issued
  response is held encrypted with the application key, in Redis when it is
  connected (so any worker can answer the retry) and otherwise in a bounded
  per-process map (`app/core/issued_secrets.py`). Requests without the
  header behave as before. `MfaSettingsCard` sends one key per attempt and
  reuses it when the same code is submitted again.

### Admin MFA Reset

An administrator with `users.create` or `members.manage` can reset a member's
MFA for the lost-device case:

- **UI:** Members admin page → the member's **Reset MFA** action (shown for
  members with an authenticator app or a passkey). The dialog lists the
  member's passkeys, so a single lost phone can be removed without resetting
  everything (`DELETE /users/{user_id}/passkeys/{id}`, audit-logged as
  `admin_passkey_removed`, same privilege ceiling, revokes the member's
  sessions; the member is emailed).
- **API:** `POST /users/{user_id}/reset-mfa` (org-scoped, rate-limited 5/5 min,
  audit-logged as `admin_mfa_reset`). It clears `mfa_enabled` / `mfa_secret` /
  `mfa_backup_codes`, deletes every passkey, and revokes the member's active
  sessions so the reset takes effect immediately.

After a reset the member re-enrolls from their own **Settings → Security**; if
the org requires MFA, they are prompted to set it up again on next login. Admins
cannot reset their own MFA via this endpoint (use your own Security settings).

**Privilege ceiling** _(2026-08-12)_: both admin reset endpoints
(`/reset-password` and `/reset-mfa`) refuse a target whose effective
permissions exceed the caller's. Resetting credentials or stripping MFA is
account takeover by construction, so a `members.manage` holder must not be
able to do it to a `security.manage` admin. The rule: every permission in the
target's effective set (positions + rank defaults, wildcards honored) must be
within the caller's set. A violation returns 403 — "You cannot reset the
account of a user with privileges beyond your own" — and files a
privilege-escalation report. Equal-privilege peers can still be reset, and a
`*` holder can reset anyone. The check runs before the MFA-enabled probe, so
an under-privileged caller can't learn a superior's MFA state from the
400/403 difference.
