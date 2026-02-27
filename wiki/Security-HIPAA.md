# HIPAA Security Features

The Logbook includes security features designed with HIPAA (Health Insurance Portability and Accountability Act) requirements in mind. However, **HIPAA compliance requires an external audit and cannot be self-declared by a software project alone.** Organizations handling Protected Health Information (PHI) must conduct their own risk assessments and engage qualified assessors to verify compliance.

> **Important:** The presence of these features does not constitute a claim of HIPAA compliance. Compliance is a shared responsibility between the software, the implementing organization, and qualified external reviewers.

---

## Security Features Aligned with HIPAA Security Rule

### Access Control (§ 164.312(a))

| HIPAA Requirement | Feature |
|-------------------|---------|
| Unique user identification | Every user has a unique ID and username |
| Emergency access procedure | System owner bypass for emergency situations |
| Automatic logoff | 30-minute inactivity timeout (configurable) |
| Encryption and decryption | AES-256 encryption for PHI at rest |

### Audit Controls (§ 164.312(b))

| HIPAA Requirement | Feature |
|-------------------|---------|
| Audit log recording | All access to PHI is logged with user, timestamp, and action |
| Tamper-proof storage | SHA-256 hash chain prevents modification |
| Log retention | 7-year retention (2555 days), exceeds 6-year HIPAA minimum |
| Periodic verification | Daily integrity checkpoints |
| Export capability | JSON export for compliance reporting |

### Integrity (§ 164.312(c))

| HIPAA Requirement | Feature |
|-------------------|---------|
| Data integrity | Hash chain verification for audit logs |
| Transmission integrity | TLS 1.3 for all data in transit |
| Modification tracking | Before/after values recorded in audit log |

### Person or Entity Authentication (§ 164.312(d))

| HIPAA Requirement | Feature |
|-------------------|---------|
| Strong passwords | Argon2id hashing, 12+ character minimum |
| Multi-factor authentication | TOTP-based 2FA (optional or admin-enforced) |
| Account lockout | 5 failed attempts = 30-minute lockout |
| Session management | JWT tokens with configurable expiration |

### Transmission Security (§ 164.312(e))

| HIPAA Requirement | Feature |
|-------------------|---------|
| Encryption | TLS 1.3 required in production |
| Integrity controls | Message authentication codes (MAC) |

---

## Administrative Safeguards

### Risk Assessment

- Regular security monitoring via `/api/v1/security/status`
- Intrusion detection with configurable alert thresholds
- Data exfiltration monitoring and prevention

### Workforce Security

- Role-Based Access Control (RBAC) with granular permissions
- 16 system roles with principle of least privilege
- Audit trail for all permission changes

### Security Awareness Training

- The Training module can be used to track HIPAA-related training
- Create training requirements with annual frequency
- Track completion through the Compliance Matrix

### Contingency Plan

- Automated database backups
- Docker volume persistence
- Documented restore procedures

---

## Physical Safeguards

### Facility Access

- Docker containerization isolates the application
- Network segmentation via Docker networks
- No direct database port exposure in production

### Workstation Security

- Session inactivity timeout
- Concurrent session limits
- IP-based session monitoring

---

## Security Monitoring

### Security Dashboard

```bash
# Check security status
curl http://YOUR-IP:3001/api/v1/security/status

# Verify audit log integrity
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity

# Review security alerts
curl http://YOUR-IP:3001/api/v1/security/alerts
```

### Security Checklist

- [ ] All users have unique accounts (no shared logins)
- [ ] MFA enabled for users with PHI access
- [ ] HTTPS enabled in production
- [ ] Audit logging verified working
- [ ] Audit log integrity check passing
- [ ] Encryption keys generated (not defaults)
- [ ] Regular backups configured
- [ ] Session timeout configured (≤30 minutes)
- [ ] Access permissions reviewed quarterly
- [ ] Security incident response plan documented

---

## Business Associate Agreement (BAA)

If The Logbook is hosted by a third party (cloud provider), ensure you have a signed BAA with:
- Your cloud hosting provider (AWS, Azure, GCP, etc.)
- Any third-party integrations that access PHI

For self-hosted deployments (Unraid, on-premises), the BAA requirement applies to any external services you integrate.

---

## Disclaimer

This software includes security features designed with HIPAA requirements in mind. However, **no software can self-certify HIPAA compliance.** Organizations must:

1. Conduct a formal risk assessment
2. Engage a qualified external assessor
3. Implement administrative, physical, and technical safeguards beyond software alone
4. Maintain ongoing compliance through regular audits

**See also:** [Security Overview](Security-Overview) | [Audit Logging](Security-Audit-Logging) | [Encryption](Security-Encryption)
