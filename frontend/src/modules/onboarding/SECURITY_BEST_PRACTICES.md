# Security Best Practices - Onboarding Module

## Overview

This document outlines security best practices for the onboarding module and provides guidance for secure deployment.

## Current Security Features ✅

### 1. Input Validation & Sanitization

**Implemented**:
- Enhanced email validation (prevents injection)
- Username validation with length limits (3-32 chars)
- Password strength requirements (12+ chars, complexity)
- Phone number validation
- File upload validation (type, size, extension)
- Host/IP validation
- Port number validation
- XSS prevention via input sanitization

**Usage**:
```typescript
import { isValidEmail, sanitizeTextInput } from './utils';

// Validate email
if (!isValidEmail(userInput)) {
  // Reject invalid email
}

// Sanitize text
const clean = sanitizeTextInput(userInput);
```

### 2. File Upload Security

**Protection Against**:
- XSS via SVG files (SVG uploads blocked)
- Malicious file types (whitelist only: PNG, JPG, WebP)
- Oversized files (5MB limit)
- Extension spoofing (validates both MIME type and extension)

**Code**:
```typescript
const result = isValidImageFile(file);
if (!result.valid) {
  console.error(result.error);
}
```

### 3. Clickjacking Protection

**Implemented**:
```typescript
if (window.top !== window.self) {
  // Prevent iframe embedding
  window.top.location = window.self.location;
}
```

### 4. HTTPS Enforcement

**Implemented**:
- Development: HTTP allowed
- Production: HTTPS required (enforced at runtime)

### 5. Password Handling

**Current Implementation**:
- Minimum 12 characters
- Requires: uppercase, lowercase, numbers, special characters
- Real-time strength feedback
- Never logged to console

**⚠️ CRITICAL ISSUE**: Passwords currently stored in sessionStorage - see Security Warnings section below.

## ⚠️ Critical Security Warnings

### Password Storage Vulnerability

**Problem**: Admin passwords are currently stored in browser sessionStorage in plain text.

**Risk Level**: 🔴 CRITICAL

**Impact**:
- Anyone with browser access can view passwords
- XSS attacks can steal passwords
- Browser extensions can access sessionStorage
- Developer tools expose passwords

**Solution**:
```typescript
// ❌ CURRENT (INSECURE)
sessionStorage.setItem('adminUser', JSON.stringify({
  username: 'admin',
  password: 'MyP@ssw0rd123'  // EXPOSED!
}));

// ✅ SECURE APPROACH
// 1. Send password directly to backend
const response = await fetch('/api/v1/onboarding/admin-user', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({
    username: formData.username,
    password: formData.password  // Transmitted once via HTTPS
  })
});

// 2. Store only session token
sessionStorage.setItem('onboardingSession', response.sessionId);

// 3. Clear password from memory
formData.password = '';
formData.confirmPassword = '';
```

### API Keys & Secrets Storage

**Problem**: OAuth secrets, API keys, and access tokens stored in sessionStorage.

**Affected Data**:
- `googleClientSecret`
- `microsoftClientSecret`
- `s3SecretAccessKey`
- `authentikClientSecret`
- SMTP passwords

**Solution**: Same as passwords - send directly to backend, store only session tokens.

## Production Deployment Checklist

Before deploying to production, complete ALL items:

### Environment Configuration

- [ ] Set `NODE_ENV=production`
- [ ] Configure `VITE_API_URL` to production API
- [ ] Generate secure `VITE_SESSION_KEY` (32+ characters)
- [ ] Remove all `console.log` statements
- [ ] Enable source map protection

### HTTPS & Transport Security

- [ ] Valid SSL/TLS certificate installed
- [ ] HTTPS enforcement enabled
- [ ] HTTP → HTTPS redirect configured
- [ ] HSTS header enabled (`Strict-Transport-Security: max-age=31536000; includeSubDomains`)
- [ ] TLS 1.2+ only (disable TLS 1.0, 1.1)

### Security Headers

Add these headers to your web server:

```nginx
# nginx configuration
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.yourdomain.com;" always;
```

### Backend Security

- [ ] Rate limiting enabled (5 requests/minute per IP)
- [ ] CSRF protection active
- [ ] SQL injection prevention (parameterized queries)
- [ ] Password hashing with Argon2id
- [ ] Session management with secure cookies
- [ ] Input validation server-side
- [ ] Output encoding
- [ ] Error messages don't leak info

### Data Protection

- [ ] Remove passwords from sessionStorage
- [ ] Remove API keys from sessionStorage
- [ ] Implement server-side sessions
- [ ] Encrypt sensitive data in database
- [ ] Secure backup procedures
- [ ] Data retention policies
- [ ] GDPR compliance (if applicable)

