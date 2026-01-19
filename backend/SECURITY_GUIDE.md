# Security Guide for The Logbook

## Understanding Different Types of Secrets

### 1. Application Secrets (.env file)
**What they are**: Credentials that the APPLICATION uses to connect to services

**Examples**:
- Database password (for the app to connect to MySQL)
- JWT secret key (for the app to sign tokens)
- Encryption key (for the app to encrypt data)
- API keys for third-party services (SendGrid, AWS, etc.)

**Where they go**: `.env` file (NEVER commit to git!)

**Example .env file**:
```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=logbook_app
DB_PASSWORD=super_secret_db_password_here  # ← Application secret
DB_NAME=logbook

# Security Keys (generate with: python -c "import secrets; print(secrets.token_urlsafe(32))")
SECRET_KEY=kZ4Hf9_YOUR_RANDOM_SECRET_HERE  # ← Application secret (JWT signing)
ENCRYPTION_KEY=nP2Jm_YOUR_ENCRYPTION_KEY_HERE  # ← Application secret (AES encryption)

# Redis
REDIS_URL=redis://localhost:6379/0

# Email (SendGrid example)
SENDGRID_API_KEY=SG.YOUR_API_KEY_HERE  # ← Application secret

# AWS S3 (if using)
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE  # ← Application secret
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG  # ← Application secret
AWS_S3_BUCKET=logbook-uploads

# Environment
ENVIRONMENT=production
```

### 2. User Passwords (NEVER in .env!)
**What they are**: Credentials that USERS create to log into the system

**Examples**:
- Admin user password
- Regular user passwords
- MFA codes

**Where they go**: Database (HASHED with Argon2id)

**CRITICAL**: User passwords are NEVER stored in .env files!

```python
# ✅ CORRECT - User creates password during signup
password = "MyP@ssw0rd123"  # User types this
hashed = hash_password(password)  # Hash it with Argon2id
# Store hashed version in database
user.password_hash = hashed

# ❌ WRONG - NEVER do this!
# .env file
USER_ADMIN_PASSWORD=MyP@ssw0rd123  # ← WRONG! NEVER!
```

## Current Security Implementation

### ✅ What's Secure

1. **Password Hashing**
   - Uses Argon2id (OWASP recommended)
   - Configurable parameters (time_cost, memory_cost, parallelism)
   - Automatic rehashing when parameters change
   - Located: `backend/app/core/security.py`

2. **Data Encryption at Rest**
   - AES-256 encryption for sensitive fields
   - Encrypted before database storage
   - Located: `backend/app/core/security.py`

3. **Tamper-Proof Audit Logging**
   - Blockchain-inspired hash chain
   - Detects log tampering
   - SHA-256 hashing
   - Located: `backend/app/core/audit.py`

4. **JWT Authentication**
   - Access and refresh tokens
   - Configurable expiration
   - Secure token validation
   - Located: `backend/app/services/auth.py`

5. **MFA Support**
   - TOTP (Time-based One-Time Password)
   - QR code generation
   - Backup codes
   - Located: `backend/app/services/auth.py`

### ⚠️ What Needs Implementation

1. **Server-Side Sessions for Onboarding** (NEW - created in this update)
   - Model: `OnboardingSessionModel`
   - Service: `OnboardingSessionManager`
   - Stores sensitive data encrypted server-side
   - Sessions expire after 2 hours

2. **Rate Limiting** (NEW - created in this update)
   - `RateLimiter` class for brute force prevention
   - 5 requests/minute default
   - 30-minute lockout after exceeding limits
   - Located: `backend/app/core/security_middleware.py`

3. **CSRF Protection** (NEW - created in this update)
   - `CSRFProtection` class
   - Token generation and validation
   - Constant-time comparison
   - Located: `backend/app/core/security_middleware.py`

4. **Security Headers** (NEW - created in this update)
   - `SecurityHeadersMiddleware`
   - HSTS, CSP, X-Frame-Options, etc.
   - Located: `backend/app/core/security_middleware.py`

5. **Input Sanitization** (NEW - created in this update)
   - `InputSanitizer` class
   - Email, username, phone validation
   - XSS prevention
   - Located: `backend/app/core/security_middleware.py`

