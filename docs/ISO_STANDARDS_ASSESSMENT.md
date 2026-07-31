# ISO Standards Assessment for The Logbook

**Date:** 2026-07-31
**Status:** Assessment / roadmap — no certification claimed

This document evaluates which ISO (and closely related) standards are relevant
to The Logbook, how close the current codebase already is to each one, and what
concrete engineering work would move us toward alignment. File references point
at the implementation that exists today.

## Two framing notes

**"ISO" means two different things in this codebase.** The fire service uses
"ISO" for the Insurance Services Office **Public Protection Classification**
(class 1–10 insurance grading). The Logbook already ships features for *that*
ISO — readiness scoring and class estimation in
`backend/app/services/compliance_officer_service.py` (`GET /iso-readiness`).
This document is about the *other* ISO: the International Organization for
Standardization's management-system and technical standards (ISO/IEC 27001
etc.), which `SECURITY.md` already names as aspirational targets alongside
SOC 2 and HITRUST.

**Management-system standards certify organizations, not software.** The
Logbook project cannot itself "be ISO 27001 certified." What the codebase can
do is (1) implement the technical controls those standards require, so a
department or hosted-SaaS operator running The Logbook can pass an audit
without fighting the software, and (2) align the open-source project's own
processes (vulnerability handling, release/testing discipline) with the
process-oriented standards. Both are treated below.

---

## Tier 1 — High relevance, strong existing foundation

### ISO/IEC 27001:2022 / 27002:2022 — Information Security Management

The most natural target. The HIPAA-driven engineering culture, the 2026-07
per-module security audits (`docs/module-audit/`, 29 files), and
`SECURITY_AUDIT.md` mean a large fraction of Annex A technical controls are
already implemented — several unusually well for a project this size.

**Already in place**

