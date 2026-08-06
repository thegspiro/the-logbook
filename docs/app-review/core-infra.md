# Application Review — Core Infrastructure (Tier B, 2nd pass)

**Prefix:** `CI2` · **Iteration:** B24 · **Reviewed:** 2026-08-06

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