6. **Security Audit Logging** (NEW - created in this update)
   - `SecurityAuditLogger` class
   - Logs authentication events
   - Tracks suspicious activity
   - Located: `backend/app/core/security_middleware.py`

## Setting Up .env File

### Step 1: Copy Example File

```bash
cp .env.example .env
```

### Step 2: Generate Secure Keys

```bash
# Generate SECRET_KEY
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(32))"

# Generate ENCRYPTION_KEY
python -c "import secrets; print('ENCRYPTION_KEY=' + secrets.token_urlsafe(32))"

# Generate CSRF_SECRET
python -c "import secrets; print('CSRF_SECRET=' + secrets.token_urlsafe(32))"
```

### Step 3: Configure Database

```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=logbook_app
DB_PASSWORD=your_secure_db_password_here
DB_NAME=logbook
```

**IMPORTANT**: Create a dedicated database user with limited permissions:

```sql
CREATE USER 'logbook_app'@'localhost' IDENTIFIED BY 'your_secure_db_password_here';
CREATE DATABASE logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT SELECT, INSERT, UPDATE, DELETE ON logbook.* TO 'logbook_app'@'localhost';
FLUSH PRIVILEGES;
```

### Step 4: Configure Email (Optional)

Choose ONE email provider:

**Option A: SendGrid**
```bash
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.your_api_key_here
EMAIL_FROM=noreply@yourdepartment.com
EMAIL_FROM_NAME=Your Fire Department
```

**Option B: SMTP (Gmail, Office 365, etc.)**
```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_TLS=true
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your_app_password_here  # Use app password, not regular password
EMAIL_FROM=noreply@yourdepartment.com
EMAIL_FROM_NAME=Your Fire Department
```

**Option C: AWS SES**
```bash
EMAIL_PROVIDER=ses
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG
AWS_REGION=us-east-1
EMAIL_FROM=noreply@yourdepartment.com
EMAIL_FROM_NAME=Your Fire Department
```

### Step 5: Set Environment

```bash
# Development
ENVIRONMENT=development

# Production
ENVIRONMENT=production
```

## Security Checklist

### Before Production Deployment

- [ ] Generate new SECRET_KEY (never use default)
- [ ] Generate new ENCRYPTION_KEY (never use default)
- [ ] Use strong database password (16+ characters)
- [ ] Enable HTTPS/TLS
- [ ] Set ENVIRONMENT=production
- [ ] Configure CORS_ORIGINS for your domain
- [ ] Enable security headers
- [ ] Set up rate limiting
- [ ] Configure CSRF protection
- [ ] Review all .env settings
- [ ] Never commit .env to git (add to .gitignore)
- [ ] Use environment-specific .env files
- [ ] Rotate secrets regularly
- [ ] Enable database backups
- [ ] Set up monitoring/alerting
- [ ] Configure firewall rules
- [ ] Enable audit logging
- [ ] Test disaster recovery

### Password Security

**User Password Requirements** (enforced in code):
- Minimum 12 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character
- Not in common password list
- Not similar to username/email

**Application Secret Requirements**:
- Minimum 32 characters
- Cryptographically random (use `secrets` module)
- Different for each environment
- Rotated regularly
- Never shared between systems
- Never committed to version control

## How Passwords Flow Through the System

### User Registration (Onboarding)

```
1. User enters password in browser
   ↓
2. Sent to backend via HTTPS (encrypted in transit)
   ↓
3. Backend validates password strength
   ↓
4. Backend hashes with Argon2id
   hash = argon2id.hash(password)
   # Example output: $argon2id$v=19$m=65536,t=3,p=4$...
   ↓
5. Hash stored in database
   user.password_hash = hash
   ↓
6. Original password NEVER stored
   password = ""  # Clear from memory
```

### User Login

```
1. User enters password
   ↓
2. Sent to backend via HTTPS
   ↓
3. Backend retrieves hash from database
   ↓
4. Backend verifies password
   is_valid = argon2id.verify(hash, password)
   ↓
5. If valid, create JWT token
   token = create_access_token(user_id)
   ↓
6. Return token to user (NOT password!)
   ↓
7. Original password cleared from memory
   password = ""
```

