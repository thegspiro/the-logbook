# Compliance Hub

The single entry point for compliance questions about The Logbook: which
frameworks the platform aligns with, where each technical control lives in the
code, what remains open, and what deploying departments must do themselves.

**How to use this document:** when adding a control or targeting a new
framework, add a row to the control inventory below and link the evidence
(code path, workflow, or doc). Auditors work from evidence; this table is the
index to it.

Related documents:

- [ISO_STANDARDS_ASSESSMENT.md](./ISO_STANDARDS_ASSESSMENT.md) — full ISO gap
  analysis and prioritized roadmap
- [BACKUP.md](./BACKUP.md) — backup, restore drills, RTO/RPO, DR runbook
- [../SECURITY.md](../SECURITY.md) — security feature reference and
  vulnerability reporting policy
- `docs/module-audit/` — 2026-07 per-module security audit reports

## Framework overview

| Framework | Scope | Status |
|---|---|---|
| **HIPAA Security Rule** | PHI in medical screening, emergency contacts | Deepest alignment — §164.312 controls implemented (password history/age, session timeout, audit retention config, encryption, access control) |
| **ISO/IEC 27001/27002** | Information security management | Strong technical-control coverage; management-system artifacts (policies, risk register, SoA) are the deploying organization's to produce — see assessment |
| **ISO/IEC 29147** | Vulnerability disclosure | Implemented: `SECURITY.md` policy + RFC 9116 `/.well-known/security.txt` endpoint |
| **ISO 22301** | Business continuity | Backup/restore tooling + documented drills and RTO/RPO guidance in BACKUP.md; no HA architecture (single-node deployment model) |
| **ISO/IEC 27701 / privacy laws** | PII/PHI data-subject rights | **Largest open gap** — no data export, anonymization workflow, consent tracking, or privacy-policy page yet (roadmap items) |
| **ISO 8601** | Date/time interchange | Conformant: UTC storage, ISO 8601 wire format, timezone-aware display layer |
| **WCAG 2.x / ISO/IEC 40500 / Section 508** | Accessibility | Substantial aria coverage, high-contrast mode, tested contrast utilities; axe automation exists but covers little — expansion on the roadmap |
| **NFPA standards** | Fire-service operations | Apparatus NFPA compliance tracking (`ApparatusNFPACompliance`); training certifications reference NFPA standards |
| **ISO PPC (Insurance Services Office)** | Fire-insurance grading | Readiness scoring and class estimation in the compliance-officer module (`GET /iso-readiness`) — note this "ISO" is unrelated to ISO/IEC standards |

## Technical control inventory

