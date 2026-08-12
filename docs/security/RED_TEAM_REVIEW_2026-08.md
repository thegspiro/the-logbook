# Red-Team Security Review — August 2026

**Review date:** 2026-08-11
**Scope:** The complete application repository: FastAPI routes and services, React client,
authentication and authorization controls, public endpoints, uploads, persistence, and bundled
deployment configuration.
**Method:** Adversarial static review, endpoint-permission inventory, targeted searches for unsafe
deserialization/process execution/TLS bypass/XSS primitives, and comparison of security controls
across equivalent entry points. This was a source review, not a live penetration test.

## Executive summary

The application has a **strong security baseline** and the previously reported critical tenant
isolation, role-escalation, session, webhook, and audit-chain defects have been remediated. The
automated endpoint inventory found no route that lacked its documented authentication or permission
control. No new critical or high-severity vulnerability was confirmed in this pass.

Seven residual weaknesses remain: **four medium** and **three low**. The most actionable issue is a
server/client contract mismatch in public forms: two access-control settings are persisted and shown
to operators but are not enforced by the public submission endpoint. The image upload stack has a
similar mismatch: callers promise that content is re-encoded and metadata-free, while the shared
optimizer deliberately returns the original bytes on every processing failure. Deployment controls
for transport security and country blocking also remain opt-in or fail-open by default.

> **Remediation update (2026-08-11):** RT-01 through RT-03 are resolved in the
> follow-up implementation. Public-form policy is now enforced against an optional authenticated
> identity (including serialized duplicate prevention); image processing rejects failed decodes;
> and onboarding reset requires the wildcard-granted system owner once that account exists. RT-04
> and RT-05 remain explicit deployment decisions: forcing either switch without TLS-enabled services,
> trusted CA files, or a mounted GeoLite database would make the bundled deployment unavailable rather
> than secure it. The production compose file now exposes those switches without falsely enabling
> them. RT-06 is strengthened for all newly issued recovery codes (80 bits; legacy compatibility
> remains until migration). RT-07 remains a follow-up because selecting a challenge provider and
> accessible fallback is a deployment/product decision rather than a safe repository-only default.

These findings should not be read as proof that the application is breach-proof. Static analysis
cannot validate the running reverse proxy, cloud IAM, database grants, secret handling, container
patch level, or third-party integrations. A staging penetration test with at least two organizations
and accounts at each privilege tier remains necessary.

## Finding summary

| ID    | Severity | Area           | Finding                                                                                      |
| ----- | -------- | -------------- | -------------------------------------------------------------------------------------------- |
| RT-01 | Medium   | Public forms   | `require_authentication` and `allow_multiple_submissions` are not enforced                   |
| RT-02 | Medium   | Uploads        | Image processing fails open and can retain hostile pixels/metadata                           |
| RT-03 | Medium   | Onboarding     | In-progress session can authorize a destructive global reset without owner re-authentication |
| RT-04 | Medium   | Transport      | Database and Redis TLS remain opt-in in production                                           |
| RT-05 | Low      | Geo blocking   | GeoIP lookup failure bypasses country policy by default                                      |
| RT-06 | Low      | MFA            | Recovery codes have only 40 bits of entropy and legacy plaintext matching remains            |
| RT-07 | Low      | Abuse controls | Public form automation relies on honeypots and rate limits, without challenge-response proof |

---

## Detailed findings

### RT-01 — Public form security settings are presentation-only

**Severity:** Medium
**CWE:** CWE-862 (Missing Authorization), CWE-841 (Improper Enforcement of Behavioral Workflow)

The form model and API expose `require_authentication` and `allow_multiple_submissions`, and the
public UI uses the latter to change its confirmation message. However,
`POST /api/public/forms/{slug}/submit` is always unauthenticated and passes the submission directly
to `FormsService.submit_public_form`. It does not load and enforce either setting. The service's
public-form lookup checks publication/public visibility, not submitter identity or uniqueness.

**Attack path:** An operator configures a sensitive intake form as “authentication required” or
disallows repeat responses. An attacker ignores the UI and posts directly to the public route. They
can submit anonymously and repeatedly (subject only to IP/distributed rate limits), potentially
creating false personnel records, triggering emails/integrations, or influencing a workflow that an
operator believed was member-only.

