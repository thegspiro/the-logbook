# Red-Team Security Review — 2026-08-16

## Scope and method

This follow-up reviewed the complete FastAPI and React application, its public and authenticated
routes, authentication/session/CSRF middleware, tenant and permission enforcement, uploads,
outbound requests, browser persistence, deployment configuration, and dependency manifests. The
review combined the repository's 1,348-handler permission inventory, targeted security regression
tests, dependency advisory scanning, and searches for common command execution, unsafe
deserialization, TLS-bypass, XSS, SSRF, redirect, token-storage, and file-upload primitives.

This was a source review, not a live penetration test. Infrastructure IAM, proxy behavior, runtime
secrets, production data, third-party accounts, and network segmentation must still be validated in
a representative staging penetration test.

## Result

No new critical or high-severity vulnerability was confirmed. Existing controls continue to cover
the principal server-side attack paths: authenticated mutations require CSRF proof, authorization
is enforced by server-side dependencies, public endpoints have purpose-built throttling, outbound
integration URLs are validated, uploads are bounded and validated, and authentication tokens are
kept in cookies rather than browser storage.

One additional shared-device confidentiality weakness was confirmed and fixed:

### RT-08 — Equipment-check drafts survived logout

**Severity:** Medium  
**CWE:** CWE-922 (Insecure Storage of Sensitive Information)

Equipment-check work in progress is stored in `localStorage` under
`equipment-check-draft-*`. The shared-device logout purge removed shift-report drafts and offline
queues, but did not remove these equipment-check keys. On a station computer, the next member using
the same browser profile could therefore recover apparatus results and narrative notes left by the
previous member, even after a successful logout.

The draft purge now sweeps both shift-report and equipment-check namespaces, including orphaned
keys that are absent from an index. A regression test seeds both types of sensitive draft, verifies
their removal, and verifies unrelated browser preferences remain intact.

The cleanup is corruption- and race-safe: malformed draft indexes cannot skip the namespace sweep,
the sweep runs again after asynchronous queue cleanup to remove drafts recreated by an in-flight
form, and failed token refreshes invoke the same purge before redirecting to login.

## Residual deployment decisions

The residual items documented in the 2026-08-11 review remain deployment or product decisions:
verified database/Redis TLS and a fail-closed GeoIP policy where country blocking is advertised.
Operators should enable the applicable controls for their threat model and alert on degraded
enforcement.

## Follow-up — attack-protection pass (2026-08-17)

The challenge-response residual above is now **implemented** rather than outstanding, and three
adjacent brute-force gaps were closed alongside it.

### CI-11 — auth rate limit was neither Redis- nor memory-limited on a Redis error

**Severity:** Low (defense-in-depth) · Carried over from `docs/app-review/core-infra.md`

`check_rate_limit` requested the Redis verdict with `fail_closed=False` and a comment promising a
fall back to the in-memory limiter on error. The fallback was unreachable: `is_rate_limited`
catches its own exceptions and returns `False` ("not limited") unless `raise_on_error` is set, so
in the window where Redis is connected but a command transiently fails, the request was limited by
neither backend. Now passes `raise_on_error=True`, matching what the sibling `public_rate_limit`
helper already did. The regression test was confirmed to fail without the fix.

### Cross-account per-IP throttling (credential stuffing)

The per-IP rate limit caps burst speed; the per-account lockout caps guesses against one user. A
spray slips between them — one IP trying two passwords each against a thousand usernames stays
under 5/min and never reaches `MAX_LOGIN_ATTEMPTS` on any single account. `app/core/suspicious_ip.py`
counts failed attempts per IP across all accounts and blocks the IP past a threshold. A fully
successful sign-in clears the counter (so shared station NAT does not accumulate ordinary typos),
but never lifts an active block (so an attacker holding one valid credential cannot unblock
themselves). Wired into `/login` and `/mfa/login`, including the pre-verification challenge
rejections that resolve no account.

### Breached-password detection

Complexity rules accept passwords already sitting in public breach corpora — exactly what
credential stuffing tries first. Checked against the HIBP range API under k-anonymity: only the
first five characters of the SHA-1 hash leave the process. **Fails open**, deliberately, since
complexity rules, password history, MFA, and lockout still apply and a third-party outage must not
block password changes during an incident. Off by default.

### Challenge-response on exposed public forms

Pluggable Turnstile / hCaptcha / reCAPTCHA verification behind `CAPTCHA_ENABLED`, applied to public
form submission and forgot-password. **Fails closed** — the opposite of the breached-password check,
because there is no fallback control here and accepting unverified traffic during a provider outage
is precisely the state an attacker wants. Not applied to guest check-in, which is reached by scanning
a QR code at a station display where a challenge would be hostile. The CSP is widened for the
configured provider's widget origins only; with CAPTCHA off the policy is unchanged.

## Validation still required

1. Run an authenticated DAST and manual penetration test against staging with two organizations and
   accounts at every privilege tier.
2. Validate reverse-proxy trusted-host/client-IP behavior and TLS from an external network vantage
   point.
3. Exercise every upload endpoint with a maintained hostile-file corpus.
4. Review cloud IAM, database grants, secrets management, backups, audit shipping, and third-party
   integration scopes against the production environment.
