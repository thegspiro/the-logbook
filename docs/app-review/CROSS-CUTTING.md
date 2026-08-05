# Application Review — Cross-Cutting Findings

Patterns that recur across features, aggregated so one sweep can close the whole
class. Numbered `AXC-n` to keep them distinct from the module audit's
[XC-1/2/3](../module-audit/CROSS-CUTTING.md), which remain open and in force.

---

## AXC-1 — `request.client.host` used instead of `get_client_ip(request)`

**Found in:** A2 (auth & session lifecycle), where 6 instances were fixed.
**Remaining: 28 instances across 7 files**, each belonging to a feature later in
the rotation.

### Why it matters

The production profile runs behind nginx. `docker-compose.prod.yml` sets
`TRUSTED_PROXY_IPS` to the RFC1918 ranges, so `get_client_ip()` correctly
resolves the real client from the right-most non-proxy `X-Forwarded-For` hop —
but `request.client.host` returns **the proxy's address**. Every record written
with the raw value therefore stores one identical internal IP for all users.

This is not a disclosure bug; it is a *silent-loss-of-signal* bug, which is
worse in the places it appears: the data looks present and is trusted by
features built on top of it.

### Site inventory, by consequence

| File | Sites | Feature / iteration | Consequence |
|---|---|---|---|
| `api/v1/endpoints/elections.py` | 5 | B5 elections | **HIGH — breaks a documented feature.** Per-vote IPs feed ballot fraud detection. `BALLOT_FORENSICS_GUIDE.md` documents `suspicious_ips` ("any IP that cast more than 5 votes") and `unique_ip_count`. Behind the proxy every ballot carries the same IP, so `unique_ip_count` collapses to 1 and **every election trips the suspicious-IP threshold** — the anomaly detection is not merely degraded, it is inverted into a permanent false positive. |
| `api/v1/endpoints/ip_security.py` | 10 | B23 security/audit/IP | **MED — the module is *about* IPs.** Requester/admin IPs on exception requests and approvals all record the proxy, so the audit of who requested and approved an IP allowlist entry carries no attribution. |
| `api/v1/endpoints/security_monitoring.py` | 8 | B23 security/audit/IP | MED — security-event IPs are the primary investigative field. |
| `api/v1/onboarding.py` | 5 | B25 onboarding | LOW/MED — tenant-provisioning audit trail (owner creation, org creation). |
| `core/public_portal_security.py` | 2 | B26 public-portal | **MED — unauthenticated surface.** Anonymous callers are the case where the real IP matters most. |
| `api/public/portal.py` | 1 | B26 public-portal | MED — same. |
| `api/v1/endpoints/error_logs.py` | 2 | B23 | LOW — error-report attribution. |

`core/audit.py` also carried the pattern in its `log_audit_event` **docstring
example** — no runtime effect, but it is the snippet developers copy, and the
likely origin of the whole class. Fixed in A2 (AUTH-3) with a note explaining
why.

### Fix shape

Mechanical and identical everywhere:

```python
from app.core.security_middleware import get_client_ip   # none of the 7 files import it yet
...
ip_address=get_client_ip(request)                        # was: request.client.host if request.client else None
```

`get_client_ip` returns `str` (never `None`) and falls back to the peer IP when
`TRUSTED_PROXY_IPS` is unset, so the change is **never worse than the current
behavior** in any deployment.

### Why it wasn't swept in A2

Each remaining file belongs to a feature with its own iteration, and the sweep
touches election-forensics semantics (whether historical rows should be
backfilled or left, and whether anomaly thresholds need retuning once
`unique_ip_count` becomes real). Two options for the owner:

1. **Let the rotation handle it** — each iteration fixes its own file. Slower;
   elections (HIGH) waits until B5.
2. **Run a dedicated sweep now** — one focused pass over all 7 files. Recommended
   given the elections impact, and small: 28 one-line edits plus 7 imports.

### Related documentation gap

No document states that `TRUSTED_PROXY_IPS` **must** be set for client-IP
features to work. `.env.example.full:464` calls it "CRITICAL when behind a
reverse proxy" and `docker-compose.prod.yml` ships a default — but a self-hosted
deployment using the base `docker-compose.yml` behind its own proxy silently
gets proxy IPs everywhere, and nothing warns the operator. Worth a startup
warning (the codebase already has `startup_validators.py`) rather than only a
comment in an example file.
</content>