| Annex A theme | Implementation |
|---|---|
| Access control (A.5.15–5.18, A.8.2–8.5) | 96-permission RBAC catalog with wildcards (`backend/app/core/permissions.py`), org-scoped roles, `require_permission()` dependencies, route-level gating (`ProtectedRoute`) |
| Authentication (A.8.5) | bcrypt/Argon2, TOTP MFA with encrypted secrets and hashed backup codes (`backend/app/services/mfa_service.py`), org-enforced MFA, account lockout, HIPAA §164.312 password history/age controls (`backend/app/core/config.py:150-163`), Google/Microsoft OIDC SSO |
| Session security | httpOnly-cookie JWTs with refresh rotation + grace window, CSRF double-submit, HIPAA session timeout |
| Logging & monitoring (A.8.15–8.16) | **Tamper-evident audit log**: keyed HMAC-SHA256 hash chain with no-downgrade guard and head-deletion detection (`backend/app/core/audit.py`), 242 distinct event types, integrity/checkpoint/export API (`endpoints/security_monitoring.py`), security-monitoring middleware, Sentry + Loguru |
| Cryptography (A.8.24) | AES-256-GCM field encryption with PBKDF2 derivation (`backend/app/core/security.py:353-461`, `encrypted_types.py` failing closed on tamper), TLS 1.2/1.3-only nginx with HSTS/OCSP, strict CSP with no `unsafe-inline` scripts |
| Secure development (A.8.25–8.31) | Strict TypeScript, CI lint/type/test gates, **Bandit + pip-audit in CI** (`.github/workflows/ci.yml`), `SafeCsvWriter`, SSRF/image-upload validators, per-module security audits with honest `docs/KNOWN_LIMITATIONS.md` |
| Tenant isolation | Org-scoping rules enforced project-wide (CLAUDE.md Pitfall #14, XC-* audit finding classes) |

**Gaps and the work to close them**

1. **Audit retention is declared but never enforced.**
   `HIPAA_AUDIT_RETENTION_DAYS = 2555` (7 years, `config.py:163`) has no
   purge/archival job consuming it — the retention claim is aspirational.
   Add a scheduled archival job (there is already an `audit_log_archival`
   event type waiting for it).
2. **No off-host log shipping.** The hash chain detects tampering; it can't
   survive deletion of the whole table. Add syslog/webhook/JSONL shipping so
   operators can keep an external copy (also the standard SIEM answer to
   A.8.15).
3. **No key rotation path (A.8.24).** `config.py:353` concedes rotating
   `SECRET_KEY` invalidates existing signatures; encrypted fields have no
   `key_version` and no multi-key decrypt ring. Add key-version metadata and
   a routine re-encryption command (the one-off
   `backend/scripts/reencrypt_to_aesgcm.py` + `docs/AES256_GCM_BACKFILL_RUNBOOK.md`
   is the template). No KMS/vault integration exists either — worth an
   optional hook.
4. **Supply-chain gaps around the existing scanning (A.8.8).** CI scans but
   nothing patches or blocks: there is **no `.github/dependabot.yml`**, the
   frontend `npm audit` step is non-blocking (`|| true`), and there is no
   CodeQL/secret-scanning, container scan (Trivy), or SBOM generation. All
   are low-effort workflow additions.
5. **Dead dependency surface:** `pysaml2` and `python-ldap`
   (`backend/requirements.txt:45-46`) have **zero implementing code** — pure
   CVE exposure. Either remove them or actually build SAML/LDAP SSO.
6. **The documentation backbone is missing.** No information-security policy
   set, risk register, asset inventory, or Statement of Applicability — the
   artifacts an ISO 27001 audit starts from. Much of the raw material exists
   in `SECURITY.md` (27 KB, 17 sections); it needs restructuring into
   per-control policy statements. Also: `docs/DEPLOYMENT.md` links to
   `docs/BACKUP.md` (3×) and `docs/COMPLIANCE.md`, **neither of which
   exists**.

**Verdict:** The technical control coverage is genuinely strong — the audit
hash chain and encryption layer exceed what most projects this size have.
Items 1–5 are the engineering work; item 6 is documentation.

### ISO/IEC 29147 & 30111 — Vulnerability Disclosure and Handling

Small, concrete, and fully achievable by the *project* itself.

- `SECURITY.md` already has "Vulnerability Reporting" and "Incident Response"
  sections with a contact address — most of 29147 in substance.
- **Gaps:** no `/.well-known/security.txt` (RFC 9116) served by the app; the
  incident-response section names no notification clocks (HIPAA breach
  notification has statutory deadlines); no documented triage → fix →
  advisory lifecycle (30111) or use of GitHub Security Advisories for CVEs.

**Verdict:** Days of work. Best effort-to-credibility ratio in this document.

### ISO 8601 — Date and time representation

Effectively achieved: UTC-aware storage (`DateTime(timezone=True)` with
normalization), ISO 8601 as the de facto wire format (~373 `isoformat()`/
`toISOString()` call sites), centralized display formatting
(`frontend/src/utils/dateFormatting.ts`) with ESLint bans on non-conformant
APIs. Remaining: a backend lint rule against naive `datetime.now()`, and a
one-paragraph conformance statement in `docs/ARCHITECTURE.md`.

---

## Tier 2 — High relevance, meaningful gaps

### ISO/IEC 27701 — Privacy Information Management (extension of 27001)

The Logbook stores PII and PHI (medical screening, emergency contacts) and the
HIPAA work covers *confidentiality* well — but privacy standards demand
**data-subject rights**, which are mostly absent. This is the largest genuine
feature gap this assessment found:

1. **No privacy policy or terms-of-service page anywhere** — zero matches in
   `frontend/src` and `backend/app`. For a platform holding PHI with a public
   portal, this is the most conspicuous single gap in the repo.
2. **No data export (portability):** no "download my data" endpoint for a
   member. (Admin CSV reporting via `SafeCsvWriter` exists; subject
   portability does not.)
3. **Partial erasure story:** soft delete is the default and an audited
   `user_hard_deleted` path exists (`endpoints/users.py`), but there is no
   *anonymization* workflow that scrubs a departed member's PII while
   preserving the attendance/training history the department legally needs.
   The elections module already ships real cryptographic anonymization
   (per-election salt destroyed at close, `election_service.py:1262`) — the
   pattern to generalize.
4. **No retention schedules for business records:** documents, minutes, and
   medical records have no retention/expiry/disposition fields at all.
   Statutory retention differs by state, so this must be org-configurable.
5. **No consent management** — no consent model or audit trail (e.g. photo
   use, public-portal visibility).

GDPR is not directly in scope for most US fire departments, but several US
state privacy laws impose similar duties, and items 1–4 are valuable to users
regardless of any certification.

### ISO 22301 — Business Continuity Management

Peculiarly important here: the customers are *emergency services*, and their
intranet being down during an activation is an operational problem.

- **Exists:** `scripts/backup.sh` is a genuinely complete backup/restore CLI
  (database + files + config; local/S3/Azure/GCS destinations; `--restore`;
  30-day retention; documented cron line). Docker health checks on
  MySQL/Redis/backend, Sentry, `db_retry.py`, per-platform deployment docs.
- **Gaps:**
  1. Backups are host-side cron only — **no backup service in any
     docker-compose file**, so nothing self-starts with the stack.
  2. No automated backup **verification** — a scheduled restore-and-checksum
     drill is the difference between having backups and having recoveries.
  3. No DR plan: no RTO/RPO targets, failover procedure, or BIA; and the
     `docs/BACKUP.md` that `docs/DEPLOYMENT.md` links to doesn't exist.
  4. No uptime/metrics monitoring (Sentry covers errors only) — no
     Prometheus/alerting or documented external-monitor setup.

**Verdict:** Mostly documentation plus two scripts (compose-integrated backup
sidecar, restore verification). High value for the user base.

### ISO/IEC 40500 (WCAG 2.0) — Accessibility

ISO/IEC 40500 is WCAG 2.0 verbatim; practical work should target WCAG 2.2 AA
(which subsumes it). US public-sector customers may be subject to ADA/Section
508, and `SECURITY.md:151-211` already *claims* WCAG 2.1 AA — currently an
unverified assertion.

- **Exists:** ~2,244 `aria-*` and ~505 `role=` attributes; first-class
  high-contrast theme; WCAG-AA contrast utilities
  (`frontend/src/utils/colorContrast.ts`, unit-tested, 4.5:1 minimum);
  widespread `sr-only` labels; 44px touch targets; **axe is already wired
  into Vitest** (`src/test/setup.ts`, `vitest-axe.d.ts`).
- **Gaps:** exactly **one** a11y spec exists (`Modal.a11y.test.tsx`); no a11y
  gate in CI; no keyboard-navigation audit of the heavy surfaces (scheduling
  grid, form builder, scanner flows); no VPAT/conformance report backing the
  SECURITY.md claims.

**Verdict:** The plumbing is done — the work is writing `*.a11y.test.tsx`
specs across components and adding the CI gate, mirroring the existing
coverage-ratchet approach.

---

## Tier 3 — Relevant as reference models, not certification targets

- **ISO/IEC 25010 (software product quality):** useful vocabulary for the
  existing quality program. The concrete gaps it would surface are already
  known: **no backend type-check (mypy) gate and no backend coverage gate in
  CI**, frontend coverage ratchet configured but not enforced in CI, no
  Playwright run in CI.
- **ISO 15489 (records management):** relevant to *what the product does* —
  minutes, training records, and elections are records with authenticity and
  retention needs. The retention engine (27701 §4) and audit archival
  (27001 §1) are exactly what 15489 alignment asks for; treat it as a design
  reference for those features. A controlled-document lifecycle
  (review/approval/expiry) on the documents module would complete it.
- **ISO/IEC 27017/27018 (cloud security / PII in cloud):** relevant only if
  The Logbook is operated as multi-tenant SaaS; the tenant-isolation
  discipline (Pitfall #14) is the core product-side prerequisite and exists.
- **ISO 9001 (quality management):** organization-level; not actionable for
  the codebase beyond what 25010/CI already covers.
- **ISO 22320 (emergency management):** domain-adjacent, but US fire-service
  interoperability lives in NFPA and NERIS/NFIRS. The apparatus module
  already tracks NFPA compliance (`ApparatusNFPACompliance`). There is **no
  incident-reporting module today**; if one is built, NERIS alignment
  matters far more than ISO 22320.

---

## Prioritized roadmap

| # | Item | Standard(s) | Effort | Type |
|---|------|-------------|--------|------|
| 1 | Remove unused `pysaml2`/`python-ldap` deps (or implement SAML/LDAP) | 27001 A.8.8 | S | Code |
| 2 | `security.txt` endpoint + advisory lifecycle & breach-clock doc | 29147/30111 | S | Code + doc |
| 3 | Dependabot config; make `npm audit` blocking; add gitleaks + Trivy + SBOM | 27001 A.8.8 | S | CI |
| 4 | Privacy-policy + ToS pages (org-configurable content) | 27701 | S–M | Code |
| 5 | Audit-log archival job enforcing `HIPAA_AUDIT_RETENTION_DAYS` | 27001, 15489 | M | Code |
| 6 | Off-host audit-log shipping (JSONL/syslog/webhook) | 27001 | M | Code |
| 7 | Fix broken `docs/BACKUP.md` / `docs/COMPLIANCE.md` links by writing them; DR runbook with RTO/RPO | 22301 | M | Doc |
| 8 | Compose-integrated backup sidecar + automated restore verification | 22301 | M | Code |
| 9 | Expand axe specs beyond Modal + a11y gate in CI | 40500/WCAG | M | CI + tests |
| 10 | Encryption key versioning + rotation command | 27001 | M | Code |
| 11 | Per-user data export endpoint | 27701 | M | Code |
| 12 | Member anonymization workflow (generalize elections pattern) | 27701 | M–L | Code |
| 13 | Org-configurable retention schedules + enforcement job | 27701, 15489 | L | Code |
| 14 | Consent tracking model + UI | 27701 | M | Code |
| 15 | Backend mypy + coverage gates; enforce frontend coverage in CI | 25010 | M | CI |
| 16 | Policy set / Statement of Applicability skeleton from SECURITY.md | 27001 | M | Doc |

Effort: S = under a day, M = days, L = a week-plus.

Items 1–4 are quick wins (1 and 3 are near-trivial). Items 5–8 close the
largest 27001/22301 control gaps. Items 11–14 are the privacy feature set —
the one area where the product currently cannot support a deploying
organization's obligations at all.
