# CRITICAL SECURITY WARNINGS - Onboarding Module

## ⚠️ CRITICAL: Sensitive Data in SessionStorage

**SECURITY VULNERABILITY**: The onboarding module currently stores sensitive data in browser sessionStorage, including:

- Admin user passwords (plain text)
- OAuth client secrets
- API keys and access keys
- App passwords
- SMTP credentials

### Why This Is Dangerous

1. **No Encryption**: sessionStorage is NOT encrypted
2. **XSS Vulnerable**: Any XSS attack can read all sessionStorage data
3. **Browser Tools**: Anyone with physical access can inspect sessionStorage in browser dev tools
4. **Logs/Debugging**: Data may be logged or appear in debugging tools

### ⚠️ IMMEDIATE ACTION REQUIRED

**DO NOT use this onboarding module in production until the following is implemented:**

1. **Remove password storage**: Admin password should ONLY be sent to backend during account creation API call, never stored client-side
2. **Remove API keys from storage**: OAuth secrets, API keys, and access tokens should go directly to backend
3. **Server-side validation**: All sensitive data must be validated server-side, not just client-side
4. **Use secure backend session**: Store onboarding state in a secure server-side session with HTTPS-only cookies

### Recommended Architecture

```
Client                          Server
------                          ------
1. Collect data     ──────►
2. Send to API      ──────►     Store in encrypted DB
3. Get session ID   ◄──────     Return secure session token
4. Continue flow                Use server-side session
```

### What's Currently Safe

- Department name
- Logo (base64 image)
- Navigation preference
- Platform choices (gmail vs microsoft, etc.)
- IT team contact info (names, phones, emails)

### What Must Change

❌ **NEVER store in sessionStorage**:
- Passwords
- OAuth client secrets
- API keys
- Access tokens
- App passwords
- SMTP credentials

✅ **Instead**:
- Send directly to backend API
- Store in encrypted database
- Use server-side sessions
- Clear from memory immediately after use

## Other Security Improvements Needed

### 1. HTTPS Enforcement

**Current State**: Development allows HTTP
**Production Need**: Enforce HTTPS-only

```typescript
// Add to index.html or main entry point
if (location.protocol !== 'https:' && !import.meta.env.DEV) {
  location.replace(`https:${location.href.substring(location.protocol.length)}`);
}
```

### 2. Content Security Policy (CSP)

Add CSP headers to prevent XSS:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self' https://api.yourserver.com;
```

### 3. Secure Cookies (Backend)

When backend creates sessions:

```python
response.set_cookie(
    'session_id',
    value=session_token,
    secure=True,        # HTTPS only
    httponly=True,      # Not accessible via JavaScript
    samesite='Strict',  # CSRF protection
    max_age=3600        # 1 hour expiry
)
```

### 4. Rate Limiting

Implement rate limiting on backend API endpoints:

```python
# Example with FastAPI
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.post("/api/v1/onboarding/admin-user")
@limiter.limit("5/minute")  # Max 5 attempts per minute
async def create_admin_user(...):
    pass
```

### 5. Input Sanitization

**Status**: ✅ IMPLEMENTED in security.ts

All user inputs are now sanitized to prevent injection attacks.

### 6. File Upload Security

**Status**: ✅ IMPROVED

- SVG files now blocked (XSS risk)
- File size limits enforced (5MB)
- MIME type validation
- Extension validation

### 7. Email Validation

**Status**: ✅ IMPROVED

- Enhanced regex to prevent injection
- Length limits (max 254 chars)
- Newline/carriage return prevention

### 8. CSRF Protection

**Current State**: Not implemented
**Production Need**: Add CSRF tokens to all state-changing operations

```python
# Backend: Generate CSRF token
csrf_token = secrets.token_urlsafe(32)
session['csrf_token'] = csrf_token

# Frontend: Include in all POST requests
headers = {
    'X-CSRF-Token': csrf_token
}
```

### 9. Audit Logging

**Current State**: Backend has audit logging
**Recommendation**: Log all onboarding attempts including:

- IP address
- User agent
- Timestamp
- Success/failure
- Data validation failures

### 10. Account Lockout

**Backend Implementation Needed**:

- Lock account after 5 failed attempts
- 30-minute lockout period
- Email notification to backup contacts
- IP-based rate limiting

## Security Checklist for Production

Before deploying to production, ensure:

- [ ] All sensitive data removed from sessionStorage
- [ ] HTTPS enforced
- [ ] CSP headers configured
- [ ] Secure cookies implemented
- [ ] Rate limiting active
- [ ] CSRF protection enabled
- [ ] Input sanitization tested
- [ ] File upload security verified
- [ ] SQL injection testing passed
- [ ] XSS testing passed
- [ ] Penetration testing completed
- [ ] Security audit performed
- [ ] Vulnerability scanning done
- [ ] Dependencies audited (npm audit)
- [ ] Secrets rotated
- [ ] Backup recovery tested

## Testing Recommendations

### XSS Testing

Try these inputs in all text fields:

```
<script>alert('XSS')</script>
<img src=x onerror=alert('XSS')>
javascript:alert('XSS')
<svg onload=alert('XSS')>
```

All should be sanitized and rendered harmless.

### SQL Injection Testing

Backend should use parameterized queries. Test:

```
admin'; DROP TABLE users;--
' OR '1'='1
1' UNION SELECT * FROM passwords--
```

### File Upload Testing

- Upload .exe file renamed to .png
- Upload SVG with embedded JavaScript
- Upload 100MB file
- Upload file with null bytes in name

## Emergency Response

If a security breach is detected:

1. **Immediate**: Rotate all API keys and secrets
2. **Within 1 hour**: Force password reset for all users
3. **Within 24 hours**: Security audit of all systems
4. **Within 72 hours**: Public disclosure (if required by law)
5. **Ongoing**: Monitor for further attacks

## Contact Security Team

For security concerns, contact:
- Security Email: security@yourdomain.com
- Emergency Hotline: +1-XXX-XXX-XXXX
- Bug Bounty: https://yourdomain.com/security

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CIS Controls](https://www.cisecurity.org/controls)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)

---

**Last Updated**: 2026-01-17
**Next Review**: Quarterly or after any security incident
