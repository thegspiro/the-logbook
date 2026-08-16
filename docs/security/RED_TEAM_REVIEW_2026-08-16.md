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

## Residual deployment decisions

The residual items documented in the 2026-08-11 review remain deployment or product decisions:
verified database/Redis TLS, fail-closed GeoIP policy where country blocking is advertised, and an
accessible challenge-response provider for exposed public forms. Operators should enable the
applicable controls for their threat model and alert on degraded enforcement.

## Validation still required

1. Run an authenticated DAST and manual penetration test against staging with two organizations and
   accounts at every privilege tier.
2. Validate reverse-proxy trusted-host/client-IP behavior and TLS from an external network vantage
   point.
3. Exercise every upload endpoint with a maintained hostile-file corpus.
4. Review cloud IAM, database grants, secrets management, backups, audit shipping, and third-party
   integration scopes against the production environment.
