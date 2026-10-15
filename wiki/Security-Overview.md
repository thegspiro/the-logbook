# Security Policy

> **Published copy — not the canonical source.** The maintained original is
> [`SECURITY.md`](https://github.com/thegspiro/the-logbook/blob/main/SECURITY.md)
> in the repository root. Make content changes there first, then mirror them
> here. The Security Monitoring, Intrusion Detection, Data Exfiltration
> Prevention and Network Edge Controls sections are published here only.

## Overview

The Logbook is designed with security as a core principle, implementing industry-standard security practices with features aligned to HIPAA requirements, Section 508 accessibility, and general security best practices. Note: HIPAA compliance requires external review and cannot be self-declared.

## Table of Contents

1. [Security Features](#security-features)
2. [Security Monitoring](#security-monitoring)
3. [Intrusion Detection](#intrusion-detection)
4. [Data Exfiltration Prevention](#data-exfiltration-prevention)
5. [Network Edge Controls](#network-edge-controls)
6. [HIPAA Security Features](#hipaa-security-features)
7. [Section 508 Accessibility](#section-508-accessibility)
8. [Password Security](#password-security)
9. [Data Encryption](#data-encryption)
10. [Audit Logging](#audit-logging)
11. [Authentication & Authorization](#authentication--authorization)
12. [Privacy & Data Subject Rights](#privacy--data-subject-rights)
13. [Records Retention](#records-retention)
14. [Supply Chain Security](#supply-chain-security)
15. [Vulnerability Reporting](#vulnerability-reporting)
16. [Security Best Practices](#security-best-practices)
17. [Incident Response](#incident-response)

---

## Security Features

### Core Security Implementations

✅ **Password Hashing**: Argon2id algorithm (OWASP recommended)
✅ **Data Encryption**: AES-256-GCM authenticated encryption for sensitive data at rest (legacy Fernet values still readable)
✅ **Transport Security**: TLS 1.2 or 1.3 for data in transit (the bundled nginx accepts both)
✅ **Tamper-Proof Logging**: Blockchain-inspired hash chain for audit logs
✅ **Multi-Factor Authentication**: TOTP-based 2FA support
✅ **Role-Based Access Control**: Granular permission system
✅ **Session Management**: Secure token-based authentication with JWT
✅ **Rate Limiting**: Protection against brute force attacks
✅ **Input Sanitization**: XSS and injection attack prevention
✅ **Security Headers**: CSP, HSTS, X-Frame-Options, etc.

---

## Security Monitoring

### Real-Time Security Monitoring

The Logbook includes a comprehensive security monitoring system that provides:

- **Real-time threat detection**: Monitors all requests for suspicious patterns
- **Automated alerting**: Generates security alerts for anomalies
- **Dashboard visibility**: **Administration → Security Alerts** (`/admin/security-alerts`, `audit.view`) lists your department's alerts by state and every recorded data export; holders of `audit.export` acknowledge and resolve alerts there, with an optional resolution note. Both actions are attributed and written to the audit log, and neither can be overwritten by a second officer
- **Log integrity verification**: Scheduled checks for tampering

### Security Monitoring API Endpoints

Access security monitoring through the API:

```
GET  /api/v1/security/status              - Overall security status
GET  /api/v1/security/alerts              - Recent security alerts
POST /api/v1/security/alerts/{id}/acknowledge - Acknowledge an alert
POST /api/v1/security/alerts/{id}/resolve     - Mark alert as resolved (optional {"note": ...})
GET  /api/v1/security/download-activity       - Recent data exports (route, size, member, IP)
GET  /api/v1/security/audit-log/integrity     - Verify log integrity
GET  /api/v1/security/audit-log/status        - Get audit log statistics
POST /api/v1/security/audit-log/checkpoint    - Create integrity checkpoint
GET  /api/v1/security/intrusion-detection/status - IDS status
GET  /api/v1/security/data-exfiltration/status   - DLP status
POST /api/v1/security/manual-check              - Trigger manual security check
```

### Security Alert Types

| Alert Type               | Threat Level  | Description                         |
| ------------------------ | ------------- | ----------------------------------- |
| `brute_force`            | HIGH          | Multiple failed login attempts      |
| `session_hijack`         | CRITICAL      | Potential session takeover detected |
| `data_exfiltration`      | HIGH/CRITICAL | Large or suspicious data transfers  |
| `log_tampering`          | CRITICAL      | Audit log integrity failure         |
| `anomaly_detected`       | MEDIUM        | Unusual patterns detected           |
| `unauthorized_access`    | HIGH          | Access to restricted resources      |
| `privilege_escalation`   | CRITICAL      | Unauthorized permission changes     |
| `suspicious_activity`    | HIGH          | Injection attempts, etc.            |
| `external_data_transfer` | CRITICAL      | Data sent to external endpoints     |
| `rate_limit_exceeded`    | MEDIUM        | Too many requests                   |

### Configurable Thresholds

Security monitoring thresholds can be configured:

| Threshold                | Default | Description                         |
| ------------------------ | ------- | ----------------------------------- |
| `failed_logins_per_hour` | 10      | Max failed logins per IP per hour   |
| `failed_logins_per_user` | 5       | Max failed logins per user per hour |
| `api_calls_per_minute`   | 60      | Max API calls per minute            |
| `large_data_export_mb`   | 50      | Alert threshold for data exports    |
| `session_ip_changes`     | 2       | Max IP changes per session          |

---

## Intrusion Detection

### Attack Pattern Detection

The system monitors for common attack patterns:

#### SQL Injection Detection

- Monitors for patterns like `' OR '1'='1`, `; DROP TABLE`, `UNION SELECT`
- All requests are analyzed before processing
- Alerts generated on detection

#### XSS Detection

- Detects `<script>`, `javascript:`, `onerror=`, etc.
- Input sanitization enforced on server-side
- CSP headers prevent execution

#### Path Traversal Detection

- Blocks `../`, `..\\`, and encoded variants
- Validates all file paths server-side

#### Command Injection Detection

- Detects shell metacharacters in inputs
- All external commands parameterized

### Session Monitoring

Session hijacking detection through:

- IP address correlation
- User agent consistency checks
- Geographic anomaly detection
- Rapid IP change detection (within 5 minutes)

### Brute Force Detection

Multi-layer brute force protection:

1. **Per-IP Rate Limiting**: Tracks failed logins by IP
2. **Per-User Rate Limiting**: Tracks failed logins by username
3. **Account Lockout**: 15-minute lockout (default) after `MAX_LOGIN_ATTEMPTS` consecutive failures; wrong two-factor codes count toward it
4. **Alert Generation**: Notifies administrators

---

## Data Exfiltration Prevention

### Monitoring Capabilities

The system monitors for data exfiltration through:

1. **Large Data Exports**: Alerts when exports exceed threshold (default 50MB)
2. **Bulk Record Access**: Flags access to large numbers of records
3. **External Destinations**: Detects data transfers to non-internal IPs
4. **Cumulative Tracking**: 24-hour rolling window for total transfers

### Protected Endpoints

Every API route whose path contains `export` is monitored — the list lives in
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` (fixed paths) and
`EXPORT_ENDPOINT_TEMPLATES` (paths with an id in them), and a test fails the
build when a new export route is missing from either. Each completed export is
sized from the bytes actually sent (streamed CSVs included) and recorded as a
`data_export` audit event holding the route, the byte count, the member and
the IP address. The exported content and the request's query string are never
recorded — a search term can name a member.

### Alert Triggers

| Trigger              | Threshold     | Threat Level |
| -------------------- | ------------- | ------------ |
| Single large export  | > 50MB        | HIGH         |
| 24-hour cumulative   | > 250MB       | CRITICAL     |
| External destination | Any           | CRITICAL     |
| Bulk record access   | > 100 records | MEDIUM       |

### Response Actions

When data exfiltration is detected:

1. Alert generated and logged
2. Administrator notified
3. Event recorded in tamper-proof audit log
4. Optional: Block further transfers (configurable)

---

## Network Edge Controls

### Client IP Resolution

`get_client_ip()` reads `X-Forwarded-For` only when the request arrives from
a proxy listed in `TRUSTED_PROXY_IPS` (CIDR ranges allowed), so a client
cannot spoof its address. Rate limits, geo-blocking and the IP recorded in
audit events all use it — behind a reverse proxy, set `TRUSTED_PROXY_IPS` or
every request appears to come from the proxy.

### Geo-Blocking (Platform-Edge Control)

GeoIP-based country blocking is a **platform-edge control**: it runs in
middleware before any tenant/authentication context exists, against one shared
MaxMind database and one global blocked-country set, so it applies
deployment-wide rather than per-organization:

- The blocklist is set at deploy time via `BLOCKED_COUNTRIES`. Runtime
  block/unblock via the API (`POST`/`DELETE /api/v1/ip-security/blocked-countries`,
  overlaid onto `CountryBlockRule` rows) is **disabled by default** and enabled
  only when the operator sets `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT=true` —
  because a change affects every tenant
- Approved IP exceptions are recorded but **not** read by enforcement — the
  middleware passes an empty allowlist, because it runs before any tenant
  context exists and one organization's exception would otherwise relax the
  block for every tenant — so an approved address is still blocked if its
  country is
- **Fail-open by default, or fail-closed via `GEOIP_FAIL_CLOSED`**: when set,
  an IP whose country can't be resolved (including a missing/corrupt MaxMind
  DB) is blocked; private/reserved IPs are always allowed so an internal
  operator can recover

### Outbound Requests (SSRF)

Integrations reach only global, non-multicast addresses. The shared
integration client (`app/utils/ssrf_transport.py`) resolves a hostname once,
refuses unless every answer is a public address, and connects to that address
with the original hostname kept for the Host header and TLS SNI — so a
DNS-rebinding host cannot pass the check with a public address and connect to
an internal one. It covers Teams, webhook, Slack, Discord, Cal.com, Documenso
and audit shipping. `AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION` lifts only the
public-address rule for the audit collector; a cloud metadata address is
still refused. Requests sent through a configured proxy are not pinned,
because the proxy does the resolving (see `docs/KNOWN_LIMITATIONS.md`).

---

## HIPAA Security Features

### Overview

The Logbook includes security features designed with HIPAA requirements in mind for organizations handling Protected Health Information (PHI). However, **HIPAA compliance cannot be self-declared** — it requires external audit and assessment. Compliance is a shared responsibility between the software, the implementing organization, and qualified external reviewers.

### HIPAA Security Rule - Technical Safeguards

#### Access Control (§ 164.312(a)(1))

- ✅ **Unique User Identification**: Each user has a unique identifier
- ✅ **Emergency Access Procedure**: Admin override capabilities for emergencies
- ✅ **Automatic Logoff**: Configurable session timeout (default: 15 minutes)
- ✅ **Encryption and Decryption**: AES-256-GCM for PHI at rest

#### Audit Controls (§ 164.312(b))

- ✅ **Tamper-Proof Logging**: Cryptographic hash chain prevents log modification
- ✅ **Comprehensive Events**: All access to PHI is logged
- ✅ **7-Year Retention**: Audit logs retained for minimum 7 years (2555 days)
- ✅ **Regular Monitoring**: Automated log integrity verification

#### Integrity (§ 164.312(c)(1))

- ✅ **Hash Chain Verification**: Detect unauthorized modifications
- ✅ **Checkpoints**: Periodic integrity snapshots
- ✅ **Version Control**: Track all changes to sensitive data

#### Person or Entity Authentication (§ 164.312(d))

- ✅ **Strong Password Policy**: Enforced complexity requirements
- ✅ **Multi-Factor Authentication**: Optional TOTP 2FA
- ✅ **Account Lockout**: Automatic lockout after failed attempts
- ✅ **Password History**: Prevents password reuse (12 previous passwords)

#### Transmission Security (§ 164.312(e)(1))

- ✅ **TLS 1.2+**: Encrypted data in transit (the bundled nginx accepts TLS 1.2 and 1.3)
- ✅ **Integrity Controls**: Hash verification for transmitted data
- ✅ **End-to-End Encryption**: For sensitive communications

### HIPAA Security Rule - Administrative Safeguards

Organizations implementing The Logbook must also implement:

#### Required by Organization:

- [ ] **Security Management Process** - Risk analysis and management
- [ ] **Assigned Security Responsibility** - Designated security official
- [ ] **Workforce Security** - Authorization and supervision procedures
- [ ] **Information Access Management** - Access authorization policies
- [ ] **Security Awareness Training** - Staff training programs
- [ ] **Security Incident Procedures** - Response and reporting procedures
- [ ] **Contingency Plan** - Disaster recovery and backups
- [ ] **Evaluation** - Regular security assessments

### HIPAA Privacy Rule Considerations

#### Minimum Necessary Standard

The system supports:

- Role-based access control to limit PHI access
- Granular permissions for different user roles
- Audit trails showing who accessed what data

#### Individual Rights

The system supports:

- Data export capabilities for individual access requests
- Audit logs for accounting of disclosures
- Data amendment tracking

### Business Associate Agreements (BAAs)

If you use third-party services (cloud hosting, email, SMS), ensure you have BAAs in place:

- Cloud hosting providers (AWS, Azure, GCP)
- Email service providers
- SMS notification services
- Backup and storage services
- Analytics services (if processing PHI)

### Security Checklist (Aligned with HIPAA Requirements)

#### Initial Setup

- [ ] Change all default passwords
- [ ] Generate strong SECRET_KEY, ENCRYPTION_KEY, and ENCRYPTION_SALT
- [ ] Enable HTTPS/TLS in production
- [ ] Configure automatic session timeout
- [ ] Set up secure backup procedures
- [ ] Enable audit logging
- [ ] Configure email encryption (if sending PHI)
- [ ] Implement physical security for servers
- [ ] Create incident response plan
- [ ] Obtain BAAs from third-party services

#### Ongoing Compliance

- [ ] Conduct regular risk assessments (annually minimum)
- [ ] Perform security audits (annually minimum)
- [ ] Review and update access controls (quarterly)
- [ ] Train staff on HIPAA requirements (annually)
- [ ] Test disaster recovery plan (semi-annually)
- [ ] Review audit logs (weekly/monthly)
- [ ] Update software and dependencies (monthly)
- [ ] Verify backup integrity (monthly)
- [ ] Review user access lists (quarterly)
- [ ] Document all security incidents

---

## Section 508 Accessibility

### Overview

The Logbook is designed to meet Section 508 accessibility standards, ensuring usability for individuals with disabilities.

### WCAG 2.1 Level AA Compliance

The platform implements:

#### Perceivable

- ✅ **Text Alternatives**: All images have alt text
- ✅ **Captions**: Video/audio content includes captions
- ✅ **Adaptable**: Content can be presented in different ways
- ✅ **Distinguishable**: Text has sufficient contrast ratios (4.5:1 minimum)

#### Operable

- ✅ **Keyboard Accessible**: All functionality via keyboard
- ✅ **Enough Time**: Adjustable time limits for interactions
- ✅ **Seizure Prevention**: No content that flashes more than 3 times per second
- ✅ **Navigable**: Multiple ways to find content, clear navigation

#### Understandable

- ✅ **Readable**: Clear language, definitions for jargon
- ✅ **Predictable**: Consistent navigation and behavior
- ✅ **Input Assistance**: Error identification and suggestions

#### Robust

- ✅ **Compatible**: Works with assistive technologies
- ✅ **Valid HTML**: Proper semantic markup
- ✅ **ARIA Labels**: Screen reader support

### Accessibility Testing

Regular testing should include:

- Keyboard-only navigation testing
- Screen reader testing (NVDA, JAWS, VoiceOver)
- Color contrast verification
- Browser zoom testing (200% minimum)
- Mobile accessibility testing

### Accessibility Features

- Skip to main content links
- Proper heading hierarchy (H1, H2, H3, etc.)
- Form labels and fieldset legends
- Focus indicators for all interactive elements
- Meaningful link text (no "click here")
- Error messages that are clear and specific
- Alternative text for all informative images
- Keyboard shortcuts documented and configurable
- High contrast mode support
- Text resize support (up to 200%)

---

## Password Security

### Password Requirements

**Minimum Standards (configurable in .env):**

- Minimum length: 12 characters (NIST SP 800-63B recommendation)
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Not a common password

### Password Storage

- **Hashing Algorithm**: Argon2id
- **Salt**: Automatically generated unique salt per password
- **Work Factor**: Configured for ~500ms hash time
- **No Plain Text**: Passwords are NEVER stored in plain text
- **No Passwords in Logs**: Temporary passwords are never written to application logs
- **Onboarding Encryption**: Email passwords and API keys entered during onboarding are encrypted (AES-256-GCM) before database storage

### Password Policies

- **History**: Last 12 passwords remembered
- **Age**: Maximum 90 days between changes (configurable)
- **Complexity**: Enforced on client and server side
- **Lockout**: 5 consecutive failed attempts (`MAX_LOGIN_ATTEMPTS`) lock the account for 15 minutes (`ACCOUNT_LOCKOUT_DURATION_MINUTES`). The sign-in screen keeps showing the generic "Incorrect username or password" unless `ACCOUNT_LOCKOUT_REVEAL` is enabled, so it never confirms an account exists
- **Reset**: Secure password reset with time-limited tokens

### Best Practices for Users

1. Use a password manager
2. Enable multi-factor authentication
3. Never share passwords
4. Use unique passwords for each system
5. Change passwords if compromise suspected

---

## Data Encryption

### Encryption at Rest

**Algorithm**: AES-256-GCM (authenticated encryption — confidentiality plus an integrity tag, fresh random 96-bit nonce per value). Data written before the AES-256-GCM migration used Fernet (AES-128-CBC + HMAC-SHA256) and remains readable; `backend/scripts/reencrypt_to_aesgcm.py` (dry-run by default) re-encrypts it to AES-256-GCM — see the operator runbook `docs/AES256_GCM_BACKFILL_RUNBOOK.md`.

**What is Encrypted:**

- Medical-screening PHI (`screening_records`: provider, result summary, structured results, notes)
- Officer evaluation narrative on shift completion reports
- MFA secrets and recovery codes, applicant status tokens
- Integration, external-training-provider, email, file-storage and OAuth secrets
- Every uploaded file stored under the uploads root (per-file AES-256-GCM key)

Passwords are not encrypted but hashed (Argon2id). Other member data — names,
contact details, dates of birth — is protected by access control, not field
encryption. The full list is in
[Encryption → What Is Encrypted](Security-Encryption#what-is-encrypted).

**Key Management:**

- Encryption keys stored in environment variables
- Never committed to version control (`.env` files are in `.gitignore`)
- Rotated regularly (recommended: every 90 days)
- Consider using a key management service (AWS KMS, Azure Key Vault, HashiCorp Vault)

**Onboarding Session Encryption:**

- Email configuration (SMTP passwords, OAuth secrets) encrypted before storage
- File storage configuration (AWS keys, Azure keys) encrypted before storage
- Only platform type identifiers are stored in plain text
- Encrypted data uses the same AES-256-GCM cipher as field-level encryption

### Encryption in Transit

**TLS** for all network communications (the bundled nginx accepts TLS 1.2 and 1.3):

- HTTPS for web traffic
- TLS for database and Redis connections (`DB_SSL` / `REDIS_SSL`). In
  production and staging, startup refuses to boot with either off unless
  `SECURITY_REQUIRE_TLS=false` records the accepted risk, and refuses to boot
  with either on but no CA (`DB_SSL_CA` / `REDIS_SSL_CA`, so the server
  certificate would go unverified) unless `SECURITY_ALLOW_UNVERIFIED_TLS=true`
- Encrypted email (STARTTLS)
- VPN for admin access to servers

---

## Audit Logging

### Tamper-Proof Logging System

The Logbook implements a blockchain-inspired **keyed** hash chain for audit logs:

```
Log Entry 1: Hash = HMAC-SHA256(key, Data1 + "0000...")
Log Entry 2: Hash = HMAC-SHA256(key, Data2 + Hash1)
Log Entry 3: Hash = HMAC-SHA256(key, Data3 + Hash2)
```

The chain is keyed with the audit signing key (`AUDIT_LOG_SIGNING_KEY`, falling back to `SECRET_KEY`), so forging it requires the key, not merely database write access. Pre-upgrade rows verify under the legacy unkeyed SHA-256 scheme. The `rehash_chain` recovery op is break-glass (gated by `AUDIT_ALLOW_CHAIN_REHASH`), repairs only legacy rows, and fails closed on a keyed-row mismatch. This makes it impossible to modify historical logs without detection.

### What is Logged

#### Authentication Events

- Sign-in (success and failure), including OAuth
- Sign-out
- Password resets (a self-service password change is not audited)
- MFA enable/disable
- Account lockouts and unlocks

#### Data Access

- PHI access (view, edit, delete)
- Document downloads
- Report generation
- Export operations
- Search queries (if sensitive)

#### Administrative Actions

- User creation/modification/deletion
- Role changes
- Permission modifications
- System configuration changes
- Module enable/disable

#### Security Events

- Failed authorization attempts
- Rate limit violations
- Suspicious activity
- Security setting changes

### Log Retention

- **Minimum**: 7 years (exceeds HIPAA 6-year minimum)
- **Format**: Immutable, tamper-evident
- **Storage**: Hash-chained in the database; rows past retention are exported to `AUDIT_ARCHIVE_DIR` (owner-only file permissions) before purge
- **Backup**: Included in disaster recovery
- **Access**: Restricted to authorized personnel

### Log Monitoring

Automated monitoring for:

- Multiple failed login attempts
- After-hours access to PHI
- Bulk data exports
- Unusual access patterns
- Permission escalation attempts
- System configuration changes

---

## Authentication & Authorization

### Authentication Methods

1. **Username/Password**
   - Argon2id hashed passwords
   - Complexity requirements enforced
   - Account lockout after failed attempts

2. **Multi-Factor Authentication (MFA)**
   - TOTP (Time-based One-Time Password) via any authenticator app
   - QR code (`otpauth://`) enrollment, confirmed with a 6-digit code
   - One-time recovery codes (shown once, stored hashed)
   - Login challenge: MFA-enabled accounts receive a short-lived `mfa_token`
     and must complete `POST /auth/mfa/login` before session cookies are issued
   - Self-enrollment from Settings → Security; admins can require MFA org-wide
     (Settings → Authentication), enforced server-side in `get_current_user`
   - Secret and recovery codes encrypted at rest

3. **OAuth 2.0 / SSO (OIDC)**
   - Microsoft Azure AD
   - Google Workspace
   - SAML and LDAP/Active Directory are **not currently implemented**
     (planned; the `LDAP_*` settings in `.env.example.full` are inert
     placeholders until then)

### Session Management

- **Token Type**: JWT (JSON Web Tokens)
- **Access Token Lifetime**: 30 minutes by default (`ACCESS_TOKEN_EXPIRE_MINUTES`; the refresh flow renews it silently)
- **Refresh Token Lifetime**: 7 days by default (`REFRESH_TOKEN_EXPIRE_DAYS`)
- **Automatic Logout**: 15 minutes inactivity (configurable, aligned with HIPAA recommendation)
- **Session Revocation**: Manual logout or admin revoke; a password change signs the member out of every session

### Role-Based Access Control (RBAC)

#### Default Positions

31 system positions are seeded (`DEFAULT_POSITIONS` in
`backend/app/core/permissions.py`) — command ranks (Chief through
Lieutenant), operational ranks (Engineer / Driver Operator, Firefighter, EMT),
administrative officers (President, Secretary, Treasurer, Board of Directors,
IT Manager and others), functional coordinators (Training Officer,
Quartermaster, Membership Coordinator, Safety Officer, Scheduling Officer and
others), and **Member**, the baseline every member holds. Departments can
edit them and add their own.

#### Permission Granularity

Permissions are dot-notation strings, `module.action`, with module-level
(`module.*`) and global (`*`) wildcards. Examples:

- `apparatus.view`
- `members.manage`
- `settings.manage`
- `audit.view`
- `audit.export`

---

## Public Form Security

### Overview

The Logbook supports public-facing forms that can be accessed without authentication via unique URL slugs (`/f/:slug`). These forms require additional security measures since they are exposed to the public internet.

### Protection Layers

#### Input Sanitization

- All submitted values are HTML-escaped before storage (prevents stored XSS)
- Null bytes are stripped from all input
- Per-field length limits enforced (5,000 chars for text, 50,000 for textarea, 254 for email)
- Submitter name and email are independently sanitized

#### Type-Specific Validation

- **Email fields**: Format validation + header injection prevention (rejects newlines/carriage returns)
- **Phone fields**: Character whitelist (digits, +, -, parentheses, spaces only)
- **Number fields**: Range validation against configured min/max values
- **Select/Radio/Checkbox fields**: Values validated against the form's allowed options (prevents arbitrary value injection)
- **Regex patterns**: Optional custom validation patterns per field

#### Rate Limiting

- **Form views**: 60 requests per minute per IP (5-minute lockout)
- **Form submissions**: 10 requests per minute per IP (10-minute lockout)
- Uses the application's existing in-memory rate limiter infrastructure

#### Bot Detection

- **Honeypot field**: A hidden `website` field is included in public forms
- Real users never see or fill this field (positioned off-screen, `aria-hidden`, `tabIndex=-1`)
- Bots that auto-fill all fields will populate it, triggering silent rejection
- Rejected submissions receive a fake success response to avoid tipping off the bot

#### Slug Validation

- Form slugs are validated against a strict regex pattern (`^[a-f0-9]{12}$`)
- Invalid slugs are rejected with a 404 before any database query executes
- Prevents path traversal, SQL injection, and other injection attacks via the URL

#### Frontend Defense-in-Depth

- All server-provided text (form names, descriptions, field labels, help text) is sanitized through DOMPurify before display
- DOMPurify strips all HTML tags and attributes, complementing React's built-in JSX escaping
- Public form page uses a separate React component with no access to authenticated application state

#### Data Isolation

- Public form submissions are marked with `is_public_submission = true`
- IP address and user agent are captured for audit purposes
- `member_lookup` field types are excluded from public form display
- Internal field IDs (UUIDs) are exposed but contain no sensitive information

---

## Guest Event Check-In Security

### Overview

`Event.allow_guest_check_in` opts a single event into a **second, unauthenticated
write path**: `POST /api/public/v1/display/{display_code}/events/{event_id}/guest-check-in`,
reached by scanning a guest QR code on a room display. It exists so a visitor at a
volunteer interest night can record their own attendance without an account.

**It is off by default, and opt-in per event, precisely because turning it on
exposes a write path to anyone who can reach that QR code.** It belongs on
outreach events and must stay off for business meetings and training sessions,
whose attendance drives records that only apply to members.

### Protection Layers

#### Tenant Resolution — the important one

- The organization is resolved from the **room's display code**, never from
  anything in the request body. An anonymous caller cannot name the organization
  it writes to.
- The event must actually be **held in that room**, so a valid display code
  cannot be used to sign people in to an event elsewhere.
- The event must have `allow_guest_check_in` set. Anything else is a `404`.

#### Rate Limiting

- Per-IP limiting on both the read and the write, reusing the display endpoint's
  existing limiter.
- **Per-event daily ceiling** — `GUEST_CHECK_IN_DAILY_LIMIT`, default `300`, `0`
  disables it. Per-IP limiting alone cannot stop a distributed flood, and each
  sign-in can create a pipeline record, which is a far more expensive side effect
  than a page view. Exceeded → `429`.

#### Bot Detection

- Hidden `hp_website` honeypot field, named to look attractive to a form-filler.
- A populated honeypot is answered with a **plausible `201` success** and nothing
  is written — the same pattern the public forms endpoint uses. A bot that
  receives a rejection learns which field to stop filling; one that receives a
  confirmation has no signal to adapt to.

#### Input Constraints

- `first_name` / `last_name`: 1–100 chars, trimmed, blank-after-trim rejected.
- `email`: validated `EmailStr`, normalized to lowercase before matching.
- `phone` ≤ 50, `organization_name` ≤ 255, `interest_reason` ≤ 2000.
- Nothing richer is accepted. A walk-in is asked for the minimum needed to follow
  up, not for a membership application.

#### Timing

- Guests are held to the organizer's configured check-in window **minus the
  early-arrival grace members get**. A member checking in early is identifiable
  and correctable; an anonymous early write is neither, so the gate stays shut
  until the window the organizer actually chose. Outside the window → `400`.

#### Information Disclosure

- The `GET` companion exposes only what a visitor standing in the room can
  already see: event name, type, start/end, room, department name, and whether
  sign-in is open. **The event description is withheld**, matching the kiosk
  display.
- The department timezone is returned so an unauthenticated tablet renders local
  times rather than falling back to the device's zone.

#### Failure Containment

- Pipeline creation failures are **logged and swallowed** — they never cost a
  guest their attendance, and they never surface an internal error to an
  anonymous caller.
- `event_external_attendees.prospect_id` is `ON DELETE SET NULL`, so purging a
  prospect (retention, withdrawal) never destroys the record of who was in the
  room.

### QR Code Access

Public forms support QR code generation for physical distribution:

- QR codes encode the full public URL including the form slug
- Downloadable as PNG or SVG for printing
- Error correction level "H" (high) for reliability when scanned from printed materials
- Designed for placement in physical locations (inventory rooms, station entrances, etc.)

---

## Election & Voting Security

### Double-Voting Prevention

The election system uses database-level constraints to prevent double-voting:

- **4 Partial Unique Indexes**: Unique indexes on the votes table enforce one vote per user per ballot at the database level — prevents race conditions and direct database manipulation
- **IntegrityError Handling**: `cast_vote()` catches constraint violations and returns a user-friendly error message instead of a 500 error
- **Anonymous Voting**: Votes are linked to users via HMAC-SHA256 hashed identifiers, preventing direct association between votes and voters while still enforcing uniqueness

### Election Results Timing

- Results require both `status=CLOSED` AND `end_date` to have passed before vote counts are revealed
- During active elections, only aggregate ballot statistics (turnout, total votes cast) are visible
- Prevents premature result leaks that could influence remaining voters

### Authentication & Token Security

- **Token Storage**: Auth tokens live in **httpOnly cookies** set by the backend and are never readable by JavaScript. Only a non-sensitive `has_session` flag is kept in localStorage, to decide whether a page refresh should attempt to restore the session. CSRF is handled by double-submit (`csrf_token` cookie echoed as an `X-CSRF-Token` header on state-changing requests)
- **Onboarding session storage**: The onboarding identifier is kept in **`sessionStorage`** (`onboarding_session_id`), not localStorage. It is a bearer credential — sent as `X-Session-ID`, it authorizes the setup mutations that create the organization, its stations and apparatus, the IT team, and the first System Owner — so it must not survive a browser restart or be readable from unrelated tabs on a shared or station-kiosk machine. Identifiers written by older clients are deleted on load and on clear. Its CSRF companion (`onboarding_csrf_token`) is a `SameSite=Strict` cookie, and the server-side session carries a 30-minute sliding expiry. The wizard's non-sensitive answers (`onboarding-storage`) remain in localStorage by design, which is why a restarted browser can repaint the form while the session behind it is gone — see [`docs/ONBOARDING_FLOW.md`](../docs/ONBOARDING_FLOW.md)
- **Concurrent Refresh Protection**: Multiple simultaneous 401 responses share a single token refresh promise — prevents replay detection from invalidating the session
- **Account Lockout**: Failed login counter persists correctly via explicit database commit (not rolled back by HTTPException)
- **Session Revocation**: Logout properly invalidates the server-side session record

For a comprehensive security review of this module, see
[`docs/module-audit/elections.md`](../docs/module-audit/elections.md).

---

## Error Handling & Information Disclosure Prevention

### API Error Responses

All API endpoints follow a strict policy of **never exposing internal details** in error responses:

- **500 errors**: Return generic messages (e.g., `"Please check the server logs for details."`) instead of raw exception strings that could reveal database queries, file paths, or system configuration
- **Validation errors (400/422)**: Return controlled validation messages from the application's business logic, not raw framework errors
- **Health endpoint**: Reports service status (`"connected"`, `"disconnected"`, `"error"`) without including raw error messages from database or Redis connection failures

### Logging Security

- **No passwords in logs**: Temporary passwords are never logged. User creation only logs that a welcome email was requested.
- **Uniform authentication failures**: Login failure logs do not distinguish between "user not found", "invalid password", or "no password set", preventing username enumeration via log analysis. All failures log as `"Authentication failed for login attempt"`.
- **Account lockout events**: These are the exception — they include the username because they are security incidents that require investigation.
- **Request body sanitization**: The security monitoring middleware reads request bodies for threat detection, but sensitive fields are not persisted to logs.

### Frontend Security

- **Production console logging**: Error details (error context, user information) are only logged to the browser console in development mode. Production builds log only the step name and error message.
- **Per-session obfuscation keys**: The frontend obfuscation utility generates a random key per browser session instead of using a hardcoded default, ensuring each session has a unique key.
- **VITE\_\* variable safety**: Only non-secret values (API URLs, feature flags) are exposed via Vite environment variables. Secrets must never use the `VITE_` prefix.

### Environment & Configuration

- **`.env` files excluded from git**: `.gitignore` includes `.env`, `.env.local`, and `.env.*.local` to prevent accidental secret commits
- **`.env.example` files**: Contain only placeholder text (`CHANGE_ME_GENERATE_WITH_STEP_2_ABOVE`), never real secrets
- **Security key validation**: Startup checks flag any `SECRET_KEY` or `ENCRYPTION_KEY` containing `"INSECURE_DEFAULT"` as a critical issue

---

## Privacy & Data Subject Rights

Aligned with ISO/IEC 27701 and the HIPAA right of access. See
[docs/COMPLIANCE.md](../docs/COMPLIANCE.md) for the full control inventory.

### Personal data export (portability)

Members download everything the system holds about them from
**Settings → Security → Your Data** (`GET /users/me/data-export`): profile and
emergency contacts, training and certifications, attendance, admin hours,
leaves, medical screening records, skill tests, dues, equipment custody,
consents, and evaluations written about them. The export is self-scoped by
construction — there is no route to another member's data — rate limited to
3/hour, and audited. Credentials, MFA secrets, and unguessable tokens are
never exported; audit history is summarized rather than dumped.

### Anonymization (right to erasure)

`POST /users/{id}/anonymize` (requires `members.manage`, refused for active
members and for self) irreversibly scrubs a departed member's identity while
preserving the operational history a department must keep:

| Scrubbed                                                                                                           | Retained                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Names, username, email (replaced with per-member tokens), phone, address, date of birth, photo, emergency contacts | Training completions, certifications, attendance counts, service hours |
| Credentials, MFA secrets, OAuth linkage, calendar/reset tokens; sessions and password history deleted              | Property custody and departure clearance records                       |
| Medical screening content (results, notes, provider)                                                               | Screening status and dates, as compliance proof                        |
| Free-text reasons on leaves, waivers, time-off, meeting waivers; RSVP dietary/accessibility notes                  | Leave types and date ranges (compliance denominators)                  |
| Body measurements; the applicant-era prospect record, its interview notes and uploaded documents                   | Dues and financial records                                             |

**Never touched:** audit logs (append-only and hash-chained — rewriting them
is tampering; the anonymization event itself records only the user id, never
the name) and election records (ballot integrity signatures).

### Consent

Optional processing is consent-gated: photo use, public roster listing, and
SMS notifications (TCPA requires express consent for text messaging). Members
manage these at **Settings → Security → Privacy Choices**. Current state lives
in `user_consents`; every change is written to the tamper-evident audit log as
`consent_updated`, which serves as the immutable consent ledger. **A member who
was never asked is treated exactly like one who refused** — consumers of a
consent must fail closed.

---

## Records Retention

Retention is configurable per organization rather than hardcoded, because
statutory retention for fire-service records varies by state (ISO 15489).

- **Business records** — each managed record class (message history,
  notification logs, error logs, form submissions, guest check-ins, practice
  skills tests) has a safe default and a **minimum floor** that a typo cannot
  go below; the floor is re-applied at enforcement time so settings edited
  outside the API cannot bypass it. Read with
  `GET /organization/retention-policy`, set one class at a time with
  `PUT /organization/retention-policy/{record_class}` (audited), enforced
  daily. The full table is in
  [Privacy & Data Protection](Security-Privacy#records-retention).
- **Documents and meeting minutes are deliberately excluded** from automatic
  deletion. Destroying official records on a timer is a department decision
  belonging in its own retention schedule, executed by a human.
- **Audit records** — retained 7 years (`HIPAA_AUDIT_RETENTION_DAYS`).
  Expired rows are exported to signed archives before purging; the purge is
  checkpoint-aligned, refuses to run on a chain that fails verification, and
  records a keyed attestation so the surviving chain still verifies while
  unsanctioned deletions still fail. **Include `AUDIT_ARCHIVE_DIR` in your
  backups — after a purge it is the only copy of the oldest audit history.**
- **Platform telemetry** — blocked-access attempts (IP + user agent) age out
  per `RETENTION_BLOCKED_ATTEMPTS_DAYS` (default 365).

---

## Supply Chain Security

Continuous, and blocking where a fix exists (ISO/IEC 27001 A.8.8):

| Control               | Tool       | Behavior                                                            |
| --------------------- | ---------- | ------------------------------------------------------------------- |
| Python SAST           | Bandit     | Reported in CI, artifact uploaded                                   |
| Python dependencies   | pip-audit  | **Blocking**; documented deferrals only                             |
| Frontend dependencies | npm audit  | **Blocking at high severity**                                       |
| Cross-ecosystem sweep | Trivy      | **Blocking** on HIGH/CRITICAL with a fix available; weekly schedule |
| Secret scanning       | gitleaks   | Full history, weekly + per-PR                                       |
| Dependency updates    | Dependabot | Weekly PRs (pip, npm, actions, docker)                              |
| Bill of materials     | Syft       | SPDX SBOM published as a CI artifact each run                       |

---

## Vulnerability Reporting

### Discovering our contact (RFC 9116)

Every deployment serves a machine-readable disclosure pointer at
`/.well-known/security.txt`, listing the department's security contact, this
policy, and an expiry date. Departments set their own contact with
`SECURITY_TXT_CONTACT` (an email address or a reporting URL); unset, it points
researchers at the upstream project's GitHub security-advisory intake. This
follows ISO/IEC 29147 (vulnerability disclosure).

### Responsible Disclosure

We take security seriously. If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. **DO NOT** discuss publicly before fix is deployed
3. Email security reports to the address in `/.well-known/security.txt`
   (default upstream: a GitHub security advisory)
4. Provide detailed information:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Severity Assessment**: Within 5 business days
- **Fix Development**: Based on severity
  - Critical: 24-72 hours
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next regular release
- **Disclosure**: After fix is deployed

### Bug Bounty

Currently no formal bug bounty program, but we may offer:

- Public acknowledgment (if desired)
- Contribution credit
- Swag/merchandise

---

## Security Best Practices

### Deployment

#### Infrastructure Security

1. **Network Security**
   - Use firewalls (allow only necessary ports)
   - Implement VPN for administrative access
   - Use private networks for database access
   - Enable DDoS protection
   - Use Web Application Firewall (WAF)

2. **Server Hardening**
   - Keep OS and software updated
   - Disable unnecessary services
   - Use fail2ban or similar
   - Enable automated security updates
   - Regular vulnerability scanning

3. **Database Security**
   - Use strong database passwords
   - Limit database user permissions
   - Enable database encryption
   - Regular automated backups
   - Test backup restoration

4. **Application Security**
   - Change all default credentials
   - Use environment variables for secrets
   - Enable HTTPS only (redirect HTTP)
   - Implement rate limiting
   - Enable CORS properly

#### Monitoring & Logging

1. **System Monitoring**
   - CPU, memory, disk usage
   - Network traffic
   - Failed login attempts
   - Error rates
   - Response times

2. **Security Monitoring**
   - Intrusion detection (IDS/IPS)
   - File integrity monitoring
   - Log aggregation and analysis
   - Alert on suspicious activity

3. **Uptime Monitoring**
   - External monitoring service
   - Alert on downtime
   - Performance degradation alerts

### Regular Maintenance

#### Daily

- [ ] Review error logs
- [ ] Check system alerts
- [ ] Monitor active sessions

#### Weekly

- [ ] Review audit logs for anomalies
- [ ] Check backup status
- [ ] Review failed login attempts

#### Monthly

- [ ] Update dependencies
- [ ] Review user access lists
- [ ] Test backup restoration
- [ ] Security patch application
- [ ] Review rate limiting logs

#### Quarterly

- [ ] Full security audit
- [ ] Review and update access controls
- [ ] Disaster recovery testing
- [ ] Password rotation for service accounts
- [ ] Review third-party integrations

#### Annually

- [ ] Comprehensive penetration testing
- [ ] HIPAA risk assessment
- [ ] Staff security training
- [ ] Review and update policies
- [ ] Encryption key rotation
- [ ] Vendor security assessments

### Development Security

1. **Code Security**
   - Input validation on all user input
   - Output encoding to prevent XSS
   - Parameterized queries (prevent SQL injection)
   - CSRF tokens on state-changing operations
   - Secure file upload handling

2. **Dependency Management**
   - Regular dependency updates
   - Automated vulnerability scanning
   - Pin dependency versions
   - Review new dependencies carefully

3. **Code Review**
   - All code changes reviewed
   - Security-focused review checklist
   - Automated SAST (Static Analysis Security Testing)

---

## Incident Response

### Incident Classification

**Critical**: Data breach, system compromise, ransomware
**High**: Attempted breach, DDoS, major vulnerability
**Medium**: Failed attack attempts, policy violations
**Low**: Minor security incidents, suspicious activity

### Response Steps

#### 1. Detection & Analysis

- Identify the incident
- Determine scope and severity
- Collect evidence
- Document everything

#### 2. Containment

- Isolate affected systems
- Revoke compromised credentials
- Block malicious IPs
- Preserve evidence

#### 3. Eradication

- Remove malware/backdoors
- Patch vulnerabilities
- Reset compromised accounts
- Update security rules

#### 4. Recovery

- Restore from clean backups
- Monitor for re-infection
- Verify system integrity
- Gradual service restoration

#### 5. Post-Incident

- Document lessons learned
- Update security procedures
- Implement preventive measures
- Notify affected parties (if required)

### HIPAA Breach Notification

If PHI is breached, you may need to:

1. **Immediate** (within 60 days):
   - Notify affected individuals
   - Notify media (if >500 people affected)
   - Notify HHS (Department of Health and Human Services)

2. **Documentation**:
   - What happened
   - When it was discovered
   - What data was affected
   - How many individuals
   - What steps were taken
   - How to prevent future incidents

### Contact Information

Maintain a current list of:

- Incident response team members
- Legal counsel
- Public relations contact
- Insurance provider
- Law enforcement contact
- HHS Office for Civil Rights

---

## Security Certifications

Organizations may pursue:

- SOC 2 Type II
- ISO 27001
- HITRUST CSF
- PCI DSS (if processing payments)

## Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [HHS HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/)
- [CIS Controls](https://www.cisecurity.org/controls/)
- [SANS Security Resources](https://www.sans.org/security-resources/)

---

## Questions or Concerns?

For security questions or concerns:

- Email: security@yourfiredept.org
- GitHub Discussions: https://github.com/thegspiro/the-logbook/discussions
- Documentation: https://docs.the-logbook.org/security

**Remember**: Security is everyone's responsibility!
