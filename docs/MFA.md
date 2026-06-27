# Multi-Factor Authentication (MFA)

The Logbook supports **app-based TOTP** (Time-based One-Time Password)
two-factor authentication. Members enroll with any standard authenticator app
(Google Authenticator, Authy, 1Password, etc.). MFA is **self-enrolled** by
default, and a department can **require** it for every member.

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

### Disabling MFA

A member disables MFA from Settings → Security by verifying a current
authenticator code (`POST /auth/mfa/disable`). This clears the secret and
recovery codes.

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

| Method & Path | Auth | Purpose |
|---------------|------|---------|
| `POST /auth/login` | none | Password step; returns `{ mfa_required, mfa_token }` when MFA is enabled |
| `POST /auth/mfa/login` | pending token | Verify second factor (`temp_token` + `code` or `recovery_code`); issues session |
| `POST /auth/mfa/setup` | session | Begin enrollment; returns `{ secret, qr_code_url }` |
| `POST /auth/mfa/verify-setup` | session | Confirm code, enable MFA, return one-time recovery codes |
| `POST /auth/mfa/disable` | session | Verify a code and disable MFA |
| `GET /auth/mfa/status` | session | `{ mfa_enabled, recovery_codes_remaining }` |
| `POST /auth/mfa/recovery-codes` | session | Regenerate recovery codes (verifies a TOTP code), returns the new set once |
| `GET /auth/mfa/policy` | `settings.manage` | Read org-wide MFA requirement |
| `PUT /auth/mfa/policy` | `settings.manage` | Set org-wide MFA requirement |
| `POST /users/{user_id}/reset-mfa` | `users.create` / `members.manage` | Admin: reset a member's MFA (lost device) |

## Implementation Notes

- **Service:** `app/services/mfa_service.py` — `generate_secret`,
  `provisioning_uri`, `verify_totp` (±30 s window), `generate_recovery_codes`,
  `normalize_recovery_code`. TOTP via `pyotp`.
- **Pending token:** `create_mfa_pending_token` in `core/security.py`
  (`type: mfa_pending`, short TTL).
- **Storage:** `User.mfa_enabled`, `User.mfa_secret`, `User.mfa_backup_codes`
  — secret and codes encrypted at rest (Fernet via `encrypt_data` /
  `decrypt_data`). No migration was required.
- **Schemas:** `MFASetup`, `MFAVerify`, `MFALogin`, `MFAPolicy` in
  `schemas/auth.py`.
- **Audit:** `mfa_enabled` / `mfa_disabled` /
  `mfa_recovery_codes_regenerated` / `admin_mfa_reset` events logged via
  `log_audit_event` (category `security`).
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

### Admin MFA Reset

An administrator with `users.create` or `members.manage` can reset a member's
MFA for the lost-device case:

- **UI:** Members admin page → the member's **Reset MFA** action (shown only for
  members who currently have MFA enabled).
- **API:** `POST /users/{user_id}/reset-mfa` (org-scoped, rate-limited 5/5 min,
  audit-logged as `admin_mfa_reset`). It clears `mfa_enabled` / `mfa_secret` /
  `mfa_backup_codes` and revokes the member's active sessions so the reset takes
  effect immediately.

After a reset the member re-enrolls from their own **Settings → Security**; if
the org requires MFA, they are prompted to set it up again on next login. Admins
cannot reset their own MFA via this endpoint (use your own Security settings).
