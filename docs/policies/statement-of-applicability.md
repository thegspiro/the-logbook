# Statement of Applicability — Skeleton

**Status:** starting point, not a completed SoA. [DEPARTMENT: complete after
your risk assessment; every Annex A control needs an applicable/not
applicable decision with justification.]

Scope suggestion: "The Logbook deployment operated by [DEPARTMENT: name],
including its host(s), backups, and the member data processed within it."

The table covers the ISO/IEC 27001:2022 Annex A controls where this platform
provides the implementation. Evidence pointers are in
[../COMPLIANCE.md](../COMPLIANCE.md). Controls not listed here (physical,
HR, supplier) are department-implemented — add rows for them.

| Control | Title | Applicable | Implementation |
|---|---|---|---|
| A.5.3 | Segregation of duties | Yes | Approval of a finance request, a skills test, administrative hours, or a training submission is refused when the approver is the person who raised or performed it — a second person is required |
| A.5.15/5.16 | Access control, identity management | Yes | Org-scoped RBAC (96 permissions), OIDC SSO; roles administered in-app; the last member holding `members.manage` cannot be removed or deactivated |
| A.5.17 | Authentication information | Yes | Argon2/bcrypt hashing, password history/age, secret-scanning CI; key custody per BACKUP.md |
| A.8.2/8.3 | Privileged access, information access restriction | Yes | Permission wildcards limited to admin roles; tenant isolation; access-audited sensitive categories |
| A.8.5 | Secure authentication | Yes | MFA (TOTP), org-enforceable; account lockout; session rotation |
| A.8.8 | Technical vulnerability management | Yes | Dependabot + blocking pip-audit/npm-audit/Trivy; SBOM per release; security.txt intake |
| A.8.12 | Data leakage prevention | Partial | CSV-injection defense, error sanitization, cache exclusions, need-to-know redaction of member contact details and deployment identifiers, shared-device purge at sign-out; [DEPARTMENT: endpoint DLP if required] |
| A.8.13 | Information backup | Yes | backup.sh with offsite destinations; restore drills per backup policy |
| A.8.15/8.16 | Logging, monitoring | Yes | Tamper-evident audit chain, off-host shipping, anomaly monitoring, Sentry |
| A.8.24 | Use of cryptography | Yes | AES-256-GCM at rest (PBKDF2-HMAC-SHA256, 600k iterations), TLS 1.2/1.3 with startup enforcement of certificate verification, key-rotation runbook (KEY_ROTATION.md) |
| A.8.25–8.31 | Secure development | Yes | Strict typing (frontend), CI gates (lint/tests/coverage/SAST), API-contract conformance testing, container build verification, end-to-end tests, module security audits |
| A.5.34 | Privacy / PII protection | Yes | Consent tracking, data export, anonymization, retention schedules, privacy notice |
| A.5.24–5.28 | Incident management | Partial | Vulnerability intake + audit trail exist; [DEPARTMENT: incident response plan with HIPAA breach clocks] |
| A.5.29/5.30 | Continuity / ICT readiness | Partial | Backup/DR runbook (BACKUP.md); [DEPARTMENT: adopt RTO/RPO and drill schedule] |

[DEPARTMENT: date, approver, next review date]
