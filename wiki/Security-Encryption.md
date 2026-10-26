# Encryption

The Logbook uses multi-layer encryption to protect data at rest, in transit, and in the audit log.

---

## Overview

| Layer                   | Algorithm                    | Purpose                                                                                     |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| **Passwords**           | Argon2id                     | Password hashing (irreversible)                                                             |
| **Data at rest**        | AES-256-GCM                  | Authenticated encryption of sensitive database fields (legacy Fernet values still readable) |
| **Data in transit**     | TLS 1.2 / 1.3                | HTTPS for all client-server communication                                                   |
| **Audit log integrity** | HMAC-SHA256 keyed hash chain | Tamper-evident audit trail                                                                  |

---

## Password Hashing (Argon2id)

Passwords are hashed using Argon2id, the OWASP-recommended algorithm. Argon2id is memory-hard, making brute-force and GPU attacks impractical.

- Passwords are **never stored in plaintext**
- Hash comparison is constant-time (prevents timing attacks)
- Implementation: `backend/app/core/security.py`

---

## Authenticated Encryption at Rest (AES-256-GCM)

Sensitive fields in the database are encrypted using **AES-256-GCM** before
storage — authenticated encryption that provides both confidentiality and
integrity in one pass (a tampered ciphertext fails to decrypt rather than
silently returning garbage), with a fresh random 96-bit nonce per value.

Values written before the AES-256-GCM migration used **Fernet**
(AES-128-CBC + HMAC-SHA256); these remain transparently readable, so no data
migration is required for correctness. `backend/scripts/reencrypt_to_aesgcm.py`
(dry-run by default) re-encrypts existing rows to AES-256-GCM as a background
step, after which Fernet read-support can be retired. See the operator runbook:
[`docs/AES256_GCM_BACKFILL_RUNBOOK.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/AES256_GCM_BACKFILL_RUNBOOK.md).

### Configuration

Two environment variables control encryption:

```bash
ENCRYPTION_KEY=<64-character hex string>   # openssl rand -hex 32
ENCRYPTION_SALT=<32-character hex string>  # openssl rand -hex 16
```

### What Is Encrypted

Field-level encryption covers the columns and settings below. Everything else
in the database — names and email addresses among it — is stored in plain
columns and protected by access control, not by field encryption. Encrypting
the database volume or disk covers a stolen drive, but **not** a `mysqldump` or
a backup: the server decrypts its own storage to answer the dump, so only a
field-encrypted column stays unreadable in one. The application stores no
Social Security numbers.

A department's own published details — the organization's address and phone,
station and location addresses, vendor and utility company details, the org
chart's office lines — are deliberately left plain; they identify no private
person, and some are searched.

| Where                              | What                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screening_records`                | Medical-screening PHI: `provider_name`, `result_summary`, `result_data`, `notes` (see below)                                                                                                                                                                                                                                                                                     |
| `shift_completion_reports`         | Officer evaluation narrative: `areas_of_strength`, `areas_for_improvement`, `officer_narrative`, `reviewer_notes`                                                                                                                                                                                                                                                                |
| `prospective_members.status_token` | The applicant's status-page credential                                                                                                                                                                                                                                                                                                                                           |
| `users`                            | MFA (TOTP) secret and MFA recovery codes; `date_of_birth`, `emergency_contacts`; `phone`, `mobile` and the home address (`address_street`, `address_city`, `address_state`, `address_zip`)                                                                                                                                                                                       |
| `prospective_members`, `prospects` | `date_of_birth` (applicants); `phone`, `mobile` and the home address, as for `users`                                                                                                                                                                                                                                                                                             |
| Other people's contact details     | `event_external_attendees.phone`; `store_orders.customer_phone`, `shipping_address`; `donors` phone and address; `check_requests.payee_address`; `organization_officers.phone`; facility emergency contacts, contractors, insurance agents and occupant contacts; `inventory_vendor_contacts.phone`; `event_requests.contact_phone`, `venue_address`                             |
| `external_training_providers`      | `api_key`, `api_secret`, `client_secret`                                                                                                                                                                                                                                                                                                                                         |
| Integrations                       | Each integration's secrets (`encrypted_config`)                                                                                                                                                                                                                                                                                                                                  |
| Organization settings JSON         | Email secrets (`smtp_password`, `google_app_password`, `google_service_account_key`, `microsoft_app_password`, `microsoft_client_secret`, `cloudflare_api_token`), file-storage secrets (`google_drive_client_secret`, `onedrive_client_secret`, `s3_secret_access_key`) and OAuth client secrets (`google_client_secret`, `microsoft_client_secret`, `authentik_client_secret`) |
| Onboarding sessions                | Email and file-storage configuration entered during setup                                                                                                                                                                                                                                                                                                                        |
| Short-lived replay cache           | A shown-once secret (such as new recovery codes) kept briefly so a retried request can receive it                                                                                                                                                                                                                                                                                |
| Uploaded files                     | Every file written under the uploads root, each with its own AES-256-GCM key wrapped by a key derived from `ENCRYPTION_KEY`; files stored before file encryption existed stay readable until `scripts/encrypt_uploads.py` encrypts them                                                                                                                                          |

> **Medical-screening PHI at rest.** Four columns on `screening_records` use
> the transparent `EncryptedText` / `EncryptedJSON` column types:
>
> | Column           | Type            | Holds                                               |
> | ---------------- | --------------- | --------------------------------------------------- |
> | `provider_name`  | `EncryptedText` | The clinic or physician who performed the screening |
> | `result_summary` | `EncryptedText` | Free-text outcome                                   |
> | `result_data`    | `EncryptedJSON` | Structured results — scores, measurements           |
> | `notes`          | `EncryptedText` | Free-text notes                                     |
>
> The column types decrypt on read and encrypt on write, so service and endpoint
> code needs no changes. **Legacy plaintext values remain readable** — a value that
> does not carry the ciphertext marker is returned as-is — so no backfill is
> required for correctness; `backend/scripts/reencrypt_to_aesgcm.py` covers
> re-encrypting them as a background task.
>
> **Decryption failures fail closed.** A value that cannot be decrypted raises
> rather than being returned as ciphertext or silently as empty — the same rule
> external-training credentials follow.

> **Email credentials at rest:** All email platform secrets — `smtp_password`, `google_app_password`, `google_service_account_key`, `microsoft_app_password`, `microsoft_client_secret`, and `cloudflare_api_token` — are AES-256-GCM encrypted before being stored in the organization settings JSON column. They are prefixed with `enc:` to prevent double-encryption and are redacted to `••••••••` in all API responses.

### Key Rotation

Rotation uses a **legacy-key ring**: decryption tries the current
`ENCRYPTION_KEY` first, then each key listed in `ENCRYPTION_KEYS_LEGACY`
(comma-separated). Encryption always uses the current key. Because AES-GCM
authenticates every value, only the correct key can decrypt — trying several
never weakens the fail-closed guarantee. That makes every intermediate state
of a rotation safe: nothing breaks the moment you deploy the new key.

1. Back up the database **and** your current `.env` secrets first.
2. Move the old key into `ENCRYPTION_KEYS_LEGACY`, set the new
   `ENCRYPTION_KEY`, and restart. Do **not** change `ENCRYPTION_SALT` — it is
   installation-scoped, not key-scoped, and changing it invalidates every key
   in the ring.
3. Drain the rotation (dry-run by default):
   ```bash
   docker exec -it intranet-backend python scripts/rotate_encryption_key.py
   docker exec -it intranet-backend python scripts/rotate_encryption_key.py --commit
   ```
4. When a `--commit` run reports zero rotated and zero unreadable values,
   remove the drained key from `ENCRYPTION_KEYS_LEGACY` and restart.

### Date of birth and emergency contacts

Members' and applicants' dates of birth and members' emergency contacts (names,
relationships, phones, emails of people who are not members) are stored as
AES-256-GCM ciphertext, like screening records. Screens, exports and integrations
are unchanged; the database cannot search or sort on them. They are covered by
`scripts/rotate_encryption_key.py`. See
[`docs/UPGRADING.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md).

### Database and cache TLS

The bundled MySQL and Redis can offer TLS with certificates from a private CA
you generate (`scripts/tls-setup.sh`). The backend and the backup sidecar verify
the server's certificate and name, and present a client certificate. Plaintext is
accepted until you set `DB_REQUIRE_TLS=true` / `REDIS_REQUIRE_TLS=true`; run
`scripts/tls-enforce.sh` first, which lists any client still connecting without
TLS. Administrators get a banner 30 days before a certificate expires. Setup,
enforcement, renewal and CA-key custody: [`docs/TLS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/TLS.md).

