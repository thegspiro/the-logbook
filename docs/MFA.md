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
| `GET /auth/mfa/policy` | `settings.manage` | Read org-wide MFA requirement |
| `PUT /auth/mfa/policy` | `settings.manage` | Set org-wide MFA requirement |

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
- **Audit:** `mfa_enabled` / `mfa_disabled` events logged via
  `log_audit_event` (category `security`).
- **Frontend:** `authService` MFA methods; `authStore` challenge state
  (`mfaRequired`, `mfaToken`, `completeMfaLogin`, `cancelMfa`); the two-factor
  step on `LoginPage`; `MfaSettingsCard` (enrollment) and `MfaPolicyCard`
  (admin toggle).

## Recovery Codes

- Generated once at enrollment and shown a single time.
- Each code is single-use — using one removes it from the stored set.
- `GET /auth/mfa/status` reports `recovery_codes_remaining`.
- There is currently no in-app "regenerate codes" flow; a member who exhausts
  their codes and loses their authenticator must have MFA reset by an
  administrator (disable + re-enroll).
