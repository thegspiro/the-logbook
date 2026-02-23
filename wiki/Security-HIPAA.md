# HIPAA Compliance

The Logbook is designed to meet HIPAA (Health Insurance Portability and Accountability Act) requirements for organizations handling Protected Health Information (PHI).

---

## HIPAA Security Rule Compliance

### Access Control (§ 164.312(a))

| Requirement | Implementation |
|-------------|---------------|
| Unique user identification | Every user has a unique ID and username |
| Emergency access procedure | System owner bypass for emergency situations |
| Automatic logoff | 30-minute inactivity timeout (configurable) |
| Encryption and decryption | AES-256 encryption for PHI at rest |

### Audit Controls (§ 164.312(b))

| Requirement | Implementation |
|-------------|---------------|
| Audit log recording | All access to PHI is logged with user, timestamp, and action |
| Tamper-proof storage | SHA-256 hash chain prevents modification |
| Log retention | 7-year retention (2555 days), exceeds 6-year HIPAA minimum |
| Periodic verification | Daily integrity checkpoints |
| Export capability | JSON export for compliance reporting |

### Integrity (§ 164.312(c))

| Requirement | Implementation |
|-------------|---------------|
| Data integrity | Hash chain verification for audit logs |
| Transmission integrity | TLS 1.3 for all data in transit |
| Modification tracking | Before/after values recorded in audit log |

### Person or Entity Authentication (§ 164.312(d))

| Requirement | Implementation |
|-------------|---------------|
| Strong passwords | Argon2id hashing, 12+ character minimum |
| Multi-factor authentication | TOTP-based 2FA (optional or admin-enforced) |
| Account lockout | 5 failed attempts = 30-minute lockout |
| Session management | JWT tokens with configurable expiration |

### Transmission Security (§ 164.312(e))

| Requirement | Implementation |
|-------------|---------------|
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

- The Training module can be used to track HIPAA compliance training
- Create HIPAA training requirements with annual frequency
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

## Compliance Monitoring

### Security Dashboard

```bash
# Check HIPAA-relevant security status
curl http://YOUR-IP:3001/api/v1/security/status

# Verify audit log integrity
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity

# Review security alerts
curl http://YOUR-IP:3001/api/v1/security/alerts
```

### Compliance Checklist

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

**See also:** [Security Overview](Security-Overview) | [Audit Logging](Security-Audit-Logging) | [Encryption](Security-Encryption)
