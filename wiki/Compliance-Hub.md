# Compliance Hub

Which regulatory and security frameworks The Logbook lines up with, where the
technical controls behind them live, what is still open — and, most important
for a department deploying it, what the software cannot do for you.

> The full reference is [docs/COMPLIANCE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/COMPLIANCE.md).

"Compliance" here means HIPAA, ISO and the like. Training compliance — whether
members have met their requirements — is the [Compliance module](Module-Compliance)
and [Compliance Configuration](Compliance-Configuration).

> **Alignment is not certification.** The software supplies technical controls
> and the evidence that they exist. Policies, risk assessments, contracts and
> training belong to the department, and no framework is met until those exist
> too — see [What the department must do itself](#what-the-department-must-do-itself).

---

## Framework overview

| Framework                               | Scope                                        | Where it stands                                                                                                                               |
| --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **HIPAA Security Rule**                 | PHI in medical screening, emergency contacts | Deepest alignment: §164.312 technical safeguards implemented — see [HIPAA Security Features](Security-HIPAA)                                  |
| **ISO/IEC 27001 / 27002**               | Information security management              | Strong technical-control coverage. The management-system documents (policies, risk register, Statement of Applicability) are the department's |
| **ISO/IEC 29147**                       | Vulnerability disclosure                     | `SECURITY.md` policy plus an RFC 9116 `/.well-known/security.txt`                                                                             |
| **ISO 22301**                           | Business continuity                          | Backup, restore and drill tooling — see [Backup & Recovery](Backup-Recovery). Single-node: no high-availability architecture                  |
| **ISO/IEC 27701 / privacy law**         | Personal data and data-subject rights        | Data export, anonymization, consent tracking, editable privacy and terms pages — see [Privacy & Data Rights](Security-Privacy)                |
| **ISO 8601**                            | Date and time interchange                    | UTC storage, ISO 8601 on the wire, local-time display                                                                                         |
| **WCAG 2.x / Section 508**              | Accessibility                                | Substantial ARIA coverage, high-contrast mode, tested contrast; automated axe coverage is partial                                             |
| **NFPA standards**                      | Fire-service operations                      | Apparatus NFPA compliance tracking; training certifications reference NFPA standards                                                          |
| **ISO PPC** (Insurance Services Office) | Fire-insurance grading                       | Readiness scoring in the compliance-officer module. This "ISO" is unrelated to ISO/IEC standards                                              |

---

## Technical controls, in summary

The full inventory, with the file behind each control and the clause it maps
to, is in the reference. Grouped for an administrator:

| Area                       | What is in place                                                                                                                                                                                                                                  | More                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Access control**         | Org-scoped role-based permissions with wildcards; MFA (TOTP with hashed recovery codes, enforceable by the department); Google and Microsoft sign-in; administrator continuity — the last administrator cannot be demoted, deactivated or deleted | [Authentication](Security-Authentication), [Role System](Role-System) |
| **Passwords and sessions** | Password history, minimum and maximum age, lockout; httpOnly cookies with rotation, CSRF double-submit, inactivity timeout                                                                                                                        | [Configuration — Security](Configuration-Security)                    |
| **Audit**                  | Keyed HMAC-SHA256 hash chain with an integrity check, 7-year default retention with archival, optional off-host shipping                                                                                                                          | [Audit Logging](Security-Audit-Logging)                               |
| **Encryption**             | AES-256-GCM on sensitive fields and every stored file, key rotation, encrypted backups, TLS 1.2/1.3 only, HSTS                                                                                                                                    | [Encryption](Security-Encryption)                                     |
| **Application hardening**  | Rate limiting that cannot be silently disabled in production, IP and geo blocking, upload scanning and validation, SSRF guards, CSV formula-injection defence, sanitized error messages                                                           | [Security Overview](Security-Overview)                                |
| **Separation of duties**   | An approver may not approve their own request — see below                                                                                                                                                                                         | —                                                                     |
| **Privacy**                | Need-to-know redaction of member contact details, per-member data export, anonymization, consent records, configurable retention                                                                                                                  | [Privacy & Data Rights](Security-Privacy)                             |
| **Continuity**             | Nightly backups with automated restore drills, offsite upload, documented RTO/RPO                                                                                                                                                                 | [Backup & Recovery](Backup-Recovery)                                  |
| **Software supply chain**  | SAST and dependency audit in CI, a cross-ecosystem vulnerability sweep with an SBOM, full-history secret scanning, automated dependency updates                                                                                                   | —                                                                     |

### Separation of duties

One shared check refuses an action when the person doing it is the person it
benefits. It covers finance approvals, payments, checks, dues payments and
waivers, budget amendments and cash-advance returns; storefront payments,
waivers, refunds and status changes; admin-hours approval; training submission
review and crew batches; skills-test examination; meeting-minutes approval;
driver exceptions; and crediting a missed course class.

Deliberately **not** guarded, each for a stated reason: declining or
withdrawing your own record; reversals such as voiding a check; procurement
status changes; approval by an external email approver (checked by address
instead); training auto-approve, which has no reviewer to compare; and
admin-hours self-approval when the department turns it on for a one-officer
operation. There is **no separate disbursement permission**, so this prevents
self-dealing rather than providing three-way separation — a finance manager can
still pay a request somebody else approved. Finance requests can also require
**two different approvers** above a department-set threshold (off by default).

---

## Still open

Tracked openly in the reference and in
[KNOWN_LIMITATIONS.md](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md):

- **SAML and LDAP sign-in** are not implemented. `LDAP_ENABLED` exists in
  configuration and gates nothing.
- **Backend static typing** (mypy) is not a blocking CI gate.
- **Accessibility:** a keyboard-navigation audit of the heaviest screens
  (scheduling grid, form builder) and a VPAT remain to be done.
- **High availability:** the deployment model is a single node; continuity
  rests on backups and a practised restore.

---

## What the department must do itself

Deploying departments own the management-system side of every framework. A
working checklist:

### Contracts and people

- [ ] **Business associate agreements** with every vendor that hosts or carries
      PHI: hosting, email, SMS. See [HIPAA → BAA](Security-HIPAA#business-associate-agreement-baa).
- [ ] **Workforce training**, a sanction policy and an incident-response policy.
- [ ] **Breach notification** written into your SOPs with its statutory
      deadlines — HIPAA allows up to 60 days for notice to HHS and to
      individuals.
- [ ] **Physical and personnel security** at the station and for any
      self-hosted hardware.

### The ISO 27001 management system

- [ ] Policies, risk assessment, Statement of Applicability, internal audits
      and management review. The control inventory is your evidence index, not
      your ISMS.
- [ ] Start from the pre-filled skeletons in
      [docs/policies/](https://github.com/thegspiro/the-logbook/tree/main/docs/policies)
      — information security, access control, cryptography and key management,
      logging and monitoring, backup and continuity, incident response, and a
      Statement of Applicability. Replace the `[DEPARTMENT: ...]` placeholders
      and adopt them formally.
- [ ] The full ISO gap analysis is
      [ISO_STANDARDS_ASSESSMENT.md](https://github.com/thegspiro/the-logbook/blob/main/docs/ISO_STANDARDS_ASSESSMENT.md).

### Keys and backups

- [ ] Keep `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `SECRET_KEY` and the database
      and Redis passwords **offline, in at least two places, never beside the
      backups**. A backup without them cannot be decrypted.
- [ ] Create backup encryption keys and store the private key off the server.
- [ ] Send backups offsite, run a restore drill at least quarterly, and write
      your RTO and RPO into your SOPs. All of this is on
      [Backup & Recovery](Backup-Recovery).
- [ ] Decide a rotation cadence for the encryption key —
      [Key Rotation](Security-Key-Rotation).

### Settings an operator should make

| Setting (`.env`)                  | Default | Why                                                                                                                                                                          |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUDIT_LOG_SIGNING_KEY`           | unset   | Without it the audit chain is keyed with `SECRET_KEY`. A dedicated key, stored outside the database, is strongly recommended; production warns at startup when it is missing |
| `VOTE_SIGNING_KEY`                | unset   | Without it ballot signatures use `SECRET_KEY`, and rotating that key invalidates them                                                                                        |
| `SECURITY_TXT_CONTACT`            | unset   | The contact served at `/.well-known/security.txt`. Unset, it points at the upstream project's advisory intake rather than your department                                    |
| `AUDIT_SHIP_WEBHOOK_URL`          | unset   | Ships audit entries off the host as HMAC-signed batches, for a SIEM or collector                                                                                             |
| `HIPAA_SESSION_TIMEOUT_MINUTES`   | `15`    | Automatic logoff after inactivity                                                                                                                                            |
| `HIPAA_PASSWORD_HISTORY_COUNT`    | `12`    | Previous passwords a member may not reuse                                                                                                                                    |
| `HIPAA_MAXIMUM_PASSWORD_AGE_DAYS` | `90`    | Days before a password must be changed                                                                                                                                       |
| `HIPAA_AUDIT_RETENTION_DAYS`      | `2555`  | Seven years of audit history before rows are archived to files and purged — back those files up                                                                              |

Generate the two signing keys the same way as `SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

Set them **once** and treat them as permanent: historical audit rows and
ballots verify only under the key that signed them.

### Records retention

Statutory retention for fire-service records varies by state, so choosing the
periods is the department's job; the application enforces what you set, daily.
It is **API-only** — no settings screen offers it:

```
GET /api/v1/organization/retention-policy
PUT /api/v1/organization/retention-policy/{record_class}?days=N
```

Both need `settings.manage` or `organization.update_settings`; omit `days` to
keep a class forever. Documents and meeting minutes are never deleted
automatically, so record their schedule in your SOPs. Details:
[Privacy → Records Retention](Security-Privacy#records-retention).

### Public notices

- [ ] Review the privacy notice and terms at `/privacy` and `/terms` and adapt
      them in **Governance → Legal Documents** —
      [Legal Documents](Module-Governance-Legal).

---

## Related

- [HIPAA Security Features](Security-HIPAA)
- [Privacy & Data Rights](Security-Privacy)
- [Security Overview](Security-Overview)
- [Encryption](Security-Encryption)
- [Audit Logging](Security-Audit-Logging)
- [Backup & Recovery](Backup-Recovery)
- [Key Rotation](Security-Key-Rotation)
- [SECURITY.md](https://github.com/thegspiro/the-logbook/blob/main/SECURITY.md) — vulnerability reporting policy