**Recommendation:** Define the settings' precise semantics and enforce them server-side. If
`require_authentication` is true, either reject the public configuration or resolve an authenticated
user through an optional-auth dependency and reject anonymous submissions. If multiple submissions
are disabled, enforce a database uniqueness rule keyed by `(form_id, authenticated_user_id)`; for
truly public forms, use a verified-email token or explicitly relabel the setting because IP/cookie
uniqueness is bypassable. Add API tests that bypass the React client.

### RT-02 — Shared image optimizer fails open

**Severity:** Medium
**CWE:** CWE-636 (Not Failing Securely), CWE-400 (Uncontrolled Resource Consumption)

`optimize_image` catches every exception and returns the original upload. This contradicts its own
contract and callers' claims that files are re-encoded as WebP, resized, and stripped of EXIF data.
Several upload paths validate only byte length and a small magic-byte prefix before calling it. The
utility does not set a conservative local pixel limit, call `verify()`, or reject a Pillow
decompression warning/error. Call-site `try/except` blocks cannot make this fail closed because the
exception has already been swallowed.

**Attack path:** A member with an applicable upload permission submits a malformed or extreme-ratio
JPEG/PNG/WebP that passes the header and 5 MB checks but makes Pillow processing fail. The unprocessed
file is then stored under an `image/webp` data URI/content type. That may preserve GPS/device EXIF,
store parser-hostile bytes for every viewer, and expend substantial CPU/memory during decode.

**Recommendation:** Delete the catch-all fallback and raise a typed validation error. Consolidate
all uploads on `ImageValidator` (or equivalent strict logic), set a project-owned pixel ceiling,
force `load()`/`verify()`, bound dimensions before expensive transforms, and only store bytes after a
successful re-encode. Verify the resulting format before assigning a WebP content type. Add corrupt,
polyglot, EXIF-bearing, and decompression-bomb regression tests for every upload route.

### RT-03 — Onboarding reset trusts the setup session for global deletion

**Severity:** Medium
**CWE:** CWE-306 (Missing Authentication for Critical Function)

Before onboarding is marked complete, `/api/v1/onboarding/reset` accepts a valid onboarding session
and CSRF proof as sufficient authority to delete every onboarding session, status row, facility,
location, user, role, and organization. Once an owner account has been created, the route still does
not require that owner's password/MFA or a fresh destructive-action confirmation. The audit entry is
written in the same transaction as the deletions, so a rollback can also erase evidence that the
attempt began.

**Attack path:** An attacker who steals an in-progress onboarding session (shared setup workstation,
browser extension, XSS, log/screenshot leakage, or support-session exposure) can erase the nascent
tenant and owner before the final completion latch is set. This is primarily destructive, but a
reset also reopens the setup path and can enable takeover if the attacker completes onboarding first.

**Recommendation:** Before an owner exists, require an explicit one-time reset secret printed or
written to the server console. After owner creation, require a recent owner login plus MFA/password
confirmation. Bind the onboarding session to the original user agent where practical, rotate it at
privilege-creating steps, and write reset-attempt telemetry to a transactionally independent or
external audit sink before deletion.

### RT-04 — Production transport security is opt-in

**Severity:** Medium
**CWE:** CWE-319 (Cleartext Transmission of Sensitive Information)

`DB_SSL` and `REDIS_SSL` default to false. In production, missing TLS is only a warning unless the
operator separately enables `SECURITY_REQUIRE_TLS`. This accommodates service meshes and private
networks, but the application cannot verify that compensating encryption exists. Redis carries
sessions/cache state and MySQL carries tenant data, so a copied example or incomplete deployment can
silently operate in plaintext while still passing the startup gate.

**Attack path:** A compromised container, node, overlay-network peer, or incorrectly routed internal
network can observe or modify database/Redis traffic, recover credentials/session material, or alter
authorization-relevant state.

**Recommendation:** Make the secure bundled deployment fail closed: enable `SECURITY_REQUIRE_TLS`
in the production compose override and require CA validation. Provide a separately named,
conspicuous service-mesh override for operators who can attest that transport encryption is supplied
externally. Add a deployment health assertion that reports the effective transport, not only the
application flags.

### RT-05 — Country blocking fails open on lookup errors

**Severity:** Low
**CWE:** CWE-636 (Not Failing Securely)

`GEOIP_FAIL_CLOSED` defaults to false. If the MaxMind database is missing, corrupt, stale in an
unexpected way, or cannot resolve an address, country restrictions do not apply. This is documented
and recoverability-friendly, but it creates a policy mismatch: an operator can configure blocked
countries while the enforcement layer silently permits unknown origins.