### Encrypted backups

Backups are encrypted once `scripts/backup-keygen.sh` has created a key
(until then they stay plaintext, log a warning each run, and administrators
see a critical notice). Each archive is AES-256 encrypted with its own random
key, and that key is wrapped to two recipients: a **drill key** on the server,
so the nightly restore drill can open what it wrote, and a **certificate**
whose private key you keep offline. Only the offline key protects backups
taken before a server compromise. If both are lost the backups cannot be
recovered. Offsite uploads carry ciphertext only and refuse a plaintext
archive. Setup, restore and key custody: [`docs/BACKUP.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/BACKUP.md#encrypted-backups).

> ⚠️ **A database backup without its era's `ENCRYPTION_KEY`/`ENCRYPTION_SALT`
> cannot decrypt sensitive fields.** Keep retired keys archived alongside the
> backups they match. Full runbook: [`docs/KEY_ROTATION.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KEY_ROTATION.md).

> `SECRET_KEY` (JWT signing) is different — rotating it signs everyone out by
> design. `AUDIT_LOG_SIGNING_KEY` must not be casually rotated: historical
> audit rows verify under the key that wrote them. Rows written before a
> dedicated `AUDIT_LOG_SIGNING_KEY` (or `VOTE_SIGNING_KEY`) took effect were
> signed with `SECRET_KEY` and still verify under it, so rotating
> `SECRET_KEY` also makes those rows read as tampered.

---

## TLS (Data in Transit)

All data between clients and the server should be encrypted via HTTPS in
production. The nginx configuration shipped in `infrastructure/nginx/`
(`nginx.conf` and `docker.conf`) accepts **TLS 1.2 and TLS 1.3**
(`ssl_protocols TLSv1.2 TLSv1.3`); TLS 1.0 and 1.1 are refused. To require
TLS 1.3 only, change that line to `ssl_protocols TLSv1.3;` — clients that
cannot negotiate TLS 1.3 will then fail to connect.

### Setting Up HTTPS

**With reverse proxy (recommended):**

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

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

The audit logging system uses a blockchain-inspired **keyed HMAC-SHA256** hash chain to ensure tamper-evident records — forging the chain requires the signing key, not merely database write access. (Rows written before the keyed upgrade remain verifiable under the legacy unkeyed SHA-256 scheme.)

### How It Works

1. Each audit log entry includes the hash of the previous entry
2. Any modification to a past entry breaks the chain
3. Weekly checkpoints anchor verified ranges of the chain
4. 7-year retention (2555 days), exceeds HIPAA 6-year minimum

### Verifying Integrity

```bash
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity
```

Response indicates whether the chain is intact or which entries have issues.

---

**See also:** [Security Overview](Security-Overview) | [Authentication](Security-Authentication) | [Audit Logging](Security-Audit-Logging)