### Testing

- [ ] Penetration testing completed
- [ ] XSS testing passed
- [ ] SQL injection testing passed
- [ ] CSRF testing passed
- [ ] Session management tested
- [ ] File upload security tested
- [ ] Authentication bypass testing
- [ ] Authorization testing

### Monitoring & Logging

- [ ] Security event logging enabled
- [ ] Failed login attempts tracked
- [ ] Suspicious activity alerts configured
- [ ] Log aggregation setup
- [ ] Intrusion detection system active
- [ ] Regular log reviews scheduled

### Compliance

- [ ] HIPAA compliance verified (if handling PHI)
- [ ] Section 508 accessibility tested
- [ ] Privacy policy updated
- [ ] Terms of service reviewed
- [ ] Data processing agreements signed
- [ ] Security audit completed

## Secure Coding Practices

### 1. Always Validate Input

```typescript
// ✅ GOOD
const email = sanitizeTextInput(formData.email);
if (!isValidEmail(email)) {
  throw new Error('Invalid email');
}

// ❌ BAD
const email = formData.email; // No validation!
```

### 2. Use HTTPS for API Calls

```typescript
// ✅ GOOD
const API_URL = import.meta.env.VITE_API_URL || 'https://api.yourdomain.com';

// ❌ BAD
const API_URL = 'http://api.yourdomain.com'; // Unencrypted!
```

### 3. Handle Errors Securely

```typescript
// ✅ GOOD
catch (error) {
  console.error('Authentication failed');
  setError('Invalid credentials');
}

// ❌ BAD
catch (error) {
  console.error('Error:', error.stack); // Leaks info!
  setError(error.message); // May expose internal details!
}
```

### 4. Clear Sensitive Data

```typescript
// ✅ GOOD
formData.password = '';
formData.confirmPassword = '';
formData.clientSecret = '';

// ❌ BAD
// Leaving sensitive data in memory
```

### 5. Use Secure Random Values

```typescript
// ✅ GOOD
const token = generateSecureToken(); // Uses crypto.getRandomValues()

// ❌ BAD
const token = Math.random().toString(36); // Predictable!
```

## Common Attack Vectors & Defenses

### Cross-Site Scripting (XSS)

**Attack**: Injecting malicious scripts
```html
<script>alert(document.cookie)</script>
```

**Defense**:
- Input sanitization (✅ implemented)
- Output encoding (✅ React does this)
- Content Security Policy (⚠️ needs server configuration)

### SQL Injection

**Attack**: Manipulating database queries
```sql
admin'; DROP TABLE users;--
```

**Defense**:
- Parameterized queries (backend responsibility)
- Input validation (✅ implemented)
- Least privilege database access

### Cross-Site Request Forgery (CSRF)

**Attack**: Unauthorized actions via authenticated session

**Defense**:
- CSRF tokens (⚠️ needs backend implementation)
- SameSite cookies
- Origin validation

### File Upload Attacks

**Attack**: Uploading malicious files
```xml
<svg onload="alert('XSS')">
```

**Defense**:
- File type validation (✅ SVG blocked)
- File size limits (✅ 5MB max)
- Extension verification (✅ implemented)
- Virus scanning (⚠️ recommended for production)

### Session Hijacking

**Attack**: Stealing session tokens

**Defense**:
- HTTPS only (✅ enforced in production)
- Secure cookies (⚠️ backend)
- Session timeout
- IP validation

## Incident Response Plan

### If a Security Breach is Detected

**Within 1 Hour**:
1. Isolate affected systems
2. Preserve logs and evidence
3. Notify security team
4. Assess scope of breach

**Within 24 Hours**:
5. Rotate all API keys and secrets
6. Force password reset for affected accounts
7. Patch vulnerabilities
8. Begin forensic investigation

**Within 72 Hours**:
9. Public disclosure (if legally required)
10. Notify affected users
11. Implement additional security measures
12. Complete incident report

**Ongoing**:
13. Monitor for further attacks
14. Review and update security practices
15. Conduct security training
16. Third-party security audit

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Web Security Checklist](https://github.com/0xRadi/OWASP-Web-Checklist)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [NIST Guidelines](https://www.nist.gov/cyberframework)
- [CWE Top 25](https://cwe.mitre.org/top25/)

## Contact

For security concerns:
- **Emergency**: Contact security team immediately
- **Non-urgent**: security@yourdomain.com
- **Bug Bounty**: https://yourdomain.com/security/bug-bounty

---

**Last Updated**: 2026-01-17
**Review Schedule**: Quarterly
**Next Review**: 2026-04-17
