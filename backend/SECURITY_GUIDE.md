# Secrets and security setup — backend

Which secrets this application needs, where each belongs, and how they are
protected. Written for whoever stands up an installation.

> **Rewritten 2026-08-24.** The previous version had drifted badly enough to
> mislead an operator following it:
>
> - Its **"⚠️ What Needs Implementation"** section listed six controls — rate
>   limiting, CSRF, security headers, server-side onboarding sessions, input
>   sanitization, security audit logging — each annotated "(NEW — created in
>   this update)". They were **already implemented**; the heading contradicted
>   its own contents and read as a list of gaps in the product.
> - It told operators to generate and set **`CSRF_SECRET`**. **No such setting
>   exists**, in the code or in either `.env.example`.
> - It told them to configure **`CORS_ORIGINS`**. The real setting is
>   **`ALLOWED_ORIGINS`**; the name in the doc configures nothing.
> - It documented an **`EMAIL_PROVIDER`** variable with SendGrid and AWS SES
>   options. That variable exists nowhere but in that document, and neither
>   provider is integrated.
> - Its MySQL `GRANT` was **`SELECT, INSERT, UPDATE, DELETE` only**, which
>   cannot run the Alembic migrations the application applies on startup.
>
> Corrected against the code rather than deleted, because the `.env` and
> secrets material here is not duplicated anywhere else.

## Two kinds of secret, and only one goes in `.env`

**Application secrets** — what the _application_ uses to reach its
dependencies, and the keys it signs and encrypts with. These belong in `.env`.

**User passwords** — never in `.env`, never in configuration, never anywhere
but the database as an Argon2id hash. If you find yourself typing a member's
password into a config file, stop.

## Required in production

| Variable              | Purpose                                 |
| --------------------- | --------------------------------------- |
| `SECRET_KEY`          | JWT signing                             |
| `ENCRYPTION_KEY`      | AES-256 for encrypted columns           |
| `ENCRYPTION_SALT`     | Key derivation, unique per installation |
| `DB_PASSWORD`         | Application database user               |
| `MYSQL_ROOT_PASSWORD` | Database root                           |
| `REDIS_PASSWORD`      | Redis auth                              |
| `ALLOWED_ORIGINS`     | Comma-separated CORS origins            |

Generate them with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # SECRET_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"        # ENCRYPTION_KEY
python3 -c "import secrets; print(secrets.token_hex(16))"        # ENCRYPTION_SALT
```

`config.py` refuses to start on a `SECRET_KEY` or `ENCRYPTION_KEY` shorter than
32 characters, and its own error message tells you to generate with
`token_urlsafe(64)`. **Use 64.** The 32-character floor is a backstop against a
placeholder, not a target.

**`ALLOWED_ORIGINS` is validated, not merely read.** A wildcard `*` is refused
with a CRITICAL error rather than silently accepted.

## Database user

Grant enough for Alembic to run — the application applies migrations on
startup, and a DML-only grant fails there:

```sql
CREATE USER 'intranet_user'@'%' IDENTIFIED BY 'your_secure_db_password_here';
CREATE DATABASE intranet_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, ALTER, DROP, INDEX, REFERENCES
  ON intranet_db.* TO 'intranet_user'@'%';
FLUSH PRIVILEGES;
```

`intranet_db` / `intranet_user` are the defaults in `config.py`; change both
together with `DB_NAME` / `DB_USER` if you use different names. Do not run the
application as the MySQL root user.

## Email

There is **no `EMAIL_PROVIDER` setting**. Email is SMTP, configured globally by
environment or per organization in the app (organization SMTP passwords are
stored encrypted and decrypted on read):

```bash
EMAIL_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_ENCRYPTION=tls
SMTP_USER=noreply@yourdepartment.org
SMTP_PASSWORD=your_app_specific_password
SMTP_FROM_EMAIL=noreply@yourdepartment.org
SMTP_FROM_NAME=Your Fire Department
```

Use an app-specific password, never an account's primary password. The full set
of options is in `.env.example.full`.

## What is already in place

You do not need to build or enable any of this — it ships on:

| Control                                                                                  | Where                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| Argon2id password hashing, with automatic rehash on parameter change                     | `app/core/security.py`                    |
| AES-256 encryption of sensitive columns                                                  | `app/core/security.py`                    |
| Tamper-evident audit log (keyed HMAC hash chain)                                         | `app/core/audit.py`                       |
| Auth via **httpOnly cookies**, with CSRF double-submit on state-changing requests        | `app/core/`, and the frontend axios layer |
| MFA — TOTP with backup codes                                                             | `app/services/auth.py`                    |
| Rate limiting, security headers (including `frame-ancestors 'none'`), input sanitization | `app/core/security_middleware.py`         |
| Account lockout, suspicious-IP throttling, breached-password checks, CAPTCHA             | see **Attack Protection** in `CLAUDE.md`  |
| Server-side onboarding sessions, sensitive data encrypted server-side                    | `OnboardingSessionManager`                |

**Tokens are not returned to the browser.** Authentication is httpOnly cookies
plus a CSRF double-submit header; nothing stores a JWT in `localStorage` and
nothing sends an `Authorization` header. If you are extending the API, keep it
that way.

Two failure directions in the attack-protection stack are deliberate and
opposite, and must be preserved: **breached-password lookup fails open** (an
outage must not block password changes, and four other controls still apply),
while **CAPTCHA fails closed** (nothing sits behind it, so accepting unverified
traffic during an outage is exactly what an attacker wants). `CLAUDE.md` has the
full table.

## Password rules

Enforced in code, on the server:

- 12 characters minimum
- Upper, lower, digit and special-character classes
- Rejected if in the common-password list, or too similar to the username or
  email

Application secrets are a different thing and have different rules: 32
characters minimum (64 recommended), cryptographically random, distinct per
environment, never shared between systems, never committed.

## How a password moves through the system

```
Browser  ──HTTPS──>  backend validates strength
                     ↓
                     Argon2id hash  ($argon2id$v=19$m=65536,t=3,p=4$…)
                     ↓
                     stored on the user row
                     ↓
                     plaintext cleared; never written to disk or a log
```

Verification hashes the submitted password and compares; the stored value is
never decrypted, because it is not encrypted — it is a one-way hash.

## Before you go live

- [ ] `SECRET_KEY`, `ENCRYPTION_KEY`, `ENCRYPTION_SALT` generated fresh for
      this installation — never a default, never copied from another
      environment
- [ ] `ENVIRONMENT=production` and `DEBUG=false`
- [ ] `ALLOWED_ORIGINS` set to your real origins, no wildcard
- [ ] Database password 16+ characters, dedicated non-root user with the grants
      above
- [ ] `REDIS_PASSWORD` set
- [ ] HTTPS terminated in front, HSTS on
- [ ] `.env` out of version control
- [ ] `ENABLE_DOCS=false` if you do not want the API docs public
- [ ] Backups running, and a restore actually tested

## See also

- [`../SECURITY.md`](../SECURITY.md) — security policy and HIPAA posture
- [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — production deployment
- [`../docs/KEY_ROTATION.md`](../docs/KEY_ROTATION.md) — rotating these keys
- [`../CLAUDE.md`](../CLAUDE.md) — the auth, CSRF and attack-protection rules
  the code is held to
- [`../docs/security/`](../docs/security/) — red-team reviews and the dynamic
  testing guide
