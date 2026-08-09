# Application Review — Core Infrastructure (Tier B)

**Prefix:** `CI2` · **Iteration:** B24 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

## Pass 3 (2026-08-09) — verified clean, no code change

Re-verified the crypto/CSV/middleware foundation:

- **CI-1** — `SafeCsvWriter` (`utils/csv_export.py`) present; the five exporters use
  it (Pitfall #15).
- **CI-4** — the field decrypt path narrows its catch to `except InvalidToken` (legacy
  plaintext only); a genuine AES-256-GCM `InvalidTag` propagates
  (`encrypted_types.py:49`).
- **CI-5** — field encryption is AES-256-GCM (600k PBKDF2), per the corrected docs.
- **Pitfall #4 (pure ASGI middleware)** — `security_middleware.py` explicitly does
  **not** import `BaseHTTPMiddleware` (module note, line 18); every middleware there
  is pure ASGI (`__call__(scope, receive, send)`), so the Set-Cookie-stripping hazard
  the pitfall warns about doesn't apply.

**E712-free** across `app/core/*.py` and `app/main.py`. **Latent-500 lens N/A** —
this is foundational code (config/crypto/middleware/database), not a resource module
with enum-bearing request schemas.

### Still flagged (unchanged)

- **CI-9** (TLS-CRITICAL posture, `optimize_image` fail-closed, Redis cert — ops/
  config decisions), **CI-4 full fail-closed decrypt** (flip once the AES-256-GCM
  backfill completes — migration-gated), **CI-11** (defense-in-depth), **CI-10
  residual** (design/migration).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · no code changed.

---

## Pass 2 (2026-08-08) — six-lens sweep — no code change

Re-verified this hardened foundation against the infra lenses. **All clean, no
code change:**

- **Middleware** — all five classes are pure ASGI (`__call__(scope, receive,
  send)`); `BaseHTTPMiddleware` is not imported (Pitfall #4); wrapped `receive`
  callables (`limited_receive`, `_replay_receive`) are `async`; header extension on
  `http.response.start` preserves `Set-Cookie`.
- **Bounded caches (Pitfall #9)** — `RateLimiter` (`_MAX_KEYS` + eviction),
  public-portal caches, GeoIP `_ip_cache`, and the IP allowlist TTL cache all have a
  size cap + eviction. Crypto cipher caches are keyed on operator-set legacy keys
  (not attacker-controllable).
- **Crypto fail-closed** — field encryption is AES-256-GCM AEAD (`$gcm2$`, 600k
  PBKDF2; `$gcm1$` 100k read-only); `decrypt_data` re-raises `InvalidTag`/
  `InvalidToken` when no key verifies; `EncryptedText` lets `InvalidTag` propagate
  (only legacy-plaintext `InvalidToken` is swallowed). The CI-10 `clear_pattern`
  wildcard-delete footgun is confirmed **removed**.
- **JWT / secrets** — HS256 allowlist + `require:["exp"]`; secrets masked in
  `Settings.__repr__`; DB password scrubbed from connect-error logs;
  `safe_error_detail` blocks SQL/paths/tracebacks/mem-addrs and caps length.

### Flagged (LOW, defense-in-depth) — CI-11

The auth rate-limit's "fall back to in-memory on Redis error" path
(`check_rate_limit` → `redis_rate_limited(fail_closed=False)`) is effectively
**unreachable**: the redis helper catches its own exceptions and returns `False`
(not-limited) rather than raising, so the outer `except → in-memory` fallback never
runs. Net effect: in the narrow window where Redis is *connected* but a command
transiently errors, that one auth request is limited by neither backend (fail-open).
A full Redis outage is unaffected (in-memory applies). Not attacker-triggerable and
one of several brute-force controls, so **flagged, not fixed** — honoring the
comment's intent is a behavior change (have the helper distinguish "error" from
"not limited" for callers wanting the fallback). CI-9 and the other pass-1 residuals
stand unchanged.

**No code changed.** The verifications and the one new DiD flag are the deliverable.

**Backend:** `core/config.py`, `core/database.py`, `core/cache.py`,
`core/websocket_manager.py`, `core/security.py` (crypto), `core/encrypted_types.py`,
shared `utils/`
**Prior audit:** `docs/module-audit/core-infra.md` (iteration 24) — CI-1 (CSV
injection ×5), CI-2 (DSN leak), CI-3 (WS DoS), CI-4 (decrypt fail-open), CI-5
(AES-256 doc), CI-6/7/8 fixed; CI-9, CI-10 flagged.

---

## Scope

Tier B: the open CI-9/CI-10 items. The crypto/auth/config foundation is strong and
was re-confirmed. Two of the flagged crypto items turned out **already resolved**
since the audit (doc drift), one dead footgun was removed, and the genuine
ops/migration decisions stay flagged.

## Findings

### CI-5 / CI-10 crypto#3 — field encryption is now AES-256-GCM at 600k PBKDF2 — ✅ ALREADY FIXED (doc drift corrected)

The audit flagged (CI-5) that switching from Fernet (AES-128-CBC) to real AES-256
would need re-encryption, and (CI-10 crypto#3) that the KDF used 100k PBKDF2
iterations vs OWASP's ~600k. **Both are done:**
- `core/security.py` now encrypts new values with **AES-256-GCM** (AEAD), tagged
  `$gcm2$`; legacy Fernet values remain readable, and `scripts/reencrypt_to_aesgcm.py`
  backfills existing rows (see `docs/AES256_GCM_BACKFILL_RUNBOOK.md`).
- The current KDF work factor is **600k** iterations (`_KDF_ITERATIONS_V2`,
  `$gcm2$`); the 100k `$gcm1$` path is retained **read-only** for values written
  during the migration.

`docs/module-audit/core-infra.md` (CI-5, CI-10) and `KNOWN_LIMITATIONS.md` are
corrected to reflect this.

### CI-10 (cache) — `clear_pattern` wildcard-delete footgun — ✅ FIXED (removed)

`CacheManager.clear_pattern(pattern)` did a `scan_iter` + bulk `delete` over a
caller-supplied Redis pattern. It had **no callers** anywhere (source or tests) and
was a footgun — a future caller passing an unsanitized/over-broad pattern could wipe
swaths of keys with no layer catching it. **Removed** (with a comment pointing to a
namespaced replacement if bulk invalidation is ever needed). No behavior change —
nothing used it.

### CI-9 — 🚩 FLAGGED (ops / behavior decisions, unchanged)

- **DB/Redis TLS only WARNS in prod** (not CRITICAL) — promoting to boot-blocking is
  the correct HIPAA posture but would refuse boot for any prod currently running
  without TLS (ops decision).
- **`optimize_image` fails open** — a valid-header decompression bomb (or any
  processing error) returns the original bytes unprocessed, storing the bomb and
  bypassing EXIF/GPS stripping. The global `MAX_IMAGE_PIXELS` still bounds decode,
  but making `optimize_image` reject/re-raise changes the avatar/equipment-photo
  upload contract (behavior change).
- **Redis TLS uses `CERT_NONE`** when no CA is configured — failing closed could
  break deployments relying on this path.

### CI-10 (residual) — 🚩 FLAGGED (design / migration, unchanged)

- Redis cache manager has **no tenant namespacing** — all current callers use
  intentionally-global keys (no PHI/PII cached), so no live issue; a namespacing
  guardrail is a design addition.
- WebSocket `accept()` before auth (deliberate, so close codes reach the browser).
- MFA **recovery codes are 40-bit unsalted SHA-256** (well-mitigated: Fernet-encrypted
  at rest, single-use, lockout-throttled; migration-shaped).
- **CI-4 full fail-closed decrypt** — the decrypt path still passes legacy plaintext
  through on `InvalidToken`; a full fail-closed switch is now *enabled* by the
  AES-256-GCM backfill script but remains a per-deployment completeness decision
  (must confirm no legacy rows remain first).

## Verified good ✅ (re-confirmed)

- CI-1 (`SafeCsvWriter` on all five exporters), CI-2 (scrubbed DSN logging), CI-3
  (`MAX_CONNECTIONS_PER_ORG`), CI-4 (`except InvalidToken` narrowing), CI-6
  (`require: ["exp"]`), CI-7 (`html.escape` in security email), CI-8 (comment) all
  hold. Argon2id hashing, HS256-pinned JWT, CSPRNG tokens, fail-closed secrets,
  org-partitioned WebSocket broadcasts all intact.

## Documentation

`docs/module-audit/core-infra.md` corrected (CI-5 + CI-10 crypto#3 already fixed);
`KNOWN_LIMITATIONS.md` crypto row updated.

## Future development

1. **CI-9** — TLS-CRITICAL posture, `optimize_image` fail-closed, Redis cert
   verification — each an ops/contract decision.
2. **CI-4** — flip the decrypt path fully fail-closed once the AES-256-GCM backfill
   is confirmed complete in a deployment.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (cache) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ cache-related tests **8 passed**; no test referenced the removed `clear_pattern`. |