**Recommendation:** Enable fail-closed behavior in deployments that advertise country blocking,
keep explicit private-network and break-glass allowlists, and alert on lookup/database failures. The
admin security status should distinguish “no country match” from “GeoIP engine unavailable.”

### RT-06 — MFA recovery-code entropy and legacy compatibility

**Severity:** Low
**CWE:** CWE-331 (Insufficient Entropy)

Recovery codes contain 10 hexadecimal characters (40 bits). New values are SHA-256 hashed and are
single-use, encrypted with the user record, and protected by MFA lockout/rate limiting, so online
exploitation is well mitigated. Nevertheless, 40 bits is below a comfortable offline-secret margin,
and the comparison path intentionally continues to recognize legacy plaintext entries.

**Attack path:** A database disclosure that also defeats field encryption exposes hashes small
enough for a determined offline search, while any unrotated legacy entry may already be directly
usable. This requires a substantial prior compromise and is therefore low severity.

**Recommendation:** Generate at least 80–128 bits per recovery code and store each with a
memory-hard password hash or keyed HMAC. Migrate by forcing regeneration at the next successful MFA
login and remove plaintext compatibility after a measured sunset period. Do not silently invalidate
existing codes without a recovery plan.

### RT-07 — Public forms lack challenge-response abuse resistance

**Severity:** Low
**CWE:** CWE-799 (Improper Control of Interaction Frequency)

Public form submissions have useful controls: per-IP distributed throttling, a per-form daily cap,
and a honeypot. They do not require CAPTCHA, proof-of-work, verified email, or another
challenge-response mechanism. A botnet can consume the default daily allowance of 500 submissions,
deny legitimate use for the rest of the day, and create operational cleanup work. RT-01 increases
the impact because “single submission” is not enforced.

**Recommendation:** Add a configurable challenge provider for internet-facing forms, with an
accessible non-JavaScript fallback. Use separate limits by IP, form, organization, and verified
identity; monitor cap consumption; and ensure webhook/email side effects are queued only after abuse
checks succeed.

---

## Controls verified as strong

The review specifically confirmed the following positive controls, which materially limit the
exploitability of the residual findings:

- Authentication is cookie-based with HttpOnly session tokens and CSRF enforcement for mutations.
- Endpoint-permission documentation and implementation are mechanically consistent across 1,329
  documented route handlers; the checker reported no errors.
- Tenant-aware authorization helpers and module-level isolation tests cover the major data domains.
- Audit rows are organization-scoped and hash-bound; the keyed-chain rewrite operation is gated as
  break-glass functionality.
- Inbound integration webhooks use signature verification and replay detection.
- Outbound integration URLs are checked again at send time to reduce DNS-rebinding SSRF risk.
- TOTP replay and per-user MFA brute-force protections are present.
- Public submission endpoints use proxy-aware client IP resolution and distributed throttling.
- React rendering paths found in the reviewed security/error/public-log surfaces use escaped JSX
  rather than raw HTML insertion.

## Prioritized remediation plan

1. **First sprint:** enforce public-form policy server-side (RT-01) and make image processing fail
   closed (RT-02). Both are concrete contract violations likely to surprise operators.
2. **Second sprint:** redesign onboarding reset authorization and audit durability (RT-03).
3. **Deployment hardening:** enable verified DB/Redis TLS and GeoIP failure alerting in the supported
   production profile (RT-04/RT-05).
4. **Scheduled hardening:** migrate recovery-code entropy and add configurable public-form challenge
   support (RT-06/RT-07).
5. **Validation:** run an authenticated two-tenant DAST/penetration test, exercise every upload with
   hostile corpora, and test production compose/network policy from a clean host.

## Review limitations

- No production data, credentials, cloud control plane, DNS, email/SMS provider, or payment account
  was available.
- No exploit payload was sent to a running application; findings are based on reachable source paths.
- The npm advisory endpoint returned HTTP 403, so this review does **not** attest that installed
  JavaScript dependencies are free of known CVEs. CI should run `npm audit --omit=dev` from a network
  allowed to access the registry advisory service, and the Python/container dependency scanners used
  by the project should run in the same pipeline.
- Business-logic authorization still needs role-by-role validation against an explicit product
  access matrix; a permission decorator can be technically present yet encode the wrong policy.
