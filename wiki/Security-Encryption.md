# Encryption

The Logbook uses multi-layer encryption to protect data at rest, in transit, and in the audit log.

---

## Overview

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| **Passwords** | Argon2id | Password hashing (irreversible) |
| **Data at rest** | AES-256 | Encrypt sensitive database fields |
| **Data in transit** | TLS 1.3 | HTTPS for all client-server communication |
| **Audit log integrity** | SHA-256 hash chain | Tamper-proof audit trail |

---

## Password Hashing (Argon2id)

Passwords are hashed using Argon2id, the OWASP-recommended algorithm. Argon2id is memory-hard, making brute-force and GPU attacks impractical.

- Passwords are **never stored in plaintext**
- Hash comparison is constant-time (prevents timing attacks)
- Implementation: `backend/app/core/security.py`

---

## AES-256 Encryption at Rest

Sensitive fields in the database are encrypted using AES-256 before storage.

### Configuration

Two environment variables control encryption:

```bash
ENCRYPTION_KEY=<64-character hex string>   # openssl rand -hex 32
ENCRYPTION_SALT=<32-character hex string>  # openssl rand -hex 16
```

### What Is Encrypted

- Sensitive personal information (SSN, medical data when applicable)
- API keys and integration credentials
- MFA secrets
- Backup encryption keys

### Key Rotation

To rotate encryption keys:

1. Generate new `ENCRYPTION_KEY` and `ENCRYPTION_SALT`
2. Run the key rotation script (decrypts with old key, re-encrypts with new)
3. Update `.env` with new values
4. Restart the backend

---

## TLS 1.3 (Data in Transit)

All data between clients and the server should be encrypted via HTTPS in production.

### Setting Up HTTPS

**With reverse proxy (recommended):**

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;
    ssl_protocols TLSv1.3;

    location / {
        proxy_pass http://localhost:3000;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
    }
}
```

**With Let's Encrypt (free certificates):**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Audit Log Hash Chain

The audit logging system uses a blockchain-inspired SHA-256 hash chain to ensure tamper-proof records.

### How It Works

1. Each audit log entry includes the hash of the previous entry
2. Any modification to a past entry breaks the chain
3. Periodic checkpoints verify chain integrity
4. 7-year retention (2555 days), exceeds HIPAA 6-year minimum

### Verifying Integrity

```bash
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity
```

Response indicates whether the chain is intact or which entries have issues.

---

**See also:** [Security Overview](Security-Overview) | [Authentication](Security-Authentication) | [Audit Logging](Security-Audit-Logging)
