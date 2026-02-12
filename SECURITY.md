# Security Policy

## Overview

The Logbook is designed with security as a core principle, implementing industry-standard security practices and compliance features for HIPAA, Section 508 accessibility, and general security best practices.

## Table of Contents

1. [Security Features](#security-features)
2. [HIPAA Compliance](#hipaa-compliance)
3. [Section 508 Accessibility](#section-508-accessibility)
4. [Password Security](#password-security)
5. [Data Encryption](#data-encryption)
6. [Audit Logging](#audit-logging)
7. [Authentication & Authorization](#authentication--authorization)
8. [Vulnerability Reporting](#vulnerability-reporting)
9. [Security Best Practices](#security-best-practices)
10. [Incident Response](#incident-response)

---

## Security Features

### Core Security Implementations

✅ **Password Hashing**: Argon2id algorithm (OWASP recommended)
✅ **Data Encryption**: AES-256 encryption for sensitive data at rest
✅ **Transport Security**: TLS 1.3 for data in transit
✅ **Tamper-Proof Logging**: Blockchain-inspired hash chain for audit logs
✅ **Multi-Factor Authentication**: TOTP-based 2FA support
✅ **Role-Based Access Control**: Granular permission system
✅ **Session Management**: Secure token-based authentication with JWT
✅ **Rate Limiting**: Protection against brute force attacks
✅ **Input Sanitization**: XSS and injection attack prevention
✅ **Security Headers**: CSP, HSTS, X-Frame-Options, etc.

---

## HIPAA Compliance

### Overview

The Logbook includes features designed to support HIPAA compliance for organizations handling Protected Health Information (PHI). However, **compliance is a shared responsibility** between the software and the implementing organization.

### HIPAA Security Rule - Technical Safeguards

#### Access Control (§ 164.312(a)(1))

- ✅ **Unique User Identification**: Each user has a unique identifier
- ✅ **Emergency Access Procedure**: Admin override capabilities for emergencies
- ✅ **Automatic Logoff**: Configurable session timeout (default: 15 minutes)
- ✅ **Encryption and Decryption**: AES-256 for PHI at rest

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

- ✅ **TLS 1.3**: Encrypted data in transit
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

### HIPAA Compliance Checklist

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
- **Onboarding Encryption**: Email passwords and API keys entered during onboarding are encrypted (AES-256 via Fernet) before database storage

### Password Policies

- **History**: Last 12 passwords remembered
- **Age**: Maximum 90 days between changes (configurable)
- **Complexity**: Enforced on client and server side
- **Lockout**: 5 failed attempts = 30 minute lockout
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

**Algorithm**: AES-256 (Advanced Encryption Standard)

**What is Encrypted:**
- User passwords (Argon2id hashing)
- Sensitive PHI fields
- File uploads containing sensitive data
- Backup files
- Database columns marked as sensitive

**Key Management:**
- Encryption keys stored in environment variables
- Never committed to version control (`.env` files are in `.gitignore`)
- Rotated regularly (recommended: every 90 days)
- Consider using a key management service (AWS KMS, Azure Key Vault, HashiCorp Vault)

**Onboarding Session Encryption:**
- Email configuration (SMTP passwords, OAuth secrets) encrypted before storage
- File storage configuration (AWS keys, Azure keys) encrypted before storage
- Only platform type identifiers are stored in plain text
- Encrypted data uses the same AES-256 Fernet cipher as field-level encryption

### Encryption in Transit

**TLS 1.3** for all network communications:
- HTTPS for web traffic
- TLS for database connections
- Encrypted email (STARTTLS)
- VPN for admin access to servers

### Field-Level Encryption

Sensitive fields that can be encrypted:
- Social Security Numbers
- Driver's License Numbers
- Medical Record Numbers
- Bank Account Information
- Credit Card Numbers
- Date of Birth (if PHI)

---

## Audit Logging

### Tamper-Proof Logging System

The Logbook implements a blockchain-inspired hash chain for audit logs:

```
Log Entry 1: Hash = SHA256(Data1 + "0000...")
Log Entry 2: Hash = SHA256(Data2 + Hash1)
Log Entry 3: Hash = SHA256(Data3 + Hash2)
```

This makes it impossible to modify historical logs without detection.

### What is Logged

#### Authentication Events
- Login attempts (success and failure)
- Logout events
- Password changes
- MFA enable/disable
- Account lockouts
- Session creation/termination

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

- **Minimum**: 7 years (HIPAA requirement)
- **Format**: Immutable, tamper-evident
- **Storage**: Encrypted at rest
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
   - TOTP (Time-based One-Time Password)
   - QR code setup
   - Backup codes
   - Optional enforcement per user/role

3. **OAuth 2.0 / SSO**
   - Microsoft Azure AD
   - Google Workspace
   - SAML support

4. **LDAP / Active Directory**
   - Enterprise directory integration
   - Synchronized user accounts

### Session Management

- **Token Type**: JWT (JSON Web Tokens)
- **Access Token Lifetime**: 8 hours (configurable)
- **Refresh Token Lifetime**: 7 days (configurable)
- **Automatic Logout**: 15 minutes inactivity (HIPAA default)
- **Concurrent Sessions**: Configurable limit
- **Session Revocation**: Manual logout or admin revoke

### Role-Based Access Control (RBAC)

#### Default Roles

1. **Super Admin**
   - Full system access
   - User management
   - System configuration

2. **Admin**
   - Organization management
   - User management within org
   - Module configuration

3. **Chief/Officer**
   - Department oversight
   - Approvals
   - Report access

4. **Member**
   - Standard access
   - Own data management
   - Limited module access

5. **Probationary**
   - Restricted access
   - Supervised permissions

#### Permission Granularity

Permissions are structured as: `module.resource.action`

Examples:
- `users.profile.view`
- `users.profile.edit`
- `documents.sensitive.view`
- `training.records.approve`
- `inventory.equipment.checkout`

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

- **Token Storage**: Auth tokens stored as `access_token` in localStorage with separate `refresh_token`
- **Concurrent Refresh Protection**: Multiple simultaneous 401 responses share a single token refresh promise — prevents replay detection from invalidating the session
- **Account Lockout**: Failed login counter persists correctly via explicit database commit (not rolled back by HTTPException)
- **Session Revocation**: Logout properly invalidates the server-side session record

For a comprehensive security review, see [ELECTION_SECURITY_AUDIT.md](ELECTION_SECURITY_AUDIT.md).

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
- **VITE_* variable safety**: Only non-secret values (API URLs, feature flags) are exposed via Vite environment variables. Secrets must never use the `VITE_` prefix.

### Environment & Configuration

- **`.env` files excluded from git**: `.gitignore` includes `.env`, `.env.local`, and `.env.*.local` to prevent accidental secret commits
- **`.env.example` files**: Contain only placeholder text (`CHANGE_ME_GENERATE_WITH_STEP_2_ABOVE`), never real secrets
- **Security key validation**: Startup checks flag any `SECRET_KEY` or `ENCRYPTION_KEY` containing `"INSECURE_DEFAULT"` as a critical issue

---

## Vulnerability Reporting

### Responsible Disclosure

We take security seriously. If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. **DO NOT** discuss publicly before fix is deployed
3. Email security reports to: security@yourfiredept.org
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
