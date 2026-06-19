# Ongoing Review Log

A recurring `/loop` reviews the codebase ~every 30 min for **security issues,
incomplete sections, feature improvements, and documentation gaps**. Each tick
covers one area, records findings here, fixes what's clearly correct and
low-risk (security hardening, doc fixes), and surfaces larger items (feature
work, ambiguous changes) for owner review rather than auto-implementing.

## Rotation (advances each tick)
1. Core auth & security — middleware, dependencies, security.py, CSRF, sessions
2. Documentation — README, CLAUDE.md, `.env` examples, API docs accuracy
3. Training module
4. Events module
5. Finance module
6. Inventory module
7. Elections module
8. Communications module
9. Membership / users module
10. Frontend cross-cutting security — apiCache exclusions, token handling, XSS

(After area 10, wrap back to 1.)

## Findings log

### Tick 1 — Area 1: Core auth & security
Layer is well-hardened overall (Argon2id, JWT alg allowlist, server-side
session validation + idle timeout, refresh rotation/replay revocation,
fail-closed rate limiting, pure-ASGI middleware, SameSite=Strict cookies,
double-submit CSRF, hashed reset tokens). Findings:

**Needs owner decision (verified):**
- **[HIGH] MFA surfaced but not implemented.** `mfa_enabled` is stored and
  returned by `/auth/me`, but there is **no TOTP/MFA verification anywhere**
  in the backend (no `pyotp` usage, no MFA challenge endpoint) — login issues
  full session cookies on password alone. Either implement an MFA challenge
  step or stop advertising `mfa_enabled` to clients. (`auth.py` login flow;
  `auth.py:176` /me.)
- **[MED] `must_change_password` not enforced server-side.** Set/cleared in
  `auth_service.py` but no dependency gates other endpoints when true — only
  the frontend honors it. (`dependencies.py` get_current_active_user.)
- **[MED] CSRF "no csrf cookie → allow" branch** is broader than its docstring
  claims (allows any request lacking the cookie, not just the first
  post-login). SameSite=Strict is the real defense; tighten or fix the
  docstring. (`security_middleware.py:535-545`.)
- **[MED] `is_rate_limited`** writes the request to the sliding window before
  the count check; verify against intended semantics. (`security.py:686-719`.)

**Fixed this tick (clearly-correct):**
- `decode_token` docstring now states it does not verify token type or
  server-side session (use AuthService.get_user_from_token). (`security.py`.)

**Reclassified:**
- `validate_url` optional-TLD "SSRF" item → **dead code** (no callers);
  requiring a TLD would break internal hostnames. No change.

Confirmed clean: JWT alg confusion, username enumeration, refresh
rotation/replay, session invalidation on password change/reset, cookie
attributes (Pitfall #6), pure-ASGI middleware (Pitfall #4), unbounded caches
(Pitfall #9), IP-spoofing/XFF handling, global CSRF wiring, SQL injection,
permission matching. No TODO/FIXME/stubs.