### Why This is Secure

1. **In Transit**: HTTPS encrypts password during transmission
2. **At Rest**: Password hash stored, not password
3. **In Memory**: Password cleared immediately after use
4. **Brute Force**: Argon2id is slow by design (prevents cracking)
5. **Rainbow Tables**: Salt is unique per password
6. **Database Breach**: Attackers get hashes, not passwords

## What NOT to Do

### ❌ NEVER Store Passwords in .env

```bash
# .env file
ADMIN_PASSWORD=MyP@ssw0rd123  # ← WRONG!
```

### ❌ NEVER Store Passwords in Config Files

```python
# config.py
ADMIN_PASSWORD = "MyP@ssw0rd123"  # ← WRONG!
```

### ❌ NEVER Store Passwords in Database Unhashed

```python
# models.py
class User(Base):
    password = Column(String(255))  # ← WRONG if storing plain text!
    # Should be:
    password_hash = Column(String(255))  # ← Correct!
```

### ❌ NEVER Log Passwords

```python
logger.info(f"User password: {password}")  # ← WRONG!
print(f"Password: {password}")  # ← WRONG!
```

### ❌ NEVER Send Passwords in URLs

```bash
https://api.example.com/login?password=MyP@ssw0rd123  # ← WRONG!
# URLs are logged, passwords would be exposed
```

### ❌ NEVER Use Weak Hashing

```python
import hashlib
password_hash = hashlib.md5(password.encode()).hexdigest()  # ← WRONG! MD5 is broken
password_hash = hashlib.sha256(password.encode()).hexdigest()  # ← WRONG! No salt, too fast

# Correct:
from app.core.security import hash_password
password_hash = hash_password(password)  # ← Uses Argon2id
```

## Environment Variables

### Required

```bash
SECRET_KEY=                # JWT signing key
ENCRYPTION_KEY=            # AES encryption key
DB_PASSWORD=               # Database password
```

### Optional but Recommended

```bash
REDIS_URL=                 # Session storage
SENDGRID_API_KEY=          # Email delivery
AWS_ACCESS_KEY_ID=         # Cloud storage
AWS_SECRET_ACCESS_KEY=     # Cloud storage
SMTP_PASSWORD=             # Email (if using SMTP)
```

### Security Settings

```bash
CORS_ORIGINS=https://yourdomain.com
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
ENVIRONMENT=production
DEBUG=false
```

## Rotating Secrets

### When to Rotate

- Every 90 days (recommended)
- After employee departure
- After suspected breach
- After key exposure
- Before major releases

### How to Rotate Secrets

1. **Generate new secret**
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

2. **Update .env file**
```bash
# Old
SECRET_KEY=old_key_here

# New
SECRET_KEY=new_key_here
```

3. **Restart application**
```bash
systemctl restart logbook
```

4. **Invalidate old sessions**
```sql
DELETE FROM sessions WHERE created_at < NOW() - INTERVAL 1 DAY;
```

5. **Update backup .env files**

## Encryption Key Management

### Current Implementation

```python
# backend/app/core/security.py
from cryptography.fernet import Fernet

# Key from .env file
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
fernet = Fernet(ENCRYPTION_KEY)

# Encrypt
encrypted = fernet.encrypt(sensitive_data.encode())

# Decrypt
decrypted = fernet.decrypt(encrypted).decode()
```

### Best Practices

1. **Key Storage**
   - Store in .env file
   - Never hardcode
   - Use environment variables
   - Consider key management service (AWS KMS, Azure Key Vault)

2. **Key Rotation**
   - Plan for key rotation
   - Keep old keys for decryption
   - Re-encrypt data with new keys
   - Document rotation procedure

3. **Access Control**
   - Limit who can access .env
   - Use file permissions (chmod 600)
   - Separate keys per environment
   - Audit key access

## References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [NIST Password Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [Argon2 Documentation](https://argon2-cffi.readthedocs.io/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)

---

**Last Updated**: 2026-01-17
**Next Review**: 2026-04-17