| Control | Implementation (evidence) | Frameworks |
|---|---|---|
| Role-based access control, org-scoped, wildcard permissions | `backend/app/core/permissions.py` (96 permissions), `require_permission()` dependencies | HIPAA §164.312(a), ISO 27001 A.5.15/A.8.3 |
| MFA (TOTP + hashed recovery codes, org-enforceable) | `backend/app/services/mfa_service.py`, `docs/MFA.md` | HIPAA §164.312(d), ISO 27001 A.8.5 |
| SSO (OIDC: Google, Microsoft Azure AD) | `backend/app/services/oauth_service.py` | ISO 27001 A.5.16 |
| Password history / age / lockout | `backend/app/core/config.py` (`HIPAA_PASSWORD_*`), `auth_service.py` | HIPAA §164.312, ISO 27001 A.8.5 |
| Session security (httpOnly cookies, rotation, CSRF double-submit, timeout) | `backend/app/core/security.py`, `security_middleware.py` | HIPAA §164.312, ISO 27001 A.8.5 |
| Tamper-evident audit log (keyed HMAC-SHA256 hash chain, integrity API, export) | `backend/app/core/audit.py`, `endpoints/security_monitoring.py` | HIPAA §164.312(b), ISO 27001 A.8.15 |
| Audit retention (7-year default) with automated archival | `HIPAA_AUDIT_RETENTION_DAYS`, archival job in `backend/app/services/scheduled_tasks.py` | HIPAA §164.316(b), ISO 27001 A.8.15, ISO 15489 |
| Field-level encryption at rest (AES-256-GCM) | `backend/app/core/security.py:353-461`, `encrypted_types.py` | HIPAA §164.312(a)(2)(iv), ISO 27001 A.8.24 |
| TLS 1.2/1.3-only, HSTS, strict CSP, security headers | `infrastructure/nginx/nginx.conf`, `SecurityHeadersMiddleware` | ISO 27001 A.8.24/A.8.26 |
| Rate limiting, IP blocking, geo blocking, anomaly monitoring | `backend/app/core/security_middleware.py`, `geoip.py`, ip-security module | ISO 27001 A.8.16 |
| Multi-tenant isolation (org-scoped queries, FK validation) | Enforced convention (CLAUDE.md Pitfall #14) + `docs/module-audit/` verification | ISO 27001 A.8.3, ISO 27017 |
| CSV formula-injection defense | `backend/app/utils/csv_export.py` (`SafeCsvWriter`) | ISO 27001 A.8.26 |
| Upload hardening (content sniffing, EXIF strip, size caps), SSRF guards | `image_validator.py`, `url_validator.py`, `SECURITY_IMAGE_UPLOADS.md` | ISO 27001 A.8.26 |
| SAST + dependency scanning in CI (Bandit, pip-audit, npm audit at high) | `.github/workflows/ci.yml` | ISO 27001 A.8.8 |
| Cross-ecosystem vulnerability sweep + SBOM (Trivy, Syft SPDX artifact) | `.github/workflows/supply-chain.yml` | ISO 27001 A.8.8 |
| Consent records (current state + tamper-evident change ledger) | `backend/app/models/consent.py`, `consent_service.py`, audit `consent_updated` events | ISO 27701 |
| Secret scanning (full-history, weekly + per-PR) | `.github/workflows/secret-scan.yml`, `.gitleaks.toml` | ISO 27001 A.8.8/A.5.17 |
| Automated dependency updates | `.github/dependabot.yml` | ISO 27001 A.8.8 |
| Vulnerability disclosure channel (RFC 9116) | `backend/app/api/public/security_txt.py`, `SECURITY.md` | ISO/IEC 29147 |
| Backups with offsite destinations + documented restore drills | `scripts/backup.sh`, [BACKUP.md](./BACKUP.md) | ISO 22301, HIPAA §164.308(a)(7) |
| Error-message sanitization (no SQL/paths/traces to clients) | `safe_error_detail()` in `core/utils.py` | ISO 27001 A.8.26 |

## Known gaps and accepted risks

Tracked openly; see the assessment for the full roadmap.

| Gap | Status |
|---|---|
| Privacy policy / ToS pages | ✅ 2026-07-31 — /privacy and /terms with org-configurable text (`GET /api/public/v1/legal`) |
| Per-user data export (portability / right of access) | ✅ 2026-07-31 — `GET /users/me/data-export`, Settings → Security → "Download my data" |
| Member anonymization (right to erasure) | ✅ 2026-07-31 — `POST /users/{id}/anonymize` scrubs PII, keeps operational history; audit logs and election records deliberately untouched |
| Encryption key rotation | ✅ 2026-07-31 — legacy-key decrypt ring (`ENCRYPTION_KEYS_LEGACY`) + `scripts/rotate_encryption_key.py`; runbook in [KEY_ROTATION.md](./KEY_ROTATION.md) |
| Off-host audit-log shipping (SIEM) | ✅ 2026-07-31 — `audit_log_ship` task, HMAC-signed NDJSON to `AUDIT_SHIP_WEBHOOK_URL`, watermarked delivery |
| Consent tracking (photo use, roster listing, SMS) | ✅ 2026-07-31 — `user_consents` current-state table + `consent_updated` audit ledger; self-service at `/users/me/consents`, Settings → Security → Privacy Choices. Never-asked fails closed |
| Org-configurable retention schedules | ✅ 2026-07-31 — per-org schedules with defaults and safety floors (message history, notification logs, form submissions; platform-level blocked-attempt telemetry), enforced daily; admin API `GET/PUT /organizations/retention-policy`, audited. Documents and minutes are deliberately excluded from auto-deletion — destroying official records stays a human decision per the department's SOPs |
| react-router advisories | ✅ 2026-07-31 — migrated v6 → react-router 8.3.0 (core package); `npm audit --omit=dev` reports zero vulnerabilities |
| SAML / LDAP SSO | Not implemented (config placeholders exist; deps removed until real support lands) |
| Backend coverage gates in CI | ✅ 2026-07-31 — pytest-cov ratchet floors (unit 46%, integration 44%); frontend ratchet raised to 53/40/44/51 |
| Backend type-checking (mypy) | Open — measured 2026-07-31: 4,927 errors in 180 of 277 files (`python -m mypy app/`), dominated by arg-type (2,215) and assignment (1,170) from untyped SQLAlchemy column usage. Needs a dedicated typing campaign; a blocking gate today is not honest |
| Accessibility: keyboard-navigation audit of heavy surfaces, VPAT | Open — axe now covers the shared UX library + legal pages in CI; scheduling grid/form-builder keyboard audit remains |

## What the software cannot do for you

Deploying departments own the management-system side of every framework:

- **HIPAA:** sign BAAs with hosting/email/SMS vendors; run workforce training;
  maintain sanction and incident-response policies; breach notification has
  **statutory deadlines** (60 days for HHS/individual notice) — put them in
  your SOPs.
- **ISO 27001:** policies, risk assessment, Statement of Applicability,
  internal audits, management review. The control inventory above is your
  evidence index, not your ISMS.
- **Key custody:** offline storage of `ENCRYPTION_KEY`/`ENCRYPTION_SALT` and
  friends — see [BACKUP.md](./BACKUP.md).
- **Records retention schedules:** statutory retention for fire-service
  records varies by state; keep your schedule in department SOPs until the
  configurable retention engine ships.
- **Physical and personnel security** at the station and for any self-hosted
  hardware.
