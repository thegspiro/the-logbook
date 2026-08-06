# Module Audit — Core Infrastructure

**Scope:** backend foundational layer — `core/config.py` (secrets/CORS/deploy),
`core/database.py`, `core/cache.py` (Redis), `core/websocket_manager.py`,
`core/security.py` (auth/crypto), `core/encrypted_types.py` (AES field
encryption), and shared `utils/` (csv_export, image_validator/processing,
security_notifications, startup_validators). Frontend shared (hooks/services/
utils/stores/components) is deferred to iteration #27 to avoid overlap.
**Audited:** iteration 24 — three parallel readers: (A) cache + websocket +
database, (B) crypto/auth primitives, (C) config + upload/util hardening.

## Verified good ✅
- **Crypto foundation is strong.** Argon2id password hashing (above OWASP mins,
  no bcrypt 72-byte truncation, constant-time verify, rehash-on-login); JWT
  algorithm hard-pinned to HS256 (no alg-confusion, no `verify_signature=False`
  anywhere); every security token uses a CSPRNG (`secrets`/`pyotp`, never
  `random`); Fernet gives authenticated encryption with a fresh random IV (not
  ECB/static-IV); TOTP is replay-protected with tight ±30s drift and constant-time
  compares; refresh-token rotation revokes on replay with a 30s grace; external
  IdP tokens verified via JWKS with audience/issuer pinned. Secrets fail closed —
  `SECRET_KEY`/`ENCRYPTION_KEY`/`ENCRYPTION_SALT` default to `""` and prod refuses
  to boot on empty/`<32`/`CHANGE_ME` values.
- **Config/deploy hardening is solid.** `DEBUG`/`DB_ECHO`/`ENABLE_DOCS` are
  CRITICAL-gated in prod (block startup); CORS is never wildcard-with-credentials
  (`*` rejected as CRITICAL); secrets are masked in `__repr__`; dangerous JWT
  `alg` values rejected at startup.
- **Cache/WS/DB isolation holds.** WebSocket auth binds `org_id` to the JWT (not
  client input) and broadcasts are strictly org-partitioned; `cache.set` always
  applies a TTL; the DB session is per-request with commit/rollback/close; the
  rate limiter uses an atomic Redis pipeline and fails closed when Redis is down.
- **Image logo upload is well-hardened** (magic-byte MIME, Pillow verify+reopen,
  `MAX_IMAGE_PIXELS` set, dimension bounds, SVG/GIF blacklisted, EXIF stripped, no
  filename constructed → no path traversal). `SafeCsvWriter` neutralization is
  correct.

## Findings

### CI-1 — MEDIUM — Spreadsheet formula injection in five CSV exporters — ✅ FIXED
A correct shared `SafeCsvWriter` (neutralizes cells starting with `= + - @`)
existed, but five exporters still used raw `csv.writer`, writing
attacker-influenceable free text (item names, memos, member names, notes) into
CSVs opened in Excel/Sheets — `=…` cells execute on the responder's machine.
**Fix:** swapped `csv.writer(output)` → `SafeCsvWriter(output)` in
`equipment_check.py`, `inventory.py` (×2), `finance_service.py`, and
`admin_hours_service.py` (dropping the now-unused `csv` imports). (The compliance
export was already hardened via `_csv_safe` in iteration #22.)

### CI-2 — MEDIUM — DB connection errors could log the credentialed DSN — ✅ FIXED
`database.py` logged the raw connection exception (`{e}`); several async-driver
exceptions embed the connection string, which carries `DB_PASSWORD`.
**Fix:** log the exception **type** plus a message scrubbed of `DB_PASSWORD`.

### CI-3 — MEDIUM (DoS) — WebSocket connection registry was unbounded — ✅ FIXED
`ConnectionManager` had no per-org cap; an authenticated tenant could open
connections in a loop and exhaust worker memory (the registry only reaps dead
sockets).
**Fix:** `connect()` now enforces `MAX_CONNECTIONS_PER_ORG = 200`, closing the
socket (code 1013) and returning `False` when the org is at cap; the caller bails.

### CI-4 — MEDIUM — ORM field decryption masked all errors (fail-open) — ✅ FIXED
`EncryptedText.process_result_value` (and the `mfa_secret`/`mfa_backup_codes`
getters) caught bare `Exception` and returned the raw stored value, so a genuine
decrypt failure — wrong/rotated key, programming bug — was silently surfaced as
"plaintext" instead of erroring.
**Fix:** narrowed the `except` to `InvalidToken` only (the legacy-plaintext case,
which Fernet raises on non-tokens); real errors now propagate. The legacy
plaintext passthrough is preserved; a full fail-closed switch remains flagged
(needs a backfill migration of legacy rows).

### CI-5 — MEDIUM (doc accuracy) — "AES-256" claimed where Fernet is AES-128-CBC — ✅ FIXED
`encrypt_data` and the `EncryptedText` docstrings claimed AES-256 in HIPAA-facing
comments, but Fernet is AES-128-CBC + HMAC-SHA256 (still authenticated, NIST-
approved, "AES or equivalent" for HIPAA — just not 256-bit).
**Fix:** corrected the docstrings to state the actual algorithm. **✅ Update
(app-review B24): the AES-256-GCM migration is DONE.** `core/security.py` now
encrypts new values with AES-256-GCM (AEAD, tagged `$gcm2$`); legacy Fernet values
stay readable and `scripts/reencrypt_to_aesgcm.py` backfills them (runbook:
`docs/AES256_GCM_BACKFILL_RUNBOOK.md`). So the "switching would require
re-encryption — flagged" note no longer stands.

### CI-6 — LOW — `decode_token` didn't require an `exp` claim — ✅ FIXED
`jwt.decode` pinned HS256 but didn't require `exp`, so a token minted without one
would never expire. Every issuer sets `exp`, so this only closes the
malformed/forged-without-exp case.
**Fix:** added `options={"require": ["exp"]}`.

### CI-7 — LOW — Security-notification email interpolated `message` unescaped — ✅ FIXED
`security_notifications.py` built `f"<p>{message}</p>"` while `wrap_email_body`
documents its body as pre-escaped. All current callers pass literals (not
exploitable today), but it's a latent HTML-injection footgun.
**Fix:** `html.escape` the interpolated message.

### CI-8 — LOW — Misleading comment on the dev insecure-defaults block — ✅ FIXED
`main.py` claimed `SECURITY_BLOCK_INSECURE_DEFAULTS` "defaults to True" while it
defaults to `False`, which could lull an operator into thinking a dev box with
default secrets is self-protecting.
**Fix:** corrected the comment.

### CI-9 — MED/LOW (flagged) — Fail-open / hardening items needing a decision
- **DB/Redis TLS only WARNS in prod** (not CRITICAL), so a HIPAA deployment can
  boot with PHI/queries and cached session data crossing the network in cleartext.
  Promoting these to CRITICAL is the correct posture but would refuse boot for any
  prod currently running without TLS — an ops decision. (config #1)
- **`optimize_image` fails open** — a valid-header decompression bomb (passes the
  magic-byte check) or any error returns the original bytes unprocessed, storing
  the bomb and bypassing EXIF/GPS stripping; it also doesn't set a local
  `MAX_IMAGE_PIXELS`. Making it reject/re-raise changes the avatar/equipment-photo
  upload contract. (image #2)
- **Redis TLS disables cert + hostname verification** when no CA is configured
  (`CERT_NONE`) — MITM on the rate-limit / pub-sub channel. Failing closed could
  break deployments relying on this path. (cache #2)
**Status:** flagged.

### CI-10 — LOW (flagged) — Latent isolation / robustness
- The Redis cache manager provides **no tenant namespacing** — all current
  callers use intentionally-global keys (no PHI/PII cached), but the shared infra
  offers no guardrail, so a future caller caching an org-scoped record under a
  bare id would leak cross-tenant with no layer catching it. **✅ `clear_pattern()`
  removed (app-review B24)** — it was unused and a wildcard-delete footgun; the
  namespacing guardrail itself remains a design item. (cache #1/#6)
- WebSocket `accept()` happens before auth (deliberate, so close codes reach the
  browser — minor pre-auth resource use); `publish_event` falls back to
  worker-local delivery on Redis failure. (ws #4/#7)
- **✅ PBKDF2 KDF now 600k (app-review B24).** The field-encryption KDF's current
  work factor is 600k iterations (`_KDF_ITERATIONS_V2`, `$gcm2$`); the 100k
  `$gcm1$` path is retained read-only for migration-era values. **Still flagged:**
  MFA **recovery codes are 40-bit, unsalted SHA-256** — well-mitigated
  (Fernet-encrypted at rest, single-use, lockout-throttled) and migration-shaped.
  (crypto #3 done / #5 open)
**Status:** flagged.

## Notes
- Large-file caveat: `security.py` (748 L), `config.py` (603 L), and
  `security_middleware.py` (IP path, reviewed in #23) were reviewed for security
  invariants (crypto correctness, secret handling, fail-closed), not
  line-by-line. The invariants held on every path examined.
- Tests: 80 relevant security/auth/crypto unit tests pass with these changes
  (the one scheduling error is a DB-fixture issue, unrelated).
- CI-1 revisits export paths in modules audited earlier (#3 inventory, #7
  equipment-check, #15 admin-hours, #20 finance) where the earlier readers focused
  on tenant isolation and didn't flag CSV formula injection.
